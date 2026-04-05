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
};

/* ══════════════════════════════════════════════════════════════
   CACHE MANAGEMENT
   ══════════════════════════════════════════════════════════════ */

function cacheKey(suffix) {
  return `thai-food-guide-${CONFIG.cacheVersion}-${suffix}`;
}

function getCached(suffix) {
  const key = cacheKey(suffix);
  const stored = localStorage.getItem(key);
  if (!stored) return null;

  try {
    const { data, timestamp } = JSON.parse(stored);
    const age = Date.now() - timestamp;
    if (age > CONFIG.cacheTTL) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch (e) {
    console.error('Cache parse error:', e);
    return null;
  }
}

function setCached(suffix, data) {
  const key = cacheKey(suffix);
  localStorage.setItem(key, JSON.stringify({
    data,
    timestamp: Date.now(),
  }));
}

function invalidateCache() {
  const prefix = `thai-food-guide-${CONFIG.cacheVersion}-`;
  Object.keys(localStorage).forEach(key => {
    if (key.startsWith(prefix)) {
      localStorage.removeItem(key);
    }
  });
}

/* ══════════════════════════════════════════════════════════════
   LOAD RESTAURANTS
   ══════════════════════════════════════════════════════════════ */

async function loadRestaurants() {
  state.isLoading = true;
  render();

  // Try cache first
  const cached = getCached('restaurants');
  if (cached) {
    state.restaurants = cached;
    state.isLoading = false;
    render();
    return;
  }

  try {
    // Load restaurants
    let { data: restaurants, error: err1 } = await db
      .from('restaurants')
      .select('*');

    if (err1) throw err1;

    // Load reviews → consolidate into restaurant_sources
    let { data: reviews, error: err2 } = await db
      .from('reviews')
      .select('*');

    if (err2) throw err2;

    // Index reviews by restaurant_id
    const reviewsByRestaurant = {};
    (reviews || []).forEach(review => {
      if (!reviewsByRestaurant[review.restaurant_id]) {
        reviewsByRestaurant[review.restaurant_id] = [];
      }
      reviewsByRestaurant[review.restaurant_id].push(review);
    });

    // Attach reviews to restaurants → restaurant_sources
    (restaurants || []).forEach(r => {
      r.restaurant_sources = reviewsByRestaurant[r.id] || [];
    });

    state.restaurants = restaurants || [];
    setCached('restaurants', state.restaurants);
  } catch (err) {
    console.error('Failed to load restaurants:', err);
    showError('Could not load restaurants. Check your internet connection.');
  }

  state.isLoading = false;
  render();
}

/* ══════════════════════════════════════════════════════════════
   FILTER & SEARCH
   ══════════════════════════════════════════════════════════════ */

function applyFilters() {
  const { activeFilters, sortOrder, restaurants, userLat, userLng } = state;

  let results = restaurants;

  // Cuisine filter
  if (activeFilters.cuisine) {
    const cuisines = activeFilters.cuisine;
    results = results.filter(r =>
      r.cuisines && r.cuisines.split(',').some(c => cuisines.includes(c.trim()))
    );
  }

  // Price filter
  if (activeFilters.price) {
    const prices = activeFilters.price;
    results = results.filter(r => prices.includes(r.price_range || 'unknown'));
  }

  // Rating filter
  if (activeFilters.minRating !== undefined && activeFilters.minRating > 0) {
    results = results.filter(r => (r.rating || 0) >= activeFilters.minRating);
  }

  // «Near me» filter (only if GPS granted)
  if (state.locationStatus === 'granted' && activeFilters.nearMe && userLat && userLng) {
    results = results.filter(r => {
      const dist = haversineDistance(userLat, userLng, r.latitude, r.longitude);
      return dist <= state.nearMeRadiusM;
    });
  }

  // Sort
  if (sortOrder === 'nearest' && userLat && userLng) {
    results.sort((a, b) => {
      const distA = haversineDistance(userLat, userLng, a.latitude, a.longitude);
      const distB = haversineDistance(userLat, userLng, b.latitude, b.longitude);
      return distA - distB;
    });
  } else {
    // Sort by rating (descending)
    results.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  }

  state.filtered = results;
}

/* ══════════════════════════════════════════════════════════════
   GEOLOCATION
   ══════════════════════════════════════════════════════════════ */

function requestLocation() {
  if (!navigator.geolocation) {
    state.locationStatus = 'unavailable';
    render();
    return;
  }

  state.locationStatus = 'requesting';
  render();

  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.userLat = position.coords.latitude;
      state.userLng = position.coords.longitude;
      state.locationStatus = 'granted';
      state.sortOrder = 'nearest';
      applyFilters();
      render();
    },
    (error) => {
      console.error('Geolocation error:', error);
      state.locationStatus = 'denied';
      state.sortOrder = 'rating';
      applyFilters();
      render();
    }
  );
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in metres
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/* ══════════════════════════════════════════════════════════════
   MAP MANAGEMENT
   ══════════════════════════════════════════════════════════════ */

