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
      label: p === 'approximate' ? 'Location approximate' : null
    };
  }

  if (restaurant.landmark_latitude && restaurant.landmark_longitude) {
    return {
      lat: restaurant.landmark_latitude,
      lng: restaurant.landmark_longitude,
      isApproximate: true,
      label: 'Navigate to nearby landmark'
    };
  }

  return null; // no navigable destination
}

/* ── Location block HTML builder ─────────────────────────── */
// Spec: docs/design/MISSING_FEATURES.md — MISSING-03
// Renders cart-finder-box, landmark note, area/city, and directions button

function locationBlockHTML(restaurant) {
  const p    = restaurant.location_precision;
  const dest = resolveNavDestination(restaurant);
  let html   = '';

  // Cart / no-location: show finder box prominently
  if (!p || p === 'no_location' || p === 'area_only') {
    if (restaurant.cart_identifier || restaurant.location_notes) {
      html += `<div class="cart-finder-box">
        <div class="cart-finder-box__label">How to find it</div>
        ${restaurant.cart_identifier ? `<div class="cart-finder-box__text">${escapeHTML(restaurant.cart_identifier)}</div>` : ''}
        ${restaurant.location_notes ? `<div class="cart-finder-box__text">${escapeHTML(restaurant.location_notes)}</div>` : ''}
      </div>`;
    }
  }

  // Nearby landmark note
  if (restaurant.nearby_landmark_en) {
    html += `<p class="landmark-note">Near: ${escapeHTML(restaurant.nearby_landmark_en)}</p>`;
  }

  // Area + city
  const areaCity = [
    restaurant.area ? restaurant.area.replace(/_/g, ' ') : null,
    restaurant.city ? restaurant.city.replace(/_/g, ' ') : null
  ].filter(Boolean).join(', ');
  if (areaCity) html += `<p class="detail__area">${escapeHTML(areaCity)}</p>`;

  // Directions button — precision-aware
  if (dest) {
    const navUrl = `https://maps.google.com/maps?q=${encodeURIComponent(dest.lat)},${encodeURIComponent(dest.lng)}(${encodeURIComponent(restaurant.name_en || restaurant.name_th || 'Restaurant')})`;
    const approxBadge = dest.isApproximate && dest.label
      ? `<span class="precision-badge">${escapeHTML(dest.label)}</span>`
      : '';
    html += `<div class="detail__directions-area">
      ${approxBadge}
      <button class="maps-btn" data-action="directions" data-restaurant-id="${restaurant.id}" aria-label="Get directions to ${escapeHTML(restaurant.name_en || restaurant.name_th || 'restaurant')}">Get Directions</button>
    </div>`;
  } else {
    html += `<div class="detail__directions-area">
      <button class="maps-btn maps-btn--disabled" data-action="directions" data-restaurant-id="${restaurant.id}" aria-label="Search for ${escapeHTML(restaurant.name_en || restaurant.name_th || 'restaurant')} on Maps">Find on Maps</button>
    </div>`;
  }

  return html;
}

function mapsUrl(restaurant) {
  if (restaurant.lat && restaurant.lng) {
    const lat  = encodeURIComponent(restaurant.lat);
    const lng  = encodeURIComponent(restaurant.lng);
    const name = encodeURIComponent(restaurant.name_en || restaurant.name_th || 'Restaurant');
    return `https://maps.google.com/maps?q=${lat},${lng}(${name})`;
  }
  const query = encodeURIComponent(
    [restaurant.name_en, restaurant.city, 'Thailand'].filter(Boolean).join(' ')
  );
  return `https://maps.google.com/maps?q=${query}`;
}

/* ── Navigation URL builder ─────────────────────────────── */
// Spec: docs/design/MISSING_FEATURES.md — MISSING-04, MISSING-17
// ARCHITECTURE.md Section 3.1 — URL formats
// Returns: { apple, google, streetView } — all HTTPS except Apple Maps maps:// scheme
// Apple Maps: maps:// scheme in <a href> — Safari hands off to Maps app natively
// Google Maps: HTTPS Universal Link — works whether or not Google Maps is installed
// Street View: HTTPS — only for exact precision coordinates
// NEVER call window.open() — use <a href> anchors only

