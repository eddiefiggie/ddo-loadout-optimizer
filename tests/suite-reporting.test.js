// #826 — the JS suite's own pass/fail counters are honest.
//
// Every test file prints `N passed, M failed` from its own counters. That print
// used to sit at a fixed POSITION in the file, so tests declared below it ran,
// set `process.exitCode`, and were never counted: `results.test.js` reported 153
// while running 323, and `wizard.test.js` reported 229 while running 511. Nine
// files under-reported by 648 tests between them.
//
// Redness was never at risk — `test()` sets `process.exitCode` in its catch and
// `scripts/run_js_tests.sh` stops on a non-zero exit. What was wrong is the
// signal a human reads, and it is the one AGENTS.md warns about: "a fully green
// suite can cover none of the diff". A `0 failed` printed ABOVE a later FAIL is
// worse than no count at all.
//
// The fix is position-independence, not a re-sort: the summary prints from a
// `process.on("exit")` handler, so it cannot matter where it is declared. This
// file asserts that every test file does it that way, so a forty-first file
// cannot start the cycle over.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  PASS", name); }
  catch (e) { console.log("  FAIL", name, "\n   ", e.message); failed++; process.exitCode = 1; }
}

const DIR = __dirname;
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith(".test.js")).sort();
const SUMMARY = /\$\{passed\} passed, \$\{failed\} failed/;
/** The summary must be registered as an exit handler, on its own line. */
const HANDLED = /process\.on\("exit",[^\n]*\$\{passed\} passed, \$\{failed\} failed/;

function summaryLinesOf(file) {
  const src = fs.readFileSync(path.join(DIR, file), "utf-8");
  return src.split("\n").filter((l) => SUMMARY.test(l));
}

test("#826: the scan actually sees the suite", () => {
  assert.ok(FILES.length >= 30,
    `only ${FILES.length} test file(s) found — the glob broke and every check below `
    + "would pass over nothing");
  assert.ok(FILES.includes("suite-reporting.test.js"), "the scan must include itself");
});

test("#826: every test file reports a pass/fail count", () => {
  assert.ok(FILES.length, "no files scanned — this check would pass vacuously");
  const silent = FILES.filter((f) => summaryLinesOf(f).length === 0);
  assert.deepStrictEqual(silent, [],
    "test file(s) that never print a count — a file nobody counts is a file "
    + "nobody notices going quiet");
});

test("#826: every count is printed from an exit handler, not a position", () => {
  assert.ok(FILES.length, "no files scanned — this check would pass vacuously");
  const positional = [];
  for (const f of FILES) {
    const lines = summaryLinesOf(f);
    assert.strictEqual(lines.length, 1, `${f} has ${lines.length} summary prints; expected 1`);
    if (!HANDLED.test(lines[0])) positional.push(f);
  }
  assert.deepStrictEqual(positional, [],
    "test file(s) printing their count at a fixed position. Tests declared after "
    + "that line still run and still fail the build, but are not in the number the "
    + "file prints — which is how nine files came to under-report 648 tests. "
    + 'Print from `process.on("exit", ...)` instead.');
});

test("#826: this file obeys its own rule", () => {
  const mine = summaryLinesOf("suite-reporting.test.js");
  assert.strictEqual(mine.length, 1);
  assert.ok(HANDLED.test(mine[0]), "the guard must not be the exception it forbids");
});

process.on("exit", () => { console.log(`\n${passed} passed, ${failed} failed`); });
