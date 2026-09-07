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
// DATE FORMAT: startAt/endAt are ISO 8601 strings (e.g.
// "2026-10-06T20:00:00.000Z"), not numeric epoch timestamps - confirmed
// against real data and both write sites (wizard.html's trip creation,
// index.html's admin date edit both call .toISOString()). The schema doc
// said "timestamps"; the data on disk is strings - same kind of mistake as
// lng/lon above, data wins again. getLegForDate already handles this
// correctly (every comparison goes through `new Date(x).getTime()`, which
// accepts a string, a number or a Date interchangeably - verified against
// real ISO values, not just numbers). But a leg object returned by
// getLegs() carries startAt/endAt through unchanged, as whatever type the
// source data had - any future code that reads leg.startAt/leg.endAt
// directly and does arithmetic on it (leg.startAt + 86400000, say) instead
// of wrapping it in new Date(...) first will silently misbehave on real
// data. Every existing consumer elsewhere in the app (itinerary.html's and
// places.html's tripDayDates()) already wraps in new Date() first - do the
// same in any new code.
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

        // Warn only when this looks like a real trip missing real data -
        // trip.destination is set but lat/lon isn't. A trip object with
        // no destination either hasn't loaded yet (every page here builds
        // trip as an empty object/module var and populates it once
        // Firebase answers - see docs/schema-legs.md's CLAUDE.md entry)
        // or was never given one; either way that's not a data problem to
        // report. Not keying this off trip.language or any other field -
        // a pre-load object can look different from page to page, but
        // "no destination yet" is the one thing they all share. This
        // narrower check is what actually distinguishes "not loaded yet"
        // from "loaded, and something's wrong": itinerary.html, places.html
        // and packing.html all synchronously call functions that reach
        // getLegs() before Firebase responds (a cached-language flash-fix
        // that runs on a bare {} trip) - confirmed to fire this warning
        // 2-6 times on every single page load before this fix, which is
        // exactly the kind of noise that gets an alert ignored.
        if (trip.destination && (trip.lat == null || trip.lon == null)) {
            console.warn(
                "[legs.js] getLegs: trip missing lat/lon" +
                (tripId ? " (tripId: " + tripId + ")" : " (" + trip.destination + ")"),
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
