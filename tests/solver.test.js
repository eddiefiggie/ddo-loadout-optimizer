// U7 staged-lexicographic solver tests — run against the REAL HiGHS engine.
// Run: node tests/solver.test.js
const assert = require("assert");
const path = require("path");
const S = require("../web/solver.js");

const vendor = path.join(__dirname, "..", "web", "vendor") + "/";
const Highs = require(vendor + "highs.js");

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  PASS", name); }
  catch (e) { console.log("  FAIL", name, "\n   ", e.message); process.exitCode = 1; }
}

// build a worn variant + a single-variant slot
function item(id, slot, affixes) {
  return {
    variant_id: id, source_item: id, slot,
    affixes: affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, value, unit: "flat" })),
    scaling: [], set_bonus: [], augment_slots: [],
  };
}
function slot(name, variants, card = 1) { return { slot: name, cardinality: card, variants }; }

(async () => {
  const highs = await Highs({ locateFile: (f) => vendor + f });

  await test("AE2: same bonus-type does NOT stack (only highest counts)", async () => {
    const model = {
      targets: ["Intelligence"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [item("R", "Ring", [["Intelligence", "Enhancement", 10]])]),
             slot("Necklace", [item("N", "Necklace", [["Intelligence", "Enhancement", 6]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.Intelligence, 10, "max(10,6), not 16");
  });

  await test("different bonus-types DO stack (sum)", async () => {
    const model = {
      targets: ["Intelligence"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [item("R", "Ring", [["Intelligence", "Enhancement", 10]])]),
             slot("Necklace", [item("N", "Necklace", [["Intelligence", "Insightful", 6]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.Intelligence, 16);
  });

  await test("AE3: dodge cap clamps (item still equipped)", async () => {
    const model = {
      targets: ["Dodge"], mlCap: 34, dodgeCap: 4,
      worn: [slot("Ring", [item("R", "Ring", [["Dodge", "Enhancement", 20]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.Dodge, 4, "clamped to cap, not forbidden");
    assert.strictEqual(r.chosen.length, 1, "the dodge item is still equipped");
  });

  await test("AE1: lexicographic — priority 1 maxed even at cost of priority 2", async () => {
    // one slot, must choose: v1 gives A=10/B=0, v2 gives A=0/B=10. A has priority.
    const model = {
      targets: ["Accuracy", "Deadly"], mlCap: 34, dodgeCap: null,
      worn: [slot("Trinket", [
        item("hiA", "Trinket", [["Accuracy", "Enhancement", 10]]),
        item("hiB", "Trinket", [["Deadly", "Enhancement", 10]]),
      ])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.Accuracy, 10, "priority 1 maxed");
    assert.strictEqual(r.effective.Deadly, 0, "priority 2 sacrificed to keep priority 1");
    assert.strictEqual(r.chosen[0].variant.variant_id, "hiA");
  });

  await test("reversing priority flips the choice", async () => {
    const model = {
      targets: ["Deadly", "Accuracy"], mlCap: 34, dodgeCap: null,
      worn: [slot("Trinket", [
        item("hiA", "Trinket", [["Accuracy", "Enhancement", 10]]),
        item("hiB", "Trinket", [["Deadly", "Enhancement", 10]]),
      ])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.Deadly, 10);
    assert.strictEqual(r.chosen[0].variant.variant_id, "hiB");
  });

  await test("solve is deterministic across runs (tie-break)", async () => {
    const mk = () => ({
      targets: ["Intelligence"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [item("R1", "Ring", [["Intelligence", "Enhancement", 5]]),
                           item("R2", "Ring", [["Intelligence", "Enhancement", 5]])], 1)],
    });
    const a = await S.solveLexicographic(mk(), highs);
    const b = await S.solveLexicographic(mk(), highs);
    assert.deepStrictEqual(a.chosen.map((c) => c.variant.variant_id), b.chosen.map((c) => c.variant.variant_id));
  });

  console.log(`\n${passed} passed`);
})();
