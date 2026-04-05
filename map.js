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

/* ── Colour constants (inline — no CSS dependency) ──────────── */
const PIN_OPEN    = '#4CAF50';
const PIN_CLOSED  = '#E53935';
const PIN_UNKNOWN = '#4A4440';
const PIN_BORDER  = '#fff';
const USER_BLUE   = '#4285F4';
const GOLD        = '#C9A84C';

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

  // Open/Closed legend (inline styled — no CSS dependency)
  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = function () {
    const div = L.DomUtil.create('div');
    div.style.cssText = 'background:rgba(14,14,14,0.88);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);border-radius:8px;padding:8px 12px;display:flex;gap:14px;align-items:center;font-family:-apple-system,system-ui,sans-serif;font-size:12px;color:#A8957C;';
    const dotBase = 'display:inline-block;width:12px;height:12px;border-radius:50%;border:2px solid #fff;flex-shrink:0;margin-right:4px;vertical-align:middle;';
    div.innerHTML = `<span style="display:flex;align-items:center;"><span style="${dotBase}background:${PIN_OPEN};"></span>Open</span><span style="display:flex;align-items:center;"><span style="${dotBase}background:${PIN_CLOSED};"></span>Closed</span>`;
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

  const dotSize = 28;
  const pulseSize = 60;
  const blueDotIcon = L.divIcon({
    className: '',
    html: `<div style="position:relative;width:${dotSize}px;height:${dotSize}px;">
      <div style="position:absolute;top:50%;left:50%;width:${pulseSize}px;height:${pulseSize}px;margin-top:-${pulseSize/2}px;margin-left:-${pulseSize/2}px;background:rgba(66,133,244,0.2);border-radius:50%;animation:loc-pulse 2s ease-out infinite;"></div>
      <div style="width:${dotSize}px;height:${dotSize}px;background:${USER_BLUE};border:3.5px solid #fff;border-radius:50%;box-shadow:0 0 0 4px rgba(66,133,244,0.3),0 2px 8px rgba(0,0,0,0.35);position:relative;z-index:1;"></div>
    </div>
    <style>@keyframes loc-pulse{0%{transform:scale(0.5);opacity:1}100%{transform:scale(2.5);opacity:0}}</style>`,
    iconSize:   [dotSize, dotSize],
    iconAnchor: [dotSize / 2, dotSize / 2],
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

/* ── Dot size based on zoom ─────────────────────────────────── */

function getDotSize(zoom) {
  if (zoom >= 18) return 32;
  if (zoom >= 17) return 28;
  if (zoom >= 16) return 26;
  if (zoom >= 15) return 24;
  if (zoom >= 14) return 22;
  if (zoom >= 13) return 18;
  if (zoom >= 12) return 16;
  if (zoom >= 11) return 14;
  return 12;
}

/* ── Pin rendering ──────────────────────────────────────────── */

function renderPins(restaurants) {
  if (!state.map) return;

  state.mapPins.forEach(marker => marker.remove());
  state.mapPins.clear();
  if (state.clusterLayer) { state.clusterLayer.clearLayers(); state.clusterLayer.remove(); state.clusterLayer = null; }

  const tier = getZoomTier();
  if (tier === 'far') { renderClusters(restaurants); return; }

  const zoom = state.map.getZoom();
  const dotSize = getDotSize(zoom);
  const showLabels = zoom >= 12;

  restaurants.forEach(r => {
    if (!r.lat || !r.lng) return;
    const openStatus = isOpenNow(r.opening_hours);
    const personal   = state.personalData.get(r.id) || {};

    // Pin colour
    const bgColor = (openStatus === 'open' || openStatus === 'closes_soon')
      ? PIN_OPEN
      : openStatus === 'closed' ? PIN_CLOSED : PIN_UNKNOWN;

    // State styling
    const isSelected = r.id === state.selectedId;
    const selStyle = isSelected ? 'transform:scale(1.4);z-index:100;' : '';
    const wishShadow = personal.is_wishlisted
      ? `box-shadow:0 0 0 3px ${GOLD},0 1px 4px rgba(0,0,0,0.4);`
      : `box-shadow:0 1px 4px rgba(0,0,0,0.4),0 0 0 1px rgba(255,255,255,0.3);`;

    // Dot inline style (zero CSS dependency)
    const dotStyle = `display:inline-block;width:${dotSize}px;height:${dotSize}px;border-radius:50%;border:2.5px solid ${PIN_BORDER};background:${bgColor};${wishShadow}cursor:pointer;flex-shrink:0;${selStyle}`;

    const fullName = r.name_en || r.name_th || '';

    let html;
    if (showLabels) {
      const rawLabel = r.name_en || r.name_th || '';
      const pinLabel = rawLabel.length > 22 ? rawLabel.slice(0, 21) + '\u2026' : rawLabel;
      const fontSize = zoom >= 14 ? '13px' : '11px';
      const labelPad = zoom >= 14 ? '3px 8px' : '2px 6px';
      const labelStyle = `font-family:-apple-system,system-ui,sans-serif;font-size:${fontSize};font-weight:600;color:#1a1a1a;background:rgba(255,255,255,0.93);padding:${labelPad};border-radius:6px;white-space:nowrap;pointer-events:none;line-height:1.3;max-width:180px;overflow:hidden;text-overflow:ellipsis;box-shadow:0 1px 3px rgba(0,0,0,0.2);margin-left:5px;`;

      html = `<div style="display:flex;align-items:center;"><div style="${dotStyle}" aria-label="${escapeHTML(fullName)}"></div><span style="${labelStyle}">${escapeHTML(pinLabel)}</span></div>`;
    } else {
      html = `<div style="${dotStyle}" aria-label="${escapeHTML(fullName)}"></div>`;
    }

    const iconW = showLabels ? 260 : dotSize + 6;
    const iconH = Math.max(dotSize + 6, 26);

    const icon = L.divIcon({
      className: '',
      html,
      iconSize:   [iconW, iconH],
      iconAnchor: [dotSize / 2 + 3, iconH / 2],
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

    const clusterStyle = `display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;background:${GOLD};border-radius:50%;color:#0E0E0E;font-family:-apple-system,system-ui,sans-serif;font-size:13px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,0.5);cursor:pointer;`;

    const icon = L.divIcon({
      className: '',
      html: `<div style="${clusterStyle}">${cell.count}</div>`,
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
  // Re-render to apply selected state via inline styles
  if (state.filtered.length > 0) {
    state.selectedId = id;
    renderPins(state.filtered);
  }
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
