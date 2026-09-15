// mapView.js - trip route map rendering (docs/schema-legs.md, trip-route-map
// investigation, commit 3/5). Classic script, window-attached - same pattern
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
// PLACEHOLDER ONLY (commit 3/5) - no real Leaflet map, no markers, no
// category colors, no animation yet. This commit is purely "does the
// infrastructure load and does this entry point exist" - the actual
// rendering logic is a later commit.
//
// containerId: the id of an element already in the DOM to render the map
//   into (the caller creates/owns this element - this file never creates or
//   looks up its own container div).
// places: the caller's places/items object (or an array - not decided yet,
//   this is a placeholder) already filtered to whichever leg is active -
//   this file does not know about activeLegFilter/legId itself, filtering is
//   the caller's job (matches how every other places.html feature already
//   splits that responsibility, e.g. geoRefLeg()/aiSuggestLeg() filter
//   before calling, not after).
// options: reserved for future use (language, theme, etc.) - unused today.
window.renderTripMap = function renderTripMap(containerId, places, options = {}) {
  console.log("[mapView.js] renderTripMap() called - placeholder, not yet implemented", {
    containerId,
    placesCount: places ? Object.keys(places).length : 0,
    options
  });
};
