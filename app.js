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
  restaurants:   [],
  filtered:      [],
  activeFilters: {},
  activeView:    'map',        // Map is the default
  selectedId:    null,
  pendingRoute:  null,         // Hash to resolve after data loads
  map:           null,
  mapPins:       new Map(),
  personalData:  new Map(),
  personalId:    null,
  isLoading:     false,
};

/* ── DOM refs ──────────────────────────────────────────────── */
const dom = {
  app:            document.getElementById('app'),
  appContent:     document.getElementById('app-content'),
  viewList:       document.getElementById('view-list'),
  viewMap:        document.getElementById('view-map'),
  viewDetail:     document.getElementById('view-detail'),
  detailTitle:    document.getElementById('detail-title'),
  detailBody:     document.getElementById('detail-body'),
  detailBack:     document.getElementById('detail-back'),
  cardList:       document.getElementById('card-list'),
  skeletonList:   document.getElementById('skeleton-list'),
  filterChips:    document.getElementById('filter-chips'),
  emptyState:     document.getElementById('empty-state'),
  navList:        document.getElementById('nav-list'),
  navMap:         document.getElementById('nav-map'),
  navBar:         document.getElementById('nav-bar'),
  toastContainer: document.getElementById('toast-container'),
  mapContainer:   document.getElementById('map'),
};

/* ============================================================
   INDEXEDDB CACHE
   ============================================================ */

const IDB_NAME    = 'thailand-food';
const IDB_VERSION = 1;
const IDB_STORE   = 'cache';
const CACHE_KEY   = 'restaurants_v1';

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => { e.target.result.createObjectStore(IDB_STORE); };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function getCached(key) {
  try {
    const idb  = await openIDB();
    const data = await new Promise((resolve, reject) => {
      const tx  = idb.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror   = (e) => reject(e.target.error);
    });
    if (!data) return null;
    if (Date.now() - data.timestamp > CONFIG.cacheTTL) return null;
    return data.value;
  } catch (err) {
    console.warn('[cache] getCached failed:', err);
    return null;
  }
}

