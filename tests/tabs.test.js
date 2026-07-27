// U1 — pure tab-state helpers (activeTab / nextTab). Run: node tests/tabs.test.js
const assert = require("assert");
const { activeTab, nextTab, TAB_IDS } = require("../web/app.js");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
    passed++;
  } catch (e) {
    console.error(`FAIL ${name}\n  ${e.message}`);
    process.exitCode = 1;
  }
}

test("TAB_IDS are solver then browse", () => {
  assert.deepStrictEqual(TAB_IDS, ["solver", "browse"]);
});

test("activeTab returns the clicked tab", () => {
  assert.strictEqual(activeTab("solver", "browse"), "browse");
  assert.strictEqual(activeTab("browse", "solver"), "solver");
});

test("activeTab is idempotent on the already-active tab", () => {
  assert.strictEqual(activeTab("solver", "solver"), "solver");
  assert.strictEqual(activeTab("browse", "browse"), "browse");
});

test("activeTab ignores an unknown clicked id (keeps current)", () => {
  assert.strictEqual(activeTab("solver", "nope"), "solver");
});

test("nextTab wraps forward on ArrowRight/ArrowDown", () => {
  assert.strictEqual(nextTab("solver", "ArrowRight"), "browse");
  assert.strictEqual(nextTab("browse", "ArrowRight"), "solver"); // wrap
  assert.strictEqual(nextTab("solver", "ArrowDown"), "browse");
});

test("nextTab wraps backward on ArrowLeft/ArrowUp", () => {
  assert.strictEqual(nextTab("browse", "ArrowLeft"), "solver");
  assert.strictEqual(nextTab("solver", "ArrowLeft"), "browse"); // wrap
  assert.strictEqual(nextTab("browse", "ArrowUp"), "solver");
});

test("nextTab honors Home and End", () => {
  assert.strictEqual(nextTab("browse", "Home"), "solver");
  assert.strictEqual(nextTab("solver", "End"), "browse");
});

test("nextTab ignores non-navigation keys", () => {
  assert.strictEqual(nextTab("solver", "a"), "solver");
  assert.strictEqual(nextTab("browse", "Enter"), "browse");
});

console.log(`\n${passed} passed`);
