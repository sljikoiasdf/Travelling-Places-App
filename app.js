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
      .select('restaurant_id, is_wishlisted, is_visited, my_rating, notes')
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
      return `<button class="star-btn${filled ? ' star-btn--filled' : ''}" data-rating="${n}" data-restaurant-id="${restaurantId}" aria-label="${n} star${n > 1 ? 's' : ''}" aria-pressed="${filled ? 'true' : 'false'}">★</button>`;
    }
    return `<span class="star${filled ? ' star--filled' : ''}">★</span>`;
  }).join('');

  return `<div class="star-rating${interactive ? ' star-rating--interactive' : ''}" role="${interactive ? 'group' : 'img'}" aria-label="Rating: ${rating || 0} out of 5">${stars}</div>`;
}

/* ── Personal notes HTML ─────────────────────────────────── */
// Spec: docs/design/MISSING_FEATURES.md — MISSING-10
// Textarea pre-filled with existing notes. Auto-saves with 1000ms debounce.
// "Saved" indicator shows for 1.5s after successful write.
// Offline: toast shown, save skipped.

function personalNotesHTML(notes, restaurantId) {
  const safe = notes ? notes.replace(/</g, '&lt;') : '';
  return `<div class="personal-notes">
    <label class="personal-notes__label" for="personal-notes-${restaurantId}">Your notes</label>
    <textarea class="personal-notes__input" id="personal-notes-${restaurantId}" data-restaurant-id="${restaurantId}" placeholder="Add your own notes…" rows="3">${safe}</textarea>
    <span class="personal-notes__saved" id="personal-notes-saved-${restaurantId}">Saved</span>
  </div>`;
}

function attachPersonalNotesListener(restaurantId) {
  const textarea = document.getElementById(`personal-notes-${restaurantId}`);
  const savedEl  = document.getElementById(`personal-notes-saved-${restaurantId}`);
  if (!textarea) return;
  let notesDebounceTimer;
  textarea.addEventListener('input', () => {
    if (!navigator.onLine) { showToast("Can't save while offline", 'error'); return; }
    clearTimeout(notesDebounceTimer);
    notesDebounceTimer = setTimeout(async () => {
      const value = textarea.value.trim();
      await upsertPersonalData(restaurantId, { notes: value });
      if (savedEl) {
        savedEl.classList.add('personal-notes__saved--visible');
        setTimeout(() => savedEl.classList.remove('personal-notes__saved--visible'), 1500);
      }
    }, 1000);
  });
}

/* ── Photo strip builder ────────────────────────────────── */
// Spec: docs/design/MISSING_FEATURES.md — MISSING-05
// Priority: identification_photo_url → cart/sign → exterior → dish/interior
// Maximum 3 photos shown. Uses scroll-snap for swipe behaviour.
// openBadgeHTML + overlaysHTML (city badge, wishlist, visited) are absolutely
// positioned within the strip.

function photoStripHTML(restaurant, openBadgeHTML, overlaysHTML) {
  const photos = [];

  // Step 1: identification photo always first
  if (restaurant.identification_photo_url) {
    photos.push({ url: restaurant.identification_photo_url, type: 'identification' });
  }

  // Step 2: sort restaurant.photos[] by type priority, de-dup against identification
  if (Array.isArray(restaurant.photos)) {
    const typePriority = { cart: 0, sign: 1, exterior: 2, dish: 3, interior: 4 };
    const sorted = [...restaurant.photos].sort((a, b) =>
      (typePriority[a.type] ?? 9) - (typePriority[b.type] ?? 9)
    );
    sorted.forEach(p => {
      if (photos.length < 5 && p.url !== restaurant.identification_photo_url) {
        photos.push(p);
      }
    });
  }

  // No photos: render cuisine placeholder
  if (photos.length === 0) {
    const cuisineText = Array.isArray(restaurant.cuisine_types) && restaurant.cuisine_types.length
      ? restaurant.cuisine_types.slice(0, 2).map(c => c.replace(/_/g, ' ')).join(' · ')
      : 'Thai cuisine';
    return `<div class="card__photo-placeholder">
      <span class="card__cuisine-label">${escapeHTML(cuisineText)}</span>
      ${openBadgeHTML}
      ${overlaysHTML}
    </div>`;
  }

  // Render strip — max 3 photos
  const slides = photos.slice(0, 3).map(p =>
    `<img class="card__photo-slide" src="${escapeHTML(p.url)}" alt="" loading="lazy" decoding="async">`
  ).join('');

  return `<div class="card__photo-strip">
    ${slides}
    ${openBadgeHTML}
    ${overlaysHTML}
  </div>`;
}

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
  const map = { bangkok: 'badge--bangkok', chiang_mai: 'badge--chiangmai', koh_chang: 'badge--kohchang' };
  return map[city] || '';
}

