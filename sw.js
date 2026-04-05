/* ============================================================
   THAILAND FOOD GUIDE — sw.js
   Service Worker: cache management + fetch routing
   ============================================================ */

'use strict';

const CACHE_NAME  = 'thailand-food-v9';
const PHOTO_CACHE = 'thailand-food-photos-v2';

// Static shell assets — pre-cached on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/styles-extra.css',
  '/app.js',
  '/config.js',
  '/state.js',
  '/utils.js',
  '/cache.js',
  '/location.js',
  '/data.js',
  '/map.js',
  '/cards.js',
  '/detail.js',
  '/filters.js',
  '/events.js',
  '/router.js',
  '/manifest.json',
  '/icon-180.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
];

/* ── Install ───────────────────────────────────────────────── */

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => {
        console.error('[sw] install cache failed:', err);
        return self.skipWaiting();
      })
  );
});

/* ── Activate ──────────────────────────────────────────────── */

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME && key !== PHOTO_CACHE)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch routing ─────────────────────────────────────────── */

const SUPABASE_HOST    = 'gfmjhirnywupfbfmflwn.supabase.co';
const SUPABASE_REST    = '/rest/v1/';
const SUPABASE_STORAGE = '/storage/v1/';

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url         = new URL(request.url);

  // 1. Google Maps — always network (tiles, API scripts)
  if (url.host.includes('googleapis.com') || url.host.includes('gstatic.com') || url.host.includes('google.com')) {
    event.respondWith(networkOnly(request));
    return;
  }

  // 2. Static shell — cache-first
  if (url.origin === self.location.origin ||
      url.host === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 3. Supabase Storage (photos) — network-only
  if (url.host === SUPABASE_HOST && url.pathname.startsWith(SUPABASE_STORAGE)) {
    event.respondWith(networkOnly(request));
    return;
  }

  // 4. Supabase REST API (data) — network-first
  if (url.host === SUPABASE_HOST && url.pathname.startsWith(SUPABASE_REST)) {
    event.respondWith(networkFirst(request, CACHE_NAME));
    return;
  }

  // 5. Default — network-first
  event.respondWith(networkFirst(request, CACHE_NAME));
});

/* ── Strategy helpers ──────────────────────────────────────── */

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    console.warn('[sw] cacheFirst network failed:', err);
    return new Response('Network error', { status: 503 });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('Offline', { status: 503 });
  }
}

async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch (err) {
    return new Response('', { status: 404 });
  }
}
