// Shared "is this user the trip's organizer" check - a pure function, no
// closure over page-specific globals, because the two page pairs that
// already had a local copy of this exact check name their auth-user and
// trip variables differently: index.html/shopping.html use
// currentUser/tripOwnerId, itinerary.html/places.html/packing.html use
// user/trip.ownerId. See CLAUDE.md's "מבנה סקריפטים בין 6 הדפים" for the
// same script-type split behind that naming difference.
//
// HISTORY: isOrganizer() already existed as an identical copy in index.html
// and shopping.html. A third, fourth and fifth copy were about to be
// written into itinerary.html/places.html/packing.html (the organizer-only
// "add your expenses link" message). Same threshold datetime.js was created
// at - 2 existing copies plus another about to be written - except here
// it's 2 copies plus 3 more at once, well past it.
//
// Deliberately NOT migrated into index.html/shopping.html's own local
// isOrganizer() in this same commit - same "two systems in parallel,
// migrate later if ever" precedent as toast.js (see CLAUDE.md). This file
// is new infrastructure for the 3 pages that had no organizer check at all
// in this flow; it doesn't touch the two pages that already worked.
//
// Loaded as a classic script on every page that uses it (no type="module"
// on its own <script> tag) and attaches to window, same pattern as
// legs.js/datetime.js.
(function () {
    function isOrganizer(user, ownerId) {
        return Boolean(user && ownerId && user.uid === ownerId);
    }

    window.isOrganizer = isOrganizer;
})();
