// #826, then #853 — the JS suite has ONE runner, and every file uses it.
//
// #782: 39 of 40 files printed `N passed` on a run that FAILed. #826: summaries
// printed from a fixed POSITION, so 648 tests ran after their own count. Both
// were harness defects, both were fixed in every file by hand, and the guard
// this file was born as pinned the output shape — `process.on("exit", ...)`
// with both counts — while forty copies of the runner stayed. #853 replaced the
// copies with `tests/_harness.js`; this file now asserts the inverse: NO test
// file declares a runner, a counter or a summary of its own, and the one
// harness prints the position-independent, two-count summary the old guard
// demanded. A forty-fourth file cannot start the cycle over in either
// direction.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { test } = require("./_harness");

const DIR = __dirname;
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith(".test.js")).sort();
const HARNESS = fs.readFileSync(path.join(DIR, "_harness.js"), "utf-8");
const src = (f) => fs.readFileSync(path.join(DIR, f), "utf-8");

const REQUIRE = /require\("\.\/_harness"\)/;
const LOCAL_RUNNER = /^(?:async\s+)?function\s+\w+\s*\(\s*name\s*,\s*fn\s*\)|^const\s+\w+\s*=\s*(?:async\s+)?\(\s*name\s*,\s*fn\s*\)\s*=>/m;
const LOCAL_COUNTER = /^let passed = 0|\bpassed\+\+|\bfailed\+\+|\bpassed \+= 1|\bif \((?:failed|passed)\)|process\.exit\(/m;
const LOCAL_SUMMARY = /\$\{passed\} passed|process\.on\("exit"/;

test("#826: the scan actually sees the suite", () => {
  assert.ok(FILES.length >= 30,
    `only ${FILES.length} test file(s) found — the glob broke and every check below `
    + "would pass over nothing");
  assert.ok(FILES.includes("suite-reporting.test.js"), "the scan must include itself");
});

test("#853: every test file requires the one harness", () => {
  const missing = FILES.filter((f) => !REQUIRE.test(src(f)));
  assert.deepStrictEqual(missing, [], "test file(s) that do not require ./_harness");
});

test("#853: no test file declares a runner, a counter or a summary of its own", () => {
  const runners = FILES.filter((f) => LOCAL_RUNNER.test(src(f)));
  assert.deepStrictEqual(runners, [], "a `function test(name, fn)` (or check / testAsync) declared in a test file — use the harness");
  const counters = FILES.filter((f) => LOCAL_COUNTER.test(src(f)));
  assert.deepStrictEqual(counters, [], "a local pass/fail counter, or a per-file call to exit the process — the harness owns the counts and the exit code (a leftover exit-on-failure line was a ReferenceError the first migration run found)");
  const summaries = FILES.filter((f) => LOCAL_SUMMARY.test(src(f).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")));
  assert.deepStrictEqual(summaries, [], "a per-file summary print or exit handler — the harness owns the summary");
});

test("#826: the harness prints its two-count summary from an exit handler", () => {
  assert.match(HARNESS, /process\.on\("exit",/, "position-independent");
  assert.match(HARNESS, /\$\{counts\.passed\} passed, \$\{counts\.failed\} failed/, "both counts, always");
  assert.match(HARNESS, /process\.exitCode = 1/, "a failure is red to the runner script");
});

test("#853: the harness honours JS_TEST_FILTER and awaits a promise-returning test", () => {
  assert.match(HARNESS, /process\.env\.JS_TEST_FILTER/);
  assert.match(HARNESS, /typeof r\.then === "function"/, "a started-but-unsettled promise is never reported PASS");
});

test("#853: the harness itself is not scanned as a test file", () => {
  assert.ok(!FILES.includes("_harness.js"));
  assert.ok(!/\.test\.js$/.test("_harness.js"));
});
