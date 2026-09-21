// #851 — the override × filter matrix.
//
// A player states an intent (a pin, a block, a floor, a cap, a declared credit,
// a custom item, a set pin, an augment pin) and a pool filter added at a
// different layer removes the entity the intent names. A constraint naming an
// absent entity is a no-op rather than an error, so the failure is silent every
// time: #108, #339, #369, #547, #721, #742 — six fixes, each at one layer. The
// design note (`docs/solutions/design-patterns/an-override-exemption-only-covers-
// the-gates-downstream-of-it.md`) states the rule; this file enforces it.
//
// ONE TABLE, ONE RULING PER CELL, RED WHEN A CELL HAS NO RULE.
//
//   honored — the entity stays in; the filter yields to the intent, with a
//             disclosure where the filter would otherwise have excluded it.
//   refused — the intent is rejected with a reason: at the point it is
//             expressed (the pin advisory, a disabled control) or by the solve
//             (a report the notices carry). Never in silence.
//   n/a     — the pair cannot meet, and the cell says why, so it is not
//             mistaken for unexamined.
//
// COMPLETENESS IS ENUMERATED FROM THE CODE, NOT FROM THIS FILE:
//   * every key `buildQuery` writes, every key the solve path adds to the query
//     and every persisted INPUT_KEY must be classified override / filter / other;
//   * every reason string `variantConflict` can return must map to a column;
//   * every override row × every filter column must hold a ruling, and every
//     honored / refused ruling must carry an assertion that runs here.
// A new filter key, a new gate reason, or a new override with no cell goes red.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const M = require("../web/model.js");
const W = require("../web/wizard.js");
const P = require("../web/projection.js");
const { INPUT_KEYS } = require("../web/persist.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  PASS", name); }
  catch (e) { console.log("  FAIL", name, "\n   ", e.message); failed++; process.exitCode = 1; }
}
process.on("exit", () => { console.log(`\n${passed} passed, ${failed} failed`); });

const SRC = (f) => fs.readFileSync(path.join(__dirname, "..", "web", f), "utf-8");
const WIZ = SRC("wizard.js"), MOD = SRC("model.js"), CUSTOM = SRC("custom-items.js");
const ITEMS = path.join(__dirname, "..", "web", "data", "items.json");
const DATA = fs.existsSync(ITEMS) ? JSON.parse(fs.readFileSync(ITEMS, "utf-8")) : null;

// ---------------------------------------------------------------------------
// 1. Every query / input key is classified. `filter` keys become columns (via
//    COLUMN_OF), `override` keys become rows (via ROW_OF), `other` keys are
//    neither a candidate filter nor a player override and say why.
// ---------------------------------------------------------------------------
const CLASSIFY = {
  // ---- filters: each removes or admits a candidate before or during the model
  mlCap: "filter", ml: "filter", mlFloor: "filter", mlFloorManual: "other",
  augCeiling: "filter", includeArtifact: "filter", craftingRung: "filter",
  excludeCraftingSystems: "other",           // legacy read-only key, folded into craftingRung on load
  race: "filter", alignment: "filter", armorTypes: "filter", armor: "filter", oath: "filter",
  style: "filter", weaponTypes: "filter", offHand: "filter", offHandWeapons: "filter", twoWeaponFighting: "filter",
  ownedSetAugments: "filter", ownedPacks: "filter", excludedSets: "filter",
  pool: "filter", ownedNames: "filter", ownedMode: "filter", ownedAugments: "filter",
  // ---- overrides: a player naming an entity or a number the solve must respect
  slotConstraints: "override", blocklist: "override", pinnedSets: "override", pinnedAugments: "override",
  targetFloors: "override", targetCaps: "override", declaredCredits: "override", customItems: "override",
  // ---- other: neither
  targets: "other", priorities: "other", armorType: "other",   // the disclosure's single declared armor; `armorTypes` is the gate
  pinnedUnowned: "other", ownedSlotsCovered: "other",          // derived facts for disclosures
  excludedTypes: "other", overrides: "other",                  // bonus-type skips / corrections: change credit, not candidacy
  characterName: "other", step: "other",
  priorityLinks: "other", utility_tier_aware: "other", utilityContainer: "other", utility_container_aware: "other",
};
const COLUMN_OF = {
  mlCap: "ml-cap", ml: "ml-cap", mlFloor: "ml-floor", augCeiling: "aug-ceiling", includeArtifact: "artifact",
  craftingRung: "rung", race: "race", alignment: "alignment", armorTypes: "armor-type", armor: "armor-type", oath: "oath",
  style: "weapon-style", weaponTypes: "weapon-style", offHand: "weapon-style", offHandWeapons: "weapon-style", twoWeaponFighting: "weapon-style",
  ownedSetAugments: "set-augment-gate", ownedPacks: "content", excludedSets: "excluded-sets",
  pool: "owned-pool", ownedNames: "owned-pool", ownedMode: "owned-pool", ownedAugments: "owned-augments",
};
// Gates that are not query keys: the picker's verification gate, the dominance
// prune, and the Unique Equipped rule for a second copy of one ring.
const EXTRA_COLUMNS = ["verification", "dominance", "unique-equipped"];
const ROW_OF = {
  slotConstraints: "pin", blocklist: "block", targetFloors: "floor", targetCaps: "cap",
  declaredCredits: "credit", customItems: "custom-item", pinnedSets: "set-pin", pinnedAugments: "augment-pin",
};
const COLUMNS = [...new Set([...Object.values(COLUMN_OF), ...EXTRA_COLUMNS])];
const ROWS = [...new Set(Object.values(ROW_OF))];

