#!/usr/bin/env node
// keyword-conflicts.js — self-audit for shopping.html's CATEGORY_DICTIONARY.
// A manual tool you run, not a check that blocks anything. Node, no external
// dependencies:
//
//   node scripts/keyword-conflicts.js
//   node scripts/keyword-conflicts.js --min-length=4        (default is 4)
//   node scripts/keyword-conflicts.js --match-mode=prefix    (default is
//                                                              "substring",
//                                                              matching
//                                                              detectCategory()
//                                                              as it is
//                                                              live today)
//
// detectCategory() matches keywords with plain substring includes() (not
// whole-word) and returns the FIRST category (in CATEGORY_DICTIONARY's
// declared order) whose keyword list matches - see docs/roadmap.md /
// CLAUDE.md investigation, 2026-09-10. That combination creates two shapes
// of bug this script looks for, both against the dictionary as it exists
// RIGHT NOW (no candidate list needed - see scripts/check-shopping-keywords.js
// for vetting words before they're added):
//
//   1. Containment - one existing keyword is a substring of another (or,
//      under --match-mode=prefix, a per-token PREFIX of another - see below).
//      Within the same category this is harmless (either keyword lands you
//      in the same bucket). Across categories it's a live bug: whichever
//      category is declared first always wins for any product name
//      containing both.
//   2. Cross-category exact duplicates - the identical keyword string
//      appears in two different categories' arrays. Same effect as #1's
//      cross-category case, just without needing containment - declaration
//      order alone decides the winner, silently.
//
// --match-mode=prefix switches check 1 from arbitrary substring to the
// same per-token startsWith relation a word-start matching algorithm would
// use (each keyword token must prefix the corresponding item token, in a
// contiguous run - handles multi-word keywords like "תפוח אדמה" the same
// way the matcher itself would). Use this to preview what's STILL a
// collision after switching detectCategory() away from substring matching -
// e.g. "תות" stops colliding with "פיתות" (never a real prefix, only ever
// sat mid-word) but "חלב" still collides with "חלבון" (חלבון genuinely
// starts with חלב) - confirmed 2026-09-10, see docs/roadmap.md.
//
// A third, harder-to-see risk: SHORT keywords (below --min-length, default
// 4 chars) are the most likely to accidentally sit inside real, unrelated
// product names that were never meant to match them at all - not just other
// dictionary entries. This script can't enumerate "every Hebrew word", but
// it CAN check every short keyword against TRANSLATION_DICTIONARY.items -
// the app's own list of known product names (107 as of 2026-09-10) - and
// report, for each one, exactly which of those known items would change
// category if the keyword were removed. That's the concrete, checkable
// version of "what breaks if I remove this" - not a guess.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SHOPPING_FILE = path.join(ROOT, "shopping.html");

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function loadBlock(source, constName) {
  const re = new RegExp(`const ${constName} = \\{[\\s\\S]*?\\n  \\};`);
  const m = source.match(re);
  if (!m) fail(`Could not locate ${constName} in shopping.html - has it moved or been renamed?`);
  return new Function(`${m[0]}\nreturn ${constName};`)();
}

function norm(s) {
  return s.trim().toLowerCase();
}

function detectCategory(dictionary, itemName) {
  const clean = norm(itemName);
  for (const [cat, kws] of Object.entries(dictionary)) {
    if (kws.some((kw) => clean.includes(norm(kw)))) return cat;
  }
  return "מוצרים נוספים 🛒";
}

function withoutKeyword(dictionary, cat, kw) {
  const copy = {};
  for (const [c, kws] of Object.entries(dictionary)) {
    copy[c] = c === cat ? kws.filter((k) => k !== kw) : kws.slice();
  }
  return copy;
}

// ---------- check 1: containment between existing keywords ----------

function tokensOf(s) {
  return norm(s).split(/\s+/).filter(Boolean);
}

