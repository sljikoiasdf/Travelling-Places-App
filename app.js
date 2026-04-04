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

/* ── DOM (cached) ──────────────────────────────────────────── */
const DOM = {
  appRoot:        null,
  map:            null,
  list:           null,
  detail:         null,
  buttons:        {},
  input:          {},
};

/* ── init() — Bootstrap app ───────────────────────────────── */
async function init() {
  console.log('[INIT] Starting Thailand Food Guide...');

  // Cache DOM elements
  DOM.appRoot = document.getElementById('app');
  DOM.map = document.getElementById('map');
  DOM.list = document.getElementById('list');
  DOM.detail = document.getElementById('detail');
  DOM.buttons.mapView = document.getElementById('btn-map');
  DOM.buttons.listView = document.getElementById('btn-list');
  DOM.buttons.location = document.getElementById('btn-location');
  DOM.buttons.settings = document.getElementById('btn-settings');
  DOM.input.search = document.getElementById('search-input');
  DOM.input.filterCuisine = document.getElementById('filter-cuisine');
  DOM.input.filterPrice = document.getElementById('filter-price');
  DOM.input.filterRating = document.getElementById('filter-rating');
  DOM.input.sortBy = document.getElementById('sort-by');

  // Bind events
  DOM.buttons.mapView.addEventListener('click', () => switchView('map'));
  DOM.buttons.listView.addEventListener('click', () => switchView('list'));
  DOM.buttons.location.addEventListener('click', requestLocation);
  DOM.buttons.settings.addEventListener('click', openSettings);
  DOM.input.search.addEventListener('input', handleSearch);
  DOM.input.filterCuisine.addEventListener('change', applyFilters);
  DOM.input.filterPrice.addEventListener('change', applyFilters);
  DOM.input.filterRating.addEventListener('change', applyFilters);
  DOM.input.sortBy.addEventListener('change', applySortOrder);

  // Load data
  await loadRestaurants();

  // Initialize map
  if (DOM.map) {
    state.map = L.map('map').setView(
      [CONFIG.mapDefaultLat, CONFIG.mapDefaultLng],
      CONFIG.mapDefaultZoom
    );
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(state.map);
  }

  // Handle hash navigation
  const pending = window.location.hash.slice(1);
  if (pending) {
    state.pendingRoute = pending;
    handleRoute(pending);
  }

  // Listen for hash changes
  window.addEventListener('hashchange', () => {
    const pending = window.location.hash.slice(1);
    handleRoute(pending);
  });

  console.log('[INIT] App initialized');
}

/* ── loadRestaurants() — Fetch from Supabase ────────────── */
async function loadRestaurants() {
  try {
    state.isLoading = true;
    DOM.list.innerHTML = '<p class="loading">Loading restaurants...</p>';

    const { data, error } = await db
      .from('restaurants')
      .select(`
        id,
        name,
        cuisine,
        price_level,
        rating,
        latitude,
        longitude,
        website,
        phone,
        address,
        description,
        image_url,
        wongnai_url
      `)
      .order('rating', { ascending: false });

    if (error) throw error;

    state.restaurants = data || [];
    state.filtered = [...state.restaurants];

    renderList();
    renderMapPins();

    state.isLoading = false;
    console.log(`[LOAD] ${state.restaurants.length} restaurants loaded`);
  } catch (err) {
    console.error('[LOAD ERROR]', err);
    DOM.list.innerHTML = `<p class="error">Error loading data: ${err.message}</p>`;
    state.isLoading = false;
  }
}

/* ── renderList() — Render restaurant list ────────────── */
function renderList() {
  if (!DOM.list) return;

  if (state.filtered.length === 0) {
    DOM.list.innerHTML = '<p class="empty">No restaurants found</p>';
    return;
  }

  const html = state.filtered.map(r => `
    <div class="list-item" data-id="${r.id}" onclick="selectRestaurant(${r.id})">
      <div class="restaurant-card">
        ${r.image_url ? `<img src="${r.image_url}" alt="${r.name}" class="restaurant-image">` : ''}
        <div class="restaurant-info">
          <h3>${r.name}</h3>
          <div class="meta">
            <span class="rating">⭐ ${r.rating || 'N/A'}</span>
            <span class="cuisine">${r.cuisine || 'Thai'}</span>
            <span class="price">${'$'.repeat(r.price_level || 1)}</span>
          </div>
          <p class="description">${r.description || ''}</p>
        </div>
      </div>
    </div>
  `).join('');

  DOM.list.innerHTML = html;
}

