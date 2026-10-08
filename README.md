# Marchés Au Coin

Deployable mobile-first PWA for live French market searches.

## Live search
The backend uses Serper (Google-style web results) and Google Maps Geocoding. Set:
SEARCH_API_KEY=...
GOOGLE_MAPS_API_KEY=...

Then:
npm install
npm start

Serve over HTTPS, open in Safari, then Share -> Add to Home Screen.

## Google Maps directions
Each result uses Google's official Directions URL format:
https://www.google.com/maps/dir/?api=1&destination=...

The direction link itself does not require a Maps API key.
