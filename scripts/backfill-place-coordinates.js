#!/usr/bin/env node
// One-time backfill: geocode every existing places/{id} that predates
// commit 1/5 of the trip-route-map feature and has no lat/lon yet.
//
// Same approach as scripts/find-desynced-legs.js - a plain Node script
// reading/writing the RTDB REST API directly via fetch, not the Admin SDK.
// Not app code - not loaded by any page, no version bump (see CLAUDE.md's
// version-management section: scripts/ is dev tooling, exempt).
//
// Deliberately NOT a copy of geocode.js's browser-side window.geocodeName -
// that file attaches to `window`, which doesn't exist in Node. The geocoding
// call itself is duplicated here (same Nominatim endpoint, same single-
// attempt-no-retry logic, same reasoning - see geocode.js's own comment for
// why there's no retry) rather than restructuring a browser-only shared file
// just to also run in Node for a script that runs once.
//
// Nominatim's usage policy (operations.osmfoundation.org/policies/nominatim/,
// checked directly - see geocode.js): max 1 request/second. This script is
// exactly the kind of batch loop that policy is worried about, unlike
// geocode.js's own one-place-at-a-time save-time use - DELAY_MS below is not
// optional and must never be removed or shortened to "speed this up".
//
// Usage (dry run by default - reports what WOULD change, writes nothing):
//   node scripts/backfill-place-coordinates.js
// Usage (writes lat/lon back to RTDB for every place that resolves):
//   node scripts/backfill-place-coordinates.js --apply
//
// Requires Node 18+ (built-in fetch). Reads/writes require the same auth as
// find-desynced-legs.js's read:
//   GITTRIP_DB_AUTH=<id-token-or-database-secret> node scripts/backfill-place-coordinates.js [--apply]
'use strict';

const DATABASE_URL = 'https://mykonos-list-default-rtdb.firebaseio.com';
// .trim() - a stray trailing space/newline from copy-pasting the token
// (PowerShell, a terminal, a text file) silently corrupts it, and RTDB's
// REST API can't tell the difference: an invalid token, a whitespace-
// corrupted token, and no token at all all return the exact same
// {"error":"Permission denied"} 401 - confirmed directly against the live
// API, not assumed. Doesn't fix every possible auth failure (e.g. legacy
// database secrets disabled for this project entirely), but removes this
// one silent, indistinguishable failure mode.
const authToken = (process.env.GITTRIP_DB_AUTH || '').trim();
const apply = process.argv.includes('--apply');

// Same 1 req/sec ceiling as geocode.js's own comment - a small margin above
// the documented floor, not the floor itself.
const DELAY_MS = 1100;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function authSuffix() {
    return authToken ? `?auth=${encodeURIComponent(authToken)}` : '';
}

// Single attempt only, no retry - same reasoning as geocode.js: Nominatim's
// accept-language only changes the response's display language, never what
// gets matched, so a same-string retry under a different language flag
// would just resend an identical request for no benefit. See geocode.js's
// own comment for the verified findings this is based on.
//
// User-Agent header is required here in a way geocode.js's browser version
// doesn't need to worry about - confirmed directly: Node's own fetch sends
// no identifying header at all, and Nominatim returns a hard 403 for every
// request without one ("Access denied", not a silent empty result - this
// was caught by testing against the live API, not assumed). geocode.js
// instead relies on the browser's own automatic Referer header, which
// satisfies the same policy requirement passively - a page has one, a bare
// Node script does not, so this one has to set User-Agent explicitly (Node,
// unlike a browser, has no restriction against a script setting it).
const USER_AGENT = 'GitTrip-backfill-script/1.0 (+https://github.com/nelevy1-sketch/mykonos-list)';

async function geocodePlace(name) {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name)}&format=json&limit=1&accept-language=he`,
            { headers: { 'User-Agent': USER_AGENT } }
        );

        if (!response.ok) return null;

        const data = await response.json();
        const match = data?.[0];

        return match ? { lat: Number(match.lat), lon: Number(match.lon) } : null;
    } catch {
        return null;
    }
}

async function main() {
    console.log(apply ? 'Running in APPLY mode - will write lat/lon back to RTDB.' : 'Running in DRY-RUN mode - reporting only, nothing will be written. Pass --apply to write.');

    const tripsUrl = `${DATABASE_URL}/trips.json${authSuffix()}`;
    console.log(`Fetching ${DATABASE_URL}/trips.json ...`);

    const res = await fetch(tripsUrl);
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

    // Collect every place missing lat/lon, across every trip, before
    // geocoding any of them - so the delay loop below only ever waits
    // between actual Nominatim calls, never between trips/places that
    // don't need one.
    const candidates = [];
    for (const [tripId, trip] of Object.entries(trips)) {
        const items = trip?.places?.items;
        if (!items) continue;

        for (const [placeId, place] of Object.entries(items)) {
            if (!place || typeof place.name !== 'string' || !place.name.trim()) continue;
            if (place.lat !== undefined && place.lon !== undefined) continue; // already geocoded
            candidates.push({ tripId, placeId, name: place.name });
        }
    }

    console.log(`${candidates.length} place(s) missing lat/lon, across ${Object.keys(trips).length} trip(s).`);

    let fixed = 0;
    const failedNames = [];

    for (let i = 0; i < candidates.length; i++) {
        const { tripId, placeId, name } = candidates[i];

        const geo = await geocodePlace(name);

        if (geo) {
            fixed++;
            console.log(`  ✓ ${name} -> lat:${geo.lat} lon:${geo.lon}`);

            if (apply) {
                const placeUrl = `${DATABASE_URL}/trips/${tripId}/places/items/${placeId}.json${authSuffix()}`;
                const patchRes = await fetch(placeUrl, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ lat: geo.lat, lon: geo.lon })
                });

                if (!patchRes.ok) {
                    console.error(`    ⚠️  write failed for ${tripId}/${placeId}: ${patchRes.status} ${patchRes.statusText}`);
                }
            }
        } else {
            failedNames.push(name);
            console.log(`  ✗ ${name} - not located`);
        }

        // Only wait if another Nominatim call is still coming - no trailing
        // delay after the last one.
        if (i < candidates.length - 1) {
            await sleep(DELAY_MS);
        }
    }

    console.log('\n--- Summary ---');
    console.log(`${candidates.length} place(s) scanned, ${fixed} fixed, ${failedNames.length} not located.`);

    if (failedNames.length) {
        console.log('\nNot located (check against geocode.js\'s known limits - Hebrew definite article "ה-", uneven OSM tagging coverage):');
        failedNames.forEach(name => console.log(`  - ${name}`));
    }

    if (!apply && fixed > 0) {
        console.log('\nThis was a dry run - nothing was written. Re-run with --apply to write these back to RTDB.');
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
