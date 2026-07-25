// U6 model-builder + dominance tests (node, zero-dependency).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const M = require("../web/model.js");

const data = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8")
);

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  PASS", name); }
  catch (e) { console.log("  FAIL", name, "\n   ", e.message); process.exitCode = 1; }
}

// minimal synthetic variant factory
function v(name, slot, affixes, opts = {}) {
  return {
    source_item: name, variant_id: name, slot, category: opts.category || "item",
    minimum_level: opts.ml ?? 10, verification: "verified",
    affixes: affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, value, unit: "flat" })),
    scaling: opts.scaling || [], set_bonus: opts.sets ? opts.sets.map((s) => ({ set: s })) : [],
    augment_slots: opts.aug || [], restrictions: "unknown", armor_type: null,
  };
}

test("dominates: strictly-better same-slot variant dominates", () => {
  const A = v("A", "Ring", [["Intelligence", "Enhancement", 10]]);
  const B = v("B", "Ring", [["Intelligence", "Enhancement", 5]]);
  const targets = new Set(["Intelligence"]);
  assert.ok(M.dominates(A, B, targets, 30));
  assert.ok(!M.dominates(B, A, targets, 30));
});

test("dominanceFilter prunes the dominated variant", () => {
  const A = v("A", "Ring", [["Intelligence", "Enhancement", 10]]);
  const B = v("B", "Ring", [["Intelligence", "Enhancement", 5]]);
  const kept = M.dominanceFilter([A, B], new Set(["Intelligence"]), 30);
  assert.deepStrictEqual(kept.map((x) => x.source_item), ["A"]);
});

test("dominanceFilter keeps a dominated set-member in a multi-pick slot", () => {
  // Two Rings of the same set: A dominates B on the target, but in a cardinality-2
  // slot both count as set pieces toward a threshold, so B must NOT be pruned.
  const A = v("A", "Ring", [["Strength", "Enhancement", 10]], { sets: ["S"] });
  const B = v("B", "Ring", [["Strength", "Enhancement", 8]], { sets: ["S"] });
  const kept2 = M.dominanceFilter([A, B], new Set(["Strength"]), 30, 2);
  assert.strictEqual(kept2.length, 2, "both set-members survive in a cardinality-2 slot");
  // sanity: at cardinality 1 the dominated set-member is still pruned
  const kept1 = M.dominanceFilter([A, B], new Set(["Strength"]), 30, 1);
  assert.deepStrictEqual(kept1.map((x) => x.source_item), ["A"]);
});

test("different bonus-type on same stat is NOT dominated", () => {
  // A has Enhancement INT, B has Insightful INT — neither dominates (different buckets)
  const A = v("A", "Ring", [["Intelligence", "Enhancement", 10]]);
  const B = v("B", "Ring", [["Intelligence", "Insightful", 4]]);
  const kept = M.dominanceFilter([A, B], new Set(["Intelligence"]), 30);
  assert.strictEqual(kept.length, 2);
});

test("variant in a unique set is NOT dominated by a stat-better peer", () => {
  const A = v("A", "Ring", [["Intelligence", "Enhancement", 10]]);
  const B = v("B", "Ring", [["Intelligence", "Enhancement", 5]], { sets: ["Legendary Foo"] });
  const kept = M.dominanceFilter([A, B], new Set(["Intelligence"]), 30);
  assert.strictEqual(kept.length, 2, "B kept for its unique set membership");
});

test("dominance only considers target stats", () => {
  // A wins a NON-target (Strength) but loses the target (Intelligence) -> A's
  // off-target advantage must NOT save it: B dominates on Intelligence alone.
  const A = v("A", "Ring", [["Strength", "Enhancement", 20], ["Intelligence", "Enhancement", 3]]);
  const B = v("B", "Ring", [["Intelligence", "Enhancement", 10]]);
  const kept = M.dominanceFilter([A, B], new Set(["Intelligence"]), 30);
  assert.deepStrictEqual(kept.map((x) => x.source_item), ["B"]);
  // when Strength IS also a target, neither dominates (A wins Str, B wins Int)
  const kept2 = M.dominanceFilter([A, B], new Set(["Intelligence", "Strength"]), 30);
  assert.strictEqual(kept2.length, 2);
});

