# API Credentials

This file stores API keys and credentials used by the Thailand Food Guide PWA.

## Google Maps JavaScript API

- **Key:** `AIzaSyCSL7LlLdm37MuJwn8FZ90rh0JXdUhVap0`
- **Used in:** `config.js` (exported as `GOOGLE_MAPS_KEY`)
- **Purpose:** In-app map display (replaces OpenStreetMap/Leaflet)
- **Free tier:** $200 USD/month (~28,000 map loads)
- **Domain restriction:** `travelling-places-app.vercel.app` (recommended)
- **Console:** https://console.cloud.google.com

## Supabase

- **Project URL:** See config.js `db.url`
- **Anon Key:** See config.js `db.key`

## Notes

- If the map stops working, check the Google Cloud Console for quota/billing issues.
- API keys in config.js are client-side (public by design for these services).
