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

test("#339: the augCeiling excludes an above-ceiling AUGMENT, keeps one at/below, and leaves a same-ML worn item untouched", () => {
  const hiAug = v("Diamond of Intelligence +15", "Colorless", [["Intelligence", "Enhancement", 15]], { ml: 36, category: "augment" });
  const okAug = v("Diamond of Intelligence +14", "Colorless", [["Intelligence", "Enhancement", 14]], { ml: 32, category: "augment" });
  const worn = v("Endgame Ring", "Ring", [["Intelligence", "Enhancement", 10]], { ml: 36, category: "item" });
  const kept = M.eligible([hiAug, okAug, worn], { mlCap: 36, augCeiling: 32, targets: ["Intelligence"] }).map((x) => x.source_item);
  assert.ok(!kept.includes("Diamond of Intelligence +15"), "an above-ceiling augment is excluded");
  assert.ok(kept.includes("Diamond of Intelligence +14"), "an at-ceiling augment is kept");
  assert.ok(kept.includes("Endgame Ring"), "a WORN item at the same ML is untouched — the ceiling is augment-only");
});

test("#339: no ceiling (absent or null) -> eligibility identical to pre-feature", () => {
  const hiAug = v("Diamond of Intelligence +15", "Colorless", [["Intelligence", "Enhancement", 15]], { ml: 36, category: "augment" });
  const worn = v("Endgame Ring", "Ring", [["Intelligence", "Enhancement", 10]], { ml: 36, category: "item" });
  const absent = M.eligible([hiAug, worn], { mlCap: 36, targets: ["Intelligence"] }).map((x) => x.source_item).sort();
  assert.deepStrictEqual(absent, ["Diamond of Intelligence +15", "Endgame Ring"], "absent ceiling restricts nothing");
  const nul = M.eligible([hiAug, worn], { mlCap: 36, augCeiling: null, targets: ["Intelligence"] }).map((x) => x.source_item).sort();
  assert.deepStrictEqual(nul, absent, "null ceiling is byte-identical to absent");
});

test("#339 contract (KD5): a PINNED above-ceiling augment passes the gate — the future pin exemption", () => {
  // Inert today (augments cannot be pinned); this pins the rule so the exemption
  // is live the day augment pinning ships, mirroring the floor's pinnedIds clause.
  const aug = v("Diamond of Intelligence +15", "Colorless", [["Intelligence", "Enhancement", 15]], { ml: 36, category: "augment" });
  const query = { mlCap: 40, augCeiling: 32, targets: ["Intelligence"] };
  const gates = { cap: 40, floor: null, ceiling: 32, pinnedIds: new Set([M.variantKey(aug)]) };
  assert.strictEqual(M.variantConflict(aug, query, gates), null, "the pin overrides the ceiling");
  // sanity: without the pin the same gate fires, with the floor-mirrored wording.
  const unpinned = { cap: 40, floor: null, ceiling: 32, pinnedIds: new Set() };
  assert.strictEqual(M.variantConflict(aug, query, unpinned), "above your augment ML 32 ceiling");
});

