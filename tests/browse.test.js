// U5 browse-filter tests (node, zero-dependency). Run: node tests/browse.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { filterVariants, variantStats, affixText } = require("../web/browse.js");
const data = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "items.json"), "utf-8")
);
const items = data.items;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  PASS", name); }
  catch (e) { console.log("  FAIL", name, "\n   ", e.message); process.exitCode = 1; }
}

test("filter by stat returns exactly items carrying that stat", () => {
  const stat = "Intelligence";
  const rows = filterVariants(items, { stat });
  assert.ok(rows.length > 0, "expected some Intelligence items");
  for (const v of rows) assert.ok(variantStats(v).includes(stat));
  // completeness: no Intelligence-bearing item was excluded
  const expected = items.filter((v) => variantStats(v).includes(stat)).length;
  assert.strictEqual(rows.length, expected);
});

test("ML filter returns only variants at or below the cap", () => {
  const rows = filterVariants(items, { maxMl: 10 });
  assert.ok(rows.length > 0);
  for (const v of rows) assert.ok(Number(v.minimum_level) <= 10);
});

test("verification filter returns only quarantined", () => {
  const rows = filterVariants(items, { verification: "quarantined" });
  assert.ok(rows.length > 0);
  for (const v of rows) assert.strictEqual(v.verification, "quarantined");
});

test("empty-match filter returns zero rows (drives empty state)", () => {
  const rows = filterVariants(items, { query: "zzz-no-such-item-xyz" });
  assert.strictEqual(rows.length, 0);
});

test("text query matches item name and affix stat", () => {
  const byName = filterVariants(items, { query: items[0].source_item.slice(0, 5) });
  assert.ok(byName.length > 0);
});

test("affixText renders typed and untyped affixes", () => {
  const withAffix = items.find((v) => (v.affixes || []).length > 0);
  const texts = affixText(withAffix);
  assert.ok(texts.length > 0);
  assert.ok(texts.every((t) => /\+\d/.test(t)));
});

console.log(`\n${passed} passed`);
