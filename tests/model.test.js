// U6 model-builder + dominance tests (node, zero-dependency).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const M = require("../web/model.js");
const { normalizeDataset } = require("../web/dataset.js");

const data = normalizeDataset(JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8")
));

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  PASS", name); }
  catch (e) { console.log("  FAIL", name, "\n   ", e.message); process.exitCode = 1; }
}

// minimal synthetic variant factory
function v(name, slot, affixes, opts = {}) {
  return {
    source_item: name, variant_id: name, slot, category: opts.category || "item",
    minimum_level: opts.ml ?? 10, ml: opts.ml ?? 10, verification: "verified",
    affixes: affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, name: stat, type: bonus_type, value, unit: "flat" })),
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

test("dominanceFilter keeps the Gem (joker set piece) against a stronger plain Trinket", () => {
  // The Gem's value lives in joker_set_groups (outside buckets and set_bonus). A
  // stronger plain-affix Trinket must NOT prune it, or the wildcard is silently lost.
  const strong = v("StrongTrinket", "Trinket", [["Intelligence", "Enhancement", 20]]);
  const gem = v("Legendary Gem of Many Facets", "Trinket", []);
  gem.joker_set_groups = [["Set A", "Set B"], ["Set C"]];
  const targets = new Set(["Intelligence"]);
  assert.ok(!M.dominates(strong, gem, targets, 34), "the Gem's joker capacity must not be dominated");
  const kept = M.dominanceFilter([strong, gem], targets, 34);
  assert.ok(kept.some((x) => x.source_item === "Legendary Gem of Many Facets"), "the Gem survives the filter");
});

