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
    targets: ["Conjuration Focus"], mlCap: 34, dodgeCap: null,
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

console.log(`\n${passed} passed`);
