#!/usr/bin/env node
// Diagnostic: find trips where trip-level fields have drifted out of sync
// with legs[0]/legs[last] (docs/schema-legs.md §2.1, §4).
//
// Written for the step-11 investigation (index.html's admin panel wrote
// destination/lat/lon/countryCode/timezone/startAt/endAt at the trip level
// without ever touching `legs`, so a multi-leg trip edited from the admin
// panel silently contradicts its own legs[]). That write path is now
// blocked for multi-leg trips - this script finds trips that were already
// corrupted by it before the fix, so they can be repaired by hand.
//
// Not app code - not loaded by any page, no version bump (see CLAUDE.md's
// version-management section: scripts/ is dev tooling, exempt).
//
// Usage:
//   node scripts/find-desynced-legs.js
//
// Requires Node 18+ (built-in fetch). Reads the whole /trips node over the
// RTDB REST API - if your database rules require auth for reads, set an
// auth token or legacy database secret first:
//   GITTRIP_DB_AUTH=<id-token-or-database-secret> node scripts/find-desynced-legs.js
'use strict';

const DATABASE_URL = 'https://mykonos-list-default-rtdb.firebaseio.com';
const authToken = process.env.GITTRIP_DB_AUTH || '';

function fmt(value) {
    if (value === undefined) return '(missing)';
    if (value === null) return '(null)';
    return JSON.stringify(value);
}

// Small tolerance for lat/lon - both write sites (wizard.html, and the
// admin panel before this fix) store whatever Open-Meteo returns verbatim,
// so an exact mismatch here is real drift, not float noise. The epsilon
// only guards against harmless serialization differences (e.g. trailing
// zeros), not against genuinely different coordinates.
function numsDiffer(a, b) {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isNaN(na) || Number.isNaN(nb)) return a !== b;
    return Math.abs(na - nb) > 1e-6;
}

function checkTrip(tripId, trip) {
    if (!trip || !Array.isArray(trip.legs) || trip.legs.length < 2) {
        return null; // single-leg trip: trip fields ARE the one leg, nothing to desync
    }

    const first = trip.legs[0];
    const last = trip.legs[trip.legs.length - 1];
    const mismatches = [];

    // §2.1: destination/lat/lon mirror the FIRST leg
    if (trip.destination !== first.name) {
        mismatches.push(['destination', trip.destination, 'legs[0].name', first.name]);
    }
    if (numsDiffer(trip.lat, first.lat)) {
        mismatches.push(['lat', trip.lat, 'legs[0].lat', first.lat]);
    }
    if (numsDiffer(trip.lon, first.lon)) {
        mismatches.push(['lon', trip.lon, 'legs[0].lon', first.lon]);
    }

    // §4: timezone/endAt mirror the LAST leg
    if (trip.timezone !== last.timezone) {
        mismatches.push(['timezone', trip.timezone, 'legs[last].timezone', last.timezone]);
    }
    if (trip.endAt !== last.endAt) {
        mismatches.push(['endAt', trip.endAt, 'legs[last].endAt', last.endAt]);
    }

    // §4: trip.startAt and legs[0].startAt are semantically different fields
    // (creator's device clock vs. first leg's own local time) and are NOT
    // required to stay equal in general - but nothing in the current
    // codebase has a legitimate reason to change one without the other, so
    // a mismatch today is still a signal of the same bug, just a softer one.
    if (trip.startAt !== first.startAt) {
        mismatches.push(['startAt (informational - see §4)', trip.startAt, 'legs[0].startAt', first.startAt]);
    }

    return mismatches.length ? mismatches : null;
}

async function main() {
    const url = `${DATABASE_URL}/trips.json${authToken ? `?auth=${encodeURIComponent(authToken)}` : ''}`;
    console.log(`Fetching ${DATABASE_URL}/trips.json ...`);

    const res = await fetch(url);
    if (!res.ok) {
        console.error(`Request failed: ${res.status} ${res.statusText}`);
        if (res.status === 401 || res.status === 403) {
            console.error('If your database rules require auth for reads, set GITTRIP_DB_AUTH (an ID token or the legacy database secret) and try again.');
        }
        process.exit(1);
    }

    const trips = await res.json();
    if (!trips) {
        console.log('No trips found at /trips.');
        return;
    }

    const tripIds = Object.keys(trips);
    let multiLegCount = 0;
    let brokenCount = 0;

    for (const tripId of tripIds) {
        const trip = trips[tripId];
        if (Array.isArray(trip && trip.legs) && trip.legs.length > 1) multiLegCount++;

        const mismatches = checkTrip(tripId, trip);
        if (!mismatches) continue;

        brokenCount++;
        console.log(`\n⚠️  ${tripId} (${trip.destination || '?'})`);
        for (const [tripField, tripValue, legField, legValue] of mismatches) {
            console.log(`   trip.${tripField} = ${fmt(tripValue)}  !=  ${legField} = ${fmt(legValue)}`);
        }
    }

    console.log(`\n${tripIds.length} trips scanned, ${multiLegCount} multi-leg, ${brokenCount} with a mismatch.`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
