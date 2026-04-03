/* ============================================================
   CONFIG
   ============================================================ */
const SUPABASE_URL = 'https://gfmjhirnywupfbfmflwn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmbWpoaXJueXd1cGZiZm1mbHduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjkyNDcsImV4cCI6MjA5MDc0NTI0N30.G51aTZpeVmu3hcQxZGTF4chQUUcs4DRKG8D_AAH0Adk';
const IDB_NAME    = 'food-guide';
const IDB_VER     = 1;
const CACHE_TTL   = 24 * 60 * 60 * 1000; // 24 hours

/* ============================================================
   STATE
   ============================================================ */
const S = {
  restaurants: [],
  personal:    {},  // { restaurant_id: personal_data_row }
  search:      '',
  tab:         'list',
  loading:     true,
  mapInit:     false,
  leafletMap:  null,
  filters: {
    openNow:  false,
    halal:    false,
    michelin: false,
    city:     null,
    price:    null,
    cuisine:  null,
  },
};

/* ============================================================
   SUPABASE CLIENT
   ============================================================ */
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ============================================================
   INDEXEDDB HELPERS
   ============================================================ */
let _idb;

async function openIDB() {
  if (_idb) return _idb;
  return new Promise((res, rej) => {
    const req = indexedDB.open(IDB_NAME, IDB_VER);
    req.onupgradeneeded = e => e.target.result.createObjectStore('kv');
    req.onsuccess  = e => { _idb = e.target.result; res(_idb); };
    req.onerror    = e => rej(e.target.error);
  });
}

async function idbGet(key) {
  try {
    const db = await openIDB();
    return new Promise(res => {
      const req = db.transaction('kv', 'readonly').objectStore('kv').get(key);
      req.onsuccess = () => res(req.result ?? null);
      req.onerror   = () => res(null);
    });
  } catch { return null; }
}

async function idbSet(key, val) {
  try {
    const db = await openIDB();
    return new Promise(res => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = res;
    });
  } catch { /* non-fatal */ }
}

/* ============================================================
   DATA FETCHING
   ============================================================ */
async function fetchRestaurants() {
  const cached = await idbGet('restaurants');
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const { data, error } = await db
    .from('restaurants')
    .select('*')
    .order('city_label')
    .order('name_th');

  if (error) throw error;
  await idbSet('restaurants', { data, ts: Date.now() });
  return data;
}

async function fetchPersonal() {
  const { data } = await db.from('personal_data').select('*');
  const map = {};
  if (data) data.forEach(r => { map[r.restaurant_id] = r; });
  return map;
}

async function savePersonal(rid) {
  if (!navigator.onLine) {
    showToast("You're offline — connect to save changes");
    return;
  }
  const row    = S.personal[rid] || {};
  const fields = ['visited','visited_date','my_rating','my_notes','wishlist'];
  const payload = { restaurant_id: rid };
  fields.forEach(k => { if (k in row) payload[k] = row[k]; });
  if (row.id) payload.id = row.id;

  const { error } = await db
    .from('personal_data')
    .upsert(payload, { onConflict: 'restaurant_id' });

  if (error) showToast('Could not save — please try again');
}

/* ============================================================
   OPEN NOW (Asia/Bangkok timezone)
   ============================================================ */
