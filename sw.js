// Bump this on every deploy so old caches get cleared.
const CACHE_NAME = 'slopewatch-v5';
const CORE_ASSETS = [
  './',
  './index.html',
  './relay.html',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first for everything we control. This is what makes airplane mode work:
// once the shell is cached, no network call is required to load the app.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response.ok && event.request.url.startsWith(self.location.origin)) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached || new Response('Offline', { status: 503, statusText: 'Service Unavailable' }));
    })
  );
});

// Background Sync (Chrome/Android only — Safari/iOS has no Background Sync API,
// so app.js also does a manual "sync on app open / on online event" fallback).
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-reports') {
    event.waitUntil(self.clients.matchAll().then((clients) => {
      clients.forEach((c) => c.postMessage({ type: 'TRY_SYNC' }));
    }));
  }
});
