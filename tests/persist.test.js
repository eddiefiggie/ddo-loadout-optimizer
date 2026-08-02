// U2 — localStorage character store (pure logic). Run: node tests/persist.test.js
const assert = require("assert");
const {
  serializeCharacter, stripResult, saveCharacter, listCharacters, loadCharacter, deleteCharacter,
  allCharacters, saveMany,
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
  oath: "druid", style: "one-hand", weaponTypes: ["Long Swords"], offHand: ["Orbs"],
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
  assert.strictEqual(rec.inputs.oath, "druid");
  // The obsolete coarse flag is off the allowlist, so it never round-trips — an old
  // save that still carries it simply loses it and loads unconstrained.
  assert.ok(!("weapon" in rec.inputs), "the obsolete coarse weapon flag is not persisted");
});

test("ownedNames Set serializes to a JSON-safe array", () => {
  const withOwned = { ...state, ownedNames: new Set(["Item A", "Item B"]) };
  const rec = serializeCharacter("Owned", withOwned, lastRun, "id1");
  assert.deepStrictEqual(rec.inputs.ownedNames, ["Item A", "Item B"]);
  // round-trips through JSON unchanged
  assert.deepStrictEqual(JSON.parse(JSON.stringify(rec)).inputs.ownedNames, ["Item A", "Item B"]);
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

if (!process.exitCode) console.log(`\n${passed} passed`);
