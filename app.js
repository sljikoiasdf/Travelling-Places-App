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

/* ════════════════════════════════════════════════════════════
   UTILS
   ════════════════════════════════════════════════════════════ */

function debounce(fn, delay) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/* ────────────────────────────────────────────────────────── */
/* Cache operations */
/* ────────────────────────────────────────────────────────── */

const cache = {
  set: async (key, value, ttlMs = CONFIG.cacheTTL) => {
    const item = {
      value,
      expires: Date.now() + ttlMs,
    };
    try {
      localStorage.setItem(key, JSON.stringify(item));
    } catch (e) {
      console.warn('Cache write failed:', e);
    }
  },

  get: (key) => {
    try {
      const item = JSON.parse(localStorage.getItem(key));
      if (!item) return null;
      if (item.expires && item.expires < Date.now()) {
        localStorage.removeItem(key);
        return null;
      }
      return item.value;
    } catch (e) {
      console.warn('Cache read failed:', e);
      return null;
    }
  },

  clear: () => {
    try {
      localStorage.clear();
    } catch (e) {
      console.warn('Cache clear failed:', e);
    }
  },
};

/* ────────────────────────────────────────────────────────── */
/* Formatting utils */
/* ────────────────────────────────────────────────────────── */

function formatDistance(meters) {
  if (meters < 1000) {
    return Math.round(meters) + ' m';
  }
  return (meters / 1000).toFixed(1) + ' km';
}

function formatRating(r) {
  if (!r) return 'N/A';
  if (r < 0) return '0';
  if (r > 5) return '5';
  return r.toFixed(1);
}

function formatPhoneForDisplay(phone) {
  if (!phone) return '';
  // Thai phone format: +66 XX XXXX XXXX or similar
  return phone;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/* ════════════════════════════════════════════════════════════
   DATABASE & DATA LOADING
   ════════════════════════════════════════════════════════════ */

async function fetchRestaurants() {
  try {
    state.isLoading = true;

    // Check cache
    const cached = cache.get('restaurants_cache');
    if (cached) {
      state.restaurants = cached;
      applyFilters();
      state.isLoading = false;
      return;
    }

    // Fetch from Supabase
    const { data, error } = await db
      .from('restaurants')
      .select('*')
      .order('name');

    if (error) {
      console.error('Fetch error:', error);
      state.isLoading = false;
      return;
    }

    state.restaurants = data || [];
    cache.set('restaurants_cache', state.restaurants);
    applyFilters();
  } catch (e) {
    console.error('Fetch failed:', e);
  } finally {
    state.isLoading = false;
  }
}

async function loadPersonalData() {
  try {
    const { data: { user } } = await db.auth.getUser();
    if (!user) return;

    state.personalId = user.id;

    const { data, error } = await db
      .from('personal_restaurants')
      .select('*')
      .eq('user_id', user.id);

    if (error) {
      console.error('Personal data error:', error);
      return;
    }

    if (data) {
      data.forEach(item => {
        state.personalData.set(item.restaurant_id, item);
      });
    }
  } catch (e) {
    console.error('Load personal data failed:', e);
  }
}

/* ────────────────────────────────────────────────────────── */
/* Geolocation (MISSING-01, MISSING-16) */
/* ────────────────────────────────────────────────────────── */

function requestLocation() {
  if (!navigator.geolocation) {
    state.locationStatus = 'unavailable';
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.userLat = position.coords.latitude;
      state.userLng = position.coords.longitude;
      state.locationStatus = 'granted';
      state.sortOrder = 'nearest';
      applyFilters();
      renderUI();
    },
    (error) => {
      state.locationStatus = 'denied';
      console.warn('Geolocation denied:', error.message);
    },
    { timeout: 5000, enableHighAccuracy: false }
  );
}

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
   FILTERING & SORTING
   ════════════════════════════════════════════════════════════ */

