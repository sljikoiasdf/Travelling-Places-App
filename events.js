/* ============================================================
   THAILAND FOOD GUIDE — events.js
   All event listeners, personal toggles, keyboard handler
   ============================================================ */

'use strict';

import { state, dom } from './state.js';
import { showToast } from './utils.js';
import { upsertPersonalData, refreshFromNetwork } from './data.js';
import { renderPins } from './map.js';
import { openDetail, showNavChoiceSheet, renderDetailPage } from './detail.js';
import { applyFiltersAndSearch } from './filters.js';
import { cardHTML } from './cards.js';

/* ── Personal toggle (wishlist only — visited/stars/notes killed) ── */

async function handlePersonalToggle(id, action) {
  if (!id || !action) return;
  if (action !== 'wishlist') return; // only wishlist survives
  const current = state.personalData.get(id) || {};
  const next = !current.is_wishlisted;
  const updates = { is_wishlisted: next };
  const toast = next ? 'Saved to wishlist' : 'Removed from wishlist';

  await upsertPersonalData(id, updates);
  showToast(toast);

  // Refresh detail page if showing this restaurant
  if (state.selectedId === id && dom.viewDetail.classList.contains('view-detail--active')) {
    const r = state.restaurants.find(r => r.id === id);
    if (r) renderDetailPage(r);
  }

  // Re-render card in list
  const cardEl = dom.cardList.querySelector(`[data-id="${id}"]`);
  if (cardEl) {
    const r = state.restaurants.find(r => r.id === id);
    if (r) cardEl.outerHTML = cardHTML(r);
  }

  // Refresh map pin
  if (state.activeView === 'map') {
    renderPins(state.filtered);
  }
}

/* ── Keyboard handler ───────────────────────────────────────── */

function initKeyboardHandler() {
  if (!window.visualViewport) return;

  let keyboardOpen = false;

  window.visualViewport.addEventListener('resize', () => {
    const viewportHeight = window.visualViewport.height;
    const windowHeight   = window.innerHeight;
    const keyboardHeight = windowHeight - viewportHeight;

    if (keyboardHeight > 150) {
      if (!keyboardOpen) {
        keyboardOpen = true;
        document.documentElement.style.setProperty('--keyboard-height', `${keyboardHeight}px`);
        document.body.classList.add('keyboard-open');
      }
    } else {
      if (keyboardOpen) {
        keyboardOpen = false;
        document.documentElement.style.setProperty('--keyboard-height', '0px');
        document.body.classList.remove('keyboard-open');
      }
    }
  });

  window.visualViewport.addEventListener('scroll', () => {
    if (window.visualViewport.offsetTop > 0) {
      window.scrollTo(0, window.visualViewport.offsetTop);
    }
  });
}

/* ── Attach all event listeners ─────────────────────────────── */

