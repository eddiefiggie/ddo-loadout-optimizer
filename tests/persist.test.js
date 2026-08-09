// U2 — localStorage character store (pure logic). Run: node tests/persist.test.js
const assert = require("assert");
const {
  serializeCharacter, stripResult, saveCharacter, listCharacters, loadCharacter, deleteCharacter,
  allCharacters, saveMany, INPUT_KEYS, pickInputs,
} = require("../web/persist.js");
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
  const report = [{ stat: "CM", bonus_type: "Insight", value: 7, won: true, beatGear: 5, floor: 10, gearOnly: 5 }];
  const kept = stripResult({ status: "optimal", creditReport: report, program: { cyclic: true } });
  assert.deepStrictEqual(kept.creditReport, report, "the disclosure is persisted");
  assert.strictEqual(kept.program, undefined, "and the program still is not");
});

if (!process.exitCode) console.log(`\n${passed} passed`);
