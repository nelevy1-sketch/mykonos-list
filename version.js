// Single source of truth for the app version.
//
// Bump this - and add a matching entry at the top of CHANGELOG.md - on every
// release. All 6 pages load this file and read window.APP_VERSION instead of
// hardcoding the string, so the version can never go stale on just one page
// the way "v4.0.0" had on four of them (as an invisible <!-- --> comment)
// while two others showed it live in their footer, and CHANGELOG.md had
// already moved on to v4.0.3.
window.APP_VERSION = "4.1.0";
