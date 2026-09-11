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

    // Whether a leg (or any {lat, lon} object) has USABLE coordinates.
    // lat/lon != null must be checked BEFORE Number.isFinite(Number(...)),
    // not after - Number(null) is 0, not NaN, so Number.isFinite(Number(x))
    // alone treats an explicit null (what a failed/skipped geocode writes -
    // legBuilder.js: `lat: legLocations[i].lat ?? null`) as if it were the
    // real coordinate (0, 0) - Null Island, a real spot in the Atlantic
    // that Open-Meteo will happily return a forecast for. Extracted here
    // after the same missing-null-check mistake happened twice
    // independently in one sitting: once in this function's own first
    // draft (see getCurrentLegCoords below), and once already live in
    // index.html's hydrateTripData() (hasRealCoords/latCoord/lonCoord,
    // docs/schema-legs.md §8 investigation) - the second occurrence is
    // exactly the kind of "same bug, different file" this file's own
    // shared-helper convention (see the header comment, and the
    // zonedParts/tripDayDates history in CLAUDE.md) exists to stop.
    function hasValidCoords(obj) {
        return !!obj &&
            obj.lat != null && obj.lon != null &&
            Number.isFinite(Number(obj.lat)) && Number.isFinite(Number(obj.lon));
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

    // §8ব finding 7: "what date/time is it right now, for THIS trip" needs
    // the leg that's actually active at this instant - not the first leg
    // (fixed, wrong once the trip is under way) and not the last leg (the
    // bug this function fixes: on a 3+-leg trip, "today" computed off the
    // last leg's zone is wrong for every day spent on an earlier leg).
    // Deliberately a function, not a cached value - the active leg changes
    // during the trip itself, so every call re-resolves "now" fresh via
    // getLegForDate(trip, new Date()).
    //
    // Fallback chain when no leg's range contains "now" (always true before
    // the trip starts and after it ends, not just a rare edge case) is
    // "active leg -> last leg -> device", extending the fallback already
    // documented in docs/schema-legs.md §4 ("רגל בלי timezone -> timezone
    // של הטיול -> שעון המכשיר") by one more tier at the front, not
    // replacing it - before/after the trip this returns exactly what
    // getLastLeg(trip).timezone already did before this function existed,
    // so those callers see no behavior change outside the trip's own dates.
    function getCurrentLegTimezone(trip) {
        const activeLeg = getLegForDate(trip, new Date());
        return (activeLeg && activeLeg.timezone) || getLastLeg(trip).timezone || null;
    }

    // docs/schema-legs.md §8, commit א - the coordinate analog of
    // getCurrentLegTimezone above ("where is the trip right now",
    // physically, not "what timezone applies right now"). Not the exact
    // same two-tier shape, for a real reason: getCurrentLegTimezone's
    // fallback (active leg -> last leg -> device) works because "device"
    // is always a usable final answer for a timezone. There's no
    // coordinate equivalent of "device" here - so instead of falling off
    // the end to null the moment there's no active leg, this mirrors §4's
    // OWN existing start/end split (trip.startAt reads the FIRST leg,
    // trip.endAt reads the LAST leg): before the trip, "where are we"
    // means the first destination; after it, the last one. During the
    // trip it's whatever getLegForDate resolves to, same as
    // getCurrentLegTimezone.
    //
    // A chosen leg can still lack real lat/lon (a failed or ambiguous
    // geocode - e.g. a plain destination name that Open-Meteo resolves to
    // the wrong place entirely, or to nothing). Decided: don't return
    // null just because THAT ONE leg has none - search the other natural
    // endpoints (last leg, then first leg) for a leg that does have real
    // coordinates, so a caller still gets something true about the trip
    // instead of nothing. Only returns null when no leg anywhere has
    // usable coordinates.
    function getCurrentLegCoords(trip) {
        const firstLeg = getPrimaryLeg(trip);
        const lastLeg = getLastLeg(trip);
        const activeLeg = getLegForDate(trip, new Date());

        let targetLeg;
        if (activeLeg) {
            targetLeg = activeLeg;
        } else {
            const beforeTrip = firstLeg.startAt && new Date() < new Date(firstLeg.startAt);
            targetLeg = beforeTrip ? firstLeg : lastLeg;
        }

        const candidate = [targetLeg, lastLeg, firstLeg].find(hasValidCoords);

        return candidate
            ? { lat: Number(candidate.lat), lon: Number(candidate.lon) }
            : null;
    }

    // docs/roadmap.md part 3 item 0 (empty-state copy) - "which
    // destination is this trip about right now", for UI copy that names
    // it (packing.html's per-category empty state, places.html's empty
    // state). Same fallback chain as getCurrentLegCoords above (active
    // leg -> first leg if before the trip -> last leg otherwise) -
    // deliberately mirrored rather than invented fresh, per that
    // function's own reasoning: "where is the trip right now" and
    // "which destination's name applies right now" are the same
    // question asked two ways. Returns the resolved leg's name as-is
    // (including falsy - undefined/"" - when a leg has none), so a
    // caller can tell "no leg" apart from "leg with no name" if it ever
    // needs to; text UI can just treat both as "no destination to show".
    function getCurrentLegName(trip) {
        const firstLeg = getPrimaryLeg(trip);
        const lastLeg = getLastLeg(trip);
        const activeLeg = getLegForDate(trip, new Date());

        let targetLeg;
        if (activeLeg) {
            targetLeg = activeLeg;
        } else {
            const beforeTrip = firstLeg.startAt && new Date() < new Date(firstLeg.startAt);
            targetLeg = beforeTrip ? firstLeg : lastLeg;
        }

        return targetLeg.name || null;
    }

    // docs/schema-legs.md investigation (per-leg seat map/personal locker,
    // commit 1 of the plan) - "is there a specific flight relevant RIGHT
    // NOW, and which one". Deliberately NOT built on getLegForDate/
    // tripDayDates: those answer "which leg does this CALENDAR DAY belong
    // to" (day granularity, day-key comparisons) - this answers "is a
    // specific flight's departure within a 24h window of this exact
    // instant", which needs raw millisecond arithmetic against
    // leg.startAt, not a day-boundary lookup. Different question, not a
    // narrower case of the same one.
    //
    // Asymmetric by design, per the decided display rule:
    // - legs[0] (the very first departure, from home): relevant from the
    //   moment the trip exists until its own startAt - no 24h gate. The
    //   organizer created the trip because of this flight; it shouldn't
    //   need a countdown to justify showing up.
    // - legs[1..] (every later transition - a flight FROM the previous
    //   leg's destination TO this one): relevant only in the 24h
    //   immediately before its own startAt (== the previous leg's endAt,
    //   contiguous per §2.2). Before that window, showing it would be
    //   noise for a flight that's still days or weeks away.
    // - the return flight (last leg's endAt, == trip.endAt per §4): NOT a
    //   leg - there's no legs[N+1] to represent "flying home from the
    //   last destination". Same 24h-before rule as legs[1..], measured
    //   against the trip's own end instead of a leg boundary. Signaled by
    //   the sentinel legId "return" (never a real leg.id - those are
    //   minted as "main", "leg_1", or crypto-random "leg_<base36>",
    //   legBuilder.js - "return" cannot collide with any of them).
    //
    // Only one flight is ever "relevant" at a time - a later flight's 24h
    // window cannot open before an earlier one's own departure has passed
    // (24h is far shorter than any realistic leg duration), so the loop
    // below returning on the first match is safe, not a coincidence.
    //
    // Timezone-agnostic on purpose: startAt/endAt are ISO strings with an
    // explicit UTC offset (§2.2), so `new Date(x) - now` is a difference
    // between two absolute instants - no leg/device timezone enters into
    // "is this within 24 hours" at all. Timezone only matters for deriving
    // a calendar day or a displayed wall-clock time from an instant
    // (zonedParts and friends) - not for this.
    //
    // Returns { legId, isReturn } or null (no flight relevant right now -
    // either between windows, or the trip is fully in its "after" phase).
    // Deliberately does not resolve seatLayout itself - "which flight is
    // relevant" and "what's its seat layout" are separate questions, same
    // one-job-per-function split as getCurrentLegTimezone/
    // getCurrentLegCoords/getCurrentLegName above.
    function getRelevantFlight(trip) {
        const legs = getLegs(trip);
        const now = new Date();

        const first = legs[0];
        if (first && first.startAt && now < new Date(first.startAt)) {
            return { legId: first.id, isReturn: false };
        }

        const ONE_DAY_MS = 24 * 60 * 60 * 1000;

        for (let i = 1; i < legs.length; i++) {
            const leg = legs[i];
            if (!leg.startAt) continue;

            const diff = new Date(leg.startAt).getTime() - now.getTime();
            if (diff > 0 && diff <= ONE_DAY_MS) {
                return { legId: leg.id, isReturn: false };
            }
        }

        const last = getLastLeg(trip);
        if (last && last.endAt) {
            const diff = new Date(last.endAt).getTime() - now.getTime();
            if (diff > 0 && diff <= ONE_DAY_MS) {
                return { legId: "return", isReturn: true };
            }
        }

        return null;
    }

    // One calendar day per entry from trip.startAt to the last leg's
    // endAt, each tagged with the leg it belongs to. Moved here from
    // itinerary.html/places.html (docs/schema-legs.md §8, step 4) - those
    // two pages held byte-for-byte identical copies of this function, and
    // a fix applied to one and not the other has already happened once
    // (see CHANGELOG, v4.13.x). A single shared definition, with both
    // local copies deleted rather than left dormant, is the actual fix
    // for that pattern - not "remember to update both".
    //
    // startAt is interpreted in the FIRST leg's timezone, endAt in the
    // LAST leg's - these are genuinely different legs on a multi-leg
    // trip, and were both being read via getLastLeg before this fix
    // (docs/schema-legs.md §4). A single-leg trip has
    // getPrimaryLeg(trip) === getLastLeg(trip), which is exactly why this
    // was wrong for months without a regression test catching it: every
    // test run so far used a single-leg trip, where the two calls are
    // indistinguishable.
    function tripDayDates(trip, tripId) {
        trip = trip || {};

        const lastLeg = getLastLeg(trip);

        if (!trip.startAt || !lastLeg.endAt) {
            return [];
        }

        const start = new Date(trip.startAt);
        const end = new Date(lastLeg.endAt);

        if (isNaN(start) || isNaN(end)) {
            return [];
        }

        const startTz = getPrimaryLeg(trip).timezone || null;
        const endTz = lastLeg.timezone || null;

        const startP = window.zonedParts(start, startTz);
        const endP = window.zonedParts(end, endTz);

        let cursor = new Date(startP.year, startP.month - 1, startP.day);
        const endDay = new Date(endP.year, endP.month - 1, endP.day);

        const days = [];
        let guard = 0;

        while (cursor <= endDay && guard < 60) {
            days.push(new Date(cursor));
            cursor.setDate(cursor.getDate() + 1);
            guard++;
        }

        // Tag each day with its leg - deliberately NOT via
        // getLegForDate(trip, date). That function is instant-based (it
        // compares date.getTime() against leg.startAt/endAt), which is
        // exactly right for a real timestamp (an activity's time) but
        // wrong here: `date` above is built with `new Date(year, month,
        // day)`, which JS interprets in the *browser's own* local
        // timezone, not the leg's - so its actual instant can land
        // outside the correct leg's range near a boundary whenever the
        // viewer's device timezone doesn't match the leg's (caught in
        // testing: a Rome/Bangkok fixture viewed from an Israel-timezone
        // browser produced false gaps on both legs' boundary days).
        // Comparing "YYYY-MM-DD" day-key strings, each computed via that
        // leg's OWN timezone, sidesteps the instant entirely - same
        // reasoning index.html's fetchForecast() already uses for its
        // own start/end-key comparison.
        const legs = getLegs(trip, tripId);

        const dayKeyOf = d =>
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

        const legRanges = legs
            .map(leg => {
                if (!leg.startAt || !leg.endAt) {
                    return null;
                }

                const legStart = new Date(leg.startAt);
                const legEnd = new Date(leg.endAt);

                if (isNaN(legStart) || isNaN(legEnd)) {
                    return null;
                }

                const legTz = leg.timezone || null;
                const legStartP = window.zonedParts(legStart, legTz);
                const legEndP = window.zonedParts(legEnd, legTz);

                return {
                    leg,
                    startKey: `${legStartP.year}-${String(legStartP.month).padStart(2, "0")}-${String(legStartP.day).padStart(2, "0")}`,
                    endKey: `${legEndP.year}-${String(legEndP.month).padStart(2, "0")}-${String(legEndP.day).padStart(2, "0")}`
                };
            })
            .filter(Boolean);

        // A shared transition-day key (both legs' own zoning agree it's
        // the same calendar day) matches both legs' ranges - array order
        // is chronological, so .find's first match is the outgoing leg,
        // per docs/schema-legs.md §5.2 ("יום המעבר שייך לרגל היוצאת").
        //
        // A gap between legs, or a day before every leg, matches none -
        // not a bug (contiguous, valid legs per §2.2 never produce this),
        // but real fallout from malformed leg data. Decision (§8): fall
        // back to the PRECEDING leg in sequence, or the first leg if the
        // day is before every leg. Warn loudly and record it rather than
        // silently absorbing it - a gap is corrupted data, not normal.
        return days.map(date => {
            const key = dayKeyOf(date);
            const match = legRanges.find(r => r.startKey <= key && key <= r.endKey);
            let leg = match ? match.leg : null;

            if (!leg) {
                const preceding = [...legRanges].reverse().find(r => r.endKey <= key);

                leg = preceding ? preceding.leg : legs[0];

                console.warn(
                    "[legs.js] tripDayDates: day falls in a leg gap" +
                    (tripId ? " (tripId: " + tripId + ")" : ""),
                    { date, trip }
                );

                window.__gtLegGap = {
                    tripId: tripId || null,
                    date,
                    at: Date.now()
                };
            }

            return { date, leg };
        });
    }

    window.getLegs = getLegs;
    window.getPrimaryLeg = getPrimaryLeg;
    window.getLastLeg = getLastLeg;
    window.isMultiLeg = isMultiLeg;
    window.hasValidCoords = hasValidCoords;
    window.getLegForDate = getLegForDate;
    window.getCurrentLegTimezone = getCurrentLegTimezone;
    window.getCurrentLegCoords = getCurrentLegCoords;
    window.getCurrentLegName = getCurrentLegName;
    window.getRelevantFlight = getRelevantFlight;
    window.tripDayDates = tripDayDates;
})();