function cityLabel(city) {
  const map = { bangkok: 'Bangkok', chiang_mai: 'Chiang Mai', koh_chang: 'Koh Chang' };
  return map[city] || escapeHTML(city);
}

function cardHTML(r) {
  const openStatus = isOpenNow(r.opening_hours);
  const personal   = state.personalData.get(r.id) || {};

  const openClass = openStatus === 'open'   ? 'open-indicator--open'
                  : openStatus === 'closed' ? 'open-indicator--closed'
                  :                           'open-indicator--unknown';
  const openLabel = openStatus === 'open'   ? 'Open now'
                  : openStatus === 'closed' ? 'Closed'
                  :                           '';

  const wishHTML = personal.is_wishlisted
    ? `<button class="wishlist-btn wishlist-btn--active" data-action="wishlist" data-id="${r.id}" aria-label="Remove from wishlist" aria-pressed="true">♥</button>`
    : `<button class="wishlist-btn" data-action="wishlist" data-id="${r.id}" aria-label="Add to wishlist" aria-pressed="false">♡</button>`;

  const visitedHTML = personal.is_visited
    ? `<span class="visited-marker visited-marker--visited" aria-label="You've visited">✓ Visited</span>`
    : '';

  // Build 2: Photo strip (MISSING-05)
  // City abbreviation badge overlaid on photo strip
  const cityAbbrev = { bangkok: 'BKK', chiang_mai: 'CNX', koh_chang: 'KCH' };
  const cityCode = r.city ? (cityAbbrev[r.city] || cityLabel(r.city)) : '';
  const cityBadgeInStrip = cityCode ? `<span class="badge badge--city">${escapeHTML(cityCode)}</span>` : '';

  const openBadgeHTML = openLabel
    ? `<span class="open-indicator ${openClass}" aria-label="${openLabel}">${openLabel}</span>`
    : '';
  const overlaysHTML = `${cityBadgeInStrip}${wishHTML}${visitedHTML}`;
  const photoAreaHTML = photoStripHTML(r, openBadgeHTML, overlaysHTML);

  const cuisineTag = Array.isArray(r.cuisine_types) && r.cuisine_types.length
    ? `<span class="badge badge--cuisine">${escapeHTML(r.cuisine_types[0].replace(/_/g, ' '))}</span>` : '';
  const priceTag = r.price_range
    ? `<span class="badge badge--price" aria-label="Price range ${r.price_range}">${'฿'.repeat(r.price_range)}</span>` : '';
  const michelinTag = r.michelin_stars > 0
    ? `<span class="badge badge--michelin">${'★'.repeat(r.michelin_stars)}</span>`
    : r.michelin_bib ? `<span class="badge badge--michelin">Bib</span>` : '';
  const halalTag = r.is_halal ? `<span class="badge badge--halal">Halal</span>` : '';
  const cityTag  = r.city ? `<span class="badge ${cityBadgeClass(r.city)}">${cityLabel(r.city)}</span>` : '';

  // Build 2: Distance display (MISSING-02)
  const precision = r.location_precision || 'no_location';
  let distanceText = '';
  if (precision === 'area_only') {
    const areaName = r.area ? r.area.replace(/_/g, ' ') : null;
    distanceText = areaName ? `<span class="card__distance card__distance--area-only">${escapeHTML(areaName)}</span>` : '';
  } else if (precision === 'no_location') {
    distanceText = `<span class="card__distance">Find locally</span>`;
  } else {
    const fd = formatDistance(r._distanceMetres, precision);
    if (fd) {
      const cls = precision === 'approximate' ? 'card__distance card__distance--approximate' : 'card__distance';
      distanceText = `<span class="${cls}">${fd}</span>`;
    }
  }

  return `
<article class="card" role="listitem" data-id="${r.id}" aria-label="${escapeHTML(r.name_en || r.name_th)}">
  ${photoAreaHTML}
  <div class="card__body">
    <h2 class="card__name-thai">${escapeHTML(r.name_th || r.name_en)}</h2>
    ${r.name_en && r.name_th ? `<p class="card__name-english">${escapeHTML(r.name_en)}</p>` : ''}
    ${r.tagline ? `<p class="card__tagline">${escapeHTML(r.tagline)}</p>` : ''}
    <div class="card__meta">${cuisineTag}${priceTag}${distanceText}${michelinTag}${halalTag}${cityTag}</div>
    ${r.area ? `<p class="card__location">${escapeHTML(r.area.replace(/_/g, ' '))}</p>` : ''}
    ${dishesPreviewHTML(r.dishes)}
    ${starRatingHTML(state.personalData.get(r.id)?.my_rating, r.id, false)}
    <div class="card__actions">
      <button class="directions-btn" data-action="directions" data-restaurant-id="${r.id}" aria-label="Directions to ${escapeHTML(r.name_en || r.name_th)}">Directions</button>
    </div>
  </div>
</article>`;
}

