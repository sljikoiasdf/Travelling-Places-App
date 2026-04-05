/* ============================================================
   THAILAND FOOD GUIDE — map.js
   Apple MapKit JS map, zoom-tier pins, clusters, legend
   ============================================================ */

'use strict';

import { CONFIG, MAPKIT_TOKEN } from './config.js';
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
const PIN_BORDER  = '#fff';
const USER_BLUE   = '#4285F4';
const GOLD        = '#C9A84C';

/* ── Init ───────────────────────────────────────────────────── */

function initMap() {
  if (state.map) return;
  if (typeof mapkit === 'undefined') {
    console.error('[map] MapKit JS not loaded — cannot initialise map');
    return;
  }

  mapkit.init({
    authorizationCallback: function(done) {
      done(MAPKIT_TOKEN);
    }
  });

  // Inject pulse animation for user location dot
  if (!document.getElementById('mapkit-pulse-style')) {
    const style = document.createElement('style');
    style.id = 'mapkit-pulse-style';
    style.textContent = '@keyframes loc-pulse{0%{transform:scale(0.5);opacity:1}100%{transform:scale(2.5);opacity:0}}';
    document.head.appendChild(style);
  }

  state.map = new mapkit.Map(dom.mapContainer, {
    center: new mapkit.Coordinate(CONFIG.mapFallbackLat, CONFIG.mapFallbackLng),
    colorScheme: mapkit.Map.ColorSchemes.Dark,
    showsCompass: mapkit.FeatureVisibility.Hidden,
    showsZoomControl: true,
    showsMapTypeControl: false,
    isScrollEnabled: true,
    isZoomEnabled: true,
  });

  // Set initial region (world view)
  state.map.region = new mapkit.CoordinateRegion(
    new mapkit.Coordinate(CONFIG.mapFallbackLat, CONFIG.mapFallbackLng),
    new mapkit.CoordinateSpan(160, 360)
  );

  // Re-render pins on region change + fetch new area if needed
  let _regionDebounce = null;
  state.map.addEventListener('region-change-end', () => {
    clearTimeout(_regionDebounce);
    _regionDebounce = setTimeout(() => {
      if (state.filtered.length > 0) renderPins(state.filtered);

      if (state.lastFetchLat != null && state.lastFetchLng != null) {
        const centre = state.map.center;
        const dist = haversineDistance(state.lastFetchLat, state.lastFetchLng, centre.latitude, centre.longitude);
        if (dist > CONFIG.reFetchDistM) {
          refreshFromNetwork(centre.latitude, centre.longitude).catch(() => {});
        }
      }
    }, 300);
  });

  // Add legend (absolutely positioned over map)
  const legendDiv = document.createElement('div');
  legendDiv.style.cssText = 'position:absolute;bottom:16px;left:16px;z-index:10;background:rgba(14,14,14,0.88);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);border-radius:8px;padding:8px 12px;display:flex;gap:14px;align-items:center;font-family:-apple-system,system-ui,sans-serif;font-size:12px;color:#A8957C;pointer-events:none;';
  const dotBase = 'display:inline-block;width:12px;height:12px;border-radius:50%;border:2px solid #fff;flex-shrink:0;margin-right:4px;vertical-align:middle;';
  legendDiv.innerHTML = '<span style="display:flex;align-items:center;"><span style="' + dotBase + 'background:' + PIN_OPEN + ';"></span>Open</span><span style="display:flex;align-items:center;"><span style="' + dotBase + 'background:' + PIN_CLOSED + ';"></span>Closed</span>';
  dom.mapContainer.style.position = 'relative';
  dom.mapContainer.appendChild(legendDiv);
}

/* ── Centre on user ─────────────────────────────────────────── */

