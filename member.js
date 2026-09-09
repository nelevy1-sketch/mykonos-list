// Shared "auto-register a joining member" logic - first-run onboarding
// change (docs/roadmap.md, part 3, item 0). Same pattern as legs.js/
// datetime.js: a plain classic script (no type="module"), loaded on all
// 5 auth-gated pages (index/packing/places/itinerary/shopping - NOT
// wizard.html, which has no trip/auth-gate yet). A top-level function
// declaration in a classic script attaches to window automatically, so
// this is reachable identically from index.html's own classic script and
// from the other 5 pages' `type="module"` scripts, without an import -
// see CLAUDE.md's "מבנה סקריפטים בין 6 הדפים" for why that split exists
// and why it matters here specifically.
//
// This file never calls Firebase directly. index.html is Firebase compat
// v8 (`db.ref(path).once(...)`, `.transaction(fn, onComplete, applyLocally)`);
// the other 4 gated pages are modular v9 (`get(ref(db,path))`,
// `runTransaction(ref(db,path), fn, {applyLocally})`) - two genuinely
// different call shapes for the same operations, not a style preference.
// autoRegisterMember() below owns only the DECISION sequence (compute a
// name, claim, write, roll back on failure) - each page supplies its own
// SDK-flavored implementation of the actual reads/writes via `ops`.
function participantKey(value) {
  const bytes = new TextEncoder().encode(String(value).trim());
  let raw = "";

  bytes.forEach(byte => {
    raw += String.fromCharCode(byte);
  });

  return btoa(raw)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Registers the signed-in user as a trip member WITHOUT asking them to
// pick a name from the organizer's list - the whole point of this change.
// Call this ONLY after the caller has already confirmed there is no
// existing memberProfiles/{uid} for this trip; it does not check itself
// (every page already does that fetch as its own first step - no reason
// to make it twice).
//
// Claims are keyed by the user's own uid (participantKey(ops.uid)), NOT
// by their display name - two different real people can share a display
// name ("Dani Cohen") with zero collision, since uids are unique by
// construction. This also means ops.tryClaim below should, under normal
// operation, always succeed: a claim key derived from MY OWN uid can
// never already be held by a DIFFERENT uid, since nobody else's own-uid-
// keyed claim could ever land on this same key. The organizer's
// participants list, if any, is no longer a gate at all - just an
// optional, admin-panel-only tracking list (see the "already linked"
// UI in each page's OWN roster-select fallback, which still reads
// participantClaims by NAME for whatever's left of that list - untouched
// by this function, since it writes a uid-keyed claim under a different
// key entirely).
//
// ops:
//   uid, displayName, email, photoURL: from the Firebase Auth user object
//   fallbackName: shown when displayName AND email are both falsy
//     (page-provided so the tr() text stays page-local, not duplicated
//     here as a hardcoded string in a script with no tr() of its own)
//   tryClaim(key, uid) -> Promise<boolean>: attempt the transaction,
//     resolve true only if it committed with this uid as the value
//   writeProfile(profile) -> Promise<void>: write memberProfiles/{uid}
//   rollbackClaim(key, uid) -> Promise<void>: null the claim back out if
//     writeProfile fails after a successful claim - mirrors the existing
//     rollback every page's own manual-claim flow already does
async function autoRegisterMember(ops) {
  const key = participantKey(ops.uid);
  const name = ops.displayName || ops.email || ops.fallbackName;

  let claimed = false;

  try {
    claimed = await ops.tryClaim(key, ops.uid);
  } catch (error) {
    console.error("[member.js] autoRegisterMember: claim failed", error);
    throw error;
  }

  if (!claimed) {
    // Structurally shouldn't happen for a uid-keyed claim (see the
    // comment above) - not treated as fatal, since the one real case is
    // this same user's own claim already sitting there from an earlier
    // attempt whose profile write never completed (e.g. a dropped
    // connection between the two steps). Proceed to the profile write
    // below rather than dead-ending the user over it.
    console.warn("[member.js] autoRegisterMember: claim did not report committed for", key);
  }

  const profile = {
    name,
    participantKey: key,
    email: ops.email || "",
    photoURL: ops.photoURL || "",
    updatedAt: Date.now()
  };

  try {
    await ops.writeProfile(profile);
  } catch (error) {
    try {
      await ops.rollbackClaim(key, ops.uid);
    } catch (rollbackError) {
      console.error("[member.js] autoRegisterMember: rollback also failed", rollbackError);
    }

    throw error;
  }

  return profile;
}

window.participantKey = participantKey;
window.autoRegisterMember = autoRegisterMember;
