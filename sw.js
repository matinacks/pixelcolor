/* ============================================================
   Service Worker — офлайн-режим и обновления
   Стратегии:
     • HTML / manifest — network-first → cache → fallback
     • JS/CSS/иконки — stale-while-revalidate
   Поднимайте CACHE_VERSION при каждом деплое.
   ============================================================ */

const CACHE_VERSION = 'v4';
const CACHE_STATIC  = 'pixelcolor-static-' + CACHE_VERSION;
const CACHE_RUNTIME = 'pixelcolor-runtime-' + CACHE_VERSION;

const PRECACHE_URLS = [
  './',
  './index.html',
  './shared.css',
  './shared.js',
  './levels.js',
  './community.js',       // ← новая строка
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-maskable.svg',
];

const OFFLINE_FALLBACK = './index.html';

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    const cache = await caches.open(CACHE_STATIC);
    await Promise.allSettled(
      PRECACHE_URLS.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' }));
      })
    );
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(function (k) { return k !== CACHE_STATIC && k !== CACHE_RUNTIME; })
        .map(function (k) { return caches.delete(k); })
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/__') || url.protocol === 'chrome-extension:') return;

  const isNavigate = req.mode === 'navigate';
  const isManifest = url.pathname.endsWith('/manifest.json');
  const isHtml = isNavigate || url.pathname.endsWith('.html');

  if (isHtml || isManifest) {
    event.respondWith(networkFirst(req, isNavigate ? OFFLINE_FALLBACK : null));
    return;
  }
  event.respondWith(staleWhileRevalidate(req));
});

async function networkFirst(req, offlineFallback) {
  const cache = await caches.open(CACHE_STATIC);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone()).catch(function () {});
    return fresh;
  } catch (_) {
    const cached = await cache.match(req);
    if (cached) return cached;
    if (offlineFallback) {
      const fb = await cache.match(offlineFallback);
      if (fb) return fb;
    }
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_RUNTIME);
  const cached = await cache.match(req);

  const networkPromise = fetch(req)
    .then(function (res) {
      if (res && res.ok) cache.put(req, res.clone()).catch(function () {});
      return res;
    })
    .catch(function () { return null; });

  if (cached) return cached;

  const fresh = await networkPromise;
  if (fresh) return fresh;
  return new Response('', { status: 504, statusText: 'Offline' });
}

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});