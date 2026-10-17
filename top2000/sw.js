// Dutch 2000 — service worker (offline support for the installed app).
//
// Scope is this folder only, so it never touches the app published at the site
// root. Every same-origin GET is network-first: online, you always get what's
// deployed; each good response is cached, so the app still opens offline. If
// the network is merely slow, a cached copy is used after a few seconds while
// the fresh one finishes downloading in the background.
//
// The first version served js/css cache-first behind a ?v=N query that was
// never bumped, so installed copies kept running launch-day code. Network-first
// means a release no longer depends on remembering a version bump. Cross-origin
// requests (the GitHub API used for sync) are never touched.

const CACHE_NAME = 'dutch-top2000-v3';
const SLOW_NETWORK_MS = 4000;
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=3',
  './js/storage.js?v=3',
  './js/srs.js?v=3',
  './js/data.js?v=3',
  './js/speech.js?v=3',
  './js/sync.js?v=3',
  './js/ui.js?v=3',
  './js/study.js?v=3',
  './js/app.js?v=3',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

// Precache one file at a time and ignore misses: with addAll a single missing
// file fails the whole install, and a worker that can't install leaves the old
// one in charge indefinitely.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url))))
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
  const key = req.mode === 'navigate' ? './index.html' : req;

  const fromCache = () => caches.match(key).then((cached) => {
    if (cached) return cached;
    if (req.mode === 'navigate') return caches.match('./index.html');
    // Offline and never cached: answer a missing batch as "not found" so batch
    // discovery stops cleanly instead of throwing.
    if (isData) return new Response('', { status: 404, statusText: 'Not cached' });
    return Response.error();
  });

  // 'no-cache' revalidates with the server instead of trusting the browser's
  // HTTP cache (GitHub Pages says max-age=600): an unchanged file costs a 304,
  // a changed one arrives on this open rather than ten minutes later.
  // Navigations can't be re-wrapped in a new Request, and already revalidate.
  const fresh = req.mode === 'navigate' ? req : new Request(req, { cache: 'no-cache' });
  const network = fetch(fresh).then((res) => {
    if (res && res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(key, copy));
    }
    return res;
  });

  // Network first; on a slow connection fall back to a cached copy if there is
  // one (the network request still completes and refreshes the cache).
  const slow = new Promise((resolve) => setTimeout(resolve, SLOW_NETWORK_MS))
    .then(() => caches.match(key))
    .then((cached) => cached || network)
    .catch(fromCache);                       // never leave a rejection dangling

  event.respondWith(Promise.race([network, slow]).catch(fromCache));
});
