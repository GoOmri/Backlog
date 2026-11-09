import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { RAWG_KEY, FIREBASE } from "./config.js";

/* ---------- constants ---------- */
const PLAT = {ps5:["PS5","PS","--ps"], psplus:["PS Plus","P+","--psplus"], steam:["Steam","ST","--steam"], epic:["Epic","EP","--epic"], itch:["itch.io","IO","--itch"], other:["Other","··","--other"]};
const STAT = {backlog:"To play", playing:"Playing", done:"Finished", dropped:"Dropped", wishlist:"Wishlist"};
const RANK = {wishlist:1, backlog:2, playing:3, dropped:4, done:5};
const TABS = [["next","Up next"],["lib","Library"],["wish","Wishlist"],["disc","Discover"]];
// RAWG tags that describe store features, not the game
const JUNK = new Set(["singleplayer","steam-achievements","full-controller-support","steam-cloud","steam-trading-cards","steam-leaderboards","partial-controller-support","controller","stats","achievements","cloud-saves","in-app-purchases","steam-workshop","includes-level-editor","remote-play-together","remote-play-on-tv","remote-play-on-phone","remote-play-on-tablet","steam-turn-notifications","valve-anti-cheat-enabled","captions-available","commentary-available","family-sharing","steamvr-collectibles","console","exclusive","true-exclusive","playstation-trophies","steam-overlay","includes-source-sdk","online-pvp","steam-pvp","steam-is-learning-about-this-game","great-soundtrack","atmospheric"]);

/* ---------- state ---------- */
let games = new Map(), tab = "next", q = "", platF = new Set(), tagF = "", sort = "title", loaded = false;
let pickMood = new Set(), pickTime = "", discFocus = "", discovered = [];
let uid = null, db = null, col = null;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const key = t => String(t).toLowerCase().replace(/[™®©]/g, "").replace(/[^a-z0-9]+/g, "");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const lenOf = h => !h ? "" : h < 10 ? "short" : h <= 30 ? "medium" : "long";
const list = () => [...games.values()];
const img = u => u ? u.replace("/media/games/", "/media/resize/640/-/games/").replace("/media/screenshots/", "/media/resize/640/-/screenshots/") : "";
const tagsOf = g => [...new Set([...(g.genres || []), ...(g.tags || [])].map(t => t.toLowerCase()))];

/* ---------- RAWG ---------- */
async function rawg(path, params = {}){
  const u = new URL("https://api.rawg.io/api/" + path);
  u.searchParams.set("key", RAWG_KEY);
  for (const [k, v] of Object.entries(params)) if (v !== "" && v != null) u.searchParams.set(k, v);
  const r = await fetch(u);
  if (r.status === 401) throw new Error("RAWG key not accepted. Check config.js.");
  if (!r.ok) throw new Error("RAWG answered " + r.status);
  return r.json();
}
function fromRawg(r){
  const tags = (r.tags || []).filter(t => t.language === "eng" && !JUNK.has(t.slug)).slice(0, 8);
  return {
    rawgId: r.id, slug: r.slug, title: r.name, cover: img(r.background_image), released: r.released || null,
    metacritic: r.metacritic || null, hours: r.playtime || null,
    genres: (r.genres || []).map(g => g.name), genreSlugs: (r.genres || []).map(g => g.slug),
    tags: tags.map(t => t.name.toLowerCase()), tagSlugs: tags.map(t => t.slug), noMatch: false
  };
}
function bestMatch(results, title){
  const k = key(title);
  return results.find(r => key(r.name) === k) || results.find(r => key(r.name).startsWith(k)) || results[0];
}

/* ---------- writes ---------- */
const upd = (id, d) => updateDoc(doc(col, id), d);
const del = id => deleteDoc(doc(col, id));
const newId = () => doc(col).id;

// Point a game at a RAWG entry. If another entry already has that game, merge into it.
async function applyMatch(g, r){
  const data = fromRawg(r);
  const twin = list().find(x => x.id !== g.id && x.rawgId === r.id);
  if (twin){
    await upd(twin.id, {platforms: [...new Set([...(twin.platforms || []), ...(g.platforms || [])])],
      status: RANK[g.status] > RANK[twin.status] ? g.status : twin.status});
    await del(g.id);
  } else {
    await upd(g.id, {...data, asTyped: g.asTyped || g.title});
  }
}