function toMins(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function isOpenNow(opening_hours) {
  if (!opening_hours?.periods?.length) return null;
  try {
    const bkk  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    const day   = bkk.getDay();
    const mins  = bkk.getHours() * 60 + bkk.getMinutes();
    for (const p of opening_hours.periods) {
      if (!Array.isArray(p.days) || !p.days.includes(day)) continue;
      const o = toMins(p.open), c = toMins(p.close);
      const open = c < o
        ? (mins >= o || mins < c)   // spans midnight
        : (mins >= o && mins < c);
      if (open) return true;
    }
    return false;
  } catch { return null; }
}

function openBadgeHTML(opening_hours) {
  const s = isOpenNow(opening_hours);
  if (s === null) return '';
  return s
    ? '<span class="open-dot open">● Open now</span>'
    : '<span class="open-dot closed">● Closed</span>';
}

/* ============================================================
   NAVIGATION URLS
   ============================================================ */
function navUrls(r) {
  // All restaurants are area_only — search by name + area + city
  const q = encodeURIComponent(
    [r.name_en, r.area_en, r.city_label].filter(Boolean).join(' ')
  );
  return {
    apple:  `maps://maps.apple.com/?q=${q}`,
    google: r.google_maps_url || `https://maps.google.com/?q=${q}`,
  };
}

/* ============================================================
   FILTER & SEARCH
   ============================================================ */
function getFiltered(source) {
  let list = source || S.restaurants;

  const q = S.search.trim().toLowerCase();
  if (q) {
    list = list.filter(r =>
      (r.name_th || '').toLowerCase().includes(q) ||
      (r.name_en || '').toLowerCase().includes(q) ||
      (r.area_en  || '').toLowerCase().includes(q) ||
      (r.dishes   || []).some(d => (d.name_en || '').toLowerCase().includes(q))
    );
  }

  const f = S.filters;
  if (f.city)    list = list.filter(r => r.city_label === f.city);
  if (f.price)   list = list.filter(r => r.price_tier === f.price);
  if (f.cuisine) list = list.filter(r => (r.cuisine_types || []).includes(f.cuisine));
  if (f.halal)   list = list.filter(r => r.is_halal);
  if (f.michelin)list = list.filter(r => r.is_michelin);
  if (f.openNow) list = list.filter(r => isOpenNow(r.opening_hours) === true);

  return list;
}

/* ============================================================
   CARD HTML
   ============================================================ */
function priceStr(tier) {
  return tier ? '฿'.repeat(tier) : '';
}

function cityClass(label) {
  if (!label) return '';
  const slug = label.toLowerCase().replace(/\s+/g, '');
  return `city-tag--${slug}`;
}

function cardHTML(r) {
  const p    = S.personal[r.id] || {};
  const urls = navUrls(r);

  // Badges
  const badges = [
    r.is_michelin  ? `<span class="badge badge--michelin">${r.michelin_type || 'Michelin'}</span>` : '',
    r.is_halal     ? '<span class="badge badge--halal">Halal</span>' : '',
    r.legacy_years ? `<span class="badge badge--legacy">${r.legacy_years}+ yrs</span>` : '',
  ].filter(Boolean).join('');

  // Dish chips (max 4)
  const dishChips = (r.dishes || []).slice(0, 4).map(d =>
    `<span class="dish-chip">${d.name_en || d.name_th || ''}</span>`
  ).join('');

  // Stars
  const myRating = p.my_rating || 0;
  const stars = [1,2,3,4,5].map(i =>
    `<button class="star ${i <= myRating ? 'star--on' : ''}" data-rid="${r.id}" data-star="${i}" aria-label="Rate ${i} star${i>1?'s':''}">★</button>`
  ).join('');

  // Personal buttons
  const wishClass   = p.wishlist ? 'wishlist-btn--on' : '';
  const visitClass  = p.visited  ? 'visited-btn--on'  : '';
  const visitLabel  = p.visited
    ? `✓ Visited${p.visited_date ? ' · ' + p.visited_date : ''}`
    : 'Mark Visited';

  // Call button only if phone exists
  const callBtn = r.phone
    ? `<a href="tel:${r.phone}" class="btn btn--secondary">📞 Call</a>`
    : '';

  // Wongnai link
  const wongnaiLink = r.wongnai_url
    ? `<a href="${r.wongnai_url}" class="btn btn--secondary" target="_blank" rel="noopener">Wongnai ↗</a>`
    : '';

  return `
<article class="card" role="listitem" id="card-${r.id}">
  <div class="card__header">
    <div class="card__names">
      <h2 class="text-restaurant-name-th">${r.name_th || r.name_en || ''}</h2>
      ${r.name_en && r.name_th ? `<p class="text-restaurant-name-en">${r.name_en}</p>` : ''}
    </div>
    <button class="wishlist-btn ${wishClass}" data-rid="${r.id}" aria-label="Save to wishlist" type="button">🔖</button>
  </div>

  <div class="card__meta">
    ${r.price_tier ? `<span class="price-tier">${priceStr(r.price_tier)}</span>` : ''}
    ${(r.cuisine_types || []).slice(0, 2).map(c => `<span class="tag">${c.replace(/_/g, ' ')}</span>`).join('')}
    ${r.city_label ? `<span class="city-tag ${cityClass(r.city_label)}">${r.city_label}</span>` : ''}
    ${openBadgeHTML(r.opening_hours)}
  </div>

  ${r.area_en ? `<p class="card__area">📍 ${r.area_en}</p>` : ''}
  ${badges ? `<div class="card__badges">${badges}</div>` : ''}

  ${dishChips ? `
  <div class="card__dishes">
    <p class="dishes-label">Must Order</p>
    <div class="dishes-row">${dishChips}</div>
  </div>` : ''}

  ${r.hours_notes ? `<p class="card__hours-notes">${r.hours_notes}</p>` : ''}

  <div class="card__actions">
    <a href="${urls.apple}" class="btn btn--primary">🗺 Apple Maps</a>
    <a href="${urls.google}" class="btn btn--secondary" target="_blank" rel="noopener">📍 Google Maps</a>
    ${callBtn}
    ${wongnaiLink}
  </div>

  <div class="card__personal">
    <div class="stars-row" aria-label="Your rating">${stars}</div>
    <button class="visited-btn ${visitClass}" data-rid="${r.id}" type="button">${visitLabel}</button>
  </div>
</article>`;
}

/* ============================================================
   RENDERING
   ============================================================ */
function setSubtitle(text) {
  const el = document.getElementById('nav-subtitle');
  if (el) el.textContent = text;
}

function renderList() {
  const filtered = getFiltered();
  const el = document.getElementById('card-list');
  if (!filtered.length) {
    el.innerHTML = `
<div class="empty-state">
  <div class="empty-state__icon">🍽</div>
  <h3 class="empty-state__title">No restaurants found</h3>
  <p class="text-secondary">Try adjusting your search or filters</p>
</div>`;
  } else {
    el.innerHTML = filtered.map(cardHTML).join('');
  }
  setSubtitle(`${filtered.length} place${filtered.length !== 1 ? 's' : ''}`);
}

function renderPersonal() {
  const list = S.restaurants.filter(r => {
    const p = S.personal[r.id];
    return p && (p.wishlist || p.visited);
  });
  const el = document.getElementById('card-list');
  if (!list.length) {
    el.innerHTML = `
<div class="empty-state">
  <div class="empty-state__icon">🔖</div>
  <h3 class="empty-state__title">Your list is empty</h3>
  <p class="text-secondary">Bookmark restaurants or mark them visited to see them here</p>
</div>`;
  } else {
    el.innerHTML = list.map(cardHTML).join('');
  }
  setSubtitle(`${list.length} saved`);
}

/* ============================================================
   MAP VIEW
   ============================================================ */
const CITY_PINS = [
  { name: 'Bangkok',    lat: 13.7563, lng: 100.5018, color: '#2E6DA4' },
  { name: 'Chiang Mai', lat: 18.7883, lng:  98.9853, color: '#2E7D32' },
  { name: 'Koh Chang',  lat: 12.0738, lng: 102.3226, color: '#AD6F00' },
];

function initMap() {
  if (S.mapInit) { setTimeout(() => S.leafletMap?.invalidateSize(), 100); return; }
  S.mapInit = true;

  setTimeout(() => {
    const map = L.map('map-view', { zoomControl: true }).setView([14.5, 100.5], 6);
    S.leafletMap = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(map);

    CITY_PINS.forEach(city => {
      const count = S.restaurants.filter(r => r.city_label === city.name).length;

      const marker = L.circleMarker([city.lat, city.lng], {
        radius:      20,
        fillColor:   city.color,
        color:       '#fff',
        weight:      2,
        opacity:     1,
        fillOpacity: 0.9,
      }).addTo(map);

      marker.bindPopup(`
        <strong>${city.name}</strong><br>
        ${count} restaurants<br>
        <a href="#" onclick="filterByCity('${city.name}'); return false;" style="color:#C9A84C">View list →</a>
      `);
    });

    map.invalidateSize();
  }, 150);
}

window.filterByCity = function(city) {
  S.filters.city = city;
  switchTab('list');
};

/* ============================================================
   FILTER BAR
   ============================================================ */
const FILTER_CHIPS = [
  { label: 'Open Now',    key: 'openNow',  val: true },
  { label: 'Halal',       key: 'halal',    val: true },
  { label: 'Michelin',    key: 'michelin', val: true },
  { label: 'Bangkok',     key: 'city',     val: 'Bangkok' },
  { label: 'Chiang Mai',  key: 'city',     val: 'Chiang Mai' },
  { label: 'Koh Chang',   key: 'city',     val: 'Koh Chang' },
  { label: '฿',           key: 'price',    val: 1 },
  { label: '฿฿',          key: 'price',    val: 2 },
  { label: '฿฿฿',         key: 'price',    val: 3 },
  { label: '฿฿฿฿',        key: 'price',    val: 4 },
];

function renderFilterBar() {
  const bar = document.getElementById('filter-bar');
  bar.innerHTML = FILTER_CHIPS.map(c => {
    const isActive = S.filters[c.key] === c.val;
    return `<button class="chip${isActive ? ' chip--active' : ''}" data-key="${c.key}" data-val='${JSON.stringify(c.val)}' type="button">${c.label}</button>`;
  }).join('');
}

/* ============================================================
   TAB SWITCHING
   ============================================================ */
function switchTab(tab) {
  S.tab = tab;

  // Update nav items
  document.querySelectorAll('.nav-item').forEach(el => {
    const active = el.dataset.tab === tab;
    el.classList.toggle('nav-item--active', active);
    el.setAttribute('aria-current', active ? 'page' : 'false');
  });

  // Show/hide views
  const cardList = document.getElementById('card-list');
  const mapView  = document.getElementById('map-view');

  if (tab === 'map') {
    cardList.style.display = 'none';
    mapView.style.display  = 'block';
    initMap();
    setSubtitle('City map');
  } else {
    mapView.style.display  = 'none';
    cardList.style.display = 'flex';
    if (tab === 'list')     renderList();
    if (tab === 'personal') renderPersonal();
  }
}

/* ============================================================
   TOAST
   ============================================================ */
let _toastTimer;
function showToast(msg, ms = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('visible'), ms);
}

