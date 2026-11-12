// Backlog service worker.
// App files (same origin): network first, bypassing the browser's HTTP cache, so a push shows on the next open;
// falls back to the cached copy when offline or the network takes over 3s.
// Fonts + pinned Firebase SDK never change: cache first. Bump V to force-clear old caches.
const V = "shell-v4";
const SHELL = ["index.html", "app.js", "style.css", "config.js", "manifest.webmanifest", "icon-192.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Same-origin shell files, Google Fonts, and the pinned Firebase SDK. Everything else (worker API, Firestore, images) goes straight to the network.
const cacheable = u => (u.origin === location.origin && !u.search) ||
  u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com" ||
  (u.hostname === "www.gstatic.com" && u.pathname.startsWith("/firebasejs/"));

self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (r.mode === "navigate" && u.origin === location.origin){ e.respondWith(fresh(r, "index.html")); return; }
  if (u.origin === location.origin && !u.search) e.respondWith(fresh(r, r));
  else if (cacheable(u)) e.respondWith(swr(e, r));
});

async function fresh(req, key){
  const c = await caches.open(V);
  const net = fetch(req.url, {cache: "no-cache"}).then(res => { if (res.ok) c.put(key, res.clone()); return res; });
  const slow = new Promise(ok => setTimeout(ok, 3000)).then(() => c.match(key));
  try { return (await Promise.race([net, slow])) || await net; }
  catch { return (await c.match(key)) || Response.error(); }
}

async function swr(e, key){
  const c = await caches.open(V);
  const hit = await c.match(key);
  const net = fetch(e.request).then(res => { if (res.ok) c.put(key, res.clone()); return res; });
  if (hit){ e.waitUntil(net.catch(() => {})); return hit; }
  return net;
}
