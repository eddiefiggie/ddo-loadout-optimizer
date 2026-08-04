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

test("an AUGMENT is exempt from the mlFloor (a low-ML augment stays a candidate), but the cap still applies", () => {
  // A ML-22 augment (e.g. a Festive +2) must survive a floor of 30 — it's a slotted
  // insert, not outleveled worn gear. A same-ML WORN item is still floored.
  const aug = v("Diamond of Festive Strength +2", "Colorless", [["Strength", "Festive", 2]], { ml: 22, category: "augment" });
  const worn = v("Old Ring", "Ring", [["Strength", "Enhancement", 5]], { ml: 22, category: "item" });
  const kept = M.eligible([aug, worn], { mlCap: 36, mlFloor: 30, targets: ["Strength"] }).map((x) => x.source_item);
  assert.ok(kept.includes("Diamond of Festive Strength +2"), "low-ML augment exempt from the floor");
  assert.ok(!kept.includes("Old Ring"), "a same-ML worn item is still floored");
  // The cap is NOT exempt: an augment above the ML cap genuinely can't be slotted.
  const overCap = v("Diamond of Future Strength", "Colorless", [["Strength", "Festive", 2]], { ml: 40, category: "augment" });
  const capped = M.eligible([overCap], { mlCap: 36, mlFloor: 30, targets: ["Strength"] });
  assert.strictEqual(capped.length, 0, "an above-cap augment is still excluded");
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
    // Main Hand is a synthetic (category-merged) slot; Off Hand and the rest map to
    // a real slot field ("Off Hand" holds orbs/shields/rune arms).
    let raw;
    if (slot.slot === "Main Hand") raw = eligible((x) => x.category === "weapon");
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
  const ra = v("RA", "Off Hand", [["Intelligence", "Enhancement", 10]]); ra.type = "Rune Arms";
  const model = M.buildModel([lc, hc, rc, ra], {
    mlCap: 34, targets: ["Accuracy", "Deadly", "Seeker", "Intelligence"], armorType: null,
  });
  const mh = model.worn.find((s) => s.slot === "Main Hand");
  assert.ok(mh, "expected a single Main Hand slot");
  assert.strictEqual(mh.cardinality, 1);
  assert.deepStrictEqual(mh.variants.map((x) => x.source_item).sort(), ["HC", "LC", "RC"]);
  assert.ok(model.worn.find((s) => s.slot === "Off Hand"), "rune-arm lives in the Off Hand slot");
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

// --- #90 constraint-violation guards, exercised against the REAL built dataset ---
// The R6 (race->body-slot) and R7 (armor-type) gates already enforce these; these
// guards pin the *dataset tags* the gates depend on. A future re-tag that drops
// `armor_type: "cloth"` off the robe, or `type: "Docents"` off a docent, would leak
// the exact violations #90 reported (Docent on a Halfling, cloth robe under Heavy)
// past a green synthetic suite — so assert directly on the shipped items.
const REAL_ROBE = data.items.find((x) => x.source_item === "Epic Robe of Insight");
const REAL_DOCENT = data.items.find((x) => x.type === "Docents" && x.slot === "Armor");

test("#90 dataset tags: Epic Robe of Insight is a cloth body-armor Armor item", () => {
  assert.ok(REAL_ROBE, "Epic Robe of Insight missing from dataset");
  assert.strictEqual(REAL_ROBE.slot, "Armor");
  assert.strictEqual(REAL_ROBE.armor_type, "cloth"); // concrete, not "unknown" (else R7 fails open)
  assert.strictEqual(M.isDocent(REAL_ROBE), false);  // must NOT be mistaken for a docent
});

test("#90 case 2: Epic Robe of Insight (cloth) is excluded when Heavy armor is selected", () => {
  const kept = M.eligible(data.items, { mlCap: 36, race: "human", armorTypes: ["heavy"] })
    .filter((x) => x.source_item === "Epic Robe of Insight");
  assert.strictEqual(kept.length, 0, "a cloth robe leaked into a Heavy-armor loadout");
});

test("#90 case 1: a real docent is rejected for a Halfling (non-Forged) with Light selected", () => {
  assert.ok(REAL_DOCENT, "no docent in dataset");
  const reason = M.variantConflict(REAL_DOCENT, { mlCap: 36, race: "halfling", armorTypes: ["light"] });
  assert.strictEqual(reason, "docents are for Forged races");
});

test("#90 case 3: a real docent is eligible for a Bladeforged (and Warforged) at ML36", () => {
  for (const race of ["bladeforged", "warforged"]) {
    assert.strictEqual(M.variantConflict(REAL_DOCENT, { mlCap: 36, race }), null,
      `docent should be equippable by a ${race}`);
  }
});

test("#90 no forbidden body-slot pick leaks across the three constraint inputs (full dataset)", () => {
  // 1) Halfling + Light: no docent, no non-light concrete body armor survives.
  const halfling = M.eligible(data.items, { mlCap: 36, race: "halfling", armorTypes: ["light"] });
  assert.strictEqual(halfling.filter((x) => x.slot === "Armor" && M.isDocent(x)).length, 0, "docent leaked to Halfling");
  assert.strictEqual(halfling.filter((x) => x.slot === "Armor" && !M.isDocent(x)
    && x.armor_type && !["light", "unknown"].includes(x.armor_type)).length, 0, "non-light body armor leaked");
  // 2) Human + Heavy: no cloth/light/medium concrete body armor survives.
  const heavy = M.eligible(data.items, { mlCap: 36, race: "human", armorTypes: ["heavy"] });
  assert.strictEqual(heavy.filter((x) => x.slot === "Armor" && !M.isDocent(x)
    && x.armor_type && !["heavy", "unknown"].includes(x.armor_type)).length, 0, "non-heavy body armor leaked to Heavy");
  // 3) Warforged: no NON-docent body armor survives; docents remain available.
  const wf = M.eligible(data.items, { mlCap: 36, race: "warforged" });
  assert.strictEqual(wf.filter((x) => x.slot === "Armor" && !M.isDocent(x)).length, 0, "body armor leaked to Warforged");
  assert.ok(wf.filter((x) => x.slot === "Armor" && M.isDocent(x)).length > 0, "no docent available to Warforged");
});

test("catalog contract: each armor class is present in the built dataset (drift guard)", () => {
  // If gear-planner's 4 armor `type` strings drift, ARMOR_TYPE_MAP misses and every
  // armor item fails open to "unknown", silently disabling the R7 gate and regressing
  // #90 while tests that pin literals stay green. Assert all 4 classes are represented.
  const classes = new Set(data.items.filter((x) => x.slot === "Armor").map((x) => x.armor_type));
  for (const cls of ["cloth", "light", "medium", "heavy"]) {
    assert.ok(classes.has(cls), `no Armor item stamped "${cls}" — gear-planner type string may have drifted`);
  }
});

test("U1 dominance: a both-hands weapon does not prune a one-handed peer (mutex re-audit)", () => {
  // A 2H weapon strictly dominates a 1H on the target, but the hand mutex can force
  // the 2H off (when an off-hand is equipped), so the 1H must survive as the true
  // best-available main hand. The 7th arg (handMutex) turns on the re-audit.
  const twoH = { ...v("Greatsword", "Main Hand", [["Strength", "Enhancement", 20]], { category: "weapon" }), type: "Great Swords" };
  const oneH = { ...v("Longsword", "Main Hand", [["Strength", "Enhancement", 10]], { category: "weapon" }), type: "Long Swords" };
  const kept = M.dominanceFilter([twoH, oneH], new Set(["Strength"]), 34, 1, null, false, true).map((x) => x.source_item);
  assert.ok(kept.includes("Longsword"), "1H peer survives despite a dominating 2H");
  assert.ok(kept.includes("Greatsword"), "2H still available when no off-hand is chosen");
});

test("U1 dominance control: without the mutex re-audit a 2H prunes a dominated 1H", () => {
  const twoH = { ...v("Greatsword", "Main Hand", [["Strength", "Enhancement", 20]], { category: "weapon" }), type: "Great Swords" };
  const oneH = { ...v("Longsword", "Main Hand", [["Strength", "Enhancement", 10]], { category: "weapon" }), type: "Long Swords" };
  const kept = M.dominanceFilter([twoH, oneH], new Set(["Strength"]), 34, 1, null, false, false).map((x) => x.source_item);
  assert.ok(!kept.includes("Longsword"), "default dominance prunes the dominated 1H");
});

test("U3/AE5: a pinned below-floor item is eligible; an unpinned one is still filtered", () => {
  const pinned = v("Pinned Ring", "Ring", [["Constitution", "Enhancement", 10]], { ml: 20 });
  const unpinned = v("Other Ring", "Ring", [["Constitution", "Enhancement", 10]], { ml: 20 });
  const query = { mlCap: 34, mlFloor: 30, slotConstraints: { Ring: { type: "pin", variant_id: "Pinned Ring" } } };
  const kept = M.eligible([pinned, unpinned], query).map((x) => x.source_item);
  assert.ok(kept.includes("Pinned Ring"), "pinned below-floor item is honored");
  assert.ok(!kept.includes("Other Ring"), "unpinned below-floor item still hidden by the floor");
});

test("U3/AE6: a pinned above-cap item is NOT honored (only the floor is exempt)", () => {
  const pinned = v("Overcap Ring", "Ring", [["Constitution", "Enhancement", 10]], { ml: 40 });
  const query = { mlCap: 34, mlFloor: 30, slotConstraints: { Ring: { type: "pin", variant_id: "Overcap Ring" } } };
  assert.strictEqual(M.eligible([pinned], query).length, 0, "above-cap pin stays invalid");
});

test("U3/AE8: a pinned below-floor item violating another dimension is still excluded", () => {
  const pinned = { ...v("Cloth Robe", "Armor", [["Constitution", "Enhancement", 10]], { ml: 20 }), type: "Cloth armor", armor_type: "cloth" };
  const query = { mlCap: 34, mlFloor: 30, armorTypes: ["heavy"], slotConstraints: { Armor: { type: "pin", variant_id: "Cloth Robe" } } };
  assert.strictEqual(M.eligible([pinned], query).length, 0, "floor exempt, but armor-type legality still excludes");
});

// U2 (#108) — a legal pin BELOW the character ML cap must survive the whole pool
// build (eligible -> dominanceFilter) into model.worn, since that is the pick var the
// solver's `x = 1` pin constraint binds to. A below-cap item is legal (the cap is an
// upper bound), so it must NOT be silently dropped/replaced. These assert at the
// buildModel layer (the solver test suite exercises the `x = 1` binding on the pool).
// A helper: the kept variants for a slot after buildModel's filter+prune.
function slotPool(model, slotName) {
  const w = model.worn.find((x) => x.slot === slotName);
  return w ? w.variants.map((x) => x.source_item) : [];
}

test("U2/#108: a legal pin BELOW the ML cap stays in its slot pool (survives filter + dominance)", () => {
  // Character ML 34, auto floor (cap - 5 = 29). An ML-20 legal Necklace is pinned; an
  // ML-34 Necklace strictly dominates it on the target. The pin must survive both the
  // below-floor exemption AND dominance pruning so its pick var exists for `x = 1`.
  const lowPin = v("Low Pinned Necklace", "Necklace", [["Constitution", "Enhancement", 5]], { ml: 20 });
  const strong = v("Strong Necklace", "Necklace", [["Constitution", "Enhancement", 20]], { ml: 34 });
  const query = { mlCap: 34, mlFloor: 29, targets: ["Constitution"],
    slotConstraints: { Necklace: { type: "pin", variant_id: "Low Pinned Necklace" } } };
  const pool = slotPool(M.buildModel([lowPin, strong], query), "Necklace");
  assert.ok(pool.includes("Low Pinned Necklace"), "below-cap pin must remain in the solver's slot pool");
});

test("U2/#108: an ILLEGAL below-cap pin is STILL dropped (no regression on illegal-pin handling)", () => {
  // Below the cap AND the floor (both exempt for a pin), but the item violates armor
  // proficiency — an illegal-for-config pin. The pin exemption covers ONLY ML gates, so
  // this pin must NOT reach the pool. Guards that the below-cap fix never weakens the
  // legality drop.
  const badPin = { ...v("Cloth Robe", "Armor", [["Constitution", "Enhancement", 10]], { ml: 20 }), type: "Cloth armor", armor_type: "cloth" };
  const query = { mlCap: 34, mlFloor: 29, armorTypes: ["heavy"], targets: ["Constitution"],
    slotConstraints: { Armor: { type: "pin", variant_id: "Cloth Robe" } } };
  const pool = slotPool(M.buildModel([badPin], query), "Armor");
  assert.ok(!pool.includes("Cloth Robe"), "an illegal (armor-type) pin is still excluded even below the cap");
});

test("U2/#108: a below-cap pin does not suppress a higher-priority legal pick in another slot", () => {
  // Pinning a low item in one slot must not perturb another slot: a strong ML-34 Ring
  // still wins its own slot's pool.
  const lowPin = v("Low Pinned Necklace", "Necklace", [["Constitution", "Enhancement", 5]], { ml: 20 });
  const strongRing = v("Strong Ring", "Ring", [["Constitution", "Enhancement", 20]], { ml: 34 });
  const query = { mlCap: 34, mlFloor: 29, targets: ["Constitution"],
    slotConstraints: { Necklace: { type: "pin", variant_id: "Low Pinned Necklace" } } };
  const model = M.buildModel([lowPin, strongRing], query);
  assert.ok(slotPool(model, "Necklace").includes("Low Pinned Necklace"), "the pinned low item is kept");
  assert.ok(slotPool(model, "Ring").includes("Strong Ring"), "an unrelated strong slot is unaffected by the pin");
});

test("U2/AE3: Sword & Board off hand keeps shields, excludes orbs and rune arms", () => {
  const shield = { ...v("Tower Shield", "Off Hand", [["Constitution", "Enhancement", 20]]), type: "Tower shields" };
  const orb = { ...v("Arcane Orb", "Off Hand", [["Intelligence", "Enhancement", 20]]), type: "Orbs" };
  const runearm = { ...v("Rune Arm", "Off Hand", [["Strength", "Enhancement", 20]]), type: "Rune Arms" };
  const kept = M.eligible([shield, orb, runearm], { mlCap: 34, style: "sword-board" }).map((x) => x.source_item);
  assert.deepStrictEqual(kept, ["Tower Shield"], "only the shield survives S&B off-hand gate");
});

test("U2/AE3: Sword & Board excludes a two-handed main-hand weapon", () => {
  const twoH = { ...v("Greatsword", "Main Hand", [["Strength", "Enhancement", 20]], { category: "weapon" }), type: "Great Swords" };
  const oneH = { ...v("Longsword", "Main Hand", [["Strength", "Enhancement", 20]], { category: "weapon" }), type: "Long Swords" };
  const kept = M.eligible([twoH, oneH], { mlCap: 34, style: "sword-board" }).map((x) => x.source_item);
  assert.deepStrictEqual(kept, ["Longsword"], "S&B main hand is one-handed only");
});

// ---- U1 (issue #107) — a shield in the off hand forbids a 2H main-hand weapon ----
function mhNames(model) {
  const mh = model.worn.find((s) => s.slot === "Main Hand");
  return mh ? mh.variants.map((x) => x.source_item).sort() : [];
}
const twoHW = { ...v("Quarterstaff", "Main Hand", [["Strength", "Enhancement", 20]], { category: "weapon" }), type: "Quarterstaffs" };
const oneHW = { ...v("Longsword", "Main Hand", [["Strength", "Enhancement", 10]], { category: "weapon" }), type: "Long Swords" };
const towerShield = { ...v("Tower Shield", "Off Hand", [["Constitution", "Enhancement", 20]]), type: "Tower shields" };

test("U1/#107: an off-hand shield PICK excludes a two-handed Main Hand weapon", () => {
  // No style set, so the main hand would normally allow a 2H weapon; picking a shield
  // off-hand type must now forbid it (a shield occupies a hand). Regression: the solver
  // used to recommend a quarterstaff alongside a shield.
  const model = M.buildModel([twoHW, oneHW, towerShield],
    { mlCap: 34, targets: ["Strength", "Constitution"], offHand: ["Tower shields"] });
  assert.deepStrictEqual(mhNames(model), ["Longsword"],
    "shield off-hand => 2H quarterstaff excluded, 1H longsword kept");
});

test("U1/#107: a PINNED off-hand shield excludes a two-handed Main Hand weapon", () => {
  const model = M.buildModel([twoHW, oneHW, towerShield],
    { mlCap: 34, targets: ["Strength", "Constitution"],
      slotConstraints: { "Off Hand": { type: "pin", variant_id: "Tower Shield" } } });
  assert.deepStrictEqual(mhNames(model), ["Longsword"],
    "pinned shield => 2H quarterstaff excluded, 1H longsword kept");
});

test("U1/#107 regression: NO shield in off hand keeps 2H weapons available", () => {
  // Pinning an ORB (not a shield) must not trigger the 2H exclusion; nor should a bare
  // query with no off-hand constraint. A 2H main weapon stays available (hand mutex,
  // enforced by the solver, lets it coexist with an empty off hand).
  const orb = { ...v("Arcane Orb", "Off Hand", [["Intelligence", "Enhancement", 20]]), type: "Orbs" };
  const bare = M.buildModel([twoHW, oneHW],
    { mlCap: 34, targets: ["Strength"] });
  assert.ok(mhNames(bare).includes("Quarterstaff"), "no off-hand constraint => 2H still available");
  const withOrb = M.buildModel([twoHW, oneHW, orb],
    { mlCap: 34, targets: ["Strength"], slotConstraints: { "Off Hand": { type: "pin", variant_id: "Arcane Orb" } } });
  assert.ok(mhNames(withOrb).includes("Quarterstaff"), "a pinned ORB (not a shield) does not exclude 2H");
});

test("U1/#107: crossbows stay available with a shield off-hand (not both-hands)", () => {
  // A crossbow is not a both-hands weapon (a rune arm pairs with it), so isBothHandsWeapon
  // is false and the shield-off-hand filter must NOT drop it. (An off-hand shield + crossbow
  // is an unusual pairing, but the exclusion targets ONLY two-handed weapons.)
  const xbow = { ...v("Heavy Crossbow", "Main Hand", [["Dexterity", "Enhancement", 15]], { category: "weapon" }), type: "Heavy Crossbows" };
  const model = M.buildModel([twoHW, oneHW, xbow, towerShield],
    { mlCap: 34, targets: ["Strength", "Dexterity", "Constitution"], offHand: ["Tower shields"] });
  const kept = mhNames(model);
  assert.ok(kept.includes("Heavy Crossbow"), "crossbow survives the shield-off-hand 2H filter");
  assert.ok(!kept.includes("Quarterstaff"), "the 2H quarterstaff is still excluded");
});

test("U1 characterization: #90 does not reproduce — Heavy query excludes cloth end-to-end", () => {
  // Build-shaped items carry native `type`; normalizeDataset derives armor_type,
  // proving the runtime chain (type -> armor_type -> gate) excludes mismatched armor.
  const ds = normalizeDataset({
    items: [
      { ...armorV("Aberrant Robe", "unknown"), type: "Cloth armor" },
      { ...armorV("Argenti's Armor", "unknown"), type: "Heavy armor" },
    ],
    metadata: {},
  });
  assert.strictEqual(ds.items[0].armor_type, "cloth");
  const kept = M.eligible(ds.items, { mlCap: 34, armorTypes: ["heavy"] }).map((x) => x.source_item);
  assert.deepStrictEqual(kept, ["Argenti's Armor"]);
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
  // native `type` is authoritative — a docent whose name lacks "docent" is still one
  assert.ok(M.isDocent({ source_item: "Legendary Scale-Stone of Avarice", type: "Docents" }));
  assert.ok(!M.isDocent({ source_item: "Robe", type: "Cloth armor" }));
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

test("U2/B5: a THF style builds no Off Hand slot and excludes 1H weapons", () => {
  const model = M.buildModel([oh("Orb", "Orbs"), wt("Falchion", "Falchions"), wt("Sword", "Long Swords")],
    { mlCap: 34, targets: ["Strength", "Constitution"], style: "thf" });
  assert.ok(!model.worn.find((s) => s.slot === "Off Hand"), "THF => no Off Hand slot");
  const mh = model.worn.find((s) => s.slot === "Main Hand");
  assert.deepStrictEqual(mh.variants.map((x) => x.type), ["Falchions"], "one-hand weapon excluded under THF");
});

test("Ranged (Bow) style: bows only, no Off Hand slot; crossbow excluded", () => {
  const model = M.buildModel([
    oh("Orb", "Orbs"),
    wt("Bow", "Long Bows", [["Strength", "Enhancement", 8]]),
    wt("Short", "Short Bows", [["Dexterity", "Enhancement", 8]]),
    wt("Xbow", "Light Crossbows", [["Wisdom", "Enhancement", 8]])],
    { mlCap: 34, targets: ["Strength", "Dexterity", "Wisdom"], style: "ranged" });
  assert.ok(!model.worn.find((s) => s.slot === "Off Hand"), "a bow takes both hands => no off-hand");
  const mh = model.worn.find((s) => s.slot === "Main Hand");
  assert.deepStrictEqual(mh.variants.map((x) => x.type).sort(), ["Long Bows", "Short Bows"],
    "bows only; the crossbow belongs to the Crossbow style, not Bow");
});

test("Crossbow style: off-hand restricted to a rune arm (no shields/orbs/weapon)", () => {
  const model = M.buildModel([
    wt("Xbow", "Light Crossbows", [["Strength", "Enhancement", 8]]),
    oh("Rune", "Rune Arms", [["Strength", "Enhancement", 6]]),
    oh("Orb", "Orbs", [["Wisdom", "Enhancement", 6]]),
    oh("Tower", "Tower shields", [["Constitution", "Enhancement", 6]])],
    { mlCap: 34, targets: ["Strength", "Wisdom", "Constitution"], style: "crossbow" });
  const off = model.worn.find((s) => s.slot === "Off Hand");
  assert.ok(off, "crossbow style builds an Off Hand slot for the rune arm");
  assert.deepStrictEqual([...new Set(off.variants.map((v) => v.type))], ["Rune Arms"], "rune arm only — orb/shield excluded");
  const mh = model.worn.find((s) => s.slot === "Main Hand");
  assert.ok(mh.variants.some((v) => v.type === "Light Crossbows"), "the crossbow is the main-hand weapon");
});

test("TWF: a one-handed off-hand weapon competes in the Off Hand slot", () => {
  const model = M.buildModel(
    [wt("Rapier", "Rapiers", [["Strength", "Enhancement", 8]]),
     wt("Shortsword", "Short Swords", [["Constitution", "Enhancement", 8]]),
     oh("Orb", "Orbs", [["Wisdom", "Enhancement", 6]])],
    { mlCap: 34, targets: ["Strength", "Constitution"], style: "one-hand",
      weaponTypes: ["Rapiers"], offHandWeapons: ["Short Swords"] });
  const off = model.worn.find((s) => s.slot === "Off Hand");
  assert.ok(off, "an Off Hand slot exists");
  assert.ok(off.variants.some((x) => x.type === "Short Swords"), "the off-hand weapon competes off-hand");
  const mh = model.worn.find((s) => s.slot === "Main Hand");
  assert.deepStrictEqual(mh.variants.map((x) => x.type), ["Rapiers"], "main hand still locked to Rapiers");
  assert.ok(!mh.variants.some((x) => x.type === "Short Swords"), "the off-hand-only type isn't a main-hand candidate");
});

test("TWF: off-hand weapons are excluded when offHandWeapons is empty (opt-in)", () => {
  const model = M.buildModel(
    [wt("Rapier", "Rapiers"), wt("Shortsword", "Short Swords"), oh("Orb", "Orbs")],
    { mlCap: 34, targets: ["Strength"], style: "one-hand", offHandWeapons: [] });
  const off = model.worn.find((s) => s.slot === "Off Hand");
  assert.ok(off && !off.variants.some((x) => x.category === "weapon"), "no weapon in the off hand without an opt-in");
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

test("U2/B4: an off-hand allow-set keeps every allowed type (permissive, not pin)", () => {
  const items = [oh("Orb", "Orbs"), oh("Tower", "Tower shields"), oh("Buckler", "Bucklers")];
  const kept = M.eligible(items, { mlCap: 34, targets: ["Constitution"], offHand: ["Orbs", "Tower shields"] });
  assert.deepStrictEqual(kept.map((x) => x.type).sort(), ["Orbs", "Tower shields"], "both allowed types kept, buckler dropped");
});

test("U2: an untyped weapon host survives a style/weapon-type lock (Dino Bone Weapon)", () => {
  // A weapon with no `type` (its in-game type is player-chosen) can't be matched
  // against a lock, so it must stay eligible under any style / weaponTypes pick.
  const dino = wt("Dino Bone Weapon", null);
  const sword = wt("Sword", "Long Swords");
  const kept = M.eligible([dino, sword], { mlCap: 34, targets: ["Strength"], style: "thf", weaponTypes: ["Falchions"] });
  assert.ok(kept.some((x) => x.source_item === "Dino Bone Weapon"), "untyped weapon host not filtered by a lock");
  assert.ok(!kept.some((x) => x.source_item === "Sword"), "a typed weapon outside the lock is still filtered");
});

test("U2: the isDocent-by-type fix excludes a name-less docent from a non-Forged Armor slot", () => {
  const doc = v("Scale-Stone of Avarice", "Armor", [["Constitution", "Enhancement", 10]]); doc.type = "Docents";
  const elf = M.eligible([doc], { mlCap: 34, targets: ["Constitution"], race: "elf" });
  assert.strictEqual(elf.length, 0, "a type-Docents item is excluded for a non-Forged race");
  const forged = M.eligible([doc], { mlCap: 34, targets: ["Constitution"], race: "warforged" });
  assert.strictEqual(forged.length, 1, "and kept for a Forged race");
});

test("U2: the real dataset has no orphaned Rune Arm slot after normalization", () => {
  assert.strictEqual(data.items.filter((v) => v.slot === "Rune Arm").length, 0, "no item left in the retired Rune Arm slot");
  const dino = data.items.find((v) => /Dinosaur Bone Rune Arm/.test(v.variant_id || v.source_item || v.name || ""));
  assert.ok(dino, "the legacy rune-arm host exists");
  assert.strictEqual(dino.slot, "Off Hand", "it is normalized into the Off Hand slot (still equippable)");
});

// --- U1 pinConflict / variantConflict (pre-solve pin B4 flag) -------------
// One gate list shared with eligible(): pinConflict returns null (equippable) or
// a short reason. These assert each gate produces a reason AND that eligible()
// stays a pure filter over the same predicate (no drift).

test("U1/B4: pinConflict flags ML above the cap", () => {
  const hi = v("Hi", "Ring", [["Intelligence", "Enhancement", 9]], { ml: 34 });
  const why = M.pinConflict(hi, { mlCap: 20 });
  assert.ok(why && /cap/.test(why), `expected an ML-cap reason, got: ${why}`);
});

test("U1/B4: pinConflict flags ML below the floor", () => {
  const lo = v("Lo", "Ring", [["Intelligence", "Enhancement", 5]], { ml: 10 });
  const why = M.pinConflict(lo, { mlCap: 36, mlFloor: 30 });
  assert.ok(why && /floor/.test(why), `expected an ML-floor reason, got: ${why}`);
});

test("U1/B4: pinConflict flags the race→docent mismatch both ways", () => {
  const doc = v("Doc", "Armor", [["Constitution", "Enhancement", 10]]); doc.type = "Docents";
  const body = v("Robe", "Armor", [["Wisdom", "Enhancement", 5]]);
  // non-Forged wearing a docent, and a Forged wearing body armor: each has a reason.
  assert.ok(/docent|Forged/i.test(M.pinConflict(doc, { mlCap: 34, race: "elf" }) || ""));
  assert.ok(/docent|Forged/i.test(M.pinConflict(body, { mlCap: 34, race: "warforged" }) || ""));
  // and the matching pairing is equippable
  assert.strictEqual(M.pinConflict(doc, { mlCap: 34, race: "warforged" }), null);
});

test("U1/B4: pinConflict flags an armor type outside proficiency", () => {
  const heavy = v("Plate", "Armor", [["Constitution", "Enhancement", 10]]); heavy.armor_type = "heavy";
  const why = M.pinConflict(heavy, { mlCap: 34, armorTypes: ["cloth"] });
  assert.ok(why && /armor/i.test(why), `expected an armor-proficiency reason, got: ${why}`);
});

test("U1/B4: pinConflict flags weapon-style and off-hand blocks", () => {
  const sword = wt("Sword", "Long Swords");
  const styled = M.pinConflict(sword, { mlCap: 34, weaponTypes: ["Rapiers"] });
  assert.ok(styled && /style/.test(styled), `expected a style reason, got: ${styled}`);
  const orb = oh("Orb", "Orbs");
  const blocked = M.pinConflict(orb, { mlCap: 34, style: "thf" });
  assert.ok(blocked && /off.?hand/i.test(blocked), `expected an off-hand reason, got: ${blocked}`);
});

test("U1/B4: pinConflict flags an alignment mismatch (drift guard vs eligible)", () => {
  // eligible() enforces the alignment gate; a hand-mirrored pinConflict would have
  // silently omitted it. This asserts the extracted core carries it.
  const item = { ...v("Litany", "Trinket", [["Melee Power", "Profane", 20]]), alignment_req: ["Lawful Good"] };
  const why = M.pinConflict(item, { mlCap: 34, alignment: "Chaotic Neutral" });
  assert.ok(why && /alignment/i.test(why), `expected an alignment reason, got: ${why}`);
});

test("U1/B4: pinConflict flags an artifact without the opt-in", () => {
  const arti = art("Arti", "Ring", [["Intelligence", "Enhancement", 9]]);
  assert.ok(/Artifact/i.test(M.pinConflict(arti, { mlCap: 34 }) || ""));
  assert.strictEqual(M.pinConflict(arti, { mlCap: 34, includeArtifact: true }), null);
});

test("U1/B4: pinConflict returns null for an equippable item", () => {
  const ring = v("Ring", "Ring", [["Intelligence", "Enhancement", 5]], { ml: 20 });
  assert.strictEqual(M.pinConflict(ring, { mlCap: 34 }), null);
});

test("U1 parity: eligible() equals filtering by variantConflict === null", () => {
  const pool = [
    v("okRing", "Ring", [["Intelligence", "Enhancement", 5]], { ml: 20 }),
    v("hiRing", "Ring", [["Intelligence", "Enhancement", 9]], { ml: 34 }),
    art("arti", "Ring", [["Intelligence", "Enhancement", 9]], { ml: 20 }),
    wt("Sword", "Long Swords"),
    oh("Orb", "Orbs"),
  ];
  const q = { mlCap: 30, weaponTypes: ["Rapiers"], style: "one-hand" };
  const kept = M.eligible(pool, q).map((x) => x.source_item).sort();
  const byCore = pool.filter((x) => M.variantConflict(x, q) === null).map((x) => x.source_item).sort();
  assert.deepStrictEqual(kept, byCore, "eligible() and the shared core must agree exactly");
});

console.log(`\n${passed} passed`);
