// U8 behavioral-parity regression guard (the FORWARD golden test).
//
// Loads the CURRENT web/data/items.json, runs the 6 parity fixtures through the
// real HiGHS solver (via the shared capture machinery), and asserts each
// fixture's perTarget map and sorted `chosen` loadout EXACTLY equal the ratified
// values in tests/parity/golden.json. Any future change that alters an optimal
// loadout fails here, loudly. Deterministic; part of the node suite convention.
//
// If a change is intentionally accepted, regenerate the fixture:
//   node tests/parity/capture_golden.js
//
// Run: node tests/solver_golden.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { solveAll } = require("./parity/capture_golden.js");

const GOLDEN = path.join(__dirname, "parity", "golden.json");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  PASS", name); }
  catch (e) { console.log("  FAIL", name, "\n   ", e.message); process.exitCode = 1; }
}

(async () => {
  const golden = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
  const goldenNames = Object.keys(golden.solves);
  const { solves, count } = await solveAll();

  test("golden guard pins exactly 6 fixtures", () => {
    assert.strictEqual(count, 6, "6 fixtures run against the live solver");
    assert.strictEqual(golden.fixture_count, 6, "golden.json records 6 fixtures");
    assert.strictEqual(goldenNames.length, 6, "golden.json carries 6 fixture solves");
    assert.deepStrictEqual(Object.keys(solves).sort(), goldenNames.slice().sort(),
      "the same fixture names are solved and pinned");
  });

  for (const name of goldenNames) {
    test(`golden solve unchanged: ${name}`, () => {
      const cur = solves[name];
      const want = golden.solves[name];
      assert.ok(cur, `fixture ${name} was solved`);
      assert.strictEqual(cur.status, want.status, "status matches");
      assert.deepStrictEqual(cur.perTarget, want.perTarget,
        `perTarget for ${name} must equal the ratified golden values`);
      assert.deepStrictEqual(cur.chosen, want.chosen,
        `chosen loadout (sorted slot+variant) for ${name} must equal the ratified golden loadout`);
    });
  }

  console.log(`\n${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
