'use strict';

/* ── app-config.js — Supabase client, CONFIG, state, dom refs ── */

/* ============================================================
   THAILAND FOOD GUIDE — app.js
   PWA for iPhone, Safari homescreen install
   Vanilla JS — no framework, no build step
   ============================================================ */

'use strict';

/* ── Supabase client ───────────────────────────────────────── */
const SUPABASE_URL = 'https://gfmjhirnywupfbfmflwn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmbWpoaXJueXd1cGZiZm1mbHduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjkyNDcsImV4cCI6MjA5MDc0NTI0N30.G51aTZpeVmu3hcQxZGTF4chQUUcs4DRKG8D_AAH0Adk';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ── App config ────────────────────────────────────────────── */
const CONFIG = {
  mapDefaultLat:  13.7563,
  mapDefaultLng:  100.5018,
  mapDefaultZoom: 12,
  mapPinZoom:     15,
  cacheVersion:   'v1',
  cacheTTL:       24 * 60 * 60 * 1000,
  timezone:       'Asia/Bangkok',
  nearbyRadiusM:  2000,
  nearbyLimit:    50,
};

/* ── App state ─────────────────────────────────────────────── */
const state = {
  restaurants:    [],
  filtered:       [],
  activeFilters:  {},
  activeView:     'map',        // Map is the default
  selectedId:     null,
  pendingRoute:   null,         // Hash to resolve after data loads
  map:            null,
  mapPins:        new Map(),
  personalData:   new Map(),
  personalId:     null,
  isLoading:      false,
  // ── Build 2: Geolocation (MISSING-01) ────────────────────
  userLat:        null,         // GPS latitude — set by requestLocation()
  userLng:        null,         // GPS longitude — set by requestLocation()
  locationStatus: 'requesting', // 'requesting' | 'granted' | 'denied' | 'unavailable'
  sortOrder:      'rating',     // 'nearest' | 'rating' — 'nearest' only when GPS granted
  nearMeRadiusM:  2000,         // Near me filter radius in metres (MISSING-16)
  // ── Build 2: Search & view mode (MISSING-07, B2_16) ─────
  searchQuery:    '',           // Free-text search query
  viewMode:       'all',        // 'all' | 'wishlist' | 'visited'
};

/* ── DOM references ────────────────────────────────────────── */
const dom = {
  app:              document.getElementById('app'),
  appHeader:        document.getElementById('app-header'),
  viewList:         document.getElementById('view-list'),
  viewMap:          document.getElementById('view-map'),
  viewDetail:       document.getElementById('view-detail'),
  detailTitle:      document.getElementById('detail-title'),
  detailBody:       document.getElementById('detail-body'),
  detailBack:       document.getElementById('detail-back'),
  cardList:         document.getElementById('card-list'),
  skeletonList:     document.getElementById('skeleton-list'),
  emptyState:       document.getElementById('empty-state'),
  searchInput:      document.getElementById('search-input'),
  searchClearBtn:   document.getElementById('search-clear-btn'),
  filterChips:      document.getElementById('filter-chips'),
  sortBtn:          document.getElementById('sort-btn'),
  navMap:           document.getElementById('nav-map'),
  navList:          document.getElementById('nav-list'),
  toastContainer:   document.getElementById('toast-container'),
  mapContainer:     document.getElementById('map'),
  viewToggle:       document.getElementById('view-toggle'),
  navChoiceOverlay: document.getElementById('nav-choice-overlay'),
  navChoiceSheet:   document.getElementById('nav-choice-sheet'),
  sortSheetOverlay: document.getElementById('sort-sheet-overlay'),
  sortSheet:        document.getElementById('sort-sheet'),
  pullIndicator:    document.getElementById('pull-indicator'),
  locationNotice:   document.getElementById('location-notice'),
};
