// U2 — load-time dataset normalizer. Run: node tests/dataset.test.js
const assert = require("assert");
const { normalizeItem } = require("../web/dataset.js");

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

if (!process.exitCode) console.log(`\n${passed} passed`);