/* ============================================================
   EVENT DELEGATION
   ============================================================ */
document.addEventListener('click', async e => {
  // Bottom nav tabs
  const navItem = e.target.closest('.nav-item[data-tab]');
  if (navItem) { switchTab(navItem.dataset.tab); return; }

  // Filter chips
  const chip = e.target.closest('.chip[data-key]');
  if (chip) {
    const key = chip.dataset.key;
    const val = JSON.parse(chip.dataset.val);
    // Toggle: click same chip again to clear
    S.filters[key] = S.filters[key] === val ? (typeof val === 'boolean' ? false : null) : val;
    renderFilterBar();
    if (S.tab === 'list') renderList();
    return;
  }

  // Star rating
  const star = e.target.closest('.star[data-rid]');
  if (star) {
    const rid    = star.dataset.rid;
    const rating = parseInt(star.dataset.star, 10);
    const prev   = (S.personal[rid] || {}).my_rating;
    const next   = prev === rating ? null : rating; // tap same star = clear
    S.personal[rid] = { ...(S.personal[rid] || {}), my_rating: next };
    // Re-render just this card efficiently
    const cardEl = document.getElementById(`card-${rid}`);
    if (cardEl) {
      const r = S.restaurants.find(r => r.id === rid);
      if (r) cardEl.outerHTML = cardHTML(r);
    }
    await savePersonal(rid);
    return;
  }

  // Wishlist toggle
  const wb = e.target.closest('.wishlist-btn[data-rid]');
  if (wb) {
    const rid = wb.dataset.rid;
    const cur = !!(S.personal[rid] || {}).wishlist;
    S.personal[rid] = { ...(S.personal[rid] || {}), wishlist: !cur };
    const cardEl = document.getElementById(`card-${rid}`);
    if (cardEl) {
      const r = S.restaurants.find(r => r.id === rid);
      if (r) cardEl.outerHTML = cardHTML(r);
    }
    showToast(cur ? 'Removed from list' : 'Saved to your list');
    await savePersonal(rid);
    return;
  }

  // Visited toggle
  const vb = e.target.closest('.visited-btn[data-rid]');
  if (vb) {
    const rid   = vb.dataset.rid;
    const cur   = !!(S.personal[rid] || {}).visited;
    const today = new Date().toISOString().slice(0, 10);
    S.personal[rid] = {
      ...(S.personal[rid] || {}),
      visited:      !cur,
      visited_date: !cur ? today : null,
    };
    const cardEl = document.getElementById(`card-${rid}`);
    if (cardEl) {
      const r = S.restaurants.find(r => r.id === rid);
      if (r) cardEl.outerHTML = cardHTML(r);
    }
    showToast(cur ? 'Marked as not visited' : '✓ Marked as visited');
    await savePersonal(rid);
    return;
  }
});

