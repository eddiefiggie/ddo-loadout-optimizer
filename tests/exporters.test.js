// U12 — Markdown + CSV loadout exporters. Run: node tests/exporters.test.js
const assert = require("assert");
const { toMarkdown, toCsv, toPrintHtml, toBBCode, setBonusDetail, bbEsc, csvSafe, constraintLines } = require("../web/exporters.js");

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e.message}`); process.exitCode = 1; }
}

const rec = {
  name: "Sook - Reaper",
  inputs: {
    ml: 34, race: "Human", alignment: "Lawful Good", armor: "light", oath: "druid",
    style: "one-hand", weaponTypes: ["Long Swords", "Rapiers"], offHand: ["Tower shields", "empty"],
    offHandWeapons: ["Short Swords"],
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

// The `rec` fixture above is intentionally LEGACY-shaped ({stat,bonus_type},
// minimum_level) — it exercises the exporter's fallback path, i.e. a pre-overhaul
// persisted snapshot. This test proves the migrated NATIVE primary path: item
// affixes as {name,type} and item-level `ml`, which is what a current save embeds.
test("U5: exporters read NATIVE {name,type} affixes and item `ml`", () => {
  const nativeRec = {
    name: "Native Build",
    inputs: { ml: 34, race: "Elf", pool: "all", priorities: ["Constitution"] },
    snapshot: {
      status: "optimal",
      chosen: [
        { slot: "Armor", variant: { variant_id: "Native Vest", ml: 30,
          affixes: [{ name: "Constitution", type: "Insightful", value: 7 }, { name: "PRR", value: 15 }] } },
      ],
      setsActive: [],
    },
  };
  const md = toMarkdown(nativeRec);
  assert.ok(/Constitution \+7 Insightful/.test(md), "native affix name+type render");
  assert.ok(/PRR \+15/.test(md));
  assert.ok(/ML 30/.test(md), "native item `ml` renders");
  const csv = toCsv(nativeRec);
  assert.ok(/Armor,Native Vest,30/.test(csv), "native `ml` in the CSV table");
});

test("constraintLines carry the character name + all constraints", () => {
  const lines = constraintLines(rec);
  const joined = lines.join("\n");
  assert.ok(/Sook - Reaper/.test(joined));
  assert.ok(/ML 34|34/.test(joined));
  assert.ok(/Human/.test(joined));
  assert.ok(/Constitution/.test(joined));
});

// ---- U5 — combat-style / weapon-type / off-hand / oath in exports ----------
test("U5: exports surface style/weapon-type/off-hand/oath constraints", () => {
  const lines = constraintLines(rec).join("\n");
  assert.ok(/Weapon: One-hand \/ Dual-wield: Long Swords, Rapiers/.test(lines), "weapon style+types line");
  assert.ok(/Off hand: Tower shields, Empty/.test(lines), "off-hand allow-set with Empty");
  assert.ok(/Off-hand weapon: Short Swords/.test(lines), "TWF off-hand weapon line");
  assert.ok(/Oath: Druid/.test(lines), "oath line");
  // every format inherits the constraints via the shared header (BBCode too, once
  // its exporter from PR #76 lands — it reads the same constraintPairs).
  assert.ok(/Long Swords/.test(toMarkdown(rec)), "markdown header");
  assert.ok(/Short Swords/.test(toCsv(rec)), "csv preamble includes off-hand weapon");
  assert.ok(/Druid/.test(toPrintHtml(rec)), "print header");
});

test("U5: an unconstrained build omits the weapon/off-hand/oath lines", () => {
  const plain = { name: "Plain", inputs: { ml: 30, race: "Elf", pool: "all", priorities: ["Wisdom"] },
    snapshot: { status: "optimal", chosen: [], setsActive: [] } };
  const lines = constraintLines(plain).join("\n");
  assert.ok(!/Weapon:/.test(lines) && !/Off hand:/.test(lines) && !/Oath:/.test(lines),
    "no empty constraint lines for an unconstrained build");
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

test("markdown escapes link/emphasis metacharacters in names (no injected link)", () => {
  const evil = { ...rec, name: "[Free points](https://evil.example)" };
  const md = toMarkdown(evil);
  assert.ok(!/\[Free points\]\(https/.test(md), "markdown link injected via name");
  assert.ok(/\\\[Free points\\\]/.test(md), "link brackets not backslash-escaped");
});

test("toPrintHtml renders name + constraints + loadout table, escaping markup", () => {
  const h = toPrintHtml(rec);
  assert.ok(/<h1>Sook - Reaper<\/h1>/.test(h));
  assert.ok(/<table>/.test(h) && /<td>Armor<\/td>/.test(h));
  assert.ok(/Legendary Gravekeeper/.test(h));   // apostrophe is html-escaped to &#39;
  const evil = toPrintHtml({ ...rec, name: "<script>x</script>" });
  assert.ok(!/<script>x/.test(evil), "raw script leaked into print html");
});

// ---- set-bonus analysis + BBCode -------------------------------------------

// A build with a completed set: two members carry set_bonus, and a parsed tier
// grants concrete affixes at 2 pieces.
const setRec = {
  name: "Tank",
  inputs: { ml: 34, race: "Dwarf", pool: "all", priorities: ["Constitution"] },
  snapshot: {
    status: "optimal",
    setsActive: [{ set: "Legendary Kundarak Delving Boots", pieces_required: 2 }],
    chosen: [
      { slot: "Boots", variant: { variant_id: "Delving Boots", ml: 34,
        affixes: [{ name: "Constitution", type: "Insight", value: 6 }],
        set_bonus: [{ set: "Legendary Kundarak Delving Boots" }],
        parsed_set_bonuses: [{ set: "Legendary Kundarak Delving Boots", pieces_required: 2,
          affixes: [{ name: "Physical Sheltering", type: "Enhancement", value: 20 }, { name: "Fortification", value: 30, unit: "pct" }] }] } },
      { slot: "Gloves", variant: { variant_id: "Delving Gloves", ml: 34, affixes: [],
        set_bonus: [{ set: "Legendary Kundarak Delving Boots" }],
        parsed_set_bonuses: [{ set: "Legendary Kundarak Delving Boots", pieces_required: 2, affixes: [] }] } },
    ],
  },
};

test("set-bonus analysis: exports include the ACTUAL affixes a set grants", () => {
  const detail = setBonusDetail(setRec);
  assert.strictEqual(detail.length, 1, "one active set");
  assert.strictEqual(detail[0].pieces, 2);
  assert.deepStrictEqual(detail[0].affixes, ["Physical Sheltering +20", "Fortification +30%"]);
  // and each format surfaces the granted affixes, not just the set name
  const md = toMarkdown(setRec);
  assert.ok(/Set bonuses/.test(md) && /Physical Sheltering \+20/.test(md), "markdown lists granted affixes");
  const csv = toCsv(setRec);
  assert.ok(/Set bonus,Pieces,Grants/.test(csv) && /Physical Sheltering \+20/.test(csv), "csv has a set-bonus section");
  assert.ok(/Physical Sheltering \+20/.test(toPrintHtml(setRec)), "print includes granted affixes");
});

test("BBCode export: forum-ready structure + set-bonus affixes", () => {
  const bb = toBBCode(setRec);
  assert.ok(bb.startsWith("[b]Tank[/b]"), "title in bold");
  assert.ok(/\[b\]Loadout\[\/b\]\n\[list\]/.test(bb), "loadout list block");
  assert.ok(/\[\*\]\[b\]Boots\[\/b\] — Delving Boots/.test(bb), "a loadout row");
  assert.ok(/\[b\]Set bonuses\[\/b\]/.test(bb) && /Physical Sheltering \+20/.test(bb), "set bonuses with affixes");
  assert.ok(/\[\/list\]/.test(bb), "closes the list");
});

test("BBCode export: bbEsc strips brackets so a name can't inject forum tags", () => {
  assert.strictEqual(bbEsc("[url=x]evil[/url]"), "url=xevil/url");
  const bb = toBBCode({ ...setRec, name: "[b]Pwn[/b]" });
  assert.ok(bb.startsWith("[b]bPwn/b[/b]"), "the injected tags are neutralized inside the title");
});

if (!process.exitCode) console.log(`\n${passed} passed`);