function navUrls(restaurant) {
  const dest = resolveNavDestination(restaurant);
  let apple = null, google = null, streetView = null;

  if (dest && dest.lat && dest.lng) {
    const lat = dest.lat;
    const lng = dest.lng;
    apple  = `maps://maps.apple.com/?daddr=${lat},${lng}&dirflg=w`;
    google = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
    if (restaurant.location_precision === 'exact') {
      streetView = `https://maps.google.com/?layer=c&cbll=${lat},${lng}`;
    }
  } else {
    const name = encodeURIComponent(restaurant.name_th || restaurant.name_en || '');
    apple  = `maps://maps.apple.com/?q=${name}`;
    google = `https://www.google.com/maps/search/?api=1&query=${name}`;
  }

  return { apple, google, streetView };
}

/* ── Navigation choice sheet ────────────────────────────── */
// Spec: docs/design/MISSING_FEATURES.md — MISSING-04, MISSING-17
// Shows bottom sheet with Apple Maps + Google Maps + optional Street View

function showNavChoiceSheet(restaurant) {
  const urls = navUrls(restaurant);
  const dest = resolveNavDestination(restaurant);
  const approxLabel = dest?.isApproximate
    ? `<p class="nav-choice-sheet__title">${escapeHTML(dest.label || 'Location approximate')}</p>` : '';

  const sheetContent = `
    ${approxLabel}
    <p class="nav-choice-sheet__title">Open with</p>
    <a href="${urls.apple}" class="nav-choice-btn">
      <span>🗺</span> Apple Maps
    </a>
    <a href="${urls.google}" class="nav-choice-btn" target="_blank" rel="noopener">
      <span>📍</span> Google Maps
    </a>
    ${urls.streetView ? `<a href="${urls.streetView}" class="street-view-link" target="_blank" rel="noopener">📷 Street View</a>` : ''}
    <button class="nav-choice-cancel" id="nav-choice-cancel">Cancel</button>
  `;

  const overlay = dom.navChoiceOverlay || document.getElementById('nav-choice-overlay');
  const sheet   = dom.navChoiceSheet   || document.getElementById('nav-choice-sheet');
  if (!overlay || !sheet) {
    // Fallback if overlay not present
    window.location.href = urls.apple;
    return;
  }

  sheet.innerHTML = sheetContent;
  overlay.classList.add('nav-choice-overlay--visible');

  function dismiss(e) {
    if (e.target === overlay) {
      overlay.classList.remove('nav-choice-overlay--visible');
      overlay.removeEventListener('click', dismiss);
    }
  }
  overlay.addEventListener('click', dismiss);

  const cancelBtn = document.getElementById('nav-choice-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      overlay.classList.remove('nav-choice-overlay--visible');
    }, { once: true });
  }
}

/* ============================================================
   KEYBOARD HANDLER
   ============================================================ */

function initKeyboardHandler() {
  if (!window.visualViewport) return;

  let keyboardOpen = false;

  window.visualViewport.addEventListener('resize', () => {
    const viewportHeight = window.visualViewport.height;
    const windowHeight   = window.innerHeight;
    const keyboardHeight = windowHeight - viewportHeight;

    if (keyboardHeight > 150) {
      if (!keyboardOpen) {
        keyboardOpen = true;
        document.documentElement.style.setProperty('--keyboard-height', `${keyboardHeight}px`);
        document.body.classList.add('keyboard-open');
      }
    } else {
      if (keyboardOpen) {
        keyboardOpen = false;
        document.documentElement.style.setProperty('--keyboard-height', '0px');
        document.body.classList.remove('keyboard-open');
      }
    }
  });

  window.visualViewport.addEventListener('scroll', () => {
    if (window.visualViewport.offsetTop > 0) {
      window.scrollTo(0, window.visualViewport.offsetTop);
    }
  });
}

/* ============================================================
   CARD HTML
   ============================================================ */

/* ── Dishes preview (card) ──────────────────────────────── */
// Spec: docs/design/MISSING_FEATURES.md — MISSING-06
// Compact one-line preview: "Must order: ข้าวมันไก่ · ไก่ทอด"
// Signature dishes shown first. Max 2 dish names. Omitted if no dishes.

function dishesPreviewHTML(dishes) {
  if (!dishes || !Array.isArray(dishes) || dishes.length === 0) return '';
  const sorted = [...dishes].sort((a, b) => (b.is_signature ? 1 : 0) - (a.is_signature ? 1 : 0));
  const shown = sorted.slice(0, 2).map(d => d.name_th || d.name_en || '').filter(Boolean);
  if (shown.length === 0) return '';
  return `<div class="card__dishes-preview">
    <span class="card__dishes-label">Must order:</span> ${escapeHTML(shown.join(' · '))}
  </div>`;
}

