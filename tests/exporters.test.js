// U12 — Markdown + CSV loadout exporters. Run: node tests/exporters.test.js
const assert = require("assert");
const { toMarkdown, toCsv, toPrintHtml, toBBCode, toPortableJSON, toGearset, setBonusDetail, bbEsc, mdEsc, htmlEsc, csvSafe, constraintLines } = require("../web/exporters.js");

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

// ---- plan 003 U1 — the declaration travels with a shared/exported loadout (R9, AE4) ----
test("U1/003 (R9/AE4): a declared build carries the feat into every export format", () => {
  const declared = { name: "Twin", inputs: Object.assign({}, rec.inputs, { twoWeaponFighting: true }),
    snapshot: rec.snapshot };
  const lines = constraintLines(declared).join("\n");
  assert.ok(/Two Weapon Fighting: Declared/.test(lines), "the declaration is a constraint line");
  // Every format inherits it via the shared constraintPairs header — solve-visible
  // must never mean share-invisible.
  assert.ok(/Two Weapon Fighting/.test(toMarkdown(declared)), "markdown header");
  assert.ok(/Two Weapon Fighting/.test(toCsv(declared)), "csv preamble");
  assert.ok(/Two Weapon Fighting/.test(toPrintHtml(declared)), "print header");
  const portable = toPortableJSON(declared);
  assert.strictEqual(portable.core.inputs.twoWeaponFighting, true, "portable JSON carries the declaration");
});

