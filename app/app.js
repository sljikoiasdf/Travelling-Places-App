/* ============================================================
   THAILAND FOOD GUIDE — app.js
   PWA for iPhone, Safari homescreen install
   Vanilla JS — no framework, no build step
   ============================================================ */

'use strict';

/* ── Supabase client ───────────────────────────────────────── */
const SUPABASE_URL = 'https://gfmjhirnywupfbfmflwn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmbWpoaXJueXd1cGZiZm1mbHduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjkyNDcsImV4cCI6MjA5MDc0NTI0N30.G51aTZpeVmu3hcQxZGTF4chQUUcs4DRKG8D_AAH0Adk';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ── App config ────────────────────────────────────────────── */
const CONFIG = {
  mapDefaultLat:  13.7563,              // Bangkok centre
  mapDefaultLng:  100.5018,
  mapDefaultZoom: 12,
  mapPinZoom:     15,
  cacheVersion:   'v1',
  cacheTTL:       24 * 60 * 60 * 1000, // 24 hours in ms
  timezone:       'Asia/Bangkok',
  nearbyRadiusM:  2000,
  nearbyLimit:    50,
};

/* ── App state ─────────────────────────────────────────────── */
const state = {
  restaurants:   [],        // full list from Supabase/cache
  filtered:      [],        // current filtered subset
  activeFilters: {},        // { city, cuisine, price_range, open_now }
  activeView:    'list',    // 'list' | 'map'
  selectedId:    null,      // restaurant id with open bottom sheet
  map:           null,      // Leaflet map instance
  mapPins:       new Map(), // id → Leaflet marker
  personalData:  new Map(), // restaurant_id → { is_wishlisted, is_visited, my_rating }
  personalId:    null,      // device UUID from localStorage
  isLoading:     false,
};

/* ── DOM refs ──────────────────────────────────────────────── */
const dom = {
  app:            document.getElementById('app'),
  appContent:     document.getElementById('app-content'),
  viewList:       document.getElementById('view-list'),
  viewMap:        document.getElementById('view-map'),
  cardList:       document.getElementById('card-list'),
  skeletonList:   document.getElementById('skeleton-list'),
  filterChips:    document.getElementById('filter-chips'),
  emptyState:     document.getElementById('empty-state'),
  navList:        document.getElementById('nav-list'),
  navMap:         document.getElementById('nav-map'),
  navBar:         document.getElementById('nav-bar'),
  bottomSheet:    document.getElementById('bottom-sheet'),
  sheetBackdrop:  document.getElementById('sheet-backdrop'),
  sheetContent:   document.getElementById('sheet-content'),
  toastContainer: document.getElementById('toast-container'),
  mapContainer:   document.getElementById('map'),
};

/* ============================================================
   INDEXEDDB CACHE — STEP_26
   Spec: docs/design/FEATURE_SPECS.md — Feature 10
   Strategy: cache-first for restaurant list; TTL = 24h
   ============================================================ */

const IDB_NAME    = 'thailand-food';
const IDB_VERSION = 1;
const IDB_STORE   = 'cache';
const CACHE_KEY   = 'restaurants_v1';

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function getCached(key) {
  try {
    const idb  = await openIDB();
    const data = await new Promise((resolve, reject) => {
      const tx  = idb.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror   = (e) => reject(e.target.error);
    });
    if (!data) return null;
    if (Date.now() - data.timestamp > CONFIG.cacheTTL) return null; // expired
    return data.value;
  } catch (err) {
    console.warn('[cache] getCached failed:', err);
    return null;
  }
}

