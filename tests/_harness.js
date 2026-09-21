// #853 — THE test harness. Every `tests/*.test.js` requires this and declares no
// runner of its own; `tests/suite-reporting.test.js` asserts exactly that.
//
// Why one file: #782 (39 of 40 summaries omitted the failure count) and #826
// (summaries printed from a fixed position, so 648 tests ran after their own
// count) were both harness defects, both fixed file by file, and the guard that
// followed pinned the OUTPUT shape while forty copies of the cause stayed. A
// third behaviour the runner should have — a filter, a skip, uniform FAIL output
// with the stack — was forty edits and a new scan, or it was not done.
//
// What it does, and the rules the copies converged on:
//   * `test(name, fn)` runs `fn`. A thrown assertion is FAIL with the stack,
//     `process.exitCode = 1`, and the run continues — a red file never stops at
//     its first failure (`scripts/run_js_tests.sh` stops at the first red FILE).
//   * A `fn` that returns a promise is awaited: PASS/FAIL is reported when it
//     settles, never when the promise was merely started (the vacuous-green trap
//     tests/augment-pin.test.js records). `await test(...)` works; `atest` is the
//     same function under the name the async files already use.
//   * The summary prints from `process.on("exit")`, so it cannot matter where a
//     test is declared, and it always carries BOTH counts.
//   * `JS_TEST_FILTER=<substring> node tests/x.test.js` runs only the tests whose
//     name contains the substring, the thing a person debugging one red test
//     could not do without editing the file.
//   * `fail(name, err)` / `pass(name)` are for the rare block that reports a
//     result the runner did not see (an async environment that failed to
//     prepare); they keep the counts honest instead of `failed++` in a file.
"use strict";

const FILTER = process.env.JS_TEST_FILTER || "";
const counts = { passed: 0, failed: 0, skipped: 0 };

function pass(name) {
  counts.passed++;
  console.log("  PASS", name);
}

function fail(name, err) {
  counts.failed++;
  process.exitCode = 1;
  const why = err && (err.stack || err.message) ? (err.stack || err.message) : String(err);
  console.log("  FAIL", name, "\n   ", why);
}

function skip(name, why) {
  counts.skipped++;
  console.log("  SKIP", name, why ? `— ${why}` : "");
}

function test(name, fn) {
  if (FILTER && !String(name).includes(FILTER)) return undefined;
  let r;
  try { r = fn(); }
  catch (e) { fail(name, e); return undefined; }
  if (r && typeof r.then === "function") {
    return r.then(() => { pass(name); }, (e) => { fail(name, e); });
  }
  pass(name);
  return undefined;
}

process.on("exit", () => {
  const skipped = counts.skipped ? `, ${counts.skipped} skipped` : "";
  console.log(`\n${counts.passed} passed, ${counts.failed} failed${skipped}`);
});

module.exports = { test, atest: test, skip, pass, fail, counts };
