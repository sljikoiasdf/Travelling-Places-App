'use strict';

/* ── app-data.js — IDB cache, data fetch, personal, hours logic ── */

const IDB_NAME    = 'thailand-food';
const IDB_VERSION = 1;
const IDB_STORE   = 'cache';
const CACHE_KEY   = 'restaurants_v5';

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
    if (isOpen) {
      // closes_soon: within 30 minutes of closing (BUG-B2-02 fix)
      const minsToClose = closeMins >= currentMins
        ? closeMins - currentMins
        : (closeMins + 1440) - currentMins; // wraps past midnight
      return minsToClose <= 30 ? 'closes_soon' : 'open';
    }
  }

  // opens_soon: next opening is within 30 minutes (BUG-B2-02 fix)
  for (const slot of daySlots) {
    const [oh, om] = (slot.open || '').split(':').map(Number);
    if (isNaN(oh)) continue;
    const openMins = oh * 60 + om;
    if (openMins > currentMins && openMins - currentMins <= 30) return 'opens_soon';
  }

  return 'closed';
}
