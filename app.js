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
  searchActive:   false,        // Whether search bar is open
};

/* ── Initialize map & bootstrap app ────────────────────────── */
async function init() {
  try {
    // ── 1. Setup auth + userId ────────────────────────────────
    state.personalId = await setupAuth();

    // ── 2. Fetch restaurants from Supabase ─────────────────────
    await fetchRestaurants();

    // ── 3. Request GPS (async, non-blocking) ──────────────────
    requestLocation();

    // ── 4. Setup event listeners ──────────────────────────────
    setupEventListeners();

    // ── 5. Initialize map ─────────────────────────────────────
    await loadMap();

    // ── 6. Handle pending route ───────────────────────────────
    const pending = window.location.hash.slice(1);
    if (pending) {
      state.pendingRoute = pending;
      const rest = state.restaurants.find(r => r.id == pending);
      if (rest) {
        handleRoute(pending);
      }
    }
  } catch (err) {
    console.error('Init failed:', err);
  }
}

/* ────────────────────────────────────────────────────────────
   SUPABASE + AUTH
   ──────────────────────────────────────────────────────────── */

/**
 * setupAuth
 * - Create an anon session via supabase.auth
 * - Store the user ID in state for personal notes
 */
async function setupAuth() {
  try {
    const { data, error } = await db.auth.signInAnonymously();
    if (error) throw error;
    return data.user?.id || null;
  } catch (err) {
    console.error('Auth setup failed:', err);
    return null;
  }
}

/**
 * fetchRestaurants
 * - Query all restaurants from 'restaurants' table
 * - Cache in state.restaurants
 */
async function fetchRestaurants() {
  try {
    state.isLoading = true;
    const { data, error } = await db
      .from('restaurants')
      .select('*')
      .order('id', { ascending: true });
    
    if (error) throw error;

    state.restaurants = data || [];
    state.filtered = [...state.restaurants];
    applyFilters(); // Ensure filtered is in sync with filters
    renderList();
  } catch (err) {
    console.error('Fetch restaurants failed:', err);
  } finally {
    state.isLoading = false;
  }
}

/* ────────────────────────────────────────────────────────────
   GEOLOCATION (Build 2: MISSING-01)
   ──────────────────────────────────────────────────────────── */

/**
 * requestLocation
 * - Request GPS from the browser
 * - Async, non-blocking; updates state.userLat/Lng
 * - Enables 'nearest' sort option
 */
function requestLocation() {
  if (!navigator.geolocation) {
    state.locationStatus = 'unavailable';
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.userLat = pos.coords.latitude;
      state.userLng = pos.coords.longitude;
      state.locationStatus = 'granted';
      // Re-apply filters to show 'nearest' if it becomes available
      applyFilters();
      renderList();
    },
    (err) => {
      console.warn('Geolocation denied:', err);
      state.locationStatus = 'denied';
    }
  );
}

/* ────────────────────────────────────────────────────────────
   EVENT LISTENERS
   ──────────────────────────────────────────────────────────── */

function setupEventListeners() {
  // ── Map tab
  document.getElementById('tab-map').addEventListener('click', () => {
    state.activeView = 'map';
    renderUI();
  });

  // ── List tab
  document.getElementById('tab-list').addEventListener('click', () => {
    state.activeView = 'list';
    renderUI();
  });

  // ── Search tab
  document.getElementById('tab-search').addEventListener('click', () => {
    state.activeView = 'search';
    renderUI();
  });

  // ── Settings tab
  document.getElementById('tab-settings').addEventListener('click', () => {
    state.activeView = 'settings';
    renderUI();
  });

  // ── Close detail button
  document.getElementById('close-detail').addEventListener('click', () => {
    state.selectedId = null;
    state.activeView = 'map';
    renderUI();
  });

  // ── Filter event listeners (cuisine, zone, rating)
  document.getElementById('filter-cuisine').addEventListener('change', () => {
    applyFilters();
    renderList();
  });

  document.getElementById('filter-zone').addEventListener('change', () => {
    applyFilters();
    renderList();
  });

  document.getElementById('filter-rating').addEventListener('change', () => {
    applyFilters();
    renderList();
  });

  // ── Sort order listener
  document.getElementById('filter-sort').addEventListener('change', (e) => {
    state.sortOrder = e.target.value;
    applyFilters();
    renderList();
  });

  // ── Search input (B2_16)
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.toLowerCase();
      applyFilters();
      renderList();
    });

    searchInput.addEventListener('focus', () => {
      state.searchActive = true;
      renderUI();
    });

    searchInput.addEventListener('blur', () => {
      state.searchActive = false;
      renderUI();
    });
  }
}

