// Backlog data service — runs on Cloudflare Workers.
// Keys live in Cloudflare as secrets (never in this file):
//   TWITCH_ID, TWITCH_SECRET, SGDB_KEY, STEAM_KEY, STEAM_ID, ITAD_KEY
// KV namespace bound as KV. Only answers requests from ALLOWED_ORIGIN.

const ALLOWED_ORIGIN = "https://goomri.github.io";
const IMG = (id, size) => id ? `https://images.igdb.com/igdb/image/upload/t_${size}/${id}.jpg` : null;
const MATCH_FIELDS = "name,slug,first_release_date,cover.image_id,genres.name,themes.name,game_modes.name,player_perspectives.name,multiplayer_modes.offlinecoop,multiplayer_modes.splitscreen,multiplayer_modes.onlinecoop,keywords.name,total_rating,total_rating_count,aggregated_rating";

export default {
  async fetch(req, env, ctx){
    const origin = req.headers.get("Origin") || "";
    const cors = {"Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin"};
    if (req.method === "OPTIONS") return new Response(null, {headers: cors});
    if (origin !== ALLOWED_ORIGIN) return new Response("Forbidden", {status: 403});
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    try {
      let out;
      switch (url.pathname){
        case "/match":    out = await match(env, (body.titles || []).slice(0, 10)); break;
        case "/search":   globalThis.__debug = url.searchParams.has("debug"); out = await search(env, url.searchParams.get("q") || ""); break;
        case "/game":     out = await game(env, +url.searchParams.get("id")); break;
        case "/discover": out = await discover(env, body.like || [], body.exclude || []); break;
        case "/info":     out = await info(env, (body.ids || []).filter(Number.isFinite).slice(0, 200)); break;
        case "/upcoming": out = await upcoming(env); break;
        case "/deck":     out = await deck(env, (body.items || []).slice(0, 12)); break;
        case "/steamrev": out = await steamReviews(env, +url.searchParams.get("appid")); break;
        case "/couch":    out = await couch(env, url.searchParams.get("kind") || "platformer"); break;
        case "/steam":    out = await steam(env); break;
        case "/prices":   out = await prices(env, (body.titles || []).slice(0, 40)); break;
        case "/psplus":   out = await psplus(env, ctx); break;
        default: return json({error: "Not found"}, 404, cors);
      }
      return json(out, 200, cors);
    } catch (e){
      return json({error: e.message || String(e)}, 502, cors);
    }
  },
  // Daily cron: look for new "leaving PS Plus" articles.
  async scheduled(event, env, ctx){ ctx.waitUntil(refreshPsPlus(env)); }
};

const json = (o, status, headers) => new Response(JSON.stringify(o), {status, headers: {...headers, "Content-Type": "application/json"}});