/* ── renderMapPins() — Add markers to Leaflet map ────── */
function renderMapPins() {
  if (!state.map) return;

  // Clear old pins
  state.mapPins.forEach(pin => state.map.removeLayer(pin));
  state.mapPins.clear();

  state.filtered.forEach(r => {
    const marker = L.marker([r.latitude, r.longitude])
      .bindPopup(`<strong>${r.name}</strong><br/>${r.cuisine}`, { maxWidth: 200 })
      .addTo(state.map);

    marker.on('click', () => selectRestaurant(r.id));
    state.mapPins.set(r.id, marker);
  });
}

/* ── selectRestaurant() – Show detail view ────────────── */
function selectRestaurant(id) {
  const restaurant = state.restaurants.find(r => r.id === id);
  if (!restaurant) return;

  state.selectedId = id;
  window.location.hash = id;
  switchView('detail');
  renderDetail(restaurant);
}

/* ── renderDetail() – Render detail panel ──────────────── */
function renderDetail(restaurant) {
  if (!DOM.detail) return;

  const contactRowHTML = () => {
    let html = '';
    if (restaurant.phone) {
      html += `<a href="tel:${restaurant.phone}" class="contact-link phone">📞 ${restaurant.phone}</a>`;
    }
    if (restaurant.website) {
      html += `<a href="${restaurant.website}" target="_blank" class="contact-link website">🌐 Website</a>`;
    }
    if (restaurant.wongnai_url) {
      html += `<a href="${restaurant.wongnai_url}" target="_blank" class="contact-link wongnai">⭐ View on Wongnai</a>`;
    }
    return html;
  };

  const html = `
    <div class="detail-header">
      <button onclick="closeDetail()" class="close-btn">✕</button>
      <h2>${restaurant.name}</h2>
      <div class="detail-meta">
        <span class="rating">Rating: ${restaurant.rating || 'N/A'} ⭐</span>
        <span class="cuisine">Cuisine: ${restaurant.cuisine || 'Thai'}</span>
        <span class="price">Price: ${'$'.repeat(restaurant.price_level || 1)}</span>
      </div>
    </div>
    <div class="detail-body">
      ${restaurant.image_url ? `<img src="${restaurant.image_url}" alt="${restaurant.name}" class="detail-image">` : ''}
      <p class="description">${restaurant.description || 'No description available.'}</p>
      <div class="contact-row">${contactRowHTML()}</div>
      <p class="address">📍 ${restaurant.address || 'No address available'}</p>
    </div>
  `;

  DOM.detail.innerHTML = html;
}

/* ── closeDetail() – Close detail view ───────────────── */
function closeDetail() {
  state.selectedId = null;
  window.location.hash = '';
  switchView('list');
}

/* ── switchView() – Toggle between map and list ────────── */
function switchView(view) {
  state.activeView = view;

  DOM.buttons.mapView.classList.toggle('active', view === 'map');
  DOM.buttons.listView.classList.toggle('active', view === 'list');

  const showDetail = view === 'detail';
  const showMap = view === 'map';
  const showList = view === 'list';

  DOM.map?.parentElement.style.display = showMap ? 'block' : 'none';
  DOM.list?.parentElement.style.display = showList ? 'block' : 'none';
  DOM.detail?.parentElement.style.display = showDetail ? 'block' : 'none';
}

/* ── handleSearch() – Filter by restaurant name ────────── */
function handleSearch(e) {
  const query = e.target.value.toLowerCase();
  state.filtered = state.restaurants.filter(r =>
    r.name.toLowerCase().includes(query) ||
    (r.cuisine && r.cuisine.toLowerCase().includes(query))
  );
  renderList();
  renderMapPins();
}

/* ── applyFilters() – Apply cuisine, price, rating filters */
function applyFilters() {
  const cuisine = DOM.input.filterCuisine.value;
  const price = DOM.input.filterPrice.value;
  const rating = DOM.input.filterRating.value;

  state.filtered = state.restaurants.filter(r => {
    if (cuisine && r.cuisine !== cuisine) return false;
    if (price && r.price_level !== parseInt(price)) return false;
    if (rating && r.rating < parseFloat(rating)) return false;
    return true;
  });

  renderList();
  renderMapPins();
}

