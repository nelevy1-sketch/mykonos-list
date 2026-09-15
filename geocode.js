// geocode.js - shared Nominatim (OpenStreetMap) geocoding wrapper
// (docs/schema-legs.md, trip-route-map investigation, commit 1/5). Classic
// script, window-attached - same pattern as legs.js/datetime.js (see
// CLAUDE.md's "מבנה סקריפטים בין 6 העמודים" for why that pattern matters here
// specifically).
//
// NOT the same service wizard.html/index.html already use for LEG-level
// destination geocoding (Open-Meteo's geocoding-api, city/region only) -
// verified directly, not assumed, that Open-Meteo returns zero results for
// actual points of interest ("Eiffel Tower", "Louvre Museum", "שוק הכרמל" -
// a real Tel Aviv market - all came back empty, even in English, even with
// added city context), while it correctly resolves cities/districts/squares
// ("רומא", "Trastevere", "Times Square"). It's a settlement gazetteer, not a
// POI geocoder - fine for a leg's own destination, wrong tool for an
// individual saved PLACE (a restaurant, a market, a landmark), which is
// exactly what this file exists for. Nominatim (OSM's own geocoder, the
// natural counterpart to the OSM tiles already chosen for the map itself)
// resolved all three of those same failing queries correctly - confirmed
// directly against the live API before choosing it, not assumed from docs.
//
// Usage policy (operations.osmfoundation.org/policies/nominatim/), checked
// directly: max 1 request/second, a User-Agent or HTTP Referer identifying
// the app, attribution required, no autocomplete/bulk/grid-query use. This
// file only ever geocodes one place, once, at the moment a user saves it -
// never a live-typing autocomplete, never a batch loop without a delay (see
// the backfill script's own comment on this same limit). The browser's own
// default Referer header (this app's page URL, sent automatically on a
// cross-origin fetch) is relied on to satisfy the User-Agent/Referer
// requirement - a browser script cannot set its own User-Agent string.
//
// wizard.html and index.html each already have their OWN independent copy of
// the OTHER (Open-Meteo, leg-level) geocoding call - deliberately NOT touched
// or unified here. Only the new places-map feature uses this shared file for
// now; unifying anything with those two existing copies is a separate
// decision, not part of this change.
//
// NO retry, on purpose - tried and confirmed NOT to work, not just skipped.
// Open-Meteo's geocoding-api (the other service in this app) has a `language`
// param that appears to affect actual matching, so a same-name English retry
// can rescue a Hebrew-coverage gap there. Nominatim's `accept-language` is
// NOT that - verified directly against the live API that it only changes the
// DISPLAY language of a match already found, never what gets matched: the
// exact same Hebrew query, resent with accept-language=en (with or without an
// appended Hebrew context string), still returned nothing for a real,
// verified gap ("מוזיאון תל אביב לאמנות" - Tel Aviv Museum of Art). Only an
// actual English-translated name string resolved it, and this app has no
// translation step to produce one. A retry that re-sends the same
// characters under a different response-language flag is not a real retry
// here - don't reintroduce one without an actual translation step behind it.
//
// What actually decides whether a place resolves, verified directly: (1) how
// famous/well-tagged it is in OSM - "מגדל אייפל"/"סגרדה פמיליה" resolve
// straight from Hebrew because enough contributors already tagged a Hebrew
// name; "הקולוסיאום"/"מגדל פיזה הנוטה" don't, despite being equally famous -
// OSM's Hebrew-tag coverage is community-contributed and uneven, not a
// simple function of fame; (2) the Hebrew definite article "ה-": "קולוסיאום"
// and "מגדל פיזה" (without the prefix) resolve where "הקולוסיאום"/"מגדל פיזה
// הנוטה" (with it) don't - Nominatim's free-text matching is brittle to this,
// even for a place that IS tagged in Hebrew. Neither is fixable from this
// file - documented here so a real "not located" result for a well-known
// place isn't mistaken for a bug in this code.
// Real bug, reported and reproduced against the live API, not guessed: a
// place named "מסעדה" (the generic Hebrew word for "restaurant") in a trip
// to Berlin geocoded successfully - to a real village called Mas'ade in the
// Golan Heights, Israel, because that's a genuine place Nominatim knows
// about and the query gave it nothing to prefer Berlin over it with. Not a
// "not located" failure (which already has a visible, honest fallback) -
// a WRONG answer accepted as a right one, silently.
//
// This is exactly the destination-context requirement decided in the
// earlier investigation (the Google Maps link plan, before the switch to
// an embedded map) - "a bare name like 'קפה' will search the whole world" -
// that never actually carried over when geocode.js was built fresh around
// the Nominatim/Open-Meteo and retry questions instead. It fell through
// between the two plans, it wasn't deliberately skipped.
//
// Fixed with countrycodes (Nominatim's own hard filter, ISO 3166-1 alpha-2,
// confirmed directly against the docs and the live API), not by appending
// the destination name back into the query text - that text-based approach
// was already shown to be unreliable for a different reason (the
// "ארומה אספרסו בר, תל אביב" test earlier in this investigation): appending
// context to Nominatim's free-text query can BREAK an already-working
// match, not just fail to help one. countrycodes changes the search space
// itself, not the text being matched - confirmed directly: the exact
// "מסעדה" query with countrycodes=de returns [] (no false Golan match, and
// no real restaurant of that literal name exists in Germany's OSM data
// either) - an honest "not located", not a wrong country.
async function geocodeQuery(name, language, countryCode) {
  try {
    const countryFilter = countryCode
      ? `&countrycodes=${encodeURIComponent(countryCode.toLowerCase())}`
      : "";

    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name)}&format=json&limit=1&accept-language=${language}${countryFilter}`
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const match = data?.[0];

    return match ? { lat: Number(match.lat), lon: Number(match.lon) } : null;
  } catch {
    return null;
  }
}

// name: the thing to locate (e.g. a saved place's own name).
// options.language: "he" | "en" - only affects the response's display
//   language (see the no-retry note above), never what gets matched.
//   Anything else falls back to "he" (this app's own default everywhere
//   else). Passed through for consistency/future use, not because it
//   changes matching today.
// options.countryCode: ISO 3166-1 alpha-2 (e.g. "DE"), the destination's own
//   country - restricts matching to that country via Nominatim's
//   countrycodes filter, so a generic/ambiguous name doesn't silently
//   resolve to a same-named place in the wrong country (see the comment
//   above). Optional and case-insensitive - when omitted (a leg that
//   predates this field, or genuinely unknown), the search runs unfiltered,
//   same as before this option existed. That's a reversion to today's
//   existing risk level, not a new failure mode - never blocks the save or
//   throws for its absence.
//
// Returns {lat, lon} or null - never throws. null is a real, expected, named
// outcome (a caller can't locate this on a map) - not an error to catch
// upstream, and never a placeholder like {lat:0, lon:0}.
window.geocodeName = async function geocodeName(name, options = {}) {
  const language = options.language === "en" ? "en" : "he";

  return geocodeQuery(name, language, options.countryCode);
};
