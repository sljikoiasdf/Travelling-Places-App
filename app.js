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
  searchText:     '',           // Search term for restaurant names and cuisines
  filteredList:   [],           // List view filtered results (searchable, sortable)
};

/* ════════════════════════════════════════════════════════════
   GEOLOCATION (MISSING-01)
   Spec: docs/design/MISSING_FEATURES.md — MISSING-01
   ════════════════════════════════════════════════════════════ */

/**
 * request userLocation()
 * Requests the browser's geolocation API for user's lat/lng.
 * On success: sets state.userLat, state.userLng, state.locationStatus = 'granted'
 * On error: state.locationStatus = 'denied'
 *
 * This is called on app init and whenever the "Get Location" button is clicked.
 */
function requestLocation() {
  if (!navigator.geolocation) {
    state.locationStatus = 'unavailable';
    updateUI();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.userLat = position.coords.latitude;
      state.userLng = position.coords.longitude;
      state.locationStatus = 'granted';

      // Attach _distanceMetres to each restaurant for use by distance display (MISSING-02)
      state.restaurants.forEach(r => {
        r._distanceMetres = haversineDistance(
          state.userLat, state.userLng,
          r.latitude, r.longitude
        );
      });

      applyFilters();
      updateUI();
    },
    (error) => {
      // Permission denied, or timeout, or unavailable
      state.locationStatus = 'denied';
      console.warn('Geolocation error:', error.message);
      updateUI();
    },
    { timeout: 8000, enableHighAccuracy: false, maximumAge: 30000 }
  );
}

/**
 * haversineDistance(lat1, lng1, lat2, lng2) → metres
 * Calculate the great-circle distance between two points on Earth.
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371e3; // Earth radius in metres
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

/* ════════════════════════════════════════════════════════════
   UTILS / COMMON
   ════════════════════════════════════════════════════════════ */

