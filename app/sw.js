// Dutch learning tool — minimal service worker.
// Strategy: cache-first for app shell, network-first for everything else.
// Bump CACHE_NAME whenever app shell files change so old caches get evicted.

const CACHE_NAME = 'dutch-app-2026-05-02-v1';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js?v=5',
  './data.js?v=5',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

// On install: pre-cache the app shell so the app boots offline immediately.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

// On activate: drop any old caches that don't match the current name.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: try cache first, then network. Cache successful network responses for next time.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle same-origin GET requests; skip everything else (e.g. speech synthesis, analytics).
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // Only cache valid 200 responses
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => {
        // Offline & not cached — fall back to index.html for navigations
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
