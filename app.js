import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { API, FIREBASE } from "./config.js";

/* ---------- constants ---------- */
const PLAT = {ps5:["PS5","PS","--ps"], psplus:["PS Plus","P+","--psplus"], steam:["Steam","ST","--steam"], epic:["Epic","EP","--epic"], itch:["itch.io","IO","--itch"], other:["Other","··","--other"]};
const STAT = {backlog:"Owned", playing:"Playing", done:"Finished", dropped:"Dropped", wishlist:"Wishlist"};
const RANK = {wishlist:1, backlog:2, playing:3, dropped:4, done:5};
// Plain white line icons (Lucide shapes), drawn inline so they follow the text colour.
const ICON = {
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  down: '<path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/>',
  undo: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  heartf: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" fill="currentColor"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  chev: '<path d="m6 9 6 6 6-6"/>'
};
const ic = (n, size = 20, fill = false) => `<svg class="ico-svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
const TABS = [["home","Play","home"],["disc","Find","compass"],["lib","Library","grid"],["diary","Diary","book"]];
const SKIP_STEAM = /^(blender|sharex|wallpaper engine)$|public test|dedicated server|soundtrack|\bsdk\b|\bdemo\b|benchmark/i;

/* ---------- state ---------- */
let games = new Map(), tab = "home", loaded = false;
let homeMode = "owned", topMV = null;
let q = "", platF = new Set(), statF = "", genreF = "", sort = "title", accessF = "", deckF = false;
// Library/Wishlist filters (sidebar on desktop, panel on phone). Remembered per device.
let F = {type: new Set(), view: new Set(), coop: new Set(), access: new Set()};
const VIEWS = ["2D", "3D", "Top-down", "VR"], COOPS = ["Couch co-op", "Online co-op", "Solo"];
function saveFilters(){ try { localStorage.setItem("filters:" + tab, JSON.stringify({statF, sort, deckF, plat: [...platF], type: [...F.type], view: [...F.view], coop: [...F.coop], access: [...F.access]})); } catch {} }
function loadFilters(){
  platF = new Set(); statF = ""; genreF = ""; sort = "title"; deckF = false; F = {type: new Set(), view: new Set(), coop: new Set(), access: new Set()};
  try { const o = JSON.parse(localStorage.getItem("filters:" + tab)); if (o){ statF = o.statF || ""; sort = o.sort || "title"; deckF = !!o.deckF; platF = new Set(o.plat); F = {type: new Set(o.type), view: new Set(o.view), coop: new Set(o.coop), access: new Set(o.access)}; } } catch {}
}
let mood = new Set(), time = "", discovered = null, leavingArticles = [];
let db = null, col = null;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const key = t => String(t).toLowerCase().replace(/[™®©]/g, "").replace(/[^a-z0-9]+/g, "");
const list = () => [...games.values()];
const genresOf = g => [...new Set([...(g.genres || []), ...(g.themes || [])])];
const mainH = g => g.ttb?.main || null;
const lenOf = h => !h ? "" : h < 10 ? "short" : h <= 30 ? "medium" : "long";
const starsTxt = n => n ? "★".repeat(n) + "☆".repeat(5 - n) : "";
const VIEW = {"Side view":"2D","Bird view / Isometric":"Top-down","First person":"3D","Third person":"3D","Virtual Reality":"VR","Text":"Text"};
const KIND = {"Platform":"Platformer","Puzzle":"Puzzle","Shooter":"Shooter","Fighting":"Fighting","Racing":"Racing","Sport":"Sports","Role-playing (RPG)":"RPG","Strategy":"Strategy","Real Time Strategy (RTS)":"Strategy","Turn-based strategy (TBS)":"Strategy","Tactical":"Strategy","Simulator":"Sim","Point-and-click":"Point & click","Hack and slash/Beat 'em up":"Action","Music":"Rhythm","Card & Board Game":"Cards","Arcade":"Arcade","Visual Novel":"Visual novel","Quiz/Trivia":"Quiz","MOBA":"MOBA","Adventure":"Adventure"};
const THEME = {"Horror":"Horror","Survival":"Survival","Open world":"Open world","Mystery":"Mystery"};
// Plain description: 2D/3D, what kind of game, co-op.
const kwOf = g => [...(g.kw || []), ...(g.stags || [])];
function basicTags(g){
  const v = [...new Set((g.views || []).map(x => VIEW[x]).filter(Boolean))].slice(0, 1);
  let k = [...new Set((g.genres || []).map(x => KIND[x]).filter(Boolean))].sort((a, b) => (a === "Adventure") - (b === "Adventure"));
  if (kwOf(g).includes("Metroidvania")) k = ["Metroidvania", ...k.filter(x => x !== "Platformer")];
  k = k.slice(0, 2);
  const f = kwOf(g).filter(x => x === "Soulslike" || x === "Chill").slice(0, 1);
  const t = f.length ? f : (g.themes || []).map(x => THEME[x]).filter(Boolean).slice(0, 1);
  const c = g.couch ? ["Couch co-op"] : g.onlineCoop || (g.modes || []).includes("Co-operative") ? ["Online co-op"] : (g.modes || []).length && !(g.modes || []).some(m => /multi|co-op|split|mmo|battle/i.test(m)) ? ["Solo"] : [];
  return [...v, ...k, ...t, ...c];
}
// PlayStation access: bought (yours), claimed (monthly PS Plus, yours while subscribed),
// catalog (PS Plus Extra, can leave), left (gone from PS Plus, not playable now).
const PS_LABEL = {bought: "Bought", claimed: "Claimed", catalog: "Catalog", left: "Left PS Plus"};
const playable = g => g.ps !== "left" && !g.hidden;
const sale = g => g.status === "wishlist" && g.sale?.cut > 0 && /^(steam|epic)/i.test(g.sale.shop || "") ? g.sale : null;

/* ---------- API (Cloudflare Worker) ---------- */
async function api(path, body){
  if (!API) throw new Error("Add your Worker address to config.js to load game info.");
  const r = await fetch(API + path, body ? {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)} : {});
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Data service answered " + r.status);
  return d;
}

// Game details (description, screenshots, trailer) change rarely: keep them on this device.
const detailMem = new Map();
async function gameDetails(id){
  if (detailMem.has(id)) return detailMem.get(id);
  try { const c = JSON.parse(localStorage.getItem("gd5:" + id)); if (c && Date.now() - c.t < 30 * 864e5){ detailMem.set(id, c.d); return c.d; } } catch {}
  const p = api("/game?id=" + id).then(d => { try { localStorage.setItem("gd5:" + id, JSON.stringify({t: Date.now(), d})); } catch {} return d; });
  detailMem.set(id, p); p.catch(() => detailMem.delete(id));
  return p;
}
// Desktop: resting on a cover plays its trailer, muted, inside the cover.
let hoverT;
if (matchMedia("(hover: hover)").matches){
  document.addEventListener("pointerover", e => {
    const c = e.target.closest?.(".card[data-edit]"); if (!c || c.querySelector(".hovervid")) return;
    const g = games.get(c.dataset.edit); if (!g?.igdbId || !API) return;
    clearTimeout(hoverT);
    hoverT = setTimeout(async () => {
      const d = await gameDetails(g.igdbId).catch(() => null);
      if (!d?.trailer || !c.matches(":hover")) return;
      const cov = c.querySelector(".cover"); const f = document.createElement("iframe");
      f.className = "hovervid"; f.title = ""; f.tabIndex = -1; f.allow = "autoplay";
      f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(d.trailer)}?autoplay=1&mute=1&controls=0&loop=1&playlist=${encodeURIComponent(d.trailer)}&playsinline=1&rel=0&modestbranding=1&start=8`;
      cov.append(f);
      c.addEventListener("pointerleave", () => f.remove(), {once: true});
    }, 700);
  });
  document.addEventListener("pointerout", e => { if (e.target.closest?.(".card[data-edit]") && !e.relatedTarget?.closest?.(".card[data-edit]")) clearTimeout(hoverT); });
}
// Desktop: drag rows sideways with the mouse.
let drag = null;
document.addEventListener("pointerdown", e => {
  const el = e.pointerType === "mouse" && e.target.closest(".row, .mslides"); if (!el || e.target.closest(".vwrap")) return;
  drag = {el, x: e.clientX, left: el.scrollLeft, moved: false};
});
document.addEventListener("pointermove", e => {
  if (!drag) return; const dx = e.clientX - drag.x;
  if (Math.abs(dx) > 5 && !drag.moved){ drag.moved = true; drag.el.style.scrollSnapType = "none"; drag.el.classList.add("dragging"); }
  if (drag.moved) drag.el.scrollLeft = drag.left - dx;
});
addEventListener("pointerup", () => { if (!drag) return; const d = drag; drag = null; d.el.style.scrollSnapType = ""; d.el.classList.remove("dragging");
  if (d.moved) addEventListener("click", ev => { ev.stopPropagation(); ev.preventDefault(); }, {capture: true, once: true}); });
// Start loading details when the pointer rests on a cover, so the page opens ready.
document.addEventListener("pointerover", e => {
  const c = e.target.closest?.("[data-edit]"); const g = c && games.get(c.dataset.edit);
  if (g?.igdbId && API) gameDetails(g.igdbId).catch(() => {});
});

/* ---------- writes ---------- */
const upd = (id, d) => updateDoc(doc(col, id), d);
const del = id => deleteDoc(doc(col, id));
const newId = () => doc(col).id;
async function commitChunks(ops){
  for (let i = 0; i < ops.length; i += 400){ const b = writeBatch(db); ops.slice(i, i + 400).forEach(f => f(b)); await b.commit(); }
}

// Point a game at an IGDB entry; if another entry already is that game, merge into it.
async function applyMatch(g, m){
  const twin = list().find(x => x.id !== g.id && x.igdbId === m.igdbId);
  if (twin){
    await upd(twin.id, {platforms: [...new Set([...(twin.platforms || []), ...(g.platforms || [])])],
      status: RANK[g.status] > RANK[twin.status] ? g.status : twin.status,
      ...(g.steamHours != null ? {steamHours: g.steamHours, steamAppId: g.steamAppId} : {})});
    await del(g.id);
  } else {
    await upd(g.id, {...m, ...(g.couchSet ? {couch: g.couch} : {}), asTyped: g.asTyped || g.title, noMatch: false, hero: null, logo: null});
  }
}

