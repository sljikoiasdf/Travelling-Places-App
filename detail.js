/* ============================================================
   THAILAND FOOD GUIDE — detail.js
   Restaurant detail page — redesigned
   KILLED: visited button, star ratings, personal notes
   ============================================================ */

'use strict';

import { db } from './config.js';
import { state, dom } from './state.js';
import { escapeHTML, isOpenNow, formatDistance, formatDayHours, todayHoursText, cityLabel } from './utils.js';
import { selectMapPin } from './map.js';

/* ── Navigation destination ─────────────────────────────────── */

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

/* ── Navigation URLs ────────────────────────────────────────── */

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

/* ── Dishes detail ──────────────────────────────────────────── */

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

/* ── Specialities ───────────────────────────────────────────── */

function specialitiesHTML(specialities) {
  if (!specialities || !Array.isArray(specialities) || specialities.length === 0) return '';
  const chips = specialities.map(s => {
    const label = s.replace(/_/g, ' ');
    return `<span style="display:inline-block;padding:4px 10px;background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.3);border-radius:20px;font-size:13px;color:#C9A84C;font-weight:500;white-space:nowrap;">${escapeHTML(label)}</span>`;
  }).join('');
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;padding:0 16px;">${chips}</div>`;
}

/* ── Ratings row ────────────────────────────────────────────── */

function ratingsHTML(restaurant) {
  const items = [];

  if (restaurant.google_rating) {
    const count = restaurant.google_review_count ? ` (${restaurant.google_review_count})` : '';
    items.push(`<span style="display:inline-flex;align-items:center;gap:4px;font-size:13px;color:#A8957C;"><span style="color:#FBBC04;">★</span> ${restaurant.google_rating}${count} Google</span>`);
  }

  if (restaurant.tripadvisor_rating) {
    const count = restaurant.tripadvisor_review_count ? ` (${restaurant.tripadvisor_review_count})` : '';
    items.push(`<span style="display:inline-flex;align-items:center;gap:4px;font-size:13px;color:#A8957C;"><span style="color:#34E0A1;">●</span> ${restaurant.tripadvisor_rating}${count} TripAdvisor</span>`);
  }

  if (restaurant.wongnai_rating) {
    items.push(`<span style="display:inline-flex;align-items:center;gap:4px;font-size:13px;color:#A8957C;"><span style="color:#ED1C24;">●</span> ${restaurant.wongnai_rating} Wongnai</span>`);
  }

  if (items.length === 0) return '';
  return `<div style="display:flex;flex-wrap:wrap;gap:12px;padding:0 16px;">${items.join('')}</div>`;
}

/* ── Dietary badges ─────────────────────────────────────────── */

function dietaryBadgesHTML(restaurant) {
  const badges = [];
  if (restaurant.is_halal) {
    badges.push(`<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:rgba(46,139,87,0.15);border:1px solid rgba(46,139,87,0.4);border-radius:20px;font-size:12px;color:#2E8B57;font-weight:600;">☪ Halal</span>`);
  }
  if (restaurant.is_vegetarian_friendly) {
    badges.push(`<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:rgba(76,175,80,0.15);border:1px solid rgba(76,175,80,0.4);border-radius:20px;font-size:12px;color:#4CAF50;font-weight:600;">🌿 Vegetarian friendly</span>`);
  }
  if (badges.length === 0) return '';
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;padding:0 16px;">${badges.join('')}</div>`;
}

/* ── Source attribution ─────────────────────────────────────── */

function sourceAttributionHTML(restaurant) {
  if (!restaurant.source_quote_th) return '';
  return `<div class="source-attribution">
    <p class="source-attribution__quote">"${escapeHTML(restaurant.source_quote_th)}"</p>
  </div>`;
}

/* ── Review links (async) ───────────────────────────────────── */

async function reviewLinksHTML(restaurantId) {
  const { data: sources, error } = await db
    .from('restaurant_sources')
    .select('url, excerpt, language, source_tier, rating_score, sources(name)')
    .eq('restaurant_id', restaurantId)
    .not('url', 'is', null)
    .order('language')
    .limit(10);

  if (error || !sources || sources.length === 0) return '';

  return `<div style="padding:0 16px;display:flex;flex-direction:column;gap:8px;">
    <h3 style="font-size:13px;font-weight:600;color:#6B5F52;text-transform:uppercase;letter-spacing:0.08em;">Sources &amp; Reviews</h3>
    ${sources.map(s => {
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
    }).join('')}
  </div>`;
}

/* ── Contact row ────────────────────────────────────────────── */

