/* ============================================================
   THAILAND FOOD GUIDE — map.js
   Google Maps, zoom-tier pins, clusters, legend
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

/* ── Colour constants (inline — no CSS dependency) ──────────── */
const PIN_OPEN    = '#4CAF50';
const PIN_CLOSED  = '#E53935';
const PIN_UNKNOWN = '#4A4440';
const USER_BLUE   = '#4285F4';
const GOLD        = '#C9A84C';

/* ── Google Maps dark theme ─────────────────────────────────── */
const DARK_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#212121' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#212121' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#757575' }] },
  { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: '#9e9e9e' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#bdbdbd' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#181818' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#616161' }] },
  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#2c2c2c' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8a8a8a' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#373737' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3c3c3c' }] },
  { featureType: 'road.highway.controlled_access', elementType: 'geometry', stylers: [{ color: '#4e4e4e' }] },
  { featureType: 'road.local', elementType: 'labels.text.fill', stylers: [{ color: '#616161' }] },
  { featureType: 'transit', elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#000000' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#3d3d3d' }] },
];

/* ── Custom HTML overlay (like Leaflet divIcon) ─────────────── */
let PinOverlay = null;

function definePinOverlay() {
  if (PinOverlay) return;

  PinOverlay = class extends google.maps.OverlayView {
    constructor(position, html, onClick) {
      super();
      this._position = position;
      this._html = html;
      this._onClick = onClick;
      this._div = null;
    }
    onAdd() {
      this._div = document.createElement('div');
      this._div.style.position = 'absolute';
      this._div.style.cursor = this._onClick ? 'pointer' : 'default';
      this._div.innerHTML = this._html;
      if (this._onClick) {
        this._div.addEventListener('click', (e) => {
          e.stopPropagation();
          this._onClick();
        });
      }
      const panes = this.getPanes();
      if (panes) panes.overlayMouseTarget.appendChild(this._div);
    }
    draw() {
      const projection = this.getProjection();
      if (!projection || !this._div) return;
      const pos = projection.fromLatLngToDivPixel(this._position);
      if (pos) {
        this._div.style.left = pos.x + 'px';
        this._div.style.top = pos.y + 'px';
      }
    }
    onRemove() {
      if (this._div && this._div.parentNode) {
        this._div.parentNode.removeChild(this._div);
        this._div = null;
      }
    }
    remove() { this.setMap(null); }
    getPosition() { return this._position; }
    getDiv() { return this._div; }
  };
}

/* ── Cluster overlay storage ────────────────────────────────── */
let _clusterOverlays = [];

/* ── Init ───────────────────────────────────────────────────── */

function initMap() {
  if (state.map) return;
  if (typeof google === 'undefined' || !google.maps) {
    console.error('[map] Google Maps not loaded — cannot initialise map');
    return;
  }

  definePinOverlay();

  state.map = new google.maps.Map(dom.mapContainer, {
    center: { lat: CONFIG.mapFallbackLat, lng: CONFIG.mapFallbackLng },
    zoom: CONFIG.mapFallbackZoom,
    styles: DARK_STYLES,
    disableDefaultUI: true,
    zoomControl: true,
    zoomControlOptions: {
      position: google.maps.ControlPosition.LEFT_TOP,
    },
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    gestureHandling: 'greedy',
    backgroundColor: '#0E0E0E',
    clickableIcons: false,
  });

  // Track zoom for re-render + pan for re-fetch
  let _lastZoom = state.map.getZoom();
  let _fetchDebounce = null;

  state.map.addListener('idle', () => {
    // Store viewport bounds for list sync
    const b = state.map.getBounds();
    if (b) {
      const ne = b.getNorthEast();
      const sw = b.getSouthWest();
      state.mapBounds = { north: ne.lat(), south: sw.lat(), east: ne.lng(), west: sw.lng() };
    }

    const currentZoom = state.map.getZoom();

    // Re-render pins if zoom changed
    if (_lastZoom !== currentZoom) {
      _lastZoom = currentZoom;
      if (state.filtered.length > 0) renderPins(state.filtered);
    }

    // Fetch new area if panned far enough
    clearTimeout(_fetchDebounce);
    _fetchDebounce = setTimeout(() => {
      if (!state.map) return;
      const centre = state.map.getCenter();
      if (state.lastFetchLat != null && state.lastFetchLng != null) {
        const dist = haversineDistance(state.lastFetchLat, state.lastFetchLng, centre.lat(), centre.lng());
        if (dist > CONFIG.reFetchDistM) {
          refreshFromNetwork(centre.lat(), centre.lng()).catch(() => {});
        }
      }
    }, 600);
  });

  // Open/Closed/Unknown legend
  const legendDiv = document.createElement('div');
  legendDiv.style.cssText = 'background:rgba(14,14,14,0.88);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-radius:10px;padding:8px 14px;margin:0 0 calc(60px + env(safe-area-inset-bottom, 0px)) 10px;display:flex;gap:14px;align-items:center;font-family:-apple-system,system-ui,sans-serif;font-size:12px;color:#A8957C;pointer-events:none;';
  const dotBase = 'display:inline-block;width:10px;height:10px;border-radius:50%;border:2px solid #fff;margin-right:5px;';
  legendDiv.innerHTML = '<span style="display:flex;align-items:center;"><span style="' + dotBase + 'background:' + PIN_OPEN + ';"></span>Open</span>'
    + '<span style="display:flex;align-items:center;"><span style="' + dotBase + 'background:' + PIN_CLOSED + ';"></span>Closed</span>'
    + '<span style="display:flex;align-items:center;"><span style="' + dotBase + 'background:' + PIN_UNKNOWN + ';"></span>Unknown Opening Hours</span>';
  state.map.controls[google.maps.ControlPosition.LEFT_BOTTOM].push(legendDiv);
}

/* ── Centre on user ─────────────────────────────────────────── */

function centreMapOnUser(zoom) {
  if (!state.map || !state.userLat || !state.userLng) return;

  const z = zoom || CONFIG.mapGPSZoom;
  state.map.setCenter({ lat: state.userLat, lng: state.userLng });
  state.map.setZoom(z);

  // Remove old user marker
  if (state.userLocationMarker) {
    state.userLocationMarker.remove();
    state.userLocationMarker = null;
  }

  // Inject pulse animation if not present
  if (!document.getElementById('gmap-pulse-style')) {
    const style = document.createElement('style');
    style.id = 'gmap-pulse-style';
    style.textContent = '@keyframes gmap-pulse{0%{transform:scale(0.5);opacity:1}100%{transform:scale(2.5);opacity:0}}';
    document.head.appendChild(style);
  }

  const html = '<div style="position:relative;width:28px;height:28px;transform:translate(-14px,-14px);">'
    + '<div style="position:absolute;top:50%;left:50%;width:50px;height:50px;margin:-25px 0 0 -25px;background:rgba(66,133,244,0.2);border-radius:50%;animation:gmap-pulse 2s ease-out infinite;"></div>'
    + '<div style="position:relative;z-index:1;width:28px;height:28px;background:' + USER_BLUE + ';border:3.5px solid #fff;border-radius:50%;box-shadow:0 0 0 4px rgba(66,133,244,0.3),0 2px 8px rgba(0,0,0,0.35);"></div>'
    + '</div>';

  const overlay = new PinOverlay(
    new google.maps.LatLng(state.userLat, state.userLng),
    html,
    null
  );
  overlay.setMap(state.map);
  state.userLocationMarker = overlay;
}

/* ── Fit to pins ────────────────────────────────────────────── */

function fitMapToPins() {
  if (!state.map || state.mapPins.size === 0) return;
  const bounds = new google.maps.LatLngBounds();
  state.mapPins.forEach(overlay => bounds.extend(overlay.getPosition()));
  if (state.userLat && state.userLng) {
    bounds.extend(new google.maps.LatLng(state.userLat, state.userLng));
  }
  state.map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
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
  if (zoom >= 18) return 28;
  if (zoom >= 17) return 24;
  if (zoom >= 16) return 20;
  if (zoom >= 15) return 18;
  if (zoom >= 14) return 16;
  if (zoom >= 13) return 14;
  return 12;
}

/* ── Pin rendering ──────────────────────────────────────────── */

function renderPins(restaurants) {
  if (!state.map) return;

  // Clear existing pins + clusters
  state.mapPins.forEach(overlay => overlay.remove());
  state.mapPins.clear();
  _clusterOverlays.forEach(o => o.remove());
  _clusterOverlays = [];

  const tier = getZoomTier();
  if (tier === 'far') { renderClusters(restaurants); return; }

  const zoom       = state.map.getZoom();
  const dotSize    = getDotSize(zoom);
  const showLabels = zoom >= 16;

  restaurants.forEach(r => {
    if (!r.lat || !r.lng) return;
    const openStatus = isOpenNow(r.opening_hours);
    const personal   = state.personalData.get(r.id) || {};

    const bgColor = (openStatus === 'open' || openStatus === 'closes_soon')
      ? PIN_OPEN
      : openStatus === 'closed' ? PIN_CLOSED : PIN_UNKNOWN;

    const isSelected   = r.id === state.selectedId;
    const isWishlisted = personal.is_wishlisted;

    const sz = isSelected ? dotSize + 6 : dotSize;
    const border = isWishlisted
      ? 'border:2.5px solid ' + GOLD + ';box-shadow:0 0 0 2px ' + GOLD + ',0 2px 6px rgba(0,0,0,0.5);'
      : isSelected
        ? 'border:2.5px solid #fff;box-shadow:0 0 0 3px rgba(255,255,255,0.4),0 2px 8px rgba(0,0,0,0.5);'
        : 'border:2px solid rgba(255,255,255,0.85);box-shadow:0 1px 4px rgba(0,0,0,0.5);';

    const fullName = r.name_en || r.name_th || '';

    let labelHtml = '';
    if (showLabels) {
      const rawLabel = r.name_en || r.name_th || '';
      const pinLabel = rawLabel.length > 22 ? rawLabel.slice(0, 21) + '\u2026' : rawLabel;
      const fontSize = zoom >= 17 ? '13px' : '11px';
      const labelPad = zoom >= 17 ? '3px 8px' : '2px 6px';
      labelHtml = '<span style="font-family:-apple-system,system-ui,sans-serif;font-size:' + fontSize + ';font-weight:600;color:#1a1a1a;background:rgba(255,255,255,0.93);padding:' + labelPad + ';border-radius:6px;white-space:nowrap;pointer-events:none;line-height:1.3;max-width:180px;overflow:hidden;text-overflow:ellipsis;box-shadow:0 1px 3px rgba(0,0,0,0.25);margin-left:5px;">' + escapeHTML(pinLabel) + '</span>';
    }

    const html = '<div style="display:flex;align-items:center;transform:translate(-' + (sz/2) + 'px,-' + (sz/2) + 'px);' + (isSelected ? 'z-index:100;' : '') + '" aria-label="' + escapeHTML(fullName) + '">'
      + '<div style="width:' + sz + 'px;height:' + sz + 'px;border-radius:50%;background:' + bgColor + ';' + border + 'flex-shrink:0;cursor:pointer;"></div>'
      + labelHtml
      + '</div>';

    const overlay = new PinOverlay(
      new google.maps.LatLng(r.lat, r.lng),
      html,
      () => { if (_openDetail) _openDetail(r.id); }
    );
    overlay.setMap(state.map);
    state.mapPins.set(r.id, overlay);
  });
}

/* ── Cluster rendering ──────────────────────────────────────── */

function renderClusters(restaurants) {
  if (!state.map) return;

  const cellSize = 0.5;
  const cells = new Map();
  restaurants.forEach(r => {
    if (!r.lat || !r.lng) return;
    const key = Math.floor(r.lat / cellSize) + '_' + Math.floor(r.lng / cellSize);
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

    const html = '<div style="transform:translate(-' + (size/2) + 'px,-' + (size/2) + 'px);width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + GOLD + ';display:flex;align-items:center;justify-content:center;font-family:-apple-system,system-ui,sans-serif;font-size:13px;font-weight:700;color:#0E0E0E;box-shadow:0 2px 8px rgba(0,0,0,0.5);cursor:pointer;">' + cell.count + '</div>';

    const overlay = new PinOverlay(
      new google.maps.LatLng(cLat, cLng),
      html,
      () => {
        state.map.setCenter({ lat: cLat, lng: cLng });
        state.map.setZoom(CONFIG.zoomMid);
      }
    );
    overlay.setMap(state.map);
    _clusterOverlays.push(overlay);
  });
}

/* ── Select pin ─────────────────────────────────────────────── */

function selectMapPin(id) {
  state.selectedId = id;
  if (state.filtered.length > 0) renderPins(state.filtered);
  const overlay = state.mapPins.get(id);
  if (overlay && state.map) {
    state.map.panTo(overlay.getPosition());
  }
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
