#!/usr/bin/env node
// One-time backfill: create users/{uid}/visits/{visitId} records for every
// existing leg that already qualifies as a "real visit" (docs/schema-legs.md-
// adjacent investigation, gamification achievement-map), so a user's first
// look at the map doesn't show gaps for trips they already took with this
// app before the feature existed. Not app code - not loaded by any page, no
// version bump (CLAUDE.md's version-management section: scripts/ is dev
// tooling, exempt).
//
// Same approach as scripts/backfill-place-coordinates.js - a plain Node
// script reading/writing the RTDB REST API directly via fetch, not the
// Admin SDK, not window.* (legs.js/legGeocode.js/datetime.js all attach to
// `window`, which doesn't exist in Node - their logic is duplicated here in
// plain-Node form, same reasoning as that script's own comment on why it
// duplicates geocode.js instead of restructuring a browser-only file).
//
// No external API calls here at all (unlike the coordinates backfill) -
// every leg already has countryCode from legGeocode.js, no geocoding
// needed. So there's no Nominatim-style rate limit to respect; writes go to
// our own database, plain sequential awaits, no artificial delay.
//
// CREDIT MODEL (decided explicitly, not assumed): every member of a trip
// gets credit for a qualifying leg, not just the trip's ownerId - a group
// trip's visit should credit everyone who was there, not just whoever
// happened to click "create trip".
//
// MEMBERSHIP SOURCE: trips/{tripId}/memberProfiles (keyed by uid), not
// trip.ownerId and not users/{uid}/trips. Two reasons:
//   1. trip.ownerId doesn't exist on every trip - wizard.html's
//      deleteRecentTrip() and index.html's own delete-trip handler both
//      have their own "trip predates this field" fallback comments.
//      memberProfiles has no such gap - every member who ever opened the
//      trip and set up a profile is in there, independent of ownerId.
//   2. memberProfiles is readable with the SAME credential this script
//      already needs for /trips.json (database.rules.json: trips/$tripId's
//      own .read is "auth != null" - unrestricted by uid, and there is no
//      narrower read rule on memberProfiles to override that cascade). The
//      users/{uid}/trips mirror was considered first but rejected: reading
//      it for every user in the app means reading /users.json as a whole
//      tree, which users/$uid's rule ("auth.uid === $uid") does NOT permit
//      for any single token - confirmed directly (curl, no auth, against
//      the live database: 401). Only the legacy database secret or
//      Admin SDK credentials can read that whole tree - memberProfiles
//      avoids needing that just to answer "who was on this trip".
//
// IDEMPOTENT BY DESIGN - safe to re-run - BUT THIS HALF STILL NEEDS THE
// DATABASE SECRET (or Admin SDK credentials), not just any signed-in user's
// token: checking "does this user already have an app-sourced visit for
// this trip/leg" means reading users/{uid}/visits for uids that aren't the
// token's own - and users/$uid's rule blocks exactly that for a normal
// token, for the same reason as above. Deliberately NOT a hard requirement
// for the whole script, though: a normal token can still run a full DRY RUN
// (shows every candidate visit that would be created, from /trips.json +
// memberProfiles alone) - it just can't tell you which of those already
// exist. --apply refuses to run unless the idempotency read succeeded, so a
// real write never happens without that safety net in place - see
// idempotencyAvailable below.
//
// Usage (dry run by default - reports what WOULD be written, writes nothing):
//   node scripts/backfill-visits.js
// Usage (writes visit records to RTDB - requires the database secret, see above):
//   node scripts/backfill-visits.js --apply
//
// Requires Node 18+ (built-in fetch, and Intl.DateTimeFormat with a
// `timeZone` option - both are already relied on elsewhere in this repo,
// e.g. scripts/find-desynced-legs.js).
//   GITTRIP_DB_AUTH=<id-token-or-database-secret> node scripts/backfill-visits.js [--apply]
'use strict';