async function setCached(key, value) {
  try {
    const idb = await openIDB();
    await new Promise((resolve, reject) => {
      const tx  = idb.transaction(IDB_STORE, 'readwrite');
      const req = tx.objectStore(IDB_STORE).put({ value, timestamp: Date.now() }, key);
      req.onsuccess = resolve;
      req.onerror   = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.warn('[cache] setCached failed:', err);
  }
}

/* ============================================================
   DATA FETCH
   ============================================================ */

async function fetchRestaurants() {
  state.isLoading = true;
  renderLoadingState();

  const cached = await getCached(CACHE_KEY);
  if (cached) {
    state.restaurants = cached;
    state.filtered    = cached;
    renderList(state.filtered);
    buildFilterChips();
    state.isLoading = false;
    refreshFromNetwork().catch(() => {});
    return;
  }

  await refreshFromNetwork();
}

async function refreshFromNetwork() {
  try {
    const { data, error } = await db
      .from('restaurants')
      .select([
        'id', 'name_th', 'name_en', 'slug', 'city', 'area',
        'lat', 'lng', 'location_precision',
        'cuisine_types', 'price_range',
        'opening_hours', 'phone', 'website',
        'photos', 'description_en', 'description_th',
        'is_halal', 'is_vegetarian_friendly',
        'michelin_stars', 'michelin_bib',
      ].join(', '))
      .order('name_en', { ascending: true });

    if (error) throw error;

    state.restaurants = data || [];
    state.filtered    = state.restaurants;
    state.isLoading   = false;

    await setCached(CACHE_KEY, state.restaurants);
    renderList(state.filtered);
    buildFilterChips();

    // Render map pins if map is currently visible
    if (state.activeView === 'map' && state.map) {
      renderPins(state.filtered);
    }

  } catch (err) {
    console.error('[fetch] refreshFromNetwork failed:', err);
    state.isLoading = false;

    if (state.restaurants.length === 0) {
      showToast('Could not load restaurants. Check your connection.', 'error');
      dom.emptyState.style.display = 'flex';
      dom.cardList.style.display   = 'none';
    } else {
      showToast('Using saved data — could not refresh.', 'error');
      renderList(state.filtered);
    }
  }
}

function renderLoadingState() {
  if (dom.skeletonList) dom.skeletonList.style.display = 'flex';
  if (dom.cardList)     dom.cardList.style.display     = 'none';
  if (dom.emptyState)   dom.emptyState.style.display   = 'none';
}

/* ── Personal data ─────────────────────────────────────────── */

function getOrCreatePersonalId() {
  let id = localStorage.getItem('personal_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('personal_id', id);
  }
  return id;
}

async function loadPersonalData() {
  if (!state.personalId) return;
  try {
    const { data } = await db
      .from('personal_data')
      .select('restaurant_id, is_wishlisted, is_visited, my_rating')
      .eq('device_id', state.personalId);

    if (data) {
      state.personalData.clear();
      data.forEach(row => state.personalData.set(row.restaurant_id, row));
    }
  } catch (err) {
    console.warn('[personal] loadPersonalData failed:', err);
  }
}

async function upsertPersonalData(restaurantId, updates) {
  if (!state.personalId) return;
  const current = state.personalData.get(restaurantId) || {};
  const next    = { ...current, ...updates };
  state.personalData.set(restaurantId, next);

  try {
    await db.from('personal_data').upsert(
      { restaurant_id: restaurantId, device_id: state.personalId, ...updates },
      { onConflict: 'restaurant_id,device_id' }
    );
  } catch (err) {
    console.warn('[personal] upsert failed:', err);
    showToast('Could not save — please try again.', 'error');
  }
}

/* ============================================================
   OPEN NOW
   ============================================================ */

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function isOpenNow(openingHours) {
  if (!openingHours || typeof openingHours !== 'object') return 'unknown';

  const now       = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: CONFIG.timezone,
    weekday:  'short',
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   false,
  });

  const parts    = formatter.formatToParts(now);
  const get      = (type) => parts.find(p => p.type === type)?.value;
  const dayKey   = get('weekday')?.toLowerCase().slice(0, 3);
  const hourStr  = get('hour');
  const minStr   = get('minute');

  if (!dayKey || !hourStr || !minStr) return 'unknown';

  const currentMins = parseInt(hourStr, 10) * 60 + parseInt(minStr, 10);

  if (!(dayKey in openingHours)) return 'unknown';

  const daySlots = openingHours[dayKey];
  if (daySlots === null) return 'closed';
  if (!Array.isArray(daySlots) || daySlots.length === 0) return 'unknown';

  for (const slot of daySlots) {
    const [openH,  openM]  = (slot.open  || '').split(':').map(Number);
    const [closeH, closeM] = (slot.close || '').split(':').map(Number);
    if (isNaN(openH) || isNaN(closeH)) continue;
    const openMins  = openH  * 60 + openM;
    const closeMins = closeH * 60 + closeM;
    const isOpen = closeMins < openMins
      ? (currentMins >= openMins || currentMins < closeMins)
      : (currentMins >= openMins && currentMins < closeMins);
    if (isOpen) return 'open';
  }

  return 'closed';
}

/* ============================================================
   NAVIGATION URLS
   ============================================================ */

function mapsUrl(restaurant) {
  if (restaurant.lat && restaurant.lng) {
    const lat  = encodeURIComponent(restaurant.lat);
    const lng  = encodeURIComponent(restaurant.lng);
    const name = encodeURIComponent(restaurant.name_en || restaurant.name_th || 'Restaurant');
    return `https://maps.google.com/maps?q=${lat},${lng}(${name})`;
  }
  const query = encodeURIComponent(
    [restaurant.name_en, restaurant.city, 'Thailand'].filter(Boolean).join(' ')
  );
  return `https://maps.google.com/maps?q=${query}`;
}

