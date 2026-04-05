/* ============================================================
   THAILAND FOOD GUIDE — utils.js
   Pure utility functions — no side effects, no state mutation
   ============================================================ */

'use strict';

import { CONFIG, DAY_KEYS } from './config.js';
import { dom } from './state.js';

/* ── HTML escaping ──────────────────────────────────────────── */

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ── Haversine distance (metres) ──────────────────────────── */

function haversineDistance(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return null;
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── Distance formatter ─────────────────────────────────── */

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
    const km = (metres / 1000).toFixed(1);
    const mins = Math.max(1, Math.round(metres / 80));
    return `${km} km \u00b7 ${mins} min walk`;
  }
}

/* ── City helpers ─────────────────────────────────────────── */

function cityBadgeClass(city) {
  const map = { bangkok: 'badge--bangkok', chiang_mai: 'badge--chiangmai', koh_chang: 'badge--kohchang' };
  return map[city] || '';
}

function cityLabel(city) {
  const map = { bangkok: 'Bangkok', chiang_mai: 'Chiang Mai', koh_chang: 'Koh Chang' };
  return map[city] || escapeHTML(city);
}

/* ── Open/closed status ─────────────────────────────────── */

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
    if (isOpen) {
      const minsToClose = closeMins >= currentMins
        ? closeMins - currentMins
        : (closeMins + 1440) - currentMins;
      return minsToClose <= 30 ? 'closes_soon' : 'open';
    }
  }

  for (const slot of daySlots) {
    const [oh, om] = (slot.open || '').split(':').map(Number);
    if (isNaN(oh)) continue;
    const openMins = oh * 60 + om;
    if (openMins > currentMins && openMins - currentMins <= 30) return 'opens_soon';
  }

  return 'closed';
}

/* ── Meal period checker ────────────────────────────────── */

function isOpenDuringPeriod(period, opening_hours) {
  if (!opening_hours || !period) return false;

  const periodRanges = {
    breakfast:  [0,    630],
    lunch:      [660,  900],
    dinner:     [1020, 1320],
    late_night: [1320, 1620],
  };

  const range = periodRanges[period];
  if (!range) return false;
  const [pStart, pEnd] = range;

  const now = new Date();
  const dayKey = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: 'Asia/Bangkok',
  }).format(now).toLowerCase().slice(0, 3);

  const daySlots = opening_hours[dayKey];
  if (!daySlots || !Array.isArray(daySlots) || daySlots.length === 0) return false;

  for (const slot of daySlots) {
    const [openH,  openM]  = (slot.open  || '').split(':').map(Number);
    const [closeH, closeM] = (slot.close || '').split(':').map(Number);
    if (isNaN(openH) || isNaN(closeH)) continue;
    const openMin  = openH  * 60 + openM;
    let   closeMin = closeH * 60 + closeM;
    if (closeMin < openMin) closeMin += 24 * 60;
    if (openMin < pEnd && closeMin > pStart) return true;
  }

  return false;
}

/* ── Hours formatting ───────────────────────────────────── */

function formatHoursSlot(slot) {
  if (!slot || typeof slot !== 'object') return '';
  return `${slot.open || '?'}\u2013${slot.close || '?'}`;
}

function formatDayHours(daySlots) {
  if (daySlots === null) return 'Closed';
  if (!Array.isArray(daySlots) || daySlots.length === 0) return '\u2014';
  return daySlots.map(formatHoursSlot).join(', ');
}

/* ── Today's hours (compact) ────────────────────────────── */

function todayHoursText(openingHours) {
  if (!openingHours || typeof openingHours !== 'object') return '';
  const now = new Date();
  const dayKey = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: CONFIG.timezone,
  }).format(now).toLowerCase().slice(0, 3);

  const daySlots = openingHours[dayKey];
  if (daySlots === null) return 'Closed today';
  if (!Array.isArray(daySlots) || daySlots.length === 0) return '';
  return daySlots.map(formatHoursSlot).join(', ');
}

/* ── Toast notifications ────────────────────────────────── */

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

export {
  escapeHTML,
  haversineDistance,
  formatDistance,
  cityBadgeClass,
  cityLabel,
  isOpenNow,
  isOpenDuringPeriod,
  formatHoursSlot,
  formatDayHours,
  todayHoursText,
  showToast,
};