function centreMapOnUser(zoom) {
  if (!state.map || !state.userLat || !state.userLng) return;

  const coord = new mapkit.Coordinate(state.userLat, state.userLng);
  const span  = new mapkit.CoordinateSpan(0.01, 0.01);
  state.map.setRegionAnimated(new mapkit.CoordinateRegion(coord, span));

  // Remove old user marker
  if (state.userLocationMarker) {
    state.map.removeAnnotation(state.userLocationMarker);
    state.userLocationMarker = null;
  }

  const dotSize   = 28;
  const pulseSize = 60;

  state.userLocationMarker = new mapkit.Annotation(coord, function() {
    const el = document.createElement('div');
    el.style.cssText = 'position:relative;width:' + dotSize + 'px;height:' + dotSize + 'px;';
    el.innerHTML = '<div style="position:absolute;top:50%;left:50%;width:' + pulseSize + 'px;height:' + pulseSize + 'px;margin-top:-' + (pulseSize/2) + 'px;margin-left:-' + (pulseSize/2) + 'px;background:rgba(66,133,244,0.2);border-radius:50%;animation:loc-pulse 2s ease-out infinite;"></div>'
      + '<div style="width:' + dotSize + 'px;height:' + dotSize + 'px;background:' + USER_BLUE + ';border:3.5px solid #fff;border-radius:50%;box-shadow:0 0 0 4px rgba(66,133,244,0.3),0 2px 8px rgba(0,0,0,0.35);position:relative;z-index:1;"></div>';
    return el;
  }, {
    anchorOffset: new DOMPoint(0, 0),
    enabled: false,
    displayPriority: 1000,
  });

  state.map.addAnnotation(state.userLocationMarker);
}

/* ── Fit to pins ────────────────────────────────────────────── */

function fitMapToPins() {
  if (!state.map || state.mapPins.size === 0) return;
  const items = Array.from(state.mapPins.values());
  if (state.userLocationMarker) items.push(state.userLocationMarker);
  state.map.showItems(items, {
    padding: new mapkit.Padding(40, 40, 40, 40),
    animate: true,
  });
}

/* ── Zoom tier ──────────────────────────────────────────────── */

function getZoomTier() {
  if (!state.map) return 'far';
  const latDelta = state.map.region.span.latitudeDelta;
  if (latDelta <= CONFIG.zoomClose) return 'close';
  if (latDelta <= CONFIG.zoomMid)   return 'mid';
  return 'far';
}

/* ── Dot size based on span ─────────────────────────────────── */

function getDotSize(latDelta) {
  if (latDelta <= 0.005) return 32;
  if (latDelta <= 0.008) return 28;
  if (latDelta <= 0.012) return 26;
  if (latDelta <= 0.02)  return 24;
  if (latDelta <= 0.04)  return 22;
  if (latDelta <= 0.08)  return 18;
  if (latDelta <= 0.15)  return 16;
  if (latDelta <= 0.3)   return 14;
  return 12;
}

/* ── Pin rendering ──────────────────────────────────────────── */