/* ============================================================
   MAP
   ============================================================ */

const MAP_TILE_URL  = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const MAP_TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function initMap() {
  if (state.map) return;
  if (typeof L === 'undefined') {
    console.error('[map] Leaflet not loaded — cannot initialise map');
    return;
  }
  state.map = L.map(dom.mapContainer, {
    center: [CONFIG.mapDefaultLat, CONFIG.mapDefaultLng],
    zoom:   CONFIG.mapDefaultZoom,
    zoomControl: true,
    attributionControl: true,
  });
  L.tileLayer(MAP_TILE_URL, { attribution: MAP_TILE_ATTR, maxZoom: 19 }).addTo(state.map);
  setTimeout(() => state.map.invalidateSize(), 50);
}

function renderPins(restaurants) {
  if (!state.map) return;
  state.mapPins.forEach(marker => marker.remove());
  state.mapPins.clear();

  restaurants.forEach(r => {
    if (!r.lat || !r.lng) return;
    const openStatus = isOpenNow(r.opening_hours);
    const personal   = state.personalData.get(r.id) || {};
    const classes    = ['map-pin'];
    if (openStatus === 'open')        classes.push('map-pin--open');
    else if (openStatus === 'closed') classes.push('map-pin--closed');
    if (personal.is_visited)          classes.push('map-pin--visited');
    if (personal.is_wishlisted)       classes.push('map-pin--wishlisted');
    if (r.id === state.selectedId)    classes.push('map-pin--selected');

    // Use tagline as pin label (tells you what the place IS), fall back to English name
    const fullName  = r.name_en || r.name_th || '';
    const rawLabel  = r.tagline || fullName;
    const pinLabel  = rawLabel.length > 22 ? rawLabel.slice(0, 21) + '…' : rawLabel;

    // Status indicator: dot + label for open/closed, nothing for unknown
    const statusHTML = openStatus === 'open'
      ? `<span class="map-pin__dot"></span><span class="map-pin__status">Open</span>`
      : openStatus === 'closed'
        ? `<span class="map-pin__dot"></span><span class="map-pin__status">Closed</span>`
        : '';

    const icon = L.divIcon({
      className: '',
      html: `<div class="${classes.join(' ')}" aria-label="${escapeHTML(fullName)}">${statusHTML}<span class="map-pin__name">${escapeHTML(pinLabel)}</span><div class="map-pin__tail"></div></div>`,
      iconSize:   [0, 0],
      iconAnchor: [0, 0],
    });

    const marker = L.marker([r.lat, r.lng], { icon }).addTo(state.map);
    marker.on('click', () => openDetail(r.id));
    state.mapPins.set(r.id, marker);
  });
}

function selectMapPin(id) {
  state.mapPins.forEach((marker, markerId) => {
    const el = marker.getElement()?.querySelector('.map-pin');
    if (!el) return;
    el.classList.toggle('map-pin--selected', markerId === id);
  });
  const marker = state.mapPins.get(id);
  if (marker && state.map) state.map.panTo(marker.getLatLng(), { animate: true });
}

/* ============================================================
   FILTERS
   ============================================================ */

