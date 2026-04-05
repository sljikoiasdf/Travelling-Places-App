'use strict';

/* ── app-main.js — detail page, event listeners, init ── */


function renderDetailPage(r) {
  state.selectedId = r.id;
  if (state.activeView === 'map') selectMapPin(r.id);

  dom.detailTitle.textContent = r.name_th || r.name_en;

  const personal   = state.personalData.get(r.id) || {};
  const openStatus = isOpenNow(r.opening_hours);

  // Primary photo
  const photos       = Array.isArray(r.photos) ? r.photos : [];
  const primaryPhoto = photos.find(p => p.is_primary) || photos[0];
  const photosHTML   = primaryPhoto
    ? `<div class="detail-photo"><img src="${escapeHTML(primaryPhoto.url)}" alt="${escapeHTML(r.name_en || r.name_th)} photo" loading="eager" decoding="async"></div>`
    : '';

  // Status
  const openClass = openStatus === 'open'         ? 'open-indicator--open'
                  : openStatus === 'closes_soon'  ? 'open-indicator--soon'
                  : openStatus === 'opens_soon'   ? 'open-indicator--soon'
                  : openStatus === 'closed'       ? 'open-indicator--closed'
                  :                                 'open-indicator--unknown';
  const openLabel = openStatus === 'open'         ? 'Open now'
                  : openStatus === 'closes_soon'  ? 'Closes soon'
                  : openStatus === 'opens_soon'   ? 'Opens soon'
                  : openStatus === 'closed'       ? 'Closed'
                  :                                 'Hours unknown';

  // Hours rows
  const dayNames  = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  const hoursRows = r.opening_hours
    ? Object.entries(dayNames).map(([key, label]) =>
        `<div class="detail-row"><span class="detail-row__label">${label}</span><span class="detail-row__value">${formatDayHours(r.opening_hours[key])}</span></div>`
      ).join('')
    : '<div class="detail-row"><span class="detail-row__value">Hours not available</span></div>';

  const cuisineDisplay = Array.isArray(r.cuisine_types)
    ? r.cuisine_types.map(c => c.replace(/_/g, ' ')).join(', ') : '';

  // Page order: Photo → Status → Location & Contact → Reviews → Details → Your stuff → Hours
  // Precision badge removed from meta row — now shown once in locationBlockHTML
  dom.detailBody.innerHTML = `
    <div class="detail-body__inner">
      ${photosHTML}

      <div class="detail-meta-row">
        <span class="open-indicator ${openClass}">${openLabel}</span>
        ${r.name_en && r.name_th ? `<p class="card__name-english">${escapeHTML(r.name_en)}</p>` : ''}
        ${r.legacy_note ? `<span class="legacy-note">${escapeHTML(r.legacy_note)}</span>` : ''}
      </div>

      ${locationBlockHTML(r)}

      ${reviewSectionHTML(r)}

      ${dishesDetailHTML(r.dishes)}

      <div class="detail-section">
        ${cuisineDisplay ? `<div class="detail-row"><span class="detail-row__label">Cuisine</span><span class="detail-row__value">${escapeHTML(cuisineDisplay)}</span></div>` : ''}
        ${r.city ? `<div class="detail-row"><span class="detail-row__label">City</span><span class="detail-row__value">${cityLabel(r.city)}${r.area ? ` — ${escapeHTML(r.area.replace(/_/g, ' '))}` : ''}</span></div>` : ''}
        ${r.price_range ? `<div class="detail-row"><span class="detail-row__label">Price</span><span class="detail-row__value">${'฿'.repeat(r.price_range)}</span></div>` : ''}
        ${r.is_halal ? `<div class="detail-row"><span class="detail-row__label">Halal</span><span class="detail-row__value">Yes ✓</span></div>` : ''}
        ${r.michelin_stars > 0 ? `<div class="detail-row"><span class="detail-row__label">Michelin</span><span class="detail-row__value">${'★'.repeat(r.michelin_stars)} Star${r.michelin_stars > 1 ? 's' : ''}</span></div>` : r.michelin_bib ? `<div class="detail-row"><span class="detail-row__label">Michelin</span><span class="detail-row__value">Bib Gourmand</span></div>` : ''}
        ${r.description_en ? `<div class="detail-row"><span class="detail-row__label">About</span><span class="detail-row__value">${escapeHTML(r.description_en)}</span></div>` : ''}
      </div>

      <div class="detail-personal">
        <button class="personal-btn${personal.is_wishlisted ? ' personal-btn--active' : ''}"
                data-action="wishlist" data-id="${r.id}"
                aria-pressed="${!!personal.is_wishlisted}"
                aria-label="${personal.is_wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}">
          ${personal.is_wishlisted ? '♥ Wishlisted' : '♡ Wishlist'}
        </button>
        <button class="personal-btn${personal.is_visited ? ' personal-btn--visited' : ''}"
                data-action="visited" data-id="${r.id}"
                aria-pressed="${!!personal.is_visited}"
                aria-label="${personal.is_visited ? 'Mark as not visited' : 'Mark as visited'}">
          ${personal.is_visited ? '✓ Visited' : '○ Mark visited'}
        </button>
        ${starRatingHTML(personal.my_rating, r.id, true)}
        ${personalNotesHTML(personal.notes, r.id)}
      </div>

      <div class="detail-section">
        <div class="detail-row detail-row--header"><span class="detail-row__label">Opening hours</span></div>
        ${hoursRows}
      </div>
    </div>`;

  dom.app.classList.add('app-shell--detail');
  dom.viewDetail.classList.add('view-detail--active');
  dom.viewDetail.removeAttribute('aria-hidden');
  dom.detailBody.scrollTop = 0;
  attachPersonalNotesListener(r.id);

  // Pass 2 (async): fetch and inject review links from restaurant_sources
  reviewLinksHTML(r.id).then(html => {
    const placeholder = document.getElementById('review-links-placeholder');
    if (!placeholder) return;
    if (html) {
      // Insert cards into the .review-cards container
      const cardsContainer = document.querySelector('.review-cards');
      if (cardsContainer) {
        cardsContainer.innerHTML = html;
      }
      placeholder.remove();
    } else {
      placeholder.remove();
      // If no review cards and no quote, remove the entire section
      const section = document.querySelector('.review-links-section');
      if (section && !section.querySelector('.source-attribution')) {
        section.remove();
      }
    }
  });
}

