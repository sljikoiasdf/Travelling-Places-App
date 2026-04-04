'use strict';

/* ── app-ui.js — formatters, navigation, card/photo/dish HTML, escapeHTML ── */

/* ── Distance formatter ─────────────────────────────────────
   Spec: docs/design/MISSING_FEATURES.md — MISSING-02
   ────────────────────────────────────────────────────────── */
function formatDistance(metres, precision) {
  if (!precision || precision === 'no_location') return 'Find locally';
  if (precision === 'area_only') return null;
  if (metres === null || metres === undefined) {
    if (precision === 'approximate') return 'Location approximate';
    return '';
  }
  if (metres < 1000) {
    return `${Math.round(metres)} m`;
  } else {
    const km   = (metres / 1000).toFixed(1);
    const mins = Math.max(1, Math.round(metres / 80));
    return `${km} km · ${mins} min walk`;
  }
}

/* ============================================================
   NAVIGATION URLS
   ============================================================ */

function resolveNavDestination(restaurant) {
  const p = restaurant.location_precision;
  if ((p === 'exact' || p === 'approximate') && restaurant.lat && restaurant.lng) {
    return {
      lat: restaurant.lat,
      lng: restaurant.lng,
      isApproximate: p === 'approximate',
      label: p === 'approximate' ? 'Location approximate' : null
    };
  }
  if (restaurant.landmark_latitude && restaurant.landmark_longitude) {
    return {
      lat: restaurant.landmark_latitude,
      lng: restaurant.landmark_longitude,
      isApproximate: true,
      label: 'Navigate to nearby landmark'
    };
  }
  return null;
}

function locationBlockHTML(restaurant) {
  const p    = restaurant.location_precision;
  const dest = resolveNavDestination(restaurant);
  let html   = '';

  // Address — shown prominently when available (street address, not area)
  if (restaurant.address_en) {
    html += `<p class="detail__address">${escapeHTML(restaurant.address_en)}</p>`;
  }

  // Cart / no-location: show finder box prominently
  if (!p || p === 'no_location' || p === 'area_only') {
    if (restaurant.cart_identifier || restaurant.location_notes) {
      html += `<div class="cart-finder-box">
        <div class="cart-finder-box__label">How to find it</div>
        ${restaurant.cart_identifier ? `<div class="cart-finder-box__text">${escapeHTML(restaurant.cart_identifier)}</div>` : ''}
        ${restaurant.location_notes ? `<div class="cart-finder-box__text">${escapeHTML(restaurant.location_notes)}</div>` : ''}
      </div>`;
    }
  }

  // Nearby landmark note
  if (restaurant.nearby_landmark_en) {
    html += `<p class="landmark-note">Near: ${escapeHTML(restaurant.nearby_landmark_en)}</p>`;
  }

  // Area + city
  const areaCity = [
    restaurant.area ? restaurant.area.replace(/_/g, ' ') : null,
    restaurant.city ? cityLabel(restaurant.city) : null
  ].filter(Boolean).join(', ');
  if (areaCity) html += `<p class="detail__area">${escapeHTML(areaCity)}</p>`;

  // Directions button — precision-aware
  if (dest) {
    const navUrl = `https://maps.google.com/maps?q=${encodeURIComponent(dest.lat)},${encodeURIComponent(dest.lng)}(${encodeURIComponent(restaurant.name_en || restaurant.name_th || 'Restaurant')})`;
    const approxBadge = dest.isApproximate && dest.label
      ? `<span class="precision-badge">${escapeHTML(dest.label)}</span>`
      : '';
    html += `<div class="detail__directions-area">
      ${approxBadge}
      <button class="maps-btn" data-action="directions" data-restaurant-id="${restaurant.id}" aria-label="Get directions to ${escapeHTML(restaurant.name_en || restaurant.name_th || 'restaurant')}">Get Directions</button>
    </div>`;
  } else {
    html += `<div class="detail__directions-area">
      <button class="maps-btn maps-btn--disabled" data-action="directions" data-restaurant-id="${restaurant.id}" aria-label="Search for ${escapeHTML(restaurant.name_en || restaurant.name_th || 'restaurant')} on Maps">Find on Maps</button>
    </div>`;
  }

  return html;
}

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

function navUrls(restaurant) {
  const dest = resolveNavDestination(restaurant);
  let apple = null, google = null, streetView = null;

  if (dest && dest.lat && dest.lng) {
    const lat = dest.lat;
    const lng = dest.lng;
    apple  = `maps://maps.apple.com/?daddr=${lat},${lng}&dirflg=w`;
    google = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
    if (restaurant.location_precision === 'exact') {
      streetView = `https://maps.google.com/?layer=c&cbll=${lat},${lng}`;
    }
  } else {
    const name = encodeURIComponent(restaurant.name_th || restaurant.name_en || '');
    apple  = `maps://maps.apple.com/?q=${name}`;
    google = `https://www.google.com/maps/search/?api=1&query=${name}`;
  }

  return { apple, google, streetView };
}

