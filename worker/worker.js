// Backlog data service — runs on Cloudflare Workers.
// Keys live in Cloudflare as secrets (never in this file):
//   TWITCH_ID, TWITCH_SECRET, SGDB_KEY, STEAM_KEY, STEAM_ID
// KV namespace bound as KV. Only answers requests from ALLOWED_ORIGIN.

const ALLOWED_ORIGIN = "https://goomri.github.io";
const IMG = (id, size) => id ? `https://images.igdb.com/igdb/image/upload/t_${size}/${id}.jpg` : null;
const MATCH_FIELDS = "name,slug,first_release_date,cover.image_id,genres.name,themes.name,game_modes.name,player_perspectives.name,multiplayer_modes.offlinecoop,multiplayer_modes.splitscreen,multiplayer_modes.onlinecoop,keywords.name,total_rating,total_rating_count,aggregated_rating,platforms.abbreviation";

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
        case "/info":     out = await info(env, (body.ids || []).filter(Number.isFinite).slice(0, 200), (body.apps || []).filter(Number.isFinite).slice(0, 200)); break;
        case "/upcoming": out = await upcoming(env); break;
        case "/deck":     out = await deck(env, (body.items || []).slice(0, 12)); break;
        case "/steamrev": out = await steamReviews(env, +url.searchParams.get("appid")); break;
        case "/logos":    out = await logos(env, url.searchParams.get("t") || ""); break;
        case "/grids":    out = await grids(env, (body.titles || []).slice(0, 10)); break;
        case "/topmv":    out = await topMetroidvanias(env); break;
        case "/finds":    out = await finds(env); break;
        case "/steamtags": out = await steamTags(env, (body.apps || []).filter(Number.isFinite).slice(0, 100)); break;
        case "/toptags":  out = await topTags(env, +url.searchParams.get("appid")); break;
        case "/achievements": out = await achievements(env, +url.searchParams.get("appid")); break;
        case "/trophies": out = await trophies(env); break;
        case "/rarity":   out = await rarity(env, url.searchParams.get("np") || "", url.searchParams.get("svc") || "trophy"); break;
        case "/achrarity": out = await achRarity(env, +url.searchParams.get("appid")); break;
        case "/steamwish": out = await steamWishlist(env); break;
        case "/steam":    out = await steam(env); break;
        default: return json({error: "Not found"}, 404, cors);
      }
      return json(out, 200, cors);
    } catch (e){
      return json({error: e.message || String(e)}, 502, cors);
    }
  }
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
// ™ ® © break IGDB name search ("Celeste™" finds nothing), so drop them from every query.
const q = s => String(s).replace(/[™®©]/g, "").replace(/\\/g, "").replace(/"/g, '\\"').trim();
const norm = s => String(s).toLowerCase().replace(/[™®©]/g, "").replace(/[^a-z0-9]+/g, "");

// IGDB platform abbreviations → short codes for "available on".
const PCODE = {"PS5": "ps5", "PS4": "ps4", "PC": "pc", "Switch": "switch", "Switch 2": "switch", "NS2": "switch", "Series X|S": "xbox", "XONE": "xbox"};
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
    avail: [...new Set((g.platforms || []).map(p => PCODE[p.abbreviation]).filter(Boolean))],
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

// Name lookups. IGDB's free-text search started returning nothing, so match by name instead:
// exact (case-insensitive), then "starts with", then "contains". Editions/DLC are skipped where possible.
async function byName(env, t, extra = "& version_parent = null", limit = 6){
  const n = q(t);
  for (const cond of [`name ~ "${n}"`, `name ~ "${n}"*`, `name ~ *"${n}"*`]){
    const rows = await igdb(env, "games", `fields ${MATCH_FIELDS}; where ${cond} ${extra}; sort total_rating_count desc; limit ${limit};`);
    if (rows.length) return rows;
  }
  return [];
}
// Best match for up to 10 titles.
async function match(env, titles){
  if (!titles.length) return {};
  const picks = {};
  for (const t of titles){
    const k = norm(t), list = await byName(env, t);
    const exact = list.filter(g => norm(g.name) === k);
    const starts = list.filter(g => norm(g.name).startsWith(k)).sort((a, b) => a.name.length - b.name.length);
    picks[t] = exact[0] || starts[0] || list[0] || null;
  }
  const ttb = await ttbFor(env, Object.values(picks).filter(Boolean).map(g => g.id));
  return Object.fromEntries(Object.entries(picks).map(([t, g]) => [t, g ? slim(g, ttb) : null]));
}

// Extra fields for games already in the list (backfill).
async function info(env, ids, apps = []){
  if (!ids.length) return {};
  const steam = {};
  if (apps.length) for (const it of await getItems(apps, {include_reviews: true}).catch(() => [])){
    const r = it.reviews?.summary_filtered; if (r?.review_count) steam[it.appid] = {pct: r.percent_positive, n: r.review_count};
  }
  const rows = await igdb(env, "games", `fields platforms.abbreviation,player_perspectives.name,multiplayer_modes.offlinecoop,multiplayer_modes.splitscreen,multiplayer_modes.onlinecoop,keywords.name; where id = (${ids.join(",")}); limit 500;`);
  return Object.fromEntries(rows.map(g => [g.id, {views: (g.player_perspectives || []).map(x => x.name), ...coop(g), kw: feel(g), avail: [...new Set((g.platforms || []).map(p => PCODE[p.abbreviation]).filter(Boolean))]}]).concat([["steam", steam]]));
}

async function search(env, text){
  if (!text.trim()) return [];
  const n = q(text), seen = new Set(), list = [];
  for (const cond of [`name ~ "${n}"`, `name ~ "${n}"*`, `name ~ *"${n}"*`]){
    for (const g of await igdb(env, "games", `fields ${MATCH_FIELDS}; where ${cond}; sort total_rating_count desc; limit 8;`))
      if (!seen.has(g.id)){ seen.add(g.id); list.push(g); }
    if (list.length >= 8) break;
  }
  const ttb = await ttbFor(env, list.map(g => g.id));
  return list.slice(0, 10).map(g => slim(g, ttb));
}

async function game(env, id){
  if (!id) throw new Error("Missing id");
  const out = await gameFresh(env, id);
  return out;
}
// Gameplay first; avoid teasers, announcements and cinematic (CG/story) trailers when there's a choice.
function pickTrailer(videos){
  const score = v => { const n = v.name || ""; return (/gameplay|walkthrough|playthrough|first \d+ minutes/i.test(n) ? 10 : 0) + (/launch|release|trailer/i.test(n) ? 2 : 0) - (/teaser|announce|reveal|cinematic|\bcg|story|intro|opening|logo|interview|dev diary/i.test(n) ? 5 : 0); };
  return videos.slice().sort((a, b) => score(b) - score(a))[0]?.video_id || null;
}
async function gameFresh(env, id){
  const [g] = await igdb(env, "games", `fields ${MATCH_FIELDS},summary,artworks.image_id,screenshots.image_id,videos.video_id,videos.name,similar_games,version_parent,involved_companies.company.name,involved_companies.developer,url,external_games.url; where id = ${id};`);
  if (!g) throw new Error("Game not found");
  // Some entries (editions, ports) have no screenshots or videos of their own: borrow the original game's.
  if (!g.screenshots?.length && g.version_parent){
    const [p] = await igdb(env, "games", `fields screenshots.image_id,videos.video_id,videos.name; where id = ${g.version_parent};`).catch(() => []);
    if (p){ g.screenshots = p.screenshots; if (!g.videos?.length) g.videos = p.videos; }
  }
  const out = {...slim(g, await ttbFor(env, [id])), summary: g.summary || "",
    developers: (g.involved_companies || []).filter(c => c.developer).map(c => c.company?.name).filter(Boolean),
    hero: IMG(g.artworks?.[0]?.image_id || g.screenshots?.[0]?.image_id, "1080p"),
    shots: (g.screenshots?.length ? g.screenshots : g.artworks || []).slice(0, 9).map(s => IMG(s.image_id, "screenshot_huge")), logo: null, igdbUrl: g.url,
    appid: +((g.external_games || []).map(e => /store\.steampowered\.com\/app\/(\d+)/.exec(e.url || "")?.[1]).find(Boolean) || 0) || null,
    trailer: pickTrailer(g.videos || []), critic: Math.round(g.aggregated_rating || 0) || null,
    available: [...new Set((g.platforms || []).map(p => ({PS5: "PS5", PS4: "PS4", PC: "PC", Switch: "Switch", "Switch 2": "Switch 2", "Series X|S": "Xbox", XONE: "Xbox"})[p.abbreviation]).filter(Boolean))]};
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
  // Exact name only: the first autocomplete hit is often a different game (e.g. new indies not on SteamGridDB yet).
  const hit = (await sgdb(env, "search/autocomplete/" + encodeURIComponent(name)))?.find(h => norm(h.name) === norm(name));
  if (!hit) return {hero: fallbackHero, logo: null};
  const [heroes, logos] = await Promise.all([
    sgdb(env, `heroes/game/${hit.id}?types=static&nsfw=false`).catch(() => []),
    sgdb(env, `logos/game/${hit.id}?types=static&nsfw=false&language=en`).then(r => r?.length ? r : sgdb(env, `logos/game/${hit.id}?types=static&nsfw=false`)).catch(() => [])
  ]);
  return {hero: heroes?.[0]?.url || fallbackHero, logo: logos?.[0]?.url || null};
}

// Logo choices for one game (English first).
async function logos(env, t){
  const hits = await sgdb(env, "search/autocomplete/" + encodeURIComponent(t)), hit = hits?.find(h => norm(h.name) === norm(t)) || hits?.[0];
  if (!hit) return [];
  const [en, all] = await Promise.all([sgdb(env, `logos/game/${hit.id}?types=static&nsfw=false&language=en`).catch(() => []), sgdb(env, `logos/game/${hit.id}?types=static&nsfw=false`).catch(() => [])]);
  return [...new Set([...(en || []), ...(all || [])].map(x => x.url))].slice(0, 8);
}
// English box art from SteamGridDB (IGDB sometimes has a regional cover, e.g. Russian).
async function grids(env, titles){
  const out = {};
  await Promise.all(titles.map(async t => {
    try {
      const hit = (await sgdb(env, "search/autocomplete/" + encodeURIComponent(t)))?.find(h => norm(h.name) === norm(t)) || null;
      out[t] = hit ? (await sgdb(env, `grids/game/${hit.id}?dimensions=600x900&types=static&nsfw=false&humor=false`) || []).slice(0, 6).map(x => x.url) : [];
    } catch { out[t] = []; }
  }));
  return out;
}

// Best-known metroidvanias (by number of ratings, then score). Cached for a week.
async function topMetroidvanias(env){
  const c = await env.KV.get("topmv", "json");
  if (c) return c;
  const kws = await igdb(env, "keywords", `fields id; where name ~ *"metroidvania"*; limit 20;`);
  if (!kws.length) return [];
  const rows = await igdb(env, "games", `fields ${MATCH_FIELDS}; where keywords = (${kws.map(k => k.id).join(",")}) & total_rating_count > 25 & total_rating > 70 & version_parent = null & parent_game = null; sort total_rating_count desc; limit 80;`);
  const out = rows.map(g => slim(g)).sort((a, b) => (b.rating || 0) - (a.rating || 0));
  await env.KV.put("topmv", JSON.stringify(out), {expirationTtl: 7 * 86400});
  return out;
}

/* ---------- Find rows: Steam tag searches, quality bar, ranked by Omri's taste ---------- */
// Steam's full tag list (id <-> name), cached for a month.
// A game's top 5 Steam player tags, in Steam's order (for the game page).
async function topTags(env, appid){
  if (!appid) return [];
  const names = new Map((await tagList(env)).map(t => [t.tagid, t.name]));
  const [it] = await getItems([appid], {include_tag_count: 8});
  return (it?.tags || []).map(t => names.get(t.tagid)).filter(Boolean).slice(0, 5);
}
async function tagList(env){
  let all = await env.KV.get("steamtagall", "json");
  if (!all){ all = await (await fetch("https://store.steampowered.com/tagdata/populartags/english")).json(); await env.KV.put("steamtagall", JSON.stringify(all), {expirationTtl: 30 * 86400}); }
  return all;
}
// Steam user tags for owned/wishlist games, kept to the few the app uses.
const STAG = {"Metroidvania": "Metroidvania", "Souls-like": "Soulslike", "Difficult": "Hard", "Relaxing": "Chill", "Cozy": "Chill", "Puzzle Platformer": "Puzzle-platformer", "Precision Platformer": "Precision", "Atmospheric": "Atmospheric", "Exploration": "Exploration", "Local Co-Op": "Couch co-op"};
async function getItems(apps, req, cc = "US"){
  const out = [];
  for (let i = 0; i < apps.length; i += 100){
    const input = {ids: apps.slice(i, i + 100).map(appid => ({appid: +appid})), context: {language: "english", country_code: cc}, data_request: req};
    const r = await (await fetch(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`)).json();
    out.push(...(r.response?.store_items || []));
  }
  return out;
}
async function steamTags(env, apps){
  if (!apps.length) return {};
  const name = new Map((await tagList(env)).map(t => [t.tagid, t.name])), out = {};
  for (const it of await getItems(apps, {include_tag_count: 20})) out[it.appid] = [...new Set((it.tags || []).map(t => STAG[name.get(t.tagid)]).filter(Boolean))];
  return out;
}
async function steamTagSearch(tagIds, filter, start = 0){
  if (!tagIds.length || tagIds.some(t => !t)) return [];
  const u = `https://store.steampowered.com/search/results/?infinite=1&start=${start}&count=100&tags=${tagIds.join(",")}&category1=998&cc=us&l=english&${filter}`;
  const html = (await (await fetch(u)).json()).results_html || "";
  return html.split("search_result_row").slice(1).map(ch => {
    const app = ch.match(/data-ds-appid="(\d+)"/)?.[1];
    const pct = ch.match(/(\d+)% of the ([\d,]+) user reviews/);
    return app ? {app, pct: pct ? +pct[1] : null, n: pct ? +pct[2].replace(/,/g, "") : 0} : null;
  }).filter(Boolean);
}
// Find rows. Quality decides the order (see NOTES "Plan: simplify"); no taste penalties.
const SEARCHES = [
  ["mv", ["Metroidvania"]], ["mv", ["Metroidvania"], 100],
  ["plat2d", ["2D Platformer"]], ["plat2d", ["2D Platformer"], 100],
  ["plat3d", ["3D Platformer"]], ["plat3d", ["3D Platformer"], 100],
  ["coop", ["Local Co-Op"]], ["coop", ["Local Co-Op"], 100],
  ["unique", ["Experimental"]], ["unique", ["Surreal"]], ["unique", ["Artistic"]]
];
// A row only counts a game when the row's genre is one of the game's main Steam tags (top 5), never "anywhere in the list".
// "Local Co-Op" is a feature tag, so it may sit anywhere (the search already guarantees it).
const TOP = 5, UNIQUE = ["Experimental", "Surreal", "Artistic", "Abstract"];
const MAIN = {
  mv: (t) => t.includes("Metroidvania"),
  plat2d: (t, g) => t.includes("2D Platformer") && (g.player_perspectives || []).some(p => p.name === "Side view"),
  plat3d: (t) => t.includes("3D Platformer"),
  unique: (t) => t.some(x => UNIQUE.includes(x))
};
// Hard no's: these in a game's main tags drop it from every row.
const NO = ["Sports", "Free to Play", "Massively Multiplayer", "Visual Novel"];
async function finds(env){
  const c = await env.KV.get("finds14", "json");
  if (c && Date.now() - c.t < 24 * 3600e3) return c.d;
  const now = Math.floor(Date.now() / 1000), since = 1199145600;
  const clean = `version_parent = null & parent_game = null`;
  const all = await tagList(env), tid = new Map(all.map(t => [t.name, t.tagid])), tname = new Map(all.map(t => [t.tagid, t.name]));
  const res = await Promise.all(SEARCHES.map(([k, t, st]) => steamTagSearch(t.map(n => tid.get(n)), "sort_by=Reviews_DESC", st).then(r => r.map(x => ({...x, k}))).catch(() => [])));
  // Quality bar: well reviewed, or a hidden gem (few reviews but nearly all positive).
  const good = x => (x.pct >= 85 && x.n >= 300) || (x.pct >= 92 && x.n >= 40);
  const hits = new Map();
  for (const x of res.flat()){
    if (!good(x)) continue;
    const h = hits.get(x.app) || {...x, keys: new Set()};
    h.keys.add(x.k); hits.set(x.app, h);
  }
  for (const it of await getItems([...hits.keys()], {include_tag_count: 12})){
    const h = hits.get(String(it.appid)); if (h) h.tags = (it.tags || []).map(t => tname.get(t.tagid)).filter(Boolean);
  }
  // Map Steam app ids to IGDB games (for covers, details, platforms and wishlist).
  const apps = [...hits.keys()], gameOf = new Map();
  for (let i = 0; i < apps.length; i += 200){
    const ext = await igdb(env, "external_games", `fields game,uid,url; where uid = (${apps.slice(i, i + 200).map(a => `"${a}"`).join(",")}); limit 500;`);
    for (const e of ext) if ((!e.url || /steampowered/.test(e.url)) && hits.has(e.uid) && !gameOf.has(e.game)) gameOf.set(e.game, hits.get(e.uid));
  }
  const ids = [...gameOf.keys()], games = [];
  for (let i = 0; i < ids.length; i += 250) games.push(...await igdb(env, "games", `fields ${MATCH_FIELDS}; where id = (${ids.slice(i, i + 250).join(",")}) & ${clean}; limit 500;`));
  const items = games.map(g => {
    const h = gameOf.get(g.id), main = (h.tags || []).slice(0, TOP);
    const keys = new Set([...h.keys].filter(k => !MAIN[k] || MAIN[k](main, g)));
    const x = {...slim(g), date: g.first_release_date || null, steamPct: h.pct, steamN: h.n, rating: h.pct || Math.round(g.total_rating || 0) || null, appid: +h.app};
    x.score = quality(h.pct, h.n, g.aggregated_rating, g.total_rating);
    x.gem = h.n < 1500 && h.pct >= 92;
    if (x.gem) keys.add("unique");
    return {x, keys, no: main.some(t => NO.includes(t)) || x.genres.includes("Visual Novel")};
  }).filter(i => i.keys.size && !i.no && i.x.date && i.x.date > since && i.x.date <= now);
  const pick = k => items.filter(i => i.keys.has(k)).map(i => i.x).sort((a, b) => b.score - a.score).slice(0, 40);
  const d = {mv: pick("mv"), plat2d: pick("plat2d"), plat3d: pick("plat3d"), coop: pick("coop"), unique: pick("unique")};
  await env.KV.put("finds14", JSON.stringify({t: Date.now(), d}));
  return d;
}
// One quality number (0–100) for any game: Steam % pulled toward 80 when there are few reviews,
// plus a small bonus/penalty from critics; IGDB rating when there is no Steam data.
function quality(pct, n, critics, igdb){
  const base = pct != null ? (pct * n + 80 * 300) / (n + 300) : igdb ? (igdb * 20 + 75 * 20) / 40 : 70;
  return base + (critics ? Math.max(-3, Math.min(3, (critics - 80) / 5)) : 0);
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
  const r = await (await fetch(`https://store.steampowered.com/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=0`)).json();
  const s = r.query_summary || {};
  const out = {pct: s.total_reviews ? Math.round(s.total_positive / s.total_reviews * 100) : null, label: s.review_score_desc || "", total: s.total_reviews || 0};
  return out;
}

/* ---------- Steam achievements (your progress per game) ---------- */
async function achievements(env, appid){
  if (!appid) throw new Error("Missing appid");
  const r = await fetch(`https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?appid=${appid}&key=${env.STEAM_KEY}&steamid=${env.STEAM_ID}`);
  const list = r.ok ? (await r.json()).playerstats?.achievements || [] : [];
  const out = {got: list.filter(a => a.achieved).length, total: list.length};
  return out;
}

/* ---------- PlayStation trophies (unofficial PSN API, as used by trophy sites) ----------
   Needs the secret PSN_NPSSO (a sign-in cookie from playstation.com, valid ~2 months). */
const PSN_AUTH = "https://ca.account.sony.com/api/authz/v3/oauth";
const PSN_BASIC = "Basic MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A=";
async function psnToken(env){
  const c = await env.KV.get("psn_tok", "json");
  if (c && c.exp > Date.now() + 60e3) return c.access;
  let body;
  if (c?.refresh && c.rexp > Date.now()) body = `refresh_token=${encodeURIComponent(c.refresh)}&grant_type=refresh_token&token_format=jwt&scope=psn:mobile.v2.core psn:clientapp`;
  else {
    if (!env.PSN_NPSSO) throw new Error("Add your PSN_NPSSO secret in Cloudflare to see trophies.");
    const a = await fetch(`${PSN_AUTH}/authorize?access_type=offline&client_id=09515159-7237-4370-9b40-3806e67c0891&redirect_uri=com.scee.psxandroid.scecompcall://redirect&response_type=code&scope=psn:mobile.v2.core%20psn:clientapp`,
      {headers: {Cookie: "npsso=" + env.PSN_NPSSO}, redirect: "manual"});
    const code = new URL(a.headers.get("location") || "x:").searchParams.get("code");
    if (!code) throw new Error("PSN sign-in expired. Get a new NPSSO and update the PSN_NPSSO secret.");
    body = `code=${code}&redirect_uri=com.scee.psxandroid.scecompcall://redirect&grant_type=authorization_code&token_format=jwt`;
  }
  const t = await (await fetch(`${PSN_AUTH}/token`, {method: "POST", headers: {Authorization: PSN_BASIC, "Content-Type": "application/x-www-form-urlencoded"}, body})).json();
  if (!t.access_token){ await env.KV.delete("psn_tok"); throw new Error("PSN sign-in failed. Update the PSN_NPSSO secret."); }
  await env.KV.put("psn_tok", JSON.stringify({access: t.access_token, exp: Date.now() + t.expires_in * 1000, refresh: t.refresh_token, rexp: Date.now() + (t.refresh_token_expires_in || 0) * 1000}));
  return t.access_token;
}
async function trophies(env){
  const c = await env.KV.get("trophies2", "json");
  if (c && Date.now() - c.t < 6 * 3600e3) return c.d;
  const tok = await psnToken(env), d = [];
  for (let off = 0; off < 2000; off += 400){
    const r = await (await fetch(`https://m.np.playstation.com/api/trophy/v1/users/me/trophyTitles?limit=400&offset=${off}`, {headers: {Authorization: "Bearer " + tok}})).json();
    for (const x of r.trophyTitles || []){
      const e = x.earnedTrophies || {}, f = x.definedTrophies || {};
      d.push({title: x.trophyTitleName, platform: x.trophyTitlePlatform, npId: x.npCommunicationId, svc: x.npServiceName, progress: x.progress || 0,
        got: (e.bronze || 0) + (e.silver || 0) + (e.gold || 0) + (e.platinum || 0), total: (f.bronze || 0) + (f.silver || 0) + (f.gold || 0) + (f.platinum || 0), plat: !!e.platinum, hasPlat: !!f.platinum});
    }
    if (!r.nextOffset) break;
  }
  await env.KV.put("trophies2", JSON.stringify({t: Date.now(), d}));
  return d;
}

// How many players earned the platinum (or the rarest trophy): a difficulty measure from PlayStation's own data.
async function rarity(env, np, svc){
  if (!/^NPWR\d+_\d+$/.test(np)) throw new Error("Bad trophy id");
  const tok = await psnToken(env);
  const r = await (await fetch(`https://m.np.playstation.com/api/trophy/v1/users/me/npCommunicationIds/${np}/trophyGroups/all/trophies?npServiceName=${svc === "trophy2" ? "trophy2" : "trophy"}`, {headers: {Authorization: "Bearer " + tok}})).json();
  const list = r.trophies || [];
  const plat = list.find(t => t.trophyType === "platinum");
  const rates = list.map(t => parseFloat(t.trophyEarnedRate)).filter(x => !isNaN(x));
  const out = {plat: plat ? parseFloat(plat.trophyEarnedRate) : null, rarest: rates.length ? Math.min(...rates) : null};
  return out;
}

// Steam: share of players who earned the rarest achievement.
async function achRarity(env, appid){
  if (!appid) throw new Error("Missing appid");
  const r = await fetch(`https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/?gameid=${appid}`);
  const list = r.ok ? (await r.json()).achievementpercentages?.achievements || [] : [];
  const p = list.map(a => parseFloat(a.percent)).filter(x => !isNaN(x));
  const out = {rarest: p.length ? Math.round(Math.min(...p) * 10) / 10 : null};
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

/* ---------- Steam wishlist (needs the wishlist/game details to be public) ---------- */
async function steamWishlist(env){
  const r = await fetch(`https://api.steampowered.com/IWishlistService/GetWishlist/v1/?key=${env.STEAM_KEY}&steamid=${env.STEAM_ID}`);
  if (!r.ok) throw new Error("Steam wishlist " + r.status);
  const items = (await r.json()).response?.items || [];
  if (!items.length) throw new Error("Steam returned an empty wishlist. Make sure your Steam wishlist / game details are public.");
  const names = {};
  for (let i = 0; i < items.length; i += 100){
    const input = {ids: items.slice(i, i + 100).map(x => ({appid: x.appid})), context: {language: "english", country_code: "US"}, data_request: {}};
    const s = await (await fetch(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`)).json();
    for (const it of s.response?.store_items || []) if (it.name) names[it.appid] = it.name;
  }
  return items.map(x => ({appid: x.appid, title: names[x.appid], added: (x.date_added || 0) * 1000, priority: x.priority})).filter(x => x.title);
}
