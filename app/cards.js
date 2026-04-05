/* ============================================================
   THAILAND FOOD GUIDE — cards.js
   Compact card HTML for list view
   ============================================================ */

'use strict';

import { state } from './state.js';
import { escapeHTML, isOpenNow, formatDistance } from './utils.js';

/* ── Compact card ───────────────────────────────────────────── */

function cardHTML(r) {
  const openStatus = isOpenNow(r.opening_hours);
  const personal   = state.personalData.get(r.id) || {};

  const dotClass = (openStatus === 'open' || openStatus === 'closes_soon') ? 'card-dot--open'
                 : openStatus === 'closed' ? 'card-dot--closed'
                 : 'card-dot--unknown';

  // Wishlist heart
  const wishHTML = personal.is_wishlisted
    ? `<button class="card__heart card__heart--active" data-action="wishlist" data-id="${r.id}" aria-label="Remove from wishlist" aria-pressed="true">♥</button>`
    : `<button class="card__heart" data-action="wishlist" data-id="${r.id}" aria-label="Add to wishlist" aria-pressed="false">♡</button>`;

  // Name — no duplicate if Thai = English
  const displayName = r.name_en || r.name_th || '';
  const subName = (r.name_th && r.name_en && r.name_th !== r.name_en) ? r.name_th : '';

  // Thumbnail
  const photos = Array.isArray(r.photos) ? r.photos : [];
  const idPhoto = r.identification_photo_url;
  const primaryPhoto = idPhoto || (photos.find(p => p.is_primary) || photos[0])?.url;
  const thumbHTML = primaryPhoto
    ? `<div class="card-compact__thumb"><img src="${escapeHTML(primaryPhoto)}" alt="" loading="lazy" decoding="async"></div>`
    : `<div class="card-compact__thumb card-compact__thumb--empty"></div>`;

  // Meta: cuisine · price · distance
  const cuisine = Array.isArray(r.cuisine_types) && r.cuisine_types.length
    ? r.cuisine_types[0].replace(/_/g, ' ') : '';
  const price = r.price_range ? '฿'.repeat(r.price_range) : '';
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

  const metaHTML = metaParts.length ? `<span class="card-compact__meta">${escapeHTML(metaParts.join(' · '))}</span>` : '';

  // Michelin badge
  const michelinHTML = r.michelin_stars > 0
    ? `<span class="card-compact__michelin">${'★'.repeat(r.michelin_stars)}</span>`
    : r.michelin_bib ? `<span class="card-compact__michelin">Bib</span>` : '';

  return `
<article class="card-compact" role="listitem" data-id="${r.id}" aria-label="${escapeHTML(displayName)}">
  ${thumbHTML}
  <div class="card-compact__body">
    <div class="card-compact__top">
      <span class="card-dot ${dotClass}"></span>
      <h2 class="card-compact__name">${escapeHTML(displayName)}</h2>
      ${michelinHTML}
      ${wishHTML}
    </div>
    ${subName ? `<span class="card-compact__subname">${escapeHTML(subName)}</span>` : ''}
    ${metaHTML}
  </div>
</article>`;
}

export { cardHTML };
