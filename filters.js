/* ============================================================
   THAILAND FOOD GUIDE — filters.js
   Filter chips, search, sort, list rendering
   ============================================================ */

'use strict';

import { state, dom } from './state.js';
import { escapeHTML, isOpenNow, isOpenDuringPeriod, cityLabel, showToast } from './utils.js';
import { renderLocationNotice } from './location.js';
import { cardHTML } from './cards.js';

/* ── Late-bound dep ─────────────────────────────────────────── */
let _renderPins = null;

function bindFilterDeps(deps) {
  _renderPins = deps.renderPins;
}

/* ── Filter chips ───────────────────────────────────────────── */

function buildFilterChips() {
  const container = dom.filterChips;
  if (!container) return;
  const chips = [];

  const gpsGranted = state.locationStatus === 'granted';
  const nearMeActive = state.activeFilters.near_me === true;
  chips.push(`<button class="filter-chip${nearMeActive ? ' filter-chip--active' : ''}${!gpsGranted ? ' filter-chip--disabled' : ''}" data-filter-dim="near_me" data-filter-val="true" aria-pressed="${nearMeActive}" ${!gpsGranted ? 'aria-disabled="true"' : ''}>\uD83D\uDCCD Near me</button>`);

  const openNowActive = state.activeFilters.open_now === true;
  chips.push(`<button class="filter-chip${openNowActive ? ' filter-chip--active' : ''}" data-filter-dim="open_now" data-filter-val="true" aria-pressed="${openNowActive}">Open now</button>`);

  const cities = [...new Set(state.restaurants.map(r => r.city).filter(Boolean))].sort();
  cities.forEach(city => {
    const isActive = state.activeFilters.city === city;
    chips.push(`<button class="filter-chip${isActive ? ' filter-chip--active' : ''}" data-filter-dim="city" data-filter-val="${escapeHTML(city)}" aria-pressed="${isActive}">${cityLabel(city)}</button>`);
  });

  const cuisines = [...new Set(state.restaurants.flatMap(r => Array.isArray(r.cuisine_types) ? r.cuisine_types : []))].sort();
  cuisines.forEach(cuisine => {
    if (!cuisine) return;
    const isActive = state.activeFilters.cuisine === cuisine;
    const label    = cuisine.replace(/_/g, ' ');
    chips.push(`<button class="filter-chip${isActive ? ' filter-chip--active' : ''}" data-filter-dim="cuisine" data-filter-val="${escapeHTML(cuisine)}" aria-pressed="${isActive}">${escapeHTML(label)}</button>`);
  });

  const prices = [...new Set(state.restaurants.map(r => r.price_range).filter(Boolean))].sort();
  prices.forEach(price => {
    const isActive = state.activeFilters.price_range === price;
    chips.push(`<button class="filter-chip${isActive ? ' filter-chip--active' : ''}" data-filter-dim="price_range" data-filter-val="${price}" aria-pressed="${isActive}">${'\u0E3F'.repeat(price)}</button>`);
  });

  if (state.restaurants.some(r => r.is_halal)) {
    const isActive = state.activeFilters.halal === true;
    chips.push(`<button class="filter-chip${isActive ? ' filter-chip--active' : ''}" data-filter-dim="halal" data-filter-val="true" aria-pressed="${isActive}">Halal</button>`);
  }
  if (state.restaurants.some(r => r.michelin_stars > 0 || r.michelin_bib)) {
    const isActive = state.activeFilters.michelin === true;
    chips.push(`<button class="filter-chip${isActive ? ' filter-chip--active' : ''}" data-filter-dim="michelin" data-filter-val="true" aria-pressed="${isActive}">Michelin</button>`);
  }

  const periods = [
    { key: 'breakfast',  label: '\uD83C\uDF05 Breakfast' },
    { key: 'lunch',      label: '\u2600\uFE0F Lunch' },
    { key: 'dinner',     label: '\uD83C\uDF19 Dinner' },
    { key: 'late_night', label: '\uD83C\uDF03 Late Night' },
  ];
  periods.forEach(({ key, label }) => {
    const isActive = state.activeFilters.meal_period === key;
    chips.push(`<button class="filter-chip filter-chip--period${isActive ? ' filter-chip--active' : ''}" data-filter-dim="meal_period" data-filter-val="${key}" aria-pressed="${isActive}">${label}</button>`);
  });

  container.innerHTML = chips.join('');
}