/* ---------- background jobs: matching + prices ---------- */
let running = false;
const tried = new Set();
async function runQueue(){
  if (running || !API) return;
  running = true;
  let done = 0;
  try {
    while (true){
      const todo = list().filter(g => !g.igdbId && !g.nope && (!g.noMatch || g.noMatchV !== 3) && !tried.has(g.id));
      if (!todo.length) break;
      const batch = todo.slice(0, 10); batch.forEach(g => tried.add(g.id));
      progress(done, done + todo.length, "Getting covers and info");
      const res = await api("/match", {titles: batch.map(g => g.asTyped || g.title)});
      for (const g of batch){
        const t = g.asTyped || g.title;
        let m = res[t];
        if (!m || key(m.title) !== key(t)){ // not an exact name: try a wider search for an exact one
          const alt = await api("/search?q=" + encodeURIComponent(t)).catch(() => []);
          m = alt.filter(r => key(r.title) === key(t)).sort((a, b) => (b.ratingCount || 0) - (a.ratingCount || 0))[0] || m || alt.find(r => key(r.title).startsWith(key(t))) || alt[0] || null;
        }
        if (m) await applyMatch(g, m); else await upd(g.id, {noMatch: true, noMatchAt: Date.now(), noMatchV: 3});
      }
      done += batch.length;
    }
    await backfill();
    await checkDeck();
    await checkSteamTags();
    await checkCovers();
    await checkPrices();
    progress(0, 0);
  } catch (e){ progress(0, 0, e.message, true); }
  running = false;
}
async function rematchAll(){
  if (running) return; running = true;
  const all = list().filter(g => g.igdbId && g.asTyped); let fixed = 0;
  try {
    for (let i = 0; i < all.length; i += 10){
      const batch = all.slice(i, i + 10);
      progress(i, all.length, "Re-checking matches");
      const res = await api("/match", {titles: batch.map(g => g.asTyped)});
      for (const g of batch){
        const m = res[g.asTyped];
        if (m && m.igdbId !== g.igdbId && key(m.title) === key(g.asTyped)){ await applyMatch(g, m); fixed++; }
      }
    }
    progress(0, 0); note(`Checked ${all.length} games and fixed ${fixed}.`);
  } catch (e){ progress(0, 0, e.message, true); }
  running = false;
}
// "Dandara: Trials of Fear Edition" and "Dandara" are one game: merge editions into one card.
const EDITION = /\s*[-:–]?\s*(the\s+)?(definitive|remastered|remaster|enhanced|director'?s cut|game of the year|goty|complete|ultimate|deluxe|special|anniversary|collector'?s|premium|gold|legendary|trials of fear|ultra deluxe|redux|hd)(\s+(edition|version|collection))?\s*$/i;
const baseKey = t => { let x = String(t).replace(/[™®©]/g, ""), y; while ((y = x.replace(EDITION, "")) !== x && y.length > 2) x = y; return key(x); };
async function mergeEditions(){
  const groups = new Map();
  for (const g of list()) { const k = baseKey(g.title); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(g); }
  for (const gs of groups.values()){
    if (gs.length < 2) continue;
    gs.sort((a, b) => (b.myRating || 0) - (a.myRating || 0) || RANK[b.status] - RANK[a.status] || a.title.length - b.title.length);
    const [keep, ...rest] = gs;
    const d = {platforms: [...new Set(gs.flatMap(g => g.platforms || []))], status: gs.reduce((m, g) => RANK[g.status] > RANK[m] ? g.status : m, keep.status)};
    for (const f of ["myRating", "finishedAt", "upNext", "steamHours", "steamAppId"]) { const v = gs.map(g => g[f]).find(v => v != null); if (v != null) d[f] = v; }
    if (gs.some(g => g.ps === "bought")) d.ps = "bought";
    await upd(keep.id, d);
    for (const g of rest) await del(g.id);
  }
}
async function backfill(){
  await mergeEditions();
  const need = list().filter(g => g.igdbId && (g.views === undefined || g.couch === undefined || g.kw === undefined));
  for (let i = 0; i < need.length; i += 200){
    const chunk = need.slice(i, i + 200);
    progress(i, need.length, "Adding game details");
    const res = await api("/info", {ids: chunk.map(g => g.igdbId)});
    await commitChunks(chunk.map(g => b => b.update(doc(col, g.id), {views: res[g.igdbId]?.views || [], couch: g.couchSet ? !!g.couch : !!res[g.igdbId]?.couch, onlineCoop: !!res[g.igdbId]?.onlineCoop, kw: res[g.igdbId]?.kw || []})));
  }
  const odd = list().filter(g => g.igdbId && g.asTyped && !g.rechecked && key(g.title) !== key(g.asTyped));
  for (const [i, g] of odd.entries()){
    progress(i, odd.length, "Double-checking matches");
    const alt = await api("/search?q=" + encodeURIComponent(g.asTyped)).catch(() => []);
    const exact = alt.find(r => key(r.title) === key(g.asTyped));
    if (exact && exact.igdbId !== g.igdbId) await applyMatch(g, exact);
    else await upd(g.id, {rechecked: true});
  }
}
async function checkCovers(){
  const need = list().filter(g => g.igdbId && !g.coverSet && g.coverV !== 1);
  for (let i = 0; i < need.length; i += 10){
    const chunk = need.slice(i, i + 10);
    progress(i, need.length, "Getting English covers");
    const res = await api("/grids", {titles: chunk.map(g => g.title)});
    await commitChunks(chunk.map(g => b => b.update(doc(col, g.id), {coverV: 1, ...(res[g.title]?.[0] ? {cover: res[g.title][0]} : {})})));
  }
}
// Steam user tags (Metroidvania, Souls-like, Cozy…) for games with a Steam app id.
async function checkSteamTags(){
  const need = list().filter(g => g.steamAppId && g.stags === undefined);
  for (let i = 0; i < need.length; i += 100){
    const chunk = need.slice(i, i + 100);
    progress(i, need.length, "Reading Steam tags");
    const res = await api("/steamtags", {apps: chunk.map(g => g.steamAppId)});
    await commitChunks(chunk.map(g => b => b.update(doc(col, g.id), {stags: res[g.steamAppId] || []})));
  }
}
async function checkDeck(){
  const need = list().filter(g => (g.platforms || []).includes("steam") && g.deck === undefined);
  for (let i = 0; i < need.length; i += 12){
    const chunk = need.slice(i, i + 12);
    progress(i, need.length, "Checking Steam Deck support");
    const res = await api("/deck", {items: chunk.map(g => ({title: g.asTyped || g.title, appid: g.steamAppId || null}))});
    await commitChunks(chunk.map(g => b => b.update(doc(col, g.id), {deck: res[g.asTyped || g.title]?.deck || 0, ...(res[g.asTyped || g.title]?.appid && !g.steamAppId ? {steamAppId: res[g.asTyped || g.title].appid} : {})})));
  }
}
async function checkPrices(force = false){
  const stale = list().filter(g => g.status === "wishlist" && !g.hidden && (force || !g.sale || Date.now() - (g.sale.checked || 0) > 12 * 3600e3));
  for (let i = 0; i < stale.length; i += 40){
    const chunk = stale.slice(i, i + 40);
    progress(i, stale.length, "Checking PC prices");
    const res = await api("/prices", {titles: chunk.map(g => g.title)});
    await commitChunks(chunk.map(g => b => b.update(doc(col, g.id), {sale: {...(res[g.title] || {cut: 0}), checked: Date.now()}})));
  }
}
async function loadLeaving(){
  if (!API) return;
  try { leavingArticles = await api("/psplus"); render(); } catch {}
}
function leavingFor(g){
  if (!(g.platforms || []).includes("psplus") || g.status === "done" || g.title.length < 4) return null;
  const re = new RegExp("\\b" + g.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
  return leavingArticles.find(a => re.test(a.text || "")) || null;
}
function progress(n, total, text = "", stay = false){
  $("#progress").hidden = !total && !stay;
  $("#progress .track").hidden = !total;
  $("#progFill").style.width = total ? (n / total * 100) + "%" : "0";
  $("#progText").textContent = total ? `${text} · ${n}/${total}` : text;
}

/* ---------- adding / importing ---------- */
function existingIndex(){ return new Map(list().flatMap(g => [[key(g.title), g], [key(g.asTyped || g.title), g]])); }
async function addTitles(titles, platform, status){
  const have = existingIndex(); let n = 0, merged = 0; const ops = [];
  for (const raw of new Set(titles.map(t => t.trim()).filter(Boolean))){
    const g = have.get(key(raw));
    if (g){ merged++; ops.push(b => b.update(doc(col, g.id), {platforms: [...new Set([...(g.platforms || []), platform])], status: RANK[status] > RANK[g.status] ? status : g.status})); }
    else { const t = Date.now() + n++; ops.push(b => b.set(doc(col, newId()), {title: raw, asTyped: raw, platforms: [platform], status, added: t})); }
  }
  await commitChunks(ops); runQueue();
  return {n, merged};
}
async function importFile(file){
  let data; try { data = JSON.parse(await file.text()); } catch { return note("That file isn't a Backlog export."); }
  if (data && !Array.isArray(data) && !data.games) return applyPsStatus(data, false);
  const rows = Array.isArray(data) ? data : data.games;
  if (!Array.isArray(rows)) return note("That file isn't a Backlog export.");
  const groups = new Map();
  for (const r of rows){
    if (!r?.title) continue;
    const k = key(r.title), st = STAT[r.status] ? r.status : "backlog";
    const g = groups.get(k) || {title: String(r.title), asTyped: String(r.title), platforms: [], status: st};
    for (const p of r.platforms || [r.platform]) if (PLAT[p] && !g.platforms.includes(p)) g.platforms.push(p);
    if (RANK[st] > RANK[g.status]) g.status = st;
    groups.set(k, g);
  }
  const have = existingIndex();
  const fresh = [...groups.entries()].filter(([k]) => !have.has(k)).map(e => e[1]);
  await commitChunks(fresh.map((g, i) => b => b.set(doc(col, newId()), {...g, added: Date.now() + i})));
  note(`Imported ${fresh.length} games. Covers and info are loading now.`);
  runQueue();
}
// Apply {title: bought|claimed|catalog} to the list. fullPlusTab: the paste was the whole
// PS Plus tab, so PS Plus games missing from it have left the service.
async function applyPsStatus(map, fullPlusTab){
  const rank = {catalog: 1, claimed: 2, bought: 3};
  const byKey = new Map(Object.entries(map).map(([t, st]) => [key(t), st]));
  const have = existingIndex(); let upd8 = 0, left = 0, added = 0; const ops = [], seen = new Set();
  for (const g of list()){
    const st = byKey.get(key(g.title)) || byKey.get(key(g.asTyped || g.title));
    if (st){
      seen.add(key(g.title)); seen.add(key(g.asTyped || g.title));
      const best = g.ps === "bought" || rank[st] < (rank[g.ps] || 0) ? g.ps : st;
      const plats = new Set(g.platforms || []); if (best === "bought") plats.add("ps5"); else plats.add("psplus");
      if (best !== g.ps || plats.size !== (g.platforms || []).length){ upd8++; ops.push(b => b.update(doc(col, g.id), {ps: best, platforms: [...plats]})); }
    } else if (fullPlusTab && (g.ps === "claimed" || g.ps === "catalog")){
      left++; ops.push(b => b.update(doc(col, g.id), {ps: "left"}));
    }
  }
  for (const [t, st] of Object.entries(map)) if (!seen.has(key(t)) && !have.has(key(t))){
    added++; const n = Date.now() + added;
    ops.push(b => b.set(doc(col, newId()), {title: t, asTyped: t, platforms: [st === "bought" ? "ps5" : "psplus"], ps: st, status: "backlog", added: n}));
  }
  await commitChunks(ops);
  note(`PlayStation: updated ${upd8}, added ${added}${fullPlusTab ? `, marked ${left} as left PS Plus` : ""}.`);
  runQueue();
}
// Read a pasted page from library.playstation.com (Purchased or PlayStation Plus tab).
function parsePsPaste(text){
  const lines = text.split(/\r?\n/).map(l => l.trim().replace(/^\*\s*/, "").replace(/^\[([^\]]+)\]\([^)]*\)$/, "$1"));
  const plusTab = /Your PS Plus games/i.test(text), map = {};
  const rank = {catalog: 1, claimed: 2, bought: 3};
  for (let i = 0; i < lines.length - 1; i++){
    const t = lines[i];
    if (!t || /^(PS4|PS5|PS Plus|Download.*)$/.test(t) || !/^(PS4|PS5)$/.test(lines[i + 1])) continue;
    const after = lines.slice(i + 2, i + 5), plus = after.includes("PS Plus"), consoleOnly = after.includes("Download to Console");
    const st = plusTab ? (consoleOnly ? "catalog" : "claimed") : (plus ? "claimed" : "bought");
    const title = t.replace(/[™®©]/g, "").replace(/\s*\(EU\)$/, "").trim();
    if (!map[title] || rank[st] > rank[map[title]]) map[title] = st;
  }
  return {map, plusTab};
}
function psPasteSheet(){
  openSheet(`<h2>Update from PlayStation</h2>
    <p class="why">On library.playstation.com open the <b>PlayStation Plus</b> tab (or a <b>Purchased</b> page), press Ctrl+A, Ctrl+C, and paste here. Pasting the whole PS Plus tab also marks games that have left PS Plus.</p>
    <textarea id="psPaste" rows="8" placeholder="Paste the page here"></textarea>
    <div class="status" id="psMsg"></div>
    <div class="actions"><button class="btn ghost" data-act="close">Cancel</button><button class="btn" id="psGo">Update</button></div>`);
  $("#psGo").onclick = async () => {
    const {map, plusTab} = parsePsPaste($("#psPaste").value);
    if (!Object.keys(map).length){ $("#psMsg").textContent = "No games found. Copy the whole page with Ctrl+A, then Ctrl+C."; return; }
    $("#psGo").disabled = true; await applyPsStatus(map, plusTab);
  };
}
async function importSteamWishlist(){
  note("Reading your Steam wishlist…");
  try {
    const items = await api("/steamwish");
    let n = 0, skip = 0; const ops = [];
    for (const it of items){
      const have = list().find(g => g.steamAppId === it.appid) || inList({title: it.title});
      if (have){ skip++; if (!have.steamAppId) ops.push(b => b.update(doc(col, have.id), {steamAppId: it.appid})); continue; }
      const t = it.added || Date.now() + n++;
      ops.push(b => b.set(doc(col, newId()), {title: it.title, asTyped: it.title, platforms: [], status: "wishlist", steamAppId: it.appid, added: t}));
      n++;
    }
    await commitChunks(ops);
    note(`Steam wishlist: added ${n} games${skip ? `, ${skip} were already in your list` : ""}.`);
    runQueue();
  } catch (e){ note(e.message); }
}
async function importSteam(){
  note("Reading your Steam library…");
  try {
    const owned = (await api("/steam")).filter(s => !SKIP_STEAM.test(s.title));
    const have = existingIndex(), byApp = new Map(list().filter(g => g.steamAppId).map(g => [g.steamAppId, g]));
    let n = 0, merged = 0; const ops = [];
    for (const s of owned){
      const want = s.hours >= 2 ? "playing" : "backlog";
      const g = byApp.get(s.appid) || have.get(key(s.title));
      if (g){
        merged++;
        ops.push(b => b.update(doc(col, g.id), {platforms: [...new Set([...(g.platforms || []), "steam"])], steamAppId: s.appid, steamHours: s.hours,
          status: g.status === "backlog" || g.status === "wishlist" ? (RANK[want] > RANK[g.status] ? want : g.status) : g.status}));
      } else {
        const t = Date.now() + n++;
        ops.push(b => b.set(doc(col, newId()), {title: s.title, asTyped: s.title, platforms: ["steam"], status: want, steamAppId: s.appid, steamHours: s.hours, added: t}));
      }
    }
    await commitChunks(ops);
    note(`Steam: added ${n} games and updated ${merged} you already had. Games with 2+ hours played are marked Playing.`);
    runQueue();
  } catch (e){ note(e.message); }
}

