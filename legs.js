// Multi-destination trip helpers. See gittrip-schema-legs.md, section 6.
//
// Pure normalization only - nothing in the app calls these yet. A trip
// without trip.legs is a single-leg trip; getLegs() is the only place
// that knows that. All future consumer code is meant to call getLegs()
// (or the functions below, all built on it) and never check `trip.legs`
// directly - one code path, not two.
//
// FIELD NAME: the RTDB field is `lon`, not `lng` - confirmed against real
// writes/reads (wizard.html's trip creation, index.html's hydrateTripData,
// places.html's geo filter). The schema doc that this file implements uses
// `lng`; the data on disk does not - data wins. This is genuinely
// unintuitive and worth restating here: Open-Meteo's API returns a field
// called "longitude", and most mapping code elsewhere in the world uses
// `lng` (Google Maps included), so new code written against this file will
// very plausibly guess `lng` and silently get `undefined` back instead of
// an error. Use `lon`.
//
// index.html is a classic (non-module) script; the other 5 pages load
// their own script as type="module". This file is loaded as a classic
// script on all 6 (no type="module" on its own <script> tag) and attaches
// explicitly to window, so it's reachable the same way everywhere:
// window.getLegs(...). A bare `getLegs(...)` call works too on index.html
// (classic scripts share one global scope), but NOT inside the other 5
// pages' module scripts - a module's top-level scope never inlines global
// classic-script bindings, only window.* is guaranteed reachable from
// both. See CLAUDE.md, "מבנה סקריפטים בין 6 הדפים" - same distinction
// that made window.toast partially dormant, applies here too. Future
// callers inside a module script should use window.getLegs(...), or do a
// one-time `const { getLegs } = window;` at the top.
(function () {
    // tripId is optional, purely to make the warning below identify which
    // trip it's about - nothing else in this file's contract depends on
    // it, and every internal caller below (getPrimaryLeg, getLastLeg,
    // isMultiLeg, getLegForDate) calls getLegs(trip) without it. The trip
    // object itself never carries its own id (it's the RTDB key one level
    // up, not a field in the value - see wizard.html's trip creation), so
    // there's no way to recover it from `trip` alone.
    function getLegs(trip, tripId) {
        trip = trip || {};

        if (Array.isArray(trip.legs) && trip.legs.length) {
            return trip.legs;
        }

        if (trip.lat == null || trip.lon == null) {
            console.warn(
                "[legs.js] getLegs: trip missing lat/lon" +
                (tripId ? " (tripId: " + tripId + ")" : trip.destination ? " (" + trip.destination + ")" : ""),
                trip
            );
        }

        return [{
            id: "main",
            name: trip.destination,
            lat: trip.lat,
            lon: trip.lon,
            timezone: trip.timezone,
            startAt: trip.startAt,
            endAt: trip.endAt,
            vibes: trip.vibes || []
        }];
    }

    function getPrimaryLeg(trip) {
        return getLegs(trip)[0];
    }

    function getLastLeg(trip) {
        const legs = getLegs(trip);
        return legs[legs.length - 1];
    }

    function isMultiLeg(trip) {
        return getLegs(trip).length > 1;
    }

    // Legs are contiguous and non-overlapping (legs[n].endAt ===
    // legs[n+1].startAt, per schema §2.2) - the transition moment belongs
    // to the OUTGOING leg. Using an inclusive range on both ends and
    // returning the first match (array order = chronological order) gives
    // exactly that: at a shared boundary timestamp, the earlier leg's
    // check is tried first and wins, without needing an asymmetric
    // open/closed interval per leg.
    //
    // A date outside every leg's range (before the trip starts, after it
    // ends, or - if legs data is ever malformed despite the "contiguous"
    // assumption - inside a gap) returns null. This is deliberately NOT a
    // clamp: a date outside every leg isn't missing data falling back to a
    // reasonable default (like timezone: leg -> trip -> device) - it's a
    // real fact that the date doesn't belong to any leg, and a silent
    // clamp would make e.g. "the day before the trip" render as if it
    // were part of the first leg's destination. A caller that explicitly
    // wants "nearest leg regardless" should get that from its own
    // wrapper (e.g. a future getLegForDateOrNearest()), not from this
    // function's default.
    function getLegForDate(trip, date) {
        const legs = getLegs(trip);
        const t = new Date(date).getTime();

        for (let i = 0; i < legs.length; i++) {
            const leg = legs[i];

            if (
                typeof leg.startAt !== "undefined" &&
                typeof leg.endAt !== "undefined" &&
                t >= new Date(leg.startAt).getTime() &&
                t <= new Date(leg.endAt).getTime()
            ) {
                return leg;
            }
        }

        return null;
    }

    window.getLegs = getLegs;
    window.getPrimaryLeg = getPrimaryLeg;
    window.getLastLeg = getLastLeg;
    window.isMultiLeg = isMultiLeg;
    window.getLegForDate = getLegForDate;
})();