/* ── Dishes detail (full) ────────────────────────────────── */
// Spec: docs/design/MISSING_FEATURES.md — MISSING-06
// Full list of dishes with name_th, name_en, price_approx, notes, is_signature badge.
// Section heading: "Known for". Omitted entirely if no dishes.

function dishesDetailHTML(dishes) {
  if (!dishes || !Array.isArray(dishes) || dishes.length === 0) return '';
  const items = dishes.map(d => `
    <div class="dish-item ${d.is_signature ? 'dish-item--signature' : ''}">
      ${d.name_th ? `<span class="dish-item__name-th">${escapeHTML(d.name_th)}</span>` : ''}
      ${d.name_en ? `<span class="dish-item__name-en">${escapeHTML(d.name_en)}</span>` : ''}
      ${d.price_approx ? `<span class="dish-item__price">฿${escapeHTML(String(d.price_approx))}</span>` : ''}
      ${d.notes ? `<p class="dish-item__notes">${escapeHTML(d.notes)}</p>` : ''}
      ${d.is_signature ? `<span class="dish-item__badge">Signature</span>` : ''}
    </div>
  `).join('');
  return `<section class="dishes-section">
    <h3 class="dishes-section__heading">Known for</h3>
    ${items}
  </section>`;
}

/* ── Star rating HTML builder ────────────────────────────── */
// Spec: docs/design/MISSING_FEATURES.md — MISSING-09
// interactive=false: read-only display on cards — returns '' if no rating
// interactive=true: 5 tappable buttons on detail view — always shown
// Tapping same star as current rating clears to null

function starRatingHTML(rating, restaurantId, interactive = false) {
  if (!interactive && (!rating || rating === 0)) return '';

  const stars = [1, 2, 3, 4, 5].map(n => {
    const filled = rating && n <= rating;
    if (interactive) {
      return `<button class="star-btn${filled ? ' star-btn--filled' : ''}" data-action="rate" data-rating="${n}" data-restaurant-id="${restaurantId}" aria-label="${n} star${n > 1 ? 's' : ''}" aria-pressed="${filled ? 'true' : 'false'}">★</button>`;
    }
    return `<span class="star${filled ? ' star--filled' : ''}">★</span>`;
  }).join('');

  return `<div class="star-rating${interactive ? ' star-rating--interactive' : ''}" role="${interactive ? 'group' : 'img'}" aria-label="Rating: ${rating || 0} out of 5">${stars}</div>`;
}

/* ── Photo strip builder ────────────────────────────────── */
// Spec: docs/design/MISSING_FEATURES.md — MISSING-05
// Priority: identification_photo_url → cart/sign → exterior → dish/interior
// Maximum 3 photos shown. Uses scroll-snap for swipe behaviour.
// openBadgeHTML + overlaysHTML (city badge, wishlist, visited) are absolutely
// positioned within the strip.

function photoStripHTML(restaurant, openBadgeHTML, overlaysHTML) {
  const photos = [];

  // Priority 1: Identification photo
  if (restaurant.identification_photo_url) {
    photos.push({
      url: restaurant.identification_photo_url,
      alt: 'Restaurant entrance',
      type: 'identification'
    });
  }

  // Priority 2–4: Numbered photos (cart, exterior, dish/interior)
  if (restaurant.photos && Array.isArray(restaurant.photos)) {
    restaurant.photos.forEach(p => {
      if (photos.length < 3) {
        photos.push({
          url: p.url,
          alt: p.caption || 'Restaurant photo',
          type: p.type || 'other'
        });
      }
    });
  }

  // No photos — show empty state
  if (photos.length === 0) {
    return `<div class="photo-strip photo-strip--empty">
      <div class="photo-strip__placeholder">📷</div>
    </div>`;
  }

  const photoHTML = photos.map((p, i) => `
    <div class="photo-strip__item">
      <img src="${escapeHTML(p.url)}" alt="${escapeHTML(p.alt)}" loading="lazy" />
    </div>
  `).join('');

  return `<div class="photo-strip">
    ${openBadgeHTML}
    ${overlaysHTML}
    ${photoHTML}
  </div>`;
}