function applyFilters() {
  let results = [...state.restaurants];

  // Filter by cuisine
  if (state.activeFilters.cuisine) {
    results = results.filter(r =>
      r.cuisines && r.cuisines.includes(state.activeFilters.cuisine)
    );
  }

  // Filter by price
  if (state.activeFilters.price) {
    results = results.filter(r => r.price_level === state.activeFilters.price);
  }

  // Filter by distance (if user location is available)
  if (state.locationStatus === 'granted' && state.userLat !== null && state.userLng !== null) {
    results = results.filter(r => {
      const dist = haversineDistance(
        state.userLat, state.userLng,
        r.latitude, r.longitude
      );
      return dist <= state.nearMeRadiusM;
    });
  }

  // Sort
  if (state.sortOrder === 'nearest' && state.locationStatus === 'granted') {
    results.sort((a, b) => {
      const distA = haversineDistance(
        state.userLat, state.userLng,
        a.latitude, a.longitude
      );
      const distB = haversineDistance(
        state.userLat, state.userLng,
        b.latitude, b.longitude
      );
      return distA - distB;
    });
  } else {
    // Sort by rating (default)
    results.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  }

  state.filtered = results;
}

/* ════════════════════════════════════════════════════════════
   MAP (Leaflet)
   ════════════════════════════════════════════════════════════ */

function initMap() {
  if (state.map) return; // Already initialized

  state.map = L.map('map').setView(
    [CONFIG.mapDefaultLat, CONFIG.mapDefaultLng],
    CONFIG.mapDefaultZoom
  );

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(state.map);
}

function renderPins(restaurants) {
  // Clear old pins
  state.mapPins.forEach((marker) => {
    state.map.removeLayer(marker);
  });
  state.mapPins.clear();

  // Add new pins
  restaurants.forEach(r => {
    const marker = L.marker([r.latitude, r.longitude])
      .bindPopup(`
        <div style="font-size: 14px;">
          <strong>${escapeHtml(r.name)}</strong><br/>
          Rating: ${formatRating(r.rating)}/5<br/>
          <a href="#detail/${r.id}" onclick="handleDetailRoute('${r.id}')">View details</a>
        </div>
      `)
      .on('click', () => {
        state.selectedId = r.id;
        showDetailView(r);
      })
      .addTo(state.map);

    state.mapPins.set(r.id, marker);
  });
}

/* ════════════════════════════════════════════════════════════
   UI RENDERING
   ════════════════════════════════════════════════════════════ */

function renderUI() {
  renderNavBar();
  renderView();
}

function renderNavBar() {
  const nav = document.getElementById('nav');
  if (!nav) return;

  let html = '<div class="nav-container">';

  // View tabs
  html += '<div class="nav-tabs">';
  html += `<button class="nav-tab ${state.activeView === 'map' ? 'active' : ''}" onclick="switchView('map')">Map</button>`;
  html += `<button class="nav-tab ${state.activeView === 'list' ? 'active' : ''}" onclick="switchView('list')">List</button>`;
  html += '</div>';

  // Filter section
  html += '<div class="nav-filters">';
  html += '<button onclick="toggleFilterPanel()" class="filter-btn">Filters</button>';
  if (state.locationStatus === 'granted') {
    html += `<button onclick="switchSortOrder()" class="sort-btn">Sort: ${state.sortOrder}</button>`;
  } else {
    html += `<button onclick="requestLocation()" class="location-btn">Get Location</button>`;
  }
  html += '</div>';

  // Filter panel (hidden by default)
  html += '<div id="filter-panel" class="filter-panel" style="display: none;">';
  html += '<h3>Filters</h3>';
  html += '<label>Cuisine: <select onchange="setFilter(\'cuisine\', this.value)" id="cuisine-filter"><option value="">All</option></select></label>';
  html += '<label>Price: <select onchange="setFilter(\'price\', this.value)" id="price-filter"><option value="">All</option></select></label>';
  html += '</div>';

  html += '</div>';
  nav.innerHTML = html;

  // Populate cuisine filter
  const cuisines = new Set();
  state.restaurants.forEach(r => {
    if (r.cuisines) {
      r.cuisines.forEach(c => cuisines.add(c));
    }
  });
  const cuisineSelect = document.getElementById('cuisine-filter');
  if (cuisineSelect) {
    Array.from(cuisines).sort().forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      cuisineSelect.appendChild(opt);
    });
  }
}

function renderView() {
  const content = document.getElementById('content');
  if (!content) return;

  if (state.activeView === 'map') {
    renderMapView();
  } else {
    renderListView();
  }
}

function renderMapView() {
  const content = document.getElementById('content');
  content.innerHTML = '<div id="map" style="width: 100%; height: 100%;"></div>';
  setTimeout(() => {
    initMap();
    renderPins(state.filtered);
  }, 0);
}

