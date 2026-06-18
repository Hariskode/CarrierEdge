// CarrierEdge Service Worker
// Cache-first for the app shell; network-first for external resources.
// Version bump here forces old caches to evict on next visit.
const CACHE = 'carrieredge-v1';

const SHELL = [
  './index.html',
  './manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Only handle same-origin GETs (don't intercept Anthropic/EIA/FMCSA calls).
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Cache-first for the shell; stale-while-revalidate keeps it fresh.
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res.ok) {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      }).catch(() => null);
      return cached || network;
    })
  );
});