/* ---------- lookup queue ---------- */
let running = false;
const tried = new Set();
async function runQueue(){
  if (running || !RAWG_KEY) return;
  running = true;
  let done = 0;
  try {
    while (true){
      const todo = list().filter(g => !g.rawgId && !g.noMatch && !tried.has(g.id));
      if (!todo.length) break;
      progress(done, done + todo.length, `Looking up ${todo[0].title}`);
      const g = todo[0]; tried.add(g.id);
      const res = await rawg("games", {search: g.title, page_size: 6});
      const best = res.results?.length ? bestMatch(res.results, g.title) : null;
      if (best) await applyMatch(g, best); else await upd(g.id, {noMatch: true});
      done++;
      await sleep(150);
    }
    progress(0, 0);
  } catch (e){ progress(0, 0, e.message, true); }
  running = false;
}
function progress(n, total, text = "", stay = false){
  const p = $("#progress");
  p.hidden = !total && !stay;
  $("#progFill").style.width = total ? (n / total * 100) + "%" : "0";
  $("#progText").textContent = total ? `${n}/${total} · ${text}` : text;
}

/* ---------- adding ---------- */
async function addTitles(titles, platform, status){
  const have = new Map(list().flatMap(g => [[key(g.title), g], [key(g.asTyped || g.title), g]]));
  const batch = writeBatch(db); let n = 0, merged = 0;
  for (const raw of new Set(titles.map(t => t.trim()).filter(Boolean))){
    const g = have.get(key(raw));
    if (g){
      batch.update(doc(col, g.id), {platforms: [...new Set([...(g.platforms || []), platform])], status: RANK[status] > RANK[g.status] ? status : g.status});
      merged++;
    } else { batch.set(doc(col, newId()), {title: raw, asTyped: raw, platforms: [platform], status, added: Date.now() + n}); n++; }
  }
  await batch.commit();
  runQueue();
  return {n, merged};
}
async function importFile(file){
  let data; try { data = JSON.parse(await file.text()); } catch { alertSheet("That file isn't a Backlog export."); return; }
  const rows = Array.isArray(data) ? data : data.games;
  if (!Array.isArray(rows)){ alertSheet("That file isn't a Backlog export."); return; }
  const groups = new Map();
  for (const r of rows){
    if (!r?.title) continue;
    const k = key(r.title), st = STAT[r.status] ? r.status : "backlog", pl = PLAT[r.platform] ? r.platform : "other";
    const g = groups.get(k) || {title: String(r.title), asTyped: String(r.title), platforms: [], status: st, tags: r.tags || [], hours: r.hours || null};
    if (!g.platforms.includes(pl)) g.platforms.push(pl);
    if (RANK[st] > RANK[g.status]) g.status = st;
    groups.set(k, g);
  }
  const have = new Set(list().flatMap(g => [key(g.title), key(g.asTyped || g.title)]));
  const fresh = [...groups.entries()].filter(([k]) => !have.has(k)).map(e => e[1]);
  for (let i = 0; i < fresh.length; i += 400){
    const b = writeBatch(db);
    fresh.slice(i, i + 400).forEach((g, j) => b.set(doc(col, newId()), {...g, added: Date.now() + i + j}));
    await b.commit();
  }
  alertSheet(`Imported ${fresh.length} games. Covers and tags are loading now.`);
  runQueue();
}

