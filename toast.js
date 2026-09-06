// Single global toast, meant to eventually replace the per-page toast()/
// showToast() implementations in index/packing/places/itinerary/shopping.
// This commit only introduces it - nothing calls window.toast() yet, and the
// existing per-page implementations are untouched (see CHANGELOG for why).
//
// Naming note, verified empirically in a real browser (not just by reading
// the source - the two disagree):
//   - index.html declares its own top-level `function toast(message) {...}`
//     in a CLASSIC (non-module) inline script. A classic top-level function
//     declaration binds directly onto window, so once that page's own
//     script runs (always after this file - it's loaded in <head>, before
//     the page's own script), it silently overwrites window.toast with its
//     local version. That's intentional: window.toast stays dormant on
//     index.html until that local implementation is deleted in a later
//     commit.
//   - packing.html, places.html, itinerary.html and shopping.html each ALSO
//     declare a local toast()/showToast(), but inside a `<script
//     type="module">` - and a module's top-level declarations are scoped to
//     that module only, never assigned onto window. So on these 4 pages
//     window.toast is NOT overwritten - it stays live as THIS
//     implementation starting with this commit, same as wizard.html (which
//     has no local toast() at all - verified: no existing call to
//     toast(...) anywhere in that file either).
// Net effect: window.toast is dormant (shadowed) only on index.html; it's
// the live implementation on all other 5 pages.
(function () {
    var el = null;
    var hideTimer = null;

    function ensureEl() {
        if (el) return el;

        el = document.createElement('div');
        el.id = 'gtToast';
        el.className = 'gt-toast';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        document.body.appendChild(el);

        return el;
    }

    window.toast = function (message, type) {
        var node = ensureEl();

        node.textContent = message;
        node.classList.toggle('gt-toast-error', type === 'error');
        node.classList.add('show');

        clearTimeout(hideTimer);
        hideTimer = setTimeout(function () {
            node.classList.remove('show');
        }, 2600);
    };
})();
