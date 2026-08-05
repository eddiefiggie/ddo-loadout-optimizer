// U2 — load-time dataset normalizer. Run: node tests/dataset.test.js
const assert = require("assert");
const { normalizeItem, buildPickerVocabulary } = require("../web/dataset.js");

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e.message}`); process.exitCode = 1; }
}

function names(it) { return it.affixes.map((a) => a.name); }
function find(it, n) { return it.affixes.find((a) => a.name === n); }

// U2 — bare "Sheltering" grants BOTH Physical and Magical Resistance Rating
// (https://ddowiki.com/page/Sheltering); expand it into the two named affixes.
test("U2: bare Sheltering expands into Physical + Magical Sheltering, same value + type", () => {
  const it = { affixes: [{ name: "Sheltering", value: 30, unit: "flat", type: "Enhancement" }] };
  normalizeItem(it);
  assert.ok(!names(it).includes("Sheltering"), "the bare Sheltering affix is replaced");
  const phys = find(it, "Physical Sheltering"), mag = find(it, "Magical Sheltering");
  assert.ok(phys && mag, "both Physical and Magical Sheltering are present");
  assert.strictEqual(phys.value, 30); assert.strictEqual(mag.value, 30);
  assert.strictEqual(phys.type, "Enhancement"); assert.strictEqual(mag.type, "Enhancement");
  assert.strictEqual(phys.unit, "flat"); assert.strictEqual(mag.unit, "flat");
});

test("U2: a typed bare Sheltering (Insight) expands preserving the Insight type", () => {
  const it = { affixes: [{ name: "Sheltering", value: 12, type: "Insight" }] };
  normalizeItem(it);
  assert.strictEqual(find(it, "Physical Sheltering").type, "Insight");
  assert.strictEqual(find(it, "Magical Sheltering").type, "Insight");
});

test("U2: 'Magical Sheltering Cap' and already-split Physical/Magical are untouched", () => {
  const it = { affixes: [
    { name: "Magical Sheltering Cap", value: 200, type: "Enhancement" },
    { name: "Physical Sheltering", value: 45, type: "Enhancement" },
  ] };
  normalizeItem(it);
  assert.deepStrictEqual(names(it).sort(), ["Magical Sheltering Cap", "Physical Sheltering"]);
});

test("U2: expansion is idempotent (re-normalizing does not re-expand)", () => {
  const it = { affixes: [{ name: "Sheltering", value: 30, type: "Enhancement" }] };
  normalizeItem(it);
  const after1 = names(it).sort();
  normalizeItem(it);
  assert.deepStrictEqual(names(it).sort(), after1, "second pass is a no-op");
});

test("U2: an item with bare + explicit Physical Sheltering does not get a duplicate", () => {
  const it = { affixes: [
    { name: "Sheltering", value: 30, type: "Enhancement" },
    { name: "Physical Sheltering", value: 45, type: "Enhancement" },
  ] };
  normalizeItem(it);
  const phys = it.affixes.filter((a) => a.name === "Physical Sheltering");
  assert.strictEqual(phys.length, 1, "no duplicate Physical Sheltering (explicit one kept)");
  assert.strictEqual(phys[0].value, 45, "the explicit affix is preserved");
  assert.ok(it.affixes.some((a) => a.name === "Magical Sheltering" && a.value === 30), "Magical still expanded");
});

test("U2: bare 'Sheltering' is not offered as a standalone picker suggestion", () => {
  const ds = { metadata: { rankable_affixes: ["Sheltering", "Physical Sheltering", "Constitution"] } };
  const vocab = buildPickerVocabulary(ds);
  assert.ok(!vocab.suggestions.includes("Sheltering"), "bare Sheltering dropped from suggestions");
  assert.ok(vocab.suggestions.includes("Physical Sheltering"), "Physical Sheltering stays a suggestion");
});

// ---------------------------------------------------------------------------
// U6 (plan 2026-08-05-001) — characterization guard.
// Pins the picker-vocabulary state that planning research found ALREADY correct,
// so a later vocabulary change cannot silently regress it. These assert current
// shipped behavior; they are not a spec for new work.
// ---------------------------------------------------------------------------

function builtVocab() {
  const fs = require("fs");
  const path = require("path");
  const p = path.join(__dirname, "..", "web", "data", "items.json");
  if (!fs.existsSync(p)) return null; // generated artifact; skip when absent
  return buildPickerVocabulary(JSON.parse(fs.readFileSync(p, "utf8")));
}

// KTD6 — the four boolean composites in scope for U4/U5 are already reachable as
// on/off targets. U5 writes their magnitude ADDITIVELY, so they must STAY here.
test("U6/KTD6: the four in-scope composites are suggested and presence-flagged", () => {
  const v = builtVocab();
  if (!v) return console.log("  (skipped — web/data/items.json not built)");
  for (const n of ["Blurry", "Lesser Displacement", "Greater Heroism", "Crown of Summer"]) {
    assert.ok(v.suggestions.includes(n), `${n} is offered as a suggestion`);
    assert.ok(v.presence.has(n), `${n} is flagged as an on/off presence target`);
  }
});

// KTD6 — R9: these already carry magnitude buckets. The plan must NOT convert
// them to presence-only; that would strip scoring that works today.
test("U6/KTD6: Parrying, Riposte and Good Luck score as magnitude, not presence", () => {
  const v = builtVocab();
  if (!v) return console.log("  (skipped — web/data/items.json not built)");
  for (const n of ["Parrying", "Riposte", "Good Luck"]) {
    assert.ok(v.suggestions.includes(n), `${n} is offered as a suggestion`);
    assert.ok(!v.presence.has(n), `${n} is NOT presence-only — it carries a magnitude bucket`);
  }
});

// R4 — the presence filter still excludes one-off proc/flavor lines. Guards
// against a future change relaxing the filter wholesale (which R5 forbids).
test("U6/R4: a sentence-shaped proc line stays out of suggestions but remains free-typeable", () => {
  const ds = {
    metadata: { rankable_affixes: ["Constitution"] },
    items: [{ affixes: [
      { name: "Ghost Touch", type: "Bool", value: 1 },
      { name: "On a Critical Hit, this weapon applies the Shaken debuff.", type: "Bool", value: 1 },
    ] }],
  };
  const v = buildPickerVocabulary(ds);
  assert.ok(v.suggestions.includes("Ghost Touch"), "a short build-around presence effect is suggested");
  assert.ok(!v.suggestions.some((s) => s.startsWith("On a Critical Hit")), "the proc sentence is not suggested");
  assert.ok(v.known.has("On a Critical Hit, this weapon applies the Shaken debuff."), "but it stays free-typeable");
});

// R1 — the umbrella dead end U1 must close. Documents the CURRENT (broken)
// state: `Well Rounded` is still offered even though umbrella.py expands it
// away, so no item can ever carry it. U1 flips this assertion.
test("U6/R1: `Well Rounded` is still offered today — the dead end U1 closes", () => {
  const v = builtVocab();
  if (!v) return console.log("  (skipped — web/data/items.json not built)");
  assert.ok(v.suggestions.includes("Well Rounded"), "characterizes the pre-U1 state");
  assert.ok(v.known.has("Well Rounded"), "and it is free-typeable via the registry");
});

if (!process.exitCode) console.log(`\n${passed} passed`);