/* ────────────────────────────────────────────────────────────
   FILTERS & SEARCH (B2_07, B2_16)
   ──────────────────────────────────────────────────────────── */

/**
 * applyFilters
 * - Combines all active filters (cuisine, zone, rating, sort, search)
 * - Updates state.filtered
 * - Handles 'nearest' sort (requires GPS)
 */
function applyFilters() {
  let results = [...state.restaurants];

  // ── Cuisine filter
  const cuisine = document.getElementById('filter-cuisine')?.value;
  if (cuisine && cuisine !== 'all') {
    results = results.filter(r => r.cuisine === cuisine);
  }

  // ── Zone filter
  const zone = document.getElementById('filter-zone')?.value;
  if (zone && zone !== 'all') {
    results = results.filter(r => r.zone === zone);
  }

  // ── Rating filter
  const ratingMin = parseFloat(document.getElementById('filter-rating')?.value || 0);
  results = results.filter(r => (r.rating || 0) >= ratingMin);

  // ── Search filter (B2_16)
  if (state.searchQuery) {
    const q = state.searchQuery;
    results = results.filter(r => 
      (r.name?.toLowerCase().includes(q)) ||
      (r.notes?.toLowerCase().includes(q)) ||
      (r.cuisine?.toLowerCase().includes(q))
    );
  }

  // ── Sort
  const sortOrder = state.sortOrder || 'rating';
  if (sortOrder === 'nearest' && state.userLat && state.userLng) {
    results.sort((a, b) => {
      const distA = haversine(state.userLat, state.userLng, a.lat, a.lng);
      const distB = haversine(state.userLat, state.userLng, b.lat, b.lng);
      return distA - distB;
    });
  } else {
    // ── Default: sort by rating (descending)
    results.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  }

  state.filtered = results;
}

/**
 * haversine
 * - Calculates distance between two lat/lng points (km)
 */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

/* ────────────────────────────────────────────────────────────
   MAP
   ──────────────────────────────────────────────────────────── */

/**
 * loadMap
 * - Initialize Leaflet map centered on Bangkok
 * - Add restaurant pins
 */
async function loadMap() {
  const mapEl = document.getElementById('map-container');
  if (!mapEl) return;

  state.map = L.map(mapEl).setView(
    [CONFIG.mapDefaultLat, CONFIG.mapDefaultLng],
    CONFIG.mapDefaultZoom
  );

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19,
  }).addTo(state.map);

  // Add pins for all restaurants
  state.restaurants.forEach(rest => {
    const marker = L.marker([rest.lat, rest.lng])
      .bindPopup(rest.name)
      .on('click', () => {
        state.selectedId = rest.id;
        state.activeView = 'detail';
        renderUI();
      });
    
    marker.addTo(state.map);
    state.mapPins.set(rest.id, marker);
  });
}

/* ────────────────────────────────────────────────────────────
   RENDER UI
   ──────────────────────────────────────────────────────────── */

