// Service worker. Core files are cached one by one (a single failed fetch no longer aborts installation).
// HTML: network-first (so updates arrive), everything else: stale-while-revalidate.
// Bump VERSION whenever any cached file changes.
const VERSION = 'zuma3d-v2.0.5';
const CORE = ['./zuma3d-android.html', './main.js', './core.js', './view.js', './render.js', './quality.js', './diag.js', './audio.js', './storage.js', './manifest.json', './icon-192.png', './icon-512.png'];
const OPTIONAL = ['./vendor/three.module.js'];          // present only if you ran fetch-three.sh
const THREE_CDN = 'https://unpkg.com/three@0.160.0/build/three.module.js';

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.all(CORE.map(u => cache.add(u).catch(() => {})));
    await Promise.all(OPTIONAL.map(u => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && req.url !== THREE_CDN) return;
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try { const res = await fetch(req); if (res.ok) cache.put(req, res.clone()); return res; }
      catch { return (await cache.match(req, { ignoreSearch: true })) || (await cache.match('./zuma3d-android.html')) || Response.error(); }
    })());
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    if (cached) { net.catch(() => {}); return cached; }
    return (await net) || Response.error();
  })());
});
