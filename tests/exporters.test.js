// U12 — Markdown + CSV loadout exporters. Run: node tests/exporters.test.js
const assert = require("assert");
const { toMarkdown, toCsv, csvSafe, constraintLines } = require("../web/exporters.js");

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e.message}`); process.exitCode = 1; }
}

const rec = {
  name: "Sook - Reaper",
  inputs: {
    ml: 34, race: "Human", alignment: "Lawful Good", armor: "light", weapon: "2h",
    pool: "all", priorities: ["Constitution", "Dodge"],
  },
  snapshot: {
    status: "optimal",
    chosen: [
      { slot: "Armor", variant: { variant_id: "Legendary Gravekeeper's Vest", minimum_level: 34,
        affixes: [{ stat: "Constitution", bonus_type: "Insightful", value: 7 }, { stat: "PRR", value: 15 }],
        augment_slots_norm: { colors: ["Green", "Colorless"] } } },
      { slot: "Cloak", variant: { variant_id: "Page Regalia", minimum_level: 32,
        affixes: [{ stat: "Dodge", value: 5 }], augment_slots_norm: { colors: [] } } },
    ],
    setsActive: [],
  },
  stampedBuildId: "abc123",
};

test("constraintLines carry the character name + all constraints", () => {
  const lines = constraintLines(rec);
  const joined = lines.join("\n");
  assert.ok(/Sook - Reaper/.test(joined));
  assert.ok(/ML 34|34/.test(joined));
  assert.ok(/Human/.test(joined));
  assert.ok(/Constitution/.test(joined));
});

test("toMarkdown has a name heading, a constraints header, and per-slot loadout", () => {
  const md = toMarkdown(rec);
  assert.ok(md.startsWith("# Sook - Reaper"), md.slice(0, 40));
  assert.ok(/Constitution/.test(md));       // priorities in header
  assert.ok(/Armor/.test(md) && /Legendary Gravekeeper's Vest/.test(md));  // loadout
  assert.ok(/PRR \+15/.test(md));           // affix formatting
  assert.ok(/ML 34/.test(md));
});

test("toCsv emits a name+constraints preamble then a loadout table", () => {
  const csv = toCsv(rec);
  const lines = csv.split("\n");
  assert.ok(csv.includes("Sook - Reaper"));
  assert.ok(/^Slot,Item,ML/m.test(csv));   // table header row
  assert.ok(/Armor,Legendary Gravekeeper's Vest,34/.test(csv));
});

test("csvSafe neutralizes spreadsheet formula injection", () => {
  assert.strictEqual(csvSafe("=1+1"), "'=1+1");
  assert.strictEqual(csvSafe("+cmd"), "'+cmd");
  assert.strictEqual(csvSafe("-2"), "'-2");
  assert.strictEqual(csvSafe("@SUM"), "'@SUM");
  assert.strictEqual(csvSafe("\tx"), "'\tx");
  assert.strictEqual(csvSafe("normal"), "normal");
  // quoting for commas/quotes
  assert.strictEqual(csvSafe('a,b'), '"a,b"');
  assert.strictEqual(csvSafe('he said "hi"'), '"he said ""hi"""');
});

test("a formula-injecting character name is neutralized in the CSV", () => {
  const evil = { ...rec, name: "=HYPERLINK(0)", inputs: { ...rec.inputs } };
  const csv = toCsv(evil);
  assert.ok(csv.includes("'=HYPERLINK(0)"), "formula name not neutralized");
  assert.ok(!/(^|,)=HYPERLINK/m.test(csv), "raw formula leaked");
});

test("markdown escapes a markup-bearing name (no raw tag)", () => {
  const evil = { ...rec, name: "<img src=x onerror=alert(1)>" };
  const md = toMarkdown(evil);
  assert.ok(!/<img /.test(md), "raw markup leaked into markdown");
});

if (!process.exitCode) console.log(`\n${passed} passed`);