function queryKeysFromCode() {
  const a = WIZ.indexOf("function buildQuery(");
  assert.ok(a > 0, "buildQuery exists");
  const body = WIZ.slice(a, WIZ.indexOf("\n}\n", a));
  const keys = new Set();
  for (const m of body.matchAll(/^\s{4}([A-Za-z_]\w*)\s*[:,]/gm)) keys.add(m[1]);
  // The solve path writes three more onto the query after buildQuery returns.
  for (const m of WIZ.matchAll(/\bquery\.([A-Za-z_]\w*)\s*=[^=]/g)) keys.add(m[1]);
  return keys;
}

test("#851: every query key and every persisted input key is classified", () => {
  const keys = new Set([...queryKeysFromCode(), ...INPUT_KEYS]);
  const unclassified = [...keys].filter((k) => !CLASSIFY[k]).sort();
  assert.deepStrictEqual(unclassified, [], "classify each in CLASSIFY (override / filter / other), and give a filter its column and an override its row");
  for (const [k, c] of Object.entries(CLASSIFY)) {
    assert.ok(["override", "filter", "other"].includes(c), `${k}: ${c}`);
    if (c === "filter") assert.ok(COLUMN_OF[k], `${k} is a filter with no column`);
    if (c === "override") assert.ok(ROW_OF[k], `${k} is an override with no row`);
  }
  assert.ok(keys.size >= 30, `the enumeration saw ${keys.size} keys — the source scan broke if this is small`);
});

// ---------------------------------------------------------------------------
// 2. Every reason `variantConflict` can return maps to a column.
// ---------------------------------------------------------------------------
const REASON_TO_COLUMN = [
  [/isn't verified/, "verification"],
  [/above your ML .* cap/, "ml-cap"],
  [/below your ML .* floor/, "ml-floor"],
  [/augment ML .* ceiling/, "aug-ceiling"],
  [/without augments|without Solar\/Lunar/, "rung"],
  [/combat style|off hand with this style|off-hand type/, "weapon-style"],
  [/docent/, "race"],
  [/requires the .* race/, "race"],
  [/armor type not in your proficiency/, "armor-type"],
  [/druid/, "oath"],
  [/alignment/, "alignment"],
  [/Include an Artifact/, "artifact"],
  [/Set Augment/, "set-augment-gate"],
];
function conflictReasonsFromCode() {
  const a = MOD.indexOf("function variantConflict(");
  const body = MOD.slice(a, MOD.indexOf("\n}\n", a));
  const out = new Set();
  for (const stmt of body.matchAll(/return\s+([^;]*);/g)) {
    for (const lit of stmt[1].matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)) {
      if (/\s/.test(lit[2])) out.add(lit[2]);
    }
  }
  return out;
}

test("#851: every variantConflict reason maps to a matrix column", () => {
  const reasons = conflictReasonsFromCode();
  assert.ok(reasons.size >= 17, `saw ${reasons.size} reasons — the source scan broke if this is small`);
  const unmapped = [...reasons].filter((r) => !REASON_TO_COLUMN.some(([re]) => re.test(r)));
  assert.deepStrictEqual(unmapped, [], "a gate with no column: add it to REASON_TO_COLUMN and give it a cell in every row");
  for (const [, col] of REASON_TO_COLUMN) assert.ok(COLUMNS.includes(col), `${col} is not a column`);
});

// ---------------------------------------------------------------------------
// 3. The matrix.
// ---------------------------------------------------------------------------

const V = (o) => Object.assign({ verification: "verified", category: "item", slot: "Ring", ml: 10,
  variant_id: "X", source_item: "X", affixes: [{ name: "Strength", type: "Enhancement", value: "5" }] }, o);
const AUG = (o) => Object.assign({ verification: "verified", category: "augment", slot: "Green", ml: 10,
  variant_id: "G", source_item: "G", aug_color: { color: "Green" }, fits_slots: ["Green"],
  affixes: [{ name: "Strength", type: "Enhancement", value: "2" }] }, o);