test("#339: a ceiling below every augment's ML empties the augment pool but leaves worn slots solvable", () => {
  // buildModel-level: with the ceiling under every augment, the model's augment
  // pool is empty while the worn pool still carries the ring — augment slots go
  // unfilled, the solve stays feasible.
  const aug = v("Diamond of Intelligence +14", "Colorless", [["Intelligence", "Enhancement", 14]], { ml: 32, category: "augment" });
  aug.aug_color = { color: "Colorless" };   // a real pool color, or the pool drops it regardless of the ceiling
  const ring = v("Endgame Ring", "Ring", [["Intelligence", "Enhancement", 10]], { ml: 36, aug: ["Colorless"] });
  // sanity (anti-vacuity): WITHOUT the ceiling the augment is in the pool.
  const open = M.buildModel([aug, ring], { mlCap: 36, targets: ["Intelligence"] });
  assert.strictEqual(open.augments.length, 1, "the augment must be poolable at all, or this test proves nothing");
  const model = M.buildModel([aug, ring], { mlCap: 36, augCeiling: 20, targets: ["Intelligence"] });
  assert.strictEqual(model.augments.length, 0, "no augment survives a ceiling below all of them");
  const ringSlot = model.worn.find((s) => s.slot === "Ring");
  assert.ok(ringSlot && ringSlot.variants.some((x) => x.source_item === "Endgame Ring"),
    "the worn host is still in its slot pool — the solve stays feasible without augments");
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

// U6 — a synthetic Set Augment insert (mirrors the built items.json shape).
function setAug(setName) {
  const x = v(`Set Augment: ${setName}`, "Colorless", [], { category: "augment", ml: 30 });
  x.set_augment = true;
  x.set = setName;
  x.pieces_required = 3;
  x.aug_color = { color: "Colorless" };
  return x;
}

test("U6: set augments are ineligible by default (empty ownedSetAugments)", () => {
  const a = setAug("Alluring Elocution");
  const b = setAug("Arcane Barrier");
  const off = M.eligible([a, b], { mlCap: 34, targets: ["Charisma"] });
  assert.deepStrictEqual(off.map((x) => x.source_item), [], "no set augment is considered by default");
  // an explicit empty Set is also all-excluded
  const emptySet = M.eligible([a, b], { mlCap: 34, targets: ["Charisma"], ownedSetAugments: new Set() });
  assert.deepStrictEqual(emptySet.map((x) => x.source_item), []);
});

test("U6 (P1 regression): buildModel gates augment_set_defs on the VALUE path by ownership", () => {
  // The solver's set-augment y-family reads model.augment_set_defs directly, not the
  // worn/augment pool — so ownership must gate the defs dict, not just eligible().
  const defs = { "Alluring Elocution": { tiers: [], tier: "augment" }, "Arcane Barrier": { tiers: [], tier: "augment" } };
  const call = (q) => M.buildModel([], q, [], [], [], [], {}, [], [], defs).augment_set_defs;
  assert.deepStrictEqual(Object.keys(call({ mlCap: 34, targets: ["Charisma"], ownedSetAugments: new Set() })), [], "empty ownership => no defs reach the solver");
  assert.deepStrictEqual(Object.keys(call({ mlCap: 34, targets: ["Charisma"] })), [], "undefined ownership => no defs");
  assert.deepStrictEqual(Object.keys(call({ mlCap: 34, targets: ["Charisma"], ownedSetAugments: new Set(["Arcane Barrier"]) })), ["Arcane Barrier"], "only the owned set's def reaches the value path");
});

test("U6: marking a set makes only that set's augment eligible", () => {
  const a = setAug("Alluring Elocution");
  const b = setAug("Arcane Barrier");
  const owned = new Set(["Alluring Elocution"]);
  const kept = M.eligible([a, b], { mlCap: 34, targets: ["Charisma"], ownedSetAugments: owned });
  assert.deepStrictEqual(kept.map((x) => x.set), ["Alluring Elocution"], "only the owned set augment survives");
});

test("U6: variantConflict reason mirrors the Artifact opt-in gate", () => {
  const a = setAug("Arcane Barrier");
  assert.ok(M.variantConflict(a, { mlCap: 34 }) != null, "excluded when unowned");
  assert.strictEqual(
    M.variantConflict(a, { mlCap: 34, ownedSetAugments: new Set(["Arcane Barrier"]) }), null,
    "eligible once owned");
});

test("U6: ownedSetAugments tolerates an array (not just a Set)", () => {
  const a = setAug("Arcane Barrier");
  assert.strictEqual(
    M.variantConflict(a, { mlCap: 34, ownedSetAugments: ["Arcane Barrier"] }), null);
});

test("U6: buildModel forwards owned augment_set_defs onto the model", () => {
  const defs = { "Alluring Elocution": { tiers: [{ pieces_required: 3, affixes: [] }] } };
  const model = M.buildModel(
    [v("Ring", "Ring", [["Intelligence", "Enhancement", 5]])],
    { mlCap: 34, targets: ["Intelligence"], ownedSetAugments: new Set(["Alluring Elocution"]) },
    [], [], [], [], {}, [], [], defs);
  assert.deepStrictEqual(model.augment_set_defs, defs, "an owned set's def must reach the model value path");
});

test("U6: buildModel augment_set_defs defaults to {} when omitted", () => {
  const model = M.buildModel(
    [v("Ring", "Ring", [["Intelligence", "Enhancement", 5]])],
    { mlCap: 34, targets: ["Intelligence"] });
  assert.deepStrictEqual(model.augment_set_defs, {});
});

test("U6: real dataset's set augments are all excluded by default, one owned survives", () => {
  const names = Object.keys(data.augment_set_defs || {});
  assert.ok(names.length >= 21, "expected the 21 augment_set_defs on the real dataset");
  const q = { mlCap: 36, targets: ["Charisma", "Magical Sheltering"] };
  const augPool = data.items.filter((x) => x.set_augment);
  assert.ok(augPool.length >= 21, "expected 21 set_augment variants in the dataset");
  const off = M.eligible(augPool, q);
  assert.strictEqual(off.length, 0, "default: none considered");
  const one = names[0];
  const on = M.eligible(augPool, { ...q, ownedSetAugments: new Set([one]) });
  assert.deepStrictEqual(on.map((x) => x.set), [one], "only the owned set augment is eligible");
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

// ---- #246 — the content-ownership filter ----

// Each in its OWN slot: six identical Rings would be pruned by dominanceFilter and
// the test would be measuring that instead of the ownership filter.
const packV = (id, pack, kind, slot) => ({
  source_item: id, variant_id: id, slot: slot || "Ring", category: "item",
  minimum_level: 30, ml: 30, verification: "verified",
  affixes: [{ stat: "Constitution", bonus_type: "Enhancement", name: "Constitution",
              type: "Enhancement", value: 10, unit: "flat" }],
  scaling: [], set_bonus: [], augment_slots: [], restrictions: "unknown", armor_type: null,
  location_pack: pack, location_kind: kind,
});
const PACK_POOL = [
  packV("owned", "Ruins of Gianthold", "pack-quest", "Ring"),
  packV("unowned", "Mists of Ravenloft", "pack-quest", "Goggles"),
  packV("free", "Free to Play", "pack-quest", "Helmet"),
  packV("crafted", null, "crafting", "Boots"),
  packV("vendor", null, "vendor", "Belt"),
  packV("nopack", null, "unknown", "Cloak"),
];
const packQ = (owned) => ({ mlCap: 34, targets: ["Constitution"], targetCaps: {}, targetFloors: {},
  ownedPacks: owned });
const idsIn = (m) => new Set(m.worn.flatMap((sl) => (sl.variants || []).map((v) => v.variant_id)));

test("#246: an ABSENT ownedPacks filters nothing", () => {
  // The same contract an absent blocklist has, and for the same reason: most callers
  // never set the key, and a truthiness slip here would empty their pools.
  const m = M.buildModel(PACK_POOL, packQ(undefined));
  assert.strictEqual(m.packExcluded.length, 0);
  assert.strictEqual(m.ownedPacks, null);
  assert.strictEqual(idsIn(m).size, PACK_POOL.length);
});

test("#246: only gear behind a NAMED, unticked pack is excluded", () => {
  const m = M.buildModel(PACK_POOL, packQ(["Ruins of Gianthold"]));
  const ids = idsIn(m);
  assert.ok(ids.has("owned"), "a ticked pack stays");
  assert.ok(!ids.has("unowned"), "an unticked pack goes");
  // Everything below is NOT pack-gated, so excluding it would be wrong rather than
  // merely cautious — 1,711 real variants are crafted, bought, event or Store gear.
  assert.ok(ids.has("free"), "Free to Play is not something you can fail to own");
  assert.ok(ids.has("crafted"), "crafted gear is not gated by an expansion");
  assert.ok(ids.has("vendor"), "nor is vendor gear");
  assert.ok(ids.has("nopack"), "and an unsourced pack is KEPT, never dropped on a guess");
  assert.deepStrictEqual(m.packExcluded.map((v) => v.variant_id), ["unowned"]);
});

test("#246: what could not be checked is COUNTED, not silently passed over", () => {
  // A filter that reports what it removed and stays quiet about what it could not
  // check reads as a complete answer when it is a partial one.
  const m = M.buildModel(PACK_POOL, packQ(["Ruins of Gianthold"]));
  assert.strictEqual(m.packUncheckable, 4, "free + crafted + vendor + nopack");
});

test("#246: an EMPTY ownedPacks is a real answer, not the absent one", () => {
  // [] means "I own nothing"; null means "I have not said". Conflating them would
  // make the first touch of a checkbox empty the roster.
  const m = M.buildModel(PACK_POOL, packQ([]));
  assert.deepStrictEqual(m.packExcluded.map((v) => v.variant_id).sort(), ["owned", "unowned"]);
  assert.ok(idsIn(m).has("free"), "and it still cannot exclude un-gated gear");
});

test("#246: the filter runs AFTER the blocklist, so a block keeps its attribution", () => {
  // A variant the player both blocked and does not own is attributed to the block —
  // the reason they actually chose.
  const m = M.buildModel(PACK_POOL, Object.assign(packQ(["Ruins of Gianthold"]),
    { blocklist: ["unowned"] }));
  assert.deepStrictEqual(m.blocked.map((v) => v.variant_id), ["unowned"]);
  assert.deepStrictEqual(m.packExcluded.map((v) => v.variant_id), []);
});

test("#573: no armor-category dodge clamp is minted, and the constant is gone", () => {
  // The inverse of the test this replaces, which pinned `cap.dodgeCap === ARMOR_DODGE_CAP.heavy`.
  //
  // Both halves matter and they fail for different reasons. The constant being unexported
  // stops a caller reaching for the four numbers again; the model carrying no `dodgeCap`
  // stops the clamp being re-plumbed under the old name. A future re-introduction has to
  // defeat both, and either way it has to argue with `intrinsic-stat-caps.md` §4, which
  // REFUSED a Dodge cap on wiki evidence.
  assert.strictEqual(M.ARMOR_DODGE_CAP, undefined, "the unsourced constant is not exported");
  const m = M.buildModel(data.items, { mlCap: 34, targets: ["Dodge"], armorType: "heavy" });
  assert.strictEqual(m.dodgeCap, undefined, "heaviest armor + ranked Dodge mints no clamp");
  assert.ok(!("Dodge" in (m.intrinsicCaps || {})),
    "and Dodge did not reappear via the #199 intrinsic table, which refused it");
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

test("dominates (#282): a sword must not dominate an equal-slotted quarterstaff host", () => {
  // A quarterstaff's Weapon slot draws the `(quarterstaff)` pool variant — richer
  // options its slot key must expose, or an intrinsically-better non-quarterstaff
  // rival with the SAME typed slot would prune it and the implement bonuses would
  // be silently unreachable.
  const mk = (id, weaponType, str) => {
    const w = v(id, "Main Hand", [["Strength", "Enhancement", str]]);
    w.type = weaponType;
    w.lamordia_slots = [{ type: "Dolorous", category: "Weapon" }];
    w.minimum_level = w.ml = 34;
    return w;
  };
  const sword = mk("Sword", "Bastard Swords", 12);
  const qstaff = mk("Qstaff", "Quarterstaffs", 8);
  const targets = new Set(["Strength"]);
  assert.strictEqual(M.dominates(sword, qstaff, targets, 36), false,
    "equal typed slots but different Weapon-pool variants — no dominance");
  assert.strictEqual(M.lamordiaWeaponVariant(qstaff), "quarterstaff");
  assert.strictEqual(M.lamordiaWeaponVariant(sword), "base");
  // Non-Weapon slots are untouched by the variant: two equal Accessory hosts of
  // different weapon-ness still compare (the marker rides Weapon keys only).
  const a = v("A", "Neck", [["Strength", "Enhancement", 12]]);
  const b = v("B", "Neck", [["Strength", "Enhancement", 8]]);
  for (const x of [a, b]) {
    x.lamordia_slots = [{ type: "Melancholic", category: "Accessory" }];
    x.minimum_level = x.ml = 34;
  }
  a.type = "Bastard Swords"; b.type = "Quarterstaffs";
  assert.strictEqual(M.dominates(a, b, targets, 36), true,
    "an Accessory-slotted pair still compares on its buckets");
});

// ---------------------------------------------------------------------------
// U2 — a Viktranium option became ATOMIC (one record carrying a whole affix list
// instead of one record per affix). That is a new value-carrying shape in a source
// family, which is the exact trigger for the new-source-family checklist in
// docs/solutions/design-patterns/milp-encoding-for-gear-optimization.md — a failure
// class that has recurred THREE times here (set-piece thresholds, Dino slots,
// Nearly-Complete) and is invisible to any test that starts from an already-built
// model. The three tests below run the checklist rather than assuming the answer.
// ---------------------------------------------------------------------------

// Fixtures shared by the three: a strictly-better plain rival, and a host whose only
// edge is a Lamordia slot that can craft a 7-affix option.
function vikMultiOption(slot_type, category, stats, tier) {
  return {
    slot_type, category, tier: tier || "legendary", name: `${slot_type} universal option`,
    affixes: stats.map((s) => ({ stat: s, bonus_type: "Profane", value: 2, unit: "flat" })),
  };
}
const VIK_SCHOOLS = ["Abjuration Focus", "Conjuration Focus", "Enchantment Focus",
  "Evocation Focus", "Illusion Focus", "Necromancy Focus", "Transmutation Focus"];

test("dominates: an affix rival does NOT dominate a Viktranium host carrying a MULTI-AFFIX option", () => {
  // Checklist step 3. The host's craftable value is a seven-school option worth far
  // more to this query than the rival's whole affix block — and it lives entirely
  // outside variantBuckets. If dominance ever stopped reading lamordia_slots, the
  // rival would prune the host here and the atomic option would have no host to sit
  // on: the solve would report the rival's numbers as "provably optimal".
  const targets = new Set(["Necromancy Focus", "Enchantment Focus"]);
  const real = v("Rival", "Necklace", [
    ["Necromancy Focus", "Profane", 12], ["Enchantment Focus", "Profane", 12],
  ], { ml: 34 });
  const host = v("Host", "Necklace", [
    ["Necromancy Focus", "Profane", 1], ["Enchantment Focus", "Profane", 1],
  ], { ml: 34 });
  host.lamordia_slots = [{ type: "Woeful", category: "Accessory" }];

  assert.strictEqual(M.dominates(real, host, targets, 36), false,
    "a rival with no Lamordia slot cannot dominate a host that can craft the option");
  assert.strictEqual(M.dominanceFilter([real, host], targets, 36, 1).length, 2,
    "the multi-affix host survives per-slot dominance");

  // Step 4: confirm END TO END, through buildModel — the prune happens there, and a
  // pruning defect is invisible upstream of it.
  const pool = [vikMultiOption("Woeful", "Accessory", VIK_SCHOOLS)];
  const model = M.buildModel([real, host], { mlCap: 36, targets: [...targets] },
    [], [], pool);
  const neck = model.worn.find((w) => w.slot === "Necklace");
  assert.ok(neck, "the Necklace slot survives into the model");
  assert.deepStrictEqual(neck.variants.map((x) => x.variant_id).sort(), ["Host", "Rival"],
    "buildModel keeps the host that owns the multi-affix craft");
});

test("dominance is BLIND to Viktranium OPTION stats — the option pool cannot change a verdict", () => {
  // Prior analysis says the Viktranium dominance key is a `type||category||tier`
  // slot multiset that never reads what an option grants, so making an option atomic
  // leaves the comparator alone. VERIFY it rather than trust it.
  //
  // Structural evidence: `dominates(A, B, targetSet, mlCap)` is never handed the
  // option pool at all, and buildModel calls dominanceFilter with only
  // (candidates, targetSet, mlCap, cardinality, pinnedIds, includeArtifact). So the
  // verdict is a pure function of the two variants. Pinned behaviourally by solving
  // the same pair against three different pools — none, single-affix (the legacy
  // flat shape), and the atomic multi-affix option — and requiring one kept set.
  const targets = new Set(["Necromancy Focus", "Enchantment Focus"]);
  const real = v("Rival", "Necklace", [["Necromancy Focus", "Profane", 12]], { ml: 34 });
  const host = v("Host", "Necklace", [["Necromancy Focus", "Profane", 1]], { ml: 34 });
  host.lamordia_slots = [{ type: "Woeful", category: "Accessory" }];

  const pools = {
    none: [],
    flat: [{ slot_type: "Woeful", category: "Accessory", tier: "legendary",
             stat: "Necromancy Focus", bonus_type: "Profane", value: 2, unit: "flat" }],
    atomic: [vikMultiOption("Woeful", "Accessory", VIK_SCHOOLS)],
  };
  const keptFor = (pool) => M.buildModel([real, host], { mlCap: 36, targets: [...targets] },
    [], [], pool).worn.find((w) => w.slot === "Necklace").variants.map((x) => x.variant_id).sort();
  const base = keptFor(pools.none);
  assert.deepStrictEqual(base, ["Host", "Rival"], "both kept with no pool at all");
  assert.deepStrictEqual(keptFor(pools.flat), base, "legacy flat option pool changes nothing");
  assert.deepStrictEqual(keptFor(pools.atomic), base, "atomic multi-affix pool changes nothing");

  // And the comparator's own verdict is identical either way: it takes no pool.
  assert.strictEqual(M.dominates(real, host, targets, 36), false);
  assert.strictEqual(M.dominates(host, real, targets, 36), false);
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

test("dominates: an affix item does NOT dominate an absorption-quarantined carrier it can't match", () => {
  // #255 — a quarantined affix lives in absorption_quarantined, outside
  // variantBuckets, and the quarantine is exactly what can make its carrier look
  // weaker than a slot rival. Pruning the carrier would silence
  // buildAbsorptionQuarantineReport (which reads the pruned pool) for the one item
  // the disclosure exists to explain.
  const real = v("Real", "Cloak", [["Constitution", "Enhancement", 12]]);
  const carrier = v("Carrier", "Cloak", [["Constitution", "Enhancement", 8]]);
  carrier.absorption_quarantined = [{ stat: "Elemental Absorption",
    reason: "wiki states no per-element values", components: ["Fire Absorption", "Cold Absorption"] }];
  const targets = new Set(["Constitution"]);
  assert.strictEqual(M.dominates(real, carrier, targets, 34), false,
    "a rival lacking the quarantine disclosure cannot dominate the carrier");
  assert.strictEqual(M.dominanceFilter([real, carrier], targets, 34, 1).length, 2,
    "the quarantined carrier survives per-slot dominance");
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

// A Viktranium option is an ATOMIC native option carrying an `affixes` list
// (mirroring the Dino insert UNIT), not one record per affix.
function vikOpt(slot_type, category, affixes, tier) {
  return {
    slot_type, category, tier: tier || "legendary", name: `${slot_type} option`,
    affixes: affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, value, unit: "flat" })),
  };
}

test("buildModel exposes a target-filtered Viktranium pool", () => {
  const model = M.buildModel([], { mlCap: 36, targets: ["Constitution"] }, [], [], [
    vikOpt("Melancholic", "Accessory", [["Constitution", "Enhancement", 15]]),
    vikOpt("Dolorous", "Weapon", [["Attack", "Competence", 23]]), // not a target
  ]);
  assert.strictEqual(model.viktranium.length, 1, "only target-relevant options kept");
  assert.strictEqual(model.viktranium[0].affixes[0].stat, "Constitution");
});

test("Viktranium prefilter keeps an option whose match is on a NON-FIRST affix", () => {
  // The universal spell-DC options carry seven school affixes in ONE record; a
  // player ranking only Necromancy Focus matches the sixth affix, not the first.
  // A prefilter reading a singular `o.stat` drops the whole option (R1/R2).
  const universal = vikOpt("Dolorous", "Armor", [
    ["Abjuration Focus", "Profane", 1], ["Conjuration Focus", "Profane", 1],
    ["Enchantment Focus", "Profane", 1], ["Evocation Focus", "Profane", 1],
    ["Illusion Focus", "Profane", 1], ["Necromancy Focus", "Profane", 1],
    ["Transmutation Focus", "Profane", 1],
  ]);
  const model = M.buildModel([], { mlCap: 36, targets: ["Necromancy Focus"] }, [], [], [universal]);
  assert.strictEqual(model.viktranium.length, 1, "an option matching on its 6th affix is kept");
  assert.strictEqual(model.viktranium[0].affixes.length, 7, "the whole option rides through, not one affix");
});

test("Viktranium prefilter drops an option none of whose affixes are ranked", () => {
  const model = M.buildModel([], { mlCap: 36, targets: ["Constitution"] }, [], [], [
    vikOpt("Dolorous", "Armor", [["Assassinate", "Profane", 1], ["Combat Mastery", "Profane", 1]]),
  ]);
  assert.strictEqual(model.viktranium.length, 0, "no affix advances a ranked target");
});

test("Viktranium prefilter still admits a FLAT legacy record (back-compat)", () => {
  // A stale cached dataset can still deliver the pre-atomicity one-record-per-affix
  // shape; the same fallback the Dino pool carries must keep it readable.
  const model = M.buildModel([], { mlCap: 36, targets: ["Constitution"] }, [], [], [
    { slot_type: "Melancholic", category: "Accessory", stat: "Constitution", bonus_type: "Enhancement", value: 15, tier: "legendary" },
    { slot_type: "Dolorous", category: "Weapon", stat: "Attack", bonus_type: "Competence", value: 23, tier: "legendary" },
  ]);
  assert.strictEqual(model.viktranium.length, 1, "flat legacy records still filter on their singular stat");
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
  // plan 003 U2/KTD3 — the DECLARATION is now the switch, not the presence of an
  // off-hand weapon-type pick. The pick survives as refinement (Short Swords only),
  // and with the declaration on, off-hand ITEMS leave candidacy (R3) — so the Orb is
  // gone and only the second weapon remains.
  const model = M.buildModel(
    [wt("Rapier", "Rapiers", [["Strength", "Enhancement", 8]]),
     wt("Shortsword", "Short Swords", [["Constitution", "Enhancement", 8]]),
     oh("Orb", "Orbs", [["Wisdom", "Enhancement", 6]])],
    { mlCap: 34, targets: ["Strength", "Constitution"], style: "one-hand", twoWeaponFighting: true,
      weaponTypes: ["Rapiers"], offHandWeapons: ["Short Swords"] });
  const off = model.worn.find((s) => s.slot === "Off Hand");
  assert.ok(off, "an Off Hand slot exists");
  assert.ok(off.variants.some((x) => x.type === "Short Swords"), "the off-hand weapon competes off-hand");
  const mh = model.worn.find((s) => s.slot === "Main Hand");
  assert.deepStrictEqual(mh.variants.map((x) => x.type), ["Rapiers"], "main hand still locked to Rapiers");
  assert.ok(!mh.variants.some((x) => x.type === "Short Swords"), "the off-hand-only type isn't a main-hand candidate");
});

test("TWF/003: picking off-hand weapon types WITHOUT declaring no longer enables dual-wield", () => {
  // The old opt-in. It is exactly the undiscoverable trigger plan 003 replaces:
  // a pick alone must no longer put a weapon in the off hand, and the off-hand
  // items must still be there (nothing was excluded — nothing was declared).
  const model = M.buildModel(
    [wt("Rapier", "Rapiers", [["Strength", "Enhancement", 8]]),
     wt("Shortsword", "Short Swords", [["Constitution", "Enhancement", 8]]),
     oh("Orb", "Orbs", [["Wisdom", "Enhancement", 6]])],
    { mlCap: 34, targets: ["Strength", "Constitution", "Wisdom"], style: "one-hand",
      offHandWeapons: ["Short Swords"] });
  const off = model.worn.find((s) => s.slot === "Off Hand");
  assert.ok(!off.variants.some((x) => x.category === "weapon"), "a pick alone no longer enables dual-wield");
  assert.ok(off.variants.some((x) => x.type === "Orbs"), "and the off-hand item is untouched");
});

test("TWF: no weapon in the off hand without the declaration, picks or not", () => {
  const model = M.buildModel(
    [wt("Rapier", "Rapiers"), wt("Shortsword", "Short Swords"), oh("Orb", "Orbs")],
    { mlCap: 34, targets: ["Strength"], style: "one-hand", offHandWeapons: [] });
  const off = model.worn.find((s) => s.slot === "Off Hand");
  assert.ok(off && !off.variants.some((x) => x.category === "weapon"), "no weapon in the off hand undeclared");
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

// ---- plan 003 U2 — off-hand candidacy follows the Two Weapon Fighting declaration ----

// A one-handed weapon and the three off-hand item families, all carrying the same
// ranked stat so the shield genuinely out-values the weapon: that is the reported
// bug (a shield usually carries more ranked stats than a longsword), and the reason
// "let weapons compete on merit" would not have fixed it.
// Each carries a DISTINCT ranked stat so the single-cardinality dominance filter
// never prunes one for another — otherwise a collapsed pool would masquerade as the
// exclusion working (or not working).
const twfSword = { ...v("Longsword", "Main Hand", [["Constitution", "Enhancement", 8]], { category: "weapon" }), type: "Long Swords" };
const twfDagger = { ...v("Dagger", "Main Hand", [["Dexterity", "Enhancement", 6]], { category: "weapon" }), type: "Daggers" };
const twfShield = { ...v("Big Shield", "Off Hand", [["Constitution", "Enhancement", 20]]), type: "Tower shields" };
const twfOrb = { ...v("Orb", "Off Hand", [["Intelligence", "Enhancement", 18]]), type: "Orbs" };
const twfRuneArm = { ...v("Rune Arm", "Off Hand", [["Strength", "Enhancement", 16]]), type: "Rune Arms" };
const twfPool = [twfSword, twfDagger, twfShield, twfOrb, twfRuneArm];
const twfQuery = (extra) => Object.assign(
  { mlCap: 34, targets: ["Constitution", "Dexterity", "Intelligence", "Strength"] }, extra);

test("U2/003 (R3): a declared one-hand build drops shields, orbs, and rune arms from the off hand", () => {
  const model = M.buildModel(twfPool, twfQuery({ style: "one-hand", twoWeaponFighting: true }));
  const off = slotPool(model, "Off Hand");
  assert.ok(!off.includes("Big Shield") && !off.includes("Orb") && !off.includes("Rune Arm"),
    "no off-hand ITEM survives a declared build");
  assert.ok(off.length, "the off hand is not empty — a one-handed weapon fills it");
  assert.ok(off.some((n) => n === "Longsword" || n === "Dagger"), "a one-handed weapon is the candidate");
});

test("U2/003 (R3): an UNDECLARED one-hand build is unchanged — shields still compete", () => {
  const model = M.buildModel(twfPool, twfQuery({ style: "one-hand" }));
  const off = slotPool(model, "Off Hand");
  assert.ok(off.includes("Big Shield"), "the shield is still a candidate without the declaration");
  assert.ok(!off.includes("Longsword"), "and no second weapon competes — dual-wield is off");
});

test("U2/003 (R5/AE3): the declaration never overrides another style's allow-list", () => {
  // Sword & Board keeps its four shield types; crossbow keeps rune arms only. The
  // exclusion is keyed on the style that permits a second weapon, not on the flag.
  const sb = slotPool(M.buildModel(twfPool, twfQuery({ style: "sword-board", twoWeaponFighting: true })), "Off Hand");
  assert.deepStrictEqual(sb, ["Big Shield"], "S&B still takes its shield");
  const xb = slotPool(M.buildModel(twfPool, twfQuery({ style: "crossbow", twoWeaponFighting: true })), "Off Hand");
  assert.deepStrictEqual(xb, ["Rune Arm"], "crossbow still takes its rune arm");
});

test("U2/003 (R5): `unarmed` — the OTHER unrestricted off-hand style — is untouched", () => {
  // offHandTypesForStyle("unarmed") is null, so unarmed is exactly the style a
  // declaration-keyed exclusion would silently empty if it forgot the style guard.
  const off = slotPool(M.buildModel(twfPool, twfQuery({ style: "unarmed", twoWeaponFighting: true })), "Off Hand");
  assert.ok(off.includes("Big Shield") && off.includes("Orb") && off.includes("Rune Arm"),
    "unarmed keeps every off-hand item under a declared build");
});

test("U2/003: picked off-hand weapon types narrow which weapons compete", () => {
  const model = M.buildModel(twfPool, twfQuery({ style: "one-hand", twoWeaponFighting: true, offHandWeapons: ["Daggers"] }));
  const off = slotPool(model, "Off Hand");
  assert.deepStrictEqual(off, ["Dagger"], "only the picked type is an off-hand candidate");
  // …and with no picks, every one-handed type competes (the declaration alone is enough).
  const wide = slotPool(M.buildModel(twfPool, twfQuery({ style: "one-hand", twoWeaponFighting: true })), "Off Hand");
  assert.ok(wide.includes("Longsword") && wide.includes("Dagger"), "no picks => every one-handed type");
});

test("U2/003 (R8): a PINNED shield overrides the exclusion — the escape hatch holds", () => {
  const model = M.buildModel(twfPool, twfQuery({ style: "one-hand", twoWeaponFighting: true,
    slotConstraints: { "Off Hand": { type: "pin", variant_id: "Big Shield" } } }));
  const off = slotPool(model, "Off Hand");
  assert.ok(off.includes("Big Shield"), "the player's explicit pin survives the exclusion");
  assert.ok(!off.includes("Orb") && !off.includes("Rune Arm"), "but only the pinned one — not off-hand items generally");
});

test("U2/003: the Artifact exemption must NOT smuggle an unpinned shield past the exclusion", () => {
  // includeArtifact widens the shared `pinnedIds` set with every eligible Artifact so
  // the pre-filter can't prune one. R3's escape hatch is "unless the PLAYER pins one",
  // so the exclusion must read the explicit pins only — reusing the widened set would
  // let an Artifact shield sit in a declared build's off hand with nobody pinning it.
  const artShield = { ...twfShield, source_item: "Artifact Shield", variant_id: "Artifact Shield", artifact: true };
  const model = M.buildModel([...twfPool, artShield],
    twfQuery({ style: "one-hand", twoWeaponFighting: true, includeArtifact: true }));
  assert.ok(!slotPool(model, "Off Hand").includes("Artifact Shield"),
    "an Artifact shield is still excluded from a declared build's off hand");
});

test("U2/003: offHandItemsExcluded is the single advisory authority (U5 flag + U6 notice)", () => {
  assert.strictEqual(M.offHandItemsExcluded({ style: "one-hand", twoWeaponFighting: true }), true);
  assert.strictEqual(M.offHandItemsExcluded({ style: "one-hand" }), false, "undeclared");
  assert.strictEqual(M.offHandItemsExcluded({ style: "sword-board", twoWeaponFighting: true }), false, "wrong style");
  assert.strictEqual(M.offHandItemsExcluded({ style: "unarmed", twoWeaponFighting: true }), false, "wrong style");
  assert.strictEqual(M.offHandItemsExcluded({}), false, "no style, no declaration");
});

// ---- plan 003 U5 (KTD6) — slot-aware pin legality, layered on variantConflict ----

test("U5/003 (R7): an off-hand WEAPON pin without the declaration is a slot conflict", () => {
  const q = { mlCap: 34, targets: ["Constitution"], style: "one-hand" };
  // variantConflict is slot-blind: a one-handed weapon passes the main-hand gate and
  // returns null, so nothing would suppress the pin — while the weapon is absent from
  // the off-hand pool, making the pin a constraint on a variant not in its own slot.
  // That is a NO-BUILD, not R7's graceful suppression. This predicate is the fix.
  assert.strictEqual(M.variantConflict(twfSword, q), null, "variantConflict alone sees nothing wrong");
  assert.ok(M.pinSlotConflict(twfSword, "Off Hand", q), "the slot-aware predicate catches it");
  assert.strictEqual(M.pinSlotConflict(twfSword, "Main Hand", q), null, "the same weapon is fine in the main hand");
});

test("U5/003 (R7): declaring makes the same off-hand weapon pin legal", () => {
  const q = { mlCap: 34, targets: ["Constitution"], style: "one-hand", twoWeaponFighting: true };
  assert.strictEqual(M.pinSlotConflict(twfSword, "Off Hand", q), null, "declared: the pin is honored");
  // …and the off-hand weapon-type picks still narrow it.
  const narrowed = Object.assign({}, q, { offHandWeapons: ["Daggers"] });
  assert.ok(M.pinSlotConflict(twfSword, "Off Hand", narrowed), "a type outside the picks is flagged");
  assert.strictEqual(M.pinSlotConflict(twfDagger, "Off Hand", narrowed), null, "a picked type is fine");
});

test("U5/003 (R8/KTD1): a pinned SHIELD on a declared build is NOT a conflict", () => {
  // This is the load-bearing case. If the exclusion were expressed as a conflict,
  // reconcilePinLegality would drop the pin — the feature would delete its own
  // escape hatch. The shield is honored; U5 flags it as an override instead.
  const q = { mlCap: 34, targets: ["Constitution"], style: "one-hand", twoWeaponFighting: true };
  assert.strictEqual(M.pinSlotConflict(twfShield, "Off Hand", q), null, "the pinned shield survives");
  assert.strictEqual(M.variantConflict(twfShield, q), null, "and no variant-level conflict either");
});

test("U5/003: the predicate is inert everywhere it should be", () => {
  const q = { mlCap: 34, targets: ["Constitution"], style: "sword-board", twoWeaponFighting: true };
  assert.strictEqual(M.pinSlotConflict(twfShield, "Off Hand", q), null, "S&B shield pin");
  assert.strictEqual(M.pinSlotConflict(twfSword, "Main Hand", q), null, "main-hand weapon pin");
  const ring = v("Ring", "Ring", [["Constitution", "Enhancement", 5]]);
  assert.strictEqual(M.pinSlotConflict(ring, "Ring", q), null, "a non-hand pin is never touched");
  assert.strictEqual(M.pinSlotConflict(null, "Off Hand", q), null, "a missing variant is not a crash");
});

// ---- #162 — druidic oath: metal restriction + proficiency ------------------
// Sourced from https://ddowiki.com/page/Druid: "A druid who wears metal armor, a
// metal shield or a rune arm is unable to cast Druid spells..." Material is
// wiki-sourced per item; an unsourced or unclassified material FAILS OPEN.
{
  const druid = { oath: "druid", armorTypes: ["cloth", "light", "medium"] };
  const v = (o) => Object.assign(
    { slot: "Off Hand", type: "Large shields", verification: "verified",
      affixes: [], ml: 20 }, o);

  test("#162: a metal shield is forbidden under a druidic oath", () => {
    const r = M.variantConflict(v({ material: "Steel", material_class: "metal" }), druid);
    assert.match(String(r), /metal shield/);
  });

  test("#162: metal body armor is forbidden under a druidic oath", () => {
    // MEDIUM, deliberately: a druid IS proficient with medium armor, so the metal
    // rule is what must block this. Heavy metal armor is a weaker test — the
    // proficiency gate rejects it first and the metal rule never runs.
    const r = M.variantConflict(
      v({ slot: "Armor", type: "Medium armor", armor_type: "medium",
          material: "Steel", material_class: "metal" }), druid);
    assert.match(String(r), /metal armor/);
  });

  test("#162: heavy armor is rejected on proficiency before metalness matters", () => {
    const r = M.variantConflict(
      v({ slot: "Armor", type: "Heavy armor", armor_type: "heavy",
          material: "Steel", material_class: "metal" }), druid);
    assert.match(String(r), /proficiency/);
  });

  test("#162: non-metal MEDIUM armor is allowed (the approximation wrongly excluded it)", () => {
    const r = M.variantConflict(
      v({ slot: "Armor", type: "Medium armor", armor_type: "medium",
          material: "Darkwood", material_class: "non_metal" }), druid);
    assert.strictEqual(r, null, "Darkwood medium armor is legal for a druid");
  });

  test("#162: a tower shield is forbidden (no druid proficiency)", () => {
    const r = M.variantConflict(
      v({ type: "Tower shields", material: "Darkwood", material_class: "non_metal" }), druid);
    assert.match(String(r), /tower shield/i);
  });

  test("#162: a rune arm is forbidden under a druidic oath", () => {
    const r = M.variantConflict(v({ type: "Rune Arms" }), druid);
    assert.match(String(r), /rune arm/i);
  });

  test("#162: an UNCLASSIFIED material fails open rather than guessing", () => {
    // Crystal's metalness is not stated on the wiki, so it carries no material_class.
    const r = M.variantConflict(v({ material: "Crystal" }), druid);
    assert.strictEqual(r, null,
      "an unsourced metalness must not silently narrow the pool");
  });

  test("#162: a character with no oath is unaffected by material", () => {
    const r = M.variantConflict(
      v({ material: "Steel", material_class: "metal" }), { armorTypes: undefined });
    assert.strictEqual(r, null);
  });
}


// ---- U1 (declared stat credits) — the sanitizer every producer crosses -------
// normalizeCredits is the only thing between a player-typed number and an LP
// coefficient. U2's selector defends the wizard; it cannot defend the restore
// and import producers, so the rules live here and are tested here.
{
  const N = M.normalizeCredits;
  const one = (rows) => N(rows);

  test("U1: a well-formed credit survives, trimmed and coerced", () => {
    assert.deepStrictEqual(one([{ stat: " Combat Mastery ", bonus_type: " Insight ", value: "7" }]),
      [{ stat: "Combat Mastery", bonus_type: "Insight", value: 7 }]);
    assert.strictEqual(typeof one([{ stat: "CM", bonus_type: "Insight", value: "7" }])[0].value, "number",
      "a numeric string must become a NUMBER — a string coefficient concatenates in readSolution's accumulator and turns the reported total into \"07\"");
  });

  test("U1: the keyed-map and array shapes normalize identically", () => {
    const rows = [{ stat: "CM", bonus_type: "Insight", value: 7 }];
    assert.deepStrictEqual(N({ "CM||Insight": rows[0] }), N(rows));
    assert.deepStrictEqual(N(null), []);
    assert.deepStrictEqual(N(undefined), []);
  });

  test("U1: a bonus type outside the curated vocabulary is dropped", () => {
    // Wrong-HIGH and silent if admitted: `insight` forms its own bucket key, so
    // the credit stops competing with Insight gear and ADDS to it. Case-folding
    // is NOT the fix — an unrecognized type stacking additively is correct for a
    // real type no gear carries, so only membership separates the two.
    for (const bad of ["insight", "Insightful", "Insights", "", "  ", "Bool", "-"]) {
      assert.deepStrictEqual(one([{ stat: "CM", bonus_type: bad, value: 7 }]), [],
        `bonus type ${JSON.stringify(bad)} must not reach a bucket`);
    }
  });

  test("U1: a type no gear carries is still declarable", () => {
    // AE4's additive case. Morale appears nowhere in the dataset; a vocabulary
    // derived from the data would make the Spell Song Trance credit undeclarable.
    assert.strictEqual(one([{ stat: "Spell DC", bonus_type: "Morale", value: 1 }]).length, 1);
    assert.ok(M.CREDIT_BONUS_TYPES.includes("Morale"));
  });

  test("U1: unusable magnitudes are dropped rather than reaching the LP", () => {
    for (const bad of [0, -1, NaN, Infinity, -Infinity, "abc", null, undefined, 7.5, 1e-7]) {
      assert.deepStrictEqual(one([{ stat: "CM", bonus_type: "Insight", value: bad }]), [],
        `value ${String(bad)} must be dropped`);
    }
    // Above ~1e15 the value stringifies into LP text HiGHS refuses, and solve
    // THROWS instead of returning infeasible. Bound it well below that.
    assert.deepStrictEqual(one([{ stat: "CM", bonus_type: "Insight", value: 1e15 }]), []);
    assert.strictEqual(one([{ stat: "CM", bonus_type: "Insight", value: M.MAX_CREDIT_VALUE }]).length, 1);
    assert.deepStrictEqual(one([{ stat: "CM", bonus_type: "Insight", value: M.MAX_CREDIT_VALUE + 1 }]), []);
  });

  test("U1: two rows on one key keep the LARGER, not the last", () => {
    // The bucket resolves max-of-type, so last-wins would contradict the rule the
    // credit participates under.
    assert.strictEqual(one([{ stat: "CM", bonus_type: "Insight", value: 9 },
                            { stat: "CM", bonus_type: "Insight", value: 4 }])[0].value, 9);
    assert.strictEqual(one([{ stat: "CM", bonus_type: "Insight", value: 4 },
                            { stat: "CM", bonus_type: "Insight", value: 9 }])[0].value, 9);
  });

  test("U1: distinct bonus types on one stat are kept separate", () => {
    assert.strictEqual(one([{ stat: "CM", bonus_type: "Insight", value: 7 },
                            { stat: "CM", bonus_type: "Sacred", value: 4 }]).length, 2);
  });

  test("U1: buildModel carries declaredCredits through to the model", () => {
    const ring = {
      source_item: "R", variant_id: "R", slot: "Ring", category: "item",
      minimum_level: 30, ml: 30, verification: "verified",
      affixes: [{ stat: "Intelligence", bonus_type: "Enhancement", name: "Intelligence", type: "Enhancement", value: 20, unit: "flat" }],
      scaling: [], set_bonus: [], augment_slots: [], restrictions: "unknown", armor_type: null,
    };
    const q = { mlCap: 34, targets: ["Intelligence"], targetCaps: {}, targetFloors: {},
      declaredCredits: { "Intelligence||Insight": { stat: "Intelligence", bonus_type: "Insight", value: 6 } } };
    assert.deepStrictEqual(M.buildModel([ring], q).credits,
      [{ stat: "Intelligence", bonus_type: "Insight", value: 6 }]);
    // The shipping no-credit case is an ABSENT key, not an empty array.
    assert.deepStrictEqual(M.buildModel([ring], { ...q, declaredCredits: undefined }).credits, []);
  });
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// #235 — an absent bonus type is NOT folded into `Untyped`. A previous revision
// did that to stop a declared credit double-counting, and it was wrong on the
// wider rule: real untyped bonuses STACK (CONCEPTS.md), and 30 stats carry both
// an absent type and an explicit `Untyped` — an item's own effect beside an
// augment's — which are meant to add.

test("#235: equivType leaves an absent bonus type alone", () => {
  assert.strictEqual(M.equivType(null), null);
  assert.strictEqual(M.equivType(undefined), undefined);
  assert.strictEqual(M.equivType("Untyped"), "Untyped");
  assert.strictEqual(M.equivType("Enhancement"), "Enhancement");
  assert.strictEqual(M.equivType("Insight"), "Insight");
});

test("#235: an untyped affix and an explicit Untyped one keep separate buckets, so they sum", () => {
  const item = {
    variant_id: "i", source_item: "Weapon", slot: "Weapon", category: "weapon",
    minimum_level: 34, ml: 34, verification: "verified",
    affixes: [
      { name: "Acidic", type: null, value: 6, unit: "flat" },       // the item's own effect
      { name: "Acidic", type: "Untyped", value: 4, unit: "flat" },  // an augment's
    ],
    scaling: [], set_bonus: [], augment_slots: [], restrictions: "unknown", armor_type: null,
  };
  const keys = [...M.variantBuckets(item, new Set(["Acidic"]), 34).keys()].sort();
  assert.strictEqual(keys.length, 2, "two buckets, so the two values add");
  assert.ok(keys.includes("Acidic||Untyped"));
});


console.log(`\n${passed} passed`);

// ---------------------------------------------------------------------------
// #346 (U1) — the crafting/augment ladder that replaced #245's boolean. A
// craftable option slot makes its host a wildcard for every rankable stat, so
// the niche-crafting rung must empty the option-pool families at the model seam
// — and the top rung must change NOTHING.

test("#346: the no-niche-crafting rung empties the option-pool families", () => {
  const host = v("Host", "Ring", [["Intelligence", "Enhancement", 5]]);
  const vik = { slot_type: "Melancholic", category: "accessory", tier: "legendary",
    affixes: [{ stat: "Intelligence", value: 7, bonus_type: "Insight" }] };
  const seal = { seal_type: "Undeath", stat: "Intelligence", value: 5, bonus_type: "Profane" };
  const nc = { category: "Ability Score", stat: "Intelligence", value: 15, bonus_type: "Enhancement" };
  const dino = { dino_type: "bone", affixes: [{ stat: "Intelligence", value: 4 }] };
  const defs = { "Some Set": { tiers: [{ pieces_required: 2, affixes: [{ stat: "Intelligence", bonus_type: "Artifact", value: 6 }] }] } };
  const q = { mlCap: 34, targets: ["Intelligence"] };

  const off = M.buildModel([host], q, [dino], [nc], [vik], [seal], defs, [], [], defs);
  assert.ok(off.viktranium.length && off.seal.length && off.nearlyComplete.length
    && off.dinoInserts.length && Object.keys(off.membershipSetDefs).length,
    "top rung: every family pool survives (today's behavior)");

  const on = M.buildModel([host], { ...q, craftingRung: "no-niche-crafting" },
    [dino], [nc], [vik], [seal], defs, [], [], defs);
  assert.deepStrictEqual(
    [on.viktranium, on.seal, on.nearlyComplete, on.dinoInserts, on.thunderForged, on.greenSteel],
    [[], [], [], [], [], []], "rung on: every option pool is empty");
  assert.deepStrictEqual(on.membershipSetDefs, {}, "chosen set-membership crafting is off");
  assert.deepStrictEqual(on.augment_set_defs, {}, "set-bonus augments (Dino crafting) are off");
  // the host itself still competes on its printed affixes
  const ring = on.worn.find((s) => s.slot === "Ring");
  assert.ok(ring && ring.variants.some((x) => x.source_item === "Host"),
    "the host item itself is not excluded — only its craft options are");
});

// #346 (U1) — the ladder's rank table is the ONLY place ordering lives, and an
// unreadable value must fail open to the top rung rather than throw. A
// hand-edited backup is the realistic source of a bad value.
test("#346: rung normalization fails open to the top rung", () => {
  // Inherited Object.prototype keys are the interesting case: a plain-object
  // rank table answered `!= null` for every one of them, so "constructor"
  // sanitized to itself, persisted, and then ranked as a Function.
  for (const bad of [undefined, null, "", "nonsense", 3, {}, "Everything",
    "constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
    assert.strictEqual(M.normalizeRung(bad), "everything", `${JSON.stringify(bad)} reads as the top rung`);
    assert.strictEqual(M.craftingRungRank(bad), 0, `${JSON.stringify(bad)} ranks as the top rung`);
    assert.strictEqual(typeof M.craftingRungRank(bad), "number", `${JSON.stringify(bad)} ranks to a NUMBER`);
  }
  for (const good of M.CRAFTING_RUNGS) {
    assert.strictEqual(M.normalizeRung(good), good, `${good} round-trips`);
  }
  assert.strictEqual(M.craftingRung({ craftingRung: "printed-only" }), "printed-only");
  assert.strictEqual(M.craftingRung({}), "everything", "an absent rung reads as the top rung");
});

// #346 (U1) — the model seam honours the legacy boolean, like every other reader
// of the ladder. It drifted once: the wizard load path, persistence, and the
// projection notice all applied this precedence while buildModel did not, so a
// query carrying only the old boolean solved with the craftable option pools
// fully live — the exact opposite of what that boolean meant.
test("#346: the model seam honours the legacy boolean when no rung is stored", () => {
  assert.strictEqual(M.craftingRung({ excludeCraftingSystems: true }), "no-niche-crafting");
  assert.strictEqual(M.craftingRung({ excludeCraftingSystems: false }), "everything");
  assert.strictEqual(M.craftingRung({ craftingRung: "printed-only", excludeCraftingSystems: true }),
    "printed-only", "a stored rung still wins over a stale boolean");

  // And it reaches the pools, not just the accessor.
  const host = v("Host", "Ring", [["Intelligence", "Enhancement", 5]]);
  const vik = { slot_type: "Melancholic", category: "accessory", tier: "legendary",
    affixes: [{ stat: "Intelligence", value: 7, bonus_type: "Insight" }] };
  const legacy = M.buildModel([host], { mlCap: 34, targets: ["Intelligence"], excludeCraftingSystems: true },
    [], [], [vik], [], {}, [], [], {});
  assert.deepStrictEqual(legacy.viktranium, [],
    "a legacy-only query empties the option pools at the model seam");
});

// #346 (U1) — the three predicates ARE the ladder's monotonicity. If a rung ever
// stops implying every exclusion above it, the ladder's promise that no
// selection can contradict itself is broken.
test("#346: each rung excludes strictly more than the one above it", () => {
  const rows = M.CRAFTING_RUNGS.map((r) => [
    M.rungExcludesNicheCrafting(r), M.rungExcludesSolarLunar(r), M.rungExcludesAllAugments(r),
  ]);
  assert.deepStrictEqual(rows, [
    [false, false, false],   // everything
    [true, false, false],    // no-niche-crafting
    [true, true, false],     // no-solar-lunar
    [true, true, true],      // printed-only
  ]);
  for (let i = 1; i < rows.length; i++) {
    for (let c = 0; c < 3; c++) {
      assert.ok(!(rows[i - 1][c] && !rows[i][c]),
        `rung ${M.CRAFTING_RUNGS[i]} must not re-admit what ${M.CRAFTING_RUNGS[i - 1]} excluded`);
    }
  }
});

// #346 (U1) — the augment rungs live in eligible(), the same choke point the
// #339 ceiling uses, so the augment pool / placement / alternatives / browse
// reason all inherit them. Colors other than Sun and Moon must survive the
// Solar/Lunar rung: that rung is about one acquisition line, not augments at
// large.
test("#346: the Solar/Lunar rung removes Sun and Moon and keeps every other color", () => {
  const augOf = (name, color) => Object.assign(
    v(name, "Augment", [["Intelligence", "Enhancement", 5]], { category: "augment", ml: 10 }),
    { aug_color: { color, raw: color, reason: null } });
  const sun = augOf("Solar Gem of Test", "Sun");
  const moon = augOf("Lunar Gem of Test", "Moon");
  const blue = augOf("Sapphire of Test", "Blue");
  const colorless = augOf("Diamond of Test", "Colorless");
  const q = { mlCap: 34, targets: ["Intelligence"] };

  const keep = (rung) => [sun, moon, blue, colorless]
    .filter((a) => M.variantConflict(a, { ...q, craftingRung: rung }) == null)
    .map((a) => a.variant_id);

  assert.deepStrictEqual(keep("everything").length, 4, "top rung keeps every augment");
  assert.deepStrictEqual(keep("no-niche-crafting").length, 4,
    "the niche-crafting rung does not touch augments — that was the old boolean's documented carve-out");
  assert.deepStrictEqual(keep("no-solar-lunar"), ["Sapphire of Test", "Diamond of Test"],
    "only Sun and Moon leave");
  assert.deepStrictEqual(keep("printed-only"), [], "the bottom rung removes every augment");

  // The reason string is player-facing (browse shows it) — it must name the
  // control the player set, not an internal rung id.
  assert.match(M.variantConflict(sun, { ...q, craftingRung: "no-solar-lunar" }), /Solar\/Lunar/);
  assert.match(M.variantConflict(blue, { ...q, craftingRung: "printed-only" }), /without augments/);
});

// #346 (U1) — worn gear is NEVER touched by the augment rungs. The bottom rung
// means "each item wins on what is printed on it", not "fewer items".
test("#346: the augment rungs leave worn gear untouched", () => {
  const ring = v("Ring of Test", "Ring", [["Intelligence", "Enhancement", 5]]);
  for (const rung of M.CRAFTING_RUNGS) {
    assert.strictEqual(M.variantConflict(ring, { mlCap: 34, targets: ["Intelligence"], craftingRung: rung }), null,
      `worn gear survives the ${rung} rung`);
  }
});

// #346 (U1) — Augment Sets need no augment-rung handling of their own: they are
// set-bonus crafting, cleared at the no-niche-crafting rung, and the ladder
// nests so every augment-excluding rung inherits that. Pinned as a test because
// the plan's acceptance example reads as though the BOTTOM rung is what removes
// them — it is not, and a future edit that "restores" sets on a middle rung
// would break the ladder's monotonicity.
test("#346: augment sets are cleared from the no-niche-crafting rung down", () => {
  const host = v("Host", "Ring", [["Intelligence", "Enhancement", 5]]);
  const defs = { "Some Aug Set": { tiers: [{ pieces_required: 3, affixes: [{ stat: "Intelligence", bonus_type: "Artifact", value: 6 }] }] } };
  // The family is opt-in: an unowned set is inert regardless of rung, so the
  // fixture must mark it owned or the rung's effect is unobservable.
  const q = { mlCap: 34, targets: ["Intelligence"], ownedSetAugments: new Set(["Some Aug Set"]) };
  const at = (rung) => Object.keys(
    M.buildModel([host], { ...q, craftingRung: rung }, [], [], [], [], {}, [], [], defs).augment_set_defs);

  assert.deepStrictEqual(at("everything"), ["Some Aug Set"], "the top rung keeps the set");
  for (const rung of ["no-niche-crafting", "no-solar-lunar", "printed-only"]) {
    assert.deepStrictEqual(at(rung), [], `${rung} has no augment sets`);
  }
});

// ---------------------------------------------------------------------------
// #110 U2 — the blocklist filters candidacy, upstream of dominance, and the
// blocked set survives on the model for the disclosure to read.

test("U2/#110: a blocked variant is absent from its slot pool; removal restores it", () => {
  const A = v("Blocked Ring", "Ring", [["Intelligence", "Enhancement", 10]]);
  const B = v("Other Ring", "Ring", [["Intelligence", "Enhancement", 8]]);
  const q = { mlCap: 34, targets: ["Intelligence"] };
  const blockedModel = M.buildModel([A, B], { ...q, blocklist: ["Blocked Ring"] });
  const pool = blockedModel.worn.find((s) => s.slot === "Ring").variants.map((x) => x.variant_id);
  assert.deepStrictEqual(pool, ["Other Ring"]);
  const freeModel = M.buildModel([A, B], { ...q, blocklist: [] });
  const freePool = freeModel.worn.find((s) => s.slot === "Ring").variants.map((x) => x.variant_id);
  assert.ok(freePool.includes("Blocked Ring"), "removing the block restores candidacy");
});

test("U2/#110: blocking the DOMINANT variant leaves the runner-up selectable", () => {
  // A strictly dominates B, so B is normally pruned. The block must run upstream
  // of dominance so B becomes the pool's new best rather than vanishing with A.
  const A = v("Dominant", "Ring", [["Intelligence", "Enhancement", 10]]);
  const B = v("RunnerUp", "Ring", [["Intelligence", "Enhancement", 5]]);
  const m = M.buildModel([A, B], { mlCap: 34, targets: ["Intelligence"], blocklist: ["Dominant"] });
  const pool = m.worn.find((s) => s.slot === "Ring").variants.map((x) => x.variant_id);
  assert.deepStrictEqual(pool, ["RunnerUp"]);
});

test("U2/#110: a blocked augment is absent from its colour pool (same gate)", () => {
  const aug = (name) => ({ ...v(name, "Yellow", [["Intelligence", "Enhancement", 5]], { category: "augment" }),
    aug_color: { color: "Yellow" } });
  const m = M.buildModel([aug("Bad Gem"), aug("Good Gem")],
    { mlCap: 34, targets: ["Intelligence"], blocklist: ["Bad Gem"] });
  assert.deepStrictEqual(m.augments.map((a) => a.variant_id), ["Good Gem"]);
});

test("U2/#110: a blocked variant that is also pinned does not reach the pool", () => {
  const A = v("Contested", "Ring", [["Intelligence", "Enhancement", 10]]);
  const m = M.buildModel([A], { mlCap: 34, targets: ["Intelligence"],
    blocklist: ["Contested"], slotConstraints: { Ring: { pin: "Contested" } } });
  const ring = m.worn.find((s) => s.slot === "Ring");
  assert.ok(!ring || !ring.variants.some((x) => x.variant_id === "Contested"),
    "the pin does not override the block");
});

test("U2/#110: the blocked set is retained on the model for the disclosure", () => {
  const A = v("Blocked Ring", "Ring", [["Intelligence", "Enhancement", 10]]);
  const m = M.buildModel([A], { mlCap: 34, targets: ["Intelligence"], blocklist: ["Blocked Ring"] });
  assert.deepStrictEqual((m.blocked || []).map((x) => x.variant_id), ["Blocked Ring"]);
});

test("U2/#110: an absent blocklist filters nothing (the legacy Solver tab's query)", () => {
  const A = v("A Ring", "Ring", [["Intelligence", "Enhancement", 10]]);
  const m = M.buildModel([A], { mlCap: 34, targets: ["Intelligence"] });   // no blocklist key at all
  assert.ok(m.worn.find((s) => s.slot === "Ring").variants.length === 1,
    "a missing key means filter nothing, never filter everything");
});

test("U7/#110: blockReport asserts bestAvailable only when the block dominates ALL survivors", () => {
  // Blocked A (Int 10) dominates survivor B (Int 5): superlative earned.
  // Blocked C (Con 8) does NOT dominate survivor D (Con 9): no superlative.
  const A = v("Blocked Best", "Ring", [["Intelligence", "Enhancement", 10]]);
  const B = v("Weak Ring", "Ring", [["Intelligence", "Enhancement", 5]]);
  const C = v("Blocked Middling", "Necklace", [["Constitution", "Enhancement", 8]]);
  const D = v("Strong Neck", "Necklace", [["Constitution", "Enhancement", 9]]);
  const m = M.buildModel([A, B, C, D], { mlCap: 34, targets: ["Intelligence", "Constitution"],
    blocklist: ["Blocked Best", "Blocked Middling"] });
  const rep = Object.fromEntries(m.blockReport.map((e) => [e.id, e.bestAvailable]));
  assert.strictEqual(rep["Blocked Best"], true);
  assert.strictEqual(rep["Blocked Middling"], false);
});

// ---------------------------------------------------------------------------
// #547 — a block names an ITEM, not a catalog record. 45 items are carried as
// two records (`X` as it drops, `X [Crafted]` after its Essence Crafting slots
// are used), and blocking one used to hand the player the other with identical
// numbers, so the block read as ignored.

test("#547: blocking either half of a crafted pair blocks the item", () => {
  // The stamp is what dataset.js writes from the build-derived pairing. Both
  // records carry the SAME identity; the base's is itself.
  const base = v("Twin Ring", "Ring", [["Intelligence", "Enhancement", 10]]);
  base.block_identity = "Twin Ring";
  const twin = v("Twin Ring [Crafted]", "Ring", [["Intelligence", "Enhancement", 10]]);
  twin.block_identity = "Twin Ring";
  const other = v("Other Ring", "Ring", [["Intelligence", "Enhancement", 8]]);
  const q = { mlCap: 34, targets: ["Intelligence"] };
  const poolOf = (blocklist) => M.buildModel([base, twin, other], { ...q, blocklist })
    .worn.find((s) => s.slot === "Ring").variants.map((x) => x.variant_id);

  assert.deepStrictEqual(poolOf(["Twin Ring"]), ["Other Ring"],
    "blocking the base must not leave its crafted twin as the runner-up");
  assert.deepStrictEqual(poolOf(["Twin Ring [Crafted]"]), ["Other Ring"],
    "and the fold is symmetric — blocking the twin covers the base");
  // With nothing blocked the block gate must remove NOTHING. Asserted on its own
  // report rather than on the surviving pool, because the pool is also shaped by
  // dominance — which prunes the identical twin, and prunes `Other Ring` too.
  // That pruning is the pre-existing behaviour this change does not touch, and it
  // is exactly why the twin stays invisible until the base is blocked.
  const free = M.buildModel([base, twin, other], { ...q, blocklist: [] });
  assert.deepStrictEqual(free.blockReport, [],
    "with nothing blocked, the block gate removes neither half");
});

test("#547: an unstamped record is only ever itself", () => {
  // The other 9,020 carry no `block_identity`, and the widened gate must fall
  // back to the record's own key for them. A truthiness slip here would collapse
  // every unstamped candidate into one identity and empty the pool.
  const A = v("Plain Ring", "Ring", [["Intelligence", "Enhancement", 10]]);
  const B = v("Second Ring", "Ring", [["Intelligence", "Enhancement", 8]]);
  const m = M.buildModel([A, B], { mlCap: 34, targets: ["Intelligence"], blocklist: ["Plain Ring"] });
  assert.deepStrictEqual(
    m.worn.find((s) => s.slot === "Ring").variants.map((x) => x.variant_id), ["Second Ring"]);
});

test("#547: the fold does not reach a DIFFERENT item sharing no identity", () => {
  // The widening keys on the stamped identity, never on the name. Two records
  // whose names merely look related must not block together.
  const a = v("Alpha Ring", "Ring", [["Intelligence", "Enhancement", 10]]);
  a.block_identity = "Alpha Ring";
  const b = v("Alpha Ring of Something Else", "Ring", [["Intelligence", "Enhancement", 9]]);
  b.block_identity = "Alpha Ring of Something Else";
  const m = M.buildModel([a, b], { mlCap: 34, targets: ["Intelligence"], blocklist: ["Alpha Ring"] });
  assert.deepStrictEqual(
    m.worn.find((s) => s.slot === "Ring").variants.map((x) => x.variant_id),
    ["Alpha Ring of Something Else"]);
});

test("#547: both halves reach the disclosure, so the block is not silent", () => {
  const base = v("Twin Ring", "Ring", [["Intelligence", "Enhancement", 10]]);
  base.block_identity = "Twin Ring";
  const twin = v("Twin Ring [Crafted]", "Ring", [["Intelligence", "Enhancement", 10]]);
  twin.block_identity = "Twin Ring";
  const other = v("Other Ring", "Ring", [["Intelligence", "Enhancement", 8]]);
  const m = M.buildModel([base, twin, other],
    { mlCap: 34, targets: ["Intelligence"], blocklist: ["Twin Ring"] });
  assert.deepStrictEqual(m.blockReport.map((e) => e.id).sort(),
    ["Twin Ring", "Twin Ring [Crafted]"],
    "the player named one; the disclosure must account for both records removed");
});

test("U7/#110: a blocked augment's report compares against its colour pool", () => {
  const aug = (name, val) => ({ ...v(name, "Yellow", [["Intelligence", "Enhancement", val]], { category: "augment" }),
    aug_color: { color: "Yellow" } });
  const m = M.buildModel([aug("Blocked Gem", 10), aug("Lesser Gem", 4)],
    { mlCap: 34, targets: ["Intelligence"], blocklist: ["Blocked Gem"] });
  const e = m.blockReport[0];
  assert.strictEqual(e.pool, "Yellow-augment", "an augment has no worn slot; the colour pool is the comparison");
  assert.strictEqual(e.bestAvailable, true);
});

test("U8/#110: a slot whose every candidate is blocked is captured where the omission happens", () => {
  const A = v("Only Neck", "Necklace", [["Constitution", "Enhancement", 5]]);
  const B = v("A Ring", "Ring", [["Constitution", "Enhancement", 5]]);
  const m = M.buildModel([A, B], { mlCap: 34, targets: ["Constitution"], blocklist: ["Only Neck"] });
  assert.ok(!m.worn.some((s) => s.slot === "Necklace"), "the emptied slot is omitted from worn (the existing shape)");
  assert.deepStrictEqual(m.blockEmptiedSlots, ["Necklace"], "…and recorded with its reason");
});

test("U8/#110: a slot empty for ordinary reasons is NOT attributed to blocks", () => {
  const B = v("A Ring", "Ring", [["Constitution", "Enhancement", 5]]);
  const m = M.buildModel([B], { mlCap: 34, targets: ["Constitution"], blocklist: ["Unrelated Thing"] });
  assert.deepStrictEqual(m.blockEmptiedSlots, [], "no candidate was removed by a block");
});

// ---------------------------------------------------------------------------
// #110 review fixes — the block-emptied capture and the attribution tie.

test("review/#110: a slot the player locked empty is never attributed to blocks", () => {
  const A = v("Only Neck", "Necklace", [["Constitution", "Enhancement", 5]]);
  const m = M.buildModel([A], { mlCap: 34, targets: ["Constitution"],
    blocklist: ["Only Neck"], slotConstraints: { Necklace: { type: "empty" } } });
  assert.deepStrictEqual(m.blockEmptiedSlots, [],
    "the player chose the emptiness; 'unblock something' would be false advice");
});

test("review/#110: bestAvailable is NOT asserted on an exact tie", () => {
  const A = v("Blocked Twin", "Ring", [["Intelligence", "Enhancement", 10]]);
  const B = v("Surviving Twin", "Ring", [["Intelligence", "Enhancement", 10]]);
  const m = M.buildModel([A, B], { mlCap: 34, targets: ["Intelligence"], blocklist: ["Blocked Twin"] });
  assert.strictEqual(m.blockReport[0].bestAvailable, false,
    "a tie is a match, not an out-valuing — the superlative must not print");
});

test("review/#110: blocking every TWF off-hand weapon is captured as block-emptied", () => {
  const wep = (name) => ({ ...v(name, "Weapon", [["Deadly", "Enhancement", 5]], { category: "weapon" }),
    type: "Short Swords", handedness: "1h" });
  const m = M.buildModel([wep("Only Offhand Sword")], { mlCap: 34, targets: ["Deadly"],
    twoWeaponFighting: true, style: "one-hand", weaponSetup: { style: "one-hand" },
    offHandWeapons: ["Short Swords"], blocklist: ["Only Offhand Sword"] });
  assert.ok((m.blockEmptiedSlots || []).includes("Off Hand"),
    "a TWF off hand emptied purely by weapon blocks must be attributed");
});

// #287 — the Legendary fold changes stat NAMES only; the stacking math is the
// existing per-(stat, equivalent-type) bucket. A folded Accuracy|Legendary must
// sum with a Competence Accuracy (different types) and collapse to the max
// against another Legendary Accuracy (same bucket) — with no new model code.
test("#287: folded Legendary bucket sums across types, maxes within its own", () => {
  const both = v("Both", "Ring", [["Accuracy", "Competence", 5], ["Accuracy", "Legendary", 2]]);
  const buckets = M.variantBuckets(both, new Set(["Accuracy"]), 30);
  assert.strictEqual(buckets.size, 2, "Competence and Legendary are distinct buckets");
  let total = 0; for (const val of buckets.values()) total += val;
  assert.strictEqual(total, 7, "different types add");

  const twice = v("Twice", "Ring", [["Accuracy", "Legendary", 2], ["Accuracy", "Legendary", 5]]);
  const b2 = M.variantBuckets(twice, new Set(["Accuracy"]), 30);
  assert.strictEqual(b2.size, 1, "two Legendary sources share one bucket");
  assert.strictEqual(b2.get("Accuracy||Legendary"), 5, "and only the highest applies");
});

// ---------------------------------------------------------------------------
// U1 (#290/#291) — cross-add data plumbing. `crossAddSourcesFor(stat)` exposes
// the installed metadata.cross_add map {target_stat: [source_stats]}: stats
// whose bucket totals ADD into the target's total ACROSS buckets (the wiki's
// fully-stacking universal sources — Universal Spell Power, the two universal
// lores). Distinct from the spell_focus expansion, which reproduces a
// DON'T-stack rule inside the same-type max bucket. This unit is plumbing
// only — nothing here credits the solver; that is a later unit.
test("U1: crossAddSourcesFor on a fresh (uninstalled) model returns [] without crashing", () => {
  // #300 — the state lives in cross-add.js (model.js re-exports it), so a truly
  // fresh uninstalled instance requires evicting BOTH modules: evicting model.js
  // alone would re-require the cached cross-add.js, whose installed map persists.
  const key = require.resolve("../web/model.js");
  const xaKey = require.resolve("../web/cross-add.js");
  const cached = require.cache[key];
  const cachedXa = require.cache[xaKey];
  delete require.cache[key];
  delete require.cache[xaKey];
  try {
    const fresh = require("../web/model.js");
    assert.deepStrictEqual(fresh.crossAddSourcesFor("Combustion"), []);
    assert.deepStrictEqual(fresh.crossAddSourcesFor(undefined), []);
  } finally {
    require.cache[key] = cached;     // restore the shared installed instances
    require.cache[xaKey] = cachedXa;
  }
});

test("U1: setCrossAdd installs the map; unmapped stats and uninstall stay []", () => {
  try {
    M.setCrossAdd({ Combustion: ["Universal Spell Power"] });
    assert.deepStrictEqual(M.crossAddSourcesFor("Combustion"), ["Universal Spell Power"]);
    assert.deepStrictEqual(M.crossAddSourcesFor("Strength"), []);
    M.setCrossAdd(null); // uninstall resets to empty rather than crashing
    assert.deepStrictEqual(M.crossAddSourcesFor("Combustion"), []);
  } finally {
    M.setCrossAdd(data._crossAdd); // restore the real catalog's map
  }
});

test("U1: the built catalog's cross_add reaches model.js through normalizeDataset", () => {
  assert.deepStrictEqual(M.crossAddSourcesFor("Combustion"), ["Universal Spell Power"]);
  // #366 — see tests/dataset.test.js: `Spell Lore` expands now, it does not add.
  assert.deepStrictEqual(M.crossAddSourcesFor("Fire Lore"), ["Universal Spell Lore"]);
});

// U2 (#290/#291) — dominance widening. buildModel unions each tracked stat's
// cross-add SOURCE stats into targetSet, so a universal-only item stays
// competitive through the Pareto pre-filter when only an element stat is
// ranked. The widened SET is the whole lever: the shared dominance comparator
// (dominates/variantBuckets) is untouched — with the sources in targetSet, the
// USP item's own buckets are compared like any other stat's.
test("U2: a USP-only item survives model pruning when only an element stat is ranked", () => {
  try {
    M.setCrossAdd({ Combustion: ["Universal Spell Power"] });
    const elem = v("Elem", "Necklace", [["Combustion", "Equipment", 100]]);
    const usp = v("USPOnly", "Necklace", [["Universal Spell Power", "Implement", 50]]);
    const model = M.buildModel([elem, usp], { mlCap: 34, targets: ["Combustion"] });
    const neck = model.worn.find((s) => s.slot === "Necklace");
    assert.ok(neck, "the Necklace pool exists");
    assert.deepStrictEqual(neck.variants.map((x) => x.variant_id).sort(), ["Elem", "USPOnly"],
      "the USP-only item is NOT pruned: its source-stat buckets are now in targetSet");

    // Control — with the map uninstalled, the element item dominates the
    // bucket-less USP item exactly as before the change (the widening is the lever).
    M.setCrossAdd({});
    const model2 = M.buildModel([elem, usp], { mlCap: 34, targets: ["Combustion"] });
    const neck2 = model2.worn.find((s) => s.slot === "Necklace");
    assert.deepStrictEqual(neck2.variants.map((x) => x.variant_id), ["Elem"],
      "uninstalled: the USP-only item is dominated away, byte-identical to the old pre-filter");
  } finally {
    M.setCrossAdd(data._crossAdd); // restore the real catalog's map
  }
});

// #91 (code review fix) — utilityCountingSet is a defaulted 11th positional
// param. A forgotten call site would previously widen nothing and solve with
// zero indicators, silently — no error anywhere in the pipeline. buildModel
// must fail fast instead when the sentinel is ranked and the counting set was
// never threaded, naming the missing argument (web/query.js is the reference
// site: it threads it from `vocab.utilityCounting`, the dataset metadata).
test("#91: sentinel ranked + no counting set throws, naming the missing argument", () => {
  const A = v("A", "Ring", [["Intelligence", "Enhancement", 10]]);
  assert.throws(
    () => M.buildModel([A], { mlCap: 34, targets: ["Intelligence", M.UTILITY_SENTINEL] }),
    /utilityCountingSet/,
    "the error must name the missing argument"
  );
  assert.throws(
    () => M.buildModel([A], { mlCap: 34, targets: ["Intelligence", M.UTILITY_SENTINEL] }),
    /web\/query\.js/,
    "the error must cite the reference call site"
  );
});

test("#91: sentinel ranked + counting set null explicitly ALSO throws", () => {
  const A = v("A", "Ring", [["Intelligence", "Enhancement", 10]]);
  assert.throws(
    () => M.buildModel([A], { mlCap: 34, targets: [M.UTILITY_SENTINEL] },
      [], [], [], [], {}, [], [], {}, null),
    /utilityCountingSet/
  );
});

test("#91: sentinel absent + no counting set stays fine (pre-feature calls unaffected)", () => {
  const A = v("A", "Ring", [["Intelligence", "Enhancement", 10]]);
  assert.doesNotThrow(() => M.buildModel([A], { mlCap: 34, targets: ["Intelligence"] }));
});

test("#91: sentinel ranked + a real (even empty) counting set does not throw", () => {
  const A = v("A", "Ring", [["Intelligence", "Enhancement", 10]]);
  assert.doesNotThrow(() => M.buildModel([A], { mlCap: 34, targets: ["Intelligence", M.UTILITY_SENTINEL] },
    [], [], [], [], {}, [], [], {}, new Set()));
});

// ---------------------------------------------------------------------------
// #369 — a pin overrides the Artifact opt-in.
//
// Reported as "why does it sometimes ignore my pins?". Pinning an Artifact with
// the box unchecked dropped the pin SILENTLY: the eligibility gate removed the
// variant before it reached the pool, so its pick var never existed and
// slotConstraintBodies' documented "a pinned id absent from the pool is a silent
// no-op" swallowed the constraint. reconcilePinLegality did not catch it either
// (it consults weapon/armor/slot legality, which knows nothing about this
// opt-in). Reproduced on real data: pinning Baphomet's Reign left the Ring slot
// EMPTY and dropped its Conditioning 15 -> 0.
// ---------------------------------------------------------------------------

test("#369: a pinned Artifact survives eligibility with the opt-in OFF", () => {
  const A = v("Plain", "Ring", [["Intelligence", "Enhancement", 9]]);
  const B = art("Arti", "Ring", [["Intelligence", "Enhancement", 5]]);
  const query = {
    mlCap: 34, targets: ["Intelligence"], includeArtifact: false,
    slotConstraints: { Ring: { type: "pin", variant_id: "Arti" } },
  };
  const ring = M.buildModel([A, B], query).worn.find((s) => s.slot === "Ring");
  const kept = ring.variants.map((x) => x.source_item).sort();
  assert.deepStrictEqual(kept, ["Arti", "Plain"],
    "the pinned Artifact must reach the pool, or the `= 1` constraint has no var to bind");
});

test("#369: with no pin, the opt-in still excludes the Artifact", () => {
  // The control. Without this the test above could pass because the gate broke
  // entirely rather than because the exemption is scoped to pins.
  const A = v("Plain", "Ring", [["Intelligence", "Enhancement", 9]]);
  const B = art("Arti", "Ring", [["Intelligence", "Enhancement", 5]]);
  const ring = M.buildModel([A, B], { mlCap: 34, targets: ["Intelligence"], includeArtifact: false })
    .worn.find((s) => s.slot === "Ring");
  assert.deepStrictEqual(ring.variants.map((x) => x.source_item), ["Plain"],
    "an unpinned Artifact stays excluded when the box is off");
});

test("#369: the exemption is per-variant — an UNPINNED Artifact stays excluded", () => {
  // The pin exempts itself, never the whole gate. Without this a pin anywhere
  // would quietly turn the opt-in off for every Artifact in the build.
  const pinned = art("PinnedArt", "Ring", [["Intelligence", "Enhancement", 5]]);
  const other = art("OtherArt", "Necklace", [["Intelligence", "Enhancement", 50]]);
  const query = {
    mlCap: 34, targets: ["Intelligence"], includeArtifact: false,
    slotConstraints: { Ring: { type: "pin", variant_id: "PinnedArt" } },
  };
  const model = M.buildModel([pinned, other], query);
  const ring = model.worn.find((s) => s.slot === "Ring");
  const neck = model.worn.find((s) => s.slot === "Necklace");
  assert.ok(ring && ring.variants.some((x) => x.source_item === "PinnedArt"), "the pinned one is in");
  assert.ok(!neck || !neck.variants.some((x) => x.source_item === "OtherArt"),
    "the unpinned Artifact is still excluded — a pin exempts itself, not the gate");
});

// ---------------------------------------------------------------------------
// #335 U1 — duplicate-ring twinning, gated to a WIKI-CONFIRMED allowlist.
//
// Duplicate-wearability is a per-item property (DDO's Unique Equipped) and the
// dataset does not carry it: `restrictions` is the literal string "unknown" on
// 426 of 427 rings and no ring carries the flag. Gating on set membership would
// infer a legality claim from a set-bonus counting rule — see #442 for the
// harvest that would widen this.
// ---------------------------------------------------------------------------

test("#335 U1: twin eligibility is allowlist-gated, not membership-gated", () => {
  const allow = [...M.DUPLICABLE_RINGS][0];
  assert.ok(allow, "the allowlist names at least the reported ring");
  const onList = { variant_id: allow, slot: "Ring", set_bonus: [{ set: "S" }] };
  const offList = { variant_id: "Some Other Ring", slot: "Ring", set_bonus: [{ set: "S" }] };
  assert.strictEqual(M.isTwinEligible(onList), true, "allowlisted set-member ring is eligible");
  assert.strictEqual(M.isTwinEligible(offList), false,
    "a set member NOT on the allowlist is refused — membership is not evidence of duplicability");
});

test("#335 U1: an allowlisted ring still needs a set membership and the Ring slot", () => {
  const allow = [...M.DUPLICABLE_RINGS][0];
  assert.strictEqual(M.isTwinEligible({ variant_id: allow, slot: "Ring", set_bonus: [] }), false,
    "no set membership, nothing for a second copy to contribute");
  assert.strictEqual(M.isTwinEligible({ variant_id: allow, slot: "Neck", set_bonus: [{ set: "S" }] }), false,
    "non-Ring slots are untouched (R9)");
  assert.strictEqual(M.isTwinEligible(null), false);
});

test("#335 U1 (KTD2): the twin id round-trips back to its original", () => {
  const id = "Legendary Katra's Razor Wit";
  const twin = M.twinIdOf(id);
  assert.notStrictEqual(twin, id, "the twin is addressable separately in the model");
  assert.strictEqual(M.originalIdOf(twin), id, "and maps back for display and pins");
  assert.strictEqual(M.originalIdOf(id), id, "an ordinary id is returned unchanged");
  assert.strictEqual(M.isTwinId(twin), true);
  assert.strictEqual(M.isTwinId(id), false);
});

// --- #545: a stamped native and the untyped blank now meet in the same pool ---
//
// Before #545 only the 11 blanks and the 2 quarterstaff hosts carried Dino
// slots, so the dino clause in `dominates` almost never fired against a real
// item. With 122 natives stamped it fires constantly, and three comparisons
// that were previously unreachable become load-bearing.

function dinoWeapon(name, affixes, opts = {}) {
  const w = v(name, opts.slot || "Weapon", affixes, { category: "weapon" });
  w.type = opts.type ?? null;
  w.dino_slots_norm = opts.slots
    || ["Claw||Weapon", "Fang||Weapon", "Horn||Weapon", "Scale||Weapon"];
  return w;
}

test("#545 a stamped native dominates the untyped blank, never the reverse", () => {
  // R7. The blank's whole value is its slots; a native offering the same slot
  // multiset AND real affixes is strictly better, so pruning the blank is the
  // correct outcome rather than a loss. The reverse must stay false: an
  // affix-less host can never dominate one carrying affixes.
  const native = dinoWeapon("Attuned Bone Longsword",
    [["Strength", "Enhancement", 10]], { type: "Long Swords" });
  const blank = dinoWeapon("Dinosaur Bone Weapon", []);
  const targets = new Set(["Strength"]);
  assert.strictEqual(M.dominates(native, blank, targets, 34), true,
    "affixes + the same slot multiset dominates the affix-less blank");
  assert.strictEqual(M.dominates(blank, native, targets, 34), false,
    "the blank carries no affixes, so it can never dominate");
});

test("#545 a quarterstaff host and a base native never prune each other", () => {
  // The variant suffix #283 added to the Weapon keys is what keeps these apart.
  // Without it the two would compare as equal-slotted and the richer
  // quarterstaff insert options would vanish.
  const qs = dinoWeapon("Attuned Bone Quarterstaff",
    [["Strength", "Enhancement", 10]], { type: "Quarterstaffs" });
  const base = dinoWeapon("Attuned Bone Longsword",
    [["Strength", "Enhancement", 10]], { type: "Long Swords" });
  const targets = new Set(["Strength"]);
  assert.strictEqual(M.dominates(qs, base, targets, 34), false);
  assert.strictEqual(M.dominates(base, qs, targets, 34), false);
  assert.strictEqual(M.dominanceFilter([qs, base], targets, 34, 1).length, 2);
});

test("#545 the hand mutex still spares a one-handed native from a both-hands peer", () => {
  // R9. The untyped blank classifies as a both-hands weapon (`styleOfType` is
  // undefined for a typeless record), so it is forced off whenever an off-hand
  // is equipped. It must therefore never prune a one-handed native: once the
  // blank is off, that native may be the true best available main hand.
  const blank = dinoWeapon("Dinosaur Bone Weapon",
    [["Strength", "Enhancement", 20]]);
  const oneHanded = dinoWeapon("Attuned Bone Longsword",
    [["Strength", "Enhancement", 10]], { type: "Long Swords" });
  const targets = new Set(["Strength"]);
  assert.strictEqual(M.isBothHandsWeapon(blank), true,
    "an untyped Dino weapon host occupies both hands");
  assert.strictEqual(M.isBothHandsWeapon(oneHanded), false);
  const withMutex = M.dominanceFilter(
    [blank, oneHanded], targets, 34, 1, null, false, true);
  assert.strictEqual(withMutex.length, 2,
    "under the hand mutex the one-handed native survives the stronger blank");
});

test("#545 stamped natives with equal slots resolve on buckets alone", () => {
  const strong = dinoWeapon("Strong", [["Strength", "Enhancement", 20]], { type: "Long Swords" });
  const weak = dinoWeapon("Weak", [["Strength", "Enhancement", 5]], { type: "Long Swords" });
  const targets = new Set(["Strength"]);
  assert.strictEqual(M.dominates(strong, weak, targets, 34), true);
  assert.strictEqual(M.dominates(weak, strong, targets, 34), false);
});

test("#545 a native offering FEWER dino slots is not dominated on buckets alone", () => {
  // The 12 named Legendary weapons carry one pool where the Bone weapons carry
  // four. A four-slot host must not prune a one-slot host it does not beat on
  // buckets — and a one-slot host must never prune a four-slot one.
  const four = dinoWeapon("Attuned Bone Longsword",
    [["Strength", "Enhancement", 5]], { type: "Long Swords" });
  const one = dinoWeapon("Legendary Firesplitter",
    [["Strength", "Enhancement", 20]], { type: "Long Swords", slots: ["Scale||Weapon"] });
  const targets = new Set(["Strength"]);
  assert.strictEqual(M.dominates(one, four, targets, 34), false,
    "one slot cannot cover four, whatever the buckets say");
  assert.strictEqual(M.dominates(four, one, targets, 34), false,
    "four slots do not help when the buckets are worse");
  assert.strictEqual(M.dominanceFilter([four, one], targets, 34, 1).length, 2);
});

test("#545 the shipped catalog carries the stamped natives into the weapon pool", () => {
  // The two shapes really do meet: the blank sits at slot `Main Hand` and the
  // natives at slot `Weapon`, but the main-hand pool is assembled by
  // `category === "weapon"`, so both land in one dominance pool. Reading the
  // slot mismatch as "they never compare" is the trap.
  const carriers = data.items.filter((x) => (x.dino_slots_norm || []).length);
  assert.strictEqual(carriers.length, 135, "11 blanks + 2 #283 hosts + 122 natives");
  const weaponCarriers = carriers.filter((x) => x.category === "weapon");
  assert.strictEqual(weaponCarriers.length, 93,
    "90 stamped native weapons + the 2 #283 quarterstaff hosts + the untyped blank");
  const blank = weaponCarriers.find((x) => x.variant_id === "Dinosaur Bone Weapon");
  assert.ok(blank, "the untyped blank still ships");
  assert.strictEqual(blank.slot, "Main Hand");
  assert.ok(weaponCarriers.some((x) => x.slot === "Weapon" && x.affixes.length),
    "stamped natives carry affixes and sit at slot Weapon");
});

test("#545 every weapon type now has a stamped native at the blank's own ML", () => {
  // The OQ1 finding, pinned. The untyped blank exists to answer "I have not
  // picked a weapon type yet" — it passes every main-hand lock because it has no
  // type. After #545 all 40 weapon types carry a stamped Dino native, and every
  // one of those natives sits at ML 31, the blank's own ML.
  //
  // So for the two gates the blank's type-agnosticism was meant to clear — the
  // weapon-type lock and the ML cap — it is never the unique carrier of Dino
  // capacity. It is retained deliberately (the plan's KTD1), and this test is
  // the evidence behind the follow-up asking whether it still earns its place.
  // The claim is bounded to those two gates on purpose: other eligibility gates
  // are not measured here, so this must not be read as "never unique".
  const cov = data.metadata.dino_coverage;
  const names = new Set(cov.native_host_names);
  const natives = data.items.filter(
    (x) => names.has(x.source_item) && x.category === "weapon");
  const blank = data.items.find((x) => x.variant_id === "Dinosaur Bone Weapon");
  assert.ok(blank && !blank.type, "the untyped blank still ships, still untyped");

  const allTypes = new Set(
    data.items.filter((x) => x.category === "weapon" && x.type).map((x) => x.type));
  const covered = new Set(natives.map((x) => x.type));
  assert.strictEqual(allTypes.size, 40);
  const uncovered = [...allTypes].filter((t) => !covered.has(t));
  assert.deepStrictEqual(uncovered, [], "every weapon type has a stamped Dino native");
  assert.ok(natives.every((x) => x.minimum_level <= blank.minimum_level),
    "no type's Dino native costs more ML than the blank");
});

// ---------------------------------------------------------------------------
// #539 — the set pin. Classified in the MODEL, before the program is built, so a
// pin the pool cannot satisfy is named rather than arriving as a bare INFEASIBLE.

const _augDefs = { "Cruel Cut": { tiers: [{ pieces_required: 3, affixes: [{ stat: "Z" }] }] } };
const _memDefs = { "Dread Stalker": { tiers: [{ pieces_required: 3, affixes: [{ stat: "Z" }] }] } };
const _gear = (slot) => ({ slot, set_bonus: [{ set: "Gear Set" }],
  parsed_set_bonuses: [{ set: "Gear Set", pieces_required: 2, affixes: [{ stat: "Z" }] }] });
const _classify = (q, elig) => M.classifySetPins(q, elig || [], _augDefs, _memDefs);

test("#539: no pins classifies to nothing, and never invents a report", () => {
  assert.deepStrictEqual(_classify({}), { pinned: [], report: [] });
  assert.deepStrictEqual(_classify({ pinnedSets: [] }), { pinned: [], report: [] });
});

test("#539: a set this dataset does not define is suppressed, not silently kept", () => {
  const r = _classify({ pinnedSets: ["No Such Set"] });
  assert.deepStrictEqual(r.pinned, []);
  assert.strictEqual(r.report[0].verdict, "unknown");
  assert.ok(r.report[0].why, "a suppressed pin always states why");
});

test("#539: an unowned Set Augment is suppressed, never implicitly widened", () => {
  // Widening would assume the player owns an augment they said nothing about,
  // which is exactly what the ownership picker exists to avoid.
  const off = _classify({ pinnedSets: ["Cruel Cut"] });
  assert.deepStrictEqual(off.pinned, []);
  assert.strictEqual(off.report[0].verdict, "not-owned");

  const on = _classify({ pinnedSets: ["Cruel Cut"], ownedSetAugments: new Set(["Cruel Cut"]) });
  assert.deepStrictEqual(on.pinned, ["Cruel Cut"]);
  assert.strictEqual(on.report[0].pieces_required, 3);
});

test("#539: ownership is read from a Set or an Array, like every other consumer", () => {
  const asArray = _classify({ pinnedSets: ["Cruel Cut"], ownedSetAugments: ["Cruel Cut"] });
  assert.deepStrictEqual(asArray.pinned, ["Cruel Cut"]);
});

test("#539: an intrinsic set needs enough distinct slots to carry its pieces", () => {
  // One slot cannot supply a 2-piece set, however many carriers sit in it.
  const thin = _classify({ pinnedSets: ["Gear Set"] }, [_gear("Ring"), _gear("Ring")]);
  assert.deepStrictEqual(thin.pinned, []);
  assert.strictEqual(thin.report[0].verdict, "unreachable");
  assert.strictEqual(thin.report[0].available, 1);
  assert.strictEqual(thin.report[0].pieces_required, 2);

  const wide = _classify({ pinnedSets: ["Gear Set"] }, [_gear("Ring"), _gear("Neck")]);
  assert.deepStrictEqual(wide.pinned, ["Gear Set"]);
});

test("#539: a craft-supplied set is not judged by worn-slot supply", () => {
  // A membership or augment set's pieces come from crafting slots, so counting
  // distinct worn carriers would wrongly call every one of them unreachable.
  const r = _classify({ pinnedSets: ["Dread Stalker"] }, []);
  assert.deepStrictEqual(r.pinned, ["Dread Stalker"]);
});

test("#539: a repeated pin is classified once", () => {
  const r = _classify({ pinnedSets: ["Dread Stalker", "Dread Stalker"] }, []);
  assert.deepStrictEqual(r.pinned, ["Dread Stalker"]);
  assert.strictEqual(r.report.length, 1);
});

test("#539: the model carries the pins and the report to the solver", () => {
  const A = v("Ring A", "Ring", [["Intelligence", "Enhancement", 5]]);
  const m = M.buildModel([A], { mlCap: 34, targets: ["Intelligence"], pinnedSets: ["Nope"] });
  assert.deepStrictEqual(m.pinnedSets, [], "an unknown set never reaches the solver");
  assert.strictEqual(m.setPinReport[0].verdict, "unknown", "but it IS reported");
});

// ---------------------------------------------------------------------------
// #442 — the twin gate reads a build-stamped field instead of a hard-coded name.
// FAIL-CLOSED in every branch: the two errors are not symmetric, because wrongly
// allowing a duplicate hands the player a loadout they cannot equip.

const _dupRing = (name, over) => Object.assign(
  { source_item: name, variant_id: name, slot: "Ring", set_bonus: [{ set: "S" }] }, over || {});

test("#442: a build-stamped ring is twin-eligible whatever its name", () => {
  assert.strictEqual(M.isTwinEligible(_dupRing("Any Ring", { duplicable_ring: true })), true);
});

test("#442: an unstamped ring falls back to the two confirmed names, and no further", () => {
  // The fallback exists for callers holding a bare variant — a hand-built fixture
  // or a legacy saved snapshot — not as a second place to add names.
  assert.strictEqual(M.isTwinEligible(_dupRing("Legendary Katra's Razor Wit")), true);
  assert.strictEqual(M.isTwinEligible(_dupRing("Legendary Katra's Wit")), true,
    "#442 widened the confirmed pair; the harvest found no third");
  assert.strictEqual(M.isTwinEligible(_dupRing("Some Other Ring")), false);
});

test("#442: the heroic Katra rings are refused, because the wiki is silent on them", () => {
  // Inferring from an absence in the PERMISSIVE direction is the error that
  // produces an unequippable answer.
  assert.strictEqual(M.isTwinEligible(_dupRing("Katra's Wit")), false);
  assert.strictEqual(M.isTwinEligible(_dupRing("Katra's Razor Wit")), false);
});

test("#442: the stamp never overrides the slot and set preconditions", () => {
  assert.strictEqual(M.isTwinEligible(
    { source_item: "X", slot: "Belt", set_bonus: [{ set: "S" }], duplicable_ring: true }), false,
    "the duplicate-wear rule is specific to the two-Ring slot");
  assert.strictEqual(M.isTwinEligible(
    { source_item: "X", slot: "Ring", set_bonus: [], duplicable_ring: true }), false,
    "a second copy of a set-less ring buys nothing — duplicate affixes take a max");
});

test("#442: only boolean true grants it, never a truthy value", () => {
  for (const v of ["yes", 1, {}, "true"]) {
    assert.strictEqual(M.isTwinEligible(_dupRing("Any Ring", { duplicable_ring: v })), false,
      `duplicable_ring=${JSON.stringify(v)} must not pass — the field is harvested, not inferred`);
  }
  assert.strictEqual(M.isTwinEligible(_dupRing("Any Ring", { duplicable_ring: false })), false);
});
