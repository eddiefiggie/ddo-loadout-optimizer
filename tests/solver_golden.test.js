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

  test("golden guard pins exactly 10 fixtures", () => {
    assert.strictEqual(count, 10, "10 fixtures run against the live solver");
    assert.strictEqual(golden.fixture_count, 10, "golden.json records 10 fixtures");
    assert.strictEqual(goldenNames.length, 10, "golden.json carries 10 fixture solves");
    assert.deepStrictEqual(Object.keys(solves).sort(), goldenNames.slice().sort(),
      "the same fixture names are solved and pinned");
  });

  // U1 — the credited fixtures must still DECLARE credits. Without this, deleting
  // `declaredCredits` from a fixture silently demotes it to an ordinary solve: the
  // guard keeps passing (it would re-ratify against whatever it produces) while
  // covering none of the credit path. A guard that can stop checking without
  // failing is the shape this repo has been bitten by; assert the input, not just
  // the output.
  test("the credited fixtures actually carry declared credits", () => {
    const fixtures = JSON.parse(fs.readFileSync(
      path.join(__dirname, "parity", "fixtures.json"), "utf8"));
    const credited = fixtures.filter((f) => f.query && f.query.declaredCredits
      && Object.keys(f.query.declaredCredits).length);
    assert.strictEqual(credited.length, 2,
      "2 fixtures must declare credits; a dropped declaration would leave the credit path unpinned");

    const byName = Object.fromEntries(credited.map((f) => [f.name, f]));
    const displaces = byName["trance-credit-displaces-ml34"];
    assert.ok(displaces, "the displacement fixture is present");
    assert.deepStrictEqual(displaces.query.declaredCredits["Combat Mastery||Insight"],
      { stat: "Combat Mastery", bonus_type: "Insight", value: 7 },
      "Insight Combat Mastery caps at 6 in the catalog, so 7 is what makes this fixture displace");

    const additive = byName["trance-credit-additive-ml32"];
    assert.ok(additive, "the additive fixture is present");
    assert.deepStrictEqual(additive.query.declaredCredits["Devotion||Sacred"],
      { stat: "Devotion", bonus_type: "Sacred", value: 12 },
      "no item carries Sacred-typed Devotion, so this credit must sit in an empty bucket");
  });

  // Each credited fixture is paired with an identical uncredited twin, so the
  // guard asserts the credit's EFFECT rather than two absolute numbers. A drift
  // that moved both halves together would keep the per-fixture equality tests
  // green; these deltas would not survive it.
  //
  // SCOPE LIMIT, verified by corruption: deleting buildProgram's credit bucket
  // floor (`sum(value_i * z_i) >= creditValue`) leaves all 10 fixtures green.
  // These solve the OPTIMUM path, where each stage maximizes its stat and the
  // objective pulls the credit's binary to 1 on its own. The floor only bites on
  // `tieBreak:false` paths — every Alternatives generator — so it is pinned in
  // tests/solver.test.js, not here. Do not read a green golden run as evidence
  // that the floor is intact.
  test("R5/R6 — a displacing credit raises its stat and frees a slot", () => {
    const on = golden.solves["trance-credit-displaces-ml34"];
    const off = golden.solves["trance-credit-displaces-ml34-baseline"];
    assert.strictEqual(off.perTarget["Combat Mastery"], 29,
      "uncredited, the best Insight-typed Combat Mastery the catalog offers");
    assert.strictEqual(on.perTarget["Combat Mastery"], 30,
      "the declared 7 beats every Insight item (they cap at 6), netting +1");
    assert.strictEqual(on.chosen.length, off.chosen.length - 1,
      `the beaten item's slot is freed: ${off.chosen.length} -> ${on.chosen.length}`);
    for (const stat of ["Constitution", "Physical Sheltering"]) {
      assert.ok(on.perTarget[stat] >= off.perTarget[stat],
        `${stat} must not regress when a credit frees a slot (${off.perTarget[stat]} -> ${on.perTarget[stat]})`);
    }
  });

  test("AE4 — an empty-bucket credit adds its full value and disturbs nothing", () => {
    const on = golden.solves["trance-credit-additive-ml32"];
    const off = golden.solves["trance-credit-additive-ml32-baseline"];
    assert.strictEqual(on.perTarget.Devotion - off.perTarget.Devotion, 12,
      "no item carries Sacred-typed Devotion, so the credit is purely additive");
    assert.deepStrictEqual(on.chosen, off.chosen,
      "and the loadout is byte-identical — a credit that competes with nothing must move nothing");
    assert.strictEqual(on.perTarget.Wisdom, off.perTarget.Wisdom);
    assert.strictEqual(on.perTarget["Universal Spell Power"], off.perTarget["Universal Spell Power"]);
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