function renderListView() {
  const content = document.getElementById('content');
  let html = '<div class="list-view">';

  if (state.filtered.length === 0) {
    html += '<p>No restaurants found</p>';
  } else {
    state.filtered.forEach(r => {
      const distance = state.locationStatus === 'granted' && state.userLat !== null
        ? formatDistance(haversineDistance(state.userLat, state.userLng, r.latitude, r.longitude))
        : 'N/A';
      html += `
        <div class="restaurant-card" onclick="showDetailView({id: '${r.id}', name: '${escapeHtml(r.name)}', rating: ${r.rating || 0}, cuisines: '${r.cuisines ? r.cuisines.join(', ') : ''}', latitude: ${r.latitude}, longitude: ${r.longitude}, phone: '${r.phone || ''}', address: '${escapeHtml(r.address || '')}', description: '${escapeHtml(r.description || '')}', review_links: ${JSON.stringify(r.review_links || [])}})">
          <h3>${escapeHtml(r.name)}</h3>
          <p>Rating: ${formatRating(r.rating)}/5</p>
          <p>Distance: ${distance}</p>
          <p>${r.cuisines ? r.cuisines.join(', ') : 'N/A'}</p>
        </div>
      `;
    });
  }

  html += '</div>';
  content.innerHTML = html;
}

function showDetailView(restaurant) {
  // MISSING-19: Add review links to detail view
  const reviewLinksHtml = restaurant.review_links && restaurant.review_links.length > 0
    ? `<div class="review-links"><h4>Reviews</h4><ul>` +
      restaurant.review_links.map(link => 
        `<li><a href="${escapeHtml(link.url)}" target="_blank">${escapeHtml(link.source)}</a></li>`
      ).join('') +
      `</ul></div>`
    : '';

  const detailHtml = `
    <div class="detail-view">
      <button onclick="backToList()">Back</button>
      <h2>${escapeHtml(restaurant.name)}</h2>
      <p><strong>Rating:</strong> ${formatRating(restaurant.rating)}/5</p>
      <p><strong>Address:</strong> ${escapeHtml(restaurant.address || 'N/A')}</p>
      <p><strong>Phone:</strong> ${formatPhoneForDisplay(restaurant.phone || 'N/A')}</p>
      <p><strong>Cuisines:</strong> ${restaurant.cuisines ? restaurant.cuisines.join(', ') : 'N/A'}</p>
      <p><strong>Description:</strong> ${escapeHtml(restaurant.description || 'No description')}</p>
      ${reviewLinksHtml}
    </div>
  `;

  const content = document.getElementById('content');
  content.innerHTML = detailHtml;
  state.activeView = 'detail';
}

/* ════════════════════════════════════════════════════════════
   EVENT HANDLERS
   ════════════════════════════════════════════════════════════ */

function switchView(view) {
  state.activeView = view;
  renderUI();
  window.location.hash = view === 'map' ? '#map' : '#list';
}

function toggleFilterPanel() {
  const panel = document.getElementById('filter-panel');
  if (panel) {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  }
}

function setFilter(key, value) {
  state.activeFilters[key] = value || undefined;
  applyFilters();
  renderView();
}

function switchSortOrder() {
  if (state.locationStatus !== 'granted') return;
  state.sortOrder = state.sortOrder === 'nearest' ? 'rating' : 'nearest';
  applyFilters();
  renderView();
}

function backToList() {
  state.activeView = 'list';
  renderUI();
  window.location.hash = '#list';
}

function handleDetailRoute(restaurantId) {
  const restaurant = state.restaurants.find(r => r.id === restaurantId);
  if (restaurant) {
    showDetailView(restaurant);
    window.location.hash = `#detail/${restaurantId}`;
  }
}

function handleRoute(hash) {
  // Remove leading #
  const route = hash.replace(/^#/, '');

  if (route.startsWith('detail/')) {
    const id = route.split('/')[1];
    handleDetailRoute(id);
  } else if (route === 'map' || !route) {
    state.activeView = 'map';
    renderUI();
  } else if (route === 'list') {
    state.activeView = 'list';
    renderUI();
  }
}

window.addEventListener('hashchange', () => {
  handleRoute(window.location.hash);
});

/* ════════════════════════════════════════════════════════════
   INITIALIZATION
   ════════════════════════════════════════════════════════════ */

async function init() {
  // Request geolocation on init
  requestLocation();

  // Load data
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