function showNavChoiceSheet(restaurant) {
  const urls = navUrls(restaurant);
  const dest = resolveNavDestination(restaurant);
  const approxLabel = dest?.isApproximate
    ? `<p class="nav-choice-sheet__title">${escapeHTML(dest.label || 'Location approximate')}</p>` : '';

  const sheetContent = `
    ${approxLabel}
    <p class="nav-choice-sheet__title">Open with</p>
    <a href="${urls.apple}" class="nav-choice-btn">
      <span>🗺</span> Apple Maps
    </a>
    <a href="${urls.google}" class="nav-choice-btn" target="_blank" rel="noopener">
      <span>📍</span> Google Maps
    </a>
    ${urls.streetView ? `<a href="${urls.streetView}" class="street-view-link" target="_blank" rel="noopener">📷 Street View</a>` : ''}
    <button class="nav-choice-cancel" id="nav-choice-cancel">Cancel</button>
  `;

  const overlay = dom.navChoiceOverlay || document.getElementById('nav-choice-overlay');
  const sheet   = dom.navChoiceSheet   || document.getElementById('nav-choice-sheet');
  if (!overlay || !sheet) {
    window.location.href = urls.apple;
    return;
  }

  sheet.innerHTML = sheetContent;
  overlay.classList.add('nav-choice-overlay--visible');

  function dismiss(e) {
    if (e.target === overlay) {
      overlay.classList.remove('nav-choice-overlay--visible');
      overlay.removeEventListener('click', dismiss);
    }
  }
  overlay.addEventListener('click', dismiss);

  const cancelBtn = document.getElementById('nav-choice-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      overlay.classList.remove('nav-choice-overlay--visible');
    }, { once: true });
  }
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

function dishesPreviewHTML(dishes) {
  if (!dishes || !Array.isArray(dishes) || dishes.length === 0) return '';
  const sorted = [...dishes].sort((a, b) => (b.is_signature ? 1 : 0) - (a.is_signature ? 1 : 0));
  const shown = sorted.slice(0, 2).map(d => d.name_th || d.name_en || '').filter(Boolean);
  if (shown.length === 0) return '';
  return `<div class="card__dishes-preview">
    <span class="card__dishes-label">Must order:</span> ${escapeHTML(shown.join(' · '))}
  </div>`;
}

function dishesDetailHTML(dishes) {
  if (!dishes || !Array.isArray(dishes) || dishes.length === 0) return '';
  const items = dishes.map(d => `
    <div class="dish-item ${d.is_signature ? 'dish-item--signature' : ''}">
      ${d.name_th ? `<span class="dish-item__name-th">${escapeHTML(d.name_th)}</span>` : ''}
      ${d.name_en ? `<span class="dish-item__name-en">${escapeHTML(d.name_en)}</span>` : ''}
      ${d.price_approx ? `<span class="dish-item__price">฿${escapeHTML(String(d.price_approx))}</span>` : ''}
      ${d.notes ? `<p class="dish-item__notes">${escapeHTML(d.notes)}</p>` : ''}
      ${d.is_signature ? `<span class="dish-item__badge">Signature</span>` : ''}
    </div>
  `).join('');
  return `<section class="dishes-section">
    <h3 class="dishes-section__heading">Known for</h3>
    ${items}
  </section>`;
}

function starRatingHTML(rating, restaurantId, interactive = false) {
  if (!interactive && (!rating || rating === 0)) return '';

  const stars = [1, 2, 3, 4, 5].map(n => {
    const filled = rating && n <= rating;
    if (interactive) {
      return `<button class="star-btn${filled ? ' star-btn--filled' : ''}" data-rating="${n}" data-restaurant-id="${restaurantId}" aria-label="${n} star${n > 1 ? 's' : ''}" aria-pressed="${filled ? 'true' : 'false'}">★</button>`;
    }
    return `<span class="star${filled ? ' star--filled' : ''}">★</span>`;
  }).join('');

  return `<div class="star-rating${interactive ? ' star-rating--interactive' : ''}" role="${interactive ? 'group' : 'img'}" aria-label="Rating: ${rating || 0} out of 5">${stars}</div>`;
}

