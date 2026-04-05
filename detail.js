/* ============================================================
   THAILAND FOOD GUIDE — detail.js
   Restaurant detail page (editorial redesign)
   ============================================================ */

'use strict';

import { db } from './config.js';
import { state, dom } from './state.js';
import { escapeHTML, isOpenNow, formatDistance, formatDayHours, todayHoursText, cityLabel, showToast } from './utils.js';
import { selectMapPin } from './map.js';
import { upsertPersonalData } from './data.js';

/* ── Navigation destination ───────────────────────────────── */

function resolveNavDestination(restaurant) {
  const p = restaurant.location_precision;
  if ((p === 'exact' || p === 'approximate') && restaurant.lat && restaurant.lng) {
    return { lat: restaurant.lat, lng: restaurant.lng, isApproximate: p === 'approximate', label: p === 'approximate' ? 'Location approximate' : null };
  }
  if (restaurant.landmark_latitude && restaurant.landmark_longitude) {
    return { lat: restaurant.landmark_latitude, lng: restaurant.landmark_longitude, isApproximate: true, label: 'Navigate to nearby landmark' };
  }
  return null;
}

/* ── Navigation URLs ────────────────────────────────────── */

function navUrls(restaurant) {
  const dest = resolveNavDestination(restaurant);
  let apple = null, google = null, streetView = null;
  if (dest && dest.lat && dest.lng) {
    apple  = 'maps://maps.apple.com/?daddr=' + dest.lat + ',' + dest.lng + '&dirflg=w';
    google = 'https://www.google.com/maps/dir/?api=1&destination=' + dest.lat + ',' + dest.lng + '&travelmode=walking';
    if (restaurant.location_precision === 'exact') {
      streetView = 'https://maps.google.com/?layer=c&cbll=' + dest.lat + ',' + dest.lng;
    }
  } else {
    const name = encodeURIComponent(restaurant.name_th || restaurant.name_en || '');
    apple  = 'maps://maps.apple.com/?q=' + name;
    google = 'https://www.google.com/maps/search/?api=1&query=' + name;
  }
  return { apple, google, streetView };
}

/* ── Format phone number ───────────────────────────────── */

function formatPhone(raw) {
  if (!raw) return '';
  const clean = raw.replace(/\s+/g, '');
  const thaiMatch = clean.replace(/^\+66/, '0').match(/^(0\d{1,2})(\d{3,4})(\d{4})$/);
  if (thaiMatch) return thaiMatch[1] + '-' + thaiMatch[2] + '-' + thaiMatch[3];
  const auMatch = clean.match(/^(\(?0\d\)?)(\d{4})(\d{4})$/);
  if (auMatch) return auMatch[1] + ' ' + auMatch[2] + ' ' + auMatch[3];
  return clean;
}

/* ── Editorial status line: Open · closes 21:30 · 330m · ฿฿ ── */

function statusLineHTML(restaurant) {
  const parts = [];

  // Open / closed state
  const openStatus = isOpenNow(restaurant.opening_hours);
  const todayText = todayHoursText(restaurant.opening_hours);
  if (openStatus === 'open' || openStatus === 'closes_soon') {
    // Try to extract closing time from today's hours string
    let closeText = 'Open';
    if (todayText && /\d/.test(todayText)) {
      const match = todayText.match(/[-–—]\s*(\d{1,2}[:.]\d{2})/);
      if (match) closeText = 'Open · closes ' + match[1].replace('.', ':');
      else closeText = 'Open · ' + todayText;
    }
    parts.push('<span style="color:#7FB685;font-weight:500;">' + escapeHTML(closeText) + '</span>');
  } else if (openStatus === 'closed') {
    parts.push('<span style="color:#B8867A;font-weight:500;">Closed</span>');
  } else if (todayText) {
    parts.push('<span style="color:#A8957C;">' + escapeHTML(todayText) + '</span>');
  }

  // Distance
  const p = restaurant.location_precision || 'no_location';
  if (p === 'area_only' && restaurant.area) {
    parts.push('<span style="color:#A8957C;">' + escapeHTML(restaurant.area.replace(/_/g, ' ')) + '</span>');
  } else if (p !== 'no_location') {
    const fd = formatDistance(restaurant._distanceMetres, p);
    if (fd) parts.push('<span style="color:#A8957C;">' + (p === 'approximate' ? '~' : '') + escapeHTML(fd) + '</span>');
  }

  // Price
  if (restaurant.price_range) {
    parts.push('<span style="color:#C9A84C;font-weight:500;">' + '\u0E3F'.repeat(restaurant.price_range) + '</span>');
  }

  if (parts.length === 0) return '';
  return '<div style="padding:0 16px;font-size:14px;line-height:1.4;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">'
    + parts.join('<span style="color:#3A342B;">·</span>')
    + '</div>';
}

