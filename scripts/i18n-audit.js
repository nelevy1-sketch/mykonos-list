#!/usr/bin/env node
// i18n-audit.js — heuristic scanner for Hebrew text that bypasses the app's
// language-switching logic. Node, no external dependencies, run manually:
//
//   node scripts/i18n-audit.js                  (scans the 6 app pages)
//   node scripts/i18n-audit.js packing.html      (scans one file)
//
// This is a linter for HUMAN REVIEW, not a blocking gate — every run of the
// manual audit it replaces still had to rule out false positives by hand
// (dynamic translation done outside the central language function, business
// logic that happens to also set .textContent, etc). Read the output as a
// candidate list, not a verdict. Known false negative: text that is later
// overwritten with non-language-related dynamic content (e.g. a title
// element whose Hebrew fallback gets replaced by a trip name) looks
// "covered" to this script even though the fallback itself never
// translates - see index.html's #appTitle for a real example.
//
// Two independent scans:
//   1. Static markup: elements with an id, whose HTML has hardcoded Hebrew
//      in textContent or in placeholder/title/aria-label, that no JS
//      anywhere in the file ever sets via a translation-shaped call.
//   2. Dynamic templates: Hebrew literal text (outside ${...} interpolation)
//      inside backtick template strings within functions whose name
//      contains "render" - catches generated markup that was never made
//      language-aware at all (a different bug shape than #1).
//
// Suppress a known/accepted finding two ways:
//   - inline: put <!-- i18n-ignore --> right before the element's opening
//     tag (scan 1), or a line containing "i18n-ignore" right before the
//     template literal (scan 2).
//   - file: add a line to scripts/i18n-ignore.txt (see that file's header).

const fs = require("fs");
const path = require("path");

const HEBREW = /[֐-׿]/;

const DEFAULT_FILES = [
  "index.html",
  "wizard.html",
  "itinerary.html",
  "places.html",
  "packing.html",
  "shopping.html",
];

const ROOT = path.resolve(__dirname, "..");
const IGNORE_FILE = path.join(__dirname, "i18n-ignore.txt");

function loadIgnoreList() {
  const ids = new Set(); // "file.html:idName"
  const lines = new Set(); // "file.html:123"
  if (!fs.existsSync(IGNORE_FILE)) return { ids, lines };
  fs.readFileSync(IGNORE_FILE, "utf8")
    .split("\n")
    .forEach((raw) => {
      const line = raw.trim();
      if (!line || line.startsWith("#")) return;
      const idx = line.indexOf(":");
      if (idx === -1) return;
      const file = line.slice(0, idx).trim();
      const key = line.slice(idx + 1).trim();
      if (!file || !key) return;
      if (/^\d+$/.test(key)) lines.add(`${file}:${key}`);
      else ids.add(`${file}:${key}`);
    });
  return { ids, lines };
}

function lineAt(source, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (source[i] === "\n") line++;
  return line;
}

// Blank out <script>...</script> bodies (spaces, keeping every newline) so
// scan 1 only sees real HTML markup - not JS text that happens to contain
// something shaped like a tag.
function stripScripts(source) {
  return source.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (m, body) => {
    const blanked = body.replace(/[^\n]/g, " ");
    return m.slice(0, m.indexOf(body)) + blanked + "</script>";
  });
}

function hasInlineIgnoreHTML(source, index) {
  const before = source.slice(Math.max(0, index - 80), index);
  return /<!--\s*i18n-ignore\s*-->\s*$/.test(before);
}

function hasInlineIgnoreJS(source, index) {
  const lineStart = source.lastIndexOf("\n", index) + 1;
  const prevLineStart = source.lastIndexOf("\n", lineStart - 2) + 1;
  const prevLine = source.slice(prevLineStart, lineStart);
  return /i18n-ignore/.test(prevLine);
}

// ---------- Scan 1: static markup with an id, hardcoded Hebrew ----------