function buildFilterChips() {
  const container = dom.filterChips;
  if (!container) return;
  const chips = [];

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

  const lower = query.toLowerCase();

  const dishNames = (restaurant.dishes || [])
    .flatMap(d => [d.name_th, d.name_en, d.notes])
    .filter(Boolean);

  const haystack = [
    restaurant.name_th,
    restaurant.name_en,
    restaurant.area,
    restaurant.area_th,
    restaurant.notes,
    restaurant.cart_identifier,
    ...dishNames
  ].filter(Boolean).join(' ').toLowerCase();

  return haystack.includes(lower);
}

/* ── Filter + search unified ─────────────────────────────── */
// Spec: docs/design/MISSING_FEATURES.md — MISSING-07
// Called after any filter change, search input change, or data load.
// Applies: viewMode → filters → search query → sort → renderList

function applyFiltersAndSearch() {
  let results = [...state.restaurants];

  // 1. View mode (All / Wishlist / Visited) — B2_16
  if (state.viewMode === 'wishlist') {
    results = results.filter(r => {
      const p = state.personalData.get(r.id);
      return p && p.is_wishlisted;
    });
  } else if (state.viewMode === 'visited') {
    results = results.filter(r => {
      const p = state.personalData.get(r.id);
      return p && p.is_visited;
    });
  }

  // 2. Existing filter logic
  if (state.activeFilters.city)        results = results.filter(r => r.city === state.activeFilters.city);
  if (state.activeFilters.cuisine)     results = results.filter(r => Array.isArray(r.cuisine_types) && r.cuisine_types.includes(state.activeFilters.cuisine));
  if (state.activeFilters.price_range) results = results.filter(r => r.price_range === Number(state.activeFilters.price_range));
  if (state.activeFilters.open_now)    results = results.filter(r => isOpenNow(r.opening_hours) === 'open');
  if (state.activeFilters.halal)       results = results.filter(r => r.is_halal);
  if (state.activeFilters.michelin)    results = results.filter(r => r.michelin_stars > 0 || r.michelin_bib);

  // 3. Meal period filter (from STEP_B2_13) — guarded until implemented
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

  // 6. Sort — guarded until STEP_B2_19 implements sortRestaurants()
  if (typeof sortRestaurants === 'function') {
    results = sortRestaurants(results, state.sortOrder);
  }

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
    dom.cardList.innerHTML = '';
    if (dom.emptyState) {
      dom.emptyState.removeAttribute('hidden');
      dom.emptyState.style.display = 'flex';
    }
    return;
  }
  if (dom.emptyState) dom.emptyState.style.display = 'none';
  dom.cardList.innerHTML = restaurants.map(cardHTML).join('');
}

/* ============================================================
   ROUTER — hash-based navigation
   #map (default), #list, #restaurant/{slug}
   ============================================================ */

function initRouter() {
  window.addEventListener('hashchange', () => handleRoute(window.location.hash));
  handleRoute(window.location.hash);
}

function handleRoute(hash) {
  if (!hash) hash = '';

  if (hash.startsWith('#restaurant/')) {
    const slug = decodeURIComponent(hash.slice(12));
    if (state.restaurants.length === 0) {
      // Data not yet loaded — store pending and handle after fetch
      state.pendingRoute = hash;
      return;
    }
    const r = state.restaurants.find(r => r.slug === slug) ||
              state.restaurants.find(r => String(r.id) === slug);
    if (r) {
      renderDetailPage(r);
    } else {
      window.location.replace('#map');
    }
  } else if (hash === '#list') {
    hideDetailPage();
    applyView('list');
  } else {
    // '#map', '' or anything else
    hideDetailPage();
    applyView('map');
  }
}

/* ── View management ──────────────────────────────────────── */

function applyView(view) {
  state.activeView = view;
  const isList = view === 'list';

  dom.viewList.classList.toggle('view--active', isList);
  dom.viewList.setAttribute('aria-hidden', String(!isList));
  dom.viewMap.classList.toggle('view--active', !isList);
  dom.viewMap.setAttribute('aria-hidden', String(isList));

  dom.navList.setAttribute('aria-pressed', String(isList));
  dom.navList.classList.toggle('nav-item--active', isList);
  dom.navMap.setAttribute('aria-pressed', String(!isList));
  dom.navMap.classList.toggle('nav-item--active', !isList);

  if (!isList) {
    initMap();
    setTimeout(() => {
      if (state.map) {
        state.map.invalidateSize();
        renderPins(state.filtered);
      }
    }, 50);
  }
}