/* ── applySortOrder() – Sort by rating or distance ────── */
function applySortOrder(e) {
  state.sortOrder = e.target.value;

  if (state.sortOrder === 'rating') {
    state.filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  } else if (state.sortOrder === 'nearest') {
    if (state.userLat && state.userLng) {
      state.filtered.sort((a, b) => {
        const distA = distance(state.userLat, state.userLng, a.latitude, a.longitude);
        const distB = distance(state.userLat, state.userLng, b.latitude, b.longitude);
        return distA - distB;
      });
    }
  }

  renderList();
  renderMapPins();
}

/* ── distance() – Calculate distance between two coordinates */
function distance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.asin(Math.sqrt(a));
  return R * c;
}

/* ── requestLocation() – Get user's GPS ────────────────── */
async function requestLocation() {
  if (!navigator.geolocation) {
    alert('Geolocation not supported');
    state.locationStatus = 'unavailable';
    return;
  }

  state.locationStatus = 'requesting';
  DOM.buttons.location.disabled = true;
  DOM.buttons.location.textContent = '📍 Locating...';

  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.userLat = position.coords.latitude;
      state.userLng = position.coords.longitude;
      state.locationStatus = 'granted';
      DOM.buttons.location.textContent = '✓ Location granted';
      DOM.buttons.location.disabled = false;
      DOM.input.sortBy.innerHTML += '<option value="nearest">Nearest</option>';
      DOM.input.sortBy.disabled = false;
      console.log(`[GPS] User location: ${state.userLat}, ${state.userLng}`);
    },
    (error) => {
      state.locationStatus = 'denied';
      DOM.buttons.location.textContent = '✕ Location denied';
      DOM.buttons.location.disabled = false;
      console.error('[GPS ERROR]', error.message);
    }
  );
}

/* ── openSettings() – Settings panel (placeholder) ──────── */
function openSettings() {
  alert('Settings coming soon!');
}

/* ── handleRoute() – Handle hash-based routing ────────── */
function handleRoute(id) {
  if (!id) {
    closeDetail();
    return;
  }

  const numId = parseInt(id);
  const restaurant = state.restaurants.find(r => r.id === numId);

  if (restaurant) {
    state.selectedId = numId;
    switchView('detail');
    renderDetail(restaurant);
  } else if (state.restaurants.length === 0) {
    // Data not loaded yet, defer
    state.pendingRoute = id;
  } else {
    closeDetail();
  }
}

/* ── Global error handler ──────────────────────────────── */
window.addEventListener('error', (e) => {
  console.error('[GLOBAL ERROR]', e.message, e.error);
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('[UNHANDLED REJECTION]', e.reason);
});

/* ── PWA Service Worker registration ────────────────────── */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    console.log('[PWA] Service Worker registered');
  }).catch((err) => {
    console.warn('[PWA] Service Worker registration failed:', err);
  });
}

/* ── Cache API helper ──────────────────────────────────── */
async function cacheData(key, data, ttl = CONFIG.cacheTTL) {
  try {
    const cache = await caches.open(CONFIG.cacheVersion);
    const response = new Response(JSON.stringify({ data, timestamp: Date.now() }));
    await cache.put(key, response);
  } catch (err) {
    console.warn('[CACHE] Failed to cache', key, err);
  }
}

async function getCachedData(key, ttl = CONFIG.cacheTTL) {
  try {
    const cache = await caches.open(CONFIG.cacheVersion);
    const response = await cache.match(key);
    if (!response) return null;

    const { data, timestamp } = await response.json();
    const isExpired = Date.now() - timestamp > ttl;

    return isExpired ? null : data;
  } catch (err) {
    console.warn('[CACHE] Failed to retrieve', key, err);
    return null;
  }
}

/* ── Load pending route after data load ────────────────── */
async function loadAndRoute() {
  await loadRestaurants();
  if (state.pendingRoute) {
    const pending = state.pendingRoute;
    state.pendingRoute = null;
    handleRoute(pending);
  }
}

document.addEventListener('DOMContentLoaded', init);