function personalNotesHTML(notes, restaurantId) {
  const safe = notes ? notes.replace(/</g, '&lt;') : '';
  return `<div class="personal-notes">
    <label class="personal-notes__label" for="personal-notes-${restaurantId}">Your notes</label>
    <textarea class="personal-notes__input" id="personal-notes-${restaurantId}" data-restaurant-id="${restaurantId}" placeholder="Add your own notes…" rows="3">${safe}</textarea>
    <span class="personal-notes__saved" id="personal-notes-saved-${restaurantId}">Saved</span>
  </div>`;
}

function attachPersonalNotesListener(restaurantId) {
  const textarea = document.getElementById(`personal-notes-${restaurantId}`);
  const savedEl  = document.getElementById(`personal-notes-saved-${restaurantId}`);
  if (!textarea) return;
  let notesDebounceTimer;
  textarea.addEventListener('input', () => {
    if (!navigator.onLine) { showToast("Can't save while offline", 'error'); return; }
    clearTimeout(notesDebounceTimer);
    notesDebounceTimer = setTimeout(async () => {
      const value = textarea.value.trim();
      await upsertPersonalData(restaurantId, { notes: value });
      if (savedEl) {
        savedEl.classList.add('personal-notes__saved--visible');
        setTimeout(() => savedEl.classList.remove('personal-notes__saved--visible'), 1500);
      }
    }, 1000);
  });
}

function contactRowHTML(restaurant) {
  const items = [];

  if (restaurant.phone) {
    const raw = restaurant.phone.replace(/\s+/g, '');
    let display = raw;
    const thaiMatch = raw.replace(/^\+66/, '0').match(/^(0\d{1,2})(\d{3,4})(\d{4})$/);
    if (thaiMatch) display = `${thaiMatch[1]}-${thaiMatch[2]}-${thaiMatch[3]}`;
    items.push(`<a class="contact-link contact-link--phone" href="tel:${encodeURI(raw)}">📞 ${escapeHTML(display)}</a>`);
  }

  if (restaurant.wongnai_url) {
    items.push(`<a class="contact-link" href="${escapeHTML(restaurant.wongnai_url)}" target="_blank" rel="noopener noreferrer">View on Wongnai ↗</a>`);
  }

  if (restaurant.website) {
    let domain = 'Website';
    try { domain = new URL(restaurant.website).hostname.replace(/^www\./, ''); } catch(e) { /* use fallback */ }
    items.push(`<a class="contact-link" href="${escapeHTML(restaurant.website)}" target="_blank" rel="noopener noreferrer">${escapeHTML(domain)} ↗</a>`);
  }

  if (items.length === 0) return '';
  return `<div class="contact-row">${items.join('')}</div>`;
}

function photoStripHTML(restaurant, openBadgeHTML, overlaysHTML) {
  const photos = [];

  if (restaurant.identification_photo_url) {
    photos.push({ url: restaurant.identification_photo_url, type: 'identification' });
  }

  if (Array.isArray(restaurant.photos)) {
    const typePriority = { cart: 0, sign: 1, exterior: 2, dish: 3, interior: 4 };
    const sorted = [...restaurant.photos].sort((a, b) =>
      (typePriority[a.type] ?? 9) - (typePriority[b.type] ?? 9)
    );
    sorted.forEach(p => {
      if (photos.length < 5 && p.url !== restaurant.identification_photo_url) {
        photos.push(p);
      }
    });
  }

  if (photos.length === 0) {
    const cuisineText = Array.isArray(restaurant.cuisine_types) && restaurant.cuisine_types.length
      ? restaurant.cuisine_types.slice(0, 2).map(c => c.replace(/_/g, ' ')).join(' · ')
      : 'Thai cuisine';
    return `<div class="card__photo-placeholder">
      <span class="card__cuisine-label">${escapeHTML(cuisineText)}</span>
      ${openBadgeHTML}
      ${overlaysHTML}
    </div>`;
  }

  const slides = photos.slice(0, 3).map(p =>
    `<img class="card__photo-slide" src="${escapeHTML(p.url)}" alt="" loading="lazy" decoding="async">`
  ).join('');

  return `<div class="card__photo-strip">
    ${slides}
    ${openBadgeHTML}
    ${overlaysHTML}
  </div>`;
}

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
  const map = {
    bangkok:    'Bangkok',
    chiang_mai: 'Chiang Mai',
    koh_chang:  'Koh Chang',
    melbourne:  'Melbourne',
    sydney:     'Sydney',
    brisbane:   'Brisbane',
    perth:      'Perth',
    adelaide:   'Adelaide',
    canberra:   'Canberra',
    hobart:     'Hobart',
  };
  return map[city] || (city ? escapeHTML(city.charAt(0).toUpperCase() + city.slice(1)) : '');
}