/* ---------- pieces ---------- */
function badges(ps, g){ return (ps || []).map(p => { const v = PLAT[p] || PLAT.other; const dk = p === "steam" && g?.deck >= 2; return `<span class="plat" style="background:var(${v[2]})" title="${v[0]}${dk ? " · good on Steam Deck" : ""}">${v[1]}${dk ? "✓" : ""}</span>`; }).join(""); }
function coverTag(g){
  const s = sale(g), lv = leavingFor(g);
  if (g.noMatch) return `<span class="tag nomatch">No match</span>`;
  if (g.ps === "left") return `<span class="tag">Left P+</span>`;
  if (lv) return `<span class="tag leaving">Leaving P+</span>`;
  if (s) return `<span class="tag sale ${s.cut >= 50 ? "big" : ""}">−${s.cut}%</span>`;
  if (g.status === "playing") return `<span class="tag playing">Playing</span>`;
  if (g.status === "dropped") return `<span class="tag">Dropped</span>`;
  return "";
}
function coverHTML(g){
  return `<div class="cover">${g.cover ? `<img src="${esc(g.cover)}" alt="" loading="lazy">` : `<span class="ph">${esc(g.title)}</span>`}
    <span class="badges">${badges(g.platforms, g)}</span>${coverTag(g)}</div>`;
}
function cardHTML(g, sub){
  const right = g.myRating ? `<span class="stars">${"★".repeat(g.myRating)}</span>` : "";
  return `<button class="card" data-edit="${g.id}">${coverHTML(g)}<span class="ctitle">${esc(g.title)}</span>
    <span class="csub"><span>${esc(sub ?? (basicTags(g).slice(0, 2).join(" · ") || g.year || ""))}</span>${right}</span></button>`;
}
const rowHTML = (title, items, sub = "", subFn, min = 1) => items.length >= min ? `<section class="section wrap"><div class="row-head"><h3>${title}</h3><span class="dim">${sub}</span></div>
  <div class="row">${items.map(g => cardHTML(g, subFn?.(g))).join("")}</div></section>` : "";

/* ---------- home ---------- */
const FAV = ["Platform", "Puzzle", "Point-and-click", "Mystery", "Adventure"]; // his favourite kinds of games
// Top carousel: platformers and metroidvanias only (IGDB files both under "Platform").
const isPlatformer = g => (g.genres || []).includes("Platform");
function upNextGames(){
  const pinned = list().filter(g => g.upNext && playable(g) && (g.status === "backlog" || g.status === "wishlist")).sort((a, b) => a.upNext - b.upNext);
  const pool = list().filter(g => isPlatformer(g) && playable(g) && g.status === "backlog");
  const playing = pool.filter(g => g.status === "playing" && !g.upNext).sort((a, b) => (b.touched || b.added || 0) - (a.touched || a.added || 0));
  const rest = pool.filter(g => !g.upNext && g.status !== "playing").sort((a, b) => (b.rating || 0) - (a.rating || 0));
  // The carousel is the shortlist. Suggestions only fill it while nothing is pinned.
  return pinned.length ? pinned : [...playing, ...rest].slice(0, 5);
}
function recommended(){
  const w = {};
  list().filter(g => g.status === "playing" || g.status === "done" || g.myRating >= 4)
    .forEach(g => genresOf(g).forEach(t => w[t] = (w[t] || 0) + (g.myRating ? g.myRating - 2 : 1)));
  FAV.forEach(t => w[t] = (w[t] || 0) + 3);
  const max = Math.max(1, ...Object.values(w));
  return list().filter(g => g.status === "backlog" && g.igdbId && !g.upNext && playable(g))
    .map(g => [g, genresOf(g).reduce((s, t) => s + (w[t] || 0), 0) / max + (g.rating || 65) / 100])
    .sort((a, b) => b[1] - a[1]).map(r => r[0]);
}
function heroHTML(g){
  if (g.igdbId && g.hero == null && !heroAsked.has(g.id)) fetchHero(g);
  const facts = [g.year, mainH(g) && `about ${mainH(g)}h`, g.steamHours && `${g.steamHours}h played`, g.rating && `Rating ${g.rating}`].filter(Boolean);
  const eyebrow = g.upNext ? (g.status === "wishlist" ? "Shortlist · wishlist" : "Shortlist") : "Suggested · pin to keep";
  return `<div class="hero slide"><div class="hero-bg">${g.hero || g.cover ? `<img src="${esc(g.hero || g.cover)}" alt="" loading="lazy">` : ""}</div>
    <div class="hero-in">
      ${g.logo ? `<img class="hero-logo" src="${esc(g.logo)}" alt="${esc(g.title)}">` : `<h1 class="hero-title">${esc(g.title)}</h1>`}
      <div class="hero-facts"><span class="badges" style="position:static">${badges(g.platforms)}</span>${facts.map(f => `<span>${esc(f)}</span>`).join("")}</div>
      <div class="hero-actions"><button class="btn" data-edit="${g.id}">Details</button></div>
    </div></div>`;
}
function carouselHTML(gs){
  if (!gs.length) return "";
  return `<section class="carousel"><div class="slides" id="slides">${gs.map(heroHTML).join("")}</div>
    ${gs.length > 1 ? `<button class="nav-arrow prev" data-slide="-1" aria-label="Previous">‹</button><button class="nav-arrow next" data-slide="1" aria-label="Next">›</button>
    <div class="dots">${gs.map((g, i) => `<button class="dotbtn" data-goto="${i}" aria-label="${esc(g.title)}" ${i === 0 ? 'aria-current="true"' : ""}></button>`).join("")}</div>` : ""}</section>`;
}
const heroAsked = new Set();
async function fetchHero(g){
  heroAsked.add(g.id);
  try { const d = await gameDetails(g.igdbId); await upd(g.id, {hero: d.hero || "", ...(g.logoSet ? {} : {logo: d.logo || ""})}); } catch {}
}
// Omri's categories. A game can sit in more than one.
const has = (g, x) => basicTags(g).includes(x) || (g.kw || []).includes(x);
const plat = g => (g.genres || []).includes("Platform");
const CATS = [
  ["MV's you own", g => kwOf(g).includes("Metroidvania")],
  ["2D platformers", g => plat(g) && has(g, "2D") && !kwOf(g).includes("Metroidvania") && !(g.genres || []).includes("Puzzle")],
  ["Couch co-op platformers", g => plat(g) && g.couch],
  ["Puzzle-platformers", g => plat(g) && ((g.genres || []).includes("Puzzle") || (g.kw || []).includes("Puzzle-platformer"))]
];
// 3D games ranked by how close they are to the 3D games he played and liked.
function taste3D(gs){
  const w = {};
  list().filter(g => has(g, "3D") && (g.status === "done" || g.status === "playing" || g.myRating))
    .forEach(g => genresOf(g).forEach(t => w[t] = (w[t] || 0) + (g.myRating ? g.myRating - 2.5 : 1)));
  return gs.filter(g => has(g, "3D")).map(g => [g, genresOf(g).reduce((s, t) => s + (w[t] || 0), 0) + (g.rating || 60) / 50])
    .sort((a, b) => b[1] - a[1]).map(r => r[0]);
}
const byLikely = (a, b) => (b.status === "playing") - (a.status === "playing") || (b.myRating || 0) - (a.myRating || 0) || (b.rating || 0) - (a.rating || 0);
function homeHTML(){
  if (!games.size) return emptyHTML();
  homeMode = "owned";
  const top = upNextGames(), inTop = new Set(top.map(g => g.id));
  const pool = list().filter(g => playable(g) && g.status === "backlog");
  const fits = g => CATS.some(([, test]) => test(g));
  const wish = list().filter(g => g.status === "wishlist" && !g.hidden)
    .sort((a, b) => (a.upNext || 9e15) - (b.upNext || 9e15) || fits(b) - fits(a) || (b.rating || 0) - (a.rating || 0)).slice(0, 30);
  const leaving = list().filter(g => leavingFor(g));
  const is2D = g => basicTags(g).includes("2D");
  const [metroid, plat2d, couch, puzzle] = CATS.map(([name, test], i) => rowHTML(name, pool.filter(test).sort((a, b) => (i === 0 ? is2D(b) - is2D(a) : 0) || byLikely(a, b)).slice(0, 24), "", undefined, 3));
  return carouselHTML(top)
    + (list().some(g => g.upNext) ? "" : `<p class="wrap why" style="padding-top:12px">Tip: open any game and tap the <b>pin</b> to put it at the top.</p>`)
    + metroid + plat2d + couch + puzzle
    + rowHTML("3D games for you", taste3D(pool).slice(0, 24), "", undefined, 3)
    + rowHTML("Leaving PS Plus soon", leaving);
}
function topTags(gs){
  const c = {}; gs.forEach(g => basicTags(g).forEach(t => c[t] = (c[t] || 0) + 1));
  return Object.entries(c).sort((a, b) => b[1] - a[1]).map(e => e[0]);
}
function topGenres(gs, n){
  const c = {}; gs.forEach(g => genresOf(g).forEach(t => c[t] = (c[t] || 0) + 1));
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]);
}
function emptyHTML(){
  return `<div class="empty wrap"><h2>No games yet</h2><p>Import your export file, pull in your Steam library, or paste titles.</p>
    <div class="chips"><button class="btn" data-act="import">Import file</button><button class="btn ghost" data-act="steam">Import Steam</button><button class="btn ghost" data-act="add">Paste titles</button></div></div>`;
}

