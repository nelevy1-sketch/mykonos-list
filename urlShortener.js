// urlShortener.js - loaded by index.html and wizard.html (docs/roadmap.md
// part 3 item 0, WhatsApp share link shortening).
//
// Wraps TinyURL's `api-create.php` endpoint - chosen specifically for the
// domain: people are more likely to trust/click a tinyurl.com link from a
// friend's WhatsApp message than an unfamiliar domain, which is the whole
// point of shortening in the first place (see the investigation this came
// out of). Verified directly, not assumed: a real request to this endpoint
// returns a genuine HTTP 301 with a `Location` header (no interstitial "are
// you sure" page), so it doesn't break WhatsApp's own og:title/og:image
// preview of the real destination. Also verified to send
// Access-Control-Allow-Origin, unlike is.gd/v.gd/cleanuri.com, which was the
// actual blocker that ruled those out - a browser fetch() to them fails
// with a CORS error for every real visitor, not just in a test sandbox.
//
// KNOWN RISK, kept on purpose: `api-create.php` is TinyURL's old, no-signup
// endpoint - it isn't part of their current official API (which requires an
// account/token) and isn't guaranteed to keep working. If this starts
// failing for everyone (not just occasionally), that's almost certainly why
// - check TinyURL's current API docs for a replacement before assuming a
// bug on our side.
//
// Classic script (not a module) - top-level `function` attaches to `window`
// automatically here, same as legs.js/datetime.js/toast.js.
//
// Pure and language-agnostic on purpose: index.html uses tr()/currentLanguage,
// wizard.html has no tr() at all and uses its own ternary idiom instead (see
// CLAUDE.md) - this function takes no part in either, so both callers can
// share it unchanged.
//
// Best-effort only, never throws: any failure (network error, CORS, timeout,
// rate limit, malformed response) resolves to null. Callers must already
// have a working long link before calling this and just keep using it on
// null - this function only ever upgrades an existing link, never gates it.
window.shortenUrl = async function shortenUrl(longUrl) {
    try {
        const controller = new AbortController();
        // Same 6s budget as places.html's detectMusicTitle() oEmbed call -
        // long enough for a normal response, short enough that a hung
        // request doesn't leave the caller waiting noticeably.
        const timeout = setTimeout(() => controller.abort(), 6000);

        const response = await fetch(
            `https://tinyurl.com/api-create.php?url=${encodeURIComponent(longUrl)}`,
            { signal: controller.signal }
        );
        clearTimeout(timeout);

        if (!response.ok) return null;

        const text = (await response.text()).trim();
        // No documented error-response shape for this unofficial endpoint
        // (unlike is.gd's "Error: ..." convention) - a plausible-looking
        // tinyurl.com URL is the only success signal available.
        if (!/^https:\/\/tinyurl\.com\//.test(text)) return null;

        return text;
    } catch {
        return null;
    }
};