test("dominates: a plain Trinket without joker groups is unaffected by the joker guard", () => {
  const A = v("A", "Trinket", [["Intelligence", "Enhancement", 10]]);
  const B = v("B", "Trinket", [["Intelligence", "Enhancement", 5]]);
  assert.ok(M.dominates(A, B, new Set(["Intelligence"]), 30), "normal dominance still applies to non-joker items");
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

test("eligible honors the optional mlFloor (hide low-level gear)", () => {
  const lo = v("Lo", "Ring", [["Intelligence", "Enhancement", 5]], { ml: 10 });
  const hi = v("Hi", "Ring", [["Intelligence", "Enhancement", 9]], { ml: 34 });
  // with a floor of 30, the ML10 ring is excluded; ML34 kept.
  const floored = M.eligible([lo, hi], { mlCap: 36, mlFloor: 30, targets: ["Intelligence"] });
  assert.deepStrictEqual(floored.map((x) => x.source_item), ["Hi"]);
  // no floor (null/absent) -> current behavior, both kept.
  const none = M.eligible([lo, hi], { mlCap: 36, mlFloor: null, targets: ["Intelligence"] });
  assert.deepStrictEqual(none.map((x) => x.source_item).sort(), ["Hi", "Lo"]);
});

// artifact variant factory: a normal variant flagged as Artifact-quality.
function art(name, slot, affixes, opts = {}) {
  const x = v(name, slot, affixes, opts);
  x.artifact = true;
  return x;
}

test("U2/R2: eligible EXCLUDES artifacts when the box is off (default)", () => {
  const ring = v("Ring", "Ring", [["Intelligence", "Enhancement", 5]]);
  const arti = art("Arti", "Ring", [["Intelligence", "Enhancement", 9]]);
  // default (no includeArtifact) — matches today's behavior
  const off = M.eligible([ring, arti], { mlCap: 34, targets: ["Intelligence"] });
  assert.deepStrictEqual(off.map((x) => x.source_item), ["Ring"]);
});

test("U2/R3: eligible INCLUDES artifacts when the box is on", () => {
  const ring = v("Ring", "Ring", [["Intelligence", "Enhancement", 5]]);
  const arti = art("Arti", "Ring", [["Intelligence", "Enhancement", 9]]);
  const on = M.eligible([ring, arti], { mlCap: 34, targets: ["Intelligence"], includeArtifact: true });
  assert.deepStrictEqual(on.map((x) => x.source_item).sort(), ["Arti", "Ring"]);
});

test("U2/KTD2: dominance exemption keeps a dominated Artifact when box is on", () => {
  // non-artifact A (Int 10) strictly dominates artifact B (Int 5) in the Ring slot.
  const A = v("A", "Ring", [["Intelligence", "Enhancement", 10]]);
  const B = art("B", "Ring", [["Intelligence", "Enhancement", 5]]);
  const model = M.buildModel([A, B], { mlCap: 34, targets: ["Intelligence"], includeArtifact: true });
  const ring = model.worn.find((s) => s.slot === "Ring");
  assert.ok(ring, "expected a Ring slot");
  const kept = ring.variants.map((x) => x.source_item).sort();
  assert.deepStrictEqual(kept, ["A", "B"], "the dominated Artifact must survive pruning");
});

test("U2/KTD2: a dominated NON-artifact is still pruned when box is on (exemption is artifact-only)", () => {
  const A = v("A", "Ring", [["Intelligence", "Enhancement", 10]]);
  const B = v("B", "Ring", [["Intelligence", "Enhancement", 5]]); // non-artifact, dominated
  const model = M.buildModel([A, B], { mlCap: 34, targets: ["Intelligence"], includeArtifact: true });
  const ring = model.worn.find((s) => s.slot === "Ring");
  assert.deepStrictEqual(ring.variants.map((x) => x.source_item), ["A"]);
});

test("U2/KTD2 soundness: an Artifact must NOT prune a non-Artifact when box on", () => {
  // artifact B (Int 10) dominates non-artifact A (Int 5) in the Ring slot. Because
  // exactly-one can force B off (a different Artifact wins elsewhere), A could be
  // the true best-available Ring — so A must survive pruning when the box is on.
  const A = v("A", "Ring", [["Intelligence", "Enhancement", 5]]);
  const B = art("B", "Ring", [["Intelligence", "Enhancement", 10]]);
  const model = M.buildModel([A, B], { mlCap: 34, targets: ["Intelligence"], includeArtifact: true });
  const ring = model.worn.find((s) => s.slot === "Ring");
  const kept = ring.variants.map((x) => x.source_item).sort();
  assert.deepStrictEqual(kept, ["A", "B"], "the Artifact must not prune the non-Artifact");
});

test("U2/KTD2 soundness: box OFF, an Artifact-flagged item is excluded so normal pruning holds", () => {
  // With the box off the artifact is excluded entirely (R2), so only A remains.
  const A = v("A", "Ring", [["Intelligence", "Enhancement", 5]]);
  const B = art("B", "Ring", [["Intelligence", "Enhancement", 10]]);
  const model = M.buildModel([A, B], { mlCap: 34, targets: ["Intelligence"] });
  const ring = model.worn.find((s) => s.slot === "Ring");
  assert.deepStrictEqual(ring.variants.map((x) => x.source_item), ["A"]);
});

test("U2/KTD5: box off leaves pruning byte-for-byte unchanged (no exemption leak)", () => {
  const A = v("A", "Ring", [["Intelligence", "Enhancement", 10]]);
  const B = v("B", "Ring", [["Intelligence", "Enhancement", 5]]);
  const baseline = M.buildModel([A, B], { mlCap: 34, targets: ["Intelligence"] });
  const off = M.buildModel([A, B], { mlCap: 34, targets: ["Intelligence"], includeArtifact: false });
  const names = (m) => m.worn.find((s) => s.slot === "Ring").variants.map((x) => x.source_item);
  assert.deepStrictEqual(names(off), names(baseline));
  assert.deepStrictEqual(names(baseline), ["A"]);
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
  host.minimum_level = host.ml = 35;
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
  host.minimum_level = host.ml = 35;
  const targets = new Set(["Strength"]);
  assert.strictEqual(M.dominates(real, host, targets, 36), false,
    "a rival lacking the Lamordia slot cannot dominate the host");
  const kept = M.dominanceFilter([real, host], targets, 36, 1);
  assert.strictEqual(kept.length, 2, "the Viktranium host survives per-slot dominance");
});

test("dominates: an affix item does NOT dominate a seal host it can't match", () => {
  // Regression: a seal host's unseal value lives in seal_slots, outside
  // variantBuckets, so an intrinsically-better rival lacking the seal must NOT
  // prune the host (the same trap as Dino blanks, NC, and Viktranium hosts).
  const real = v("Real", "Trinket", [["Charisma", "Enhancement", 12]]);
  const host = v("Host", "Trinket", [["Charisma", "Enhancement", 8]]);
  host.seal_slots = [{ seal_type: "Undeath", category: "Trinket" }];
  const targets = new Set(["Charisma"]);
  assert.strictEqual(M.dominates(real, host, targets, 34), false,
    "a rival lacking the seal slot cannot dominate the host");
  const kept = M.dominanceFilter([real, host], targets, 34, 1);
  assert.strictEqual(kept.length, 2, "the seal host survives per-slot dominance");
});

test("dominates: an affix item does NOT dominate a Thunder-Forged host it can't match", () => {
  // Regression: a TF host's craftable value lives in thunder_forged_tiers, outside
  // variantBuckets, so a stronger plain-affix rival lacking the tier slots must NOT prune it.
  const real = v("Real", "Main Hand", [["Strength", "Enhancement", 12]], { category: "weapon" });
  const host = v("Host", "Main Hand", [["Strength", "Enhancement", 8]], { category: "weapon" });
  host.thunder_forged_tiers = [{ tier: 1 }, { tier: 2 }, { tier: 3 }];
  const targets = new Set(["Strength"]);
  assert.strictEqual(M.dominates(real, host, targets, 34), false,
    "a rival lacking the TF tier slots cannot dominate the host");
  assert.strictEqual(M.dominanceFilter([real, host], targets, 34, 1).length, 2, "the TF host survives");
});

test("dominates: an affix item does NOT dominate a Green Steel host it can't match", () => {
  const real = v("Real", "Trinket", [["Constitution", "Enhancement", 12]]);
  const host = v("Host", "Trinket", [["Constitution", "Enhancement", 8]]);
  host.green_steel_slot = true;
  const targets = new Set(["Constitution"]);
  assert.strictEqual(M.dominates(real, host, targets, 34), false,
    "a rival lacking the Green Steel slot cannot dominate the host");
  assert.strictEqual(M.dominanceFilter([real, host], targets, 34, 1).length, 2, "the GS host survives");
});

test("dominates: an affix item does NOT dominate a chosen set-membership host it can't match", () => {
  // Regression: a Lost Purpose / Dino Set-Bonus host's value lives in
  // set_membership_slot.pool (which sets it can join toward a threshold), outside
  // variantBuckets AND set_bonus. A stronger plain-affix rival lacking the slot must
  // NOT prune it (the same trap as Dino blanks / seal / joker hosts).
  const real = v("Real", "Helmet", [["Constitution", "Enhancement", 12]]);
  const host = v("Host", "Helmet", [["Constitution", "Enhancement", 8]]);
  host.set_membership_slot = { pool: ["Legendary Vol's Influence"], station: "Cannith Repurposing Station" };
  const targets = new Set(["Constitution"]);
  assert.strictEqual(M.dominates(real, host, targets, 34), false,
    "a rival lacking the membership slot cannot dominate the host");
  const kept = M.dominanceFilter([real, host], targets, 34, 1);
  assert.strictEqual(kept.length, 2, "the membership host survives per-slot dominance");
});

test("dominanceFilter keeps a dominated membership host in a multi-pick slot", () => {
  // Two Rings that can both join the same set: A dominates B on the target, but in a
  // cardinality-2 slot both are needed to reach a piece threshold, so neither is pruned.
  const A = v("RingA", "Ring", [["Strength", "Enhancement", 10]]);
  const B = v("RingB", "Ring", [["Strength", "Enhancement", 6]]);
  B.set_membership_slot = { pool: ["Legendary Vol's Influence"] };
  A.set_membership_slot = { pool: ["Legendary Vol's Influence"] };
  const kept2 = M.dominanceFilter([A, B], new Set(["Strength"]), 30, 2);
  assert.strictEqual(kept2.length, 2, "both membership hosts survive in a cardinality-2 slot");
});

test("dominates: a Viktranium host at a DIFFERENT tier is not matched", () => {
  // Tier is part of the slot key: a heroic host cannot stand in for a legendary
  // host's craft, so it must not dominate it even with identical (type, category).
  const heroic = v("Heroic", "Neck", []);
  heroic.lamordia_slots = [{ type: "Melancholic", category: "Accessory" }];
  heroic.minimum_level = heroic.ml = 11; // heroic (Viktranium heroic recipe ML11)
  const legendary = v("Legendary", "Neck", []);
  legendary.lamordia_slots = [{ type: "Melancholic", category: "Accessory" }];
  legendary.minimum_level = legendary.ml = 34; // legendary (real host ML)
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
  assert.strictEqual(M.lamordiaTier({ ml: 34 }), "legendary", "ML34 host is legendary");
  assert.strictEqual(M.lamordiaTier({ ml: 35 }), "legendary");
  assert.strictEqual(M.lamordiaTier({ ml: 30 }), "legendary", "boundary: ML30 legendary");
  assert.strictEqual(M.lamordiaTier({ ml: 11 }), "heroic", "heroic recipe ML11 is heroic");
  const keys = M.lamordiaSlotKeys({
    ml: 34,
    lamordia_slots: [{ type: "Melancholic", category: "Accessory" }],
  });
  assert.deepStrictEqual(keys, ["Melancholic||Accessory||legendary"]);
});

// --- U2 character gate (eligible) -----------------------------------------
function armorV(name, armorType) {
  return { ...v(name, "Armor", [["Constitution", "Enhancement", 20]]), armor_type: armorType };
}

test("AE1: Warforged keeps docents, excludes body armor in the Armor slot", () => {
  const pool = [
    armorV("Flightless Bird's Icebox", "unknown"),
    { ...v("Adamantine Docent", "Armor", [["Fortification", "Enhancement", 100]]) },
  ];
  const kept = M.eligible(pool, { mlCap: 34, race: "warforged" }).map((x) => x.source_item);
  assert.deepStrictEqual(kept, ["Adamantine Docent"]);
});

test("AE1 inverse: a non-Forged race excludes docents", () => {
  const pool = [
    armorV("Cloudburst Shell", "unknown"),
    v("Adamantine Docent", "Armor", [["Fortification", "Enhancement", 100]]),
  ];
  const kept = M.eligible(pool, { mlCap: 34, race: "human" }).map((x) => x.source_item);
  assert.deepStrictEqual(kept, ["Cloudburst Shell"]);
});

test("armor-type excludes mismatched body armor when armor_type is concrete", () => {
  const pool = [armorV("Heavy Plate", "heavy"), armorV("Silk Robe", "cloth")];
  // gated on the dedicated wizard field armorTypes (proficiency set), not armorType
  const kept = M.eligible(pool, { mlCap: 34, armorTypes: ["cloth"] }).map((x) => x.source_item);
  assert.deepStrictEqual(kept, ["Silk Robe"]);
});

test("armor-type proficiency set keeps every allowed type (heavy-prof wears lighter)", () => {
  const pool = [armorV("Robe", "cloth"), armorV("Chain", "medium"), armorV("Plate", "heavy")];
  const kept = M.eligible(pool, { mlCap: 34, armorTypes: ["cloth", "light", "medium", "heavy"] });
  assert.strictEqual(kept.length, 3);
});

test('armor-type filter fails open on "unknown" (current dataset)', () => {
  const pool = [armorV("Whatsit", "unknown")];
  assert.strictEqual(M.eligible(pool, { mlCap: 34, armorTypes: ["cloth"] }).length, 1);
});

test("live query.armorType (dodge-cap input) does NOT gate armor (P2 decoupling)", () => {
  // passing the live armorType field must not exclude concrete-typed armor
  const pool = [armorV("Heavy Plate", "heavy"), armorV("Silk Robe", "cloth")];
  const kept = M.eligible(pool, { mlCap: 34, armorType: "cloth" }).map((x) => x.source_item).sort();
  assert.deepStrictEqual(kept, ["Heavy Plate", "Silk Robe"]);
});

test("a docent bypasses the armor-type proficiency filter", () => {
  const pool = [{ ...v("Adamantine Docent", "Armor", [["Fortification", "Enhancement", 100]]), armor_type: "heavy" }];
  const kept = M.eligible(pool, { mlCap: 34, race: "warforged", armorTypes: ["cloth"] });
  assert.strictEqual(kept.length, 1); // docent kept despite armorTypes=[cloth]
});

test("alignment_req of [] fails open (no gate)", () => {
  const item = { ...v("Trink", "Trinket", [["Melee Power", "Profane", 20]]), alignment_req: [] };
  assert.strictEqual(M.eligible([item], { mlCap: 34, alignment: "Chaotic Neutral" }).length, 1);
});

test("AE2: alignment excludes items whose alignment_req is unmet, incl. by axis", () => {
  const item = { ...v("Litany of the Dead", "Trinket", [["Melee Power", "Profane", 20]]), alignment_req: ["Lawful Good", "Lawful Neutral"] };
  assert.strictEqual(M.eligible([item], { mlCap: 34, alignment: "Chaotic Neutral" }).length, 0);
  assert.strictEqual(M.eligible([item], { mlCap: 34, alignment: "Lawful Neutral" }).length, 1);
});

test("backward-compat: no race/alignment fields → no new filtering (live behavior)", () => {
  const pool = [
    v("Docent of Gravity", "Armor", [["Constitution", "Enhancement", 20]]),
    armorV("Some Robe", "unknown"),
  ];
  // current query shape (mlCap + armorType only) leaves both eligible
  const kept = M.eligible(pool, { mlCap: 34, armorType: "cloth" }).map((x) => x.source_item).sort();
  assert.deepStrictEqual(kept, ["Docent of Gravity", "Some Robe"]);
});

test("isForgedRace / isDocent helpers", () => {
  assert.ok(M.isForgedRace("Bladeforged") && M.isForgedRace("warforged"));
  assert.ok(!M.isForgedRace("elf") && !M.isForgedRace(""));
  assert.ok(M.isDocent({ source_item: "Saltiron Docent" }));
  assert.ok(!M.isDocent({ source_item: "Cloak of Night" }));
});

// ---- U2 — weapon-type / off-hand / style constraints -----------------------
// Synthetic weapon (category "weapon") and off-hand (slot "Off Hand") builders,
// carrying a native `type` the new gates read.
function wt(name, type, affixes = [["Strength", "Enhancement", 5]]) {
  const w = v(name, "Weapon", affixes, { category: "weapon", ml: 30 });
  w.type = type; return w;
}
function oh(name, type, affixes = [["Constitution", "Enhancement", 5]]) {
  const o = v(name, "Off Hand", affixes, { ml: 30 });
  o.type = type; return o;
}
const T = new Set(["Strength", "Constitution"]);

test("U2/B1: an Off Hand slot is built and off-hand items are equippable", () => {
  const model = M.buildModel([oh("Orb", "Orbs"), oh("Tower", "Tower shields")],
    { mlCap: 34, targets: ["Constitution"] });
  const slot = model.worn.find((s) => s.slot === "Off Hand");
  assert.ok(slot, "expected an Off Hand slot");
  assert.strictEqual(slot.cardinality, 1);
  assert.ok(slot.variants.length >= 1, "off-hand items entered the pool");
});

test("U2/B3: weaponTypes pins Main Hand to the allowed types", () => {
  const items = [wt("Sword", "Long Swords"), wt("Falchion", "Falchions")];
  const one = M.eligible(items, { mlCap: 34, targets: ["Strength"], weaponTypes: ["Long Swords"] });
  assert.deepStrictEqual(one.map((x) => x.type), ["Long Swords"]);
  const both = M.eligible([...items, wt("Rapier", "Rapiers")],
    { mlCap: 34, targets: ["Strength"], weaponTypes: ["Long Swords", "Rapiers"] });
  assert.deepStrictEqual(both.map((x) => x.type).sort(), ["Long Swords", "Rapiers"]);
});

test("U2/B4: offHand pins the Off Hand slot to the allowed types", () => {
  const items = [oh("Orb", "Orbs"), oh("Tower", "Tower shields")];
  const only = M.eligible(items, { mlCap: 34, targets: ["Constitution"], offHand: ["Tower shields"] });
  assert.deepStrictEqual(only.map((x) => x.type), ["Tower shields"]);
});

test("U2/B5: a two-hand style builds no Off Hand slot and excludes 1H weapons", () => {
  const model = M.buildModel([oh("Orb", "Orbs"), wt("Falchion", "Falchions"), wt("Sword", "Long Swords")],
    { mlCap: 34, targets: ["Strength", "Constitution"], style: "two-hand" });
  assert.ok(!model.worn.find((s) => s.slot === "Off Hand"), "two-hand => no Off Hand slot");
  const mh = model.worn.find((s) => s.slot === "Main Hand");
  assert.deepStrictEqual(mh.variants.map((x) => x.type), ["Falchions"], "one-hand weapon excluded under two-hand");
});

test("U2/KTD4: empty-only builds no Off Hand slot; a set with empty keeps its types", () => {
  const items = [oh("Orb", "Orbs"), oh("Tower", "Tower shields")];
  const noneModel = M.buildModel(items, { mlCap: 34, targets: ["Constitution"], offHand: ["empty"] });
  assert.ok(!noneModel.worn.find((s) => s.slot === "Off Hand"), "empty-only => no Off Hand slot");
  const orbModel = M.buildModel(items, { mlCap: 34, targets: ["Constitution"], offHand: ["Orbs", "empty"] });
  const slot = orbModel.worn.find((s) => s.slot === "Off Hand");
  assert.deepStrictEqual(slot.variants.map((x) => x.type), ["Orbs"], "orb kept, tower excluded, unfilled still allowed");
});

test("U2: additive no-op — an unconstrained query keeps every weapon and off-hand", () => {
  const items = [wt("Sword", "Long Swords"), wt("Falchion", "Falchions"),
    oh("Orb", "Orbs"), oh("Rune", "Rune Arms")];
  const all = M.eligible(items, { mlCap: 34, targets: ["Strength", "Constitution"] });
  assert.strictEqual(all.length, 4, "no style/weaponTypes/offHand => nothing filtered");
});

test("U2: a rune arm is equippable through the Off Hand slot", () => {
  const model = M.buildModel([oh("Rune", "Rune Arms", [["Strength", "Enhancement", 6]])],
    { mlCap: 34, targets: ["Strength"] });
  const slot = model.worn.find((s) => s.slot === "Off Hand");
  assert.ok(slot && slot.variants.some((x) => x.type === "Rune Arms"), "rune arm placed in Off Hand");
  assert.ok(!model.worn.find((s) => s.slot === "Rune Arm"), "vestigial Rune Arm slot retired");
});

console.log(`\n${passed} passed`);