function contactRowHTML(restaurant) {
  const items = [];

  if (restaurant.phone) {
    const raw = restaurant.phone.replace(/\s+/g, '');
    let display = raw;
    const thaiMatch = raw.replace(/^\+66/, '0').match(/^(0\d{1,2})(\d{3,4})(\d{4})$/);
    if (thaiMatch) display = `${thaiMatch[1]}-${thaiMatch[2]}-${thaiMatch[3]}`;
    items.push(`<a class="contact-link contact-link--phone" href="tel:${encodeURI(raw)}">📞 ${escapeHTML(display)}</a>`);
  }

  if (restaurant.website) {
    items.push(`<a class="contact-link" href="${escapeHTML(restaurant.website)}" target="_blank" rel="noopener noreferrer">🌐 Website</a>`);
  }

  if (restaurant.line_id) {
    items.push(`<span class="contact-link">LINE: ${escapeHTML(restaurant.line_id)}</span>`);
  }

  if (items.length === 0) return '';
  return `<div class="contact-row">${items.join('')}</div>`;
}

/* ── Directions buttons (Apple Maps + Google Maps side by side) ── */

function directionsButtonsHTML(restaurant) {
  const urls = navUrls(restaurant);
  const dest = resolveNavDestination(restaurant);

  const approxNote = dest?.isApproximate
    ? `<p style="font-size:12px;color:#6B5F52;font-style:italic;margin-bottom:8px;text-align:center;">${escapeHTML(dest.label || 'Location approximate')}</p>`
    : '';

  const btnBase = 'display:flex;align-items:center;justify-content:center;gap:6px;flex:1;padding:12px 8px;min-height:48px;border-radius:12px;font-size:15px;font-weight:600;text-decoration:none;transition:opacity 150ms;';

  const appleBtnStyle = `${btnBase}background:#C9A84C;color:#0E0E0E;`;
  const googleBtnStyle = `${btnBase}background:#222222;color:#EAE2D2;border:1px solid rgba(255,255,255,0.07);`;

  return `<div style="padding:0 16px;">
    ${approxNote}
    <div style="display:flex;gap:8px;">
      <a href="${urls.apple}" style="${appleBtnStyle}">🗺 Apple Maps</a>
      <a href="${urls.google}" style="${googleBtnStyle}" target="_blank" rel="noopener">📍 Google Maps</a>
    </div>
    ${urls.streetView ? `<a href="${urls.streetView}" style="display:flex;align-items:center;justify-content:center;gap:4px;margin-top:8px;padding:8px;font-size:13px;color:#A8957C;text-decoration:none;" target="_blank" rel="noopener">📷 Street View</a>` : ''}
  </div>`;
}

/* ── Open detail ────────────────────────────────────────────── */

function openDetail(id) {
  const r = state.restaurants.find(r => r.id === id);
  if (!r) return;
  const key = r.slug || String(r.id);
  window.location.hash = '#restaurant/' + encodeURIComponent(key);
}

/* ── Render detail page (REDESIGNED) ────────────────────────── */