/* ============================================================
   KEYBOARD HANDLER
   ============================================================ */

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

/* ============================================================
   CARD HTML
   ============================================================ */

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cityBadgeClass(city) {
  const map = { bangkok: 'badge--bangkok', chiang_mai: 'badge--chiangmai', koh_chang: 'badge--kohchang' };
  return map[city] || '';
}

function cityLabel(city) {
  const map = { bangkok: 'Bangkok', chiang_mai: 'Chiang Mai', koh_chang: 'Koh Chang' };
  return map[city] || escapeHTML(city);
}

function cardHTML(r) {
  const openStatus   = isOpenNow(r.opening_hours);
  const personal     = state.personalData.get(r.id) || {};
  const primaryPhoto = Array.isArray(r.photos) ? (r.photos.find(p => p.is_primary) || r.photos[0]) : null;

  const openClass = openStatus === 'open'   ? 'open-indicator--open'
                  : openStatus === 'closed' ? 'open-indicator--closed'
                  :                           'open-indicator--unknown';
  const openLabel = openStatus === 'open'   ? 'Open now'
                  : openStatus === 'closed' ? 'Closed'
                  :                           '';

  const wishHTML = personal.is_wishlisted
    ? `<button class="wishlist-btn wishlist-btn--active" data-action="wishlist" data-id="${r.id}" aria-label="Remove from wishlist" aria-pressed="true">♥</button>`
    : `<button class="wishlist-btn" data-action="wishlist" data-id="${r.id}" aria-label="Add to wishlist" aria-pressed="false">♡</button>`;

  const visitedHTML = personal.is_visited
    ? `<span class="visited-marker visited-marker--visited" aria-label="You've visited">✓ Visited</span>`
    : '';

  const photoHTML = primaryPhoto
    ? `<img src="${escapeHTML(primaryPhoto.url)}" alt="${escapeHTML(r.name_en || r.name_th)} photo" loading="lazy" decoding="async">`
    : '';

  const cuisineTag = Array.isArray(r.cuisine_types) && r.cuisine_types.length
    ? `<span class="badge badge--cuisine">${escapeHTML(r.cuisine_types[0].replace(/_/g, ' '))}</span>` : '';
  const priceTag = r.price_range
    ? `<span class="badge badge--price" aria-label="Price range ${r.price_range}">${'฿'.repeat(r.price_range)}</span>` : '';
  const michelinTag = r.michelin_stars > 0
    ? `<span class="badge badge--michelin">${'★'.repeat(r.michelin_stars)}</span>`
    : r.michelin_bib ? `<span class="badge badge--michelin">Bib</span>` : '';
  const halalTag = r.is_halal ? `<span class="badge badge--halal">Halal</span>` : '';
  const cityTag  = r.city ? `<span class="badge ${cityBadgeClass(r.city)}">${cityLabel(r.city)}</span>` : '';

  return `
<article class="card" role="listitem" data-id="${r.id}" aria-label="${escapeHTML(r.name_en || r.name_th)}">
  <div class="card__photo-strip${primaryPhoto ? '' : ' card__photo-strip--empty'}" aria-hidden="true">
    ${photoHTML}
    ${openLabel ? `<span class="open-indicator ${openClass}" aria-label="${openLabel}">${openLabel}</span>` : ''}
    ${wishHTML}
    ${visitedHTML}
  </div>
  <div class="card__body">
    <h2 class="card__name-thai">${escapeHTML(r.name_th || r.name_en)}</h2>
    ${r.name_en && r.name_th ? `<p class="card__name-english">${escapeHTML(r.name_en)}</p>` : ''}
    <div class="card__meta">${cuisineTag}${priceTag}${michelinTag}${halalTag}${cityTag}</div>
    ${r.area ? `<p class="card__location">${escapeHTML(r.area.replace(/_/g, ' '))}</p>` : ''}
    <div class="card__actions">
      <a class="directions-btn" href="${escapeHTML(mapsUrl(r))}" rel="noopener noreferrer" aria-label="Directions to ${escapeHTML(r.name_en || r.name_th)}">Directions</a>
    </div>
  </div>
</article>`;
}