/* ── Address line (street address, readable muted text) ────── */

function addressLineHTML(restaurant) {
  if (!restaurant.address_en) return '';
  return '<div style="padding:0 16px;font-size:14px;color:#8A7F6F;line-height:1.4;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">'
    + escapeHTML(restaurant.address_en)
    + '</div>';
}

/* ── Big Directions CTA button ─────────────────────────── */

function directionsCTAHTML(restaurant) {
  const dest = resolveNavDestination(restaurant);
  const approxNote = dest?.isApproximate
    ? '<p style="font-size:11px;color:#6B5F52;font-style:italic;margin:6px 0 0;text-align:center;">' + escapeHTML(dest.label || 'Location approximate') + '</p>'
    : '';
  return '<div style="padding:0 16px;">'
    + '<button type="button" id="detail-directions-btn" data-action="directions" data-id="' + restaurant.id + '" '
    + 'style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:52px;padding:14px 18px;'
    + 'background:#C9A84C;color:#0E0E0E;border:none;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer;'
    + 'font-family:inherit;-webkit-tap-highlight-color:transparent;">'
    + '<span style="font-size:18px;">\u27A4</span> Directions'
    + '</button>'
    + approxNote
    + '</div>';
}

/* ── Accordion block ─────────────────────────────────────── */

function accordionHTML(id, label, bodyHTML) {
  if (!bodyHTML) return '';
  return '<details class="detail-accordion" style="padding:0 16px;border-top:1px solid rgba(255,255,255,0.06);margin-top:0;">'
    + '<summary style="display:flex;justify-content:space-between;align-items:center;padding:14px 0;cursor:pointer;list-style:none;-webkit-tap-highlight-color:transparent;">'
    + '<span style="font-size:13px;font-weight:600;color:#A8957C;text-transform:uppercase;letter-spacing:0.05em;">' + escapeHTML(label) + '</span>'
    + '<span class="detail-accordion__chevron" style="color:#6B5F52;font-size:14px;transition:transform 0.2s;">\u25BE</span>'
    + '</summary>'
    + '<div style="padding:0 0 14px;">' + bodyHTML + '</div>'
    + '</details>';
}

function hoursBodyHTML(restaurant) {
  if (!restaurant.opening_hours) return '';
  const days = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  const rows = Object.entries(days).map(([k, label]) =>
    '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:14px;">'
    + '<span style="color:#A8957C;">' + label + '</span>'
    + '<span style="color:#EAE2D2;">' + escapeHTML(formatDayHours(restaurant.opening_hours[k])) + '</span>'
    + '</div>'
  ).join('');
  return rows;
}

function contactBodyHTML(restaurant) {
  const rows = [];
  if (restaurant.phone) {
    const raw = restaurant.phone.replace(/\s+/g, '');
    rows.push('<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:14px;">'
      + '<span style="color:#A8957C;">Phone</span>'
      + '<a href="tel:' + encodeURI(raw) + '" style="color:#C9A84C;text-decoration:none;">' + escapeHTML(formatPhone(restaurant.phone)) + '</a>'
      + '</div>');
  }
  if (restaurant.website) {
    let displayUrl = restaurant.website;
    try { displayUrl = new URL(restaurant.website).hostname.replace(/^www\./, ''); } catch {}
    rows.push('<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:14px;gap:12px;">'
      + '<span style="color:#A8957C;flex-shrink:0;">Website</span>'
      + '<a href="' + escapeHTML(restaurant.website) + '" target="_blank" rel="noopener noreferrer" style="color:#C9A84C;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHTML(displayUrl) + '</a>'
      + '</div>');
  }
  return rows.join('');
}