function escapeHTML(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

function formatDistance(metres) {
  if (metres == null) return 'N/A';
  if (metres < 1000) return Math.round(metres) + ' m';
  return (metres / 1000).toFixed(1) + ' km';
}

function formatRating(r) {
  if (!r) return 'Not rated';
  if (r < 0) return '0';
  if (r > 5) return '5';
  return r.toFixed(1);
}

/* ────────────────────────────────────────────────────────── */
/* DOM & Utils */
/* ────────────────────────────────────────────────────────── */

function el(selector) {
  return document.querySelector(selector);
}

function elAll(selector) {
  return document.querySelectorAll(selector);
}

function on(selector, event, handler) {
  const element = typeof selector === 'string' ? el(selector) : selector;
  if (element) {
    element.addEventListener(event, handler);
  }
}

/* ════════════════════════════════════════════════════════════
   DATA LOADING (Supabase)
   ════════════════════════════════════════════════════════════ */

async function fetchRestaurants() {
  try {
    state.isLoading = true;
    updateUI();

    // Try to load from cache first
    const cached = localStorage.getItem('restaurants_cache');
    if (cached) {
      try {
        state.restaurants = JSON.parse(cached);
        applyFilters();
        state.isLoading = false;
        updateUI();
        return;
      } catch (e) {
        console.warn('Cache parse error:', e);
      }
    }

    // Fetch from Supabase
    const { data, error } = await db
      .from('restaurants')
      .select('*')
      .order('name');

    if (error) {
      console.error('Fetch error:', error);
      state.isLoading = false;
      updateUI();
      return;
    }

    state.restaurants = data || [];

    // Cache it
    localStorage.setItem('restaurants_cache', JSON.stringify(state.restaurants));

    // Attach distance data if we have location
    if (state.locationStatus === 'granted' && state.userLat && state.userLng) {
      state.restaurants.forEach(r => {
        r._distanceMetres = haversineDistance(
          state.userLat, state.userLng,
          r.latitude, r.longitude
        );
      });
    } else {
      // No GPS — attach null _distanceMetres for consistency (used by MISSING-02)
      state.restaurants.forEach(r => {
        r._distanceMetres = null;
      });
    }

    applyFilters();
  } catch (e) {
    console.error('Fetch failed:', e);
  } finally {
    state.isLoading = false;
    updateUI();
  }
}

/* ════════════════════════════════════════════════════════════
   FILTERING & SORTING (MISSING-07)
   ════════════════════════════════════════════════════════════ */

/**
 * applyFilters()
 * Filters and sorts state.restaurants based on:
 * - Search text (name, cuisine keywords)
 * - Location (if GPS granted, near-me filter + distance sort)
 * - Sorts by rating by default, by distance if GPS enabled
 *
 * Outputs to state.filteredList
 */
function applyFilters() {
  let results = [...state.restaurants];

  // Filter by search text
  if (state.searchText && state.searchText.trim()) {
    const query = state.searchText.toLowerCase();
    results = results.filter(r => {
      const name = (r.name_en || r.name_th || '').toLowerCase();
      const cuisines = (r.cuisines || []).map(c => c.toLowerCase()).join(' ');
      return name.includes(query) || cuisines.includes(query);
    });
  }

  // Sort by rating (or distance if GPS granted)
  if (state.locationStatus === 'granted' && state.userLat && state.userLng) {
    results.sort((a, b) => (a._distanceMetres || Infinity) - (b._distanceMetres || Infinity));
  } else {
    results.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  }

  state.filteredList = results;
}

/* ════════════════════════════════════════════════════════════
   RENDERING
   ════════════════════════════════════════════════════════════ */

function updateUI() {
  if (state.isLoading) {
    el('#app').innerHTML = '<p>Loading restaurants...</p>';
    return;
  }

  // Show either map or list based on state.activeView
  if (state.activeView === 'map') {
    renderMapView();
  } else {
    renderListView();
  }
}

function renderMapView() {
  const container = el('#app');
  container.innerHTML = '<div id="map-container" style="width: 100%; height: 100vh;"></div>';

  // Initialize Leaflet map
  const mapEl = el('#map-container');
  if (!state.map) {
    state.map = L.map(mapEl).setView([CONFIG.mapDefaultLat, CONFIG.mapDefaultLng], CONFIG.mapDefaultZoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(state.map);
  } else {
    state.map.invalidateSize();
  }

  // Clear old markers
  if (state.mapMarkers) {
    state.mapMarkers.forEach(m => state.map.removeLayer(m));
  }
  state.mapMarkers = [];

  // Add new markers for filtered restaurants
  state.filteredList.forEach(r => {
    const marker = L.marker([r.latitude, r.longitude])
      .bindPopup(`<strong>${escapeHTML(r.name_en || r.name_th)}</strong><br/>Rating: ${formatRating(r.rating)}/5`)
      .on('click', () => showDetailView(r))
      .addTo(state.map);
    state.mapMarkers.push(marker);
  });
}

/**
 * MISSING-03: restaurant card HTML renderer
 * Shows: image, name, rating, cuisines, price, distance
 * Spec: docs/design/MISSING_FEATURES.md — MISSING-03
 */
function restaurantCardHTML(r) {
  const distance = r._distanceMetres ? formatDistance(r._distanceMetres) : 'N/A';
  const ratingText = formatRating(r.rating);
  const cuisineText = r.cuisines && r.cuisines.length > 0 ? r.cuisines.join(', ') : 'N/A';

  return `
    <article class="card" onclick="showDetailView(${JSON.stringify(r)})">
      ${r.image_url ? `<img src="${escapeHTML(r.image_url)}" alt="${escapeHTML(r.name_en || r.name_th)}" class="card__image">` : ''}
      <div class="card__body">
        <h3 class="card__name">${escapeHTML(r.name_en || r.name_th)}</h3>
        <p class="card__cuisines">${escapeHTML(cuisineText)}</p>
        <p class="card__rating">Rating: ${ratingText}/5</p>
        <p class="card__distance">Distance: ${escapeHTML(distance)}</p>
      </div>
    </article>
  `;
}

function renderListView() {
  const container = el('#app');
  let html = `
    <div class="search-bar">
      <input type="text" id="search-input" placeholder="Search restaurants...">
    </div>
    <div class="list-view">
  `;

  if (state.filteredList.length === 0) {
    html += '<p>No restaurants found.</p>';
  } else {
    state.filteredList.forEach(r => {
      html += restaurantCardHTML(r);
    });
  }

  html += '</div>';
  container.innerHTML = html;

  // Attach search handler
  const searchInput = el('#search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchText = e.target.value;
      applyFilters();
      renderListView();
    });
  }
}

