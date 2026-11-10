import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { API, FIREBASE } from "./config.js";

/* ---------- constants ---------- */
const PLAT = {ps5:["PS5","PS","--ps"], psplus:["PS Plus","P+","--psplus"], steam:["Steam","ST","--steam"], epic:["Epic","EP","--epic"], itch:["itch.io","IO","--itch"], other:["Other","··","--other"]};
const STAT = {backlog:"To play", playing:"Playing", done:"Finished", dropped:"Dropped", wishlist:"Wishlist"};
const RANK = {wishlist:1, backlog:2, playing:3, dropped:4, done:5};
const TABS = [["home","Home","⌂"],["lib","Library","▦"],["wish","Wishlist","♡"],["disc","Discover","✦"],["diary","Diary","★"]];
const SKIP_STEAM = /^(blender|sharex|wallpaper engine)$|public test|dedicated server|soundtrack|\bsdk\b|\bdemo\b|benchmark/i;

/* ---------- state ---------- */
let games = new Map(), tab = "home", loaded = false;
let homeMode = "owned";
let q = "", platF = new Set(), statF = "", genreF = "", sort = "title", accessF = "", deckF = false;
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
function basicTags(g){
  const v = [...new Set((g.views || []).map(x => VIEW[x]).filter(Boolean))].slice(0, 1);
  let k = [...new Set((g.genres || []).map(x => KIND[x]).filter(Boolean))].sort((a, b) => (a === "Adventure") - (b === "Adventure"));
  if ((g.kw || []).includes("Metroidvania")) k = ["Metroidvania", ...k.filter(x => x !== "Platformer")];
  k = k.slice(0, 2);
  const f = (g.kw || []).filter(x => x === "Soulslike" || x === "Chill").slice(0, 1);
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
  try { const c = JSON.parse(localStorage.getItem("gd:" + id)); if (c && Date.now() - c.t < 30 * 864e5){ detailMem.set(id, c.d); return c.d; } } catch {}
  const p = api("/game?id=" + id).then(d => { try { localStorage.setItem("gd:" + id, JSON.stringify({t: Date.now(), d})); } catch {} return d; });
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
      const todo = list().filter(g => !g.igdbId && (!g.noMatch || !g.noMatchAt) && !tried.has(g.id));
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
        if (m) await applyMatch(g, m); else await upd(g.id, {noMatch: true, noMatchAt: Date.now()});
      }
      done += batch.length;
    }
    await backfill();
    await checkDeck();
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
  const main = g.status === "playing" ? `<button class="btn" data-finish="${g.id}">Mark finished</button>`
    : g.status === "wishlist" ? "" : `<button class="btn" data-start="${g.id}">Start playing</button>`;
  return `<div class="hero slide"><div class="hero-bg">${g.hero || g.cover ? `<img src="${esc(g.hero || g.cover)}" alt="" loading="lazy">` : ""}</div>
    <div class="hero-in">
      <span class="eyebrow">${eyebrow}</span>
      ${g.logo ? `<img class="hero-logo" src="${esc(g.logo)}" alt="${esc(g.title)}">` : `<h1 class="hero-title">${esc(g.title)}</h1>`}
      <div class="hero-facts"><span class="badges" style="position:static">${badges(g.platforms)}</span>${facts.map(f => `<span>${esc(f)}</span>`).join("")}</div>
      <div class="hero-actions">${main}<button class="btn ghost" data-edit="${g.id}">Details</button></div>
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
  try { const d = await gameDetails(g.igdbId); await upd(g.id, {hero: d.hero || "", logo: d.logo || ""}); } catch {}
}
// Omri's categories. A game can sit in more than one.
const has = (g, x) => basicTags(g).includes(x) || (g.kw || []).includes(x);
const plat = g => (g.genres || []).includes("Platform");
const CATS = [
  ["Metroidvanias", g => (g.kw || []).includes("Metroidvania")],
  ["2D platformers", g => plat(g) && has(g, "2D") && !(g.kw || []).includes("Metroidvania") && !(g.genres || []).includes("Puzzle")],
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
  const [metroid, plat2d, couch, puzzle] = CATS.map(([name, test]) => rowHTML(name, pool.filter(test).sort(byLikely).slice(0, 24), "", undefined, 3));
  return carouselHTML(top)
    + (list().some(g => g.upNext) ? "" : `<p class="wrap why" style="padding-top:12px">Tip: open any game and tap <b>📌 Shortlist</b> to put it at the top.</p>`)
    + metroid + plat2d + couch + puzzle
    + rowHTML("Wishlist", wish, "", g => sale(g) ? `−${g.sale.cut}% ${g.sale.shop || ""}` : undefined)
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
function shelfHTML(wish){
  if (!games.size) return emptyHTML();
  const scope = list().filter(g => (wish ? g.status === "wishlist" : g.status !== "wishlist") && (statF === "hidden" ? g.hidden && !g.nope : !g.hidden));
  const plats = Object.keys(PLAT).filter(p => scope.some(g => (g.platforms || []).includes(p)));
  const s = q.toLowerCase(), nom = scope.filter(g => g.noMatch).length;
  const shown = scope.filter(g => (!statF || statF === "hidden" || g.status === statF)
    && (!deckF || (g.deck || 0) >= 2)
    && (!platF.size || (g.platforms || []).some(p => platF.has(p)))
    && (!genreF || (genreF === "__nomatch" ? g.noMatch : basicTags(g).includes(genreF)))
    && (!accessF || g.ps === accessF)
    && (!s || g.title.toLowerCase().includes(s)));
  const by = {title: (a, b) => a.title.localeCompare(b.title), rating: (a, b) => (b.rating || 0) - (a.rating || 0), short: (a, b) => (mainH(a) || 999) - (mainH(b) || 999),
    added: (a, b) => (b.added || 0) - (a.added || 0), played: (a, b) => (b.steamHours || 0) - (a.steamHours || 0),
    anticipated: (a, b) => (a.upNext || 9e15) - (b.upNext || 9e15) || (b.myRating || 0) - (a.myRating || 0) || (b.rating || 0) - (a.rating || 0)};
  const srt = wish && sort === "title" ? "anticipated" : sort;
  shown.sort((a, b) => (srt === "title" ? (b.status === "playing") - (a.status === "playing") : 0) || by[srt](a, b));
  const SORTS = {title: wish ? "Most anticipated" : "A–Z", rating: "Best rated", short: "Shortest", added: "Recently added", played: "Most played (Steam)"};
  const ACCESS = {bought: "Bought", claimed: "Claimed", catalog: "Catalog", left: "Left PS Plus"};
  const active = [...[...platF].map(p => [`plat:${p}`, PLAT[p][0]]), genreF && ["genre:", genreF === "__nomatch" ? "Needs a match" : genreF],
    accessF && ["access:", ACCESS[accessF]], deckF && ["deck:", "Good on Deck"], sort !== "title" && ["sort:", SORTS[sort]]].filter(Boolean);
  const nFilters = active.length;
  filterCtx = {wish, plats, tags: topTags(scope), nom, hasPs: scope.some(g => g.ps), SORTS, ACCESS};
  return `<div class="wrap"><div class="filters">
    <input id="q" type="search" autocomplete="off" placeholder="Search" value="${esc(q)}" aria-label="Search">
    <button class="chip" data-act="filters">Filters${nFilters ? ` · ${nFilters}` : ""}</button>
    <span class="mono dim" aria-live="polite">${shown.length} ${shown.length === 1 ? "game" : "games"}</span>
  </div>
  ${wish ? "" : `<div class="chips statusbar">${[["","All"],["backlog","To play"],["playing","Playing"],["done","Finished"],["dropped","Dropped"],["hidden","Hidden"]].map(([k, l]) => `<button class="chip" data-stat="${k}" aria-pressed="${statF === k}">${l}</button>`).join("")}</div>`}
  ${active.length ? `<div class="chips activebar">${active.map(([k, l]) => `<button class="chip on" data-clear="${esc(k)}" aria-label="Remove ${esc(l)}">${esc(l)} ×</button>`).join("")}</div>` : ""}
  <div class="grid">${shown.map(g => cardHTML(g, wish && sale(g) ? `−${g.sale.cut}% ${g.sale.shop || ""}` : undefined)).join("") || `<div class="empty">Nothing matches these filters.</div>`}</div></div>`;
}
let filterCtx = null;
function filterSheet(){
  const c = filterCtx; if (!c) return;
  openSheet(`<h2>Filters</h2>
    <div class="field"><span class="label">Platform</span><div class="chips">${c.plats.map(p => `<button class="chip" data-fplat="${p}" aria-pressed="${platF.has(p)}"><span class="dot" style="background:var(${PLAT[p][2]})"></span>${PLAT[p][0]}</button>`).join("")}</div></div>
    <div class="field"><label class="label" for="fType">Type</label><select id="fType"><option value="">All types</option>${c.nom ? `<option value="__nomatch" ${genreF === "__nomatch" ? "selected" : ""}>Needs a match (${c.nom})</option>` : ""}${c.tags.map(t => `<option ${t === genreF ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
    ${c.hasPs ? `<div class="field"><label class="label" for="fAccess">PlayStation</label><select id="fAccess"><option value="">Any</option>${Object.entries(c.ACCESS).map(([k, l]) => `<option value="${k}" ${accessF === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>` : ""}
    ${c.plats.includes("steam") ? `<div class="field"><span class="label">Steam Deck</span><div class="chips"><button class="chip" id="fDeck" aria-pressed="${deckF}">Good on Deck</button></div></div>` : ""}
    <div class="field"><label class="label" for="fSort">Sort</label><select id="fSort">${Object.entries(c.SORTS).filter(([k]) => !(c.wish && k === "played")).map(([k, l]) => `<option value="${k}" ${sort === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    <div class="actions"><button class="btn ghost" id="fReset">Reset</button><button class="btn" data-act="close">Done</button></div>`);
  const sh = $("#sheet");
  sh.querySelectorAll("[data-fplat]").forEach(b => b.onclick = () => { const p = b.dataset.fplat; platF.has(p) ? platF.delete(p) : platF.add(p); b.setAttribute("aria-pressed", platF.has(p)); });
  $("#fType").onchange = e => genreF = e.target.value;
  if ($("#fAccess")) $("#fAccess").onchange = e => accessF = e.target.value;
  $("#fSort").onchange = e => sort = e.target.value;
  if ($("#fDeck")) $("#fDeck").onclick = () => { deckF = !deckF; $("#fDeck").setAttribute("aria-pressed", deckF); };
  $("#fReset").onclick = () => { platF.clear(); genreF = ""; accessF = ""; deckF = false; sort = "title"; closeSheet(); };
}

/* ---------- discover ---------- */
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
  const card = d => `<div class="card"><button class="card" data-preview="${d.igdbId}">${coverHTML({...d, platforms: [], status: "wishlist"})}<span class="ctitle">${esc(d.title)}</span></button>
    <span class="csub"><span>${d.year || ""}</span>${d.rating ? `<span class="score ${d.rating >= 80 ? "hi" : ""}">${d.rating}</span>` : ""}</span>
    <button class="btn ghost small" data-cwish="${d.igdbId}" ${d.added ? "disabled" : ""}>${d.added ? "On wishlist" : "+ Wishlist"}</button></div>`;
  const row = (t, sub, xs) => { xs = xs.filter(d => !have.has(d.igdbId)); return xs.length ? `<div class="section"><div class="row-head"><h3>${t}</h3><span class="dim">${sub}</span></div><div class="row">${xs.map(card).join("")}</div></div>` : ""; };
  return row("New couch co-op 2D platformers", "released in the last 18 months", couchFinds.fresh) + row("Best couch co-op 2D platformers", "you don't own yet", couchFinds.best);
}
let radar = null;
const radarItem = id => [...(radar?.soon || []), ...(radar?.recent || [])].find(x => x.igdbId === id);
function radarHTML(){
  if (radar === null){ radar = {}; api("/upcoming").then(r => { radar = r; if (tab === "disc") render(); }, e => { radar = {error: e.message}; if (tab === "disc") render(); }); return `<div class="section"><h3>Coming soon</h3><span class="why">Loading…</span></div>`; }
  if (radar.error) return `<div class="section"><h3>Coming soon</h3><span class="why">Couldn't load new releases: ${esc(radar.error)}</span></div>`;
  if (!radar.soon) return `<div class="section"><h3>Coming soon</h3><span class="why">Loading…</span></div>`;
  const have = new Set(list().map(g => g.igdbId));
  [...(radar.soon || []), ...(radar.recent || [])].forEach(x => previewCache.set(x.igdbId, x));
  const card = (x, sub) => `<div class="card"><button class="card" data-preview="${x.igdbId}">${coverHTML({...x, platforms: [], status: "wishlist"})}<span class="ctitle">${esc(x.title)}</span></button><span class="csub"><span>${esc(sub)}</span></span>
    <span class="chips"><button class="btn ghost small" data-rwish="${x.igdbId}">+ Wishlist</button><button class="btn ghost small" data-rnope="${x.igdbId}" aria-label="Not for me">✕</button></span></div>`;
  const row = (t, xs, subf) => { xs = xs.filter(x => !have.has(x.igdbId)); return xs.length ? `<div class="section"><h3>${t}</h3><div class="row">${xs.map(x => card(x, subf(x))).join("")}</div></div>` : ""; };
  return row("Coming soon", radar.soon, x => new Date(x.date * 1000).toLocaleDateString("en-GB", {day: "numeric", month: "short"})) + row("Just released", radar.recent, x => basicTags(x).slice(1, 3).join(" · "));
}
function discoverHTML(){
  const liked = list().filter(g => g.igdbId && (g.myRating >= 4 || (g.status === "done" && !g.myRating) || g.status === "playing"));
  if (!liked.length) return `<div class="wrap">${radarHTML()}${couchHTML()}</div><div class="empty wrap"><h2>Rate a few games first</h2><p>Mark games Finished and give them stars. Discover suggests games similar to the ones you rate 4–5.</p></div>`;
  if (discovered === null){ runDiscover(liked); return `<div class="empty wrap">Finding games like the ${liked.length} you enjoyed…</div>`; }
  if (discovered.error) return `<div class="empty wrap">${esc(discovered.error)}</div>`;
  return `<div class="wrap">${radarHTML()}${couchHTML()}<div class="section"><div class="row-head"><h3>Because you liked…</h3><button class="btn ghost small" data-act="rediscover">Refresh</button></div>
    <div class="grid">${discovered.map((d, i) => (previewCache.set(d.igdbId, d), `<div class="card"><button class="card" data-preview="${d.igdbId}">${coverHTML({...d, platforms: [], status: "wishlist"})}
      <span class="ctitle">${esc(d.title)}</span></button><span class="why">Like ${esc(d.because.join(", "))}</span>
      <span class="csub"><span>${d.ttb?.main ? d.ttb.main + "h" : d.year || ""}</span>${d.rating ? `<span class="score ${d.rating >= 80 ? "hi" : ""}">${d.rating}</span>` : ""}</span>
      <span class="chips"><button class="btn ghost small" data-wish="${i}" ${d.added ? "disabled" : ""}>${d.added ? "On wishlist" : "+ Wishlist"}</button><button class="btn ghost small" data-nope="${i}" aria-label="Not for me">✕</button></span></div>`)).join("")}</div></div></div>`;
}
async function runDiscover(liked){
  try {
    const like = liked.sort((a, b) => (b.myRating || 3) - (a.myRating || 3)).slice(0, 60).map(g => g.igdbId);
    discovered = await api("/discover", {like, exclude: list().map(g => g.igdbId).filter(Boolean)});
  } catch (e){ discovered = {error: e.message}; }
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
  $("#tabs").innerHTML = TABS.map(([k, l, i]) => `<button class="tab" data-tab="${k}" ${tab === k ? 'aria-current="page"' : ""}><span class="ico" aria-hidden="true">${i}</span>${l}</button>`).join("");
  const m = $("#main");
  if (!loaded){ m.innerHTML = `<div class="empty">Loading your games…</div>`; return; }
  m.innerHTML = tab === "home" ? homeHTML() : tab === "lib" ? shelfHTML(false) : tab === "wish" ? shelfHTML(true) : tab === "disc" ? discoverHTML() : diaryHTML();
}

/* ---------- sheets ---------- */
function openSheet(html, tall = false){ $("#dlg").classList.toggle("tall", tall); $("#sheet").innerHTML = html; if (!$("#dlg").open) $("#dlg").showModal(); }
function closeSheet(){ $("#dlg").close(); }
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
// Preview for a game that isn't in your list (Discover, radar, similar games).
const previewCache = new Map();
async function previewSheet(x){
  const have = list().find(g => g.igdbId === x.igdbId);
  if (have) return editSheet(have.id);
  previewCache.set(x.igdbId, x);
  const meta = [x.year, ...basicTags(x)].filter(Boolean).join(" · ");
  openSheet(`<button class="x" data-act="close" aria-label="Close">×</button>
    <div class="media"><div class="mslides" id="mslides"><div class="mslide">${x.cover ? `<img src="${esc(x.cover)}" alt="">` : ""}</div></div><div class="mdots" id="mdots"></div></div>
    <div class="ghead">${coverHTML({...x, platforms: [], status: "wishlist"})}<div><h2>${esc(x.title)}</h2>${meta ? `<div class="meta">${esc(meta)}</div>` : ""}</div></div>
    <div class="ctrl"><div class="chips"><button class="btn" id="pvWish">+ Wishlist</button><button class="chip" id="pvNope">Not for me</button></div></div>
    <p class="desc clamp" id="desc"></p>
    <details class="more" id="simBox" hidden><summary>Similar to ${esc(x.title)}</summary><div class="row" id="simRow"></div></details>`, true);
  $("#desc").onclick = () => $("#desc").classList.toggle("clamp");
  $("#pvWish").onclick = async () => { $("#pvWish").disabled = true; $("#pvWish").textContent = "On wishlist";
    const {because, score, added, date, ...data} = x; await setDoc(doc(col, newId()), {...data, asTyped: x.title, platforms: ["other"], status: "wishlist", added: Date.now()}); };
  $("#pvNope").onclick = () => { closeSheet(); notForMe(x); };
  try { fillMedia(await gameDetails(x.igdbId)); } catch (e){ if ($("#desc")) $("#desc").textContent = e.message; }
}
// Trailer + screenshots, description and similar games into an open game page.
function fillMedia(d){
  if (!$("#dlg").open || !$("#mslides")) return;
  $("#desc").textContent = d.summary || "";
  const slides = [
    d.trailer && `<div class="mslide"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(d.trailer)}?autoplay=1&mute=1&loop=1&playlist=${encodeURIComponent(d.trailer)}&controls=0&playsinline=1&rel=0&modestbranding=1" title="Trailer" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`,
    ...(d.shots || []).map(u => `<div class="mslide"><img src="${esc(u)}" alt="" loading="lazy"></div>`)
  ].filter(Boolean);
  if (slides.length){
    $("#mslides").innerHTML = slides.join("");
    $("#mdots").innerHTML = slides.map((_, i) => `<button class="dotbtn" data-mgo="${i}" aria-label="Slide ${i + 1}" ${i === 0 ? 'aria-current="true"' : ""}></button>`).join("");
  }
  const byIgdb = new Map(list().map(g => [g.igdbId, g]));
  const sims = (d.similar || []).filter(x => !byIgdb.get(x.igdbId)?.nope);
  if (sims.length && $("#simBox")){
    $("#simBox").hidden = false;
    sims.forEach(x => previewCache.set(x.igdbId, x));
    $("#simRow").innerHTML = sims.map(x => { const own = byIgdb.get(x.igdbId);
      return own ? `<button class="card" data-edit="${own.id}">${coverHTML(own)}<span class="ctitle">${esc(own.title)}</span><span class="csub"><span>${STAT[own.status]}</span></span></button>`
        : `<button class="card" data-preview="${x.igdbId}">${coverHTML({...x, platforms: [], status: "wishlist"})}<span class="ctitle">${esc(x.title)}</span></button>`; }).join("");
  }
}
async function editSheet(id){
  const g = games.get(id); if (!g) return;
  let status = g.status, plats = new Set(g.platforms || []), stars = g.myRating || 0, pinned = !!g.upNext, couchV = !!g.couch;
  const s = sale(g), lv = leavingFor(g), toDate = t => t ? new Date(t).toISOString().slice(0, 10) : "";
  const meta = [g.year, ...basicTags(g), g.deck === 3 ? "Deck Verified" : g.deck === 2 ? "Deck Playable" : ""].filter(Boolean).join(" · ");
  // PS5 only counts when bought; PS Plus games get a single "PS+" pill.
  const viaPlus = g.ps ? g.ps !== "bought" : (g.platforms || []).includes("psplus");
  const own = (g.platforms || []).filter(p => p !== "psplus" && !(p === "ps5" && viaPlus));
  const pills = g.status === "wishlist" ? `<span class="pill">Wishlist</span>`
    : own.map(p => `<span class="pill" style="--c:var(${PLAT[p][2]})">${PLAT[p][0]}</span>`).join("")
      + (viaPlus ? `<span class="pill" style="--c:var(--psplus)">${g.ps === "left" ? "Left PS+" : "PS+"}</span>` : "");
  openSheet(`<button class="x" data-act="close" aria-label="Close">×</button>
    <div class="media"><div class="mslides" id="mslides"><div class="mslide">${g.hero || g.cover ? `<img src="${esc(g.hero || g.cover)}" alt="">` : ""}</div></div><div class="mdots" id="mdots"></div></div>
    <div class="ghead">${coverHTML({...g, platforms: [], sale: null, status: "backlog", noMatch: false})}
      <div><h2>${esc(g.title)}</h2>${meta ? `<div class="meta">${esc(meta)}</div>` : ""}<div class="pills">${pills}</div></div></div>
    ${s ? `<a class="deal ${s.cut >= 50 ? "hot" : ""}" href="${esc(s.url || "#")}" target="_blank" rel="noopener"><b>−${s.cut}%</b> ${esc(s.price ?? "")} ${esc(s.currency || "")} on ${esc(s.shop || "")}</a>` : ""}
    ${lv ? `<a class="deal warn" href="${esc(lv.url)}" target="_blank" rel="noopener">Leaving PS Plus soon</a>` : ""}
    <div class="seg">${Object.entries(STAT).map(([k, v]) => `<button data-setstat="${k}" aria-pressed="${status === k}">${v}</button>`).join("")}</div>
    <div class="ctrl"><div class="starpick">${[1,2,3,4,5].map(n => `<button data-star="${n}" class="${n <= stars ? "on" : ""}" aria-label="${n} stars">★</button>`).join("")}</div>
      <div class="chips"><button class="chip" id="upNextBtn" aria-pressed="${pinned}">📌 Shortlist</button><button class="chip" id="nopeBtn">${g.hidden ? "Show again" : "Not for me"}</button></div></div>
    <label class="fin" id="finField" ${status === "done" ? "" : "hidden"}>Finished on <input type="date" id="finDate" value="${toDate(g.finishedAt) || toDate(Date.now())}"></label>
    <p class="desc clamp" id="desc" title="Show more"></p>
    <details class="more" id="simBox" hidden><summary>Similar to ${esc(g.title)}</summary><div class="row" id="simRow"></div></details>
    <details class="more"><summary>More</summary>
      <div class="field"><span class="label">Where you own it</span><div class="chips">${Object.entries(PLAT).map(([k, v]) => `<button class="chip" aria-pressed="${plats.has(k)}" data-setplat="${k}"><span class="dot" style="background:var(${v[2]})"></span>${v[0]}</button>`).join("")}</div></div>
      <div class="field"><span class="label">Wrong game?</span><div class="chips"><input id="fix" value="${esc(g.asTyped || g.title)}" style="flex:1"><button class="btn ghost small" id="fixGo">Search</button></div><div class="matches" id="matches"></div></div>
      <button class="btn ghost small danger" id="eDel">Delete game</button>
    </details>`, true);
  const sh = $("#sheet"), save = d => upd(id, {...d, touched: Date.now()});
  sh.querySelectorAll("[data-setstat]").forEach(b => b.onclick = () => {
    status = b.dataset.setstat; sh.querySelectorAll("[data-setstat]").forEach(x => x.setAttribute("aria-pressed", x === b)); $("#finField").hidden = status !== "done";
    save({status, finishedAt: status === "done" ? (Date.parse($("#finDate").value) || Date.now()) : null});
  });
  $("#finDate").onchange = () => save({finishedAt: Date.parse($("#finDate").value) || Date.now()});
  sh.querySelectorAll("[data-star]").forEach(b => b.onclick = () => {
    stars = +b.dataset.star === stars ? 0 : +b.dataset.star; sh.querySelectorAll("[data-star]").forEach(x => x.classList.toggle("on", +x.dataset.star <= stars)); save({myRating: stars || null});
  });
  $("#upNextBtn").onclick = () => { pinned = !pinned; $("#upNextBtn").setAttribute("aria-pressed", pinned); save({upNext: pinned ? (g.upNext || Date.now()) : null}); };
  sh.querySelectorAll("[data-setplat]").forEach(b => b.onclick = () => { const p = b.dataset.setplat; plats.has(p) ? plats.delete(p) : plats.add(p); b.setAttribute("aria-pressed", plats.has(p)); save({platforms: [...plats]}); });
  $("#desc").onclick = () => $("#desc").classList.toggle("clamp");
  $("#nopeBtn").onclick = async () => { closeSheet(); if (g.hidden){ await upd(id, {hidden: false}); toast(`${g.title} is back`); } else notForMe(g); };
  let armed = false;
  $("#eDel").onclick = async () => { if (!armed){ armed = true; $("#eDel").textContent = "Tap again to delete"; return; } await del(id); closeSheet(); };
  $("#fixGo").onclick = async () => {
    const box = $("#matches"); box.textContent = "Searching…";
    try {
      const res = await api("/search?q=" + encodeURIComponent($("#fix").value));
      box.innerHTML = res.map((r, i) => `<button class="match" data-m="${i}">${r.cover ? `<img src="${esc(r.cover)}" alt="">` : "<span></span>"}<span><b>${esc(r.title)}</b><br><span class="why">${r.year || ""}</span></span></button>`).join("") || "No results.";
      box.querySelectorAll("[data-m]").forEach(b => b.onclick = async () => { await applyMatch({...g, status, platforms: [...plats]}, res[+b.dataset.m]); closeSheet(); });
    } catch (e){ box.textContent = e.message; }
  };
  if (!g.igdbId) return;
  try {
    const d = await gameDetails(g.igdbId);
    fillMedia(d);
    if (!g.hero && d.hero) upd(id, {hero: d.hero, logo: d.logo || ""});
  } catch (e){ if ($("#desc")) $("#desc").textContent = e.message; }
}

/* ---------- events ---------- */
document.addEventListener("click", async e => {
  const t = e.target.closest("button"); if (!t) return;
  const d = t.dataset;
  if (d.tab){ tab = d.tab; platF.clear(); statF = ""; genreF = ""; accessF = ""; q = ""; sort = "title"; render(); scrollTo(0, 0); }
  else if (d.plat){ platF.has(d.plat) ? platF.delete(d.plat) : platF.add(d.plat); render(); }
  else if (d.mood){ mood.has(d.mood) ? mood.delete(d.mood) : mood.add(d.mood); render(); }
  else if (d.time){ time = time === d.time ? "" : d.time; render(); }
  else if (d.edit) editSheet(d.edit);
  else if (d.preview){ const x = previewCache.get(+d.preview); if (x) previewSheet(x); }
  else if (d.mode){ homeMode = d.mode; render(); }
  else if (d.stat != null){ statF = d.stat; render(); }
  else if (d.clear){ const [k, v] = d.clear.split(":"); if (k === "plat") platF.delete(v); if (k === "genre") genreF = ""; if (k === "access") accessF = ""; if (k === "sort") sort = "title"; if (k === "deck") deckF = false; render(); }
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
    await setDoc(doc(col, newId()), {...it, asTyped: it.title, platforms: ["other"], status: "wishlist", added: Date.now()});
    it.added = true; render();
  }
  else if (d.nope != null){ const it = discovered[+d.nope]; discovered.splice(+d.nope, 1); render(); notForMe(it); }
  else if (d.rwish){ const it = radarItem(+d.rwish); t.disabled = true; t.textContent = "On wishlist";
    await setDoc(doc(col, newId()), {...it, asTyped: it.title, platforms: ["other"], status: "wishlist", added: Date.now()}); }
  else if (d.rnope){ const it = radarItem(+d.rnope); notForMe(it); }
  else if (d.wish != null){
    const it = discovered[+d.wish]; t.disabled = true;
    const {because, score, ...data} = it;
    await setDoc(doc(col, newId()), {...data, asTyped: it.title, platforms: ["other"], status: "wishlist", added: Date.now()});
    it.added = true; render(); runQueue();
  }
  else switch (d.act){
    case "add": addSheet(); break;
    case "import": closeSheet(); $("#importFile").click(); break;
    case "steam": importSteam(); break;
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
$("#dlg").addEventListener("close", () => { $("#sheet").innerHTML = ""; render(); });
document.addEventListener("scroll", e => {
  const el = e.target; if (el.id !== "slides" && el.id !== "mslides") return;
  const i = Math.round(el.scrollLeft / el.clientWidth);
  el.parentElement.querySelectorAll(".dotbtn").forEach((b, j) => b.toggleAttribute("aria-current", j === i));
}, true);
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
    $("#sync").textContent = snap.metadata.fromCache ? "offline" : "";
    const first = !loaded; loaded = true;
    if (!$("#dlg").open) render();
    if (first) loadLeaving();
    runQueue();
  }, e => { $("#main").innerHTML = `<div class="empty wrap">Couldn't load your games: ${esc(e.message)}</div>`; });
});