function addressBodyHTML(restaurant) {
  const bits = [];
  if (restaurant.nearby_landmark_en) {
    bits.push('<p style="font-size:13px;color:#A8957C;line-height:1.4;margin:0;">Near: ' + escapeHTML(restaurant.nearby_landmark_en) + '</p>');
  }
  if (restaurant.cart_identifier || restaurant.location_notes) {
    const p = restaurant.location_precision;
    if (!p || p === 'no_location' || p === 'area_only') {
      bits.push('<div style="margin-top:10px;padding:12px 14px;background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.2);border-radius:10px;">'
        + '<div style="font-size:11px;font-weight:600;color:#C9A84C;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">How to find it</div>'
        + (restaurant.cart_identifier ? '<div style="font-size:14px;color:#EAE2D2;line-height:1.4;">' + escapeHTML(restaurant.cart_identifier) + '</div>' : '')
        + (restaurant.location_notes ? '<div style="font-size:13px;color:#A8957C;line-height:1.4;margin-top:4px;">' + escapeHTML(restaurant.location_notes) + '</div>' : '')
        + '</div>');
    }
  }
  return bits.join('');
}

/* ── Dishes detail ──────────────────────────────────────────── */

function dishesDetailHTML(dishes) {
  if (!dishes || !Array.isArray(dishes) || dishes.length === 0) return '';
  const items = dishes.map(d => {
    return '<div class="dish-item ' + (d.is_signature ? 'dish-item--signature' : '') + '">'
      + (d.name_th ? '<span class="dish-item__name-th">' + escapeHTML(d.name_th) + '</span>' : '')
      + (d.name_en ? '<span class="dish-item__name-en">' + escapeHTML(d.name_en) + '</span>' : '')
      + (d.price_approx ? '<span class="dish-item__price">\u0E3F' + escapeHTML(String(d.price_approx)) + '</span>' : '')
      + (d.notes ? '<p class="dish-item__notes">' + escapeHTML(d.notes) + '</p>' : '')
      + (d.is_signature ? '<span class="dish-item__badge">Signature</span>' : '')
      + '</div>';
  }).join('');
  return '<section class="dishes-section"><h3 class="dishes-section__heading">Known for</h3>' + items + '</section>';
}

/* ── Specialities ───────────────────────────────────────────── */

function specialitiesHTML(specialities) {
  if (!specialities || !Array.isArray(specialities) || specialities.length === 0) return '';
  const chips = specialities.map(s => {
    const label = s.replace(/_/g, ' ');
    return '<span style="display:inline-block;padding:4px 10px;background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.3);border-radius:20px;font-size:13px;color:#C9A84C;font-weight:500;white-space:nowrap;">' + escapeHTML(label) + '</span>';
  }).join('');
  return '<div style="display:flex;flex-wrap:wrap;gap:6px;padding:0 16px;">' + chips + '</div>';
}

/* ── Ratings row ────────────────────────────────────────────── */

function ratingsHTML(restaurant) {
  const items = [];
  if (restaurant.google_rating) {
    const count = restaurant.google_review_count ? ' (' + restaurant.google_review_count + ')' : '';
    items.push('<span style="display:inline-flex;align-items:center;gap:4px;font-size:13px;color:#A8957C;"><span style="color:#FBBC04;">\u2605</span> ' + restaurant.google_rating + count + ' Google</span>');
  }
  if (restaurant.tripadvisor_rating) {
    const count = restaurant.tripadvisor_review_count ? ' (' + restaurant.tripadvisor_review_count + ')' : '';
    items.push('<span style="display:inline-flex;align-items:center;gap:4px;font-size:13px;color:#A8957C;"><span style="color:#34E0A1;">\u25CF</span> ' + restaurant.tripadvisor_rating + count + ' TripAdvisor</span>');
  }
  if (restaurant.wongnai_rating) {
    items.push('<span style="display:inline-flex;align-items:center;gap:4px;font-size:13px;color:#A8957C;"><span style="color:#ED1C24;">\u25CF</span> ' + restaurant.wongnai_rating + ' Wongnai</span>');
  }
  if (items.length === 0) return '';
  return '<div style="display:flex;flex-wrap:wrap;gap:12px;padding:0 16px;">' + items.join('') + '</div>';
}

