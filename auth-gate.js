// Shared safety net for the full-screen #authLoading gate every trip page
// shows until its first onAuthStateChanged callback fires.
//
// On iOS, a tab frozen in the background for a while can come back with
// Firebase's internal auth state-check permanently stuck (a known WebKit
// IndexedDB/connection issue) - with nothing else in place, the spinner
// just spins forever and the user has no way out short of closing the
// whole browser. This does not fix that underlying connection problem -
// it just makes sure the user is never stuck looking at an infinite
// spinner with no recourse.
//
// Usage (once per page, right where the page sets up its
// onAuthStateChanged listener):
//   window.armAuthGate(() => handleAuthStateChanged(auth.currentUser));
//
// The retry callback should re-run the exact same logic the page's own
// onAuthStateChanged callback runs, using the SDK's synchronous
// auth.currentUser as a fallback in case the async initial check itself
// is what's stuck. If auth.currentUser is still null, the callback
// should do nothing (not treat that as "signed out") - the overlay
// reappears and a fresh timeout starts, giving the still-attached
// onAuthStateChanged listener more time to fire on its own.
//
// Important: this never touches #authLoading's own hidden class itself -
// it only ever reads it. The timeout UI is painted on top of the spinner
// (a higher z-index), so the one and only place that hides #authLoading
// is still the page's own existing code, on the normal success path. A
// single MutationObserver watches for that and clears everything -
// whether the page resolves on its own while the timeout UI is showing,
// or after the user clicks retry, both are handled the same way.
(function () {
  var TIMEOUT_MS = 12000;
  var timeoutId = null;
  var observer = null;
  var overlay = null;
  var currentRetry = null;

  function isEnglish() {
    return document.documentElement.lang === "en";
  }

  function authLoadingEl() {
    return document.getElementById("authLoading");
  }

  function buildOverlay() {
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = "authGateTimeout";
    overlay.className = "auth-gate-timeout hidden";
    overlay.setAttribute("role", "alertdialog");
    overlay.innerHTML =
      '<div class="auth-gate-timeout-card">' +
      '<p class="auth-gate-timeout-text"></p>' +
      '<button type="button" class="auth-gate-timeout-btn"></button>' +
      "</div>";

    document.body.appendChild(overlay);

    overlay
      .querySelector(".auth-gate-timeout-btn")
      .addEventListener("click", function () {
        overlay.classList.add("hidden");

        var retry = currentRetry;
        armAuthGate(retry);

        if (typeof retry === "function") retry();
      });

    return overlay;
  }

  function showTimeoutUI() {
    timeoutId = null;

    var isEn = isEnglish();
    var box = buildOverlay();

    box.querySelector(".auth-gate-timeout-text").textContent = isEn
      ? "This is taking longer than expected. Check your connection and try again."
      : "זה לוקח יותר זמן מהצפוי. בדקו את החיבור ונסו שוב.";

    box.querySelector(".auth-gate-timeout-btn").textContent = isEn
      ? "Try again"
      : "נסה שוב";

    box.classList.remove("hidden");
  }

  function stopWatching() {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function armAuthGate(retryFn, timeoutMs) {
    currentRetry = retryFn;
    stopWatching();

    var el = authLoadingEl();
    if (!el || el.classList.contains("hidden")) return;

    timeoutId = setTimeout(showTimeoutUI, timeoutMs || TIMEOUT_MS);

    observer = new MutationObserver(function () {
      if (el.classList.contains("hidden")) {
        stopWatching();
        if (overlay) overlay.classList.add("hidden");
      }
    });

    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
  }

  window.armAuthGate = armAuthGate;
})();
