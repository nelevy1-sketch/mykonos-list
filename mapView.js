// mapView.js - trip route map rendering (docs/schema-legs.md, trip-route-map
// investigation, commit 4/5). Classic script, window-attached - same pattern
// as legs.js/datetime.js/geocode.js (see CLAUDE.md's "מבנה סקריפטים בין 6
// העמודים" for why that pattern matters here specifically).
//
// Deliberately its own file, not code inline inside places.html - the whole
// point of building this as a standalone entry point is that it must not
// assume it lives specifically in places.html. There's a separate, future
// discussion about moving the places view to itinerary.html - whichever page
// ends up hosting the map tab just needs to load this file and call
// renderTripMap() the same way; the rendering logic itself doesn't belong to
// either page.
//
// Deliberately self-contained: no dependency on the caller's own tr()/
// escapeHtml() - places.html (and every other trip-scoped page) is a
// type="module" script, so those helpers are module-scoped and unreachable
// from a classic script like this one (see CLAUDE.md's own note on this -
// leaned on repeatedly this session for real browser testing). Small local
// equivalents are defined below instead of assuming they're reachable.

// Category -> color, matched by the trailing emoji in the category string,
// not the full text - resilient to future wording tweaks (the emoji is the
// stable anchor, the words around it aren't). Covers every category
// categories() (places.html) can currently produce, across every
// tripType/vibe combination, in both languages - verified directly against
// that function's source, not guessed. A category is stored verbatim in
// whatever language it was picked in (there's no re-translation later), so
// this can't be keyed by language - matching on the emoji sidesteps that too.
//
// Colors verified visually (not just as hex values) against a light OSM-tile
// backdrop and the app's own light/dark backgrounds before being finalized -
// see the trip-route-map investigation for the swatch comparisons. "חשוב"/
// "Important" (⭐, reserve-duty trips only) was moved from a red to a gold
// after that check found it too close to "אוכל"/"Food" (🍽️) - closer than
// either pair that prompted the check in the first place.
const CATEGORY_COLORS = {
  "🍽️": "#E67E22", // אוכל וקפה / Food & coffee, אוכל / Food (reserve)
  "🎟️": "#8E44AD", // אטרקציה / Attraction
  "🏨": "#2E86DE", // מלון / Hotel
  "🏡": "#2E86DE", // לינה / Lodging (local)
  "🛏️": "#2E86DE", // לינה / Lodging (reserve, different emoji, same color)
  "🎵": "#E84393", // חיי לילה / Nightlife
  "🛍️": "#E84393", // קניות / Shopping
  "🏖️": "#00B8A9", // חוף / Beach
  "🏄": "#00B8A9", // ספורט ים / Water sports
  "🥾": "#27AE60", // מסלול / Trail
  "🌄": "#27AE60", // תצפית / Viewpoint
  "💆": "#9B8CFF", // ספא ובריאות / Spa & wellness
  "🌅": "#9B8CFF", // נוף ורוגע / Quiet views
  "⛺": "#8D6E48", // חניון לילה / Campsite
  "💧": "#8D6E48", // מים / Water
  "🛒": "#8D6E48", // אספקה / Supplies
  "📍": "#8D6E48", // נקודת מפגש / Meeting point
  "⭐": "#F1C40F" // חשוב / Important
};

// Not theoretical - refreshPlaceCategoryOptions() (places.html) already
// keeps a place's OWN stale category value in its dropdown when it no
// longer matches the trip's current tripType/vibes (organizer changed trip
// settings after the place was saved) rather than discarding it. A category
// this map has never seen must fall back cleanly, not throw or render
// nothing.
const DEFAULT_CATEGORY_COLOR = "#7F8C8D";

function colorForCategory(category) {
  if (typeof category !== "string") {
    return DEFAULT_CATEGORY_COLOR;
  }

  for (const emoji in CATEGORY_COLORS) {
    if (category.includes(emoji)) {
      return CATEGORY_COLORS[emoji];
    }
  }

  return DEFAULT_CATEGORY_COLOR;
}

// Tabler's map-pin (map-pin.svg, outline set, MIT) - embedded once as a
// string rather than fetched at runtime per marker. stroke="currentColor"
// in the source file is exactly what makes the div-icon wrapper's own CSS
// color below work - Leaflet has no built-in colored-pin marker, this is
// the standard way to get one (an HTML div icon, not an L.icon image).
const PIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/><path d="M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0"/></svg>';