async function setCached(key, value) {
  try {
    const idb = await openIDB();
    await new Promise((resolve, reject) => {
      const tx  = idb.transaction(IDB_STORE, 'readwrite');
      const req = tx.objectStore(IDB_STORE).put({ value, timestamp: Date.now() }, key);
      req.onsuccess = resolve;
      req.onerror   = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.warn('[cache] setCached failed:', err);
    // Non-fatal — app continues without caching
  }
}

/* ============================================================
   DATA FETCH — STEP_27
   Spec: docs/design/FEATURE_SPECS.md — Feature 10
   NOTE: nearby_restaurants RPC not used — all restaurants are
   area_only (location_precision='area_only'); it returns 0 rows.
   ============================================================ */

async function fetchRestaurants() {
  state.isLoading = true;
  renderLoadingState();

  // 1. Try cache first (serves data in <500ms on warm cache)
  const cached = await getCached(CACHE_KEY);
  if (cached) {
    state.restaurants = cached;
    state.filtered    = cached;
    renderList(state.filtered);
    buildFilterChips();
    state.isLoading = false;
    // Background refresh so next load is fresh
    refreshFromNetwork().catch(() => {});
    return;
  }

  // 2. Cache miss — fetch from Supabase
  await refreshFromNetwork();
}

async function refreshFromNetwork() {
  try {
    const { data, error } = await db
      .from('restaurants')
      .select([
        'id', 'name_th', 'name_en', 'slug', 'city', 'area',
        'lat', 'lng', 'location_precision',
        'cuisine_types', 'price_range',
        'opening_hours', 'phone', 'website',
        'photos', 'description_en', 'description_th',
        'is_halal', 'is_vegetarian_friendly',
        'michelin_stars', 'michelin_bib',
      ].join(', '))
      .order('name_en', { ascending: true });

    if (error) throw error;

    state.restaurants = data || [];
    state.filtered    = state.restaurants;
    state.isLoading   = false;

    await setCached(CACHE_KEY, state.restaurants);
    renderList(state.filtered);
    buildFilterChips();

  } catch (err) {
    console.error('[fetch] refreshFromNetwork failed:', err);
    state.isLoading = false;

    if (state.restaurants.length === 0) {
      showToast('Could not load restaurants. Check your connection.', 'error');
      dom.emptyState.hidden = false;
      dom.cardList.hidden   = true;
    } else {
      showToast('Using saved data — could not refresh.', 'error');
      renderList(state.filtered);
    }
  }
}

function renderLoadingState() {
  // Show skeleton cards from index.html; hide real list
  if (dom.skeletonList) dom.skeletonList.hidden = false;
  if (dom.cardList)     dom.cardList.hidden     = true;
  if (dom.emptyState)   dom.emptyState.hidden   = true;
}

/* ── Personal data (Supabase personal_data table) ─────────── */
// device_id is a UUID generated once per device and stored in localStorage.
// This is the sole auth mechanism — no login required (per SCHEMA_GUIDE.md).

function getOrCreatePersonalId() {
  let id = localStorage.getItem('personal_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('personal_id', id);
  }
  return id;
}

async function loadPersonalData() {
  if (!state.personalId) return;
  try {
    const { data } = await db
      .from('personal_data')
      .select('restaurant_id, is_wishlisted, is_visited, my_rating')
      .eq('device_id', state.personalId);

    if (data) {
      state.personalData.clear();
      data.forEach(row => state.personalData.set(row.restaurant_id, row));
    }
  } catch (err) {
    console.warn('[personal] loadPersonalData failed:', err);
  }
}

async function upsertPersonalData(restaurantId, updates) {
  if (!state.personalId) return;
  const current = state.personalData.get(restaurantId) || {};
  const next    = { ...current, ...updates };
  state.personalData.set(restaurantId, next);

  try {
    await db.from('personal_data').upsert(
      { restaurant_id: restaurantId, device_id: state.personalId, ...updates },
      { onConflict: 'restaurant_id,device_id' }
    );
  } catch (err) {
    console.warn('[personal] upsert failed:', err);
    showToast('Could not save — please try again.', 'error');
  }
}

/* ============================================================
   OPEN NOW — STEP_28
   Spec: docs/design/FEATURE_SPECS.md — Feature 6
   Timezone: Asia/Bangkok (UTC+7, no DST)
   opening_hours format per SCHEMA_GUIDE.md:
     { "mon": [{"open":"11:00","close":"21:00"}, ...] | null, ... }
   Null value = closed all day on that day.
   Missing key = hours unknown for that day.
   ============================================================ */

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function isOpenNow(openingHours) {
  if (!openingHours || typeof openingHours !== 'object') return 'unknown';

  // Get current time in Bangkok using Intl API (never hardcode +7 offset)
  const now       = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: CONFIG.timezone,
    weekday:  'short',
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   false,
  });

  const parts    = formatter.formatToParts(now);
  const get      = (type) => parts.find(p => p.type === type)?.value;
  const dayKey   = get('weekday')?.toLowerCase().slice(0, 3); // 'mon', 'tue', etc.
  const hourStr  = get('hour');
  const minStr   = get('minute');

  if (!dayKey || !hourStr || !minStr) return 'unknown';

  const currentMins = parseInt(hourStr, 10) * 60 + parseInt(minStr, 10);

  // Missing key = unknown hours for this day
  if (!(dayKey in openingHours)) return 'unknown';

  const daySlots = openingHours[dayKey];

  // null = closed all day
  if (daySlots === null) return 'closed';

  // Must be an array of {open, close} windows (SCHEMA_GUIDE format)
  if (!Array.isArray(daySlots) || daySlots.length === 0) return 'unknown';

  for (const slot of daySlots) {
    const [openH,  openM]  = (slot.open  || '').split(':').map(Number);
    const [closeH, closeM] = (slot.close || '').split(':').map(Number);

    if (isNaN(openH) || isNaN(closeH)) continue;

    const openMins  = openH  * 60 + openM;
    const closeMins = closeH * 60 + closeM;

    // Handle overnight hours (e.g. open 22:00, close 02:00)
    const isOpen = closeMins < openMins
      ? (currentMins >= openMins || currentMins < closeMins)
      : (currentMins >= openMins && currentMins < closeMins);

    if (isOpen) return 'open';
  }

  return 'closed';
}