/* ── Card HTML builder ────────────────────────────────────── */
// Spec: docs/design/MISSING_FEATURES.md — MISSING-05 (photo strip),
//       MISSING-06 (dishes), MISSING-09 (star rating),
//       MISSING-08 (meal periods), MISSING-02 (distance)
// Returns one <div class="card"> with: photo, title, distance, meal periods,
// dishes preview, price range, wishlist / visited buttons, star rating.

function cardHTML(restaurant) {
  const personal = state.personalData.get(restaurant.id) || {};
  const distance = formatDistance(restaurant._distanceMetres, restaurant.location_precision);
  const openStatus = isOpenNow(restaurant.opening_hours);

  // Open status badge
  const openBadgeHTML = openStatus === 'open'
    ? `<span class="badge badge--open">Open now</span>`
    : openStatus === 'closed'
      ? `<span class="badge badge--closed">Closed</span>`
      : '';

  // Wishlist + Visited overlay
  const overlaysHTML = `
    <div class="card__overlays">
      <button class="card__wishlist-btn${personal.is_wishlisted ? ' card__wishlist-btn--active' : ''}" data-action="toggle-wishlist" data-restaurant-id="${restaurant.id}" aria-label="${personal.is_wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}">♡</button>
      <button class="card__visited-btn${personal.is_visited ? ' card__visited-btn--active' : ''}" data-action="toggle-visited" data-restaurant-id="${restaurant.id}" aria-label="${personal.is_visited ? 'Mark as not visited' : 'Mark as visited'}">✓</button>
    </div>
  `;

  const photoHTML = photoStripHTML(restaurant, openBadgeHTML, overlaysHTML);
  const dishesHTML = dishesPreviewHTML(restaurant.dishes);
  const ratingHTML = starRatingHTML(personal.my_rating, restaurant.id, false);

  // Meal period icons (breakfast, lunch, dinner, late_night)
  const mealPeriods = [];
  if (isOpenDuringPeriod('breakfast', restaurant.opening_hours)) mealPeriods.push('🥐');
  if (isOpenDuringPeriod('lunch', restaurant.opening_hours)) mealPeriods.push('🍜');
  if (isOpenDuringPeriod('dinner', restaurant.opening_hours)) mealPeriods.push('🍽');
  if (isOpenDuringPeriod('late_night', restaurant.opening_hours)) mealPeriods.push('🌙');
  const mealPeriodsHTML = mealPeriods.length > 0
    ? `<div class="card__meal-periods">${mealPeriods.join(' ')}</div>`
    : '';

  // Distance line
  const distanceHTML = distance
    ? `<div class="card__distance">${escapeHTML(distance)}</div>`
    : '';

  // Price range
  const priceRange = restaurant.price_range
    ? `<span class="card__price-range">${escapeHTML(restaurant.price_range)}</span>`
    : '';

  const cuisinesHTML = restaurant.cuisine_types && restaurant.cuisine_types.length > 0
    ? `<span class="card__cuisines">${escapeHTML(restaurant.cuisine_types.slice(0, 2).join(', '))}</span>`
    : '';

  return `<div class="card" data-restaurant-id="${restaurant.id}">
    ${photoHTML}
    <div class="card__content">
      <h2 class="card__title">${escapeHTML(restaurant.name_en || restaurant.name_th)}</h2>
      ${distanceHTML}
      ${mealPeriodsHTML}
      <div class="card__meta">
        ${priceRange}
        ${cuisinesHTML}
      </div>
      ${dishesHTML}
      ${ratingHTML}
    </div>
  </div>`;
}

/* ============================================================
   DETAIL VIEW HTML
   ============================================================ */