const DATABASE_URL = 'https://mykonos-list-default-rtdb.firebaseio.com';
// .trim() - see backfill-place-coordinates.js's own comment: a stray
// trailing space/newline from copy-pasting the token silently corrupts it,
// and RTDB's REST API can't tell an invalid token from a whitespace-
// corrupted one from no token at all - all three return the same 401.
const authToken = (process.env.GITTRIP_DB_AUTH || '').trim();
const apply = process.argv.includes('--apply');

function authSuffix() {
    return authToken ? `?auth=${encodeURIComponent(authToken)}` : '';
}

// --- Duplicated leg-normalization logic (legs.js's getLegs(), Node form) ---
// A trip with a real, non-empty trip.legs array uses it verbatim. Otherwise
// synthesize the single implied leg from the trip's own top-level fields -
// exactly legs.js's own fallback shape, so a pre-legs trip is treated
// identically here to how the live app already treats it.
function getLegsFor(trip) {
    if (Array.isArray(trip.legs) && trip.legs.length) {
        return trip.legs;
    }
    return [{
        id: 'main',
        name: trip.destination,
        countryCode: trip.countryCode || null,
        // cityName/region don't exist yet at the trip level (legGeocode.js's
        // v4.75.0 addition is leg-level and forward-only) - a synthesized
        // single leg from an old trip has neither, same as a real old leg.
        cityName: null,
        timezone: trip.timezone,
        startAt: trip.startAt,
        endAt: trip.endAt
    }];
}