function renderDetailPage(r) {
  state.selectedId = r.id;
  if (state.activeView === 'map') selectMapPin(r.id);

  dom.detailTitle.textContent = r.name_en || r.name_th || '';

  const personal   = state.personalData.get(r.id) || {};
  const openStatus = isOpenNow(r.opening_hours);

  // ── Photo ──
  const photos       = Array.isArray(r.photos) ? r.photos : [];
  const idPhoto      = r.identification_photo_url;
  const primaryPhoto = idPhoto || (photos.find(p => p.is_primary) || photos[0])?.url;
  const photoHTML    = primaryPhoto
    ? `<div class="detail-photo"><img src="${escapeHTML(primaryPhoto)}" alt="${escapeHTML(r.name_en || r.name_th)} photo" loading="eager" decoding="async"></div>`
    : '';

  // ── Open/closed dot (small, inline) ──
  const dotClass = (openStatus === 'open' || openStatus === 'closes_soon') ? 'card-dot--open'
                 : openStatus === 'closed' ? 'card-dot--closed'
                 : 'card-dot--unknown';

  // ── Names ──
  const displayName = r.name_en || r.name_th || '';
  const subName = (r.name_th && r.name_en && r.name_th !== r.name_en) ? r.name_th : '';

  // ── Address block ──
  const areaCity = [
    r.area ? r.area.replace(/_/g, ' ') : null,
    r.city ? cityLabel(r.city) : null
  ].filter(Boolean).join(', ');

  // ── Cuisine + price ──
  const cuisineDisplay = Array.isArray(r.cuisine_types)
    ? r.cuisine_types.map(c => c.replace(/_/g, ' ')).join(', ') : '';
  const priceDisplay = r.price_range ? '฿'.repeat(r.price_range) : '';
  const metaLine = [cuisineDisplay, priceDisplay].filter(Boolean).join(' \u00b7 ');

  // ── Today's hours (compact, expandable) ──
  const todayText = todayHoursText(r.opening_hours);
  const dayNames  = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  const fullHoursHTML = r.opening_hours
    ? Object.entries(dayNames).map(([key, label]) =>
        `<div class="detail-hours__row"><span class="detail-hours__day">${label}</span><span class="detail-hours__time">${formatDayHours(r.opening_hours[key])}</span></div>`
      ).join('')
    : '';

  // ── Michelin ──
  const michelinHTML = r.michelin_stars > 0
    ? `<span class="detail__michelin">${'\u2605'.repeat(r.michelin_stars)} Michelin Star${r.michelin_stars > 1 ? 's' : ''}</span>`
    : r.michelin_bib ? `<span class="detail__michelin">Bib Gourmand</span>` : '';

  // ── Wishlist heart (small icon only) ──
  const wishHTML = personal.is_wishlisted
    ? `<button class="detail__heart detail__heart--active" data-action="wishlist" data-id="${r.id}" aria-label="Remove from wishlist" aria-pressed="true">\u2665</button>`
    : `<button class="detail__heart" data-action="wishlist" data-id="${r.id}" aria-label="Add to wishlist" aria-pressed="false">\u2661</button>`;

  // ── Distance ──
  const detailPrecision = r.location_precision || 'no_location';
  let distText = '';
  if (detailPrecision === 'area_only' && r.area) {
    distText = r.area.replace(/_/g, ' ');
  } else if (detailPrecision !== 'no_location') {
    const fd = formatDistance(r._distanceMetres, detailPrecision);
    if (fd) distText = (detailPrecision === 'approximate' ? '~' : '') + fd;
  }

  // ── Address lines ──
  const addressLines = [];
  if (r.address_en) addressLines.push(escapeHTML(r.address_en));
  if (r.location_notes) addressLines.push(escapeHTML(r.location_notes));
  if (r.cart_identifier) addressLines.push(escapeHTML(r.cart_identifier));
  if (r.nearby_landmark_en) addressLines.push(`Near: ${escapeHTML(r.nearby_landmark_en)}`);

  // ── Tagline ──
  const taglineHTML = r.tagline
    ? `<p style="padding:0 16px;font-size:17px;color:#A8957C;font-style:italic;line-height:1.5;">${escapeHTML(r.tagline)}</p>`
    : '';

  // ── Description ──
  const descriptionHTML = r.description_en
    ? `<p style="padding:0 16px;font-size:16px;color:#EAE2D2;line-height:1.6;">${escapeHTML(r.description_en)}</p>`
    : '';

  dom.detailBody.innerHTML = `
    <div class="detail-body__inner">
      ${photoHTML}

      <div class="detail-header">
        <div class="detail-header__name-row">
          <span class="card-dot ${dotClass}"></span>
          <h2 class="detail-header__name">${escapeHTML(displayName)}</h2>
          ${wishHTML}
        </div>
        ${subName ? `<span class="detail-header__subname">${escapeHTML(subName)}</span>` : ''}
        ${r.legacy_note ? `<span class="detail-header__legacy">${escapeHTML(r.legacy_note)}</span>` : ''}
      </div>

      ${michelinHTML}

      ${taglineHTML}

      <div class="detail-address">
        ${areaCity ? `<span class="detail-address__area">${escapeHTML(areaCity)}</span>` : ''}
        ${addressLines.map(p => `<span class="detail-address__line">${p}</span>`).join('')}
        ${distText ? `<span class="detail-address__dist">${escapeHTML(distText)}</span>` : ''}
      </div>

      ${directionsButtonsHTML(r)}

      ${metaLine ? `<div class="detail-meta">${escapeHTML(metaLine)}</div>` : ''}

      ${ratingsHTML(r)}

      ${dietaryBadgesHTML(r)}

      <div class="detail-hours">
        ${todayText ? `<button class="detail-hours__today" aria-expanded="false">
          <span>Today: ${escapeHTML(todayText)}</span>
          <span class="detail-hours__chevron">\u25be</span>
        </button>` : ''}
        <div class="detail-hours__full" hidden>
          ${fullHoursHTML}
        </div>
      </div>

      ${descriptionHTML}

      ${dishesDetailHTML(r.dishes)}

      ${specialitiesHTML(r.specialities)}

      ${contactRowHTML(r)}

      ${sourceAttributionHTML(r)}
      <div id="review-links-placeholder"></div>
    </div>`;

  dom.app.classList.add('app-shell--detail');
  dom.viewDetail.classList.add('view-detail--active');
  dom.viewDetail.removeAttribute('aria-hidden');
  dom.detailBody.scrollTop = 0;

  // Expandable hours
  const todayBtn = dom.detailBody.querySelector('.detail-hours__today');
  const fullHours = dom.detailBody.querySelector('.detail-hours__full');
  if (todayBtn && fullHours) {
    todayBtn.addEventListener('click', () => {
      const expanded = todayBtn.getAttribute('aria-expanded') === 'true';
      todayBtn.setAttribute('aria-expanded', String(!expanded));
      fullHours.hidden = expanded;
    });
  }

  // Async: review links
  reviewLinksHTML(r.id).then(html => {
    const placeholder = document.getElementById('review-links-placeholder');
    if (placeholder && html) {
      placeholder.outerHTML = html;
    } else if (placeholder) {
      placeholder.remove();
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

/* showNavChoiceSheet kept as no-op export — events.js still imports it
   but the detail view now uses direct Apple/Google Maps <a> links instead */
function showNavChoiceSheet() {}

export {
  openDetail,
  renderDetailPage,
  hideDetailPage,
  showNavChoiceSheet,
  resolveNavDestination,
};
