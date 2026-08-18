// U5 — versioned JSON backup: export, import, migration, payload safety.
// Run: node tests/backup.test.js
const assert = require("assert");
const {
  serializeAll, parseBackup, mergeInto, CURRENT_SCHEMA,
} = require("../web/backup.js");

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e.message}`); process.exitCode = 1; }
}

const rec = (name, ml) => ({
  name, savedAt: "2026-07-30T00:00:00.000Z",
  inputs: { characterName: name, ml, race: "Elf", priorities: ["Constitution"] },
  query: { targets: ["Constitution"] },
  snapshot: { status: "optimal", chosen: [] },
  stampedBuildId: "abc123",
});

test("serializeAll wraps characters with the current schema version", () => {
  const out = serializeAll({ Sook: rec("Sook", 34) }, { buildId: "abc123" });
  assert.strictEqual(out.schema_version, CURRENT_SCHEMA);
  assert.strictEqual(out.app_build_id, "abc123");
  assert.ok(out.characters.Sook);
  assert.strictEqual(out.characters.Sook.inputs.ml, 34);
});

test("export -> import round-trip restores characters", () => {
  const text = JSON.stringify(serializeAll({ Sook: rec("Sook", 34), Torin: rec("Torin", 30) }, {}));
  const res = parseBackup(text);
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(Object.keys(res.characters).sort(), ["Sook", "Torin"]);
  assert.strictEqual(res.characters.Sook.inputs.ml, 34);
});

test("U6: ownedSetAugments (array) survives export -> import round-trip", () => {
  const r = rec("SA", 34);
  r.inputs.ownedSetAugments = ["Alluring Elocution", "Arcane Barrier"];
  const text = JSON.stringify(serializeAll({ SA: r }, {}));
  const res = parseBackup(text);
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res.characters.SA.inputs.ownedSetAugments, ["Alluring Elocution", "Arcane Barrier"]);
});

test("a current-version file imports", () => {
  const text = JSON.stringify({ schema_version: 1, characters: { Sook: rec("Sook", 34) } });
  assert.strictEqual(parseBackup(text, { current: 1, window: 3 }).ok, true);
});

test("a within-window older file migrates and imports", () => {
  // simulate current=3, window=3 -> versions 1,2,3 are in window; a v1 migration runs
  const migrations = { 2: (d) => d, 3: (d) => d };
  const text = JSON.stringify({ schema_version: 1, characters: { Sook: rec("Sook", 34) } });
  const res = parseBackup(text, { current: 3, window: 3, migrations });
  assert.strictEqual(res.ok, true, res.error);
  assert.strictEqual(res.schemaVersion, 3);
});

test("older-than-window is refused as too-old", () => {
  // current=5, window=3 -> in-window is 3,4,5; v2 is too old
  const text = JSON.stringify({ schema_version: 2, characters: {} });
  const res = parseBackup(text, { current: 5, window: 3 });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, "too-old");
});

test("newer-than-app is refused", () => {
  const text = JSON.stringify({ schema_version: 2, characters: {} });
  const res = parseBackup(text, { current: 1, window: 3 });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, "newer");
});

test("structurally invalid JSON is refused, not thrown", () => {
  assert.strictEqual(parseBackup("{not json").error, "invalid");
  assert.strictEqual(parseBackup(JSON.stringify({ nope: 1 })).error, "invalid");
});

test("oversized payload is refused", () => {
  const big = JSON.stringify({ schema_version: 1, characters: {}, pad: "x".repeat(20) });
  const res = parseBackup(big, { current: 1, window: 3, maxChars: 10 });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, "oversized");
});

test("prototype-pollution payload does not pollute Object.prototype and is stripped", () => {
  const hostile = '{"schema_version":1,"characters":{"Sook":{"name":"Sook","__proto__":{"polluted":true},"inputs":{"ml":34}}}}';
  const res = parseBackup(hostile, { current: 1, window: 3 });
  assert.strictEqual(({}).polluted, undefined, "Object.prototype was polluted");
  if (res.ok) {
    assert.strictEqual(res.characters.Sook.polluted, undefined);
    assert.strictEqual(Object.getPrototypeOf(res.characters.Sook), Object.prototype);
  }
});

test("reviver strips __proto__ nested inside snapshot (exercises the reviver, not the allowlist)", () => {
  // __proto__ buried in app-produced snapshot data — the field allowlist passes
  // snapshot through, so only the reviver + scrub can catch this.
  const hostile = '{"schema_version":1,"characters":{"Sook":{"name":"Sook",'
    + '"snapshot":{"status":"optimal","chosen":[],"__proto__":{"polluted":true}}}}}';
  const res = parseBackup(hostile, { current: 1, window: 3 });
  assert.strictEqual(({}).polluted, undefined, "Object.prototype polluted via nested __proto__");
  assert.strictEqual(res.ok, true);
  assert.ok(!Object.prototype.hasOwnProperty.call(res.characters.Sook.snapshot, "__proto__"),
    "snapshot still carries an own __proto__ property");
});

test("a malformed character (missing name) refuses the whole file — no partial import", () => {
  const text = JSON.stringify({ schema_version: 1, characters: { Good: rec("Good", 34), Bad: { inputs: { ml: 1 } } } });
  const res = parseBackup(text, { current: 1, window: 3 });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, "invalid");
});

test("mergeInto per-name updates collisions, adds new, keeps others; replace wipes", () => {
  const existing = { Sook: rec("Sook", 34), Keeper: rec("Keeper", 20) };
  const incoming = { Sook: rec("Sook", 30), Torin: rec("Torin", 28) };
  const merged = mergeInto(existing, incoming, "merge");
  assert.strictEqual(merged.Sook.inputs.ml, 30);   // updated
  assert.strictEqual(merged.Keeper.inputs.ml, 20);  // kept
  assert.strictEqual(merged.Torin.inputs.ml, 28);   // added
  const replaced = mergeInto(existing, incoming, "replace");
  assert.deepStrictEqual(Object.keys(replaced).sort(), ["Sook", "Torin"]);
});


// ---- U5 — declared credits survive the backup round-trip (R11) --------------

test("U5: declared credits survive export and import", () => {
  // backup.js imports persist.js's INPUT_KEYS precisely so the save path and the
  // import path cannot drift; this is the assertion that proves the new key rode
  // along rather than being silently stripped on import.
  const credits = {
    "Combat Mastery||Insight": { stat: "Combat Mastery", bonus_type: "Insight", value: 7 },
    "Devotion||Sacred": { stat: "Devotion", bonus_type: "Sacred", value: 12 },
  };
  const r = rec("Trance", 34);
  r.inputs.declaredCredits = credits;
  const parsed = parseBackup(JSON.stringify(serializeAll({ Trance: r }, {})));
  assert.ok(parsed.ok, `backup must parse: ${parsed.error || ""}`);
  assert.deepStrictEqual(parsed.characters.Trance.inputs.declaredCredits, credits,
    "an imported character keeps the credits it was exported with");
});

test("U5: a hand-edited backup cannot smuggle an invalid credit into the solve", () => {
  // A backup file is user-supplied. The allowlist and scrub() pass declaredCredits
  // through by reference, so normalizeCredits at the query seam is the real gate —
  // pin that, rather than asserting an absent field stays absent.
  const { cleanCreditMap } = require("../web/wizard.js");
  const r = rec("Hostile", 30);
  r.inputs.declaredCredits = {
    "__proto__||Insight": { stat: "__proto__", bonus_type: "Insight", value: 5 },
    "CM||insight": { stat: "CM", bonus_type: "insight", value: 7 },
    "CM||Insight": { stat: "CM", bonus_type: "Insight", value: "not a number" },
    "X||Insight": { stat: "X", bonus_type: "Insight", value: 999999 },
    "OK||Insight": { stat: "OK", bonus_type: "Insight", value: 6 },
  };
  const parsed = parseBackup(JSON.stringify(serializeAll({ Hostile: r }, {})));
  assert.ok(parsed.ok);
  const clean = cleanCreditMap(parsed.characters.Hostile.inputs.declaredCredits, { canonical: (v) => v });
  assert.deepStrictEqual(Object.keys(clean), ["OK||Insight"],
    `only the valid credit may reach the solver, got ${JSON.stringify(Object.keys(clean))}`);
  assert.strictEqual({}.polluted, undefined, "no prototype pollution");
});

if (!process.exitCode) console.log(`\n${passed} passed`);

// #346 (U3) — the ladder survives the hand-export / re-import round trip, which
// is the real cross-version boundary: users export these to files and import
// them into whatever build they are running later.
test("#346: craftingRung round-trips through export and re-import", () => {
  const { serializeCharacter } = require("../web/persist.js");
  const state = { ml: 34, race: "Human", priorities: ["Constitution"], slotConstraints: {} };
  const run = { query: {}, result: { status: "optimal", chosen: [], effective: {} } };

  for (const rung of ["everything", "no-niche-crafting", "no-solar-lunar", "printed-only"]) {
    const saved = serializeCharacter("R", Object.assign({}, state, { craftingRung: rung }), run, "b");
    const parsed = parseBackup(JSON.stringify(serializeAll({ R: saved })));
    assert.ok(parsed.ok, `${rung}: the backup parses (${parsed.message || ""})`);
    const back = parsed.characters.R;
    assert.strictEqual(back.inputs.craftingRung, rung,
      `${rung} survives the export/import round trip unchanged`);
    // The derived downgrade bridge rides along and still agrees with the rung.
    assert.strictEqual(back.inputs.excludeCraftingSystems, rung !== "everything",
      `${rung}: the legacy bridge stays consistent with the rung across the round trip`);
  }
});

// The allowlist is shared with persist.js precisely so a field cannot persist on
// one path and be stripped on the other. If craftingRung ever falls off it, the
// round-trip test above would still pass on a fresh save while silently losing
// the field for anyone importing an older file — so pin membership directly.
test("#346: the shared input allowlist carries craftingRung", () => {
  const { INPUT_KEYS } = require("../web/persist.js");
  assert.ok(INPUT_KEYS.includes("craftingRung"),
    "a key outside the allowlist is stripped on import and the rung would not survive");
  assert.ok(INPUT_KEYS.includes("excludeCraftingSystems"),
    "the legacy bridge must also survive import, or a downgrade loses the restriction");
});

test("#348 U7/R11: the export/import round-trip carries the container and its marker", () => {
  const { INPUT_KEYS } = require("../web/persist.js");
  // backup.js filters imported inputs through this same list, so a key outside it
  // is stripped on import. Without the container the player's curation would be
  // silently reset by moving a character between devices; without the marker the
  // imported record would read as pre-container and re-heal (and re-notify) on
  // every single load.
  assert.ok(INPUT_KEYS.includes("utilityContainer"),
    "a container outside the allowlist is stripped on import — curation lost on transfer");
  assert.ok(INPUT_KEYS.includes("utility_container_aware"),
    "the marker must survive too, or an imported record heals forever");
});
