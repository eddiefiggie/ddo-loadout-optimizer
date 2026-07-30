// U2 — localStorage character store (pure logic). Run: node tests/persist.test.js
const assert = require("assert");
const {
  serializeCharacter, stripResult, saveCharacter, listCharacters, loadCharacter, deleteCharacter,
} = require("../web/persist.js");

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
  ml: 34, race: "Elf", alignment: "Lawful Good", armor: "light", weapon: "",
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

test("quota-exceeded on save returns a typed error rather than throwing", () => {
  const st = fakeStorage(true);
  const res = saveCharacter(serializeCharacter("Sook", state, lastRun, "id1"), st);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, "quota");
});

if (!process.exitCode) console.log(`\n${passed} passed`);
