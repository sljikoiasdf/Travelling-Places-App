/* ============================================================
   THAILAND FOOD GUIDE — cards.js
   Compact card HTML for list view with restored features
   ============================================================ */

'use strict';

import { state } from './state.js';
import { escapeHTML, isOpenNow, formatDistance } from './utils.js';

/* ── Dishes preview (restored from monolith) ─────────────── */

function dishesPreviewHTML(dishes) {
  if (!dishes || !Array.isArray(dishes) || dishes.length === 0) return '';
  const sorted = [...dishes].sort((a, b) => (b.is_signature ? 1 : 0) - (a.is_signature ? 1 : 0));
  const shown = sorted.slice(0, 2).map(d => d.name_th || d.name_en || '').filter(Boolean);
  if (shown.length === 0) return '';
  return '<div style="font-size:12px;color:#A8957C;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'
    + '<span style="font-weight:600;color:#C9A84C;">Must order:</span> '
    + escapeHTML(shown.join(' \u00b7 '))
    + '</div>';
}

/* ── Star rating (read-only, restored from monolith) ──────── */

function starRatingHTML(rating) {
  if (!rating || rating === 0) return '';
  const stars = [1, 2, 3, 4, 5].map(n => {
    const filled = n <= rating;
    return '<span style="font-size:12px;color:' + (filled ? '#C9A84C' : '#4A4440') + ';">\u2605</span>';
  }).join('');
  return '<div style="display:inline-flex;align-items:center;gap:1px;margin-top:2px;">' + stars + '</div>';
}

/* ── Compact card ───────────────────────────────────────────── */

function cardHTML(r) {
  const openStatus = isOpenNow(r.opening_hours);
  const personal   = state.personalData.get(r.id) || {};

  const dotClass = (openStatus === 'open' || openStatus === 'closes_soon') ? 'card-dot--open'
                 : openStatus === 'closed' ? 'card-dot--closed'
                 : 'card-dot--unknown';

  // Wishlist heart
  const wishHTML = personal.is_wishlisted
    ? '<button class="card__heart card__heart--active" data-action="wishlist" data-id="' + r.id + '" aria-label="Remove from wishlist" aria-pressed="true">\u2665</button>'
    : '<button class="card__heart" data-action="wishlist" data-id="' + r.id + '" aria-label="Add to wishlist" aria-pressed="false">\u2661</button>';

  // Visited marker
  const visitedHTML = personal.is_visited
    ? '<span style="font-size:11px;color:#4CAF50;font-weight:600;margin-left:6px;">\u2713 Visited</span>'
    : '';

  // Name
  const displayName = r.name_en || r.name_th || '';
  const subName = (r.name_th && r.name_en && r.name_th !== r.name_en) ? r.name_th : '';

  // Thumbnail
  const photos = Array.isArray(r.photos) ? r.photos : [];
  const idPhoto = r.identification_photo_url;
  const primaryPhoto = idPhoto || (photos.find(p => p.is_primary) || photos[0])?.url;
  const thumbHTML = primaryPhoto
    ? '<div class="card-compact__thumb"><img src="' + escapeHTML(primaryPhoto) + '" alt="" loading="lazy" decoding="async"></div>'
    : '<div class="card-compact__thumb card-compact__thumb--empty"></div>';

  // Meta: cuisine \u00b7 price \u00b7 distance
  const cuisine = Array.isArray(r.cuisine_types) && r.cuisine_types.length
    ? r.cuisine_types[0].replace(/_/g, ' ') : '';
  const price = r.price_range ? '\u0E3F'.repeat(r.price_range) : '';
  const metaParts = [cuisine, price].filter(Boolean);

  const precision = r.location_precision || 'no_location';
  let dist = '';
  if (precision === 'area_only' && r.area) {
    dist = r.area.replace(/_/g, ' ');
  } else if (precision !== 'no_location') {
    const fd = formatDistance(r._distanceMetres, precision);
    if (fd) dist = (precision === 'approximate' ? '~' : '') + fd;
  }
  if (dist) metaParts.push(dist);

  const metaHTML = metaParts.length ? '<span class="card-compact__meta">' + escapeHTML(metaParts.join(' \u00b7 ')) + '</span>' : '';

  // Michelin badge
  const michelinHTML = r.michelin_stars > 0
    ? '<span class="card-compact__michelin">' + '\u2605'.repeat(r.michelin_stars) + '</span>'
    : r.michelin_bib ? '<span class="card-compact__michelin">Bib</span>' : '';

  // Dishes preview
  const dishesHTML = dishesPreviewHTML(r.dishes);

  // Star rating (read-only)
  const myRating = personal.my_rating;
  const ratingHTML = starRatingHTML(myRating);

  // Directions button
  const directionsHTML = '<button style="display:inline-flex;align-items:center;gap:4px;padding:6px 12px;background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.3);border-radius:8px;color:#C9A84C;font-size:12px;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;margin-top:4px;" data-action="directions" data-restaurant-id="' + r.id + '" aria-label="Directions to ' + escapeHTML(displayName) + '">Directions</button>';

  return '\n<article class="card-compact" role="listitem" data-id="' + r.id + '" aria-label="' + escapeHTML(displayName) + '">'
    + thumbHTML
    + '<div class="card-compact__body">'
    + '<div class="card-compact__top">'
    + '<span class="card-dot ' + dotClass + '"></span>'
    + '<h2 class="card-compact__name">' + escapeHTML(displayName) + '</h2>'
    + michelinHTML
    + visitedHTML
    + wishHTML
    + '</div>'
    + (subName ? '<span class="card-compact__subname">' + escapeHTML(subName) + '</span>' : '')
    + metaHTML
    + dishesHTML
    + ratingHTML
    + directionsHTML
    + '</div>'
    + '</article>';
}

export { cardHTML };
