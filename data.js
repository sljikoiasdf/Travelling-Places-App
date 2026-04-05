/* ============================================================
   THAILAND FOOD GUIDE — data.js
   Data fetching, personal data, loading state
   ============================================================ */

'use strict';

import { db, CONFIG } from './config.js';
import { state, dom } from './state.js';
import { haversineDistance, showToast } from './utils.js';
import { CACHE_KEY, getCached, setCached } from './cache.js';
import { requestLocation } from './location.js';

/* ── Late-bound deps (set by app.js to break circular imports) ── */
let _applyFiltersAndSearch = null;
let _renderPins = null;

function bindDataDeps(deps) {
  _applyFiltersAndSearch = deps.applyFiltersAndSearch;
  _renderPins = deps.renderPins;
}

/* ── Personal data ──────────────────────────────────────────── */

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

/* ── Data loading ───────────────────────────────────────────── */

function renderLoadingState() {
  if (dom.skeletonList) {
    dom.skeletonList.removeAttribute('hidden');
    dom.skeletonList.style.display = 'flex';
  }
  if (dom.cardList)   dom.cardList.style.display   = 'none';
  if (dom.emptyState) dom.emptyState.style.display = 'none';
}

async function fetchRestaurants() {
  state.isLoading = true;
  renderLoadingState();

  await requestLocation();

  const cached = await getCached(CACHE_KEY);
  if (cached) {
    state.restaurants = cached;
    if (_applyFiltersAndSearch) _applyFiltersAndSearch();
    state.isLoading = false;
    refreshFromNetwork().catch(() => {});
    return;
  }

  await refreshFromNetwork();
}

async function refreshFromNetwork(fetchLat, fetchLng) {
  try {
    let data, error;
    const lat = fetchLat ?? (state.locationStatus === 'granted' ? state.userLat : null);
    const lng = fetchLng ?? (state.locationStatus === 'granted' ? state.userLng : null);

    if (lat != null && lng != null) {
      // Fetch ALL restaurants (no radius cap) so global search works:
      // someone in Melbourne must still be able to search "Hia" or "Mee Krob"
      // and find Bangkok results. "Near me" stays as a client-side filter
      // against _distanceMetres. The RPC still returns results sorted by distance.
      ({ data, error } = await db.rpc('nearby_restaurants', {
        user_lat: lat,
        user_lng: lng,
        radius_m: 50000000,
        limit_n:  10000
      }));

      state.lastFetchLat = lat;
      state.lastFetchLng = lng;

      if (data) {
        const uLat = state.userLat || lat;
        const uLng = state.userLng || lng;
        data = data.map(r => ({
          ...r,
          _distanceMetres: r.dist_metres != null
            ? r.dist_metres
            : haversineDistance(uLat, uLng, r.lat, r.lng)
        }));
      }
    } else {
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
          description_en, description_th,
          created_at
        `)
        .order('wongnai_rating', { ascending: false, nullsFirst: false })
      );

      if (data) {
        data = data.map(r => ({ ...r, _distanceMetres: null }));
      }
    }

    if (error) throw error;

    if (data && data.length > 0) {
      const existingMap = new Map(state.restaurants.map(r => [r.id, r]));
      data.forEach(r => {
        if (state.userLat && state.userLng && existingMap.has(r.id)) {
          r._distanceMetres = haversineDistance(state.userLat, state.userLng, r.lat, r.lng);
        }
        existingMap.set(r.id, r);
      });
      state.restaurants = [...existingMap.values()];
    }

    state.isLoading = false;

    await setCached(CACHE_KEY, state.restaurants);
    if (_applyFiltersAndSearch) _applyFiltersAndSearch();

    if (state.activeView === 'map' && state.map && _renderPins) {
      _renderPins(state.filtered);
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
      if (_applyFiltersAndSearch) _applyFiltersAndSearch();
    }
  }
}

export {
  getOrCreatePersonalId,
  loadPersonalData,
  upsertPersonalData,
  renderLoadingState,
  fetchRestaurants,
  refreshFromNetwork,
  bindDataDeps,
};
