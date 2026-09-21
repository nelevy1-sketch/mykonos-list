#!/usr/bin/env node
// One-time backfill: populate _analytics/visitorStats/{uid} for every user
// who already has existing users/{uid}/visits records, so dashboard.html's
// cross-user country/continent/capital stats aren't empty for everyone who
// used achievements.html before that mirror existed. Not app code - not
// loaded by any page, no version bump (CLAUDE.md's version-management
// section: scripts/ is dev tooling, exempt).
//
// Modeled on scripts/backfill-visits.js, but ADMIN SDK instead of a plain
// token via fetch - and for a real structural reason, not preference:
// achievements.html's own mirrorVisitorStats() writes only *its own* uid's
// entry (database.rules.json's _analytics/visitorStats/$uid.write is
// "auth.uid === $uid", same ownership shape as users/$uid itself) - correct
// for a live user's own browser, but this script needs to write EVERY
// user's entry from one process. backfill-visits.js's own file header
// already worked through this exact tradeoff for an adjacent problem
// (reading across all of users/{uid}/visits for the idempotency check) and
// documented, from an actual production test (not a guess): a normal
// signed-in token gets a flat 401 on /users.json - only the database
// secret or Admin SDK credentials can read that whole tree. Since this
// script's entire job IS reading every uid's visits (not just checking
// against them), Admin SDK is a hard requirement here, not an upgrade.
//
// The Admin SDK also means this script does NOT need backfill-visits.js's
// memberProfiles-based UID-discovery dance at all - Admin SDK bypasses
// database.rules.json entirely (same as functions/index.js's own
// admin.database() calls), so it can just read /users.json directly in
// one call and iterate every uid found there.
//
// firebase-admin is required from functions/node_modules (already an
// installed, in-use dependency there - see functions/index.js) rather than
// adding a second copy via a new root-level package.json/node_modules just
// for this one script.
//
// IDEMPOTENT BY CONSTRUCTION, more simply than backfill-visits.js: each
// write here is a set() (full overwrite of _analytics/visitorStats/{uid}),
// not a push() (new record every time) - re-running this script any number
// of times just recomputes and overwrites the same mirror from the same
// source data, with no duplicate-record risk to guard against at all.
//
// computeCountryVisitInfo() and the trimmed-visit field selection below are
// duplicated from achievements.html's own mirrorVisitorStats()/
// computeCountryVisitInfo() in plain-Node form - same reasoning as
// backfill-visits.js's own duplication of legs.js/legGeocode.js logic
// (browser-only `window`-attached code has no Node equivalent to import),
// not a rewrite: the logic itself is unchanged, byte-for-byte the same
// field reads and dedup rules.
//
// Usage (dry run by default - reports what WOULD be written, writes nothing):
//   node scripts/backfill-visitor-stats.js
// Usage (writes the mirror to RTDB):
//   node scripts/backfill-visitor-stats.js --apply
//
// Requires a service account with Admin SDK access to this Firebase
// project, via the standard GOOGLE_APPLICATION_CREDENTIALS env var (a
// service-account JSON key path - Firebase Console -> Project Settings ->
// Service Accounts -> Generate new private key) or any other Application
// Default Credentials source (e.g. `gcloud auth application-default
// login`). Not a GitTrip-specific env var - this is the Admin SDK's own
// standard credential discovery, same as functions/index.js relies on
// implicitly when deployed.
'use strict';

const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const DATABASE_URL = 'https://mykonos-list-default-rtdb.firebaseio.com';
const apply = process.argv.includes('--apply');

// --- Duplicated from achievements.html's computeCountryVisitInfo(visits) -
// same field reads (countryCode, source), same dedup-by-country-code
// shape. Not reimplemented differently - copied. ---
function computeCountryVisitInfo(visits) {
    const info = {};
    Object.values(visits || {}).forEach(v => {
        if (!v || !v.countryCode) return;
        const cc = String(v.countryCode).toUpperCase();
        if (!info[cc]) info[cc] = { hasApp: false, hasManual: false, count: 0 };
        info[cc].count++;
        if (v.source === 'app') info[cc].hasApp = true;
        else if (v.source === 'manual') info[cc].hasManual = true;
    });
    return info;
}

// --- Duplicated from achievements.html's mirrorVisitorStats()'s own
// trimming - only the 3 fields any of computeCountryVisitInfo/
// computeContinentVisitInfo/computeStats/computeCityVisitInfo actually
// read (source, countryCode, cityName), dropping ownerName/timestamps/
// tripId/legId, which no aggregate stat needs. ---
function trimVisits(visits) {
    return Object.values(visits || {})
        .filter(v => v && v.countryCode)
        .map(v => ({
            source: v.source || null,
            countryCode: v.countryCode,
            cityName: v.cityName || null
        }));
}

async function main() {
    console.log(apply ? 'Running in APPLY mode - will write _analytics/visitorStats/{uid} to RTDB.' : 'Running in DRY-RUN mode - reporting only, nothing will be written. Pass --apply to write.');

    admin.initializeApp({ databaseURL: DATABASE_URL });
    const db = admin.database();

    console.log('Fetching /users.json via Admin SDK (bypasses database.rules.json entirely - same mechanism functions/index.js already uses) ...');
    const usersSnapshot = await db.ref('users').once('value');
    const users = usersSnapshot.val() || {};

    let usersScanned = 0;
    let usersWithVisits = 0;
    let usersSkippedNoCountryData = 0;
    let mirrorsWritten = 0;
    const perUserReport = [];

    for (const [uid, userNode] of Object.entries(users)) {
        usersScanned++;

        if (!userNode || !userNode.visits) continue;

        const visits = userNode.visits;
        const trimmedVisits = trimVisits(visits);

        if (!trimmedVisits.length) {
            usersSkippedNoCountryData++;
            perUserReport.push(`  ✗ ${uid} - has a visits/ node but no entry with a countryCode, skipped`);
            continue;
        }

        usersWithVisits++;

        const mirror = {
            countryVisitInfo: computeCountryVisitInfo(visits),
            visits: trimmedVisits,
            updatedAt: Date.now()
        };

        const countryCount = Object.keys(mirror.countryVisitInfo).length;
        perUserReport.push(`  ${apply ? '✓' : '·'} ${uid} - ${trimmedVisits.length} visit(s), ${countryCount} distinct countr${countryCount === 1 ? 'y' : 'ies'} -> _analytics/visitorStats/${uid}`);

        if (apply) {
            try {
                await db.ref(`_analytics/visitorStats/${uid}`).set(mirror);
                mirrorsWritten++;
            } catch (err) {
                console.error(`    ⚠️  write failed for _analytics/visitorStats/${uid}: ${err.message}`);
            }
        } else {
            mirrorsWritten++; // counts as "would be written" in dry-run
        }
    }

    console.log('\n--- Per-user detail ---');
    perUserReport.forEach(line => console.log(line));

    console.log('\n--- Summary ---');
    console.log(`${usersScanned} user(s) scanned under /users.`);
    console.log(`${usersWithVisits} user(s) have at least one visit with a countryCode, ${usersSkippedNoCountryData} skipped (visits/ exists but nothing usable in it).`);
    console.log(`${mirrorsWritten} mirror(s) ${apply ? 'written' : 'would be written'} to _analytics/visitorStats/{uid}.`);

    if (!apply && mirrorsWritten > 0) {
        console.log('\nThis was a dry run - nothing was written. Re-run with --apply to write these to RTDB.');
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