function initMap() {
  if (state.map) return;

  const mapContainer = document.getElementById('map');
  if (!mapContainer) return;

  state.map = L.map('map').setView(
    [CONFIG.mapDefaultLat, CONFIG.mapDefaultLng],
    CONFIG.mapDefaultZoom
  );

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:
      '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(state.map);

  renderMapPins();
}

function renderMapPins() {
  if (!state.map) return;

  // Clear existing pins
  state.mapPins.forEach(pin => state.map.removeLayer(pin));
  state.mapPins.clear();

  // Add pins for filtered results
  state.filtered.forEach(restaurant => {
    const marker = L.marker([restaurant.latitude, restaurant.longitude])
      .bindPopup(`<strong>${restaurant.name}</strong><br>${restaurant.address || 'N/A'}`)
      .addTo(state.map);

    marker.on('click', () => {
      state.selectedId = restaurant.id;
      render();
    });

    state.mapPins.set(restaurant.id, marker);
  });
}

/* ══════════════════════════════════════════════════════════════
   UI EVENT HANDLERS
   ══════════════════════════════════════════════════════════════ */

function switchView(viewName) {
  state.activeView = viewName;
  render();

  if (viewName === 'map') {
    setTimeout(() => initMap(), 100);
  }
}

function toggleFilter(filterName, value) {
  if (!state.activeFilters[filterName]) {
    state.activeFilters[filterName] = [];
  }

  const arr = state.activeFilters[filterName];
  const idx = arr.indexOf(value);
  if (idx >= 0) {
    arr.splice(idx, 1);
  } else {
    arr.push(value);
  }

  applyFilters();
  render();
}

function setMinRating(rating) {
  state.activeFilters.minRating = rating;
  applyFilters();
  render();
}

function toggleNearMe() {
  if (!state.activeFilters.nearMe) {
    state.activeFilters.nearMe = true;
    requestLocation();
  } else {
    state.activeFilters.nearMe = false;
    applyFilters();
    render();
  }
}

function setNearMeRadius(radiusM) {
  state.nearMeRadiusM = radiusM;
  if (state.activeFilters.nearMe) {
    applyFilters();
    render();
  }
}

function selectRestaurant(id) {
  const found = state.restaurants.find(r => r.id === id);
  if (!found) return;

  state.selectedId = id;
  render();

  if (state.activeView === 'map' && state.map) {
    const pin = state.mapPins.get(id);
    if (pin) {
      state.map.setView(pin.getLatLng(), CONFIG.mapPinZoom);
      pin.openPopup();
    }
  }
}

function showError(message) {
  const errorDiv = document.getElementById('error');
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    setTimeout(() => {
      errorDiv.style.display = 'none';
    }, 5000);
  }
}