// Search
document.getElementById('search-input').addEventListener('input', e => {
  S.search = e.target.value;
  if (S.tab !== 'list') switchTab('list');
  else renderList();
});

/* ============================================================
   SERVICE WORKER
   ============================================================ */
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration failure is non-fatal
    });
  }
}

/* ============================================================
   INIT
   ============================================================ */
async function init() {
  registerSW();

  // Show skeleton while loading
  document.getElementById('card-list').innerHTML = `
    <div class="skeleton skeleton--card"></div>
    <div class="skeleton skeleton--card"></div>
    <div class="skeleton skeleton--card"></div>`;

  try {
    const [restaurants, personal] = await Promise.all([
      fetchRestaurants(),
      fetchPersonal(),
    ]);
    S.restaurants = restaurants || [];
    S.personal    = personal   || {};
    S.loading     = false;
    renderFilterBar();
    renderList();
  } catch (err) {
    // Network failed — try offline cache
    const cached = await idbGet('restaurants');
    if (cached?.data?.length) {
      S.restaurants = cached.data;
      S.personal    = {};
      S.loading     = false;
      renderFilterBar();
      renderList();
      showToast('Showing cached data — some info may be outdated');
    } else {
      document.getElementById('card-list').innerHTML = `
<div class="empty-state">
  <div class="empty-state__icon">⚠️</div>
  <h3 class="empty-state__title">Could not load restaurants</h3>
  <p class="text-secondary">Please check your internet connection and reload the page</p>
</div>`;
      setSubtitle('No connection');
    }
  }
}

init();