function renderPins(restaurants) {
  if (!state.map) return;

  // Remove old annotations (keep user location marker)
  const toRemove = Array.from(state.mapPins.values());
  if (state._clusterAnnotations) {
    toRemove.push(...state._clusterAnnotations);
    state._clusterAnnotations = null;
  }
  if (toRemove.length > 0) state.map.removeAnnotations(toRemove);
  state.mapPins.clear();

  const tier = getZoomTier();
  if (tier === 'far') { renderClusters(restaurants); return; }

  const latDelta   = state.map.region.span.latitudeDelta;
  const dotSize    = getDotSize(latDelta);
  const showLabels = latDelta <= 0.15;

  const annotations = [];
  restaurants.forEach(r => {
    if (!r.lat || !r.lng) return;
    const openStatus = isOpenNow(r.opening_hours);
    const personal   = state.personalData.get(r.id) || {};

    const bgColor = (openStatus === 'open' || openStatus === 'closes_soon')
      ? PIN_OPEN
      : openStatus === 'closed' ? PIN_CLOSED : PIN_UNKNOWN;

    const isSelected = r.id === state.selectedId;
    const coord = new mapkit.Coordinate(r.lat, r.lng);

    // Capture values for closure
    const _dotSize = dotSize;
    const _showLabels = showLabels;
    const _bgColor = bgColor;
    const _isSelected = isSelected;
    const _personal = personal;
    const _latDelta = latDelta;
    const _r = r;

    const annotation = new mapkit.Annotation(coord, function() {
      const el = document.createElement('div');
      const selStyle = _isSelected ? 'transform:scale(1.4);z-index:100;' : '';
      const wishShadow = _personal.is_wishlisted
        ? 'box-shadow:0 0 0 3px ' + GOLD + ',0 1px 4px rgba(0,0,0,0.4);'
        : 'box-shadow:0 1px 4px rgba(0,0,0,0.4),0 0 0 1px rgba(255,255,255,0.3);';
      const dotStyle = 'display:inline-block;width:' + _dotSize + 'px;height:' + _dotSize + 'px;border-radius:50%;border:2.5px solid ' + PIN_BORDER + ';background:' + _bgColor + ';' + wishShadow + 'cursor:pointer;flex-shrink:0;' + selStyle;
      const fullName = _r.name_en || _r.name_th || '';

      if (_showLabels) {
        const rawLabel = _r.name_en || _r.name_th || '';
        const pinLabel = rawLabel.length > 22 ? rawLabel.slice(0, 21) + '\u2026' : rawLabel;
        const fontSize = _latDelta <= 0.04 ? '13px' : '11px';
        const labelPad = _latDelta <= 0.04 ? '3px 8px' : '2px 6px';
        const labelStyle = 'font-family:-apple-system,system-ui,sans-serif;font-size:' + fontSize + ';font-weight:600;color:#1a1a1a;background:rgba(255,255,255,0.93);padding:' + labelPad + ';border-radius:6px;white-space:nowrap;pointer-events:none;line-height:1.3;max-width:180px;overflow:hidden;text-overflow:ellipsis;box-shadow:0 1px 3px rgba(0,0,0,0.2);margin-left:5px;';

        el.style.cssText = 'display:flex;align-items:center;';
        el.innerHTML = '<div style="' + dotStyle + '" aria-label="' + escapeHTML(fullName) + '"></div><span style="' + labelStyle + '">' + escapeHTML(pinLabel) + '</span>';
      } else {
        el.style.cssText = dotStyle;
        el.setAttribute('aria-label', escapeHTML(fullName));
      }
      return el;
    }, {
      anchorOffset: new DOMPoint(0, 0),
      displayPriority: _isSelected ? 1000 : 500,
    });

    annotation._restaurantId = r.id;
    annotation.addEventListener('select', () => {
      if (_openDetail) _openDetail(r.id);
    });

    annotations.push(annotation);
    state.mapPins.set(r.id, annotation);
  });

  if (annotations.length > 0) state.map.addAnnotations(annotations);
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

  const clusterAnnotations = [];
  cells.forEach(cell => {
    const cLat  = cell.lat / cell.count;
    const cLng  = cell.lng / cell.count;
    const size  = cell.count > 20 ? 48 : cell.count > 5 ? 40 : 32;
    const coord = new mapkit.Coordinate(cLat, cLng);
    const count = cell.count;

    const annotation = new mapkit.Annotation(coord, function() {
      const el = document.createElement('div');
      el.style.cssText = 'display:flex;align-items:center;justify-content:center;width:' + size + 'px;height:' + size + 'px;background:' + GOLD + ';border-radius:50%;color:#0E0E0E;font-family:-apple-system,system-ui,sans-serif;font-size:13px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,0.5);cursor:pointer;';
      el.textContent = count;
      return el;
    }, {
      anchorOffset: new DOMPoint(0, 0),
    });

    annotation.addEventListener('select', () => {
      const span = new mapkit.CoordinateSpan(CONFIG.zoomMid, CONFIG.zoomMid);
      state.map.setRegionAnimated(new mapkit.CoordinateRegion(coord, span));
    });

    clusterAnnotations.push(annotation);
  });

  state._clusterAnnotations = clusterAnnotations;
  if (clusterAnnotations.length > 0) state.map.addAnnotations(clusterAnnotations);
}

/* ── Select pin ─────────────────────────────────────────────── */

function selectMapPin(id) {
  state.selectedId = id;
  if (state.filtered.length > 0) renderPins(state.filtered);
  const annotation = state.mapPins.get(id);
  if (annotation && state.map) {
    state.map.setCenterAnimated(annotation.coordinate);
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
