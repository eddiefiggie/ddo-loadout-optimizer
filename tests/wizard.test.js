// U1 — wizard step-machine pure helpers. Run: node tests/wizard.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { WIZARD_STEPS, canAdvance, nextStep, prevStep, wizIsForged, buildQuery, cleanBoundMap, cleanCreditMap, creditKey, creditIsUsable, isPresenceOnly, isUntypedOnly, canDeclareCredit, advancedRowModel, advancedBadgeText, openPanels, openPanelToggle, openPanelSweep, openPanelClear, panelOpenAttr, stepAfterLoad, curatedStats, pickerVocabulary, PRESET_BUNDLES, BUNDLE_GROUPS, resolveBundle, addBundle, twfMigrationNeeded, pinWornSlotOf, pinHandsFor, pinIdOf, applyPin, applyPinId, removePinFrom, reconcilePinLegality, dualPinMutexConflict, resolvePriorityAdd, addBlocks, removeBlock, pinBlockedConflict, blockPinOverlap, blockStale, blockLoadMessage, noDropNote, rungFromInputs } = require("../web/wizard.js");
const { normalizeDataset, buildPickerVocabulary } = require("../web/dataset.js");
const realData = normalizeDataset(JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8")));

const baseState = () => ({ ml: 34, race: "Human", armor: "", oath: "", alignment: "",
  style: "", weaponTypes: [], offHand: [], offHandWeapons: [],
  priorities: ["Constitution"], slotConstraints: {} });

// plan 005 — a minimal picker vocabulary with two known presence stats, for the
// Advanced-row model and the presence-bound guard. Declared up here because tests
// run at call time, and several call sites precede the plan-005 block below.
const presenceVocab = { canonical: (v) => v, presence: new Set(["Blurry", "Ghostly"]) };

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

test("#91 (review fix) canAdvance(priorities): a sentinel-only list does not satisfy the gate", () => {
  // A freshly-born priority list is [UTILITY_SENTINEL] (newPriorityList) — the
  // player has ranked nothing. `length > 0` alone would wrongly pass this.
  const { UTILITY_SENTINEL: SENT } = require("../web/model.js");
  assert.ok(!canAdvance("priorities", { priorities: [SENT] }),
    "sentinel-only must block, exactly like an empty list did pre-feature");
  assert.ok(canAdvance("priorities", { priorities: [SENT, "Constitution"] }),
    "one real stat alongside the sentinel passes");
  assert.ok(canAdvance("priorities", { priorities: ["Constitution", SENT] }),
    "order does not matter");
});

test("#91 (review fix) canAdvance(priorities): removing the last real stat re-blocks", () => {
  const { UTILITY_SENTINEL: SENT } = require("../web/model.js");
  let priorities = [SENT, "Constitution"];
  assert.ok(canAdvance("priorities", { priorities }));
  priorities = priorities.filter((p) => p !== "Constitution");   // player removes the only real stat
  assert.deepStrictEqual(priorities, [SENT]);
  assert.ok(!canAdvance("priorities", { priorities }),
    "back down to sentinel-only re-blocks the gate");
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

// ---------------------------------------------------------------------------
// #346 (U1/U2) — the crafting/augment ladder at the query boundary.

test("#346: buildQuery threads the rung and fails open to the top", () => {
  assert.strictEqual(buildQuery(baseState()).craftingRung, "everything",
    "an absent rung (pre-feature state) reads as the top rung");
  for (const r of ["everything", "no-niche-crafting", "no-solar-lunar", "printed-only"]) {
    assert.strictEqual(buildQuery({ ...baseState(), craftingRung: r }).craftingRung, r);
  }
  assert.strictEqual(buildQuery({ ...baseState(), craftingRung: "nonsense" }).craftingRung, "everything",
    "a hand-edited value fails open rather than reaching the solver");
});

// KTD4 — the control retains the player's typed ceiling, but the SOLVED query
// must not carry it on a rung that placed no augments, or the results assert a
// restriction that did nothing. This is the honesty half of R6.
test("#346: a rung that excludes augments nulls the ceiling in the solved query", () => {
  const withCeiling = { ...baseState(), ml: 34, augCeiling: 30 };
  assert.strictEqual(buildQuery({ ...withCeiling, craftingRung: "everything" }).augCeiling, 30);
  assert.strictEqual(buildQuery({ ...withCeiling, craftingRung: "no-niche-crafting" }).augCeiling, 30);
  assert.strictEqual(buildQuery({ ...withCeiling, craftingRung: "no-solar-lunar" }).augCeiling, 30,
    "the Solar/Lunar rung still admits 819 augments, so the ceiling still means something");
  assert.strictEqual(buildQuery({ ...withCeiling, craftingRung: "printed-only" }).augCeiling, null,
    "the bottom rung places no augment, so the solve carries no augment restriction");
});

// R6 — the typed value survives the round trip. The player who sets a ceiling,
// drops to printed-only, then climbs back must find their number intact; only
// the QUERY forgets it, never the state.
test("#346: the ceiling value survives a trip down to the bottom rung and back", () => {
  const state = { ...baseState(), ml: 34, augCeiling: 28, craftingRung: "everything" };
  state.craftingRung = "printed-only";
  assert.strictEqual(buildQuery(state).augCeiling, null, "the solve forgets it");
  assert.strictEqual(state.augCeiling, 28, "the state does not");
  state.craftingRung = "no-solar-lunar";
  assert.strictEqual(buildQuery(state).augCeiling, 28, "climbing back restores it to the solve");
});

// #346 (U3, KTD3, AE6) — the migration. This is the highest-consequence line in
// the feature: a wrong derivation silently changes the loadout of every saved
// character, with no signal to the player that anything moved.
test("#346: a pre-ladder save migrates to the rung its boolean meant", () => {
  assert.strictEqual(rungFromInputs({}), "everything",
    "a save from before #245 (no boolean at all) loads unrestricted");
  assert.strictEqual(rungFromInputs({ excludeCraftingSystems: false }), "everything",
    "the checkbox unticked meant nothing was excluded");
  assert.strictEqual(rungFromInputs({ excludeCraftingSystems: true }), "no-niche-crafting",
    "the checkbox ticked meant exactly the niche-crafting rung — never lower");
});

test("#346: a stored rung always wins over the legacy boolean", () => {
  assert.strictEqual(rungFromInputs({ craftingRung: "printed-only", excludeCraftingSystems: true }),
    "printed-only", "a stale boolean beside a rung cannot override it");
  assert.strictEqual(rungFromInputs({ craftingRung: "everything", excludeCraftingSystems: true }),
    "everything", "including when the boolean would imply a LOWER rung");
  assert.strictEqual(rungFromInputs({ craftingRung: "nonsense", excludeCraftingSystems: true }),
    "everything", "a hand-edited rung fails open rather than falling back to the boolean");
  assert.strictEqual(rungFromInputs(null), "everything", "a missing record does not throw");
});

test("buildQuery threads the optional mlFloor (blank/0 -> null)", () => {
  assert.strictEqual(buildQuery({ ...baseState(), mlFloor: 30 }).mlFloor, 30);
  assert.strictEqual(buildQuery({ ...baseState(), mlFloor: "" }).mlFloor, null);
  assert.strictEqual(buildQuery(baseState()).mlFloor, null);
});

test("#339: buildQuery owns the augCeiling clamp — emitted only when positive and STRICTLY below the cap", () => {
  assert.strictEqual(buildQuery({ ...baseState(), ml: 36, augCeiling: 32 }).augCeiling, 32, "a real ceiling threads through");
  assert.strictEqual(buildQuery({ ...baseState(), ml: 30, augCeiling: 32 }).augCeiling, null,
    "a STALE ceiling above a later-lowered cap re-normalizes to unrestricted at query time");
  assert.strictEqual(buildQuery({ ...baseState(), ml: 36, augCeiling: 36 }).augCeiling, null, "ceiling equal to the cap is unrestricted");
  assert.strictEqual(buildQuery({ ...baseState(), ml: 36, augCeiling: 40 }).augCeiling, null, "ceiling above the cap is unrestricted");
  assert.strictEqual(buildQuery({ ...baseState(), augCeiling: 0 }).augCeiling, null, "0/blank means unrestricted");
  assert.strictEqual(buildQuery({ ...baseState(), augCeiling: "" }).augCeiling, null);
  assert.strictEqual(buildQuery(baseState()).augCeiling, null, "a pre-feature state (no field) is unrestricted");
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
  // Enumerate from BUNDLE_GROUPS itself rather than a hardcoded list of group
  // names: the hardcoded version silently skipped any NEW group, so plan 005's
  // `attributes` row would have shipped unguarded and a later dead target in it
  // would have gone green.
  const allKeys = Object.values(BUNDLE_GROUPS).flat();
  assert.deepStrictEqual([...new Set(allKeys)].length, allKeys.length, "no bundle is listed in two groups");
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

test("bundle disclosure: retired — every row is visible from the start", () => {
  // The reveal map is gone, not inert. It never worked (a class `display: flex`
  // beat the UA `[hidden]` rule), the flat layout is the chosen behavior, and a
  // dead map with tests pinning its contents is the unfalsifiable shape #185
  // shipped eight of.
  assert.strictEqual(require("../web/wizard.js").BUNDLE_REVEALS, undefined,
    "BUNDLE_REVEALS is no longer exported");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  assert.ok(!/BUNDLE_REVEALS/.test(src), "and no longer referenced anywhere");
  assert.ok(!/data-group="[a-z]+" hidden/.test(src), "no bundle row ships hidden");
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
    const fn = WIZARD_SRC.slice(at, at + 420);
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
  // plan 005 moved the gate: credits now render only inside the Advanced panel,
  // and R6 gives a presence row no panel at all. So the guarantee is one step
  // removed from the markup — assert both halves.
  assert.deepStrictEqual(advancedRowModel("Blurry", {
    declaredCredits: { [creditKey("Blurry", "Insight")]: { stat: "Blurry", bonus_type: "Insight", value: 3 } },
  }, presenceVocab).credits, [], "a presence row is offered no credit, panel or not");
  const rows = WIZARD_SRC.slice(WIZARD_SRC.indexOf("function rankedHTML"), WIZARD_SRC.indexOf("function advancedHTML"));
  assert.ok(!/creditsHTML/.test(rows), "the row body never renders credits directly");
  const panel = WIZARD_SRC.slice(WIZARD_SRC.indexOf("function advancedHTML"), WIZARD_SRC.indexOf("function creditsHTML"));
  assert.ok(/creditsHTML\(stat/.test(panel), "credits render inside the panel, nowhere else");
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
  assert.ok(/filter\(\(c\) => c\.usable\)/.test(fn),
    "usedTypes counts only rows the solver would keep");
  // The `usable` flag now comes from the shared module-scope predicate via the
  // row model, so the markup and the badge cannot disagree about the same row.
  assert.ok(/creditIsUsable\(/.test(WIZARD_SRC.slice(
    WIZARD_SRC.indexOf("function advancedRowModel"), WIZARD_SRC.indexOf("const openPanels"))),
    "the row model decides usability with the shared predicate");
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

// ---- plan 005 U1 — the pure Advanced-row model -------------------------------
// These exist because rankedHTML/renderRankedList live inside the DOM closure and
// this suite has no jsdom: without the extraction, R5's badge and R6's presence
// rule could only ever be eyeballed in a browser.

test("U1: an on/off row keeps min/max but is offered no credit", () => {
  // R6 as planned removed the whole control from on/off rows. That was wrong: the
  // Bool bucket is part of the stat's solver expression, so `min 1 Ghostly` is a
  // working hard constraint. Only credits are refused there.
  const m = advancedRowModel("Blurry", {
    targetFloors: { Blurry: 1 },
    declaredCredits: { [creditKey("Blurry", "Insight")]: { stat: "Blurry", bonus_type: "Insight", value: 3 } },
  }, presenceVocab);
  assert.strictEqual(m.floor, 1, "the floor is live — min 1 is a hard 'must have this'");
  assert.deepStrictEqual(m.credits, [], "but no credit is offered");
  assert.strictEqual(m.canCredit, false, "and the affordance itself is suppressed");
  assert.strictEqual(advancedRowModel("Constitution", {}, presenceVocab).canCredit, true);
  // The button must be gated too, not just the rows: rendering it while the model
  // refuses the result gave a control that wrote invisible state on every click.
  const panel = WIZARD_SRC.slice(WIZARD_SRC.indexOf("function advancedHTML"), WIZARD_SRC.indexOf("function creditsHTML"));
  assert.ok(/adv\.canCredit \? /.test(panel), "the credit block renders only when the stat can carry one");
  // and the row still reads as on/off in the markup
  const rows = WIZARD_SRC.slice(WIZARD_SRC.indexOf("function rankedHTML"), WIZARD_SRC.indexOf("function advancedHTML"));
  assert.ok(/isPresenceOnly\(p, vocab\) \? ` <span class="rank-tag"/.test(rows),
    "the on/off badge keys on the presence test, not on a field that is always true");
  assert.ok(!/hasAdvanced/.test(rows), "no dead always-true branch left in the row markup");
});

test("U1: badgeCount counts a floor, a cap, and each usable credit", () => {
  const stat = "Constitution";
  assert.strictEqual(advancedRowModel(stat, {}, presenceVocab).badgeCount, 0);
  assert.strictEqual(advancedRowModel(stat, { targetFloors: { [stat]: 20 } }, presenceVocab).badgeCount, 1);
  assert.strictEqual(
    advancedRowModel(stat, { targetFloors: { [stat]: 20 }, targetCaps: { [stat]: 40 } }, presenceVocab).badgeCount, 2);
  const withCredits = advancedRowModel(stat, {
    targetFloors: { [stat]: 20 }, targetCaps: { [stat]: 40 },
    declaredCredits: {
      [creditKey(stat, "Insight")]: { stat, bonus_type: "Insight", value: 7 },
      [creditKey(stat, "Quality")]: { stat, bonus_type: "Quality", value: 3 },
    },
  }, presenceVocab);
  assert.strictEqual(withCredits.badgeCount, 4);
});

test("U1: an unusable credit never inflates the badge", () => {
  // The badge is a claim that N settings are applied. A blank, zero, or
  // over-range credit is dropped by normalizeCredits on the way to the query, so
  // counting it would advertise a setting the solve refuses.
  const stat = "Combat Mastery";
  for (const bad of ["", 0, -3, 1.5, 99999]) {
    const m = advancedRowModel(stat, {
      declaredCredits: { [creditKey(stat, "Insight")]: { stat, bonus_type: "Insight", value: bad } },
    }, presenceVocab);
    assert.strictEqual(m.badgeCount, 0, `value ${JSON.stringify(bad)} must not count`);
    assert.strictEqual(m.credits.length, 1, "the row is still rendered, just not counted");
    assert.strictEqual(m.credits[0].usable, false);
  }
  const good = advancedRowModel(stat, {
    declaredCredits: { [creditKey(stat, "Insight")]: { stat, bonus_type: "Insight", value: 7 } },
  }, presenceVocab);
  assert.strictEqual(good.badgeCount, 1);
  assert.strictEqual(good.credits[0].usable, true);
});

test("U1: absent bound/credit maps do not throw", () => {
  const m = advancedRowModel("Dodge", {}, presenceVocab);
  assert.strictEqual(m.floor, null);
  assert.strictEqual(m.cap, null);
  assert.deepStrictEqual(m.credits, []);
  assert.doesNotThrow(() => advancedRowModel("Dodge", null, null));
  assert.doesNotThrow(() => advancedRowModel("Dodge", { targetCaps: "nope" }, null));
});

test("U1: a stat named __proto__ does not read Object.prototype as a bound", () => {
  // `{}["__proto__"]` is Object.prototype, which is neither null nor "", so a
  // plain truthiness read would report a floor nobody set.
  const m = advancedRowModel("__proto__", { targetFloors: {}, targetCaps: {} }, null);
  assert.strictEqual(m.floor, null);
  assert.strictEqual(m.cap, null);
  assert.strictEqual(m.badgeCount, 0);
});

test("U1: the wizard markup and the row model share one usable-credit predicate", () => {
  // Two copies of this rule would drift, and the drift is invisible: the badge
  // would count a credit the row is simultaneously dimming as incomplete.
  assert.ok(/function creditIsUsable\(/.test(WIZARD_SRC));
  assert.ok(!/const usable = \(v\) =>/.test(WIZARD_SRC),
    "creditsHTML's local `usable` arrow is gone — it calls the shared predicate");
});

// ---- F2 — a bound on a presence stat cannot survive R6 ------------------------


test("F2: cleanBoundMap without a vocab keeps its prior behavior exactly", () => {
  assert.deepStrictEqual(cleanBoundMap({ Blurry: 3, Constitution: 20 }), { Blurry: 3, Constitution: 20 });
  assert.deepStrictEqual(cleanBoundMap({ a: "", b: null, c: -1, d: "x", e: 0 }), { e: 0 });
});


test("F2: every rankable stat keeps its Advanced control against the REAL vocab", () => {
  // The bug this catches: `vocab.presence` means "appears as Bool on at least one
  // item", not "has no magnitude". Four stats are in both sets — Deception, Smoke
  // Screen, Protection from Evil, Underwater Action — and gating on `presence`
  // alone hid their min/max AND silently dropped any floor already set on them.
  // The hand-built presenceVocab above could never surface this; only the real one can.
  const rv = buildPickerVocabulary(realData);
  // The magnitude set must come from the CURATED rankable list. A raw
  // `_rankableType` scan calls an untyped affix row rankable, and most on/off
  // weapon effects carry one alongside their Bool line — that pulled 57 extra
  // stats (Holy, Vampirism, Wounding, the Bane lines) out of the credit gate and
  // reopened the defect it exists to block. Intended overlap is exactly the
  // dual-nature four.
  const leaked = [...rv.presence].filter((x) => rv.magnitude.has(x));
  assert.deepStrictEqual(leaked.sort(),
    ["Deception", "Protection from Evil", "Smoke Screen", "Underwater Action"],
    `only the dual-nature stats may escape the presence gate; got ${leaked.length}`);
  for (const stat of realData.metadata.rankable_affixes) {
    assert.strictEqual(isPresenceOnly(stat, rv), false, `${stat} has a magnitude bucket`);
  }
  for (const weapon of ["Holy", "Vampirism", "Wounding", "Paralyzing"]) {
    if (!rv.presence.has(weapon)) continue;
    assert.strictEqual(isPresenceOnly(weapon, rv), true,
      `${weapon} is an on/off effect and must stay behind the credit gate`);
  }
});

test("F2: a floor on a dual-nature stat survives to the query", () => {
  const rv = buildPickerVocabulary(realData);
  const dual = realData.metadata.rankable_affixes.find((s) => rv.presence.has(s));
  const state = Object.assign(baseState(), { priorities: [dual], targetFloors: { [dual]: 5 } });
  assert.deepStrictEqual(buildQuery(state, rv).targetFloors, { [dual]: 5 },
    `${dual} carries a real magnitude, so its floor must reach the solver`);
});

test("F2: cleanBoundMap does not canonicalize keys", () => {
  // buildModel derives solver targets from bound-map keys, so rewriting a stale
  // non-canonical key would both resurrect a dead bound and mint a target the
  // player never ranked. Credits canonicalize; bounds must not.
  const aliasVocab = { canonical: (v) => (v === "PRR" ? "Physical Sheltering" : v), presence: new Set(), magnitude: new Set() };
  assert.deepStrictEqual(cleanBoundMap({ PRR: 50 }, aliasVocab), { PRR: 50 });
});




test("KTD1: the markup READS the open set — the seam, not just the Set", () => {
  // The mutation that reverts KTD1 entirely is deleting the read from the
  // template: every panel then renders closed, so the panel snaps shut on the
  // very click it exists to survive. The Set-API tests below cannot see that.
  openPanelClear();
  assert.strictEqual(panelOpenAttr("Constitution"), "", "closed by default");
  openPanelToggle("Constitution", true);
  assert.strictEqual(panelOpenAttr("Constitution"), " open");
  assert.strictEqual(panelOpenAttr("Dodge"), "", "only the opened stat");
  openPanelClear();
  assert.strictEqual(panelOpenAttr("Constitution"), "");
  const panel = WIZARD_SRC.slice(WIZARD_SRC.indexOf("function advancedHTML"), WIZARD_SRC.indexOf("function creditsHTML"));
  assert.ok(/\$\{panelOpenAttr\(stat\)\}/.test(panel), "the markup renders that attribute");
});

test("KTD1: opening a panel WRITES to the set", () => {
  // The other half of the seam: without the toggle binding nothing is ever
  // recorded, so every rebuild renders every panel closed.
  const wire = WIZARD_SRC.slice(WIZARD_SRC.indexOf("function renderRankedList"));
  assert.ok(/ontoggle\s*=\s*\(\)\s*=>\s*openPanelToggle\(d\.dataset\.adv,\s*d\.open\)/.test(wire),
    "each panel's toggle records its own stat and open state");
});

test("R5: refreshBadge writes the shared summary, not just anything", () => {
  // Asserting the call sites is not enough — a refreshBadge whose body does
  // nothing leaves the badge one render stale, which is the original bug.
  const wire = WIZARD_SRC.slice(WIZARD_SRC.indexOf("function renderRankedList"));
  const body = wire.slice(wire.indexOf("const refreshBadge"), wire.indexOf("const refreshBadge") + 400);
  assert.ok(/innerHTML\s*=\s*advSummaryHTML\(advancedRowModel\(/.test(body),
    "the patched summary comes from the same model the full render uses");
});

test("F2: a declared credit on a dual-nature stat survives to the query", () => {
  // The credit gate was loosened from bare `presence` to `isPresenceOnly` for
  // the same reason the bound gate was. Without this, reverting that one line
  // silently drops the player's credit on those four stats.
  const rv = buildPickerVocabulary(realData);
  const dual = realData.metadata.rankable_affixes.find((s) => rv.presence.has(s));
  const state = Object.assign(baseState(), {
    priorities: [dual],
    declaredCredits: { [creditKey(dual, "Insight")]: { stat: dual, bonus_type: "Insight", value: 4 } },
  });
  const out = buildQuery(state, rv).declaredCredits;
  assert.strictEqual(Object.keys(out).length, 1, `${dual} carries a magnitude, so its credit is valid`);
  // and an on/off-only stat's credit is still refused
  const onOff = [...rv.presence].find((s) => !rv.magnitude.has(s));
  const s2 = Object.assign(baseState(), {
    priorities: [onOff],
    declaredCredits: { [creditKey(onOff, "Insight")]: { stat: onOff, bonus_type: "Insight", value: 4 } },
  });
  assert.deepStrictEqual(buildQuery(s2, rv).declaredCredits, {});
});

test("KTD6: the drag guard covers the whole panel, not just INPUT/SELECT", () => {
  // A click on the count badge has tagName SPAN and a drag on the relocated
  // prose has P — the tagName allowlist misses both, so either would start a
  // row reorder instead of toggling or selecting.
  const at = WIZARD_SRC.indexOf("li.ondragstart");
  const guard = WIZARD_SRC.slice(at, at + 320);
  assert.ok(/closest\("details\.wz-adv"\)/.test(guard),
    "anything inside the panel is panel interaction, never a drag handle");
  assert.ok(/tagName === "INPUT"/.test(guard) && /tagName === "SELECT"/.test(guard),
    "and the original tagName clauses survive for controls outside the panel");
});

test("D1: adding or removing a credit restores focus after the rebuild", () => {
  // ol.innerHTML = rankedHTML() destroys the focused element, so without this a
  // player who clicks "+ already have" gets the panel they expect and a caret
  // nowhere — focus falls to <body>.
  const wire = WIZARD_SRC.slice(WIZARD_SRC.indexOf("function renderRankedList"));
  const cadd = wire.slice(wire.indexOf("b.dataset.cadd != null"), wire.indexOf("b.dataset.crem != null"));
  assert.ok(/after = \(\) => focusCreditValue\(key\)/.test(cadd), "add lands the caret in the new field");
  const crem = wire.slice(wire.indexOf("b.dataset.crem != null"), wire.indexOf("rerender();"));
  assert.ok(/after = \(\) => focusSummary\(stat\)/.test(crem), "remove goes up a level");
  assert.ok(/rerender\(\);\s*\n\s*if \(after\) after\(\);/.test(wire), "and it runs AFTER the rebuild");
});

test("bundles: a hidden sub-row is actually hidden", () => {
  // Pre-existing: `.wz-bundle-row { display: flex }` is a class rule, so it beats
  // the UA stylesheet's `[hidden] { display: none }`. The tactics/schools/spell-power
  // rows shipped with `hidden` set and rendered anyway, so the reveal wired in
  // BUNDLE_REVEALS never hid anything. Found while verifying the Attributes row.
  const css = fs.readFileSync(path.join(__dirname, "..", "web", "styles.css"), "utf-8");
  assert.ok(/\.wz-bundle-row\[hidden\]\s*\{[^}]*display:\s*none/.test(css),
    "an explicit [hidden] rule overrides the class display");
  // The Attributes row is the one sub-row that must NOT carry hidden.
  const step = stepTemplate("stepPriorities");
  const attrRow = step.slice(step.indexOf('data-group="attributes"') - 120, step.indexOf('data-group="attributes"') + 40);
  assert.ok(!/hidden/.test(attrRow), "the Attributes row is always visible");
});

test("R1/R2: the Advanced panel is ordered after the reorder controls", () => {
  // `.wz-adv` precedes `.wz-ctl` in DOM order and takes a full flex line, so
  // without an explicit order it pushed ↑ ↓ ✕ onto a third line on every
  // magnitude row while presence rows stayed on one — the exact misalignment
  // this change exists to remove.
  const css = fs.readFileSync(path.join(__dirname, "..", "web", "styles.css"), "utf-8");
  const rule = css.slice(css.indexOf(".wz-adv {"), css.indexOf(".wz-adv >"));
  assert.ok(/order:\s*1/.test(rule), ".wz-adv carries an explicit order so it lays out last");
  assert.ok(/flex-basis:\s*100%/.test(rule), "and still takes its own line");
});

// ---- U2/KTD1 — the open-panel set --------------------------------------------

test("KTD1: the open set survives a list rebuild", () => {
  // renderRankedList does `ol.innerHTML = rankedHTML()` and four handlers call
  // rerender(); a <details open> would snap shut the moment the player clicks
  // "+ already have" inside the panel they just opened. The set is what carries
  // the state across that rebuild, so it must live outside the rebuilt markup.
  openPanelClear();
  openPanelToggle("Constitution", true);
  assert.ok(openPanels.has("Constitution"));
  assert.ok(!/openPanels\.clear\(\)/.test(
    WIZARD_SRC.slice(WIZARD_SRC.indexOf("function renderRankedList"),
      WIZARD_SRC.indexOf("function renderRanked("))),
    "renderRankedList must not clear the open set while rebuilding");
  openPanelClear();
});

test("KTD1: toggle, sweep, and clear behave as the row lifecycle needs", () => {
  openPanelClear();
  openPanelToggle("Dodge", true);
  openPanelToggle("Constitution", true);
  assert.strictEqual(openPanels.size, 2);
  openPanelToggle("Dodge", false);
  assert.ok(!openPanels.has("Dodge"));
  openPanelSweep("Constitution");
  assert.strictEqual(openPanels.size, 0);
  openPanelToggle("Dodge", true);
  openPanelClear();
  assert.strictEqual(openPanels.size, 0);
});

test("KTD1: the open set is keyed by stat, so reordering does not move a panel", () => {
  // Keyed by index, moving Constitution from row 3 to row 1 would leave the panel
  // open on whatever stat landed in row 3.
  openPanelClear();
  const priorities = ["Dodge", "Fortification", "Constitution"];
  openPanelToggle("Constitution", true);
  const moved = priorities.slice();
  moved.splice(0, 0, moved.splice(2, 1)[0]);
  assert.deepStrictEqual(moved, ["Constitution", "Dodge", "Fortification"]);
  assert.ok(openPanels.has("Constitution"), "the panel followed the stat, not the index");
  assert.strictEqual(openPanels.size, 1);
  openPanelClear();
});

test("KTD1: deleting a priority sweeps its open panel alongside its bounds", () => {
  const del = WIZARD_SRC.slice(WIZARD_SRC.indexOf("b.dataset.del != null"),
    WIZARD_SRC.indexOf("b.dataset.cadd != null"));
  assert.ok(/openPanelSweep\(/.test(del),
    "the delete branch sweeps the open set, like it already does for bounds and credits");
});

test("KTD1: loading a character clears every open panel", () => {
  assert.ok(/openPanelClear\(\)/.test(WIZARD_SRC.slice(WIZARD_SRC.indexOf("function loadCharacter"))),
    "loadCharacter clears the open set — a carried-over row belongs to the old build");
});

test("KTD1: the open set is ephemeral — never persisted, never queried", () => {
  assert.ok(!/openPanels/.test(fs.readFileSync(path.join(__dirname, "..", "web", "persist.js"), "utf-8")));
  openPanelClear();
  openPanelToggle("Constitution", true);
  const q = buildQuery(Object.assign(baseState(), { priorities: ["Constitution"] }), presenceVocab);
  assert.ok(!JSON.stringify(Object.keys(q)).includes("open"), "the open set never reaches the solver query");
  openPanelClear();
});

test("R5: the collapsed badge stays current when a bound is typed", () => {
  // Caught in the browser, not here: the bound and credit inputs skip rerender so
  // they don't destroy the field under the caret, which also skipped the badge —
  // it sat one render behind, so typing a floor and collapsing the row showed
  // nothing. The in-place refresh must read the same model the render does.
  assert.strictEqual(advancedBadgeText(0), "");
  assert.strictEqual(advancedBadgeText(1), "· 1 setting");
  assert.strictEqual(advancedBadgeText(2), "· 2 settings");
  const wire = WIZARD_SRC.slice(WIZARD_SRC.indexOf("function renderRankedList"));
  assert.ok(/const refreshBadge = /.test(wire), "an in-place badge refresh exists");
  // Anchor on text unique to each handler body — "input.wz-bound" and
  // "input.wz-credit-val" also appear in the focus helpers above them.
  for (const [what, anchor] of [["the bound inputs", "const isMax = inp.dataset.max"],
    ["the credit value field", "state.declaredCredits || {})[inp.dataset.cval]"]]) {
    const at = wire.indexOf(anchor);
    assert.ok(at > 0, `${what} handler found`);
    assert.ok(/refreshBadge\(/.test(wire.slice(at, at + 700)), `${what} refreshes the badge`);
  }
  // One definition of the summary contents, or the patched and rendered forms drift.
  assert.strictEqual(WIZARD_SRC.split("advancedBadgeText(").length - 1, 2,
    "advancedBadgeText is defined once and called once, from advSummaryHTML");
});

// ---- U3 — the panel's prose, relocated not duplicated -------------------------

test("U3: the stranded bottom explainer is gone from the step", () => {
  // stepPriorities lives inside the DOM closure and Node cannot call it, so slice
  // its source the way the rest of this suite does.
  const step = stepTemplate("stepPriorities");
  assert.ok(!/wz-bounds-help/.test(step), "the standalone explainer block is removed");
  assert.ok(!/wz-bounds-help/.test(WIZARD_SRC), "and nothing else still renders it");
});

test("U3: the explainer is DEFINED once, even though it renders per row", () => {
  // R3 is about relocation, not deduplication in the DOM: the panel is closed by
  // default and a player opens one row at a time, so the text belongs next to the
  // inputs. What must not happen is two copies of the prose drifting apart — so
  // the criterion is one definition in source, interpolated everywhere it appears.
  const occurrences = WIZARD_SRC.split("Min is a hard floor.").length - 1;
  assert.strictEqual(occurrences, 1, "the min explainer has exactly one definition");
  assert.strictEqual(WIZARD_SRC.split("Max is a cap.").length - 1, 1);
  assert.ok(/ADVANCED_PANEL_HELP\.min/.test(WIZARD_SRC), "the panel interpolates it rather than restating it");
});

test("U3: the panel leads with the no-min-no-max default (R4)", () => {
  const panel = WIZARD_SRC.slice(WIZARD_SRC.indexOf("function advancedHTML"), WIZARD_SRC.indexOf("function creditsHTML"));
  const leadAt = panel.indexOf("ADVANCED_PANEL_HELP.lead");
  assert.ok(leadAt > 0, "the default line is in the panel");
  assert.ok(leadAt < panel.indexOf("wz-bounds"), "and it comes before the inputs it describes");
  assert.ok(/Nothing set is the default/.test(ADVANCED_HELP_SRC()), "it states the default plainly");
});

test("U3: 'already have' names its sources on screen, not only in a tooltip (R7)", () => {
  const help = ADVANCED_HELP_SRC();
  for (const source of ["trances", "enhancements", "epic destinies"]) {
    assert.ok(help.includes(source), `the visible context names ${source}`);
  }
  // The tooltip named a different set entirely; broadened so the two agree.
  const tip = WIZARD_SRC.match(/title="Already have this from[^"]*"/)[0];
  for (const source of ["enhancement", "epic destiny", "past life", "filigree", "ship buff"]) {
    assert.ok(tip.includes(source), `the tooltip still covers ${source}`);
  }
});

// ---- U4 — bundle reorder, Attributes, Warlock ---------------------------------

test("U4: Basic and Ranged are REORDERED — no affix silently dropped", () => {
  // A reorder edits a literal array by hand, which is exactly how an affix goes
  // missing. Assert the lead order AND that membership is untouched.
  assert.deepStrictEqual(PRESET_BUNDLES.Basic.slice(0, 6),
    ["Constitution", "Healing Amplification", "Physical Sheltering", "Magical Sheltering", "Dodge", "Fortification"]);
  assert.deepStrictEqual([...PRESET_BUNDLES.Basic].sort(), [
    "Blindness Immunity", "Blurry", "Constitution", "Dodge", "False Life", "Fortification",
    "Freedom of Movement", "Ghostly", "Healing Amplification", "Magical Sheltering",
    "Physical Sheltering", "Resistance"].sort());
  assert.deepStrictEqual(PRESET_BUNDLES.Ranged.slice(0, 4),
    ["Ranged Power", "Doubleshot", "Deadly", "Armor-Piercing"]);
  assert.deepStrictEqual([...PRESET_BUNDLES.Ranged].sort(),
    ["Accuracy", "Armor-Piercing", "Deadly", "Doubleshot", "Ranged Alacrity", "Ranged Power"].sort());
});

test("U4: Warlock resolves to both warlock-mechanic affixes, neither dropped", () => {
  // resolveBundle silently drops anything the dataset does not carry, so a typo or
  // a not-rankable stat shrinks the bundle with no error. Eldritch Blast Dice only
  // resolves at all because the augment-only stats reached CORE_STATS.
  const rv = buildPickerVocabulary(realData);
  assert.deepStrictEqual(resolveBundle("Warlock", rv), ["Power in Pact", "Eldritch Blast Dice"]);
});

test("U4: each ability score is its own single-affix bundle", () => {
  const rv = buildPickerVocabulary(realData);
  const six = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"];
  assert.deepStrictEqual(BUNDLE_GROUPS.attributes, six, "the row lists all six");
  assert.strictEqual(PRESET_BUNDLES.Attributes, undefined, "the batch bundle is gone");
  for (const a of six) assert.deepStrictEqual(resolveBundle(a, rv), [a], a + " adds only itself");
});

test("U4: adding a bundle never duplicates a stat already ranked", () => {
  const rv = buildPickerVocabulary(realData);
  assert.deepStrictEqual(addBundle("Warlock", ["Eldritch Blast Dice"], rv),
    ["Eldritch Blast Dice", "Power in Pact"], "existing entry keeps its position");
  assert.deepStrictEqual(addBundle("Constitution", ["Constitution"], rv), ["Constitution"]);
});

test("U4: Warlock sits on the packages row; ability scores are above Tactics", () => {
  assert.ok(BUNDLE_GROUPS.packages.includes("Warlock"));
  const step = stepTemplate("stepPriorities");
  const attrAt = step.indexOf('data-group="attributes"');
  const tacticsAt = step.indexOf('data-group="tactics"');
  assert.ok(attrAt > 0 && tacticsAt > 0 && attrAt < tacticsAt, "ability scores render before Tactics");
});

function ADVANCED_HELP_SRC() {
  return WIZARD_SRC.slice(WIZARD_SRC.indexOf("const ADVANCED_PANEL_HELP"), WIZARD_SRC.indexOf("// U2/KTD1"));
}

// ---------------------------------------------------------------------------
// #235 — a stat with a magnitude but NO bonus type anywhere gets no declared
// credit. The control asks for a bonus type and this stat has none: `Untyped`
// keys a bucket the gear cannot join (they would sum into a double-count), and
// any other type names a bucket nothing supplies.

test("#235: an untyped-only stat is refused a declared credit", () => {
  const vocab = { presence: new Set(), magnitude: new Set(["Enhanced Ki", "Constitution"]),
                  untypedOnly: new Set(["Enhanced Ki"]) };
  assert.strictEqual(isUntypedOnly("Enhanced Ki", vocab), true);
  assert.strictEqual(canDeclareCredit("Enhanced Ki", vocab), false);
  assert.strictEqual(canDeclareCredit("Constitution", vocab), true, "a typed stat is unaffected");
});

test("#235: an untyped-only stat still accepts a floor and a cap", () => {
  // Only the credit is refused. A bound is a working constraint on any bucket.
  const vocab = { presence: new Set(), magnitude: new Set(["Enhanced Ki"]),
                  untypedOnly: new Set(["Enhanced Ki"]) };
  const state = { priorities: ["Enhanced Ki"], targetFloors: { "Enhanced Ki": 3 },
                  targetCaps: { "Enhanced Ki": 9 }, declaredCredits: {} };
  const row = advancedRowModel("Enhanced Ki", state, vocab);
  assert.strictEqual(row.canCredit, false, "no credit control");
  assert.strictEqual(row.floor, 3, "floor survives");
  assert.strictEqual(row.cap, 9, "cap survives");
});

test("#235: an existing credit on an untyped-only stat is dropped, not honored", () => {
  const vocab = { presence: new Set(), magnitude: new Set(["Enhanced Ki"]),
                  untypedOnly: new Set(["Enhanced Ki"]) };
  const state = { priorities: ["Enhanced Ki"], targetFloors: {}, targetCaps: {},
                  declaredCredits: { "Enhanced Ki||Untyped": { stat: "Enhanced Ki", bonus_type: "Untyped", value: 3 } } };
  assert.deepStrictEqual(advancedRowModel("Enhanced Ki", state, vocab).credits, [],
    "a credit saved before this gate must not reach the solver");
});

test("#235: the real vocabulary marks Enhanced Ki untyped-only and nothing else", () => {
  const rv = buildPickerVocabulary(realData);
  assert.ok(rv.untypedOnly.has("Enhanced Ki"));
  assert.strictEqual(rv.untypedOnly.size, 1);
  assert.strictEqual(canDeclareCredit("Enhanced Ki", rv), false);
  assert.strictEqual(canDeclareCredit("Constitution", rv), true);
});


// --- U11 (R15): selecting an aliased enchantment name substitutes its stats ----
// The picker now offers the enchantment names the item surfaces display ("Sacred
// Spell Focus Mastery"). Selecting one must insert the stats it becomes, as
// consecutive priorities in the expansion's declared order — never a single
// combined objective term, which is the weighted-sum mode the Non-goals list
// declines and which would silently trade the player's top stat away.
{
  const U11_VOCAB = buildPickerVocabulary(realData);
  const U11_SCHOOLS = ["Abjuration Focus", "Conjuration Focus", "Enchantment Focus",
    "Evocation Focus", "Illusion Focus", "Necromancy Focus", "Transmutation Focus"];

  test("U11: selecting a provenance label inserts its stats in declared order", () => {
    const out = resolvePriorityAdd("Sacred Spell Focus Mastery", U11_VOCAB, ["Constitution"]);
    assert.ok(out.ok, "the label is accepted, not refused");
    assert.deepStrictEqual(out.priorities, ["Constitution", ...U11_SCHOOLS]);
    assert.deepStrictEqual(out.substitutions,
      [{ from: "Sacred Spell Focus Mastery", to: U11_SCHOOLS }]);
  });

  test("U11: seven components occupy seven ranks — never one combined term", () => {
    const out = resolvePriorityAdd("Sacred Spell Focus Mastery", U11_VOCAB, ["Constitution"]);
    assert.strictEqual(out.priorities.length, 8,
      "ranking the alias second puts nothing else above rank 8 — the disclosed cost");
    assert.strictEqual(out.priorities[0], "Constitution", "the top priority is untouched");
    for (const p of out.priorities) {
      assert.ok(U11_VOCAB.known.has(p), `"${p}" is a real stat, not a fused objective term`);
    }
    assert.strictEqual(new Set(out.priorities).size, out.priorities.length, "no duplicates");
  });

  test("U11: a priority already ranked below is displaced, not dropped", () => {
    const out = resolvePriorityAdd("Parrying", U11_VOCAB, ["Constitution", "Dodge"]);
    assert.ok(out.ok);
    assert.deepStrictEqual(out.priorities, ["Constitution", "Dodge",
      "Armor Class", "Fortitude Save", "Reflex Save", "Will Save"]);
    for (const kept of ["Constitution", "Dodge"]) {
      assert.ok(out.priorities.includes(kept), `${kept} survived the substitution`);
    }
  });

  test("U11: adding an alias whose components are already ranked does not duplicate", () => {
    const out = resolvePriorityAdd("Parrying", U11_VOCAB, ["Armor Class"]);
    assert.deepStrictEqual(out.priorities,
      ["Armor Class", "Fortitude Save", "Reflex Save", "Will Save"]);
    assert.strictEqual(out.substitutions.length, 1, "and still discloses the substitution");
  });

  test("U11: the alias itself never lands as a priority", () => {
    for (const alias of ["Sacred Spell Focus Mastery", "Parrying", "Speed"]) {
      const out = resolvePriorityAdd(alias, U11_VOCAB, []);
      assert.ok(!out.priorities.includes(alias),
        `${alias} is an enchantment name — it must not become a target no item carries`);
    }
  });

  test("U11: an expanded-away name NO surface displays is still refused and redirected", () => {
    const out = resolvePriorityAdd("Well Rounded", U11_VOCAB, ["Constitution"]);
    assert.ok(!out.ok, "removal-and-redirect survives for a name nothing displays");
    assert.ok(/rank those instead/.test(out.message || ""), out.message);
    assert.deepStrictEqual(out.priorities, ["Constitution"], "priorities are untouched");
  });

  test("U11: an ordinary stat and an unknown name behave exactly as before", () => {
    const good = resolvePriorityAdd("Dodge", U11_VOCAB, ["Constitution"]);
    assert.ok(good.ok);
    assert.deepStrictEqual(good.priorities, ["Constitution", "Dodge"]);
    assert.deepStrictEqual(good.substitutions, [], "no disclosure when nothing was substituted");

    const bad = resolvePriorityAdd("Notastat McNotastat", U11_VOCAB, ["Constitution"]);
    assert.ok(!bad.ok);
    assert.ok(/isn't a known affix/.test(bad.message || ""), bad.message);

    const dupe = resolvePriorityAdd("Constitution", U11_VOCAB, ["Constitution"]);
    assert.ok(!dupe.ok, "a duplicate is still a no-op");
    assert.strictEqual(dupe.message, undefined, "and says nothing, as today");
  });

  test("U11: a blank or whitespace-only entry is a no-op", () => {
    for (const junk of ["", "   ", null, undefined]) {
      assert.ok(!resolvePriorityAdd(junk, U11_VOCAB, ["Constitution"]).ok, JSON.stringify(junk));
    }
  });

  // The DOM half lives inside the window-gated IIFE Node cannot reach, so the
  // wiring is asserted against the source text — the established precedent here
  // (see the #169 load-path tests above).
  test("U11: addPriority routes the add through the shared resolver", () => {
    const at = WIZARD_SRC.indexOf("function addPriority(");
    assert.ok(at > 0, "addPriority exists");
    const fn = WIZARD_SRC.slice(at, at + 2600);
    assert.ok(/resolvePriorityAdd\(/.test(fn), "it delegates to the shared resolver");
    assert.ok(/state\.priorities = res\.priorities/.test(fn), "and adopts the substituted list");
  });

  test("U11: a bound attached to the alias is DROPPED and reported, not remapped", () => {
    const at = WIZARD_SRC.indexOf("function addPriority(");
    const fn = WIZARD_SRC.slice(at, at + 2600);
    assert.ok(/targetCaps, state\.targetFloors/.test(fn), "both bound maps are swept");
    assert.ok(/delete map\[sub\.from\]/.test(fn), "the bound keyed to the alias is removed");
    assert.ok(/droppedBounds/.test(fn), "and disclosed rather than dropped silently");
    assert.ok(!/targetFloors\[sub\.to/.test(fn) && !/targetCaps\[sub\.to/.test(fn),
      "and never copied onto a component — 'min 4 Parrying' is not 'min 4 Armor Class'");
  });

  test("U11: a declared credit keyed to the alias is cleared and reported", () => {
    const at = WIZARD_SRC.indexOf("function addPriority(");
    const fn = WIZARD_SRC.slice(at, at + 2600);
    assert.ok(/declaredCredits/.test(fn), "credits are swept too");
    assert.ok(/c\.stat === sub\.from/.test(fn),
      "credits key on stat PLUS bonus type, so they need their own matcher");
    assert.ok(/droppedCredits/.test(fn), "and are disclosed separately");
  });

  test("U11: the substitution is disclosed inline at the picker", () => {
    const at = WIZARD_SRC.indexOf("function addPriority(");
    const fn = WIZARD_SRC.slice(at, at + 2600);
    assert.ok(/migrationMessage\(/.test(fn), "it reuses the shared disclosure builder");
    assert.ok(/lead: "picker"/.test(fn), "with the picker wording, not the saved-character one");
    assert.ok(/status\.textContent/.test(fn), "written to the inline picker status line");
  });

  test("U11: the Adjust panel's picker has a status line to disclose into", () => {
    // addPriority is wired to BOTH pickers. The Adjust panel had no status element,
    // so a substitution made there would have been silent — the exact failure R15
    // exists to prevent.
    assert.ok(/id="wz-radd-status"/.test(WIZARD_SRC), "the Adjust panel has its own status line");
    const at = WIZARD_SRC.indexOf("function pickerStatusEl(");
    assert.ok(at > 0, "and a resolver that finds whichever picker is on screen");
    const fn = WIZARD_SRC.slice(at, at + 300);
    assert.ok(/wz-status/.test(fn) && /wz-radd-status/.test(fn), fn);
  });
}


console.log(`\n${passed} passed`);

// ---------------------------------------------------------------------------
// #110 U1 — blocklist state reaches the query.

test("U1/#110: buildQuery threads the blocklist as a fresh array", () => {
  const q = buildQuery({ ...baseState(), blocklist: ["Lunar Gem of Abjuration (Heroic)"] });
  assert.deepStrictEqual(q.blocklist, ["Lunar Gem of Abjuration (Heroic)"]);
  const src = { ...baseState(), blocklist: ["A"] };
  const q2 = buildQuery(src);
  q2.blocklist.push("B");
  assert.deepStrictEqual(src.blocklist, ["A"], "the query holds a copy, not the live state array");
});

test("U1/#110: buildQuery defaults an absent blocklist to empty (pre-feature state)", () => {
  const q = buildQuery(baseState());
  assert.deepStrictEqual(q.blocklist, [], "absent -> empty array, never undefined");
});


// ---------------------------------------------------------------------------
// #110 U3/U4/U5 — the blocklist mutation core (pure; the renderers are DOM-bound).

test("U3/#110: addBlocks adds one entry, dedupes, and removal leaves the rest", () => {
  const r1 = addBlocks([], ["Lunar Gem of Abjuration (Heroic)"], {});
  assert.deepStrictEqual(r1.list, ["Lunar Gem of Abjuration (Heroic)"]);
  const r2 = addBlocks(r1.list, ["Lunar Gem of Abjuration (Heroic)"], {});
  assert.deepStrictEqual(r2.list, r1.list, "blocking twice does not duplicate");
  assert.deepStrictEqual(r2.added, [], "the duplicate adds nothing");
  const afterRemove = removeBlock(["A", "B", "C"], "B");
  assert.deepStrictEqual(afterRemove, ["A", "C"]);
});

test("U4/#110: one action over a staged set adds one entry per selection", () => {
  const staged = ["Gem A", "Gem B", "Gem C", "Gem A"];   // a double-tick stays one entry
  const r = addBlocks([], staged, {});
  assert.deepStrictEqual(r.list, ["Gem A", "Gem B", "Gem C"]);
  assert.strictEqual(r.added.length, 3);
  // no pattern is stored — the list holds concrete ids only
  assert.ok(r.list.every((e) => typeof e === "string" && !e.includes("*")));
});

test("U4/#110: an already-blocked variant is not duplicated by block-selected", () => {
  const r = addBlocks(["Gem A"], ["Gem A", "Gem B"], {});
  assert.deepStrictEqual(r.list, ["Gem A", "Gem B"]);
  assert.deepStrictEqual(r.added, ["Gem B"]);
});

test("U5/#110: blocking a pinned variant is refused with the pin named", () => {
  const sc = {}; applyPinId(sc, "Ring", "Contested Ring", () => 2);
  const r = addBlocks([], ["Contested Ring", "Free Gem"], sc);
  assert.deepStrictEqual(r.list, ["Free Gem"], "only the unpinned id lands");
  assert.deepStrictEqual(r.refused, [{ id: "Contested Ring", slot: "Ring" }],
    "the refusal names the conflicting pin's slot");
});

test("U5/#110: pinning a blocked variant is refused symmetrically", () => {
  assert.strictEqual(pinBlockedConflict(["Contested Ring"], "Contested Ring"), true);
  assert.strictEqual(pinBlockedConflict(["Other"], "Contested Ring"), false);
  assert.strictEqual(pinBlockedConflict(undefined, "X"), false, "absent blocklist never conflicts");
});

test("U5/#110: a loaded character holding both states is detected for the report", () => {
  const sc = {}; applyPinId(sc, "Ring", "Both Ring", () => 2);
  applyPinId(sc, "Necklace", "Clean Neck", () => 1);
  assert.deepStrictEqual(blockPinOverlap(["Both Ring", "Solo Gem"], sc), ["Both Ring"]);
  assert.deepStrictEqual(blockPinOverlap([], sc), []);
});

test("U5/#110: a Ring pin holding two variants conflicts only on the one being blocked", () => {
  const sc = {}; applyPinId(sc, "Ring", "Ring One", () => 2); applyPinId(sc, "Ring", "Ring Two", () => 2);
  const r = addBlocks([], ["Ring Two"], sc);
  assert.deepStrictEqual(r.refused.map((x) => x.id), ["Ring Two"]);
  const ok = addBlocks([], ["Ring Three"], sc);
  assert.deepStrictEqual(ok.list, ["Ring Three"], "an unpinned third ring blocks fine");
});


test("U6/#110: a block on a vanished variant is stale; an existing one is not", () => {
  const items = [{ variant_id: "Real Gem", source_item: "Real Gem" },
                 { variant_id: "High ML Ring", source_item: "High ML Ring", ml: 36 }];
  assert.deepStrictEqual(blockStale(["Ghost Gem", "Real Gem"], items), ["Ghost Gem"]);
  // ML-gating is NOT staleness: the id still resolves, so it stays silent.
  assert.deepStrictEqual(blockStale(["High ML Ring"], items), []);
  assert.deepStrictEqual(blockStale([], items), [], "no entries, no report");
});

test("U6/#110: reconciliation never mutates the saved list", () => {
  const saved = ["Ghost Gem", "Real Gem"];
  blockStale(saved, [{ variant_id: "Real Gem" }]);
  assert.deepStrictEqual(saved, ["Ghost Gem", "Real Gem"]);
});

test("U6/#110: an entry named like a JS built-in resolves safely", () => {
  assert.deepStrictEqual(blockStale(["constructor"], [{ variant_id: "A" }]), ["constructor"],
    "a Set lookup, not an object key walk — no prototype hit");
});

test("U5+U6/#110: blockLoadMessage names both facts, and is null when clean", () => {
  const sc = {}; applyPinId(sc, "Ring", "Both Ring", () => 2);
  const items = [{ variant_id: "Both Ring" }];
  const msg = blockLoadMessage(["Both Ring", "Ghost Gem"], sc, items);
  assert.ok(/Both Ring/.test(msg) && /pinned and blocked/.test(msg), "the overlap is named");
  assert.ok(/Ghost Gem/.test(msg) && /no longer/.test(msg), "the stale entry is named");
  assert.strictEqual(blockLoadMessage(["Both Ring"], {}, items), null,
    "no stale entries and no overlap -> no message at all, not an empty one");
});

// ---------------------------------------------------------------------------
// #110 review fixes — the load path's blocklist hygiene, pinned at the source
// level (the load path is DOM-bound; the WIZARD_SRC-slice precedent applies).

test("review/#110: the load path clears the staged block selection", () => {
  const start = WIZARD_SRC.indexOf("function loadCharacter(");
  const slice = WIZARD_SRC.slice(start, start + 4000);
  assert.ok(/blockStage\.clear\(\);/.test(slice),
    "ticks staged on the previous character must not commit into this one");
  assert.ok(/state\.blockRefusedMsg = null;/.test(slice), "the refusal message resets too");
});

test("review/#110: the load path sanitizes blocklist elements to non-empty strings", () => {
  const start = WIZARD_SRC.indexOf("function loadCharacter(");
  const slice = WIZARD_SRC.slice(start, start + 4000);
  assert.ok(/i\.blocklist\.filter\(\(x\) => typeof x === "string" && x\)/.test(slice),
    "a hand-edited backup's non-string entries would become unremovable ghost rows");
});

// ---------------------------------------------------------------------------
// U4 (plan 2026-08-12-003, #262) — no-drop-source disclosure at pick time.
// The pin and block search rows are where a player chooses an item; a
// wiki-confirmed sourceless item says so right there, as one more per-row note
// beside the existing "· pinned" / "· blocked" state notes.
// ---------------------------------------------------------------------------

test("U4/262: noDropNote renders the note for a flagged item, nothing otherwise", () => {
  assert.strictEqual(noDropNote({ no_drop_source: true }), " · no known live drop source");
  assert.strictEqual(noDropNote({}), "", "unflagged: no note (absence, not empty wording)");
  assert.strictEqual(noDropNote({ no_drop_source: false }), "");
  assert.strictEqual(noDropNote(null), "");
  assert.ok(!/unobtainable/i.test(noDropNote({ no_drop_source: true })), "R5: 'unobtainable' never appears");
});

test("U4/262: a real flagged item carries the note; an unflagged one doesn't", () => {
  const flagged = realData.items.filter((v) => v.no_drop_source === true);
  assert.ok(flagged.length >= 2, "the wiki-confirmed items survive dataset normalization");
  assert.ok(flagged.some((v) => /Bracers of the Spider Queen/.test(v.variant_id)));
  for (const v of flagged) assert.ok(noDropNote(v).includes("no known live drop source"));
  const plain = realData.items.find((v) => !v.no_drop_source);
  assert.strictEqual(noDropNote(plain), "");
});

test("U4/262: the PIN search row template appends the note (source wiring)", () => {
  // The render is DOM-bound; the WIZARD_SRC-slice precedent applies.
  const src = WIZARD_SRC.slice(WIZARD_SRC.indexOf("function renderPinResults("));
  const body = src.slice(0, src.indexOf("function renderPinList("));
  assert.ok(/noDropNote\(v\)/.test(body), "the pin row's state-note string appends noDropNote(v)");
});

test("U4/262: the BLOCK search row template appends the note (source wiring)", () => {
  const src = WIZARD_SRC.slice(WIZARD_SRC.indexOf("function renderBlockResults("));
  const body = src.slice(0, src.indexOf("function renderBlockList("));
  assert.ok(/noDropNote\(v\)/.test(body), "the block row's note string appends noDropNote(v)");
});

// ---- #91 U4 — Utility tier: seeding, healing, re-add, panel suppression -------
// The tier's presence/position lives in the persisted priority list, never
// closure state; these cover the pure lifecycle helpers plus the query-side
// defensive gates (R1, R2, R15, KTD8).
{
  const { newPriorityList, insertAboveTrailingSentinel, healUtilityTier, restoredRenderQuery, datalistStats } = require("../web/wizard.js");
  const { UTILITY_SENTINEL } = require("../web/model.js");
  const S = UTILITY_SENTINEL;
  const U4_VOCAB = buildPickerVocabulary(realData);

  test("#91 U4/R1: a new priority list is born with the sentinel at the bottom", () => {
    assert.deepStrictEqual(newPriorityList(), [S]);
    assert.strictEqual(S, "Utility effects", "display name is the solver's sentinel, verbatim");
  });

  test("#91 U4/R1: the wizard state init seeds priorities from newPriorityList (source wiring)", () => {
    assert.ok(/priorities:\s*newPriorityList\(\)/.test(WIZARD_SRC),
      "the fresh-state literal births the list through the seeding helper");
  });

  test("#91 U4/R1: adding a stat lands ABOVE a bottom-seated sentinel", () => {
    const out = resolvePriorityAdd("Dodge", U4_VOCAB, ["Constitution", S]);
    assert.ok(out.ok);
    assert.deepStrictEqual(out.priorities, ["Constitution", "Dodge", S],
      "the seeded default keeps every ranked stat above utility");
  });

  test("#91 U4/R2: a dragged-up sentinel is respected — adds append at the true bottom", () => {
    const out = resolvePriorityAdd("Dodge", U4_VOCAB, [S, "Constitution"]);
    assert.ok(out.ok);
    assert.deepStrictEqual(out.priorities, [S, "Constitution", "Dodge"]);
  });

  test("#91 U4/R1: an alias expansion also lands above a bottom-seated sentinel", () => {
    const out = resolvePriorityAdd("Parrying", U4_VOCAB, ["Constitution", S]);
    assert.ok(out.ok);
    assert.deepStrictEqual(out.priorities, ["Constitution",
      "Armor Class", "Fortitude Save", "Reflex Save", "Will Save", S]);
  });

  test("#91 U4/R1: addBundle keeps a bottom-seated sentinel at the bottom", () => {
    const out = addBundle("Basic", [S], U4_VOCAB);
    assert.ok(out.length > 1, "the bundle landed");
    assert.strictEqual(out[out.length - 1], S, "sentinel still last");
    assert.strictEqual(out.filter((p) => p === S).length, 1, "and not duplicated");
  });

  test("#91 U4: insertAboveTrailingSentinel is pure and position-aware", () => {
    const ranked = ["Constitution", S];
    const out = insertAboveTrailingSentinel(ranked, "Dodge");
    assert.deepStrictEqual(out, ["Constitution", "Dodge", S]);
    assert.deepStrictEqual(ranked, ["Constitution", S], "input untouched");
    assert.deepStrictEqual(insertAboveTrailingSentinel(["Constitution"], "Dodge"),
      ["Constitution", "Dodge"], "no sentinel: plain append");
  });

  test("#91 U4/R15: resolvePriorityAdd re-adds the sentinel, case-insensitively, at the bottom", () => {
    const out = resolvePriorityAdd("utility effects", U4_VOCAB, ["Constitution"]);
    assert.ok(out.ok, "accepted even though it is not a vocab stat");
    assert.deepStrictEqual(out.priorities, ["Constitution", S]);
    assert.deepStrictEqual(out.substitutions, []);
    assert.ok(!U4_VOCAB.known.has(S), "the sentinel deliberately never joins `known`");
  });

  test("#91 U4/R15: re-adding an already-present sentinel is a silent no-op, never a duplicate", () => {
    const out = resolvePriorityAdd(S, U4_VOCAB, ["Constitution", S]);
    assert.ok(!out.ok);
    assert.deepStrictEqual(out.priorities, ["Constitution", S], "unchanged");
    assert.strictEqual(out.message, undefined, "and says nothing, like a duplicate stat");
  });

  test("#91 U4/KTD8: an unmarked (pre-feature) restore heals — sentinel appended at bottom", () => {
    assert.deepStrictEqual(healUtilityTier(["Constitution", "Dodge"], false),
      ["Constitution", "Dodge", S]);
  });

  test("#91 U4/KTD8: an unmarked restore with EMPTY priorities heals to a valid list", () => {
    assert.deepStrictEqual(healUtilityTier([], false), [S]);
    assert.deepStrictEqual(healUtilityTier(null, false), [S], "a malformed save still heals");
  });

  test("#91 U4/KTD8: an unmarked restore that already carries the sentinel is not duplicated", () => {
    assert.deepStrictEqual(healUtilityTier(["Constitution", S], false), ["Constitution", S]);
  });

  test("#91 U4/KTD8: a MARKED restore is verbatim — removal persists, position persists", () => {
    assert.deepStrictEqual(healUtilityTier(["Constitution", "Dodge"], true),
      ["Constitution", "Dodge"], "the player removed the tier; it stays removed");
    assert.deepStrictEqual(healUtilityTier(["Constitution", S, "Dodge"], true),
      ["Constitution", S, "Dodge"], "a dragged position restores exactly");
  });

  test("#91 U4/KTD8: the load path heals through healUtilityTier + the marker (source wiring)", () => {
    assert.ok(/healUtilityTier\(state\.priorities,\s*!!i\.utility_tier_aware\)/.test(WIZARD_SRC),
      "the restore path routes the restored list through the healing rule");
  });

  test("#91 U4/R15: the sentinel row's Advanced panel is suppressed, whatever state holds", () => {
    const st = { priorities: [S], targetFloors: { [S]: 3 }, targetCaps: { [S]: 9 },
      declaredCredits: { [`${S}||Enhancement`]: { stat: S, bonus_type: "Enhancement", value: 2 } } };
    const adv = advancedRowModel(S, st, U4_VOCAB);
    assert.strictEqual(adv.suppressed, true);
    assert.strictEqual(adv.floor, null, "a stale bound never surfaces as a live control");
    assert.strictEqual(adv.cap, null);
    assert.strictEqual(adv.canCredit, false);
    assert.deepStrictEqual(adv.credits, []);
    assert.strictEqual(adv.badgeCount, 0);
  });

  test("#91 U4/R15: rankedHTML renders no Advanced panel for a suppressed row (source wiring)", () => {
    assert.ok(/adv\.suppressed \? "" : advancedHTML\(/.test(WIZARD_SRC),
      "the row template gates advancedHTML on the model's suppressed flag");
  });

  test("#91 U4/R15: a bound keyed to the sentinel is dropped from the query", () => {
    assert.deepStrictEqual(cleanBoundMap({ [S]: 4, Dodge: 2 }), { Dodge: 2 });
    const q = buildQuery({ ...baseState(), priorities: ["Constitution", S],
      targetFloors: { Constitution: 5, [S]: 2 }, targetCaps: { [S]: 9 } });
    assert.deepStrictEqual(q.targetFloors, { Constitution: 5 });
    assert.deepStrictEqual(q.targetCaps, {});
  });

  test("#91 U4/R15: a declared credit keyed to the sentinel is dropped from the query", () => {
    const out = cleanCreditMap({
      [`${S}||Enhancement`]: { stat: S, bonus_type: "Enhancement", value: 2 },
      "Constitution||Insight": { stat: "Constitution", bonus_type: "Insight", value: 2 },
    }, U4_VOCAB);
    assert.deepStrictEqual(Object.keys(out), ["Constitution||Insight"]);
  });

  test("#91 U4/R15: the datalist option list offers the sentinel's display name", () => {
    const opts = datalistStats(U4_VOCAB);
    assert.ok(opts.includes("Utility effects"), "autocomplete offers the re-add");
    assert.ok(!U4_VOCAB.suggestions.includes(S), "seeded at the datalist, not into the vocabulary");
    assert.strictEqual(datalistStats(U4_VOCAB).filter((o) => o === S).length, 1, "once");
  });

  test("#91 U4/R15: both datalists render from the seeded list (source wiring)", () => {
    assert.ok(/const allStats = datalistStats\(vocab\)/.test(WIZARD_SRC),
      "allStats — the source of wz-stats AND wz-stats2 — is the seeded list");
    assert.ok(/id="wz-stats">\$\{allStats\.map/.test(WIZARD_SRC), "wz-stats renders from allStats");
    assert.ok(/id="wz-stats2">\$\{allStats\.map/.test(WIZARD_SRC), "wz-stats2 renders from allStats");
  });

  // ---- review fix — sentinel-only gates ---------------------------------------
  test("#91 (review fix) the solve-button gate and the two re-solve gates route through canAdvance, not a bare length check (source wiring)", () => {
    assert.ok(!/state\.priorities\.length\)\s*solve\(/.test(WIZARD_SRC),
      "no re-solve affordance gates on the bare length any more");
    assert.ok(!/if\s*\(!state\.priorities\.length\)\s*return;\s*\n\s*solving = true/.test(WIZARD_SRC),
      "the solve() internal guard also routes through canAdvance");
    const matches = WIZARD_SRC.match(/canAdvance\("priorities", state\)/g) || [];
    assert.ok(matches.length >= 4,
      `expected canAdvance("priorities", state) at the Continue check, the solve-button check, and both re-solve buttons; found ${matches.length}`);
  });

  // ---- review fix — healed-restore disclosure reachability ------------------
  test("#91 (review fix) restoredRenderQuery: a healed pre-feature restore's render targets include the sentinel, and the report-absent utility card becomes reachable", () => {
    const results = require("../web/results.js");
    const storedQuery = { targets: ["Constitution", "Dodge"], slotConstraints: {} };
    const snapshotBeforeCall = JSON.parse(JSON.stringify(storedQuery));
    const renderQuery = restoredRenderQuery(storedQuery, false);   // unmarked (pre-feature)

    assert.deepStrictEqual(storedQuery, snapshotBeforeCall, "the stored record's query is never mutated");
    assert.notStrictEqual(renderQuery, storedQuery, "a NEW object is returned for rendering");
    assert.deepStrictEqual(renderQuery.targets, ["Constitution", "Dodge", S]);

    // A restored pre-feature snapshot has no utilityReport — confirm the healed
    // render targets actually reach utilityCard's report-absent branch (never
    // the zero-state, which would be a false claim about an unknown count).
    const snap = { chosen: [], effective: { Constitution: 20, Dodge: 5 } };   // no utilityReport
    const idx = renderQuery.targets.indexOf(S);
    const card = results.utilityCard(snap, idx);
    assert.ok(card.includes("predates utility tracking"), "the report-absent disclosure is reachable");
  });

  test("#91 (review fix) restoredRenderQuery: a query already carrying the sentinel is returned untouched", () => {
    const q = { targets: ["Constitution", S] };
    assert.strictEqual(restoredRenderQuery(q, false), q, "already present: same reference back, unmarked");
    assert.strictEqual(restoredRenderQuery(q, true), q, "already present: same reference back, marked");
  });

  test("#91 (review fix) restoredRenderQuery: a MARKED (post-feature) restore renders verbatim, even with no utility ranked", () => {
    const q = { targets: ["Constitution", "Dodge"] };   // the player legitimately ranked no utility
    assert.strictEqual(restoredRenderQuery(q, true), q, "marked restores are never healed for render either");
  });

  test("#91 (review fix) loadCharacter routes the restored render through restoredRenderQuery, while buildModel/state.lastRun keep the unmutated query (source wiring)", () => {
    const at = WIZARD_SRC.indexOf("function loadCharacter(");
    assert.ok(at > 0, "loadCharacter exists");
    const fn = WIZARD_SRC.slice(at, WIZARD_SRC.indexOf("\n    function renderSavedPicker", at));
    assert.ok(/restoredRenderQuery\(query, !!i\.utility_tier_aware\)/.test(fn),
      "the render-only query is derived through the shared pure helper");
    assert.ok(/buildModel\(candidateItems\(\), query,/.test(fn),
      "the model is still built from the unmutated query");
    assert.ok(/state\.lastRun = \{ model, result: snap, query,/.test(fn),
      "state.lastRun (read by a later Save) keeps the original, unhealed query");
    assert.ok(/query: renderQuery/.test(fn),
      "renderResults is handed the render-only copy, not `query` itself");
  });
}

// #346 — the ladder's UI options must match the model's vocabulary exactly.
// wizard.js hand-writes the rung list with its player-facing labels (copy belongs
// in the UI, not the model), so the two CAN drift — this is the assertion that
// stops a rung being added, removed, or reordered in one place only.
test("#346: the rendered ladder options match CRAFTING_RUNGS in order and value", () => {
  const M = require("../web/model.js");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  const block = src.slice(src.indexOf("const RUNGS = ["));
  const rendered = [...block.slice(0, block.indexOf("];")).matchAll(/\["([a-z-]+)",/g)].map((m) => m[1]);
  assert.deepStrictEqual(rendered, M.CRAFTING_RUNGS,
    "every rung the model knows is offered, in rank order, with no extras");
});

// #346 — the three readers of the ladder now share ONE precedence implementation.
// They did not always: the model seam drifted and solved a legacy-only query with
// the craftable pools fully live. This table pins that they agree.
test("#346: every reader of the ladder agrees on the same precedence", () => {
  const M = require("../web/model.js");
  const P = require("../web/projection.js");
  const cases = [
    [{}, "everything"],
    [{ excludeCraftingSystems: false }, "everything"],
    [{ excludeCraftingSystems: true }, "no-niche-crafting"],
    [{ craftingRung: "printed-only" }, "printed-only"],
    [{ craftingRung: "printed-only", excludeCraftingSystems: true }, "printed-only"],
    [{ craftingRung: "everything", excludeCraftingSystems: true }, "everything"],
    [{ craftingRung: "nonsense", excludeCraftingSystems: true }, "everything"],
  ];
  for (const [input, expected] of cases) {
    assert.strictEqual(M.craftingRung(input), expected, `model seam: ${JSON.stringify(input)}`);
    assert.strictEqual(rungFromInputs(input), expected, `wizard load path: ${JSON.stringify(input)}`);
    // The projection reads the same rule through craftingExcludedLine's rung branch.
    const line = P.craftingExcludedLine({ query: input, snapshot: { augmentsPlaced: [] } }) || "";
    const impliedRestrictive = /excluded from this solve|nothing beyond what is printed/.test(line);
    assert.strictEqual(impliedRestrictive, expected !== "everything",
      `projection notice: ${JSON.stringify(input)} implies ${expected}`);
  }
});

// #346 (U2) — the Set Augments picker is set-bonus crafting, cleared by every
// rung from no-niche-crafting down. Leaving it live there would let a player tick
// boxes the solve cannot honour: the contradictory-but-permitted state the
// ladder's own rule exists to prevent. Same treatment as the augment ML ceiling.
test("#346: the Set Augments picker is disabled on rungs that clear set-bonus crafting", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  const block = src.slice(src.indexOf('id="wz-setaug"'), src.indexOf('id="wz-setaug"') + 1800);
  assert.match(block, /setAugInert \? " disabled" : ""/,
    "the checkboxes carry a disabled branch keyed on the rung");
  assert.match(block, /Not applicable — the rung you chose excludes set-bonus crafting/,
    "and the reason is stated, never left silently inert");
  assert.match(block, /Your selections are kept/,
    "and the player is told their ticks survive the trip");
  // Keyed on the niche-crafting rung, not the augment rungs — that is where the
  // model actually clears augmentSetDefs.
  assert.match(src, /const setAugInert = _rungExcludesNicheCrafting\(/,
    "gated on the rung that actually clears the family");
});

// #332 — SOURCE-TEXT WIRING GUARD. This is the guard whose absence let the whole
// disclosure ship dead: web/query.js is not loaded by web/index.html, so wiring the
// sets there reached a file the app never runs. Every unit test passed because each
// one drove buildModel directly. This asserts the LIVE call sites pass the object
// shape, which no unit test can observe.
test("#332: both live buildModel call sites thread {counting, admitted}", () => {
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  const calls = [...src.matchAll(/buildModel\(/g)].map((m) => m.index);
  assert.strictEqual(calls.length, 2, "wizard.js has exactly the two known buildModel call sites");
  for (const at of calls) {
    const region = src.slice(at, src.indexOf(");", at) + 2);
    assert.ok(/counting:\s*vocab\.utilityCounting/.test(region),
      `a buildModel call at index ${at} must pass the counting set as { counting: ... }`);
    assert.ok(/admitted:\s*vocab\.utilityAdmitted/.test(region),
      `a buildModel call at index ${at} must pass the admitted procs as { admitted: ... }`);
    assert.ok(!/augment_set_defs,\s*vocab\.utilityCounting\s*\|\|\s*null/.test(region),
      "the pre-#332 bare-Set form must not survive at a live call site");
  }
});

test("#332: initBrowse receives the picker vocabulary", () => {
  // The call that makes every Browse marker appear. Without a vocabulary, initBrowse
  // renders chips with no markers at all — a silent, total feature loss that no unit
  // test can see, which is the same shape as the buildModel wiring defect above.
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  assert.ok(/ItemBrowser\.initBrowse\(\s*dataset\s*,\s*pickerVocabulary\(dataset\)\s*\)/.test(src),
    "initBrowse must be passed pickerVocabulary(dataset), not dataset alone");
  assert.ok(!/ItemBrowser\.initBrowse\(\s*dataset\s*\)/.test(src),
    "the pre-#332 single-argument form must not survive");
});

test("#332: web/query.js is NOT a live solve path — index.html must not load it", () => {
  // Pins the fact that made #3 possible, so a future reader is not misled again.
  const fs = require("fs"); const path = require("path");
  const html = fs.readFileSync(path.join(__dirname, "..", "web", "index.html"), "utf-8");
  assert.ok(!/src="query\.js/.test(html),
    "if query.js becomes loaded, it is a live solve path and must thread both sets too");
});

// ---------------------------------------------------------------------------
// U3 (plan 2026-08-17-001, #345) — the outbid disclosure renders wherever
// results render. No unit test can observe what the app's OWN calls pass, so
// the call sites are asserted as source text, with a count so a fourth cannot
// appear unguarded. #332 shipped a feature that passed its tests and rendered
// on one surface of four; this is the guard that would have caught it.
// ---------------------------------------------------------------------------

test("#345: every live renderResults call site is accounted for", () => {
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  const calls = [...src.matchAll(/renderResults\(/g)].map((m) => m.index);
  assert.strictEqual(calls.length, 3,
    `wizard.js has exactly the three known renderResults call sites; found ${calls.length}`);
  for (const at of calls) {
    const region = src.slice(at, src.indexOf(");", at) + 2);
    assert.ok(/\bmodel\b/.test(region) && /\bquery\b/.test(region) && /\bresult\b|\bsnap\b/.test(region),
      "each site must pass model, query and a result — the disclosure needs all three");
  }
  // Exactly one site renders a restored character with no solver attached. That
  // is KTD4's defined degraded state (disclose, do not price), not an oversight.
  const withoutHighs = [...src.matchAll(/renderResults\([^)]*highs:\s*null/g)];
  assert.strictEqual(withoutHighs.length, 1,
    "exactly one restored-snapshot site passes highs: null; pricing is withheld there by design");
});

test("#345: the pricing gate is a capability probe, not an assumption", () => {
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "results.js"), "utf-8");
  const fn = src.slice(src.indexOf("function canPriceOutbid()"), src.indexOf("function canPriceOutbid()") + 400);
  assert.ok(/typeof attributeOutbid === "function"/.test(fn), "probes the solver function");
  assert.ok(/!!highs/.test(fn), "and the solver instance — a restored render has none");
  assert.ok(/optimum && optimum\.program/.test(fn), "and the program the probe needs");
});
