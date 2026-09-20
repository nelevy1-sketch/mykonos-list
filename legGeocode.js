// legGeocode.js - shared leg-level (trip/destination) geocoding with a
// Hebrew-search fallback. Classic script, window-attached - same pattern as
// legs.js/datetime.js/legBuilder.js (see CLAUDE.md's "מבנה סקריפטים בין 6
// העמודים" for why that pattern matters here specifically). Loaded by
// wizard.html and index.html only - the two places that geocode a leg's own
// destination (city/region level). NOT geocode.js - that's a different
// concern (Nominatim for individual saved PLACES/POIs, already documented
// there) and is deliberately left untouched by this file.
//
// The bug this exists to fix, confirmed directly against the live API, not
// assumed: Open-Meteo's geocoding-api returns zero results for a
// Hebrew-script query - not for some Hebrew queries, for every one tried
// ("שטוקהולם", "גוטנבורג", "קליפורניה") - and its own `language` param does
// NOT rescue this (verified: language=he vs language=en on the exact same
// Hebrew string returns the same empty result both times). geocode.js's own
// comment previously assumed the opposite ("Open-Meteo's language param
// appears to affect actual matching") - that assumption was untested and is
// now confirmed wrong. Don't resurrect it.
//
// Fallback, not a replacement: Nominatim (the same service geocode.js
// already uses for places), only when Open-Meteo returns nothing.
// (1) Nominatim never returns a timezone field in any configuration - a
//     full switch would need a brand-new timezone-by-coordinate dependency
//     for every trip, not just the rare failed-geocode case.
// (2) Nominatim's own usage policy caps requests at ~1/second - the
//     existing Promise.all-per-leg pattern in wizard.html/index.html fires
//     several geocoding calls at once, which Nominatim would throttle/
//     reject if it received them all directly at that volume.
// Open-Meteo has neither limitation, so it stays the fast path for the
// common case (a real, Latin/well-known city name) and Nominatim only ever
// carries the rare Hebrew-empty case.
//
// countryCode casing: Open-Meteo already returns it upper-case ("SE", "US"),
// matching everything already stored in RTDB and read elsewhere in this app
// (including shopping.html's Greek-VAT-button gate, countryCode === "GR").
// Nominatim returns it lower-case and only inside `address`, which requires
// an explicit addressdetails=1 param - geocode.js's existing Nominatim call
// does not request that (it never needed country_code), confirmed directly
// that without it Nominatim's response carries no country field at all. So
// this file makes its own Nominatim request rather than reusing geocode.js's.
// .toUpperCase() is applied once, here, at this one new entry point - every
// existing consumer keeps assuming upper-case without needing to change.
//
// timezone on a Nominatim-rescued leg: left null, on purpose - not resolved
// via a third lookup. Falls back through the chain already documented in
// docs/schema-legs.md §4 (leg timezone -> trip timezone -> device clock),
// same as any other leg that failed to geocode before this fix existed. A
// real per-leg timezone-by-coordinate lookup is separate, bigger work, only
// worth it if this turns out to matter in practice.
//
// Throttle: a single module-level promise chain, not a per-call delay -
// critical because wizard.html/index.html call this once per leg via
// Promise.all, all at once. A per-call "wait 1.1s before firing" would not
// serialize anything if several legs all start that wait at the same
// instant and all fire together 1.1s later. Chaining onto one shared
// promise means every Nominatim call this file ever makes - regardless of
// which leg, which page, or how many "started" simultaneously - queues
// behind the one before it, each still waiting its own 1.1s after the
// previous one actually RAN, not after it started.
let nominatimQueueTail = Promise.resolve();
let lastNominatimCallAt = 0;
const NOMINATIM_MIN_INTERVAL_MS = 1100; // Nominatim's policy is 1/sec; small margin, not exactly 1000

