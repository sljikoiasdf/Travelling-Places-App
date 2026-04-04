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
};

/* ============================================================
   INDEXEDDB CACHE
   ============================================================ */

const IDB_NAME    = 'thailand-food';
const IDB_VERSION = 1;
const IDB_STORE   = 'cache';
const CACHE_KEY   = 'restaurants_v1';

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => { e.target.result.createObjectStore(IDB_STORE); };
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
    if (Date.now() - data.timestamp > CONFIG.cacheTTL) return null;
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
  }
}

/* ============================================================
   GEOLOCATION (MISSING-01)
   Spec: docs/design/MISSING_FEATURES.md — MISSING-01
   ============================================================ */

/* ── GPS request ─────────────────────────────────────────────
   Requests location on app open; sets state.userLat/Lng and
   state.locationStatus. Timeout: 8s. No localStorage persist.
   ────────────────────────────────────────────────────────── */
async function requestLocation() {
  if (!navigator.geolocation) {
    state.locationStatus = 'unavailable';
    return;
  }
  state.locationStatus = 'requesting';
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.userLat = pos.coords.latitude;
        state.userLng = pos.coords.longitude;
        state.locationStatus = 'granted';
        state.sortOrder = 'nearest';
        resolve();
      },
      () => {
        // Denied or error
        state.locationStatus = 'denied';
        resolve();
      },
      { timeout: 8000, maximumAge: 60000, enableHighAccuracy: false }
    );
  });
}

/* ── Haversine distance calculator ──────────────────────────
   Returns distance in metres between two lat/lng coordinates.
   Used as fallback when RPC does not return dist_metres.
   ────────────────────────────────────────────────────────── */
