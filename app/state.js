/* ============================================================
   THAILAND FOOD GUIDE — state.js
   Application state and DOM references
   ============================================================ */

'use strict';

const state = {
  restaurants:    [],
  filtered:       [],
  activeFilters:  {},
  activeView:     'map',
  selectedId:     null,
  pendingRoute:   null,
  map:            null,
  mapPins:        new Map(),
  personalData:   new Map(),
  personalId:     null,
  isLoading:      false,
  userLat:        null,
  userLng:        null,
  locationStatus: 'requesting',
  sortOrder:      'rating',
  nearMeRadiusM:  2000,
  userLocationMarker: null,
  locationManual: false,
  lastFetchLat:   null,
  lastFetchLng:   null,
  mapLegend:      null,
  clusterLayer:   null,
  searchQuery:    '',
  viewMode:       'all',
};

const dom = {};

function initDom() {
  dom.app               = document.getElementById('app');
  dom.appContent        = document.getElementById('app-content');
  dom.viewList          = document.getElementById('view-list');
  dom.viewMap           = document.getElementById('view-map');
  dom.viewDetail        = document.getElementById('view-detail');
  dom.detailTitle       = document.getElementById('detail-title');
  dom.detailBody        = document.getElementById('detail-body');
  dom.detailBack        = document.getElementById('detail-back');
  dom.cardList          = document.getElementById('card-list');
  dom.skeletonList      = document.getElementById('skeleton-list');
  dom.filterChips       = document.getElementById('filter-chips');
  dom.emptyState        = document.getElementById('empty-state');
  dom.navList           = document.getElementById('nav-list');
  dom.navMap            = document.getElementById('nav-map');
  dom.navBar            = document.getElementById('nav-bar');
  dom.toastContainer    = document.getElementById('toast-container');
  dom.mapContainer      = document.getElementById('map');
  dom.searchInput       = document.getElementById('search-input');
  dom.searchClearBtn    = document.getElementById('search-clear-btn');
  dom.viewToggle        = document.getElementById('view-toggle');
  dom.locationNotice    = document.getElementById('location-notice');
  dom.navChoiceOverlay  = document.getElementById('nav-choice-overlay');
  dom.navChoiceSheet    = document.getElementById('nav-choice-sheet');
  dom.sortSheetOverlay  = document.getElementById('sort-sheet-overlay');
  dom.sortSheet         = document.getElementById('sort-sheet');
  dom.sortBtn           = document.getElementById('sort-btn');
  dom.pullIndicator     = document.getElementById('pull-indicator');
}

export { state, dom, initDom };
