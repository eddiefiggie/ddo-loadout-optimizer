// #340 — bundled enchantments on the Sets tab and in every sets-rendering export.
// Run: node tests/bundles.test.js
//
// A multi-stat engraved bundle (Profane Well Rounded, Profane Potency) is fully
// credited but was invisible as a unit: the app rendered its expanded members and
// nothing named the bundle. These tests pin the display-only grouping: items' AND
// placed augments' via-stamped affixes group into named bundles with their
// carrier, 2+ members only, and the grouping reaches the app's Sets tab and all
// five share exports from the one shared content model.
const assert = require("assert");
const P = require("../web/projection.js");
const R = require("../web/results.js");
const X = require("../web/exporters.js");

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e.message}`); process.exitCode = 1; }
}

const ABILITIES = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"];
const ELEMENTS = ["Fire", "Cold", "Acid", "Electric"];

// Mirrors the real expanded shape: six ability affixes, all stamped with the
// engraved name the item carries in-game.
const wellRounded = () => ABILITIES.map((s) => ({ name: s, type: "Profane", value: 2, via: "Profane Well Rounded" }));
// An augment's umbrella spread — element spellpowers under one engraved name.
const potency = () => ELEMENTS.map((e) => ({ name: `${e} Spellpower`, type: "Profane", value: 10, via: "Profane Potency" }));

const LITANY = "Essence of the Epic Litany of the Dead";
const GEM = "Lunar Gem of Spellpower";

function makeResult() {
  return {
    status: "optimal", setsActive: [],
    chosen: [{
      slot: "Trinket",
      variant: {
        variant_id: LITANY, ml: 34,
        affixes: [
          ...wellRounded(),
          // A native affix (no via) and a single-member rename (via with ONE
          // member) ride along — neither may become a bundle.
          { name: "Spot", type: "Enhancement", value: 15 },
          { name: "Accuracy", type: "Enhancement", value: 27, via: "Legendary Accuracy" },
        ],
      },
    }],
    augmentsPlaced: [{ variant_id: GEM, color: "Lunar", affixes: potency() }],
    setAugmentsPlaced: [],
  };
}

function makeRec() {
  return { name: "Bundler", inputs: { ml: 34, pool: "all", priorities: [] }, snapshot: makeResult() };
}

test("AE4: an item's via-stamped multi-member affixes group into one named bundle", () => {
  const groups = P.bundleGroups(makeResult());
  const wr = groups.filter((g) => g.name === "Profane Well Rounded");
  assert.strictEqual(wr.length, 1, "one group per carrier occurrence");
  assert.strictEqual(wr[0].carrier, LITANY, "carrier is the item name");
  assert.strictEqual(wr[0].members.length, 6, "all six ability members ride the entry");
  assert.deepStrictEqual(wr[0].members.map((m) => m.name), ABILITIES);
  // The entry shape carries per-member value AND bonus type — collapseExpansions'
  // collapsed entries drop both, which is why this is its own shape.
  for (const m of wr[0].members) {
    assert.strictEqual(m.value, 2);
    assert.strictEqual(m.type, "Profane");
  }
});

test("AE5: a placed augment's via-stamped spread groups with the augment as carrier", () => {
  // The NEW augment-affix path — augment affixes are never collapsed anywhere
  // else, so nothing but this grouping exercises it.
  const groups = P.bundleGroups(makeResult());
  const pot = groups.filter((g) => g.name === "Profane Potency");
  assert.strictEqual(pot.length, 1);
  assert.strictEqual(pot[0].carrier, GEM, "carrier is the augment name");
  assert.deepStrictEqual(pot[0].members.map((m) => m.name), ELEMENTS.map((e) => `${e} Spellpower`));
});

test("a single-member via group (a rename, a retype) never appears as a bundle", () => {
  const groups = P.bundleGroups(makeResult());
  assert.ok(!groups.some((g) => g.name === "Legendary Accuracy"),
    "the Legendary fold stamps via on ONE member — a one-line bundle would be a lie");
});

test("guard: the positive-arm affix records carry no cross-add key (KTD5)", () => {
  // Cross-add lives in metadata.cross_add and on attribution parts, never on
  // item/augment affix arrays — so the grouping needs no exclusion branch. If a
  // cross-add key ever lands on an affix record, this fixture assumption (and
  // the no-branch design) is void.
  const r = makeResult();
  const all = [...r.chosen[0].variant.affixes, ...r.augmentsPlaced[0].affixes];
  assert.ok(all.length >= 10, "guard inspects real records, not an empty list");
  for (const a of all) {
    assert.ok(!("crossAdd" in a) && !("cross_add" in a),
      `affix ${a.name} must not carry a cross-add key`);
  }
});

test("two carriers of the same bundle produce two entries", () => {
  const r = makeResult();
  r.chosen.push({ slot: "Ring", variant: { variant_id: "Second Carrier Ring", ml: 30, affixes: wellRounded() } });
  const wr = P.bundleGroups(r).filter((g) => g.name === "Profane Well Rounded");
  assert.strictEqual(wr.length, 2);
  assert.deepStrictEqual(wr.map((g) => g.carrier).sort(), ["Second Carrier Ring", LITANY].sort());
});

test("a loadout with no multi-member via groups yields no bundles and no section", () => {
  const r = {
    status: "optimal", setsActive: [],
    chosen: [{ slot: "Trinket", variant: { variant_id: "Plain Trinket", ml: 30, affixes: [
      { name: "Spot", type: "Enhancement", value: 15 },
      { name: "Accuracy", type: "Enhancement", value: 27, via: "Legendary Accuracy" },
    ] } }],
    augmentsPlaced: [], setAugmentsPlaced: [],
  };
  assert.deepStrictEqual(P.bundleGroups(r), []);
  assert.strictEqual(R.bundlesBlock(r, new Map()), "", "the Sets tab renders no third block");
  const md = X.toMarkdown({ name: "Plain", inputs: { ml: 30, pool: "all", priorities: [] }, snapshot: r });
  assert.ok(!md.includes("Bundled enchantment"), "no export section either");
});

test("the Sets tab block names the bundle, its members, and its carrier — not set-shaped", () => {
  const html = R.bundlesBlock(makeResult(), new Map());
  assert.ok(html.includes("Profane Well Rounded"));
  assert.ok(html.includes(`from ${LITANY}`));
  assert.ok(html.includes("Profane Potency"));
  assert.ok(html.includes(`from ${GEM}`));
  assert.ok(html.includes("single-source, not sets"), "the copy says what these are");
  assert.ok(!/pieces/i.test(html) && !/tier/i.test(html), "no piece counts, no tier language (R6)");
});

test("R8: the Markdown export renders the SAME bundle line the app renders", () => {
  // The app row and the export row both render the members through affixLabel,
  // so the member text must match character for character (the cross-export
  // parity precedent from the spell-focus receipts).
  const groups = P.bundleGroups(makeResult());
  const wr = groups.find((g) => g.name === "Profane Well Rounded");
  const memberText = wr.members.map(P.affixLabel).join(", ");
  const appHtml = R.bundlesBlock(makeResult(), new Map());
  assert.ok(appHtml.includes(memberText), "the app's Sets tab renders the member list");
  const md = X.toMarkdown(makeRec());
  assert.ok(md.includes(memberText), "and the share export renders the same text");
  assert.ok(md.includes("Profane Well Rounded"));
  assert.ok(md.includes(`from ${LITANY}`));
});

test("R8: every sets-rendering export includes the grouping when bundles exist", () => {
  const rec = makeRec();
  const outputs = {
    markdown: X.toMarkdown(rec),
    bbcode: X.toBBCode(rec),
    csv: X.toCsv(rec),
    printHtml: X.toPrintHtml(rec),
    gearset: X.toGearset(rec),
  };
  for (const [fmt, out] of Object.entries(outputs)) {
    assert.ok(out.includes("Bundled enchantment"), `${fmt} carries the bundled-enchantments section`);
    assert.ok(out.includes("Profane Well Rounded"), `${fmt} names the item bundle`);
    assert.ok(out.includes("Profane Potency"), `${fmt} names the augment bundle`);
  }
  // The portable JSON inherits the resolved view wholesale.
  const pj = X.toPortableJSON(rec, "2026-08-16T00:00:00Z");
  assert.strictEqual(pj.resolved.bundles.length, 2);
});

// ---- #370 — crafted bundles ------------------------------------------------
//
// A bundle earned by CRAFTING is the same engraved multi-stat enchantment as one
// printed on the item, but `bundleGroups` scanned only items and augments, so 43
// via-carrying crafted options (24 Viktranium, 12 Nearly Complete, 7 Dino
// inserts) could never name themselves — solve-visible, share-invisible. These
// pin the three multi-affix channels, their host attribution, and the fact that
// the flat single-affix channels cannot reach the 2+ member floor at all.

const SWORD = "Legendary Calamitous Bastard Sword";
const DINO_RING = "Dinosaur Bone Ring";

// The real shape of a via-stamped Viktranium option: one craft, seven schools.
const SCHOOLS = ["Abjuration", "Conjuration", "Divination", "Enchantment", "Evocation", "Illusion", "Necromancy"];
const schoolSpread = (bonus_type, via) =>
  SCHOOLS.map((s) => ({ stat: `${s} Focus`, bonus_type, value: 2, unit: "flat", via }));

function craftResult() {
  return {
    status: "optimal", setsActive: [],
    chosen: [
      { slot: "Main Hand", variant: { variant_id: SWORD, ml: 34, affixes: [] } },
      { slot: "Ring", variant: { variant_id: DINO_RING, ml: 32, affixes: [], dino_slots_norm: ["Dread||Accessory"] } },
    ],
    augmentsPlaced: [], setAugmentsPlaced: [],
    vikPlaced: [{
      item: SWORD, slot_type: "Woeful", category: "Weapon",
      name: "Woeful: Exceptional Spell Focus Mastery",
      affixes: schoolSpread("Exceptional", "Exceptional Spell Focus Mastery"),
    }],
    ncPlaced: [{
      item: SWORD, category: "Skills", pool: "Nearly Finished", name: "Exceptional Strength Skills",
      affixes: [
        { stat: "Jump", bonus_type: "Exceptional", value: 3, unit: "flat", via: "Exceptional Strength Skills" },
        { stat: "Swim", bonus_type: "Exceptional", value: 3, unit: "flat", via: "Exceptional Strength Skills" },
      ],
    }],
    dinoPlaced: [{
      dino_type: "Dread", category: "Accessory", name: "Dread Potency",
      affixes: [
        { stat: "Fire Spell Power", bonus_type: "Profane", value: 10, unit: "flat", via: "Profane Potency" },
        { stat: "Cold Spell Power", bonus_type: "Profane", value: 10, unit: "flat", via: "Profane Potency" },
      ],
    }],
    // Flat single-affix channels — one affix each, no `affixes` array, no `via`.
    rollPlaced: [{ item: SWORD, stat: "Deadly", bonus_type: "Insight", value: 4 }],
    sealPlaced: [{ item: SWORD, seal_type: "Undeath", stat: "Melee Power", bonus_type: "Profane", value: 3 }],
    tfPlaced: [{ item: SWORD, tier: 3, stat: "Accuracy", bonus_type: "Enhancement", value: 8 }],
    gsPlaced: [{ item: SWORD, name: "Air/Air", stat: "Doubleshot", bonus_type: "Enhancement", value: 5 }],
  };
}

test("#370: a Viktranium craft's via-stamped spread becomes a bundle, hosted on the item it was crafted into", () => {
  const g = P.bundleGroups(craftResult()).find((b) => b.name === "Exceptional Spell Focus Mastery");
  assert.ok(g, "the crafted bundle is surfaced at all — it was invisible before #370");
  assert.strictEqual(g.carrierKind, "craft");
  assert.strictEqual(g.host, SWORD, "the machine-readable host is the equipped item");
  assert.strictEqual(g.craftFamily, "vik");
  assert.strictEqual(g.craftName, "Woeful: Exceptional Spell Focus Mastery");
  assert.strictEqual(g.members.length, 7);
  // The display carrier names BOTH, so the "from X" grammar every export already
  // prints stays correct without a per-format edit.
  assert.strictEqual(g.carrier, `${SWORD} (Slot Woeful Viktranium augment)`);
});

test("#370: a Nearly Complete craft names the pool it actually came from, not the category path's name", () => {
  const g = P.bundleGroups(craftResult()).find((b) => b.name === "Exceptional Strength Skills");
  assert.ok(g);
  assert.strictEqual(g.craftFamily, "nc");
  assert.strictEqual(g.carrier, `${SWORD} (Nearly Finished)`,
    "the per-item pool is a different in-game system from Nearly Completed (#371)");
});

test("#370: a Dino insert's host comes from the shared assignment, not a second walk", () => {
  const g = P.bundleGroups(craftResult()).find((b) => b.name === "Profane Potency");
  assert.ok(g);
  assert.strictEqual(g.host, DINO_RING, "the insert lands on the item whose dino slot accepts it");
  assert.strictEqual(g.carrier, `${DINO_RING} (Dread insert)`);
});

test("#370 guard: the flat single-affix craft channels cannot form a bundle", () => {
  // Not an assertion about the scan list — an assertion about the DATA. These
  // four channels store one stat per placement with no `affixes` array, so the
  // 2+ member floor is unreachable by construction. If that ever changes, this
  // fixture assumption (and the decision to leave them unscanned) is void.
  const r = craftResult();
  for (const key of ["rollPlaced", "sealPlaced", "tfPlaced", "gsPlaced"]) {
    assert.ok(r[key].length, `${key} guard inspects a real record, not an empty list`);
    for (const o of r[key]) {
      assert.ok(!Array.isArray(o.affixes), `${key} records carry no affixes array`);
    }
  }
  const names = P.bundleGroups(r).map((b) => b.name);
  assert.deepStrictEqual(
    names.sort(),
    ["Exceptional Spell Focus Mastery", "Exceptional Strength Skills", "Profane Potency"].sort(),
    "exactly the three multi-affix channels contribute bundles");
});

test("#370: a crafted bundle reaches the Sets tab and every sets-rendering export", () => {
  const r = craftResult();
  const html = R.bundlesBlock(r, new Map());
  assert.ok(html.includes("Exceptional Spell Focus Mastery"), "the Sets tab names the crafted bundle");
  assert.ok(html.includes(`from ${SWORD} (Slot Woeful Viktranium augment)`), "and says where to craft it");
  const rec = { name: "Crafter", inputs: { ml: 34, pool: "all", priorities: [] }, snapshot: r };
  for (const [fmt, out] of Object.entries({
    markdown: X.toMarkdown(rec), bbcode: X.toBBCode(rec), csv: X.toCsv(rec),
    printHtml: X.toPrintHtml(rec), gearset: X.toGearset(rec),
  })) {
    assert.ok(out.includes("Exceptional Spell Focus Mastery"), `${fmt} carries the crafted bundle`);
  }
  const pj = X.toPortableJSON(rec, "2026-08-19T00:00:00Z");
  assert.strictEqual(pj.resolved.bundles.filter((b) => b.carrierKind === "craft").length, 3);
});

console.log(`\n${passed} passed`);
