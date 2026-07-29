// U5 — Trove import pure helpers. Run: node tests/import.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  splitCsvLine, parseTroveCsv, ownedMatch, filterItemsToOwned, USED_COLUMNS,
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

test("ownedMatch discloses matched vs unrecognized (R11, AE5)", () => {
  const { ownedNames } = parseTroveCsv(sampleCsv);
  const items = [
    { name: "Legendary Collar of the Unbroken" },
    { name: "Ring of Fire, Lesser" },
    { name: "Docent of Gravity" },
    { name: "An Item The Player Does Not Own" },
  ];
  const m = ownedMatch(ownedNames, items);
  assert.strictEqual(m.ownedCount, 4);        // 4 distinct owned names
  assert.strictEqual(m.matched, 3);           // 3 exist in the dataset
  assert.strictEqual(m.unrecognized, 1);      // "Some Item Not In Dataset"
});

test("filterItemsToOwned keeps only owned base items (R13/KTD4)", () => {
  const ownedNames = new Set(["Docent of Gravity", "Ring of Fire, Lesser"]);
  const items = [
    { name: "Docent of Gravity", slot: "Armor" },
    { name: "Ring of Fire, Lesser", slot: "Ring" },
    { name: "Unowned Helm", slot: "Helmet" },
  ];
  const owned = filterItemsToOwned(items, ownedNames);
  assert.strictEqual(owned.length, 2);
  assert.ok(!owned.some((v) => v.name === "Unowned Helm"));
});

console.log(`\n${passed} passed`);
