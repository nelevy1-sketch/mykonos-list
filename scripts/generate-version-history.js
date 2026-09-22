// One-time/manual generator for dashboard.html's version-history feature.
// The current-version KPI and the major/minor/patch donut (already built)
// get their data straight from GitHub at runtime (raw.githubusercontent.com
// for CHANGELOG.md's content, no auth/rate-limit issue). The two remaining
// cards - a versions-per-day/week bar chart and a scrollable per-version
// timeline - both need a real DATE per version, and CHANGELOG.md itself
// carries none (verified: no structured date field anywhere in the file).
//
// Investigated and rejected: matching each version to its bump commit by
// searching COMMIT MESSAGE TEXT for "vX.Y.Z" (api.github.com/.../commits,
// runnable from the browser, no local git needed) - verified against the
// real repo that only ~22-27 of 238 versions (~10%) actually state their
// own version number anywhere in the commit message. The other ~90%
// bumped the version silently - e.g. the real commit for v4.81.2,
// "achievements.html: תיקון חפיפת רשימת המדינה עם שדה העיר", mentions no
// version number at all. No text-matching heuristic, however clever, can
// recover a number that was never written down - three different
// heuristics were tried and all failed on the same ~90% of history.
//
// This script instead finds the TRUE bump commit via git's own content
// history (`git log -S`, pickaxe search - finds the commit that changed
// the OCCURRENCE COUNT of an exact string, i.e. the commit that actually
// ADDED this exact CHANGELOG header line, regardless of what its message
// says). 100% reliable - verified against all 238 real versions with zero
// misses. Only runs locally though: this is not something a browser fetch
// against GitHub's REST API can do - there is no pickaxe-search equivalent
// in the commits-list endpoint, and diffing all 242 commits individually
// to find the same answer would blow through the 60/hour unauthenticated
// rate limit.
//
// Output: version-history.json at the repo root - plain data, not a
// <script src> file or one of the 6 app pages, so not version.js-tracked
// (same reasoning as database.rules.json). dashboard.html fetches it
// directly from this app's own Firebase Hosting - same-origin, so no
// CORS/rate-limit concern at all, unlike the two GitHub-sourced cards.
//
// Re-run manually whenever CHANGELOG.md gains new versions - safe to
// re-run any time (regenerates the whole file from scratch, not
// incremental). Deliberately not wired into CI/deploy - a manual step,
// same precedent as scripts/backfill-visits.js and its siblings in this
// directory.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const CHANGELOG_PATH = path.join(ROOT, "CHANGELOG.md");
const OUTPUT_PATH = path.join(ROOT, "version-history.json");

const text = fs.readFileSync(CHANGELOG_PATH, "utf8");

// Same regex dashboard.html's own parseChangelogVersions() uses on the
// GitHub-fetched copy of this same file - kept identical on purpose, not
// reimplemented independently, so the two data sources (this script's
// dates, dashboard.html's live-fetched major/minor/patch counts) can never
// silently drift into parsing the same file two different ways.
const HEADER_RE = /^## v(\d+)\.(\d+)\.(\d+) — (.+)$/gm;

const versions = [];
let m;
while ((m = HEADER_RE.exec(text))) {
  versions.push({ major: +m[1], minor: +m[2], patch: +m[3], summary: m[4].trim() });
}

console.log(`Parsed ${versions.length} versions from CHANGELOG.md`);

let missing = 0;
const result = versions.map(v => {
  const label = `${v.major}.${v.minor}.${v.patch}`;
  const header = `## v${label} — `;
  let date = null;
  try {
    // %aI = strict ISO 8601 author date - parses directly with `new
    // Date(...)` in dashboard.html, no format guessing needed there.
    const out = execSync(
      `git log --all -S"${header}" --format="%aI" -- CHANGELOG.md`,
      { cwd: ROOT, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
    ).trim();
    // -S can in principle return more than one commit if the exact header
    // text was ever removed and re-added - never observed in this repo's
    // real history (verified: every one of the 238 real versions resolved
    // to exactly one commit), but if it ever does, the OLDEST match (last
    // line - git log prints newest-first) is the one that actually
    // introduced the version, not a later unrelated reappearance.
    if (out) {
      const lines = out.split("\n").filter(Boolean);
      date = lines[lines.length - 1];
    }
  } catch (error) {
    console.warn(`[generate-version-history] git log failed for v${label}:`, error.message);
  }
  if (!date) {
    missing++;
    console.warn(`[generate-version-history] no commit found for v${label} - writing null date`);
  }
  return { major: v.major, minor: v.minor, patch: v.patch, summary: v.summary, date };
});

console.log(`Resolved dates for ${result.length - missing}/${result.length} versions (${missing} missing)`);

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2) + "\n");
console.log(`Wrote ${OUTPUT_PATH}`);