function renderUI() {
  // ── Render tabs (active / inactive)
  renderTabs();

  // ── Render active view
  switch (state.activeView) {
    case 'map':
      document.getElementById('view-map').style.display = 'block';
      document.getElementById('view-list').style.display = 'none';
      document.getElementById('view-search').style.display = 'none';
      document.getElementById('view-settings').style.display = 'none';
      document.getElementById('view-detail').style.display = 'none';
      if (state.map) {
        setTimeout(() => state.map.invalidateSize(), 100);
      }
      break;

    case 'list':
      document.getElementById('view-map').style.display = 'none';
      document.getElementById('view-list').style.display = 'block';
      document.getElementById('view-search').style.display = 'none';
      document.getElementById('view-settings').style.display = 'none';
      document.getElementById('view-detail').style.display = 'none';
      break;

    case 'search':
      document.getElementById('view-map').style.display = 'none';
      document.getElementById('view-list').style.display = 'none';
      document.getElementById('view-search').style.display = 'block';
      document.getElementById('view-settings').style.display = 'none';
      document.getElementById('view-detail').style.display = 'none';
      // Focus search input
      const searchInput = document.getElementById('search-input');
      if (searchInput && state.searchActive) {
        searchInput.focus();
      }
      break;

    case 'settings':
      document.getElementById('view-map').style.display = 'none';
      document.getElementById('view-list').style.display = 'none';
      document.getElementById('view-search').style.display = 'none';
      document.getElementById('view-settings').style.display = 'block';
      document.getElementById('view-detail').style.display = 'none';
      break;

    case 'detail':
      document.getElementById('view-map').style.display = 'none';
      document.getElementById('view-list').style.display = 'none';
      document.getElementById('view-search').style.display = 'none';
      document.getElementById('view-settings').style.display = 'none';
      document.getElementById('view-detail').style.display = 'block';
      renderDetail();
      break;
  }
}

function renderTabs() {
  const tabs = ['map', 'list', 'search', 'settings'];
  tabs.forEach(tab => {
    const el = document.getElementById(`tab-${tab}`);
    if (el) {
      el.classList.toggle('active', state.activeView === tab);
    }
  });
}

/**
 * renderList
 * - Render restaurant list view (state.filtered)
 */
function renderList() {
  const listContainer = document.getElementById('restaurant-list');
  if (!listContainer) return;

  listContainer.innerHTML = state.filtered.map(rest => `
    <div class="list-item" data-id="${rest.id}" onclick="selectRestaurant(${rest.id})">
      <div class="list-item-header">
        <h3>${rest.name}</h3>
        <span class="list-item-rating">${rest.rating ? rest.rating.toFixed(1) + '★' : 'N/A'}</span>
      </div>
      <p class="list-item-cuisine">${rest.cuisine} • ${rest.zone}</p>
      <p class="list-item-notes">${rest.notes || ''}</p>
      ${state.userLat && state.userLng ? `
        <p class="list-item-distance">${haversine(state.userLat, state.userLng, rest.lat, rest.lng).toFixed(1)}km away</p>
      ` : ''}
    </div>
  `).join('');
}

/**
 * renderDetail
 * - Render full detail view (map, notes, edit button)
 * - B2_15: personalNotesHTML() + auto-save + Saved indicator
 */
function renderDetail() {
  const detailContainer = document.getElementById('detail-container');
  if (!detailContainer) return;

  const rest = state.restaurants.find(r => r.id === state.selectedId);
  if (!rest) return;

  // Fetch personal notes for this restaurant
  const personalNote = state.personalData.get(state.selectedId) || {};
  const notes = personalNote.notes || '';

  detailContainer.innerHTML = `
    <div class="detail-header">
      <h2>${rest.name}</h2>
      <button id="close-detail">✕</button>
    </div>

    <div class="detail-content">
      <div class="detail-meta">
        <p><strong>Cuisine:</strong> ${rest.cuisine}</p>
        <p><strong>Zone:</strong> ${rest.zone}</p>
        <p><strong>Rating:</strong> ${rest.rating ? rest.rating.toFixed(1) + '★' : 'N/A'}</p>
        <p><strong>Notes:</strong> ${rest.notes || ''}</p>
      </div>

      ${personalNotesHTML(rest.id, notes)}

      <div class="detail-actions">
        <button onclick="openMap(${rest.id})">Open on Map</button>
      </div>
    </div>
  `;

  // Re-attach close listener (since we just re-rendered)
  document.getElementById('close-detail').addEventListener('click', () => {
    state.selectedId = null;
    state.activeView = 'map';
    renderUI();
  });

  // Attach autosave listener for personal notes
  setupPersonalNotesAutosave(rest.id);
}

