'use strict';

/* ── app-list.js — map, filter chips, search, sort, router, openDetail ── */

const MAP_TILE_URL  = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const MAP_TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function initMap() {
  if (state.map) return;
  if (typeof L === 'undefined') {
    console.error('[map] Leaflet not loaded — cannot initialise map');
    return;
  }
  state.map = L.map(dom.mapContainer, {
    center: [CONFIG.mapDefaultLat, CONFIG.mapDefaultLng],
    zoom:   CONFIG.mapDefaultZoom,
    zoomControl: true,
    attributionControl: true,
  });
  L.tileLayer(MAP_TILE_URL, { attribution: MAP_TILE_ATTR, maxZoom: 19 }).addTo(state.map);
  setTimeout(() => state.map.invalidateSize(), 50);
}

function renderPins(restaurants) {
  if (!state.map) return;
  state.mapPins.forEach(marker => marker.remove());
  state.mapPins.clear();

  restaurants.forEach(r => {
    if (!r.lat || !r.lng) return;
    const openStatus = isOpenNow(r.opening_hours);
    const personal   = state.personalData.get(r.id) || {};
    const classes    = ['map-pin'];
    if (openStatus === 'open')        classes.push('map-pin--open');
    else if (openStatus === 'closed') classes.push('map-pin--closed');
    if (personal.is_visited)          classes.push('map-pin--visited');
    if (personal.is_wishlisted)       classes.push('map-pin--wishlisted');
    if (r.id === state.selectedId)    classes.push('map-pin--selected');

    // Use tagline as pin label (tells you what the place IS), fall back to English name
    const fullName  = r.name_en || r.name_th || '';
    const rawLabel  = r.tagline || fullName;
    const pinLabel  = rawLabel.length > 22 ? rawLabel.slice(0, 21) + '…' : rawLabel;

    // Status indicator: dot + label for open/closed, nothing for unknown
    const statusHTML = openStatus === 'open'
      ? `<span class="map-pin__dot"></span><span class="map-pin__status">Open</span>`
      : openStatus === 'closed'
        ? `<span class="map-pin__dot"></span><span class="map-pin__status">Closed</span>`
        : '';

    const icon = L.divIcon({
      className: '',
      html: `<div class="${classes.join(' ')}" aria-label="${escapeHTML(fullName)}">${statusHTML}<span class="map-pin__name">${escapeHTML(pinLabel)}</span><div class="map-pin__tail"></div></div>`,
      iconSize:   [0, 0],
      iconAnchor: [0, 0],
    });

    const marker = L.marker([r.lat, r.lng], { icon }).addTo(state.map);
    marker.on('click', () => openDetail(r.id));
    state.mapPins.set(r.id, marker);
  });
}

function selectMapPin(id) {
  state.mapPins.forEach((marker, markerId) => {
    const el = marker.getElement()?.querySelector('.map-pin');
    if (!el) return;
    el.classList.toggle('map-pin--selected', markerId === id);
  });
  const marker = state.mapPins.get(id);
  if (marker && state.map) state.map.panTo(marker.getLatLng(), { animate: true });
}

/* ============================================================
   FILTERS
   ============================================================ */