/* ── Dietary badges ─────────────────────────────────────────── */

function dietaryBadgesHTML(restaurant) {
  const badges = [];
  if (restaurant.is_halal) {
    badges.push('<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:rgba(46,139,87,0.15);border:1px solid rgba(46,139,87,0.4);border-radius:20px;font-size:12px;color:#2E8B57;font-weight:600;">\u262A Halal</span>');
  }
  if (restaurant.is_vegetarian_friendly) {
    badges.push('<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:rgba(76,175,80,0.15);border:1px solid rgba(76,175,80,0.4);border-radius:20px;font-size:12px;color:#4CAF50;font-weight:600;">\uD83C\uDF3F Vegetarian friendly</span>');
  }
  if (badges.length === 0) return '';
  return '<div style="display:flex;flex-wrap:wrap;gap:6px;padding:0 16px;">' + badges.join('') + '</div>';
}

/* ── Source attribution ─────────────────────────────────────── */

function sourceAttributionHTML(restaurant) {
  if (!restaurant.source_quote_th) return '';
  return '<div class="source-attribution"><p class="source-attribution__quote">"' + escapeHTML(restaurant.source_quote_th) + '"</p></div>';
}

/* ── Extract clean source name from URL ────────────────────── */

function extractSourceName(url, fallbackName) {
  if (fallbackName && fallbackName !== 'Other Editorial' && fallbackName !== 'other_editorial' && fallbackName !== 'Other') {
    return fallbackName;
  }
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    const cleaned = hostname
      .replace(/\.com\.au$/, '').replace(/\.co\.th$/, '').replace(/\.co\.uk$/, '')
      .replace(/\.com$/, '').replace(/\.org$/, '').replace(/\.net$/, '')
      .replace(/\.io$/, '').replace(/\.au$/, '').replace(/\.th$/, '');
    if (cleaned) return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    return hostname;
  } catch {
    return fallbackName || 'Review';
  }
}

/* ── Review chips (2-col compact) ──────────────────────────── */

async function reviewLinksHTML(restaurantId, restaurantName) {
  const { data: sources, error } = await db
    .from('restaurant_sources')
    .select('url, excerpt, language, source_tier, rating_score, sources(name)')
    .eq('restaurant_id', restaurantId)
    .not('url', 'is', null)
    .order('language')
    .limit(10);

  if (error || !sources || sources.length === 0) return '';

  const chipStyle = 'display:flex;align-items:center;justify-content:center;gap:4px;padding:8px 10px;background:#1a1a1a;border:1px solid rgba(255,255,255,0.08);border-radius:10px;font-size:12px;font-weight:500;color:#EAE2D2;text-decoration:none;text-align:center;-webkit-tap-highlight-color:transparent;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

  const blocks = sources.map(s => {
    const label = extractSourceName(s.url, s.sources?.name);
    const rating = s.rating_score ? ' \u2605' + s.rating_score : '';
    return '<a href="' + escapeHTML(s.url) + '" style="' + chipStyle + '" target="_blank" rel="noopener noreferrer">' + escapeHTML(label) + rating + '</a>';
  }).join('');

  return '<div style="padding:0 16px;">'
    + '<h3 style="font-size:11px;font-weight:600;color:#6B5F52;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 8px;">Reviews</h3>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">' + blocks + '</div>'
    + '</div>';
}

/* ── Navigation choice sheet ─────────────────────────────── */

