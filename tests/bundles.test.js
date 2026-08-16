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

console.log(`\n${passed} passed`);