/**
 * showDetailView(restaurant)
 * Renders a detail panel for the selected restaurant.
 * Includes: name, rating, address, phone, description, image, review links.
 *
 * reviewLinksHTML is fetched async and injected after rendering.
 */
function showDetailView(restaurant) {
  const container = el('#app');

  // Build HTML without review links first (will fetch async)
  let html = `
    <div class="detail-view">
      <button onclick="backToList()" class="btn-back">← Back to list</button>
      <div class="detail-content">
  `;

  if (restaurant.image_url) {
    html += `<img src="${escapeHTML(restaurant.image_url)}" alt="${escapeHTML(restaurant.name_en || restaurant.name_th)}" class="detail-image">`;
  }

  html += `
        <h1>${escapeHTML(restaurant.name_en || restaurant.name_th)}</h1>
        <p class="detail-rating">Rating: ${formatRating(restaurant.rating)}/5</p>
        <p><strong>Address:</strong> ${escapeHTML(restaurant.address || 'N/A')}</p>
        <p><strong>Phone:</strong> ${escapeHTML(restaurant.phone || 'N/A')}</p>
        <p><strong>Cuisines:</strong> ${restaurant.cuisines ? escapeHTML(restaurant.cuisines.join(', ')) : 'N/A'}</p>
        <p><strong>Description:</strong> ${escapeHTML(restaurant.description || 'No description available.')}</p>
        <div id="review-links-placeholder">Loading reviews...</div>
      </div>
    </div>
  `;

  container.innerHTML = html;
  state.activeView = 'detail';

  // Fetch review links async
  reviewLinksHTML(restaurant.id).then(reviewHTML => {
    const placeholder = el('#review-links-placeholder');
    if (placeholder) {
      placeholder.outerHTML = reviewHTML;
    }
  });
}

function backToList() {
  state.activeView = 'list';
  renderListView();
}

/**
 * MISSING-04: source attribution & review links (detail view footer)
 * Spec: docs/design/MISSING_FEATURES.md — MISSING-04, MISSING-17
 *
 * Fetches restaurant_sources rows where source_tier IN ('writer', 'food_press').
 * Renders HTML with source name, quote, and link.
 */
function sourceAttributionHTML(source) {
  const sourceIcon = {
    'writer': '✍️',
    'food_press': '📰',
    'local_platform': '⭐',
    'google': 'G',
    'tripadvisor': '🌟',
  };

  const icon = sourceIcon[source.sources?.name] || '📌';
  const link = source.url ? `<a href="${escapeHTML(source.url)}" target="_blank">${escapeHTML(source.url)}</a>` : '';

  return `<div class="source-attribution">
    <div class="source-attribution__header">${icon} ${escapeHTML(source.sources?.name || 'Unknown')}</div>
    ${source.excerpt ? `<p class="source-attribution__quote">"${escapeHTML(source.excerpt)}"</p>` : ''}
    ${link}
  </div>`;
}