/* ── Detail page ──────────────────────────────────────────── */

function openDetail(id) {
  const r = state.restaurants.find(r => r.id === id);
  if (!r) return;
  const key = r.slug || String(r.id);
  window.location.hash = '#restaurant/' + encodeURIComponent(key);
}

function renderDetailPage(r) {
  state.selectedId = r.id;
  if (state.activeView === 'map') selectMapPin(r.id);

  dom.detailTitle.textContent = r.name_th || r.name_en;

  const personal   = state.personalData.get(r.id) || {};
  const openStatus = isOpenNow(r.opening_hours);

  // Primary photo
  const photos       = Array.isArray(r.photos) ? r.photos : [];
  const primaryPhoto = photos.find(p => p.is_primary) || photos[0];
  const photosHTML   = primaryPhoto
    ? `<div class="detail-photo"><img src="${escapeHTML(primaryPhoto.url)}" alt="${escapeHTML(r.name_en || r.name_th)} photo" loading="eager" decoding="async"></div>`
    : '';

  // Status
  const openClass = openStatus === 'open'   ? 'open-indicator--open'
                  : openStatus === 'closed' ? 'open-indicator--closed'
                  :                           'open-indicator--unknown';
  const openLabel = openStatus === 'open'   ? 'Open now'
                  : openStatus === 'closed' ? 'Closed'
                  :                           'Hours unknown';

  // Hours rows
  const dayNames  = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  const hoursRows = r.opening_hours
    ? Object.entries(dayNames).map(([key, label]) =>
        `<div class="detail-row"><span class="detail-row__label">${label}</span><span class="detail-row__value">${formatDayHours(r.opening_hours[key])}</span></div>`
      ).join('')
    : '<div class="detail-row"><span class="detail-row__value">Hours not available</span></div>';

  const cuisineDisplay = Array.isArray(r.cuisine_types)
    ? r.cuisine_types.map(c => c.replace(/_/g, ' ')).join(', ') : '';

  // Build 2: Distance display in detail view (MISSING-02)
  const detailPrecision = r.location_precision || 'no_location';
  let detailDistance = '';
  if (detailPrecision === 'area_only' && r.area) {
    detailDistance = `<span class="precision-badge">📍 ${escapeHTML(r.area.replace(/_/g, ' '))}</span>`;
  } else if (detailPrecision === 'no_location') {
    detailDistance = `<span class="precision-badge">Find locally</span>`;
  } else {
    const fd = formatDistance(r._distanceMetres, detailPrecision);
    if (fd) {
      detailDistance = `<span class="precision-badge">${fd}</span>`;
    }
  }

  dom.detailBody.innerHTML = `
    <div class="detail-body__inner">
      ${photosHTML}

      <div class="detail-meta-row">
        <span class="open-indicator ${openClass}">${openLabel}</span>
        ${detailDistance}
        ${r.name_en && r.name_th ? `<p class="card__name-english">${escapeHTML(r.name_en)}</p>` : ''}
      </div>

      ${dishesDetailHTML(r.dishes)}

      ${locationBlockHTML(r)}

      <div class="detail-section">
        ${cuisineDisplay ? `<div class="detail-row"><span class="detail-row__label">Cuisine</span><span class="detail-row__value">${escapeHTML(cuisineDisplay)}</span></div>` : ''}
        ${r.city ? `<div class="detail-row"><span class="detail-row__label">City</span><span class="detail-row__value">${cityLabel(r.city)}${r.area ? ` — ${escapeHTML(r.area.replace(/_/g, ' '))}` : ''}</span></div>` : ''}
        ${r.price_range ? `<div class="detail-row"><span class="detail-row__label">Price</span><span class="detail-row__value">${'฿'.repeat(r.price_range)}</span></div>` : ''}
        ${r.is_halal ? `<div class="detail-row"><span class="detail-row__label">Halal</span><span class="detail-row__value">Yes ✓</span></div>` : ''}
        ${r.michelin_stars > 0 ? `<div class="detail-row"><span class="detail-row__label">Michelin</span><span class="detail-row__value">${'★'.repeat(r.michelin_stars)} Star${r.michelin_stars > 1 ? 's' : ''}</span></div>` : r.michelin_bib ? `<div class="detail-row"><span class="detail-row__label">Michelin</span><span class="detail-row__value">Bib Gourmand</span></div>` : ''}
        ${r.description_en ? `<div class="detail-row"><span class="detail-row__label">About</span><span class="detail-row__value">${escapeHTML(r.description_en)}</span></div>` : ''}
      </div>

      <div class="detail-section">
        <div class="detail-row detail-row--header"><span class="detail-row__label">Opening Hours</span></div>
        ${hoursRows}
      </div>

      <div class="detail-personal">
        <button class="personal-btn${personal.is_wishlisted ? ' personal-btn--active' : ''}"
                data-action="wishlist" data-id="${r.id}"
                aria-pressed="${!!personal.is_wishlisted}"
                aria-label="${personal.is_wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}">
          ${personal.is_wishlisted ? '♥ Wishlisted' : '♡ Wishlist'}
        </button>
        <button class="personal-btn${personal.is_visited ? ' personal-btn--visited' : ''}"
                data-action="visited" data-id="${r.id}"
                aria-pressed="${!!personal.is_visited}"
                aria-label="${personal.is_visited ? 'Mark as not visited' : 'Mark as visited'}">
          ${personal.is_visited ? '✓ Visited' : '○ Mark visited'}
        </button>
        ${starRatingHTML(personal.my_rating, r.id, true)}
        ${personalNotesHTML(personal.notes, r.id)}
      </div>
    </div>`;

  dom.app.classList.add('app-shell--detail');
  dom.viewDetail.classList.add('view-detail--active');
  dom.viewDetail.removeAttribute('aria-hidden');
  dom.detailBody.scrollTop = 0;
  attachPersonalNotesListener(r.id);
}

