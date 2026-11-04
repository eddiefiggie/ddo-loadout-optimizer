// Observe the real harness from another process, including Node's natural exit.
// This file uses that same harness only to report the subprocess assertions.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { test } = require("./_harness");

const ROOT = path.resolve(__dirname, "..");
const CASES = path.join(__dirname, "fixtures/harness/cases.js");
const env = (filter = "") => ({ ...process.env, JS_TEST_FILTER: filter });

function runCase(scenario, filter = "") {
  const result = spawnSync(process.execPath, [CASES, scenario], {
    encoding: "utf8", env: env(filter),
  });
  assert.ifError(result.error);
  assert.strictEqual(result.signal, null, result.stderr);
  return result;
}

function verdict(result, status, passedCount, failedCount, skippedCount = 0) {
  const output = result.stdout + result.stderr;
  assert.strictEqual(result.status, status, output);
  assert.strictEqual(result.stderr, "", output);
  const summaries = result.stdout.match(/^\d+ passed, \d+ failed.*$/gm);
  assert.deepStrictEqual(summaries, [
    `${passedCount} passed, ${failedCount} failed${skippedCount ? `, ${skippedCount} skipped` : ""}`,
  ], output);
  assert.strictEqual((result.stdout.match(/^  PASS /gm) || []).length, passedCount, output);
  assert.strictEqual((result.stdout.match(/^  FAIL /gm) || []).length, failedCount, output);
  assert.strictEqual((result.stdout.match(/^  SKIP /gm) || []).length, skippedCount, output);
  assert.ok(result.stdout.trimEnd().endsWith(summaries[0]), output);
}

function unfinished(result, names) {
  for (const name of names) assert.ok(result.stdout.includes(`  FAIL ${name} \n`), result.stdout);
  assert.strictEqual((result.stdout.match(/Test returned a promise that did not settle before process exit/g) || []).length,
    names.length, result.stdout);
}

test("harness: no-handle pending promise fails at natural exit", () => {
  const result = runCase("pending");
  verdict(result, 1, 0, 1);
  unfinished(result, ["pending without handles"]);
});

test("harness: all pending names and the summary survive piped output", () => {
  const result = runCase("many pending");
  verdict(result, 1, 0, 4000);
  unfinished(result, Array.from({ length: 4000 }, (_, i) => `pending ${i}`));
});

test("harness: partial writes and transient backpressure preserve Unicode output", () => {
  const result = runCase("partial writes");
  verdict(result, 1, 0, 1);
  unfinished(result, ["pending café 🧪"]);
});

test("harness: sync, resolved and deferred successes remain awaitable", () => {
  verdict(runCase("success"), 0, 4, 0);
});

test("harness: throws, rejections and explicit reports keep honest counts and continue", () => {
  const result = runCase("failures");
  verdict(result, 1, 2, 4, 1);
  for (const reason of ["sync reason", "async reason", "string reason", "explicit reason", "fixture reason"])
    assert.ok(result.stdout.includes(reason), result.stdout);
  assert.ok(result.stdout.includes("PASS after failures"), result.stdout);
  assert.ok(!result.stdout.includes("did not settle"), result.stdout);
});

test("harness: simultaneous pending and settled tests are accounted independently", () => {
  const result = runCase("mixed");
  verdict(result, 1, 2, 3);
  unfinished(result, ["pending alpha", "pending beta"]);
  assert.ok(result.stdout.includes("FAIL deferred rejection"), result.stdout);
  assert.ok(result.stdout.includes("mixed reason"), result.stdout);
});

test("harness: duplicate names cannot hide unfinished invocations", () => {
  const result = runCase("duplicate names");
  verdict(result, 1, 1, 2);
  unfinished(result, ["same name", "same name"]);
});

test("harness: filtered-out callbacks never run or become pending", () => {
  const result = runCase("filtered", "selected");
  verdict(result, 0, 2, 0);
  assert.ok(!result.stdout.includes("excluded"), result.stdout);
});