/* ── Search ─────────────────────────────────────────────────── */

function searchMatches(restaurant, query) {
  if (!query || query.length < 2) return true;
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

/* ── Sort ───────────────────────────────────────────────────── */

function sortRestaurants(restaurants, sortOrder) {
  const arr = [...restaurants];

  if (sortOrder === 'nearest') {
    return arr.sort((a, b) => (a._distanceMetres ?? Infinity) - (b._distanceMetres ?? Infinity));
  }
  if (sortOrder === 'rating') {
    return arr.sort((a, b) => (b.wongnai_rating ?? -1) - (a.wongnai_rating ?? -1));
  }
  if (sortOrder === 'newest') {
    return arr.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  return arr;
}

/* ── Apply all filters + search + sort ──────────────────────── */

function applyFiltersAndSearch() {
  let results = [...state.restaurants];

  // View mode
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

  // Filters
  if (state.activeFilters.city)        results = results.filter(r => r.city === state.activeFilters.city);
  if (state.activeFilters.cuisine)     results = results.filter(r => Array.isArray(r.cuisine_types) && r.cuisine_types.includes(state.activeFilters.cuisine));
  if (state.activeFilters.price_range) results = results.filter(r => r.price_range === Number(state.activeFilters.price_range));
  if (state.activeFilters.open_now)    results = results.filter(r => { const s = isOpenNow(r.opening_hours); return s === 'open' || s === 'closes_soon'; });
  if (state.activeFilters.halal)       results = results.filter(r => r.is_halal);
  if (state.activeFilters.michelin)    results = results.filter(r => r.michelin_stars > 0 || r.michelin_bib);
  if (state.activeFilters.meal_period) results = results.filter(r => isOpenDuringPeriod(state.activeFilters.meal_period, r.opening_hours));
  if (state.activeFilters.near_me && state.locationStatus === 'granted') {
    results = results.filter(r => r._distanceMetres != null && r._distanceMetres <= (state.nearMeRadiusM || 2000));
  }

  // Search
  if (state.searchQuery && state.searchQuery.length >= 2) {
    results = results.filter(r => searchMatches(r, state.searchQuery));
  }

  // Sort
  results = sortRestaurants(results, state.sortOrder);
  state.filtered = results;

  // For list rendering, apply map viewport bounds if available.
  // BUT skip the viewport filter when the user has expressed an explicit
  // narrowing intent that may point outside the current map view —
  // otherwise results get silently dropped (e.g. searching "Saen" from
  // Melbourne matches Bangkok restaurants that then fail the viewport check).
  const hasExplicitFilter =
    (state.searchQuery && state.searchQuery.length >= 2) ||
    !!state.activeFilters.city ||
    state.viewMode === 'wishlist' ||
    state.viewMode === 'visited';

  let listResults = results;
  if (state.mapBounds && !hasExplicitFilter) {
    const { north, south, east, west } = state.mapBounds;
    listResults = results.filter(r => {
      if (!r.lat || !r.lng) return false;
      return r.lat >= south && r.lat <= north && r.lng >= west && r.lng <= east;
    });
  }

  // Render
  renderList(listResults);
  buildFilterChips();
  if (state.activeView === 'map' && _renderPins) _renderPins(state.filtered);
  renderLocationNotice();
}

/* ── Render list ────────────────────────────────────────────── */

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

export {
  buildFilterChips,
  applyFiltersAndSearch,
  renderList,
  bindFilterDeps,
};