const pinQ = (id, slot = "Ring", extra = {}) => Object.assign({ mlCap: 30, targets: ["Strength"], slotConstraints: { [slot]: { type: "pin", variant_id: id } } }, extra);
const augPinQ = (id, extra = {}) => Object.assign({ mlCap: 30, targets: ["Strength"], pinnedAugments: [id] }, extra);
const build = (items, q) => M.buildModel(items, q, [], [], [], [], {}, [], {}, null, {}, []);
const NO_CANDIDACY_READER = (key) => {
  // The candidacy chain never reads the key: it cannot re-admit or remove a candidate.
  for (const fn of ["function variantConflict(", "function filterEligiblePool(", "function dominanceFilter("]) {
    const a = MOD.indexOf(fn); const body = MOD.slice(a, MOD.indexOf("\n}\n", a));
    assert.ok(!body.includes(key), `${fn} reads ${key}`);
  }
  for (const fn of ["function candidateItems(", "function ownedPoolAdmits("]) {
    const a = WIZ.indexOf(fn); const body = WIZ.slice(a, WIZ.indexOf("\n    }\n", a) > 0 ? WIZ.indexOf("\n    }\n", a) : a + 3000);
    assert.ok(!body.includes(key), `${fn} reads ${key}`);
  }
};
const refusedByGate = (v, q, re, slot) => {
  const reason = M.variantConflict(v, q);
  assert.ok(reason && re.test(reason), `expected the gate to refuse: ${reason}`);
  assert.strictEqual(M.pinConflict(v, q), reason, "the pin advisory shows the same reason (refused at the point of expression)");
  const sc = { ...q.slotConstraints };
  const dropped = W.reconcilePinLegality(sc, () => v, q, () => 1);
  assert.deepStrictEqual(dropped, [{ slot: slot || "Ring", id: v.variant_id }], "reconcilePinLegality drops it before the model, so the pin never names an absent variant");
};

