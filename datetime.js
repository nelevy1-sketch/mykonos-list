// Timezone-aware date/time helpers, shared by itinerary.html, index.html and
// (as of the commit that adds this comment) places.html.
//
// Not about legs - deliberately kept out of legs.js. These functions answer
// "what day/time is it in timezone X", nothing about trip structure. Mixing
// the two would turn legs.js into a grab-bag file for "anything trip-time-
// related", which is exactly the kind of vague catch-all that's hard to
// find things in later.
//
// HISTORY: zonedParts() existed as a byte-for-byte-identical copy in both
// itinerary.html and index.html already (confirmed via git log - itinerary
// got it 2026-09-05, index.html independently around the same work). A
// third copy was about to be written into places.html to fix a stale-
// timezone bug there (places.html's own tripDayDates() never got the
// 2026-09-05 fix that itinerary.html's did - it was copied from itinerary's
// PRE-fix version two days earlier and the fix never propagated). Three
// separate copies of the same ~15-line utility, with a real edge case
// (see the hour===24 note below) a future copy-paste could silently drop,
// crossed the line from "matches this codebase's established duplication
// precedent" (dateKey, --glow-color, the toast system) to "this is a
// pattern that will keep recurring" - hence this file instead of a fourth
// copy-paste.
//
// EDGE CASE - DO NOT DROP: Intl.DateTimeFormat with hour12:false can format
// local midnight as "24" instead of "00" (observed in practice, not just in
// spec text). zonedParts() normalizes that back to 0. Every caller here
// relies on hour being in the [0,23] range - dropping this normalization
// while "simplifying" the function would silently reintroduce a bug that
// was already fixed once, in a way most tests won't catch (it only shows
// up exactly at local midnight in the given timezone).
//
// index.html is a classic (non-module) script; the other 5 pages load
// their own script as type="module". This file is loaded as a classic
// script on all 6 (no type="module" on its own <script> tag) and attaches
// explicitly to window, so it's reachable the same way everywhere:
// window.zonedParts(...) etc. See legs.js's own header for the fuller
// explanation of why window.* is the only guaranteed-reachable form across
// both script types, and CLAUDE.md's "מבנה סקריפטים בין 6 הדפים".
(function () {
    function pad2(n) {
        return String(n).padStart(2, "0");
    }

    // Reads a Date's Y/M/D/H/M as seen in `timeZone`. Falls back to the
    // viewer's own device timezone when timeZone is falsy - this is the
    // existing "leg/trip has no timezone" fallback behavior (schema doc
    // §4: "רגל בלי timezone → timezone של הטיול → שעון המכשיר"), not
    // something new introduced by centralizing this function.
    function zonedParts(date, timeZone) {
        if (!timeZone) {
            return {
                year: date.getFullYear(),
                month: date.getMonth() + 1,
                day: date.getDate(),
                hour: date.getHours(),
                minute: date.getMinutes()
            };
        }

        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        }).formatToParts(date).reduce((acc, p) => {
            if (p.type !== "literal") acc[p.type] = parseInt(p.value, 10);
            return acc;
        }, {});

        if (parts.hour === 24) parts.hour = 0;

        return parts;
    }

    // "YYYY-MM-DD" for an arbitrary date, in `timeZone`.
    function dateKeyInZone(date, timeZone) {
        const p = zonedParts(date, timeZone);
        return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
    }

    // "YYYY-MM-DD" for right now, in `timeZone`.
    function todayKeyInZone(timeZone) {
        return dateKeyInZone(new Date(), timeZone);
    }

    // "HH:MM" for right now, in `timeZone`.
    function nowHHMMInZone(timeZone) {
        const p = zonedParts(new Date(), timeZone);
        return `${pad2(p.hour)}:${pad2(p.minute)}`;
    }

    // Interprets a naive "YYYY-MM-DDTHH:MM" datetime-local value as wall-clock
    // time in `timeZone` (not the browser's own timezone) and returns the
    // correct UTC instant. Uses Intl.DateTimeFormat only - no libraries.
    //
    // Moved here (docs/schema-legs.md §11, the legBuilder.js extraction) from
    // wizard.html and index.html, which each carried a byte-for-byte
    // identical copy (confirmed via diff before the move - only whitespace/
    // quote-style differed, same as every other duplication this file exists
    // to end). legBuilder.js's buildLegs() depends on this, and both existing
    // call sites (index.html's admin panel, wizard.html's trip creation)
    // already load this file - the same "about to become a third copy"
    // trigger that justified this file's own creation for zonedParts.
    function localInputToUtcInZone(inputValue, timeZone) {
        if (!inputValue) return new Date(NaN);
        const [datePart, timePart] = inputValue.split("T");
        const [year, month, day] = datePart.split("-").map(Number);
        const [hour, minute] = (timePart || "00:00").split(":").map(Number);
        const target = Date.UTC(year, month - 1, day, hour, minute);

        const partsInZone = (utcMillis) => {
            const parts = new Intl.DateTimeFormat("en-US", {
                timeZone,
                year: "numeric", month: "2-digit", day: "2-digit",
                hour: "2-digit", minute: "2-digit", hour12: false
            }).formatToParts(new Date(utcMillis)).reduce((acc, p) => {
                if (p.type !== "literal") acc[p.type] = parseInt(p.value, 10);
                return acc;
            }, {});

            if (parts.hour === 24) parts.hour = 0;

            return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
        };

        let guess = target;

        for (let i = 0; i < 2; i++) {
            guess -= partsInZone(guess) - target;
        }

        return new Date(guess);
    }

    window.zonedParts = zonedParts;
    window.dateKeyInZone = dateKeyInZone;
    window.todayKeyInZone = todayKeyInZone;
    window.nowHHMMInZone = nowHHMMInZone;
    window.localInputToUtcInZone = localInputToUtcInZone;
})();