function scanStaticMarkup(source) {
  const stripped = stripScripts(source);
  const findings = [];
  // Opening tag with attributes (order-independent), not self-closed by </...>.
  const tagRe = /<([a-zA-Z][\w-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(stripped))) {
    const [full, tag, attrsStr, selfClose] = m;
    const idMatch = attrsStr.match(/\bid=["']([\w-]+)["']/);
    if (!idMatch) continue;
    const id = idMatch[1];
    const tagStart = m.index;
    const tagEnd = tagRe.lastIndex;
    const classMatch = attrsStr.match(/\bclass=["']([^"']*)["']/);
    const classes = classMatch ? classMatch[1].trim().split(/\s+/) : [];

    if (hasInlineIgnoreHTML(stripped, tagStart)) continue;

    for (const attr of ["placeholder", "title", "aria-label"]) {
      const re = new RegExp(attr + '=["\']([^"\']*)["\']');
      const am = attrsStr.match(re);
      if (am && HEBREW.test(am[1])) {
        findings.push({
          index: tagStart,
          line: lineAt(source, tagStart),
          id,
          classes,
          kind: `attr:${attr}`,
          text: am[1].trim(),
        });
      }
    }

    if (!selfClose && !/^(br|img|input|hr|meta|link)$/i.test(tag)) {
      const closeRe = new RegExp(`</${tag}\\s*>`, "i");
      const rest = stripped.slice(tagEnd);
      const nextOpen = rest.search(/<[^/!]/); // next opening tag (rough nesting guard)
      const closeIdx = rest.search(closeRe);
      if (closeIdx !== -1 && (nextOpen === -1 || nextOpen >= closeIdx)) {
        const text = rest.slice(0, closeIdx);
        if (HEBREW.test(text) && text.trim()) {
          findings.push({
            index: tagStart,
            line: lineAt(source, tagStart),
            id,
            classes,
            kind: "text",
            text: text.trim().slice(0, 80),
          });
        }
      }
    }
  }
  return findings;
}

// ---------- coverage check: is this id ever set by JS anywhere in the file? ----------

const COVERAGE_MARKERS = [
  /\.textContent/,
  /\.innerText\b/,
  /\.innerHTML/,
  /\.setAttribute\(\s*["'](aria-label|title|placeholder)["']/,
  /\.placeholder\s*=/,
  /\btr\(/,
];

// Elements are frequently cached once into a variable (often under a
// different name than the id) and set later, far from the lookup - a flat
// character-proximity window either misses those or, worse, on a dense
// single-line minified page (itinerary.html), spuriously matches an
// unrelated marker that just happens to fall within the window. Anchor
// every check to an actual `.` accessor instead of a character distance.
//
// The setter marker is also kept specific to the KIND of the finding: an
// aria-label gap is only "covered" by something that actually touches
// aria-label/title, not by an unrelated .textContent/.innerHTML call on the
// same element (e.g. index.html's #forecastStrip gets its child cards
// rendered via `strip.innerHTML = ...`, which never touches the container's
// own aria-label - a flat "any setter counts" check would have missed it).
// NOTE: every caller already supplies the leading `\.` before splicing this
// in (`...\)\s*\.\s*(?:${setter})`), so the alternatives below must NOT
// have their own leading dot - "title\s*=", not "\.title\s*=".
function setterPatternFor(kind) {
  if (kind === "attr:aria-label")
    return 'setAttribute\\(\\s*["\']aria-label["\']|ariaLabel\\s*=';
  if (kind === "attr:title") return 'setAttribute\\(\\s*["\']title["\']|title\\s*=';
  if (kind === "attr:placeholder")
    return 'setAttribute\\(\\s*["\']placeholder["\']|placeholder\\s*=';
  return "(?:textContent|innerText|innerHTML)\\b"; // kind === "text"
}

function findCachedVarNames(source, id) {
  const re = new RegExp(
    `(?:const|let|var)\\s+(\\w+)\\s*=\\s*(?:document\\.getElementById|document\\.querySelector|\\$)\\(\\s*["']#?${id}["']\\s*\\)`,
    "g"
  );
  const names = [];
  let m;
  while ((m = re.exec(source))) names.push(m[1]);
  return names;
}

function isCoveredElsewhere(source, id, kind, classes) {
  const setter = setterPatternFor(kind);

  // Pattern A: lookup chained directly into a matching setter in the same
  // statement, e.g. getElementById("id").textContent = ..., or
  // $("id").setAttribute("aria-label", ...).
  const chainRe = new RegExp(
    `(?:getElementById|querySelector|\\$)\\(\\s*["']#?${id}["']\\s*\\)\\s*\\.\\s*(?:${setter})`
  );
  if (chainRe.test(source)) return true;

  // Pattern B: id used as an unquoted object key - dictionary-driven
  // translation, e.g. dashboardText = { he: { pageTitle: "..." }, ... },
  // applied through a generic Object.entries loop that never sits next to
  // the key itself. Dictionaries in this codebase only ever drive text.
  if (kind === "text" && new RegExp(`[{,]\\s*${id}\\s*:`).test(source)) return true;

  // Pattern C: id cached into a variable (any name), variable later used to
  // set the matching attribute - checked by real accessor, not proximity.
  for (const v of findCachedVarNames(source, id)) {
    if (new RegExp(`\\b${v}\\s*\\.\\s*(?:${setter})`).test(source)) return true;
  }

  // Pattern D: element also carries a class targeted by a batch update -
  // querySelectorAll(".cls").forEach(el => el.textContent = ...). Found via
  // wizard.html's #previewBtnPacking etc: covered as a group via
  // ".preview-btn", never individually by id. Windowed (not chained) since
  // the setter is inside a forEach callback, at an arbitrary distance from
  // the selector call - narrow enough to matter only because it's gated on
  // a specific class match first.
  for (const cls of classes || []) {
    const clsRe = new RegExp(`querySelectorAll\\(\\s*["']\\.${cls}["']\\s*\\)`, "g");
    let cm;
    while ((cm = clsRe.exec(source))) {
      const windowText = source.slice(cm.index, cm.index + 400);
      if (new RegExp(`\\.\\s*(?:${setter})`).test(windowText)) return true;
    }
  }

  return false;
}

// ---------- Scan 2: hardcoded Hebrew in template strings inside render*() ----------

function scanDynamicTemplates(source) {
  const findings = [];
  const funcDeclRe =
    /(?:function\s+(\w+)\s*\(|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>)|window\.(\w+)\s*=\s*(?:async\s*)?function\b)/g;
  const decls = [];
  let dm;
  while ((dm = funcDeclRe.exec(source))) {
    const name = dm[1] || dm[2] || dm[3];
    if (name) decls.push({ name, index: dm.index });
  }
  decls.sort((a, b) => a.index - b.index);

  function nearestFuncName(idx) {
    let name = null;
    for (const d of decls) {
      if (d.index <= idx) name = d.name;
      else break;
    }
    return name;
  }

  const tplRe = /`(?:[^`\\]|\\.)*`/g;
  let tm;
  while ((tm = tplRe.exec(source))) {
    if (hasInlineIgnoreJS(source, tm.index)) continue;
    const raw = tm[0];
    const staticText = raw.replace(/\$\{[^}]*\}/g, "");
    if (!HEBREW.test(staticText)) continue;
    if (isTranslationBranch(source, tm.index)) continue;
    const fname = nearestFuncName(tm.index);
    if (!fname || !/render/i.test(fname)) continue;
    findings.push({
      line: lineAt(source, tm.index),
      func: fname,
      text: raw.trim().slice(0, 100),
    });
  }
  return findings;
}

// A Hebrew template literal is already-translated, not a bug, when it's one
// branch of a working translation call/expression - this is the SHAPE of a
// heuristic scanner's false positive (it finds Hebrew, it doesn't understand
// context), not a one-off bug: every real run so far has found some. Two
// known-good shapes, both confirmed against real findings:
//   - an argument to tr(...) - e.g. tr(`${n} שנשארו`, `${n} remaining`) -
//     shopping.html/index.html/places.html's render functions all use this.
//   - a ternary branch on currentLanguage/lang - e.g.
//     currentLanguage === 'he' ? `...` : `...` - wizard.html has no tr() at
//     all and uses this idiom instead throughout the file.
function isTranslationBranch(source, index) {
  const before = source.slice(Math.max(0, index - 200), index);
  if (/\btr\(\s*$/.test(before)) return true;
  if (/[?:]\s*$/.test(before) && /\b(currentLanguage|lang)\b/.test(before)) return true;
  return false;
}

// ---------- main ----------

function main() {
  const args = process.argv.slice(2);
  const files = args.length ? args : DEFAULT_FILES;
  const { ids: ignoreIds, lines: ignoreLines } = loadIgnoreList();

  let totalStatic = 0;
  let totalDynamic = 0;
  let totalIgnored = 0;

  for (const relFile of files) {
    const filePath = path.join(ROOT, relFile);
    if (!fs.existsSync(filePath)) {
      console.error(`skip: ${relFile} not found`);
      continue;
    }
    const source = fs.readFileSync(filePath, "utf8");

    const staticFindings = scanStaticMarkup(source).filter(
      (f) => !isCoveredElsewhere(source, f.id, f.kind, f.classes)
    );
    const dynamicFindings = scanDynamicTemplates(source);

    const staticKept = [];
    for (const f of staticFindings) {
      if (ignoreIds.has(`${relFile}:${f.id}`)) {
        totalIgnored++;
        continue;
      }
      staticKept.push(f);
    }
    const dynamicKept = [];
    for (const f of dynamicFindings) {
      if (ignoreLines.has(`${relFile}:${f.line}`)) {
        totalIgnored++;
        continue;
      }
      dynamicKept.push(f);
    }

    if (!staticKept.length && !dynamicKept.length) continue;

    console.log(`\n${relFile}`);
    console.log("-".repeat(relFile.length));
    for (const f of staticKept) {
      console.log(`  [static]  ${relFile}:${f.line}  #${f.id}  (${f.kind})  "${f.text}"`);
    }
    for (const f of dynamicKept) {
      console.log(`  [dynamic] ${relFile}:${f.line}  ${f.func}()  ${f.text}`);
    }

    totalStatic += staticKept.length;
    totalDynamic += dynamicKept.length;
  }

  console.log(
    `\n${totalStatic + totalDynamic} candidate(s): ${totalStatic} static markup, ${totalDynamic} dynamic template` +
      (totalIgnored ? ` (${totalIgnored} suppressed by scripts/i18n-ignore.txt)` : "")
  );
}

main();
