// U5 browse-filter tests (node, zero-dependency). Run: node tests/browse.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { filterVariants, variantStats, affixText, dinoInsertRow, ncRow, vikRow, compendiumRow, browsableItems } = require("../web/browse.js");
const { normalizeDataset } = require("../web/dataset.js");
const data = normalizeDataset(JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8")
));
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

test("U4: affixText renders a boolean feature as presence, not a magnitude", () => {
  const v = { affixes: [
    { stat: "Salt", bonus_type: "boolean", value: 1, unit: "flat" },
    { stat: "Intelligence", bonus_type: "Enhancement", value: 10, unit: "flat" },
  ] };
  const parts = affixText(v);
  assert.ok(parts.includes("✓ Salt"), "boolean rendered as presence marker");
  assert.ok(!parts.some((p) => /Salt \+/.test(p)), "no '+N' magnitude for the boolean");
  assert.ok(parts.some((p) => p.includes("Intelligence +10")), "real magnitude still shown");
});

test("U5: affixText / variantStats read NATIVE {name,type} affixes and item `ml`", () => {
  // A live item affix is native ({name,type}); the ML filter reads native `ml`.
  const v = { ml: 30, affixes: [
    { name: "Salt", type: "boolean", value: 1, unit: "flat" },
    { name: "Constitution", type: "Insightful", value: 7, unit: "flat" },
  ] };
  const parts = affixText(v);
  assert.ok(parts.includes("✓ Salt"), "native boolean rendered as presence");
  assert.ok(parts.some((p) => p.includes("Constitution +7 Insightful")), "native name+type render");
  assert.deepStrictEqual(variantStats(v).sort(), ["Constitution", "Salt"], "variantStats reads native names");
  // filter by native `ml` (item carries no legacy minimum_level)
  assert.strictEqual(filterVariants([v], { maxMl: 34 }).length, 1);
  assert.strictEqual(filterVariants([v], { maxMl: 20 }).length, 0);
});

test("ML filter returns only variants at or below the cap", () => {
  const rows = filterVariants(items, { maxMl: 10 });
  assert.ok(rows.length > 0);
  for (const v of rows) assert.ok(Number(v.ml) <= 10);   // U5: native item-level ML
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
  const vik = (data.viktranium || []).length;
  const comp = (data.compendium || []).filter((x) => x.status === "indexed").length;
  assert.strictEqual(list.length, items.length + inserts.length + nc + vik + comp);
});

test("a Dino insert is findable in the browser by stat", () => {
  const list = browsableItems(data);
  const rows = filterVariants(list, { stat: "Constitution" });
  assert.ok(rows.some((v) => v.dino_insert && /^Dinosaur Bone augment \(Scale\b/.test(v.slot)),
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
  // U5: pseudo-rows now carry native item-level `ml` (was legacy `minimum_level`).
  assert.strictEqual(row.ml, 35);
  assert.ok(affixText(row).some((t) => /Constitution \+15/.test(t)));
});

test("browsableItems appends the U81 Viktranium option pool", () => {
  const list = browsableItems(data);
  const vik = list.filter((v) => v.vik_option);
  assert.strictEqual(vik.length, (data.viktranium || []).length);
  assert.ok(vik.length >= 100, "expected the sourced Viktranium option pool");
});

test("a Viktranium option is findable in the browser by stat", () => {
  const list = browsableItems(data);
  const rows = filterVariants(list, { stat: "Charisma" });
  assert.ok(rows.some((v) => v.vik_option), "Charisma Lamordia craft options surface under the stat filter");
});

test("vikRow tags the tier's ML, keys the pool, and renders its value", () => {
  const row = vikRow({ slot_type: "Melancholic", category: "Accessory", stat: "Charisma", bonus_type: "Enhancement", value: 15, tier: "legendary", wiki_url: "w" });
  // U5: pseudo-rows now carry native item-level `ml` (was legacy `minimum_level`).
  assert.strictEqual(row.ml, 34);
  assert.ok(/Melancholic/.test(row.slot) && /Accessory/.test(row.slot), "slot names the (type, category) pool");
  assert.ok(affixText(row).some((t) => /Charisma \+15/.test(t)));
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
