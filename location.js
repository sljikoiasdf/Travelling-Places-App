/* ============================================================
   THAILAND FOOD GUIDE — location.js
   GPS, location picker, geocoding
   ============================================================ */

'use strict';

import { CONFIG, CITY_CENTRES } from './config.js';
import { state, dom } from './state.js';
import { escapeHTML, haversineDistance, cityLabel, showToast } from './utils.js';

/* ── GPS request ────────────────────────────────────────────── */

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
        state.locationStatus = 'denied';
        resolve();
      },
      { timeout: 8000, maximumAge: 60000, enableHighAccuracy: false }
    );
  });
}

/* ── GPS status notice ──────────────────────────────────────── */

function renderLocationNotice() {
  if ((state.locationStatus === 'denied' || state.locationStatus === 'unavailable') && !state.locationManual) {
    showLocationPicker();
  }
}

/* ── Location picker overlay ────────────────────────────────── */

function showLocationPicker() {
  const existing = document.getElementById('location-picker-overlay');
  if (existing) { existing.hidden = false; return; }

  const cities = [...new Set(state.restaurants.map(r => r.city).filter(Boolean))].sort();
  const cityButtonsHTML = cities.map(city => {
    const label = cityLabel(city);
    return `<button class="loc-picker__city-btn" data-city="${escapeHTML(city)}">${label}</button>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.id = 'location-picker-overlay';
  overlay.className = 'loc-picker-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Set your location');
  overlay.innerHTML = `
    <div class="loc-picker">
      <div class="loc-picker__icon">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
          <circle cx="12" cy="10" r="3"/>
        </svg>
      </div>
      <h2 class="loc-picker__title">Location not available</h2>
      <p class="loc-picker__subtitle">Choose a city or enter an address so we can show nearby restaurants.</p>
      <div class="loc-picker__cities">${cityButtonsHTML}</div>
      <div class="loc-picker__divider"><span>or enter an address</span></div>
      <form class="loc-picker__form" id="loc-picker-form">
        <input class="loc-picker__input"
               id="loc-picker-address"
               type="text"
               placeholder="e.g. 123 Collins St, Melbourne"
               autocomplete="street-address"
               enterkeyhint="search" />
        <button class="loc-picker__submit" type="submit">Find</button>
      </form>
      <p class="loc-picker__error" id="loc-picker-error" hidden></p>
      <button class="loc-picker__skip" id="loc-picker-skip">Skip — browse without location</button>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelectorAll('.loc-picker__city-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const city = btn.dataset.city;
      setLocationFromCity(city);
      hideLocationPicker();
    });
  });

  document.getElementById('loc-picker-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('loc-picker-address');
    const addr  = input.value.trim();
    if (!addr) return;
    await geocodeAddress(addr);
  });

  document.getElementById('loc-picker-skip').addEventListener('click', () => {
    hideLocationPicker();
    if (state.map && state.restaurants.length > 0) {
      const coords = state.restaurants.filter(r => r.lat && r.lng).map(r => [r.lat, r.lng]);
      if (coords.length > 0) state.map.fitBounds(coords, { padding: [40, 40], maxZoom: 14 });
    }
  });
}

function hideLocationPicker() {
  const overlay = document.getElementById('location-picker-overlay');
  if (overlay) overlay.hidden = true;
}

/* ── Set location from city ───────────────────────────────── */
// Requires late-bound imports to avoid circular deps
let _applyFiltersAndSearch = null;
let _buildFilterChips = null;
let _centreMapOnUser = null;
let _renderPins = null;
let _refreshFromNetwork = null;

function bindLocationDeps(deps) {
  _applyFiltersAndSearch = deps.applyFiltersAndSearch;
  _buildFilterChips = deps.buildFilterChips;
  _centreMapOnUser = deps.centreMapOnUser;
  _renderPins = deps.renderPins;
  _refreshFromNetwork = deps.refreshFromNetwork;
}

function setLocationFromCity(city) {
  const centre = CITY_CENTRES[city];
  if (!centre) return;

  state.userLat       = centre.lat;
  state.userLng       = centre.lng;
  state.locationManual = true;
  state.locationStatus = 'granted';
  state.sortOrder      = 'nearest';

  state.restaurants = state.restaurants.map(r => ({
    ...r,
    _distanceMetres: haversineDistance(state.userLat, state.userLng, r.lat, r.lng),
  }));

  if (_applyFiltersAndSearch) _applyFiltersAndSearch();
  if (_buildFilterChips) _buildFilterChips();
  if (_centreMapOnUser) _centreMapOnUser(CONFIG.mapCityZoom);

  if (state.activeView === 'map' && state.map) {
    state.map.invalidateSize();
    if (_renderPins) _renderPins(state.filtered);
  }

  if (_refreshFromNetwork) _refreshFromNetwork(centre.lat, centre.lng).catch(() => {});
  showToast(`Location set to ${cityLabel(city)}`);
}

/* ── Geocode address via Nominatim ──────────────────────────── */

async function geocodeAddress(address) {
  const errEl = document.getElementById('loc-picker-error');
  const btn   = document.querySelector('.loc-picker__submit');
  if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
  if (btn) { btn.disabled = true; btn.textContent = 'Searching…'; }

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const results = await res.json();

    if (!results || results.length === 0) {
      if (errEl) {
        errEl.textContent = 'Address not found. Try a different search.';
        errEl.hidden = false;
      }
      return;
    }

    const { lat, lon, display_name } = results[0];
    state.userLat        = parseFloat(lat);
    state.userLng        = parseFloat(lon);
    state.locationManual  = true;
    state.locationStatus  = 'granted';
    state.sortOrder       = 'nearest';

    state.restaurants = state.restaurants.map(r => ({
      ...r,
      _distanceMetres: haversineDistance(state.userLat, state.userLng, r.lat, r.lng),
    }));

    if (_applyFiltersAndSearch) _applyFiltersAndSearch();
    if (_buildFilterChips) _buildFilterChips();
    if (_centreMapOnUser) _centreMapOnUser(CONFIG.mapCityZoom);

    if (state.activeView === 'map' && state.map) {
      state.map.invalidateSize();
      if (_renderPins) _renderPins(state.filtered);
    }

    if (_refreshFromNetwork) _refreshFromNetwork(state.userLat, state.userLng).catch(() => {});
    hideLocationPicker();

    const shortName = display_name.length > 50 ? display_name.slice(0, 47) + '…' : display_name;
    showToast(`Location set to ${shortName}`);

  } catch (err) {
    console.error('[geocode] Failed:', err);
    if (errEl) {
      errEl.textContent = 'Could not search for address. Check your connection.';
      errEl.hidden = false;
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Find'; }
  }
}

export {
  requestLocation,
  renderLocationNotice,
  showLocationPicker,
  hideLocationPicker,
  setLocationFromCity,
  geocodeAddress,
  bindLocationDeps,
};