test("harness: a filter with no matches retains the empty summary", () => {
  verdict(runCase("filtered", "no matching name"), 0, 0, 0);
});

test("harness: beforeExit work can still finish a test", () => {
  verdict(runCase("before exit"), 0, 1, 0);
});

test("harness: explicit reports do not settle a same-name pending test", () => {
  const result = runCase("explicit reports and pending");
  verdict(result, 1, 1, 2, 1);
  unfinished(result, ["still pending"]);
});

test("harness: a forced zero exit still reports an already pending test", () => {
  const result = runCase("forced exit");
  verdict(result, 1, 0, 1);
  unfinished(result, ["pending on forced exit"]);
});

test("harness: settled tests do not erase an external nonzero exit code", () => {
  verdict(runCase("existing exit code"), 7, 1, 0);
});

test("harness: unhandled failures outside callbacks remain fatal", () => {
  const result = runCase("unhandled rejection");
  assert.strictEqual(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Error: outside the test/);
});

test("harness: existing synchronous and asynchronous thenables still settle", () => {
  const result = runCase("thenables");
  verdict(result, 1, 2, 1);
  assert.ok(!result.stdout.includes("did not settle"), result.stdout);
});

// Exercise the actual shell script in a throwaway tree, without running the
// entire solver suite recursively. The dataset sentinel avoids its build step;
// none of these fixtures reads game data.
function runSweep(scenario) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ddo-harness-sweep-"));
  try {
    for (const subdir of ["scripts", "tests/fixtures/harness", "web/data"])
      fs.mkdirSync(path.join(dir, subdir), { recursive: true });
    fs.copyFileSync(path.join(ROOT, "scripts/run_js_tests.sh"), path.join(dir, "scripts/run_js_tests.sh"));
    fs.copyFileSync(path.join(__dirname, "_harness.js"), path.join(dir, "tests/_harness.js"));
    fs.copyFileSync(CASES, path.join(dir, "tests/fixtures/harness/cases.js"));
    fs.writeFileSync(path.join(dir, "web/data/items.json"), "{}\n");
    fs.writeFileSync(path.join(dir, "tests/a.test.js"),
      `process.argv[2] = ${JSON.stringify(scenario)}; require("./fixtures/harness/cases");\n`);
    fs.writeFileSync(path.join(dir, "tests/z.test.js"),
      'require("./_harness").test("later file ran", () => {});\n');
    const result = spawnSync("bash", [path.join(dir, "scripts/run_js_tests.sh")], {
      encoding: "utf8",
      env: { ...env(), PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}` },
    });
    assert.ifError(result.error);
    assert.strictEqual(result.signal, null, result.stderr);
    assert.strictEqual(result.stderr, "", result.stdout + result.stderr);
    return result;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("harness: the shell sweep stops at a pending-promise failure", () => {
  const result = runSweep("pending");
  assert.strictEqual(result.status, 1, result.stdout);
  unfinished(result, ["pending without handles"]);
  assert.ok(!result.stdout.includes("later file ran"), result.stdout);
  assert.ok(!result.stdout.includes("all JS test files passed"), result.stdout);
});

test("harness: the shell sweep still stops at explicit failures", () => {
  const result = runSweep("failures");
  assert.strictEqual(result.status, 1, result.stdout);
  assert.ok(result.stdout.includes("FAIL explicit fail"), result.stdout);
  assert.ok(!result.stdout.includes("later file ran"), result.stdout);
  assert.ok(!result.stdout.includes("all JS test files passed"), result.stdout);
});

test("harness: the shell sweep continues through settled successes", () => {
  const result = runSweep("success");
  assert.strictEqual(result.status, 0, result.stdout);
  assert.ok(result.stdout.includes("PASS later file ran"), result.stdout);
  assert.ok(result.stdout.includes("all JS test files passed"), result.stdout);
});