const MATRIX = {
  pin: {
    "ml-cap": { ruling: "refused", why: "an item above the cap cannot be worn; the advisory says so and the pin is dropped for the solve, never erased",
      assert: () => refusedByGate(V({ ml: 34 }), pinQ("X", "Ring", { mlCap: 30 }), /above your ML 30 cap/) },
    "ml-floor": { ruling: "honored", why: "R8 — the floor hides outleveled gear; a pin is the more specific instruction",
      assert: () => { const v = V({ ml: 5 }); assert.strictEqual(M.variantConflict(v, pinQ("X", "Ring", { mlFloor: 10 })), null);
        assert.match(M.variantConflict(v, { mlCap: 30, mlFloor: 10 }), /below your ML 10 floor/, "and the floor still bites an unpinned item"); } },
    "aug-ceiling": { ruling: "n/a", why: "the ceiling fires only on category === 'augment'; see the augment-pin row",
      assert: () => assert.strictEqual(M.variantConflict(V({ ml: 34 }), { mlCap: 36, augCeiling: 30 }), null) },
    artifact: { ruling: "honored", why: "#369 — the checkbox governs what the solver may CHOOSE; a pin is the player choosing. Disclosed as ARTIFACT PINNED IN (results.test.js #369)",
      assert: () => { const v = V({ artifact: true }); assert.strictEqual(M.variantConflict(v, pinQ("X", "Ring", { includeArtifact: false })), null);
        assert.match(M.variantConflict(v, { mlCap: 30, includeArtifact: false }), /Include an Artifact/); } },
    rung: { ruling: "n/a", why: "the rung gates augments and crafting pools; a worn item passes every rung",
      assert: () => assert.strictEqual(M.variantConflict(V(), pinQ("X", "Ring", { craftingRung: "printed-only" })), null) },
    race: { ruling: "refused", why: "R18/#740 — a race-locked item cannot be worn by another race; advisory + dropped, never silent (the cell the issue named)",
      assert: () => { refusedByGate(V({ race_req: "Warforged" }), pinQ("X", "Ring", { race: "Human" }), /requires the Warforged race/);
        refusedByGate(V({ slot: "Armor", type: "Docents" }), pinQ("X", "Armor", { race: "Human" }), /docents are for Forged/, "Armor"); } },
    alignment: { ruling: "refused", why: "an alignment-locked item; same shape as race",
      assert: () => refusedByGate(V({ alignment_req: ["Lawful Good"] }), pinQ("X", "Ring", { alignment: "Chaotic Evil" }), /alignment/) },
    "armor-type": { ruling: "refused", why: "R7 — body armor outside the proficiency set; same shape as race",
      assert: () => refusedByGate(V({ slot: "Armor", armor_type: "heavy" }), pinQ("X", "Armor", { armorTypes: ["cloth"] }), /armor type not in your proficiency/, "Armor") },
    oath: { ruling: "refused", why: "#162 — a druid cannot wear metal; same shape as race",
      assert: () => refusedByGate(V({ slot: "Armor", material_class: "metal" }), pinQ("X", "Armor", { oath: "druid" }), /druidic oath forbids metal armor/, "Armor") },
    "weapon-style": { ruling: "refused", why: "an off-hand weapon pin without Two Weapon Fighting is refused by the slot-aware layer; a pinned SHIELD on a declared build is the documented escape hatch and is honored",
      assert: () => { const w = V({ category: "weapon", slot: "Weapon", type: "Long Swords" });
        assert.match(M.pinSlotConflict(w, "Off Hand", { mlCap: 30 }), /hasn't declared Two Weapon Fighting/);
        const shield = V({ slot: "Off Hand", type: "Small Shields" });
        assert.strictEqual(M.pinSlotConflict(shield, "Off Hand", { mlCap: 30, twoWeaponFighting: true, style: "one-hand" }), null, "the shield escape hatch"); } },
    "set-augment-gate": { ruling: "n/a", why: "the gate fires on set_augment inserts only; see the augment-pin row",
      assert: () => assert.strictEqual(M.variantConflict(V(), pinQ("X", "Ring", { ownedSetAugments: new Set() })), null) },
    content: { ruling: "honored", why: "#851 — the pin overrides the unticked pack (the player could buy it tomorrow), disclosed as PINNED THROUGH A FILTER",
      assert: () => { const A = V({ location_pack: "Foo Pack" }); const m = build([A], pinQ("X", "Ring", { ownedPacks: ["Bar"] }));
        assert.deepStrictEqual(m.packExcluded.map((x) => x.variant_id), [], "not excluded");
        assert.deepStrictEqual(m.pinnedThrough, [{ variant_id: "X", name: "X", filter: "content-not-owned", detail: "Foo Pack" }]);
        assert.match(P.pinnedThroughNoticeLines({ pinnedThrough: m.pinnedThrough })[0], /X was kept because you pinned it, although its pack \(Foo Pack\)/);
        const m2 = build([A], { mlCap: 30, targets: ["Strength"], ownedPacks: ["Bar"] });
        assert.deepStrictEqual(m2.packExcluded.map((x) => x.variant_id), ["X"], "and the filter still bites an unpinned item"); } },
    "excluded-sets": { ruling: "honored", why: "#851 — the pin names an item, the exclusion names a set; the more specific wins, disclosed as PINNED THROUGH A FILTER",
      assert: () => { const S = V({ set_bonus: [{ set: "Zed Set" }] }); const m = build([S], pinQ("X", "Ring", { excludedSets: ["Zed Set"] }));
        assert.deepStrictEqual(m.setExcluded.map((x) => x.variant_id), []);
        assert.deepStrictEqual(m.pinnedThrough, [{ variant_id: "X", name: "X", filter: "excluded-set", detail: "Zed Set" }]);
        assert.match(P.pinnedThroughNoticeLines({ pinnedThrough: m.pinnedThrough })[0], /although you excluded its set \(Zed Set\)/);
        const m2 = build([S], { mlCap: 30, targets: ["Strength"], excludedSets: ["Zed Set"] });
        assert.deepStrictEqual(m2.setExcluded.map((x) => x.variant_id), ["X"]); } },
    "owned-pool": { ruling: "honored", why: "#721 — a pinned unowned item stays, disclosed as PINNED, NOT OWNED",
      assert: () => { const v = V(); const owns = () => false; assert.strictEqual(W.ownedPoolAdmits(v, owns, new Set(["X"]), false), true);
        assert.strictEqual(W.ownedPoolAdmits(v, owns, new Set(), false), false);
        assert.deepStrictEqual(W.pinnedUnownedNames("owned", new Set(["Other"]), { Ring: { type: "pin", variant_id: "X" } }, [v], owns), ["X"]); } },
    "owned-augments": { ruling: "n/a", why: "the owned-augments filter admits augments only; a worn pin never meets it",
      assert: () => assert.strictEqual(W.ownedPoolAdmits(V(), () => true, new Set(), true), true) },
    verification: { ruling: "n/a", why: "the picker offers only verified items (KTD3), so a pin cannot name an unverified one; the gate is kept for eligible() parity",
      assert: () => assert.match(M.variantConflict(V({ verification: "unverified" }), pinQ("X")), /isn't verified/) },
    dominance: { ruling: "honored", why: "a pinned variant survives the pre-filter even when a peer dominates it, or its pick var would not exist for the = 1 constraint",
      assert: () => { const A = V({ variant_id: "A", source_item: "A", affixes: [{ name: "Strength", type: "Enhancement", value: "2" }] });
        const B = V({ variant_id: "B", source_item: "B" });
        const kept = M.dominanceFilter([A, B], new Set(["Strength"]), 30, 1, new Set(["A"])).map((x) => x.variant_id).sort();
        assert.deepStrictEqual(kept, ["A", "B"], "A is dominated by B and survives on the pin");
        assert.deepStrictEqual(M.dominanceFilter([A, B], new Set(["Strength"]), 30, 1, null).map((x) => x.variant_id), ["B"], "and is pruned unpinned"); } },
    "unique-equipped": { ruling: "refused", why: "#335/#442 — a second copy of one ring exists only for the wiki-confirmed duplicable rings; every other ring is fail-closed, so a doubled pin has no twin to bind",
      assert: () => { assert.strictEqual(M.isTwinEligible(V({ slot: "Ring", set_bonus: [{ set: "S" }] })), false);
        assert.strictEqual(M.isTwinEligible(V({ slot: "Ring", set_bonus: [{ set: "S" }], variant_id: "Legendary Katra's Wit", source_item: "Legendary Katra's Wit" })), true); } },
  },
  block: {},          // filled below: every column n/a — a block and a filter both exclude
  floor: {},          // filled below: the filter wins and FLOOR NOT REACHED discloses
  cap: {},            // filled below: a cap clamps credit and never touches candidacy
  credit: {},         // filled below: a declared credit is a slot-agnostic contribution, not a candidate
  "custom-item": {
    "ml-cap": { ruling: "refused", why: "a player-authored item above the cap is excluded like any item; its ML is the player's own number",
      assert: () => assert.match(M.variantConflict(V({ player_authored: true, ml: 34 }), { mlCap: 30 }), /above your ML 30 cap/) },
    "ml-floor": { ruling: "refused", why: "same as the cap — unless pinned, which the pin row covers",
      assert: () => assert.match(M.variantConflict(V({ player_authored: true, ml: 5 }), { mlCap: 30, mlFloor: 10 }), /below your ML 10 floor/) },
    "aug-ceiling": { ruling: "n/a", why: "a custom item is worn gear, never an augment", assert: () => assert.ok(!/category: "augment"/.test(CUSTOM)) },
    artifact: { ruling: "n/a", why: "a custom item carries no artifact flag", assert: () => assert.ok(!/artifact: true/.test(CUSTOM)) },
    rung: { ruling: "n/a", why: "the rung gates augments and crafting pools", assert: () => assert.strictEqual(M.variantConflict(V({ player_authored: true }), { mlCap: 30, craftingRung: "printed-only" }), null) },
    race: { ruling: "n/a", why: "a custom item carries no race_req; the gate fails open", assert: () => assert.ok(!/race_req/.test(CUSTOM)) },
    alignment: { ruling: "n/a", why: "no alignment_req; fails open", assert: () => assert.ok(!/alignment_req/.test(CUSTOM)) },
    "armor-type": { ruling: "n/a", why: "custom armor is stamped armor_type: null and the proficiency gate fails open on it", assert: () => assert.ok(/armor_type: null/.test(CUSTOM)) },
    oath: { ruling: "n/a", why: "no material_class; the druid gate fails open", assert: () => assert.ok(!/material_class/.test(CUSTOM)) },
    "weapon-style": { ruling: "refused", why: "a custom weapon outside the declared style is excluded like any weapon",
      assert: () => assert.match(M.variantConflict(V({ player_authored: true, category: "weapon", slot: "Weapon", type: "Long Swords" }), { mlCap: 30, style: "bow", weaponTypes: ["Long Bows"] }), /combat style/) },
    "set-augment-gate": { ruling: "n/a", why: "a custom item is worn gear, never a Set Augment insert", assert: () => assert.ok(!/set_augment/.test(CUSTOM)) },
    content: { ruling: "n/a", why: "a custom item is stamped location_pack: null; the content filter keeps it and counts it as uncheckable", assert: () => assert.ok(/location_pack: null/.test(CUSTOM)) },
    "excluded-sets": { ruling: "n/a", why: "a custom item carries no set", assert: () => assert.ok(!/set_bonus:\s*\[[^\]]/.test(CUSTOM)) },
    "owned-pool": { ruling: "honored", why: "#773 — appended AFTER the owned filter: an item the player typed in is owned by construction",
      assert: () => { const a = WIZ.indexOf("function candidateItems("); const body = WIZ.slice(a, a + 3000);
        assert.ok(body.indexOf("ownedPoolAdmits(") < body.indexOf(".concat(customVariants())"), "customVariants are concatenated after the owned filter"); } },
    "owned-augments": { ruling: "n/a", why: "worn gear, never an augment", assert: () => assert.ok(!/category: "augment"/.test(CUSTOM)) },
    verification: { ruling: "honored", why: "stamped 'verified' so the gate passes; player_authored is the separate, honest marker and the result discloses it",
      assert: () => assert.ok(/verification: "verified"/.test(CUSTOM) && /player_authored: true/.test(CUSTOM)) },
    dominance: { ruling: "n/a", why: "a custom item competes like any candidate; being pruned as dominated is the model working, not an override lost", assert: () => {} },
    "unique-equipped": { ruling: "n/a", why: "a custom ring carries no set, so it is never twin-eligible", assert: () => assert.strictEqual(M.isTwinEligible(V({ player_authored: true, slot: "Ring" })), false) },
  },
  "set-pin": {},      // filled below
  "augment-pin": {
    "ml-cap": { ruling: "refused", why: "an augment above the cap cannot be slotted; #851 reports it as PINNED AUGMENT NOT PLACED instead of dropping it in silence",
      assert: () => { const g = AUG({ ml: 34 }); const m = build([V(), g], augPinQ("G", { mlCap: 30 }));
        assert.deepStrictEqual(m.augPinExcluded, [{ variant_id: "G", color: "Green", reason: "above your ML 30 cap" }]);
        assert.match(P.augPinNoticeLines({ augPinReport: m.augPinExcluded })[0], /G is pinned but was not placed: above your ML 30 cap/); } },
    "ml-floor": { ruling: "n/a", why: "augments are exempt from the floor outright: a low-ML augment is still slottable",
      assert: () => assert.strictEqual(M.variantConflict(AUG({ ml: 5 }), { mlCap: 30, mlFloor: 10 }), null) },
    "aug-ceiling": { ruling: "honored", why: "#742 gate 1 — the pin joins pinnedIds and the ceiling exemption written for this day switches on",
      assert: () => { const g = AUG({ ml: 36 }); assert.strictEqual(M.variantConflict(g, augPinQ("G", { mlCap: 36, augCeiling: 32 })), null);
        assert.match(M.variantConflict(g, { mlCap: 36, augCeiling: 32 }), /ceiling/); } },
    artifact: { ruling: "n/a", why: "augments carry no artifact flag", assert: () => assert.strictEqual(M.variantConflict(AUG({ artifact: true }), augPinQ("G", { includeArtifact: false })), null) },
    rung: { ruling: "refused", why: "deliberately not pin-exempt — the rung says 'no augments at all', which a pin cannot contradict; #851 reports it instead of dropping it in silence",
      assert: () => { const g = AUG(); const m = build([V(), g], augPinQ("G", { craftingRung: "printed-only" }));
        assert.deepStrictEqual(m.augPinExcluded.map((e) => [e.variant_id, e.reason]), [["G", "excluded — you chose to solve without augments"]]);
        const sun = AUG({ aug_color: { color: "Sun" }, slot: "Sun", fits_slots: ["Sun"] });
        assert.match(build([V(), sun], augPinQ("G", { craftingRung: "no-solar-lunar" })).augPinExcluded[0].reason, /Solar\/Lunar/); } },
    race: { ruling: "n/a", why: "augments carry no race_req", assert: () => assert.strictEqual(M.variantConflict(AUG(), augPinQ("G", { race: "Human" })), null) },
    alignment: { ruling: "n/a", why: "augments carry no alignment_req", assert: () => assert.strictEqual(M.variantConflict(AUG(), augPinQ("G", { alignment: "Chaotic Evil" })), null) },
    "armor-type": { ruling: "n/a", why: "the gate fires on slot === Armor", assert: () => assert.strictEqual(M.variantConflict(AUG(), augPinQ("G", { armorTypes: ["cloth"] })), null) },
    oath: { ruling: "n/a", why: "the druid gate reads Armor and Off Hand slots", assert: () => assert.strictEqual(M.variantConflict(AUG(), augPinQ("G", { oath: "druid" })), null) },
    "weapon-style": { ruling: "n/a", why: "not a weapon and not an off-hand item", assert: () => assert.strictEqual(M.variantConflict(AUG(), augPinQ("G", { style: "two-hand" })), null) },
    "set-augment-gate": { ruling: "refused", why: "a Set Augment the player has not ticked as owned; not pin-exempt (the pin would silently assume ownership), and #851 reports it",
      assert: () => { const g = AUG({ set_augment: true, set: "Some Set" }); const m = build([V(), g], augPinQ("G", { ownedSetAugments: new Set() }));
        assert.match(m.augPinExcluded[0].reason, /mark this Set Augment as available/); } },
    content: { ruling: "n/a", why: "no augment in the catalog carries a named location_pack (measured 0 of 1,147), so the content filter never meets one",
      assert: () => { if (!DATA) return; assert.strictEqual(DATA.items.filter((v) => v.category === "augment" && v.location_pack && v.location_pack !== "Free to Play").length, 0); } },
    "excluded-sets": { ruling: "n/a", why: "an augment's set membership is a Set Augment, gated by ownership, not by the excluded-sets filter (which reads set_bonus)", assert: () => {} },
    "owned-pool": { ruling: "n/a", why: "the owned pool restricts BASE items; augments take the owned-augments branch", assert: () => {} },
    "owned-augments": { ruling: "honored", why: "#851 — the pin check now precedes the #359 branch, so a pinned unowned augment stays and is disclosed as PINNED, NOT OWNED",
      assert: () => { const g = AUG({ acquirable: false }); const owns = () => false;
        assert.strictEqual(W.ownedPoolAdmits(g, owns, new Set(["G"]), true), true);
        assert.strictEqual(W.ownedPoolAdmits(g, owns, new Set(), true), false, "and the filter still bites an unpinned one");
        assert.deepStrictEqual(W.pinnedUnownedNames("owned", new Set(["Other"]), {}, [g], owns, ["G"], true), ["G"]);
        assert.deepStrictEqual(W.pinnedUnownedNames("owned", new Set(["Other"]), {}, [g], owns, ["G"], false), [], "with owned-augments OFF nothing overrode anything"); } },
    verification: { ruling: "n/a", why: "the pin search offers verified augments only", assert: () => {} },
    dominance: { ruling: "honored", why: "#742 gate 2 — the augment pool's dominanceFilter receives the pinned augment ids",
      assert: () => assert.ok(/dominanceFilter\(group, targetSet, mlCap, undefined, pinnedAugs\)/.test(MOD)) },
    "unique-equipped": { ruling: "n/a", why: "the ring twin rule reads slot === Ring", assert: () => assert.strictEqual(M.isTwinEligible(AUG()), false) },
  },
};
for (const col of COLUMNS) {
  MATRIX.block[col] = { ruling: "n/a", why: "a block and a filter both exclude; a blocked item a filter also removes is doubly excluded and the block is what the disclosure attributes it to",
    assert: () => assert.ok(/\(hit \? blocked : elig\)/.test(MOD) && MOD.indexOf("blockedIds") < MOD.indexOf("if (excludedSets)"), "the blocklist runs first and takes attribution") };
  MATRIX.floor[col] = { ruling: "refused", why: "a floor is a solver constraint over the eligible pool: it can never re-admit a candidate a filter removed, and an unreachable floor is disclosed as FLOOR NOT REACHED",
    assert: () => { NO_CANDIDACY_READER("targetFloors"); assert.ok(/id: "floor-not-reached"/.test(SRC("projection.js"))); } };
  MATRIX.cap[col] = { ruling: "n/a", why: "a cap clamps a stat's credited value; it neither admits nor removes a candidate",
    assert: () => NO_CANDIDACY_READER("targetCaps") };
  MATRIX.credit[col] = { ruling: "n/a", why: "a declared credit is a (stat, type, value) contribution with no gate — it competes in its bucket and is never a candidate",
    assert: () => NO_CANDIDACY_READER("declaredCredits") };
  MATRIX["set-pin"][col] = { ruling: "refused", why: "a set pin is classified against the ELIGIBLE pool: pieces a filter removed are not there, so the pin is suppressed with a verdict the REQUIRED SETS notice prints (never erased)",
    assert: () => {
      // The classification reads the post-filter pool by construction.
      assert.ok(/classifySetPins\(query, elig/.test(MOD) || /classifySetPins\(\s*query,\s*elig/.test(MOD), "classified against the filtered pool");
      const r = M.classifySetPins({ pinnedSets: ["No Such Set"] }, [], {}, {});
      assert.deepStrictEqual(r.pinned, []);
      assert.strictEqual(r.report[0].verdict, "unknown");
      assert.ok(P.setPinNoticeLines({ setPinReport: r.report })[0].includes("was not required"));
    } };
}
// Column-specific set-pin cells that have a sharper observable than the generic one.
MATRIX["set-pin"]["set-augment-gate"] = { ruling: "refused", why: "a Set Augment set the player has not ticked is suppressed with verdict not-owned, printed by REQUIRED SETS",
  assert: () => { if (!DATA) return; const defs = DATA.augment_set_defs || {}; const name = Object.keys(defs)[0]; assert.ok(name, "an augment set def exists");
    const r = M.classifySetPins({ pinnedSets: [name], ownedSetAugments: new Set() }, [], defs, {});
    assert.strictEqual(r.report[0].verdict, "not-owned"); assert.match(P.setPinNoticeLines({ setPinReport: r.report })[0], /not marked as owned/); } };

// ---------------------------------------------------------------------------
// 4. Every cell holds a ruling and every ruling is asserted.
// ---------------------------------------------------------------------------
const RULINGS = ["honored", "refused", "n/a"];
test("#851: every override row × every filter column holds a ruling", () => {
  const missing = [];
  for (const row of ROWS) for (const col of COLUMNS) if (!(MATRIX[row] || {})[col]) missing.push(`${row} × ${col}`);
  assert.deepStrictEqual(missing, [], "a cell with no rule — decide honored / refused / n/a and assert it");
  for (const row of Object.keys(MATRIX)) {
    assert.ok(ROWS.includes(row), `${row} is a matrix row but no override key maps to it`);
    for (const col of Object.keys(MATRIX[row])) assert.ok(COLUMNS.includes(col), `${row} × ${col}: not a column`);
  }
  const cells = ROWS.length * COLUMNS.length;
  assert.ok(cells >= 100, `${ROWS.length} rows × ${COLUMNS.length} columns = ${cells}`);
});

for (const row of ROWS) {
  for (const col of COLUMNS) {
    const cell = (MATRIX[row] || {})[col];
    if (!cell) continue;
    test(`#851: ${row} × ${col} — ${cell.ruling}`, () => {
      assert.ok(RULINGS.includes(cell.ruling), `ruling ${cell.ruling}`);
      assert.ok(cell.why && cell.why.length > 20, "says why");
      assert.strictEqual(typeof cell.assert, "function", "every cell carries the assertion that proves its ruling");
      cell.assert();
    });
  }
}

// ---------------------------------------------------------------------------
// 5. The disclosures the honored / refused cells rely on reach the result.
// ---------------------------------------------------------------------------
test("#851: the two pin reports survive a save and are registered notices", () => {
  const { RESULT_KEEP } = require("../web/persist.js");
  const keep = RESULT_KEEP || null;
  if (keep) for (const k of ["augPinReport", "pinnedThrough", "setPinReport"]) assert.ok(keep.includes(k), `${k} is kept on save`);
  const R = require("../web/results.js");
  const names = R.NOTICES.map((n) => n.name);
  for (const n of ["augPinNotice", "pinnedThroughNotice", "setPinNotice", "pinnedUnownedNotice"]) assert.ok(names.includes(n), `${n} is registered`);
  const { CHARACTER_NOTICES } = require("../web/exporters.js");
  const keys = CHARACTER_NOTICES.map((n) => n.key);
  for (const n of ["augPinNotice", "pinnedThroughNotice"]) assert.ok(keys.includes(n), `${n} reaches the exports`);
});

// ---------------------------------------------------------------------------
// 6. End to end, through the real solver: the reports the cells above rely on
//    reach the RESULT, not just the model. `readSolution` had carried
//    `augPinReport` since #742, but the lexicographic assembly never copied it,
//    so on the main path it reached nobody — the first run of this block found
//    that. Same shape as tests/augment-pin.test.js: the app's own buildModel
//    argument order, never a hand-assembled call that drops a pool.
// ---------------------------------------------------------------------------
(async () => {
  if (!DATA) return;
  let env;
  try { env = await require("./parity/capture_golden.js").solveEnv(); }
  catch (e) { console.log("  FAIL #851 end to end: could not prepare the solve environment\n   ", e.message); failed++; process.exitCode = 1; return; }
  const { dataset } = env;
  const { solveLexicographic } = require("../web/solver.js");
  const solve = (q) => solveLexicographic(M.buildModel(
    dataset.items, q, dataset.dino_inserts, dataset.nearly_complete, dataset.viktranium,
    dataset.seal, dataset.membership_set_defs, dataset.legendary_green_steel,
    {}, null, dataset.nearly_complete_per_item, dataset.essence_crafting), env.highs);
  const atest = async (name, fn) => {
    try { await fn(); passed++; console.log("  PASS", name); }
    catch (e) { console.log("  FAIL", name, "\n   ", e.message); failed++; process.exitCode = 1; }
  };

  const GEM = "Legendary Wraithborn Emerald";   // ML 30, Green
  await atest("#851 end to end: augment-pin × ml-cap — the result names the pin the cap excluded", async () => {
    const r = await solve({ mlCap: 20, targets: ["Strength"], pinnedAugments: [GEM] });
    assert.strictEqual(r.status, "optimal");
    assert.deepStrictEqual((r.augmentsPlaced || []).filter((a) => a.variant_id === GEM), [], "not placed — it cannot be");
    assert.deepStrictEqual(r.augPinReport, [{ variant_id: GEM, color: "Green", reason: "above your ML 20 cap" }]);
    assert.match(P.augPinNoticeLines(r)[0], /Legendary Wraithborn Emerald is pinned but was not placed: above your ML 20 cap/);
  });
  await atest("#851 end to end: the same pin at cap 34 is placed and reports nothing", async () => {
    const r = await solve({ mlCap: 34, targets: ["Strength"], pinnedAugments: [GEM] });
    assert.ok((r.augmentsPlaced || []).some((a) => a.variant_id === GEM), "placed");
    assert.deepStrictEqual(r.augPinReport, []);
    assert.deepStrictEqual(r.pinnedThrough, []);
  });
  await atest("#851 end to end: pin × excluded-sets — the pinned member is worn and the result says the pin overrode the exclusion", async () => {
    const S = dataset.items.find((v) => v.category === "item" && v.slot === "Ring" && v.verification === "verified"
      && (v.set_bonus || []).length && v.set_bonus[0].set && v.ml != null && v.ml <= 20 && !v.artifact && !v.race_req);
    assert.ok(S, "a low-ML set ring exists to pin");
    const setName = S.set_bonus[0].set;
    const r = await solve({ mlCap: 20, targets: ["Strength"], excludedSets: [setName],
      slotConstraints: { Ring: { type: "pin", variant_id: S.variant_id } } });
    assert.strictEqual(r.status, "optimal");
    assert.ok((r.chosen || []).some((c) => (c.variant_id || (c.variant && c.variant.variant_id)) === S.variant_id), `${S.variant_id} is worn`);
    assert.deepStrictEqual(r.pinnedThrough, [{ variant_id: S.variant_id, name: S.source_item || S.variant_id, filter: "excluded-set", detail: setName }]);
    assert.match(P.pinnedThroughNoticeLines(r)[0], new RegExp(`although you excluded its set \\(${setName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`));
  });
})();