/**
 * personalNotesHTML
 * - Returns HTML for the personal notes section
 * - B2_15: includes notes textarea + Saved indicator
 */
function personalNotesHTML(restaurantId, currentNotes) {
  return `
    <div class="personal-notes-section">
      <h3>My Notes</h3>
      <textarea 
        id="personal-notes-${restaurantId}"
        class="personal-notes-input"
        placeholder="Add your personal notes here..."
      >${currentNotes}</textarea>
      <div class="notes-footer">
        <span id="saved-indicator-${restaurantId}" class="saved-indicator" style="display:none;">✓ Saved</span>
      </div>
    </div>
  `;
}

/**
 * setupPersonalNotesAutosave
 * - B2_15: Auto-saves personal notes to Supabase
 * - 1s debounce + Saved indicator
 */
function setupPersonalNotesAutosave(restaurantId) {
  const textarea = document.getElementById(`personal-notes-${restaurantId}`);
  const savedIndicator = document.getElementById(`saved-indicator-${restaurantId}`);
  if (!textarea) return;

  let debounceTimer;
  let hasChanged = false;

  textarea.addEventListener('input', () => {
    hasChanged = true;
    if (savedIndicator) {
      savedIndicator.style.display = 'none';
    }

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      savePersonalNotes(restaurantId, textarea.value);
    }, 1000);
  });
}

/**
 * savePersonalNotes
 * - Saves personal notes to Supabase personal_notes table
 * - Shows Saved indicator on success
 */
async function savePersonalNotes(restaurantId, notes) {
  if (!state.personalId) return;

  try {
    const { data, error } = await db
      .from('personal_notes')
      .upsert([
        {
          user_id: state.personalId,
          restaurant_id: restaurantId,
          notes: notes,
          updated_at: new Date().toISOString(),
        }
      ], { onConflict: 'user_id,restaurant_id' });

    if (error) throw error;

    // Update local cache
    state.personalData.set(restaurantId, { notes: notes });

    // Show saved indicator
    const savedIndicator = document.getElementById(`saved-indicator-${restaurantId}`);
    if (savedIndicator) {
      savedIndicator.style.display = 'inline';
      setTimeout(() => {
        savedIndicator.style.display = 'none';
      }, 2000);
    }

    console.log('Personal notes saved:', restaurantId);
  } catch (err) {
    console.error('Save personal notes failed:', err);
  }
}

/**
 * openMap
 * - Zoom to restaurant pin on map
 */
function openMap(restaurantId) {
  const rest = state.restaurants.find(r => r.id === restaurantId);
  if (!rest || !state.map) return;

  state.activeView = 'map';
  renderUI();

  // Zoom to pin
  setTimeout(() => {
    state.map.setView([rest.lat, rest.lng], CONFIG.mapPinZoom);
    const pin = state.mapPins.get(restaurantId);
    if (pin) pin.openPopup();
  }, 100);
}

/**
 * selectRestaurant
 * - Set active restaurant and switch to detail view
 */
function selectRestaurant(restaurantId) {
  state.selectedId = restaurantId;
  state.activeView = 'detail';
  renderUI();
}

/**
 * handleRoute
 * - Called when user navigates via hash (e.g., #123)
 * - Shows detail view for that restaurant
 */
function handleRoute(restaurantId) {
  const rest = state.restaurants.find(r => r.id == restaurantId);
  if (!rest) {
    console.warn('Restaurant not found:', restaurantId);
    state.activeView = 'map';
  } else {
    state.selectedId = restaurantId;
    state.activeView = 'detail';
  }
  renderUI();

  // Clear pending route
  state.pendingRoute = null;
}

/**
 * onHashChange
 * - Monitor hash changes and update view
 */
window.addEventListener('hashchange', () => {
  const pending = window.location.hash.slice(1);
  if (pending) {
    handleRoute(pending);
  } else {
    state.activeView = 'map';
    state.selectedId = null;
    renderUI();
  }
});

document.addEventListener('DOMContentLoaded', init);
