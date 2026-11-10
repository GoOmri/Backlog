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
let q = "", platF = new Set(), statF = "", genreF = "", sort = "title";
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
const sale = g => g.status === "wishlist" && g.sale?.cut > 0 ? g.sale : null;

/* ---------- API (Cloudflare Worker) ---------- */
async function api(path, body){
  if (!API) throw new Error("Add your Worker address to config.js to load game info.");
  const r = await fetch(API + path, body ? {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)} : {});
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Data service answered " + r.status);
  return d;
}

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
    await upd(g.id, {...m, asTyped: g.asTyped || g.title, noMatch: false, hero: null, logo: null});
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
        if (!m){ // wider search (includes editions and DLC) before giving up
          const alt = await api("/search?q=" + encodeURIComponent(t)).catch(() => []);
          m = alt.find(r => key(r.title) === key(t)) || alt.find(r => key(r.title).startsWith(key(t))) || alt[0] || null;
        }
        if (m) await applyMatch(g, m); else await upd(g.id, {noMatch: true, noMatchAt: Date.now()});
      }
      done += batch.length;
    }
    await checkPrices();
    progress(0, 0);
  } catch (e){ progress(0, 0, e.message, true); }
  running = false;
}
async function checkPrices(force = false){
  const stale = list().filter(g => g.status === "wishlist" && (force || !g.sale || Date.now() - (g.sale.checked || 0) > 12 * 3600e3));
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
function badges(ps){ return (ps || []).map(p => { const v = PLAT[p] || PLAT.other; return `<span class="plat" style="background:var(${v[2]})" title="${v[0]}">${v[1]}</span>`; }).join(""); }
function coverTag(g){
  const s = sale(g), lv = leavingFor(g);
  if (g.noMatch) return `<span class="tag nomatch">No match</span>`;
  if (lv) return `<span class="tag leaving">Leaving P+</span>`;
  if (s) return `<span class="tag sale ${s.cut >= 50 ? "big" : ""}">−${s.cut}%</span>`;
  if (g.status === "playing") return `<span class="tag playing">Playing</span>`;
  if (g.status === "dropped") return `<span class="tag">Dropped</span>`;
  return "";
}
function coverHTML(g){
  return `<div class="cover">${g.cover ? `<img src="${esc(g.cover)}" alt="" loading="lazy">` : `<span class="ph">${esc(g.title)}</span>`}
    <span class="badges">${badges(g.platforms)}</span>${coverTag(g)}</div>`;
}
function cardHTML(g, sub){
  const right = g.myRating ? `<span class="stars">${"★".repeat(g.myRating)}</span>` : g.rating ? `<span class="score ${g.rating >= 80 ? "hi" : ""}">${g.rating}</span>` : "";
  return `<button class="card" data-edit="${g.id}">${coverHTML(g)}<span class="ctitle">${esc(g.title)}</span>
    <span class="csub"><span>${sub ?? (mainH(g) ? mainH(g) + "h" : g.year || "")}</span>${right}</span></button>`;
}
const rowHTML = (title, items, sub = "", subFn) => items.length ? `<section class="section wrap"><div class="row-head"><h3>${title}</h3><span class="dim">${sub}</span></div>
  <div class="row">${items.map(g => cardHTML(g, subFn?.(g))).join("")}</div></section>` : "";

/* ---------- home ---------- */
function heroGame(){
  const playing = list().filter(g => g.status === "playing").sort((a, b) => (b.touched || b.added || 0) - (a.touched || a.added || 0));
  return playing[0] || list().filter(g => g.status === "backlog" && g.igdbId).sort((a, b) => (b.rating || 0) - (a.rating || 0))[0] || null;
}
function heroHTML(g){
  if (!g) return "";
  if (g.igdbId && g.hero == null && !heroAsked.has(g.id)) fetchHero(g);
  const facts = [g.year, mainH(g) && `about ${mainH(g)}h`, g.steamHours && `${g.steamHours}h played`, g.rating && `Rating ${g.rating}`].filter(Boolean);
  return `<section class="hero"><div class="hero-bg">${g.hero || g.cover ? `<img src="${esc(g.hero || g.cover)}" alt="">` : ""}</div>
    <div class="hero-in">
      <span class="eyebrow">${g.status === "playing" ? "Continue playing" : "Up next for you"}</span>
      ${g.logo ? `<img class="hero-logo" src="${esc(g.logo)}" alt="${esc(g.title)}">` : `<h1 class="hero-title">${esc(g.title)}</h1>`}
      <div class="hero-facts"><span class="badges" style="position:static">${badges(g.platforms)}</span>${facts.map(f => `<span>${esc(f)}</span>`).join("")}</div>
      <div class="hero-actions">${g.status === "playing" ? `<button class="btn" data-finish="${g.id}">Mark finished</button>` : `<button class="btn" data-start="${g.id}">Start playing</button>`}
        <button class="btn ghost" data-edit="${g.id}">Details</button></div>
    </div></section>`;
}
const heroAsked = new Set();
async function fetchHero(g){
  heroAsked.add(g.id);
  try { const d = await api("/game?id=" + g.igdbId); await upd(g.id, {hero: d.hero || "", logo: d.logo || ""}); } catch {}
}
function homeHTML(){
  if (!games.size) return emptyHTML();
  const h = heroGame(), back = list().filter(g => g.status === "backlog");
  const playing = list().filter(g => g.status === "playing" && g !== h);
  const leaving = list().filter(g => leavingFor(g));
  const sales = list().filter(g => sale(g)).sort((a, b) => b.sale.cut - a.sale.cut);
  const short = back.filter(g => mainH(g) && mainH(g) < 10).sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 20);
  const best = back.filter(g => g.rating).sort((a, b) => b.rating - a.rating).slice(0, 20);
  const recent = list().filter(g => g.status !== "wishlist").sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 20);
  return heroHTML(h)
    + rowHTML("Also playing", playing)
    + rowHTML("Leaving PS Plus soon", leaving, "play these before they go")
    + rowHTML("On sale from your wishlist", sales, "PC stores", g => `${g.sale.price != null ? g.sale.price + " " + (g.sale.currency || "") : ""} ${g.sale.shop || ""}`)
    + pickHTML(back)
    + rowHTML("Short and great", short, "under 10 hours")
    + rowHTML("Best rated in your backlog", best)
    + rowHTML("Recently added", recent);
}
function pickHTML(back){
  const moods = topGenres(back, 12);
  const res = time || mood.size ? back.map(g => {
    const hit = genresOf(g).filter(t => mood.has(t)).length, timeOk = time && lenOf(mainH(g)) === time;
    return [g, hit * 3 + (timeOk ? 2 : 0) + (g.rating || 70) / 100 + Math.random() * .3, hit || timeOk];
  }).filter(r => r[2]).sort((a, b) => b[1] - a[1]).slice(0, 12).map(r => r[0]) : [];
  return `<section class="section wrap"><div class="panel">
    <h3>What should I play tonight?</h3>
    <div class="chips">${moods.map(t => `<button class="chip" aria-pressed="${mood.has(t)}" data-mood="${esc(t)}">${esc(t)}</button>`).join("")}</div>
    <div class="chips">${[["short","Under 10h"],["medium","10–30h"],["long","30h+"]].map(([k, l]) => `<button class="chip" aria-pressed="${time === k}" data-time="${k}">${l}</button>`).join("")}</div>
    ${res.length ? `<div class="row">${res.map(g => cardHTML(g)).join("")}</div>` : (time || mood.size) ? `<span class="why">Nothing in your backlog fits. Try fewer moods.</span>` : ""}
  </div></section>`;
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
  const scope = list().filter(g => wish ? g.status === "wishlist" : g.status !== "wishlist");
  const plats = Object.keys(PLAT).filter(p => scope.some(g => (g.platforms || []).includes(p)));
  const s = q.toLowerCase(), nom = scope.filter(g => g.noMatch).length;
  const shown = scope.filter(g => (!statF || g.status === statF)
    && (!platF.size || (g.platforms || []).some(p => platF.has(p)))
    && (!genreF || (genreF === "__nomatch" ? g.noMatch : genresOf(g).includes(genreF)))
    && (!s || g.title.toLowerCase().includes(s)));
  const by = {title: (a, b) => a.title.localeCompare(b.title), rating: (a, b) => (b.rating || 0) - (a.rating || 0), short: (a, b) => (mainH(a) || 999) - (mainH(b) || 999),
    added: (a, b) => (b.added || 0) - (a.added || 0), played: (a, b) => (b.steamHours || 0) - (a.steamHours || 0), sale: (a, b) => (b.sale?.cut || 0) - (a.sale?.cut || 0)};
  const srt = wish && sort === "title" ? "sale" : sort;
  shown.sort((a, b) => (srt === "title" ? (b.status === "playing") - (a.status === "playing") : 0) || by[srt](a, b));
  return `<div class="wrap"><div class="filters">
    <input id="q" type="search" autocomplete="off" placeholder="Search ${scope.length} games" value="${esc(q)}" aria-label="Search">
    ${wish ? "" : `<select id="statSel" aria-label="Status"><option value="">Any status</option>${["backlog","playing","done","dropped"].map(k => `<option value="${k}" ${statF === k ? "selected" : ""}>${STAT[k]}</option>`).join("")}</select>`}
    <select id="genreSel" aria-label="Genre"><option value="">All genres</option>${nom ? `<option value="__nomatch" ${genreF === "__nomatch" ? "selected" : ""}>Needs a match (${nom})</option>` : ""}${topGenres(scope, 40).map(t => `<option ${t === genreF ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
    <select id="sortSel" aria-label="Sort">${[["title", wish ? "Biggest discount" : "A–Z"], ["rating","Best rated"], ["short","Shortest"], ["added","Recently added"], ...(wish ? [] : [["played","Most played (Steam)"]])].map(([k, l]) => `<option value="${k}" ${k === sort ? "selected" : ""}>${l}</option>`).join("")}</select>
    <div class="chips">${plats.map(p => `<button class="chip" aria-pressed="${platF.has(p)}" data-plat="${p}"><span class="dot" style="background:var(${PLAT[p][2]})"></span>${PLAT[p][0]}</button>`).join("")}</div>
  </div><div class="grid">${shown.map(g => cardHTML(g, wish && g.sale?.cut ? `${g.sale.price ?? ""} ${g.sale.currency || ""}` : undefined)).join("") || `<div class="empty">Nothing matches these filters.</div>`}</div></div>`;
}

/* ---------- discover ---------- */
function discoverHTML(){
  const liked = list().filter(g => g.igdbId && (g.myRating >= 4 || (g.status === "done" && !g.myRating) || g.status === "playing"));
  if (!liked.length) return `<div class="empty wrap"><h2>Rate a few games first</h2><p>Mark games Finished and give them stars. Discover suggests games similar to the ones you rate 4–5.</p></div>`;
  if (discovered === null){ runDiscover(liked); return `<div class="empty wrap">Finding games like the ${liked.length} you enjoyed…</div>`; }
  if (discovered.error) return `<div class="empty wrap">${esc(discovered.error)}</div>`;
  return `<div class="wrap"><div class="section"><div class="row-head"><h3>Because you liked…</h3><button class="btn ghost small" data-act="rediscover">Refresh</button></div>
    <div class="grid">${discovered.map((d, i) => `<div class="card">${coverHTML({...d, platforms: [], status: "wishlist"})}
      <span class="ctitle">${esc(d.title)}</span><span class="why">Like ${esc(d.because.join(", "))}</span>
      <span class="csub"><span>${d.ttb?.main ? d.ttb.main + "h" : d.year || ""}</span>${d.rating ? `<span class="score ${d.rating >= 80 ? "hi" : ""}">${d.rating}</span>` : ""}</span>
      <button class="btn ghost small" data-wish="${i}" ${d.added ? "disabled" : ""}>${d.added ? "On wishlist" : "+ Wishlist"}</button></div>`).join("")}</div></div></div>`;
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
function openSheet(html){ $("#sheet").innerHTML = html; if (!$("#dlg").open) $("#dlg").showModal(); }
function closeSheet(){ $("#dlg").close(); }
function note(t){ openSheet(`<p>${esc(t)}</p><div class="actions"><button class="btn" data-act="close">OK</button></div>`); }
const platOpts = sel => Object.entries(PLAT).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${v[0]}</option>`).join("");
const statOpts = sel => Object.entries(STAT).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${v}</option>`).join("");

function menuSheet(){
  openSheet(`<h2>Backlog</h2><div class="menu">
    <button data-act="steam">Import from Steam<small>Adds your Steam games with hours played</small></button>
    <button data-act="import">Import a file<small>The export from the old Backlog</small></button>
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
async function editSheet(id){
  const g = games.get(id); if (!g) return;
  let status = g.status, plats = new Set(g.platforms || []), stars = g.myRating || 0;
  const s = sale(g), lv = leavingFor(g), toDate = t => t ? new Date(t).toISOString().slice(0, 10) : "";
  openSheet(`<div class="sheet-hero">${g.hero || g.cover ? `<img src="${esc(g.hero || g.cover)}" alt="">` : ""}</div>
    <div class="sheet-head">${coverHTML({...g, platforms: [], sale: null, status: "backlog", noMatch: false})}<div><h2>${esc(g.title)}</h2>
      <div class="facts">${[g.year, g.ttb?.main && `${g.ttb.main}h main`, g.ttb?.full && `${g.ttb.full}h 100%`, g.steamHours != null && `${g.steamHours}h played`, g.rating && `Rating ${g.rating}`].filter(Boolean).map(f => `<span>${esc(f)}</span>`).join("")}<span id="devs"></span></div></div></div>
    ${s ? `<div class="note ${s.cut >= 50 ? "hot" : ""}"><b>−${s.cut}%</b> · ${esc(s.price ?? "")} ${esc(s.currency || "")} at ${esc(s.shop || "a PC store")} ${s.url ? `· <a href="${esc(s.url)}" target="_blank" rel="noopener">Open deal</a>` : ""}</div>` : ""}
    ${lv ? `<div class="note warn">Probably leaving PS Plus soon. <a href="${esc(lv.url)}" target="_blank" rel="noopener">${esc(lv.title)}</a></div>` : ""}
    <div class="desc" id="desc">${g.igdbId ? "Loading…" : g.noMatch ? "No match found yet. Use Fix match below." : ""}</div>
    <div class="chips">${genresOf(g).map(t => `<span class="chip">${esc(t)}</span>`).join("")}</div>
    <div class="field"><span class="label">List</span><div class="chips">${Object.entries(STAT).map(([k, v]) => `<button class="chip" aria-pressed="${status === k}" data-setstat="${k}">${v}</button>`).join("")}</div></div>
    <div class="grid2"><div class="field"><span class="label">Your rating</span><div class="starpick">${[1,2,3,4,5].map(n => `<button data-star="${n}" class="${n <= stars ? "on" : ""}" aria-label="${n} stars">★</button>`).join("")}</div></div>
      <div class="field" id="finField" ${status === "done" ? "" : "hidden"}><label class="label" for="finDate">Finished on</label><input type="date" id="finDate" value="${toDate(g.finishedAt) || toDate(Date.now())}"></div></div>
    <div class="field"><span class="label">Platforms</span><div class="chips">${Object.entries(PLAT).map(([k, v]) => `<button class="chip" aria-pressed="${plats.has(k)}" data-setplat="${k}"><span class="dot" style="background:var(${v[2]})"></span>${v[0]}</button>`).join("")}</div></div>
    <details><summary class="label">Wrong game? Fix match</summary><div class="field" style="margin-top:8px"><div class="chips"><input id="fix" value="${esc(g.asTyped || g.title)}" style="flex:1"><button class="btn ghost small" id="fixGo">Search</button></div><div class="matches" id="matches"></div></div></details>
    <div class="actions"><button class="btn ghost danger" id="eDel" style="margin-right:auto">Delete</button><button class="btn ghost" data-act="close">Cancel</button><button class="btn" id="eSave">Save</button></div>`);
  const sh = $("#sheet");
  sh.querySelectorAll("[data-setstat]").forEach(b => b.onclick = () => { status = b.dataset.setstat; sh.querySelectorAll("[data-setstat]").forEach(x => x.setAttribute("aria-pressed", x === b)); $("#finField").hidden = status !== "done"; });
  sh.querySelectorAll("[data-setplat]").forEach(b => b.onclick = () => { const p = b.dataset.setplat; plats.has(p) ? plats.delete(p) : plats.add(p); b.setAttribute("aria-pressed", plats.has(p)); });
  sh.querySelectorAll("[data-star]").forEach(b => b.onclick = () => { stars = +b.dataset.star === stars ? 0 : +b.dataset.star; sh.querySelectorAll("[data-star]").forEach(x => x.classList.toggle("on", +x.dataset.star <= stars)); });
  $("#eSave").onclick = async () => {
    const d = {status, platforms: [...plats], myRating: stars || null, touched: Date.now()};
    d.finishedAt = status === "done" ? (Date.parse($("#finDate").value) || Date.now()) : null;
    await upd(id, d); closeSheet();
  };
  let armed = false;
  $("#eDel").onclick = async () => { if (!armed){ armed = true; $("#eDel").textContent = "Tap again to delete"; return; } await del(id); closeSheet(); };
  $("#fixGo").onclick = async () => {
    const box = $("#matches"); box.textContent = "Searching…";
    try {
      const res = await api("/search?q=" + encodeURIComponent($("#fix").value));
      box.innerHTML = res.map((r, i) => `<button class="match" data-m="${i}">${r.cover ? `<img src="${esc(r.cover)}" alt="">` : "<span></span>"}<span><b>${esc(r.title)}</b><br><span class="why">${r.year || ""} · ${esc(r.genres.join(", "))}</span></span></button>`).join("") || "No results.";
      box.querySelectorAll("[data-m]").forEach(b => b.onclick = async () => { await applyMatch({...g, status, platforms: [...plats]}, res[+b.dataset.m]); closeSheet(); });
    } catch (e){ box.textContent = e.message; }
  };
  if (g.igdbId){
    try {
      const d = await api("/game?id=" + g.igdbId);
      if ($("#dlg").open && $("#desc")){ $("#desc").textContent = d.summary || "No description."; $("#devs").textContent = d.developers.join(", "); }
      if (!g.hero && d.hero) upd(id, {hero: d.hero, logo: d.logo || ""});
    } catch (e){ if ($("#desc")) $("#desc").textContent = e.message; }
  }
}

/* ---------- events ---------- */
document.addEventListener("click", async e => {
  const t = e.target.closest("button"); if (!t) return;
  const d = t.dataset;
  if (d.tab){ tab = d.tab; platF.clear(); statF = ""; genreF = ""; q = ""; sort = "title"; render(); scrollTo(0, 0); }
  else if (d.plat){ platF.has(d.plat) ? platF.delete(d.plat) : platF.add(d.plat); render(); }
  else if (d.mood){ mood.has(d.mood) ? mood.delete(d.mood) : mood.add(d.mood); render(); }
  else if (d.time){ time = time === d.time ? "" : d.time; render(); }
  else if (d.edit) editSheet(d.edit);
  else if (d.finish){ await upd(d.finish, {status: "done", finishedAt: Date.now(), touched: Date.now()}); editSheet(d.finish); }
  else if (d.start) await upd(d.start, {status: "playing", touched: Date.now()});
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
  if (id === "sortSel"){ sort = e.target.value; render(); }
  if (id === "importFile" && e.target.files[0]){ importFile(e.target.files[0]); e.target.value = ""; }
});
$("#dlg").addEventListener("close", () => render());
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