function detailViewHTML(restaurant) {
  const personal = state.personalData.get(restaurant.id) || {};
  const openStatus = isOpenNow(restaurant.opening_hours);

  const openBadgeHTML = openStatus === 'open'
    ? `<div class="badge badge--open">Open now</div>`
    : openStatus === 'closed'
      ? `<div class="badge badge--closed">Closed</div>`
      : '';

  // Photo strip with wishlist / visited overlay
  const overlaysHTML = `
    <div class="detail__overlays">
      <button class="detail__wishlist-btn${personal.is_wishlisted ? ' detail__wishlist-btn--active' : ''}" data-action="toggle-wishlist" data-restaurant-id="${restaurant.id}" aria-label="${personal.is_wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}">♡</button>
      <button class="detail__visited-btn${personal.is_visited ? ' detail__visited-btn--active' : ''}" data-action="toggle-visited" data-restaurant-id="${restaurant.id}" aria-label="${personal.is_visited ? 'Mark as not visited' : 'Mark as visited'}">✓</button>
    </div>
  `;
  const photoHTML = photoStripHTML(restaurant, openBadgeHTML, overlaysHTML);

  // Contact info
  let contactHTML = '';
  if (restaurant.phone || restaurant.website) {
    contactHTML = `<section class="contact-section">
      ${restaurant.phone ? `<a href="tel:${encodeURIComponent(restaurant.phone)}" class="contact-link phone-link">📞 ${escapeHTML(restaurant.phone)}</a>` : ''}
      ${restaurant.website ? `<a href="${escapeHTML(restaurant.website)}" class="contact-link website-link" target="_blank" rel="noopener">🌐 Website</a>` : ''}
    </section>`;
  }

  // Michelin badge
  let michelinHTML = '';
  if (restaurant.michelin_stars && restaurant.michelin_stars > 0) {
    michelinHTML = `<div class="michelin-badge">⭐ ${restaurant.michelin_stars}-star Michelin</div>`;
  } else if (restaurant.michelin_bib) {
    michelinHTML = `<div class="michelin-badge">Bib Gourmand</div>`;
  }

  // Attributes (halal, vegetarian)
  const attrsHTML = [
    restaurant.is_halal ? '<span class="attr-badge attr-badge--halal">Halal</span>' : '',
    restaurant.is_vegetarian_friendly ? '<span class="attr-badge attr-badge--veg">Vegetarian-friendly</span>' : ''
  ].filter(Boolean).join('');
  const attributesHTML = attrsHTML
    ? `<div class="detail__attributes">${attrsHTML}</div>`
    : '';

  // Meal periods
  const mealPeriods = [];
  if (isOpenDuringPeriod('breakfast', restaurant.opening_hours)) mealPeriods.push('🥐 Breakfast');
  if (isOpenDuringPeriod('lunch', restaurant.opening_hours)) mealPeriods.push('🍜 Lunch');
  if (isOpenDuringPeriod('dinner', restaurant.opening_hours)) mealPeriods.push('🍽 Dinner');
  if (isOpenDuringPeriod('late_night', restaurant.opening_hours)) mealPeriods.push('🌙 Late night');
  const mealPeriodsHTML = mealPeriods.length > 0
    ? `<div class="detail__meal-periods"><strong>Available:</strong> ${escapeHTML(mealPeriods.join(' · '))}</div>`
    : '';

  // Star rating (interactive)
  const ratingHTML = starRatingHTML(personal.my_rating, restaurant.id, true);

  // Dishes
  const dishesHTML = dishesDetailHTML(restaurant.dishes);

  // Location block (directions)
  const locationHTML = locationBlockHTML(restaurant);

  return `
    ${photoHTML}
    <div class="detail__content">
      <h1 class="detail__title">${escapeHTML(restaurant.name_en || restaurant.name_th)}</h1>
      ${openBadgeHTML}
      ${michelinHTML}
      ${attributesHTML}
      ${mealPeriodsHTML}
      <div class="detail__tagline">${escapeHTML(restaurant.tagline || '')}</div>
      ${ratingHTML}
      ${contactHTML}
      ${locationHTML}
      ${dishesHTML}
    </div>
  `;
}

/* ============================================================
   FILTERS & SEARCH
   ============================================================ */

