/* ============================================================
   THAILAND FOOD GUIDE — router.js
   Hash-based routing and view management
   ============================================================ */

'use strict';

import { state, dom } from './state.js';
import { initMap, renderPins } from './map.js';
import { openDetail, renderDetailPage, hideDetailPage } from './detail.js';
import { applyFiltersAndSearch } from './filters.js';

/* ── Router ─────────────────────────────────────────────────── */

function initRouter() {
  window.addEventListener('hashchange', () => handleRoute(window.location.hash));
  handleRoute(window.location.hash);
}

function handleRoute(hash) {
  if (!hash) hash = '';

  if (hash.startsWith('#restaurant/')) {
    const slug = decodeURIComponent(hash.slice(12));
    if (state.restaurants.length === 0) {
      state.pendingRoute = hash;
      return;
    }
    const r = state.restaurants.find(r => r.slug === slug) ||
              state.restaurants.find(r => String(r.id) === slug);
    if (r) {
      renderDetailPage(r);
    } else {
      window.location.replace('#map');
    }
  } else if (hash === '#search') {
    hideDetailPage();
    applyView('search');
  } else if (hash === '#list') {
    hideDetailPage();
    applyView('list');
  } else {
    hideDetailPage();
    applyView('map');
  }
}

/* ── View management ────────────────────────────────────────── */

function applyView(view) {
  const showList = view === 'list' || view === 'search';
  state.activeView = showList ? 'list' : 'map';

  dom.viewList.classList.toggle('view--active', showList);
  dom.viewList.setAttribute('aria-hidden', String(!showList));
  dom.viewMap.classList.toggle('view--active', !showList);
  dom.viewMap.setAttribute('aria-hidden', String(showList));

  // Nav highlighting — 3 tabs
  dom.navMap.classList.toggle('nav-item--active', view === 'map');
  dom.navMap.setAttribute('aria-pressed', String(view === 'map'));
  dom.navList.classList.toggle('nav-item--active', view === 'list');
  dom.navList.setAttribute('aria-pressed', String(view === 'list'));
  if (dom.navSearch) {
    dom.navSearch.classList.toggle('nav-item--active', view === 'search');
    dom.navSearch.setAttribute('aria-pressed', String(view === 'search'));
  }

  if (showList) {
    // Re-filter list with current map viewport bounds
    applyFiltersAndSearch();
  } else {
    initMap();
    setTimeout(() => {
      if (state.map) {
        google.maps.event.trigger(state.map, 'resize');
        renderPins(state.filtered);
      }
    }, 50);
  }

  // Focus search input when search tab selected
  if (view === 'search' && dom.searchInput) {
    setTimeout(() => dom.searchInput.focus(), 100);
  }
}

export { initRouter, handleRoute, applyView };