/* ══════════════════════════════════════════════════════════════
   ROUTER (hash-based)
   ══════════════════════════════════════════════════════════════ */

function parseHash() {
  const hash = window.location.hash.slice(1);
  if (!hash) return;

  const [view, id] = hash.split('/');

  if (view && ['map', 'list', 'details'].includes(view)) {
    state.activeView = view;
  }

  if (id && id !== 'null') {
    const numId = parseInt(id, 10);
    const found = state.restaurants.find(r => r.id === numId);
    if (found) {
      state.selectedId = numId;
    } else {
      // Restaurant not loaded yet — store it
      state.pendingRoute = numId;
    }
  }
}

function updateHash() {
  let hash = state.activeView || 'map';
  if (state.selectedId) {
    hash += `/${state.selectedId}`;
  }
  window.location.hash = hash;
}

/* ══════════════════════════════════════════════════════════════
   RENDER (UI generation)
   ══════════════════════════════════════════════════════════════ */

function render() {
  renderHeader();
  renderViewTabs();
  renderFilters();
  renderMainContent();
  updateHash();
}

function renderHeader() {
  const header = document.querySelector('header');
  if (!header) return;

  let html = '<h1>Thailand Food Guide</h1>';
  if (state.isLoading) {
    html += '<p class="loading">Loading...</p>';
  }
  header.innerHTML = html;
}

function renderViewTabs() {
  const tabs = document.getElementById('view-tabs');
  if (!tabs) return;

  const views = ['map', 'list', 'details'];
  tabs.innerHTML = views
    .map(v => {
      const active = state.activeView === v ? 'active' : '';
      return `<button class="tab ${active}" onclick="switchView('${v}')">${v.toUpperCase()}</button>`;
    })
    .join('');
}

function renderFilters() {
  const filterArea = document.getElementById('filters');
  if (!filterArea) return;

  let html = '<div class="filter-group">';

  // Cuisine filter
  const cuisines = ['Thai', 'Seafood', 'Vegetarian', 'Street Food'];
  html += '<label>Cuisine:</label>';
  html += '<div class="filter-options">';
  cuisines.forEach(c => {
    const checked = (state.activeFilters.cuisine || []).includes(c) ? 'checked' : '';
    html += `<label><input type="checkbox" ${checked} onchange="toggleFilter('cuisine', '${c}')"> ${c}</label>`;
  });
  html += '</div>';

  // Price filter
  const prices = ['$', '$$', '$$$', '$$$$'];
  html += '<label>Price:</label>';
  html += '<div class="filter-options">';
  prices.forEach(p => {
    const checked = (state.activeFilters.price || []).includes(p) ? 'checked' : '';
    html += `<label><input type="checkbox" ${checked} onchange="toggleFilter('price', '${p}')"> ${p}</label>`;
  });
  html += '</div>';

  // Rating filter
  html += '<label>Min Rating:</label>';
  html += '<input type="range" min="0" max="5" step="0.5" value="' + (state.activeFilters.minRating || 0) + '" onchange="setMinRating(parseFloat(this.value))" />';
  html += '<span>' + (state.activeFilters.minRating || 0) + ' stars</span>';

  // Near me
  if (state.locationStatus !== 'unavailable') {
    const checked = state.activeFilters.nearMe ? 'checked' : '';
    html += '<label><input type="checkbox" ' + checked + ' onchange="toggleNearMe()"> Near Me</label>';

    if (state.activeFilters.nearMe) {
      html += '<label>Radius (m):</label>';
      html += '<input type="number" min="100" max="5000" step="100" value="' + state.nearMeRadiusM + '" onchange="setNearMeRadius(parseInt(this.value))" />';
    }
  }

  if (state.locationStatus === 'requesting') {
    html += '<p class="status">Requesting location...</p>';
  } else if (state.locationStatus === 'denied') {
    html += '<p class="status warning">Location access denied</p>';
  } else if (state.locationStatus === 'granted') {
    html += '<p class="status success">Location enabled</p>';
  }

  html += '</div>';
  filterArea.innerHTML = html;
}