/**
 * reviewLinksHTML — renders writer and food_press source links in the detail view.
 * Only writer and food_press tier rows from restaurant_sources are shown.
 * Fetches asynchronously after detail view renders.
 * @param {string} restaurantId — uuid of the restaurant
 * @returns {Promise<string>} HTML string (empty string if no writer/food_press sources)
 */
async function reviewLinksHTML(restaurantId) {
  // Only writer and food_press tiers are readable articles — shown to users.
  // local_platform, google, tripadvisor are backend signals, not article links.
  const { data: sources, error } = await db
    .from('restaurant_sources')
    .select('url, excerpt, language, source_tier, sources(name)')
    .eq('restaurant_id', restaurantId)
    .in('source_tier', ['writer', 'food_press'])
    .not('url', 'is', null);

  if (error) {
    console.error('Failed to fetch review links:', error);
    return '';
  }

  if (!sources || sources.length === 0) {
    return '';
  }

  let html = '<div class="review-links"><h3>Reviews & articles</h3>';
  sources.forEach(src => {
    html += sourceAttributionHTML(src);
  });
  html += '</div>';

  return html;
}

/**
 * MISSING-06: dishes preview (card)
 * Spec: docs/design/MISSING_FEATURES.md — MISSING-06
 * Compact one-line preview: "Must order: ข้าวมันไก่ · ไก่ทอด"
 */
function dishesPreviewHTML(dishes) {
  if (!dishes || dishes.length === 0) return '';
  const names = dishes.slice(0, 3).map(d => d.name_th || d.name_en).join(' · ');
  return `<p class="card__dishes-preview">Must order: ${escapeHTML(names)}</p>`;
}

/**
 * MISSING-08: Michelin star rendering
 * Spec: docs/design/MISSING_FEATURES.md — MISSING-08
 */
function michelin StarHTML(r) {
  if (!r.michelin_star) return '';
  const stars = '⭐'.repeat(r.michelin_star);
  return `<span class="michelin-star" title="Michelin ${r.michelin_star} star">${stars}</span>`;
}

/**
 * MISSING-09: Halal badge
 * Spec: docs/design/MISSING_FEATURES.md — MISSING-09
 */
function halalBadgeHTML(r) {
  if (!r.halal_certified) return '';
  return '<span class="halal-badge" title="Halal certified">🕌</span>';
}

/* ════════════════════════════════════════════════════════════
   MAP
   ════════════════════════════════════════════════════════════ */

const MAP_TILE_URL  = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const MAP_TILE_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function initMap() {
  if (state.map) return;
  const mapEl = el('#map-container');
  if (!mapEl) return;

  state.map = L.map(mapEl).setView([CONFIG.mapDefaultLat, CONFIG.mapDefaultLng], CONFIG.mapDefaultZoom);
  L.tileLayer(MAP_TILE_URL, { attribution: MAP_TILE_ATTR, maxZoom: 19 }).addTo(state.map);
}

/* ════════════════════════════════════════════════════════════
   EVENT HANDLERS & NAVIGATION
   ════════════════════════════════════════════════════════════ */

function switchView(view) {
  state.activeView = view;
  updateUI();
}

function toggleLocationRequest() {
  if (state.locationStatus === 'granted') {
    state.locationStatus = 'denied';
  } else {
    requestLocation();
  }
}

/* ════════════════════════════════════════════════════════════
   INIT
   ════════════════════════════════════════════════════════════ */

async function init() {
  // Set initial view
  state.activeView = 'list';

  // Request location on startup (will run in background)
  requestLocation();

  // Fetch restaurants
  await fetchRestaurants();

  // Initial UI render
  updateUI();

  // Attach global event listeners
  on('#app', 'click', (e) => {
    if (e.target.id === 'btn-map') switchView('map');
    if (e.target.id === 'btn-list') switchView('list');
    if (e.target.id === 'btn-location') toggleLocationRequest();
  });
}

// Auto-init when DOM is ready
document.addEventListener('DOMContentLoaded', init);