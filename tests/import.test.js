// U5 — Trove import pure helpers. Run: node tests/import.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  splitCsvLine, parseTroveCsv, ownedMatch, filterItemsToOwned, itemName, USED_COLUMNS,
  ownedHasCatalogName, singularCandidates,
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

test("parseTroveCsv handles CRLF line endings (real Windows Trove exports)", () => {
  const crlf = 'Name,Quantity,Binding\r\n"Cloak of Night",1,BtA\r\n"Ring of Fire",2,BtC\r\n';
  const { ownedNames, quantities, rowCount } = parseTroveCsv(crlf);
  assert.strictEqual(rowCount, 2);
  assert.ok(ownedNames.has("Cloak of Night")); // no trailing \r on the name
  assert.strictEqual(quantities.get("Ring of Fire"), 2); // no \r corrupting the last column
});

test("parseTroveCsv skips a row with an empty Name and does not inflate rowCount", () => {
  const csv = 'Name,Quantity\n"Real Item",1\n,3\n';
  const { ownedNames, rowCount } = parseTroveCsv(csv);
  assert.strictEqual(rowCount, 1);
  assert.deepStrictEqual([...ownedNames], ["Real Item"]);
});

test("parseTroveCsv accepts a header-only file (zero rows, no throw)", () => {
  const { ownedNames, rowCount } = parseTroveCsv("Name,Quantity,Binding\n");
  assert.strictEqual(rowCount, 0);
  assert.strictEqual(ownedNames.size, 0);
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

test("U5: owned filter retains an artifact-flagged variant with its dataset stats", () => {
  // R5: the Trove supplies identity only; an owned Artifact must resolve to its
  // dataset variant (stats + artifact flag intact), never be filtered out.
  const ownedNames = new Set(["Legendary Epic Artifact"]);
  const items = [{
    source_item: "Legendary Epic Artifact", variant_id: "Legendary Epic Artifact",
    slot: "Trinket", artifact: true,
    affixes: [{ stat: "Constitution", bonus_type: "Enhancement", value: 20, unit: "flat" }],
  }];
  const owned = filterItemsToOwned(items, ownedNames);
  assert.strictEqual(owned.length, 1, "the owned Artifact is retained");
  assert.strictEqual(owned[0].artifact, true, "artifact flag preserved");
  assert.strictEqual(owned[0].affixes[0].value, 20, "stats come from the dataset variant");
});

test("U5: owned filter retains a boolean-only-eligible variant", () => {
  // An item whose only eligible content is a boolean presence affix must still
  // match by source_item and stay in the owned pool.
  const ownedNames = new Set(["Salt Guard Cloak"]);
  const items = [{
    source_item: "Salt Guard Cloak", variant_id: "Salt Guard Cloak", slot: "Cloak",
    affixes: [{ stat: "Salt", bonus_type: "boolean", value: 1, unit: "flat" }],
  }];
  const owned = filterItemsToOwned(items, ownedNames);
  assert.strictEqual(owned.length, 1, "the boolean-only item is retained");
  assert.strictEqual(owned[0].affixes[0].bonus_type, "boolean");
});

console.log(`\n${passed} passed`);


// --- #408: stacked-item plurals -------------------------------------------
//
// Trove writes a STACKED item's name in the plural while the catalog stores the
// singular, so a player who owns TWO of something had it silently dropped — in
// the one mode whose promise is "only what I have". Every name this recovered in
// a real export is an augment, which is what made it load-bearing once #359
// shipped owned-augment mode.

test("#408: a stacked plural matches its singular catalog name", () => {
  const owned = new Set(["Solar Gems of Constitution (Legendary)", "Rubies of Acid (4d6)"]);
  assert.strictEqual(ownedHasCatalogName(owned, "Solar Gem of Constitution (Legendary)"), true);
  assert.strictEqual(ownedHasCatalogName(owned, "Ruby of Acid (4d6)"), true);
});

test("#408: an exact name still matches, and a near-miss does not", () => {
  const owned = new Set(["Ruby of Flame (2d6)", "Bolts"]);
  assert.strictEqual(ownedHasCatalogName(owned, "Ruby of Flame (2d6)"), true, "exact match unaffected");
  // The guard against a blanket trailing-`s` singularizer: `Bolts` must NOT
  // manufacture a match for `Bolt`. Each plural rule is a specific head-noun.
  assert.strictEqual(ownedHasCatalogName(owned, "Bolt"), false);
  assert.strictEqual(ownedHasCatalogName(owned, "Ruby of Frost (2d6)"), false);
});

test("#408: singularCandidates is conservative, never a general singularizer", () => {
  assert.deepStrictEqual(singularCandidates("Solar Gems of Constitution (Legendary)"),
    ["Solar Gem of Constitution (Legendary)"]);
  assert.deepStrictEqual(singularCandidates("Bolts"), [], "no blanket trailing-s rule");
  assert.deepStrictEqual(singularCandidates("Glorious Dawn"), []);
});

test("#408: the disclosure and the pool agree about what 'owned' means", () => {
  // The bug class this prevents: a name counted as matched in the import
  // disclosure while being dropped from the solver's pool, or the reverse.
  const items = [
    { source_item: "Solar Gem of Constitution (Legendary)", category: "augment" },
    { source_item: "Ruby of Flame (2d6)", category: "augment" },
    { source_item: "Not Owned", category: "item" },
  ];
  const owned = new Set(["Solar Gems of Constitution (Legendary)", "Ruby of Flame (2d6)"]);
  const kept = filterItemsToOwned(items, owned).map((v) => v.source_item);
  const m = ownedMatch(owned, items);
  assert.deepStrictEqual(kept.sort(),
    ["Ruby of Flame (2d6)", "Solar Gem of Constitution (Legendary)"]);
  assert.strictEqual(m.matched, 2, "both count as matched in the disclosure too");
  assert.strictEqual(m.matched, kept.length, "disclosure and pool cannot disagree");
});
