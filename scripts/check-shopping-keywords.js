#!/usr/bin/env node
// check-shopping-keywords.js — pre-flight checker for candidate keywords
// before they're added to shopping.html's CATEGORY_DICTIONARY. Node, no
// external dependencies, run manually:
//
//   node scripts/check-shopping-keywords.js <candidate-list.txt>
//
// Why this exists: detectCategory() in shopping.html matches keywords with
// plain substring includes() (see CLAUDE.md / docs/roadmap.md investigation,
// 2026-09-10) - not whole-word, not fuzzy. That means a candidate list
// written without that constraint in mind can contain two different classes
// of problem once dropped in:
//   1. a short/generic candidate word silently swallows unrelated product
//      names that happen to contain it as a substring (e.g. a 3-letter
//      candidate matching inside a much longer, unrelated word)
//   2. a candidate collides - via containment, not just exact string
//      equality - with a keyword the dictionary already has, in the same
//      category or a different one. Object key order in CATEGORY_DICTIONARY
//      decides the winner for any name both would match (first category
//      wins), so a silent collision can re-route items that already
//      categorize correctly today.
//
// This script is READ-ONLY: it never edits shopping.html or the candidate
// file. It reports; a human decides what to keep, rename, or drop.
//
// Candidate list format (plain text, same "# comment" convention as
// scripts/i18n-ignore.txt):
//   - blank lines and lines starting with # are ignored
//   - a line starting with ## sets the "proposed category" label attached
//     to every word below it in the report, purely for readability - it
//     does not affect any check. Optional; omit it and every word is
//     reported with no category label.
//   - every other non-blank line is one candidate keyword, taken verbatim
//     (leading/trailing whitespace trimmed)
//
// Example:
//   ## קפואים
//   אפונה קפואה
//   תירס קפוא
//   ## תינוקות
//   חיתולים
//   מגבונים לתינוק

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SHOPPING_FILE = path.join(ROOT, "shopping.html");
const SHORT_WORD_THRESHOLD = 4; // chars; below this, flag as suspicious (question 2)

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

// ---------- load the CURRENT dictionary straight from shopping.html, never
// hardcoded here - so this script can't go stale the way a copy-pasted
// snapshot would the next time someone edits the real one. ----------

function loadCurrentDictionary() {
  const source = fs.readFileSync(SHOPPING_FILE, "utf8");
  const m = source.match(/const CATEGORY_DICTIONARY = \{[\s\S]*?\n  \};/);
  if (!m) fail("Could not locate CATEGORY_DICTIONARY in shopping.html - has it moved or been renamed?");
  // Evaluated in an isolated Function scope (no closure over this script's
  // own variables) - the object literal itself, nothing else, ever runs.
  const dict = new Function(`${m[0]}\nreturn CATEGORY_DICTIONARY;`)();
  return dict;
}

// ---------- load the candidate list ----------

function loadCandidates(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(
      `Candidate file not found: ${filePath}\n\n` +
        "Expected a plain text file, one keyword per line (# comments allowed,\n" +
        "## lines set an optional category label). See the header comment in\n" +
        "this script for the exact format and an example."
    );
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const candidates = []; // { word, category, line }
  let currentCategory = null;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith("##")) {
      currentCategory = line.replace(/^##\s*/, "").trim() || null;
      return;
    }
    if (line.startsWith("#")) return;
    candidates.push({ word: line, category: currentCategory, line: i + 1 });
  });
  return candidates;
}

function norm(s) {
  return s.trim().toLowerCase();
}

// ---------- check 1: containment within the new list itself ----------

function checkSelfContainment(candidates) {
  const findings = [];
  const seen = new Set();
  for (let i = 0; i < candidates.length; i++) {
    for (let j = 0; j < candidates.length; j++) {
      if (i === j) continue;
      const a = candidates[i];
      const b = candidates[j];
      if (norm(a.word) === norm(b.word)) continue; // exact dupes handled separately below
      if (norm(b.word).includes(norm(a.word))) {
        // a is contained inside b - report once per unordered pair, shorter first
        const key = [a.word, b.word].sort().join(" ⊂ ");
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({ short: a.word, long: b.word });
      }
    }
  }
  return findings;
}

// ---------- check 1b: exact duplicates within the new list (free side-effect
// of walking the list - not one of the 3 asked-for checks on its own, but
// silently dropped here would just resurface as a confusing "containment"
// finding against itself, so it's split out and labeled plainly instead) ----------

function checkSelfExactDuplicates(candidates) {
  const byNorm = new Map();
  candidates.forEach((c) => {
    const key = norm(c.word);
    if (!byNorm.has(key)) byNorm.set(key, []);
    byNorm.get(key).push(c);
  });
  const findings = [];
  for (const [, group] of byNorm) {
    if (group.length > 1) findings.push(group);
  }
  return findings;
}

// ---------- check 2: suspicious short candidate words ----------

function checkShortWords(candidates) {
  return candidates
    .filter((c) => c.word.trim().length < SHORT_WORD_THRESHOLD)
    .sort((a, b) => a.word.length - b.word.length);
}

// ---------- check 3: collisions against the EXISTING dictionary ----------