/* ---------- views ---------- */
function inTab(g){
  if (tab === "next") return g.status === "backlog" || g.status === "playing";
  if (tab === "lib") return g.status !== "wishlist";
  if (tab === "wish") return g.status === "wishlist";
  return false;
}
function visible(){
  const s = q.toLowerCase();
  const out = list().filter(g => inTab(g)
    && (!platF.size || (g.platforms || []).some(p => platF.has(p)))
    && (!tagF || (tagF === "__nomatch" ? g.noMatch : tagsOf(g).includes(tagF)))
    && (!s || g.title.toLowerCase().includes(s) || tagsOf(g).some(t => t.toLowerCase().includes(s))));
  const by = {
    title: (a, b) => a.title.localeCompare(b.title),
    score: (a, b) => (b.metacritic || 0) - (a.metacritic || 0),
    short: (a, b) => (a.hours || 999) - (b.hours || 999),
    added: (a, b) => (b.added || 0) - (a.added || 0)
  }[sort];
  return out.sort((a, b) => (b.status === "playing") - (a.status === "playing") || by(a, b));
}
function topTags(gs, n){
  const c = {}; gs.forEach(g => tagsOf(g).forEach(t => c[t] = (c[t] || 0) + 1));
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]);
}
function badges(ps){ return (ps || []).map(p => { const v = PLAT[p] || PLAT.other; return `<span class="plat" style="background:var(${v[2]})" title="${v[0]}">${v[1]}</span>`; }).join(""); }
function coverHTML(g){
  return `<div class="cover">${g.cover ? `<img src="${esc(g.cover)}" alt="" loading="lazy">` : `<span class="ph">${esc(g.title)}</span>`}
    <span class="badges">${badges(g.platforms)}</span>
    ${g.noMatch ? `<span class="ribbon nomatch">No match</span>` : g.status !== "backlog" && g.status !== "wishlist" ? `<span class="ribbon ${g.status}">${STAT[g.status]}</span>` : ""}</div>`;
}
function cardHTML(g){
  return `<button class="card" data-edit="${g.id}">${coverHTML(g)}
    <span class="ctitle">${esc(g.title)}</span>
    <span class="csub"><span class="t">${esc((g.genres || []).slice(0, 2).join(", ") || (g.tags || []).slice(0, 2).join(", "))}</span>
    <span>${g.metacritic ? `<span class="mc ${g.metacritic >= 80 ? "hi" : ""}">${g.metacritic}</span>` : ""}${g.hours ? ` <span class="mono">${g.hours}h</span>` : ""}</span></span></button>`;
}

