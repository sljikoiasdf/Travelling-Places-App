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
  mapFallbackLat:  0,            // Neutral world view — overridden by GPS or city pick
  mapFallbackLng:  0,
  mapFallbackZoom: 2,
  mapPinZoom:     15,
  mapGPSZoom:     16,            // Tight local zoom on GPS lock — "what's near me right now"
  mapCityZoom:    14,            // Zoom level when user picks a city
  // Zoom tier thresholds for pin rendering
  zoomClose:      15,            // >= 15: dots + name labels
  zoomMid:        12,            // 12–14: dots only (no labels)
                                 // < 12: cluster mode
  fetchRadiusM:   50000,         // Radius for nearby_restaurants RPC (50km)
  reFetchDistM:   20000,         // Pan > 20km from last fetch centre → re-fetch
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
  mapCluster:     null,
  mapLayers:      { markers: {}, clusters: null },
  mapFetchCentre: null,         // Track last fetch location for re-fetch logic
  gpsWatch:       null,
  gpsLocked:      false,
  filtersOpen:    false,
};

/* ────────────────────────────────────────────────────────────
   INIT — Register SW, hydrate restaurants, bind UI
   ──────────────────────────────────────────────────────────── */

window.addEventListener('DOMContentLoaded', async () => {
  // Register service worker for offline support
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js');
      console.log('[app] Service Worker registered');
    } catch (err) {
      console.warn('[app] SW registration failed:', err);
    }
  }

  // Fetch and hydrate restaurant data
  await hydrateRestaurants();

  // Initialize map
  initMap();

  // Bind UI event listeners
  bindUI();

  // Resolve any pending route (hash navigation)
  resolvePendingRoute();
});

/* ────────────────────────────────────────────────────────────
   HYDRATE RESTAURANTS — fetch from Supabase, cache locally
   ──────────────────────────────────────────────────────────── */

async function hydrateRestaurants() {
  const cacheKey = `restaurants_${CONFIG.cacheVersion}`;
  const now = Date.now();
  const cached = localStorage.getItem(cacheKey);

  if (cached) {
    const { data, timestamp } = JSON.parse(cached);
    if (now - timestamp < CONFIG.cacheTTL) {
      console.log('[app] Using cached restaurants');
      state.restaurants = data;
      return;
    }
  }

  console.log('[app] Fetching restaurants from Supabase...');
  try {
    const { data, error } = await db
      .from('restaurants')
      .select('*');

    if (error) throw error;

    state.restaurants = data || [];
    localStorage.setItem(cacheKey, JSON.stringify({
      data: state.restaurants,
      timestamp: now,
    }));
    console.log(`[app] Fetched ${state.restaurants.length} restaurants`);
  } catch (err) {
    console.error('[app] Failed to fetch restaurants:', err);
    state.restaurants = [];
  }
}

/* ────────────────────────────────────────────────────────────
   MAP INIT — Leaflet setup, GPS, pan listener for re-fetch
   ──────────────────────────────────────────────────────────── */

function initMap() {
  const mapEl = document.getElementById('map');
  if (!mapEl) return;

  state.map = L.map(mapEl).setView(
    [CONFIG.mapFallbackLat, CONFIG.mapFallbackLng],
    CONFIG.mapFallbackZoom
  );

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(state.map);

  // Add open/closed legend at bottom-left
  addMapLegend();

  // Render initial pins based on zoom level
  renderMapPins();

  // Pan listener — re-fetch if moved > 20km from last fetch centre
  state.map.on('moveend', () => {
    checkAndRefetchIfPanned();
  });

  // Zoom listener — re-render pins on zoom change
  state.map.on('zoomend', () => {
    renderMapPins();
  });

  // GPS tracking
  enableGPS();
}

function addMapLegend() {
  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `
      <div class="legend-item"><span class="legend-dot" style="background: #4CAF50;"></span> Open</div>
      <div class="legend-item"><span class="legend-dot" style="background: #E53935;"></span> Closed</div>
      <div class="legend-item"><span class="legend-dot" style="background: #4A4440;"></span> Unknown</div>
    `;
    return div;
  };
  legend.addTo(state.map);
}

function checkAndRefetchIfPanned() {
  if (!state.mapFetchCentre || !state.map) return;

  const centre = state.map.getCenter();
  const distance = L.latLng(state.mapFetchCentre).distanceTo(centre);

  if (distance > CONFIG.reFetchDistM) {
    console.log(`[map] Panned ${Math.round(distance / 1000)}km — re-fetching...`);
    refetchNearby();
  }
}

/* ────────────────────────────────────────────────────────────
   GPS — Request permission, watch position, auto-zoom
   ──────────────────────────────────────────────────────────── */