test("U1/003: an undeclared build omits the line entirely", () => {
  assert.ok(!/Two Weapon Fighting/.test(constraintLines(rec).join("\n")),
    "no empty declaration line for a build that never declared");
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

// ---- DDOBuilderV2 .gearset export (U1-U3) ----------------------------------
// The grammar these pin comes from DDOBuilderV2's own parser, not from a sample
// file: `ProcessFileLine` matches slot labels by substring and strips them, then
// `FindItem` compares the remainder for EXACT equality with no trimming anywhere
// in the chain. So "Head: Item" parses the name as " Item" and silently drops it.
// The label order is load-bearing too — `Hand:` is tested before `Weapon:`.
const gsRec = {
  name: "Sook - Reaper",
  inputs: {
    ml: 36, mlFloor: 31, race: "Human", armor: "cloth", pool: "all",
    priorities: ["Melee Power", "Doublestrike"],
    targetFloors: { "Melee Power": 20 },
    slotConstraints: { Trinket: { type: "empty" } },
  },
  snapshot: {
    status: "optimal",
    chosen: [
      { slot: "Goggles", variant: { variant_id: "The Ruined Vision", ml: 34, affixes: [],
        augment_slots_norm: { colors: [] } } },
      { slot: "Helmet", variant: { variant_id: "Legendary Downcast Bowler", ml: 34, affixes: [],
        augment_slots_norm: { colors: ["Sun", "Yellow"] } } },
      { slot: "Armor", variant: { variant_id: "Dragonsoul Vestments (level 36)", ml: 36, affixes: [],
        augment_slots_norm: { colors: [] } } },
      { slot: "Main Hand", variant: { variant_id: "Sireth", ml: 34, affixes: [],
        augment_slots_norm: { colors: [] } } },
      { slot: "Quiver", variant: { variant_id: "Epic Purifying Quiver", ml: 32, affixes: [],
        augment_slots_norm: { colors: [] } } },
    ],
    augmentsPlaced: [
      { variant_id: "Solar Gem of Critical Confirmation (Legendary)", color: "Sun", slot_color: "Sun",
        affixes: [{ name: "Seeker", type: "Artifact", value: 4 }] },
      { variant_id: "Topaz of Melee Power +12", color: "Yellow", slot_color: "Yellow",
        affixes: [{ name: "Melee Power", type: "Enhancement", value: 12 }] },
    ],
    vikPlaced: [{ item: "The Ruined Vision", stat: "Deadly", bonus_type: "Competence", value: 12, slot_type: "Dolorous" }],
    setsActive: [],
    effective: { "Melee Power": 45, Doublestrike: 18 },
    perTarget: { "Melee Power": 45, Doublestrike: 18 },
    breakdown: {},
  },
};
const gsBlocks = () => {
  const out = toGearset(gsRec);
  const i = out.indexOf("\n\n");
  return { all: out, gear: out.slice(0, i), record: out.slice(i + 2) };
};

test("U1: a gear line has no space after the colon (exact-equality item lookup)", () => {
  const { gear } = gsBlocks();
  assert.ok(/^Eye:The Ruined Vision/m.test(gear), "renders Eye:The Ruined Vision");
  assert.ok(!/^\w+: /m.test(gear), "no gear line puts a space after the colon");
});

test("U1: item names survive verbatim, including parentheses and spaces", () => {
  const { gear } = gsBlocks();
  assert.ok(/^Body:Dragonsoul Vestments \(level 36\)$/m.test(gear), "no normalization or trimming");
});

test("U1: Main Hand renders as Weapon, never a label containing Hand:", () => {
  const { gear, record } = gsBlocks();
  assert.ok(/^Weapon:Sireth$/m.test(gear), "Main Hand maps to Weapon");
  assert.ok(!/Main Hand:/.test(gear), "the app's own label would misparse as Gloves");
  assert.ok(!/Main Hand:/.test(record), "and it does not leak into the record block either");
});

test("U1: a slot with no DDOBuilderV2 label is omitted and recorded instead", () => {
  const { gear, record } = gsBlocks();
  assert.ok(!/Quiver/.test(gear), "Quiver has no file-grammar label");
  assert.ok(/Epic Purifying Quiver/.test(record), "but the item is still named below the split");
});

test("U1: an unequipped slot emits no line", () => {
  const { gear } = gsBlocks();
  assert.ok(!/^Waist:/m.test(gear), "no bare label for a slot the solver left empty");
});

test("U1: the two Ring rows fill Finger1 and Finger2 in solver order", () => {
  // The only app slot that maps to two labels, and the only place emission depends
  // on consuming rows in order. A regression that dropped the second entry or filled
  // both Finger slots from the same row would otherwise pass the whole suite.
  const rings = JSON.parse(JSON.stringify(gsRec));
  rings.snapshot.chosen.push(
    { slot: "Ring", variant: { variant_id: "Legendary Lantern of the Abyss", ml: 34, affixes: [], augment_slots_norm: { colors: [] } } },
    { slot: "Ring", variant: { variant_id: "Legendary The Earth and the Sky", ml: 34, affixes: [], augment_slots_norm: { colors: [] } } },
  );
  const gear = toGearset(rings).split("\n\n")[0];
  assert.ok(/^Finger1:Legendary Lantern of the Abyss$/m.test(gear), "first Ring row lands on Finger1");
  assert.ok(/^Finger2:Legendary The Earth and the Sky$/m.test(gear), "second lands on Finger2, not a repeat of the first");
});

test("U1: a single Ring emits Finger1 only, never an empty Finger2", () => {
  const one = JSON.parse(JSON.stringify(gsRec));
  one.snapshot.chosen.push({ slot: "Ring", variant: { variant_id: "Solo Band", ml: 30, affixes: [], augment_slots_norm: { colors: [] } } });
  const gear = toGearset(one).split("\n\n")[0];
  assert.ok(/^Finger1:Solo Band$/m.test(gear), "the one ring lands on Finger1");
  assert.ok(!/^Finger2:/m.test(gear), "no bare Finger2 line");
});

test("U1: item names are NOT trimmed — the importer compares them with equality", () => {
  // Both catalogs come from the Gear Planner, so whitespace in a name exists on
  // BOTH sides; normalizing ours would turn a match into a miss.
  const padded = JSON.parse(JSON.stringify(gsRec));
  padded.snapshot.chosen = [{ slot: "Goggles", variant: { variant_id: " Odd Name ", ml: 30, affixes: [], augment_slots_norm: { colors: [] } } }];
  padded.snapshot.augmentsPlaced = [];
  const gear = toGearset(padded).split("\n\n")[0];
  assert.ok(gear.split("\n").includes("Eye: Odd Name "), `name emitted verbatim, got: ${JSON.stringify(gear)}`);
});

test("U3: record-block indentation survives (hierarchy is not flattened)", () => {
  const { record } = gsBlocks();
  assert.ok(/^# {2,}ML 36/m.test(record), "nested lines keep their indent under their heading");
  assert.ok(!/ $/m.test(record), "and no line carries trailing whitespace");
});

test("U2: augments append as brace entries with no space before the first brace", () => {
  const { gear } = gsBlocks();
  const head = gear.split("\n").find((l) => l.startsWith("Head:"));
  assert.ok(/^Head:Legendary Downcast Bowler\{/.test(head), `no space before the brace: ${head}`);
  assert.ok(/\{artifact seeker 4\}/.test(head), "bonus type, stat, value — lowercased for the matcher");
  assert.ok(/\{enhancement melee power 12\}/.test(head), "second augment on the same line");
});

test("U2: a multi-affix augment emits ONE entry, not one per affix", () => {
  const multi = JSON.parse(JSON.stringify(gsRec));
  multi.snapshot.augmentsPlaced = [{ variant_id: "Lunar Gem of Balance and Tumble (Legendary)",
    color: "Moon", slot_color: "Sun",
    affixes: [{ name: "Balance", type: "Profane", value: 6 }, { name: "Tumble", type: "Profane", value: 6 }] }];
  const head = toGearset(multi).split("\n").find((l) => l.startsWith("Head:"));
  assert.strictEqual((head.match(/\{/g) || []).length, 1, "one augment placed means one entry");
  assert.ok(/\{profane balance 6\}/.test(head), "built from the first affix");
});

test("U2: a host with no augments renders a bare line", () => {
  const { gear } = gsBlocks();
  assert.ok(/^Eye:The Ruined Vision$/m.test(gear), "no trailing braces when nothing is placed");
});

test("U3: the first blank line is the terminator and nothing above it is a comment", () => {
  const { all, gear, record } = gsBlocks();
  assert.ok(!/^\s*$/m.test(gear), "no blank line above the terminator");
  assert.ok(record.split("\n").filter((l) => l.length).every((l) => l.startsWith("#")),
    "every record line reads as commentary");
  assert.ok(all.indexOf("\n\n") > 0, "the terminator exists");
});

test("U3: the record block carries character, inputs, priorities and totals", () => {
  const { record } = gsBlocks();
  assert.ok(/Sook - Reaper/.test(record), "character name");
  assert.ok(/ML 36/.test(record) && /31/.test(record), "level cap and floor");
  assert.ok(/Melee Power/.test(record) && /Doublestrike/.test(record), "ranked priorities");
  assert.ok(/Melee Power[^\n]*45/.test(record), "achieved total for a ranked stat");
  assert.ok(/Trinket/.test(record), "a locked slot is disclosed");
});

test("U3: a craft decision is recorded and never becomes an importable augment", () => {
  const { gear, record } = gsBlocks();
  assert.ok(!/deadly/i.test(gear), "a Viktranium craft must not consume a real augment slot");
  assert.ok(/Deadly \+12 Competence/.test(record), "it appears in the record, attributed to its slot");
  assert.ok(/Ruined Vision/.test(record), "attribution names the host");
});

test("U3: every placed augment is listed in the record block (unplaceable ones recoverable)", () => {
  const { record } = gsBlocks();
  assert.ok(/Solar Gem of Critical Confirmation \(Legendary\)/.test(record), "named in the record");
  assert.ok(/Seeker \+4 Artifact/.test(record), "with the affixes it grants");
});

test("U3: user text is newline-neutralized so it cannot forge a gear line", () => {
  const evil = JSON.parse(JSON.stringify(gsRec));
  evil.name = "Sook\nWeapon:Forged Item";
  const out = toGearset(evil);
  const gear = out.slice(0, out.indexOf("\n\n"));
  assert.ok(!/Forged Item/.test(gear), "injected text never reaches the parseable half");
  const record = out.slice(out.indexOf("\n\n") + 2);
  assert.ok(record.split("\n").filter((l) => l.length).every((l) => l.startsWith("#")),
    "and every physical line below stays commented");
});


// ---- U3 — a declared credit is labelled in EVERY export (R8) ----------------
// The invariant this repo holds: a mechanic must never be solve-visible but
// share-invisible. A shared loadout has to show which numbers the recipient's own
// gear produces and which one the sender asserted.
//
// The label is imported from the SOLVER, not restated here. Restating it made
// these tests pass against the pre-U3 tree: the fixture supplied the string and
// the assertion looked for it, so they only proved the exporter echoes its input.
// Importing the constant turns them into a real cross-module contract.
const { DECLARED_LABEL } = require("../web/solver.js");

const creditRec = {
  name: "Trance Build",
  inputs: { ml: 34, race: "Human", pool: "all", priorities: ["Combat Mastery"],
    declaredCredits: { "Combat Mastery||Insight": { stat: "Combat Mastery", bonus_type: "Insight", value: 7 } } },
  snapshot: {
    status: "optimal",
    chosen: [{ slot: "Ring", variant: { variant_id: "Plain Ring", ml: 30,
      affixes: [{ name: "Combat Mastery", type: "Enhancement", value: 5 }] } }],
    setsActive: [],
    effective: { "Combat Mastery": 12 },
    breakdown: {
      "Combat Mastery": [
        { bonus_type: "Enhancement", value: 5, source: "Plain Ring", sourceKind: "worn", slot: "Ring", hostIds: ["Plain Ring"] },
        { bonus_type: "Insight", value: 7, source: DECLARED_LABEL, sourceKind: "declared", slot: null, hostIds: null },
      ],
    },
  },
};

test("U3: every text export labels a declared credit as declared", () => {
  const outs = { markdown: toMarkdown(creditRec), bbcode: toBBCode(creditRec),
    csv: toCsv(creditRec), print: toPrintHtml(creditRec) };
  for (const [fmt, out] of Object.entries(outs)) {
    assert.ok(out.includes(DECLARED_LABEL),
      `${fmt} must name the declared credit — a shared build that hides it presents a player-typed number as sourced`);
    assert.ok(/Insight/.test(out) && /\+7/.test(out), `${fmt} keeps the credit's type and value`);
  }
});

test("U3: a declared credit is not attributed to a slot in exports", () => {
  const md = toMarkdown(creditRec);
  const line = md.split("\n").find((l) => l.includes(DECLARED_LABEL));
  assert.ok(line, "the declared line exists");
  assert.ok(!/ via /.test(line), `a credit occupies no slot, got: ${line.trim()}`);
});

test("U3: an undeclared build's exports carry no declared label", () => {
  for (const out of [toMarkdown(rec), toBBCode(rec), toCsv(rec), toPrintHtml(rec)]) {
    assert.ok(!out.includes(DECLARED_LABEL), "R3 — nothing added when nothing is declared");
  }
});


// ---- U4 — the declared-credit qualifier reaches every export (R9) -----------

test("U4: every export that claims an optimal loadout carries the qualifier", () => {
  const r = {
    name: "Trance", inputs: { ml: 34, pool: "all", priorities: ["CM"] },
    snapshot: { status: "optimal", chosen: [], setsActive: [], effective: { CM: 12 }, breakdown: { CM: [] },
      creditReport: [{ stat: "CM", bonus_type: "Insight", value: 7, won: true, beatGear: 5, floor: 10, gearInLoadout: 5 }] },
  };
  for (const [fmt, fn] of [["markdown", toMarkdown], ["bbcode", toBBCode], ["csv", toCsv], ["print", toPrintHtml]]) {
    const out = fn(r);
    assert.ok(/did not verify/.test(out),
      `${fmt} asserts an optimal loadout, so it must also say the declared number was unverified`);
    // The sentences carrying actual numbers must travel too — the qualifier alone
    // says a number was declared, not what it did.
    assert.ok(/which is 5/.test(out), `${fmt} carries the displacement figure`);
    assert.ok(/the gear in this loadout supplies 5/.test(out), `${fmt} carries the floor attribution`);
  }
});

test("U4: an undeclared build's exports carry no qualifier", () => {
  for (const out of [toMarkdown(rec), toBBCode(rec), toCsv(rec), toPrintHtml(rec)]) {
    assert.ok(!/did not verify/.test(out), "R3 — nothing added when nothing is declared");
  }
});


// ---- U6 — the DECLARATION travels with a shared loadout (R12) ----------------
// Distinct from U4's qualifier, which says a number was declared and unverified.
// This is the number itself, so a recipient can reproduce the solve.

const DECLARED = {
  "Combat Mastery||Insight": { stat: "Combat Mastery", bonus_type: "Insight", value: 7 },
  "Devotion||Sacred": { stat: "Devotion", bonus_type: "Sacred", value: 12 },
};
const APPLIED = [
  { stat: "Combat Mastery", bonus_type: "Insight", value: 7, won: true, beatGear: 6, floor: null, gearInLoadout: 5 },
  { stat: "Devotion", bonus_type: "Sacred", value: 12, won: true, beatGear: null, floor: null, gearInLoadout: 309 },
];
const sharedRec = () => ({
  name: "Trance Build",
  inputs: { ml: 34, pool: "all", priorities: ["Combat Mastery", "Devotion"],
    declaredCredits: JSON.parse(JSON.stringify(DECLARED)) },
  snapshot: { status: "optimal", chosen: [], setsActive: [],
    effective: { "Combat Mastery": 12 }, breakdown: {},
    creditReport: JSON.parse(JSON.stringify(APPLIED)) },
});

test("U6: every text export carries the declared credits themselves", () => {
  for (const [fmt, fn] of [["markdown", toMarkdown], ["bbcode", toBBCode],
                           ["csv", toCsv], ["print", toPrintHtml], ["gearset", toGearset]]) {
    const out = fn(sharedRec());
    // Assert the LINE, not just the substrings — "Combat Mastery" also appears in
    // the priorities list, so a substring check would pass without the credit.
    const line = (out.match(/[^\n]*[Aa]lready have[^\n]*/) || [""])[0];
    assert.ok(line, `${fmt} must carry an 'already have' line`);
    assert.ok(/Combat Mastery \+7 Insight/.test(line),
      `${fmt} must carry the declared value on that line, got: ${line.trim().slice(0, 120)}`);
    assert.ok(/Devotion \+12 Sacred/.test(line), `${fmt} carries the second credit too`);
  }
});

// Forward regression guard — passes against main too (main emits no such line at
// all), so it covers no part of this diff. Kept because R3 is worth pinning.
test("regression: an undeclared build's exports carry no credit line", () => {
  const bare = sharedRec();
  delete bare.inputs.declaredCredits;
  bare.snapshot.creditReport = [];   // the source of truth for this line
  for (const [fmt, fn] of [["markdown", toMarkdown], ["bbcode", toBBCode],
                           ["csv", toCsv], ["print", toPrintHtml], ["gearset", toGearset]]) {
    const out = fn(bare);
    assert.ok(!/[Aa]lready have/.test(out), `${fmt} adds no credit line when none is declared`);
  }
});

// Also passes against main: toPortableJSON has always set `core: rec`, and U5
// already persisted declaredCredits. Documents the U6 claim that the envelope
// needs no exporter change; it is not evidence for this diff.
test("regression: the portable JSON carries the credits verbatim in core.inputs", () => {
  // No round-trip test: there is no reader for the ddo-loadout/v1 envelope, and
  // exporters.js records import/compare as deferred. Assert the contents; the
  // backup path (tests/backup.test.js) owns the round-trip.
  const portable = toPortableJSON(sharedRec());
  assert.deepStrictEqual(portable.core.inputs.declaredCredits, DECLARED,
    "the envelope carries the saved record verbatim, so U5's persistence suffices");
});

test("U6: the export lists only the credits that APPLIED, not what was typed", () => {
  // The input map and the solve disagree routinely: the wizard keeps a half-typed
  // row in state on purpose, pickInputs saves it raw, and the query seam drops it.
  // Reading the input map published a credit the solve refused — with no U4
  // qualifier, since that reads the report — telling a recipient the sender holds
  // a bonus that contributed nothing to the build they were handed.
  const rec = sharedRec();
  rec.inputs.declaredCredits["Blurry||Insight"] = { stat: "Blurry", bonus_type: "Insight", value: 3 };
  rec.inputs.declaredCredits["Devotion||insight"] = { stat: "Devotion", bonus_type: "insight", value: 7 };
  rec.inputs.declaredCredits["Wisdom||Sacred"] = { stat: "Wisdom", bonus_type: "Sacred", value: "" };
  // creditReport is unchanged — none of those three survived the query seam.

  const line = (toMarkdown(rec).match(/[^\n]*[Aa]lready have[^\n]*/) || [""])[0];
  assert.ok(/Combat Mastery \+7 Insight/.test(line) && /Devotion \+12 Sacred/.test(line),
    `the applied credits are listed: ${line}`);
  for (const ghost of ["Blurry", "+7 insight", "Wisdom"]) {
    assert.ok(!line.includes(ghost),
      `a credit the solve refused must not be published: ${ghost} in ${line}`);
  }
});

test("U6: a hostile stat name cannot break out of any format", () => {
  const rec = sharedRec();
  rec.snapshot.creditReport = [{ stat: "=cmd|'/C calc'!A0\nWeapon:Cheat Sword",
    bonus_type: "Insight", value: 7, won: true, beatGear: null, floor: null, gearInLoadout: 0 }];

  const gs = toGearset(rec);
  const body = gs.split("\n\n").slice(1).join("\n").split("\n").filter((l) => l.trim());
  assert.ok(!body.some((l) => !l.startsWith("#")),
    "every gearset record line stays commented — an injected newline must not forge a gear line");
  assert.ok(!gs.split("\n").some((l) => /^Weapon:Cheat Sword/.test(l)),
    "the injected weapon line never reaches the parseable region");

  const csvLine = toCsv(rec).split("\n").find((l) => /Already have/.test(l));
  assert.ok(/"'=cmd/.test(csvLine) || /'=cmd/.test(csvLine),
    `a formula-leading cell must be neutralized: ${csvLine}`);
});

// ---- U5/002 — the set-piece attribution reaches every export (R11) ----------
// Same standing invariant as U3 above: never solve-visible but share-invisible.
// The solver completes a set with a Gem of Many Facets even though the gem carries
// the set in NO item data, so a format that printed the set name alone handed a
// recipient a bonus they could not reproduce.
//
// The member text is imported from projection's SINGLE label function rather than
// restated here — restating it would let each exporter drift into its own format
// while the tests stayed green, which is the exact failure U4 exported
// `setMemberLabel` to prevent.
const Projection = require("../web/projection.js");

// Two intrinsic pieces plus a wildcard pick. The static count is 2 against a
// 3-piece tier, so the set is satisfied only via `setsActive` — the runtime path.
const GEM_TIER = [{ set: "Legendary Vol's Influence", pieces_required: 3,
  affixes: [{ name: "Wizardry", type: "Enhancement", value: 150 }] }];
const gemRec = () => ({
  name: "Facets",
  inputs: { ml: 34, race: "Elf", pool: "all", priorities: ["Wizardry"] },
  snapshot: {
    status: "optimal",
    setsActive: [{ set: "Legendary Vol's Influence", pieces_required: 3 }],
    chosen: [
      { slot: "Helmet", variant: { variant_id: "Legendary University Mage's Hat", ml: 34, affixes: [],
        set_bonus: [{ set: "Legendary Vol's Influence" }], parsed_set_bonuses: GEM_TIER } },
      { slot: "Necklace", variant: { variant_id: "Legendary Collar of the Vol", ml: 34, affixes: [],
        set_bonus: [{ set: "Legendary Vol's Influence" }], parsed_set_bonuses: GEM_TIER } },
      { slot: "Trinket", variant: { variant_id: "Gem of Many Facets", ml: 34, affixes: [] } },
    ],
    jokerPlaced: [{ host: "Gem of Many Facets", set: "Legendary Vol's Influence" }],
    membershipPlaced: [],
    effective: { Wizardry: 150 },
    breakdown: { Wizardry: [{ bonus_type: "Enhancement", value: 150, source: "Legendary Vol's Influence",
      sourceKind: "set", setYieldingSlots: ["Helmet", "Necklace"] }] },
  },
});
const GEM_LABEL = Projection.setMemberLabel({ slot: "Trinket", item: "Gem of Many Facets", kind: "wildcard" });

test("U5/002 (R11): the portable JSON carries each set's members with their slots", () => {
  const sets = toPortableJSON(gemRec()).resolved.sets;
  const vol = sets.find((s) => s.set === "Legendary Vol's Influence");
  assert.ok(vol, "the gem-completed set is in the envelope");
  assert.deepStrictEqual(vol.members, [
    { slot: "Helmet", item: "Legendary University Mage's Hat", kind: "intrinsic" },
    { slot: "Necklace", item: "Legendary Collar of the Vol", kind: "intrinsic" },
    { slot: "Trinket", item: "Gem of Many Facets", kind: "wildcard" },
  ], "every counted piece rides along, each with the slot it occupies and how it counts");
});

// The one physical line on which a format names a set's pieces. CSV puts them in a
// column of the set-bonus row; the other four use a labelled "Pieces:" line.
function memberLine(fmt, out) {
  if (fmt === "csv") return (out.split("\n").find((l) => l.startsWith("Legendary Vol's Influence,")) || "");
  return (out.match(/[^\n]*Pieces: [^\n]*/) || [""])[0];
}

// [name, renderer, the format's escaper for user-derived text]. Names travel
// escaped, so an expectation must be escaped the same way — print entity-escapes
// the apostrophe in "Mage's Hat".
const FORMATS = [["markdown", toMarkdown, mdEsc], ["bbcode", toBBCode, bbEsc],
  ["csv", toCsv, (s) => s], ["print", toPrintHtml, htmlEsc], ["gearset", toGearset, (s) => s]];

test("U5/002 (R11): all five text formats name the gem among that set's pieces", () => {
  // Assert EVERY format, not a sample: each renders view.sets by hand, so fixing
  // the projection satisfies none of them on its own.
  for (const [fmt, fn, esc] of FORMATS) {
    const line = memberLine(fmt, fn(gemRec()));
    assert.ok(line, `${fmt} must carry a set-pieces line`);
    assert.ok(line.includes("Gem of Many Facets"),
      `${fmt} must name the wildcard piece the solve counted, got: ${line.trim().slice(0, 200)}`);
    assert.ok(/wildcard/.test(line),
      `${fmt} must say the gem is a wildcard, not imply it carries the set intrinsically`);
    for (const worn of ["Legendary University Mage's Hat", "Legendary Collar of the Vol"]) {
      assert.ok(line.includes(esc(worn)),
        `${fmt} names the intrinsic piece ${worn} too, got: ${line.trim().slice(0, 200)}`);
    }
  }
});

test("U5/002 (R11): every format uses projection's single member label, not its own", () => {
  for (const [fmt, fn, esc] of FORMATS) {
    // The label's own punctuation is structural; only the item/slot text is escaped.
    const want = Projection.setMemberLabel({ slot: esc("Trinket"), item: esc("Gem of Many Facets"), kind: "wildcard" });
    assert.ok(fn(gemRec()).includes(want),
      `${fmt} must render Proj.setMemberLabel verbatim (want ${JSON.stringify(want)})`);
  }
});

test("U5/002 (R11): the CSV set-bonus row carries a members column", () => {
  const csv = toCsv(gemRec());
  const header = csv.split("\n").find((l) => l.startsWith("Set bonus,"));
  assert.strictEqual(header, "Set bonus,Pieces,Grants,From", "the section gains a members column");
  const row = csv.split("\n").find((l) => l.startsWith("Legendary Vol's Influence,"));
  assert.ok(row.includes("Gem of Many Facets (Trinket) — wildcard"),
    `the row's last cell names the counted pieces, got: ${row}`);
  // The cell holds commas, so RFC-4180 quoting must survive the new column.
  assert.ok(/,"[^"]*Gem of Many Facets[^"]*"$/.test(row), `the members cell stays quoted: ${row}`);
});

test("U5/002 (R11): a chosen-membership pick is named as a pick, not as intrinsic", () => {
  // Vecna Lost Purpose / Cannith Repurposing / Dino Set-Bonus take the same path
  // as the gem but are a different `kind`, and the text must not conflate them.
  // The expected string is written out LITERALLY, not computed by calling the
  // function under test — an echo test passes whatever that function returns,
  // including a label identical to an intrinsic member's, which is the exact
  // confusion this assertion exists to prevent.
  const r = gemRec();
  r.snapshot.jokerPlaced = [];
  r.snapshot.membershipPlaced = [{ host: "Gem of Many Facets", set: "Legendary Vol's Influence",
    station: "Cannith Repurposing Station" }];
  const line = (toMarkdown(r).match(/[^\n]*Pieces: [^\n]*/) || [""])[0];
  assert.ok(line.includes("Gem of Many Facets (Trinket) \u2014 set-bonus pick"),
    `membership pick must be labelled distinctly; got: ${line}`);
  assert.ok(!/wildcard/.test(line), "and must not be labelled a wildcard");
});

test("U5/002: a build with no completed set gains nothing in any format", () => {
  // The no-change guard. Verified byte-identical against the pre-change tree by
  // diffing full captures of all six outputs; this pins the observable half.
  for (const [fmt, fn] of [["markdown", toMarkdown], ["bbcode", toBBCode],
                           ["csv", toCsv], ["print", toPrintHtml], ["gearset", toGearset]]) {
    const out = fn(rec);
    assert.ok(!/Pieces: /.test(out), `${fmt} adds no set-pieces line when no set is complete`);
    assert.ok(!/Set bonus,Pieces,Grants,From/.test(out), `${fmt} adds no members column either`);
  }
  assert.deepStrictEqual(toPortableJSON(rec).resolved.sets, [], "and the envelope still lists no sets");
});

// #227 — an adjudicated untyped affix has no bonus type. Every share format ran
// it through `sourceStr`, which printed the raw value: the literal "null". The
// label matches the on-screen receipts so a shared build reads the same as the
// one it came from.
test("#227: every share format labels an untyped contributor \"untyped\"", () => {
  const untypedRec = {
    name: "Monk",
    inputs: { ml: 34, race: "Human", pool: "all", priorities: ["Enhanced Ki"] },
    snapshot: {
      status: "optimal",
      chosen: [
        { slot: "Boots", variant: { variant_id: "Legendary Icewalkers", ml: 34,
          affixes: [{ name: "Enhanced Ki", type: null, value: 5 }],
          augment_slots_norm: { colors: [] } } },
      ],
      setsActive: [],
      breakdown: {
        "Enhanced Ki": [{ bonus_type: null, value: 5, source: "Legendary Icewalkers",
                          sourceKind: "worn", slot: "Boots" }],
      },
    },
    stampedBuildId: "untyped1",
  };
  for (const [fmt, fn] of [["markdown", toMarkdown], ["csv", toCsv],
                           ["print", toPrintHtml], ["bbcode", toBBCode]]) {
    const out = fn(untypedRec);
    assert.ok(/Enhanced Ki/.test(out), `${fmt} names the stat`);
    assert.ok(/untyped/.test(out), `${fmt} labels the bucket`);
    assert.ok(!/\bnull\b/.test(out), `${fmt} never prints the raw null`);
  }
});

// ---- #239 U3: both disclosures reach every share surface -------------------
//
// Carrying a fact through the content model is necessary but not sufficient —
// each renderer has to print it. That gap already shipped once, for set members.
function disclosureRec(opts) {
  return {
    name: "Warlock",
    inputs: { ml: 34, race: "Human", pool: "all", priorities: ["Kinetic Lore"] },
    stampedBuildId: "sat1",
    snapshot: {
      status: "optimal",
      chosen: [
        { slot: "Goggles", variant: { variant_id: "Red Wizard's Sight", ml: 34,
          affixes: [{ name: "Kinetic Lore", type: "Equipment", value: 24 }],
          augment_slots_norm: { colors: [] } } },
        { slot: "Boots", variant: { variant_id: "Filler Boots", ml: 30, affixes: [],
          augment_slots_norm: { colors: [] } } },
      ],
      setsActive: [],
      breakdown: { "Kinetic Lore": [{ bonus_type: "Equipment", value: 24,
        source: "Red Wizard's Sight", sourceKind: "worn", slot: "Goggles", hostIds: ["Red Wizard's Sight"] }] },
      saturationReport: (opts && opts.saturation) === false ? [] : [
        { stat: "Kinetic Lore", total: 30, bonusTypes: ["Equipment", "Artifact"], unusedSources: 56 },
      ],
      emptySlots: (opts && opts.empty) === false ? { count: 0, slots: [] }
        : { count: 2, slots: ["Ring", "Trinket"] },
      // U6/#249 — the third disclosure on the same channel.
      absorptionQuarantine: (opts && opts.quarantine) === false ? [] : [
        { item: "Cyran Guard (level 26)", stat: "Elemental Absorption", reason: "absent",
          components: ["Acid Absorption", "Cold Absorption", "Fire Absorption",
                       "Electric Absorption", "Sonic Absorption"] },
      ],
    },
  };
}

test("U3/#239: every share format carries both disclosures", () => {
  const rec = disclosureRec();
  for (const [fmt, fn] of [["markdown", toMarkdown], ["csv", toCsv],
                           ["print", toPrintHtml], ["bbcode", toBBCode]]) {
    const out = fn(rec);
    assert.ok(/at its ceiling/.test(out), `${fmt} carries the saturation fact`);
    assert.ok(/Equipment bonus/.test(out) && /Artifact bonus/.test(out),
      `${fmt} names both carrying bonus types`);
    assert.ok(/slots are empty/.test(out), `${fmt} carries the empty-slot fact`);
    assert.ok(!/56/.test(out), `${fmt} does not speak the unused-source count`);
    assert.ok(!/\bML band\b/i.test(out), `${fmt} attributes no cause`);
  }
});

test("U3/#239: the two disclosures are independent", () => {
  // Saturation with no free slots.
  const noEmpty = disclosureRec({ empty: false });
  const a = toMarkdown(noEmpty);
  assert.ok(/at its ceiling/.test(a), "saturation still renders");
  assert.ok(!/slots are empty/.test(a), "and does not drag the other in");

  // Free slots with no saturation.
  const noSat = disclosureRec({ saturation: false });
  const b = toMarkdown(noSat);
  assert.ok(!/at its ceiling/.test(b), "no saturation fact");
  assert.ok(/slots are empty/.test(b), "the empty-slot fact still renders");
});

test("U3/#239: the portable envelope carries both, so a re-import discloses identically", () => {
  const portable = toPortableJSON(disclosureRec(), "2026-08-10T00:00:00Z");
  const blob = JSON.stringify(portable);
  assert.ok(/at its ceiling/.test(blob), "saturation rides in the envelope");
  assert.ok(/slots are empty/.test(blob), "so does the empty-slot fact");
});

test("U3/#239: a build with neither fact exports cleanly", () => {
  const clean = disclosureRec({ saturation: false, empty: false, quarantine: false });
  const out = toMarkdown(clean);
  assert.ok(!/at its ceiling/.test(out) && !/slots are empty/.test(out), "neither fact appears");
  assert.ok(!/>\s*\n/.test(out.replace(/\n{3,}/g, "\n\n")), "and no empty blockquote is left behind");
});

// ---- U6/#249: the absorption quarantine reaches every share surface ---------

test("U6/#249: every share format carries the absorption-quarantine disclosure", () => {
  const rec = disclosureRec();
  for (const [fmt, fn] of [["markdown", toMarkdown], ["csv", toCsv],
                           ["print", toPrintHtml], ["bbcode", toBBCode]]) {
    const out = fn(rec);
    assert.ok(/Elemental Absorption/.test(out), `${fmt} names the excluded enchantment`);
    // Escaping-agnostic: markdown escapes the parentheses an item name carries
    // ("Cyran Guard \(level 26\)"), the same way it already does in the loadout
    // table. That is the format's own quoting, not a lost fact.
    assert.ok(/Cyran Guard/.test(out) && /level 26/.test(out), `${fmt} names the item`);
    assert.ok(!/would have/i.test(out), `${fmt} asserts nothing about the score`);
  }
});

test("U6/#249: the disclosure is independent of the other two", () => {
  const only = toMarkdown(disclosureRec({ saturation: false, empty: false }));
  assert.ok(/Elemental Absorption/.test(only), "renders alone");
  assert.ok(!/at its ceiling/.test(only) && !/slots are empty/.test(only),
    "and drags neither of the others in");

  const without = toMarkdown(disclosureRec({ quarantine: false }));
  assert.ok(!/Elemental Absorption/.test(without), "silent when nothing was quarantined");
  assert.ok(/at its ceiling/.test(without), "while the others still render");
});

test("U6/#249: the portable envelope carries it, so a re-import discloses identically", () => {
  const blob = JSON.stringify(toPortableJSON(disclosureRec(), "2026-08-11T00:00:00Z"));
  assert.ok(/Elemental Absorption/.test(blob), "the quarantine rides in the envelope");
});

// ---- U8 (R8, R10) — every share export renders the collapsed line ----------
//
// R10: the collapse is driven from the single content source the exports read
// (`Proj.project`), so no export can show the expanded shape while the UI shows
// the collapsed one. These pin each output individually anyway — carrying the
// shape through the model is necessary, not sufficient, and each renderer still
// has to print it.
const SCHOOLS_U8 = ["Abjuration", "Conjuration", "Enchantment", "Evocation", "Illusion", "Necromancy", "Transmutation"];
function expandedU8(label, type, value) {
  return SCHOOLS_U8.map((s) => ({ name: `${s} Focus`, type, value, via: label }));
}

// A build whose Trinket carries a typed universal spell-focus enchantment, and
// whose Cloak carries a Viktranium craft of the universal option (the reported
// symptom's own shape).
function expansionRec() {
  return {
    name: "Caster",
    inputs: { ml: 34, race: "Elf", pool: "all", priorities: ["Necromancy Focus"] },
    snapshot: {
      status: "optimal",
      chosen: [
        { slot: "Trinket", variant: { variant_id: "A Memento of Mori", ml: 32,
          affixes: expandedU8("Sacred Spell Focus Mastery", "Sacred", 3) } },
        { slot: "Cloak", variant: { variant_id: "Cloak of Sorrow", ml: 34, affixes: [] } },
      ],
      effective: { "Necromancy Focus": 5 },
      breakdown: { "Necromancy Focus": [
        { bonus_type: "Sacred", value: 3, source: "A Memento of Mori", sourceKind: "worn",
          slot: "Trinket", hostIds: ["A Memento of Mori"], via: "Sacred Spell Focus Mastery" },
      ] },
      augmentsPlaced: [], setsActive: [],
      vikPlaced: [{ item: "Cloak of Sorrow", slot_type: "Woeful", name: "Woeful Invigorator",
        affixes: SCHOOLS_U8.map((s) => ({ stat: `${s} Focus`, bonus_type: "Profane", value: 2,
          unit: "flat", via: "Profane Spell Focus Mastery" })),
        stat: "Necromancy Focus", bonus_type: "Profane", value: 2, unit: "flat" }],
    },
    stampedBuildId: "u8",
  };
}

const COLLAPSED = "Sacred Spell Focus Mastery +3";
const VIK_COLLAPSED = "Slot Woeful Viktranium augment: Profane Spell Focus Mastery +2";

// #340 — the bundled-enchantments section deliberately lists an expansion's
// members UNDER the engraved name (a spell-focus umbrella is a multi-stat
// bundle). The no-leak assertions must skip that one section — but ONLY that
// section: Stat breakdown and Utility render AFTER it in every format, and the
// expanded shape must never masquerade there either. So the helper EXCISES the
// bundles block (its heading up to the next section's marker) and rejoins the
// tail. A missing end marker falls back to truncation; each test's anti-vacuity
// assertion (the tail marker must survive the excision) turns that fallback
// into a failure rather than silently weaker coverage.
const sansBundles = (s, start, end) => {
  const i = s.indexOf(start);
  if (i < 0) return s;
  const j = s.indexOf(end, i + start.length);
  return j < 0 ? s.slice(0, i) : s.slice(0, i) + s.slice(j);
};

test("U8/R8/AE6: the Markdown export renders the collapsed worn line, not seven school lines", () => {
  const md = toMarkdown(expansionRec());
  assert.ok(md.includes(COLLAPSED), "names the enchantment engraved on the item");
  const sans = sansBundles(md, "## Bundled enchantments", "## Stat breakdown");
  assert.ok(sans.includes("## Stat breakdown"), "the tail survived the excision (anti-vacuity)");
  assert.ok(!/Abjuration Focus/.test(sans), "no expanded school leaks into the share text");
  assert.ok(md.includes(VIK_COLLAPSED), "the crafted choice-slot option reads as the enchantment too");
});

test("U8/R8: the BBCode export renders the collapsed line", () => {
  const bb = toBBCode(expansionRec());
  assert.ok(bb.includes(COLLAPSED));
  const sans = sansBundles(bb, "[b]Bundled enchantments[/b]", "[b]Stat breakdown[/b]");
  assert.ok(sans.includes("[b]Stat breakdown[/b]"), "the tail survived the excision (anti-vacuity)");
  assert.ok(!/Abjuration Focus/.test(sans));
  assert.ok(bb.includes(VIK_COLLAPSED));
});

test("U8/R8: the CSV export renders the collapsed line", () => {
  const csv = toCsv(expansionRec());
  assert.ok(csv.includes(COLLAPSED));
  const sans = sansBundles(csv, "Bundled enchantment", "Stat,Total,Capped,Sources");
  assert.ok(sans.includes("Stat,Total,Capped,Sources"), "the tail survived the excision (anti-vacuity)");
  assert.ok(!/Abjuration Focus/.test(sans));
  assert.ok(csv.includes(VIK_COLLAPSED));
});

test("U8/R8: the print HTML export renders the collapsed line", () => {
  const html = toPrintHtml(expansionRec());
  assert.ok(html.includes(COLLAPSED));
  const sans = sansBundles(html, "<h2>Bundled enchantments</h2>", "<h2>Stat breakdown</h2>");
  assert.ok(sans.includes("<h2>Stat breakdown</h2>"), "the tail survived the excision (anti-vacuity)");
  assert.ok(!/Abjuration Focus/.test(sans));
  assert.ok(html.includes(VIK_COLLAPSED));
});

test("U8/R10: the portable JSON's resolved block carries the collapsed affix, not the expansion", () => {
  const portable = toPortableJSON(expansionRec(), "2026-08-11T00:00:00Z");
  const trinket = portable.resolved.loadout.find((i) => i.item === "A Memento of Mori");
  assert.strictEqual(trinket.affixes.length, 1, "one resolved affix entry, not seven");
  const blob = JSON.stringify(portable.resolved);
  assert.ok(/Sacred Spell Focus Mastery/.test(blob), "the enchantment name rides in the envelope");
  assert.ok(/Profane Spell Focus Mastery \+2/.test(blob), "so does the collapsed craft label");
});

test("U8/R8: the .gearset carries the collapse through its CRAFTING line", () => {
  // The .gearset has no worn-affix channel at all — it emits `label:item{augments}`
  // plus crafting lines — so its behavior is asserted through the crafting line.
  const gs = toGearset(expansionRec());
  assert.ok(gs.includes(VIK_COLLAPSED), `crafting line names the enchantment; got:\n${gs}`);
  // #370 — the bundles block is excised first, exactly as the MD/BBCode/CSV/print
  // siblings do it. That block DELIBERATELY lists an expansion's members under
  // the engraved name, and since #370 a via-stamped Viktranium craft reaches it
  // too, so the seven schools legitimately appear there. Everything ABOVE it must
  // still name only the enchantment. No end marker: the bundles block is the last
  // thing the .gearset record emits, so the helper truncates — the anti-vacuity
  // assertion below is what stops that from silently gutting the coverage.
  const sans = sansBundles(gs, "Bundled enchantments", " never");
  assert.ok(sans.includes(VIK_COLLAPSED), "the crafting line survived the excision (anti-vacuity)");
  assert.ok(!/Necromancy Focus \+2/.test(sans), "not the single ranked school the option happened to match");
});

test("U8/R8: an export of a build with no expanded affix is unchanged", () => {
  const md = toMarkdown(rec);
  assert.ok(/Constitution \+7 Insightful/.test(md) && /PRR \+15/.test(md) && /Dodge \+5/.test(md),
    "native affixes render exactly as before");
});

if (!process.exitCode) console.log(`\n${passed} passed`);

// ---------------------------------------------------------------------------
// #245 — the craft-carried line and the opt-out scope disclosure must ride
// every text export (the solve-visible-but-share-invisible invariant).

test("#339: the augment-ceiling disclosure reaches MD, CSV, print, BBCode", () => {
  const rec = {
    name: "Ceiling Build",
    inputs: { ml: 36, pool: "all", priorities: ["Intelligence"], augCeiling: 32 },
    // notice keys off the SOLVED query — a SIBLING of snapshot, the shape
    // serializeCharacter actually produces.
    query: { augCeiling: 32 },
    snapshot: {
      status: "optimal",
      chosen: [], setsActive: [], breakdown: {}, effective: {},
    },
  };
  assert.ok(/ML 32 and below/.test(toMarkdown(rec)), "markdown notice");
  const csv = toCsv(rec);
  assert.ok(/^Scope,/m.test(csv) && /ML 32 and below/.test(csv), "csv scope row");
  assert.ok(/ML 32 and below/.test(toPrintHtml(rec)), "print notice");
  assert.ok(/ML 32 and below/.test(toBBCode(rec)), "bbcode notice");
  delete rec.query.augCeiling;
  assert.ok(!/and below/.test(toMarkdown(rec)), "silent when unrestricted");
});

test("#339: a record built by the REAL serializeCharacter carries the notice into MD", () => {
  // Integration leg: no hand-shaped record — the persistence layer itself decides
  // where the solved query lives, and the export must find it there.
  const { serializeCharacter } = require("../web/persist.js");
  const state = { ml: 36, race: "Elf", pool: "all", priorities: ["Intelligence"], augCeiling: 32 };
  const lastRun = {
    query: { targets: ["Intelligence"], augCeiling: 32 },
    result: { status: "optimal", chosen: [], setsActive: [], breakdown: {}, effective: {} },
  };
  const md = toMarkdown(serializeCharacter("Ceiled", state, lastRun, "bid"));
  assert.ok(/ML 32 and below/.test(md), "the disclosure survives the real persistence shape");
});

// #346 (U4, AE5) — the sentence a player reads in the results must be the
// sentence a shared build carries, byte for byte. The notice family's standing
// rule exists because phrasing one in results and again in the exporters is how
// the app and an export come to disagree about the same solve.
test("#346: the ladder notice is byte-identical across results and all four exports", () => {
  const P = require("../web/projection.js");
  const R = require("../web/results.js");
  for (const rung of ["no-niche-crafting", "no-solar-lunar", "printed-only"]) {
    // The real writer stores `query` as a top-level SIBLING of `snapshot`
    // (serializeCharacter, web/persist.js) — RESULT_KEEP never admits a `query`
    // key into the snapshot, so the nested shape cannot exist on a real saved
    // character. Build the fixture the way production does or the parity claim
    // rests on a shape nothing produces.
    const rec = {
      name: "Parity", inputs: { ml: 9, pool: "all", priorities: ["Charisma"] },
      query: { craftingRung: rung },
      snapshot: { status: "optimal", chosen: [], setsActive: [], breakdown: {}, effective: {} },
    };
    const canonical = P.craftingExcludedLine(rec);
    assert.ok(canonical, `${rung} produces a sentence`);
    // results.js wraps the SAME string in its scope-note element.
    const html = R.craftingExcludedNotice({ craftingRung: rung }, { status: "optimal", augmentsPlaced: [], chosen: [] });
    assert.ok(html.includes(canonical.replace(/"/g, "&quot;")) || html.includes(canonical),
      `results renders the canonical ${rung} sentence verbatim`);
    for (const [label, out] of [["markdown", toMarkdown(rec)], ["csv", toCsv(rec)],
      ["print", toPrintHtml(rec)], ["bbcode", toBBCode(rec)]]) {
      assert.ok(out.includes(canonical) || out.includes(canonical.replace(/"/g, "&quot;")),
        `${label} carries the canonical ${rung} sentence, not a re-phrasing`);
    }
  }
});

test("#346: a craft-carried pick and the ladder notice reach MD, CSV, print, BBCode", () => {
  const carriedRec = {
    name: "Carried Build",
    inputs: { ml: 9, pool: "all", priorities: ["Charisma"] },
    snapshot: {
      status: "optimal",
      query: { craftingRung: "no-niche-crafting" },   // notice keys off the SOLVED query
      chosen: [
        { slot: "Weapon", variant: { variant_id: "Calamitous Sword", ml: 8,
          affixes: [], augment_slots_norm: { colors: [] }, set_bonus: [], parsed_set_bonuses: [] } },
      ],
      setsActive: [],
      breakdown: {
        Charisma: [
          { bonus_type: "Insight", value: 1, source: "Slot Melancholic Viktranium augment",
            sourceKind: "vik", slot: "Weapon", hostIds: ["Calamitous Sword"] },
        ],
      },
      effective: { Charisma: 1 },
    },
  };
  const md = toMarkdown(carriedRec);
  assert.ok(/⚒ Picked only for its crafts: Charisma \+1 \(Viktranium\)/.test(md), "markdown line");
  assert.ok(/Niche crafting was excluded/.test(md), "markdown notice");
  const csv = toCsv(carriedRec);
  assert.ok(/Picked only for its crafts: Charisma \+1 \(Viktranium\)/.test(csv), "csv crafting cell");
  assert.ok(/^Scope,/m.test(csv) && /Niche crafting was excluded/.test(csv), "csv scope row");
  const html = toPrintHtml(carriedRec);
  assert.ok(/⚒ Picked only for its crafts/.test(html) && /Niche crafting was excluded/.test(html), "print");
  const bb = toBBCode(carriedRec);
  assert.ok(/Picked only for its crafts/.test(bb), "bbcode line");
  assert.ok(/Niche crafting was excluded/.test(bb), "bbcode notice");
});

test("#245: a natively-earned loadout exports with no carried line and no notice", () => {
  const md = toMarkdown(rec);
  assert.ok(!/Picked only for its crafts/.test(md) && !/Niche crafting was excluded/.test(md));
});

// #110 U7/U9 — the blocklist disclosure reaches every prose export.
test("U7/#110: the block notice reaches MD, CSV, print, and BBCode", () => {
  const blockedRec = {
    name: "Blocked Build",
    inputs: { ml: 30, pool: "all", priorities: ["Intelligence"], blocklist: ["Lunar Gem of Abjuration (Heroic)"] },
    snapshot: {
      status: "optimal",
      chosen: [{ slot: "Ring", variant: { variant_id: "Some Ring", ml: 28, affixes: [],
        augment_slots_norm: { colors: [] }, set_bonus: [], parsed_set_bonuses: [] } }],
      setsActive: [],
      blockReport: [{ id: "Lunar Gem of Abjuration (Heroic)", name: "Lunar Gem of Abjuration (Heroic)",
        pool: "Moon-augment", bestAvailable: true }],
      effective: { Intelligence: 0 },
    },
  };
  for (const [label, fn, esc] of [["md", toMarkdown], ["csv", toCsv], ["print", toPrintHtml], ["bb", toBBCode]]) {
    const out = fn(blockedRec);
    assert.ok(/optimal given those exclusions/.test(out), `${label}: the qualified claim rides along`);
    assert.ok(/out-valued every remaining Moon-augment candidate/.test(out), `${label}: the attribution rides along`);
    assert.ok(!/would have/.test(out), `${label}: never counterfactual`);
  }
  const md = toMarkdown(rec);
  assert.ok(!/exclusions/.test(md), "an unblocked build carries no notice");
});

// #110 U9 — a shared build states its exclusions in the constraint header.
test("U9/#110: each prose export names the blocklist; an empty one adds no line", () => {
  const withBlocks = { name: "B", inputs: { ml: 30, pool: "all", priorities: ["Constitution"],
    blocklist: ["Gem One", "Gem Two", "Gem Three"] },
    snapshot: { status: "optimal", chosen: [], setsActive: [] } };
  for (const fn of [toMarkdown, toCsv, toPrintHtml, toBBCode]) {
    const out = fn(withBlocks);
    assert.ok(/Blocked/.test(out) && /3 — Gem One; Gem Two; Gem Three/.test(out));
  }
  assert.ok(!/Blocked/.test(toMarkdown(rec)), "no blocklist, no line");
});

test("U9/#110: a backup round trip reproduces the blocklist", () => {
  // The backup path imports persist's INPUT_KEYS (asserted in persist tests);
  // here the portable envelope's resolved view carries the constraint row.
  const withBlocks = { name: "B", inputs: { ml: 30, pool: "all", priorities: ["Constitution"],
    blocklist: ["Gem One"] },
    snapshot: { status: "optimal", chosen: [], setsActive: [] } };
  const envelope = toPortableJSON(withBlocks, "2026-08-12T00:00:00Z");   // returns the object; callers stringify
  assert.deepStrictEqual(envelope.core.inputs.blocklist, ["Gem One"], "the verbatim record carries it");
});

// ---------------------------------------------------------------------------
// #262 U3 — the no-drop-source disclosure must ride ALL SIX exports (the
// solve-visible-but-share-invisible invariant), exactly once per flagged item,
// and claim nothing stronger than the wiki evidence supports.

const ProjShared = require("../web/projection.js");
const NDS_WORDING = ProjShared.NO_DROP_SOURCE_WORDING;
// R5 — the stronger word is never claimed; spelled split so this guard's own
// source can't satisfy a naive grep for it.
const NDS_FORBIDDEN = "un" + "obtainable";
const countOf = (s, sub) => s.split(sub).length - 1;

function noDropRec() {
  return {
    name: "Flagged Build",
    inputs: { ml: 20, pool: "all", priorities: ["Constitution"] },
    snapshot: {
      status: "optimal",
      chosen: [
        { slot: "Bracers", variant: { variant_id: "Bracers of the Spider Queen", ml: 20,
          no_drop_source: true,
          affixes: [{ name: "Constitution", type: "Enhancement", value: 8 }],
          augment_slots_norm: { colors: [] }, set_bonus: [], parsed_set_bonuses: [] } },
        { slot: "Ring", variant: { variant_id: "Plain Ring", ml: 18, affixes: [],
          augment_slots_norm: { colors: [] }, set_bonus: [], parsed_set_bonuses: [] } },
      ],
      setsActive: [],
      effective: { Constitution: 8 },
    },
  };
}

test("#262: the wording is exact and reaches all six exports exactly once", () => {
  assert.strictEqual(NDS_WORDING, "no known live drop source");
  const flagged = noDropRec();
  for (const [label, fn] of [["md", toMarkdown], ["csv", toCsv], ["print", toPrintHtml],
    ["bb", toBBCode], ["gearset", toGearset]]) {
    const out = fn(flagged);
    assert.strictEqual(countOf(out, NDS_WORDING), 1, `${label}: the wording exactly once`);
    assert.ok(!out.toLowerCase().includes(NDS_FORBIDDEN), `${label}: never the stronger claim`);
  }
  const envelope = toPortableJSON(noDropRec(), "2026-08-12T00:00:00Z");
  const json = JSON.stringify(envelope);
  assert.strictEqual(countOf(json, NDS_WORDING), 1, "portable JSON: the wording exactly once");
  assert.ok(!json.toLowerCase().includes(NDS_FORBIDDEN), "portable JSON: never the stronger claim");
  const flaggedEntry = envelope.resolved.loadout.find((i) => i.slot === "Bracers");
  assert.strictEqual(flaggedEntry.noDropSource, NDS_WORDING,
    "the resolved view carries the field through Proj.project");
  assert.ok(!("noDropSource" in envelope.resolved.loadout.find((i) => i.slot === "Ring")),
    "an unflagged entry carries no field at all");
});

test("#262: an unflagged loadout carries the wording in NO export", () => {
  for (const fn of [toMarkdown, toCsv, toPrintHtml, toBBCode, toGearset]) {
    assert.ok(!fn(rec).includes(NDS_WORDING));
  }
  assert.ok(!JSON.stringify(toPortableJSON(rec, "2026-08-12T00:00:00Z")).includes(NDS_WORDING));
});

// ---------------------------------------------------------------------------
// U3 (#290/#291) — cross-added credit is labeled in every share export.
//
// End-to-end in the shape of tests/spell-focus-receipts.test.js: a snapshot whose
// Combustion breakdown carries a U2-stamped cross-added part, exported through the
// real pipeline. The label wording is "from <source stat>", one clause in the one
// shared sourceStr, so no format can drift.
function crossAddExportRec() {
  return {
    name: "Pyro",
    inputs: { ml: 34, pool: "all", priorities: ["Combustion"] },
    snapshot: {
      status: "optimal",
      chosen: [
        { slot: "Ring", variant: { variant_id: "Ember Band", ml: 34,
          affixes: [{ name: "Combustion", type: "Equipment", value: 100 }] } },
        { slot: "Necklace", variant: { variant_id: "Universal Torc", ml: 34,
          affixes: [{ name: "Universal Spell Power", type: "Implement", value: 50 }] } },
      ],
      effective: { Combustion: 150 },
      breakdown: {
        Combustion: [
          { bonus_type: "Equipment", value: 100, source: "Ember Band", sourceKind: "worn",
            slot: "Ring", hostIds: ["Ember Band"], via: null, crossAdd: null },
          { bonus_type: "Implement", value: 50, source: "Universal Torc", sourceKind: "worn",
            slot: "Necklace", hostIds: ["Universal Torc"], via: null,
            crossAdd: "Universal Spell Power" },
        ],
      },
      augmentsPlaced: [], setAugmentsPlaced: [], setsActive: [],
    },
  };
}

test("U3: the Markdown export labels the cross-added contribution 'from Universal Spell Power'", () => {
  const md = toMarkdown(crossAddExportRec());
  assert.ok(/Implement \+50 — Universal Torc via Necklace from Universal Spell Power/.test(md),
    `the source line carries the from-clause, got:\n${md}`);
  assert.ok(!/Ember Band via Ring from/.test(md), "the target's own part carries no from-clause");
});

test("U3: CSV and print carry the same from-clause through the shared sourceStr", () => {
  const csv = toCsv(crossAddExportRec());
  assert.ok(/Universal Torc via Necklace from Universal Spell Power/.test(csv), "CSV sources cell");
  const html = toPrintHtml(crossAddExportRec());
  assert.ok(/Universal Torc via Necklace from Universal Spell Power/.test(html), "print stat breakdown");
  const bb = toBBCode(crossAddExportRec());
  assert.ok(/Universal Torc via Necklace from Universal Spell Power/.test(bb), "BBCode stat breakdown");
});

test("U3: the portable ddo-loadout/v1 JSON carries crossAdd raw in resolved AND verbatim in core", () => {
  const env = toPortableJSON(crossAddExportRec(), "2026-08-13T00:00:00Z");
  const src = env.resolved.attribution.Combustion.sources.find((s) => s.source === "Universal Torc");
  assert.strictEqual(src.crossAdd, "Universal Spell Power", "resolved attribution carries the raw field");
  assert.strictEqual(env.resolved.attribution.Combustion.sources.find((s) => s.source === "Ember Band").crossAdd,
    null, "own part stays null");
  const corePart = env.core.snapshot.breakdown.Combustion.find((p) => p.source === "Universal Torc");
  assert.strictEqual(corePart.crossAdd, "Universal Spell Power", "core carries the breakdown verbatim");
});

test("U3: the .gearset record block still renders the achieved total (attribution totals-only, unchanged)", () => {
  // The gearset attribution section prints per-priority totals, never per-source
  // lines — same as via. Pin that a cross-added build's total renders and the
  // from-clause does not leak into the importable half.
  const gs = toGearset(crossAddExportRec());
  assert.ok(/1\. Combustion\s+150/.test(gs), "achieved total in the record block");
  const importable = gs.split("\n\n")[0];
  assert.ok(!/from Universal Spell Power/.test(importable), "importable half stays a pure gear list");
});

// ---- #91 (U6/R10) — the Utility tier renders on all six export surfaces ----

function utilityExportRec(report) {
  return {
    name: "Proc Carrier",
    inputs: { ml: 9, race: "Dwarf", pool: "all",
      priorities: ["Constitution", "Utility effects"] },
    snapshot: {
      status: "optimal",
      chosen: [
        { slot: "Main Hand", variant: { variant_id: "Echo of Whelm", ml: 9,
          affixes: [{ name: "Constitution", type: "Enhancement", value: 2 }] } },
      ],
      effective: { Constitution: 2 },
      breakdown: { Constitution: [
        { bonus_type: "Enhancement", value: 2, source: "Echo of Whelm", sourceKind: "worn", slot: "Main Hand", hostIds: ["Echo of Whelm"] },
      ] },
      setsActive: [],
      utilityReport: report !== undefined ? report : { count: 2, effects: [
        { name: "Ghost Touch", item: "Echo of Whelm" },
        { name: "Feather Falling", item: null },
      ] },
    },
  };
}

test("U6 (#91): Markdown carries the Utility section with per-effect receipts", () => {
  const md = toMarkdown(utilityExportRec());
  assert.ok(/## Utility effects \(2\)/.test(md), "section heading with the count");
  assert.ok(/2 utility effects on this loadout/.test(md), "the canonical line");
  assert.ok(/- Ghost Touch — from Echo of Whelm/.test(md), "effect — from item");
  assert.ok(/- Feather Falling\n/.test(md) && !/Feather Falling — from/.test(md),
    "an uncredited effect omits the from-clause rather than printing null");
});

test("U6 (#91): BBCode carries the Utility section", () => {
  const bb = toBBCode(utilityExportRec());
  assert.ok(/\[b\]Utility effects \(2\)\[\/b\]/.test(bb), "bold section heading");
  assert.ok(/2 utility effects on this loadout/.test(bb), "the canonical line");
  assert.ok(/\[\*\]Ghost Touch — from Echo of Whelm/.test(bb), "list receipts");
});

test("U6 (#91): CSV carries the Utility section rows", () => {
  const csv = toCsv(utilityExportRec());
  assert.ok(/Utility effects,2 utility effects on this loadout/.test(csv), "the canonical line row");
  assert.ok(/^Utility effect,From$/m.test(csv), "receipt table header");
  assert.ok(/^Ghost Touch,Echo of Whelm$/m.test(csv), "receipt row: name,item");
  assert.ok(/^Feather Falling,$/m.test(csv), "uncredited effect leaves the From cell empty");
});

test("U6 (#91): print HTML carries the Utility section", () => {
  const html = toPrintHtml(utilityExportRec());
  assert.ok(/<h2>Utility effects \(2\)<\/h2>/.test(html), "section heading");
  assert.ok(/2 utility effects on this loadout/.test(html), "the canonical line");
  assert.ok(/<li>Ghost Touch — from Echo of Whelm<\/li>/.test(html), "receipt list item");
});

test("U6 (#91): portable JSON round-trips the utility field shape", () => {
  const env = toPortableJSON(utilityExportRec(), "2026-08-15T00:00:00Z");
  assert.deepStrictEqual(env.resolved.utility.effects, [
    { name: "Ghost Touch", item: "Echo of Whelm" },
    { name: "Feather Falling", item: null },
  ], "resolved.utility carries {count, effects} with schema-stable naming");
  assert.strictEqual(env.resolved.utility.count, 2);
  assert.strictEqual(env.resolved.utility.line, "2 utility effects on this loadout");
  // Verbatim in core, and stable through a stringify/parse round trip.
  assert.strictEqual(env.core.snapshot.utilityReport.count, 2, "core carries the report verbatim");
  const rt = JSON.parse(JSON.stringify(env));
  assert.deepStrictEqual(rt.resolved.utility, env.resolved.utility, "round-trip preserves the shape");
});

test("U6 (#91): .gearset lists utility under the not-importable split + the priorities count", () => {
  const gs = toGearset(utilityExportRec());
  const [importable, record] = [gs.split("\n\n")[0], gs.split("\n\n").slice(1).join("\n\n")];
  assert.ok(!/Utility/.test(importable), "the importable half stays a pure gear list");
  assert.ok(/# Utility effects \(not importable — informational\)/.test(record), "record-block section");
  assert.ok(/#   Ghost Touch — from Echo of Whelm/.test(record), "receipt line");
  assert.ok(/#   2\. Utility effects  2/.test(record),
    "the ranked-priorities echo shows the achieved count, not '-'");
});

test("U6 (#91): zero-count renders the zero-state line on every surface", () => {
  const rec = utilityExportRec({ count: 0, effects: [] });
  const zero = "0 utility effects on this loadout — no counted on/off effects are present.";
  assert.ok(toMarkdown(rec).includes(zero), "markdown");
  assert.ok(toBBCode(rec).includes(zero), "bbcode");
  assert.ok(toCsv(rec).includes(zero), "csv");
  assert.ok(toPrintHtml(rec).includes(zero), "print html");
  assert.ok(toGearset(rec).includes(`#   ${zero}`), "gearset record block");
  assert.strictEqual(toPortableJSON(rec).resolved.utility.count, 0, "portable JSON");
  // No empty receipt scaffolding around the zero state.
  assert.ok(!/\[list\]\n\[\/list\]/.test(toBBCode(rec)), "no empty BBCode list");
  assert.ok(!/^Utility effect,From$/m.test(toCsv(rec)), "no empty CSV receipt table");
});

test("U6 (#91): ABSENT report → no Utility section on any surface", () => {
  const recAbsent = utilityExportRec(null);
  delete recAbsent.snapshot.utilityReport;
  recAbsent.inputs.priorities = ["Constitution"];   // no sentinel echo in headers either
  for (const [label, out] of [
    ["markdown", toMarkdown(recAbsent)], ["bbcode", toBBCode(recAbsent)],
    ["csv", toCsv(recAbsent)], ["print html", toPrintHtml(recAbsent)],
    ["gearset", toGearset(recAbsent)],
  ]) {
    assert.ok(!/Utility effect/i.test(out), `${label}: no utility section for a report-less snapshot`);
  }
  assert.ok(!("utility" in toPortableJSON(recAbsent).resolved), "portable JSON omits the field");
});

// #353 — presence rendering reaches EVERY export. The bug: every surface
// compared the type against "boolean" while the pipeline only ever emits "Bool",
// so exports printed `Ghostly +1 Bool` instead of `✓ Ghostly`, and the source
// line printed the raw type instead of "feature". Built through the real writer
// (`Proj.project`) rather than hand-shaped, per
// docs/solutions/conventions/fixture-shape-must-mirror-the-production-writer.md.
test("#353: a Bool-typed contribution renders as presence in the markdown export", () => {
  const presRec = {
    name: "Presence Export",
    inputs: { ml: 34, pool: "all", priorities: ["Ghostly"] },
    snapshot: {
      status: "optimal", effective: { Ghostly: 1 }, perTarget: { Ghostly: 1 },
      breakdown: { Ghostly: [{ bonus_type: "Bool", value: 1, source: "Belt of the Black Sands",
        sourceKind: "worn", slot: "Waist", slots: ["Waist"], hostIds: ["B"] }] },
      chosen: [{ slot: "Waist", variant: { variant_id: "Belt of the Black Sands", ml: 34,
        affixes: [{ name: "Ghostly", type: "Bool", value: 1 }] } }],
      setsActive: [],
    },
  };
  const md = toMarkdown(presRec);
  assert.ok(/✓ Ghostly/.test(md), "the item affix reads as a presence tick");
  assert.ok(!/Ghostly \+1/.test(md), "no magnitude for a presence affix");
  assert.ok(/feature/.test(md), "the source line names the type 'feature'");
  assert.ok(!/\bBool\b/.test(md), "the raw type name never reaches a share export");
});

test("#353: the legacy 'boolean' spelling renders identically", () => {
  // src/affix_parser.py's curated allowlist path would emit "boolean"; the build
  // installs no allowlist today, so it is inert — but both spellings must render
  // the same, which is why the predicate accepts either rather than canonicalizing.
  const legacy = {
    name: "Legacy Spelling",
    inputs: { ml: 34, pool: "all", priorities: ["Ghostly"] },
    snapshot: {
      status: "optimal", effective: { Ghostly: 1 }, perTarget: { Ghostly: 1 },
      breakdown: { Ghostly: [{ bonus_type: "boolean", value: 1, source: "Belt",
        sourceKind: "worn", slot: "Waist", slots: ["Waist"], hostIds: ["B"] }] },
      chosen: [{ slot: "Waist", variant: { variant_id: "Belt", ml: 34,
        affixes: [{ name: "Ghostly", type: "boolean", value: 1 }] } }],
      setsActive: [],
    },
  };
  const md = toMarkdown(legacy);
  assert.ok(/✓ Ghostly/.test(md), "presence tick for the legacy spelling too");
  assert.ok(/feature/.test(md), "same 'feature' type label");
});

// #332 — the ranked-but-uncounted disclosure reaches EVERY export. Standing
// invariant: a mechanic that is solve-visible must never be share-invisible.
// The record is shaped like a real solve result (utilityReport carrying
// rankedNotCounted, plus the breakdown that proves the loadout holds the stat).
const excludedRec = {
  name: "Excluded Proc",
  inputs: { ml: 34, pool: "all", priorities: ["Undead Bane", "Utility effects"] },
  snapshot: {
    status: "optimal", effective: { "Undead Bane": 13 }, perTarget: { "Undead Bane": 13 },
    breakdown: { "Undead Bane": [{ bonus_type: "Untyped", value: 13, source: "Echo of the Sunsword",
      sourceKind: "worn", slot: "Main Hand", slots: ["Main Hand"], hostIds: ["E"] }] },
    chosen: [{ slot: "Main Hand", variant: { variant_id: "Echo of the Sunsword", ml: 34,
      affixes: [{ name: "Undead Bane", value: 13 }] } }],
    setsActive: [],
    utilityReport: { count: 1, effects: [{ name: "Ghostly", item: "Belt" }],
      rankedNotCounted: ["Undead Bane"] },
  },
};

test("#332: every text export names a ranked-but-uncounted proc", () => {
  const want = /Undead Bane is ranked as its own priority/;
  assert.ok(want.test(toMarkdown(excludedRec)), "markdown");
  assert.ok(want.test(toBBCode(excludedRec)), "bbcode");
  assert.ok(want.test(toCsv(excludedRec)), "csv");
  assert.ok(want.test(toPrintHtml(excludedRec)), "print html");
  assert.ok(want.test(JSON.stringify(toPortableJSON(excludedRec, "2026-08-17T00:00:00Z"))),
    "portable ddo-loadout/v1 envelope");
});

test("#332: the portable envelope carries the exclusion as DATA, not just prose", () => {
  const env = toPortableJSON(excludedRec, "2026-08-17T00:00:00Z");
  assert.deepStrictEqual(env.resolved.utility.excluded, ["Undead Bane"],
    "a future import/compare reads the names, not a sentence it has to parse");
  assert.ok(env.resolved.utility.excludedLine, "and the rendered sentence beside them");
});

test("#332: nothing is said when no ranked proc was excluded", () => {
  const clean = JSON.parse(JSON.stringify(excludedRec));
  clean.snapshot.utilityReport.rankedNotCounted = [];
  const md = toMarkdown(clean);
  assert.ok(!/ranked as its own priority/.test(md), "no disclosure without an exclusion");
  const env = toPortableJSON(clean, "2026-08-17T00:00:00Z");
  assert.deepStrictEqual(env.resolved.utility.excluded, []);
  assert.strictEqual(env.resolved.utility.excludedLine, null, "null line, not an empty string");
});

test("#332: a stat the loadout does not carry is NOT named", () => {
  // "not counted" is a confusing thing to say about a stat with no sources at all.
  const noSources = JSON.parse(JSON.stringify(excludedRec));
  noSources.snapshot.breakdown = {};
  assert.ok(!/ranked as its own priority/.test(toMarkdown(noSources)),
    "an unsourced stat is left out of the sentence");
});

// ---------------------------------------------------------------------------
// U1 (plan 2026-08-17-001, #345) — the outbid disclosure reaches all six
// exports. Built through the shared writer, never hand-shaped: a hand-built
// record produced a false negative on this very channel during #353.
// ---------------------------------------------------------------------------

function outbidRec() {
  const r = disclosureRec({ saturation: false, empty: false });
  r.inputs.priorities = ["Deadly", "Freedom of Movement"];
  r.snapshot.perTarget = { Deadly: 13, "Freedom of Movement": 0 };
  // The set the solver stamps. A restored character has no model, so this is
  // the only thing the export path can read.
  r.snapshot.outbidReport = ["Freedom of Movement"];
  return r;
}

test("#345 U1: projection carries the outbid line for a stamped report", () => {
  const view = Projection.project(outbidRec());
  assert.ok(Array.isArray(view.character.outbidNotice), "the channel exists");
  assert.strictEqual(view.character.outbidNotice.length, 1, "one line for one outbid target");
  assert.ok(view.character.outbidNotice[0].includes("Freedom of Movement"), "names it");
});

test("#345 U1: an empty report produces no line", () => {
  const r = outbidRec();
  r.snapshot.outbidReport = [];
  assert.deepStrictEqual(Projection.project(r).character.outbidNotice, []);
});

test("#345 U1: all six exports carry the outbid disclosure", () => {
  const rec = outbidRec();
  const surfaces = [
    ["markdown", toMarkdown(rec)],
    ["bbcode", toBBCode(rec)],
    ["csv", toCsv(rec)],
    ["print html", toPrintHtml(rec)],
    ["portable json", JSON.stringify(toPortableJSON(rec))],
    ["gearset", toGearset(rec)],
  ];
  for (const [name, out] of surfaces) {
    assert.ok(typeof out === "string" && out.length, `${name} produced output`);
    assert.ok(out.includes("Freedom of Movement"),
      `${name} names the outbid target — solve-visible must never be share-invisible`);
    assert.ok(/scored 0|outbid/i.test(out), `${name} carries the disclosure, not just the stat name`);
  }
});

// ---------------------------------------------------------------------------
// #348 (U5, R14) — the container's misses and the priced top miss reach every
// share surface. The standing rule is that a mechanic is never solve-visible but
// share-invisible: a recipient who cannot re-solve would otherwise receive a
// loadout whose container silently omits the effect the player most wanted.
// ---------------------------------------------------------------------------

function containerRec(price) {
  const r = disclosureRec({ saturation: false, empty: false });
  r.snapshot.utilityReport = { count: 1, effects: [{ name: "Blurry", item: "Some Trinket" }] };
  r.snapshot.utilityOrdered = {
    secured: ["Blurry"],
    unsecured: [{ name: "Ghostly", reason: "outbid" }, { name: "Deathblock", reason: "unreachable" }],
    price: price === undefined ? { name: "Ghostly", stat: "Deadly", give: 2, free: false } : price,
  };
  return r;
}

test("#348 U5: all six exports carry the container's misses and the priced top miss", () => {
  const rec = containerRec();
  const surfaces = [
    ["markdown", toMarkdown(rec)],
    ["bbcode", toBBCode(rec)],
    ["csv", toCsv(rec)],
    ["print html", toPrintHtml(rec)],
    ["portable json", JSON.stringify(toPortableJSON(rec))],
    ["gearset", toGearset(rec)],
  ];
  for (const [name, out] of surfaces) {
    assert.ok(typeof out === "string" && out.length, `${name} produced output`);
    assert.ok(out.includes("Ghostly"), `${name} names the unsecured effect`);
    assert.ok(/at least 2 Deadly/.test(out) || name === "gearset",
      `${name} carries the price, not just the name`);
  }
});

test("#348 U5: the three price outcomes read as three different sentences", () => {
  const line = (p) => Projection.utilityPriceLine(p);
  const priced = line({ name: "Ghostly", stat: "Deadly", give: 2, free: false });
  const free = line({ name: "Ghostly", stat: "Deadly", give: 0, free: true });
  const blocked = line({ name: "Ghostly", stat: "Deadly", give: null, infeasible: true, blockedByHigherOrder: true });
  const stuck = line({ name: "Ghostly", stat: "Deadly", give: null, infeasible: true, blockedByHigherOrder: false });

  assert.ok(/at least 2 Deadly/.test(priced), "a real price states the give and that it is a floor");
  // The zero case is the most common on the parity set (7 of 17) and the easiest to
  // get wrong: "costs 0 Deadly" reads as free, when the effect is unsecured
  // precisely because something blocks it. It must not render as a number.
  assert.ok(!/0 Deadly/.test(free), "a zero give never renders as a numeric price");
  assert.ok(/costs nothing on Deadly/.test(free) && /lower-ranked/.test(free),
    `the zero case locates the block instead: ${free}`);
  assert.ok(/an effect you placed above it/.test(blocked), "ordering-blocked says so");
  assert.ok(/nothing you can equip/.test(stuck), "structurally blocked says so");
  assert.strictEqual(line(null), null, "no price, no sentence");
});

test("#348 U5: a snapshot predating the container asserts nothing about it", () => {
  const r = disclosureRec({ saturation: false, empty: false });
  r.snapshot.utilityReport = { count: 1, effects: [{ name: "Blurry", item: "Some Trinket" }] };
  delete r.snapshot.utilityOrdered;      // saved before #348
  const view = Projection.project(r);
  assert.strictEqual(view.utility.ordered, null, "no container is invented");
  assert.deepStrictEqual(view.utility.unsecuredLines, [], "and nothing is claimed unsecured");
  assert.strictEqual(view.utility.priceLine, null);
  const md = toMarkdown(r);
  assert.ok(!/Not secured/.test(md), "the export stays silent rather than implying a full container");
});


// ---- #88 U9 (R15) — no export is solve-visible but share-invisible ----------
// The standing invariant: a mechanic the solve used reaches every export by
// default. An override changes which bucket a value counts in, so a recipient who
// cannot see it cannot reproduce the build they were handed.
test("#88 U9 (R15/R16): every export carries the overrides in force, naming both types", () => {
  const withOverride = JSON.parse(JSON.stringify(rec));
  withOverride.snapshot.overrideReport = {
    inForce: [{ variant_id: "Page Regalia", name: "Dodge", from: "Armor", to: "Quality", count: 1 }],
    contributions: [{ stat: "Dodge", from: "Armor", to: "Quality", host: "Page Regalia", value: 5 }],
  };
  const outputs = {
    markdown: toMarkdown(withOverride),
    csv: toCsv(withOverride),
    print: toPrintHtml(withOverride),
    bbcode: toBBCode(withOverride),
    gearset: toGearset(withOverride),
    portable: JSON.stringify(toPortableJSON(withOverride)),
  };
  for (const [name, out] of Object.entries(outputs)) {
    assert.ok(/Dodge/.test(out), `${name} names the overridden affix`);
    assert.ok(/Quality/.test(out) && /Armor/.test(out),
      `${name} names both the asserted and the catalog type`);
  }
});

test("#88 U9: a build with no overrides exports exactly as it did before", () => {
  // R3's shape: the line is omitted entirely rather than printed empty, so an
  // unoverridden build's exports are byte-identical to the pre-feature ones.
  for (const out of [toMarkdown(rec), toCsv(rec), toPrintHtml(rec), toBBCode(rec)]) {
    assert.ok(!/corrected/i.test(out), "no override line at all");
  }
});
