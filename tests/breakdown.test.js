// U1 — breakdownByTarget: per-target bonus-type/source split derived from the
// final solution (presentation-only reader; no solve change). Run against the
// REAL HiGHS engine. Run: node tests/breakdown.test.js
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

function item(id, slot, affixes) {
  return {
    variant_id: id, source_item: id, slot,
    affixes: affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, name: stat, type: bonus_type, value, unit: "flat" })),
    scaling: [], set_bonus: [], augment_slots: [],
  };
}
function slot(name, variants, card = 1) { return { slot: name, cardinality: card, variants }; }
const AUG_FITS_SLOTS = { Blue: ["Blue", "Purple", "Green"] };
function augment(id, color, affixes) {
  return {
    variant_id: id, source_item: id, category: "augment", slot: color,
    aug_color: { color, raw: color, reason: null }, fits_slots: AUG_FITS_SLOTS[color] || [],
    affixes: affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, name: stat, type: bonus_type, value, unit: "flat" })),
    scaling: [], set_bonus: [], augment_slots: [],
  };
}
// a set-member worn item that also carries a Blue augment slot + a base affix
function setHost(id, slotName, affixes, setName, colors, tiers) {
  const v = item(id, slotName, affixes);
  v.set_bonus = [{ set: setName }];
  v.augment_slots_norm = { colors: colors || [], quarantined: [] };
  v.parsed_set_bonuses = (tiers || []).map((t) => ({
    set: setName, pieces_required: t.n, pieces_label: `${t.n} Pieces`,
    affixes: t.affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, name: stat, type: bonus_type, value, unit: "flat" })),
    flagged: [],
  }));
  return v;
}

(async () => {
  const highs = await Highs({ locateFile: (f) => vendor + f });

  await test("breakdown splits a target into typed contributions with source labels, highest-first", async () => {
    const tier = [{ n: 2, affixes: [["Constitution", "Insightful", 5]] }];
    const model = {
      targets: ["Constitution"], mlCap: 34,
      worn: [
        slot("Ring", [setHost("R", "Ring", [["Constitution", "Enhancement", 10]], "Alpha", ["Blue"], tier)]),
        slot("Necklace", [setHost("N", "Necklace", [], "Alpha", [], tier)]),
      ],
      augments: [augment("AugCon", "Blue", [["Constitution", "Quality", 3]])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    // three different bonus types stack: 10 + 5 + 3
    assert.strictEqual(r.effective.Constitution, 18, "Enhancement 10 + Insightful 5 + Quality 3");
    const parts = r.breakdown.Constitution;
    assert.strictEqual(parts.length, 3, "three typed contributions");
    // highest-first ordering
    assert.deepStrictEqual(parts.map((p) => p.value), [10, 5, 3]);
    // bonus-type + source-kind labeling
    const byType = Object.fromEntries(parts.map((p) => [p.bonus_type, p]));
    assert.strictEqual(byType.Enhancement.sourceKind, "worn");
    assert.strictEqual(byType.Enhancement.source, "R");
    assert.strictEqual(byType.Insightful.sourceKind, "set");
    assert.strictEqual(byType.Insightful.source, "Alpha");
    assert.strictEqual(byType.Quality.sourceKind, "augment");
    assert.strictEqual(byType.Quality.source, "AugCon");
    // the parts sum to the achieved value (folding, R7)
    assert.strictEqual(parts.reduce((s, p) => s + p.value, 0), r.effective.Constitution);
  });

  await test("same-type across sources shows only the winning contribution (bucket-max)", async () => {
    // worn Enhancement 10 and an augment Enhancement 6 land in one bucket -> one part.
    const model = {
      targets: ["Constitution"], mlCap: 34,
      worn: [slot("Ring", [setHost("R", "Ring", [["Constitution", "Enhancement", 10]], "Alpha", ["Blue"], [])])],
      augments: [augment("AugC", "Blue", [["Constitution", "Enhancement", 6]])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.Constitution, 10, "max(10,6)");
    const enh = r.breakdown.Constitution.filter((p) => p.bonus_type === "Enhancement");
    assert.strictEqual(enh.length, 1, "one active contribution per bucket");
    assert.strictEqual(enh[0].value, 10);
  });

  await test("computeScale reports variants, crafts, and stages", async () => {
    const model = {
      targets: ["Constitution", "Strength"], mlCap: 34,
      worn: [slot("Ring", [setHost("R", "Ring", [["Constitution", "Enhancement", 10]], "Alpha", ["Blue"], [])])],
      augments: [augment("AugC", "Blue", [["Strength", "Enhancement", 6]])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.ok(r.computeScale.variants >= 1, "counts candidate variants");
    assert.strictEqual(r.computeScale.stages, 3, "targets + 1 tie-break stage");
    assert.ok(r.computeScale.crafts >= 1, "counts craft placement options");
  });

  console.log(`\n${passed} passed`);
})();
