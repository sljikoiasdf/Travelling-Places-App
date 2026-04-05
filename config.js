/* ============================================================
   THAILAND FOOD GUIDE — config.js
   App configuration, Supabase client, constants
   ============================================================ */

'use strict';

const SUPABASE_URL = 'https://gfmjhirnywupfbfmflwn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmbWpoaXJueXd1cGZiZm1mbHduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjkyNDcsImV4cCI6MjA5MDc0NTI0N30.G51aTZpeVmu3hcQxZGTF4chQUUcs4DRKG8D_AAH0Adk';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

const CONFIG = {
  mapFallbackLat:  0,
  mapFallbackLng:  0,
  mapFallbackZoom: 2,
  mapPinZoom:     15,
  mapGPSZoom:     16,
  mapCityZoom:    14,
  zoomClose:      15,
  zoomMid:        12,
  fetchRadiusM:   50000,
  reFetchDistM:   20000,
  cacheVersion:   'v1',
  cacheTTL:       24 * 60 * 60 * 1000,
  timezone:       'Asia/Bangkok',
  nearbyRadiusM:  2000,
  nearbyLimit:    50,
};

const CITY_CENTRES = {
  melbourne:  { lat: -37.8136, lng: 144.9631 },
  bangkok:    { lat: 13.7563,  lng: 100.5018 },
  chiang_mai: { lat: 18.7883,  lng: 98.9853  },
  koh_chang:  { lat: 12.0500,  lng: 102.3400 },
};

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export { db, CONFIG, CITY_CENTRES, DAY_KEYS };
