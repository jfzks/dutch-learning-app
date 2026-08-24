// Dutch flashcards — service worker.
//
// Strategy:
//   - Navigations / HTML  → network-first (fall back to cache when offline).
//     This is what stops an old app version from being pinned forever: the
//     page is always re-fetched when online, so a fresh deploy shows up on the
//     next load instead of being served from a stale cache.
//   - Versioned static assets (?v=N) and other GETs → cache-first (fast; the
//     ?v query busts them on each release).
// Bump CACHE_NAME whenever the app shell changes so old caches are evicted.

const CACHE_NAME = 'dutch-app-2026-08-24-v9';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=8',
  './app.js?v=8',
  './data.js?v=8',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

// On install: pre-cache the app shell, then activate immediately.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

// On activate: drop any old caches and take control of open pages at once.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Network-first for page navigations so new deploys are picked up promptly.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  // Cache-first for everything else (assets are versioned via ?v=N).
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
