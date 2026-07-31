/* Offline cache for Pay Clock.

   The page itself is fetched NETWORK-FIRST: every launch tries the live site and falls
   back to the cached copy only when offline. Updates therefore arrive on the first
   open — no version churn, no two-open lag, and far less service-worker update
   activity, which iOS home-screen apps handle badly (rapid updates can crash-loop
   with "a problem repeatedly occurred").

   Static assets (icons, manifest) stay cache-first; they effectively never change. */
const CACHE = 'pay-clock-v13';
const ASSETS = ['./', './index.html', './manifest.webmanifest',
                './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const isPage = e.request.mode === 'navigate' ||
                 e.request.destination === 'document' ||
                 /(\/|index\.html)$/.test(new URL(e.request.url).pathname);

  if (isPage) {
    // Network first: fresh app every open; cache is purely the offline fallback.
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  // Assets: cache first, refresh quietly in the background.
  e.respondWith(
    caches.match(e.request).then(hit => {
      const live = fetch(e.request)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || live;
    })
  );
});