function buildFilterChips() {
  const container = dom.filterChips;
  if (!container) return;
  const chips = [];

  // Near me chip (MISSING-16) — disabled when GPS not granted
  // Spec: docs/design/MISSING_FEATURES.md — MISSING-16
  const gpsGranted = state.locationStatus === 'granted';
  const nearMeActive = state.activeFilters.near_me === true;
  chips.push(`<button class="filter-chip${nearMeActive ? ' filter-chip--active' : ''}${!gpsGranted ? ' filter-chip--disabled' : ''}" data-filter-dim="near_me" data-filter-val="true" aria-pressed="${nearMeActive}" ${!gpsGranted ? 'aria-disabled="true"' : ''} aria-label="Near me — 2km radius">📍 Near me</button>`);

  const openNowActive = state.activeFilters.open_now === true;
  chips.push(`<button class="filter-chip${openNowActive ? ' filter-chip--active' : ''}" data-filter-dim="open_now" data-filter-val="true" aria-pressed="${openNowActive}" aria-label="Show open now">Open now</button>`);

  const cities = [...new Set(state.restaurants.map(r => r.city).filter(Boolean))].sort();
  cities.forEach(city => {
    const isActive = state.activeFilters.city === city;
    chips.push(`<button class="filter-chip${isActive ? ' filter-chip--active' : ''}" data-filter-dim="city" data-filter-val="${escapeHTML(city)}" aria-pressed="${isActive}" aria-label="Filter by ${cityLabel(city)}">${cityLabel(city)}</button>`);
  });

  const cuisines = [...new Set(state.restaurants.flatMap(r => Array.isArray(r.cuisine_types) ? r.cuisine_types : []))].sort();
  cuisines.forEach(cuisine => {
    if (!cuisine) return;
    const isActive = state.activeFilters.cuisine === cuisine;
    const label    = cuisine.replace(/_/g, ' ');
    chips.push(`<button class="filter-chip${isActive ? ' filter-chip--active' : ''}" data-filter-dim="cuisine" data-filter-val="${escapeHTML(cuisine)}" aria-pressed="${isActive}" aria-label="Filter by ${escapeHTML(label)}">${escapeHTML(label)}</button>`);
  });

  const prices = [...new Set(state.restaurants.map(r => r.price_range).filter(Boolean))].sort();
  prices.forEach(price => {
    const isActive = state.activeFilters.price_range === price;
    chips.push(`<button class="filter-chip${isActive ? ' filter-chip--active' : ''}" data-filter-dim="price_range" data-filter-val="${price}" aria-pressed="${isActive}" aria-label="Price range ${'฿'.repeat(price)}">${'฿'.repeat(price)}</button>`);
  });

  if (state.restaurants.some(r => r.is_halal)) {
    const isActive = state.activeFilters.halal === true;
    chips.push(`<button class="filter-chip${isActive ? ' filter-chip--active' : ''}" data-filter-dim="halal" data-filter-val="true" aria-pressed="${isActive}" aria-label="Halal only">Halal</button>`);
  }
  if (state.restaurants.some(r => r.michelin_stars > 0 || r.michelin_bib)) {
    const isActive = state.activeFilters.michelin === true;
    chips.push(`<button class="filter-chip${isActive ? ' filter-chip--active' : ''}" data-filter-dim="michelin" data-filter-val="true" aria-pressed="${isActive}" aria-label="Michelin recognised">Michelin</button>`);
  }

  // Meal period chips (MISSING-08) — mutually exclusive
  const periods = [
    { key: 'breakfast',  label: '🌅 Breakfast' },
    { key: 'lunch',      label: '☀️ Lunch' },
    { key: 'dinner',     label: '🌙 Dinner' },
    { key: 'late_night', label: '🌃 Late Night' },
  ];
  periods.forEach(({ key, label }) => {
    const isActive = state.activeFilters.meal_period === key;
    chips.push(`<button class="filter-chip filter-chip--period${isActive ? ' filter-chip--active' : ''}" data-filter-dim="meal_period" data-filter-val="${key}" aria-pressed="${isActive}" aria-label="${label}">${label}</button>`);
  });

  container.innerHTML = chips.join('');
}

/* ── Search matcher ─────────────────────────────────────── */
// Spec: docs/design/MISSING_FEATURES.md — MISSING-07
// Client-side search against cached data — works offline
// Searches: name_th, name_en, area, notes, and dish names (Thai + English)
// Case-insensitive substring match. Minimum 2 characters enforced by caller.

function searchMatches(restaurant, query) {
  if (!query || query.length < 2) return true; // no query = show all

  const lower = query.toLowerCase();

  const dishNames = (restaurant.dishes || [])
    .flatMap(d => [d.name_th, d.name_en, d.notes])
    .filter(Boolean);

  const haystack = [
    restaurant.name_th,
    restaurant.name_en,
    restaurant.area,
    restaurant.area_th,
    restaurant.notes,
    restaurant.cart_identifier,
    ...dishNames
  ].filter(Boolean).join(' ').toLowerCase();

  return haystack.includes(lower);
}

/* ── Filter + search unified ─────────────────────────────── */
// Spec: docs/design/MISSING_FEATURES.md — MISSING-07
// Called after any filter change, search input change, or data load.
// Applies: viewMode → filters → search query → sort → renderList

/* ── Restaurant sorter ──────────────────────────────────── */
// Spec: docs/design/MISSING_FEATURES.md — MISSING-14
// 'nearest': _distanceMetres ascending — requires GPS (STEP_B2_05)
// 'rating': wongnai_rating descending, nulls last
// 'newest': created_at descending
// Sort is applied AFTER all filters in applyFiltersAndSearch()

function sortRestaurants(restaurants, sortOrder) {
  const arr = [...restaurants];

  if (sortOrder === 'nearest') {
    return arr.sort((a, b) => {
      const aD = a._distanceMetres ?? Infinity;
      const bD = b._distanceMetres ?? Infinity;
      return aD - bD;
    });
  }

  if (sortOrder === 'rating') {
    return arr.sort((a, b) => {
      const aR = a.wongnai_rating ?? -1;
      const bR = b.wongnai_rating ?? -1;
      return bR - aR;
    });
  }

  if (sortOrder === 'newest') {
    return arr.sort((a, b) =>
      new Date(b.created_at) - new Date(a.created_at)
    );
  }

  return arr;
}