/* ---------- shelf (library + wishlist) ---------- */
const typesOf = g => basicTags(g).filter(t => !VIEWS.includes(t) && !COOPS.includes(t) && t !== "Text");
const coopOf = g => basicTags(g).find(t => COOPS.includes(t)) || "";
// Each group, given a game: does it pass? `skip` leaves one group out (for live counts).
function passes(g, skip){
  return (skip === "stat" || !statF || (statF === "hidden" ? true : g.status === statF))
    && (skip === "plat" || !platF.size || (g.platforms || []).some(p => platF.has(p)))
    && (skip === "type" || !F.type.size || typesOf(g).some(t => F.type.has(t)))
    && (skip === "view" || !F.view.size || basicTags(g).some(t => F.view.has(t)))
    && (skip === "coop" || !F.coop.size || F.coop.has(coopOf(g)))
    && (skip === "access" || !F.access.size || F.access.has(g.ps))
    && (skip === "deck" || !deckF || (g.deck || 0) >= 2)
    && (genreF !== "__nomatch" || g.noMatch);
}
let shelfScope = [], shelfWish = false;
// Library renders in chunks: CHUNK cards, more as you scroll. The count survives data redraws, resets when filters change.
const CHUNK = 60;
let shelfShown = [], shelfLimit = CHUNK, shelfKey = "", shelfObs = null;
function moreShelf(){
  const grid = $("#main .grid"); if (!grid || shelfLimit >= shelfShown.length) return;
  const next = shelfShown.slice(shelfLimit, shelfLimit + CHUNK); shelfLimit += next.length;
  grid.insertAdjacentHTML("beforeend", next.map(g => cardHTML(g, shelfWish && sale(g) ? `−${g.sale.cut}% ${g.sale.shop || ""}` : undefined)).join(""));
  if (shelfLimit >= shelfShown.length) $("#shelfMore")?.remove();
}
function watchShelf(){
  shelfObs?.disconnect(); const el = $("#shelfMore"); if (!el) return;
  shelfObs = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) moreShelf(); }, {rootMargin: "800px"});
  shelfObs.observe(el);
}
function sidebarHTML(){
  const scope = shelfScope, wish = shelfWish;
  const count = (skip, test) => scope.filter(g => passes(g, skip) && test(g)).length;
  const opt = (group, val, label, n, on) => n || on ? `<button class="fopt" data-f="${group}|${esc(val)}" aria-pressed="${on}"><span>${esc(label)}</span><span class="n">${n}</span></button>` : "";
  const sec = (title, body) => body.trim() ? `<div class="fsec"><div class="label">${title}</div>${body}</div>` : "";
  const typeCounts = {}; scope.filter(g => passes(g, "type")).forEach(g => typesOf(g).forEach(t => typeCounts[t] = (typeCounts[t] || 0) + 1));
  const types = [...new Set([...Object.keys(typeCounts), ...F.type])].sort((a, b) => (typeCounts[b] || 0) - (typeCounts[a] || 0));
  const any = statF || platF.size || F.type.size || F.view.size || F.coop.size || F.access.size || deckF || sort !== "title";
  const SORTS = {title: wish ? "Most anticipated" : "A–Z", rating: "Best rated", short: "Shortest", added: "Recently added", ...(wish ? {} : {played: "Most played (Steam)"})};
  return `<div class="fhead"><b>Filters</b>${any ? `<button class="linkbtn" data-f="reset|">Reset</button>` : ""}</div>`
    + (wish ? "" : sec("Status", [["","All"],["backlog","Owned"],["playing","Playing"],["done","Finished"],["dropped","Dropped"],["hidden","Hidden"]]
        .map(([k, l]) => opt("stat", k, l, k === "hidden" ? list().filter(g => g.hidden && !g.nope && g.status !== "wishlist").length : count("stat", g => !k || g.status === k), statF === k)).join("")))
    + sec("Needs attention", opt("nomatch", "1", "No match found", scope.filter(g => g.noMatch).length, genreF === "__nomatch"))
    + sec("Type", types.map(t => opt("type", t, t, typeCounts[t] || 0, F.type.has(t))).join(""))
    + sec("View", VIEWS.map(v => opt("view", v, v, count("view", g => basicTags(g).includes(v)), F.view.has(v))).join(""))
    + sec("Co-op", COOPS.map(c => opt("coop", c, c.replace(" co-op", ""), count("coop", g => coopOf(g) === c), F.coop.has(c))).join(""))
    + sec("Platform", Object.keys(PLAT).map(p => opt("plat", p, PLAT[p][0], count("plat", g => (g.platforms || []).includes(p)), platF.has(p))).join(""))
    + sec("PlayStation", [["bought","Bought"],["claimed","Claimed"],["catalog","Catalog"],["left","Left PS Plus"]].map(([k, l]) => opt("access", k, l, count("access", g => g.ps === k), F.access.has(k))).join(""))
    + sec("Steam Deck", opt("deck", "1", "Good on Deck", count("deck", g => (g.deck || 0) >= 2), deckF))
    + sec("Sort", Object.entries(SORTS).map(([k, l]) => `<button class="fopt" data-f="sort|${k}" aria-pressed="${sort === k}"><span>${l}</span></button>`).join(""));
}
function shelfHTML(wish){
  if (!games.size) return emptyHTML();
  const scope = list().filter(g => (wish ? g.status === "wishlist" : g.status !== "wishlist") && (statF === "hidden" ? g.hidden && !g.nope : !g.hidden));
  shelfScope = scope; shelfWish = wish;
  const s = q.toLowerCase();
  const shown = scope.filter(g => passes(g) && (!s || g.title.toLowerCase().includes(s)));
  const by = {title: (a, b) => a.title.localeCompare(b.title), rating: (a, b) => (b.rating || 0) - (a.rating || 0), short: (a, b) => (mainH(a) || 999) - (mainH(b) || 999),
    added: (a, b) => (b.added || 0) - (a.added || 0), played: (a, b) => (b.steamHours || 0) - (a.steamHours || 0),
    anticipated: (a, b) => (a.upNext || 9e15) - (b.upNext || 9e15) || (b.myRating || 0) - (a.myRating || 0) || (b.rating || 0) - (a.rating || 0)};
  const srt = wish && sort === "title" ? "anticipated" : by[sort] ? sort : "title";
  shown.sort((a, b) => (srt === "title" ? (b.status === "playing") - (a.status === "playing") : 0) || by[srt](a, b));
  const key = JSON.stringify([wish, s, sort, statF, genreF, accessF, deckF, [...platF], ...Object.values(F).map(x => [...x])]);
  if (key !== shelfKey){ shelfKey = key; shelfLimit = CHUNK; }
  shelfShown = shown;
  const nOn = platF.size + F.type.size + F.view.size + F.coop.size + F.access.size + (deckF ? 1 : 0) + (sort !== "title" ? 1 : 0);
  return `${wish ? `<div class="wrap backbar"><button class="linkbtn" data-tab="disc">← Find</button><h2>Your wishlist</h2></div>` : ""}<div class="wrap libwrap"><aside class="side" id="side">${sidebarHTML()}</aside><div class="libmain">
    <div class="filters">
      <input id="q" type="search" autocomplete="off" placeholder="Search" value="${esc(q)}" aria-label="Search">
      <button class="chip mobile-only" data-act="filters">Filters${nOn ? ` · ${nOn}` : ""}</button>
      <span class="mono dim" aria-live="polite">${shown.length} ${shown.length === 1 ? "game" : "games"}</span>
    </div>
    ${wish ? "" : `<div class="chips statusbar mobile-only">${[["","All"],["backlog","Owned"],["playing","Playing"],["done","Finished"],["dropped","Dropped"]].map(([k, l]) => `<button class="chip" data-f="stat|${k}" aria-pressed="${statF === k}">${l}</button>`).join("")}</div>`}
    <div class="grid">${shown.slice(0, shelfLimit).map(g => cardHTML(g, wish && sale(g) ? `−${g.sale.cut}% ${g.sale.shop || ""}` : undefined)).join("") || `<div class="empty">Nothing matches these filters.</div>`}</div>${shown.length > shelfLimit ? `<div id="shelfMore" style="height:1px"></div>` : ""}
  </div></div>`;
}
function filterSheet(){
  openSheet(`<button class="x" data-act="close" aria-label="Close">${ic("x")}</button><div class="side insheet" id="sheetSide">${sidebarHTML()}</div><div class="actions sticky-actions"><button class="btn" data-act="close">Done</button></div>`);
}
function toggleFilter(group, val){
  if (group === "reset"){ platF.clear(); statF = ""; sort = "title"; deckF = false; genreF = ""; Object.values(F).forEach(x => x.clear()); }
  else if (group === "stat") statF = val;
  else if (group === "sort") sort = val;
  else if (group === "deck") deckF = !deckF;
  else if (group === "nomatch") genreF = genreF ? "" : "__nomatch";
  else { const set = group === "plat" ? platF : F[group]; set.has(val) ? set.delete(val) : set.add(val); }
  saveFilters(); render();
  if ($("#sheetSide")) $("#sheetSide").innerHTML = sidebarHTML();
}

/* ---------- discover ---------- */
// Suggestion card: cover with a small heart to wishlist, title, one short line.
function suggestCard(x, sub){
  previewCache.set(x.igdbId, x);
  const on = list().some(g => g.igdbId === x.igdbId && g.status === "wishlist");
  return `<div class="card sugg"><button class="card" data-preview="${x.igdbId}">${coverHTML({...x, platforms: [], status: "backlog"})}<span class="ctitle">${esc(x.title)}</span>${sub ? `<span class="csub"><span class="oneline">${esc(sub)}</span></span>` : ""}</button>
    <button class="heartbtn ${on ? "on-heart" : ""}" data-heart="${x.igdbId}" aria-label="${on ? "Remove from wishlist" : "Add to wishlist"}">${ic(on ? "heartf" : "heart", 18)}</button></div>`;
}
let couchFinds = null;
async function loadCouch(){
  try { couchFinds = await api("/couch?kind=platformer"); } catch (e){ couchFinds = {error: e.message}; }
  if (tab === "disc") render();
}
function couchHTML(){
  if (couchFinds === null){ loadCouch(); return `<div class="section"><h3>Couch co-op 2D platformers</h3><span class="why">Looking…</span></div>`; }
  if (couchFinds.error) return `<div class="section"><h3>Couch co-op 2D platformers</h3><span class="why">${esc(couchFinds.error)}</span></div>`;
  const have = new Set(list().map(g => g.igdbId));
  [...(couchFinds.fresh || []), ...(couchFinds.best || [])].forEach(x => previewCache.set(x.igdbId, x));
  const card = d => suggestCard(d, d.year || "");
  const row = (t, sub, xs) => { xs = xs.filter(d => !inList(d)); return xs.length ? `<div class="section"><div class="row-head"><h3>${t}</h3><span class="dim">${sub}</span></div><div class="row">${xs.map(card).join("")}</div></div>` : ""; };
  return row("New couch co-op 2D platformers", "released in the last 18 months", couchFinds.fresh) + row("Best couch co-op 2D platformers", "you don't own yet", couchFinds.best);
}
let radar = null;
const radarItem = id => [...(radar?.soonPs5 || []), ...(radar?.soonPc || []), ...(radar?.recent || [])].find(x => x.igdbId === id);
function radarHTML(){
  if (radar === null) radar = swr("c:upcoming", () => api("/upcoming"), r => radar = r, e => radar = {error: e.message}) || {};
  if (radar.error) return `<div class="section"><h3>Coming soon</h3><span class="why">Couldn't load new releases: ${esc(radar.error)}</span></div>`;
  if (!radar.soonPs5) return `<div class="section"><h3>Coming soon</h3><span class="why">Loading…</span></div>`;
  const have = new Set(list().map(g => g.igdbId));
  [...radar.soonPs5, ...radar.soonPc, ...radar.recent].forEach(x => previewCache.set(x.igdbId, x));
  const card = (x, sub) => suggestCard(x, sub);
  const row = (t, xs, subf) => { xs = xs.filter(x => !inList(x)); return xs.length ? `<div class="section"><h3>${t}</h3><div class="row">${xs.map(x => card(x, subf(x))).join("")}</div></div>` : ""; };
  const when = x => x.date ? new Date(x.date * 1000).toLocaleDateString("en-GB", {day: "numeric", month: "short", year: "numeric"}) : "Coming soon";
  return row("Coming soon on PS5", radar.soonPs5, when) + row("Coming soon on Steam", radar.soonPc, when);
}
// Find tab extras: wishlist sales and the best metroidvanias you don't own.
const priceTxt = x => x?.price ? (x.price.d ? `−${x.price.d}% ${x.price.f}` : x.price.f) : "";
// Show the last saved result instantly, refresh in the background, re-render only if it changed.
function swr(key, fetcher, set, onErr){
  let c = null; try { c = JSON.parse(localStorage.getItem(key)); } catch {}
  fetcher().then(r => { const j = JSON.stringify(r); if (c && JSON.stringify(c) === j) return; try { localStorage.setItem(key, j); } catch {} set(r); if (tab === "disc") render(); },
    e => { if (!c && onErr){ onErr(e); if (tab === "disc") render(); } });
  return c;
}
function findExtrasHTML(){
  const is2D = g => basicTags(g).includes("2D");
  if (topMV === null) topMV = swr("c:finds", () => api("/finds"), r => topMV = r) || {};
  const seen = new Set();
  const frow = (t, xs, subf, twoD) => {
    xs = (xs || []).filter(x => !inList(x) && !seen.has(x.igdbId));
    if (twoD) xs.sort((a, b) => is2D(b) - is2D(a));
    xs = xs.slice(0, 24); xs.forEach(x => { seen.add(x.igdbId); previewCache.set(x.igdbId, x); });
    return xs.length >= 3 ? `<div class="section"><h3>${t}</h3><div class="row">${xs.map(x => suggestCard(x, [subf(x), priceTxt(x)].filter(Boolean).join(" · "))).join("")}</div></div>` : "";
  };
  const yr = x => x.year || "", when = x => x.date ? new Date(x.date * 1000).toLocaleDateString("en-GB", {day: "numeric", month: "short"}) : yr(x);
  const rev = x => x?.steamN ? `${x.steamPct}% · ${x.steamN.toLocaleString("en")} reviews` : yr(x);
  const played = x => { const g = inList(x); return g && ["playing", "done", "dropped"].includes(g.status); };
  const top = (topMV.mvTop || []).filter(x => !played(x)).slice(0, 24), topIds = new Set(top.map(x => x.igdbId));
  // One metroidvania row: top rated first, then MVs you don't own (2D first).
  top.push(...(topMV.mv || []).filter(x => !inList(x) && !topIds.has(x.igdbId)).sort((a, b) => is2D(b) - is2D(a)).slice(0, 30 - top.length));
  top.forEach(x => { seen.add(x.igdbId); previewCache.set(x.igdbId, x); });
  const mvTop = top.length >= 3 ? `<div class="section"><h3>Metroidvanias you haven't played</h3><div class="row">${top.map(x => { const g = inList(x); return g ? cardHTML(g, rev(x)) : suggestCard(x, rev(x)); }).join("")}</div></div>` : "";
  const mv = mvTop + frow("2D platformers you don't own", topMV.plat, yr) + frow("Hidden gems", topMV.gems, rev)
    + frow("Puzzle co-op", topMV.coopPuzzle, yr) + frow("Couch co-op platformers", topMV.coopPlat, yr)
    + frow("Narrative & walking sims", topMV.walk, yr) + frow("Mystery & deduction", topMV.mystery, yr) + frow("Cozy short indies", topMV.cozy, yr) + frow("Zelda-likes", topMV.zelda, yr)
    + frow("You missed these", topMV.missed, yr) + frow("Classics", topMV.classics, yr, true);
  const wl = list().filter(g => g.status === "wishlist" && !g.hidden)
    .sort((a, b) => (a.upNext || 9e15) - (b.upNext || 9e15) || (b.myRating || 0) - (a.myRating || 0) || (b.rating || 0) - (a.rating || 0));
  const sales = list().filter(g => sale(g)).sort((a, b) => b.sale.cut - a.sale.cut);
  const seeAll = wl.length ? `<span class="dim">${wl.length} on wishlist</span><button class="linkbtn" data-tab="wish" style="margin-left:auto">See all</button>` : "";
  const onSale = sales.length ? `<div class="section"><div class="row-head"><h3>On sale from your wishlist</h3>${seeAll}</div><div class="row">${sales.map(g => cardHTML(g, `−${g.sale.cut}% ${g.sale.shop || ""}`)).join("")}</div></div>`
    : wl.length ? `<div class="section"><div class="row-head"><h3>Your wishlist</h3>${seeAll}</div></div>` : "";
  return onSale + mv;
}
const findPins = () => carouselHTML(list().filter(g => g.status === "wishlist" && g.upNext && !g.hidden).sort((a, b) => a.upNext - b.upNext));
function discoverHTML(){
  const liked = list().filter(g => g.igdbId && (g.myRating >= 4 || (g.status === "done" && !g.myRating) || g.status === "playing"));
  if (!liked.length) return `<div class="wrap">${findExtrasHTML()}${radarHTML()}</div><div class="empty wrap"><h2>Rate a few games first</h2><p>Mark games Finished and give them stars. Discover suggests games similar to the ones you rate 4–5.</p></div>`;
  if (discovered === null){ try { discovered = JSON.parse(localStorage.getItem("c:disc")); } catch {} discovered = discovered || {loading: 1}; runDiscover(liked); }
  const body = discovered.loading ? `<span class="why">Finding games like the ${liked.length} you enjoyed…</span>` : discovered.error ? `<span class="why">${esc(discovered.error)}</span>`
    : `<div class="row">${discovered.filter(d => !inList(d)).map(d => suggestCard(d, "Like " + d.because[0])).join("")}</div>`;
  return `<div class="wrap">${findExtrasHTML()}${radarHTML()}<div class="section"><div class="row-head"><h3>Because you liked…</h3><button class="btn ghost small" data-act="rediscover">Refresh</button></div>
    ${body}</div></div>`;
}
async function runDiscover(liked){
  try {
    const like = liked.sort((a, b) => (b.myRating || 3) - (a.myRating || 3)).slice(0, 60).map(g => g.igdbId);
    const r = await api("/discover", {like, exclude: list().map(g => g.igdbId).filter(Boolean)}), j = JSON.stringify(r);
    if (Array.isArray(discovered) && JSON.stringify(discovered) === j) return;
    discovered = r; try { localStorage.setItem("c:disc", j); } catch {}
  } catch (e){ if (!Array.isArray(discovered)) discovered = {error: e.message}; }
  if (tab === "disc") render();
}

