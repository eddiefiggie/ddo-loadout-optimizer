// U12 — Markdown + CSV loadout exporters. Run: node tests/exporters.test.js
const assert = require("assert");
const { toMarkdown, toCsv, toPrintHtml, toBBCode, toPortableJSON, setBonusDetail, bbEsc, csvSafe, constraintLines } = require("../web/exporters.js");

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

// A rich record exercising the new universal content: a colored augment, a Lunar
// augment, a Viktranium craft, a completed set, and a capped priority stat.
const richRec = {
  name: "Nightshade",
  stampedBuildId: "08032026.1",
  inputs: { ml: 32, race: "Elf", armor: "light", pool: "all", priorities: ["Deadly", "Dodge"] },
  snapshot: {
    status: "optimal",
    chosen: [
      { slot: "Goggles", variant: { variant_id: "Epic Spectacles", ml: 32,
        affixes: [{ name: "Deadly", type: "Insightful", value: 9 }],
        augment_slots_norm: { colors: ["red", "yellow"] },
        set_bonus: [{ set: "Vol Set" }],
        parsed_set_bonuses: [{ set: "Vol Set", pieces_required: 3, affixes: [{ name: "Wizardry", type: "Enhancement", value: 150 }] }] } },
      { slot: "Ring", variant: { variant_id: "Moon Ring", ml: 30,
        affixes: [{ name: "Dodge", type: "Enhancement", value: 5, unit: "pct" }], augment_slots_norm: { colors: ["blue"] },
        set_bonus: [{ set: "Vol Set" }],
        parsed_set_bonuses: [{ set: "Vol Set", pieces_required: 3, affixes: [{ name: "Wizardry", type: "Enhancement", value: 150 }] }] } },
      { slot: "Trinket", variant: { variant_id: "Vol Amulet", ml: 30, affixes: [],
        set_bonus: [{ set: "Vol Set" }],
        parsed_set_bonuses: [{ set: "Vol Set", pieces_required: 3, affixes: [{ name: "Wizardry", type: "Enhancement", value: 150 }] }] } },
    ],
    effective: { Deadly: 21, Dodge: 20 },
    capped: { Dodge: 20 },
    breakdown: {
      Deadly: [
        { bonus_type: "Insightful", value: 9, source: "Epic Spectacles", sourceKind: "worn", slot: "Goggles", hostIds: ["Epic Spectacles"] },
        { bonus_type: "Insight", value: 9, source: "Deadly Aug", sourceKind: "augment" },
        { bonus_type: "Set", value: 3, source: "Vol Set", sourceKind: "set", setYieldingSlots: ["Goggles", "Ring", "Trinket"] },
      ],
      Dodge: [
        { bonus_type: "Enhancement", value: 15, source: "Moon Ring", sourceKind: "worn", slot: "Ring", hostIds: ["Moon Ring"] },
        { bonus_type: "Quality", value: 10, source: "Dodge Aug", sourceKind: "augment" },
      ],
    },
    augmentsPlaced: [
      { variant_id: "Deadly Aug", color: "red", slot_color: "red", affixes: [{ name: "Deadly", type: "Insight", value: 9 }] },
      { variant_id: "Lunar Insight Aug", color: "yellow", slot_color: "yellow", affixes: [{ name: "Insightful Constitution", type: "Insight", value: 4 }] },
      { variant_id: "Dodge Aug", color: "blue", slot_color: "blue", affixes: [{ name: "Dodge", type: "Quality", value: 10, unit: "pct" }] },
    ],
    setsActive: [],
    dinoPlaced: [], ncPlaced: [], rollPlaced: [],
    vikPlaced: [{ item: "Epic Spectacles", stat: "Resistance", bonus_type: "Enhancement", value: 3, slot_type: "Melancholic" }],
    sealPlaced: [], tfPlaced: [], gsPlaced: [], jokerPlaced: [], membershipPlaced: [],
  },
};