function renderMainContent() {
  const main = document.getElementById('main');
  if (!main) return;

  if (state.activeView === 'map') {
    renderMapView(main);
  } else if (state.activeView === 'list') {
    renderListView(main);
  } else if (state.activeView === 'details') {
    renderDetailsView(main);
  }
}

function renderMapView(container) {
  container.innerHTML = '<div id="map" style="width: 100%; height: 100%; position: absolute;"></div>';
  setTimeout(() => initMap(), 50);
}

function renderListView(container) {
  if (state.filtered.length === 0) {
    container.innerHTML = '<p>No restaurants found.</p>';
    return;
  }

  const html = state.filtered
    .map(r => {
      const distance = state.userLat && state.userLng
        ? haversineDistance(state.userLat, state.userLng, r.latitude, r.longitude)
        : null;

      const distanceStr = distance ? `<br><small>${(distance / 1000).toFixed(1)} km away</small>` : '';
      const ratingStr = r.rating ? `<span class="rating">${r.rating.toFixed(1)}★</span>` : '';

      return `
        <div class="restaurant-card" onclick="selectRestaurant(${r.id})">
          <h3>${r.name}</h3>
          ${ratingStr}
          <p>${r.address || 'N/A'}</p>
          <p><small>${r.cuisines || 'Cuisine unknown'}</small></p>
          ${distanceStr}
        </div>
      `;
    })
    .join('');

  container.innerHTML = html;
}

function renderDetailsView(container) {
  if (!state.selectedId) {
    container.innerHTML = '<p>Select a restaurant from the list.</p>';
    return;
  }

  const selected = state.restaurants.find(r => r.id === state.selectedId);
  if (!selected) {
    container.innerHTML = '<p>Restaurant not found.</p>';
    return;
  }

  let html = `
    <div class="details-card">
      <h2>${selected.name}</h2>
      <p><strong>Address:</strong> ${selected.address || 'N/A'}</p>
      <p><strong>Cuisines:</strong> ${selected.cuisines || 'Unknown'}</p>
      <p><strong>Price Range:</strong> ${selected.price_range || 'Unknown'}</p>
      <p><strong>Rating:</strong> ${selected.rating ? selected.rating.toFixed(1) + '★' : 'N/A'}</p>
      <p><strong>Phone:</strong> ${selected.phone || 'N/A'}</p>
      <p><strong>Website:</strong> ${selected.website ? '<a href="' + selected.website + '" target="_blank">View</a>' : 'N/A'}</p>
      <p><strong>Hours:</strong> ${selected.hours || 'N/A'}</p>
  `;

  // Display reviews (from restaurant_sources)
  if (selected.restaurant_sources && selected.restaurant_sources.length > 0) {
    html += '<h3>Reviews</h3>';
    html += '<div class="reviews">';
    selected.restaurant_sources.forEach(review => {
      html += `
        <div class="review">
          <p><strong>${review.author || 'Anonymous'}</strong> - ${review.rating || 'N/A'}★</p>
          <p>${review.comment || 'No comment'}</p>
        </div>
      `;
    });
    html += '</div>';
  }

  html += '</div>';
  container.innerHTML = html;
}

/* ══════════════════════════════════════════════════════════════
   INITIALIZATION
   ══════════════════════════════════════════════════════════════ */

async function init() {
  parseHash();

  // Request location immediately (user will be prompted)
  requestLocation();

  // Load data
  await loadRestaurants();

  // Resolve pending route if any
  if (state.pendingRoute) {
    state.selectedId = state.pendingRoute;
    state.pendingRoute = null;
  }

  // Apply default filters and render
  applyFilters();
  render();

  // Listen for hash changes (browser back/forward)
  window.addEventListener('hashchange', () => {
    parseHash();
    applyFilters();
    render();
  });
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
