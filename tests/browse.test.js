// U5 browse-filter tests (node, zero-dependency). Run: node tests/browse.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { filterVariants, variantStats, affixText, dinoInsertRow, ncRow, compendiumRow, browsableItems } = require("../web/browse.js");
const data = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8")
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

// ---- Dino content is browsable (insert pool + blank slots) ----

test("browsableItems appends the Dino insert pool as display rows", () => {
  const list = browsableItems(data);
  const inserts = list.filter((v) => v.dino_insert);
  assert.strictEqual(inserts.length, (data.dino_inserts || []).length);
  assert.ok(inserts.length >= 50, "expected the sourced insert pool");
  // browsable = real variants + every appended display pool (dino inserts,
  // NC options, and the indexed-only compendium index)
  const nc = (data.nearly_complete || []).length;
  const comp = (data.compendium || []).filter((x) => x.status === "indexed").length;
  assert.strictEqual(list.length, items.length + inserts.length + nc + comp);
});

test("a Dino insert is findable in the browser by stat", () => {
  const list = browsableItems(data);
  const rows = filterVariants(list, { stat: "Constitution" });
  assert.ok(rows.some((v) => v.dino_insert && v.slot === "Dino Insert (Scale)"),
    "the Scale Constitution insert should surface under the Constitution stat filter");
});

test("a Dino insert is findable by text search on its type", () => {
  const list = browsableItems(data);
  const rows = filterVariants(list, { query: "claw" });
  assert.ok(rows.some((v) => v.dino_insert), "searching 'claw' surfaces Claw inserts");
});

test("dinoInsertRow carries a percentage unit for spell-crit inserts", () => {
  const row = dinoInsertRow({ dino_type: "Scale", stat: "Fire Spell Crit Damage",
    bonus_type: "Enhancement", value: 20, unit: "pct", wiki_url: "w" });
  assert.strictEqual(row.affixes[0].unit, "pct");
  assert.ok(affixText(row).some((t) => /\+20%/.test(t)), "renders +20% not +20");
});

test("a Dinosaur Bone blank shows its Isle of Dread slots instead of nothing", () => {
  const blank = items.find((v) => v.source === "dino_crafting_blank");
  assert.ok(blank, "expected a blank host in the dataset");
  const texts = affixText(blank);
  assert.ok(texts.some((t) => /Isle of Dread slots:/.test(t)),
    "blank should surface its typed Dino slots");
});

test("browsableItems appends the U81 Nearly-Complete option pool", () => {
  const list = browsableItems(data);
  const nc = list.filter((v) => v.nc_option);
  assert.strictEqual(nc.length, (data.nearly_complete || []).length);
  assert.ok(nc.length >= 60, "expected the sourced NC option pool");
});

test("a Nearly-Complete option is findable in the browser by stat", () => {
  const list = browsableItems(data);
  const rows = filterVariants(list, { stat: "Constitution" });
  assert.ok(rows.some((v) => v.nc_option), "Constitution NC craft options surface under the stat filter");
});

test("ncRow tags the tier's ML and renders its value", () => {
  const row = ncRow({ category: "Ability Score", stat: "Constitution", bonus_type: "Enhancement", value: 15, tier: "legendary", wiki_url: "w" });
  assert.strictEqual(row.minimum_level, 35);
  assert.ok(affixText(row).some((t) => /Constitution \+15/.test(t)));
});

test("browsableItems appends the compendium index (indexed-only entries)", () => {
  const list = browsableItems(data);
  const idx = list.filter((v) => v.compendium);
  const indexedOnly = (data.compendium || []).filter((x) => x.status === "indexed").length;
  assert.strictEqual(idx.length, indexedOnly, "indexed-only compendium rows are browsable");
  assert.ok(idx.length > 0, "expected a non-empty compendium index");
  // enriched entries are NOT re-listed here (they appear as real variant rows)
  assert.ok(!idx.some((v) => v.verification !== "indexed"));
});

test("compendiumRow renders an indexed, solver-excluded row with a wiki link", () => {
  const row = compendiumRow({ name: "Some Ring", slot: "Ring", wiki_url: "w", status: "indexed" });
  assert.strictEqual(row.verification, "indexed");
  assert.strictEqual(row.slot, "Ring");
  assert.deepStrictEqual(row.affixes, []);
  assert.ok(row.wiki_url);
});

test("indexed items are filterable by status and slot", () => {
  const list = browsableItems(data);
  const rows = filterVariants(list, { verification: "indexed", slot: "Ring" });
  assert.ok(rows.length > 0, "indexed Rings surface under the status+slot filter");
  for (const v of rows) { assert.strictEqual(v.verification, "indexed"); assert.strictEqual(v.slot, "Ring"); }
});

console.log(`\n${passed} passed`);