function attachEventListeners() {
  // Card tap → detail, wishlist toggle
  dom.cardList.addEventListener('click', (e) => {
    const dirBtn = e.target.closest('[data-action="directions"]');
    if (dirBtn) {
      e.stopPropagation();
      const restId = dirBtn.dataset.restaurantId;
      const restaurant = state.restaurants.find(r => r.id === restId);
      if (restaurant) showNavChoiceSheet(restaurant);
      return;
    }
    const wbtn = e.target.closest('[data-action="wishlist"]');
    if (wbtn && wbtn.closest('.card-list')) {
      e.stopPropagation();
      handlePersonalToggle(wbtn.dataset.id, 'wishlist');
      return;
    }
    const card = e.target.closest('[data-id]');
    if (card) openDetail(card.dataset.id);
  });

  // Filter chips
  dom.filterChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    const dim = chip.dataset.filterDim;
    const val = chip.dataset.filterVal;
    if (dim === 'near_me') {
      if (state.locationStatus !== 'granted') {
        showToast('Enable location access to use Near me', 'info');
        return;
      }
      state.activeFilters.near_me = state.activeFilters.near_me ? undefined : true;
      applyFiltersAndSearch();
      return;
    }
    if (dim === 'open_now' || dim === 'halal' || dim === 'michelin') {
      state.activeFilters[dim] = state.activeFilters[dim] ? undefined : true;
    } else {
      state.activeFilters[dim] = state.activeFilters[dim] === val
        ? undefined
        : (dim === 'price_range' ? Number(val) : val);
    }
    applyFiltersAndSearch();
  });

  // Nav buttons
  dom.navMap.addEventListener('click',  () => { window.location.hash = '#map'; });
  dom.navList.addEventListener('click', () => { window.location.hash = '#list'; });

  // Detail back button
  dom.detailBack.addEventListener('click', () => history.back());

  // Detail page actions (wishlist + directions)
  dom.detailBody.addEventListener('click', async (e) => {
    const dirBtn = e.target.closest('[data-action="directions"]');
    if (dirBtn) {
      const restId = dirBtn.dataset.restaurantId;
      const restaurant = state.restaurants.find(r => r.id === restId);
      if (restaurant) showNavChoiceSheet(restaurant);
      return;
    }

    const btn = e.target.closest('[data-action="wishlist"][data-id]');
    if (btn) {
      handlePersonalToggle(btn.dataset.id, 'wishlist');
      return;
    }
  });

  // Search input
  let searchDebounceTimer;
  dom.searchInput?.addEventListener('input', (e) => {
    clearTimeout(searchDebounceTimer);
    const q = e.target.value.trim();
    state.searchQuery = q;
    if (dom.searchClearBtn) {
      dom.searchClearBtn.classList.toggle('search-clear-btn--visible', q.length > 0);
      dom.searchClearBtn.hidden = q.length === 0;
    }
    searchDebounceTimer = setTimeout(applyFiltersAndSearch, 300);
  });

  dom.searchClearBtn?.addEventListener('click', () => {
    state.searchQuery = '';
    if (dom.searchInput) dom.searchInput.value = '';
    if (dom.searchClearBtn) {
      dom.searchClearBtn.hidden = true;
      dom.searchClearBtn.classList.remove('search-clear-btn--visible');
    }
    applyFiltersAndSearch();
  });

  // View toggle (All / Wishlist / Visited)
  dom.viewToggle?.addEventListener('click', (e) => {
    const btn = e.target.closest('.view-toggle__btn');
    if (!btn) return;
    const mode = btn.dataset.mode;
    if (!mode) return;
    state.viewMode = mode;
    dom.viewToggle.querySelectorAll('.view-toggle__btn').forEach(b => {
      b.classList.toggle('view-toggle__btn--active', b.dataset.mode === mode);
    });
    applyFiltersAndSearch();
  });

  // Sort sheet
  function showSortSheet() {
    const options = [
      { key: 'nearest', label: 'Nearest first', disabled: state.locationStatus !== 'granted' },
      { key: 'rating',  label: 'Highest rated' },
      { key: 'newest',  label: 'Newly added' }
    ];

    dom.sortSheet.innerHTML = options.map(o => `
      <div class="sort-option ${state.sortOrder === o.key ? 'sort-option--active' : ''} ${o.disabled ? 'sort-option--disabled' : ''}"
        data-sort="${o.key}" ${o.disabled ? 'aria-disabled="true"' : ''}>
        ${o.label}
        ${state.sortOrder === o.key ? '<span class="sort-option__check">✓</span>' : ''}
      </div>
    `).join('');

    dom.sortSheetOverlay.classList.add('sort-sheet-overlay--visible');

    dom.sortSheetOverlay.addEventListener('click', (e) => {
      if (e.target === dom.sortSheetOverlay) {
        dom.sortSheetOverlay.classList.remove('sort-sheet-overlay--visible');
      }
    }, { once: true });
  }

  dom.sortSheet?.addEventListener('click', (e) => {
    const option = e.target.closest('.sort-option');
    if (!option || option.getAttribute('aria-disabled') === 'true') return;
    state.sortOrder = option.dataset.sort;
    dom.sortSheetOverlay.classList.remove('sort-sheet-overlay--visible');
    applyFiltersAndSearch();
  });

  dom.sortBtn?.addEventListener('click', showSortSheet);

  // Pull-to-refresh
  (function initPullToRefresh() {
    const listContainer = dom.cardList?.parentElement;
    if (!listContainer) return;

    let startY = 0;
    let pulling = false;
    let refreshing = false;
    const THRESHOLD = 60;

    listContainer.addEventListener('touchstart', (e) => {
      if (listContainer.scrollTop === 0) {
        startY = e.touches[0].clientY;
        pulling = true;
      }
    }, { passive: true });

    listContainer.addEventListener('touchmove', (e) => {
      if (!pulling || refreshing) return;
      const currentY = e.touches[0].clientY;
      const delta = currentY - startY;
      if (delta > 10 && listContainer.scrollTop === 0) {
        const progress = Math.min(delta, THRESHOLD);
        if (dom.pullIndicator) {
          dom.pullIndicator.classList.toggle('pull-indicator--active', progress >= THRESHOLD * 0.5);
        }
      }
    }, { passive: true });

    listContainer.addEventListener('touchend', async () => {
      if (!pulling) return;
      pulling = false;

      if (!refreshing && dom.pullIndicator?.classList.contains('pull-indicator--active')) {
        refreshing = true;
        try {
          await refreshFromNetwork();
          showToast('Refreshed', 'success');
        } catch (_) {
        } finally {
          refreshing = false;
          dom.pullIndicator?.classList.remove('pull-indicator--active');
        }
      } else {
        dom.pullIndicator?.classList.remove('pull-indicator--active');
      }
    });
  })();
}

export { attachEventListeners, initKeyboardHandler, handlePersonalToggle };
