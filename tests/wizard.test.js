// U1 — wizard step-machine pure helpers. Run: node tests/wizard.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { railModel, saveControl, resolveBannerShowing, resolveBannerPrimary, savedStep, stepOnLoad, nameCollides, runBelongsTo, overwriteConfirmText, missingRequired, missingRequiredMessage, weaponGroupSummary, WIZARD_STEPS, canAdvance, nextStep, prevStep, wizIsForged, buildQuery, cleanBoundMap, cleanCreditMap, creditKey, creditIsUsable, isPresenceOnly, isUntypedOnly, canDeclareCredit, advancedRowModel, advancedBadgeText, openPanels, openPanelToggle, openPanelSweep, openPanelClear, panelOpenAttr, stepAfterLoad, curatedStats, pickerVocabulary, PRESET_BUNDLES, BUNDLE_GROUPS, resolveBundle, addBundle, twfMigrationNeeded, pinWornSlotOf, pinHandsFor, pinIdOf, applyPin, applyPinId, removePinFrom, reconcilePinLegality, dualPinMutexConflict, resolvePriorityAdd, addBlocks, removeBlock, pinBlockedConflict, blockPinOverlap, blockStale, blockLoadMessage, noDropNote, rungFromInputs, healUtilityContainer, UTILITY_CONTAINER_CAP, containerList, containerAddable, containerEdit, containerSummary, containerAddHint } = require("../web/wizard.js");
const { normalizeDataset, buildPickerVocabulary } = require("../web/dataset.js");
const realData = normalizeDataset(JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8")));

/** #450 — slice a source region between two markers, with the closing search
 *  ANCHORED to the opening index.
 *
 *  The unanchored form — `src.slice(src.indexOf(A), src.indexOf(B))` — searches
 *  for B from position 0, so any earlier occurrence of B captures the closing
 *  bound, the range inverts, and `slice` returns "" rather than throwing. That
 *  has already cost this repo a confusing red (#348, where an unrelated feature
 *  inverted a guard about focus) and, in four cases, a silent green (#450).
 *
 *  Both markers are asserted present, so a renamed marker fails here naming the
 *  marker, instead of somewhere downstream naming a behaviour that is fine.
 */
function srcBetween(src, open, close, label) {
  const a = src.indexOf(open);
  assert.ok(a >= 0, `${label || "srcBetween"}: opening marker not found — ${open}`);
  const b = src.indexOf(close, a);
  assert.ok(b >= a, `${label || "srcBetween"}: closing marker not found after the opening — ${close}`);
  return src.slice(a, b);
}

/** #450 — the fixed-window variant: from a marker, forward N characters. Locates
 *  the marker ONCE (the two-call form can disagree with itself) and refuses a
 *  missing marker, which would otherwise make the start negative — and `slice`
 *  reads a negative start as an offset from the END of the string. */
function srcFrom(src, open, len, label) {
  const a = src.indexOf(open);
  assert.ok(a >= 0, `${label || "srcFrom"}: marker not found — ${open}`);
  return src.slice(a, a + len);
}

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

// #428 U6 (KD6) — armor JOINED this gate. The pre-#428 expectation ("race and a
// positive ML are enough") is superseded, not merely extended: a player who
// advanced without armor could solve for a loadout they cannot wear, because
// armor drives the dodge cap and filters what is equippable.
test("canAdvance(character): needs a race, a positive ML, and an armor type", () => {
  assert.ok(!canAdvance("character", { characterName: "Sook", race: "", ml: 34, armor: "light" }));
  assert.ok(!canAdvance("character", { characterName: "Sook", race: "Human", ml: 0, armor: "light" }));
  assert.ok(!canAdvance("character", { characterName: "Sook", race: "Human", ml: 34, armor: "" }));
  assert.ok(canAdvance("character", { characterName: "Sook", race: "Human", ml: 34, armor: "light" }));
  // …except for the Forged, who wear a docent and have no armor pick to make.
  assert.ok(canAdvance("character", { characterName: "Sook", race: "Warforged", ml: 34, armor: "" }));
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
  // #431 U3 (KTD8) — save takes the results bar's terminal slot and Edit
  // character moves before the spacer. The token is the RENDERER'S CALL, not the
  // button id: the bar's source holds an interpolation, not the rendered markup.
  stepResults: { advance: "saveControl(", back: 'data-goto="priorities"' },
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
  // #450 — anchored end marker, and a positive assertion over the slice. The
  // negative below is satisfied by an empty string, so without both of these an
  // inverted slice reports the header clean while reading nothing at all.
  const headAt = tpl.indexOf("wz-results-head");
  assert.ok(headAt >= 0, "the results header is in the template");
  const head = tpl.slice(headAt, tpl.indexOf('class="wz-actions"', headAt));
  assert.ok(/wz-eyebrow/.test(head), "and the slice really spans it");
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

// The load path's migration block, sliced from the helper call to the close of
// the `if (_dnMig && _dnMig.migratePriorities)` arm that holds it. Bounded by the
// construct, never by a character count: #381 added the retired-label arm inside
// this block and pushed the last assertion past a fixed 1200-char slice, which
// reads as "the wizard stopped recording the disclosure" when the wizard does
// exactly what it did before. A construct bound grows with the block.
function migrationBlock() {
  const at = WIZARD_SRC.indexOf("migratePriorities(state.priorities");
  assert.ok(at > 0, "loadCharacter consults the migration helper");
  const end = WIZARD_SRC.indexOf("\n      }\n", at);
  assert.ok(end > at, "the migration block's closing brace resolves");
  return WIZARD_SRC.slice(at, end);
}

// The source text of addPriority, from its declaration to the next declaration
// at the same indent — same rule as migrationBlock above.
function addPriorityEnd(at) {
  const end = WIZARD_SRC.indexOf("\n    function ", at + 1);
  assert.ok(end > at, "the slice's end marker resolves");
  return end;
}

// One function body out of any web source, bounded by the construct: from the
// declaration to the next `function` at the same indent. Both markers are
// asserted, so a rename fails loudly instead of widening the slice to the rest
// of the file or collapsing it to nothing.
// The offset of `marker` AFTER `at`, asserted. A positional end marker is the
// one case a global marker-resolves sweep cannot cover: the marker may exist in
// the file yet not after this anchor, and indexOf's -1 would then widen the
// slice to the whole remaining file instead of collapsing it.
function endAfter(src, marker, at) {
  const end = src.indexOf(marker, at + 1);
  assert.ok(end > at,
    `the end marker ${JSON.stringify(marker)} must resolve after the anchor — `
    + "a -1 here silently widens the slice to the rest of the file");
  return end;
}

function fnBody(src, decl, indent) {
  const at = src.indexOf(decl);
  assert.ok(at >= 0, `the source declares ${decl}`);
  const end = src.indexOf(`\n${" ".repeat(indent)}function `, at + 1);
  assert.ok(end > at, `the slice's end marker after ${decl} resolves`);
  return src.slice(at, end);
}

test("#169: the load path migrates expanded-away priorities and flags the disclosure", () => {
  const near = migrationBlock();
  assert.ok(/state\.priorities = migrated\.priorities/.test(near), "it adopts the substitution");
  assert.ok(/state\.expandedAwayMigrated = /.test(near), "and records it so the notice can render");
});

test("#169: the migration drops bounds stranded on the old name, and discloses it", () => {
  const near = migrationBlock();
  assert.ok(/delete map\[sub\.from\]/.test(near), "a cap/floor keyed to the old name is removed");
  assert.ok(/droppedBounds/.test(near), "and passed to the disclosure rather than dropped silently");
});

test("#381: the load path sweeps RETIRED substitutions through the same cleanup", () => {
  // A retired label's stranded cap/floor/credit is the same orphan #169 closed for
  // expanded-away names: model.js still unions the old name into the target set and
  // the solver reports a floor it can never satisfy, with no UI row to delete it.
  const near = migrationBlock();
  assert.ok(/migrated\.retired/.test(near), "the retired arm is read");
  assert.ok(/migrated\.substitutions\.concat\(_retiredSubs\)/.test(near),
    "and it walks the SAME bound/credit sweep, not a parallel one that can drift");
  assert.ok(/\{ retired: _retiredSubs \}/.test(near),
    "and reaches the disclosure, which gives it its own sentence");
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
  const end = WIZARD_SRC.indexOf("\n    function ", at + 1);
  assert.ok(end > at, "the slice's end marker resolves");
  const fn = WIZARD_SRC.slice(at, end);
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
    const fn = WIZARD_SRC.slice(at, endAfter(WIZARD_SRC, "\n    }", at));
    assert.ok(/_creditBonusTypes\.map/.test(fn), "options come from the shared list");
    assert.ok(/usedTypes\.has\(t\)/.test(fn), "already-declared types are disabled");
    assert.ok(/esc\(/.test(fn), "stat and type names reach innerHTML and must be escaped");
  });

  test("U2: the credit controls are labelled for screen readers", () => {
    const at = WIZARD_SRC.indexOf("function creditsHTML");
    const fn = WIZARD_SRC.slice(at, endAfter(WIZARD_SRC, "\n    }", at));
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
  // #450 — anchored, and proven non-empty before the negative runs.
  const rowsAt = WIZARD_SRC.indexOf("function rankedHTML");
  assert.ok(rowsAt >= 0, "rankedHTML is in the source");
  const rows = WIZARD_SRC.slice(rowsAt, WIZARD_SRC.indexOf("function advancedHTML", rowsAt));
  assert.ok(/state\.priorities\.map/.test(rows), "and the slice really spans its body");
  assert.ok(!/creditsHTML/.test(rows), "the row body never renders credits directly");
  const panel = srcBetween(WIZARD_SRC, "function advancedHTML", "function creditsHTML", "advancedHTML");
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
  const fn = WIZARD_SRC.slice(at, endAfter(WIZARD_SRC, "\n    }", at));
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
  const at = WIZARD_SRC.indexOf("for (const sub of migrated.substitutions");
  assert.ok(at > 0, "the sweep loop is found");
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
  const panel = srcBetween(WIZARD_SRC, "function advancedHTML", "function creditsHTML", "advancedHTML");
  assert.ok(/adv\.canCredit \? /.test(panel), "the credit block renders only when the stat can carry one");
  // and the row still reads as on/off in the markup
  const rows = srcBetween(WIZARD_SRC, "function rankedHTML", "function advancedHTML", "rankedHTML");
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
  // Re-ratified 2026-08-18 (#374/U6): `Magical Efficiency` became the fifth
  // dual-nature stat, and upstream is why. Its 100 magnitude carriers were
  // key-less (untyped) in the previous dump, which kept it out of the curated
  // rankable list; the refresh types them `Enhancement`, so it now carries a
  // real magnitude AND the 8 `Bool` lines it already had. Gating it on
  // `presence` alone would hide the min/max of a stat that has one — the exact
  // defect this test exists to block, now on a fifth name.
  const leaked = [...rv.presence].filter((x) => rv.magnitude.has(x));
  assert.deepStrictEqual(leaked.sort(),
    ["Deception", "Magical Efficiency", "Protection from Evil", "Smoke Screen",
     "Underwater Action"],
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
  const panel = srcBetween(WIZARD_SRC, "function advancedHTML", "function creditsHTML", "advancedHTML");
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
  const body = srcFrom(wire, "const refreshBadge", 400, "refreshBadge");
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
  const cadd = srcBetween(wire, "b.dataset.cadd != null", "b.dataset.crem != null", "credit-add branch");
  assert.ok(/after = \(\) => focusCreditValue\(key\)/.test(cadd), "add lands the caret in the new field");
  const crem = srcBetween(wire, "b.dataset.crem != null", "rerender();", "credit-remove branch");
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
  // #450 — the marker was located twice and the lower bound could go NEGATIVE,
  // which `slice` reads as an offset from the END of the string: a marker within
  // 120 chars of the start would have sliced an unrelated tail, and the negative
  // assertion below would most likely have passed over it. Located once, clamped,
  // and proven to contain the marker before anything is asserted about it.
  const attrAt = step.indexOf('data-group="attributes"');
  assert.ok(attrAt >= 0, "the Attributes row is in the template");
  const attrRow = step.slice(Math.max(0, attrAt - 120), attrAt + 40);
  assert.ok(attrRow.includes('data-group="attributes"'), "and the window really contains it");
  assert.ok(!/hidden/.test(attrRow), "the Attributes row is always visible");
});

test("R1/R2: the Advanced panel is ordered after the reorder controls", () => {
  // `.wz-adv` precedes `.wz-ctl` in DOM order and takes a full flex line, so
  // without an explicit order it pushed ↑ ↓ ✕ onto a third line on every
  // magnitude row while presence rows stayed on one — the exact misalignment
  // this change exists to remove.
  const css = fs.readFileSync(path.join(__dirname, "..", "web", "styles.css"), "utf-8");
  const rule = srcBetween(css, ".wz-adv {", ".wz-adv >", ".wz-adv rule");
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
  const panel = srcBetween(WIZARD_SRC, "function advancedHTML", "function creditsHTML", "advancedHTML");
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
  return srcBetween(WIZARD_SRC, "const ADVANCED_PANEL_HELP", "// U2/KTD1", "ADVANCED_PANEL_HELP");
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
    const fn = WIZARD_SRC.slice(at, addPriorityEnd(at));
    assert.ok(/resolvePriorityAdd\(/.test(fn), "it delegates to the shared resolver");
    assert.ok(/state\.priorities = res\.priorities/.test(fn), "and adopts the substituted list");
  });

  test("U11: a bound attached to the alias is DROPPED and reported, not remapped", () => {
    const at = WIZARD_SRC.indexOf("function addPriority(");
    assert.ok(at > 0, "addPriority exists");
    const fn = WIZARD_SRC.slice(at, addPriorityEnd(at));
    assert.ok(/targetCaps, state\.targetFloors/.test(fn), "both bound maps are swept");
    assert.ok(/delete map\[sub\.from\]/.test(fn), "the bound keyed to the alias is removed");
    assert.ok(/droppedBounds/.test(fn), "and disclosed rather than dropped silently");
    assert.ok(!/targetFloors\[sub\.to/.test(fn) && !/targetCaps\[sub\.to/.test(fn),
      "and never copied onto a component — 'min 4 Parrying' is not 'min 4 Armor Class'");
  });

  test("U11: a declared credit keyed to the alias is cleared and reported", () => {
    const at = WIZARD_SRC.indexOf("function addPriority(");
    assert.ok(at > 0, "addPriority exists");
    const fn = WIZARD_SRC.slice(at, addPriorityEnd(at));
    assert.ok(/declaredCredits/.test(fn), "credits are swept too");
    assert.ok(/c\.stat === sub\.from/.test(fn),
      "credits key on stat PLUS bonus type, so they need their own matcher");
    assert.ok(/droppedCredits/.test(fn), "and are disclosed separately");
  });

  test("U11: the substitution is disclosed inline at the picker", () => {
    const at = WIZARD_SRC.indexOf("function addPriority(");
    assert.ok(at > 0, "addPriority exists");
    const fn = WIZARD_SRC.slice(at, addPriorityEnd(at));
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
    const pEnd = WIZARD_SRC.indexOf("\n    function ", at + 1);
    assert.ok(pEnd > at, "the slice's end marker resolves");
    const fn = WIZARD_SRC.slice(at, pEnd);
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
  const end = WIZARD_SRC.indexOf("\n    function ", start + 1);
  assert.ok(end > start, "the slice's end marker resolves");
  const slice = WIZARD_SRC.slice(start, end);
  assert.ok(/blockStage\.clear\(\);/.test(slice),
    "ticks staged on the previous character must not commit into this one");
  assert.ok(/state\.blockRefusedMsg = null;/.test(slice), "the refusal message resets too");
});

test("review/#110: the load path sanitizes blocklist elements to non-empty strings", () => {
  const start = WIZARD_SRC.indexOf("function loadCharacter(");
  const end = WIZARD_SRC.indexOf("\n    function ", start + 1);
  assert.ok(end > start, "the slice's end marker resolves");
  const slice = WIZARD_SRC.slice(start, end);
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
    // #429 review #5 — this used to slice to `function renderSavedPicker`, which
    // #428 renamed to railHTML. indexOf returned -1, slice(at, -1) covered the
    // rest of the file, and all four assertions below could match anywhere. The
    // end marker is now asserted rather than assumed.
    const end = WIZARD_SRC.indexOf("\n    function railHTML", at);
    assert.ok(end > at, "the slice's end marker resolves — an unresolved one silently widens it");
    const fn = WIZARD_SRC.slice(at, end);
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
  const block = srcFrom(src, 'id="wz-setaug"', 1800, "wz-setaug block");
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
test("#332/#380: both live buildModel call sites thread {counting, notCounted}", () => {
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  const calls = [...src.matchAll(/buildModel\(/g)].map((m) => m.index);
  assert.strictEqual(calls.length, 2, "wizard.js has exactly the two known buildModel call sites");
  for (const at of calls) {
    const region = src.slice(at, src.indexOf(");", at) + 2);
    assert.ok(/counting:\s*vocab\.utilityCounting/.test(region),
      `a buildModel call at index ${at} must pass the counting set as { counting: ... }`);
    assert.ok(/notCounted:\s*vocab\.utilityNotCounted/.test(region),
      `a buildModel call at index ${at} must pass the not-counted names as { notCounted: ... }`);
    assert.ok(!/\badmitted:/.test(region),
      `a buildModel call at index ${at} must not carry the pre-#380 \`admitted\` key`);
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
  // The guard's claim is about the VOCABULARY ARGUMENT, not about the arity: #88
  // U10 added a third `hooks` argument, and a guard that pins the closing paren
  // would fail on every future argument while proving nothing more about the one
  // it exists to protect. `[,)]` keeps the position assertion and drops the arity.
  assert.ok(/ItemBrowser\.initBrowse\(\s*dataset\s*,\s*pickerVocabulary\(dataset\)\s*[,)]/.test(src),
    "initBrowse must be passed pickerVocabulary(dataset) as its second argument, not dataset alone");
  assert.ok(!/ItemBrowser\.initBrowse\(\s*dataset\s*\)/.test(src),
    "the pre-#332 single-argument form must not survive");
});

// #88 U10 (R32) — the same shape of guard for the same shape of risk. Browse is
// one of the two creation surfaces R32 names, and it renders its control ONLY
// when a host supplies the hook. Dropping the hook at the call site removes the
// surface silently: no error, no failing unit test, just a feature that quietly
// is not there — which is precisely why #332 needed a guard of its own.
test("#88 U10: Browse is handed the override hook that renders its creation control", () => {
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  assert.ok(/initBrowse\([\s\S]{0,200}?onOverride\s*:/.test(src),
    "the initBrowse call must pass an onOverride hook");
  const browse = fs.readFileSync(path.join(__dirname, "..", "web", "browse.js"), "utf-8");
  assert.ok(/hooks\s*&&\s*hooks\.onOverride/.test(browse),
    "…and browse.js must gate its control on that hook rather than assuming it");
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
  const fn = fnBody(src, "function canPriceOutbid()", 2);
  assert.ok(/typeof attributeOutbid === "function"/.test(fn), "probes the solver function");
  assert.ok(/!!highs/.test(fn), "and the solver instance — a restored render has none");
  assert.ok(/optimum && optimum\.program/.test(fn), "and the program the probe needs");
});

test("#345 U4: every live render site can accept a trade, not just the fresh one", () => {
  // Requiring needs no solver — it writes a floor and re-solves through the
  // wizard's own path — so the restored-character site offers it even though it
  // cannot price. If a site drops onRequire, its accept button silently vanishes.
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  const calls = [...src.matchAll(/renderResults\(/g)].map((m) => m.index);
  assert.strictEqual(calls.length, 3, "the three known sites");
  for (const at of calls) {
    const region = src.slice(at, src.indexOf(");", at) + 2);
    assert.ok(/onRequire:\s*requireOutbidStat/.test(region),
      "each site must pass the accept handler");
  }
});

test("#345 U4: the accept handler writes the same field the Advanced input writes", () => {
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  const fn = fnBody(src, "function requireOutbidStat(stat)", 4);
  assert.ok(/state\.targetFloors/.test(fn),
    "writes targetFloors — the field cleanBoundMap sanitizes and persist.js stores");
  assert.ok(/solve\(false\)/.test(fn), "and re-solves so the player sees the result");
  // persist.js must actually carry it, or the requirement dies on reload.
  const persist = fs.readFileSync(path.join(__dirname, "..", "web", "persist.js"), "utf-8");
  assert.ok(/"targetFloors"/.test(persist),
    "targetFloors must be a persisted field or an accepted trade is lost on reload");
});

// ---------------------------------------------------------------------------
// U5 (plan 2026-08-17-001, #345) — a required effect says so on its row.
// ---------------------------------------------------------------------------

test("#345 U5: a floored row reports required; an unfloored one does not", () => {
  const st = { priorities: ["Ghostly", "Deadly"], targetFloors: { Ghostly: 1 }, targetCaps: {} };
  assert.strictEqual(advancedRowModel("Ghostly", st, {}).required, true);
  assert.strictEqual(advancedRowModel("Deadly", st, {}).required, false);
});

test("#345 U5: required is derived from the floor, never stored separately", () => {
  // One representation. A second stored flag could disagree with the bound the
  // solve actually received, and the row would assert a constraint that is not real.
  const st = { priorities: ["Ghostly"], targetFloors: { Ghostly: 1 }, targetCaps: {} };
  assert.strictEqual(advancedRowModel("Ghostly", st, {}).required, true);
  delete st.targetFloors.Ghostly;
  assert.strictEqual(advancedRowModel("Ghostly", st, {}).required, false,
    "clearing the floor clears the marker with no second write");
});

test("#345 U5: a zero floor is not a requirement", () => {
  const st = { priorities: ["Ghostly"], targetFloors: { Ghostly: 0 }, targetCaps: {} };
  assert.strictEqual(advancedRowModel("Ghostly", st, {}).required, false,
    "min 0 constrains nothing and must not read as required");
});

test("#345 U5: the Utility container never reports required", () => {
  const S = require("../web/model.js").UTILITY_SENTINEL;
  const st = { priorities: [S], targetFloors: { [S]: 1 }, targetCaps: {} };
  const m = advancedRowModel(S, st, {});
  assert.strictEqual(m.suppressed, true, "the sentinel row renders no Advanced panel");
  assert.ok(!m.required, "and never claims a requirement — it is not a ranked stat");
});

test("#345 U5: the marker and the clear control are both on the row", () => {
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  assert.ok(/adv\.required \? ` <span class="wz-adv-req">/.test(src),
    "the summary carries Required as text, visible without opening Advanced");
  assert.ok(/wz-clear-req/.test(src), "and the row offers a way to clear it");
  assert.ok(/delete state\.targetFloors\[p\]/.test(src),
    "clearing deletes the floor itself, not a parallel flag");
});

// ---------------------------------------------------------------------------
// #348 (U6) — the pinned Utility container row and its curation panel.
// ---------------------------------------------------------------------------

test("#348 U6/KTD3: null follows the default roster, an array is the player's own", () => {
  const vocab = { presence: new Set(["Ghostly", "True Seeing", "Blurry"]), magnitude: new Set(),
    utilityOrder: ["Ghostly", "True Seeing"] };
  assert.deepStrictEqual(containerList({ utilityContainer: null }, vocab), ["Ghostly", "True Seeing"],
    "untouched follows the current default — a later roster revision reaches the player");
  assert.deepStrictEqual(containerList({ utilityContainer: ["Blurry"] }, vocab), ["Blurry"],
    "curated is frozen against roster changes — their list is theirs");
  assert.deepStrictEqual(containerList({ utilityContainer: [] }, vocab), [],
    "an EMPTY array is a real state, not a synonym for untouched");
});

test("#348 U6/R5: an add beyond the cap is refused with a stated reason", () => {
  const full = Array.from({ length: UTILITY_CONTAINER_CAP }, (_, i) => `Effect ${i}`);
  const res = containerEdit(full, "add", "One More");
  assert.strictEqual(res.ok, false, "refused");
  assert.deepStrictEqual(res.list, full, "and the list is untouched");
  assert.ok(res.message && /at most 28 effects/.test(res.message), "the cap is named");
  assert.ok(/strict order/.test(res.message), "and WHY it exists, not just that it does");
  // The cap is the encoding gate's number, not a UI choice. #349 raised it from
  // 20 to 28 after the gate measured exact agreement through 32 — 20 had only
  // ever been "the largest size anyone had measured".
  assert.strictEqual(UTILITY_CONTAINER_CAP, 28);
});

test("#348 U6/R4: reorder and remove work by position; a duplicate add is a no-op", () => {
  assert.deepStrictEqual(containerEdit(["a", "b", "c"], "up", 2).list, ["a", "c", "b"]);
  assert.deepStrictEqual(containerEdit(["a", "b", "c"], "down", 0).list, ["b", "a", "c"]);
  assert.deepStrictEqual(containerEdit(["a", "b", "c"], "remove", 1).list, ["a", "c"]);
  assert.strictEqual(containerEdit(["a"], "up", 0).ok, false, "no-op at the top");
  assert.strictEqual(containerEdit(["a"], "down", 0).ok, false, "no-op at the bottom");
  assert.strictEqual(containerEdit(["a"], "add", "a").ok, false, "a duplicate never doubles a position");
});

test("#348 U6/KTD9: search spans every presence effect; empty search suggests the defaults", () => {
  const vocab = {
    presence: new Set(["Ghostly", "True Seeing", "Blurry", "Deathblock", "Seeker"]),
    magnitude: new Set(["Seeker"]),                    // has a magnitude -> not a presence toggle
    utilityOrder: ["Ghostly", "True Seeing"],
  };
  assert.deepStrictEqual(containerAddable(vocab, [], "", 12), ["Ghostly", "True Seeing"],
    "no query -> the declared defaults, in declared order");
  assert.deepStrictEqual(containerAddable(vocab, ["Ghostly"], "", 12), ["True Seeing"],
    "what the container already holds is never offered again");
  const hits = containerAddable(vocab, [], "bl", 12);
  assert.ok(hits.includes("Blurry") && hits.includes("Deathblock"),
    "a query reaches the whole presence population, not just the defaults");
  assert.ok(!containerAddable(vocab, [], "seek", 12).includes("Seeker"),
    "a name with a magnitude is rankable on its own and is not a container effect");
});

test("#348 U6/R3/KTD10: the collapsed summary distinguishes empty from removed", () => {
  assert.ok(/Empty/.test(containerSummary([])), "an empty container says so");
  assert.ok(/remove this row entirely/.test(containerSummary([])),
    "and points at the different action that means 'no utility at all'");
  assert.strictEqual(containerSummary(["A", "B"]), "A, B", "short lists show in full");
  assert.strictEqual(containerSummary(["A", "B", "C", "D"]), "A, B, C +1 more",
    "long lists still show what leads, so the panel is not the only way to see it");
});

// ---------------------------------------------------------------------------
// #348 (U7) — the second-generation heal. Three generations of saved character
// must be distinguishable, and each must heal exactly once.
// ---------------------------------------------------------------------------

const SENT_U7 = "Utility effects";

test("#348 U7/R13/AE6: a mid-list tier is pinned to the bottom and the player is told", () => {
  const saved = ["Strength", "Constitution", SENT_U7, "Dodge"];
  const h = healUtilityContainer(saved, false);       // tier-aware, pre-container
  assert.deepStrictEqual(h.priorities, ["Strength", "Constitution", "Dodge", SENT_U7],
    "the row moves to the bottom, and the ranked stats keep their order");
  assert.strictEqual(h.moved, true);
  assert.ok(h.message, "a notice fires");
  assert.ok(/moved there from where you had it/.test(h.message), "it names the move");
  assert.ok(/default set of nice-to-have effects/.test(h.message), "and the seeding");
  assert.ok(/unchanged until you re-solve/.test(h.message),
    "and that the saved loadout has not changed — without this the notice reads as 'your build changed'");
});

test("#348 U7/R12/AE6: a post-container save restores verbatim and never re-heals", () => {
  const saved = ["Strength", SENT_U7, "Dodge"];       // deliberately mid-list
  const h = healUtilityContainer(saved, true);        // container-aware
  assert.deepStrictEqual(h.priorities, saved, "a marked record is never rearranged");
  assert.strictEqual(h.message, null, "and never re-notified");
});

test("#348 U7: a tier already at the bottom is seeded and told, without claiming it moved", () => {
  const h = healUtilityContainer(["Strength", SENT_U7], false);
  assert.strictEqual(h.moved, false);
  assert.ok(h.message && !/moved there/.test(h.message),
    "the notice must not assert a move that did not happen");
  assert.ok(/pinned container/.test(h.message), "but still explains what the row became");
});

test("#348 U7: a player who removed the row keeps it removed, with nothing to say", () => {
  const h = healUtilityContainer(["Strength", "Dodge"], false);
  assert.deepStrictEqual(h.priorities, ["Strength", "Dodge"], "removal is a decision, not damage");
  assert.strictEqual(h.message, null, "and there is nothing to tell them about");
});


test("#348 U6/R5: the empty-suggestion copy answers the dead end the player is in", () => {
  // Found by opening the panel in a browser, not by reading the code: the original
  // copy ("Every default effect is already in your container") was true, useless,
  // and left both the cap and the other ~800 addable effects unexplained.
  // #349 — the default roster (25) is now BELOW the cap (28), so an untouched
  // panel no longer opens full. This test drives the at-cap state explicitly
  // rather than relying on the two numbers coinciding, which is why it still
  // covers the branch after the widening.
  const full = Array.from({ length: UTILITY_CONTAINER_CAP }, (_, i) => `E${i}`);
  const atCap = containerAddHint(full, "", false);
  assert.ok(/full \(28\/28\)/.test(atCap), "names the cap");
  assert.ok(/Remove an effect/.test(atCap), "and the action that resolves it");
  assert.ok(/order is what decides/.test(atCap), "and points at the thing that still helps them");

  const room = containerAddHint(["E0"], "", false);
  assert.ok(/Search to add any other/.test(room), "with room, invite the search that reaches the rest");
  assert.ok(!/full/.test(room), "and do not imply a cap that is not binding");

  assert.ok(/No on\/off effect matches/.test(containerAddHint(["E0"], "zzzz", false)),
    "a failed search says so plainly");
  assert.strictEqual(containerAddHint(["E0"], "", true), null,
    "when there ARE suggestions, no hint at all");
});


// --- #404: the companion hint reaches the picker ----------------------------
//
// dataset.test.js owns the hint's own rules. This owns the WIRING: the resolver
// must carry it out on a successful plain add, or the sentence exists and no
// player ever sees it.

test("#404: a successful plain add carries the companion hint", () => {
  const vocab = buildPickerVocabulary(realData);
  const out = resolvePriorityAdd("Void Intensity", vocab, ["Constitution"]);
  assert.strictEqual(out.ok, true);
  assert.deepStrictEqual(out.priorities, ["Constitution", "Void Intensity"], "the add still happens");
  assert.ok(out.companionHint && /Spell Intensity/.test(out.companionHint),
    "and the hint rides out with it");
});

test("#404: the hint is computed against the POST-add list", () => {
  // Adding the companion itself must not then suggest it back. Computing against
  // the pre-add list would do exactly that on the second of the two adds.
  const vocab = buildPickerVocabulary(realData);
  const out = resolvePriorityAdd("Spell Intensity", vocab, ["Void Intensity"]);
  assert.strictEqual(out.ok, true);
  assert.ok(!out.companionHint, "no hint once both are ranked");
});

test("#404: an ordinary add carries no hint field at all", () => {
  const vocab = buildPickerVocabulary(realData);
  const out = resolvePriorityAdd("Constitution", vocab, []);
  assert.strictEqual(out.ok, true);
  assert.ok(!("companionHint" in out), "absent, not an empty string — callers test truthiness");
});


// --- #359: owned-augment mode ----------------------------------------------
//
// The augment half of inventory mode. Base items were always restricted to the
// export; augments came from the full catalog. Restricting them STRICTLY to the
// export would cut 1063 augments to ~123 and delete gear nobody farms, so the
// pool is `owned UNION acquirable` — acquirable being the wiki's
// Common/Uncommon/Rare rarity classes, stamped at build time.

const ownedState = (over) => Object.assign(baseState(), {
  pool: "owned", ownedNames: new Set(["My Ring", "Essence of The Masque"]),
}, over || {});

// A stand-in catalog: one owned item, one unowned item, and three augments —
// one owned, one acquirable, one neither.
const OA_ITEMS = [
  { variant_id: "My Ring", source_item: "My Ring", category: "item", slot: "Ring" },
  { variant_id: "Not Mine", source_item: "Not Mine", category: "item", slot: "Ring" },
  { variant_id: "Essence of The Masque", source_item: "Essence of The Masque", category: "augment" },
  { variant_id: "Diamond of Constitution +12", source_item: "Diamond of Constitution +12",
    category: "augment", acquirable: true },
  { variant_id: "Crystallized Unicorn Tear", source_item: "Crystallized Unicorn Tear", category: "augment" },
];

/** Mirrors wizard.js candidateItems() — the filter under test is pure set logic,
 *  and the wizard's own copy closes over `state`/`dataset` inside the IIFE. */
function candidates(state, items) {
  if (state.pool === "owned" && state.ownedNames) {
    return items.filter((v) => (v.category === "augment"
      ? (!state.ownedAugments || v.acquirable === true
         || state.ownedNames.has(v.source_item || v.variant_id))
      : state.ownedNames.has(v.source_item || v.variant_id)));
  }
  return items;
}

test("#359: with the toggle OFF, owned mode is unchanged — every augment stays", () => {
  const out = candidates(ownedState({ ownedAugments: false }), OA_ITEMS).map((v) => v.variant_id);
  assert.deepStrictEqual(out.sort(), [
    "Crystallized Unicorn Tear", "Diamond of Constitution +12",
    "Essence of The Masque", "My Ring",
  ].sort(), "base items restricted, augment pool untouched");
});

test("#359: with the toggle ON, augments narrow to owned UNION acquirable", () => {
  const out = candidates(ownedState({ ownedAugments: true }), OA_ITEMS).map((v) => v.variant_id);
  assert.ok(out.includes("Essence of The Masque"), "a NAMED augment the player owns is kept");
  assert.ok(out.includes("Diamond of Constitution +12"), "an acquirable augment is kept even unowned");
  assert.ok(!out.includes("Crystallized Unicorn Tear"),
    "a named augment the player does NOT own is dropped — the whole point");
  assert.ok(!out.includes("Not Mine"), "base items stay restricted");
});

test("#359: the toggle does nothing outside owned mode", () => {
  const all = candidates(Object.assign(baseState(), { pool: "all", ownedAugments: true }), OA_ITEMS);
  assert.strictEqual(all.length, OA_ITEMS.length, "full-catalog mode is never filtered");
});

test("#359: acquirable is strict-true, never a truthy accident", () => {
  // A stale build could leave the field absent; `acquirable: "yes"` or `1` must
  // not slip an unowned named augment through.
  const odd = [{ variant_id: "Odd", source_item: "Odd", category: "augment", acquirable: "yes" }];
  const out = candidates(ownedState({ ownedAugments: true }), odd);
  assert.deepStrictEqual(out, [], "only a real boolean true admits an unowned augment");
});


// ---- #88 U5 — restoring overrides at the load boundary (R20/R21/R23) --------
// The load path ALWAYS assigns, because `state` outlives a character: an override
// left over from the previous one would otherwise silently retype this build's
// gear. The sanitization is the blocklist precedent — a hand-edited backup can
// carry entries no reader can use, and they would re-persist on every save.
const { restoreOverrides, OVERRIDE_LIMIT } = require("../web/wizard.js");

test("#88 U5 (R21/AE10): a pre-feature save restores an empty override list", () => {
  assert.deepStrictEqual(restoreOverrides({ ml: 34 }), [], "absent reads as none");
  assert.deepStrictEqual(restoreOverrides({ overrides: null }), []);
  assert.deepStrictEqual(restoreOverrides({}), []);
  assert.deepStrictEqual(restoreOverrides(null), [], "a record with no inputs at all");
});

test("#88 U5 (R20/R22): a saved override restores with its recorded type intact", () => {
  const o = { variant_id: "Aberrant Robe", name: "Armor Class", from: "Armor",
              value: "5", to: "Enhancement", note: "seen in game" };
  const got = restoreOverrides({ overrides: [o] });
  assert.deepStrictEqual(got, [o]);
  assert.notStrictEqual(got[0], o, "restored entries are copies — the record is not aliased into state");
});

test("#88 U5: malformed entries are dropped at the load boundary, not re-persisted", () => {
  const good = { variant_id: "Aberrant Robe", name: "Armor Class", from: "Armor",
                 value: "5", to: "Enhancement" };
  const got = restoreOverrides({ overrides: [
    good,
    null, "a string", 7,
    { name: "Armor Class", from: "Armor", to: "Enhancement", value: "5" },   // no target
    { variant_id: "X", from: "Armor", to: "Enhancement", value: "5" },       // no affix name
    { variant_id: "X", name: "Armor Class", to: "Enhancement", value: "5" }, // no recorded type
    { variant_id: "X", name: "Armor Class", from: "Armor", value: "5" },     // no replacement
  ] });
  assert.deepStrictEqual(got, [good], "only the well-formed entry survives");
});

test("#88 U6 (R8): a pool-keyed override is well-formed without a variant_id", () => {
  const crafted = { pool_key: "seal||heroic||Constitution||Enhancement||6",
                    name: "Constitution", from: "Enhancement", value: "6", to: "Quality" };
  assert.deepStrictEqual(restoreOverrides({ overrides: [crafted] }), [crafted],
    "crafted options live outside item variants and are addressed by pool key");
});


// ---- #88 U7 (R25/R27/R28) — the load-time lifecycle disclosure --------------
// A refresh can move, adopt, or retire the type an override was written against.
// Whichever happened, the player is told on the load that detects it — a saved
// character quietly changing what it solves is the defect this prevents.
const { overrideLoadMessage } = require("../web/wizard.js");
const _ov = (name, extra) => Object.assign(
  { variant_id: "Aberrant Robe", name, from: "Armor", value: "5", to: "Enhancement" }, extra || {});

test("#88 U7 (AE7): an all-active list discloses nothing", () => {
  assert.strictEqual(overrideLoadMessage([
    { override: _ov("Armor Class"), state: "active", reason: null, now: null },
  ]), null, "no prompt when nothing changed");
  assert.strictEqual(overrideLoadMessage([]), null);
  assert.strictEqual(overrideLoadMessage(null), null);
});

test("#88 U7 (AE4/R27): drift names the affix and the type it moved to", () => {
  const msg = overrideLoadMessage([
    { override: _ov("Armor Class"), state: "suspended", reason: "drift", now: "Profane" },
  ]);
  assert.ok(/Armor Class/.test(msg), "the affix is named");
  assert.ok(/Armor/.test(msg) && /Profane/.test(msg), "both the recorded and the current type");
  assert.ok(/suspended/i.test(msg), "and its state");
});

test("#88 U7 (AE5/R25): satisfaction is disclosed and says the override is kept", () => {
  const msg = overrideLoadMessage([
    { override: _ov("Armor Class"), state: "satisfied", reason: null, now: null },
  ]);
  assert.ok(/Enhancement/.test(msg), "the type upstream adopted");
  assert.ok(/kept|retained/i.test(msg), "R26 — it is retained, not deleted");
});

test("#88 U7 (R28): a retired target is disclosed with its reason", () => {
  const msg = overrideLoadMessage([
    { override: _ov("Armor Class"), state: "suspended", reason: "retired-target", now: null },
  ]);
  assert.ok(/no longer/i.test(msg) && /Armor Class/.test(msg));
});

test("#88 U7: a crafted override is named by its pool key, not a missing item name", () => {
  const msg = overrideLoadMessage([
    { override: { pool_key: "seal||Gloom||equipment/accessories||Charisma||Insight||7",
                  name: "Charisma", from: "Insight", to: "Quality", value: "7" },
      state: "suspended", reason: "drift", now: "Sacred" },
  ]);
  assert.ok(/Charisma/.test(msg));
  assert.ok(!/undefined/.test(msg), "a pool-keyed override has no variant_id to print");
});

test("#88 U7: one line per changed override, and only the changed ones", () => {
  const msg = overrideLoadMessage([
    { override: _ov("Armor Class"), state: "active", reason: null, now: null },
    { override: _ov("Fortitude Save"), state: "suspended", reason: "drift", now: "Profane" },
    { override: _ov("Dodge"), state: "satisfied", reason: null, now: null },
  ]);
  assert.ok(!/Armor Class/.test(msg), "an active override is not news");
  assert.ok(/Fortitude Save/.test(msg) && /Dodge/.test(msg));
});


// ---- #88 U8 (R30) — the stale banner's reason -------------------------------
const { staleNote } = require("../web/wizard.js");
const _applied = (to) => [{ variant_id: "X", name: "Armor Class", from: "Armor", to, count: 1 }];

test("#88 U8 (R30): a build solved under the overrides in force now is not stale", () => {
  const run = { query: { overrides: _applied("Enhancement") } };
  assert.strictEqual(staleNote({ lastRun: run, overrideApplied: _applied("Enhancement") }), null);
});

test("#88 U8 (AE22/R30): creating or deleting an override marks the shown result stale", () => {
  const run = { query: { overrides: [] } };
  const created = staleNote({ lastRun: run, overrideApplied: _applied("Enhancement") });
  assert.ok(/different set of bonus-type corrections/.test(created));
  const deleted = staleNote({ lastRun: { query: { overrides: _applied("Enhancement") } }, overrideApplied: [] });
  assert.ok(/different set of bonus-type corrections/.test(deleted));
});

test("#88 U8 (AE9): a restored result whose override has since suspended is stale, not re-solved", () => {
  // The suspended override never reaches today's APPLIED list, so the sets differ.
  const run = { query: { overrides: _applied("Enhancement") } };
  const note = staleNote({ lastRun: run, overrideApplied: [], loadedStale: false });
  assert.ok(note, "the player is told");
  assert.ok(/corrections/.test(note), "…and told which of the two causes it is");
});

test("#88 U8: the catalog-age cause still reports itself when overrides are unchanged", () => {
  const run = { query: { overrides: [] } };
  assert.ok(/predates the current gear catalog/.test(
    staleNote({ lastRun: run, overrideApplied: [], loadedStale: true })));
});

test("#88 U8: with no solved build on screen there is nothing to call stale", () => {
  assert.strictEqual(staleNote({ lastRun: null, overrideApplied: _applied("Enhancement") }), null);
  assert.strictEqual(staleNote({}), null);
  assert.strictEqual(staleNote(null), null);
});


// ---- review #9 — an imported override list is bounded at the load boundary ---
// A backup file is user-supplied and shareable, and backup.js's size cap admits
// tens of thousands of override rows. Both load-path consumers do work per row,
// so an unbounded list is a synchronous main-thread block on every load of that
// character — and it re-persists, so it happens again next time.
test("#88 review #9: the restored override list is capped", () => {
  const one = (i) => ({ variant_id: `Item ${i}`, name: "Armor Class", from: "Armor",
                        value: "5", to: "Enhancement" });
  const huge = Array.from({ length: 5000 }, (_, i) => one(i));
  const got = restoreOverrides({ overrides: huge });
  assert.ok(got.length < huge.length, "the list is bounded");
  assert.strictEqual(got.length, OVERRIDE_LIMIT, "…at the declared cap");
  assert.deepStrictEqual(got[0], one(0), "and it keeps the FIRST entries, not an arbitrary slice");
});

test("#88 review #9: an ordinary list is untouched by the cap", () => {
  const list = [{ variant_id: "X", name: "Armor Class", from: "Armor", value: "5", to: "Enhancement" }];
  assert.deepStrictEqual(restoreOverrides({ overrides: list }), list);
});


// ---- #88 U10/U11 — the list transformations behind the surfaces -------------
// Kept pure and exported, like every other wizard helper, so the semantics are
// tested directly rather than through the render path. The DOM wrappers do two
// things only: assign the result to state, and re-apply the overlay.
const { addOverrideTo, removeOverrideAt, reconfirmOverrideAt } = require("../web/wizard.js");
const _k = (name, from) => ({ variant_id: "Aberrant Robe", name, from, value: "5" });

test("#88 U10: adding an override appends it with its replacement and note", () => {
  const r = addOverrideTo([], _k("Armor Class", "Armor"), "Enhancement", "seen in game");
  assert.ok(r.ok);
  assert.deepStrictEqual(r.list, [{ variant_id: "Aberrant Robe", name: "Armor Class",
    from: "Armor", value: "5", to: "Enhancement", note: "seen in game" }]);
});

test("#88 U10: a second override on the same affix REPLACES the first, never duplicates", () => {
  const first = addOverrideTo([], _k("Armor Class", "Armor"), "Enhancement", "").list;
  const second = addOverrideTo(first, _k("Armor Class", "Armor"), "Sacred", "changed my mind");
  assert.strictEqual(second.list.length, 1, "one affix, one correction");
  assert.strictEqual(second.list[0].to, "Sacred");
  assert.strictEqual(second.list[0].note, "changed my mind");
});

test("#88 U10: a malformed or reserved replacement is refused rather than stored", () => {
  assert.ok(!addOverrideTo([], _k("Armor Class", "Armor"), "Bool", "").ok, "reserved token");
  assert.ok(!addOverrideTo([], _k("Armor Class", "Armor"), "", "").ok, "empty replacement");
  assert.ok(!addOverrideTo([], { variant_id: "X" }, "Sacred", "").ok, "incomplete identity");
});

test("#88 U10 (review #9): the ceiling is enforced at the creation surface too", () => {
  const full = Array.from({ length: OVERRIDE_LIMIT }, (_, i) => ({
    variant_id: `Item ${i}`, name: "Armor Class", from: "Armor", value: "5", to: "Enhancement" }));
  const r = addOverrideTo(full, _k("Armor Class", "Armor"), "Sacred", "");
  assert.ok(!r.ok, "refused rather than silently dropped later");
  assert.strictEqual(r.error, "limit");
  assert.strictEqual(r.list.length, OVERRIDE_LIMIT, "and the list is unchanged");
});

test("#88 U11: deleting returns a new list without that entry", () => {
  const list = [{ variant_id: "A", name: "n", from: "f", value: "1", to: "t" },
                { variant_id: "B", name: "n", from: "f", value: "1", to: "t" }];
  const got = removeOverrideAt(list, 0);
  assert.deepStrictEqual(got.map((o) => o.variant_id), ["B"]);
  assert.strictEqual(list.length, 2, "the input list is not mutated");
  assert.deepStrictEqual(removeOverrideAt(list, 9), list, "an out-of-range index is a no-op");
});

test("#88 U11 (KTD9/R35): re-confirm re-anchors the recorded type and keeps identity", () => {
  const list = [{ variant_id: "Aberrant Robe", name: "Armor Class", from: "Armor",
                  value: "5", to: "Enhancement", note: "why I said so" }];
  const r = reconfirmOverrideAt(list, 0, "Profane");
  assert.ok(r.ok);
  assert.strictEqual(r.list[0].from, "Profane", "anchored to what upstream now says");
  assert.strictEqual(r.list[0].to, "Enhancement", "the player's claim is unchanged");
  assert.strictEqual(r.list[0].note, "why I said so", "and the note survives — this is not a replacement");
});

test("#88 U11: re-confirm needs a type to anchor to", () => {
  const list = [{ variant_id: "A", name: "n", from: "f", value: "1", to: "t" }];
  assert.ok(!reconfirmOverrideAt(list, 0, null).ok, "a retired target has nothing to confirm against");
  assert.ok(!reconfirmOverrideAt(list, 9, "Profane").ok, "out of range");
  assert.ok(!reconfirmOverrideAt(list, 0, "t").ok,
    "anchoring the recorded type onto the player's own replacement would make it satisfied-by-construction");
});


// #88 U10 (AE19/R31/R32) — BOTH creation surfaces exist and reach the same
// builder. The plan names two on purpose: the results card is where a wrong
// total is noticed, and Browse is the only one that reaches an item the current
// loadout does not contain. A surface that quietly stopped rendering its control
// would leave the other still working, so neither can vouch for the other.
test("#88 U10 (AE19): both creation surfaces are wired, to one shared builder", () => {
  const fs = require("fs"); const path = require("path");
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", "web", f), "utf-8");
  const results = read("results.js"), browse = read("browse.js"), wiz = read("wizard.js");

  assert.ok(/data-act="override"/.test(results), "the results card offers the control (R31)");
  assert.ok(/act\.dataset\.act === "override"/.test(wiz), "…and the wizard acts on it");
  assert.ok(/data-correct=/.test(browse), "Browse offers the control (R32)");
  // #426 — the handler gained a third parameter. An item row is resolvable from
  // its id against the catalog; a synthesized crafted row is not, so Browse hands
  // back the row itself and the provenance stamped on it is what reaches the pool.
  assert.ok(/onOverride:\s*\(variantId, host, row\)/.test(wiz), "…and the wizard supplies its handler");
  assert.ok(/poolPickerEntriesFor\(/.test(wiz), "…which routes a crafted row to the pool picker");

  // One builder, one predicate. Neither surface may compute its own entry list:
  // two surfaces disagreeing about what is overridable is indistinguishable, from
  // the player's side, from the catalog being inconsistent.
  assert.ok(/O\.pickerEntries\(/.test(wiz), "the picker renders from Overrides.pickerEntries");
  for (const [name, src] of [["results.js", results], ["browse.js", browse]]) {
    assert.ok(!/pickerEntries|eligibleAffixes|isEligible/.test(src),
      `${name} must not keep its own copy of the eligibility predicate`);
  }
});

// #88 U10 (R33/AE17) — the picker names the three causes of a wrong recorded
// type, and says to check the wiki first. This is the only place the player
// learns the difference between a defect worth reporting for everyone and a
// disagreement only they can hold, and it is the difference the whole correction
// report depends on being understood.
test("#88 U10 (R33): the creation surface names the three causes and the wiki check", () => {
  const fs = require("fs"); const path = require("path");
  const wiz = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  const lead = (wiz.match(/pd-override-lead[\s\S]{0,600}?<\/p>/) || [""])[0];
  assert.ok(lead, "the picker renders a lead paragraph");
  assert.ok(/catalog copied it wrong/i.test(lead), "cause 1: our catalog is wrong");
  assert.ok(/wiki itself is\s*\n?\s*wrong/i.test(lead), "cause 2: the wiki is wrong");
  assert.ok(/game changed/i.test(lead), "cause 3: the game moved and neither caught up");
  assert.ok(/Check the wiki page first/i.test(lead),
    "…and the step that tells the three apart");
});


// ---- review fixes: the override creation surfaces ---------------------------

// findOverrideFor is the lookup createOverride uses to hand the freshly-made
// override to the report. It was written inline as
//   o.variant_id === key.variant_id || o.pool_key === key.pool_key
// which collapses on two ITEM overrides: neither carries a pool_key, so
// `undefined === undefined` satisfies the second clause and any override
// sharing the affix name and recorded type matches — from a different item.
const { findOverrideFor } = require("../web/wizard.js");

test("review: findOverrideFor does not match a different item on undefined pool_key", () => {
  const a = { variant_id: "Aberrant Robe", name: "Armor Class", from: "Armor", value: "5", to: "Enhancement" };
  const b = { variant_id: "Cloak of Night", name: "Armor Class", from: "Armor", value: "5", to: "Sacred" };
  const list = [a, b];
  assert.strictEqual(findOverrideFor(list, b), b, "the second item's override, not the first");
  assert.strictEqual(findOverrideFor(list, a), a);
});

test("review: findOverrideFor matches a pool-keyed override on its key", () => {
  const p = { pool_key: "seal||Gloom||equipment/accessories||Charisma||Insight||7",
              name: "Charisma", from: "Insight", value: "7", to: "Quality" };
  const q = { pool_key: "seal||Gloom||equipment/accessories||Charisma||Quality||3",
              name: "Charisma", from: "Quality", value: "3", to: "Insight" };
  assert.strictEqual(findOverrideFor([p, q], q), q);
});

test("review: findOverrideFor returns null when nothing matches", () => {
  assert.strictEqual(findOverrideFor([], { variant_id: "X", name: "n", from: "f", value: "1" }), null);
  assert.strictEqual(findOverrideFor(null, { variant_id: "X", name: "n", from: "f", value: "1" }), null);
});

// The picker resolves a variant id against dataset.items. Browse's table also
// carries 472 CRAFTED rows whose synthetic ids resolve to nothing there, and the
// control was rendered on every row — so pressing it on a crafted row said
// "nothing here can be corrected", which is false: those rows carry eligible
// affixes, addressed by pool key rather than variant id.
test("review: Browse offers the correction control only on rows the picker can serve", () => {
  const fs = require("fs"); const path = require("path");
  const browse = fs.readFileSync(path.join(__dirname, "..", "web", "browse.js"), "utf-8");
  assert.ok(/hooks\.canOverride/.test(browse),
    "browse.js gates the control on a host-supplied predicate");
  assert.ok(!/data-correct="\$\{esc\(v\.variant_id\)\}"[^`]*`;\s*$/m.test(browse)
    || /canOverride\(v\)/.test(browse),
    "…and the predicate is consulted per row, not assumed");
  const wiz = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  assert.ok(/canOverride:\s*\(v\)/.test(wiz), "the wizard supplies that predicate");
});

// ---------------------------------------------------------------------------
// #428 U1/U2 (R25-R31) — repository references off the UI, and the footer's
// build stamp promoted to a labelled first position.
//
// These are SOURCE-TEXT guards for the same reason as the wiring guards above:
// the step bodies are template literals inside the browser-only block, so no
// unit test can observe what they render. A count removed from one template and
// left in another is exactly the drift a per-template sweep catches.
// ---------------------------------------------------------------------------

// The source text of one wizard step template, sliced from its declaration to
// the next top-level `function` at the same indent. Used by the count sweep so
// the assertion names the offending step rather than "somewhere in wizard.js".
function stepSource(name) {
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  const at = src.indexOf(`function ${name}() {`);
  assert.ok(at >= 0, `wizard.js declares ${name}`);
  const end = src.indexOf("\n    function ", at + 1);
  return src.slice(at, end < 0 ? src.length : end);
}

test("#428 (AE8): no wizard step template quotes a dataset-derived count", () => {
  for (const step of ["stepIntro", "stepCharacter", "stepPool", "stepPriorities", "stepResults"]) {
    const body = stepSource(step);
    assert.ok(!/dataset\.items\b[\s\S]{0,20}\.length/.test(body),
      `${step} must not interpolate the catalog size`);
    assert.ok(!/\bitem_count\b/.test(body),
      `${step} must not interpolate the dataset's item_count`);
    assert.ok(!/\.toLocaleString\(\)\s*\}\s*indexed/.test(body),
      `${step} must not render an "N indexed" count`);
  }
});

test("#428 (AE8): the intro's opening copy carries no digit-grouped count", () => {
  const intro = stepSource("stepIntro");
  // The lead paragraph is what a player reads first (R26). A count reaches it
  // only through an interpolation or a hardcoded numeral; both are refused.
  assert.ok(!/\d{1,3},\d{3}/.test(intro), "no literal thousands-separated number in the intro");
  assert.ok(!/\$\{n\b/.test(intro), "the removed count variable must not survive");
});

test("#428 (AE8): the footer carries no item count, and app.js writes none", () => {
  const fs = require("fs"); const path = require("path");
  const html = fs.readFileSync(path.join(__dirname, "..", "web", "index.html"), "utf-8");
  assert.ok(!/id="dataset-info"/.test(html), "the footer's count host is gone");
  const app = fs.readFileSync(path.join(__dirname, "..", "web", "app.js"), "utf-8");
  assert.ok(!/dataset-info/.test(app), "…and nothing writes to it");
  assert.ok(!/item_count\s*\?\?/.test(app), "…including the item_count fallback that fed it");
});

test("#428 (AE9): per-result coverage disclosure survives — it describes the solve", () => {
  // R27's carve-out. coverageNote is dataset-SCOPED but result-facing: it states
  // what the solve searched, which is the one place a number is about the answer
  // rather than about the repository.
  const R = require("../web/results.js");
  const note = R.coverageNote({ metadata: { color_coverage: { augments_placeable: 42 } } });
  assert.ok(note && /Optimized:/.test(note), "the disclosure still renders");
  assert.ok(/42 placeable/.test(note), "…with its per-solve counts intact");
});

test("#428 (AE10): the footer puts a labelled build stamp before attribution", () => {
  const fs = require("fs"); const path = require("path");
  const html = fs.readFileSync(path.join(__dirname, "..", "web", "index.html"), "utf-8");
  const foot = srcBetween(html, "<footer", "</footer>", "footer");
  assert.ok(foot, "index.html has a footer");
  const build = foot.indexOf('id="build-info"');
  const attrib = foot.indexOf("ddowiki.com");
  assert.ok(build >= 0 && attrib >= 0, "both the build stamp and attribution are in the footer");
  assert.ok(build < attrib, "the build stamp comes first (R29 — a fixed, findable position)");
  assert.ok(/class="build-label"/.test(foot), "the stamp carries a visible 'Build' label (R28)");
  assert.ok(/>Build</.test(foot), "…and the label reads 'Build'");
});

test("#428 (R30): footer attribution keeps both credits and both links", () => {
  const fs = require("fs"); const path = require("path");
  const html = fs.readFileSync(path.join(__dirname, "..", "web", "index.html"), "utf-8");
  const foot = srcBetween(html, "<footer", "</footer>", "footer");
  assert.ok(/https:\/\/ddowiki\.com/.test(foot), "the DDO Wiki link survives");
  assert.ok(/illusionistpm\/ddo-gear-planner/.test(foot), "the Gear Planner link survives");
  assert.ok(/illusionistpm/.test(foot), "…and its author is still credited");
});

test("#428 (R28): the build value renders monospaced so successive stamps align", () => {
  const fs = require("fs"); const path = require("path");
  const css = fs.readFileSync(path.join(__dirname, "..", "web", "styles.css"), "utf-8");
  const at = css.indexOf(".build-info");
  assert.ok(at >= 0, "styles.css styles .build-info");
  const rule = css.slice(at, endAfter(css, "}", at));
  assert.ok(/font-family:[^;]*mono/i.test(rule), ".build-info renders in a monospaced face");
});

test("#428 (R31): the footer reads as distinct elements, not one run-on line", () => {
  const fs = require("fs"); const path = require("path");
  const html = fs.readFileSync(path.join(__dirname, "..", "web", "index.html"), "utf-8");
  // #450 — anchored, and proven to span the real footer before the negative runs.
  const footAt = html.indexOf("<footer");
  assert.ok(footAt >= 0, "index.html has a footer");
  const foot = html.slice(footAt, html.indexOf("</footer>", footAt));
  assert.ok(/class="footer-build"/.test(foot), "and the slice really spans it");
  assert.ok(!/<span>\s*·/.test(foot), "no leading separator dot joining spans into a sentence");
  const app = fs.readFileSync(path.join(__dirname, "..", "web", "app.js"), "utf-8");
  assert.ok(!/textContent\s*=\s*`\s*·\s*Build/.test(app),
    "app.js must not prefix the stamp with a run-on separator");
});

// ---------------------------------------------------------------------------
// #428 U3 (R13/R14/R17/R20/R21) — the save rail. Save, Load, Delete and the
// build's name are reachable from EVERY step, so the rail cannot live inside a
// step template (KTD4). Its model is pure so the rail's contents are testable
// without a DOM; the placement itself is a source-text guard.
// ---------------------------------------------------------------------------

test("#428 U3: railModel reports an empty state when nothing is saved or loaded", () => {
  const m = railModel({ characterName: "", loadedName: "" }, []);
  assert.strictEqual(m.loaded, false);
  assert.strictEqual(m.loadedName, "");
  assert.deepStrictEqual(m.saved, []);
  assert.strictEqual(m.empty, true);
});

test("#428 U3 (AE7): with two builds saved, loading the second shows the second name", () => {
  const saved = [{ name: "Sook — Reaper" }, { name: "Pagos — Fighter" }];
  const m = railModel({ characterName: "Pagos — Fighter", loadedName: "Pagos — Fighter" }, saved);
  assert.strictEqual(m.loaded, true);
  assert.strictEqual(m.loadedName, "Pagos — Fighter", "R20 — the loaded name is visible while editing it");
  assert.deepStrictEqual(m.saved, ["Sook — Reaper", "Pagos — Fighter"]);
});

test("#428 U3 (R21): deleting the loaded build returns the rail to its empty state", () => {
  const before = railModel({ characterName: "Sook", loadedName: "Sook" }, [{ name: "Sook" }]);
  assert.strictEqual(before.loaded, true);
  // The store is the authority: `loaded` is DERIVED from the record still being
  // there, so a delete cannot leave a phantom name in the rail through some
  // second flag a delete path forgot to clear.
  const after = railModel({ characterName: "Sook", loadedName: "Sook" }, []);
  assert.strictEqual(after.loaded, false);
  assert.strictEqual(after.loadedName, "");
  assert.strictEqual(after.empty, true);
});

test("#428 U3: railModel tolerates a junk store without inventing entries", () => {
  const m = railModel({}, [null, { name: "" }, { name: "Real" }, "nope"]);
  assert.deepStrictEqual(m.saved, ["Real"]);
});

test("#428 U3 (R17): the flow carries exactly one build-name input", () => {
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  assert.ok(!/wz-charname/.test(src), "the gear-pool step's Character name field is gone");
  assert.ok(!/wz-savename/.test(src), "the results step's second name input is gone");
  const hits = (src.match(/id="wz-buildname"/g) || []).length;
  assert.strictEqual(hits, 1, "exactly one name input renders anywhere in the flow");
});

test("#428 U3 (R14/KTD4): the rail renders from render(), not from any step body", () => {
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  const render = src.slice(src.indexOf("function render() {"));
  assert.ok(/railHTML\(\)/.test(render.slice(0, render.indexOf("\n    }"))),
    "render() emits the rail beside the step body");
  for (const step of ["stepIntro", "stepCharacter", "stepPool", "stepPriorities", "stepResults"]) {
    assert.ok(!/railHTML\(/.test(stepSource(step)), `${step} must not render its own rail`);
  }
});

test("#428 U3 (R24) / #431 U3 (R9): the rail offers load and delete only", () => {
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  const at = src.indexOf("function railHTML(");
  assert.ok(at >= 0, "wizard.js declares railHTML");
  const body = src.slice(at, endAfter(src, "\n    function ", at));
  // #431 U3 (R9) supersedes R24's save clause: saving moved to the action bars,
  // so the rail is no longer an action surface at all.
  assert.ok(!/wz-railsave/.test(body), "the rail no longer saves — that moved to the bars");
  assert.ok(/data-railload/.test(body), "it loads");
  assert.ok(/data-raildel/.test(body), "…and deletes");
  assert.ok(!/wz-export|wz-import|Export all|Import a backup/.test(body),
    "…and offers no backup export or import (R24)");
});

// ---------------------------------------------------------------------------
// #428 U4 (R15/R16/R18) — a saved build reopens where the player stopped.
// `step` joins INPUT_KEYS (KTD1) rather than becoming a new top-level record
// field, so the backup round-trip inherits it with no second allowlist edit.
// ---------------------------------------------------------------------------

test("#428 U4: savedStep reads only a step this flow actually has", () => {
  assert.strictEqual(savedStep({ step: "character" }), "character");
  assert.strictEqual(savedStep({ step: "results" }), "results");
  assert.strictEqual(savedStep({}), null, "a pre-feature record records no step");
  assert.strictEqual(savedStep({ step: "nowhere" }), null, "an unknown step is not a step");
  assert.strictEqual(savedStep({ step: 3 }), null, "…nor is an index");
  assert.strictEqual(savedStep(null), null);
});

test("#428 U4 (AE4): a build saved mid-flow reopens at the step it was saved on", () => {
  assert.strictEqual(stepOnLoad({ step: "character" }, null), "character");
  assert.strictEqual(stepOnLoad({ step: "pool" }, null), "pool");
  assert.strictEqual(stepOnLoad({ step: "priorities" }, null), "priorities");
});

test("#428 U4: a pre-feature record with no step lands where stepAfterLoad sends it", () => {
  // Unchanged behavior, asserted so the fallback cannot rot: this is what every
  // record written before the feature carries.
  assert.strictEqual(stepOnLoad({}, { status: "optimal" }), "results");
  assert.strictEqual(stepOnLoad({}, null), "priorities");
  assert.strictEqual(stepOnLoad({}, { status: "infeasible" }), "priorities");
});

test("#428 U4: a record claiming 'results' without an optimal snapshot is not believed", () => {
  // Every other step renders from inputs alone. Results renders from a solved
  // snapshot, so honouring a saved "results" without one would restore a blank
  // results view — exactly the failure stepAfterLoad exists to prevent.
  assert.strictEqual(stepOnLoad({ step: "results" }, null), "priorities");
  assert.strictEqual(stepOnLoad({ step: "results" }, { status: "optimal" }), "results");
});

test("#428 U4 (KTD1): step rides the save allowlist, so the backup inherits it", () => {
  const { INPUT_KEYS } = require("../web/persist.js");
  assert.ok(INPUT_KEYS.includes("step"),
    "step is a saved INPUT, not a new top-level record field");
});

test("#428 U4 (R15): pickInputs captures the in-progress step with no solve", () => {
  const P = require("../web/persist.js");
  const inputs = P.pickInputs({ step: "character", ml: 30, race: "Elf" }, "Sook");
  assert.strictEqual(inputs.step, "character");
  assert.strictEqual(inputs.characterName, "Sook");
});

test("#428 U4 (R15): serializeCharacter writes a record with no snapshot and no query", () => {
  const P = require("../web/persist.js");
  const r = P.serializeCharacter("Mid-flow", { step: "pool", ml: 30, race: "Elf" }, null, "b1");
  assert.strictEqual(r.inputs.step, "pool");
  assert.strictEqual(r.query, null, "nothing was solved, so there is no query");
  assert.deepStrictEqual(r.snapshot, {}, "…and no snapshot");
  // …and it still routes back to where it was saved.
  assert.strictEqual(stepOnLoad(r.inputs, r.snapshot), "pool");
});

test("#428 U4 (R18/AE5): nothing persists unless the player saves", () => {
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  // The store is written from exactly two places: the explicit save the rail
  // triggers, and the backup import. No autosave, no unload hook, no timer.
  const writes = (src.match(/CharacterStore\.save(Character|Many)\(/g) || []);
  assert.strictEqual(writes.length, 2,
    `expected exactly the save-button and import writes; found ${writes.length}`);
  assert.ok(!/beforeunload|visibilitychange/.test(src),
    "no unload hook quietly persists an unsaved build");
  assert.ok(!/setInterval\(/.test(src), "no autosave timer");
});

test("#428 U4 (R15): saving no longer requires a solved build", () => {
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  const at = src.indexOf("function saveCurrentCharacter(");
  const body = src.slice(at, endAfter(src, "\n    }", at));
  assert.ok(!/no-build/.test(body),
    "the pre-#428 'solve first' refusal is gone — an in-progress build is savable");
  assert.ok(/no-name/.test(body), "…but an unnamed one still is not (R13)");
});

// ---------------------------------------------------------------------------
// #428 U5 (R19) — the unsaved-changes guard. KD5 makes saving explicit, which
// leaves unsaved work losable, so leaving a step while dirty says so rather than
// discarding silently. The message is built from state (KTD3) and tested here;
// the dialog it renders is not the thing under test.
// ---------------------------------------------------------------------------

test("#428 U5 (KTD3): the flag is cleared by save and by load, and by nothing else", () => {
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  const clears = (src.match(/inputsDirty = false/g) || []).length;
  assert.ok(clears >= 2, "at least the save path and the load path clear it");
  const save = src.slice(src.indexOf("function saveCurrentCharacter("));
  assert.ok(/inputsDirty = false/.test(save.slice(0, save.indexOf("\n    }"))),
    "a successful save clears the flag");
  const load = src.slice(src.indexOf("function loadCharacter("));
  assert.ok(/inputsDirty = false/.test(load.slice(0, load.indexOf("\n    function "))),
    "loading a build clears it — a freshly loaded build is not unsaved work");
});

test("#428 U5 (KTD3): every write that marks constraints dirty also marks inputs dirty", () => {
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  const sites = [...src.matchAll(/state\.constraintsDirty = true;/g)].map((m) => m.index);
  assert.ok(sites.length >= 4, `expected the known constraintsDirty writes; found ${sites.length}`);
  for (const at of sites) {
    assert.ok(/markDirty\(\)/.test(src.slice(at, at + 200)),
      `the constraintsDirty write at index ${at} must also raise inputsDirty (KTD3)`);
  }
});

test("#428 U5: the guard gates player navigation, not the app's own step changes", () => {
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  // Solving and loading move the player deliberately; a guard there would fire on
  // the one action that is ABOUT to produce the thing worth saving.
  assert.ok(/function navigate\(/.test(src), "player navigation goes through navigate()");
  for (const nav of ['data-next', 'data-back', 'data-goto']) {
    const at = src.indexOf(`querySelectorAll("[${nav}]")`);
    assert.ok(at >= 0, `${nav} is wired`);
    assert.ok(/navigate\(/.test(src.slice(at, at + 260)),
      `${nav} navigation is guarded`);
  }
});

// ---------------------------------------------------------------------------
// #428 U6 (R1-R12) — the character step reads as grouped and required-marked,
// and an unanswered required field stops Continue and says which.
//
// KD6 adds armor to the required set, which is a GATE change rather than a
// labelling one: a player who advances today without setting armor will be
// stopped. The Forged exemption below is why that gate is satisfiable at all.
// ---------------------------------------------------------------------------

test("#428 U6 (R2a): the required set is race, ML cap and armor", () => {
  assert.deepStrictEqual(missingRequired({ characterName: "Sook", race: "", ml: 0, armor: "" }).sort(),
    ["armor", "ml", "race"]);
  assert.deepStrictEqual(missingRequired({ characterName: "Sook", race: "Human", ml: 30, armor: "light" }), []);
});

test("#428 U6 (AE1): race blank is reported as missing", () => {
  assert.deepStrictEqual(missingRequired({ characterName: "Sook", race: "", ml: 30, armor: "light" }), ["race"]);
});

test("#428 U6 (AE2a): armor blank blocks even with race and ML cap set", () => {
  const st = { characterName: "Sook", race: "Human", ml: 30, armor: "" };
  assert.deepStrictEqual(missingRequired(st), ["armor"]);
  assert.ok(!canAdvance("character", st), "the gate armor newly joins is ENFORCED, not merely displayed");
});

test("#428 U6 (AE2): all three set advances regardless of optional fields", () => {
  assert.ok(canAdvance("character", { characterName: "Sook", race: "Human", ml: 30, armor: "cloth" }));
  assert.ok(canAdvance("character", { characterName: "Sook", race: "Human", ml: 30, armor: "cloth",
    alignment: "", oath: "", style: "", weaponTypes: [] }));
});

test("#428 U6 (KD6): a Forged race is exempt from the armor requirement", () => {
  // Warforged and Bladeforged wear a docent; the armor control is disabled and
  // the race handler CLEARS state.armor. Requiring it of them would be a gate no
  // player could satisfy — the step would simply never advance.
  for (const race of ["Warforged", "Bladeforged"]) {
    assert.deepStrictEqual(missingRequired({ characterName: "Sook", race, ml: 30, armor: "" }), [],
      `${race} needs no armor pick`);
    assert.ok(canAdvance("character", { characterName: "Sook", race, ml: 30, armor: "" }));
  }
});

// ---------------------------------------------------------------------------
// #431 U1 (KTD12) — the build name joins the same gate. Isolated coverage, on
// purpose: every assertion in this file's gate cluster fails on some OTHER
// blank field, so a name check that never ran would still pass them all for
// the wrong reason. These pin the `name` key on its own.
// ---------------------------------------------------------------------------

test("#431 U1 (AE2): all four required fields set advances", () => {
  assert.ok(canAdvance("character", { characterName: "Sook", race: "Human", ml: 30, armor: "cloth" }));
});

test("#431 U1 (AE1): a blank name blocks, on the name key alone", () => {
  const st = { characterName: "", race: "Human", ml: 30, armor: "cloth" };
  assert.deepStrictEqual(missingRequired(st), ["name"]);
  assert.ok(!canAdvance("character", st), "the name gate is ENFORCED, not merely displayed");
});

test("#431 U1: a name that is only whitespace counts as absent", () => {
  assert.deepStrictEqual(
    missingRequired({ characterName: "   ", race: "Human", ml: 30, armor: "cloth" }), ["name"]);
});

test("#431 U1 (KTD1): the name leads the missing list, so it leads the message and the scroll", () => {
  assert.deepStrictEqual(
    missingRequired({ characterName: "", race: "", ml: 30, armor: "cloth" }), ["name", "race"]);
});

test("#431 U1 (AE1): the message names the build name, and names it alongside a second field", () => {
  const one = missingRequiredMessage({ characterName: "", race: "Human", ml: 30, armor: "cloth" });
  assert.ok(/[Bb]uild name/.test(one), one);
  const both = missingRequiredMessage({ characterName: "", race: "", ml: 30, armor: "cloth" });
  assert.ok(/[Bb]uild name/.test(both), both);
  assert.ok(/[Rr]ace/.test(both), both);
});

test("#431 U1: the Forged armor exemption still holds once a name is present", () => {
  for (const race of ["Warforged", "Bladeforged"]) {
    assert.deepStrictEqual(
      missingRequired({ characterName: "Sook", race, ml: 30, armor: "" }), [], race);
    assert.ok(canAdvance("character", { characterName: "Sook", race, ml: 30, armor: "" }));
  }
});

test("#428 U6 (AE3): a loaded build carrying all three marks nothing as needing an answer", () => {
  const loaded = { characterName: "Sook", race: "Elf", ml: 34, armor: "medium" };
  assert.deepStrictEqual(missingRequired(loaded), []);
  assert.strictEqual(missingRequiredMessage(loaded), null);
});

test("#428 U6 (AE3a): a build saved before KD6 carries no armor and is marked", () => {
  const preKd6 = { characterName: "Sook", race: "Elf", ml: 34, armor: "" };
  assert.deepStrictEqual(missingRequired(preKd6), ["armor"]);
  assert.ok(/[Aa]rmor/.test(missingRequiredMessage(preKd6)));
});

test("#428 U6 (R10): one message names EVERY unanswered field, not only the first", () => {
  const msg = missingRequiredMessage({ race: "", ml: 0, armor: "" });
  assert.ok(/Race/.test(msg), "names race");
  assert.ok(/level/i.test(msg), "names the ML cap");
  assert.ok(/[Aa]rmor/.test(msg), "names armor");
  const one = missingRequiredMessage({ race: "", ml: 30, armor: "light" });
  assert.ok(/Race/.test(one) && !/[Aa]rmor/.test(one), "and names only what is actually missing");
});

test("#428 U6: missingRequired treats a non-positive or non-numeric ML cap as unanswered", () => {
  for (const ml of ["", null, undefined, 0, "0", "abc", -3]) {
    assert.ok(missingRequired({ race: "Human", ml, armor: "light" }).includes("ml"),
      `ML ${JSON.stringify(ml)} is not an answer`);
  }
  assert.ok(!missingRequired({ race: "Human", ml: "30", armor: "light" }).includes("ml"),
    "a numeric string is an answer — the input is a string at runtime");
});

test("#428 U6 (R6a): a collapsed weapon group states whether it holds set values", () => {
  const empty = weaponGroupSummary({ weaponTypes: [], offHand: [], offHandWeapons: [] }, "");
  assert.ok(/nothing set/i.test(empty), "an unopened group is never mistaken for an empty one");
  const set = weaponGroupSummary({ twoWeaponFighting: true, style: "one-hand",
    weaponTypes: ["Dagger", "Rapier"], offHand: ["empty"], offHandWeapons: [] }, "One-hand / Dual-wield");
  assert.ok(!/nothing set/i.test(set));
  assert.ok(/Two Weapon Fighting/.test(set), "the declaration is named");
  assert.ok(/One-hand/.test(set), "the style is named by its label, not its id");
  assert.ok(/2 weapon types/.test(set), "the picks are counted");
  assert.ok(/1 off-hand/.test(set));
});

test("#428 U6 (R11): the invalid treatment adds no repeating animation", () => {
  const fs = require("fs"); const path = require("path");
  const css = fs.readFileSync(path.join(__dirname, "..", "web", "styles.css"), "utf-8");
  const at = css.indexOf(".wz-invalid");
  assert.ok(at >= 0, "styles.css defines the invalid treatment");
  const rule = css.slice(at, endAfter(css, "}", at));
  assert.ok(!/animation/.test(rule), "no animation (WCAG 2.3.1 — KD4)");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  const fn = src.slice(src.indexOf("function showMissingRequired("));
  assert.ok(!/wz-nudge/.test(fn.slice(0, fn.indexOf("\n    }"))),
    "the character step does not fall back to the nudge (KTD2)");
});

test("#428 U6 (KTD2): the pool and priorities steps still nudge the Continue button", () => {
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  const at = src.indexOf("function blockFeedback(");
  assert.ok(at >= 0, "the generic handler became step-aware rather than being rewritten");
  const body = src.slice(at, endAfter(src, "\n    }", at));
  assert.ok(/flashBlock\(\)/.test(body), "other steps keep the nudge");
  assert.ok(/"character"/.test(body), "…and only the character step gets the field treatment");
});

test("#428 U6 (R1/R2/R4): the character step renders three labelled groups in order", () => {
  const body = stepSource("stepCharacter");
  const req = body.indexOf('data-group="required"');
  const restr = body.indexOf('data-group="restrictions"');
  const weap = body.indexOf('data-group="weapons"');
  assert.ok(req >= 0 && restr >= 0 && weap >= 0, "all three groups exist");
  assert.ok(req < restr && restr < weap, "required first, then restrictions, then weapon setup (R4)");
  assert.ok(/<details[^>]*data-group="weapons"/.test(body), "weapon setup is the collapsible one (R6)");
  assert.ok(!/<details[^>]*data-group="required"/.test(body), "required fields are visible without interaction (R6)");
  assert.ok(!/<details[^>]*data-group="restrictions"/.test(body), "…and so are restrictions (R6)");
});

test("#431 U4 (KTD4): saveCurrentCharacter's store-integrity refusal is untouched", () => {
  const f = fnBody(WIZARD_SRC, "function saveCurrentCharacter(", 4);
  assert.ok(/no-name/.test(f),
    "the refusal stays: CharacterStore keys records by name, so an empty one would "
    + "mint a \"\"-keyed record");
});

test("#431 U3 (AE3/KTD5/KTD6): one renderer puts save on four bars, and not on intro", () => {
  for (const step of ["stepCharacter", "stepPool", "stepPriorities", "stepResults"]) {
    assert.ok(/saveControl\(/.test(actionRow(step)), `${step} carries the save control`);
  }
  assert.ok(!/saveControl\(/.test(actionRow("stepIntro")),
    "intro runs before the character step, so there is no name and nothing to save");
  const calls = (WIZARD_SRC.match(/\$\{saveControl\(/g) || []).length;
  assert.strictEqual(calls, 4, "exactly four call sites — a sixth step cannot ship without one");
});

test("#431 U3 (AE6/KTD7): save is ghost beside a forward action, and conditional on results", () => {
  for (const step of ["stepCharacter", "stepPool", "stepPriorities"]) {
    assert.ok(/saveControl\("ghost"\)/.test(actionRow(step)),
      `${step} already has a primary forward action, so save is ghost there`);
  }
  const results = actionRow("stepResults");
  assert.ok(/saveControl\(resolveBannerShowing\(state\) \? "ghost" : "primary"\)/.test(results),
    "on results save is the bar's primary, except while a re-solve banner holds it");
});

test("#432: only the first SHOWING re-solve banner in document order holds primacy", () => {
  // The three raise from independent flags and can co-show. Document order is
  // wz-stale, wz-twfmig, wz-cbar.
  assert.strictEqual(resolveBannerPrimary({}), null, "none showing, no claim");
  assert.strictEqual(resolveBannerPrimary({ loadedStale: true }), "wz-stale");
  assert.strictEqual(resolveBannerPrimary({ twfMigrated: true }), "wz-twfmig");
  assert.strictEqual(resolveBannerPrimary({ constraintsDirty: true }), "wz-cbar");
  // Co-showing pairs and the full set: the earliest in document order wins.
  assert.strictEqual(resolveBannerPrimary({ loadedStale: true, twfMigrated: true }), "wz-stale",
    "a loaded stale build that also migrated TWF raises both on first paint");
  assert.strictEqual(resolveBannerPrimary({ twfMigrated: true, constraintsDirty: true }), "wz-twfmig");
  assert.strictEqual(resolveBannerPrimary({ loadedStale: true, constraintsDirty: true }), "wz-stale");
  assert.strictEqual(
    resolveBannerPrimary({ loadedStale: true, twfMigrated: true, constraintsDirty: true }), "wz-stale",
    "all three up — still exactly one primary");
});

test("#432 review: the live re-rank reads what is ON SCREEN, not the state flags", () => {
  // `staleNote` accumulates three causes and its dismissal clears only one of
  // them, hiding the element while the flag behind it can stay truthy. Ranking
  // from state there would award `primary` to the button just hidden and ghost
  // every visible control, leaving the step with no primary at all.
  const f = fnBody(WIZARD_SRC, "function refreshResultsEmphasis() {", 4);
  const loop = srcBetween(f, "for (", "wz-save", "re-rank loop");
  assert.ok(/wz-hidden/.test(loop),
    "the re-rank decides `showing` from the element's own wz-hidden class");
  assert.ok(!/resolveBannerPrimary/.test(loop),
    "…and NOT by re-deriving the claimant from state, which can disagree with the DOM");
});

test("#432: the banner buttons take their class from the ranking, not a hardcoded primary", () => {
  const body = stepSource("stepResults");
  const hardcoded = (body.match(/class="btn primary" id="wz-(stale|twfmig|c)resolve"/g) || []);
  assert.deepStrictEqual(hardcoded, [],
    "no re-solve banner may hardcode `btn primary` — two co-showing would both claim it");
  for (const id of ["wz-stale", "wz-twfmig", "wz-cbar"]) {
    assert.ok(new RegExp(`resolveBannerPrimary\\(state\\) === "${id}"`).test(body),
      `${id}'s button asks the ranking whether it holds primacy`);
  }
});

test("#431 U3 (KTD7): resolveBannerShowing counts the three re-solve banners only", () => {
  assert.strictEqual(resolveBannerShowing({}), false);
  assert.strictEqual(resolveBannerShowing({ loadedStale: true }), true, "the stale banner");
  assert.strictEqual(resolveBannerShowing({ twfMigrated: true }), true, "the TWF migration banner");
  assert.strictEqual(resolveBannerShowing({ constraintsDirty: true }), true, "the constraints banner");
  // The four migrationBanner notices share the wz-cbar class but their buttons
  // are ghosts, so they do not contend for primacy and must not ghost save.
  for (const notice of ["expandedAwayMigrated", "utilityHealNotice", "blockLoadNotice", "overrideNotice"]) {
    assert.strictEqual(resolveBannerShowing({ [notice]: "something happened" }), false,
      `${notice} is a ghost-button notice, not a re-solve banner`);
  }
});

test("#431 U3 (KTD7): every site that mutates a re-solve banner refreshes save's emphasis", () => {
  // Banner visibility is changed imperatively, without a re-render, so a class
  // assigned at render time would never flip. A fifth banner path cannot ship
  // without a refresh call.
  assert.ok(/refreshResultsEmphasis\(\)/.test(fnBody(WIZARD_SRC, "function refreshStaleBanner() {", 4)),
    "the in-place stale toggle re-ranks");
  const calls = (WIZARD_SRC.match(/\n\s+refreshResultsEmphasis\(\)/g) || []).length;
  assert.ok(calls >= 4, `expected the four banner-mutation sites to re-rank, saw ${calls}`);
});

test("#431 U3 (R6/KTD7): save also yields to the Adjust & re-solve fold-up", () => {
  // A FOURTH primary lives inside that fold (web/wizard.js: wz-radjust-solve).
  // It is collapsed on every render, so the render-time class needs only the
  // banner check — but opening it puts two primaries on screen.
  const f = fnBody(WIZARD_SRC, "function refreshResultsEmphasis() {", 4);
  assert.ok(/wz-adjust/.test(f) && /\.open/.test(f),
    "the emphasis check reads whether the fold is open");
  const fill = fnBody(WIZARD_SRC, "function fillAdjustSlot() {", 4);
  assert.ok(/ontoggle\s*=\s*refreshResultsEmphasis/.test(fill),
    "and opening or closing the fold re-applies it");
});

test("#431 U3 (R9): the rail hosts neither the save control nor its status line", () => {
  const rail = fnBody(WIZARD_SRC, "function railHTML() {", 4);
  assert.ok(!/wz-railsave/.test(rail), "the rail's save button is gone");
  assert.ok(!/wz-railstat/.test(rail), "and its status span with it");
  assert.ok(!/wz-railsave|wz-railstat/.test(WIZARD_SRC), "no orphaned references remain");
});

test("#428 U6 (R2): each required field is marked at the field", () => {
  const body = stepSource("stepCharacter");
  for (const key of ["name", "ml", "race", "armor"]) {
    assert.ok(new RegExp(`data-req="${key}"`).test(body), `${key} is addressable as a required field`);
  }
  assert.strictEqual((body.match(/wz-req-mark/g) || []).length, 4,
    "exactly the four required fields carry the marker");
});

test("#431 U2 (R1/R4): the legend's stated count matches the markers it describes", () => {
  const body = stepSource("stepCharacter");
  const marks = (body.match(/wz-req-mark/g) || []).length;
  // The Forged branch states no count ("armor is settled"), so only the other
  // one carries a number to drift.
  const stated = body.match(/all (\w+) are needed to continue/);
  assert.ok(stated, "the non-Forged legend still states a count");
  const words = { two: 2, three: 3, four: 4, five: 5 };
  assert.strictEqual(words[stated[1]], marks,
    `the legend says ${stated[1]} but ${marks} fields are marked`);
});

test("#431 U2 (KTD2/AE5): the name field lives in the required group and binds its value", () => {
  const body = stepSource("stepCharacter");
  assert.ok(/data-req="name"/.test(body), "the name field is addressable as required");
  assert.ok(/id="wz-buildname"/.test(body), "the name input renders in the character step");
  assert.ok(/value="\$\{esc\(state\.characterName[^}]*\)\}"/.test(body),
    "the input is BOUND — an unbound field blanks the name on every render() and "
    + "would block the player on their own gate");
  assert.ok(!/data-nodirty/.test(body.slice(body.indexOf('data-req="name"') - 400,
    body.indexOf('data-req="name"') + 400)),
    "the field is not opted out of dirty-tracking (KTD9)");
});

test("#431 U2 (R9/KTD10): the rail hosts no name input and railModel sheds its save-shaped fields", () => {
  const rail = fnBody(WIZARD_SRC, "function railHTML() {", 4);
  assert.ok(!/wz-buildname/.test(rail), "the rail no longer renders the name input");
  assert.ok(!/Name this build/.test(rail), "and not its label either");
  const m = railModel({ characterName: "Sook", loadedName: "Sook" }, [{ name: "Sook" }]);
  for (const gone of ["name", "canSave", "overwrites"]) {
    assert.ok(!(gone in m), `railModel no longer returns ${gone}`);
  }
  assert.deepStrictEqual(Object.keys(m).sort(), ["empty", "loaded", "loadedName", "saved"]);
});

test("#431 U2 (R12): renaming stays reachable from every later step without a rail control", () => {
  // R12 is a guarantee, not a new control: the step dots and the results bar's
  // Edit character already reach the character step. Neither may be removed
  // without this failing.
  assert.ok(/data-goto="\$\{id\}"/.test(WIZARD_SRC),
    "the step dots are still data-goto targets");
  assert.ok(/data-goto="character"/.test(stepSource("stepResults")),
    "the results bar still reaches the character step directly");
});

// ---------------------------------------------------------------------------
// #428 U7 (R22/R23/R24) — backup leaves the wizard without leaving the app.
// KD2's known cost was that the Share tab follows a solve, so a player holding
// saves but no current solve would have no path to their backups — and a fresh
// browser could not import one at all, which is the whole point of import. One
// shared renderer serves both hosts so the two can never drift.
// ---------------------------------------------------------------------------

test("#428 U7 (AE11): no wizard step template contains an export or import control", () => {
  for (const step of ["stepIntro", "stepCharacter", "stepPool", "stepPriorities", "stepResults"]) {
    const body = stepSource(step);
    assert.ok(!/wz-export|wz-import|Export all|Import a backup|Export &amp; Data Management/.test(body),
      `${step} must not carry a backup control (R23)`);
  }
});

test("#428 U7 (AE12): export-all and import render from one shared block", () => {
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  const at = src.indexOf("function dataBlockHTML(");
  assert.ok(at >= 0, "one renderer owns the Your data block");
  const body = src.slice(at, endAfter(src, "\n    function ", at));
  assert.ok(/Export all/.test(body) && /Import a backup/.test(body),
    "…and it carries both controls");
  // Both hosts render it — the Share panel (KTD6) and the on-demand panel that
  // makes it reachable before any solve.
  const share = src.slice(src.indexOf("function sharePanelHTML("));
  assert.ok(/dataBlockHTML\(/.test(share.slice(0, share.indexOf("\n    }"))),
    "the Share panel renders the block below the loadout export formats (KD2)");
  assert.ok(/function openDataPanel\(/.test(src),
    "…and it is reachable without a solve, which the Share tab alone cannot be");
});

test("#428 U7: the two hosts cannot collide on element ids", () => {
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  const at = src.indexOf("function dataBlockHTML(");
  const body = src.slice(at, endAfter(src, "\n    function ", at));
  // The Share panel lives inside the results view while the on-demand panel is an
  // overlay; both can be in the DOM at once, so every id the block mints is
  // namespaced by its host.
  assert.ok(/function dataBlockHTML\(ns\)/.test(src), "the renderer takes a namespace");
  for (const id of ["wz-export", "wz-import", "wz-import-label", "wz-data-stat"]) {
    assert.ok(new RegExp(`id="${id}-\\$\\{ns\\}"`).test(body),
      `${id} is namespaced by host`);
  }
  assert.ok(/function wireDataManagement\(ns\)/.test(src),
    "…and the wiring reads the same namespace rather than a second list of ids");
});

test("#428 U7 (KTD7): #357's plan no longer says a record is written only at the end of a solve", () => {
  const fs = require("fs"); const path = require("path");
  const plan = fs.readFileSync(path.join(__dirname, "..", "docs", "plans",
    "2026-08-09-005-feat-loadout-library-compare-manual-build-plan.md"), "utf-8");
  assert.ok(!/written only at the end of a solve/.test(plan),
    "the superseded sentence is gone");
  assert.ok(/may be written at any step/.test(plan),
    "…replaced by the save model #428 owns");
  assert.ok(/2026-08-21-001-feat-wizard-structure-and-save-progress-plan/.test(plan),
    "…and the plan that superseded it is named, so the edit is traceable");
});

// ---------------------------------------------------------------------------
// #429 review fixes. Seven findings from the multi-agent review of the #428
// branch; the two data-integrity ones share a root cause — removing the
// "solve first" refusal removed a data-loss guard nobody had labelled as one.
// ---------------------------------------------------------------------------

// ---- #1 (P0): an in-progress save must not destroy a stored loadout ---------

test("#429 review #1: overwrite wording says the saved loadout is kept", () => {
  const kept = overwriteConfirmText("Sook", true, false);
  assert.ok(/Sook/.test(kept), "names the build");
  assert.ok(/kept/i.test(kept),
    "an in-progress save over a solved record must say the loadout survives");
  const replaced = overwriteConfirmText("Sook", true, true);
  assert.ok(/replace/i.test(replaced),
    "a solved save DOES replace the stored loadout, and says so");
  const plain = overwriteConfirmText("Sook", false, false);
  assert.ok(!/kept|replace/i.test(plain),
    "with no stored loadout there is nothing to promise either way");
});

test("#429 review #1: overwriteConfirmText escapes nothing and needs no store", () => {
  // Pure: it is given the two facts, never asked to look them up, so the
  // confirm and the write cannot disagree about what is being overwritten.
  assert.strictEqual(typeof overwriteConfirmText("A", false, false), "string");
});

// ---- #2 (P1): a run belongs to the record it was solved or loaded for ------

test("#429 review #2: a freshly solved run belongs to whatever name you save under", () => {
  assert.strictEqual(runBelongsTo({ fresh: true }, "Anything", ""), true);
  assert.strictEqual(runBelongsTo({ fresh: true }, "Anything", "Other"), true);
});

test("#429 review #2 (AE): a LOADED run belongs only to the record it came from", () => {
  // Load A (results, lastRun = A's run), step back, rename to B, save.
  // Attributing A's run to B writes A's snapshot, query AND build stamp into B.
  const loadedRun = { fresh: false, stampedBuildId: "buildA" };
  assert.strictEqual(runBelongsTo(loadedRun, "A", "A"), true, "saving A back is still A's run");
  assert.strictEqual(runBelongsTo(loadedRun, "B", "A"), false,
    "saving under a different name must not inherit the loaded build's loadout");
});

test("#429 review #2: no run, or a run with no record behind it, belongs to nobody", () => {
  assert.strictEqual(runBelongsTo(null, "A", "A"), false);
  assert.strictEqual(runBelongsTo(undefined, "A", ""), false);
  assert.strictEqual(runBelongsTo({ fresh: false }, "A", ""), false,
    "a loaded run with no loadedName cannot be attributed to anything");
});

test("#429 review #1+#2: the save path attributes the run and preserves the record", () => {
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  const at = src.indexOf("function saveCurrentCharacter(");
  assert.ok(at >= 0, "wizard.js declares saveCurrentCharacter");
  const end = src.indexOf("\n    // Load a saved character", at);
  assert.ok(end > at, "the save function's end marker resolves");
  const body = src.slice(at, end);
  assert.ok(/runBelongsTo\(/.test(body),
    "the live lastRun is attributed before it is written into a record (#2)");
  assert.ok(/rec\.snapshot = prev\.snapshot/.test(body),
    "an in-progress save over a solved record carries that loadout forward (#1)");
  assert.ok(/rec\.query = prev\.query/.test(body), "…and the query it was solved with");
  assert.ok(/rec\.stampedBuildId = prev\.stampedBuildId/.test(body),
    "…and its build stamp, so the preserved loadout does not re-stamp itself current");
});

test("#429 review #2: loadCharacter clears lastRun on the branch that does not set it", () => {
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  const at = src.indexOf("function loadCharacter(");
  const end = src.indexOf("\n    // #428 U3 (R13/R14", at);
  assert.ok(end > at, "the load function's end marker resolves");
  const body = src.slice(at, end);
  assert.ok(/state\.lastRun = null/.test(body),
    "the non-results branch resets lastRun beside its sibling per-character fields");
  assert.ok(/state\.loadedStale = false/.test(body), "…and the staleness flag that rides with it");
});

// ---- #3 (P1): the rail's own Load goes through the guard --------------------

test("#429 review #3: the rail's Load is routed through the guard, not straight to loadCharacter", () => {
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  const at = src.indexOf("function wireRail(");
  assert.ok(at >= 0, "wizard.js declares wireRail");
  const end = src.indexOf("\n    function ", at + 1);
  assert.ok(end > at, "wireRail's end marker resolves");
  const body = src.slice(at, end);
  assert.ok(/requestLoad\(/.test(body),
    "Load routes through the one seam, so its policy lives in one place (#452 U3)");
  assert.ok(!/\bloadCharacter\(b\.dataset\.railload\)/.test(body),
    "…rather than reaching past it into loadCharacter directly");
  assert.ok(/state\.loadedName/.test(body),
    "deleting the build you are editing warns about the in-memory copy");
});

// ---- #4 (P1): KTD5 — the stale banner names armor as newly required --------

test("#429 review #4 (KTD5): a displayed build missing armor says so on the banner", () => {
  const run = { query: { overrides: [] } };
  const note = staleNote({ lastRun: run, overrideApplied: [], race: "Elf", ml: 34, armor: "" });
  assert.ok(note, "a pre-KD6 build that never passes the character step is still told");
  assert.ok(/[Aa]rmor/.test(note), "…and told which field");
});

test("#429 review #4: a build carrying armor raises no armor note", () => {
  const run = { query: { overrides: [] } };
  assert.strictEqual(
    staleNote({ lastRun: run, overrideApplied: [], race: "Elf", ml: 34, armor: "heavy" }), null);
});

test("#429 review #4: the Forged exemption reaches the banner too", () => {
  const run = { query: { overrides: [] } };
  assert.strictEqual(
    staleNote({ lastRun: run, overrideApplied: [], race: "Warforged", ml: 34, armor: "" }), null,
    "a docent-wearing race is not asked for an armor type it cannot pick");
});

test("#429 review #4: both causes report together rather than one hiding the other", () => {
  const run = { query: { overrides: [] } };
  const note = staleNote({ lastRun: run, overrideApplied: [], loadedStale: true,
                           race: "Elf", ml: 34, armor: "" });
  assert.ok(/predates the current gear catalog/.test(note), "the catalog cause survives");
  assert.ok(/[Aa]rmor/.test(note), "…and the armor cause is not swallowed by it");
});

// ---- #5 (P2): the scoping guard whose marker stopped resolving --------------

// A comment can quote a marker it does not use; only code hands strings to
// indexOf, so the meta-guards below read this file with its full-line comments
// stripped. Without this they flag their own explanatory prose.
function testFileCode() {
  const fs = require("fs"); const path = require("path");
  return fs.readFileSync(path.join(__dirname, "wizard.test.js"), "utf-8")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

test("#429 review #5: every source-slice guard's end marker actually resolves", () => {
  // The #91 wiring guard sliced to `function renderSavedPicker`, which #428
  // renamed — indexOf returned -1 and slice(at, -1) covered the rest of the
  // file, so four assertions could match anywhere below loadCharacter and the
  // test stayed green. This asserts the markers themselves: EVERY string this
  // file hands to indexOf must still resolve in some web/ source, whichever
  // source and whatever shape the marker takes, not just the one spelling
  // against WIZARD_SRC that the original guard knew how to look for.
  const fs = require("fs"); const path = require("path");
  const web = path.join(__dirname, "..", "web");
  const haystack = fs.readdirSync(web)
    .filter((f) => /\.(js|css|html)$/.test(f))
    .map((f) => fs.readFileSync(path.join(web, f), "utf-8"))
    .join("\n \n");
  const code = testFileCode();
  const unescape = (s) => s.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  const markers = [
    // markers handed straight to indexOf…
    ...[...code.matchAll(/\.indexOf\("((?:[^"\\]|\\.)*)"/g)].map((m) => unescape(m[1])),
    // …and markers handed to the construct-bounding helpers, which is where the
    // renameable ones increasingly live.
    ...[...code.matchAll(/(?:fnBody|endAfter)\(\s*[\w$.]+\s*,\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => unescape(m[1])),
  ]
    // Punctuation-only anchors ("});", "}") are structural and always present;
    // the renameable markers are the ones carrying a name.
    .filter((s) => s.length >= 6 && /[A-Za-z]/.test(s));
  assert.ok(markers.length > 40, `the guard finds the slice markers it is checking (${markers.length})`);
  for (const m of new Set(markers)) {
    assert.ok(haystack.includes(m),
      `slice marker ${JSON.stringify(m)} must still exist in a web/ source — a marker `
      + "that no longer resolves makes indexOf return -1 and the slice silently widen");
  }
});

test("#430: no source-slice guard bounds a construct by a fixed character offset", () => {
  // The companion failure to a stale marker, and the quieter one. A guard that
  // reads a whole function through a fixed-width window keeps passing while the
  // function grows underneath it, until one added line pushes the last assertion
  // out of the window and the guard stops checking what it names — silently,
  // because the shortened slice still matches whatever assertions remain inside
  // it. #110's loadCharacter guard sat 86 characters from that edge. Bound a
  // construct by the construct's own end (see fnBody / migrationBlock / endAfter).
  // Fixed-width windows anchored on a STATEMENT are proximity assertions ("this
  // is set near that") and stay legitimate — this rule is about constructs.
  const code = testFileCode();
  const blocks = code.split(/\n(?=[ \t]*test\()/);
  const offenders = [];
  for (const block of blocks) {
    const name = (block.match(/test\("([^"]*)"/) || [])[1] || "(file scope)";
    // slice(v, v + N), where v was anchored on a function declaration.
    for (const m of block.matchAll(/\.slice\(\s*(\w+)\s*,\s*(\w+)\s*\+\s*(\d+|[A-Z][A-Z_0-9]{3,})\s*\)/g)) {
      if (m[1] !== m[2]) continue;
      const decl = new RegExp(`(?:const|let)\\s+${m[1]}\\s*=\\s*[\\w$.]*\\.indexOf\\(\\s*["\`]function `);
      if (decl.test(block)) offenders.push(`${name}: slice(${m[1]}, ${m[1]} + ${m[3]})`);
    }
    // The same shape written inline, with no intermediate variable.
    for (const m of block.matchAll(/\.slice\(\s*[\w$.]*\.indexOf\(\s*["`](function [^"`]+)["`]\s*\)\s*,[^;]{0,90}?\+\s*\d+\s*\)/g)) {
      offenders.push(`${name}: inline fixed window on ${m[1]}`);
    }
  }
  assert.deepStrictEqual(offenders, [],
    "these guards read a construct through a fixed-width window; bound them by the "
    + "construct's own end instead:\n  " + offenders.join("\n  "));
});

// ---- #6 (P2): a pure lookup is not an edit ---------------------------------

test("#429 review #6: the search boxes opt out of the dirty listener at declaration", () => {
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  for (const id of ["wz-pin-search", "wz-block-search", "wz-add", "wz-radd"]) {
    const at = src.indexOf(`id="${id}"`);
    assert.ok(at >= 0, `${id} exists`);
    const tag = src.slice(src.lastIndexOf("<", at), src.indexOf(">", at));
    assert.ok(/data-nodirty/.test(tag),
      `${id} is a lookup, not an edit — it must not arm the unsaved-changes guard`);
  }
  assert.ok(/closest\("\[data-nodirty\], \.wz-share"\)/.test(src),
    "…and the listener honours the opt-out beside the Share-panel exclusion");
});

// ---- #7 (P2): a fallback that explains itself ------------------------------

test("#429 review #7: the load explanation fires when the target differs from the saved step", () => {
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf-8");
  assert.ok(/savedStep\(i\) !== _target/.test(src),
    "a record saved on results with no optimal snapshot is bounced to priorities WITH a reason");
  assert.ok(!/if \(!savedStep\(i\)\)/.test(src),
    "the absent-step-only condition is gone — it suppressed the very message it gated");
});

// ---------------------------------------------------------------------------
// #335 U5 (R8) — pinning is unaffected, and the documented limitation holds: a
// player cannot pin the same ring to BOTH Ring slots, because applyPinId ignores
// a duplicate id for a multi-cardinality slot. A doubled pick is therefore
// solver-discretionary — the player can see one but cannot request one. That is
// recorded in the plan's Scope Boundaries rather than left to be discovered.
// ---------------------------------------------------------------------------

test("#335 U5 (R8): a duplicate ring pin is still ignored, so x2 cannot be pinned", () => {
  const M = require("../web/model.js");
  const id = [...(M.DUPLICABLE_RINGS)][0];
  const cardOf = (slot) => (slot === "Ring" ? 2 : 1);   // the real Ring cardinality
  const cons = {};
  applyPinId(cons, "Ring", id, cardOf);
  applyPinId(cons, "Ring", id, cardOf);        // the same ring a second time
  const ids = [].concat((cons.Ring && cons.Ring.variant_ids) || []).filter(Boolean);
  assert.strictEqual(ids.length, 1,
    "the repeat selection is discarded — pinning a doubled pick is deferred, not supported");
  assert.strictEqual(ids[0], id, "and the single pin is the ring the player picked");
});

// ---------------------------------------------------------------------------
// #452 — autosave on Continue. The unsaved-changes guard is gone; the forward
// path saves. `nameCollides` is the gate that makes that viable and is pure, so
// it is tested directly rather than through a dialog. Everything else here is a
// source-text assertion in this file's established idiom (no DOM).
// ---------------------------------------------------------------------------

test("#452 U2 (R5/KTD1): a name matching a DIFFERENT saved build collides", () => {
  const prev = { name: "Barbarian", snapshot: { status: "optimal" } };
  assert.strictEqual(nameCollides({ loadedName: "Sorc", nameReconciled: null }, "Barbarian", prev), true);
});

test("#452 U2 (KTD1/R-a): re-saving the build you are editing NEVER collides", () => {
  const prev = { name: "Barbarian", snapshot: { status: "optimal" } };
  const st = { loadedName: "Barbarian", nameReconciled: null };
  // The whole plan turns on this. `prev` is truthy for the loaded build, so a
  // gate keyed on `prev` alone would fire a native confirm on EVERY Continue of
  // a build saved even once — worse than the dialog #452 removes.
  for (let i = 0; i < 5; i++) {
    assert.strictEqual(nameCollides(st, "Barbarian", prev), false,
      "however many times the forward path saves, it is not an overwrite");
  }
});

test("#452 U2 (R6): a reconciled name does not collide again", () => {
  const prev = { name: "Barbarian", snapshot: null };
  const st = { loadedName: "Sorc", nameReconciled: "Barbarian" };
  assert.strictEqual(nameCollides(st, "Barbarian", prev), false);
  // …but only that name. Reconciling one build must not silently license
  // overwriting a different record.
  assert.strictEqual(nameCollides(st, "Ranger", { name: "Ranger" }), true);
});

test("#452 U2: a name matching no record never collides", () => {
  assert.strictEqual(nameCollides({ loadedName: "Sorc" }, "Brand New", null), false);
  assert.strictEqual(nameCollides({ loadedName: "Sorc" }, "", { name: "" }), false,
    "an empty name has nothing to overwrite");
  assert.strictEqual(nameCollides(null, "Barbarian", { name: "Barbarian" }), true,
    "a missing state is not a licence to skip the confirm");
});

test("#452 U2: the collision gate is what trySave consults, not `prev` alone", () => {
  const body = fnBody(WIZARD_SRC, "function trySave(nm) {", 4);
  assert.ok(/nameCollides\(state, nm, prev\)/.test(body),
    "trySave gates on the narrowed predicate");
  assert.ok(!/if \(prev\) \{/.test(body),
    "…and not on `prev` alone, which is true for the build being edited (KTD1)");
  assert.ok(/state\.nameReconciled = nm/.test(body),
    "an accepted overwrite is remembered so the next Continue is silent (R6)");
  assert.ok(/if \(res\.ok\) state\.loadedName = nm/.test(body),
    "a successful save adopts the name — without it the next Continue re-collides (R-d)");
});

test("#452 U2 (R7): loading a build clears the reconciliation", () => {
  const load = fnBody(WIZARD_SRC, "function loadCharacter(name) {", 4);
  assert.ok(/state\.nameReconciled = null/.test(load),
    "a freshly loaded build has reconciled nothing");
});

test("#452 U1 (R1): navigation saves before it moves, in both directions", () => {
  const nav = fnBody(WIZARD_SRC, "function navigate(step) {", 4);
  assert.ok(/autosaveThen\(step\)/.test(nav), "the one navigation seam autosaves");
  assert.ok(!/guardOr/.test(nav), "…rather than raising a guard");
  const body = fnBody(WIZARD_SRC, "function autosaveThen(step) {", 4);
  assert.ok(/trySave\(nm\)/.test(body),
    "it reuses the one save transaction, so an autosaved record is not a second shape (R3)");
  assert.ok(/go\(step\)/.test(body), "…and then moves");
});

test("#452 U1: a declined overwrite is the only path that does not advance", () => {
  const body = fnBody(WIZARD_SRC, "function autosaveThen(step) {", 4);
  assert.ok(/res === null/.test(body),
    "a declined overwrite is distinguished from a failed save");
  const declined = body.slice(body.indexOf("res === null"));
  assert.ok(/return/.test(declined.slice(0, 40)), "…and returns without advancing");
});

test("#452 U4 (R11/R12): a failed save reports and still advances", () => {
  const body = fnBody(WIZARD_SRC, "function autosaveThen(step) {", 4);
  const bad = body.slice(body.indexOf("if (!res.ok)"));
  assert.ok(body.indexOf("go(step)") < body.indexOf("if (!res.ok)"),
    "the step change happens before the report, so a failed save never blocks (R12)");
  assert.ok(/wz-savestat/.test(bad), "the outcome lands in the polite status span");
  assert.ok(/saveErrorText\(res\.error\)/.test(bad), "…using the existing strings, not new ones");
  assert.ok(!/confirm\(|wz-modal|showUnsavedGuard/.test(bad),
    "no path through the failure branch constructs a dialog (R12)");
});

test("#452 U3 (R10): no path can render the unsaved-changes guard", () => {
  assert.ok(!/wz-unsaved/.test(WIZARD_SRC),
    "the guard's element, handlers and every id are gone — deleted, not disabled");
  assert.ok(!/unsavedPrompt/.test(WIZARD_SRC), "…and so is the state it stashed");
  assert.ok(!/function guardOr\(|function resumePending\(/.test(WIZARD_SRC),
    "…and the gate that raised it");
  assert.strictEqual(typeof nameCollides, "function", "the collision gate replaces it");
});

test("#452 U3 (R9): loading a saved build goes straight there", () => {
  const body = fnBody(WIZARD_SRC, "function requestLoad(name) {", 4);
  assert.ok(/loadCharacter\(name\)/.test(body), "no guard stands between Load and the load");
});

test("#452 U5 (R13): the rail says builds save automatically, and stay local", () => {
  const rail = WIZARD_SRC.slice(WIZARD_SRC.indexOf("function railHTML("));
  const copy = rail.slice(0, rail.indexOf("\n    function "));
  assert.ok(/[Ss]aves automatically/.test(copy),
    "the storage sentence states that saving is not something the player opts into");
  assert.ok(/this browser only/.test(copy) && /no account/.test(copy),
    "…without weakening the privacy promise it already carried");
});

test("#452: overwriteConfirmText is unchanged — regression guard", () => {
  // Deliberately NOT proven red: this pins behaviour #452 must not disturb. Its
  // three branches are what R5's "states which of the two records carries a
  // solved loadout" is satisfied by, and rewording them would drift from the
  // Save progress path that shares them.
  assert.strictEqual(overwriteConfirmText("Sook", false, false), "Update saved build “Sook”?");
  assert.ok(/Its saved loadout is replaced/.test(overwriteConfirmText("Sook", true, true)));
  assert.ok(/Its saved loadout is kept/.test(overwriteConfirmText("Sook", true, false)));
});

test("#453 U6 (R15/R16/KTD5): the notice jump OPENS the panel it scrolls to", () => {
  const body = fnBody(WIZARD_SRC, "function jumpFromNotice(target) {", 4);
  assert.ok(/scrollIntoView/.test(body), "it still scrolls the anchor into view");
  assert.ok(/\.open = true/.test(body),
    "…and opens the fold, which is what it never did — a control that moves the "
    + "viewport and changes nothing else is indistinguishable from one that failed");
  assert.ok(/querySelector\("input, select, button/.test(body),
    "focus lands on the panel's first control, not the wrapper div it used to target");
  assert.ok(/if \(!el\) return;/.test(body),
    "a missing anchor still no-ops rather than throwing (R17, unchanged)");
});

test("#453 U6 (KTD5): `open` is set as a property so ontoggle fires", () => {
  const body = fnBody(WIZARD_SRC, "function jumpFromNotice(target) {", 4);
  // The positive assertion first: without it this test is only a ban on a
  // spelling, which the pre-change tree satisfies by never opening the fold at
  // all — passing while the defect it describes is fully present.
  assert.ok(/fold\.open = true/.test(body), "the fold is opened by property assignment");
  assert.ok(!/setAttribute\("open"/.test(body),
    "the attribute form would skip ontoggle, leaving Save wrongly primary while a "
    + "second primary (Re-solve) is on screen (#431 U3 KTD7/R6)");
});

test("#453 U4 (R9): the chip overflow expands in place, by delegation", () => {
  assert.ok(/data-statmore/.test(WIZARD_SRC), "the expander is wired");
  const at = WIZARD_SRC.indexOf('e.target.closest("[data-statmore]")');
  assert.ok(at > 0, "…through the results box's click delegation");
  const near = WIZARD_SRC.slice(at, at + 400);
  assert.ok(/classList\.toggle\("is-expanded"\)/.test(near), "it toggles the row open");
  assert.ok(/aria-expanded/.test(near), "…and says so to assistive tech");
});