function applyFiltersAndSearch() {
  // Filter by view mode (all / wishlist / visited)
  let items = state.restaurants;

  if (state.viewMode === 'wishlist') {
    items = items.filter(r => {
      const personal = state.personalData.get(r.id);
      return personal && personal.is_wishlisted;
    });
  } else if (state.viewMode === 'visited') {
    items = items.filter(r => {
      const personal = state.personalData.get(r.id);
      return personal && personal.is_visited;
    });
  }

  // Filter by active filters (cuisine, price range, halal, vegetarian, michelin)
  items = items.filter(r => {
    for (const [filterKey, filterValue] of Object.entries(state.activeFilters)) {
      if (!filterValue) continue; // Filter is not active

      if (filterKey === 'cuisine') {
        if (!r.cuisine_types || !r.cuisine_types.includes(filterValue)) return false;
      } else if (filterKey === 'price_range') {
        if (r.price_range !== filterValue) return false;
      } else if (filterKey === 'halal') {
        if (!r.is_halal) return false;
      } else if (filterKey === 'vegetarian') {
        if (!r.is_vegetarian_friendly) return false;
      } else if (filterKey === 'michelin') {
        if (filterValue === 'michelin_stars') {
          if (!r.michelin_stars || r.michelin_stars < 1) return false;
        } else if (filterValue === 'bib_gourmand') {
          if (!r.michelin_bib) return false;
        }
      }
    }
    return true;
  });

  // Free-text search (name, cuisine, area, city, tagline)
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    items = items.filter(r => {
      const searchable = [
        r.name_en,
        r.name_th,
        (r.cuisine_types || []).join(' '),
        r.area,
        r.city,
        r.tagline
      ].join(' ').toLowerCase();
      return searchable.includes(q);
    });
  }

  // Sort
  if (state.sortOrder === 'nearest' && state.userLat && state.userLng) {
    // Already sorted by distance from RPC, but re-sort to be sure
    items.sort((a, b) => {
      const distA = a._distanceMetres || Infinity;
      const distB = b._distanceMetres || Infinity;
      return distA - distB;
    });
  } else {
    // Sort by rating
    items.sort((a, b) => (b.wongnai_rating || 0) - (a.wongnai_rating || 0));
  }

  state.filtered = items;

  // Render UI
  if (state.activeView === 'list') {
    renderCardList();
  } else if (state.activeView === 'map') {
    renderPins(state.filtered);
  }
}

function renderCardList() {
  if (!dom.cardList) return;

  if (state.filtered.length === 0) {
    if (dom.emptyState) {
      dom.emptyState.style.display = 'flex';
      dom.emptyState.removeAttribute('hidden');
    }
    dom.cardList.style.display = 'none';
    dom.cardList.innerHTML = '';
    return;
  }

  if (dom.emptyState) dom.emptyState.style.display = 'none';

  const html = state.filtered.map(r => cardHTML(r)).join('');
  dom.cardList.innerHTML = html;
  dom.cardList.style.display = 'flex';

  // Attach event listeners
  attachCardListeners();
}

function attachCardListeners() {
  // Card taps → detail view
  document.querySelectorAll('[data-restaurant-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      // Ignore clicks on buttons (wishlist, visited, star rating)
      if (e.target.tagName === 'BUTTON' && e.target.dataset.action) return;
      // Ignore clicks on links
      if (e.target.tagName === 'A') return;

      const restaurantId = parseInt(el.dataset.restaurantId, 10);
      showDetail(restaurantId);
    });
  });

  // Wishlist buttons
  document.querySelectorAll('[data-action="toggle-wishlist"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const restaurantId = parseInt(btn.dataset.restaurantId, 10);
      const personal = state.personalData.get(restaurantId) || {};
      const nextValue = !personal.is_wishlisted;
      upsertPersonalData(restaurantId, { is_wishlisted: nextValue });
      // Re-render (or just update UI state)
      applyFiltersAndSearch();
    });
  });

  // Visited buttons
  document.querySelectorAll('[data-action="toggle-visited"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const restaurantId = parseInt(btn.dataset.restaurantId, 10);
      const personal = state.personalData.get(restaurantId) || {};
      const nextValue = !personal.is_visited;
      upsertPersonalData(restaurantId, { is_visited: nextValue });
      applyFiltersAndSearch();
    });
  });

  // Star rating buttons (on cards — read-only, no interaction)
  // Interactive star rating is only on the detail view
}

/* ============================================================
   DETAIL VIEW
   ============================================================ */

function showDetail(restaurantId) {
  const restaurant = state.restaurants.find(r => r.id === restaurantId);
  if (!restaurant) return;

  state.selectedId = restaurantId;
  state.activeView = 'detail';

  if (dom.detailBody) {
    dom.detailBody.innerHTML = detailViewHTML(restaurant);
    attachDetailListeners();
  }

  // Show detail, hide list
  if (dom.viewDetail) dom.viewDetail.style.display = 'block';
  if (dom.viewList) dom.viewList.style.display = 'none';
  if (dom.viewMap) dom.viewMap.style.display = 'none';

  // Scroll to top
  window.scrollTo(0, 0);
}

