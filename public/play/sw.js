// Service worker for play/: makes the phone game work offline after the first load.
// Hashed build assets are cache-first; pages are network-first with the cache as fallback.
// No network calls of its own beyond what the page already requested.
const CACHE = 'joudbird-play-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

// The page sends the URLs its first load fetched (before this worker controlled it).
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'cache' || !Array.isArray(data.urls)) return;
  const urls = data.urls.filter((u) => typeof u === 'string' && u.startsWith(self.location.origin));
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        urls.map((u) =>
          cache.match(u).then((hit) => hit || fetch(u).then((res) => (res.ok ? cache.put(u, res) : undefined)).catch(() => undefined)),
        ),
      ),
    ),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  const isPage = req.mode === 'navigate';
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (isPage) {
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch {
          return (await cache.match(req, { ignoreSearch: true })) || Response.error();
        }
      }
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })(),
  );
});
