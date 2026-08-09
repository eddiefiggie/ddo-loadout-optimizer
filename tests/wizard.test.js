// U1 — wizard step-machine pure helpers. Run: node tests/wizard.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { WIZARD_STEPS, canAdvance, nextStep, prevStep, wizIsForged, buildQuery, cleanBoundMap, cleanCreditMap, creditKey, stepAfterLoad, curatedStats, pickerVocabulary, PRESET_BUNDLES, BUNDLE_GROUPS, BUNDLE_REVEALS, resolveBundle, addBundle, twfMigrationNeeded, pinWornSlotOf, pinHandsFor, pinIdOf, applyPin, applyPinId, removePinFrom, reconcilePinLegality, dualPinMutexConflict } = require("../web/wizard.js");
const { normalizeDataset, buildPickerVocabulary } = require("../web/dataset.js");
const realData = normalizeDataset(JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8")));

const baseState = () => ({ ml: 34, race: "Human", armor: "", oath: "", alignment: "",
  style: "", weaponTypes: [], offHand: [], offHandWeapons: [],
  priorities: ["Constitution"], slotConstraints: {} });

let passed = 0;
function test(name, fn) {
  try { fn(); console.log("PASS", name); passed++; }
  catch (e) { console.error("FAIL", name, "\n ", e.message); process.exitCode = 1; }
}

test("WIZARD_STEPS order", () => {
  assert.deepStrictEqual(WIZARD_STEPS, ["intro", "character", "pool", "priorities", "results"]);
});

test("canAdvance(character): needs a race and a positive ML", () => {
  assert.ok(!canAdvance("character", { race: "", ml: 34 }));
  assert.ok(!canAdvance("character", { race: "Human", ml: 0 }));
  assert.ok(canAdvance("character", { race: "Human", ml: 34 }));
});

test("canAdvance(pool): owned mode requires an uploaded inventory", () => {
  assert.ok(canAdvance("pool", { pool: "all" }));
  assert.ok(!canAdvance("pool", { pool: "owned", ownedNames: null }));
  assert.ok(canAdvance("pool", { pool: "owned", ownedNames: new Set() }));
});

test("canAdvance(priorities): needs at least one ranked stat", () => {
  assert.ok(!canAdvance("priorities", { priorities: [] }));
  assert.ok(canAdvance("priorities", { priorities: ["Constitution"] }));
});

test("nextStep / prevStep clamp at the ends", () => {
  assert.strictEqual(nextStep("intro"), "character");
  assert.strictEqual(nextStep("priorities"), "results");
  assert.strictEqual(nextStep("results"), "results");
  assert.strictEqual(prevStep("character"), "intro");
  assert.strictEqual(prevStep("intro"), "intro");
});

test("wizIsForged", () => {
  assert.ok(wizIsForged("Warforged") && wizIsForged("bladeforged"));
  assert.ok(!wizIsForged("Elf") && !wizIsForged(""));
});

test("buildQuery threads the optional mlFloor (blank/0 -> null)", () => {
  assert.strictEqual(buildQuery({ ...baseState(), mlFloor: 30 }).mlFloor, 30);
  assert.strictEqual(buildQuery({ ...baseState(), mlFloor: "" }).mlFloor, null);
  assert.strictEqual(buildQuery(baseState()).mlFloor, null);
});

test("U4: buildQuery reflects the Include-an-Artifact flag", () => {
  const on = buildQuery({ ...baseState(), includeArtifact: true });
  assert.strictEqual(on.includeArtifact, true);
  const off = buildQuery({ ...baseState(), includeArtifact: false });
  assert.strictEqual(off.includeArtifact, false);
});

test("U4: buildQuery defaults includeArtifact to false when unset", () => {
  // A fresh state with no includeArtifact -> query is false, so the default run
  // excludes Artifacts (R2 default). Coerced boolean, never undefined.
  const q = buildQuery(baseState());
  assert.strictEqual(q.includeArtifact, false);
});

// ---- U3 — combat style / weapon-type / off-hand constraints ----
test("U3: buildQuery emits style/weaponTypes/offHand/offHandWeapons and drops weaponSetup", () => {
  const q = buildQuery({ ...baseState(), style: "one-hand",
    weaponTypes: ["Long Swords", "Rapiers"], offHand: ["Tower shields"], offHandWeapons: ["Short Swords"] });
  assert.strictEqual(q.style, "one-hand");
  assert.deepStrictEqual(q.weaponTypes, ["Long Swords", "Rapiers"]);
  assert.deepStrictEqual(q.offHand, ["Tower shields"]);
  assert.deepStrictEqual(q.offHandWeapons, ["Short Swords"], "TWF off-hand weapon set threads through");
  assert.ok(!("weaponSetup" in q), "the inert weaponSetup flag is gone");
});

test("U3: an unconstrained state emits null style + empty sets", () => {
  const q = buildQuery(baseState());
  assert.strictEqual(q.style, null);
  assert.deepStrictEqual(q.weaponTypes, []);
  assert.deepStrictEqual(q.offHand, []);
  assert.deepStrictEqual(q.offHandWeapons, []);
});

test("U3: buildQuery copies the arrays (mutating the query never edits state)", () => {
  const st = { ...baseState(), style: "two-hand", weaponTypes: ["Falchions"] };
  const q = buildQuery(st);
  q.weaponTypes.push("Mauls");
  assert.deepStrictEqual(st.weaponTypes, ["Falchions"], "state array untouched");
});

// ---- U4 — druidic oath / anathema ----
// #162: the old cloth+light APPROXIMATION is superseded. Per
// https://ddowiki.com/page/Druid a druid is proficient with Light AND Medium armor,
// and separately cannot use metal armor, a metal shield, or a rune arm. Proficiency
// rides armorTypes here; the metal restriction rides `oath` + the wiki-sourced
// material map (see variantConflict in web/model.js).
test("U4: the Druid oath allows cloth, light, and medium (proficiency, not metalness)", () => {
  const q = buildQuery({ ...baseState(), oath: "druid" });
  assert.deepStrictEqual(q.armorTypes, ["cloth", "light", "medium"],
    "medium is a druid proficiency; non-metal medium armor must stay available");
  assert.strictEqual(q.oath, "druid", "the oath must reach the query for the metal gate");
});

test("U4: the oath overrides a conflicting armor-proficiency chip", () => {
  const q = buildQuery({ ...baseState(), armor: "heavy", oath: "druid" });
  assert.deepStrictEqual(q.armorTypes, ["cloth", "light", "medium"],
    "oath wins over the heavy chip — druids have no heavy proficiency");
});

test("U4: with no oath, armorTypes behaves exactly as before", () => {
  assert.deepStrictEqual(buildQuery({ ...baseState(), armor: "heavy" }).armorTypes, ["heavy"]);
  assert.strictEqual(buildQuery(baseState()).armorTypes, undefined, "no armor, no oath => undefined");
});

test("U4: a Forged race ignores the oath (docent body slot, gate moot)", () => {
  const q = buildQuery({ ...baseState(), race: "Bladeforged", oath: "druid" });
  assert.strictEqual(q.armorTypes, undefined);
});

// ---- U1 (Plan B) — load-to-Results routing (AE1, AE8) ----
test("U1: an optimal snapshot lands straight on Results", () => {
  assert.strictEqual(stepAfterLoad({ status: "optimal" }), "results");
});

test("U1: a non-optimal or missing snapshot routes to priorities (never blank Results)", () => {
  assert.strictEqual(stepAfterLoad({ status: "infeasible" }), "priorities");
  assert.strictEqual(stepAfterLoad({ status: "no_solution" }), "priorities");
  assert.strictEqual(stepAfterLoad({}), "priorities", "a snapshot with no status is not optimal");
  assert.strictEqual(stepAfterLoad(null), "priorities", "no saved snapshot");
  assert.strictEqual(stepAfterLoad(undefined), "priorities");
});

test("U1: load routing never targets pool/priorities-skippable intermediate steps", () => {
  // The only two landing steps are results (solved) or priorities (re-solve) —
  // load never drops the user on intro/character/pool.
  const landing = stepAfterLoad({ status: "optimal" });
  assert.ok(landing === "results" || landing === "priorities");
  assert.ok(!["intro", "character", "pool"].includes(stepAfterLoad({ status: "optimal" })));
  assert.ok(!["intro", "character", "pool"].includes(stepAfterLoad(null)));
});

// U4 — priority-picker vocabulary prefers the build's curated rankable list.
test("curatedStats: uses metadata.rankable_affixes when present", () => {
  const ds = {
    metadata: { rankable_affixes: ["Constitution", "Dodge", "Strength"] },
    items: [{ affixes: [{ stat: "Bal" }, { stat: "Strength" }] }],
  };
  assert.deepStrictEqual(curatedStats(ds), ["Constitution", "Dodge", "Strength"]);
  // parser garbage present in items[] must NOT appear (gate came from metadata)
  assert.ok(!curatedStats(ds).includes("Bal"));
});

test("curatedStats: falls back to dataset stats when metadata is absent", () => {
  const ds = { items: [{ affixes: [{ stat: "Dodge" }, { stat: "Accuracy" }] }] };
  assert.deepStrictEqual(curatedStats(ds), ["Accuracy", "Dodge"]);
});

test("curatedStats: returns a copy (mutating it never edits the dataset)", () => {
  const ds = { metadata: { rankable_affixes: ["Strength"] }, items: [] };
  curatedStats(ds).push("Mutated");
  assert.deepStrictEqual(ds.metadata.rankable_affixes, ["Strength"]);
});

// ---- U5 — picker vocabulary: union of every affix source, canonicalized --------

test("U5 picker: a CRAFTING-ONLY affix is selectable (union includes crafting pools)", () => {
  // "Strikethrough Chance" is supplied only by a crafting pool (no worn/weapon item
  // carries it), so the pre-U5 item-only scan could never offer it even though the
  // solver matches it. The union must now surface it as a suggestion.
  const v = buildPickerVocabulary(realData);
  const onItem = (realData.items || []).some((it) =>
    (it.affixes || []).some((a) => (a.name != null ? a.name : a.stat) === "Strikethrough Chance"));
  assert.ok(!onItem, "precondition: Strikethrough Chance is not on any worn/weapon item");
  assert.ok(v.suggestions.includes("Strikethrough Chance"),
    "a crafting-only rankable affix is now a picker suggestion");
  assert.ok(v.known.has("Strikethrough Chance"), "and is a known (typeable) target");
});

test("picker: build-around presence (Bool) effects are suggested + flagged on/off", () => {
  // Discrete named on/off effects players chase (Ghost Touch, Bone Paws...) ARE now
  // suggested and flagged in `presence` so the UI can badge them.
  const v = buildPickerVocabulary(realData);
  const found = ["Ghost Touch", "Bone Paws", "Freedom of Movement", "True Seeing", "Deathblock"]
    .find((n) => v.known.has(n));
  assert.ok(found, "precondition: a build-around presence effect exists in the dataset");
  assert.ok(v.suggestions.includes(found), `presence effect "${found}" is a suggestion`);
  assert.ok(v.presence.has(found), `and "${found}" is flagged as on/off`);
});

test("picker: rankability + presence classification (synthetic)", () => {
  // Rankable magnitude -> suggested. Penalty/Sneak descriptors -> excluded. A DISCRETE
  // Bool ("Ghost Touch") -> suggested + flagged presence. A SENTENCE Bool -> hidden
  // (typeable only). All remain typeable via `known`.
  const ds = {
    metadata: {}, items: [],
    green_steel: [
      { stat: "Wildcard Power", bonus_type: "Untyped", value: 10 },
      { stat: "Armor Class Penalty", bonus_type: "Penalty", value: -5 },
      { stat: "Extra Sneak Damage", bonus_type: "Sneak Attack", value: 8 },
      { stat: "Ghost Touch", bonus_type: "Bool", value: 1 },
      { stat: "5% chance to gain 150 temporary hit points when you are hit", bonus_type: "Bool", value: 1 },
    ],
  };
  const v = buildPickerVocabulary(ds);
  assert.deepStrictEqual(v.suggestions.sort(), ["Ghost Touch", "Wildcard Power"],
    "rankable magnitude + discrete presence are suggested; penalty/sneak/sentence are not");
  assert.ok(v.presence.has("Ghost Touch"), "the discrete Bool is flagged on/off");
  assert.ok(!v.presence.has("Wildcard Power"), "a magnitude affix is not flagged on/off");
  for (const n of ["Wildcard Power", "Armor Class Penalty", "Extra Sneak Damage", "Ghost Touch",
    "5% chance to gain 150 temporary hit points when you are hit"]) {
    assert.ok(v.known.has(n), `${n} is typeable`);
  }
});

test("U5 picker: a free-typed variant is canonicalized through the alias table", () => {
  const ds = {
    metadata: {}, items: [], _affixAliases: { "blood rage": "Blood Rage" },
    green_steel: [{ stat: "Blood Rage", bonus_type: "Enhancement", value: 4 }],
  };
  const v = buildPickerVocabulary(ds);
  assert.strictEqual(v.canonical("blood rage"), "Blood Rage");
  assert.ok(v.known.has("Blood Rage"), "canonical target is known");
  assert.ok(v.suggestions.includes("Blood Rage"));
});

test("U5 pickerVocabulary (wizard) delegates to the shared builder", () => {
  // The wizard's resolver returns the same shape the picker consumes.
  const out = pickerVocabulary(realData);
  assert.ok(Array.isArray(out.suggestions) && out.suggestions.length > 0);
  assert.ok(out.known instanceof Set && typeof out.canonical === "function");
  assert.ok(out.suggestions.includes("Strikethrough Chance"));
});

// ---- composable preset bundles (gear-planner style) ------------------------

test("bundles: every UI bundle resolves to >=1 known target in the dataset", () => {
  const rv = buildPickerVocabulary(realData);
  const allKeys = [...BUNDLE_GROUPS.packages, ...BUNDLE_GROUPS.tactics, ...BUNDLE_GROUPS.schools, ...BUNDLE_GROUPS.spellpower];
  assert.ok(allKeys.length >= 20, "a rich set of bundles exists");
  for (const key of allKeys) {
    assert.ok(PRESET_BUNDLES[key], `bundle "${key}" is defined`);
    const resolved = resolveBundle(key, rv);
    assert.ok(resolved.length >= 1, `bundle "${key}" resolves to at least one known affix`);
    assert.ok(resolved.every((n) => rv.known.has(n)), `bundle "${key}" resolves to all-known targets`);
  }
});

test("resolveBundle canonicalizes, dedupes, and drops dataset-absent names", () => {
  const stub = { canonical: (n) => ({ Str: "Strength" }[n] || n), known: new Set(["Strength"]) };
  PRESET_BUNDLES.__test = ["Str", "Ghostwalk", "Strength"]; // canonical dup + unknown
  assert.deepStrictEqual(resolveBundle("__test", stub), ["Strength"], "Str->Strength once, unknown dropped, dup removed");
  delete PRESET_BUNDLES.__test;
  assert.deepStrictEqual(resolveBundle("Nope", stub), [], "unknown bundle key -> []");
});

test("U1: Seeker is in the Melee preset and resolves against the dataset", () => {
  const rv = buildPickerVocabulary(realData);
  assert.ok(PRESET_BUNDLES.Melee.includes("Seeker"), "Seeker is listed in the Melee preset");
  assert.ok(resolveBundle("Melee", rv).includes("Seeker"), "Seeker survives resolveBundle (dataset carries it)");
});

test("addBundle is additive: appends new affixes, preserves existing, no dupes", () => {
  const rv = buildPickerVocabulary(realData);
  const melee = resolveBundle("Melee", rv);
  const base = ["Constitution"];
  const out = addBundle("Melee", base, rv);
  assert.strictEqual(out[0], "Constitution", "existing priority stays first");
  assert.ok(melee.every((n) => out.includes(n)), "the bundle's affixes are appended");
  // adding the same bundle again is a no-op (dedup)
  assert.deepStrictEqual(addBundle("Melee", out, rv), out, "re-adding a bundle changes nothing");
});

test("bundle disclosure: Melee reveals tactics, Caster reveals schools + spell power", () => {
  assert.deepStrictEqual(BUNDLE_REVEALS.Melee, ["tactics"]);
  assert.deepStrictEqual(BUNDLE_REVEALS.Caster, ["schools", "spellpower"]);
});

// --- U3 pre-solve item pinning (pure core) --------------------------------
const cardOf = (slot) => (slot === "Ring" ? 2 : 1);
const mkItem = (id, slot, opts = {}) => ({ variant_id: id, source_item: id, slot, category: opts.category || "item" });

test("U3/KTD4 pinWornSlotOf maps a weapon to Main Hand, not its raw slot", () => {
  assert.strictEqual(pinWornSlotOf(mkItem("Sword", "Weapon", { category: "weapon" })), "Main Hand");
  assert.strictEqual(pinWornSlotOf(mkItem("Orb", "Off Hand")), "Off Hand");
  assert.strictEqual(pinWornSlotOf(mkItem("R1", "Ring")), "Ring");
});

test("U3/B2 applyPin pins a single-slot item by its worn slot", () => {
  const sc = {};
  applyPin(sc, mkItem("Hydra's Heart", "Trinket"), cardOf);
  assert.deepStrictEqual(sc, { Trinket: { type: "pin", variant_id: "Hydra's Heart" } });
});

test("U3/KTD4 applyPin pins a weapon to Main Hand (guards the silent no-op)", () => {
  const sc = {};
  applyPin(sc, mkItem("Legendary Sword", "Weapon", { category: "weapon" }), cardOf);
  assert.deepStrictEqual(sc, { "Main Hand": { type: "pin", variant_id: "Legendary Sword" } });
  assert.ok(!sc.Weapon, "must NOT key by the raw 'Weapon' slot");
});

test("U3/B5 applyPin appends up to two different rings, then keeps the newest two", () => {
  const sc = {};
  applyPin(sc, mkItem("R1", "Ring"), cardOf);
  applyPin(sc, mkItem("R2", "Ring"), cardOf);
  assert.deepStrictEqual(sc.Ring, { type: "pin", variant_ids: ["R1", "R2"] });
  applyPin(sc, mkItem("R1", "Ring"), cardOf);                 // duplicate -> no-op
  assert.deepStrictEqual(sc.Ring, { type: "pin", variant_ids: ["R1", "R2"] });
  applyPin(sc, mkItem("R3", "Ring"), cardOf);                 // third -> drop oldest
  assert.deepStrictEqual(sc.Ring, { type: "pin", variant_ids: ["R2", "R3"] });
});

test("U3 applyPin replaces a single-cardinality slot on re-pin", () => {
  const sc = {};
  applyPin(sc, mkItem("T1", "Trinket"), cardOf);
  applyPin(sc, mkItem("T2", "Trinket"), cardOf);
  assert.deepStrictEqual(sc.Trinket, { type: "pin", variant_id: "T2" });
});

test("U3/B3 removePinFrom clears a slot, or prunes one ring keeping the other", () => {
  const single = { Trinket: { type: "pin", variant_id: "T1" } };
  removePinFrom(single, "Trinket", "T1", cardOf);
  assert.deepStrictEqual(single, {}, "removing the only pin deletes the slot");
  const rings = { Ring: { type: "pin", variant_ids: ["R1", "R2"] } };
  removePinFrom(rings, "Ring", "R1", cardOf);
  assert.deepStrictEqual(rings.Ring, { type: "pin", variant_ids: ["R2"] }, "the other ring survives as a list");
});

test("U3/B6 buildQuery threads slotConstraints (incl. a two-ring list) into the query", () => {
  const st = { ...baseState(), slotConstraints: {
    Trinket: { type: "pin", variant_id: "Hydra's Heart" },
    Ring: { type: "pin", variant_ids: ["R1", "R2"] },
  } };
  const q = buildQuery(st);
  assert.deepStrictEqual(q.slotConstraints.Trinket, { type: "pin", variant_id: "Hydra's Heart" });
  assert.deepStrictEqual(q.slotConstraints.Ring, { type: "pin", variant_ids: ["R1", "R2"] });
});

test("U1: cleanBoundMap keeps finite non-negative values, drops the rest", () => {
  assert.deepStrictEqual(cleanBoundMap({ A: 5, B: 0, C: "", D: null, E: -2, F: "x", G: "7" }), { A: 5, B: 0, G: 7 });
  assert.deepStrictEqual(cleanBoundMap(undefined), {});
  assert.deepStrictEqual(cleanBoundMap(null), {});
});

test("U1/U4: buildQuery emits cleaned targetCaps/targetFloors maps", () => {
  const st = { ...baseState(), targetCaps: { Dodge: 4, Bad: -1, Blank: "" }, targetFloors: { PRR: 300 } };
  const q = buildQuery(st);
  assert.deepStrictEqual(q.targetCaps, { Dodge: 4 }, "negative/blank dropped");
  assert.deepStrictEqual(q.targetFloors, { PRR: 300 });
});

test("U1/U4: buildQuery defaults caps/floors to empty maps when absent", () => {
  const q = buildQuery(baseState());
  assert.deepStrictEqual(q.targetCaps, {});
  assert.deepStrictEqual(q.targetFloors, {});
});

test("U3: buildQuery emits the ML floor from state", () => {
  assert.strictEqual(buildQuery({ ...baseState(), mlFloor: 32 }).mlFloor, 32);
  assert.strictEqual(buildQuery({ ...baseState(), mlFloor: 0 }).mlFloor, null, "0/blank means consider all");
});


// --- R4a: pre-solve pin-legality reconciliation (U4) -----------------------
test("R4a: reconcilePinLegality drops an illegal pin, keeps a legal one", () => {
  const query = buildQuery({ ...baseState(), race: "Human", armor: "heavy" });
  const items = {
    DOC: { source_item: "Adamantine Docent", variant_id: "DOC", slot: "Armor", type: "Docents", verification: "verified", ml: 10, affixes: [] },
    TRK: { source_item: "Good Trinket", variant_id: "TRK", slot: "Trinket", verification: "verified", ml: 10, affixes: [] },
  };
  const itemByPinId = (id) => items[id] || null;
  const sc = { Armor: { type: "pin", variant_id: "DOC" }, Trinket: { type: "pin", variant_id: "TRK" } };
  const dropped = reconcilePinLegality(sc, itemByPinId, query, () => 1);
  assert.deepStrictEqual(dropped, [{ slot: "Armor", id: "DOC" }]); // docent illegal for non-Forged
  assert.strictEqual(sc.Armor, undefined);                          // illegal pin freed
  assert.deepStrictEqual(sc.Trinket, { type: "pin", variant_id: "TRK" }); // legal pin kept
});

test("R4a: reconcilePinLegality prunes one illegal Ring member, keeps the legal one", () => {
  const query = buildQuery({ ...baseState(), race: "Human" }); // mlCap 34
  const items = {
    R1: { source_item: "Legal Ring", variant_id: "R1", slot: "Ring", verification: "verified", ml: 10, affixes: [] },
    R2: { source_item: "Overcap Ring", variant_id: "R2", slot: "Ring", verification: "verified", ml: 99, affixes: [] },
  };
  const itemByPinId = (id) => items[id] || null;
  const sc = { Ring: { type: "pin", variant_ids: ["R1", "R2"] } };
  const cardOf = (slot) => (slot === "Ring" ? 2 : 1);
  const dropped = reconcilePinLegality(sc, itemByPinId, query, cardOf);
  assert.deepStrictEqual(dropped, [{ slot: "Ring", id: "R2" }]);   // R2 above ML cap
  assert.deepStrictEqual(sc.Ring, { type: "pin", variant_ids: ["R1"] }); // R2 pruned, R1 kept
});

test("R4a: reconcilePinLegality keeps an unresolvable (stale) pin — fail-open, not dropped", () => {
  const query = buildQuery({ ...baseState(), race: "Human" });
  const itemByPinId = () => null;                 // pin id resolves to no catalog item
  const sc = { Trinket: { type: "pin", variant_id: "GHOST" } };
  const dropped = reconcilePinLegality(sc, itemByPinId, query, () => 1);
  assert.deepStrictEqual(dropped, []);            // nothing dropped (post-solve sweep owns stale)
  assert.deepStrictEqual(sc.Trinket, { type: "pin", variant_id: "GHOST" }); // pin intact
});

test("U2: buildQuery threads the Sword & Board style so the off-hand/main-hand gates fire", () => {
  const q = buildQuery({ ...baseState(), style: "sword-board" });
  assert.strictEqual(q.style, "sword-board");
});

test("U3: reconcilePinLegality keeps a pinned below-floor item (pin overrides the floor)", () => {
  const sc = { Ring: { type: "pin", variant_id: "LOW" } };
  // query.slotConstraints carries the pin so queryGates builds the pinnedIds set
  const query = buildQuery({ ...baseState(), ml: 34, mlFloor: 30, slotConstraints: sc });
  const items = { LOW: { source_item: "Low Ring", variant_id: "LOW", slot: "Ring", verification: "verified", ml: 20, affixes: [] } };
  const itemByPinId = (id) => items[id] || null;
  const dropped = reconcilePinLegality(sc, itemByPinId, query, () => 1);
  assert.deepStrictEqual(dropped, [], "below-floor pin not suppressed by reconcile");
  assert.deepStrictEqual(sc.Ring, { type: "pin", variant_id: "LOW" }, "pin intact");
});

test("U4/AE10: dual-pin mutex — a pinned 2H main + pinned off-hand conflicts; otherwise not", () => {
  const items = {
    GS: { source_item: "Greatsword", variant_id: "GS", category: "weapon", type: "Great Swords" },
    SH: { source_item: "Shield", variant_id: "SH", type: "Large shields" },
    LS: { source_item: "Longsword", variant_id: "LS", category: "weapon", type: "Long Swords" },
  };
  const byId = (id) => items[id] || null;
  assert.strictEqual(dualPinMutexConflict([{ slot: "Main Hand", id: "GS" }, { slot: "Off Hand", id: "SH" }], byId), true, "2H main + off-hand conflicts");
  assert.strictEqual(dualPinMutexConflict([{ slot: "Main Hand", id: "LS" }, { slot: "Off Hand", id: "SH" }], byId), false, "1H main + off-hand is fine");
  assert.strictEqual(dualPinMutexConflict([{ slot: "Main Hand", id: "GS" }], byId), false, "only the 2H pinned: no conflict");
  assert.strictEqual(dualPinMutexConflict([{ slot: "Off Hand", id: "SH" }], byId), false, "only the off-hand pinned: no conflict");
});

// ---------------------------------------------------------------------------
// U4 / issue #105 — consistent back/advance navigation on every wizard step.
// The step render functions live inside the DOM-guarded closure (not exported),
// so we assert on their source markup: every step must carry the shared
// `.wz-actions` / `.wz-spacer` row with the ADVANCE control bottom-right (after
// the spacer) and, where present, the BACK control bottom-left (before it).
const WIZARD_SRC = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");

// Slice a single step render function's returned <section>…</section> template.
function stepTemplate(name) {
  const start = WIZARD_SRC.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `${name} exists`);
  const end = WIZARD_SRC.indexOf("</section>", start);
  assert.ok(end !== -1, `${name} returns a <section>`);
  return WIZARD_SRC.slice(start, end);
}
// The action row: from the (single) `class="wz-actions"` to the template end.
function actionRow(name) {
  const tpl = stepTemplate(name);
  const i = tpl.indexOf('class="wz-actions"');
  assert.ok(i !== -1, `${name} has a .wz-actions row`);
  return tpl.slice(i);
}