// Per-token prefix match: is `shorterTokens` a contiguous, position-by-
// position startsWith-prefix of some window in `longerTokens`? Mirrors how
// a word-start matcher would test a multi-word keyword against an item.
function isTokenPrefix(longerTokens, shorterTokens) {
  for (let start = 0; start + shorterTokens.length <= longerTokens.length; start++) {
    let ok = true;
    for (let i = 0; i < shorterTokens.length; i++) {
      if (!longerTokens[start + i].startsWith(shorterTokens[i])) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function checkContainment(flat, matchMode) {
  const seen = new Set();
  const findings = [];
  for (let i = 0; i < flat.length; i++) {
    for (let j = 0; j < flat.length; j++) {
      if (i === j) continue;
      const a = flat[i];
      const b = flat[j];
      if (norm(a.word) === norm(b.word)) continue;

      let collides;
      if (matchMode === "prefix") {
        const aT = tokensOf(a.word);
        const bT = tokensOf(b.word);
        if (aT.length > bT.length) continue; // only check shorter-as-prefix-of-longer once
        collides = isTokenPrefix(bT, aT);
      } else {
        collides = norm(b.word).includes(norm(a.word));
      }
      if (!collides) continue;

      const key = [`${a.word}|${a.cat}`, `${b.word}|${b.cat}`].sort().join(" :: ");
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ short: a, long: b, crossCategory: a.cat !== b.cat });
    }
  }
  return findings.sort((x, y) => (x.crossCategory === y.crossCategory ? 0 : x.crossCategory ? -1 : 1));
}

// ---------- check 2: exact duplicate keyword across categories ----------

function checkCrossCategoryDuplicates(flat) {
  const byWord = new Map();
  flat.forEach((f) => {
    const key = norm(f.word);
    if (!byWord.has(key)) byWord.set(key, []);
    byWord.get(key).push(f);
  });
  const findings = [];
  for (const [, group] of byWord) {
    if (group.length > 1) findings.push(group);
  }
  return findings;
}

// ---------- check 3: short keywords + removal-impact against known items ----------

function checkShortKeywords(dict, flat, knownItems, minLength) {
  const short = flat
    .filter((f) => f.word.trim().length < minLength)
    .sort((a, b) => a.word.length - b.word.length || a.word.localeCompare(b.word, "he"));

  return short.map((f) => {
    const dictWithout = withoutKeyword(dict, f.cat, f.word);
    const affected = [];
    for (const item of knownItems) {
      const before = detectCategory(dict, item);
      if (before !== f.cat) continue; // doesn't currently land in this keyword's own category - irrelevant here
      const after = detectCategory(dictWithout, item);
      if (after !== before) affected.push({ item, after });
    }
    return { ...f, affected };
  });
}

// ---------- report ----------

function main() {
  const minLengthArg = process.argv.find((a) => a.startsWith("--min-length="));
  const minLength = minLengthArg ? parseInt(minLengthArg.split("=")[1], 10) : 4;
  const matchModeArg = process.argv.find((a) => a.startsWith("--match-mode="));
  const matchMode = matchModeArg ? matchModeArg.split("=")[1] : "substring";
  if (matchMode !== "substring" && matchMode !== "prefix") {
    fail(`--match-mode must be "substring" or "prefix", got "${matchMode}"`);
  }

  const source = fs.readFileSync(SHOPPING_FILE, "utf8");
  const dict = loadBlock(source, "CATEGORY_DICTIONARY");
  const td = loadBlock(source, "TRANSLATION_DICTIONARY");
  const knownItems = Object.keys(td.items || {});

  const flat = [];
  for (const [cat, kws] of Object.entries(dict)) kws.forEach((kw) => flat.push({ word: kw, cat }));

  console.log(
    `CATEGORY_DICTIONARY: ${Object.keys(dict).length} categories, ${flat.length} keywords. ` +
      `${knownItems.length} known product names in TRANSLATION_DICTIONARY.items (used for removal-impact below). ` +
      `match-mode: ${matchMode}`
  );

  const containment = checkContainment(flat, matchMode);
  const relLabel = matchMode === "prefix" ? "prefix-of" : "⊂";
  console.log(`\n1. Containment between existing keywords, ${matchMode} mode (${containment.length})`);
  console.log("-".repeat(40));
  if (!containment.length) {
    console.log("  none");
  } else {
    containment.forEach((f) => {
      const tag = f.crossCategory ? "CROSS-CATEGORY — live bug" : "same category — harmless";
      console.log(`  "${f.short.word}" (${f.short.cat}) ${relLabel} "${f.long.word}" (${f.long.cat})  [${tag}]`);
    });
  }

  const catOrder = Object.keys(dict);
  const crossDup = checkCrossCategoryDuplicates(flat);
  console.log(`\n2. Identical keyword in two+ categories (${crossDup.length})`);
  console.log("-".repeat(40));
  if (!crossDup.length) {
    console.log("  none");
  } else {
    crossDup.forEach((group) => {
      const winner = group.slice().sort((a, b) => catOrder.indexOf(a.cat) - catOrder.indexOf(b.cat))[0];
      console.log(`  "${group[0].word}"  in:  ${group.map((g) => g.cat).join("  &  ")}`);
      console.log(`    → "${winner.cat}" wins (declared first)`);
    });
  }

  const shortKws = checkShortKeywords(dict, flat, knownItems, minLength);
  console.log(`\n3. Keywords under ${minLength} chars, with removal-impact on known items (${shortKws.length})`);
  console.log("-".repeat(40));
  if (!shortKws.length) {
    console.log("  none");
  } else {
    shortKws.forEach((f) => {
      console.log(`  "${f.word}" (${f.word.trim().length} chars, ${f.cat})`);
      if (!f.affected.length) {
        console.log(`    removal-impact: none of ${knownItems.length} known items rely on it`);
      } else {
        console.log(`    removal-impact: ${f.affected.length} known item(s) would change category:`);
        f.affected.forEach((a) => console.log(`      "${a.item}" → would become "${a.after}"`));
      }
    });
  }

  console.log(
    `\nReport only - nothing here was changed. A "removal-impact: none" reading means none of the ` +
      `app's own ${knownItems.length} known product names rely on that keyword; it does NOT mean no real-world ` +
      `product name ever would - that would require checking against every Hebrew word, which this tool can't do.`
  );
}

main();
