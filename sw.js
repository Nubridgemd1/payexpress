/* PayExpress service worker — app-shell cache for offline + installability. */
const CACHE = 'payexpress-v12';
const SHELL = [
  './',
  './index.html',
  './terms.html',
  './privacy.html',
  './refunds.html',
  './legal.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Navigations:
  if (req.mode === 'navigate') {
    // Admin console is a separate page — never serve the customer app shell for it.
    if (url.pathname.indexOf('admin') !== -1) {
      e.respondWith(fetch(req).catch(() => caches.match(req)));
      return;
    }
    // Customer app: network-first so content updates reach users immediately;
    // keep the cached shell fresh and fall back to it only when offline.
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put('./index.html', copy));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  if (url.origin === location.origin) {
    // Same-origin assets: cache-first, then update the cache in the background.
    e.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => cached))
    );
  } else {
    // Cross-origin (fonts, backend/API): network-first, fall back to any cached copy.
    e.respondWith(fetch(req).catch(() => caches.match(req)));
  }
});