function applyFiltersAndSearch() {
  let results = [...state.restaurants];

  // 1. View mode (All / Wishlist / Visited) — B2_16
  if (state.viewMode === 'wishlist') {
    results = results.filter(r => {
      const p = state.personalData.get(r.id);
      return p && p.is_wishlisted;
    });
  } else if (state.viewMode === 'visited') {
    results = results.filter(r => {
      const p = state.personalData.get(r.id);
      return p && p.is_visited;
    });
  }

  // 2. Existing filter logic
  if (state.activeFilters.city)        results = results.filter(r => r.city === state.activeFilters.city);
  if (state.activeFilters.cuisine)     results = results.filter(r => Array.isArray(r.cuisine_types) && r.cuisine_types.includes(state.activeFilters.cuisine));
  if (state.activeFilters.price_range) results = results.filter(r => r.price_range === Number(state.activeFilters.price_range));
  if (state.activeFilters.open_now)    results = results.filter(r => { const s = isOpenNow(r.opening_hours); return s === 'open' || s === 'closes_soon'; });
  if (state.activeFilters.halal)       results = results.filter(r => r.is_halal);
  if (state.activeFilters.michelin)    results = results.filter(r => r.michelin_stars > 0 || r.michelin_bib);

  // 3. Meal period filter (from STEP_B2_13) — guarded until implemented
  if (state.activeFilters.meal_period && typeof isOpenDuringPeriod === 'function') {
    results = results.filter(r => isOpenDuringPeriod(state.activeFilters.meal_period, r.opening_hours));
  }

  // 4. Near me filter (from STEP_B2_21) — guarded on GPS
  if (state.activeFilters.near_me && state.locationStatus === 'granted') {
    results = results.filter(r => r._distanceMetres != null && r._distanceMetres <= (state.nearMeRadiusM || 2000));
  }

  // 5. Full-text search — runs AFTER filters (AND logic)
  if (state.searchQuery && state.searchQuery.length >= 2) {
    results = results.filter(r => searchMatches(r, state.searchQuery));
  }

  // 6. Sort
  results = sortRestaurants(results, state.sortOrder);

  state.filtered = results;

  // 7. Render
  renderList(state.filtered);
  buildFilterChips();
  if (state.activeView === 'map') renderPins(state.filtered);
  renderLocationNotice();
}


function renderList(restaurants) {
  if (!dom.cardList) return;
  if (dom.skeletonList) {
    dom.skeletonList.style.display = 'none';
    dom.skeletonList.setAttribute('hidden', '');
  }
  dom.cardList.removeAttribute('hidden');
  dom.cardList.style.display = 'flex';
  if (!restaurants || restaurants.length === 0) {
    dom.cardList.innerHTML = '';
    if (dom.emptyState) {
      dom.emptyState.removeAttribute('hidden');
      dom.emptyState.style.display = 'flex';
    }
    return;
  }
  if (dom.emptyState) dom.emptyState.style.display = 'none';
  dom.cardList.innerHTML = restaurants.map(cardHTML).join('');
}

/* ============================================================
   ROUTER — hash-based navigation
   #map (default), #list, #restaurant/{slug}
   ============================================================ */

function initRouter() {
  window.addEventListener('hashchange', () => handleRoute(window.location.hash));
  handleRoute(window.location.hash);
}

function handleRoute(hash) {
  if (!hash) hash = '';

  if (hash.startsWith('#restaurant/')) {
    const slug = decodeURIComponent(hash.slice(12));
    if (state.restaurants.length === 0) {
      // Data not yet loaded — store pending and handle after fetch
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
    // '#map', '' or anything else
    hideDetailPage();
    applyView('map');
  }
}

/* ── View management ──────────────────────────────────────── */

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

/**
 * reviewLinksHTML — fetches review links from restaurant_sources table.
 * No tier filter — shows all sources that have a URL.
 * Injected async into the Reviews section placeholder.
 * @param {string} restaurantId
 * @returns {Promise<string>} HTML string (empty if no sources at all)
 */
async function reviewLinksHTML(restaurantId) {
  const { data: sources, error } = await db
    .from('restaurant_sources')
    .select('url, excerpt, language, source_tier, rating_score, sources(name)')
    .eq('restaurant_id', restaurantId)
    .not('url', 'is', null)
    .order('language')
    .limit(10);

  if (error || !sources || sources.length === 0) return '';

  let html = '';

  html += sources.map(s => {
    const label = s.sources?.name || 'Review';
    const rating = s.rating_score ? ` \u00b7 ${s.rating_score}/5` : '';
    const desc = s.excerpt
      ? `<span class="review-card__desc">${escapeHTML(s.excerpt)}</span>`
      : (s.source_tier === 'local_platform'
        ? `<span class="review-card__desc">Thai language reviews and ratings</span>`
        : '');
    return `<a href="${escapeHTML(s.url)}" class="review-card" target="_blank" rel="noopener noreferrer">
      <span class="review-card__source">${escapeHTML(label)}${rating}</span>
      ${desc}
      <span class="review-card__arrow" aria-hidden="true">&#8250;</span>
    </a>`;
  }).join('');

  return html;
}

/* ── Detail page ──────────────────────────────────────────── */

function openDetail(id) {
  const r = state.restaurants.find(r => r.id === id);
  if (!r) return;
  const key = r.slug || String(r.id);
  window.location.hash = '#restaurant/' + encodeURIComponent(key);
}