function attachDetailListeners() {
  // Back button
  if (dom.detailBack) {
    dom.detailBack.addEventListener('click', () => {
      state.selectedId = null;
      state.activeView = 'list';
      applyFiltersAndSearch();

      if (dom.viewDetail) dom.viewDetail.style.display = 'none';
      if (dom.viewList) dom.viewList.style.display = 'block';
    });
  }

  // Wishlist toggle (detail)
  document.querySelectorAll('[data-action="toggle-wishlist"][data-restaurant-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const restaurantId = parseInt(btn.dataset.restaurantId, 10);
      const personal = state.personalData.get(restaurantId) || {};
      const nextValue = !personal.is_wishlisted;
      upsertPersonalData(restaurantId, { is_wishlisted: nextValue });
      // Re-render detail
      showDetail(restaurantId);
    });
  });

  // Visited toggle (detail)
  document.querySelectorAll('[data-action="toggle-visited"][data-restaurant-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const restaurantId = parseInt(btn.dataset.restaurantId, 10);
      const personal = state.personalData.get(restaurantId) || {};
      const nextValue = !personal.is_visited;
      upsertPersonalData(restaurantId, { is_visited: nextValue });
      showDetail(restaurantId);
    });
  });

  // Star rating buttons (detail — interactive)
  document.querySelectorAll('[data-action="rate"][data-restaurant-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const restaurantId = parseInt(btn.dataset.restaurantId, 10);
      const rating = parseInt(btn.dataset.rating, 10);
      const personal = state.personalData.get(restaurantId) || {};

      // Tapping the same star clears the rating to null
      const nextRating = personal.my_rating === rating ? null : rating;

      upsertPersonalData(restaurantId, { my_rating: nextRating });
      showDetail(restaurantId);
    });
  });

  // Directions button
  document.querySelectorAll('[data-action="directions"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const restaurantId = parseInt(btn.dataset.restaurantId, 10);
      const restaurant = state.restaurants.find(r => r.id === restaurantId);
      if (restaurant) {
        showNavChoiceSheet(restaurant);
      }
    });
  });
}

/* ============================================================
   MAP VIEW
   ============================================================ */

function initMap() {
  // Initialize Leaflet map
  state.map = L.map('map').setView(
    [CONFIG.mapDefaultLat, CONFIG.mapDefaultLng],
    CONFIG.mapDefaultZoom
  );

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(state.map);

  // Render pins for currently filtered restaurants
  renderPins(state.filtered);
}

function renderPins(restaurants) {
  if (!state.map) return;

  // Clear existing pins
  state.mapPins.forEach(layer => state.map.removeLayer(layer));
  state.mapPins.clear();

  // Add pins for each restaurant
  restaurants.forEach(r => {
    if (!r.lat || !r.lng) return;

    const marker = L.circleMarker([r.lat, r.lng], {
      radius: 8,
      fillColor: isOpenNow(r.opening_hours) === 'open' ? '#2ecc71' : '#e74c3c',
      color: '#000',
      weight: 1,
      opacity: 1,
      fillOpacity: 0.7
    });

    marker.on('click', () => {
      showDetail(r.id);
      state.activeView = 'detail';

      if (dom.viewDetail) dom.viewDetail.style.display = 'block';
      if (dom.viewList) dom.viewList.style.display = 'none';
      if (dom.viewMap) dom.viewMap.style.display = 'none';
    });

    marker.bindPopup(`<strong>${escapeHTML(r.name_en || r.name_th)}</strong>`);
    marker.addTo(state.map);
    state.mapPins.set(r.id, marker);
  });

  // Re-fit bounds to all pins
  if (restaurants.length > 0) {
    const bounds = L.latLngBounds(restaurants.map(r => [r.lat, r.lng]));
    state.map.fitBounds(bounds, { padding: [40, 40] });
  }
}

/* ============================================================
   SEARCH INPUT
   ============================================================ */

function initSearch() {
  const searchInput = document.getElementById('search-input');
  const searchClearBtn = document.getElementById('search-clear-btn');

  if (!searchInput) return;

  // Debounce search input
  let searchTimeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.searchQuery = e.target.value.trim();
      applyFiltersAndSearch();
    }, 300);
  });

  // Clear button
  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', () => {
      state.searchQuery = '';
      searchInput.value = '';
      applyFiltersAndSearch();
    });
  }
}

/* ============================================================
   VIEW MODE (WISHLIST / VISITED)
   ============================================================ */

