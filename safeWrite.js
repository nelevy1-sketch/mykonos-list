// Thin wrapper for RTDB writes that were firing without a try/catch (QA
// bug-map cluster 2 - "silent write" cluster: trip settings save,
// personalLocker, participant tags, saveModulesBtn, releaseMember, and a
// long tail of similar non-delete writes across packing/shopping/places/
// itinerary - all sharing the same shape: await a write with no catch, or
// don't even await it, then run success UI unconditionally).
//
// Deliberately has NO opinion about what happens on success or failure -
// it does not know about tr()/toast()/customAlert(), which differ per page
// (see the "שתי מערכות טוסט" note in CLAUDE.md), and it does not take
// onSuccess/onError callbacks. The "success closes this modal" vs "success
// just updates this row in place" difference between call sites is real
// and intentional - forcing it into one shape here would be wrong. Callers
// keep writing their own if/else with their own existing toast/tr calls;
// this only centralizes the try/catch + console.error + boolean result,
// which is the part that was actually missing everywhere, not the UI
// reaction, which was never the bug.
//
// Classic script (not type="module"), same reason as legs.js/datetime.js/
// member.js: index.html's main script is a classic script (Firebase compat
// v8), the other 5 pages are type="module" (Firebase modular v9) - a
// classic top-level function declaration attaches to window automatically,
// reachable from both contexts identically. member.js's window.
// autoRegisterMember already proves this exact cross-context call works.
//
// writePromise: the already-in-flight promise from whatever write call the
// caller just made (set/update/push/runTransaction, compat or modular -
// this file doesn't care which SDK shape produced the promise).
// context: optional short string identifying the call site, logged
// alongside the error so a failure in the console says WHICH write failed,
// not just "something failed" - same convention as cluster 3's
// `console.error('[file.html] X delete failed', error)` messages.
//
// Returns true if the write resolved, false if it rejected. Never throws.
async function safeWrite(writePromise, context) {
  try {
    await writePromise;
    return true;
  } catch (error) {
    console.error(`[safeWrite]${context ? " " + context : ""}`, error);
    return false;
  }
}

window.safeWrite = safeWrite;