async function enableGPS() {
  if (!navigator.geolocation) {
    console.warn('[gps] Geolocation not available');
    return;
  }

  try {
    state.gpsWatch = navigator.geolocation.watchPosition(
      (pos) => onGPSSuccess(pos),
      (err) => onGPSError(err),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  } catch (err) {
    console.warn('[gps] watch failed:', err);
  }
}

function onGPSSuccess(pos) {
  const { latitude, longitude } = pos.coords;
  console.log(`[gps] Locked: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);

  state.gpsLocked = true;
  state.map.setView([latitude, longitude], CONFIG.mapGPSZoom);
  state.mapFetchCentre = [latitude, longitude];
  refetchNearby();

  // Mark user location on map
  if (window.gpsMarker) window.gpsMarker.remove();
  window.gpsMarker = L.circleMarker([latitude, longitude], {
    radius: 8,
    fillColor: '#2196F3',
    color: '#fff',
    weight: 2,
    opacity: 1,
    fillOpacity: 0.8,
  }).addTo(state.map);
}

function onGPSError(err) {
  console.warn(`[gps] Error: ${err.message}`);
}

/* ────────────────────────────────────────────────────────────
   NEARBY FETCH — RPC to nearby_restaurants, store in state
   ──────────────────────────────────────────────────────────── */

async function refetchNearby() {
  if (!state.mapFetchCentre) return;

  const [lat, lng] = state.mapFetchCentre;
  console.log(`[fetch] Nearby restaurants at ${lat}, ${lng}...`);

  try {
    const { data, error } = await db.rpc('nearby_restaurants', {
      lat,
      lng,
      radius_m: CONFIG.fetchRadiusM,
      limit: CONFIG.nearbyLimit,
    });

    if (error) throw error;

    // Merge with state, prefer RPC results (filtered nearby)
    state.filtered = data || state.restaurants;
    renderMapPins();
    console.log(`[fetch] Got ${state.filtered.length} nearby restaurants`);
  } catch (err) {
    console.error('[fetch] RPC failed:', err);
    state.filtered = state.restaurants; // Fallback to all
    renderMapPins();
  }
}

/* ────────────────────────────────────────────────────────────
   RENDER MAP PINS — Zoom-tier logic
   ──────────────────────────────────────────────────────────── */

function renderMapPins() {
  if (!state.map) return;

  const zoom = state.map.getZoom();

  // Clear old markers
  Object.values(state.mapLayers.markers).forEach(m => m.remove());
  state.mapLayers.markers = {};
  if (state.mapLayers.clusters) state.mapLayers.clusters.remove();

  const data = state.filtered.length ? state.filtered : state.restaurants;

  if (zoom >= CONFIG.zoomClose) {
    // Tier 1: >= 15 — dots + name labels
    renderPinsWithLabels(data, zoom);
  } else if (zoom >= CONFIG.zoomMid) {
    // Tier 2: 12–14 — dots only
    renderPinsWithoutLabels(data, zoom);
  } else {
    // Tier 3: < 12 — clusters
    renderClusters(data);
  }
}

function renderPinsWithLabels(data, zoom) {
  console.log(`[pins] Rendering ${data.length} pins + labels (zoom ${zoom})`);
  data.forEach(r => {
    const colour = getStatusColour(r.open_status);
    const marker = L.circleMarker([r.latitude, r.longitude], {
      radius: 6,
      fillColor: colour,
      color: '#fff',
      weight: 1,
      opacity: 1,
      fillOpacity: 0.85,
    }).addTo(state.map);

    const label = L.tooltip({
      permanent: true,
      direction: 'top',
      offset: [0, -10],
      className: 'pin-label',
    });
    label.setContent(r.name_en || r.name_th);
    marker.bindTooltip(label);

    marker.on('click', () => selectRestaurant(r.id));
    state.mapLayers.markers[r.id] = marker;
  });
}

function renderPinsWithoutLabels(data, zoom) {
  console.log(`[pins] Rendering ${data.length} pins (zoom ${zoom})`);
  data.forEach(r => {
    const colour = getStatusColour(r.open_status);
    const marker = L.circleMarker([r.latitude, r.longitude], {
      radius: 5,
      fillColor: colour,
      color: '#fff',
      weight: 1,
      opacity: 1,
      fillOpacity: 0.85,
    }).addTo(state.map);

    marker.on('click', () => selectRestaurant(r.id));
    state.mapLayers.markers[r.id] = marker;
  });
}

function renderClusters(data) {
  console.log(`[clusters] Clustering ${data.length} restaurants...`);
  // Simplified clustering: group by ~0.5° lat/lng grid
  const clusters = {};
  data.forEach(r => {
    const key = `${Math.round(r.latitude * 2)},${Math.round(r.longitude * 2)}`;
    if (!clusters[key]) clusters[key] = { lat: r.latitude, lng: r.longitude, count: 0 };
    clusters[key].count++;
  });

  Object.values(clusters).forEach(c => {
    const marker = L.circleMarker([c.lat, c.lng], {
      radius: Math.max(8, Math.min(15, 8 + c.count / 5)),
      fillColor: '#9C27B0',
      color: '#fff',
      weight: 1,
      opacity: 1,
      fillOpacity: 0.8,
    }).addTo(state.map);

    const label = L.tooltip({
      permanent: true,
      direction: 'center',
      className: 'cluster-label',
    });
    label.setContent(c.count);
    marker.bindTooltip(label);
  });
}

function getStatusColour(status) {
  switch (status) {
    case 'open':    return '#4CAF50';  // Green
    case 'closed':  return '#E53935';  // Red
    default:        return '#4A4440';  // Grey
  }
}

/* ────────────────────────────────────────────────────────────
   SELECTION & DETAIL VIEW
   ──────────────────────────────────────────────────────────── */

function selectRestaurant(id) {
  state.selectedId = id;
  const restaurant = state.restaurants.find(r => r.id === id);

  if (!restaurant) {
    console.warn(`[select] Restaurant ${id} not found`);
    return;
  }

  console.log(`[select] Selected: ${restaurant.name_en}`);
  showDetailView(restaurant);
}

function showDetailView(restaurant) {
  state.activeView = 'detail';
  const detailEl = document.getElementById('detail');
  if (!detailEl) return;

  detailEl.innerHTML = `
    <div class="detail-header">
      <button class="back-btn" onclick="closeDetail()">← Back</button>
      <h2>${restaurant.name_en || restaurant.name_th}</h2>
    </div>
    <div class="detail-content">
      <p><strong>Status:</strong> ${restaurant.open_status || 'Unknown'}</p>
      <p><strong>Cuisine:</strong> ${restaurant.cuisine_tags?.join(', ') || 'N/A'}</p>
      <p><strong>Address:</strong> ${restaurant.address || 'N/A'}</p>
      ${restaurant.phone ? `<p><strong>Phone:</strong> ${restaurant.phone}</p>` : ''}
      ${restaurant.website ? `<p><a href="${restaurant.website}" target="_blank">Website</a></p>` : ''}
    </div>
  `;

  detailEl.classList.add('active');
  document.getElementById('map').style.display = 'none';
}

function closeDetail() {
  state.activeView = 'map';
  state.selectedId = null;
  const detailEl = document.getElementById('detail');
  if (detailEl) detailEl.classList.remove('active');
  document.getElementById('map').style.display = 'block';
}

/* ────────────────────────────────────────────────────────────
   CITY PICKER — Set view and zoom
   ──────────────────────────────────────────────────────────── */

function cityPicker(name, lat, lng) {
  state.map.setView([lat, lng], CONFIG.mapCityZoom);
  state.mapFetchCentre = [lat, lng];
  refetchNearby();
  console.log(`[city] Picked: ${name}`);
}

/* ────────────────────────────────────────────────────────────
   FILTERS
   ──────────────────────────────────────────────────────────── */

function toggleFilters() {
  state.filtersOpen = !state.filtersOpen;
  const filterEl = document.getElementById('filters');
  if (filterEl) {
    filterEl.classList.toggle('open', state.filtersOpen);
  }
}

function applyFilter(key, value) {
  if (state.activeFilters[key] === value) {
    delete state.activeFilters[key];
  } else {
    state.activeFilters[key] = value;
  }

  state.filtered = state.restaurants.filter(r => {
    for (const [k, v] of Object.entries(state.activeFilters)) {
      if (k === 'cuisine' && !r.cuisine_tags?.includes(v)) return false;
      if (k === 'status' && r.open_status !== v) return false;
    }
    return true;
  });

  renderMapPins();
  console.log(`[filters] Applied: ${JSON.stringify(state.activeFilters)}`);
}

/* ────────────────────────────────────────────────────────────
   HASH ROUTING
   ──────────────────────────────────────────────────────────── */

function resolvePendingRoute() {
  const hash = window.location.hash.slice(1);
  if (hash.startsWith('restaurant/')) {
    const id = hash.replace('restaurant/', '');
    const restaurant = state.restaurants.find(r => r.id === parseInt(id));
    if (restaurant) {
      selectRestaurant(restaurant.id);
    } else {
      state.pendingRoute = id;
    }
  }
}

window.addEventListener('hashchange', resolvePendingRoute);

/* ────────────────────────────────────────────────────────────
   UI BINDINGS
   ──────────────────────────────────────────────────────────── */

function bindUI() {
  const citiesContainer = document.getElementById('cities');
  if (citiesContainer) {
    citiesContainer.innerHTML = `
      <button onclick="cityPicker('Bangkok', 13.7563, 100.5018)">Bangkok</button>
      <button onclick="cityPicker('Chiang Mai', 18.7883, 98.9853)">Chiang Mai</button>
      <button onclick="cityPicker('Koh Chang', 12.0833, 102.3333)">Koh Chang</button>
    `;
  }

  const filterBtn = document.getElementById('filter-btn');
  if (filterBtn) {
    filterBtn.addEventListener('click', toggleFilters);
  }
}