/* ---------- IGDB ---------- */
async function twitchToken(env){
  const c = await env.KV.get("twitch_token", "json");
  if (c && c.exp > Date.now() + 3600e3) return c.token;
  const r = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${env.TWITCH_ID}&client_secret=${env.TWITCH_SECRET}&grant_type=client_credentials`, {method: "POST"});
  if (!r.ok) throw new Error("Twitch login failed (" + r.status + "). Check TWITCH_ID and TWITCH_SECRET.");
  const d = await r.json();
  await env.KV.put("twitch_token", JSON.stringify({token: d.access_token, exp: Date.now() + d.expires_in * 1000}));
  return d.access_token;
}
async function igdb(env, endpoint, query){
  const r = await fetch("https://api.igdb.com/v4/" + endpoint, {method: "POST", headers: {"Client-ID": env.TWITCH_ID, "Authorization": "Bearer " + await twitchToken(env)}, body: query});
  if (r.status === 401) await env.KV.delete("twitch_token");
  if (!r.ok) throw new Error("IGDB " + r.status + ": " + (await r.text()).slice(0, 200));
  return r.json();
}
const q = s => String(s).replace(/\\/g, "").replace(/"/g, '\\"');
const norm = s => String(s).toLowerCase().replace(/[™®©]/g, "").replace(/[^a-z0-9]+/g, "");

function slim(g, ttb){
  const t = ttb?.[g.id];
  return {
    igdbId: g.id, slug: g.slug, title: g.name,
    year: g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null,
    cover: IMG(g.cover?.image_id, "cover_big"),
    genres: (g.genres || []).map(x => x.name),
    themes: (g.themes || []).map(x => x.name),
    modes: (g.game_modes || []).map(x => x.name),
    views: (g.player_perspectives || []).map(x => x.name),
    ...coop(g), kw: feel(g),
    rating: Math.round(g.total_rating || g.aggregated_rating || 0) || null,
    ratingCount: g.total_rating_count || 0,
    ttb: t ? {main: hrs(t.normally || t.hastily), rush: hrs(t.hastily), full: hrs(t.completely)} : null
  };
}
// Keep only the keywords that describe feel; IGDB has hundreds per game.
const KW = [[/metroidvania/i, "Metroidvania"], [/souls-?like/i, "Soulslike"], [/^(difficult|hardcore|challenging|hard)$/i, "Hard"], [/relaxing|cozy|casual/i, "Chill"], [/^exploration$/i, "Exploration"], [/puzzle.?platform/i, "Puzzle-platformer"], [/precision platform/i, "Precision"], [/atmospheric/i, "Atmospheric"]];
const feel = g => [...new Set((g.keywords || []).flatMap(k => KW.filter(([re]) => re.test(k.name || "")).map(([, l]) => l)))];
const coop = g => ({couch: (g.multiplayer_modes || []).some(m => m.offlinecoop || m.splitscreen), onlineCoop: (g.multiplayer_modes || []).some(m => m.onlinecoop)});
const hrs = s => s ? Math.max(1, Math.round(s / 3600)) : null;
async function ttbFor(env, ids){
  if (!ids.length) return {};
  const rows = await igdb(env, "game_time_to_beats", `fields game_id,hastily,normally,completely; where game_id = (${ids.join(",")}); limit 500;`);
  return Object.fromEntries(rows.map(r => [r.game_id, r]));
}

// Best match for up to 10 titles in one IGDB request.
async function match(env, titles){
  if (!titles.length) return {};
  const picks = {}, lists = {};
  for (let i = 0; i < titles.length; i += 5){
    const part = titles.slice(i, i + 5);
    const mq = part.flatMap((t, j) => [
      `query games "s${i + j}" { search "${q(t)}"; fields ${MATCH_FIELDS}; where version_parent = null & parent_game = null; limit 10; };`,
      `query games "e${i + j}" { fields ${MATCH_FIELDS}; where name ~ "${q(t)}" & version_parent = null; sort total_rating_count desc; limit 5; };`
    ]).join("\n");
    for (const r of await igdb(env, "multiquery", mq)){
      const n = +r.name.slice(1);
      lists[n] = r.name[0] === "e" ? [...(r.result || []), ...(lists[n] || [])] : [...(lists[n] || []), ...(r.result || [])];
    }
  }
  for (const [n, list] of Object.entries(lists)){
    const t = titles[+n], k = norm(t);
    const starts = list.filter(g => norm(g.name).startsWith(k)).sort((a, b) => a.name.length - b.name.length);
    // Several games can share a name (e.g. a mobile spin-off): take the best known one.
    const exact = list.filter(g => norm(g.name) === k).sort((a, b) => (b.total_rating_count || 0) - (a.total_rating_count || 0));
    picks[t] = exact[0] || starts[0] || list[0] || null;
  }
  const ttb = await ttbFor(env, Object.values(picks).filter(Boolean).map(g => g.id));
  return Object.fromEntries(Object.entries(picks).map(([t, g]) => [t, g ? slim(g, ttb) : null]));
}

// Extra fields for games already in the list (backfill).
async function info(env, ids){
  if (!ids.length) return {};
  const rows = await igdb(env, "games", `fields player_perspectives.name,multiplayer_modes.offlinecoop,multiplayer_modes.splitscreen,multiplayer_modes.onlinecoop,keywords.name; where id = (${ids.join(",")}); limit 500;`);
  return Object.fromEntries(rows.map(g => [g.id, {views: (g.player_perspectives || []).map(x => x.name), ...coop(g), kw: feel(g)}]));
}

async function search(env, text){
  if (!text.trim()) return [];
  const mq = `query games "e" { fields ${MATCH_FIELDS}; where name ~ "${q(text)}"; sort total_rating_count desc; limit 5; };
query games "s" { search "${q(text)}"; fields ${MATCH_FIELDS}; limit 10; };`;
  const res = await igdb(env, "multiquery", mq), seen = new Set();
  if (globalThis.__debug) return res;
  const list = [...(res.find(r => r.name === "e")?.result || []), ...(res.find(r => r.name === "s")?.result || [])].filter(g => !seen.has(g.id) && seen.add(g.id));
  const ttb = await ttbFor(env, list.map(g => g.id));
  return list.map(g => slim(g, ttb));
}

async function game(env, id){
  if (!id) throw new Error("Missing id");
  const cached = await env.KV.get("game3:" + id, "json");
  if (cached) return cached;
  const out = await gameFresh(env, id);
  await env.KV.put("game3:" + id, JSON.stringify(out), {expirationTtl: 14 * 86400});
  return out;
}
// Gameplay first; avoid teasers, announcements and cinematic (CG/story) trailers when there's a choice.
function pickTrailer(videos){
  const score = v => { const n = v.name || ""; return (/gameplay|walkthrough|playthrough|first \d+ minutes/i.test(n) ? 10 : 0) + (/launch|release|trailer/i.test(n) ? 2 : 0) - (/teaser|announce|reveal|cinematic|\bcg|story|intro|opening|logo|interview|dev diary/i.test(n) ? 5 : 0); };
  return videos.slice().sort((a, b) => score(b) - score(a))[0]?.video_id || null;
}
async function gameFresh(env, id){
  const [g] = await igdb(env, "games", `fields ${MATCH_FIELDS},summary,artworks.image_id,screenshots.image_id,videos.video_id,videos.name,similar_games,involved_companies.company.name,involved_companies.developer,url; where id = ${id};`);
  if (!g) throw new Error("Game not found");
  const out = {...slim(g, await ttbFor(env, [id])), summary: g.summary || "",
    developers: (g.involved_companies || []).filter(c => c.developer).map(c => c.company?.name).filter(Boolean),
    hero: IMG(g.artworks?.[0]?.image_id || g.screenshots?.[0]?.image_id, "1080p"),
    shots: (g.screenshots || []).slice(0, 8).map(s => IMG(s.image_id, "screenshot_huge")), logo: null, igdbUrl: g.url,
    trailer: pickTrailer(g.videos || []), critic: Math.round(g.aggregated_rating || 0) || null};
  try { Object.assign(out, await sgdbArt(env, g.name, out.hero)); } catch {}
  const sim = (g.similar_games || []).slice(0, 10);
  out.similar = sim.length ? (await igdb(env, "games", `fields ${MATCH_FIELDS}; where id = (${sim.join(",")}); limit 10;`)).map(x => slim(x)) : [];
  return out;
}

/* ---------- SteamGridDB (hero banners + logos) ---------- */
async function sgdb(env, path){
  const r = await fetch("https://www.steamgriddb.com/api/v2/" + path, {headers: {Authorization: "Bearer " + env.SGDB_KEY}});
  if (!r.ok) throw new Error("SteamGridDB " + r.status);
  return (await r.json()).data;
}
async function sgdbArt(env, name, fallbackHero){
  const hit = (await sgdb(env, "search/autocomplete/" + encodeURIComponent(name)))?.[0];
  if (!hit) return {};
  const [heroes, logos] = await Promise.all([
    sgdb(env, `heroes/game/${hit.id}?types=static&nsfw=false`).catch(() => []),
    sgdb(env, `logos/game/${hit.id}?types=static&nsfw=false`).catch(() => [])
  ]);
  return {hero: heroes?.[0]?.url || fallbackHero, logo: logos?.[0]?.url || null};
}

/* ---------- Discover: games IGDB lists as similar to ones you like ---------- */
async function discover(env, like, exclude){
  like = like.filter(Number.isFinite).slice(0, 60);
  if (!like.length) return [];
  const src = await igdb(env, "games", `fields name,similar_games; where id = (${like.join(",")}); limit 60;`);
  const ex = new Set(exclude), count = new Map(), because = new Map();
  for (const g of src) for (const s of g.similar_games || []){
    if (ex.has(s)) continue;
    count.set(s, (count.get(s) || 0) + 1);
    if (!because.has(s)) because.set(s, []);
    because.get(s).push(g.name);
  }
  const top = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(e => e[0]);
  if (!top.length) return [];
  const list = await igdb(env, "games", `fields ${MATCH_FIELDS}; where id = (${top.join(",")}); limit 30;`);
  const ttb = await ttbFor(env, list.map(g => g.id));
  return list.map(g => ({...slim(g, ttb), because: because.get(g.id).slice(0, 3), score: count.get(g.id)}))
    .sort((a, b) => b.score - a.score || (b.rating || 0) - (a.rating || 0));
}

/* ---------- Couch co-op finder ---------- */
// IGDB ids: genre 8 = Platform, perspective 4 = Side view.
async function couch(env, kind){
  const base = `(multiplayer_modes.offlinecoop = true | multiplayer_modes.splitscreen = true)` + (kind === "platformer" ? ` & genres = (8) & player_perspectives = (4)` : "");
  const yearAgo = Math.floor(Date.now() / 1000) - 540 * 86400, now = Math.floor(Date.now() / 1000);
  const [best, fresh] = await Promise.all([
    igdb(env, "games", `fields ${MATCH_FIELDS}; where ${base} & total_rating_count > 8 & version_parent = null & parent_game = null; sort total_rating desc; limit 40;`),
    igdb(env, "games", `fields ${MATCH_FIELDS}; where ${base} & first_release_date > ${yearAgo} & first_release_date < ${now} & version_parent = null & parent_game = null; sort hypes desc; limit 40;`)
  ]);
  const ttb = await ttbFor(env, [...best, ...fresh].map(g => g.id));
  return {best: best.map(g => slim(g, ttb)), fresh: fresh.map(g => slim(g, ttb))};
}

/* ---------- New releases radar: 2D platformers and metroidvanias ---------- */
async function upcoming(env){
  const c = await env.KV.get("upcoming2", "json");
  if (c && Date.now() - c.t < 12 * 3600e3) return c.d;
  const now = Math.floor(Date.now() / 1000), base = `genres = (8) & player_perspectives = (4) & version_parent = null & parent_game = null`;
  // IGDB platform ids: 167 = PS5, 6 = PC (Windows, i.e. Steam).
  const soonQ = plat => `fields ${MATCH_FIELDS}; where ${base} & platforms = (${plat}) & first_release_date > ${now} & first_release_date < ${now + 180 * 86400}; sort first_release_date asc; limit 40;`;
  const [soonPs5, soonPc, recent] = await Promise.all([
    igdb(env, "games", soonQ(167)), igdb(env, "games", soonQ(6)),
    igdb(env, "games", `fields ${MATCH_FIELDS}; where ${base} & first_release_date > ${now - 90 * 86400} & first_release_date <= ${now}; sort hypes desc; limit 40;`)
  ]);
  const withDate = gs => gs.map(g => ({...slim(g), date: g.first_release_date}));
  const d = {soonPs5: withDate(soonPs5), soonPc: withDate(soonPc), recent: recent.map(g => slim(g))};
  await env.KV.put("upcoming2", JSON.stringify({t: Date.now(), d}));
  return d;
}

/* ---------- Steam Deck compatibility (0 unknown, 1 unsupported, 2 playable, 3 verified) ---------- */
async function deck(env, items){
  const out = {};
  await Promise.all(items.map(async it => {
    try {
      let appid = it.appid;
      if (!appid){
        const r = await (await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(it.title)}&cc=us&l=english`)).json();
        const hit = (r.items || []).find(x => norm(x.name) === norm(it.title)) || (r.items || [])[0];
        appid = hit?.id;
      }
      if (!appid){ out[it.title] = {deck: 0}; return; }
      const d = await (await fetch(`https://store.steampowered.com/saleaction/ajaxgetdeckappcompatibilityreport?nAppID=${appid}&l=english`)).json();
      out[it.title] = {appid, deck: d?.results?.resolved_category || 0};
    } catch { out[it.title] = {deck: 0}; }
  }));
  return out;
}

