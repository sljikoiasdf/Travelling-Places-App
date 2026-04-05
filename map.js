/* ============================================================
   THAILAND FOOD GUIDE — map.js
   Leaflet map, zoom-tier pins, clusters, legend
   ============================================================ */

'use strict';

import { CONFIG } from './config.js';
import { state, dom } from './state.js';
import { escapeHTML, isOpenNow, haversineDistance } from './utils.js';
import { refreshFromNetwork } from './data.js';

/* ── Late-bound dep ─────────────────────────────────────────── */
let _openDetail = null;

function bindMapDeps(deps) {
  _openDetail = deps.openDetail;
}

/* ── Constants ──────────────────────────────────────────────── */

const MAP_TILE_URL  = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const MAP_TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/* ── Init ───────────────────────────────────────────────────── */

function initMap() {
  if (state.map) return;
  if (typeof L === 'undefined') {
    console.error('[map] Leaflet not loaded');
    return;
  }

  state.map = L.map(dom.mapContainer, {
    center: [CONFIG.mapFallbackLat, CONFIG.mapFallbackLng],
    zoom:   CONFIG.mapFallbackZoom,
    zoomControl: true,
    attributionControl: true,
  });
  L.tileLayer(MAP_TILE_URL, { attribution: MAP_TILE_ATTR, maxZoom: 19 }).addTo(state.map);
  setTimeout(() => state.map.invalidateSize(), 50);

  // Zoom change → re-render pins with correct tier
  state.map.on('zoomend', () => {
    if (state.filtered.length > 0) renderPins(state.filtered);
  });

  // Pan → fetch new area if moved far enough
  let _fetchDebounce = null;
  state.map.on('moveend', () => {
    clearTimeout(_fetchDebounce);
    _fetchDebounce = setTimeout(() => {
      if (!state.map) return;
      const centre = state.map.getCenter();
      if (state.lastFetchLat != null && state.lastFetchLng != null) {
        const dist = haversineDistance(state.lastFetchLat, state.lastFetchLng, centre.lat, centre.lng);
        if (dist > CONFIG.reFetchDistM) {
          refreshFromNetwork(centre.lat, centre.lng).catch(() => {});
        }
      }
    }, 600);
  });

  // Open/Closed legend
  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `<span class="map-legend__item"><span class="map-legend__dot map-legend__dot--open"></span>Open</span><span class="map-legend__item"><span class="map-legend__dot map-legend__dot--closed"></span>Closed</span>`;
    return div;
  };
  legend.addTo(state.map);
  state.mapLegend = legend;
}

/* ── Centre on user ─────────────────────────────────────────── */

function centreMapOnUser(zoom) {
  if (!state.map || !state.userLat || !state.userLng) return;

  const z = zoom || CONFIG.mapGPSZoom;
  state.map.setView([state.userLat, state.userLng], z, { animate: true });

  if (state.userLocationMarker) {
    state.userLocationMarker.remove();
    state.userLocationMarker = null;
  }

  const blueDotIcon = L.divIcon({
    className: '',
    html: `<div class="user-location-dot" aria-label="Your location"><div class="user-location-pulse"></div></div>`,
    iconSize:   [18, 18],
    iconAnchor: [9, 9],
  });

  state.userLocationMarker = L.marker([state.userLat, state.userLng], {
    icon: blueDotIcon,
    zIndexOffset: 1000,
    interactive: false,
  }).addTo(state.map);
}

/* ── Fit to pins ────────────────────────────────────────────── */

function fitMapToPins() {
  if (!state.map || state.mapPins.size === 0) return;
  const coords = [];
  state.mapPins.forEach(marker => coords.push(marker.getLatLng()));
  if (state.userLat && state.userLng) coords.push(L.latLng(state.userLat, state.userLng));
  if (coords.length > 0) {
    state.map.fitBounds(L.latLngBounds(coords), { padding: [40, 40], maxZoom: 15 });
  }
}

/* ── Zoom tier ──────────────────────────────────────────────── */

function getZoomTier() {
  if (!state.map) return 'far';
  const z = state.map.getZoom();
  if (z >= CONFIG.zoomClose) return 'close';
  if (z >= CONFIG.zoomMid)   return 'mid';
  return 'far';
}

