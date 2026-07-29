// U5 — Trove import pure helpers. Run: node tests/import.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  splitCsvLine, parseTroveCsv, ownedMatch, filterItemsToOwned, itemName, USED_COLUMNS,
} = require("../web/import.js");

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n  ${e.message}`); process.exitCode = 1; }
}

const sampleCsv = fs.readFileSync(
  path.join(__dirname, "fixtures", "trove-sample.csv"), "utf8");

test("splitCsvLine keeps quoted commas inside one field", () => {
  const f = splitCsvLine('a,"b, still b",c');
  assert.deepStrictEqual(f, ["a", "b, still b", "c"]);
});

test("splitCsvLine collapses escaped double-quotes", () => {
  assert.deepStrictEqual(splitCsvLine('"say ""hi""",x'), ['say "hi"', "x"]);
});

test("parseTroveCsv reads owned names, incl. a comma-in-name item", () => {
  const { ownedNames, rowCount } = parseTroveCsv(sampleCsv);
  assert.strictEqual(rowCount, 4);
  assert.ok(ownedNames.has("Legendary Collar of the Unbroken"));
  assert.ok(ownedNames.has("Ring of Fire, Lesser")); // comma-in-name survived
  assert.ok(ownedNames.has("Docent of Gravity"));
});

test("parseTroveCsv NEVER surfaces SubscriptionHash or Character (R12)", () => {
  const result = parseTroveCsv(sampleCsv);
  const blob = JSON.stringify({
    names: [...result.ownedNames],
    quantities: [...result.quantities],
    columns: result.columns,
  });
  assert.ok(!/FAKEHASH/.test(blob), "SubscriptionHash leaked into parsed output");
  assert.ok(!/Testchar/.test(blob), "Character name leaked into parsed output");
  // and the reported columns are only the ones the optimizer is allowed to use
  result.columns.forEach((c) => assert.ok(USED_COLUMNS.includes(c)));
  assert.ok(!result.columns.includes("subscriptionhash"));
  assert.ok(!result.columns.includes("character"));
});

test("parseTroveCsv sums quantity per name", () => {
  const { quantities } = parseTroveCsv(sampleCsv);
  assert.strictEqual(quantities.get("Ring of Fire, Lesser"), 2);
  assert.strictEqual(quantities.get("Legendary Collar of the Unbroken"), 1);
});

test("parseTroveCsv rejects a file with no Name column (R10)", () => {
  assert.throws(() => parseTroveCsv("foo,bar\n1,2\n"), /Not a Trove export/);
  assert.throws(() => parseTroveCsv(""), /Empty file/);
});

test("itemName matches on source_item (the real dataset identity, not .name)", () => {
  assert.strictEqual(itemName({ source_item: "Saltiron Docent", variant_id: "Saltiron Docent" }), "Saltiron Docent");
  assert.strictEqual(itemName({ variant_id: "Foo (Legendary)" }), "Foo (Legendary)");
});

test("ownedMatch discloses matched vs unrecognized against real variant shape (R11, AE5)", () => {
  const { ownedNames } = parseTroveCsv(sampleCsv);
  // real variants carry source_item, NOT name
  const items = [
    { source_item: "Legendary Collar of the Unbroken", variant_id: "Legendary Collar of the Unbroken" },
    { source_item: "Ring of Fire, Lesser", variant_id: "Ring of Fire, Lesser" },
    { source_item: "Docent of Gravity", variant_id: "Docent of Gravity" },
    { source_item: "An Item The Player Does Not Own", variant_id: "x" },
  ];
  const m = ownedMatch(ownedNames, items);
  assert.strictEqual(m.ownedCount, 4);        // 4 distinct owned names
  assert.strictEqual(m.matched, 3);           // 3 exist in the dataset by source_item
  assert.strictEqual(m.unrecognized, 1);      // "Some Item Not In Dataset"
});

test("filterItemsToOwned keeps all variants of an owned base item (R13/KTD4)", () => {
  const ownedNames = new Set(["Docent of Gravity", "Ring of Fire, Lesser"]);
  const items = [
    { source_item: "Docent of Gravity", variant_id: "Docent of Gravity", slot: "Armor" },
    { source_item: "Ring of Fire, Lesser", variant_id: "Ring of Fire, Lesser (Legendary)", slot: "Ring" },
    { source_item: "Unowned Helm", variant_id: "Unowned Helm", slot: "Helmet" },
  ];
  const owned = filterItemsToOwned(items, ownedNames);
  assert.strictEqual(owned.length, 2);
  assert.ok(!owned.some((v) => itemName(v) === "Unowned Helm"));
});

console.log(`\n${passed} passed`);