/* ---------- Steam user reviews ---------- */
async function steamReviews(env, appid){
  if (!appid) throw new Error("Missing appid");
  const c = await env.KV.get("rev:" + appid, "json");
  if (c) return c;
  const r = await (await fetch(`https://store.steampowered.com/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=0`)).json();
  const s = r.query_summary || {};
  const out = {pct: s.total_reviews ? Math.round(s.total_positive / s.total_reviews * 100) : null, label: s.review_score_desc || "", total: s.total_reviews || 0};
  await env.KV.put("rev:" + appid, JSON.stringify(out), {expirationTtl: 7 * 86400});
  return out;
}

/* ---------- Steam library ---------- */
async function steam(env){
  const r = await fetch(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${env.STEAM_KEY}&steamid=${env.STEAM_ID}&include_appinfo=1&include_played_free_games=1`);
  if (!r.ok) throw new Error("Steam " + r.status);
  const games = (await r.json()).response?.games;
  if (!games) throw new Error("Steam returned no games. Set Game details to Public in your Steam privacy settings.");
  return games.map(g => ({appid: g.appid, title: g.name, hours: Math.round(g.playtime_forever / 6) / 10}));
}

/* ---------- IsThereAnyDeal prices (PC stores) ---------- */
async function itad(env, path, body){
  const r = await fetch(`https://api.isthereanydeal.com/${path}${path.includes("?") ? "&" : "?"}key=${env.ITAD_KEY}`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
  if (!r.ok) throw new Error("IsThereAnyDeal " + r.status);
  return r.json();
}
async function prices(env, titles){
  if (!titles.length) return {};
  const ids = await itad(env, "lookup/id/title/v1", titles);
  const uuids = [...new Set(Object.values(ids).filter(Boolean))];
  if (!uuids.length) return Object.fromEntries(titles.map(t => [t, null]));
  let rows;
  try { rows = await itad(env, "games/prices/v3?country=IL&deals=true", uuids); }
  catch { rows = await itad(env, "games/prices/v3?country=US&deals=true", uuids); }
  const best = {};
  for (const r of rows){
    // Only the stores Omri buys from on PC.
    const d = (r.deals || []).filter(x => /^(steam|epic)/i.test(x.shop?.name || "")).sort((a, b) => (b.cut || 0) - (a.cut || 0))[0];
    if (d) best[r.id] = {cut: d.cut || 0, price: d.price?.amount, regular: d.regular?.amount, currency: d.price?.currency, shop: d.shop?.name, url: d.url};
  }
  return Object.fromEntries(titles.map(t => [t, ids[t] ? (best[ids[t]] || {cut: 0}) : null]));
}

/* ---------- PS Plus leaving: news articles, matched against your titles in the app ---------- */
const FEEDS = ["https://www.pushsquare.com/feeds/latest", "https://www.kitguru.net/feed/"];
const LEAVING = /(leav|last chance|los(e|ing)).*(ps plus|playstation plus)|(ps plus|playstation plus).*(leav|last chance|los(e|ing))/i;
async function psplus(env, ctx){
  let data = await env.KV.get("psplus", "json");
  if (!data || Date.now() - data.checked > 12 * 3600e3){
    ctx.waitUntil(refreshPsPlus(env));
    data = data || await refreshPsPlus(env);
  }
  const cutoff = Date.now() - 45 * 864e5;
  return (data.articles || []).filter(a => a.date > cutoff);
}
async function refreshPsPlus(env){
  const old = (await env.KV.get("psplus", "json")) || {articles: []};
  const known = new Set(old.articles.map(a => a.url));
  const found = [];
  for (const feed of FEEDS){
    try {
      const xml = await (await fetch(feed, {headers: {"User-Agent": "Backlog personal app"}})).text();
      for (const item of xml.split(/<item[\s>]/).slice(1)){
        const title = strip(pick(item, "title")), link = strip(pick(item, "link")), date = Date.parse(strip(pick(item, "pubDate"))) || Date.now();
        if (LEAVING.test(title) && link && !known.has(link)) found.push({title, url: link, date});
      }
    } catch {}
  }
  for (const a of found.slice(0, 4)){
    try {
      const html = await (await fetch(a.url, {headers: {"User-Agent": "Backlog personal app"}})).text();
      a.text = strip(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")).slice(0, 20000);
    } catch {}
  }
  const cutoff = Date.now() - 60 * 864e5;
  const data = {checked: Date.now(), articles: [...found.filter(a => a.text), ...old.articles].filter(a => a.date > cutoff).slice(0, 12)};
  await env.KV.put("psplus", JSON.stringify(data));
  return data;
}
const pick = (s, tag) => (s.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || "";
const strip = s => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&rsquo;/g, "'").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
