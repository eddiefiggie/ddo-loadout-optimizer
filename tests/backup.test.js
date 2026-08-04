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

if (!process.exitCode) console.log(`\n${passed} passed`);