/* ============================================================
   NAVIGATION URLS — STEP_29
   Spec: docs/design/FEATURE_SPECS.md — Feature 5
   MUST be used as <a href> — never as a JS navigation call.
   HTTPS Universal Links work on iPhone for both Apple Maps
   and Google Maps (iOS opens the user's preferred app).
   Note: schema has no google_maps_place_id column — fallback
   to coordinate or name search.
   ============================================================ */

function mapsUrl(restaurant) {
  // Coordinates available — most reliable for area_only restaurants
  if (restaurant.lat && restaurant.lng) {
    const lat  = encodeURIComponent(restaurant.lat);
    const lng  = encodeURIComponent(restaurant.lng);
    const name = encodeURIComponent(restaurant.name_en || restaurant.name_th || 'Restaurant');
    return `https://maps.google.com/maps?q=${lat},${lng}(${name})`;
  }

  // Fallback: name + city search
  const query = encodeURIComponent(
    [restaurant.name_en, restaurant.city, 'Thailand']
      .filter(Boolean).join(' ')
  );
  return `https://maps.google.com/maps?q=${query}`;
}

/* ============================================================
   KEYBOARD HANDLER — STEP_30
   Spec: docs/design/MOBILE_CONSTRAINTS.md — Section 5
   iOS Safari keyboard shrinks the visual viewport, not the
   layout viewport. window.resize is unreliable — use
   visualViewport API instead.
   ============================================================ */

function initKeyboardHandler() {
  if (!window.visualViewport) return; // Older browsers skip gracefully

  let keyboardOpen = false;

  window.visualViewport.addEventListener('resize', () => {
    const viewportHeight = window.visualViewport.height;
    const windowHeight   = window.innerHeight;
    const keyboardHeight = windowHeight - viewportHeight;

    if (keyboardHeight > 150) {
      // Keyboard is open — threshold filters URL-bar show/hide
      if (!keyboardOpen) {
        keyboardOpen = true;
        document.documentElement.style.setProperty(
          '--keyboard-height', `${keyboardHeight}px`
        );
        document.body.classList.add('keyboard-open');
      }
    } else {
      // Keyboard is closed
      if (keyboardOpen) {
        keyboardOpen = false;
        document.documentElement.style.setProperty('--keyboard-height', '0px');
        document.body.classList.remove('keyboard-open');
      }
    }
  });

  // Counteract iOS scrolling the visual viewport when keyboard opens
  window.visualViewport.addEventListener('scroll', () => {
    if (window.visualViewport.offsetTop > 0) {
      window.scrollTo(0, window.visualViewport.offsetTop);
    }
  });
}

/* ============================================================
   CARD HTML — STEP_31
   Spec: docs/design/FEATURE_SPECS.md — Feature 1
   Uses only CSS classes from styles.css (STEP_17 + STEP_18).
   All Supabase strings escaped via escapeHTML().
   Deviations: schema uses name_th/name_en (not name/name_thai);
   cuisine_types[] array (not cuisine_type string).
   ============================================================ */

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cityBadgeClass(city) {
  const map = {
    bangkok:    'badge--bangkok',
    chiang_mai: 'badge--chiangmai',
    koh_chang:  'badge--kohchang',
  };
  return map[city] || '';
}

function cityLabel(city) {
  const map = {
    bangkok:    'Bangkok',
    chiang_mai: 'Chiang Mai',
    koh_chang:  'Koh Chang',
  };
  return map[city] || escapeHTML(city);
}