/* ── City-aware price currency ──────────────────────────────
   Returns '$' for Australian cities, '฿' for everything else.
   Used in card price badges and detail view price row.
   ────────────────────────────────────────────────────────── */
function priceCurrency(city) {
  const ausCities = ['melbourne', 'sydney', 'brisbane', 'perth', 'adelaide', 'canberra', 'hobart'];
  return ausCities.includes((city || '').toLowerCase()) ? '$' : '฿';
}

function cardHTML(r) {
  const openStatus = isOpenNow(r.opening_hours);
  const personal   = state.personalData.get(r.id) || {};

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

  const wishHTML = personal.is_wishlisted
    ? `<button class="wishlist-btn wishlist-btn--active" data-action="wishlist" data-id="${r.id}" aria-label="Remove from wishlist" aria-pressed="true">♥</button>`
    : `<button class="wishlist-btn" data-action="wishlist" data-id="${r.id}" aria-label="Add to wishlist" aria-pressed="false">♡</button>`;

  const visitedHTML = personal.is_visited
    ? `<span class="visited-marker visited-marker--visited" aria-label="You've visited">✓ Visited</span>`
    : '';

  const cityAbbrev = { bangkok: 'BKK', chiang_mai: 'CNX', koh_chang: 'KCH' };
  const cityCode = r.city ? (cityAbbrev[r.city] || cityLabel(r.city)) : '';
  const cityBadgeInStrip = cityCode ? `<span class="badge badge--city">${escapeHTML(cityCode)}</span>` : '';

  const openBadgeHTML = openLabel
    ? `<span class="open-indicator ${openClass}" aria-label="${openLabel}">${openLabel}</span>`
    : '';
  const overlaysHTML = `${cityBadgeInStrip}${wishHTML}${visitedHTML}`;
  const photoAreaHTML = photoStripHTML(r, openBadgeHTML, overlaysHTML);

  const cuisineTag = Array.isArray(r.cuisine_types) && r.cuisine_types.length
    ? `<span class="badge badge--cuisine">${escapeHTML(r.cuisine_types[0].replace(/_/g, ' '))}</span>` : '';
  const currency = priceCurrency(r.city);
  const priceTag = r.price_range
    ? `<span class="badge badge--price" aria-label="Price range ${r.price_range}">${currency.repeat(r.price_range)}</span>` : '';
  const michelinTag = r.michelin_stars > 0
    ? `<span class="badge badge--michelin">${'★'.repeat(r.michelin_stars)}</span>`
    : r.michelin_bib ? `<span class="badge badge--michelin">Bib</span>` : '';
  const halalTag = r.is_halal ? `<span class="badge badge--halal">Halal</span>` : '';
  const cityTag  = r.city ? `<span class="badge ${cityBadgeClass(r.city)}">${cityLabel(r.city)}</span>` : '';

  const precision = r.location_precision || 'no_location';
  let distanceText = '';
  if (precision === 'area_only') {
    const areaName = r.area ? r.area.replace(/_/g, ' ') : null;
    distanceText = areaName ? `<span class="card__distance card__distance--area-only">${escapeHTML(areaName)}</span>` : '';
  } else if (precision === 'no_location') {
    distanceText = `<span class="card__distance">Find locally</span>`;
  } else {
    const fd = formatDistance(r._distanceMetres, precision);
    if (fd) {
      const cls = precision === 'approximate' ? 'card__distance card__distance--approximate' : 'card__distance';
      distanceText = `<span class="${cls}">${fd}</span>`;
    }
  }

  return `
<article class="card" role="listitem" data-id="${r.id}" aria-label="${escapeHTML(r.name_en || r.name_th)}">
  ${photoAreaHTML}
  <div class="card__body">
    <h2 class="card__name-thai">${escapeHTML(r.name_th || r.name_en)}</h2>
    ${r.name_en && r.name_th ? `<p class="card__name-english">${escapeHTML(r.name_en)}</p>` : ''}
    ${r.tagline ? `<p class="card__tagline">${escapeHTML(r.tagline)}</p>` : ''}
    <div class="card__meta">${cuisineTag}${priceTag}${distanceText}${michelinTag}${halalTag}${cityTag}</div>
    ${r.area ? `<p class="card__location">${escapeHTML(r.area.replace(/_/g, ' '))}</p>` : ''}
    ${dishesPreviewHTML(r.dishes)}
    ${starRatingHTML(state.personalData.get(r.id)?.my_rating, r.id, false)}
    <div class="card__actions">
      <button class="directions-btn" data-action="directions" data-restaurant-id="${r.id}" aria-label="Directions to ${escapeHTML(r.name_en || r.name_th)}">Directions</button>
    </div>
  </div>
</article>`;
}