function render(){
  const c = {next: 0, lib: 0, wish: 0};
  list().forEach(g => { if (g.status === "backlog" || g.status === "playing") c.next++; if (g.status === "wishlist") c.wish++; else c.lib++; });
  $("#tabs").innerHTML = TABS.map(([k, l]) => `<button class="tab" role="tab" aria-selected="${tab === k}" data-tab="${k}">${l}${c[k] != null ? `<span class="n">${c[k]}</span>` : ""}</button>`).join("");
  const m = $("#main");
  if (!loaded){ m.innerHTML = `<div class="empty">Loading your games…</div>`; return; }
  if (tab === "disc"){ m.innerHTML = discoverHTML(); return; }
  if (!games.size){
    m.innerHTML = `<div class="empty"><h2>No games yet</h2><p>Import the file you exported from the old Backlog, or paste a list of titles.</p>
      <div class="chips"><button class="btn" data-act="import">Import file</button><button class="btn ghost" data-act="add">Paste titles</button></div></div>`;
    return;
  }
  const scope = list().filter(inTab);
  const plats = Object.keys(PLAT).filter(p => scope.some(g => (g.platforms || []).includes(p)));
  const nom = scope.filter(g => g.noMatch).length;
  const shown = visible();
  m.innerHTML = (tab === "next" ? pickHTML(scope) : "") + `
    <div class="filters">
      <input id="q" type="search" autocomplete="off" placeholder="Search title, genre or tag" value="${esc(q)}" aria-label="Search">
      ${plats.map(p => `<button class="chip" aria-pressed="${platF.has(p)}" data-plat="${p}"><span class="dot" style="background:var(${PLAT[p][2]})"></span>${PLAT[p][0]}</button>`).join("")}
      <select id="tagSel" aria-label="Filter by genre or tag"><option value="">All genres & tags</option>
        ${nom ? `<option value="__nomatch" ${tagF === "__nomatch" ? "selected" : ""}>Needs a match (${nom})</option>` : ""}
        ${topTags(scope, 40).map(t => `<option ${t === tagF ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
      <select id="sortSel" aria-label="Sort">${[["title","A–Z"],["score","Best rated"],["short","Shortest"],["added","Recently added"]].map(([k, l]) => `<option value="${k}" ${k === sort ? "selected" : ""}>${l}</option>`).join("")}</select>
    </div>
    <div class="grid">${shown.map(cardHTML).join("") || `<div class="empty">Nothing matches these filters.</div>`}</div>`;
}

/* ---------- what should I play (from backlog) ---------- */
function pickHTML(scope){
  const moods = topTags(scope, 14);
  const res = pickTime || pickMood.size ? pickResults(scope) : [];
  return `<section class="panel">
    <h2>What should I play?</h2>
    <div class="label">In the mood for</div>
    <div class="chips">${moods.map(t => `<button class="chip" aria-pressed="${pickMood.has(t)}" data-mood="${esc(t)}">${esc(t)}</button>`).join("")}</div>
    <div class="label">Time I have</div>
    <div class="chips">${[["short","Under 10h"],["medium","10–30h"],["long","30h+"]].map(([k, l]) => `<button class="chip" aria-pressed="${pickTime === k}" data-time="${k}">${l}</button>`).join("")}</div>
    ${res.length ? `<div class="picks">${res.map(([g, why]) => `<button class="pick" data-edit="${g.id}">${coverHTML(g)}<span><strong>${esc(g.title)}</strong><br><span class="why">${esc(why)}</span></span></button>`).join("")}</div>` : ""}
    ${(pickTime || pickMood.size) && !res.length ? `<div class="why">Nothing in your backlog fits. Try fewer moods.</div>` : ""}
  </section>`;
}
function pickResults(scope){
  return scope.map(g => {
    const hit = tagsOf(g).filter(t => pickMood.has(t));
    const timeOk = pickTime && lenOf(g.hours) === pickTime;
    const score = hit.length * 3 + (timeOk ? 2 : 0) + (g.status === "playing" ? 1 : 0) + (g.metacritic || 70) / 100 + Math.random() * .4;
    const why = [hit.length ? hit.join(", ") : "", timeOk ? `about ${g.hours}h` : "", g.metacritic ? `Metacritic ${g.metacritic}` : "", g.status === "playing" ? "already started" : ""].filter(Boolean).join(" · ");
    return [g, why, score, hit.length || timeOk];
  }).filter(r => r[3]).sort((a, b) => b[2] - a[2]).slice(0, 3);
}

/* ---------- discover (RAWG) ---------- */
function tasteProfile(){
  const w = {done: 3, playing: 2, backlog: .5, wishlist: 1, dropped: -2};
  const tags = {}, genres = {}, names = {};
  for (const g of list()){
    const x = w[g.status] || 0;
    (g.tagSlugs || []).forEach((s, i) => { tags[s] = (tags[s] || 0) + x; names[s] = g.tags[i]; });
    (g.genreSlugs || []).forEach((s, i) => { genres[s] = (genres[s] || 0) + x; names[s] = g.genres[i]; });
  }
  const top = o => Object.entries(o).filter(e => e[1] > 0).sort((a, b) => b[1] - a[1]).map(e => e[0]);
  return {tags, genres, names, topTags: top(tags), topGenres: top(genres)};
}
function discoverHTML(){
  const p = tasteProfile();
  if (!p.topTags.length) return `<div class="empty"><h2>Discover needs a few matched games</h2><p>Mark some games as Finished or Playing and suggestions will appear here.</p></div>`;
  const focus = [...p.topGenres.slice(0, 4), ...p.topTags.slice(0, 8)];
  return `<section class="panel">
    <h2>Games like the ones you play</h2>
    <div class="label">Focus on</div>
    <div class="chips"><button class="chip" aria-pressed="${!discFocus}" data-focus="">Everything I like</button>${focus.map(s => `<button class="chip" aria-pressed="${discFocus === s}" data-focus="${s}">${esc(p.names[s])}</button>`).join("")}</div>
    <div><button class="btn" data-act="discover">Find games</button></div>
    <div class="status" id="discMsg"></div>
  </section>
  <div class="grid">${discovered.map((d, i) => `<div class="card">${coverHTML({...d, platforms: [], status: "wishlist"})}
    <span class="ctitle">${esc(d.title)}</span><span class="why">${esc(d.why)}</span>
    <span class="chips"><select data-dplat="${i}" aria-label="Platform">${Object.entries(PLAT).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join("")}</select>
    <button class="btn ghost small" data-wish="${i}" ${d.added ? "disabled" : ""}>${d.added ? "Added" : "+ Wishlist"}</button></span></div>`).join("")}</div>`;
}
async function discover(){
  const msg = $("#discMsg"); msg.textContent = "Searching RAWG…";
  const p = tasteProfile();
  const isGenre = s => p.genres[s] != null && !p.tags[s];
  const queries = discFocus
    ? [isGenre(discFocus) ? {genres: discFocus, tags: p.topTags[0]} : {tags: discFocus, genres: p.topGenres[0]}, isGenre(discFocus) ? {genres: discFocus} : {tags: discFocus}]
    : [{genres: p.topGenres[0], tags: p.topTags[0]}, {genres: p.topGenres[1] || p.topGenres[0], tags: p.topTags[1]}, {tags: p.topTags[2]}];
  try {
    const owned = new Set(list().map(g => g.rawgId)), ownedK = new Set(list().map(g => key(g.title)));
    const seen = new Map();
    for (const qy of queries){
      const res = await rawg("games", {...qy, ordering: "-added", page_size: 40, exclude_additions: true});
      for (const r of res.results || []) if (!owned.has(r.id) && !ownedK.has(key(r.name)) && !seen.has(r.id)) seen.set(r.id, r);
    }
    discovered = [...seen.values()].map(r => {
      const d = fromRawg(r);
      const shared = [...d.genreSlugs, ...d.tagSlugs].filter(s => (p.tags[s] || p.genres[s] || 0) > 0);
      const score = shared.reduce((a, s) => a + (p.tags[s] || 0) + (p.genres[s] || 0), 0) + (d.metacritic || 70) / 20;
      return {...d, score, why: "Shares " + shared.slice(0, 3).map(s => p.names[s]).join(", ") + (d.metacritic ? ` · Metacritic ${d.metacritic}` : "")};
    }).sort((a, b) => b.score - a.score).slice(0, 12);
    render();
  } catch (e){ msg.textContent = e.message; }
}

/* ---------- sheets ---------- */
function openSheet(html){ $("#sheet").innerHTML = html; if (!$("#dlg").open) $("#dlg").showModal(); }
function closeSheet(){ $("#dlg").close(); }
function alertSheet(t){ openSheet(`<p>${esc(t)}</p><div class="actions"><button class="btn" data-act="close">OK</button></div>`); }
const platOpts = sel => Object.entries(PLAT).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${v[0]}</option>`).join("");
const statOpts = sel => Object.entries(STAT).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${v}</option>`).join("");

function addSheet(){
  openSheet(`<h2>Add games</h2>
    <div class="field"><label class="label" for="titles">One title per line</label>
      <textarea id="titles" rows="8" placeholder="Hades&#10;Hollow Knight&#10;Astro Bot"></textarea></div>
    <div class="grid2">
      <div class="field"><label class="label" for="aPlat">Platform</label><select id="aPlat">${platOpts("steam")}</select></div>
      <div class="field"><label class="label" for="aStat">List</label><select id="aStat">${statOpts(tab === "wish" ? "wishlist" : "backlog")}</select></div>
    </div>
    <div class="status" id="aMsg">Covers, genres and tags come from RAWG. Games you already have get the new platform added instead of a copy.</div>
    <div class="actions"><button class="btn ghost" data-act="close">Cancel</button><button class="btn" id="aGo">Add</button></div>`);
  $("#titles").focus();
  $("#aGo").onclick = async () => {
    $("#aGo").disabled = true;
    try {
      const {n, merged} = await addTitles($("#titles").value.split(/\r?\n/), $("#aPlat").value, $("#aStat").value);
      alertSheet(`Added ${n} games${merged ? `, added the platform to ${merged} you already had` : ""}.`);
    } catch (e){ $("#aMsg").textContent = "Couldn't save: " + e.message; $("#aGo").disabled = false; }
  };
}

async function editSheet(id){
  const g = games.get(id); if (!g) return;
  let status = g.status, plats = new Set(g.platforms || []);
  openSheet(`${g.cover ? `<div class="hero"><img src="${esc(g.cover)}" alt=""></div>` : ""}
    <h2>${esc(g.title)}</h2>
    <div class="facts">${g.released ? `<span>${g.released.slice(0, 4)}</span>` : ""}${g.metacritic ? `<span>Metacritic ${g.metacritic}</span>` : ""}${g.hours ? `<span>about ${g.hours}h</span>` : ""}<span id="devs"></span>
      ${g.slug ? `<a href="https://rawg.io/games/${esc(g.slug)}" target="_blank" rel="noopener">RAWG page</a>` : ""}</div>
    <div class="chips">${tagsOf(g).map(t => `<span class="chip">${esc(t)}</span>`).join("")}</div>
    <div class="desc" id="desc">${g.rawgId ? "Loading description…" : g.noMatch ? "No match on RAWG yet. Use Fix match below." : ""}</div>
    <div class="field"><span class="label">List</span><div class="chips">${Object.entries(STAT).map(([k, v]) => `<button class="chip" aria-pressed="${status === k}" data-setstat="${k}">${v}</button>`).join("")}</div></div>
    <div class="field"><span class="label">Platforms</span><div class="chips">${Object.entries(PLAT).map(([k, v]) => `<button class="chip" aria-pressed="${plats.has(k)}" data-setplat="${k}"><span class="dot" style="background:var(${v[2]})"></span>${v[0]}</button>`).join("")}</div></div>
    <div class="field"><label class="label" for="fix">Wrong game? Search RAWG</label>
      <div class="chips"><input id="fix" value="${esc(g.asTyped || g.title)}" style="flex:1"><button class="btn ghost small" id="fixGo">Search</button></div>
      <div class="matches" id="matches"></div></div>
    <div class="actions"><button class="btn ghost danger" id="eDel" style="margin-right:auto">Delete</button><button class="btn ghost" data-act="close">Cancel</button><button class="btn" id="eSave">Save</button></div>`);
  const sh = $("#sheet");
  sh.querySelectorAll("[data-setstat]").forEach(b => b.onclick = () => { status = b.dataset.setstat; sh.querySelectorAll("[data-setstat]").forEach(x => x.setAttribute("aria-pressed", x === b)); });
  sh.querySelectorAll("[data-setplat]").forEach(b => b.onclick = () => { const p = b.dataset.setplat; plats.has(p) ? plats.delete(p) : plats.add(p); b.setAttribute("aria-pressed", plats.has(p)); });
  $("#eSave").onclick = async () => { await upd(id, {status, platforms: [...plats]}); closeSheet(); };
  let armed = false;
  $("#eDel").onclick = async () => { if (!armed){ armed = true; $("#eDel").textContent = "Tap again to delete"; return; } await del(id); closeSheet(); };
  $("#fixGo").onclick = async () => {
    const box = $("#matches"); box.textContent = "Searching…";
    try {
      const res = await rawg("games", {search: $("#fix").value, page_size: 6});
      box.innerHTML = (res.results || []).map((r, i) => `<button class="match" data-m="${i}">${r.background_image ? `<img src="${esc(img(r.background_image))}" alt="">` : "<span></span>"}<span><strong>${esc(r.name)}</strong><br><span class="why">${(r.released || "").slice(0, 4)} · ${esc((r.genres || []).map(x => x.name).join(", "))}</span></span></button>`).join("") || "No results.";
      box.querySelectorAll("[data-m]").forEach(b => b.onclick = async () => { await applyMatch({...g, status, platforms: [...plats]}, res.results[+b.dataset.m]); closeSheet(); });
    } catch (e){ box.textContent = e.message; }
  };
  if (g.rawgId){
    try {
      const d = await rawg("games/" + g.rawgId);
      if ($("#dlg").open && $("#desc")){
        $("#desc").textContent = (d.description_raw || "No description.").slice(0, 1200);
        $("#devs").textContent = (d.developers || []).map(x => x.name).join(", ");
      }
    } catch { if ($("#desc")) $("#desc").textContent = ""; }
  }
}

/* ---------- events ---------- */
document.addEventListener("click", async e => {
  const t = e.target.closest("button"); if (!t) return;
  const d = t.dataset;
  if (d.tab){ tab = d.tab; platF.clear(); tagF = ""; render(); }
  else if (d.plat){ platF.has(d.plat) ? platF.delete(d.plat) : platF.add(d.plat); render(); }
  else if (d.mood){ pickMood.has(d.mood) ? pickMood.delete(d.mood) : pickMood.add(d.mood); render(); }
  else if (d.time){ pickTime = pickTime === d.time ? "" : d.time; render(); }
  else if (d.focus != null && !d.setplat){ discFocus = d.focus; render(); }
  else if (d.edit) editSheet(d.edit);
  else if (d.act === "add") addSheet();
  else if (d.act === "import") $("#importFile").click();
  else if (d.act === "close") closeSheet();
  else if (d.act === "discover"){ t.disabled = true; await discover(); }
  else if (d.wish != null){
    const it = discovered[+d.wish]; t.disabled = true;
    const plat = document.querySelector(`[data-dplat="${d.wish}"]`).value;
    const {score, why, ...data} = it;
    await setDoc(doc(col, newId()), {...data, asTyped: it.title, platforms: [plat], status: "wishlist", added: Date.now()});
    it.added = true; render();
  }
});
document.addEventListener("input", e => {
  if (e.target.id === "q"){ q = e.target.value; const pos = e.target.selectionStart; render(); const n = $("#q"); n.focus(); n.setSelectionRange(pos, pos); }
});
document.addEventListener("change", e => {
  if (e.target.id === "tagSel"){ tagF = e.target.value; render(); }
  if (e.target.id === "sortSel"){ sort = e.target.value; render(); }
  if (e.target.id === "importFile" && e.target.files[0]){ importFile(e.target.files[0]); e.target.value = ""; }
});
$("#dlg").addEventListener("close", () => render());
$("#addBtn").onclick = addSheet;
$("#importBtn").onclick = () => $("#importFile").click();

/* ---------- boot ---------- */
function setupNeeded(){
  $("#main").innerHTML = `<div class="empty"><h2>Almost there</h2><p>Fill in your RAWG key and Firebase settings in <code>config.js</code>. SETUP.md walks through it.</p></div>`;
}
if (!RAWG_KEY || !FIREBASE.apiKey){ setupNeeded(); }
else {
  const app = initializeApp(FIREBASE);
  const auth = getAuth(app);
  db = initializeFirestore(app, {localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})});
  let unsub = null;
  onAuthStateChanged(auth, user => {
    if (unsub){ unsub(); unsub = null; }
    if (!user){
      uid = null; games = new Map();
      ["#addBtn", "#importBtn", "#userBtn"].forEach(s => $(s).hidden = true);
      $("#tabs").innerHTML = "";
      $("#main").innerHTML = `<div class="empty"><h2>Your games, every store, one list</h2><p>Sign in with Google to sync between your phone and PC.</p><button class="btn" id="signIn">Sign in with Google</button><span class="status" id="signMsg"></span></div>`;
      $("#signIn").onclick = async () => {
        const prov = new GoogleAuthProvider();
        try { await signInWithPopup(auth, prov); }
        catch (e){ if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-environment") signInWithRedirect(auth, prov); else $("#signMsg").textContent = e.message; }
      };
      return;
    }
    uid = user.uid; col = collection(db, "users", uid, "games");
    ["#addBtn", "#importBtn", "#userBtn"].forEach(s => $(s).hidden = false);
    $("#userBtn").textContent = "Sign out";
    $("#userBtn").onclick = () => signOut(auth);
    loaded = false; render();
    unsub = onSnapshot(col, snap => {
      games = new Map(snap.docs.map(d => [d.id, {id: d.id, ...d.data()}]));
      $("#sync").textContent = snap.metadata.fromCache ? "offline" : "synced";
      loaded = true;
      if (!$("#dlg").open || !document.activeElement?.closest?.("dialog")) render();
      runQueue();
    }, e => { $("#main").innerHTML = `<div class="empty">Couldn't load your games: ${esc(e.message)}</div>`; });
  });
}