function cardHTML(r) {
  const openStatus  = isOpenNow(r.opening_hours);
  const personal    = state.personalData.get(r.id) || {};
  const primaryPhoto = Array.isArray(r.photos)
    ? (r.photos.find(p => p.is_primary) || r.photos[0])
    : null;

  // Open/closed indicator
  const openClass = openStatus === 'open'   ? 'open-indicator--open'
                  : openStatus === 'closed' ? 'open-indicator--closed'
                  :                           'open-indicator--unknown';
  const openLabel = openStatus === 'open'   ? 'Open now'
                  : openStatus === 'closed' ? 'Closed'
                  :                           '';

  // Wishlist/visited badges on card
  const wishHTML    = personal.is_wishlisted
    ? `<button class="wishlist-btn wishlist-btn--active"
               data-action="wishlist" data-id="${r.id}"
               aria-label="Remove from wishlist" aria-pressed="true">♥</button>`
    : `<button class="wishlist-btn"
               data-action="wishlist" data-id="${r.id}"
               aria-label="Add to wishlist" aria-pressed="false">♡</button>`;

  const visitedHTML = personal.is_visited
    ? `<span class="visited-marker visited-marker--visited" aria-label="You've visited">✓ Visited</span>`
    : '';

  // Photo or placeholder
  const photoHTML = primaryPhoto
    ? `<img src="${escapeHTML(primaryPhoto.url)}"
           alt="${escapeHTML(r.name_en || r.name_th)} photo"
           loading="lazy"
           decoding="async">`
    : '';

  // Cuisine (first tag from array)
  const cuisineTag = Array.isArray(r.cuisine_types) && r.cuisine_types.length
    ? `<span class="badge badge--cuisine">${escapeHTML(r.cuisine_types[0].replace(/_/g, ' '))}</span>`
    : '';

  // Price range
  const priceTag = r.price_range
    ? `<span class="badge badge--price" aria-label="Price range ${r.price_range}">${'฿'.repeat(r.price_range)}</span>`
    : '';

  // Michelin badge
  const michelinTag = r.michelin_stars > 0
    ? `<span class="badge badge--michelin" aria-label="${r.michelin_stars} Michelin star${r.michelin_stars > 1 ? 's' : ''}">${'★'.repeat(r.michelin_stars)}</span>`
    : r.michelin_bib
    ? `<span class="badge badge--michelin" aria-label="Michelin Bib Gourmand">Bib</span>`
    : '';

  // Halal badge
  const halalTag = r.is_halal
    ? `<span class="badge badge--halal">Halal</span>`
    : '';

  // City badge
  const cBadgeClass = cityBadgeClass(r.city);
  const cityTag = r.city
    ? `<span class="badge ${cBadgeClass}">${cityLabel(r.city)}</span>`
    : '';

  // Directions
  const dirHref = mapsUrl(r);

  return `
<article class="card"
         role="listitem"
         data-id="${r.id}"
         aria-label="${escapeHTML(r.name_en || r.name_th)}">
  <div class="card__photo-strip${primaryPhoto ? '' : ' card__photo-strip--empty'}" aria-hidden="true">
    ${photoHTML}
    ${openLabel ? `<span class="open-indicator ${openClass}" aria-label="${openLabel}">${openLabel}</span>` : ''}
    ${wishHTML}
    ${visitedHTML}
  </div>
  <div class="card__body">
    <h2 class="card__name-thai">${escapeHTML(r.name_th || r.name_en)}</h2>
    ${r.name_en && r.name_th ? `<p class="card__name-english">${escapeHTML(r.name_en)}</p>` : ''}
    <div class="card__meta">
      ${cuisineTag}${priceTag}${michelinTag}${halalTag}${cityTag}
    </div>
    ${r.area ? `<p class="card__location">${escapeHTML(r.area.replace(/_/g, ' '))}</p>` : ''}
    <div class="card__actions">
      <a class="directions-btn"
         href="${escapeHTML(dirHref)}"
         rel="noopener noreferrer"
         aria-label="Directions to ${escapeHTML(r.name_en || r.name_th)}">Directions</a>
    </div>
  </div>
</article>`;
}

/* ============================================================
   MAP — STEP_32
   Spec: docs/design/FEATURE_SPECS.md — Feature 3
   Leaflet loaded via CDN in index.html (before app.js).
   Deviations: schema uses lat/lng (not latitude/longitude).
   ============================================================ */

const MAP_TILE_URL  = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const MAP_TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function initMap() {
  if (state.map) return; // Already initialised

  // Guard: Leaflet may not have loaded if SW served an opaque cached response
  // and SRI blocked execution (BUG-001). Fail gracefully rather than throwing.
  if (typeof L === 'undefined') {
    console.error('[map] Leaflet not loaded — cannot initialise map');
    return;
  }

  state.map = L.map(dom.mapContainer, {
    center:           [CONFIG.mapDefaultLat, CONFIG.mapDefaultLng],
    zoom:             CONFIG.mapDefaultZoom,
    zoomControl:      true,
    attributionControl: true,
  });

  L.tileLayer(MAP_TILE_URL, {
    attribution: MAP_TILE_ATTR,
    maxZoom:     19,
  }).addTo(state.map);

  // invalidateSize after container becomes visible — Leaflet needs dimensions
  setTimeout(() => state.map.invalidateSize(), 50);
}

