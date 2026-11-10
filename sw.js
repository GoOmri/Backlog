// Backlog service worker: serves the app shell from cache for an instant open,
// then refreshes it in the background (stale-while-revalidate).
// A new deploy shows up on the open after next. Bump V to force-clear old caches.
const V = "shell-v1";
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
  if (r.mode === "navigate" && u.origin === location.origin){ e.respondWith(swr(e, "index.html")); return; }
  if (cacheable(u)) e.respondWith(swr(e, r));
});

async function swr(e, key){
  const c = await caches.open(V);
  const hit = await c.match(key);
  const net = fetch(e.request).then(res => { if (res.ok) c.put(key, res.clone()); return res; });
  if (hit){ e.waitUntil(net.catch(() => {})); return hit; }
  return net;
}