// steps → { advance: token that must sit bottom-right, back: token bottom-left (or null) }
const NAV = {
  stepIntro: { advance: "data-next", back: null },
  stepCharacter: { advance: "data-next", back: "data-back" },
  stepPool: { advance: "data-next", back: "data-back" },
  stepPriorities: { advance: "data-solve", back: "data-back" },
  stepResults: { advance: 'data-goto="character"', back: 'data-goto="priorities"' },
};

test("U4/#105: every step exposes its advance control bottom-right (after the spacer)", () => {
  for (const [name, nav] of Object.entries(NAV)) {
    const row = actionRow(name);
    const spacer = row.indexOf('class="wz-spacer"');
    const adv = row.indexOf(nav.advance);
    assert.ok(spacer !== -1, `${name} action row has a wz-spacer`);
    assert.ok(adv !== -1, `${name} action row has its advance control (${nav.advance})`);
    assert.ok(adv > spacer, `${name}: advance control sits AFTER the spacer (bottom-right)`);
  }
});

test("U4/#105: steps with a back control expose it bottom-left (before the spacer)", () => {
  for (const [name, nav] of Object.entries(NAV)) {
    if (!nav.back) continue;
    const row = actionRow(name);
    const spacer = row.indexOf('class="wz-spacer"');
    const back = row.indexOf(nav.back);
    assert.ok(back !== -1, `${name} action row has its back control (${nav.back})`);
    assert.ok(back < spacer, `${name}: back control sits BEFORE the spacer (bottom-left)`);
  }
});

