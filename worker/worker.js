// Backlog data service — runs on Cloudflare Workers.
// Keys live in Cloudflare as secrets (never in this file):
//   TWITCH_ID, TWITCH_SECRET, SGDB_KEY, STEAM_KEY, STEAM_ID, ITAD_KEY
// KV namespace bound as KV. Only answers requests from ALLOWED_ORIGIN.

const ALLOWED_ORIGIN = "https://goomri.github.io";
const IMG = (id, size) => id ? `https://images.igdb.com/igdb/image/upload/t_${size}/${id}.jpg` : null;
const MATCH_FIELDS = "name,slug,first_release_date,cover.image_id,genres.name,themes.name,game_modes.name,player_perspectives.name,total_rating,aggregated_rating";

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
        case "/search":   out = await search(env, url.searchParams.get("q") || ""); break;
        case "/game":     out = await game(env, +url.searchParams.get("id")); break;
        case "/discover": out = await discover(env, body.like || [], body.exclude || []); break;
        case "/info":     out = await info(env, (body.ids || []).filter(Number.isFinite).slice(0, 400)); break;
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
    rating: Math.round(g.total_rating || g.aggregated_rating || 0) || null,
    ttb: t ? {main: hrs(t.normally || t.hastily), rush: hrs(t.hastily), full: hrs(t.completely)} : null
  };
}
const hrs = s => s ? Math.max(1, Math.round(s / 3600)) : null;
async function ttbFor(env, ids){
  if (!ids.length) return {};
  const rows = await igdb(env, "game_time_to_beats", `fields game_id,hastily,normally,completely; where game_id = (${ids.join(",")}); limit 500;`);
  return Object.fromEntries(rows.map(r => [r.game_id, r]));
}

// Best match for up to 10 titles in one IGDB request.
async function match(env, titles){
  if (!titles.length) return {};
  const mq = titles.map((t, i) => `query games "${i}" { search "${q(t)}"; fields ${MATCH_FIELDS}; where version_parent = null & parent_game = null; limit 10; };`).join("\n");
  const res = await igdb(env, "multiquery", mq);
  const picks = {};
  for (const r of res){
    const t = titles[+r.name], k = norm(t), list = r.result || [];
    const starts = list.filter(g => norm(g.name).startsWith(k)).sort((a, b) => a.name.length - b.name.length);
    picks[t] = list.find(g => norm(g.name) === k) || starts[0] || list[0] || null;
  }
  const ttb = await ttbFor(env, Object.values(picks).filter(Boolean).map(g => g.id));
  return Object.fromEntries(Object.entries(picks).map(([t, g]) => [t, g ? slim(g, ttb) : null]));
}

// Extra fields for games already in the list (backfill).
async function info(env, ids){
  if (!ids.length) return {};
  const rows = await igdb(env, "games", `fields player_perspectives.name; where id = (${ids.join(",")}); limit 500;`);
  return Object.fromEntries(rows.map(g => [g.id, {views: (g.player_perspectives || []).map(x => x.name)}]));
}

async function search(env, text){
  if (!text.trim()) return [];
  const list = await igdb(env, "games", `search "${q(text)}"; fields ${MATCH_FIELDS}; limit 10;`);
  const ttb = await ttbFor(env, list.map(g => g.id));
  return list.map(g => slim(g, ttb));
}

async function game(env, id){
  if (!id) throw new Error("Missing id");
  const [g] = await igdb(env, "games", `fields ${MATCH_FIELDS},summary,artworks.image_id,screenshots.image_id,involved_companies.company.name,involved_companies.developer,url; where id = ${id};`);
  if (!g) throw new Error("Game not found");
  const out = {...slim(g, await ttbFor(env, [id])), summary: g.summary || "",
    developers: (g.involved_companies || []).filter(c => c.developer).map(c => c.company?.name).filter(Boolean),
    hero: IMG(g.artworks?.[0]?.image_id || g.screenshots?.[0]?.image_id, "1080p"),
    shots: (g.screenshots || []).slice(0, 6).map(s => IMG(s.image_id, "screenshot_big")), logo: null, igdbUrl: g.url};
  try { Object.assign(out, await sgdbArt(env, g.name, out.hero)); } catch {}
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
    const d = (r.deals || []).sort((a, b) => (b.cut || 0) - (a.cut || 0))[0];
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
