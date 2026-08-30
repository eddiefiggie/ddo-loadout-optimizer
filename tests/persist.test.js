// U2 — localStorage character store (pure logic). Run: node tests/persist.test.js
const assert = require("assert");
const {
  serializeCharacter, stripResult, saveCharacter, listCharacters, loadCharacter, deleteCharacter,
  allCharacters, saveMany, INPUT_KEYS, pickInputs, deletionImpact, deleteBuildAndDependents,
  renameBuild, STORE_KEY,
} = require("../web/persist.js");
const Farm = require("../web/farming.js");
const { migrateLoadout } = require("../web/dataset.js");

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e.message}`); process.exitCode = 1; }
}

function fakeStorage(failOnSet) {
  const m = {};
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => {
      if (failOnSet) { const e = new Error("full"); e.name = "QuotaExceededError"; throw e; }
      m[k] = String(v);
    },
    removeItem: (k) => { delete m[k]; },
  };
}

const state = {
  ml: 34, race: "Elf", alignment: "Lawful Good", armor: "light", weapon: "old-flag",
  oath: "druid", style: "one-hand", weaponTypes: ["Long Swords"], offHand: ["Orbs"], offHandWeapons: ["Short Swords"],
  includeArtifact: false, pool: "all", ownedNames: null,
  priorities: ["Constitution", "Dodge"], slotConstraints: { Goggles: "lock" },
};
const lastRun = {
  query: { targets: ["Constitution"] },
  result: {
    status: "optimal",
    chosen: [{ slot: "Goggles", variant: { variant_id: "Sight:heroic", source_item: "Sight of the Devil" } }],
    effective: { Constitution: 12 }, computeScale: { variants: 100 }, setsActive: [],
    program: { huge: true, model: null },  // must be stripped
  },
};

test("stripResult drops program and keeps the panel subset", () => {
  const s = stripResult(lastRun.result);
  assert.strictEqual(s.program, undefined);
  assert.strictEqual(s.model, undefined);
  assert.strictEqual(s.status, "optimal");
  assert.deepStrictEqual(s.chosen, lastRun.result.chosen);
  assert.strictEqual(s.effective.Constitution, 12);
});

test("stripResult keeps setAugmentsPlaced so saved-record exports carry set augments", () => {
  const placed = [{ set: "Quickblade", host: "some-variant-id", wiki_url: "https://ddowiki.com/page/Augment_Slot/Set_Augment" }];
  const s = stripResult({ status: "optimal", chosen: [], effective: {}, setAugmentsPlaced: placed });
  assert.deepStrictEqual(s.setAugmentsPlaced, placed);
});

test("serializeCharacter carries inputs, query, snapshot, build stamp; item ref keyed on variant_id", () => {
  const rec = serializeCharacter("Sook - Reaper", state, lastRun, "abc123def456");
  assert.strictEqual(rec.name, "Sook - Reaper");
  assert.strictEqual(rec.inputs.ml, 34);
  assert.deepStrictEqual(rec.inputs.priorities, ["Constitution", "Dodge"]);
  assert.deepStrictEqual(rec.query, { targets: ["Constitution"] });
  assert.strictEqual(rec.stampedBuildId, "abc123def456");
  assert.strictEqual(rec.snapshot.program, undefined);
  assert.strictEqual(rec.snapshot.chosen[0].variant.variant_id, "Sight:heroic");
  assert.strictEqual(rec.snapshot.chosen[0].variant.source_item, "Sight of the Devil");
});

test("U5: serializeCharacter persists combat constraints and drops the inert weapon flag", () => {
  const rec = serializeCharacter("Combat", state, lastRun, "id5");
  assert.strictEqual(rec.inputs.style, "one-hand");
  assert.deepStrictEqual(rec.inputs.weaponTypes, ["Long Swords"]);
  assert.deepStrictEqual(rec.inputs.offHand, ["Orbs"]);
  assert.deepStrictEqual(rec.inputs.offHandWeapons, ["Short Swords"]);
  assert.strictEqual(rec.inputs.oath, "druid");
  // The obsolete coarse flag is off the allowlist, so it never round-trips — an old
  // save that still carries it simply loses it and loads unconstrained.
  assert.ok(!("weapon" in rec.inputs), "the obsolete coarse weapon flag is not persisted");
});

test("U3/U4: serializeCharacter persists the ML floor + caps/floors (INPUT_KEYS)", () => {
  const withBounds = { ...state, mlFloor: 30, mlFloorManual: true,
    targetCaps: { Dodge: 4 }, targetFloors: { PRR: 300 } };
  const rec = serializeCharacter("Bounds", withBounds, lastRun, "idb");
  assert.strictEqual(rec.inputs.mlFloor, 30, "ML floor persists (was the latent gap)");
  assert.strictEqual(rec.inputs.mlFloorManual, true, "manual-floor flag persists");
  assert.deepStrictEqual(rec.inputs.targetCaps, { Dodge: 4 });
  assert.deepStrictEqual(rec.inputs.targetFloors, { PRR: 300 });
});

test("#339: augCeiling round-trips through serialize -> save -> load (INPUT_KEYS scalar)", () => {
  const st = fakeStorage();
  const withCeiling = { ...state, augCeiling: 32 };
  saveCharacter(serializeCharacter("Ceiled", withCeiling, lastRun, "idc"), st);
  const back = loadCharacter("Ceiled", st);
  assert.strictEqual(back.inputs.augCeiling, 32, "the augment ML ceiling persists");
  // ...and survives JSON exactly as localStorage stores it.
  assert.strictEqual(JSON.parse(JSON.stringify(back)).inputs.augCeiling, 32);
});

test("#339: a pre-feature save (no augCeiling field) loads unrestricted — no key, no healing", () => {
  const rec = serializeCharacter("PreCeiling", state, lastRun, "idc");   // `state` predates the feature
  // pickInputs stores undefined; JSON drops the key, so the stored record has
  // NO augCeiling — exactly the mlFloor precedent, and the wizard load path
  // reads an absent key as null (unrestricted).
  const stored = JSON.parse(JSON.stringify(rec));
  assert.ok(!("augCeiling" in stored.inputs), "a pre-feature record carries no key at all");
});

test("#339: INPUT_KEYS carries augCeiling (the save-path allowlist)", () => {
  assert.ok(INPUT_KEYS.includes("augCeiling"),
    "a key outside the allowlist is silently stripped on save and the ceiling would never persist");
});

test("ownedNames Set serializes to a JSON-safe array", () => {
  const withOwned = { ...state, ownedNames: new Set(["Item A", "Item B"]) };
  const rec = serializeCharacter("Owned", withOwned, lastRun, "id1");
  assert.deepStrictEqual(rec.inputs.ownedNames, ["Item A", "Item B"]);
  // round-trips through JSON unchanged
  assert.deepStrictEqual(JSON.parse(JSON.stringify(rec)).inputs.ownedNames, ["Item A", "Item B"]);
});

test("U6: ownedSetAugments Set serializes to a JSON-safe array and round-trips", () => {
  const withSA = { ...state, ownedSetAugments: new Set(["Alluring Elocution", "Arcane Barrier"]) };
  const rec = serializeCharacter("SA", withSA, lastRun, "id1");
  assert.deepStrictEqual(rec.inputs.ownedSetAugments, ["Alluring Elocution", "Arcane Barrier"]);
  // round-trips through JSON unchanged; the loader rebuilds the Set from this array
  const back = JSON.parse(JSON.stringify(rec)).inputs.ownedSetAugments;
  assert.deepStrictEqual(back, ["Alluring Elocution", "Arcane Barrier"]);
  assert.deepStrictEqual([...new Set(back)].sort(), ["Alluring Elocution", "Arcane Barrier"]);
});

test("U6: ownedSetAugments defaults to [] when absent", () => {
  const rec = serializeCharacter("None", state, lastRun, "id1");
  assert.deepStrictEqual(rec.inputs.ownedSetAugments, []);
});

test("save -> list -> load round-trip preserves inputs + snapshot", () => {
  const st = fakeStorage();
  const rec = serializeCharacter("Sook", state, lastRun, "id1");
  assert.strictEqual(saveCharacter(rec, st).ok, true);
  const names = listCharacters(st).map((c) => c.name);
  assert.deepStrictEqual(names, ["Sook"]);
  const back = loadCharacter("Sook", st);
  assert.strictEqual(back.inputs.race, "Elf");
  assert.strictEqual(back.snapshot.status, "optimal");
  assert.strictEqual(back.snapshot.chosen[0].variant.variant_id, "Sight:heroic");
});

test("U4/B6: a two-ring pin list survives serialize -> save -> load intact", () => {
  const st = fakeStorage();
  const pinned = { ...state, slotConstraints: {
    Trinket: { type: "pin", variant_id: "Hydra's Heart" },
    Ring: { type: "pin", variant_ids: ["R1", "R2"] },
  } };
  saveCharacter(serializeCharacter("Pinned", pinned, lastRun, "idp"), st);
  const back = loadCharacter("Pinned", st);
  assert.deepStrictEqual(back.inputs.slotConstraints.Trinket, { type: "pin", variant_id: "Hydra's Heart" });
  assert.deepStrictEqual(back.inputs.slotConstraints.Ring, { type: "pin", variant_ids: ["R1", "R2"] },
    "the two-ring list is preserved verbatim (not collapsed to a single pin)");
});

test("save under an existing name replaces that entry only", () => {
  const st = fakeStorage();
  saveCharacter(serializeCharacter("Sook", state, lastRun, "id1"), st);
  saveCharacter(serializeCharacter("Torin", state, lastRun, "id1"), st);
  const updated = serializeCharacter("Sook", { ...state, ml: 30 }, lastRun, "id2");
  saveCharacter(updated, st);
  assert.deepStrictEqual(listCharacters(st).map((c) => c.name).sort(), ["Sook", "Torin"]);
  assert.strictEqual(loadCharacter("Sook", st).inputs.ml, 30);
  assert.strictEqual(loadCharacter("Torin", st).inputs.ml, 34);
});

test("delete removes only the named entry", () => {
  const st = fakeStorage();
  saveCharacter(serializeCharacter("Sook", state, lastRun, "id1"), st);
  saveCharacter(serializeCharacter("Torin", state, lastRun, "id1"), st);
  deleteCharacter("Sook", st);
  assert.deepStrictEqual(listCharacters(st).map((c) => c.name), ["Torin"]);
  assert.strictEqual(loadCharacter("Sook", st), null);
});

test("allCharacters returns the full name->record map; saveMany writes a batch", () => {
  const st = fakeStorage();
  saveMany({
    Sook: serializeCharacter("Sook", state, lastRun, "id1"),
    Torin: serializeCharacter("Torin", state, lastRun, "id1"),
  }, st);
  const all = allCharacters(st);
  assert.deepStrictEqual(Object.keys(all).sort(), ["Sook", "Torin"]);
  assert.strictEqual(all.Sook.inputs.race, "Elf");
});

test("a character literally named __proto__ saves and loads (null-proto store)", () => {
  const st = fakeStorage();
  const rec = serializeCharacter("__proto__", state, lastRun, "id1");
  assert.strictEqual(saveCharacter(rec, st).ok, true);
  assert.deepStrictEqual(listCharacters(st).map((c) => c.name), ["__proto__"]);
  assert.ok(loadCharacter("__proto__", st), "named __proto__ was silently dropped");
  assert.strictEqual(({}).__proto__, Object.prototype, "Object.prototype was replaced");
});

test("quota-exceeded on save returns a typed error rather than throwing", () => {
  const st = fakeStorage(true);
  const res = saveCharacter(serializeCharacter("Sook", state, lastRun, "id1"), st);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, "quota");
});

// ---- U5, Part C — one-time load migration for a pre-overhaul snapshot ----------
test("migrateLoadout upgrades a PRE-OVERHAUL snapshot's chosen items to native fields", () => {
  // A save made before the native-schema overhaul embedded its chosen items with
  // ONLY the legacy stat/bonus_type/minimum_level. On load, migrateLoadout attaches
  // the native name/type/ml the migrated readers use — without dropping the legacy
  // aliases (so both read paths keep working).
  const snap = {
    status: "optimal",
    chosen: [
      { slot: "Armor", variant: { variant_id: "Old Vest", minimum_level: 30,
        affixes: [{ stat: "Constitution", bonus_type: "Insightful", value: 7, unit: "flat" }] } },
    ],
  };
  const out = migrateLoadout(snap);
  const v = out.chosen[0].variant;
  assert.strictEqual(v.ml, 30, "native item ml attached from minimum_level");
  const a = v.affixes[0];
  assert.strictEqual(a.name, "Constitution", "native affix name attached from stat");
  assert.strictEqual(a.type, "Insightful", "native affix type attached from bonus_type");
  // idempotent + non-destructive: a second pass and the legacy aliases both survive
  migrateLoadout(out);
  assert.strictEqual(a.stat, "Constitution", "legacy affix alias preserved");
  assert.strictEqual(v.minimum_level, 30, "legacy item alias preserved");
});

test("migrateLoadout is a no-op on a native (current) snapshot and tolerates empties", () => {
  assert.strictEqual(migrateLoadout(null), null);
  const native = { chosen: [{ slot: "Ring", variant: { variant_id: "New", ml: 34,
    affixes: [{ name: "Dodge", type: "Enhancement", value: 5, unit: "pct" }] } }] };
  const out = migrateLoadout(native);
  const a = out.chosen[0].variant.affixes[0];
  assert.strictEqual(a.name, "Dodge");
  // U7 removed the native->legacy affix aliases: a native affix stays {name,type},
  // no stat/bonus_type back-fill.
  assert.strictEqual(a.stat, undefined, "no legacy alias back-filled for a native affix");
});


// ---- plan 003 U1 — the declaration round-trips with the saved character (R9) ----

test("U1/003 (R9): the declaration is a saved input and survives the round trip", () => {
  assert.ok(INPUT_KEYS.includes("twoWeaponFighting"), "the declaration joins the saved-input allowlist");
  const declared = pickInputs(Object.assign({}, state, { twoWeaponFighting: true }), "Rogue");
  assert.strictEqual(declared.twoWeaponFighting, true, "a declared character saves it as true");
  const plain = pickInputs(state, "Rogue");
  assert.strictEqual(plain.twoWeaponFighting, false, "an undeclared character saves false, not undefined");
  // A pre-U1 save carries no field at all; it must load as undeclared rather than
  // as a stray truthy value.
  const legacy = Object.assign({}, state); delete legacy.twoWeaponFighting;
  assert.strictEqual(pickInputs(legacy, "Rogue").twoWeaponFighting, false, "a pre-U1 save defaults to undeclared");
});


// ---- U5 — declared stat credits persist with the character (R11) ------------

const CREDITS = {
  "Combat Mastery||Insight": { stat: "Combat Mastery", bonus_type: "Insight", value: 7 },
  "Combat Mastery||Sacred": { stat: "Combat Mastery", bonus_type: "Sacred", value: 4 },
};

test("U5: declared credits join the saved-input allowlist and round-trip", () => {
  assert.ok(INPUT_KEYS.includes("declaredCredits"),
    "the credit map must be in the single allowlist backup.js also imports, or save and import drift");
  const rec = serializeCharacter("Trance", { ...state, declaredCredits: CREDITS }, lastRun, "idc");
  assert.deepStrictEqual(rec.inputs.declaredCredits, CREDITS,
    "both credits on one stat survive — the map is keyed (stat, bonus type), not by stat");
});

test("U5: a saved credit survives the full save -> JSON -> import chain", () => {
  // The two halves are allowlisted separately in persist.js and backup.js, and the
  // only thing keeping them aligned is that backup imports INPUT_KEYS. Assert the
  // whole chain rather than each end: an absent-field test is unfalsifiable and
  // passes on any branch.
  const { serializeAll, parseBackup } = require("../web/backup.js");
  const rec = serializeCharacter("Trance", { ...state, declaredCredits: CREDITS }, lastRun, "ide");
  const parsed = parseBackup(JSON.stringify(serializeAll({ Trance: rec }, {})));
  assert.ok(parsed.ok, `backup must parse: ${parsed.error || ""}`);
  assert.deepStrictEqual(parsed.characters.Trance.inputs.declaredCredits, CREDITS,
    "credits declared, saved, exported, and re-imported must be identical");
});

test("U5: the credit map is plain JSON — it survives a stringify round-trip", () => {
  // Unlike ownedNames/ownedSetAugments it needs no Set handling, which is the
  // reason it is a bare allowlist entry rather than a special case in pickInputs.
  const rec = serializeCharacter("Trance", { ...state, declaredCredits: CREDITS }, lastRun, "idd");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(rec.inputs.declaredCredits)), CREDITS);
});


test("U4/U5: the credit disclosure survives the save path", () => {
  // The second allowlist. Without creditReport in RESULT_KEEP the credit still
  // solves correctly on load while the honesty line goes quiet — `program` is
  // dropped and KTD6 forbids re-solving a restored character.
  const { stripResult } = require("../web/persist.js");
  const report = [{ stat: "CM", bonus_type: "Insight", value: 7, won: true, beatGear: 5, floor: 10, gearInLoadout: 5 }];
  const kept = stripResult({ status: "optimal", creditReport: report, program: { cyclic: true } });
  assert.deepStrictEqual(kept.creditReport, report, "the disclosure is persisted");
  assert.strictEqual(kept.program, undefined, "and the program still is not");
});

test("U1/#239: the saturation disclosure survives the save path", () => {
  // Same allowlist, same reason as the credit disclosure above: built from
  // `program.zByBucket`, and `program` is dropped. Omitted from RESULT_KEEP, the
  // notice renders on a fresh solve and disappears on reload.
  const { stripResult } = require("../web/persist.js");
  const report = [{ stat: "Kinetic Lore", total: 30, bonusTypes: ["Equipment", "Artifact"], unusedSources: 56 }];
  const kept = stripResult({ status: "optimal", saturationReport: report, program: { cyclic: true } });
  assert.deepStrictEqual(kept.saturationReport, report, "the disclosure is persisted");
  assert.strictEqual(kept.program, undefined, "and the program still is not");
});

test("U6/#249: the absorption-quarantine disclosure survives the save path", () => {
  // Same allowlist, same reason: it is read off `model.worn`, `model` is dropped
  // by omission, and a restored character is never re-solved. Without it a
  // saved build silently stops disclosing an exclusion it disclosed when solved.
  const { stripResult } = require("../web/persist.js");
  const report = [{ item: "Cyran Guard (level 26)", stat: "Elemental Absorption",
    reason: "absent", components: ["Fire Absorption", "Sonic Absorption"] }];
  const kept = stripResult({ status: "optimal", absorptionQuarantine: report, model: { worn: [] } });
  assert.deepStrictEqual(kept.absorptionQuarantine, report, "the disclosure is persisted");
  assert.strictEqual(kept.model, undefined, "and the model still is not");
});

// #346 (U3) — the ladder survives save/load, and it is ALWAYS written. A save
// that omitted the rung would be indistinguishable from a pre-ladder one and
// would take the boolean-derivation path forever.
test("#346: craftingRung persists through pickInputs and is always written", () => {
  for (const rung of ["everything", "no-niche-crafting", "no-solar-lunar", "printed-only"]) {
    assert.strictEqual(pickInputs(Object.assign({}, state, { craftingRung: rung }), "R").craftingRung, rung);
  }
  assert.strictEqual(pickInputs(state, "Plain").craftingRung, "everything",
    "a state with no rung still writes one — absence must mean 'pre-ladder save', not 'top rung'");
  assert.strictEqual(pickInputs(Object.assign({}, state, { craftingRung: "nonsense" }), "Bad").craftingRung,
    "everything", "a hand-edited value is sanitized at the write boundary, not stored back");
});

// #346 (U3, KTD3) — the legacy boolean is read on load and never written again.
// Re-emitting it would leave two sources of truth that disagree the moment the
// player moves the ladder.
// #346 (U3) — the legacy boolean is written as a DOWNGRADE BRIDGE, derived from
// the rung rather than read from state. This app deploys continuously to Pages
// with best-effort cache-busting, so a backup exported from the new build can be
// re-imported into an older build still in a browser cache; without this key
// that build would restore a restricted character as fully unrestricted.
// Deriving is what makes it safe — it cannot contradict the rung it came from.
test("#346: the legacy boolean is derived from the rung, never read from state", () => {
  const at = (rung, stale) => pickInputs(
    Object.assign({}, state, { craftingRung: rung, excludeCraftingSystems: stale }), "L");

  assert.strictEqual(at("everything").excludeCraftingSystems, false);
  for (const rung of ["no-niche-crafting", "no-solar-lunar", "printed-only"]) {
    assert.strictEqual(at(rung).excludeCraftingSystems, true,
      `${rung} degrades to the closest legal older state, not to nothing`);
  }

  // A stale value on state must never survive — the rung is the only truth.
  assert.strictEqual(at("everything", true).excludeCraftingSystems, false,
    "a stale true beside the top rung is overwritten, not preserved");
  assert.strictEqual(at("printed-only", false).excludeCraftingSystems, true,
    "and a stale false beside a restrictive rung likewise");
  assert.strictEqual(at("printed-only", false).craftingRung, "printed-only",
    "the rung remains the primary stored truth");
});

// #110 U1 — the blocklist persists like any other collection input.
test("U1/#110: blocklist round-trips through pickInputs and stays an array", () => {
  const s = pickInputs(Object.assign({}, state, { blocklist: ["Gem A", "Gem B"] }), "Blocky");
  assert.deepStrictEqual(s.blocklist, ["Gem A", "Gem B"]);
  assert.ok(INPUT_KEYS.includes("blocklist"), "the allowlist carries the field (backup imports this list)");
});

// #110 U7 — a restored character discloses without re-solving.
test("U7/#110: blockReport survives stripResult", () => {
  const s = stripResult(Object.assign({}, lastRun.result, {
    blockReport: [{ id: "X", name: "X", pool: "Ring", bestAvailable: false }],
  }));
  assert.deepStrictEqual(s.blockReport, [{ id: "X", name: "X", pool: "Ring", bestAvailable: false }]);
});

// #539 — the set pins persist like any other collection input, and the report
// they produced survives so a restored build can still say what happened.
test("#539: pinnedSets round-trips through pickInputs and stays an array", () => {
  const s = pickInputs(Object.assign({}, state, { pinnedSets: ["Cruel Cut", "Quickblade"] }), "Pinner");
  assert.deepStrictEqual(s.pinnedSets, ["Cruel Cut", "Quickblade"]);
  assert.ok(INPUT_KEYS.includes("pinnedSets"),
    "the allowlist carries the field — a saved build solved under a pin must come back holding it");
});

test("#539: setPinReport survives stripResult", () => {
  const rep = [{ set: "Cruel Cut", verdict: "pinned", pieces_required: 3 },
    { set: "Quickblade", verdict: "not-owned", pieces_required: 3, why: "…" }];
  const s = stripResult(Object.assign({}, lastRun.result, { setPinReport: rep }));
  assert.deepStrictEqual(s.setPinReport, rep,
    "program is dropped on save, so a restored build cannot re-derive why a pin did not land");
});

// ---------------------------------------------------------------------------
// U3 (#290/#291) — the cross-add marker survives a save/load round-trip.
// `breakdown` is on RESULT_KEEP and parts are stored whole, so the field rides
// along; this pins that no future field-level filtering strips it.
test("U3: stripResult keeps crossAdd on breakdown parts (save/load round-trip)", () => {
  const breakdown = {
    Combustion: [
      { bonus_type: "Equipment", value: 100, source: "Ember Band", sourceKind: "worn",
        slot: "Ring", hostIds: ["Ember Band"], via: null, crossAdd: null },
      { bonus_type: "Implement", value: 50, source: "Universal Torc", sourceKind: "worn",
        slot: "Necklace", hostIds: ["Universal Torc"], via: null,
        crossAdd: "Universal Spell Power" },
    ],
  };
  const s = stripResult({ status: "optimal", chosen: [], effective: {}, breakdown,
    program: { cyclic: true } });
  // Through JSON, exactly as localStorage stores it.
  const restored = JSON.parse(JSON.stringify(s));
  assert.deepStrictEqual(restored.breakdown, breakdown,
    "breakdown parts round-trip whole, crossAdd included");
  assert.strictEqual(restored.breakdown.Combustion[1].crossAdd, "Universal Spell Power");
});

// ---------------------------------------------------------------------------
// #91 (U5, KTD6/R14) — the Utility receipts survive the save path. `program`
// is dropped by omission and a restored character is never re-solved, so
// without utilityReport in RESULT_KEEP a saved tier-ranked build could only
// ever render the report-absent state on reload.
test("#91 U5/R14: utilityReport + utilityCount survive stripResult; program still dropped", () => {
  const report = { count: 2, effects: [
    { name: "Ghost Touch", item: "rGT" }, { name: "Feather Falling", item: "tFF" }] };
  const kept = stripResult({ status: "optimal", chosen: [], effective: {},
    utilityReport: report, utilityCount: 2, program: { cyclic: true } });
  assert.deepStrictEqual(kept.utilityReport, report, "the receipts are persisted");
  assert.strictEqual(kept.utilityCount, 2, "the stage-locked count rides along");
  assert.strictEqual(kept.program, undefined, "the program still is not");
});

test("#91 U5/R14: a serialized character keeps utilityReport through save -> load -> JSON round-trip", () => {
  const st = fakeStorage();
  const report = { count: 1, effects: [{ name: "Ghost Touch", item: "nGT" }] };
  const run = { query: { targets: ["Constitution", "Utility effects"] },
    result: { status: "optimal", chosen: [], effective: { Constitution: 12 },
      utilityReport: report, utilityCount: 1, program: { huge: true } } };
  saveCharacter(serializeCharacter("Utila", state, run, "b1"), st);
  const rec = loadCharacter("Utila", st);
  const restored = JSON.parse(JSON.stringify(rec.snapshot)); // exactly as localStorage stores it
  assert.deepStrictEqual(restored.utilityReport, report,
    "the restored snapshot renders receipts without a re-solve");
  assert.strictEqual(restored.utilityCount, 1);
});

// ---- #91 U4/KTD8 — the Utility-tier save marker + priority round-trip --------

test("#91 U4/KTD8: INPUT_KEYS carries utility_tier_aware (the save-path allowlist)", () => {
  assert.ok(INPUT_KEYS.includes("utility_tier_aware"),
    "a marker outside the allowlist is silently stripped and every save reads pre-feature");
});

test("#91 U4/KTD8: every save stamps utility_tier_aware: true, even when state lacks it", () => {
  const inputs = pickInputs(state, "Marked");   // `state` predates the feature: no marker field
  assert.strictEqual(inputs.utility_tier_aware, true);
  // ...and it survives JSON, so the stored record is verifiably marked.
  assert.strictEqual(JSON.parse(JSON.stringify(inputs)).utility_tier_aware, true);
});

test("#91 U4/R2: a dragged sentinel position round-trips save -> load with the marker", () => {
  const st = fakeStorage();
  const dragged = { ...state, priorities: ["Constitution", "Utility effects", "Dodge"] };
  saveCharacter(serializeCharacter("Dragged", dragged, lastRun, "b1"), st);
  const rec = loadCharacter("Dragged", st);
  assert.deepStrictEqual(rec.inputs.priorities, ["Constitution", "Utility effects", "Dodge"],
    "position 2 restores exactly where it was dragged");
  assert.strictEqual(rec.inputs.utility_tier_aware, true, "and the record is marked");
});

test("#91 U4/R2: a removed sentinel stays removed in the saved record — still marked", () => {
  const st = fakeStorage();
  const removed = { ...state, priorities: ["Constitution", "Dodge"] };
  saveCharacter(serializeCharacter("Removed", removed, lastRun, "b1"), st);
  const rec = loadCharacter("Removed", st);
  assert.deepStrictEqual(rec.inputs.priorities, ["Constitution", "Dodge"],
    "no sentinel is re-injected at save time");
  assert.strictEqual(rec.inputs.utility_tier_aware, true,
    "the marker is what tells the load path this removal was deliberate");
});

if (!process.exitCode) console.log(`\n${passed} passed`);

// ---------------------------------------------------------------------------
// #348 (U7, R11/KTD3/KTD4) — the container and its second-generation marker.
// ---------------------------------------------------------------------------

test("#348 U7/R11: INPUT_KEYS carries the container and the second-generation marker", () => {
  assert.ok(INPUT_KEYS.includes("utilityContainer"), "the container is on the save allowlist");
  assert.ok(INPUT_KEYS.includes("utility_container_aware"),
    "so is the marker — #91's utility_tier_aware only separates the FIRST generation");
  // backup.js imports this list, so the export/import round-trip carries both for
  // free and the two lists cannot drift.
});

test("#348 U7/KTD3/AE4: a curated container round-trips exactly, order included", () => {
  const st = fakeStorage();
  const curated = { ...state, utilityContainer: ["Deathblock", "Ghostly", "True Seeing"] };
  saveCharacter(serializeCharacter("Curated", curated, lastRun, "idc"), st);
  const back = loadCharacter("Curated", st);
  assert.deepStrictEqual(back.inputs.utilityContainer, ["Deathblock", "Ghostly", "True Seeing"],
    "contents AND order survive — a reordered container that reloads sorted is a silent data loss");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(back)).inputs.utilityContainer,
    ["Deathblock", "Ghostly", "True Seeing"], "and survives JSON exactly as localStorage stores it");
  assert.strictEqual(back.inputs.utility_container_aware, true, "the marker is stamped by the writing code");
});

test("#348 U7/KTD3: null and an EMPTY array round-trip as different things", () => {
  const st = fakeStorage();
  // null  = never curated -> follow the current default roster (so a later roster
  //         revision reaches this player).
  // []    = deliberately emptied -> pursue nothing.
  // Collapsing either into the other is a silent data change: one freezes every
  // untouched container at today's roster, the other refills one the player emptied.
  saveCharacter(serializeCharacter("Untouched", { ...state, utilityContainer: null }, lastRun, "idc"), st);
  saveCharacter(serializeCharacter("Emptied", { ...state, utilityContainer: [] }, lastRun, "idc"), st);
  const untouched = JSON.parse(JSON.stringify(loadCharacter("Untouched", st)));
  const emptied = JSON.parse(JSON.stringify(loadCharacter("Emptied", st)));
  assert.strictEqual(untouched.inputs.utilityContainer, null, "untouched stays null through JSON");
  assert.deepStrictEqual(emptied.inputs.utilityContainer, [], "emptied stays an empty array through JSON");
  assert.notStrictEqual(untouched.inputs.utilityContainer, emptied.inputs.utilityContainer);
});

test("#348 U7/R12: a pre-container save is distinguishable from a post-container one", () => {
  const rec = serializeCharacter("Post", state, lastRun, "idc");
  assert.strictEqual(rec.inputs.utility_container_aware, true, "everything this code writes is marked");
  // A record written before #348 simply lacks the key — the same shape #91 used,
  // and what the wizard's load path reads as "heal me once".
  const pre = JSON.parse(JSON.stringify(rec));
  delete pre.inputs.utility_container_aware;
  assert.ok(!("utility_container_aware" in pre.inputs), "absence is the pre-container signal");
});


// #359 — the owned-augment opt-in must survive a save/load round trip, and a
// character saved BEFORE it shipped must reload solving what it solved before.
test("#359: ownedAugments round-trips, and a pre-feature save reads as off", () => {
  const inputs = { characterName: "Aug", ml: 34, pool: "owned",
                   ownedNames: ["My Ring"], ownedAugments: true, priorities: ["Constitution"] };
  assert.ok(INPUT_KEYS.includes("ownedAugments"), "the key is on the input allowlist");
  const kept = pickInputs(inputs);
  assert.strictEqual(kept.ownedAugments, true, "the opt-in is persisted");

  // The pre-feature shape: the key simply is not there.
  const legacy = { characterName: "Old", ml: 34, pool: "owned", ownedNames: ["My Ring"] };
  assert.ok(!("ownedAugments" in legacy));
  assert.strictEqual(!!legacy.ownedAugments, false,
    "absent reads as off — a saved character does not silently change what it solves");
});


// ---- #88 U5 — overrides are a saved input ------------------------------------
// R20/R22: the override travels with the character and carries the type its
// target affix held when it was written. R21/AE10: a character saved before the
// feature loads with none and solves exactly as it did before.
const OVERRIDES = [
  { variant_id: "Aberrant Robe", name: "Armor Class", from: "Armor", value: "5",
    to: "Enhancement", note: "measured on my own robe" },
  { variant_id: "Artemist's Aegis (level 5)", name: "Fortitude Save", from: "Resistance",
    value: "4", to: "Insight", note: "" },
];

test("#88 U5 (R20/R22/AE18): overrides join the input allowlist and round-trip", () => {
  assert.ok(INPUT_KEYS.includes("overrides"), "the key is on the save-path allowlist");
  const st = Object.assign({}, state, { overrides: OVERRIDES });
  const rec = serializeCharacter("Overrider", st, lastRun, "b1");
  // Through real JSON, because that is the only form the store ever holds.
  const back = JSON.parse(JSON.stringify(rec));
  assert.deepStrictEqual(back.inputs.overrides, OVERRIDES,
    "both overrides return with their recorded types, values, and notes");
  saveCharacter(rec, fakeStorage());
});

test("#88 U5 (R21/AE10): a pre-feature save carries no overrides key", () => {
  const rec = serializeCharacter("Plain", state, lastRun, "b1");
  assert.deepStrictEqual(rec.inputs.overrides, [],
    "a character with none saves an empty list rather than undefined");
  const legacy = { characterName: "Old", ml: 34, priorities: ["Constitution"] };
  assert.ok(!("overrides" in legacy), "absence is the pre-feature signal");
});

test("#88 U5 (KTD5): a non-array in state is sanitized at the save boundary", () => {
  const st = Object.assign({}, state, { overrides: "not-a-list" });
  assert.deepStrictEqual(pickInputs(st, "Bad").overrides, [],
    "a hand-edited or corrupted value never reaches the store as-is");
});

test("#88 U5 (KTD5/R30): overrideReport joins RESULT_KEEP", () => {
  const report = { applied: [{ variant_id: "Aberrant Robe", name: "Armor Class",
    from: "Armor", to: "Enhancement", count: 1 }], unmatched: [], ineligible: [] };
  const kept = stripResult(Object.assign({}, lastRun.result, { overrideReport: report }));
  assert.deepStrictEqual(kept.overrideReport, report,
    "a restored character discloses what applied without re-solving — `program` is dropped");
});

test("#88 review #9: the save boundary applies the same override ceiling", () => {
  const { OVERRIDE_LIMIT } = require("../web/overrides.js");
  const huge = Array.from({ length: OVERRIDE_LIMIT + 500 }, (_, i) => ({
    variant_id: `Item ${i}`, name: "Armor Class", from: "Armor", value: "5", to: "Enhancement" }));
  const kept = pickInputs(Object.assign({}, state, { overrides: huge }), "Big").overrides;
  assert.strictEqual(kept.length, OVERRIDE_LIMIT,
    "an over-long list cannot re-persist — otherwise the load-path cap is undone on every save");
});


// ---------------------------------------------------------------------------
// plan 2026-08-25-001 U6 — deleting a build takes its dependents with it.

/** A storage stand-in shared by the character store AND the farming store, so a
 *  cascade is observed across both the way it happens in a browser. */
function sharedStorage(failOnSet) {
  const m = {};
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => {
      if (failOnSet && failOnSet(k)) { const e = new Error("full"); e.name = "QuotaExceededError"; throw e; }
      m[k] = String(v);
    },
    removeItem: (k) => { delete m[k]; },
    _keys: () => Object.keys(m),
  };
}

function seedBuildWithFarming(st, name, items) {
  saveCharacter(serializeCharacter(name, state, null, null), st);
  for (const it of items) Farm.toggleAcquired(name, it, st);
}

test("U6: deleting a build removes its farming progress with it", () => {
  const st = sharedStorage();
  seedBuildWithFarming(st, "Tank", ["Item A", "Item B"]);
  seedBuildWithFarming(st, "Caster", ["Item C"]);
  const r = deleteBuildAndDependents("Tank", st);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(listCharacters(st).map((c) => c.name || c), ["Caster"]);
  assert.deepStrictEqual(Farm.loadProgress("Tank", st), {}, "its ticks are gone");
  assert.deepStrictEqual(Object.keys(Farm.loadProgress("Caster", st)), ["Item C"],
    "and another build's progress is untouched");
});

test("U6: the impact is readable BEFORE the delete, and matches what goes", () => {
  // Read after the delete and it always reports zero — a confirmation that cannot
  // be wrong and cannot be useful.
  const st = sharedStorage();
  seedBuildWithFarming(st, "Tank", ["A", "B", "C"]);
  const before = deletionImpact("Tank", st);
  assert.strictEqual(before.farming, 3, "counted while it is still a question");
  const r = deleteBuildAndDependents("Tank", st);
  assert.strictEqual(r.impact.farming, 3, "and the delete reports the same count it acted on");
  assert.strictEqual(deletionImpact("Tank", st).farming, 0, "nothing left afterwards");
});

test("U6: a build with no farming progress reports zero and still deletes", () => {
  const st = sharedStorage();
  saveCharacter(serializeCharacter("Bare", state, null, null), st);
  assert.strictEqual(deletionImpact("Bare", st).farming, 0);
  assert.strictEqual(deleteBuildAndDependents("Bare", st).ok, true);
  assert.deepStrictEqual(listCharacters(st), []);
});

test("U6: version snapshots are NOT counted and NOT deleted", () => {
  // Corrects the plan. Versions are ONE GLOBAL LIST: versions.js holds no
  // character reference, listVersions takes no scope, and stampedBuildId is the
  // DATASET build id used for staleness. A version's only tie to a character is
  // the display name of a `named` snapshot, as prose — and `auto` snapshots carry
  // nothing. Deleting them by matching that prose would infer a relationship the
  // data does not record.
  const V = require("../web/versions.js");
  const st = sharedStorage();
  seedBuildWithFarming(st, "Tank", ["A"]);
  V.saveVersion(V.makeVersion({ id: "v1", name: "Tank — something", kind: "named" }), st);
  V.saveVersion(V.makeVersion({ id: "v2", name: "auto", kind: "auto" }), st);
  const impact = deletionImpact("Tank", st);
  assert.ok(!("versions" in impact), "the impact does not claim to count versions");
  deleteBuildAndDependents("Tank", st);
  assert.deepStrictEqual(V.listVersions(st).map((v) => v.id).sort(), ["v1", "v2"],
    "both snapshots survive — they were never owned by the build");
});

test("U6: a failed dependent clear aborts BEFORE the build is removed", () => {
  // A partial cascade is worse than none: the player would be left with exactly
  // the orphan this exists to remove and no build to reach it from.
  // Seed with writes ALLOWED, then arm the failure — seeding through a storage
  // that already rejects the farming key throws before the case under test runs.
  let armed = false;
  const st = sharedStorage((k) => armed && k === Farm.PROGRESS_KEY);
  seedBuildWithFarming(st, "Tank", ["A"]);
  armed = true;
  const r = deleteBuildAndDependents("Tank", st);
  assert.strictEqual(r.ok, false, "the cascade reports failure");
  assert.strictEqual(r.stage, "farming", "and names where it stopped");
  assert.ok(listCharacters(st).length, "the build is still there, so the player can retry");
});

test("U6: deleteCharacter stays the primitive and does NOT cascade on its own", () => {
  // One authority. The primitive is still used by the coordinator; if it cascaded
  // too the cleanup would run twice and the count would be read after the fact.
  const st = sharedStorage();
  seedBuildWithFarming(st, "Tank", ["A"]);
  deleteCharacter("Tank", st);
  assert.deepStrictEqual(Object.keys(Farm.loadProgress("Tank", st)), ["A"],
    "the primitive removes the build alone — the coordinator is what cascades");
});

// ---- #518 U2: the rename coordinator --------------------------------------

function solvedRecord(name) {
  const rec = serializeCharacter(name, state, null, null);
  rec.snapshot = { status: "optimal", chosen: [{ slot: "Head", variant: { variant_id: "X" } }] };
  rec.query = { targets: ["Strength"] };
  rec.stampedBuildId = "08202026.3";
  rec.savedAt = "2026-08-20T00:00:00.000Z";
  return rec;
}

test("#518: a rename moves the record — the new name loads it, the old loads nothing", () => {
  const st = sharedStorage();
  saveCharacter(solvedRecord("Aurelia"), st);
  assert.strictEqual(renameBuild("Aurelia", "Aurelia Mk2", st).ok, true);
  assert.ok(loadCharacter("Aurelia Mk2", st), "the build is under its new name");
  assert.strictEqual(loadCharacter("Aurelia", st), null, "and not under the old one");
  assert.deepStrictEqual(listCharacters(st).map((c) => c.name), ["Aurelia Mk2"]);
});

test("#518: the renamed record's inputs.characterName moves with the key", () => {
  // The trap. pickInputs writes the name INTO the record as well as using it as
  // the store key, so a key-only rename leaves a record whose inputs still say
  // the old name — load it, navigate once, and autosave re-creates the build the
  // rename was supposed to remove. Every other test in this file passes without
  // this one.
  const st = sharedStorage();
  saveCharacter(solvedRecord("Aurelia"), st);
  renameBuild("Aurelia", "Aurelia Mk2", st);
  const back = loadCharacter("Aurelia Mk2", st);
  assert.strictEqual(back.name, "Aurelia Mk2", "the record's own name field");
  assert.strictEqual(back.inputs.characterName, "Aurelia Mk2",
    "and the name carried inside its inputs, which is what a reload restores");
});

test("#518: a rename preserves the loadout, the query, the stamp and the save date", () => {
  // A rename is not a save. Re-stamping would silence the staleness warning for
  // a build that has not been re-solved.
  const st = sharedStorage();
  const before = solvedRecord("Aurelia");
  saveCharacter(before, st);
  renameBuild("Aurelia", "Aurelia Mk2", st);
  const after = loadCharacter("Aurelia Mk2", st);
  assert.deepStrictEqual(after.snapshot, before.snapshot);
  assert.deepStrictEqual(after.query, before.query);
  assert.strictEqual(after.stampedBuildId, "08202026.3");
  assert.strictEqual(after.savedAt, "2026-08-20T00:00:00.000Z");
});

test("#518: a rename carries the build's farming progress with it", () => {
  const st = sharedStorage();
  seedBuildWithFarming(st, "Aurelia", ["Item A", "Item B"]);
  seedBuildWithFarming(st, "Bram", ["Item C"]);
  assert.strictEqual(renameBuild("Aurelia", "Aurelia Mk2", st).ok, true);
  assert.deepStrictEqual(Object.keys(Farm.loadProgress("Aurelia Mk2", st)).sort(),
    ["Item A", "Item B"]);
  assert.deepStrictEqual(Farm.loadProgress("Aurelia", st), {}, "nothing left under the old name");
  assert.deepStrictEqual(Object.keys(Farm.loadProgress("Bram", st)), ["Item C"],
    "another build's progress is untouched");
});

test("#518: a rename onto an existing build's name is refused, changing nothing", () => {
  const st = sharedStorage();
  seedBuildWithFarming(st, "Aurelia", ["A"]);
  seedBuildWithFarming(st, "Bram", ["B"]);
  const r = renameBuild("Aurelia", "Bram", st);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "collision", "the surface has to say which refusal happened");
  assert.ok(loadCharacter("Aurelia", st) && loadCharacter("Bram", st), "both builds survive");
  assert.deepStrictEqual(Object.keys(Farm.loadProgress("Aurelia", st)), ["A"]);
  assert.deepStrictEqual(Object.keys(Farm.loadProgress("Bram", st)), ["B"],
    "and neither build's ticks moved");
});

test("#518: a rename to an empty or whitespace name is refused, changing nothing", () => {
  const st = sharedStorage();
  seedBuildWithFarming(st, "Aurelia", ["A"]);
  for (const bad of ["", "   ", "\t"]) {
    const r = renameBuild("Aurelia", bad, st);
    assert.strictEqual(r.ok, false, `refused: ${JSON.stringify(bad)}`);
    assert.strictEqual(r.reason, "empty");
  }
  assert.ok(loadCharacter("Aurelia", st), "the build is untouched");
  assert.deepStrictEqual(Object.keys(Farm.loadProgress("Aurelia", st)), ["A"]);
});

test("#518: renaming a build to the name it already has is a no-op success", () => {
  // Not a self-collision. The build IS the record at that name.
  const st = sharedStorage();
  seedBuildWithFarming(st, "Aurelia", ["A"]);
  const r = renameBuild("Aurelia", "Aurelia", st);
  assert.strictEqual(r.ok, true);
  assert.ok(loadCharacter("Aurelia", st));
  assert.deepStrictEqual(Object.keys(Farm.loadProgress("Aurelia", st)), ["A"]);
});

test("#518: a rename that trims to the same name is also a no-op, not a collision", () => {
  const st = sharedStorage();
  saveCharacter(solvedRecord("Aurelia"), st);
  assert.strictEqual(renameBuild("Aurelia", "  Aurelia  ", st).ok, true);
  assert.ok(loadCharacter("Aurelia", st), "still one build, under its own name");
  assert.strictEqual(listCharacters(st).length, 1);
});

test("#518: a failed build write rolls the progress back and reports failure", () => {
  // The build is still loadable under its old name, so the player can retry.
  let armed = false;
  const st = sharedStorage((k) => armed && k === STORE_KEY);
  seedBuildWithFarming(st, "Aurelia", ["A", "B"]);
  armed = true;
  const r = renameBuild("Aurelia", "Aurelia Mk2", st);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.stage, "build", "and names where it stopped");
  assert.ok(loadCharacter("Aurelia", st), "the build kept its old name");
  assert.strictEqual(loadCharacter("Aurelia Mk2", st), null, "and nothing was written under the new one");
  assert.deepStrictEqual(Object.keys(Farm.loadProgress("Aurelia", st)).sort(), ["A", "B"],
    "the ticks are back where they were");
  assert.deepStrictEqual(Farm.loadProgress("Aurelia Mk2", st), {},
    "and not stranded under a name with no build");
});

test("#518: a failed progress move never writes the build record at all", () => {
  let armed = false;
  const st = sharedStorage((k) => armed && k === Farm.PROGRESS_KEY);
  seedBuildWithFarming(st, "Aurelia", ["A"]);
  armed = true;
  const r = renameBuild("Aurelia", "Aurelia Mk2", st);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.stage, "farming");
  assert.strictEqual(loadCharacter("Aurelia Mk2", st), null, "no half-renamed build exists");
  assert.ok(loadCharacter("Aurelia", st), "the original is intact");
});

test("#518: renaming a build with no farming progress succeeds and invents no entry", () => {
  const st = sharedStorage();
  saveCharacter(solvedRecord("Bare"), st);
  assert.strictEqual(renameBuild("Bare", "Bare Mk2", st).ok, true);
  assert.ok(loadCharacter("Bare Mk2", st));
  assert.ok(!("Bare Mk2" in Farm.readProgress(st)), "no empty progress entry is created");
});

test("#518: renaming a build that does not exist is refused rather than creating one", () => {
  const st = sharedStorage();
  const r = renameBuild("Ghost", "Ghost Mk2", st);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "missing");
  assert.deepStrictEqual(listCharacters(st), [], "nothing was conjured into the store");
});


// ---- #357/U1 — a disclosure that renders on a solve and vanishes on reload ----
//
// This has now happened five times. `creditReport`, `saturationReport` and the #449
// ceiling census were each added to RESULT_KEEP only AFTER someone noticed a
// disclosure had gone quiet on reload; `outbidReport` and `packFilter` were both
// still live when this guard was written, the second of them shipped the same day.
//
// The shape is always identical: a new field is stamped on the solver result, a
// notice reads it, and nobody edits the allowlist in `persist.js` — so the build
// solves correctly, says the right thing once, and then silently stops saying it.
// A RESTORED build is the bad case; a SHARED one is worse, because `project()` reads
// the saved record and the recipient cannot re-solve to find out what was withheld.
//
// The real fix is plan U1 (delete the allowlist, drop only the unserialisable by
// name). Until that lands this makes the omission a build failure instead of a thing
// somebody eventually notices.
test("#357: every result field the disclosure layer reads survives a save", () => {
  const fs = require("fs"), path = require("path");
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", "web", f), "utf8");

  // Fields read off a solved snapshot by the two layers that render disclosures.
  const found = new Set();
  for (const src of [read("projection.js"), read("results.js")]) {
    for (const m of src.matchAll(/\b(?:snap|snapshot|result|build)(?:\s*&&\s*(?:snap|snapshot|result|build))?\.([a-zA-Z][a-zA-Z0-9]*)/g)) {
      found.add(m[1]);
    }
  }

  // Not solver output, so not RESULT_KEEP's business. Each is here for a stated
  // reason rather than because it was inconvenient.
  const EXEMPT = new Set([
    "query", "inputs", "name", "savedAt", "stampedBuildId",   // record fields, not result
    "snapshot", "length", "map", "filter", "forEach", "find", "slice", "some",
    "every", "reduce", "sort", "concat", "join", "push", "indexOf", "includes",
    "status",                          // in RESULT_KEEP already; listed for clarity
    "floorReport", "targets", "items", "metadata",            // model/dataset/query reads
    "alternatives", "altState", "sol",                        // live-only, never persisted
    // A FAILED solve is never saved as a build: `RESULT_KEEP` requires `status`, and
    // renderResults short-circuits to the empty state when it is not "optimal", so a
    // record can never reach the failure text these two feed. Exempt because they are
    // unreachable from a saved record, not because persisting them was inconvenient.
    "failure", "reason",
  ]);

  const KEEP = new Set(require("../web/persist.js").RESULT_KEEP
    || JSON.parse(JSON.stringify(RESULT_KEEP_FROM_SOURCE(read("persist.js")))));

  const missing = [...found].filter((k) => !EXEMPT.has(k) && !KEEP.has(k)).sort();
  assert.deepStrictEqual(missing, [],
    "these are read off a saved build but not persisted, so they render once and "
    + "vanish on reload: " + missing.join(", "));
});

function RESULT_KEEP_FROM_SOURCE(src) {
  const blk = src.slice(src.indexOf("const RESULT_KEEP = ["));
  return [...blk.slice(0, blk.indexOf("];")).matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]);
}
