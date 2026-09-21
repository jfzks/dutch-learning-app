// Dutch 2000 — service worker (offline support for the installed app).
//
// Scope is this folder only, so it never touches the app published at the site
// root. Strategy:
//   - navigations and data/*.json → network-first, falling back to the cache
//     when offline. New batch files therefore show up as soon as they're
//     deployed instead of being pinned to an old copy.
//   - everything else (versioned js/css, icons) → cache-first; the ?v=N query
//     busts them on release.
// Bump CACHE_NAME whenever the shell changes so stale caches are dropped.

const CACHE_NAME = 'dutch-top2000-v1';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=1',
  './js/storage.js?v=1',
  './js/srs.js?v=1',
  './js/data.js?v=1',
  './js/speech.js?v=1',
  './js/ui.js?v=1',
  './js/study.js?v=1',
  './js/app.js?v=1',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isData = url.pathname.includes('/data/') && url.pathname.endsWith('.json');

  // Network-first for pages and word data.
  if (req.mode === 'navigate' || isData) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            const key = req.mode === 'navigate' ? './index.html' : req;
            caches.open(CACHE_NAME).then((cache) => cache.put(key, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((cached) => {
          if (cached) return cached;
          if (req.mode === 'navigate') return caches.match('./index.html');
          // Offline and never cached: answer a missing batch as "not found" so
          // batch discovery stops cleanly instead of throwing.
          return new Response('', { status: 404, statusText: 'Not cached' });
        }))
    );
    return;
  }

  // Cache-first for the versioned shell.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});