function initViewToggle() {
  const viewToggle = document.getElementById('view-toggle');
  if (!viewToggle) return;

  const buttons = viewToggle.querySelectorAll('button[data-view-mode]');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      state.viewMode = btn.dataset.viewMode || 'all';
      applyFiltersAndSearch();

      // Update active state
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

/* ============================================================
   SORT SHEET
   ============================================================ */

function initSortSheet() {
  const sortSheetOverlay = document.getElementById('sort-sheet-overlay');
  const sortSheet = document.getElementById('sort-sheet');
  const navMap = document.getElementById('nav-map');

  if (!sortSheetOverlay || !sortSheet) return;

  // Trigger from nav-map button
  if (navMap) {
    navMap.addEventListener('click', () => {
      sortSheetOverlay.classList.add('sort-sheet-overlay--visible');
    });
  }

  // Sort options
  const sortOptions = sortSheet.querySelectorAll('[data-sort-order]');
  sortOptions.forEach(option => {
    option.addEventListener('click', () => {
      state.sortOrder = option.dataset.sortOrder || 'rating';
      applyFiltersAndSearch();

      // Update active state
      sortOptions.forEach(o => o.classList.remove('active'));
      option.classList.add('active');

      // Close sheet
      sortSheetOverlay.classList.remove('sort-sheet-overlay--visible');
    });
  });

  // Close on overlay click
  sortSheetOverlay.addEventListener('click', (e) => {
    if (e.target === sortSheetOverlay) {
      sortSheetOverlay.classList.remove('sort-sheet-overlay--visible');
    }
  });
}

/* ============================================================
   TOAST NOTIFICATIONS
   ============================================================ */

function showToast(message, type = 'info') {
  if (!dom.toastContainer) return;

  const toastEl = document.createElement('div');
  toastEl.className = `toast toast--${type}`;
  toastEl.textContent = message;
  dom.toastContainer.appendChild(toastEl);

  // Auto-remove after 3s
  setTimeout(() => {
    toastEl.remove();
  }, 3000);
}

/* ============================================================
   UTILITY: HTML ESCAPING
   ============================================================ */

function escapeHTML(str) {
  if (!str) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return str.replace(/[&<>"']/g, m => map[m]);
}

/* ============================================================
   INIT
   ============================================================ */

async function init() {
  // Load personal ID from localStorage
  state.personalId = getOrCreatePersonalId();

  // Load personal data (wishlist, visited, rating)
  await loadPersonalData();

  // Fetch restaurants
  await fetchRestaurants();

  // Render location notice
  renderLocationNotice();

  // Initialize UI components
  initKeyboardHandler();
  initSearch();
  initViewToggle();
  initSortSheet();

  // Initialize detail view back button listener
  if (dom.detailBack) {
    dom.detailBack.addEventListener('click', () => {
      state.selectedId = null;
      state.activeView = 'list';
      applyFiltersAndSearch();

      if (dom.viewDetail) dom.viewDetail.style.display = 'none';
      if (dom.viewList) dom.viewList.style.display = 'block';
    });
  }

  // View switcher (list ↔ map)
  const navList = document.getElementById('nav-list');
  const navMap = document.getElementById('nav-map');

  if (navList) {
    navList.addEventListener('click', () => {
      state.activeView = 'list';
      if (dom.viewList) dom.viewList.style.display = 'block';
      if (dom.viewMap) dom.viewMap.style.display = 'none';
      applyFiltersAndSearch();
    });
  }

  if (navMap) {
    navMap.addEventListener('click', () => {
      state.activeView = 'map';
      if (dom.viewList) dom.viewList.style.display = 'none';
      if (dom.viewMap) dom.viewMap.style.display = 'block';

      // Initialize map on first view
      if (!state.map) {
        initMap();
      } else {
        state.map.invalidateSize();
        renderPins(state.filtered);
      }
    });
  }

  // Render initial list
  applyFiltersAndSearch();

  // Handle URL hash routing (for links like #/restaurants/123)
  async function handleRoute(hash) {
    if (!hash || hash === '#') return;

    const match = hash.match(/#\/restaurants\/(\d+)/);
    if (match) {
      const restaurantId = parseInt(match[1], 10);
      showDetail(restaurantId);
    }
  }

  const currentHash = window.location.hash;
  if (currentHash && currentHash !== '#') {
    state.pendingRoute = currentHash;
    // Wait for data to load before routing
    const timeout = setInterval(() => {
      if (state.restaurants.length > 0) {
        clearInterval(timeout);
        const pending = state.pendingRoute;
        state.pendingRoute = null;
        handleRoute(pending);
      }
    }, 100);
  }

  // Route on hash change
  window.addEventListener('hashchange', (e) => {
    const hash = window.location.hash;
    state.Route = null;
    handleRoute(hash);
  });
}

document.addEventListener('DOMContentLoaded', init);