/* ---------- diary + stats ---------- */
function diaryHTML(){
  const all = list(), done = all.filter(g => g.status === "done").sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  const year = new Date().getFullYear(), thisYear = done.filter(g => g.finishedAt && new Date(g.finishedAt).getFullYear() === year);
  const back = all.filter(g => g.status === "backlog" || g.status === "playing");
  const left = back.reduce((s, g) => s + (mainH(g) || 0), 0), rated = done.filter(g => g.myRating);
  const avg = rated.length ? (rated.reduce((s, g) => s + g.myRating, 0) / rated.length).toFixed(1) : "–";
  const bar = (label, n, max) => `<div class="barrow"><span>${esc(label)}</span><span class="fill" style="width:${Math.max(4, n / max * 100)}%"></span><span class="n">${n}</span></div>`;
  const gC = {}; done.forEach(g => genresOf(g).forEach(t => gC[t] = (gC[t] || 0) + 1));
  const gTop = Object.entries(gC).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const pC = {}; all.filter(g => g.status !== "wishlist").forEach(g => (g.platforms || []).forEach(p => pC[p] = (pC[p] || 0) + 1));
  const pTop = Object.entries(pC).sort((a, b) => b[1] - a[1]);
  let lastMonth = "";
  const entries = done.map(g => {
    const m = g.finishedAt ? new Date(g.finishedAt).toLocaleDateString("en-GB", {month: "long", year: "numeric"}) : "Earlier";
    const head = m !== lastMonth ? `<div class="month">${m}</div>` : ""; lastMonth = m;
    return head + `<button class="entry" data-edit="${g.id}">${coverHTML({...g, platforms: [], status: "done", sale: null})}<span><b>${esc(g.title)}</b><br><span class="why">${esc(genresOf(g).slice(0, 2).join(", "))}</span></span><span class="stars">${starsTxt(g.myRating) || `<span class="dim">Rate</span>`}</span></button>`;
  }).join("");
  return `<div class="wrap"><div class="section"><h2>Your year in games</h2>
    <div class="stats">
      <div class="stat"><b>${thisYear.length}</b><span>finished in ${year}</span></div>
      <div class="stat"><b>${back.length}</b><span>in your backlog</span></div>
      <div class="stat"><b>${left.toLocaleString()}h</b><span>to beat the backlog</span></div>
      <div class="stat"><b>${avg}</b><span>average rating</span></div>
    </div>
    <div class="two">
      ${gTop.length ? `<div class="panel"><span class="label">What you finish</span><div class="bars">${gTop.map(([t, n]) => bar(t, n, gTop[0][1])).join("")}</div></div>` : ""}
      ${pTop.length ? `<div class="panel"><span class="label">Where your games are</span><div class="bars">${pTop.map(([p, n]) => bar(PLAT[p]?.[0] || p, n, pTop[0][1])).join("")}</div></div>` : ""}
    </div></div>
    <div class="section"><h3>Finished</h3><div class="diary">${entries || `<div class="empty">Games you mark Finished show up here with the date and your stars.</div>`}</div></div></div>`;
}

/* ---------- render ---------- */
function render(){
  $("#tabs").innerHTML = TABS.map(([k, l, i]) => `<button class="tab" data-tab="${k}" ${tab === k || (k === "disc" && tab === "wish") ? 'aria-current="page"' : ""}><span class="ico">${ic(i)}</span>${l}</button>`).join("");
  const m = $("#main");
  if (!loaded){ m.innerHTML = `<div class="empty">Loading your games…</div>`; return; }
  // Keep each row's (and the carousel's) scroll position while staying on the same tab.
  const keyOf = el => el.id || el.closest(".section")?.querySelector("h3")?.textContent || "";
  const pos = rowTab === tab ? new Map([...m.querySelectorAll(".row, #slides")].map(el => [keyOf(el), el.scrollLeft])) : new Map();
  rowTab = tab;
  m.innerHTML = tab === "home" ? homeHTML() : tab === "lib" ? shelfHTML(false) : tab === "wish" ? shelfHTML(true) : tab === "disc" ? discoverHTML() : diaryHTML();
  if (pos.size) for (const el of m.querySelectorAll(".row, #slides")){ const x = pos.get(keyOf(el)); if (x) el.scrollLeft = x; }
  watchShelf();
}
let rowTab = null;
// Batch data-driven redraws (background queue writes games one by one): one render per ~500ms,
// none while a page is open (closing it renders) or while the app is in the background.
let softT = 0, softPending = false;
function softRender(){
  softPending = true;
  if (softT) return;
  softT = setTimeout(() => { softT = 0; if (document.hidden || $("#dlg").open) return; softPending = false; render(); }, 500);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && softPending && !$("#dlg").open){ softPending = false; render(); } });

/* ---------- sheets ---------- */
// The system back gesture (swipe from the screen edge) closes an open page.
addEventListener("popstate", () => { if ($("#dlg").open) shut(); });
// Close with a slide-down instead of vanishing; Esc goes through the same path.
function shut(){ const g = $("#dlg"); if (!g.open || g.classList.contains("closing")) return; g.classList.add("closing"); setTimeout(() => { if (g.classList.contains("closing")){ g.classList.remove("closing"); g.close(); } }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180); }
$("#dlg").addEventListener("cancel", e => { e.preventDefault(); closeSheet(); });
// Restart a one-shot CSS animation class on an element.
function anim(el, c){ if (!el) return; el.classList.remove(c); void el.offsetWidth; el.classList.add(c); }
// Fade covers in the first time an image arrives (cached re-renders stay still, no flicker).
const seenImg = new Set();
document.addEventListener("load", e => { const i = e.target; if (i.tagName !== "IMG" || seenImg.has(i.src)) return; seenImg.add(i.src); anim(i, "imgin"); }, true);
function openSheet(html, tall = false){ $("#dlg").classList.remove("closing"); if (!$("#dlg").open) history.pushState({sheet: 1}, ""); $("#dlg").classList.toggle("tall", tall === true); $("#dlg").classList.toggle("full", tall === "full"); $("#sheet").innerHTML = html; if (!$("#dlg").open) $("#dlg").showModal(); }
function closeSheet(){ if (history.state?.sheet) history.back(); else shut(); }
function note(t){ openSheet(`<p>${esc(t)}</p><div class="actions"><button class="btn" data-act="close">OK</button></div>`); }
const platOpts = sel => Object.entries(PLAT).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${v[0]}</option>`).join("");
const statOpts = sel => Object.entries(STAT).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${v}</option>`).join("");