test("AE1: an item's Red augment, Lunar augment, and Viktranium craft are all cued in every format", () => {
  const md = toMarkdown(richRec);
  assert.ok(/🔴 Red:/.test(md), "MD cues the Red augment");
  assert.ok(/🌙 Lunar/.test(md), "MD cues the Lunar augment");
  assert.ok(/⚗️ Viktranium:/.test(md), "MD cues the Viktranium craft");
  const bb = toBBCode(richRec);
  assert.ok(/🔴 \[color=red\]Red\[\/color\]/.test(bb), "BBCode wraps the color word in a real [color] tag");
  assert.ok(/🌙 Lunar/.test(bb), "BBCode cues Lunar");
  const csv = toCsv(richRec);
  assert.ok(/🔴 Red:/.test(csv) && /⚗️ Viktranium:/.test(csv), "CSV carries the same cued content");
  const html = toPrintHtml(richRec);
  assert.ok(/🔴 Red:/.test(html) && /⚗️ Viktranium:/.test(html), "print carries the same cued content");
});

test("AE2/AE3: the stat breakdown attributes each priority and shows the cap when clamped", () => {
  const md = toMarkdown(richRec);
  assert.ok(/## Stat breakdown/.test(md), "there is a stat-breakdown section");
  assert.ok(/\*\*Deadly\*\* → \+21/.test(md), "Deadly total equals its effective value");
  assert.ok(/\*\*Dodge\*\* → \+20 \(capped at 20 · raw 25\)/.test(md), "Dodge shows the cap and the raw sum");
  const csv = toCsv(richRec);
  assert.ok(/Stat,Total,Capped,Sources/.test(csv), "CSV has a stat-breakdown section");
  assert.ok(/Dodge,20,capped at 20 \(raw 25\)/.test(csv), "CSV encodes the cap");
});

test("AE4: all four text formats + the portable JSON render the same items, augments, crafts, sets, stats", () => {
  const md = toMarkdown(richRec), bb = toBBCode(richRec), csv = toCsv(richRec), html = toPrintHtml(richRec);
  const resolved = toPortableJSON(richRec).resolved;
  // Every format names every equipped item and the set, and the JSON resolved view agrees.
  for (const s of [md, bb, csv, html]) {
    for (const item of ["Epic Spectacles", "Moon Ring", "Vol Amulet"]) assert.ok(s.includes(item), `format includes ${item}`);
    assert.ok(s.includes("Vol Set"), "format names the completed set");
    assert.ok(s.includes("Deadly Aug") && s.includes("Lunar Insight Aug"), "format names both augments");
  }
  assert.deepStrictEqual(resolved.loadout.map((i) => i.item), ["Epic Spectacles", "Moon Ring", "Vol Amulet"]);
  assert.deepStrictEqual(Object.keys(resolved.attribution), ["Deadly", "Dodge"]);
  assert.strictEqual(resolved.sets[0].set, "Vol Set");
});

test("R7/AE2: each priority stat's sources render with their value AND bonus type", () => {
  const md = toMarkdown(richRec);
  assert.ok(/Insightful \+9 — Epic Spectacles/.test(md), "worn source line carries type + signed value + source");
  assert.ok(/Set \+3 — Vol Set \(set\)/.test(md), "set source line is tagged (set)");
  const bb = toBBCode(richRec);
  assert.ok(/Quality \+10 — Dodge Aug/.test(bb), "BBCode renders the same attributed source lines");
});

test("R12: no CSV cell begins with a raw spreadsheet formula, across old and new columns", () => {
  const evil = JSON.parse(JSON.stringify(richRec));
  // New-column content (augment name, source name) is always cue/type-prefixed, so a
  // formula there is inert mid-cell; the item name is the reachable cell-start path.
  evil.snapshot.augmentsPlaced[0].variant_id = "=cmd|'/c calc'!A1";   // Augments cell (mid, after cue)
  evil.snapshot.breakdown.Deadly[0].source = "@SUM(A1)";             // Sources cell (mid, after type)
  evil.snapshot.chosen[0].variant.variant_id = "=HYPERLINK(2)";      // Item cell (cell start)
  const csv = toCsv(evil);
  for (const line of csv.split("\n")) {
    for (const cell of line.split(",")) {
      assert.ok(!/^[=+@]/.test(cell.replace(/^"/, "")), `no cell begins with a raw formula: ${cell.slice(0, 20)}`);
    }
  }
  assert.ok(/'=HYPERLINK\(2\)/.test(csv), "the formula-injecting item name is quote-neutralized at cell start");
});

test("R12: BBCode strips bracket tags injected via the new augment/craft/source content", () => {
  const evil = JSON.parse(JSON.stringify(richRec));
  evil.snapshot.augmentsPlaced[0].variant_id = "[url=x]evil[/url]";
  evil.snapshot.vikPlaced[0].stat = "[b]pwn[/b]";
  evil.snapshot.breakdown.Deadly[0].source = "[img]x[/img]";
  const bb = toBBCode(evil);
  assert.ok(!/\[url=x\]evil\[\/url\]/.test(bb), "augment name tags stripped");
  assert.ok(!/\[b\]pwn\[\/b\]/.test(bb), "craft label tags stripped");
  assert.ok(!/\[img\]x\[\/img\]/.test(bb), "source tags stripped");
});

test("Solar augment is cued (the ☀️ branch of the Lunar/Solar detector)", () => {
  const solar = JSON.parse(JSON.stringify(richRec));
  solar.snapshot.augmentsPlaced[1].variant_id = "Solar Insight Aug";
  assert.ok(/☀️ Solar/.test(toMarkdown(solar)), "MD cues a Solar augment");
});

test("U7: a placed Set Augment + host-set suppression appear in all five outputs", () => {
  const augRec = JSON.parse(JSON.stringify(richRec));
  augRec.snapshot.setAugmentsPlaced = [{ set: "Legendary Prowess", host: "Vol Amulet", wiki_url: "https://ddowiki.com/x" }];
  const outs = [["md", toMarkdown(augRec)], ["bb", toBBCode(augRec)], ["csv", toCsv(augRec)], ["print", toPrintHtml(augRec)]];
  for (const [fmt, s] of outs) {
    assert.ok(/Set Augment: Legendary Prowess/.test(s), `${fmt} shows the placed Set Augment`);
    assert.ok(/suppresses Vol Set/.test(s), `${fmt} shows the suppressed host set`);
  }
  // Portable JSON: core carries the placement verbatim (round-trips); resolved view
  // attributes it to the solver-decided host and drops the suppressed set.
  const j = toPortableJSON(augRec, "2026-08-04T00:00:00Z");
  assert.strictEqual(j.core.snapshot.setAugmentsPlaced[0].host, "Vol Amulet", "core carries the placement verbatim");
  const trinket = j.resolved.loadout.find((i) => i.item === "Vol Amulet");
  assert.ok(trinket.crafting.some((c) => c.family === "augmentset" && c.set === "Legendary Prowess"),
    "resolved view attributes the augment to its host");
  assert.deepStrictEqual(trinket.suppressedSets, ["Vol Set"]);
  assert.ok(!j.resolved.sets.some((st) => st.set === "Vol Set"), "the suppressed set is no longer active");
});

test("U7: the displayed host matches the solver-decided host, not a greedy reconstruction", () => {
  const augRec = JSON.parse(JSON.stringify(richRec));
  // Target the Ring even though several equipped items also have open augment slots —
  // the host must be read verbatim from setAugmentsPlaced[].host, never reconstructed.
  augRec.snapshot.setAugmentsPlaced = [{ set: "Legendary Prowess", host: "Moon Ring" }];
  const resolved = toPortableJSON(augRec).resolved;
  const onRing = resolved.loadout.find((i) => i.item === "Moon Ring");
  const others = resolved.loadout.filter((i) => i.item !== "Moon Ring");
  assert.ok(onRing.crafting.some((c) => c.family === "augmentset"), "the Set Augment sits on the solver's chosen host");
  assert.ok(!others.some((i) => i.crafting.some((c) => c.family === "augmentset")), "no other item shows it");
});

test("R10/R11: toPortableJSON emits the ddo-loadout/v1 envelope with a verbatim core", () => {
  const j = toPortableJSON(richRec, "2026-08-03T00:00:00Z");
  assert.strictEqual(j.format, "ddo-loadout/v1");
  assert.strictEqual(j.schema_version, 1);
  assert.strictEqual(j.exported_at, "2026-08-03T00:00:00Z");
  assert.strictEqual(j.app_build_id, "08032026.1");
  assert.strictEqual(j.core, richRec, "core is the verbatim record (round-trips)");
  assert.ok(j.resolved && j.resolved.character.name === "Nightshade", "resolved view is present");
});

if (!process.exitCode) console.log(`\n${passed} passed`);
