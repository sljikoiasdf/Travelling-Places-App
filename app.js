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
  mapDefaultLat:  13.7563,
  mapDefaultLng:  100.5018,
  mapDefaultZoom: 12,
  mapPinZoom:     15,
  cacheVersion:   'v1',
  cacheTTL:       24 * 60 * 60 * 1000,
  timezone:       'Asia/Bangkok',
  nearbyRadiusM:  2000,
  nearbyLimit:    50,
};

/* ── App state ─────────────────────────────────────────────── */
const state = {
  restaurants:    [],
  filtered:       [],
  activeFilters:  {},
  activeView:     'map',        // Map is the default
  selectedId:     null,
  pendingRoute:   null,         // Hash to resolve after data loads
  map:            null,
  mapPins:        new Map(),
  personalData:   new Map(),
  personalId:     null,
  isLoading:      false,
  // ── Build 2: Geolocation (MISSING-01) ────────────────────
  userLat:        null,         // GPS latitude — set by requestLocation()
  userLng:        null,         // GPS longitude — set by requestLocation()
  locationStatus: 'requesting', // 'requesting' | 'granted' | 'denied' | 'unavailable'
  sortOrder:      'rating',     // 'nearest' | 'rating' — 'nearest' only when GPS granted
  nearMeRadiusM:  2000,         // Near me filter radius in metres (MISSING-16)
  // ── Build 2: Search & view mode (MISSING-07, B2_16) ─────
  searchQuery:    '',           // Free-text search query
  viewMode:       'all',        // 'all' | 'wishlist' | 'visited'
};

/* ── DOM refs ──────────────────────────────────────────────── */
const dom = {
  app:            document.getElementById('app'),
  appContent:     document.getElementById('app-content'),
  viewList:       document.getElementById('view-list'),
  viewMap:        document.getElementById('view-map'),
  viewDetail:     document.getElementById('view-detail'),
  detailTitle:    document.getElementById('detail-title'),
  detailBody:     document.getElementById('detail-body'),
  detailBack:     document.getElementById('detail-back'),
  cardList:       document.getElementById('card-list'),
  skeletonList:   document.getElementById('skeleton-list'),
  filterChips:    document.getElementById('filter-chips'),
  emptyState:     document.getElementById('empty-state'),
  navList:        document.getElementById('nav-list'),
  navMap:         document.getElementById('nav-map'),
  navBar:         document.getElementById('nav-bar'),
  toastContainer:    document.getElementById('toast-container'),
  mapContainer:      document.getElementById('map'),
  searchInput:       document.getElementById('search-input'),
  searchClearBtn:    document.getElementById('search-clear-btn'),
  viewToggle:        document.getElementById('view-toggle'),
  locationNotice:    document.getElementById('location-notice'),
  navChoiceOverlay:  document.getElementById('nav-choice-overlay'),
  navChoiceSheet:    document.getElementById('nav-choice-sheet'),
  sortSheetOverlay:  document.getElementById('sort-sheet-overlay'),
  sortSheet:         document.getElementById('sort-sheet'),
  sortBtn:           document.getElementById('sort-btn'),
  pullIndicator:     document.getElementById('pull-indicator'),
};

/* ============================================================
   INDEXEDDB CACHE
   ============================================================ */
const IDB_NAME    = 'thailand-food';
const IDB_VERSION = 1;
const IDB_STORE   = 'restaurants';

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function readFromIDB() {
  try {
    const db   = await openIDB();
    const tx   = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  } catch { return []; }
}

async function writeToIDB(records) {
  try {
    const db    = await openIDB();
    const tx    = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    records.forEach(r => store.put(r));
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror    = e => reject(e.target.error);
    });
  } catch { /* silent */ }
}

/* ============================================================
   SUPABASE DATA LAYER
   ============================================================ */

/* ── Field list shared by both SELECT paths ─────────────────
   NOTE: Kept in sync with ARCHITECTURE.md#restaurants columns.
   Any new column used in UI must be added here AND to the RPC
   path in refreshFromNetwork() if needed.                    */
const RESTAURANT_FIELDS = `
  id, name_th, name_en, slug, city, area,
  cuisine_types, price_range, is_halal, michelin_stars, michelin_bib,
  lat, lng, google_maps_url, wongnai_url, facebook_url, phone,
  opening_hours, cover_photo_url, photos, notes, dishes,
  legacy_note, source_quote_th, source_url, wongnai_rating,
  is_area_only, created_at
`.trim();