test("U4/#105: step 1 (intro) aligns like the others — action row + spacer, no back", () => {
  const row = actionRow("stepIntro");
  assert.ok(row.includes('class="wz-spacer"'), "intro has a spacer so advance is bottom-right");
  assert.ok(!row.includes("data-back"), "intro has no back control (it is the first step)");
});

test("U4/#105: step 5 (results) nav is in the bottom action bar, not the header", () => {
  const tpl = stepTemplate("stepResults");
  // The results header must no longer host the nav buttons…
  const head = tpl.slice(tpl.indexOf("wz-results-head"), tpl.indexOf('class="wz-actions"'));
  assert.ok(!head.includes("data-goto"), "results header no longer carries the goto nav");
  // …they now live in the bottom .wz-actions row, both preserved.
  const row = actionRow("stepResults");
  assert.ok(row.includes('data-goto="priorities"'), "Adjust-priorities relocated to the bottom bar");
  assert.ok(row.includes('data-goto="character"'), "Edit-character relocated to the bottom bar");
});

// ---- plan 003 U1 — Two Weapon Fighting declaration (R1, R2, R9, R11) ----

test("U1/003: buildQuery emits the declaration; undeclared is false", () => {
  const on = buildQuery(Object.assign(baseState(), { twoWeaponFighting: true }));
  assert.strictEqual(on.twoWeaponFighting, true, "a declared build emits the flag");
  const off = buildQuery(baseState());
  assert.strictEqual(off.twoWeaponFighting, false, "an undeclared build emits false, never undefined");
  // A pre-U1 state object has no field at all and must still resolve to false.
  const legacy = baseState(); delete legacy.twoWeaponFighting;
  assert.strictEqual(buildQuery(legacy).twoWeaponFighting, false, "a state without the field defaults to undeclared");
});