function hideDetailPage() {
  if (!dom.viewDetail.classList.contains('view-detail--active')) return;
  dom.viewDetail.classList.remove('view-detail--active');
  dom.viewDetail.setAttribute('aria-hidden', 'true');
  dom.app.classList.remove('app-shell--detail');
  state.selectedId = null;
}

/* ── Toast ─────────────────────────────────────────────────── */

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className   = `toast toast--${type}`;
  toast.textContent = message;
  toast.setAttribute('role', 'status');
  dom.toastContainer.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('toast--visible')));
  setTimeout(() => {
    toast.classList.remove('toast--visible');
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

/* ── Hours formatting ────────────────────────────────────── */

function formatHoursSlot(slot) {
  if (!slot || typeof slot !== 'object') return '';
  return `${slot.open || '?'}–${slot.close || '?'}`;
}

function formatDayHours(daySlots) {
  if (daySlots === null) return 'Closed';
  if (!Array.isArray(daySlots) || daySlots.length === 0) return '—';
  return daySlots.map(formatHoursSlot).join(', ');
}

/* ── Event listeners ─────────────────────────────────────── */

function attachEventListeners() {
  // Card tap → navigate to detail page
  dom.cardList.addEventListener('click', (e) => {
    // Directions button — open nav choice sheet (B2_10)
    const dirBtn = e.target.closest('[data-action="directions"]');
    if (dirBtn) {
      e.stopPropagation();
      const restId = dirBtn.dataset.restaurantId;
      const restaurant = state.restaurants.find(r => r.id === restId);
      if (restaurant) showNavChoiceSheet(restaurant);
      return;
    }
    const wbtn = e.target.closest('[data-action="wishlist"]');
    if (wbtn && wbtn.closest('.card-list')) {
      e.stopPropagation();
      handlePersonalToggle(wbtn.dataset.id, 'wishlist');
      return;
    }
    const card = e.target.closest('[data-id]');
    if (card) openDetail(card.dataset.id);
  });

  // Filter chips
  dom.filterChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    const dim = chip.dataset.filterDim;
    const val = chip.dataset.filterVal;
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
      const restId = dirBtn.dataset.restaurantId;
      const restaurant = state.restaurants.find(r => r.id === restId);
      if (restaurant) showNavChoiceSheet(restaurant);
      return;
    }

    // Star rating tap handler (MISSING-09)
    const starBtn = e.target.closest('.star-btn');
    if (starBtn) {
      if (!navigator.onLine) { showToast("Can't save while offline", 'error'); return; }
      const newRating  = parseInt(starBtn.dataset.rating, 10);
      const restId     = starBtn.dataset.restaurantId;
      const current    = state.personalData.get(restId) || {};
      const ratingToSave = current.my_rating === newRating ? null : newRating;
      // Optimistic UI
      const container = starBtn.closest('.star-rating--interactive');
      if (container) {
        container.querySelectorAll('.star-btn').forEach((b, i) => {
          const filled = ratingToSave && (i + 1) <= ratingToSave;
          b.classList.toggle('star-btn--filled', !!filled);
          b.setAttribute('aria-pressed', filled ? 'true' : 'false');
        });
      }
      await upsertPersonalData(restId, { my_rating: ratingToSave });
      return;
    }

    const btn = e.target.closest('[data-action][data-id]');
    if (!btn) return;
    handlePersonalToggle(btn.dataset.id, btn.dataset.action);
  });

  // ── Search input — 300ms debounce, min 2 chars (MISSING-07) ──
  let searchDebounceTimer;
  dom.searchInput?.addEventListener('input', (e) => {
    clearTimeout(searchDebounceTimer);
    const q = e.target.value.trim();
    state.searchQuery = q;

    // Show/hide clear button
    if (dom.searchClearBtn) {
      dom.searchClearBtn.classList.toggle('search-clear-btn--visible', q.length > 0);
      dom.searchClearBtn.hidden = q.length === 0;
    }

    searchDebounceTimer = setTimeout(applyFiltersAndSearch, 300);
  });

  // Clear button
  dom.searchClearBtn?.addEventListener('click', () => {
    state.searchQuery = '';
    if (dom.searchInput) dom.searchInput.value = '';
    if (dom.searchClearBtn) {
      dom.searchClearBtn.hidden = true;
      dom.searchClearBtn.classList.remove('search-clear-btn--visible');
    }
    applyFiltersAndSearch();
  });

  // ── View toggle (All / Wishlist / Visited) — MISSING-11 ──
  // Spec: docs/design/MISSING_FEATURES.md — MISSING-11
  // 'all' = show all; 'wishlist' = wishlisted only; 'visited' = visited only
  // Combines with other active filters using AND logic — does NOT clear existing filters
  dom.viewToggle?.addEventListener('click', (e) => {
    const btn = e.target.closest('.view-toggle__btn');
    if (!btn) return;
    const mode = btn.dataset.mode; // 'all', 'wishlist', 'visited'
    if (!mode) return;
    state.viewMode = mode;
    dom.viewToggle.querySelectorAll('.view-toggle__btn').forEach(b => {
      b.classList.toggle('view-toggle__btn--active', b.dataset.mode === mode);
    });
    applyFiltersAndSearch();
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

  // Refresh detail page if currently showing this restaurant
  if (state.selectedId === id && dom.viewDetail.classList.contains('view-detail--active')) {
    const r = state.restaurants.find(r => r.id === id);
    if (r) renderDetailPage(r);
  }

  // Re-render card in list
  const cardEl = dom.cardList.querySelector(`[data-id="${id}"]`);
  if (cardEl) {
    const r = state.restaurants.find(r => r.id === id);
    if (r) cardEl.outerHTML = cardHTML(r);
  }

  // Refresh map pin
  if (state.activeView === 'map') {
    const pin = state.mapPins.get(id);
    if (pin && state.map) {
      pin.remove();
      state.mapPins.delete(id);
      const r = state.restaurants.find(r => r.id === id);
      if (r && r.lat && r.lng) renderPins([r]);
    }
  }
}

/* ── Init ───────────────────────────────────────────────────── */

async function init() {
  state.personalId = getOrCreatePersonalId();
  attachEventListeners();
  initKeyboardHandler();
  initMap();      // Map is default — init early so tiles start loading
  initRouter();   // Set up hashchange + handle initial hash

  await Promise.allSettled([
    loadPersonalData(),
    fetchRestaurants(),
  ]);

  // Render pins now that data is ready
  if (state.map && state.activeView === 'map') {
    state.map.invalidateSize();
    renderPins(state.filtered);
  }

  // Handle any route that was pending (restaurant detail before data loaded)
  if (state.pendingRoute) {
    const pending = state.pendingRoute;
    state.pendingRoute = null;
    handleRoute(pending);
  }
}

document.addEventListener('DOMContentLoaded', init);