async function refreshFromNetwork() {
  if (state.isLoading) return;
  state.isLoading = true;

  try {
    let rows;

    if (state.locationStatus === 'granted' && state.userLat && state.userLng) {
      // GPS path — RPC that returns distance-sorted results
      const { data, error } = await db.rpc('restaurants_near', {
        user_lat: state.userLat,
        user_lng: state.userLng,
        radius_m: CONFIG.nearbyRadiusM,
        lim:      CONFIG.nearbyLimit,
      });
      if (error) throw error;

      // RPC returns a subset; merge with any cached data for offline completeness
      rows = data || [];

    } else {
      // No GPS — fetch all restaurants with expanded field set
      const { data, error } = await db
        .from('restaurants')
        .select(`
          id, name_th, name_en, slug, city, area,
          cuisine_types, price_range, is_halal, michelin_stars, michelin_bib,
          lat, lng, google_maps_url, wongnai_url, facebook_url, phone,
          opening_hours, cover_photo_url, photos, notes, dishes,
          legacy_note, source_quote_th, source_url, wongnai_rating,
          is_area_only, created_at
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      rows = data || [];
    }

    // Attach distance from GPS if available (RPC rows already have it)
    if (state.locationStatus === 'granted' && state.userLat && state.userLng) {
      rows = rows.map(r => ({
        ...r,
        _distanceMetres: r.distance_m ?? r._distanceMetres ?? null,
      }));
    } else {
      rows = rows.map(r => ({ ...r, _distanceMetres: null }));
    }

    state.restaurants = rows;
    await writeToIDB(rows);
    applyFiltersAndSearch();

  } catch (err) {
    console.error('[refreshFromNetwork]', err);
    showToast('Could not refresh restaurants', 'error');
  } finally {
    state.isLoading = false;
  }
}

async function loadPersonalData() {
  try {
    const id = await getOrCreatePersonalId();
    if (!id) return;
    state.personalId = id;
    const { data, error } = await db
      .from('personal_lists')
      .select('restaurant_id, status, visited_at, notes')
      .eq('user_id', id);
    if (error) throw error;
    state.personalData = new Map((data || []).map(r => [r.restaurant_id, r]));
  } catch (err) {
    console.error('[loadPersonalData]', err);
  }
}

async function getOrCreatePersonalId() {
  const KEY = 'thailand-food-uid';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    localStorage.setItem(KEY, id);
  }
  return id;
}

async function savePersonalStatus(restaurantId, status) {
  if (!state.personalId) await loadPersonalData();
  const existing = state.personalData.get(restaurantId);

  let newStatus;
  if (status === 'wishlist') {
    newStatus = existing?.status === 'wishlist' ? null : 'wishlist';
  } else if (status === 'visited') {
    newStatus = existing?.status === 'visited' ? null : 'visited';
  }

  if (newStatus === null) {
    // Remove
    state.personalData.delete(restaurantId);
    if (state.personalId) {
      await db.from('personal_lists')
        .delete()
        .eq('user_id', state.personalId)
        .eq('restaurant_id', restaurantId);
    }
  } else {
    const record = {
      user_id:       state.personalId,
      restaurant_id: restaurantId,
      status:        newStatus,
      visited_at:    newStatus === 'visited' ? new Date().toISOString() : null,
    };
    state.personalData.set(restaurantId, record);
    if (state.personalId) {
      await db.from('personal_lists').upsert(record, { onConflict: 'user_id,restaurant_id' });
    }
  }
}

/* ============================================================
   GEOLOCATION
   ============================================================ */

// Spec: docs/design/MISSING_FEATURES.md — MISSING-01
// Single geolocation request on app load — result stored in state.
// GPS is required for: _distanceMetres, 'nearest' sort, Near me filter.
// Failure/denial sets state.locationStatus = 'denied' | 'unavailable'.

function requestLocation() {
  if (!navigator.geolocation) {
    state.locationStatus = 'unavailable';
    renderLocationNotice();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.userLat       = pos.coords.latitude;
      state.userLng       = pos.coords.longitude;
      state.locationStatus = 'granted';
      state.sortOrder     = 'nearest';   // Upgrade default sort now GPS is available
      renderLocationNotice();
      refreshFromNetwork();              // Re-fetch with GPS path (distance data)
    },
    (err) => {
      state.locationStatus = err.code === 1 ? 'denied' : 'unavailable';
      renderLocationNotice();
      buildFilterChips();                // Re-render chips to reflect disabled Near me
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

/* ============================================================
   SERVICE WORKER REGISTRATION
   ============================================================ */

// Service worker registers itself in index.html after Leaflet/Supabase load.
// This file only provides the update-check helper used after SW activation.

function checkForUpdate() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.getRegistration().then(reg => {
    if (reg) reg.update();
  });
}

/* ============================================================
   OPENING HOURS HELPERS
   ============================================================ */

// Spec: docs/design/MISSING_FEATURES.md — MISSING-05
// opening_hours is a JSONB object: { mon: "08:00-20:00", ... } or null
// Days: mon tue wed thu fri sat sun — lowercase 3-letter keys
// Value: "HH:MM-HH:MM" | "closed" | null (unknown)
// Returns: 'open' | 'closed' | 'unknown'

function isOpenNow(openingHours) {
  if (!openingHours) return 'unknown';

  const now  = new Date();
  const opts = { timeZone: CONFIG.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false };
  const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(now);

  const dayMap = { Sun: 'sun', Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat' };
  const dayKey = dayMap[parts.find(p => p.type === 'weekday')?.value] || null;
  const hour   = parseInt(parts.find(p => p.type === 'hour')?.value   || '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const nowMin = hour * 60 + minute;

  if (!dayKey) return 'unknown';

  const hours = openingHours[dayKey];
  if (!hours || hours === 'closed') return 'closed';
  if (hours === 'open') return 'open'; // 24h

  const match = hours.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!match) return 'unknown';

  const openMin  = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  const closeMin = parseInt(match[3], 10) * 60 + parseInt(match[4], 10);

  if (closeMin <= openMin) {
    // Overnight span
    return (nowMin >= openMin || nowMin < closeMin) ? 'open' : 'closed';
  }
  return (nowMin >= openMin && nowMin < closeMin) ? 'open' : 'closed';
}

// Spec: docs/design/MISSING_FEATURES.md — MISSING-08
// Meal period filter: returns true if restaurant is open during given period
// Periods: breakfast (06:00-11:00), lunch (11:00-15:00), dinner (17:00-22:00), late_night (22:00-02:00)
function isOpenDuringPeriod(period, openingHours) {
  if (!openingHours) return false;

  const PERIOD_HOURS = {
    breakfast:  [6 * 60,  11 * 60],
    lunch:      [11 * 60, 15 * 60],
    dinner:     [17 * 60, 22 * 60],
    late_night: [22 * 60, 26 * 60], // 26*60 = 2:00 AM next day
  };

  const range = PERIOD_HOURS[period];
  if (!range) return false;

  const [periodStart, periodEnd] = range;

  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  return days.some(day => {
    const hours = openingHours[day];
    if (!hours || hours === 'closed') return false;
    if (hours === 'open') return true;

    const match = hours.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
    if (!match) return false;

    let openMin  = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
    let closeMin = parseInt(match[3], 10) * 60 + parseInt(match[4], 10);
    if (closeMin <= openMin) closeMin += 24 * 60; // Overnight

    // Check overlap between restaurant hours and period
    return openMin < periodEnd && closeMin > periodStart;
  });
}

/* ============================================================
   DISTANCE HELPER
   ============================================================ */

function haversineMetres(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;
  const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(metres) {
  if (metres == null) return '';
  if (metres < 1000) return `${Math.round(metres)}m`;
  return `${(metres / 1000).toFixed(1)}km`;
}

/* ============================================================
   CITY LABEL HELPER
   ============================================================ */

function cityLabel(city) {
  const MAP = {
    bangkok:    'Bangkok',
    chiangmai:  'Chiang Mai',
    phuket:     'Phuket',
    pattaya:    'Pattaya',
    ayutthaya:  'Ayutthaya',
    chiang_rai: 'Chiang Rai',
    koh_samui:  'Koh Samui',
    hua_hin:    'Hua Hin',
  };
  return MAP[city] || city;
}

/* ============================================================
   ESCAPE HELPER
   ============================================================ */

function escapeHTML(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ============================================================
   TOAST NOTIFICATIONS
   ============================================================ */

// Spec: docs/design/MISSING_FEATURES.md — MISSING-10
// Types: 'success' | 'error' | 'info'
// Auto-dismisses after 3s. Max 3 visible at once.

function showToast(message, type = 'info') {
  const container = dom.toastContainer;
  if (!container) return;

  const existing = container.querySelectorAll('.toast');
  if (existing.length >= 3) existing[0].remove();

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  toast.setAttribute('role', 'alert');
  container.appendChild(toast);

  // Trigger reflow for animation
  toast.getBoundingClientRect();
  toast.classList.add('toast--visible');

  setTimeout(() => {
    toast.classList.remove('toast--visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/* ============================================================
   FILTER CHIPS
   ============================================================ */

// Spec: docs/design/MISSING_FEATURES.md — MISSING-03
// Chips rendered from live restaurant data — only shows cuisines/cities present in dataset
// Active chip highlighted with filter-chip--active class
// Chips call applyFiltersAndSearch() on click

function buildFilterChips() {
  const container = dom.filterChips;
  if (!container) return;
  const chips = [];

  // Near me chip (MISSING-16) — disabled when GPS not granted
  // Spec: docs/design/MISSING_FEATURES.md — MISSING-16
  const gpsGranted = state.locationStatus === 'granted';
  const nearMeActive = state.activeFilters.near_me === true;
  chips.push(`<button class="filter-chip${nearMeActive ? ' filter-chip--active' : ''}${!gpsGranted ? ' filter-chip--disabled' : ''}" data-filter-dim="near_me" data-filter-val="true" aria-pressed="${nearMeActive}" ${!gpsGranted ? 'aria-disabled="true"' : ''} aria-label="Near me — 2km radius">📍 Near me</button>`);

  const openNowActive = state.activeFilters.open_now === true;
  chips.push(`<button class="filter-chip${openNowActive ? ' filter-chip--active' : ''}" data-filter-dim="open_now" data-filter-val="true" aria-pressed="${openNowActive}" aria-label="Show open now">Open now</button>`);

  const cities = [...new Set(state.restaurants.map(r => r.city).filter(Boolean))].sort();
  cities.forEach(city => {
    const isActive = state.activeFilters.city === city;
    chips.push(`<button class="filter-chip${isActive ? ' filter-chip--active' : ''}" data-filter-dim="city" data-filter-val="${escapeHTML(city)}" aria-pressed="${isActive}" aria-label="Filter by ${cityLabel(city)}">${cityLabel(city)}</button>`);
  });

  const cuisines = [...new Set(state.restaurants.flatMap(r => Array.isArray(r.cuisine_types) ? r.cuisine_types : []))].sort();
  cuisines.forEach(cuisine => {
    if (!cuisine) return;
    const isActive = state.activeFilters.cuisine === cuisine;
    const label    = cuisine.replace(/_/g, ' ');
    chips.push(`<button class="filter-chip${isActive ? ' filter-chip--active' : ''}" data-filter-dim="cuisine" data-filter-val="${escapeHTML(cuisine)}" aria-pressed="${isActive}" aria-label="Filter by ${escapeHTML(label)}">${escapeHTML(label)}</button>`);
  });

  const prices = [...new Set(state.restaurants.map(r => r.price_range).filter(Boolean))].sort();
  prices.forEach(price => {
    const isActive = state.activeFilters.price_range === price;
    chips.push(`<button class="filter-chip${isActive ? ' filter-chip--active' : ''}" data-filter-dim="price_range" data-filter-val="${price}" aria-pressed="${isActive}" aria-label="Price range ${'฿'.repeat(price)}">${'฿'.repeat(price)}</button>`);
  });

  if (state.restaurants.some(r => r.is_halal)) {
    const isActive = state.activeFilters.halal === true;
    chips.push(`<button class="filter-chip${isActive ? ' filter-chip--active' : ''}" data-filter-dim="halal" data-filter-val="true" aria-pressed="${isActive}" aria-label="Halal only">Halal</button>`);
  }
  if (state.restaurants.some(r => r.michelin_stars > 0 || r.michelin_bib)) {
    const isActive = state.activeFilters.michelin === true;
    chips.push(`<button class="filter-chip${isActive ? ' filter-chip--active' : ''}" data-filter-dim="michelin" data-filter-val="true" aria-pressed="${isActive}" aria-label="Michelin recognised">Michelin</button>`);
  }

  // Meal period chips (MISSING-08) — mutually exclusive
  const periods = [
    { key: 'breakfast',  label: '🌅 Breakfast' },
    { key: 'lunch',      label: '☀️ Lunch' },
    { key: 'dinner',     label: '🌙 Dinner' },
    { key: 'late_night', label: '🌃 Late Night' },
  ];
  periods.forEach(({ key, label }) => {
    const isActive = state.activeFilters.meal_period === key;
    chips.push(`<button class="filter-chip filter-chip--period${isActive ? ' filter-chip--active' : ''}" data-filter-dim="meal_period" data-filter-val="${key}" aria-pressed="${isActive}" aria-label="${label}">${label}</button>`);
  });

  container.innerHTML = chips.join('');
}

/* ── Search matcher ─────────────────────────────────────── */
// Spec: docs/design/MISSING_FEATURES.md — MISSING-07
// Client-side search against cached data — works offline
// Searches: name_th, name_en, area, notes, and dish names (Thai + English)
// Case-insensitive substring match. Minimum 2 characters enforced by caller.

function searchMatches(restaurant, query) {
  if (!query || query.length < 2) return true; // no query = show all
  const q = query.toLowerCase();
  const fields = [
    restaurant.name_th,
    restaurant.name_en,
    restaurant.area,
    restaurant.notes,
  ];
  if (Array.isArray(restaurant.dishes)) {
    restaurant.dishes.forEach(d => {
      fields.push(d.name_th, d.name_en, d.description);
    });
  }
  return fields.some(f => f && String(f).toLowerCase().includes(q));
}

/* ============================================================
   APPLY FILTERS AND SEARCH
   ============================================================ */

/* ── applyFiltersAndSearch ────────────────────────────────── */
// Spec: docs/design/MISSING_FEATURES.md — MISSING-02/03/07/08/16
// Applies ALL active filters and search in sequence:
// 1. viewMode filter (wishlist/visited)
// 2. City filter
// 3. Cuisine filter
// 4. Open now filter
// 5. Price range filter
// 6. Halal filter
// 7. Michelin filter
// 8. Meal period filter (MISSING-08)
// 4. Near me filter (from STEP_B2_21) — guarded on GPS
// Sort is applied AFTER all filters in applyFiltersAndSearch()

function applyFiltersAndSearch() {
  let results = [...state.restaurants];

  // 1. View mode
  if (state.viewMode === 'wishlist') {
    results = results.filter(r => state.personalData.get(r.id)?.status === 'wishlist');
  } else if (state.viewMode === 'visited') {
    results = results.filter(r => state.personalData.get(r.id)?.status === 'visited');
  }

  // 2–7. Active filters (city, cuisine, price, open_now, halal, michelin)
  if (state.activeFilters.city)        results = results.filter(r => r.city === state.activeFilters.city);
  if (state.activeFilters.cuisine)     results = results.filter(r => Array.isArray(r.cuisine_types) && r.cuisine_types.includes(state.activeFilters.cuisine));
  if (state.activeFilters.price_range) results = results.filter(r => r.price_range === Number(state.activeFilters.price_range));
  if (state.activeFilters.open_now)    results = results.filter(r => isOpenNow(r.opening_hours) === 'open');
  if (state.activeFilters.halal)       results = results.filter(r => r.is_halal);
  if (state.activeFilters.michelin)    results = results.filter(r => r.michelin_stars > 0 || r.michelin_bib);

  // 8. Meal period filter (MISSING-08)
  if (state.activeFilters.meal_period && typeof isOpenDuringPeriod === 'function') {
    results = results.filter(r => isOpenDuringPeriod(state.activeFilters.meal_period, r.opening_hours));
  }

  // 4. Near me filter (from STEP_B2_21) — guarded on GPS
  if (state.activeFilters.near_me && state.locationStatus === 'granted') {
    results = results.filter(r => r._distanceMetres != null && r._distanceMetres <= (state.nearMeRadiusM || 2000));
  }

  // 5. Full-text search — runs AFTER filters (AND logic)
  if (state.searchQuery && state.searchQuery.length >= 2) {
    results = results.filter(r => searchMatches(r, state.searchQuery));
  }

  // 6. Sort
  results = sortRestaurants(results, state.sortOrder);

  state.filtered = results;

  // 7. Render
  renderList(state.filtered);
  buildFilterChips();
  if (state.activeView === 'map') renderPins(state.filtered);
  renderLocationNotice();
}


function renderList(restaurants) {
  if (!dom.cardList) return;
  if (dom.skeletonList) {
    dom.skeletonList.style.display = 'none';
    dom.skeletonList.setAttribute('hidden', '');
  }
  dom.cardList.removeAttribute('hidden');
  dom.cardList.style.display = 'flex';
  if (!restaurants || restaurants.length === 0) {
    dom.cardList.style.display = 'none';
    dom.cardList.setAttribute('hidden', '');
    if (dom.emptyState) {
      dom.emptyState.removeAttribute('hidden');
      dom.emptyState.style.display = '';
    }
    return;
  }
  if (dom.emptyState) {
    dom.emptyState.style.display = 'none';
    dom.emptyState.setAttribute('hidden', '');
  }

  dom.cardList.innerHTML = restaurants.map(r => {
    const personal   = state.personalData.get(r.id);
    const isWishlist = personal?.status === 'wishlist';
    const isVisited  = personal?.status === 'visited';
    const dist       = r._distanceMetres != null ? formatDistance(r._distanceMetres) : '';
    const openStatus = isOpenNow(r.opening_hours);
    const openLabel  = openStatus === 'open' ? 'Open' : openStatus === 'closed' ? 'Closed' : '';
    const openClass  = openStatus === 'open' ? 'card__open-tag--open' : openStatus === 'closed' ? 'card__open-tag--closed' : '';

    return `
      <div class="card ${isVisited ? 'card--visited' : ''}" role="listitem" data-id="${r.id}" tabindex="0" aria-label="${escapeHTML(r.name_en || r.name_th)}">
        <div class="card__photo-wrap">
          ${r.cover_photo_url
            ? `<img class="card__photo" src="${escapeHTML(r.cover_photo_url)}" alt="${escapeHTML(r.name_en || r.name_th)}" loading="lazy">`
            : `<div class="card__photo card__photo--placeholder" aria-hidden="true"></div>`}
          ${openLabel ? `<span class="card__open-tag ${openClass}" aria-label="${openLabel}">${openLabel}</span>` : ''}
          ${isWishlist ? `<span class="card__wishlist-badge" aria-label="On wishlist">♡</span>` : ''}
          ${isVisited  ? `<span class="card__visited-badge"  aria-label="Visited">✓</span>`  : ''}
        </div>
        <div class="card__body">
          <p class="card__name">${escapeHTML(r.name_th || r.name_en)}</p>
          <p class="card__meta">
            ${r.city ? `<span class="card__city">${cityLabel(r.city)}</span>` : ''}
            ${r.area ? `<span class="card__area">${escapeHTML(r.area)}</span>` : ''}
            ${dist   ? `<span class="card__dist">${dist}</span>` : ''}
          </p>
          ${r.wongnai_rating ? `<p class="card__rating">★ ${r.wongnai_rating}</p>` : ''}
        </div>
      </div>`;
  }).join('');
}

/* ── Location notice ─────────────────────────────────────── */
function renderLocationNotice() {
  const el = dom.locationNotice;
  if (!el) return;
  if (state.locationStatus === 'denied') {
    el.textContent = 'Location access denied — enable in Settings for distance and sorting.';
    el.removeAttribute('hidden');
  } else if (state.locationStatus === 'unavailable') {
    el.textContent = 'Location unavailable on this device.';
    el.removeAttribute('hidden');
  } else {
    el.setAttribute('hidden', '');
    el.textContent = '';
  }
}

/* ============================================================
   MAP
   ============================================================ */

function initMap() {
  if (!dom.mapContainer) return;
  if (state.map) return; // Already initialised

  state.map = L.map(dom.mapContainer, {
    center:    [CONFIG.mapDefaultLat, CONFIG.mapDefaultLng],
    zoom:      CONFIG.mapDefaultZoom,
    zoomControl: false,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(state.map);

  // Zoom control — bottom right
  L.control.zoom({ position: 'bottomright' }).addTo(state.map);
}

function renderPins(restaurants) {
  if (!state.map) return;

  // Clear existing pins
  state.mapPins.forEach(pin => pin.remove());
  state.mapPins.clear();

  restaurants.forEach(r => {
    if (!r.lat || !r.lng) return;

    const personal   = state.personalData.get(r.id);
    const isWishlist = personal?.status === 'wishlist';
    const isVisited  = personal?.status === 'visited';

    const pinClass = isVisited ? 'map-pin map-pin--visited'
                  : isWishlist ? 'map-pin map-pin--wishlist'
                  : 'map-pin';

    const icon = L.divIcon({
      className: '',
      html:      `<div class="${pinClass}" aria-label="${escapeHTML(r.name_en || r.name_th)}"></div>`,
      iconSize:  [28, 28],
      iconAnchor:[14, 14],
    });

    const marker = L.marker([r.lat, r.lng], { icon })
      .addTo(state.map)
      .on('click', () => openDetail(r.id));

    state.mapPins.set(r.id, marker);
  });
}

/* ============================================================
   DETAIL VIEW
   ============================================================ */

// Spec: docs/design/FEATURE_SPECS.md — Feature 5
// Full-screen routed page at #detail/:slug
// Shows: cover photo, name, area/city, cuisine, price, rating, opening hours,
//        dishes, contact, personal action buttons, navigation links

function openDetail(id) {
  const r = state.restaurants.find(r => r.id === id || r.slug === id);
  if (!r) return;
  state.selectedId = r.id;
  window.location.hash = `#detail/${r.slug || r.id}`;
}

/* ── Source attribution (MISSING-15) ──────────────────────── */
// Spec: docs/design/MISSING_FEATURES.md — MISSING-15
// source_quote_th: Thai-language quote from original source
// source_url: URL to the source page
// Both rendered at bottom of detail view; both omitted when null

function sourceAttributionHTML(restaurant) {
  if (!restaurant.source_quote_th) return '';
  const link = restaurant.source_url
    ? `<a href="${escapeHTML(restaurant.source_url)}" target="_blank" rel="noopener noreferrer" class="source-attribution__credit">As described by source ↗</a>`
    : '';
  return `<div class="source-attribution">
    <p class="source-attribution__quote">"${escapeHTML(restaurant.source_quote_th)}"</p>
    ${link}
  </div>`;
}

function renderDetailPage(r) {
  if (!r) return;

  document.title = `${r.name_en || r.name_th} — Thailand Food Guide`;
  if (dom.detailTitle) dom.detailTitle.textContent = r.name_en || r.name_th;

  const personal   = state.personalData.get(r.id);
  const isWishlist = personal?.status === 'wishlist';
  const isVisited  = personal?.status === 'visited';
  const openStatus = isOpenNow(r.opening_hours);

  const cuisineList = Array.isArray(r.cuisine_types)
    ? r.cuisine_types.map(c => c.replace(/_/g, ' ')).join(', ')
    : '';

  const priceBaht = r.price_range ? '฿'.repeat(r.price_range) : '';

  const ratingHTML = r.wongnai_rating
    ? `<span class="detail-rating">★ ${r.wongnai_rating}</span>`
    : '';

  const openHTML = openStatus === 'open'
    ? '<span class="detail-open detail-open--open">Open now</span>'
    : openStatus === 'closed'
    ? '<span class="detail-open detail-open--closed">Closed</span>'
    : '';

  // Opening hours table
  const days = ['mon','tue','wed','thu','fri','sat','sun'];
  const dayLabels = { mon:'Mon', tue:'Tue', wed:'Wed', thu:'Thu', fri:'Fri', sat:'Sat', sun:'Sun' };

  const hoursHTML = r.opening_hours
    ? `<table class="detail-hours">
        ${days.map(d => {
          const val = r.opening_hours[d];
          return `<tr>
            <td class="detail-hours__day">${dayLabels[d]}</td>
            <td class="detail-hours__time">${val === 'closed' ? 'Closed' : val || '—'}</td>
          </tr>`;
        }).join('')}
       </table>`
    : '';

  // Dishes section
  const dishesHTML = Array.isArray(r.dishes) && r.dishes.length > 0
    ? `<div class="detail-dishes">
        <h3 class="detail-section-title">Must Try</h3>
        <div class="detail-dishes__list">
          ${r.dishes.map(d => `
            <div class="dish-card">
              ${d.photo_url ? `<img class="dish-card__photo" src="${escapeHTML(d.photo_url)}" alt="${escapeHTML(d.name_en || d.name_th)}" loading="lazy">` : ''}
              <div class="dish-card__body">
                <p class="dish-card__name-th">${escapeHTML(d.name_th || '')}</p>
                ${d.name_en ? `<p class="dish-card__name-en">${escapeHTML(d.name_en)}</p>` : ''}
                ${d.price   ? `<p class="dish-card__price">฿${d.price}</p>` : ''}
                ${d.description ? `<p class="dish-card__desc">${escapeHTML(d.description)}</p>` : ''}
              </div>
            </div>`).join('')}
        </div>
      </div>`
    : '';

  // Contact row
  const contactLinks = [];
  if (r.google_maps_url) contactLinks.push(`<a href="${escapeHTML(r.google_maps_url)}" target="_blank" rel="noopener noreferrer" class="detail-contact__link detail-contact__link--maps" aria-label="Open in Google Maps">Maps</a>`);
  if (r.wongnai_url)     contactLinks.push(`<a href="${escapeHTML(r.wongnai_url)}" target="_blank" rel="noopener noreferrer" class="detail-contact__link detail-contact__link--wongnai" aria-label="View on Wongnai">Wongnai</a>`);
  if (r.facebook_url)    contactLinks.push(`<a href="${escapeHTML(r.facebook_url)}" target="_blank" rel="noopener noreferrer" class="detail-contact__link detail-contact__link--facebook" aria-label="View on Facebook">Facebook</a>`);
  if (r.phone)           contactLinks.push(`<a href="tel:${escapeHTML(r.phone)}" class="detail-contact__link detail-contact__link--phone" aria-label="Call ${escapeHTML(r.phone)}">${escapeHTML(r.phone)}</a>`);

  const contactHTML = contactLinks.length
    ? `<div class="detail-contact">${contactLinks.join('')}</div>`
    : '';

  // Personal action buttons
  const wishlistLabel = isWishlist ? '♡ Remove from Wishlist' : '♡ Add to Wishlist';
  const visitedLabel  = isVisited  ? '✓ Mark Unvisited'       : '✓ Mark Visited';

  dom.detailBody.innerHTML = `
    <div class="detail-cover">
      ${r.cover_photo_url
        ? `<img class="detail-cover__img" src="${escapeHTML(r.cover_photo_url)}" alt="${escapeHTML(r.name_en || r.name_th)}">`
        : `<div class="detail-cover__placeholder" aria-hidden="true"></div>`}
    </div>

    <div class="detail-meta-row">
      <p class="detail-name-th">${escapeHTML(r.name_th || '')}</p>
      ${r.legacy_note ? `<span class="legacy-note">${escapeHTML(r.legacy_note)}</span>` : ''}
      <p class="detail-location">${[r.area, cityLabel(r.city)].filter(Boolean).join(', ')}</p>
      <div class="detail-tags">
        ${cuisineList ? `<span class="detail-tag">${escapeHTML(cuisineList)}</span>` : ''}
        ${priceBaht   ? `<span class="detail-tag">${priceBaht}</span>` : ''}
        ${r.is_halal  ? `<span class="detail-tag detail-tag--halal">Halal</span>` : ''}
        ${r.michelin_stars > 0 ? `<span class="detail-tag detail-tag--michelin">★ Michelin ${'★'.repeat(r.michelin_stars)}</span>` : ''}
        ${r.michelin_bib && !r.michelin_stars ? `<span class="detail-tag detail-tag--michelin">Bib Gourmand</span>` : ''}
      </div>
      ${ratingHTML}
      ${openHTML}
    </div>

    ${hoursHTML ? `<div class="detail-hours-wrap">${hoursHTML}</div>` : ''}

    ${dishesHTML}

    ${r.notes ? `<div class="detail-notes"><p>${escapeHTML(r.notes)}</p></div>` : ''}

    <div class="detail-personal">
      <button class="detail-action-btn detail-action-btn--wishlist ${isWishlist ? 'detail-action-btn--active' : ''}"
        data-action="wishlist" data-id="${r.id}" aria-pressed="${isWishlist}">
        ${wishlistLabel}
      </button>
      <button class="detail-action-btn detail-action-btn--visited ${isVisited ? 'detail-action-btn--active' : ''}"
        data-action="visited" data-id="${r.id}" aria-pressed="${isVisited}">
        ${visitedLabel}
      </button>
    </div>

    ${sourceAttributionHTML(r)}

    ${contactHTML}
  `;
}

/* ============================================================
   PHOTO GALLERY
   ============================================================ */

function openPhotoGallery(photos, startIndex = 0) {
  // Lightbox — fullscreen swipe gallery
  if (!photos || photos.length === 0) return;

  let current = startIndex;

  const overlay = document.createElement('div');
  overlay.className = 'gallery-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Photo gallery');

  const render = () => {
    overlay.innerHTML = `
      <button class="gallery-close" aria-label="Close gallery">✕</button>
      <div class="gallery-img-wrap">
        <img class="gallery-img" src="${escapeHTML(photos[current])}" alt="Photo ${current + 1} of ${photos.length}">
      </div>
      <div class="gallery-controls">
        <button class="gallery-prev" aria-label="Previous photo" ${current === 0 ? 'disabled' : ''}>‹</button>
        <span class="gallery-counter">${current + 1} / ${photos.length}</span>
        <button class="gallery-next" aria-label="Next photo" ${current === photos.length - 1 ? 'disabled' : ''}>›</button>
      </div>`;

    overlay.querySelector('.gallery-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.gallery-prev')?.addEventListener('click', () => { if (current > 0) { current--; render(); } });
    overlay.querySelector('.gallery-next')?.addEventListener('click', () => { if (current < photos.length - 1) { current++; render(); } });
  };

  render();
  document.body.appendChild(overlay);
}

/* ============================================================
   NAVIGATION CHOICE SHEET (Directions)
   ============================================================ */

// Spec: docs/design/MISSING_FEATURES.md — MISSING-09
// Shows a sheet with navigation app options: Apple Maps, Google Maps, Waze
// Opens the appropriate deep-link URL for the selected app

function showNavChoiceSheet(lat, lng, name) {
  const encodedName = encodeURIComponent(name);

  const options = [
    {
      label:    'Apple Maps',
      icon:     '🗺️',
      url:      `maps://?daddr=${lat},${lng}&q=${encodedName}`,
    },
    {
      label:    'Google Maps',
      icon:     '🌍',
      url:      `https://maps.google.com/?daddr=${lat},${lng}`,
    },
    {
      label:    'Waze',
      icon:     '🚗',
      url:      `waze://?ll=${lat},${lng}&navigate=yes`,
    },
  ];

  dom.navChoiceSheet.innerHTML = `
    <p class="nav-choice-title">Get directions to</p>
    <p class="nav-choice-name">${escapeHTML(name)}</p>
    ${options.map(o => `
      <a href="${o.url}" class="nav-choice-option" target="_blank" rel="noopener noreferrer">
        <span class="nav-choice-icon">${o.icon}</span>
        <span class="nav-choice-label">${o.label}</span>
      </a>`).join('')}
    <button class="nav-choice-cancel" id="nav-choice-cancel">Cancel</button>
  `;

  dom.navChoiceOverlay.classList.add('nav-choice-overlay--visible');

  document.getElementById('nav-choice-cancel')?.addEventListener('click', () => {
    dom.navChoiceOverlay.classList.remove('nav-choice-overlay--visible');
  });

  dom.navChoiceOverlay.addEventListener('click', (e) => {
    if (e.target === dom.navChoiceOverlay) {
      dom.navChoiceOverlay.classList.remove('nav-choice-overlay--visible');
    }
  }, { once: true });
}

/* ============================================================
   ROUTING
   ============================================================ */

function handleRoute(hash) {
  hash = hash || window.location.hash;

  if (!hash || hash === '#' || hash === '#map') {
    switchView('map');
    return;
  }
  if (hash === '#list') {
    switchView('list');
    return;
  }
  if (hash.startsWith('#detail/')) {
    const slug = hash.slice('#detail/'.length);
    const r    = state.restaurants.find(r => r.slug === slug || String(r.id) === slug);
    if (r) {
      showDetailView(r);
    } else if (state.restaurants.length === 0) {
      // Data not loaded yet — store and resolve after load
      state.pendingRoute = hash;
    } else {
      switchView('map');
    }
    return;
  }
  switchView('map');
}

function switchView(view) {
  state.activeView = view;

  const viewList   = dom.viewList;
  const viewMap    = dom.viewMap;
  const viewDetail = dom.viewDetail;

  viewList.classList.remove('view--active');
  viewMap.classList.remove('view--active');
  viewDetail.classList.remove('view--active');
  viewList.setAttribute('aria-hidden', 'true');
  viewMap.setAttribute('aria-hidden', 'true');
  viewDetail.setAttribute('aria-hidden', 'true');

  dom.navList.setAttribute('aria-pressed', 'false');
  dom.navList.classList.remove('nav-item--active');
  dom.navMap.setAttribute('aria-pressed', 'false');
  dom.navMap.classList.remove('nav-item--active');

  if (view === 'list') {
    viewList.classList.add('view--active');
    viewList.removeAttribute('aria-hidden');
    dom.navList.setAttribute('aria-pressed', 'true');
    dom.navList.classList.add('nav-item--active');
    applyFiltersAndSearch();
  } else if (view === 'map') {
    viewMap.classList.add('view--active');
    viewMap.removeAttribute('aria-hidden');
    dom.navMap.setAttribute('aria-pressed', 'true');
    dom.navMap.classList.add('nav-item--active');
    if (state.map) {
      setTimeout(() => state.map.invalidateSize(), 50);
    }
    renderPins(state.filtered.length > 0 ? state.filtered : state.restaurants);
  }
}

function showDetailView(r) {
  const viewList   = dom.viewList;
  const viewMap    = dom.viewMap;
  const viewDetail = dom.viewDetail;

  viewList.classList.remove('view--active');
  viewMap.classList.remove('view--active');
  viewList.setAttribute('aria-hidden', 'true');
  viewMap.setAttribute('aria-hidden', 'true');

  viewDetail.classList.add('view--active');
  viewDetail.removeAttribute('aria-hidden');

  renderDetailPage(r);
}

/* ============================================================
   RESTAURANT SORTER
   ============================================================ */

/* ── Restaurant sorter ──────────────────────────────────── */
// Spec: docs/design/MISSING_FEATURES.md — MISSING-14
// 'nearest': _distanceMetres ascending — requires GPS (STEP_B2_05)
// 'rating': wongnai_rating descending, nulls last
// 'newest': created_at descending
// Sort is applied AFTER all filters in applyFiltersAndSearch()

function sortRestaurants(restaurants, sortOrder) {
  const arr = [...restaurants];

  if (sortOrder === 'nearest') {
    return arr.sort((a, b) => {
      const aD = a._distanceMetres ?? Infinity;
      const bD = b._distanceMetres ?? Infinity;
      return aD - bD;
    });
  }

  if (sortOrder === 'rating') {
    return arr.sort((a, b) => {
      const aR = a.wongnai_rating ?? -1;
      const bR = b.wongnai_rating ?? -1;
      return bR - aR;
    });
  }

  if (sortOrder === 'newest') {
    return arr.sort((a, b) =>
      new Date(b.created_at) - new Date(a.created_at)
    );
  }

  return arr;
}

/* ============================================================
   EVENT LISTENERS
   ============================================================ */

function attachEventListeners() {

  // Card list tap — open detail
  dom.cardList.addEventListener('click', (e) => {
    const card = e.target.closest('[data-id]');
    if (card) openDetail(card.dataset.id);
  });

  // Filter chips
  dom.filterChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    const dim = chip.dataset.filterDim;
    const val = chip.dataset.filterVal;
    // Near me — requires GPS; show toast when disabled
    if (dim === 'near_me') {
      if (state.locationStatus !== 'granted') {
        showToast('Enable location access to use Near me', 'info');
        return;
      }
      state.activeFilters.near_me = state.activeFilters.near_me ? undefined : true;
      applyFiltersAndSearch();
      return;
    }
    if (dim === 'open_now' || dim === 'halal' || dim === 'michelin') {
      state.activeFilters[dim] = state.activeFilters[dim] ? undefined : true;
    } else {
      state.activeFilters[dim] = state.activeFilters[dim] === val
        ? undefined
        : (dim === 'price_range' ? Number(val) : val);
    }
    applyFiltersAndSearch();
  });

  // Nav buttons push to hash; router handles the rest
  dom.navMap.addEventListener('click',  () => { window.location.hash = '#map'; });
  dom.navList.addEventListener('click', () => { window.location.hash = '#list'; });

  // Detail back button
  dom.detailBack.addEventListener('click', () => history.back());

  // Personal actions + directions on detail page
  dom.detailBody.addEventListener('click', async (e) => {
    // Directions button — open nav choice sheet (B2_10)
    const dirBtn = e.target.closest('[data-action="directions"]');
    if (dirBtn) {
      const lat  = parseFloat(dirBtn.dataset.lat);
      const lng  = parseFloat(dirBtn.dataset.lng);
      const name = dirBtn.dataset.name || '';
      if (!isNaN(lat) && !isNaN(lng)) {
        showNavChoiceSheet(lat, lng, name);
      }
      return;
    }

    // Wishlist / visited toggles (B2_09)
    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) return;
    const action = actionBtn.dataset.action;
    const id     = actionBtn.dataset.id;
    if ((action === 'wishlist' || action === 'visited') && id) {
      await savePersonalStatus(id, action);
      renderDetailPage(state.restaurants.find(r => r.id === id));
      showToast(action === 'wishlist'
        ? (state.personalData.get(id)?.status === 'wishlist' ? 'Added to Wishlist' : 'Removed from Wishlist')
        : (state.personalData.get(id)?.status === 'visited'  ? 'Marked as Visited' : 'Marked Unvisited'),
        'success'
      );
    }
  });

  // Search input
  dom.searchInput?.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim();
    dom.searchClearBtn?.toggleAttribute('hidden', !state.searchQuery);
    applyFiltersAndSearch();
  });

  dom.searchClearBtn?.addEventListener('click', () => {
    if (dom.searchInput) dom.searchInput.value = '';
    state.searchQuery = '';
    dom.searchClearBtn.setAttribute('hidden', '');
    applyFiltersAndSearch();
  });

  // View toggle (All / Wishlist / Visited)
  dom.viewToggle?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mode]');
    if (!btn) return;
    state.viewMode = btn.dataset.mode;
    dom.viewToggle.querySelectorAll('.view-toggle__btn').forEach(b => {
      b.classList.toggle('view-toggle__btn--active', b.dataset.mode === state.viewMode);
    });
    applyFiltersAndSearch();
  });

  // Hash-based routing
  window.addEventListener('hashchange', () => handleRoute(window.location.hash));

  // Sort button + sort sheet (MISSING-14)
  function showSortSheet() {
    const options = [
      { key: 'nearest', label: 'Nearest first', disabled: state.locationStatus !== 'granted' },
      { key: 'rating',  label: 'Highest rated' },
      { key: 'newest',  label: 'Newly added' }
    ];
    dom.sortSheet.innerHTML = options.map(o => `
      <div class="sort-option ${state.sortOrder === o.key ? 'sort-option--active' : ''} ${o.disabled ? 'sort-option--disabled' : ''}"
        data-sort="${o.key}" ${o.disabled ? 'aria-disabled="true"' : ''}>
        ${o.label}
        ${state.sortOrder === o.key ? '<span class="sort-option__check">✓</span>' : ''}
      </div>
    `).join('');
    dom.sortSheetOverlay.classList.add('sort-sheet-overlay--visible');
    dom.sortSheetOverlay.addEventListener('click', (e) => {
      if (e.target === dom.sortSheetOverlay) {
        dom.sortSheetOverlay.classList.remove('sort-sheet-overlay--visible');
      }
    }, { once: true });
  }

  dom.sortSheet?.addEventListener('click', (e) => {
    const option = e.target.closest('.sort-option');
    if (!option || option.getAttribute('aria-disabled') === 'true') return;
    const sort = option.dataset.sort;
    state.sortOrder = sort;
    dom.sortSheetOverlay.classList.remove('sort-sheet-overlay--visible');
    applyFiltersAndSearch();
  });

  dom.sortBtn?.addEventListener('click', showSortSheet);

  // Pull-to-refresh (MISSING-13)
  // Spec: docs/design/MISSING_FEATURES.md — MISSING-13
  // Threshold: 60px pull. Spinner shown during refresh. Debounced.
  ;(function initPullToRefresh() {
    let startY       = 0;
    let pulling      = false;
    let refreshing   = false;
    const THRESHOLD  = 60;
    const indicator  = dom.pullIndicator;

    const listView = dom.viewList;

    listView.addEventListener('touchstart', (e) => {
      if (listView.scrollTop > 0) return;
      startY  = e.touches[0].clientY;
      pulling = true;
    }, { passive: true });

    listView.addEventListener('touchmove', (e) => {
      if (!pulling || refreshing) return;
      const deltaY = e.touches[0].clientY - startY;
      if (deltaY > 0 && listView.scrollTop <= 0) {
        const progress = Math.min(deltaY / THRESHOLD, 1);
        if (indicator) {
          indicator.style.opacity  = String(progress);
          indicator.style.transform = `translateY(${Math.min(deltaY * 0.4, 24)}px)`;
        }
      }
    }, { passive: true });

    listView.addEventListener('touchend', async (e) => {
      if (!pulling || refreshing) return;
      pulling = false;
      const deltaY = e.changedTouches[0].clientY - startY;
      if (indicator) {
        indicator.style.opacity   = '0';
        indicator.style.transform = '';
      }
      if (deltaY >= THRESHOLD && listView.scrollTop <= 0) {
        refreshing = true;
        if (indicator) indicator.classList.add('pull-indicator--active');
        try {
          await refreshFromNetwork();
        } finally {
          refreshing = false;
          if (indicator) indicator.classList.remove('pull-indicator--active');
        }
      }
    }, { passive: true });
  })();
}

/* ============================================================
   INIT
   ============================================================ */

async function init() {
  // 1. Map
  initMap();

  // 2. Event listeners
  attachEventListeners();

  // 3. Personal data (async — non-blocking)
  loadPersonalData().then(() => {
    applyFiltersAndSearch();
  });

  // 4. Try IDB cache first (instant render)
  const cached = await readFromIDB();
  if (cached && cached.length > 0) {
    state.restaurants = cached;
    applyFiltersAndSearch();
  }

  // 5. GPS — triggers refreshFromNetwork() on success
  requestLocation();

  // 6. If no GPS (denied/unavailable), fetch from network after short delay
  setTimeout(() => {
    if (state.locationStatus !== 'granted' && state.restaurants.length === 0) {
      refreshFromNetwork();
    }
  }, 1500);

  // 7. Resolve pending route from hash
  handleRoute(window.location.hash);

  // 8. SW update check
  checkForUpdate();

  // 9. Resolve any pending route after data load
  if (state.pendingRoute && state.restaurants.length > 0) {
    const pending = state.pendingRoute;
    state.pendingRoute = null;
    handleRoute(pending);
  }
}

document.addEventListener('DOMContentLoaded', init);