function haversineDistance(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return null;
  const R = 6371000; // Earth radius in metres
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── GPS status notice ───────────────────────────────────────
   Shows a notice when GPS is denied/unavailable.
   Reads #location-notice element in index.html.
   ────────────────────────────────────────────────────────── */
function renderLocationNotice() {
  const el = document.getElementById('location-notice');
  if (!el) return;
  if (state.locationStatus === 'denied' || state.locationStatus === 'unavailable') {
    el.textContent = 'Showing all restaurants — enable location for proximity sorting';
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

/* ============================================================
   DATA FETCH
   ============================================================ */

async function fetchRestaurants() {
  state.isLoading = true;
  renderLoadingState();

  // Request GPS first — completes before data fetch (8s timeout max)
  await requestLocation();

  // Try cache first (cache is location-agnostic — stores full restaurant list)
  const cached = await getCached(CACHE_KEY);
  if (cached) {
    state.restaurants = cached;
    applyFiltersAndSearch();
    state.isLoading = false;
    refreshFromNetwork().catch(() => {});
    return;
  }

  await refreshFromNetwork();
}

async function refreshFromNetwork() {
  try {
    let data, error;

    if (state.locationStatus === 'granted' && state.userLat && state.userLng) {
      // GPS available — use nearby_restaurants RPC (sorted by distance)
      // radius_m: 50000 (50km) — returns all restaurants within 50km of user
      ({ data, error } = await db.rpc('nearby_restaurants', {
        user_lat: state.userLat,
        user_lng: state.userLng,
        radius_m: 50000,
        limit_n:  100
      }));

      // Attach _distanceMetres to each restaurant for use by distance display (MISSING-02)
      // RPC returns dist_metres column; fall back to haversine if null
      if (data) {
        data = data.map(r => ({
          ...r,
          _distanceMetres: r.dist_metres != null
            ? r.dist_metres
            : haversineDistance(state.userLat, state.userLng, r.lat, r.lng)
        }));
      }
    } else {
      // No GPS — fetch all restaurants sorted by rating
      ({ data, error } = await db
        .from('restaurants')
        .select(`
          id, name_th, name_en, slug, city, area,
          location_precision, lat, lng,
          cuisine_types, price_range, is_halal, is_vegetarian_friendly,
          michelin_stars, michelin_bib,
          opening_hours, phone, website, tagline,
          photos, identification_photo_url, dishes,
          cart_identifier, location_notes,
          nearby_landmark_en, landmark_latitude, landmark_longitude,
          legacy_note, source_quote_th, wongnai_rating,
          created_at
        `)
        .order('wongnai_rating', { ascending: false, nullsFirst: false })
      );

      // No GPS — attach null _distanceMetres for consistency (used by MISSING-02)
      if (data) {
        data = data.map(r => ({ ...r, _distanceMetres: null }));
      }
    }

    if (error) throw error;

    state.restaurants = data || [];
    state.isLoading   = false;

    await setCached(CACHE_KEY, state.restaurants);
    applyFiltersAndSearch();

    // Render map pins if map is currently visible
    if (state.activeView === 'map' && state.map) {
      state.map.invalidateSize();
      renderPins(state.filtered);
    }

  } catch (err) {
    console.error('[fetch] refreshFromNetwork failed:', err);
    state.isLoading = false;

    if (state.restaurants.length === 0) {
      showToast('Could not load restaurants. Check your connection.', 'error');
      if (dom.emptyState) {
        dom.emptyState.removeAttribute('hidden');
        dom.emptyState.style.display = 'flex';
      }
      if (dom.cardList) dom.cardList.style.display = 'none';
    } else {
      showToast('Using saved data — could not refresh.', 'error');
      applyFiltersAndSearch();
    }
  }
}

function renderLoadingState() {
  if (dom.skeletonList) {
    dom.skeletonList.removeAttribute('hidden');
    dom.skeletonList.style.display = 'flex';
  }
  if (dom.cardList)   dom.cardList.style.display   = 'none';
  if (dom.emptyState) dom.emptyState.style.display = 'none';
}

/* ── Personal data ─────────────────────────────────────────── */

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
   OPEN NOW
   ============================================================ */

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/* ── Meal period checker ─────────────────────────────────── */
// Spec: docs/design/MISSING_FEATURES.md — MISSING-08
// Checks if a restaurant is open during a specific meal period (Asia/Bangkok)
// Period ranges in minutes from midnight:
//   breakfast:  00:00–10:30 (0–630)
//   lunch:      11:00–15:00 (660–900)
//   dinner:     17:00–22:00 (1020–1320)
//   late_night: 22:00–27:00 (1320–1620, spans midnight)
// opening_hours format: { mon: [{open:'11:00',close:'15:00'}], ... } — same as isOpenNow

function isOpenDuringPeriod(period, opening_hours) {
  if (!opening_hours || !period) return false;

  const periodRanges = {
    breakfast:  [0,    630],
    lunch:      [660,  900],
    dinner:     [1020, 1320],
    late_night: [1320, 1620],
  };

  const range = periodRanges[period];
  if (!range) return false;
  const [pStart, pEnd] = range;

  // Get today's day key in Bangkok time
  const now = new Date();
  const dayKey = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: 'Asia/Bangkok',
  }).format(now).toLowerCase().slice(0, 3);

  const daySlots = opening_hours[dayKey];
  if (!daySlots || !Array.isArray(daySlots) || daySlots.length === 0) return false;

  // Check if ANY slot overlaps with the period window
  for (const slot of daySlots) {
    const [openH,  openM]  = (slot.open  || '').split(':').map(Number);
    const [closeH, closeM] = (slot.close || '').split(':').map(Number);
    if (isNaN(openH) || isNaN(closeH)) continue;
    const openMin  = openH  * 60 + openM;
    let   closeMin = closeH * 60 + closeM;
    if (closeMin < openMin) closeMin += 24 * 60; // spans midnight
    // Overlap test: open before period ends AND close after period starts
    if (openMin < pEnd && closeMin > pStart) return true;
  }

  return false;
}

function isOpenNow(openingHours) {
  if (!openingHours || typeof openingHours !== 'object') return 'unknown';

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
  const dayKey   = get('weekday')?.toLowerCase().slice(0, 3);
  const hourStr  = get('hour');
  const minStr   = get('minute');

  if (!dayKey || !hourStr || !minStr) return 'unknown';

  const currentMins = parseInt(hourStr, 10) * 60 + parseInt(minStr, 10);

  if (!(dayKey in openingHours)) return 'unknown';

  const daySlots = openingHours[dayKey];
  if (daySlots === null) return 'closed';
  if (!Array.isArray(daySlots) || daySlots.length === 0) return 'unknown';

  for (const slot of daySlots) {
    const [openH,  openM]  = (slot.open  || '').split(':').map(Number);
    const [closeH, closeM] = (slot.close || '').split(':').map(Number);
    if (isNaN(openH) || isNaN(closeH)) continue;
    const openMins  = openH  * 60 + openM;
    const closeMins = closeH * 60 + closeM;
    const isOpen = closeMins < openMins
      ? (currentMins >= openMins || currentMins < closeMins)
      : (currentMins >= openMins && currentMins < closeMins);
    if (isOpen) return 'open';
  }

  return 'closed';
}

/* ── Distance formatter ─────────────────────────────────────
   Spec: docs/design/MISSING_FEATURES.md — MISSING-02
   Returns a human-readable distance string based on metres and
   location_precision tier. Walking speed: 80 m/min.
   Precision values (per SCHEMA_GUIDE): 'exact', 'approximate', 'area_only'
   ────────────────────────────────────────────────────────── */
function formatDistance(metres, precision) {
  // No location data — don't show a distance
  if (!precision || precision === 'no_location') return 'Find locally';

  // Area-only: caller renders area name instead of distance
  if (precision === 'area_only') return null;

  // No distance available (GPS denied or geom null)
  if (metres === null || metres === undefined) {
    if (precision === 'approximate') return 'Location approximate';
    return '';
  }

  const prefix = precision === 'approximate' ? '~' : '';

  if (metres < 1000) {
    // Under 1km: show metres
    const m = Math.round(metres);
    return `${prefix}${m} m`;
  } else {
    // 1km and over: show km + walking time
    const km = (metres / 1000).toFixed(1);
    const mins = Math.max(1, Math.round(metres / 80));
    return `${prefix}${km} km · ${mins} min walk`;
  }
}

/* ============================================================
   NAVIGATION URLS
   ============================================================ */

/* ── Navigation destination resolver ────────────────────── */
// Spec: docs/design/MISSING_FEATURES.md — MISSING-03
// Priority: exact/approximate coords → landmark coords → null
// Returns { lat, lng, isApproximate, label } or null if no navigable destination

function resolveNavDestination(restaurant) {
  const p = restaurant.location_precision;

  if ((p === 'exact' || p === 'approximate') && restaurant.lat && restaurant.lng) {
    return {
      lat: restaurant.lat,
      lng: restaurant.lng,
      isApproximate: p === 'approximate',
      label: restaurant.name_en || restaurant.name_th
    };
  }

  if (restaurant.landmark_latitude && restaurant.landmark_longitude) {
    return {
      lat: restaurant.landmark_latitude,
      lng: restaurant.landmark_longitude,
      isApproximate: true,
      label: restaurant.nearby_landmark_en || restaurant.name_en || restaurant.name_th
    };
  }

  return null;
}

/* ============================================================
   FILTERS & SEARCH
   ============================================================ */

function applyFiltersAndSearch() {
  let results = state.restaurants;

  // Apply period filter
  if (state.activeFilters.period) {
    results = results.filter(r => isOpenDuringPeriod(state.activeFilters.period, r.opening_hours));
  }

  // Apply other filters
  if (state.activeFilters.cuisineType) {
    results = results.filter(r => r.cuisine_types && r.cuisine_types.includes(state.activeFilters.cuisineType));
  }

  if (state.activeFilters.isHalal) {
    results = results.filter(r => r.is_halal === true);
  }

  if (state.activeFilters.isVegetarianFriendly) {
    results = results.filter(r => r.is_vegetarian_friendly === true);
  }

  if (state.activeFilters.openNow) {
    results = results.filter(r => isOpenNow(r.opening_hours) === 'open');
  }

  if (state.activeFilters.michelin) {
    results = results.filter(r =>
      (state.activeFilters.michelin === 'any' && (r.michelin_stars || r.michelin_bib)) ||
      (state.activeFilters.michelin === 'star' && r.michelin_stars) ||
      (state.activeFilters.michelin === 'bib' && r.michelin_bib)
    );
  }

  // Apply search query
  if (state.searchQuery) {
    const query = state.searchQuery.toLowerCase();
    results = results.filter(r =>
      (r.name_th && r.name_th.toLowerCase().includes(query)) ||
      (r.name_en && r.name_en.toLowerCase().includes(query)) ||
      (r.area && r.area.toLowerCase().includes(query)) ||
      (r.city && r.city.toLowerCase().includes(query)) ||
      (r.tagline && r.tagline.toLowerCase().includes(query)) ||
      (r.cuisine_types && r.cuisine_types.some(c => c.toLowerCase().includes(query)))
    );
  }

  // Apply view mode
  if (state.viewMode === 'wishlist') {
    results = results.filter(r => {
      const pd = state.personalData.get(r.id);
      return pd && pd.is_wishlisted;
    });
  } else if (state.viewMode === 'visited') {
    results = results.filter(r => {
      const pd = state.personalData.get(r.id);
      return pd && pd.is_visited;
    });
  }

  // Apply sort order
  if (state.sortOrder === 'nearest' && state.userLat && state.userLng) {
    results.sort((a, b) => {
      const distA = a._distanceMetres || 999999;
      const distB = b._distanceMetres || 999999;
      return distA - distB;
    });
  } else {
    // Default sort: rating (descending)
    results.sort((a, b) => (b.wongnai_rating || 0) - (a.wongnai_rating || 0));
  }

  state.filtered = results;
  renderFilterChips();
  renderCardList();
}

function renderFilterChips() {
  const chips = dom.filterChips;
  if (!chips) return;

  chips.innerHTML = '';

  // Period filter chips
  ['breakfast', 'lunch', 'dinner', 'late_night'].forEach(period => {
    const label = period === 'late_night' ? 'Late Night' : period.charAt(0).toUpperCase() + period.slice(1);
    const isActive = state.activeFilters.period === period;

    const chip = document.createElement('button');
    chip.className = `chip ${isActive ? 'active' : ''}`;
    chip.textContent = label;
    chip.onclick = () => {
      state.activeFilters.period = isActive ? null : period;
      applyFiltersAndSearch();
    };
    chips.appendChild(chip);
  });

  // Open now chip
  const openNowChip = document.createElement('button');
  openNowChip.className = `chip ${state.activeFilters.openNow ? 'active' : ''}`;
  openNowChip.textContent = 'Open Now';
  openNowChip.onclick = () => {
    state.activeFilters.openNow = !state.activeFilters.openNow;
    applyFiltersAndSearch();
  };
  chips.appendChild(openNowChip);

  // Michelin chip
  if (state.activeFilters.michelin) {
    const michChip = document.createElement('button');
    michChip.className = 'chip active';
    michChip.textContent = state.activeFilters.michelin === 'star'
      ? 'Michelin Star'
      : state.activeFilters.michelin === 'bib'
      ? 'Bib Gourmand'
      : 'Michelin';
    michChip.onclick = () => {
      state.activeFilters.michelin = null;
      applyFiltersAndSearch();
    };
    chips.appendChild(michChip);
  }

  // Halal chip
  if (state.activeFilters.isHalal) {
    const halalChip = document.createElement('button');
    halalChip.className = 'chip active';
    halalChip.textContent = 'Halal';
    halalChip.onclick = () => {
      state.activeFilters.isHalal = false;
      applyFiltersAndSearch();
    };
    chips.appendChild(halalChip);
  }

  // Vegetarian chip
  if (state.activeFilters.isVegetarianFriendly) {
    const vegChip = document.createElement('button');
    vegChip.className = 'chip active';
    vegChip.textContent = 'Vegetarian';
    vegChip.onclick = () => {
      state.activeFilters.isVegetarianFriendly = false;
      applyFiltersAndSearch();
    };
    chips.appendChild(vegChip);
  }
}

/* ============================================================
   CARD LIST RENDERING
   ============================================================ */

function renderCardList() {
  const container = dom.cardList;
  if (!container) return;

  if (state.filtered.length === 0) {
    container.style.display = 'none';
    if (dom.emptyState) {
      dom.emptyState.textContent = state.searchQuery
        ? 'No results. Try adjusting your search or filters.'
        : 'No restaurants match your filters.';
      dom.emptyState.removeAttribute('hidden');
      dom.emptyState.style.display = 'flex';
    }
    if (dom.skeletonList) dom.skeletonList.style.display = 'none';
    return;
  }

  container.style.display = 'flex';
  container.innerHTML = '';
  if (dom.emptyState) dom.emptyState.style.display = 'none';
  if (dom.skeletonList) dom.skeletonList.style.display = 'none';

  state.filtered.forEach(restaurant => {
    const card = renderRestaurantCard(restaurant);
    container.appendChild(card);
  });
}

function renderRestaurantCard(restaurant) {
  const card = document.createElement('div');
  card.className = 'card';
  card.onclick = () => {
    state.selectedId = restaurant.id;
    renderDetailView();
    state.activeView = 'detail';
    showDetailView();
  };

  const personalData = state.personalData.get(restaurant.id) || {};
  const isWishlisted = personalData.is_wishlisted;
  const isVisited = personalData.is_visited;

  const thumbnailUrl = restaurant.photos && restaurant.photos[0]
    ? restaurant.photos[0]
    : restaurant.identification_photo_url;

  // Card header (image + wishlist button)
  const header = document.createElement('div');
  header.className = 'card-header';

  const img = document.createElement('img');
  img.src = thumbnailUrl || '';
  img.alt = restaurant.name_en || '';
  img.onerror = () => { img.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect fill="%23eee" width="200" height="200"/></svg>'; };
  header.appendChild(img);

  const wishlistBtn = document.createElement('button');
  wishlistBtn.className = `wishlist-btn ${isWishlisted ? 'active' : ''}`;
  wishlistBtn.innerHTML = isWishlisted ? '♡' : '♡';
  wishlistBtn.onclick = (e) => {
    e.stopPropagation();
    const newState = !isWishlisted;
    upsertPersonalData(restaurant.id, { is_wishlisted: newState });
    personalData.is_wishlisted = newState;
    wishlistBtn.classList.toggle('active');
  };
  header.appendChild(wishlistBtn);

  card.appendChild(header);

  // Card body
  const body = document.createElement('div');
  body.className = 'card-body';

  // Title
  const titleEl = document.createElement('h3');
  titleEl.className = 'card-title';
  titleEl.textContent = restaurant.name_en || restaurant.name_th;
  body.appendChild(titleEl);

  // Michelin badge
  if (restaurant.michelin_stars || restaurant.michelin_bib) {
    const badge = document.createElement('div');
    badge.className = 'michelin-badge';
    badge.textContent = restaurant.michelin_stars
      ? `${restaurant.michelin_stars} Star`
      : 'Bib Gourmand';
    body.appendChild(badge);
  }

  // Location + distance
  const locationEl = document.createElement('p');
  locationEl.className = 'card-location';
  if (restaurant.location_precision === 'area_only' && restaurant.area) {
    locationEl.textContent = restaurant.area;
  } else {
    const dist = formatDistance(restaurant._distanceMetres, restaurant.location_precision);
    locationEl.textContent = dist || restaurant.area || restaurant.city || 'Location info unavailable';
  }
  body.appendChild(locationEl);

  // Open status
  const openStatus = isOpenNow(restaurant.opening_hours);
  if (openStatus !== 'unknown') {
    const openEl = document.createElement('p');
    openEl.className = `open-status ${openStatus}`;
    openEl.textContent = openStatus === 'open' ? 'Open now' : 'Closed';
    body.appendChild(openEl);
  }

  // Rating
  if (restaurant.wongnai_rating) {
    const ratingEl = document.createElement('p');
    ratingEl.className = 'card-rating';
    ratingEl.textContent = `Rating: ${restaurant.wongnai_rating.toFixed(1)}`;
    body.appendChild(ratingEl);
  }

  card.appendChild(body);

  return card;
}

/* ============================================================
   DETAIL VIEW
   ============================================================ */

function renderDetailView() {
  if (!state.selectedId) return;

  const restaurant = state.restaurants.find(r => r.id === state.selectedId);
  if (!restaurant) return;

  const personalData = state.personalData.get(state.selectedId) || {};
  const isWishlisted = personalData.is_wishlisted;
  const isVisited = personalData.is_visited;

  const detailBody = dom.detailBody;
  if (!detailBody) return;

  detailBody.innerHTML = '';

  // Cover image
  const coverImg = document.createElement('img');
  coverImg.className = 'detail-cover-image';
  const coverUrl = restaurant.photos && restaurant.photos[0]
    ? restaurant.photos[0]
    : restaurant.identification_photo_url;
  coverImg.src = coverUrl || '';
  coverImg.alt = restaurant.name_en || '';
  detailBody.appendChild(coverImg);

  // Info section
  const infoSection = document.createElement('div');
  infoSection.className = 'detail-section';

  // Title + buttons
  const titleRow = document.createElement('div');
  titleRow.className = 'detail-title-row';

  const title = document.createElement('h1');
  title.textContent = restaurant.name_en || restaurant.name_th;
  titleRow.appendChild(title);

  const buttonRow = document.createElement('div');
  buttonRow.className = 'detail-button-row';

  const wishlistBtn = document.createElement('button');
  wishlistBtn.className = `detail-btn wishlist-btn ${isWishlisted ? 'active' : ''}`;
  wishlistBtn.innerHTML = '♡';
  wishlistBtn.onclick = () => {
    const newState = !isWishlisted;
    upsertPersonalData(state.selectedId, { is_wishlisted: newState });
    personalData.is_wishlisted = newState;
    wishlistBtn.classList.toggle('active');
  };
  buttonRow.appendChild(wishlistBtn);

  const visitedBtn = document.createElement('button');
  visitedBtn.className = `detail-btn visited-btn ${isVisited ? 'active' : ''}`;
  visitedBtn.textContent = '✓';
  visitedBtn.onclick = () => {
    const newState = !isVisited;
    upsertPersonalData(state.selectedId, { is_visited: newState });
    personalData.is_visited = newState;
    visitedBtn.classList.toggle('active');
  };
  buttonRow.appendChild(visitedBtn);

  const navBtn = document.createElement('button');
  navBtn.className = 'detail-btn nav-btn';
  navBtn.textContent = '→';
  navBtn.onclick = () => {
    showNavChoiceSheet(restaurant);
  };
  buttonRow.appendChild(navBtn);

  titleRow.appendChild(buttonRow);
  infoSection.appendChild(titleRow);

  // Thai name (if different)
  if (restaurant.name_th && restaurant.name_th !== restaurant.name_en) {
    const thaiName = document.createElement('p');
    thaiName.className = 'detail-thai-name';
    thaiName.textContent = restaurant.name_th;
    infoSection.appendChild(thaiName);
  }

  detailBody.appendChild(infoSection);

  // Badges section
  const badgeSection = document.createElement('div');
  badgeSection.className = 'detail-section badge-section';

  if (restaurant.michelin_stars || restaurant.michelin_bib) {
    const michBadge = document.createElement('span');
    michBadge.className = 'detail-badge michelin-badge';
    michBadge.textContent = restaurant.michelin_stars
      ? `${restaurant.michelin_stars} Star${restaurant.michelin_stars > 1 ? 's' : ''}`
      : 'Bib Gourmand';
    badgeSection.appendChild(michBadge);
  }

  if (restaurant.is_halal) {
    const halalBadge = document.createElement('span');
    halalBadge.className = 'detail-badge halal-badge';
    halalBadge.textContent = 'Halal';
    badgeSection.appendChild(halalBadge);
  }

  if (restaurant.is_vegetarian_friendly) {
    const vegBadge = document.createElement('span');
    vegBadge.className = 'detail-badge veg-badge';
    vegBadge.textContent = 'Vegetarian-friendly';
    badgeSection.appendChild(vegBadge);
  }

  if (badgeSection.children.length > 0) {
    detailBody.appendChild(badgeSection);
  }

  // Open status
  const openStatus = isOpenNow(restaurant.opening_hours);
  if (openStatus !== 'unknown') {
    const openEl = document.createElement('p');
    openEl.className = `detail-open-status ${openStatus}`;
    openEl.textContent = openStatus === 'open' ? 'Open now' : 'Closed';
    detailBody.appendChild(openEl);
  }

  // Rating
  if (restaurant.wongnai_rating) {
    const ratingEl = document.createElement('p');
    ratingEl.className = 'detail-rating';
    ratingEl.textContent = `Wongnai Rating: ${restaurant.wongnai_rating.toFixed(1)}/5`;
    detailBody.appendChild(ratingEl);
  }

  // Location details
  const locSection = document.createElement('div');
  locSection.className = 'detail-section';

  const locTitle = document.createElement('h3');
  locTitle.textContent = 'Location';
  locSection.appendChild(locTitle);

  const locText = document.createElement('p');
  locText.textContent = `${restaurant.area || ''}${restaurant.area && restaurant.city ? ', ' : ''}${restaurant.city || ''}`;
  if (!locText.textContent.trim()) locText.textContent = 'Location not available';
  locSection.appendChild(locText);

  if (restaurant.location_notes) {
    const notesEl = document.createElement('p');
    notesEl.className = 'detail-location-notes';
    notesEl.textContent = restaurant.location_notes;
    locSection.appendChild(notesEl);
  }

  detailBody.appendChild(locSection);

  // Opening hours
  if (restaurant.opening_hours) {
    const hoursSection = document.createElement('div');
    hoursSection.className = 'detail-section';

    const hoursTitle = document.createElement('h3');
    hoursTitle.textContent = 'Opening Hours';
    hoursSection.appendChild(hoursTitle);

    DAY_KEYS.forEach(dayKey => {
      const slots = restaurant.opening_hours[dayKey];
      const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][DAY_KEYS.indexOf(dayKey)];

      const dayEl = document.createElement('p');
      dayEl.className = 'detail-hours-day';

      if (slots === null) {
        dayEl.textContent = `${dayName}: Closed`;
      } else if (!Array.isArray(slots) || slots.length === 0) {
        dayEl.textContent = `${dayName}: Not available`;
      } else {
        const times = slots.map(s => `${s.open}-${s.close}`).join(', ');
        dayEl.textContent = `${dayName}: ${times}`;
      }

      hoursSection.appendChild(dayEl);
    });

    detailBody.appendChild(hoursSection);
  }

  // Contact info
  const contactSection = document.createElement('div');
  contactSection.className = 'detail-section';

  const contactTitle = document.createElement('h3');
  contactTitle.textContent = 'Contact';
  contactSection.appendChild(contactTitle);

  if (restaurant.phone) {
    const phoneEl = document.createElement('p');
    phoneEl.innerHTML = `Phone: <a href="tel:${restaurant.phone}">${restaurant.phone}</a>`;
    contactSection.appendChild(phoneEl);
  }

  if (restaurant.website) {
    const webEl = document.createElement('p');
    webEl.innerHTML = `Website: <a href="${restaurant.website}" target="_blank">Visit</a>`;
    contactSection.appendChild(webEl);
  }

  detailBody.appendChild(contactSection);

  // Dishes
  if (restaurant.dishes && Array.isArray(restaurant.dishes) && restaurant.dishes.length > 0) {
    const dishSection = document.createElement('div');
    dishSection.className = 'detail-section';

    const dishTitle = document.createElement('h3');
    dishTitle.textContent = 'Signature Dishes';
    dishSection.appendChild(dishTitle);

    const dishList = document.createElement('ul');
    restaurant.dishes.forEach(dish => {
      const li = document.createElement('li');
      li.textContent = dish;
      dishList.appendChild(li);
    });
    dishSection.appendChild(dishList);

    detailBody.appendChild(dishSection);
  }

  // Update detail title
  if (dom.detailTitle) {
    dom.detailTitle.textContent = restaurant.name_en || restaurant.name_th;
  }
}

function showDetailView() {
  if (dom.viewList)   dom.viewList.style.display = 'none';
  if (dom.viewMap)    dom.viewMap.style.display = 'none';
  if (dom.viewDetail) dom.viewDetail.style.display = 'flex';

  // Update nav
  if (dom.navList) dom.navList.classList.remove('active');
  if (dom.navMap)  dom.navMap.classList.remove('active');

  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;
}

/* ============================================================
   MAP VIEW
   ============================================================ */

function initMap() {
  if (state.map) return; // Already initialized

  state.map = L.map('map', {
    center: [CONFIG.mapDefaultLat, CONFIG.mapDefaultLng],
    zoom:   CONFIG.mapDefaultZoom,
    zoomControl: true,
    scrollWheelZoom: true
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(state.map);

  // Render existing pins
  if (state.filtered.length > 0) {
    renderPins(state.filtered);
  }
}

function renderPins(restaurants) {
  // Clear existing pins
  state.mapPins.forEach(pin => state.map.removeLayer(pin));
  state.mapPins.clear();

  restaurants.forEach(restaurant => {
    if (!restaurant.lat || !restaurant.lng) return;

    const marker = L.marker([restaurant.lat, restaurant.lng], {
      title: restaurant.name_en || restaurant.name_th
    })
      .on('click', () => {
        state.selectedId = restaurant.id;
        renderDetailView();
        state.activeView = 'detail';
        showDetailView();
      })
      .addTo(state.map);

    state.mapPins.set(restaurant.id, marker);
  });
}

function showMapView() {
  if (dom.viewList)   dom.viewList.style.display = 'none';
  if (dom.viewMap)    dom.viewMap.style.display = 'flex';
  if (dom.viewDetail) dom.viewDetail.style.display = 'none';

  // Update nav
  if (dom.navList) dom.navList.classList.remove('active');
  if (dom.navMap)  dom.navMap.classList.add('active');

  // Initialize or refresh map
  if (!state.map) {
    initMap();
  } else {
    state.map.invalidateSize();
    renderPins(state.filtered);
  }
}

/* ============================================================
   SEARCH & VIEW TOGGLING (B2_16)
   ============================================================ */

function setupSearch() {
  const input = dom.searchInput;
  const clearBtn = dom.searchClearBtn;

  if (input) {
    input.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      applyFiltersAndSearch();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      state.searchQuery = '';
      if (input) input.value = '';
      applyFiltersAndSearch();
    });
  }
}

function setupViewToggle() {
  const listBtn = dom.navList;
  const mapBtn = dom.navMap;

  if (listBtn) {
    listBtn.addEventListener('click', () => {
      state.activeView = 'list';
      if (dom.viewList) dom.viewList.style.display = 'flex';
      if (dom.viewMap) dom.viewMap.style.display = 'none';
      if (dom.viewDetail) dom.viewDetail.style.display = 'none';
      listBtn.classList.add('active');
      if (mapBtn) mapBtn.classList.remove('active');
    });
  }

  if (mapBtn) {
    mapBtn.addEventListener('click', () => {
      state.activeView = 'map';
      showMapView();
      if (listBtn) listBtn.classList.remove('active');
      mapBtn.classList.add('active');
    });
  }
}

function setupViewModeToggle() {
  const toggle = dom.viewToggle;
  if (!toggle) return;

  const updateToggleUI = () => {
    const modes = ['all', 'wishlist', 'visited'];
    toggle.innerHTML = '';

    modes.forEach(mode => {
      const btn = document.createElement('button');
      btn.className = `view-mode-btn ${state.viewMode === mode ? 'active' : ''}`;
      btn.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
      btn.onclick = () => {
        state.viewMode = mode;
        updateToggleUI();
        applyFiltersAndSearch();
      };
      toggle.appendChild(btn);
    });
  };

  updateToggleUI();
}

/* ============================================================
   NAVIGATION SHEET (MISSING-03)
   ============================================================ */

function showNavChoiceSheet(restaurant) {
  const dest = resolveNavDestination(restaurant);
  if (!dest) {
    showToast('Location information not available for navigation', 'error');
    return;
  }

  const overlay = dom.navChoiceOverlay;
  const sheet = dom.navChoiceSheet;

  if (!overlay || !sheet) return;

  sheet.innerHTML = '';

  const title = document.createElement('h2');
  title.textContent = 'Open Navigation';
  sheet.appendChild(title);

  // Apple Maps
  const appleMapsBtn = document.createElement('button');
  appleMapsBtn.className = 'nav-choice-btn';
  appleMapsBtn.textContent = 'Apple Maps';
  appleMapsBtn.onclick = () => {
    const url = `maps://maps.apple.com/?daddr=${dest.lat},${dest.lng}&q=${encodeURIComponent(dest.label)}`;
    window.location.href = url;
    closeNavChoiceSheet();
  };
  sheet.appendChild(appleMapsBtn);

  // Google Maps
  const googleMapsBtn = document.createElement('button');
  googleMapsBtn.className = 'nav-choice-btn';
  googleMapsBtn.textContent = 'Google Maps';
  googleMapsBtn.onclick = () => {
    const url = `https://www.google.com/maps/search/${encodeURIComponent(dest.label)}/@${dest.lat},${dest.lng},15z`;
    window.location.href = url;
    closeNavChoiceSheet();
  };
  sheet.appendChild(googleMapsBtn);

  // Cancel
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'nav-choice-btn cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = closeNavChoiceSheet;
  sheet.appendChild(cancelBtn);

  overlay.style.display = 'flex';
}

function closeNavChoiceSheet() {
  const overlay = dom.navChoiceOverlay;
  if (overlay) overlay.style.display = 'none';
}

/* ============================================================
   SORT SHEET
   ============================================================ */

function showSortSheet() {
  const overlay = dom.sortSheetOverlay;
  const sheet = dom.sortSheet;

  if (!overlay || !sheet) return;

  sheet.innerHTML = '';

  const title = document.createElement('h2');
  title.textContent = 'Sort By';
  sheet.appendChild(title);

  // Rating (always available)
  const ratingBtn = document.createElement('button');
  ratingBtn.className = `sort-option ${state.sortOrder === 'rating' ? 'active' : ''}`;
  ratingBtn.textContent = 'Rating';
  ratingBtn.onclick = () => {
    state.sortOrder = 'rating';
    applyFiltersAndSearch();
    closeSortSheet();
  };
  sheet.appendChild(ratingBtn);

  // Nearest (only if GPS available)
  if (state.locationStatus === 'granted' && state.userLat && state.userLng) {
    const nearestBtn = document.createElement('button');
    nearestBtn.className = `sort-option ${state.sortOrder === 'nearest' ? 'active' : ''}`;
    nearestBtn.textContent = 'Nearest';
    nearestBtn.onclick = () => {
      state.sortOrder = 'nearest';
      applyFiltersAndSearch();
      closeSortSheet();
    };
    sheet.appendChild(nearestBtn);
  }

  overlay.style.display = 'flex';
}

function closeSortSheet() {
  const overlay = dom.sortSheetOverlay;
  if (overlay) overlay.style.display = 'none';
}

/* ============================================================
   TOAST NOTIFICATIONS
   ============================================================ */

function showToast(message, type = 'info') {
  const container = dom.toastContainer;
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/* ============================================================
   INITIALIZATION
   ============================================================ */

async function init() {
  state.personalId = getOrCreatePersonalId();
  await loadPersonalData();

  setupSearch();
  setupViewToggle();
  setupViewModeToggle();

  // Show list view by default
  if (dom.viewList) {
    dom.viewList.style.display = 'flex';
    if (dom.navList) dom.navList.classList.add('active');
  }

  // Close nav overlays on background click
  if (dom.navChoiceOverlay) {
    dom.navChoiceOverlay.addEventListener('click', (e) => {
      if (e.target === dom.navChoiceOverlay) closeNavChoiceSheet();
    });
  }

  if (dom.sortSheetOverlay) {
    dom.sortSheetOverlay.addEventListener('click', (e) => {
      if (e.target === dom.sortSheetOverlay) closeSortSheet();
    });
  }

  // Router
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.slice(1);
    if (hash.startsWith('restaurant/')) {
      const id = parseInt(hash.split('/')[1], 10);
      state.selectedId = id;
      renderDetailView();
      state.activeView = 'detail';
      showDetailView();
    } else if (hash === 'map') {
      state.activeView = 'map';
      showMapView();
    } else {
      state.activeView = 'list';
      if (dom.viewList) dom.viewList.style.display = 'flex';
      if (dom.viewMap) dom.viewMap.style.display = 'none';
      if (dom.viewDetail) dom.viewDetail.style.display = 'none';
      if (dom.navList) dom.navList.classList.add('active');
      if (dom.navMap) dom.navMap.classList.remove('active');
    }
  };

  await fetchRestaurants();
  renderLocationNotice();
  renderFilterChips();
}

init().catch(err => console.error('[init] Failed:', err));