function ownedHTML(g){
  const own = (g.platforms || []).filter(p => p !== "psplus"), plus = (g.platforms || []).includes("psplus");
  if (g.status === "wishlist") return `<div class="note">Not owned yet. It's on your wishlist${own.length ? ` (for ${own.map(p => PLAT[p][0]).join(", ")})` : ""}.</div>`;
  return `<div class="note own">${own.length ? `<b>You own it on</b> ${own.map(p => `<span class="chip"><span class="dot" style="background:var(${PLAT[p][2]})"></span>${PLAT[p][0]}</span>`).join(" ")}` : ""}
    ${plus ? `<div>${own.length ? "Also in" : "<b>Not owned.</b> Playable through"} <b>PS Plus</b> while you're subscribed.</div>` : ""}</div>`;
}
function menuSheet(){
  openSheet(`<h2>Backlog</h2><div class="menu">
    <button data-act="steam">Import from Steam<small>Adds your Steam games with hours played</small></button>
    <button data-act="steamwish">Import Steam wishlist<small>Adds games from your Steam wishlist</small></button>
    <button data-act="import">Import a file<small>The export from the old Backlog</small></button>
    <button data-act="nope">Not for me<small>Games you dismissed from suggestions</small></button>
    <button data-act="psplus">Update from PlayStation<small>Paste your PS Plus tab: bought, claimed, catalog, left</small></button>
    <button data-act="rematch">Re-check all matches<small>Fixes games matched to the wrong version</small></button>
    <button data-act="prices">Check wishlist prices now<small>PC stores via IsThereAnyDeal</small></button>
    <button data-act="signout">Sign out</button></div>
    <div class="actions"><button class="btn ghost" data-act="close">Close</button></div>`);
}
function addSheet(){
  openSheet(`<h2>Add games</h2>
    <div class="field"><label class="label" for="titles">One title per line</label><textarea id="titles" rows="8" placeholder="Hades&#10;Hollow Knight&#10;Astro Bot"></textarea></div>
    <div class="grid2"><div class="field"><label class="label" for="aPlat">Platform</label><select id="aPlat">${platOpts("ps5")}</select></div>
      <div class="field"><label class="label" for="aStat">List</label><select id="aStat">${statOpts(tab === "wish" ? "wishlist" : "backlog")}</select></div></div>
    <div class="status" id="aMsg">Covers and info load automatically. Games you already have get the new platform added.</div>
    <div class="actions"><button class="btn ghost" data-act="close">Cancel</button><button class="btn" id="aGo">Add</button></div>`);
  $("#aGo").onclick = async () => {
    $("#aGo").disabled = true;
    try { const {n, merged} = await addTitles($("#titles").value.split(/\r?\n/), $("#aPlat").value, $("#aStat").value);
      note(`Added ${n} games${merged ? ` and updated ${merged} you already had` : ""}.`); }
    catch (e){ $("#aMsg").textContent = "Couldn't save: " + e.message; $("#aGo").disabled = false; }
  };
}
// Game page: media carousel on top, short facts, quick controls that save as you tap.
// Not for me: owned games are hidden (Library → Hidden); suggestions are remembered so they never come back.
let toastTimer;
function toast(text, undo){
  let t = $("#toast"); if (!t){ t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.append(t); }
  t.innerHTML = `<span>${esc(text)}</span>${undo ? `<button class="btn ghost small" id="toastUndo">Undo</button>` : ""}`; t.hidden = false;
  if (undo) $("#toastUndo").onclick = () => { undo(); t.hidden = true; };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 5000);
}
async function notForMe(g){
  if (g.id && games.has(g.id)){
    await upd(g.id, {hidden: true}); toast(`${g.title} hidden`, () => upd(g.id, {hidden: false}));
  } else {
    const nid = newId(); const {because, score, added, ...data} = g;
    await setDoc(doc(col, nid), {...data, asTyped: g.title, platforms: [], status: "wishlist", hidden: true, nope: true, added: Date.now()});
    toast(`${g.title} won't be suggested again`, () => del(nid));
  }
}
function nopeSheet(){
  const nope = list().filter(g => g.nope);
  openSheet(`<h2>Not for me</h2>${nope.length ? `<div class="matches">${nope.map(g => `<div class="match">${g.cover ? `<img src="${esc(g.cover)}" alt="">` : "<span></span>"}<span><b>${esc(g.title)}</b> <button class="btn ghost small" data-unnope="${g.id}">Bring back</button></span></div>`).join("")}</div>` : `<p class="why">Nothing dismissed yet.</p>`}
    <div class="actions"><button class="btn" data-act="close">Close</button></div>`);
  $("#sheet").querySelectorAll("[data-unnope]").forEach(b => b.onclick = async () => { await del(b.dataset.unnope); b.closest(".match").remove(); });
}
// ---------- Game page: full screen, art behind the title, one status button, icon actions ----------
const previewCache = new Map();
function inList(x){
  const k = baseKey(x.title);
  return list().find(g => (x.igdbId && g.igdbId === x.igdbId) || baseKey(g.title) === k || baseKey(g.asTyped || "") === k) || null;
}
function pageShell(x, {own, actions, facts, edit}){
  const yr = new Date().getFullYear();
  const when = !x.year ? "Coming soon" : x.year > yr ? `Coming ${x.year}` : x.year;
  const meta = [when, ...basicTags(x), x.deck === 3 ? "Deck Verified" : x.deck === 2 ? "Deck Playable" : ""].filter(Boolean).join(" · ");
  const art = x.hero || x.cover;
  return `<div class="topbtns">${edit ? `<button class="x" id="kebab" aria-label="Edit options" aria-haspopup="true">${ic("more")}</button>` : ""}<button class="x" data-act="close" aria-label="Close">${ic("x")}</button></div>
  ${edit ? `<div class="editpanel" id="editPanel" hidden>${edit}</div>` : ""}
  <header class="gp-hero">${art ? `<img class="gp-bg" src="${esc(art)}" alt="">` : ""}
    <div class="gp-head">
      ${x.logo ? `<img class="gp-logo" src="${esc(x.logo)}" alt="${esc(x.title)}">` : `<h1 class="gp-title">${esc(x.title)}</h1>`}
      ${meta ? `<div class="meta">${esc(meta)}</div>` : ""}
      <div class="gp-actions">${actions}</div>
    </div></header>
  <div class="gp-body">
    <div class="gp-main">
      <div class="media"><div class="mslides" id="mslides"><div class="mslide">${art ? `<img src="${esc(art)}" alt="">` : ""}</div></div><div class="mdots" id="mdots"></div></div>
      <p class="desc clamp" id="desc"></p>
    </div>
    <aside class="gp-facts">${own}<div class="strip" id="strip"></div><div class="prog" id="prog"></div><div class="diff" id="diffBox"><span class="dchip none">…</span><span>Difficulty</span></div>${facts || ""}</aside>
  </div>
  <section class="gp-similar" id="simBox" hidden><h3>Similar games</h3><div class="row" id="simRow"></div></section>`;
}
async function previewSheet(x){
  const have = inList(x);
  if (have) return editSheet(have.id);
  previewCache.set(x.igdbId, x);
  openSheet(pageShell(x, {own: `<div class="ownline"><b class="st no">Not owned</b><span id="ownAvail"></span>${x.price ? `<span class="dim">· ${esc(priceTxt(x))} on Steam</span>` : ""}</div><div class="links"><a href="https://store.steampowered.com/search/?term=${encodeURIComponent(x.title)}" target="_blank" rel="noopener">Steam page ↗</a><a class="pslink" href="https://store.playstation.com/en-il/search/${encodeURIComponent(x.title)}" target="_blank" rel="noopener">PlayStation Store ↗</a></div>`, actions: `<button class="ibtn" id="pvPin" title="Pin to Play carousel" aria-label="Pin">${ic("pin")}</button><button class="ibtn" id="pvWish" title="Add to wishlist" aria-label="Add to wishlist">${ic("heart")}</button><button class="ibtn" id="pvNope" title="Not for me" aria-label="Not for me">${ic("down", 18)}</button>`}), "full");
  $("#desc").onclick = () => $("#desc").classList.toggle("clamp");
  let wid = null;
  $("#pvWish").onclick = async () => {
    if (wid){ await del(wid); wid = null; $("#pvWish").innerHTML = ic("heart"); $("#pvWish").classList.remove("on-heart"); toast("Removed from wishlist"); return; }
    wid = newId(); $("#pvWish").innerHTML = ic("heartf"); $("#pvWish").classList.add("on-heart");
    const {because, score, added, date, gem, taste, appid, steamPct, steamN, price, ...data} = x; await setDoc(doc(col, wid), {...data, ...(appid ? {steamAppId: appid} : {}), asTyped: x.title, platforms: [], status: "wishlist", added: Date.now(), ...(pinned ? {upNext: Date.now()} : {})});
    toast("Added to wishlist");
  };
  let pinned = false;
  $("#pvPin").onclick = async () => {
    pinned = !pinned; $("#pvPin").classList.toggle("on", pinned);
    if (!wid){ if (pinned) $("#pvWish").onclick(); return; }
    await setDoc(doc(col, wid), {upNext: pinned ? Date.now() : null}, {merge: true});
    toast(pinned ? "Pinned to Play" : "Unpinned");
  };
  $("#pvNope").onclick = () => { closeSheet(); notForMe(x); };
  fillDifficulty(x, null);
  try { const d = await gameDetails(x.igdbId); fillMedia(d); fillStrip(x, d); } catch (e){ if ($("#desc")) $("#desc").textContent = e.message; }
}
// Trailer: no YouTube buttons. A thin timeline to scrub, the title, tap left/right for −/+10s, middle to pause.
let ytReady, vTimer, isScrubbing = () => false;
function loadYT(){ return ytReady ||= new Promise(res => { window.onYouTubeIframeAPIReady = res; const sc = document.createElement("script"); sc.src = "https://www.youtube.com/iframe_api"; document.head.append(sc); }); }
async function mountTrailer(id){
  await loadYT(); if (!$("#ytp")) return;
  const flash = t => { const f = $("#vflash"); if (!f) return; f.textContent = t; f.classList.remove("show"); void f.offsetWidth; f.classList.add("show"); };
  const pl = new YT.Player("ytp", {videoId: id, playerVars: {autoplay: 1, mute: 1, start: 5, controls: 0, cc_load_policy: 0, playsinline: 1, rel: 0, modestbranding: 1, disablekb: 1, iv_load_policy: 3, fs: 0},
    events: {onStateChange: e => $("#vctl")?.classList.toggle("paused", e.data === 2), onReady: e => { e.target.playVideo(); const t = e.target.getVideoData()?.title; if ($("#vtitle")) $("#vtitle").textContent = t || ""; }}});
  clearInterval(vTimer);
  vTimer = setInterval(() => { const f = $("#vfill"); if (!f || !pl.getDuration || isScrubbing()) return; const dur = pl.getDuration() || 0; if (dur) f.style.width = (pl.getCurrentTime() / dur * 100) + "%"; }, 250);
  const ctl = $("#vctl");
  ctl.onclick = e => {
    if (e.target.closest("#vbar")) return;
    const r = ctl.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
    if (x < .35){ pl.seekTo(Math.max(0, pl.getCurrentTime() - 10), true); flash("−10s"); }
    else if (x > .65){ pl.seekTo(pl.getCurrentTime() + 10, true); flash("+10s"); }
    else if (pl.getPlayerState() === 1){ pl.pauseVideo(); flash("❚❚"); } else { pl.playVideo(); flash("▶"); }
  };
  // Drag along the timeline to scrub: the bar follows your finger, the video jumps as you move and settles on release.
  const bar = $("#vbar"); let scrubbing = false;
  const frac = e => { const r = bar.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
  const show = f => { $("#vfill").style.width = f * 100 + "%"; };
  bar.onpointerdown = e => { e.stopPropagation(); e.preventDefault(); scrubbing = true; bar.setPointerCapture(e.pointerId); const f = frac(e); show(f); pl.seekTo(f * (pl.getDuration() || 0), false); };
  bar.onpointermove = e => { if (!scrubbing) return; const f = frac(e); show(f); pl.seekTo(f * (pl.getDuration() || 0), false); };
  bar.onpointerup = bar.onpointercancel = e => { if (!scrubbing) return; scrubbing = false; pl.seekTo(frac(e) * (pl.getDuration() || 0), true); };
  bar.onclick = e => e.stopPropagation();
  isScrubbing = () => scrubbing;
}
// Your progress: Steam achievements and PlayStation trophies.
let trophyList = null;
async function fillProgress(g){
  const box = $("#prog"); if (!box) return;
  const rows = [];
  const bar = (label, got, total, extra = "") => `<div class="pbar"><div class="pline"><span>${label}</span><span><b>${got}/${total}</b>${extra}</span></div><div class="ptrack"><span style="width:${total ? got / total * 100 : 0}%"></span></div></div>`;
  const draw = () => { if ($("#prog") === box) box.innerHTML = rows.join(""); };
  const ps = (g.platforms || []).some(p => p === "ps5" || p === "psplus") || g.ps;
  let psRarity = null;
  if (g.steamAppId) api("/achievements?appid=" + g.steamAppId).then(a => { if (a.total){ rows.unshift(bar("Steam achievements", a.got, a.total)); draw(); } }).catch(() => {});
  if (ps){
    try {
      trophyList ||= api("/trophies");
      const k = baseKey(g.title), t = (await trophyList).find(x => baseKey(x.title) === k);
      if (t) { rows.push(bar("Trophies", t.got, t.total, t.hasPlat ? (t.plat ? ` · <span class="plat-ok">Platinum ✓</span>` : " · no platinum yet") : "")); draw(); }
      if (t?.npId) psRarity = api(`/rarity?np=${t.npId}&svc=${t.svc || "trophy"}`).then(r => r.plat != null ? [r.plat, "Platinum"] : r.rarest != null ? [r.rarest, "Rarest trophy"] : null).catch(() => null);
    } catch (e){ trophyList = null; if (/NPSSO/.test(e.message)) { rows.push(`<div class="why">${esc(e.message)}</div>`); draw(); } }
  }
  fillDifficulty(g, psRarity);
}
// Difficulty, same look for every game: how many players earned the platinum (PS),
// or the rarest achievement (Steam). Shown as "Unknown" when there's no data.
async function fillDifficulty(g, psRarity){
  const box = $("#diffBox"); if (!box) return;
  let r = psRarity ? await psRarity : null;
  if (!r && g.steamAppId) r = await api("/achrarity?appid=" + g.steamAppId).then(x => x.rarest != null ? [x.rarest, "Rarest achievement"] : null).catch(() => null);
  if ($("#diffBox") !== box) return;
  if (!r){ box.innerHTML = `<span class="dchip none">Unknown</span><span>No trophy data yet</span>`; return; }
  const [pct, what] = r, lvl = pct < 5 ? ["Very hard", "vhard"] : pct < 15 ? ["Hard", "hard"] : pct < 35 ? ["Medium", "med"] : ["Easy", "easy"];
  box.innerHTML = `<span class="dchip ${lvl[1]}">${lvl[0]}</span><span>${what} earned by <b>${pct}%</b> of players</span>`;
}
// Critics · Steam % · Developer · Your hours.
async function fillStrip(g, d){
  const box = $("#strip"); if (!box) return;
  if (d.available?.length && $("#ownAvail")) $("#ownAvail").textContent = " · available on " + d.available.join(", ");
  // No PlayStation release (e.g. PC only): drop the PS Store link.
  if (d.available?.length && !d.available.some(p => p === "PS5" || p === "PS4")) $(".pslink")?.remove();
  const parts = [null, d.critic && `<span>Critics <b>${d.critic}</b>/100</span>`, null, d.developers?.[0] && `<span>Developer <b>${esc(d.developers[0])}</b></span>`, g.steamHours ? `<span>You played <b>${g.steamHours}h</b></span>` : null];
  const draw = () => { if ($("#strip") === box) box.innerHTML = parts.filter(Boolean).join(""); };
  draw();
  if (g.steamAppId){
    let r = null;
    try { r = JSON.parse(localStorage.getItem("rev:" + g.steamAppId)); if (r && Date.now() - r.t > 7 * 864e5) r = null; } catch {}
    if (!r){ try { r = {...await api("/steamrev?appid=" + g.steamAppId), t: Date.now()}; localStorage.setItem("rev:" + g.steamAppId, JSON.stringify(r)); } catch {} }
    if (r?.pct != null){ parts[2] = `<span title="${esc(r.label)} · ${r.total} reviews">Steam reviews <b>${r.pct}%</b> positive</span>`; draw(); }
  }
}
// Trailer (with timeline) + screenshots, description, similar games.
function fillMedia(d){
  if (!$("#dlg").open || !$("#mslides")) return;
  $("#desc").textContent = d.summary || "";
  if (d.logo && !$(".gp-logo") && $(".gp-title")) $(".gp-title").outerHTML = `<img class="gp-logo" src="${esc(d.logo)}" alt="">`;
  if (d.hero && $(".gp-bg") && !$(".gp-bg").src.includes(d.hero)) $(".gp-bg").src = d.hero;
  const slides = [
    d.trailer && `<div class="mslide vwrap"><div id="ytp"></div><div class="vctl" id="vctl"><div class="vtitle" id="vtitle"></div><div class="vflash" id="vflash"></div><div class="vbar" id="vbar"><span id="vfill"></span></div></div></div>`,
    ...(d.shots || []).map(u => `<div class="mslide"><img src="${esc(u)}" alt="" loading="lazy"></div>`)
  ].filter(Boolean);
  if (slides.length){
    $("#mslides").innerHTML = slides.join("");
    $("#mdots").innerHTML = slides.map((_, i) => `<button class="dotbtn" data-mgo="${i}" aria-label="Slide ${i + 1}" ${i === 0 ? 'aria-current="true"' : ""}></button>`).join("");
  }
  if (d.trailer && $("#ytp")) mountTrailer(d.trailer);
  const byIgdb = new Map(list().map(g => [g.igdbId, g]));
  const sims = (d.similar || []).filter(x => !byIgdb.get(x.igdbId)?.nope);
  if (sims.length && $("#simBox")){
    $("#simBox").hidden = false;
    sims.forEach(x => previewCache.set(x.igdbId, x));
    $("#simRow").innerHTML = sims.map(x => { const own = byIgdb.get(x.igdbId);
      return own ? `<button class="card" data-edit="${own.id}">${coverHTML(own)}<span class="ctitle">${esc(own.title)}</span></button>`
        : `<button class="card" data-preview="${x.igdbId}">${coverHTML({...x, platforms: [], status: "wishlist"})}<span class="ctitle">${esc(x.title)}</span></button>`; }).join("");
  }
}
async function editSheet(id){
  const g = games.get(id); if (!g) return;
  let plats = new Set(g.platforms || []);
  const s = sale(g), lv = leavingFor(g), toDate = t => t ? new Date(t).toISOString().slice(0, 10) : "";
  const viaPlus = g.ps ? g.ps !== "bought" : (g.platforms || []).includes("psplus");
  const ownP = (g.platforms || []).filter(p => p !== "psplus" && !(p === "ps5" && viaPlus));
  const pills = g.status === "wishlist" ? `<span class="pill">Wishlist</span>`
    : ownP.map(p => `<span class="pill" style="--c:var(${PLAT[p][2]})">${PLAT[p][0]}</span>`).join("") + (viaPlus ? `<span class="pill" style="--c:var(--psplus)">${g.ps === "left" ? "Left PS+" : "PS+"}</span>` : "");
  // One button for the next step only.
  const NEXT = {wishlist: "I bought it", backlog: "Start playing", playing: "Finished", dropped: "Pick it up again"};
  const actions = `${NEXT[g.status] ? `<div class="menuwrap"><button class="btn" id="statBtn">${NEXT[g.status]}</button><div class="popmenu" id="statMenu" hidden></div></div>` : ""}
    ${g.status === "wishlist" ? `<button class="ibtn on-heart" id="wishBtn" title="Remove from wishlist" aria-label="Remove from wishlist">${ic("heartf")}</button>` : ""}
    <div class="menuwrap"><button class="ibtn ${g.myRating ? "on" : ""}" id="rateBtn" title="Rate" aria-label="Rate">${ic("star", 20, !!g.myRating)}${g.myRating ? `<small>${g.myRating}</small>` : ""}</button>
      <div class="popmenu stars" id="rateMenu" hidden>${[1,2,3,4,5].map(n => `<button data-star="${n}" class="${n <= (g.myRating || 0) ? "on" : ""}" aria-label="${n} stars">${ic("star", 26)}</button>`).join("")}</div></div>
    <button class="ibtn ${g.upNext ? "on" : ""}" id="upNextBtn" title="Shortlist" aria-label="Shortlist" aria-pressed="${!!g.upNext}">${ic("pin")}</button>
    <button class="ibtn" id="nopeBtn" title="${g.hidden ? "Show again" : "Not for me"}" aria-label="${g.hidden ? "Show again" : "Not for me"}">${g.hidden ? ic("undo") : ic("down")}</button>`;
  const facts = `
    ${s ? `<a class="deal ${s.cut >= 50 ? "hot" : ""}" href="${esc(s.url || "#")}" target="_blank" rel="noopener"><b>−${s.cut}%</b> ${esc(s.price ?? "")} ${esc(s.currency || "")} on ${esc(s.shop || "")}</a>` : ""}
    ${lv ? `<a class="deal warn" href="${esc(lv.url)}" target="_blank" rel="noopener">Leaving PS Plus soon</a>` : ""}
    <div class="links"><a href="${g.steamAppId ? `https://store.steampowered.com/app/${g.steamAppId}` : `https://store.steampowered.com/search/?term=${encodeURIComponent(g.title)}`}" target="_blank" rel="noopener">Steam page ↗</a><a class="pslink" href="https://store.playstation.com/en-il/search/${encodeURIComponent(g.title)}" target="_blank" rel="noopener">PlayStation Store ↗</a>${(g.platforms || []).some(p => p === "ps5" || p === "psplus") ? `<a href="https://psnprofiles.com/search/games?q=${encodeURIComponent(g.title)}" target="_blank" rel="noopener">PSNProfiles ↗</a>` : ""}</div>
    <label class="fin" id="finField" ${g.status === "done" ? "" : "hidden"}>Finished <input type="date" id="finDate" value="${toDate(g.finishedAt) || toDate(Date.now())}"></label>
`;
  const edit = `
      <div class="field"><span class="label">Status</span><div class="chips">${Object.entries(STAT).map(([k, v]) => `<button class="chip" data-setstat="${k}" aria-pressed="${g.status === k}">${v}</button>`).join("")}</div></div>
      <div class="field"><span class="label">Wrong game?</span><div class="chips"><input id="fix" value="${esc(g.asTyped || g.title)}" style="flex:1"><button class="btn ghost small" id="fixGo">Search</button></div><div class="matches" id="matches"></div></div>
      <div class="field"><span class="label">Logo</span><button class="btn ghost small" id="logoGo">Change logo</button><div class="logopick" id="logos"></div></div>
      <div class="field"><span class="label">Cover</span><button class="btn ghost small" id="coverGo">Change cover</button><div class="coverpick" id="covers"></div></div>
      <button class="btn ghost small danger" id="eDel">Delete game</button>
`;
  const pc = p => `<span class="pc" style="--c:var(${PLAT[p][2]})">${PLAT[p][0]}</span>`;
  const ownLine = g.ps === "left" ? `<b class="st no">Left PS Plus</b> · not playable now`
    : g.status === "wishlist" || (!ownP.length && !viaPlus) ? `<b class="st no">Not owned</b><span id="ownAvail"></span>`
    : ownP.length ? `<b class="st yes">Owned</b> ${ownP.map(pc).join(" ")}${viaPlus ? ` ${pc("psplus")}` : ""}`
    : `<b class="st yes">Owned</b> ${pc("psplus")} · while subscribed`;
  openSheet(pageShell(g, {own: `<div class="ownline">${ownLine}</div>`, actions, facts, edit}), "full");
  $("#kebab").onclick = e => { e.stopPropagation(); $("#editPanel").hidden = !$("#editPanel").hidden; };
  $("#sheet").addEventListener("click", e => { if ($("#editPanel") && !e.target.closest("#editPanel, #kebab")) $("#editPanel").hidden = true; });
  const sh = $("#sheet"), save = d => upd(id, {...d, touched: Date.now()});
  const pop = (btn, menu) => { $(btn).onclick = e => { e.stopPropagation(); sh.querySelectorAll(".popmenu").forEach(m => { if (m !== $(menu)) m.hidden = true; }); $(menu).hidden = !$(menu).hidden; }; };
  pop("#rateBtn", "#rateMenu");
  const reopen = () => setTimeout(() => editSheet(id), 120);
  if ($("#statBtn")) $("#statBtn").onclick = async e => {
    e.stopPropagation();
    if (g.status === "wishlist") return askBought("backlog");
    const st = g.status === "playing" ? "done" : "playing";
    await save({status: st, finishedAt: st === "done" ? Date.now() : null});
    toast(st === "done" ? "Finished! Rate it with the star" : "Enjoy!"); reopen();
  };
  if ($("#wishBtn")) $("#wishBtn").onclick = async () => {
    const snap = {...g}; delete snap.id; closeSheet(); await del(id);
    toast(`${g.title} removed from wishlist`, () => setDoc(doc(col, id), snap));
  };
  sh.addEventListener("click", e => { if (!e.target.closest(".menuwrap")) sh.querySelectorAll(".popmenu").forEach(m => m.hidden = true); });
  sh.querySelectorAll("[data-setstat]").forEach(b => b.onclick = () => {
    const st = b.dataset.setstat;
    if (g.status === "wishlist" && st !== "wishlist" && st !== "dropped" && $("#statBtn")) return askBought(st);
    save({status: st, finishedAt: st === "done" ? (Date.parse($("#finDate").value) || Date.now()) : null}); reopen();
  });
  $("#finDate").onchange = () => save({finishedAt: Date.parse($("#finDate").value) || Date.now()});
  let stars = g.myRating || 0;
  sh.querySelectorAll("[data-star]").forEach(b => b.onclick = () => {
    stars = +b.dataset.star === stars ? 0 : +b.dataset.star;
    sh.querySelectorAll("[data-star]").forEach(x => x.classList.toggle("on", +x.dataset.star <= stars));
    $("#rateBtn").innerHTML = ic("star", 20, !!stars) + (stars ? `<small>${stars}</small>` : ""); $("#rateBtn").classList.toggle("on", !!stars); $("#rateMenu").hidden = true;
    save({myRating: stars || null});
  });
  // Bought a wishlist game: pick the platform once, then it moves to that status.
  const askBought = st => {
    const m = $("#statMenu"); m.hidden = false;
    m.innerHTML = `<div class="label" style="padding:6px 12px">Where did you buy it?</div>` + ["ps5","steam","epic","itch"].map(p => `<button data-buy="${p}">${PLAT[p][0]}</button>`).join("");
    m.querySelectorAll("[data-buy]").forEach(x => x.onclick = async () => {
      await save({status: st, platforms: [x.dataset.buy], ps: x.dataset.buy === "ps5" ? "bought" : g.ps || null, upNext: g.upNext || null});
      toast(`Moved to ${STAT[st]} · ${PLAT[x.dataset.buy][0]}`); closeSheet();
    });
  };
  let pinned = !!g.upNext;
  $("#upNextBtn").onclick = () => { pinned = !pinned; $("#upNextBtn").classList.toggle("on", pinned); $("#upNextBtn").setAttribute("aria-pressed", pinned); save({upNext: pinned ? (g.upNext || Date.now()) : null}); toast(pinned ? "Added to your shortlist" : "Removed from your shortlist"); };
  $("#nopeBtn").onclick = async () => { closeSheet(); if (g.hidden){ await upd(id, {hidden: false}); toast(`${g.title} is back`); } else notForMe(g); };
  sh.querySelectorAll("[data-setplat]").forEach(b => b.onclick = () => { const p = b.dataset.setplat; plats.has(p) ? plats.delete(p) : plats.add(p); b.setAttribute("aria-pressed", plats.has(p)); save({platforms: [...plats]}); });
  $("#desc").onclick = () => $("#desc").classList.toggle("clamp");
  let armed = false;
  $("#eDel").onclick = async () => { if (!armed){ armed = true; $("#eDel").textContent = "Tap again to delete"; return; } await del(id); closeSheet(); };
  $("#logoGo").onclick = async () => {
    const box = $("#logos"); box.textContent = "Loading logos…";
    try {
      const urls = await api("/logos?t=" + encodeURIComponent(g.title));
      box.innerHTML = `<button data-logo="">Use the title instead</button>` + urls.map(u => `<button data-logo="${esc(u)}"><img src="${esc(u)}" alt=""></button>`).join("");
      box.querySelectorAll("[data-logo]").forEach(b => b.onclick = async () => { await upd(id, {logo: b.dataset.logo, logoSet: true}); toast("Logo changed"); closeSheet(); });
    } catch (e){ box.textContent = e.message; }
  };
  $("#coverGo").onclick = async () => {
    const box = $("#covers"); box.textContent = "Loading covers…";
    try {
      const urls = (await api("/grids", {titles: [g.title]}))[g.title] || [];
      box.innerHTML = urls.length ? urls.map(u => `<button data-cover="${esc(u)}"><img src="${esc(u)}" alt=""></button>`).join("") : "No other covers found.";
      box.querySelectorAll("[data-cover]").forEach(b => b.onclick = async () => { await upd(id, {cover: b.dataset.cover, coverSet: true}); toast("Cover changed"); box.innerHTML = ""; });
    } catch (e){ box.textContent = e.message; }
  };
  $("#fixGo").onclick = async () => {
    const box = $("#matches"); box.textContent = "Searching…";
    try {
      const res = await api("/search?q=" + encodeURIComponent($("#fix").value));
      box.innerHTML = res.map((r, i) => `<button class="match" data-m="${i}">${r.cover ? `<img src="${esc(r.cover)}" alt="">` : "<span></span>"}<span><b>${esc(r.title)}</b><br><span class="why">${r.year || ""}</span></span></button>`).join("") || "No results.";
      box.querySelectorAll("[data-m]").forEach(b => b.onclick = async () => { await applyMatch({...games.get(id), platforms: [...plats]}, res[+b.dataset.m]); closeSheet(); });
    } catch (e){ box.textContent = e.message; }
  };
  if (!g.igdbId) return;
  try {
    const d0 = await gameDetails(g.igdbId), d = g.logoSet ? {...d0, logo: g.logo} : d0;
    fillMedia(d); fillStrip(g, d); fillProgress(g);
    if ((!g.hero && d.hero) || (!g.logoSet && (d.logo || "") !== (g.logo || ""))) upd(id, {hero: g.hero || d.hero || "", ...(g.logoSet ? {} : {logo: d.logo || ""})});
  } catch (e){ if ($("#desc")) $("#desc").textContent = e.message; }
}

/* ---------- events ---------- */
document.addEventListener("click", async e => {
  const t = e.target.closest("button"); if (!t) return;
  const d = t.dataset;
  if (t.matches(".ibtn,.heartbtn")) anim(t, "pop");
  if (d.tab){ const ch = tab !== d.tab; tab = d.tab; q = ""; loadFilters(); render(); scrollTo(0, 0); if (ch) anim($("#main"), "tabin"); }
  else if (d.f != null){ const k = d.f.indexOf("|"); toggleFilter(d.f.slice(0, k), d.f.slice(k + 1)); }
  else if (d.plat){ platF.has(d.plat) ? platF.delete(d.plat) : platF.add(d.plat); render(); }
  else if (d.mood){ mood.has(d.mood) ? mood.delete(d.mood) : mood.add(d.mood); render(); }
  else if (d.time){ time = time === d.time ? "" : d.time; render(); }
  else if (d.edit) editSheet(d.edit);
  else if (d.heart){
    const id = +d.heart, have = list().find(g => g.igdbId === id && g.status === "wishlist");
    if (have){ await del(have.id); toast("Removed from wishlist"); }
    else { const x = previewCache.get(id); const {because, score, added, date, ...data} = x; await setDoc(doc(col, newId()), {...data, asTyped: x.title, platforms: [], status: "wishlist", added: Date.now()}); toast("Added to wishlist"); }
    render();
  }
  else if (d.preview){ const x = previewCache.get(+d.preview); if (x) previewSheet(x); }
  else if (d.mode){ homeMode = d.mode; render(); }
  else if (d.mgo != null){ const el = $("#mslides"); el.scrollTo({left: +d.mgo * el.clientWidth, behavior: "smooth"}); }
  else if (d.slide || d.goto != null){
    const el = $("#slides"); if (!el) return;
    const i = d.goto != null ? +d.goto : Math.round(el.scrollLeft / el.clientWidth) + +d.slide;
    el.scrollTo({left: Math.max(0, i) * el.clientWidth, behavior: "smooth"});
  }
  else if (d.finish){ await upd(d.finish, {status: "done", finishedAt: Date.now(), touched: Date.now()}); editSheet(d.finish); }
  else if (d.start) await upd(d.start, {status: "playing", touched: Date.now()});
  else if (d.cwish){
    const it = [...(couchFinds.fresh || []), ...(couchFinds.best || [])].find(x => x.igdbId === +d.cwish); t.disabled = true;
    await setDoc(doc(col, newId()), {...it, asTyped: it.title, platforms: [], status: "wishlist", added: Date.now()});
    it.added = true; render();
  }
  else if (d.nope != null){ const it = discovered[+d.nope]; discovered.splice(+d.nope, 1); render(); notForMe(it); }
  else if (d.rwish){ const it = radarItem(+d.rwish); t.disabled = true; t.textContent = "On wishlist";
    await setDoc(doc(col, newId()), {...it, asTyped: it.title, platforms: [], status: "wishlist", added: Date.now()}); }
  else if (d.rnope){ const it = radarItem(+d.rnope); notForMe(it); }
  else if (d.wish != null){
    const it = discovered[+d.wish]; t.disabled = true;
    const {because, score, ...data} = it;
    await setDoc(doc(col, newId()), {...data, asTyped: it.title, platforms: [], status: "wishlist", added: Date.now()});
    it.added = true; render(); runQueue();
  }
  else switch (d.act){
    case "add": addSheet(); break;
    case "import": closeSheet(); $("#importFile").click(); break;
    case "steam": importSteam(); break;
    case "steamwish": importSteamWishlist(); break;
    case "prices":
      closeSheet();
      if (running) break;
      running = true;
      checkPrices(true).then(() => progress(0, 0), err => progress(0, 0, err.message, true)).finally(() => running = false);
      break;
    case "psplus": psPasteSheet(); break;
    case "filters": filterSheet(); break;
    case "nope": nopeSheet(); break;
    case "rematch": closeSheet(); rematchAll(); break;
    case "rediscover": discovered = null; render(); break;
    case "signout": closeSheet(); signOut(getAuth()); break;
    case "close": closeSheet(); break;
  }
});
document.addEventListener("input", e => {
  if (e.target.id === "q"){ q = e.target.value; const pos = e.target.selectionStart; render(); const n = $("#q"); n.focus(); n.setSelectionRange(pos, pos); }
});
document.addEventListener("change", e => {
  const id = e.target.id;
  if (id === "statSel"){ statF = e.target.value; render(); }
  if (id === "genreSel"){ genreF = e.target.value; render(); }
  if (id === "accessSel"){ accessF = e.target.value; render(); }
  if (id === "sortSel"){ sort = e.target.value; render(); }
  if (id === "importFile" && e.target.files[0]){ importFile(e.target.files[0]); e.target.value = ""; }
});
$("#dlg").addEventListener("close", () => { $("#sheet").innerHTML = ""; clearInterval(vTimer); if (history.state?.sheet) history.back(); softPending = false; render(); });
document.addEventListener("scroll", e => {
  const el = e.target; if (el.id !== "slides" && el.id !== "mslides") return;
  const i = Math.round(el.scrollLeft / el.clientWidth);
  el.parentElement.querySelectorAll(".dotbtn").forEach((b, j) => b.toggleAttribute("aria-current", j === i));
}, true);
// Phones: the tab bar is position:fixed, but inside the sticky header Chrome can misplace it while scrolling. Move it to <body> there.
const phoneMQ = matchMedia("(max-width:760px)");
function placeTabs(){ const t = $("#tabs"); if (phoneMQ.matches) document.body.append(t); else $(".bar-in .brand").after(t); }
placeTabs(); phoneMQ.addEventListener("change", placeTabs);
$("#addBtn").onclick = addSheet;
$("#menuBtn").onclick = menuSheet;

/* ---------- boot ---------- */
const app = initializeApp(FIREBASE);
const auth = getAuth(app);
db = initializeFirestore(app, {localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})});
let unsub = null;
onAuthStateChanged(auth, user => {
  if (unsub){ unsub(); unsub = null; }
  if (!user){
    games = new Map(); loaded = false;
    ["#addBtn", "#menuBtn"].forEach(s => $(s).hidden = true);
    $("#tabs").innerHTML = "";
    $("#main").innerHTML = `<div class="empty wrap"><h2>Every game you own, one shelf</h2><p>Sign in with Google to sync between your phone and PC.</p><button class="btn" id="signIn">Sign in with Google</button><span class="status" id="signMsg"></span></div>`;
    $("#signIn").onclick = async () => {
      const prov = new GoogleAuthProvider();
      try { await signInWithPopup(auth, prov); }
      catch (e){ if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-environment") signInWithRedirect(auth, prov); else $("#signMsg").textContent = e.message; }
    };
    return;
  }
  col = collection(db, "users", user.uid, "games");
  ["#addBtn", "#menuBtn"].forEach(s => $(s).hidden = false);
  if (!API) progress(0, 0, "Covers and info will load once the Worker address is in config.js.", true);
  render();
  unsub = onSnapshot(col, snap => {
    games = new Map(snap.docs.map(d => [d.id, {id: d.id, ...d.data()}]));
    $("#sync").textContent = navigator.onLine ? "" : "offline";
    const first = !loaded; loaded = true;
    if (first) render(); else if (snap.docChanges().length) softRender();
    if (first) loadLeaving();
    runQueue();
  }, e => { $("#main").innerHTML = `<div class="empty wrap">Couldn't load your games: ${esc(e.message)}</div>`; });
});