function renderPins(restaurants) {
  if (!state.map) return;

  // Remove old pins
  state.mapPins.forEach(marker => marker.remove());
  state.mapPins.clear();

  restaurants.forEach(r => {
    if (!r.lat || !r.lng) return;

    const openStatus = isOpenNow(r.opening_hours);
    const personal   = state.personalData.get(r.id) || {};

    const classes = ['map-pin'];
    if (openStatus === 'open')  classes.push('map-pin--open');
    if (personal.is_visited)    classes.push('map-pin--visited');
    if (personal.is_wishlisted) classes.push('map-pin--wishlisted');
    if (r.id === state.selectedId) classes.push('map-pin--selected');

    const icon = L.divIcon({
      className: '',  // Clear Leaflet default
      html:      `<div class="${classes.join(' ')}" aria-label="${escapeHTML(r.name_en || r.name_th)}"></div>`,
      iconSize:  [32, 32],
      iconAnchor:[16, 32],
    });

    const marker = L.marker([r.lat, r.lng], { icon }).addTo(state.map);

    // Pin tap opens bottom sheet — same as card tap
    marker.on('click', () => openSheet(r.id));

    state.mapPins.set(r.id, marker);
  });
}

function selectMapPin(id) {
  state.mapPins.forEach((marker, markerId) => {
    const el = marker.getElement()?.querySelector('.map-pin');
    if (!el) return;
    el.classList.toggle('map-pin--selected', markerId === id);
  });

  // Pan to selected pin
  const marker = state.mapPins.get(id);
  if (marker && state.map) {
    state.map.panTo(marker.getLatLng(), { animate: true });
  }
}

/* ============================================================
   FILTERS — STEP_33
   Spec: docs/design/FEATURE_SPECS.md — Feature 4
   Chips built from live data — never hardcoded.
   cuisine_types is an array field — flatMap for unique values.
   Deviations: schema uses cuisine_types[] not cuisine_type;
   uses @> contains operator logic on the client side.
   ============================================================ */

function buildFilterChips() {
  const container = dom.filterChips;
  if (!container) return;

  const chips = [];

  // Open now chip (always first)
  const openNowActive = state.activeFilters.open_now === true;
  chips.push(`
    <button class="filter-chip${openNowActive ? ' filter-chip--active' : ''}"
            data-filter-dim="open_now"
            data-filter-val="true"
            aria-pressed="${openNowActive}"
            aria-label="Show open now">Open now</button>`);

  // City chips
  const cities = [...new Set(state.restaurants.map(r => r.city).filter(Boolean))].sort();
  cities.forEach(city => {
    const isActive = state.activeFilters.city === city;
    chips.push(`
      <button class="filter-chip${isActive ? ' filter-chip--active' : ''}"
              data-filter-dim="city"
              data-filter-val="${escapeHTML(city)}"
              aria-pressed="${isActive}"
              aria-label="Filter by ${cityLabel(city)}">${cityLabel(city)}</button>`);
  });

  // Cuisine chips — flatten arrays, collect unique values
  const cuisines = [...new Set(
    state.restaurants.flatMap(r => Array.isArray(r.cuisine_types) ? r.cuisine_types : [])
  )].sort();
  cuisines.forEach(cuisine => {
    if (!cuisine) return;
    const isActive = state.activeFilters.cuisine === cuisine;
    const label    = cuisine.replace(/_/g, ' ');
    chips.push(`
      <button class="filter-chip${isActive ? ' filter-chip--active' : ''}"
              data-filter-dim="cuisine"
              data-filter-val="${escapeHTML(cuisine)}"
              aria-pressed="${isActive}"
              aria-label="Filter by ${escapeHTML(label)}">${escapeHTML(label)}</button>`);
  });

  // Price chips
  const prices = [...new Set(state.restaurants.map(r => r.price_range).filter(Boolean))].sort();
  prices.forEach(price => {
    const isActive = state.activeFilters.price_range === price;
    const label    = '฿'.repeat(price);
    chips.push(`
      <button class="filter-chip${isActive ? ' filter-chip--active' : ''}"
              data-filter-dim="price_range"
              data-filter-val="${price}"
              aria-pressed="${isActive}"
              aria-label="Price range ${label}">${label}</button>`);
  });

  // Halal chip (only show if any halal restaurants exist)
  if (state.restaurants.some(r => r.is_halal)) {
    const isActive = state.activeFilters.halal === true;
    chips.push(`
      <button class="filter-chip${isActive ? ' filter-chip--active' : ''}"
              data-filter-dim="halal"
              data-filter-val="true"
              aria-pressed="${isActive}"
              aria-label="Halal only">Halal</button>`);
  }

  // Michelin chip (only show if any Michelin restaurants exist)
  if (state.restaurants.some(r => r.michelin_stars > 0 || r.michelin_bib)) {
    const isActive = state.activeFilters.michelin === true;
    chips.push(`
      <button class="filter-chip${isActive ? ' filter-chip--active' : ''}"
              data-filter-dim="michelin"
              data-filter-val="true"
              aria-pressed="${isActive}"
              aria-label="Michelin recognised">Michelin</button>`);
  }

  container.innerHTML = chips.join('');
}