test("U1/003 (R1): the declaration is a character-step control, not an off-hand one", () => {
  const tpl = stepTemplate("stepCharacter");
  assert.ok(tpl.includes('id="wz-twf"'), "the declaration control renders on the character step");
  assert.ok(/Two Weapon Fighting/.test(tpl), "the control names the feat it declares");
});

test("U1/003 (R11): the declaration control is announced and keyboard-operable", () => {
  const tpl = stepTemplate("stepCharacter");
  const i = tpl.indexOf('id="wz-twf"');
  assert.ok(i !== -1, "the control exists");
  // The shipped chip convention is a real <button> (focusable, Enter/Space native).
  // aria-pressed is what makes its on/off state audible to a screen reader.
  const control = tpl.slice(i, i + 600);
  assert.ok(/<button/.test(control), "a real button, so it is focusable and Enter/Space works");
  assert.ok(/aria-pressed=/.test(control), "aria-pressed announces the declared state");
});

test("U1/003 (R2): changing combat style resets gear picks but never the declaration", () => {
  // The style handler is the one site that clears adjacent gear state. The
  // declaration is character state (Product Contract Key Decision 2), so it must
  // not join that reset — a style switch cannot silently un-declare a feat.
  const h = WIZARD_SRC.slice(WIZARD_SRC.indexOf("#wz-style .wz-chip"));
  const body = h.slice(0, h.indexOf("});"));
  assert.ok(/state\.offHandWeapons\s*=\s*\[\]/.test(body), "the style reset still clears off-hand weapon picks");
  assert.ok(!/twoWeaponFighting/.test(body), "the style reset must not touch the declaration");
});

