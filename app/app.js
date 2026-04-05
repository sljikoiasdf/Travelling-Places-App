/* ============================================================
   THAILAND FOOD GUIDE — app.js
   Entry point — imports all modules, wires deps, kicks off init
   ============================================================ */

'use strict';

import { CONFIG } from './config.js';
import { state, dom, initDom } from './state.js';
import { initMap, centreMapOnUser, renderPins, bindMapDeps } from './map.js';
import { fetchRestaurants, loadPersonalData, getOrCreatePersonalId, refreshFromNetwork, bindDataDeps } from './data.js';
import { applyFiltersAndSearch, buildFilterChips, bindFilterDeps } from './filters.js';
import { attachEventListeners, initKeyboardHandler } from './events.js';
import { initRouter, handleRoute } from './router.js';
import { bindLocationDeps } from './location.js';
import { openDetail } from './detail.js';

/* ── Wire up circular dependencies ──────────────────────────── */

bindDataDeps({ applyFiltersAndSearch, renderPins });
bindFilterDeps({ renderPins });
bindLocationDeps({
  applyFiltersAndSearch,
  buildFilterChips,
  centreMapOnUser,
  renderPins,
  refreshFromNetwork,
});
bindMapDeps({ openDetail });

/* ── Init ───────────────────────────────────────────────────── */

async function init() {
  initDom();

  state.personalId = getOrCreatePersonalId();
  attachEventListeners();
  initKeyboardHandler();
  initMap();
  initRouter();

  await Promise.allSettled([
    loadPersonalData(),
    fetchRestaurants(),
  ]);

  if (state.map && state.activeView === 'map') {
    state.map.invalidateSize();
    renderPins(state.filtered);
  }

  if (state.locationStatus === 'granted' && state.userLat && state.userLng) {
    centreMapOnUser(CONFIG.mapGPSZoom);
  }

  if (state.pendingRoute) {
    const pending = state.pendingRoute;
    state.pendingRoute = null;
    handleRoute(pending);
  }
}

document.addEventListener('DOMContentLoaded', init);