function applyFilters() {
  let results = state.restaurants;

  if (state.activeFilters.city) {
    results = results.filter(r => r.city === state.activeFilters.city);
  }
  if (state.activeFilters.cuisine) {
    results = results.filter(r =>
      Array.isArray(r.cuisine_types) && r.cuisine_types.includes(state.activeFilters.cuisine)
    );
  }
  if (state.activeFilters.price_range) {
    results = results.filter(r => r.price_range === Number(state.activeFilters.price_range));
  }
  if (state.activeFilters.open_now) {
    results = results.filter(r => isOpenNow(r.opening_hours) === 'open');
  }
  if (state.activeFilters.halal) {
    results = results.filter(r => r.is_halal);
  }
  if (state.activeFilters.michelin) {
    results = results.filter(r => r.michelin_stars > 0 || r.michelin_bib);
  }

  state.filtered = results;
  renderList(state.filtered);
  buildFilterChips(); // Rebuild to update active states

  // Update map if visible
  if (state.activeView === 'map') {
    renderPins(state.filtered);
  }
}

function renderList(restaurants) {
  if (!dom.cardList) return;

  // Hide skeleton, show card list
  if (dom.skeletonList) dom.skeletonList.hidden = true;
  dom.cardList.hidden = false;

  if (!restaurants || restaurants.length === 0) {
    dom.cardList.innerHTML = '';
    dom.emptyState.hidden  = false;
    return;
  }

  dom.emptyState.hidden  = true;
  dom.cardList.innerHTML = restaurants.map(cardHTML).join('');
}

/* ============================================================
   EVENT HANDLERS + INIT — STEP_34
   Spec: docs/design/FEATURE_SPECS.md — Features 5, 8, 9
   Personal data synced to Supabase personal_data table
   using device_id (per SCHEMA_GUIDE.md).
   Deviation from STEP_34 spec: using Supabase rather than
   localStorage for personal data (schema was built for this).
   ============================================================ */

/* ── Bottom sheet ────────────────────────────────────────────── */

function formatHoursSlot(slot) {
  if (!slot || typeof slot !== 'object') return '';
  return `${slot.open || '?'}–${slot.close || '?'}`;
}

function formatDayHours(daySlots) {
  if (daySlots === null) return 'Closed';
  if (!Array.isArray(daySlots) || daySlots.length === 0) return '—';
  return daySlots.map(formatHoursSlot).join(', ');
}

