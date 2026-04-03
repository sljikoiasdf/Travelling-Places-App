/* ============================================================
   SERVICE WORKER — Food Guide PWA
   Cache version: bump this to force a refresh after deploy
   ============================================================ */
const CACHE_NAME    = 'food-guide-v1';
const FONT_CACHE    = 'food-guide-fonts-v1';

// Static assets to pre-cache on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icon-180.png',
  '/icon-192.png',
  '/icon-512.png',
];

// External scripts to pre-cache
const EXTERNAL_SCRIPTS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
];

// Google Fonts CSS URL (cached separately so font files can be cached dynamically)
const FONTS_CSS_URL =
  'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=DM+Sans:wght@400;500;600&family=Noto+Sans+Thai:wght@400;500;600&display=swap';

/* ============================================================
   INSTALL — pre-cache static assets
   ============================================================ */
self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      // Cache static app assets
      caches.open(CACHE_NAME).then(cache =>
        cache.addAll(STATIC_ASSETS).catch(() => {
          // Fail gracefully — some may 404 in dev
        })
      ),
      // Cache external scripts
      caches.open(CACHE_NAME).then(cache =>
        Promise.allSettled(
          EXTERNAL_SCRIPTS.map(url => cache.add(url))
        )
      ),
      // Cache Google Fonts CSS
      caches.open(FONT_CACHE).then(cache =>
        fetch(FONTS_CSS_URL)
          .then(res => cache.put(FONTS_CSS_URL, res))
          .catch(() => {})
      ),
    ]).then(() => self.skipWaiting())
  );
});

/* ============================================================
   ACTIVATE — clean up old caches
   ============================================================ */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== FONT_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ============================================================
   FETCH — routing strategy
   ============================================================ */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // ── Supabase API: always network-first (fresh data)
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // ── Photos: network-only (no caching — 50MB iOS limit)
  if (
    url.pathname.includes('/storage/v1/object/') ||
    url.hostname.includes('images.') ||
    /\.(jpg|jpeg|png|webp|gif|avif)$/i.test(url.pathname)
  ) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response('', { status: 503, statusText: 'Offline' })
      )
    );
    return;
  }

  // ── Google Fonts CSS + woff2: cache-first
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    event.respondWith(cacheFirst(request, FONT_CACHE));
    return;
  }

  // ── External scripts (Leaflet, Supabase JS): cache-first
  if (
    url.hostname === 'unpkg.com' ||
    url.hostname === 'cdn.jsdelivr.net'
  ) {
    event.respondWith(cacheFirst(request, CACHE_NAME));
    return;
  }

  // ── Everything else (HTML, CSS, JS, icons, manifest): cache-first
  event.respondWith(cacheFirst(request, CACHE_NAME));
});

/* ============================================================
   STRATEGY HELPERS
   ============================================================ */

// Cache-first: serve from cache, fallback to network + store
async function cacheFirst(request, cacheName) {
  const cache    = await caches.open(cacheName);
  const cached   = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

// Network-first: try network, fallback to cache
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}