function showNavChoiceSheet(restaurant) {
  const urls = navUrls(restaurant);
  const dest = resolveNavDestination(restaurant);
  const approxLabel = dest?.isApproximate
    ? '<p style="font-size:13px;color:#A8957C;font-style:italic;text-align:center;margin-bottom:8px;">' + escapeHTML(dest.label || 'Location approximate') + '</p>'
    : '';

  const overlay = dom.navChoiceOverlay || document.getElementById('nav-choice-overlay');
  const sheet   = dom.navChoiceSheet   || document.getElementById('nav-choice-sheet');
  if (!overlay || !sheet) {
    window.location.href = urls.apple;
    return;
  }

  const btnStyle = 'display:flex;align-items:center;gap:10px;width:100%;padding:16px;background:rgba(255,255,255,0.06);border:none;border-radius:12px;color:#EAE2D2;font-size:17px;font-weight:500;text-decoration:none;-webkit-tap-highlight-color:transparent;';

  sheet.innerHTML = approxLabel
    + '<p style="font-size:15px;font-weight:600;color:#A8957C;text-align:center;margin-bottom:12px;">Open with</p>'
    + '<a href="' + urls.apple + '" style="' + btnStyle + '"><span>\uD83D\uDDFA</span> Apple Maps</a>'
    + '<a href="' + urls.google + '" style="' + btnStyle + 'margin-top:8px;" target="_blank" rel="noopener"><span>\uD83D\uDCCD</span> Google Maps</a>'
    + (urls.streetView ? '<a href="' + urls.streetView + '" style="' + btnStyle + 'margin-top:8px;" target="_blank" rel="noopener"><span>\uD83D\uDCF7</span> Street View</a>' : '')
    + '<button id="nav-choice-cancel" style="display:block;width:100%;padding:14px;margin-top:12px;background:none;border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#A8957C;font-size:15px;cursor:pointer;">Cancel</button>';

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

/* ── Open detail ────────────────────────────────────────────── */

function openDetail(id) {
  const r = state.restaurants.find(r => r.id === id);
  if (!r) return;
  const key = r.slug || String(r.id);
  window.location.hash = '#restaurant/' + encodeURIComponent(key);
}

/* ── Render detail page ────────────────────────────────────── */

function renderDetailPage(r) {
  state.selectedId = r.id;
  if (state.activeView === 'map') selectMapPin(r.id);

  dom.detailTitle.textContent = r.name_en || r.name_th || '';

  const personal   = state.personalData.get(r.id) || {};
  const openStatus = isOpenNow(r.opening_hours);

  // Open/closed dot
  const dotClass = (openStatus === 'open' || openStatus === 'closes_soon') ? 'card-dot--open'
                 : openStatus === 'closed' ? 'card-dot--closed'
                 : 'card-dot--unknown';

  // Names
  const displayName = r.name_en || r.name_th || '';
  const subName = (r.name_th && r.name_en && r.name_th !== r.name_en) ? r.name_th : '';

  // Wishlist heart
  const wishHTML = personal.is_wishlisted
    ? '<button class="detail__heart detail__heart--active" data-action="wishlist" data-id="' + r.id + '" aria-label="Remove from wishlist" aria-pressed="true">\u2665</button>'
    : '<button class="detail__heart" data-action="wishlist" data-id="' + r.id + '" aria-label="Add to wishlist" aria-pressed="false">\u2661</button>';

  // Michelin
  const michelinHTML = r.michelin_stars > 0
    ? '<div style="padding:0 16px;"><span class="detail__michelin">' + '\u2605'.repeat(r.michelin_stars) + ' Michelin Star' + (r.michelin_stars > 1 ? 's' : '') + '</span></div>'
    : r.michelin_bib ? '<div style="padding:0 16px;"><span class="detail__michelin">Bib Gourmand</span></div>' : '';

  // Tagline
  const taglineHTML = r.tagline
    ? '<p style="padding:0 16px;font-size:15px;color:#A8957C;font-style:italic;line-height:1.5;margin:0;">' + escapeHTML(r.tagline) + '</p>'
    : '';

  // Description (150-word editorial body)
  const descriptionHTML = r.description_en
    ? '<p style="padding:0 16px;font-size:16px;color:#EAE2D2;line-height:1.6;margin:0;">' + escapeHTML(r.description_en) + '</p>'
    : '';

  // Editorial header
  const editorialHeaderHTML = '<div style="padding:18px 16px 0;">'
    + '<div style="display:flex;align-items:flex-start;gap:10px;">'
    + '<span class="card-dot ' + dotClass + '" style="margin-top:10px;flex-shrink:0;"></span>'
    + '<h2 style="flex:1;font-size:26px;font-weight:700;color:#EAE2D2;line-height:1.2;margin:0;letter-spacing:-0.01em;">' + escapeHTML(displayName) + '</h2>'
    + wishHTML
    + '</div>'
    + (subName ? '<div style="padding-left:18px;font-size:14px;color:#6B5F52;font-style:italic;margin-top:2px;">' + escapeHTML(subName) + '</div>' : '')
    + (r.legacy_note ? '<div style="padding-left:18px;font-size:12px;color:#6B5F52;margin-top:2px;">' + escapeHTML(r.legacy_note) + '</div>' : '')
    + '</div>';

  const addressLine = addressLineHTML(r);
  const statusLine = statusLineHTML(r);

  dom.detailBody.innerHTML = '<div class="detail-body__inner" style="padding-bottom:24px;">'
    // Editorial header
    + editorialHeaderHTML
    // Address (street address, muted readable text)
    + (addressLine ? '<div style="margin-top:4px;">' + addressLine + '</div>' : '')
    // Status line: open · closes · distance · price
    + (statusLine ? '<div style="margin-top:2px;">' + statusLine + '</div>' : '')
    // Primary CTA
    + '<div style="margin-top:16px;">' + directionsCTAHTML(r) + '</div>'
    // Description (150-word editorial body)
    + (descriptionHTML ? '<div style="margin-top:16px;">' + descriptionHTML + '</div>' : '')
    // Tagline (if present)
    + (taglineHTML ? '<div style="margin-top:10px;">' + taglineHTML + '</div>' : '')
    // Review chips
    + '<div id="review-links-placeholder" style="margin-top:18px;"></div>'
    // Michelin / dietary / ratings
    + (michelinHTML ? '<div style="margin-top:14px;">' + michelinHTML + '</div>' : '')
    + (dietaryBadgesHTML(r) ? '<div style="margin-top:10px;">' + dietaryBadgesHTML(r) + '</div>' : '')
    + (ratingsHTML(r) ? '<div style="margin-top:10px;">' + ratingsHTML(r) + '</div>' : '')
    // Specialities
    + (specialitiesHTML(r.specialities) ? '<div style="margin-top:14px;">' + specialitiesHTML(r.specialities) + '</div>' : '')
    // Dishes detail
    + (dishesDetailHTML(r.dishes) ? '<div style="margin-top:14px;">' + dishesDetailHTML(r.dishes) + '</div>' : '')
    // Accordions
    + '<div style="margin-top:18px;">'
    + accordionHTML('hours', 'Hours', hoursBodyHTML(r))
    + accordionHTML('contact', 'Contact', contactBodyHTML(r))
    + accordionHTML('address', 'Address', addressBodyHTML(r))
    + '</div>'
    // Source attribution
    + sourceAttributionHTML(r)
    + '</div>';

  dom.app.classList.add('app-shell--detail');
  dom.viewDetail.classList.add('view-detail--active');
  dom.viewDetail.removeAttribute('aria-hidden');
  dom.detailBody.scrollTop = 0;

  // Wire up Directions button → existing nav choice sheet
  const dirBtn = document.getElementById('detail-directions-btn');
  if (dirBtn) {
    dirBtn.addEventListener('click', () => showNavChoiceSheet(r));
  }

  // Async: review chips
  reviewLinksHTML(r.id, r.name_en || r.name_th || '').then(html => {
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

export {
  openDetail,
  renderDetailPage,
  hideDetailPage,
  showNavChoiceSheet,
  resolveNavDestination,
};
