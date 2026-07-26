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

test("dominates: an affix item does NOT dominate a Dino blank offering slots it lacks", () => {
  // Regression (U4): a Dinosaur Bone blank's value is its typed Dino slots; if
  // dominance ignored them, any affix-bearing item in the slot would prune the
  // blank and its insert capacity would be lost.
  const real = v("Real", "Boots", [["Constitution", "Enhancement", 10]]);
  const blank = v("Blank", "Boots", []);
  blank.dino_slots_norm = ["Scale", "Fang", "Claw", "Horn"];
  const targets = new Set(["Constitution"]);
  assert.strictEqual(M.dominates(real, blank, targets, 34), false,
    "real item lacks Dino slots -> cannot dominate the blank host");
  const kept = M.dominanceFilter([real, blank], targets, 34, 1);
  assert.strictEqual(kept.length, 2, "blank survives per-slot dominance");
});

test("buildModel exposes a target-filtered Dino insert pool", () => {
  const model = M.buildModel([], { mlCap: 34, targets: ["Constitution"] }, [
    { dino_type: "Scale", stat: "Constitution", bonus_type: "Enhancement", value: 14 },
    { dino_type: "Claw", stat: "Dodge", bonus_type: "Enhancement", value: 5 }, // not a target
  ]);
  assert.strictEqual(model.dinoInserts.length, 1, "only target-relevant inserts kept");
  assert.strictEqual(model.dinoInserts[0].stat, "Constitution");
});

test("dominates: an affix item does NOT dominate a Nearly-Complete host it can't match", () => {
  // Regression: a host whose value is a craftable NC slot must survive dominance
  // against an intrinsically-better rival that lacks that slot (or its category).
  const real = v("Real", "Ring", [["Strength", "Enhancement", 12]]);
  const host = v("Host", "Ring", [["Strength", "Enhancement", 8]]);
  host.nearly_complete = "Ability Score";
  host.minimum_level = 35;
  const targets = new Set(["Strength"]);
  assert.strictEqual(M.dominates(real, host, targets, 36), false,
    "a rival lacking the NC slot cannot dominate the host");
  const kept = M.dominanceFilter([real, host], targets, 36, 1);
  assert.strictEqual(kept.length, 2, "the NC host survives per-slot dominance");
});

test("buildModel exposes a target-filtered Nearly-Complete pool", () => {
  const model = M.buildModel([], { mlCap: 36, targets: ["Constitution"] }, [], [
    { category: "Ability Score", stat: "Constitution", bonus_type: "Enhancement", value: 15, tier: "legendary" },
    { category: "Spell Focus", stat: "Evocation Focus", bonus_type: "Equipment", value: 13, tier: "legendary" }, // not a target
  ]);
  assert.strictEqual(model.nearlyComplete.length, 1, "only target-relevant options kept");
  assert.strictEqual(model.nearlyComplete[0].stat, "Constitution");
});

test("dominates: an affix item does NOT dominate a Viktranium host it can't match", () => {
  // Regression: a Lamordia host's craftable value lives in lamordia_slots, outside
  // variantBuckets, so an intrinsically-better rival lacking that typed slot must
  // NOT prune the host (the same trap as Dino blanks and NC hosts).
  const real = v("Real", "Neck", [["Strength", "Enhancement", 12]]);
  const host = v("Host", "Neck", [["Strength", "Enhancement", 8]]);
  host.lamordia_slots = [{ type: "Melancholic", category: "Accessory" }];
  host.minimum_level = 35;
  const targets = new Set(["Strength"]);
  assert.strictEqual(M.dominates(real, host, targets, 36), false,
    "a rival lacking the Lamordia slot cannot dominate the host");
  const kept = M.dominanceFilter([real, host], targets, 36, 1);
  assert.strictEqual(kept.length, 2, "the Viktranium host survives per-slot dominance");
});

test("dominates: a Viktranium host at a DIFFERENT tier is not matched", () => {
  // Tier is part of the slot key: a heroic host cannot stand in for a legendary
  // host's craft, so it must not dominate it even with identical (type, category).
  const heroic = v("Heroic", "Neck", []);
  heroic.lamordia_slots = [{ type: "Melancholic", category: "Accessory" }];
  heroic.minimum_level = 11; // heroic (Viktranium heroic recipe ML11)
  const legendary = v("Legendary", "Neck", []);
  legendary.lamordia_slots = [{ type: "Melancholic", category: "Accessory" }];
  legendary.minimum_level = 34; // legendary (real host ML)
  const targets = new Set(["Constitution"]);
  assert.strictEqual(M.dominates(heroic, legendary, targets, 36), false,
    "heroic slot cannot match a legendary slot (tier is part of the key)");
});

test("buildModel exposes a target-filtered Viktranium pool", () => {
  const model = M.buildModel([], { mlCap: 36, targets: ["Constitution"] }, [], [], [
    { slot_type: "Melancholic", category: "Accessory", stat: "Constitution", bonus_type: "Enhancement", value: 15, tier: "legendary" },
    { slot_type: "Dolorous", category: "Weapon", stat: "Attack", bonus_type: "Competence", value: 23, tier: "legendary" }, // not a target
  ]);
  assert.strictEqual(model.viktranium.length, 1, "only target-relevant options kept");
  assert.strictEqual(model.viktranium[0].stat, "Constitution");
});

test("lamordiaTier + lamordiaSlotKeys derive tier from ML and key by type/category/tier", () => {
  // ML34 is the real-host case: every Lamordia host is a Legendary (ML34) item,
  // so ML34 MUST resolve legendary. The boundary sits at DDO's Heroic->Legendary
  // split (ML30), not NC's ML35 — a heroic Viktranium host is ML8/11.
  assert.strictEqual(M.lamordiaTier({ minimum_level: 34 }), "legendary", "ML34 host is legendary");
  assert.strictEqual(M.lamordiaTier({ minimum_level: 35 }), "legendary");
  assert.strictEqual(M.lamordiaTier({ minimum_level: 30 }), "legendary", "boundary: ML30 legendary");
  assert.strictEqual(M.lamordiaTier({ minimum_level: 11 }), "heroic", "heroic recipe ML11 is heroic");
  const keys = M.lamordiaSlotKeys({
    minimum_level: 34,
    lamordia_slots: [{ type: "Melancholic", category: "Accessory" }],
  });
  assert.deepStrictEqual(keys, ["Melancholic||Accessory||legendary"]);
});

console.log(`\n${passed} passed`);
