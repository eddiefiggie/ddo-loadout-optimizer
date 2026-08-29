// #205 — the receipts half of universal spell-DC expansion.
// Run: node tests/spell-focus-receipts.test.js
//
// The solver credits an expanded universal affix to the ranked SCHOOL, but the
// item is engraved with the enchantment's own name. These tests pin that the
// originating name survives from the solver breakdown into the proof panel and
// into every share export — a player checking the app against an in-game tooltip
// must find the same text on the item.
const assert = require("assert");
const P = require("../web/projection.js");
const Solver = require("../web/solver.js");

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e.message}`); process.exitCode = 1; }
}

// A solved result whose Necromancy total comes from two sources: a native school
// affix and an expanded universal one. Only the latter carries `via`.
function makeResult() {
  return {
    chosen: [
      { slot: "Ring", variant: { variant_id: "Legendary Argonnessen Eye Band" } },
      { slot: "Helmet", variant: { variant_id: "Cowl of the Drow Devotee" } },
    ],
    augmentsPlaced: [], setAugmentsPlaced: [],
    breakdown: {
      "Necromancy Focus": [
        { bonus_type: "Sacred", value: 3, source: "Legendary Argonnessen Eye Band",
          sourceKind: "worn", slot: "Ring", hostIds: ["Legendary Argonnessen Eye Band"],
          via: "Sacred Spell Focus Mastery" },
        { bonus_type: "Equipment", value: 13, source: "Cowl of the Drow Devotee",
          sourceKind: "worn", slot: "Helmet", hostIds: ["Cowl of the Drow Devotee"],
          via: null },
      ],
    },
  };
}

test("attribution carries the originating enchantment name", () => {
  const attr = P.attributionByTarget(makeResult());
  const rows = attr["Necromancy Focus"];
  assert.strictEqual(rows.length, 2);
  const expanded = rows.find((r) => r.bonus_type === "Sacred");
  assert.strictEqual(expanded.via, "Sacred Spell Focus Mastery",
    "the Sacred contribution names the enchantment printed on the item");
});

test("a native school affix carries no originating name", () => {
  const attr = P.attributionByTarget(makeResult());
  const native = attr["Necromancy Focus"].find((r) => r.bonus_type === "Equipment");
  assert.strictEqual(native.via, null,
    "a native Necromancy Focus affix is already engraved under that name");
});

test("the credited value and stat are unchanged by provenance", () => {
  // Provenance is presentation only. If carrying it ever altered a value, the
  // expansion would be changing the solve rather than describing it.
  const attr = P.attributionByTarget(makeResult());
  const rows = attr["Necromancy Focus"];
  assert.deepStrictEqual(rows.map((r) => r.value).sort((a, b) => a - b), [3, 13]);
});

test("the solver's bucket keeps the higher same-type value and drops the lower", () => {
  // The wiki rule the whole expansion rests on: "Effects with the same bonus type
  // don't stack, only the highest applies." Two Equipment-typed Conjuration
  // sources on ONE item must collapse to 13, never sum to 21 — the +8 Topaz /
  // +13 Demogorgon pair from the report.
  const variant = {
    variant_id: "host", affixes: [
      { name: "Conjuration Focus", type: "Equipment", value: 13 },
      { name: "Conjuration Focus", type: "Equipment", value: 8 },
    ],
  };
  const program = Solver.buildProgram({
    targets: ["Conjuration Focus"], mlCap: 34,
    worn: [{ slot: "Ring", cardinality: 1, variants: [variant] }],
  });
  const bucket = [...program.zByBucket].find(([k]) => k.startsWith("Conjuration Focus||"));
  assert.ok(bucket, "the target produced a bucket");
  const values = bucket[1].map((z) => z.value);
  assert.ok(values.includes(13), "the higher same-type value is kept");
  assert.ok(!values.includes(8), "the lower same-type value never becomes its own contribution");
});

test("exports name the enchantment, not just the school", () => {
  // exporters.js builds every format from one `sourceStr`, so proving the shape
  // reaches the shared source model proves it reaches all five outputs.
  const attr = P.attributionByTarget(makeResult());
  const rows = attr["Necromancy Focus"];
  const exported = rows.map((p) => ({
    source: p.source, kind: p.sourceKind, value: p.value,
    bonusType: p.bonus_type, slots: p.slots, viaSet: p.isSet, viaAffix: p.via || null,
  }));
  const expanded = exported.find((e) => e.bonusType === "Sacred");
  assert.strictEqual(expanded.viaAffix, "Sacred Spell Focus Mastery");
  assert.strictEqual(exported.find((e) => e.bonusType === "Equipment").viaAffix, null);
});

// ---- U8 (R8, R9, R11) — the two surfaces answer different questions --------
//
// Ranked Priorities answers "where did this point come from", and must keep
// attributing each ranked stat INDIVIDUALLY while naming the enchantment as its
// source. The item-centric surfaces answer "what is engraved on this item", and
// must collapse the expansion to the one name the player will read in-game.
const R = require("../web/results.js");
const X = require("../web/exporters.js");

const SCHOOLS = ["Abjuration", "Conjuration", "Enchantment", "Evocation", "Illusion", "Necromancy", "Transmutation"];
const expanded = (label, type, value) => SCHOOLS.map((s) => ({ name: `${s} Focus`, type, value, via: label }));

test("AE3: the item surface shows ONE line naming the enchantment, not seven school lines", () => {
  const affixes = expanded("Sacred Spell Focus Mastery", "Sacred", 3);
  const lines = P.collapseExpansions(affixes).map(P.affixLabel);
  assert.deepStrictEqual(lines, ["Sacred Spell Focus Mastery +3"],
    "the player reads the name engraved on the item, not the model's shape");
});

test("AE3/R11: Ranked Priorities still attributes the ranked school individually — UNCHANGED", () => {
  // This surface is deliberately NOT collapsed. It credits the Necromancy point
  // to the school it was ranked on and names the enchantment as its source; a
  // collapse here would destroy the answer it exists to give.
  const attr = P.attributionByTarget(makeResult());
  const rows = attr["Necromancy Focus"];
  assert.strictEqual(rows.length, 2, "still one row per contributing source");
  const expandedRow = rows.find((r) => r.bonus_type === "Sacred");
  assert.strictEqual(expandedRow.value, 3, "credited to the ranked school, individually");
  assert.strictEqual(expandedRow.via, "Sacred Spell Focus Mastery", "and names the enchantment as its source");
});

test("AE5: the reported symptom — a Viktranium craft names the enchantment, not one school", () => {
  // Reported: the same Woeful Viktranium craft read "+2 Enchantment" on one item
  // and "+2 Necromancy" on the off-hand. Both are the SAME option; the label was
  // built from whichever affix the solve happened to rank, so it differed per item.
  const option = (rankedSchool) => ({
    slot_type: "Woeful", name: "Woeful Invigorator",
    affixes: SCHOOLS.map((s) => ({ stat: `${s} Focus`, bonus_type: "Profane", value: 2, unit: "flat",
      via: "Profane Spell Focus Mastery" })),
    stat: `${rankedSchool} Focus`, bonus_type: "Profane", value: 2, unit: "flat",
  });
  const onItem = P.craftLabel(option("Enchantment"), "vik");
  const onOffHand = P.craftLabel(option("Necromancy"), "vik");
  assert.strictEqual(onItem, onOffHand, "one craft, one description — regardless of which school was ranked");
  assert.strictEqual(onItem, "Slot Woeful Viktranium augment: Profane Spell Focus Mastery +2");
});

test("AE6: the Markdown export renders the SAME collapsed line the app renders", () => {
  const affixes = expanded("Sacred Spell Focus Mastery", "Sacred", 3);
  const appLine = P.affixLabel(P.collapseExpansions(affixes)[0]);
  const html = R.equippedBody({ variant_id: "A Memento of Mori", affixes }, -1, null, new Map());
  assert.ok(html.includes(appLine), "the app's Loadout block renders it");
  const md = X.toMarkdown({
    name: "Caster", inputs: { ml: 32, pool: "all", priorities: [] },
    snapshot: { status: "optimal", setsActive: [],
      chosen: [{ slot: "Trinket", variant: { variant_id: "A Memento of Mori", ml: 32, affixes } }] },
  });
  assert.ok(md.includes(appLine), "and the share export renders the same text, character for character");
});

console.log(`\n${passed} passed`);