// The animation class lives on an INNER div, not on Leaflet's own
// className option (which targets .leaflet-marker-icon, the element
// Leaflet itself positions via an inline `transform: translate3d(...)`).
// Animating `transform` on that same element/property would fight Leaflet's
// own positioning transform (inline styles win over a class's @keyframes on
// the same property) - a real conflict, not just a style nit. The color and
// drop-shadow/glow live entirely in CSS on this inner div too (not inline),
// so there's exactly one thing setting `filter` on it, not two.
function pinIcon(color) {
  return L.divIcon({
    className: "trip-map-pin",
    html: `<div class="trip-map-pin-inner" style="color:${color}">${PIN_SVG}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 30], // near the visual point of the pin, not its center
    popupAnchor: [0, -28]
  });
}

function escapeHtml(value) {
  return String(value || "").replace(
    /[&<>"']/g,
    char =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char])
  );
}

const TEXT = {
  he: {
    empty: "אין עדיין מקומות ממופים לרגל הזו - הוסיפו מקום עם שם מזוהה כדי לראות אותו כאן.",
    emptyButton: "מעבר לטאב \"מקומות\"",
    notLocated: "לא אותרו על המפה: "
  },
  en: {
    empty: "No mapped places for this leg yet - add a place with a recognizable name to see it here.",
    emptyButton: "Go to the Places tab",
    notLocated: "Not located on the map: "
  }
};

// Dark map tiles (trip-route-map investigation, dark-tiles follow-up).
//
// CartoDB dark_all was chosen over the key-free alternative (Esri "Dark Gray
// Canvas") after an actual side-by-side visual test, not just reading specs -
// Esri's tiles rendered as a light/medium gray "canvas" style, clearly closer
// to muted-gray than to a real dark mode, especially next to this app's own
// near-black dark theme (#0B1015, see the theme-color meta tag in
// places.html). CartoDB dark_all was genuinely dark in the same test.
//
// CARTO_DARK_KEY below is the real, live key (replaced the original
// "YOUR_CARTO_KEY_HERE" placeholder before that commit shipped - verified
// visually, dark tiles loading with no watermark, before it was swapped in).
// If this key is ever revoked/rate-limited and needs replacing, get a new
// free one (takes ~1 minute, email only, no CARTO account, no credit card,
// 5M tile requests/month) at:
//   https://carto.com/basemaps/apikey/
//
// This key is NOT a secret and does not need a Cloud Function proxy (unlike
// e.g. a Gemini API key) - it's designed to be embedded directly in a
// client-side tile request URL, the same way every CARTO/Mapbox/similar
// tile key works. GitHub Pages being static hosting changes nothing here;
// there's no server-side value to protect. Optional (not required):  CARTO's
// own dashboard (dashboard.basemaps.carto.com/keys) lets you restrict a key
// to specific domains/referrers - a mild anti-abuse measure, not encryption.
const CARTO_DARK_KEY = "cb1_3mi6_1_bcb832d295be0078fcdd9ec7";

const OSM_LIGHT_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const CARTO_DARK_TILE_URL = `https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=${CARTO_DARK_KEY}`;

// Both OpenStreetMap and CARTO attribution are required any time CARTO's
// tiles are shown (docs.carto.com/faqs/carto-basemaps) - kept as one
// constant, always both credited, rather than swapped per-layer. Simpler
// than syncing the attribution control every time the tile layer's URL
// changes, and over-crediting CARTO while the light OSM tiles happen to be
// active isn't a problem the way under-crediting would be.
const TILE_ATTRIBUTION =
  '&copy; OpenStreetMap contributors, tiles by <a href="https://carto.com/attributions">CARTO</a>';

function isDarkTheme() {
  return document.documentElement.dataset.theme === "dark";
}

// Falls back from the dark CARTO tiles to the plain OSM light tiles if they
// repeatedly fail to load (key revoked, CARTO outage/policy change, quota
// exhausted - all real, external, out-of-this-app's-control failure modes,
// see the dark-tiles investigation's own risk list) - a broken/blank map is
// not acceptable, a map that silently reverts to its light style is. A
// single stray tile error (flaky connection, one bad tile) is normal and
// not a reason to give up - only reacts once several land close together.
// Not wired up for the OSM light layer itself - there's no further fallback
// tier planned if OSM is what's failing, that's already the last resort.
function attachTileFallback(layer, tilesAreDark) {
  layer.off("tileerror");

  if (!tilesAreDark) {
    return;
  }

  const FAILURE_WINDOW_MS = 3000;
  const FAILURE_THRESHOLD = 3;
  let errorCount = 0;
  let windowStart = 0;

  layer.on("tileerror", () => {
    const now = Date.now();

    if (now - windowStart > FAILURE_WINDOW_MS) {
      windowStart = now;
      errorCount = 0;
    }

    errorCount++;

    if (errorCount >= FAILURE_THRESHOLD) {
      console.warn(
        "CARTO dark map tiles failed to load repeatedly - falling back to OSM light tiles"
      );
      layer.setUrl(OSM_LIGHT_TILE_URL);
      layer.off("tileerror");
    }
  });
}

// Tracks the current Leaflet instance across calls - renderTripMap() is
// re-entrant (leg filter changes, language changes, a place is added/edited)
// and container.innerHTML is rebuilt from scratch each time, which detaches
// the old map's DOM node but leaves the old L.Map object's own listeners
// (window resize, etc.) alive unless .remove() is called on it first - a
// real leak across repeated calls in one session, not just tidiness.
let currentMap = null;

// The single tile layer instance for the current map - swapped in place via
// .setUrl() (both on initial render and on a live theme toggle, see
// window.updateMapTheme below) rather than removed/re-added, so there's
// always exactly one layer/one attribution control entry, never a stacked
// pair mid-swap.
let currentTileLayer = null;

// Same "ignore it if a newer request has since started" idiom already used
// elsewhere in this app (itinerary.html/places.html's own profileLoadGen,
// index.html's shareLinkRequestId) - the entrance animation staggers
// marker.addTo() calls with setTimeout (commit 5/5), and renderTripMap()
// can run again (leg filter flipped, language changed) before those timers
// finish. Without this guard, a stale timeout would call .addTo() on
// whatever currentMap happens to be *now* - possibly a newer map instance
// for a completely different filtered set of places - adding a leftover
// marker from the render that was just superseded.
let renderGeneration = 0;

// Gap between one pin's entrance and the next - deliberately not "however
// long the CSS animation takes", the two are independent: this controls
// when each pin STARTS appearing, the CSS controls how each one animates
// once it does.
const STAGGER_MS = 90;

// containerId: the id of an element already in the DOM to render into (the
//   caller creates/owns this element - this file never creates or looks up
//   its own container div beyond what's passed in).
// places: the caller's places/items object, already filtered to whichever
//   leg is active - this file does not know about activeLegFilter/legId
//   itself, filtering is the caller's job (matches how every other
//   places.html feature already splits that responsibility, e.g.
//   geoRefLeg()/aiSuggestLeg() filter before calling, not after). Places
//   WITHOUT lat/lon are expected to still be present in this object - this
//   file is what splits "has coordinates" (goes on the map) from "doesn't"
//   (goes in the not-located list below it), not the caller.
// options.language: "he" | "en", defaults to "he".
// options.onEmptyAction: optional callback, shown as a button in the empty
//   state (no places have coordinates yet). This file doesn't know the
//   caller's own tab-switching function (or even that it lives inside tabs
//   at all - see the file-level comment above) - the caller decides what
//   the button does, this file only renders it when a callback is given.
window.renderTripMap = function renderTripMap(containerId, places, options = {}) {
  const container = document.getElementById(containerId);

  if (!container) {
    return;
  }

  const myGeneration = ++renderGeneration;

  if (currentMap) {
    currentMap.remove();
    currentMap = null;
  }

  container.innerHTML = "";

  const lang = options.language === "en" ? "en" : "he";
  const t = TEXT[lang];

  const withCoords = [];
  const withoutCoords = [];

  Object.values(places || {}).forEach(place => {
    if (!place || typeof place.name !== "string" || !place.name.trim()) {
      return;
    }

    if (typeof place.lat === "number" && typeof place.lon === "number") {
      withCoords.push(place);
    } else {
      withoutCoords.push(place);
    }
  });

  if (withCoords.length === 0) {
    const empty = document.createElement("div");
    empty.className = "trip-map-empty";

    const message = document.createElement("p");
    message.style.margin = "0";
    message.textContent = t.empty;
    empty.appendChild(message);

    if (typeof options.onEmptyAction === "function") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "primary-btn";
      button.style.cssText = "margin-top:14px;padding:0 22px;cursor:pointer";
      button.textContent = t.emptyButton;
      button.onclick = options.onEmptyAction;
      empty.appendChild(button);
    }

    container.appendChild(empty);
  } else {
    const mapDiv = document.createElement("div");
    mapDiv.className = "trip-map-canvas";
    container.appendChild(mapDiv);

    const avgLat =
      withCoords.reduce((sum, p) => sum + p.lat, 0) / withCoords.length;
    const avgLon =
      withCoords.reduce((sum, p) => sum + p.lon, 0) / withCoords.length;

    currentMap = L.map(mapDiv).setView([avgLat, avgLon], 14);

    const startDark = isDarkTheme();
    currentTileLayer = L.tileLayer(
      startDark ? CARTO_DARK_TILE_URL : OSM_LIGHT_TILE_URL,
      { attribution: TILE_ATTRIBUTION, maxZoom: 19 }
    ).addTo(currentMap);
    attachTileFallback(currentTileLayer, startDark);

    // Computed from the places themselves, not from marker.getLatLng() after
    // adding them - bounds/view need to settle ONCE, before any pin starts
    // its staggered entrance below, not keep shifting under the animation as
    // markers appear one by one.
    const markerLatLngs = withCoords.map(place => [place.lat, place.lon]);

    // Deliberate refinement of "center on the average" (as specified) rather
    // than a literal average + fixed zoom: with 2+ places spread across a
    // city, a fixed zoom around the average point can crop pins out of view
    // entirely depending on how far apart they are. fitBounds() still
    // centers on the places' own collective area (the practical goal average
    // centering was after) while guaranteeing every pin stays visible. A
    // single place has no bounds to fit, so it keeps the plain average (its
    // own one coordinate) + setView's fixed zoom above.
    if (markerLatLngs.length > 1) {
      currentMap.fitBounds(L.latLngBounds(markerLatLngs), { padding: [24, 24] });
    }

    // Staggered entrance (commit 5/5): pins drop in one after another, not
    // all at once - matches every other pin's own CSS animation delay
    // between drop+bounce and its one-time glow (trip-map-pin-inner in
    // places.html). Skipped entirely (not just visually neutralized) under
    // prefers-reduced-motion - every pin appears immediately, together, not
    // "fast" one-by-one - the CSS override below is a second, independent
    // guard for the animation itself, not a substitute for skipping the
    // staggered timing too.
    const reducedMotion =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    withCoords.forEach((place, index) => {
      const addMarker = () => {
        if (myGeneration !== renderGeneration) {
          return;
        }

        L.marker([place.lat, place.lon], {
          icon: pinIcon(colorForCategory(place.category))
        })
          .addTo(currentMap)
          .bindPopup(escapeHtml(place.name));
      };

      if (reducedMotion) {
        addMarker();
      } else {
        setTimeout(addMarker, index * STAGGER_MS);
      }
    });
  }

  if (withoutCoords.length) {
    const list = document.createElement("div");
    list.className = "trip-map-not-located";
    list.textContent =
      t.notLocated + withoutCoords.map(p => p.name).join(", ");
    container.appendChild(list);
  }
};

// Called from applyTheme() (places.html) every time the theme is set - on
// load AND on the theme button's own click - so the map's tile layer flips
// live in the same moment as every other themed element on the page,
// instead of only updating the next time the map tab happens to be
// re-entered. A no-op (not an error) when the map tab was never opened this
// session - currentMap/currentTileLayer don't exist yet, and the next
// renderTripMap() call already picks the right tiles for the theme at that
// point, same as this function would.
window.updateMapTheme = function updateMapTheme() {
  if (!currentMap || !currentTileLayer) {
    return;
  }

  const wantsDark = isDarkTheme();
  currentTileLayer.setUrl(wantsDark ? CARTO_DARK_TILE_URL : OSM_LIGHT_TILE_URL);
  attachTileFallback(currentTileLayer, wantsDark);
};