function runThrottledOnNominatimQueue(task) {
  const runNext = async () => {
    const wait = Math.max(0, lastNominatimCallAt + NOMINATIM_MIN_INTERVAL_MS - Date.now());
    if (wait > 0) {
      await new Promise(resolve => setTimeout(resolve, wait));
    }
    lastNominatimCallAt = Date.now();
    return task();
  };

  // .then(runNext, runNext): the queue must keep moving even if an earlier
  // call in the chain rejected - one failed geocode must never block every
  // leg queued behind it.
  const result = nominatimQueueTail.then(runNext, runNext);
  // Swallowed here too, for the same reason - only this function's own
  // caller (below) needs to see whether ITS OWN call failed.
  nominatimQueueTail = result.catch(() => {});
  return result;
}

async function geocodeViaOpenMeteo(name, language) {
  try {
    const response = await fetch(
      "https://geocoding-api.open-meteo.com/v1/search" +
      `?name=${encodeURIComponent(name)}` +
      "&count=1" +
      `&language=${language}` +
      "&format=json"
    );
    if (!response.ok) return null;
    const data = await response.json();
    const match = data.results?.[0];
    return match
      ? {
          lat: match.latitude,
          lon: match.longitude,
          timezone: match.timezone || null,
          countryCode: match.country_code || null,
          // Forward-only additions (gamification achievement-map work) -
          // Open-Meteo already returns its own resolved city name and
          // region/state in every match; this was being silently discarded
          // before. A leg's own `name` stays the raw free-text the user
          // typed (never overwritten by this) - these are a separate,
          // additional, machine-clean pair for grouping/display, not a
          // replacement for it.
          cityName: match.name || null,
          region: match.admin1 || null
        }
      : null;
  } catch {
    return null;
  }
}

async function geocodeViaNominatim(name, language) {
  return runThrottledOnNominatimQueue(async () => {
    try {
      const response = await fetch(
        "https://nominatim.openstreetmap.org/search" +
        `?q=${encodeURIComponent(name)}` +
        "&format=json&limit=1&addressdetails=1" +
        `&accept-language=${language}`
      );
      if (!response.ok) return null;
      const data = await response.json();
      const match = data?.[0];
      if (!match) return null;
      const countryCode = match.address?.country_code
        ? match.address.country_code.toUpperCase()
        : null;
      return {
        lat: Number(match.lat),
        lon: Number(match.lon),
        // Nominatim never returns a timezone, in any configuration - see
        // the file header. Left null on purpose, not derived here.
        timezone: null,
        countryCode,
        // Same forward-only pair as the Open-Meteo path above. Nominatim's
        // settlement-type key varies by place (city/town/village/hamlet),
        // hence the fallback chain rather than a single fixed key.
        cityName: match.address?.city || match.address?.town || match.address?.village || null,
        region: match.address?.state || null
      };
    } catch {
      return null;
    }
  });
}

// name: the leg's own destination text, exactly as typed (may be Hebrew).
// language: "he" | "en" - passed through to both services; only affects the
//   display language of an already-found match in either one, never what
//   gets matched (confirmed for both - see file header).
// Returns {lat, lon, timezone, countryCode, cityName, region} - each
// individually null when unknown, never a placeholder like 0. Never throws.
// cityName/region are forward-only (added after both services were already
// wired up) - a leg saved before this existed simply has no value for
// either, same fallback-shaped gap as countryCode had for legs predating
// v4.23.0 (docs/schema-legs.md §2.2). Never a substitute for the leg's own
// `name` (still the raw, user-typed destination) - this is a separate,
// additional, machine-clean pair for grouping/display.
window.geocodeLegDestination = async function geocodeLegDestination(name, language) {
  const openMeteoResult = await geocodeViaOpenMeteo(name, language);
  if (openMeteoResult) return openMeteoResult;

  const nominatimResult = await geocodeViaNominatim(name, language);
  return nominatimResult || { lat: null, lon: null, timezone: null, countryCode: null, cityName: null, region: null };
};
