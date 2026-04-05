/* ============================================================
   THAILAND FOOD GUIDE — sw.js
   Service Worker: cache management + fetch routing
   Spec: docs/design/FEATURE_SPECS.md — Feature 10
   ============================================================ */

'use strict';

const CACHE_NAME  = 'thailand-food-v3';
const PHOTO_CACHE = 'thailand-food-photos-v2';

// Static shell assets — pre-cached on install
// Supabase JS client and Leaflet CDN are included (versioned URLs are stable)
// Google Fonts excluded — UA-dependent dynamic responses; served via network-first fallback
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icon-180.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
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
        // skipWaiting even if some CDN assets fail — app still works online
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
// Spec: docs/design/FEATURE_SPECS.md — Feature 10
//
// Strategy map:
//   Static shell (CSS, JS, HTML, icons) → cache-first
//   Supabase REST API (/rest/v1/)        → network-first, fall back to cache
//   Supabase Storage (/storage/v1/)      → network-only (photos)
//   Everything else                      → network-first, fall back to cache

const SUPABASE_HOST    = 'gfmjhirnywupfbfmflwn.supabase.co';
const SUPABASE_REST    = '/rest/v1/';
const SUPABASE_STORAGE = '/storage/v1/';

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url         = new URL(request.url);

  // ── 1. Static shell — cache-first ───────────────────────────
  if (url.origin === self.location.origin ||
      url.host === 'unpkg.com' ||
      url.host === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirst(request));
    return;
  }

  // ── 2. Supabase Storage (photos) — network-only ─────────────
  if (url.host === SUPABASE_HOST && url.pathname.startsWith(SUPABASE_STORAGE)) {
    event.respondWith(networkOnly(request));
    return;
  }

  // ── 3. Supabase REST API (data) — network-first ─────────────
  if (url.host === SUPABASE_HOST && url.pathname.startsWith(SUPABASE_REST)) {
    event.respondWith(networkFirst(request, CACHE_NAME));
    return;
  }

  // ── 4. Default — network-first ──────────────────────────────
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
    // Photos fail gracefully — return 404 so <img> shows broken placeholder
    return new Response('', { status: 404 });
  }
}