test("eligible filters ML above cap", () => {
  const lo = v("Lo", "Ring", [["Intelligence", "Enhancement", 5]], { ml: 10 });
  const hi = v("Hi", "Ring", [["Intelligence", "Enhancement", 9]], { ml: 34 });
  const out = M.eligible([lo, hi], { mlCap: 20, targets: ["Intelligence"] });
  assert.deepStrictEqual(out.map((x) => x.source_item), ["Lo"]);
});

test("scaledValue interpolates and clamps", () => {
  const s = { val_lo: 1, ml_lo: 1, val_hi: 14, ml_hi: 32 };
  assert.strictEqual(M.scaledValue(s, 1), 1);
  assert.strictEqual(M.scaledValue(s, 32), 14);
  assert.strictEqual(M.scaledValue(s, 40), 14); // clamp
  assert.ok(M.scaledValue(s, 16) > 1 && M.scaledValue(s, 16) < 14);
});

test("buildModel over real dataset prunes per slot", () => {
  const model = M.buildModel(data.items, {
    mlCap: 34, targets: ["Intelligence", "Constitution"], armorType: null,
  });
  assert.ok(model.worn.length > 0, "expected worn slots");
  const eligible = (pred) => data.items.filter((x) => pred(x) && x.verification === "verified" && x.minimum_level <= 34).length;
  for (const slot of model.worn) {
    // Main Hand / Rune Arm are synthetic (category-merged) slots; others map to a real slot field.
    let raw;
    if (slot.slot === "Main Hand") raw = eligible((x) => x.category === "weapon");
    else if (slot.slot === "Rune Arm") raw = eligible((x) => x.category === "runearm");
    else raw = eligible((x) => x.slot === slot.slot);
    assert.ok(slot.variants.length <= raw, `${slot.slot}: pruned (${slot.variants.length}) <= raw (${raw})`);
    assert.ok(slot.variants.length >= 1);
  }
  assert.ok(model.augments.length >= 0);
});

test("weapon types share ONE main-hand slot (not one slot per type)", () => {
  const lc = v("LC", "Light Crossbow", [["Accuracy", "Enhancement", 10]], { category: "weapon" });
  const hc = v("HC", "Heavy Crossbow", [["Deadly", "Enhancement", 10]], { category: "weapon" });
  const rc = v("RC", "Repeating Heavy Crossbow", [["Seeker", "Enhancement", 10]], { category: "weapon" });
  const ra = v("RA", "Rune Arm", [["Intelligence", "Enhancement", 10]], { category: "runearm" });
  const model = M.buildModel([lc, hc, rc, ra], {
    mlCap: 34, targets: ["Accuracy", "Deadly", "Seeker", "Intelligence"], armorType: null,
  });
  const mh = model.worn.find((s) => s.slot === "Main Hand");
  assert.ok(mh, "expected a single Main Hand slot");
  assert.strictEqual(mh.cardinality, 1);
  assert.deepStrictEqual(mh.variants.map((x) => x.source_item).sort(), ["HC", "LC", "RC"]);
  assert.ok(model.worn.find((s) => s.slot === "Rune Arm"), "rune-arm is its own slot");
  // and no per-weapon-type slots leak through
  assert.ok(!model.worn.some((s) => s.slot === "Light Crossbow"));
});

test("dodge cap set only when Dodge is a target and armor given", () => {
  const noCap = M.buildModel(data.items, { mlCap: 34, targets: ["Intelligence"], armorType: "heavy" });
  assert.strictEqual(noCap.dodgeCap, null);
  const cap = M.buildModel(data.items, { mlCap: 34, targets: ["Dodge"], armorType: "heavy" });
  assert.strictEqual(cap.dodgeCap, M.ARMOR_DODGE_CAP.heavy);
});

console.log(`\n${passed} passed`);