function hideDetailPage() {
  if (!dom.viewDetail.classList.contains('view-detail--active')) return;
  dom.viewDetail.classList.remove('view-detail--active');
  dom.viewDetail.setAttribute('aria-hidden', 'true');
  dom.app.classList.remove('app-shell--detail');
  state.selectedId = null;
}

/* ── Toast ─────────────────────────────────────────────────── */

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className   = `toast toast--${type}`;
  toast.textContent = message;
  toast.setAttribute('role', 'status');
  dom.toastContainer.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('toast--visible')));
  setTimeout(() => {
    toast.classList.remove('toast--visible');
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

/* ── Hours formatting ────────────────────────────────────── */

function formatHoursSlot(slot) {
  if (!slot || typeof slot !== 'object') return '';
  return `${slot.open || '?'}–${slot.close || '?'}`;
}

function formatDayHours(daySlots) {
  if (daySlots === null) return 'Closed';
  if (!Array.isArray(daySlots) || daySlots.length === 0) return '—';
  return daySlots.map(formatHoursSlot).join(', ');
}

/* ── Event listeners ─────────────────────────────────────── */

function attachEventListeners() {
  // Card tap → navigate to detail page
  dom.cardList.addEventListener('click', (e) => {
    // Directions button — open nav choice sheet (B2_10)
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
    // Near me — requires GPS; show toast when disabled
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

  // Nav buttons push to hash; router handles the rest
  dom.navMap.addEventListener('click',  () => { window.location.hash = '#map'; });
  dom.navList.addEventListener('click', () => { window.location.hash = '#list'; });

  // Detail back button
  dom.detailBack.addEventListener('click', () => history.back());

  // Personal actions + directions on detail page
  dom.detailBody.addEventListener('click', async (e) => {
    // Directions button — open nav choice sheet (B2_10)
    const dirBtn = e.target.closest('[data-action="directions"]');
    if (dirBtn) {
      const restId = dirBtn.dataset.restaurantId;
      const restaurant = state.restaurants.find(r => r.id === restId);
      if (restaurant) showNavChoiceSheet(restaurant);
      return;
    }

    // Star rating tap handler (MISSING-09)
    const starBtn = e.target.closest('.star-btn');
    if (starBtn) {
      if (!navigator.onLine) { showToast("Can't save while offline", 'error'); return; }
      const newRating  = parseInt(starBtn.dataset.rating, 10);
      const restId     = starBtn.dataset.restaurantId;
      const current    = state.personalData.get(restId) || {};
      const ratingToSave = current.my_rating === newRating ? null : newRating;
      // Optimistic UI
      const container = starBtn.closest('.star-rating--interactive');
      if (container) {
        container.querySelectorAll('.star-btn').forEach((b, i) => {
          const filled = ratingToSave && (i + 1) <= ratingToSave;
          b.classList.toggle('star-btn--filled', !!filled);
          b.setAttribute('aria-pressed', filled ? 'true' : 'false');
        });
      }
      await upsertPersonalData(restId, { my_rating: ratingToSave });
      return;
    }

    const btn = e.target.closest('[data-action][data-id]');
    if (!btn) return;
    handlePersonalToggle(btn.dataset.id, btn.dataset.action);
  });

  // ── Search input — 300ms debounce, min 2 chars (MISSING-07) ──
  let searchDebounceTimer;
  dom.searchInput?.addEventListener('input', (e) => {
    clearTimeout(searchDebounceTimer);
    const q = e.target.value.trim();
    state.searchQuery = q;

    // Show/hide clear button
    if (dom.searchClearBtn) {
      dom.searchClearBtn.classList.toggle('search-clear-btn--visible', q.length > 0);
      dom.searchClearBtn.hidden = q.length === 0;
    }

    searchDebounceTimer = setTimeout(applyFiltersAndSearch, 300);
  });

  // Clear button
  dom.searchClearBtn?.addEventListener('click', () => {
    state.searchQuery = '';
    if (dom.searchInput) dom.searchInput.value = '';
    if (dom.searchClearBtn) {
      dom.searchClearBtn.hidden = true;
      dom.searchClearBtn.classList.remove('search-clear-btn--visible');
    }
    applyFiltersAndSearch();
  });

  // ── View toggle (All / Wishlist / Visited) — MISSING-11 ──
  // Spec: docs/design/MISSING_FEATURES.md — MISSING-11
  // 'all' = show all; 'wishlist' = wishlisted only; 'visited' = visited only
  // Combines with other active filters using AND logic — does NOT clear existing filters
  dom.viewToggle?.addEventListener('click', (e) => {
    const btn = e.target.closest('.view-toggle__btn');
    if (!btn) return;
    const mode = btn.dataset.mode; // 'all', 'wishlist', 'visited'
    if (!mode) return;
    state.viewMode = mode;
    dom.viewToggle.querySelectorAll('.view-toggle__btn').forEach(b => {
      b.classList.toggle('view-toggle__btn--active', b.dataset.mode === mode);
    });
    applyFiltersAndSearch();
  });

  /* ── Sort sheet ──────────────────────────────────────────── */
  // Spec: docs/design/MISSING_FEATURES.md — MISSING-14
  // Sort button opens sheet; sheet shows 3 options; 'nearest' disabled if no GPS.
  // Selecting option updates state.sortOrder and calls applyFiltersAndSearch().

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
    const sort = option.dataset.sort;
    state.sortOrder = sort;
    dom.sortSheetOverlay.classList.remove('sort-sheet-overlay--visible');
    applyFiltersAndSearch();
  });

  dom.sortBtn?.addEventListener('click', showSortSheet);

  /* ── Pull-to-refresh ─────────────────────────────────────── */
  // Spec: docs/design/MISSING_FEATURES.md — MISSING-13
  // Detects downward pull when list is scrolled to top.
  // Pull threshold: 60px. Calls refreshFromNetwork() on release.
  // passive:true on touchstart/touchmove — required for iOS scroll performance.
  (function initPullToRefresh() {
    const listContainer = dom.cardList?.parentElement; // div.view__content
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
          // refreshFromNetwork handles its own error toast
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

async function handlePersonalToggle(id, action) {
  if (!id || !action) return;
  const current = state.personalData.get(id) || {};
  let updates = {};
  let toast   = '';

  if (action === 'wishlist') {
    const next = !current.is_wishlisted;
    updates    = { is_wishlisted: next };
    toast      = next ? 'Saved to wishlist' : 'Removed from wishlist';
  } else if (action === 'visited') {
    const next = !current.is_visited;
    updates    = { is_visited: next };
    toast      = next ? 'Marked as visited ✓' : 'Removed from visited';
  }

  await upsertPersonalData(id, updates);
  showToast(toast);

  // Refresh detail page if currently showing this restaurant
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
    const pin = state.mapPins.get(id);
    if (pin && state.map) {
      pin.remove();
      state.mapPins.delete(id);
      const r = state.restaurants.find(r => r.id === id);
      if (r && r.lat && r.lng) renderPins([r]);
    }
  }
}

/* ── Init ───────────────────────────────────────────────────── */

async function init() {
  state.personalId = getOrCreatePersonalId();
  attachEventListeners();
  initKeyboardHandler();
  initMap();      // Map is default — init early so tiles start loading
  initRouter();   // Set up hashchange + handle initial hash

  await Promise.allSettled([
    loadPersonalData(),
    fetchRestaurants(),
  ]);

  // Render pins now that data is ready
  if (state.map && state.activeView === 'map') {
    state.map.invalidateSize();
    renderPins(state.filtered);
  }

  // Centre map on user location if GPS was granted
  // Only centre — do NOT fitMapToPins here because cached data may include
  // restaurants from other cities (e.g. Thailand + Melbourne) causing the
  // map to zoom out to fit everything. City-level zoom is more useful.
  if (state.locationStatus === 'granted' && state.userLat && state.userLng) {
    centreMapOnUser();
  }

  // Handle any route that was pending (restaurant detail before data loaded)
  if (state.pendingRoute) {
    const pending = state.pendingRoute;
    state.pendingRoute = null;
    handleRoute(pending);
  }
}

document.addEventListener('DOMContentLoaded', init);