// --- Duplicated calendar-day-key logic (datetime.js's zonedParts/
// dateKeyInZone, and legs.js's isRealVisit, Node form) ---
// Node's Intl.DateTimeFormat supports the `timeZone` option the same as a
// browser's - already relied on elsewhere in this repo (see
// scripts/find-desynced-legs.js) - so this is a faithful port, not an
// approximation.
function dateKeyInZone(date, timeZone) {
    if (!timeZone) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date).reduce((acc, p) => {
        if (p.type !== 'literal') acc[p.type] = p.value;
        return acc;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
}

// Same criterion as legs.js's isRealVisit() - at least one night, via
// calendar-day-key comparison, not endAt-startAt>=24h. See that function's
// own comment for why the raw-hours version is wrong (a real ~10h overnight
// stay would silently read as "no visit").
function isRealVisit(leg) {
    if (!leg || !leg.startAt || !leg.endAt) return false;
    const tz = leg.timezone || null;
    const startKey = dateKeyInZone(new Date(leg.startAt), tz);
    const endKey = dateKeyInZone(new Date(leg.endAt), tz);
    return startKey !== endKey;
}

async function main() {
    console.log(apply ? 'Running in APPLY mode - will write visit records to RTDB.' : 'Running in DRY-RUN mode - reporting only, nothing will be written. Pass --apply to write.');

    console.log('Fetching /trips.json ...');
    const tripsRes = await fetch(`${DATABASE_URL}/trips.json${authSuffix()}`);
    if (!tripsRes.ok) {
        console.error(`Request for /trips.json failed: ${tripsRes.status} ${tripsRes.statusText}`);
        if (tripsRes.status === 401 || tripsRes.status === 403) {
            console.error('If your database rules require auth for reads, set GITTRIP_DB_AUTH (an ID token or the legacy database secret) and try again.');
        }
        process.exit(1);
    }
    const trips = (await tripsRes.json()) || {};

    // uid -> Set("tripId:legId") - existing app-sourced visits, for the
    // idempotency check. Requires reading /users.json as a whole tree -
    // only the database secret (or Admin SDK credentials) can do that, see
    // the file header. Attempted, but NOT fatal if it fails - a normal
    // token still gets a full dry-run preview, just without this check.
    const existingVisitsByUser = new Map();
    let idempotencyAvailable = false;

    console.log('Fetching /users.json for the idempotency check (requires the database secret / admin credentials - see file header) ...');
    try {
        const usersRes = await fetch(`${DATABASE_URL}/users.json${authSuffix()}`);
        if (usersRes.ok) {
            const users = (await usersRes.json()) || {};
            for (const [uid, userNode] of Object.entries(users)) {
                const existingKeys = new Set();
                if (userNode && userNode.visits) {
                    for (const visit of Object.values(userNode.visits)) {
                        if (visit && visit.source === 'app' && visit.tripId && visit.legId) {
                            existingKeys.add(`${visit.tripId}:${visit.legId}`);
                        }
                    }
                }
                existingVisitsByUser.set(uid, existingKeys);
            }
            idempotencyAvailable = true;
        } else {
            console.warn(`  /users.json returned ${usersRes.status} ${usersRes.statusText} - proceeding WITHOUT idempotency protection.`);
        }
    } catch (err) {
        console.warn(`  /users.json fetch failed (${err.message}) - proceeding WITHOUT idempotency protection.`);
    }

    if (apply && !idempotencyAvailable) {
        console.error('\nRefusing to run --apply without the idempotency check available (see warning above) - re-running without it risks creating duplicate visit records. Re-run with GITTRIP_DB_AUTH set to the database secret / admin credentials, or run without --apply for a preview.');
        process.exit(1);
    }

    let tripsScanned = 0;
    let legsScanned = 0;
    let legsQualified = 0;
    let legsSkippedNoCountry = 0;
    let tripsSkippedNoMembers = 0;
    let candidateWrites = 0; // (uid, leg) pairs that would be new visit records
    let alreadyExisting = 0;
    const perTripReport = [];

    for (const [tripId, trip] of Object.entries(trips)) {
        if (!trip || typeof trip !== 'object') continue;
        tripsScanned++;

        const members = new Set(Object.keys(trip.memberProfiles || {}));
        if (members.size === 0) {
            tripsSkippedNoMembers++;
            perTripReport.push(`  ✗ ${tripId} (${trip.destination || '?'}) - no memberProfiles found, skipped entirely`);
            continue;
        }

        const legs = getLegsFor(trip);

        for (const leg of legs) {
            legsScanned++;

            if (!isRealVisit(leg)) continue; // same-day/stopover, or missing dates - not a "real visit"

            if (!leg.countryCode) {
                legsSkippedNoCountry++;
                continue;
            }

            legsQualified++;

            for (const uid of members) {
                const key = `${tripId}:${leg.id}`;
                if (existingVisitsByUser.get(uid)?.has(key)) {
                    alreadyExisting++;
                    continue;
                }

                candidateWrites++;
                const record = {
                    source: 'app',
                    countryCode: leg.countryCode,
                    cityName: leg.cityName || leg.name || null,
                    tripId,
                    legId: leg.id,
                    visitedAt: leg.startAt,
                    createdAt: new Date().toISOString()
                };

                perTripReport.push(`  ${apply ? '✓' : '·'} ${tripId}/${leg.id} (${leg.cityName || leg.name}, ${leg.countryCode}) -> users/${uid}/visits`);

                if (apply) {
                    const postRes = await fetch(`${DATABASE_URL}/users/${uid}/visits.json${authSuffix()}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(record)
                    });
                    if (!postRes.ok) {
                        console.error(`    ⚠️  write failed for users/${uid}/visits (trip ${tripId}, leg ${leg.id}): ${postRes.status} ${postRes.statusText}`);
                    }
                }
            }
        }
    }

    console.log('\n--- Per-trip detail ---');
    perTripReport.forEach(line => console.log(line));

    console.log('\n--- Summary ---');
    console.log(`${tripsScanned} trip(s) scanned, ${tripsSkippedNoMembers} skipped (no resolvable members).`);
    console.log(`${legsScanned} leg(s) scanned, ${legsQualified} qualified as a real visit (>=1 night), ${legsSkippedNoCountry} qualified but skipped (no countryCode - failed geocode).`);
    console.log(`${candidateWrites} visit record(s) ${apply ? 'written' : 'would be written'}, ${alreadyExisting} already existed (skipped - idempotent).`);
    if (!idempotencyAvailable) {
        console.log('NOTE: idempotency check was unavailable (see warning above) - the counts above assume nothing exists yet. Re-run with the database secret set to get an accurate "already existed" count before trusting this preview fully.');
    }

    if (!apply && candidateWrites > 0) {
        console.log('\nThis was a dry run - nothing was written. Re-run with --apply to write these to RTDB.');
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
