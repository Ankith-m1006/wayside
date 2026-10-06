// Offline shell: the app opens with no signal; finds are saved on the phone and
// identified when the connection comes back. API calls always go to the network.
const CACHE = "wayside-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  // Network first for the app itself (fresh when online), cache fallback when offline;
  // fonts, Leaflet and map tiles are cached as they are used.
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok && (url.origin === location.origin || /unpkg\.com|fonts\.(googleapis|gstatic)\.com|tile\.openstreetmap\.org/.test(url.host))) {
      const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy));
    }
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || (e.request.mode === "navigate" ? caches.match("/index.html") : undefined))));
});
