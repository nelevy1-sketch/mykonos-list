// knownUsers.js - shared "track known-user first/last seen" logic
// (_analytics/knownUsers/{uid} - dashboard.html's "unique users ever" +
// "active in the last 7/30 days" metrics). Classic script, window-attached
// - same pattern as legs.js/datetime.js/legGeocode.js (CLAUDE.md, "מבנה
// סקריפטים בין 6 העמודים") - loaded on all 7 pages (the 6 main app pages +
// achievements.html), same reach as the sign-in-logging feature this
// reuses the exact connection point from (handleAuthStateChanged's own
// null->user transition, see each page's own wiring).
//
// Same ops-injection pattern as member.js (already established in this
// codebase, not invented fresh here): this file owns the DECISION
// sequence (write firstSeen exactly once, always refresh lastSeen), each
// page supplies its own SDK-flavored transaction/update calls via `ops` -
// same underlying reason member.js does this: index.html is Firebase
// compat v8 (`ref.transaction(fn)`, `ref.update(obj)`); the other 6 pages
// are modular v9 (`runTransaction(ref, fn)`, `update(ref, obj)`) - two
// genuinely different call shapes for the same two operations, not a
// style preference.
//
// The transaction's own update-function (the `current => ...` closure
// below) needs NO per-SDK variant at all, unlike the outer call: Firebase
// documents the identical contract in both generations - the function
// receives the current value and returns the new value, and returning
// undefined aborts the transaction with no write. That closure is the one
// genuinely tricky piece of logic here (the "never overwrite an existing
// firstSeen" guarantee) - keeping it in this one shared file, not
// reimplemented 7 times, is the actual point of centralizing this at all.
//
// ops:
//   transactionFirstSeen(updateFn) -> Promise<void> - run updateFn as a
//     transaction against _analytics/knownUsers/{uid}/firstSeen
//   updateLastSeen(nowIso) -> Promise<void> - plain update() writing
//     { lastSeen: nowIso } at _analytics/knownUsers/{uid}
//
// Both calls are independently best-effort - a failure in one (e.g. the
// firstSeen transaction losing a race, or a dropped connection) must
// never block the other, and neither should ever surface to the user
// (this is background analytics, not something a sign-in should be
// gated on) - console.warn only, matching this app's own established
// silent-failure convention.
async function trackKnownUser(ops) {
  const nowIso = new Date().toISOString();

  try {
    await ops.transactionFirstSeen(current => {
      if (current) return undefined; // already set - never overwrite the original firstSeen
      return nowIso;
    });
  } catch (error) {
    console.warn("[knownUsers] firstSeen transaction failed", error);
  }

  try {
    await ops.updateLastSeen(nowIso);
  } catch (error) {
    console.warn("[knownUsers] lastSeen update failed", error);
  }
}

window.trackKnownUser = trackKnownUser;
