// Pure functions for CONSTRUCTING a legs[] array from raw wizard/admin-panel
// input (destination names, geocoded locations, date strings) - the write
// side of the multi-destination feature. See docs/schema-legs.md.
//
// Deliberately a separate file from legs.js, not an addition to it. legs.js
// is read/normalize only ("given a trip that may or may not already have
// legs, hand back a legs array") - every function in it takes an existing
// trip and never manufactures new leg data. These functions do the
// opposite: given raw input with no trip yet, build a legs array from
// scratch. Mixing the two would turn legs.js into a grab-bag for "anything
// leg-related" - the same reasoning that kept datetime.js (time-of-day
// utilities) out of legs.js despite both being trip-adjacent. See
// datetime.js's own header for that precedent.
//
// Also a real dependency-boundary reason, not just a naming one: legs.js is
// loaded on all 6 pages (packing/places/shopping/itinerary only ever read
// legs, never build them). This file is only needed by pages that
// CONSTRUCT a legs array - wizard.html today, index.html once the admin
// panel gains real leg editing (docs/schema-legs.md §5.7, step 11ב/ג) - so
// it's loaded only there, not dragged into the other four.
//
// Extracted (not copied) from wizard.html's generateTripAndSave() - that
// function called these directly as inline logic before this file existed.
// wizard.html now calls window.buildLegs()/window.deriveTripFields() and
// carries no local copy. A future admin-panel leg editor is meant to reuse
// these same two functions, not reimplement the boundary/derivation math a
// second time - see CLAUDE.md's "מבנה סקריפטים בין 6 הדפים" and legs.js's
// own header for why the shared-file pattern exists at all in this repo.
//
// RULE: pure functions only. No DOM access, no globals besides
// window.localInputToUtcInZone (datetime.js) and the standard Web Crypto
// API. Every caller passes in already-read values and gets back plain data -
// DOM reads/writes stay in the page that owns the form.
//
// index.html is a classic (non-module) script; wizard.html (and 4 of the
// other 5 pages) load their own script as type="module". This file is
// loaded as a classic script (no type="module" on its own <script> tag) and
// attaches explicitly to window, so it's reachable the same way from both:
// window.buildLegs(...). See legs.js's own header for the fuller
// explanation of why window.* is the only guaranteed-reachable form across
// both script types.
(function () {
    // Equal division of [startMs, endMs] into `legCount` segments, returning
    // the legCount-1 interior boundary instants (as epoch ms) - not the
    // endpoints themselves, which the caller already has. Pure math: for any
    // positive span and legCount<=6 (docs/schema-legs.md §7's own cap),
    // dividing by legCount can never produce a duplicate or zero-length
    // segment, only a short one (e.g. a 3-day span split 4 ways gives
    // ~18-hour segments) - that's a UI/UX question for the caller to accept
    // or not (docs/schema-legs.md's wizard commit ב decided to accept it,
    // relying on "ניתנות לתיקון ידני"), not something this function guards
    // against.
    function splitEqualBoundaries(startMs, endMs, legCount) {
        const boundaries = [];
        for (let i = 1; i < legCount; i++) {
            boundaries.push(startMs + Math.round((endMs - startMs) * i / legCount));
        }
        return boundaries;
    }

    // Builds a full legs[] array from raw per-leg input. Continuity
    // (legs[n].endAt === legs[n+1].startAt, docs/schema-legs.md §2.2) is
    // guaranteed BY CONSTRUCTION, not validated after the fact: every
    // boundary instant is computed exactly once into a shared `boundaries`
    // array, and both the leg ending there and the leg starting there read
    // the same array element - never two separate computations that could
    // drift apart.
    //
    // boundaries[0] = startInputValue verbatim, no re-zoning. docs/schema-
    // legs.md §4 treats trip.startAt (creator's device clock) and
    // legs[0].startAt (first leg's own local time) as semantically
    // different values that happen to coincide today, and explicitly defers
    // actually separating them to a future departureTimezone field.
    //
    // boundaries[last] = endInputValue interpreted in the LAST leg's own
    // timezone - both already mean "the last leg's own timezone" (same
    // reasoning as trip.endAt itself, docs/schema-legs.md §4).
    //
    // Each interior boundary (a transition date) is interpreted in the
    // OUTGOING leg's own timezone (leg i, not leg i+1) - docs/schema-legs.md
    // §5.2: the transition day belongs to the outgoing leg, extended from a
    // calendar day to an instant, and the same asymmetric "endAt uses its
    // own leg's zone" rule §4 already uses for trip.endAt/legs[last].endAt.
    //
    // legLocations[i] is expected to be `{ lat, lon, timezone, countryCode }`
    // (or `{}` on a failed/skipped geocode) - the shape geocodeDestination()
    // already returns. A leg with no resolved timezone falls back to
    // interpreting its own boundary(ies) as a naive local Date, and is
    // written with lat/lon/timezone all null - matching the decided partial-
    // geocoding-failure behavior (the caller logs its own console.warn for
    // that; this function doesn't warn, since it has no tripId to name).
    //
    // legIds[i], when given, is REUSED as that leg's id instead of minting a
    // fresh one - docs/schema-legs.md §2.2: "id יציב, לא אינדקס", specifically
    // so item/place assignments by legId survive a save that didn't touch
    // that leg. Before this parameter existed, every call regenerated every
    // leg's id unconditionally - including admin-panel saves that reused an
    // unchanged leg's lat/lon/timezone verbatim (index.html's `!dirty`
    // branch) - so ANY save on a multi-leg trip silently orphaned every
    // existing legId-based association, not just ones on the leg actually
    // edited. Found during docs/schema-legs.md step 8 investigation, before
    // step 6/9 (the first real legId consumers) could hit it. The wizard
    // never passes legIds - every leg there is new by construction, so the
    // fallback (mint one) is exactly what it needs, unchanged from before.
    //
    // legSeatLayouts[i], when given, is that leg's own seat configuration
    // (docs/schema-legs.md investigation, per-leg seat map/personal locker,
    // commit 2 of the plan) - parallel to legNames/legLocations, same
    // by-index convention. Optional and defaults to null, NOT "3-3" or any
    // other hardcoded layout: applying a default is a read-time concern for
    // whoever consumes leg.seatLayout, exactly like countryCode above (a leg
    // that predates this field falls back to the trip's own value, not to a
    // value baked in here at write time - docs/schema-legs.md §8ব.11ব.3).
    // wizard.html never passes this at all (seatLayout is admin-panel-only,
    // set after trip creation, never asked at creation time) - the `&&`
    // guard keeps that caller working unchanged, same as the legIds guard
    // above. trip.returnSeatLayout (the return flight's own layout) does
    // NOT go through this function - it's a sibling trip-level field, not a
    // leg, written directly by its own caller (there's no legs[N+1] to
    // represent "flying home from the last destination").
    function buildLegs({ legNames, legLocations, legVibes, startInputValue, endInputValue, transitionInputValues, hasTime, legIds, legSeatLayouts }) {
        const startBoundary = new Date(startInputValue);

        const lastLegTimezone = legLocations[legLocations.length - 1].timezone;
        const endBoundary = lastLegTimezone
            ? window.localInputToUtcInZone(endInputValue, lastLegTimezone)
            : new Date(endInputValue);

        const boundaries = [startBoundary];
        for (let i = 0; i < legNames.length - 1; i++) {
            const rawTransition = transitionInputValues[i];
            const transitionValue = rawTransition
                ? (hasTime ? rawTransition : `${rawTransition}T00:00`)
                : '';
            const outgoingTimezone = legLocations[i].timezone;
            boundaries.push(
                outgoingTimezone
                    ? window.localInputToUtcInZone(transitionValue, outgoingTimezone)
                    : new Date(transitionValue)
            );
        }
        boundaries.push(endBoundary);

        return legNames.map((name, i) => ({
            id: (legIds && legIds[i]) || `leg_${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`,
            name,
            lat: legLocations[i].lat ?? null,
            lon: legLocations[i].lon ?? null,
            timezone: legLocations[i].timezone || null,
            // Added so deriveTripFields can read trip.countryCode from
            // legs[0].countryCode directly instead of the caller's
            // ephemeral legLocations array - the latter doesn't exist by
            // the time an admin-panel save reuses an unchanged leg without
            // re-geocoding it (docs/schema-legs.md §2.2).
            countryCode: legLocations[i].countryCode || null,
            seatLayout: (legSeatLayouts && legSeatLayouts[i]) || null,
            startAt: boundaries[i].toISOString(),
            endAt: boundaries[i + 1].toISOString(),
            vibes: legVibes
        }));
    }

    // Trip-level fields that mirror legs[0]/legs[last] (docs/schema-legs.md
    // §2.1, §4): destination/lat/lon/countryCode from the FIRST leg,
    // timezone/endAt from the LAST leg. startAt is the one field that
    // doesn't follow that split - it's legs[0].startAt, but only because
    // that's the same boundaries[0] value buildLegs() already wrote there
    // verbatim from startInputValue (see that function's own comment), not
    // because "first leg" is the rule for it.
    //
    // Keeping all of these in one function is exactly what v4.20.2
    // (CHANGELOG) fixed after `timezone` was written from the wrong leg
    // (legs[0] instead of legs[legs.length-1]) - a single shared function
    // makes that class of mistake structurally harder to reintroduce than
    // separate inline reads at each call site did.
    // legLocations is no longer read here for countryCode (kept as a
    // parameter so existing callers don't need to change their call site) -
    // now sourced from legs[0].countryCode itself, which buildLegs() always
    // populates for a freshly-geocoded leg. A leg reused verbatim without
    // re-geocoding (an admin-panel save that didn't touch that leg's name)
    // may not carry one yet if it predates this field - the caller is
    // expected to fall back to whatever countryCode value it already knows
    // (e.g. the trip's own current value) rather than overwrite it with ''
    // the first time an old leg is saved unchanged.
    function deriveTripFields(legs, legLocations) {
        const lastLeg = legs[legs.length - 1];
        return {
            destination: legs[0].name,
            lat: legs[0].lat,
            lon: legs[0].lon,
            countryCode: legs[0].countryCode || '',
            timezone: lastLeg.timezone,
            startAt: legs[0].startAt,
            endAt: lastLeg.endAt
        };
    }

    window.splitEqualBoundaries = splitEqualBoundaries;
    window.buildLegs = buildLegs;
    window.deriveTripFields = deriveTripFields;
})();