function openSheet(id) {
  const r = state.restaurants.find(r => r.id === id);
  if (!r) return;

  state.selectedId = id;
  if (state.activeView === 'map') selectMapPin(id);

  const personal    = state.personalData.get(id) || {};
  const openStatus  = isOpenNow(r.opening_hours);
  const navHref     = mapsUrl(r);

  // Photos
  const photos     = Array.isArray(r.photos) ? r.photos : [];
  const photosHTML = photos.length > 0
    ? photos.map(p =>
        `<img src="${escapeHTML(p.url)}"
              alt="${escapeHTML(r.name_en || r.name_th)} photo"
              loading="lazy" decoding="async">`
      ).join('')
    : '';

  // Open indicator
  const openClass = openStatus === 'open'   ? 'open-indicator--open'
                  : openStatus === 'closed' ? 'open-indicator--closed'
                  :                           'open-indicator--unknown';
  const openLabel = openStatus === 'open'   ? 'Open now'
                  : openStatus === 'closed' ? 'Closed'
                  :                           'Hours unknown';

  // Opening hours table
  const dayNames = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  const hoursRows = r.opening_hours
    ? Object.entries(dayNames).map(([key, label]) =>
        `<div class="detail-row">
          <span class="detail-row__label">${label}</span>
          <span class="detail-row__value">${formatDayHours(r.opening_hours[key])}</span>
        </div>`
      ).join('')
    : '<div class="detail-row"><span class="detail-row__value">Hours not available</span></div>';

  // Cuisine display
  const cuisineDisplay = Array.isArray(r.cuisine_types)
    ? r.cuisine_types.map(c => c.replace(/_/g, ' ')).join(', ')
    : '';

  dom.sheetContent.innerHTML = `
    <div class="bottom-sheet__header">
      <h2 class="card__name-thai">${escapeHTML(r.name_th || r.name_en)}</h2>
      ${r.name_en && r.name_th ? `<p class="card__name-english">${escapeHTML(r.name_en)}</p>` : ''}
      <span class="open-indicator ${openClass}" aria-label="${openLabel}">${openLabel}</span>
    </div>

    ${photosHTML ? `<div class="bottom-sheet__photos">${photosHTML}</div>` : ''}

    <a class="maps-btn"
       href="${escapeHTML(navHref)}"
       rel="noopener noreferrer"
       aria-label="Open in Maps">Open in Maps</a>

    <div class="detail-section">
      ${cuisineDisplay ? `
        <div class="detail-row">
          <span class="detail-row__label">Cuisine</span>
          <span class="detail-row__value">${escapeHTML(cuisineDisplay)}</span>
        </div>` : ''}
      ${r.city ? `
        <div class="detail-row">
          <span class="detail-row__label">City</span>
          <span class="detail-row__value">${cityLabel(r.city)}${r.area ? ` — ${escapeHTML(r.area.replace(/_/g, ' '))}` : ''}</span>
        </div>` : ''}
      ${r.price_range ? `
        <div class="detail-row">
          <span class="detail-row__label">Price</span>
          <span class="detail-row__value">${'฿'.repeat(r.price_range)}</span>
        </div>` : ''}
      ${r.is_halal ? `
        <div class="detail-row">
          <span class="detail-row__label">Halal</span>
          <span class="detail-row__value">Yes ✓</span>
        </div>` : ''}
      ${r.michelin_stars > 0 ? `
        <div class="detail-row">
          <span class="detail-row__label">Michelin</span>
          <span class="detail-row__value">${'★'.repeat(r.michelin_stars)} Star${r.michelin_stars > 1 ? 's' : ''}</span>
        </div>` : r.michelin_bib ? `
        <div class="detail-row">
          <span class="detail-row__label">Michelin</span>
          <span class="detail-row__value">Bib Gourmand</span>
        </div>` : ''}
      ${r.description_en ? `
        <div class="detail-row">
          <span class="detail-row__label">About</span>
          <span class="detail-row__value">${escapeHTML(r.description_en)}</span>
        </div>` : ''}
    </div>

    <div class="detail-section">
      <p class="detail-row__label">Opening Hours</p>
      ${hoursRows}
    </div>

    <div class="personal-section">
      <button class="wishlist-btn${personal.is_wishlisted ? ' wishlist-btn--active' : ''}"
              data-action="wishlist"
              data-id="${id}"
              aria-pressed="${!!personal.is_wishlisted}"
              aria-label="${personal.is_wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}">
        ${personal.is_wishlisted ? '♥ Wishlisted' : '♡ Wishlist'}
      </button>
      <button class="visited-marker${personal.is_visited ? ' visited-marker--visited' : ''}"
              data-action="visited"
              data-id="${id}"
              aria-pressed="${!!personal.is_visited}"
              aria-label="${personal.is_visited ? 'Mark as not visited' : 'Mark as visited'}">
        ${personal.is_visited ? '✓ Visited' : '○ Mark visited'}
      </button>
    </div>`;

  dom.bottomSheet.classList.add('bottom-sheet--open');
  dom.sheetBackdrop.classList.add('bottom-sheet-backdrop--visible');
  dom.bottomSheet.removeAttribute('aria-hidden');
  dom.sheetBackdrop.removeAttribute('aria-hidden');
}

function closeSheet() {
  state.selectedId = null;
  dom.bottomSheet.classList.remove('bottom-sheet--open');
  dom.sheetBackdrop.classList.remove('bottom-sheet-backdrop--visible');
  dom.bottomSheet.setAttribute('aria-hidden', 'true');
  dom.sheetBackdrop.setAttribute('aria-hidden', 'true');
}

/* ── Toast ─────────────────────────────────────────────────── */

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className   = `toast toast--${type}`;
  toast.textContent = message;
  toast.setAttribute('role', 'status');

  dom.toastContainer.appendChild(toast);

  // Double-rAF to trigger CSS transition
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('toast--visible'));
  });

  // Auto-dismiss after 3.5s
  setTimeout(() => {
    toast.classList.remove('toast--visible');
    setTimeout(() => toast.remove(), 400); // wait for fade-out transition
  }, 3500);
}

