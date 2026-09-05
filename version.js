// Single source of truth for the app version.
//
// Bump this - and add a matching entry at the top of CHANGELOG.md - on every
// release. All 6 pages load this file and read window.APP_VERSION instead of
// hardcoding the string, so the version can never go stale on just one page
// the way "v4.0.0" had on four of them (as an invisible <!-- --> comment)
// while two others showed it live in their footer, and CHANGELOG.md had
// already moved on to v4.0.3.
window.APP_VERSION = "4.7.0";

// GitHub Pages caches every file (HTML included) for up to 10 minutes, so a tab
// left open - or a PWA resumed from the home screen - never re-fetches anything
// on its own and can silently sit on stale code indefinitely. When the tab
// regains visibility, re-fetch this same file bypassing the cache and compare;
// if the deployed version moved on, show a small dismissible banner rather than
// forcing a reload. Runs on all 6 pages since they all load this file.
(function () {
    let checking = false;
    let shown = false;

    function showUpdateBanner() {
        if (shown || document.getElementById('gittrip-update-banner')) return;
        shown = true;
        const isEn = document.documentElement.lang === 'en';

        const style = document.createElement('style');
        style.textContent = `
            #gittrip-update-banner{position:fixed;top:0;inset-inline:0;z-index:9999;display:flex;align-items:center;justify-content:center;gap:8px;padding:7px 14px;padding-top:calc(7px + env(safe-area-inset-top));background:#18324A;color:#fff;font:600 .74rem/1.3 Assistant,system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.18)}
            [data-theme="dark"] #gittrip-update-banner{background:#0F3E63}
            #gittrip-update-banner button{font:inherit;border:none;border-radius:999px;cursor:pointer}
            #gittrip-update-banner .gittrip-refresh{background:#2A9D8F;color:#fff;padding:3px 12px}
            #gittrip-update-banner .gittrip-dismiss{background:transparent;color:#fff;opacity:.7;padding:3px 7px;font-size:.9rem}
        `;
        document.head.appendChild(style);

        const banner = document.createElement('div');
        banner.id = 'gittrip-update-banner';
        banner.setAttribute('role', 'status');
        banner.innerHTML = `
            <span>${isEn ? 'A new version is available' : 'גרסה חדשה זמינה'}</span>
            <button type="button" class="gittrip-refresh">${isEn ? 'Refresh' : 'רענון'}</button>
            <button type="button" class="gittrip-dismiss" aria-label="${isEn ? 'Dismiss' : 'סגירה'}">✕</button>
        `;
        banner.querySelector('.gittrip-refresh').addEventListener('click', () => location.reload());
        banner.querySelector('.gittrip-dismiss').addEventListener('click', () => banner.remove());
        document.body.appendChild(banner);
    }

    function checkForUpdate() {
        if (checking || shown) return;
        checking = true;
        fetch('version.js', { cache: 'no-store' })
            .then(res => res.text())
            .then(text => {
                const match = text.match(/APP_VERSION\s*=\s*"([^"]+)"/);
                if (match && match[1] !== window.APP_VERSION) showUpdateBanner();
            })
            .catch(() => {})
            .finally(() => { checking = false; });
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
    });
})();