/* ── Pin rendering ──────────────────────────────────────────── */

function renderPins(restaurants) {
  if (!state.map) return;

  state.mapPins.forEach(marker => marker.remove());
  state.mapPins.clear();
  if (state.clusterLayer) { state.clusterLayer.clearLayers(); state.clusterLayer.remove(); state.clusterLayer = null; }

  const tier = getZoomTier();
  if (tier === 'far') { renderClusters(restaurants); return; }

  restaurants.forEach(r => {
    if (!r.lat || !r.lng) return;
    const openStatus = isOpenNow(r.opening_hours);
    const personal   = state.personalData.get(r.id) || {};

    const dotClass = openStatus === 'open' || openStatus === 'closes_soon'
      ? 'map-dot--open'
      : openStatus === 'closed' ? 'map-dot--closed' : 'map-dot--unknown';

    const extraClasses = [];
    if (personal.is_wishlisted) extraClasses.push('map-dot--wishlisted');
    if (r.id === state.selectedId) extraClasses.push('map-dot--selected');

    const fullName = r.name_en || r.name_th || '';

    let html;
    if (tier === 'close') {
      const rawLabel = r.name_en || r.name_th || '';
      const pinLabel = rawLabel.length > 24 ? rawLabel.slice(0, 23) + '…' : rawLabel;
      html = `<div class="map-dot ${dotClass} ${extraClasses.join(' ')}" aria-label="${escapeHTML(fullName)}"></div><span class="map-dot__label">${escapeHTML(pinLabel)}</span>`;
    } else {
      html = `<div class="map-dot ${dotClass} ${extraClasses.join(' ')}" aria-label="${escapeHTML(fullName)}"></div>`;
    }

    const icon = L.divIcon({
      className: tier === 'close' ? 'map-dot-wrapper map-dot-wrapper--labelled' : 'map-dot-wrapper',
      html,
      iconSize:   [12, 12],
      iconAnchor: [6, 6],
    });

    const marker = L.marker([r.lat, r.lng], { icon }).addTo(state.map);
    marker.on('click', () => { if (_openDetail) _openDetail(r.id); });
    state.mapPins.set(r.id, marker);
  });
}

/* ── Cluster rendering ──────────────────────────────────────── */

function renderClusters(restaurants) {
  if (!state.map) return;
  state.clusterLayer = L.layerGroup().addTo(state.map);

  const cellSize = 0.5;
  const cells = new Map();
  restaurants.forEach(r => {
    if (!r.lat || !r.lng) return;
    const key = `${Math.floor(r.lat / cellSize)}_${Math.floor(r.lng / cellSize)}`;
    if (!cells.has(key)) cells.set(key, { lat: 0, lng: 0, count: 0 });
    const cell = cells.get(key);
    cell.lat += r.lat;
    cell.lng += r.lng;
    cell.count++;
  });

  cells.forEach(cell => {
    const cLat = cell.lat / cell.count;
    const cLng = cell.lng / cell.count;
    const size = cell.count > 20 ? 48 : cell.count > 5 ? 40 : 32;

    const icon = L.divIcon({
      className: '',
      html: `<div class="map-cluster" style="width:${size}px;height:${size}px">${cell.count}</div>`,
      iconSize:   [size, size],
      iconAnchor: [size / 2, size / 2],
    });

    const marker = L.marker([cLat, cLng], { icon }).addTo(state.clusterLayer);
    marker.on('click', () => {
      state.map.setView([cLat, cLng], CONFIG.zoomMid, { animate: true });
    });
  });
}

/* ── Select pin ─────────────────────────────────────────────── */

function selectMapPin(id) {
  state.mapPins.forEach((marker, markerId) => {
    const el = marker.getElement()?.querySelector('.map-dot');
    if (!el) return;
    el.classList.toggle('map-dot--selected', markerId === id);
  });
  const marker = state.mapPins.get(id);
  if (marker && state.map) state.map.panTo(marker.getLatLng(), { animate: true });
}

export {
  initMap,
  centreMapOnUser,
  fitMapToPins,
  renderPins,
  renderClusters,
  selectMapPin,
  bindMapDeps,
};
