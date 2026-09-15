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

function pinIcon(color) {
  return L.divIcon({
    className: "trip-map-pin",
    html: `<div style="color:${color};filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))">${PIN_SVG}</div>`,
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
    notLocated: "לא אותרו על המפה: "
  },
  en: {
    empty: "No mapped places for this leg yet - add a place with a recognizable name to see it here.",
    notLocated: "Not located on the map: "
  }
};

// Tracks the current Leaflet instance across calls - renderTripMap() is
// re-entrant (leg filter changes, language changes, a place is added/edited)
// and container.innerHTML is rebuilt from scratch each time, which detaches
// the old map's DOM node but leaves the old L.Map object's own listeners
// (window resize, etc.) alive unless .remove() is called on it first - a
// real leak across repeated calls in one session, not just tidiness.
let currentMap = null;

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
window.renderTripMap = function renderTripMap(containerId, places, options = {}) {
  const container = document.getElementById(containerId);

  if (!container) {
    return;
  }

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
    empty.textContent = t.empty;
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

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19
    }).addTo(currentMap);

    const markerLatLngs = [];

    withCoords.forEach(place => {
      const marker = L.marker([place.lat, place.lon], {
        icon: pinIcon(colorForCategory(place.category))
      })
        .addTo(currentMap)
        .bindPopup(escapeHtml(place.name));

      markerLatLngs.push(marker.getLatLng());
    });

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
  }

  if (withoutCoords.length) {
    const list = document.createElement("div");
    list.className = "trip-map-not-located";
    list.textContent =
      t.notLocated + withoutCoords.map(p => p.name).join(", ");
    container.appendChild(list);
  }
};
