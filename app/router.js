/* ============================================================
   THAILAND FOOD GUIDE — router.js
   Hash-based routing and view management
   ============================================================ */

'use strict';

import { state, dom } from './state.js';
import { initMap, renderPins } from './map.js';
import { openDetail, renderDetailPage, hideDetailPage } from './detail.js';

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
  state.activeView = view;
  const isList = view === 'list';

  dom.viewList.classList.toggle('view--active', isList);
  dom.viewList.setAttribute('aria-hidden', String(!isList));
  dom.viewMap.classList.toggle('view--active', !isList);
  dom.viewMap.setAttribute('aria-hidden', String(isList));

  dom.navList.setAttribute('aria-pressed', String(isList));
  dom.navList.classList.toggle('nav-item--active', isList);
  dom.navMap.setAttribute('aria-pressed', String(!isList));
  dom.navMap.classList.toggle('nav-item--active', !isList);

  if (!isList) {
    initMap();
    setTimeout(() => {
      if (state.map) {
        state.map.invalidateSize();
        renderPins(state.filtered);
      }
    }, 50);
  }
}

export { initRouter, handleRoute, applyView };