/* ============================================================
   MAP
   ============================================================ */

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
    if (openStatus === 'open')  classes.push('map-pin--open');
    if (personal.is_visited)    classes.push('map-pin--visited');
    if (personal.is_wishlisted) classes.push('map-pin--wishlisted');
    if (r.id === state.selectedId) classes.push('map-pin--selected');

    const icon = L.divIcon({
      className: '',
      html:      `<div class="${classes.join(' ')}" aria-label="${escapeHTML(r.name_en || r.name_th)}"></div>`,
      iconSize:  [32, 32],
      iconAnchor:[16, 32],
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

  container.innerHTML = chips.join('');
}

function applyFilters() {
  let results = state.restaurants;
  if (state.activeFilters.city)        results = results.filter(r => r.city === state.activeFilters.city);
  if (state.activeFilters.cuisine)     results = results.filter(r => Array.isArray(r.cuisine_types) && r.cuisine_types.includes(state.activeFilters.cuisine));
  if (state.activeFilters.price_range) results = results.filter(r => r.price_range === Number(state.activeFilters.price_range));
  if (state.activeFilters.open_now)    results = results.filter(r => isOpenNow(r.opening_hours) === 'open');
  if (state.activeFilters.halal)       results = results.filter(r => r.is_halal);
  if (state.activeFilters.michelin)    results = results.filter(r => r.michelin_stars > 0 || r.michelin_bib);

  state.filtered = results;
  renderList(state.filtered);
  buildFilterChips();
  if (state.activeView === 'map') renderPins(state.filtered);
}

function renderList(restaurants) {
  if (!dom.cardList) return;
  if (dom.skeletonList) dom.skeletonList.style.display = 'none';
  dom.cardList.style.display = 'flex';
  if (!restaurants || restaurants.length === 0) {
    dom.cardList.innerHTML = '';
    dom.emptyState.style.display = 'flex';
    return;
  }
  dom.emptyState.style.display = 'none';
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

/* ── Detail page ──────────────────────────────────────────── */

function openDetail(id) {
  const r = state.restaurants.find(r => r.id === id);
  if (!r) return;
  const key = r.slug || String(r.id);
  window.location.hash = '#restaurant/' + encodeURIComponent(key);
}

function renderDetailPage(r) {
  state.selectedId = r.id;
  if (state.activeView === 'map') selectMapPin(r.id);

  dom.detailTitle.textContent = r.name_th || r.name_en;

  const personal   = state.personalData.get(r.id) || {};
  const openStatus = isOpenNow(r.opening_hours);
  const navHref    = mapsUrl(r);

  // Primary photo
  const photos       = Array.isArray(r.photos) ? r.photos : [];
  const primaryPhoto = photos.find(p => p.is_primary) || photos[0];
  const photosHTML   = primaryPhoto
    ? `<div class="detail-photo"><img src="${escapeHTML(primaryPhoto.url)}" alt="${escapeHTML(r.name_en || r.name_th)} photo" loading="eager" decoding="async"></div>`
    : '';

  // Status
  const openClass = openStatus === 'open'   ? 'open-indicator--open'
                  : openStatus === 'closed' ? 'open-indicator--closed'
                  :                           'open-indicator--unknown';
  const openLabel = openStatus === 'open'   ? 'Open now'
                  : openStatus === 'closed' ? 'Closed'
                  :                           'Hours unknown';

  // Hours rows
  const dayNames  = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  const hoursRows = r.opening_hours
    ? Object.entries(dayNames).map(([key, label]) =>
        `<div class="detail-row"><span class="detail-row__label">${label}</span><span class="detail-row__value">${formatDayHours(r.opening_hours[key])}</span></div>`
      ).join('')
    : '<div class="detail-row"><span class="detail-row__value">Hours not available</span></div>';

  const cuisineDisplay = Array.isArray(r.cuisine_types)
    ? r.cuisine_types.map(c => c.replace(/_/g, ' ')).join(', ') : '';

  dom.detailBody.innerHTML = `
    <div class="detail-body__inner">
      ${photosHTML}

      <div class="detail-meta-row">
        <span class="open-indicator ${openClass}">${openLabel}</span>
        ${r.name_en && r.name_th ? `<p class="card__name-english">${escapeHTML(r.name_en)}</p>` : ''}
      </div>

      <a class="maps-btn" href="${escapeHTML(navHref)}" rel="noopener noreferrer" aria-label="Open in Maps">Open in Maps</a>

      <div class="detail-section">
        ${cuisineDisplay ? `<div class="detail-row"><span class="detail-row__label">Cuisine</span><span class="detail-row__value">${escapeHTML(cuisineDisplay)}</span></div>` : ''}
        ${r.city ? `<div class="detail-row"><span class="detail-row__label">City</span><span class="detail-row__value">${cityLabel(r.city)}${r.area ? ` — ${escapeHTML(r.area.replace(/_/g, ' '))}` : ''}</span></div>` : ''}
        ${r.price_range ? `<div class="detail-row"><span class="detail-row__label">Price</span><span class="detail-row__value">${'฿'.repeat(r.price_range)}</span></div>` : ''}
        ${r.is_halal ? `<div class="detail-row"><span class="detail-row__label">Halal</span><span class="detail-row__value">Yes ✓</span></div>` : ''}
        ${r.michelin_stars > 0 ? `<div class="detail-row"><span class="detail-row__label">Michelin</span><span class="detail-row__value">${'★'.repeat(r.michelin_stars)} Star${r.michelin_stars > 1 ? 's' : ''}</span></div>` : r.michelin_bib ? `<div class="detail-row"><span class="detail-row__label">Michelin</span><span class="detail-row__value">Bib Gourmand</span></div>` : ''}
        ${r.description_en ? `<div class="detail-row"><span class="detail-row__label">About</span><span class="detail-row__value">${escapeHTML(r.description_en)}</span></div>` : ''}
      </div>

      <div class="detail-section">
        <div class="detail-row detail-row--header"><span class="detail-row__label">Opening Hours</span></div>
        ${hoursRows}
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
      </div>
    </div>`;

  dom.app.classList.add('app-shell--detail');
  dom.viewDetail.classList.add('view-detail--active');
  dom.viewDetail.removeAttribute('aria-hidden');
  dom.detailBody.scrollTop = 0;
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
    if (dim === 'open_now' || dim === 'halal' || dim === 'michelin') {
      state.activeFilters[dim] = state.activeFilters[dim] ? undefined : true;
    } else {
      state.activeFilters[dim] = state.activeFilters[dim] === val
        ? undefined
        : (dim === 'price_range' ? Number(val) : val);
    }
    applyFilters();
  });

  // Nav buttons push to hash; router handles the rest
  dom.navMap.addEventListener('click',  () => { window.location.hash = '#map'; });
  dom.navList.addEventListener('click', () => { window.location.hash = '#list'; });

  // Detail back button
  dom.detailBack.addEventListener('click', () => history.back());

  // Personal actions on detail page
  dom.detailBody.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action][data-id]');
    if (!btn) return;
    handlePersonalToggle(btn.dataset.id, btn.dataset.action);
  });
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

  // Handle any route that was pending (restaurant detail before data loaded)
  if (state.pendingRoute) {
    const pending = state.pendingRoute;
    state.pendingRoute = null;
    handleRoute(pending);
  }
}

document.addEventListener('DOMContentLoaded', init);