test("U1/003 (R9): the declaration is restored on load, defaulting to undeclared", () => {
  const load = WIZARD_SRC.slice(WIZARD_SRC.indexOf("state.offHandWeapons = Array.isArray(i.offHandWeapons)"));
  const near = load.slice(0, 1200);
  // U4 layered the migration on top; a save with neither the field nor the old
  // opt-in still resolves to undeclared through both terms.
  assert.ok(/state\.twoWeaponFighting\s*=\s*state\.twfMigrated \|\| !!i\.twoWeaponFighting/.test(near),
    "the load path restores the declaration, coercing a missing field to false");
  assert.strictEqual(twfMigrationNeeded({}), false, "…and a bare pre-U1 save does not migrate");
});

// ---- plan 003 U5 — a hand target in the pin flow (R6, R7, R8, R11) ----

const oneHandWeapon = { source_item: "Longsword", variant_id: "Longsword", slot: "Weapon",
  category: "weapon", type: "Long Swords", ml: 20, minimum_level: 20, verification: "verified",
  affixes: [{ name: "Constitution", type: "Enhancement", value: 8, unit: "flat" }],
  scaling: [], set_bonus: [], augment_slots: [] };
const twoHandWeapon = { ...oneHandWeapon, source_item: "Greatsword", variant_id: "Greatsword", type: "Great Swords" };
const pinShield = { source_item: "Tower Shield", variant_id: "Tower Shield", slot: "Off Hand",
  type: "Tower shields", ml: 20, minimum_level: 20, verification: "verified",
  affixes: [{ name: "Constitution", type: "Enhancement", value: 25, unit: "flat" }],
  scaling: [], set_bonus: [], augment_slots: [] };
const pinRing = { source_item: "Ring", variant_id: "Ring", slot: "Ring", ml: 20, minimum_level: 20,
  verification: "verified", affixes: [], scaling: [], set_bonus: [], augment_slots: [] };

test("U5/003 (R6): pinWornSlotOf routes a weapon to the hand it was pinned to", () => {
  // The shipped line sent EVERY weapon to "Main Hand" unconditionally, so an
  // off-hand weapon pin could not be expressed at all — half the reported bug.
  assert.strictEqual(pinWornSlotOf(oneHandWeapon), "Main Hand", "default is unchanged: Main hand");
  assert.strictEqual(pinWornSlotOf(oneHandWeapon, "Off Hand"), "Off Hand", "an explicit off-hand target is honored");
  assert.strictEqual(pinWornSlotOf(pinShield, "Off Hand"), "Off Hand", "a non-weapon still uses its own slot");
  assert.strictEqual(pinWornSlotOf(pinRing, "Off Hand"), "Ring", "a hand target never moves a non-weapon");
});

test("U5/003 (R6): only a ONE-HANDED weapon offers both hands", () => {
  assert.deepStrictEqual(pinHandsFor(oneHandWeapon), ["Main Hand", "Off Hand"], "one-handed: two actions");
  assert.deepStrictEqual(pinHandsFor(twoHandWeapon), ["Main Hand"], "two-handed: main hand only");
  assert.deepStrictEqual(pinHandsFor(pinShield), ["Off Hand"], "a shield keeps its single worn slot");
  assert.deepStrictEqual(pinHandsFor(pinRing), ["Ring"], "a non-weapon keeps its single worn slot");
  // An UNTYPED weapon host has unknown handedness — it could be crafted two-handed,
  // which cannot be dual-wielded — so it is not offered as an off-hand pin.
  assert.deepStrictEqual(pinHandsFor({ ...oneHandWeapon, type: null }), ["Main Hand"], "untyped host: main hand only");
});

test("U5/003 (R6): applyPin honors the hand target", () => {
  const sc = {};
  applyPin(sc, oneHandWeapon, () => 1, "Off Hand");
  assert.deepStrictEqual(sc, { "Off Hand": { type: "pin", variant_id: "Longsword" } },
    "the weapon lands in the OFF hand, not silently in the main hand");
  const sc2 = {};
  applyPin(sc2, oneHandWeapon, () => 1);
  assert.deepStrictEqual(sc2, { "Main Hand": { type: "pin", variant_id: "Longsword" } },
    "with no target, existing behavior is unchanged");
});

test("U5/003 (R7): reconcile DROPS an off-hand weapon pin made without the declaration", () => {
  const byId = (id) => ({ Longsword: oneHandWeapon, "Tower Shield": pinShield }[id] || null);
  const sc = { "Off Hand": { type: "pin", variant_id: "Longsword" } };
  const dropped = reconcilePinLegality(sc, byId, { mlCap: 34, style: "one-hand" }, () => 1);
  assert.deepStrictEqual(dropped, [{ slot: "Off Hand", id: "Longsword" }], "the illegal pin is reported");
  assert.deepStrictEqual(sc, {}, "and actually removed, so the solve is not constrained to an absent variant");
});

test("U5/003 (R7): the same pin SURVIVES once the feat is declared", () => {
  const byId = (id) => ({ Longsword: oneHandWeapon }[id] || null);
  const sc = { "Off Hand": { type: "pin", variant_id: "Longsword" } };
  const dropped = reconcilePinLegality(sc, byId, { mlCap: 34, style: "one-hand", twoWeaponFighting: true }, () => 1);
  assert.deepStrictEqual(dropped, [], "nothing dropped");
  assert.ok(sc["Off Hand"], "the pin is honored");
});

test("U5/003 (R8/KTD1): reconcile must NEVER sweep a pinned shield on a declared build", () => {
  // The escape hatch. If the exclusion had been expressed through variantConflict,
  // this pin would be dropped here and the feature would delete its own override.
  const byId = (id) => ({ "Tower Shield": pinShield }[id] || null);
  const sc = { "Off Hand": { type: "pin", variant_id: "Tower Shield" } };
  const dropped = reconcilePinLegality(sc, byId, { mlCap: 34, style: "one-hand", twoWeaponFighting: true }, () => 1);
  assert.deepStrictEqual(dropped, [], "the pinned shield is not swept");
  assert.ok(sc["Off Hand"], "the player's override stands");
});