function checkAgainstExisting(candidates, existingDict) {
  const existingFlat = [];
  for (const [cat, keywords] of Object.entries(existingDict)) {
    keywords.forEach((kw) => existingFlat.push({ word: kw, category: cat }));
  }

  // De-duplicated by normalized word (first occurrence's category label
  // wins) - an exact duplicate in the candidate list is already reported by
  // checkSelfExactDuplicates(); repeating every one of its collisions here
  // too would just be noise on top of that, not a second real finding.
  const seenWord = new Set();
  const uniqueCandidates = candidates.filter((c) => {
    const key = norm(c.word);
    if (seenWord.has(key)) return false;
    seenWord.add(key);
    return true;
  });

  const exactDuplicates = [];
  const candidateContainsExisting = []; // existing keyword already sits inside this candidate
  const existingContainsCandidate = []; // this candidate already sits inside an existing keyword

  for (const c of uniqueCandidates) {
    const cNorm = norm(c.word);
    for (const e of existingFlat) {
      const eNorm = norm(e.word);
      if (cNorm === eNorm) {
        exactDuplicates.push({ candidate: c, existing: e });
      } else if (cNorm.includes(eNorm)) {
        candidateContainsExisting.push({ candidate: c, existing: e });
      } else if (eNorm.includes(cNorm)) {
        existingContainsCandidate.push({ candidate: c, existing: e });
      }
    }
  }

  return { exactDuplicates, candidateContainsExisting, existingContainsCandidate };
}

// ---------- report ----------

function catLabel(c) {
  return c.category ? ` [${c.category}]` : "";
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    fail(
      "Usage: node scripts/check-shopping-keywords.js <candidate-list.txt>\n\n" +
        "See the header comment in this script for the candidate file format."
    );
  }
  const candidatesPath = path.isAbsolute(arg) ? arg : path.join(process.cwd(), arg);

  const existingDict = loadCurrentDictionary();
  const candidates = loadCandidates(candidatesPath);

  if (!candidates.length) fail(`No candidate words found in ${candidatesPath}`);

  console.log(`Loaded ${candidates.length} candidate word(s) from ${path.relative(ROOT, candidatesPath)}`);
  console.log(
    `Existing dictionary: ${Object.keys(existingDict).length} categories, ` +
      `${Object.values(existingDict).reduce((n, kws) => n + kws.length, 0)} keywords (read live from shopping.html)`
  );

  // --- 1. self-containment ---
  const selfContainment = checkSelfContainment(candidates);
  const selfExact = checkSelfExactDuplicates(candidates);
  console.log(`\n1. Containment within the new list${"-".repeat(0)}`);
  console.log("-".repeat(40));
  if (!selfContainment.length) {
    console.log("  none");
  } else {
    selfContainment.forEach((f) => console.log(`  "${f.short}"  ⊂  "${f.long}"`));
  }
  if (selfExact.length) {
    console.log("\n  Exact duplicates within the new list itself:");
    selfExact.forEach((group) => {
      console.log(`  "${group[0].word}"  — appears ${group.length}x (line ${group.map((g) => g.line).join(", ")})`);
    });
  }

  // --- 2. suspicious short words ---
  const shortWords = checkShortWords(candidates);
  console.log(`\n2. Candidate words under ${SHORT_WORD_THRESHOLD} chars (over-matching risk)`);
  console.log("-".repeat(40));
  if (!shortWords.length) {
    console.log("  none");
  } else {
    shortWords.forEach((c) => console.log(`  "${c.word}" (${c.word.trim().length} chars)${catLabel(c)}`));
  }

  // --- 3. collisions against existing dictionary ---
  const { exactDuplicates, candidateContainsExisting, existingContainsCandidate } = checkAgainstExisting(
    candidates,
    existingDict
  );
  console.log(`\n3. Collisions against the existing dictionary`);
  console.log("-".repeat(40));
  if (exactDuplicates.length) {
    console.log("  Exact duplicates (candidate word already exists verbatim):");
    exactDuplicates.forEach((f) =>
      console.log(`    "${f.candidate.word}"${catLabel(f.candidate)}  — already in "${f.existing.category}"`)
    );
  }
  if (candidateContainsExisting.length) {
    console.log(
      "\n  Existing keyword already sits inside this candidate (existing keyword wins today, candidate is redundant for names that contain it):"
    );
    candidateContainsExisting.forEach((f) =>
      console.log(
        `    "${f.candidate.word}"${catLabel(f.candidate)}  contains existing  "${f.existing.word}"  (${f.existing.category})`
      )
    );
  }
  if (existingContainsCandidate.length) {
    console.log(
      "\n  This candidate already sits inside an existing keyword (adding it can re-route names that used to match the existing one first):"
    );
    existingContainsCandidate.forEach((f) =>
      console.log(
        `    "${f.candidate.word}"${catLabel(f.candidate)}  ⊂  existing  "${f.existing.word}"  (${f.existing.category})`
      )
    );
  }
  if (!exactDuplicates.length && !candidateContainsExisting.length && !existingContainsCandidate.length) {
    console.log("  none");
  }

  const total =
    selfContainment.length +
    selfExact.length +
    shortWords.length +
    exactDuplicates.length +
    candidateContainsExisting.length +
    existingContainsCandidate.length;
  console.log(`\n${total} finding(s) total across all checks. Review list, not a verdict - a human decides.`);
}

main();
