/* Offline cache for Pay Clock.
   Serve from cache immediately so it opens instantly with no signal, then refresh the
   cache in the background so the next launch has any update. */
const CACHE = 'pay-clock-v7';
const ASSETS = ['./', './index.html', './manifest.webmanifest',
                './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'];

/* If the page fails to render (blank blue), force-reload once after 3s.
   This breaks the "stuck on old cache" loop without user intervention. */
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
        .catch(() => hit);        // offline: whatever we already have
      return hit || live;
    })
  );
});