test("U5/003 (R6/R11): the pin search offers a labelled hand action per weapon", () => {
  const src = WIZARD_SRC.slice(WIZARD_SRC.indexOf("function renderPinResults("));
  const body = src.slice(0, src.indexOf("function renderPinList("));
  assert.ok(/data-pin-hand=/.test(body), "each action carries its hand target");
  assert.ok(/pinHandsFor\(/.test(body), "the action list comes from the shared handedness helper");
  assert.ok(/aria-label=/.test(body), "each action is labelled for screen readers");
});

test("U5/003 (R7/R8): the pin list flags both the illegal pin and the override", () => {
  const src = WIZARD_SRC.slice(WIZARD_SRC.indexOf("function renderPinList("));
  const body = src.slice(0, src.indexOf("function stepPriorities("));
  assert.ok(/pinSlotConflict\(/.test(body), "the slot-aware reason is surfaced, not just variantConflict");
  assert.ok(/offHandItemsExcluded\(/.test(body),
    "the override flag reads U2's exported advisory predicate, not a view-layer copy");
});

// ---- plan 003 U3 — the declaration across combat-style states (R4) ----

test("U3/003 (R4): the control states its three style cases in the markup", () => {
  const tpl = stepTemplate("stepCharacter");
  const i = tpl.indexOf('id="wz-twf"');
  assert.ok(i !== -1, "the control exists");
  // "Inert" is settable-but-without-effect, NOT disabled: a player must be able to
  // declare from any style (AE3 declares, then switches), and disabling would also
  // read as "you can't have this feat".
  assert.ok(!/data-twf="1"[^>]*\bdisabled\b/.test(tpl), "the control is never disabled");
  // The IIFE that wraps the field computes twfActive from the taxonomy and branches
  // on it — that branch is the whole of R4's behavior.
  const block = tpl.slice(0, i);
  assert.ok(/twfActive\s*=\s*!!\(WT && WT\.twfWeaponAllowedForStyle\(state\.style\)\)/.test(block),
    "active-ness comes from the shipped taxonomy, not a new style list here (KTD2)");
  assert.ok(/state\.twoWeaponFighting && !twfActive/.test(block),
    "the reason renders exactly when the declaration is set but currently has no effect");
});

test("U3/003 (R4): a forbidding style renders a stated reason, an enabling one doesn't", () => {
  const tpl = stepTemplate("stepCharacter");
  // The reason names the style's constraint rather than just greying out.
  assert.ok(/wz-twf-inert/.test(tpl), "a reason element exists for the inert case");
  assert.ok(/no effect|doesn't apply|does not apply/i.test(tpl),
    "the reason says the declaration has no effect under this style");
});

test("U3/003 (R2/R4): only `one-hand` makes the declaration active", () => {
  // The single source is the shipped taxonomy — U3 adds no new style logic (KTD2).
  const WT = require("../web/weapon-taxonomy.js");
  const active = WT.STYLES.map((s) => s.id).filter((id) => WT.twfWeaponAllowedForStyle(id));
  assert.deepStrictEqual(active, ["one-hand"], "exactly one style permits a second weapon");
  for (const id of ["thf", "ranged", "crossbow", "sword-board", "unarmed"]) {
    assert.strictEqual(WT.twfWeaponAllowedForStyle(id), false, `${id} forbids a second weapon`);
  }
  assert.strictEqual(WT.twfWeaponAllowedForStyle(""), false, "no style chosen: not yet active");
});

test("U3/003 (R2): the toggle handler still only flips the flag — no style coupling", () => {
  const h = WIZARD_SRC.slice(WIZARD_SRC.indexOf("#wz-twf .wz-chip"));
  const body = h.slice(0, h.indexOf("});"));
  assert.ok(/state\.twoWeaponFighting = !state\.twoWeaponFighting/.test(body), "a plain toggle");
  assert.ok(!/state\.style/.test(body), "declaring never reads or writes the combat style");
});

// ---- plan 003 U4 — migrate saved characters that used the old opt-in (R9) ----

test("U4/003: a save that used the old opt-in migrates to declared", () => {
  // Those players HAD dual-wield on under the pre-U1 trigger (a non-empty
  // offHandWeapons list). Leaving them undeclared would silently return a shield on
  // their next solve — a regression they never asked for and can't see coming.
  assert.strictEqual(twfMigrationNeeded({ offHandWeapons: ["Short Swords"] }), true);
});

test("U4/003: a save with no off-hand weapon picks does NOT migrate", () => {
  assert.strictEqual(twfMigrationNeeded({ offHandWeapons: [] }), false, "empty list: dual-wield was off");
  assert.strictEqual(twfMigrationNeeded({}), false, "no field at all");
  assert.strictEqual(twfMigrationNeeded({ offHandWeapons: null }), false, "null is not a pick list");
  assert.strictEqual(twfMigrationNeeded(null), false, "a missing record is not a crash");
});

test("U4/003: the migration is idempotent — a post-U1 save is never re-migrated", () => {
  // pickInputs always writes a boolean, so ANY save made after U1 carries the field.
  // Its presence is exactly the "already migrated / made a choice" signal, which is
  // why persist.js coerces rather than passing undefined through.
  assert.strictEqual(twfMigrationNeeded({ twoWeaponFighting: false, offHandWeapons: ["Short Swords"] }), false,
    "an explicit false is the player's choice and is honored, not overwritten");
  assert.strictEqual(twfMigrationNeeded({ twoWeaponFighting: true, offHandWeapons: ["Short Swords"] }), false,
    "already declared: nothing to do");
});

test("U4/003 (R9): the load path applies the migration and flags it for disclosure", () => {
  const load = WIZARD_SRC.slice(WIZARD_SRC.indexOf("state.twfMigrated = twfMigrationNeeded(i)"));
  const near = load.slice(0, 700);
  assert.ok(/twfMigrationNeeded\(i\)/.test(near), "the load path consults the migration helper");
  assert.ok(/state\.twfMigrated/.test(near), "and records it so the notice can render");
});

test("U4/003: the migration notice is a distinct message, not the catalog-staleness one", () => {
  const tpl = stepTemplate("stepResults");
  assert.ok(/wz-twfmig/.test(tpl), "its own bar");
  assert.ok(/Two Weapon Fighting/.test(tpl), "naming what was turned on");
  assert.ok(/predates the current gear catalog/.test(tpl), "the catalog-staleness bar still exists separately");
});

// --- review #169: the load path applies the expanded-away priority migration ---
// Mirrors the U4/003 twfMigrated precedent above: loadCharacter lives inside a
// window-gated IIFE that Node cannot reach, so the wiring is asserted against the
// source text. Without this, the player-facing half of #169 -- the part that stops
// a saved `Parrying` priority from silently scoring zero -- had no coverage at all.

test("#169: the load path migrates expanded-away priorities and flags the disclosure", () => {
  const at = WIZARD_SRC.indexOf("migratePriorities(state.priorities");
  assert.ok(at > 0, "loadCharacter consults the migration helper");
  const near = WIZARD_SRC.slice(at, at + 1200);
  assert.ok(/state\.priorities = migrated\.priorities/.test(near), "it adopts the substitution");
  assert.ok(/state\.expandedAwayMigrated = /.test(near), "and records it so the notice can render");
});

test("#169: the migration drops bounds stranded on the old name, and discloses it", () => {
  const at = WIZARD_SRC.indexOf("migratePriorities(state.priorities");
  const near = WIZARD_SRC.slice(at, at + 1200);
  assert.ok(/delete map\[sub\.from\]/.test(near), "a cap/floor keyed to the old name is removed");
  assert.ok(/droppedBounds/.test(near), "and passed to the disclosure rather than dropped silently");
});

test("#169: bounds are restored BEFORE the migration runs, or it cannot clean them", () => {
  const caps = WIZARD_SRC.indexOf("state.targetCaps = (i.targetCaps");
  const mig = WIZARD_SRC.indexOf("migratePriorities(state.priorities");
  assert.ok(caps > 0 && mig > 0);
  assert.ok(caps < mig,
    "targetCaps/targetFloors must be restored before the migration, otherwise the " +
    "restore overwrites the cleanup and the orphaned bound comes back");
});

test("#169: the disclosure banner escapes its message", () => {
  const at = WIZARD_SRC.indexOf("function migrationBanner");
  assert.ok(at > 0, "the banner helper exists");
  const fn = WIZARD_SRC.slice(at, at + 500);
  assert.ok(/esc\(state\.expandedAwayMigrated\)/.test(fn),
    "the message carries user-typed stat names into innerHTML and must be escaped");
});


// ---- U2 (declared stat credits) — declaration input and query plumbing -------
{
  const M = require("../web/model.js");
  const K = (s, t) => creditKey(s, t);

  test("U2: creditKey pairs stat and bonus type — a stat alone cannot key R2", () => {
    assert.strictEqual(K("Combat Mastery", "Insight"), "Combat Mastery||Insight");
    assert.notStrictEqual(K("Combat Mastery", "Insight"), K("Combat Mastery", "Sacred"),
      "two bonus types on one stat must be distinct entries");
    assert.strictEqual(K(" Combat Mastery ", " Insight "), K("Combat Mastery", "Insight"));
  });

  test("U2: a declared credit reaches the query with its stat canonicalized", () => {
    // KTD4 — the solver matches a bucket's stat half by EXACT string with no
    // aliasing, so a non-canonical name does not error: it forms an orphan bucket
    // that silently contributes nothing.
    const vocab = { canonical: (v) => (v === "PRR" ? "Physical Resistance Rating" : v) };
    const out = cleanCreditMap({ "PRR||Insight": { stat: "PRR", bonus_type: "Insight", value: 7 } }, vocab);
    assert.deepStrictEqual(Object.keys(out), ["Physical Resistance Rating||Insight"]);
    assert.strictEqual(out["Physical Resistance Rating||Insight"].stat, "Physical Resistance Rating");
  });

  test("U2: empty, non-numeric, zero, and negative values are dropped", () => {
    for (const bad of ["", " ", "abc", 0, -1, null, undefined, NaN]) {
      const out = cleanCreditMap({ "CM||Insight": { stat: "CM", bonus_type: "Insight", value: bad } });
      assert.deepStrictEqual(out, {}, `value ${JSON.stringify(bad)} must not reach the query`);
    }
  });

  test("U2: the wizard cannot accept a credit the solver would drop", () => {
    // cleanCreditMap delegates to the SAME normalizeCredits the solver uses, so the
    // two cannot disagree about validity — the divergence class that shipped a
    // `stat||undefined` bucket and a string-valued coefficient in U1.
    for (const bad of ["insight", "Insightful", "", "Bool"]) {
      assert.deepStrictEqual(cleanCreditMap({ k: { stat: "CM", bonus_type: bad, value: 7 } }), {},
        `bonus type ${JSON.stringify(bad)} must be refused`);
    }
    assert.strictEqual(Object.keys(cleanCreditMap({ k: { stat: "CM", bonus_type: "Insight", value: "7" } })).length, 1,
      "a numeric string is coerced, not refused");
  });

  test("U2: Morale is declarable — the additive-only case must be reachable", () => {
    // No item in the catalog carries Morale, so a vocabulary derived from the data
    // would make the Spell Song Trance credit undeclarable. AE4 depends on this.
    assert.ok(M.CREDIT_BONUS_TYPES.includes("Morale"));
    const out = cleanCreditMap({ k: { stat: "Spell DC", bonus_type: "Morale", value: 1 } });
    assert.strictEqual(Object.keys(out).length, 1);
    const names = new Set(realData.items.flatMap((i) => (i.affixes || [])
      .filter((a) => a.type === "Morale").map((a) => a.name)));
    assert.strictEqual(names.size, 0, "premise: no shipped item carries a Morale-typed affix");
  });

  test("U2: two bonus types on one stat both survive; the same type collapses", () => {
    const two = cleanCreditMap({
      a: { stat: "CM", bonus_type: "Insight", value: 7 },
      b: { stat: "CM", bonus_type: "Sacred", value: 4 },
    });
    assert.strictEqual(Object.keys(two).length, 2, "R2 — distinct bonus types are distinct credits");
    const dup = cleanCreditMap({
      a: { stat: "CM", bonus_type: "Insight", value: 4 },
      b: { stat: "CM", bonus_type: "Insight", value: 9 },
    });
    assert.strictEqual(Object.keys(dup).length, 1, "the same pair does not duplicate");
    assert.strictEqual(dup["CM||Insight"].value, 9, "and keeps the larger, matching max-of-type");
  });

  test("U2: Covers R3 — an undeclared build's query is unchanged from today", () => {
    const s = baseState();
    const q = buildQuery(s);
    assert.deepStrictEqual(q.declaredCredits, {}, "no credits declared => an empty map");
    const withEmpty = buildQuery({ ...s, declaredCredits: {} });
    assert.deepStrictEqual(withEmpty, q, "an empty map is indistinguishable from absent");
  });

  test("U2: buildQuery carries a declared credit through", () => {
    const q = buildQuery({ ...baseState(),
      declaredCredits: { "Constitution||Insight": { stat: "Constitution", bonus_type: "Insight", value: 6 } } });
    assert.deepStrictEqual(q.declaredCredits,
      { "Constitution||Insight": { stat: "Constitution", bonus_type: "Insight", value: 6 } });
  });

  // ---- DOM behaviour, asserted against the source (this suite has no jsdom) ----

  test("U2: the drag guard matches SELECT as well as INPUT", () => {
    // draggable="false" on a child does not stop the nearest draggable ancestor
    // from becoming the drag source, and stopPropagation on pointerdown does not
    // suppress the native drag — the tagName test is the part that works, and a
    // <select> does not match `tagName === "INPUT"`.
    const at = WIZARD_SRC.indexOf("li.ondragstart");
    assert.ok(at > 0, "the drag handler exists");
    const fn = WIZARD_SRC.slice(at, at + 260);
    assert.ok(/tagName === "SELECT"/.test(fn),
      "the bonus-type <select> would otherwise start a row reorder when dragged");
    assert.ok(/tagName === "INPUT"/.test(fn), "and the original input guard is intact");
  });

  test("U2: deleting a priority row drops EVERY credit on that stat", () => {
    // AE5 via A1 — a keyed input that outlives its row is the orphaned-bound
    // defect already recorded in this repo, and a stat can carry several credits.
    const at = WIZARD_SRC.indexOf("dataset.del != null");
    assert.ok(at > 0);
    const branch = WIZARD_SRC.slice(at, at + 900);
    assert.ok(/declaredCredits/.test(branch), "the delete branch sweeps credits");
    assert.ok(/for \(const \[k, c\] of Object\.entries\(state\.declaredCredits\)\)/.test(branch),
      "it iterates rather than deleting a single stat-keyed entry");
  });

  test("U2: the add affordance cannot produce a duplicate (stat, type) pair", () => {
    const at = WIZARD_SRC.indexOf("dataset.cadd != null");
    assert.ok(at > 0, "the add handler exists");
    const branch = WIZARD_SRC.slice(at, at + 500);
    assert.ok(/used\.has\(t\)/.test(branch), "it picks the first UNUSED bonus type");
    assert.ok(/_creditBonusTypes/.test(branch), "from the curated vocabulary, not a literal");
  });

  test("U2: the selector renders from the curated vocabulary and marks used types", () => {
    const at = WIZARD_SRC.indexOf("function creditsHTML");
    assert.ok(at > 0, "the sub-row renderer exists");
    const fn = WIZARD_SRC.slice(at, WIZARD_SRC.indexOf("\n    }", at));
    assert.ok(/_creditBonusTypes\.map/.test(fn), "options come from the shared list");
    assert.ok(/usedTypes\.has\(t\)/.test(fn), "already-declared types are disabled");
    assert.ok(/esc\(/.test(fn), "stat and type names reach innerHTML and must be escaped");
  });

  test("U2: the credit controls are labelled for screen readers", () => {
    const at = WIZARD_SRC.indexOf("function creditsHTML");
    const fn = WIZARD_SRC.slice(at, WIZARD_SRC.indexOf("\n    }", at));
    for (const needle of ["wz-credit-val", "wz-credit-type", "data-crem", "data-cadd"]) {
      assert.ok(fn.includes(needle), `${needle} is rendered`);
    }
    const labels = fn.match(/aria-label=/g) || [];
    assert.ok(labels.length >= 4,
      `every credit control needs a label; found ${labels.length}`);
  });
}

test("U2: the wizard's own call sites pass the real vocabulary", () => {
  // Regression: buildQuery originally read `state.canonical`, which nothing ever
  // sets — so the KTD4 canonicalization silently never ran in the app while the
  // unit test passed its own function and looked green. It now takes the whole
  // vocabulary, because the presence set gates credits too.
  assert.ok(!/state\.canonical/.test(WIZARD_SRC),
    "state.canonical does not exist; reading it is dead code");
  const calls = (WIZARD_SRC.match(/(?<!function )buildQuery\(state[^)]*\)/g) || []);
  assert.ok(calls.length >= 3, `expected the in-app call sites; found ${calls.length}`);
  for (const c of calls) {
    assert.ok(/\bvocab\b/.test(c),
      `every in-app buildQuery call must pass the vocabulary, got: ${c}`);
  }
});

test("U2: a presence (on/off) stat cannot carry a magnitude credit", () => {
  // Reproduced before the gate: targets ["Constitution","Blurry"], floor Blurry>=1,
  // one Goggles slot offering the Blurry item or a Constitution item. Declaring
  // Insight 3 on Blurry moved the solve from {Constitution:0, Blurry:1} with the
  // Blurry item equipped, to {Constitution:10, Blurry:3} WITHOUT it — the
  // meaningless magnitude satisfied the floor and the feature was dropped, while
  // the result still claimed Blurry at 3.
  const vocab = { canonical: (v) => v, presence: new Set(["Blurry"]) };
  const out = cleanCreditMap({
    "Blurry||Insight": { stat: "Blurry", bonus_type: "Insight", value: 3 },
    "Constitution||Insight": { stat: "Constitution", bonus_type: "Insight", value: 6 },
  }, vocab);
  assert.deepStrictEqual(Object.keys(out), ["Constitution||Insight"],
    "a presence stat's credit must never reach the query");
});

test("U2: the credit control is not offered on a presence row", () => {
  const at = WIZARD_SRC.indexOf("${creditsHTML(p)}");
  assert.ok(at > 0 || /presence.*creditsHTML/.test(WIZARD_SRC), "the sub-row is rendered somewhere");
  const call = WIZARD_SRC.match(/[^\n]*creditsHTML\(p\)[^\n]*/)[0];
  assert.ok(/vocab\.presence/.test(call),
    `the render must be gated on the presence set, got: ${call.trim()}`);
});

test("U2: loading a character resets declared credits", () => {
  // state is long-lived. Without a reset, a credit declared on the previous
  // character stays live: the first render uses the stored query and looks right,
  // then Re-solve reads live state and solves the loaded character with a bonus
  // nobody declared for it.
  const at = WIZARD_SRC.indexOf("state.targetFloors = (i.targetFloors");
  assert.ok(at > 0, "the restore block exists");
  const block = WIZARD_SRC.slice(at, at + 900);
  assert.ok(/state\.declaredCredits\s*=/.test(block),
    "declaredCredits must be reset alongside its sibling maps in loadCharacter");
});

test("U2: an unusable credit row neither reads as declared nor reserves its type", () => {
  const at = WIZARD_SRC.indexOf("function creditsHTML");
  const fn = WIZARD_SRC.slice(at, WIZARD_SRC.indexOf("\n    }", at));
  assert.ok(/is-incomplete/.test(fn), "an unusable row is visually marked");
  assert.ok(/filter\(\[, c\]\) => usable\(c\.value\)\)|filter\(\(\[, c\]\) => usable\(c\.value\)\)/.test(fn),
    "usedTypes counts only rows the solver would keep");
});

// ---- U5 — declared credits persist with the character (R11) -----------------

test("credits are restored BEFORE the priority migration runs", () => {
  // Same ordering constraint as the bounds (#169): the migration cleans stat-keyed
  // state, so a restore that ran after it would overwrite the cleanup and bring
  // the orphan back. Forward guard — the restore landed in U2, not U5, so this
  // asserts the ordering stays correct rather than covering the U5 diff.
  const cred = WIZARD_SRC.indexOf("state.declaredCredits = (i.declaredCredits");
  const mig = WIZARD_SRC.indexOf("migratePriorities(state.priorities");
  assert.ok(cred > 0, "the credit restore exists in loadCharacter");
  assert.ok(mig > 0);
  assert.ok(cred < mig,
    "declaredCredits must be restored before the migration, or the restore undoes the sweep");
});

test("U5: a dropped credit is disclosed as a credit, not as a min/max", () => {
  // The sweep is only half the job. Reusing the bounds channel told a player who
  // had a credit but no cap/floor that "the min/max you had set was removed" — a
  // limit they never set — and never mentioned the bonus that actually vanished.
  const { migrationMessage } = require("../web/dataset.js");
  const subs = [{ from: "Speed", to: ["Striding", "Movement Speed"] }];

  const creditOnly = migrationMessage(subs, [], ["Speed"]);
  assert.ok(/already have/.test(creditOnly), "the credit is named as a credit");
  assert.ok(!/min\/max/.test(creditOnly),
    `a dropped credit must not be reported as a dropped bound: ${creditOnly}`);

  const boundOnly = migrationMessage(subs, ["Speed"], []);
  assert.ok(/min\/max/.test(boundOnly) && !/already have/.test(boundOnly),
    "and a dropped bound is still reported as a bound");

  const both = migrationMessage(subs, ["Speed"], ["Speed"]);
  assert.ok(/min\/max/.test(both) && /already have/.test(both), "both are disclosed when both drop");

  // The stat-keyed bounds loop cannot reach a `stat||bonusType` key, so the sweep
  // must match on the entry's own stat.
  const at = WIZARD_SRC.indexOf("for (const sub of migrated.substitutions)");
  const loop = WIZARD_SRC.slice(at, at + 1000);
  assert.ok(/c\.stat === sub\.from/.test(loop) && /droppedCredits\.push/.test(loop),
    "the sweep matches on the credit's stat and reports through its own channel");
});

test("U5: the credit map is in the persistence allowlist the wizard state feeds", () => {
  const { INPUT_KEYS } = require("../web/persist.js");
  assert.ok(INPUT_KEYS.includes("declaredCredits"));
  // The state initializer must define the field, or a never-declared character
  // saves `undefined` and the loader cannot tell it from a pre-feature save.
  assert.ok(/declaredCredits: \{\},/.test(WIZARD_SRC),
    "state initializes declaredCredits so the saved shape is always a map");
});

console.log(`\n${passed} passed`);