/* ── View switching ─────────────────────────────────────────── */

function switchView(view) {
  if (view === state.activeView) return;
  state.activeView = view;

  dom.viewList.classList.toggle('view--active', view === 'list');
  dom.viewList.setAttribute('aria-hidden', String(view !== 'list'));

  dom.viewMap.classList.toggle('view--active', view === 'map');
  dom.viewMap.setAttribute('aria-hidden', String(view !== 'map'));

  dom.navList.setAttribute('aria-pressed', String(view === 'list'));
  dom.navList.classList.toggle('nav-item--active', view === 'list');

  dom.navMap.setAttribute('aria-pressed', String(view === 'map'));
  dom.navMap.classList.toggle('nav-item--active', view === 'map');

  if (view === 'map') {
    initMap();
    setTimeout(() => {
      state.map.invalidateSize();
      renderPins(state.filtered);
    }, 50);
  }
}

/* ── Event delegation ───────────────────────────────────────── */

function attachEventListeners() {
  // Card list — single delegated listener for 54 cards
  dom.cardList.addEventListener('click', (e) => {
    // Wishlist button on card
    const wbtn = e.target.closest('[data-action="wishlist"]');
    if (wbtn && wbtn.closest('.card-list')) {
      e.stopPropagation();
      handlePersonalToggle(wbtn.dataset.id, 'wishlist');
      return;
    }
    // Card tap → open sheet
    const card = e.target.closest('[data-id]');
    if (card) openSheet(card.dataset.id);
  });

  // Filter chips
  dom.filterChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;

    const dim = chip.dataset.filterDim;
    const val = chip.dataset.filterVal;

    if (dim === 'open_now' || dim === 'halal' || dim === 'michelin') {
      // Boolean toggle
      state.activeFilters[dim] = state.activeFilters[dim] ? undefined : true;
    } else {
      // Single-select: tap same chip to deactivate
      state.activeFilters[dim] = state.activeFilters[dim] === val
        ? undefined
        : (dim === 'price_range' ? Number(val) : val);
    }
    applyFilters();
  });

  // Nav bar
  dom.navList.addEventListener('click', () => switchView('list'));
  dom.navMap.addEventListener('click',  () => switchView('map'));

  // Close sheet on backdrop tap
  dom.sheetBackdrop.addEventListener('click', closeSheet);

  // Close sheet on drag-handle tap (swipe-down is primary; this is secondary)
  const handle = dom.bottomSheet.querySelector('.bottom-sheet__handle');
  if (handle) handle.addEventListener('click', closeSheet);

  // Personal actions in bottom sheet
  dom.bottomSheet.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action][data-id]');
    if (!btn || !dom.sheetContent.contains(btn)) return;
    handlePersonalToggle(btn.dataset.id, btn.dataset.action);
  });
}

async function handlePersonalToggle(id, action) {
  if (!id || !action) return;
  const current = state.personalData.get(id) || {};

  let updates = {};
  let toast   = '';

  if (action === 'wishlist') {
    const next = !current.is_wishlisted;
    updates    = { is_wishlisted: next };
    toast      = next ? 'Saved to wishlist' : 'Removed from wishlist';
  } else if (action === 'visited') {
    const next = !current.is_visited;
    updates    = { is_visited: next };
    toast      = next ? 'Marked as visited ✓' : 'Removed from visited';
  }

  await upsertPersonalData(id, updates);
  showToast(toast);

  // Refresh sheet if this restaurant is currently open
  if (state.selectedId === id) openSheet(id);

  // Re-render card in list
  const cardEl = dom.cardList.querySelector(`[data-id="${id}"]`);
  if (cardEl) {
    const r = state.restaurants.find(r => r.id === id);
    if (r) cardEl.outerHTML = cardHTML(r);
  }

  // Refresh map pin if map is visible
  if (state.activeView === 'map') {
    const pin = state.mapPins.get(id);
    if (pin && state.map) {
      pin.remove();
      state.mapPins.delete(id);
      const r = state.restaurants.find(r => r.id === id);
      if (r && r.lat && r.lng) renderPins([r]); // re-add just this pin
    }
  }
}

/* ── Init ───────────────────────────────────────────────────── */

async function init() {
  // Get or generate device ID
  state.personalId = getOrCreatePersonalId();

  // Wire up all event listeners
  attachEventListeners();

  // iOS keyboard handler
  initKeyboardHandler();

  // Load personal data and restaurants in parallel
  await Promise.allSettled([
    loadPersonalData(),
    fetchRestaurants(),
  ]);
}

/* ── Bootstrap ─────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', init);
