// U4 — slot-level attribution (breakdownByTarget host slots) + attributionByTarget
// + whyThis. Presentation-only readers over existing solution state; run against
// the REAL HiGHS engine. Run: node tests/attribution.test.js
const assert = require("assert");
const path = require("path");
const S = require("../web/solver.js");
const R = require("../web/results.js");
const vendor = path.join(__dirname, "..", "web", "vendor") + "/";
const Highs = require(vendor + "highs.js");

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  PASS", name); }
  catch (e) { console.log("  FAIL", name, "\n   ", e.message); process.exitCode = 1; }
}

function item(id, slot, affixes) {
  return {
    variant_id: id, source_item: id, slot,
    affixes: affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, value, unit: "flat" })),
    scaling: [], set_bonus: [], augment_slots: [],
  };
}
function slot(name, variants, card = 1) { return { slot: name, cardinality: card, variants }; }
const AUG_FITS_SLOTS = { Blue: ["Blue", "Purple", "Green"] };
function augment(id, color, affixes) {
  return {
    variant_id: id, source_item: id, category: "augment", slot: color,
    aug_color: { color, raw: color, reason: null }, fits_slots: AUG_FITS_SLOTS[color] || [],
    affixes: affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, value, unit: "flat" })),
    scaling: [], set_bonus: [], augment_slots: [],
  };
}
function setHost(id, slotName, affixes, setName, colors, tiers) {
  const v = item(id, slotName, affixes);
  v.set_bonus = [{ set: setName }];
  v.augment_slots_norm = { colors: colors || [], quarantined: [] };
  v.parsed_set_bonuses = (tiers || []).map((t) => ({
    set: setName, pieces_required: t.n, pieces_label: `${t.n} Pieces`,
    affixes: t.affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, value, unit: "flat" })),
    flagged: [],
  }));
  return v;
}

(async () => {
  const highs = await Highs({ locateFile: (f) => vendor + f });

  // A worn ring (Enhancement + a Blue augment) + a plain necklace, both members of
  // a 2-piece set granting Insightful Constitution.
  const tier = [{ n: 2, affixes: [["Constitution", "Insightful", 5]] }];
  const mixModel = () => ({
    targets: ["Constitution"], mlCap: 34, dodgeCap: null,
    worn: [
      slot("Ring", [setHost("R", "Ring", [["Constitution", "Enhancement", 10]], "Alpha", ["Blue"], tier)], 1),
      slot("Necklace", [setHost("N", "Necklace", [], "Alpha", [], tier)]),
    ],
    augments: [augment("AugCon", "Blue", [["Constitution", "Quality", 3]])],
  });

  await test("breakdown carries the host slot for worn contributions", async () => {
    const r = await S.solveLexicographic(mixModel(), highs);
    assert.strictEqual(r.status, "optimal");
    const worn = r.breakdown.Constitution.find((p) => p.sourceKind === "worn");
    assert.ok(worn, "a worn contribution exists");
    assert.strictEqual(worn.slot, "Ring", "worn contribution attributes to its slot");
  });

  await test("breakdown carries the equipped slots yielding a set", async () => {
    const r = await S.solveLexicographic(mixModel(), highs);
    const set = r.breakdown.Constitution.find((p) => p.sourceKind === "set");
    assert.ok(set, "a set contribution exists");
    assert.deepStrictEqual([...set.setYieldingSlots].sort(), ["Necklace", "Ring"],
      "the set attributes to both equipped pieces yielding it");
  });

  await test("attributionByTarget resolves slots for worn, set, and augment", async () => {
    const r = await S.solveLexicographic(mixModel(), highs);
    const attr = R.attributionByTarget(r).Constitution;
    const worn = attr.find((p) => p.sourceKind === "worn");
    const set = attr.find((p) => p.isSet);
    const aug = attr.find((p) => p.sourceKind === "augment");
    assert.deepStrictEqual(worn.slots, ["Ring"]);
    assert.deepStrictEqual([...set.slots].sort(), ["Necklace", "Ring"]);
    assert.deepStrictEqual(aug.slots, ["Ring"], "augment attributes to its reconstructed host slot");
  });

  await test("whyThis names the ranked target an item wins and by how much", async () => {
    const r = await S.solveLexicographic(mixModel(), highs);
    const ring = R.whyThis(r, { slot: "Ring", variant_id: "R" });
    assert.strictEqual(ring.length, 1, "the ring wins one ranked target");
    assert.strictEqual(ring[0].stat, "Constitution");
    // worn 10 + set 5 (Ring yields it) + augment 3 (hosted on the ring) = 18
    assert.strictEqual(ring[0].value, 18);
    assert.strictEqual(ring[0].viaSet, true);
  });

  await test("whyThis shows a piece that only contributes via the set (swap impact)", async () => {
    const r = await S.solveLexicographic(mixModel(), highs);
    const neck = R.whyThis(r, { slot: "Necklace", variant_id: "N" });
    assert.strictEqual(neck.length, 1);
    assert.strictEqual(neck[0].stat, "Constitution");
    assert.strictEqual(neck[0].value, 5, "the necklace contributes only the set's Insightful 5");
    assert.strictEqual(neck[0].viaSet, true);
  });

  await test("whyThis is empty for a pick that wins no ranked target", async () => {
    const r = await S.solveLexicographic(mixModel(), highs);
    assert.deepStrictEqual(R.whyThis(r, { slot: "Boots", variant_id: "ZZZ" }), []);
  });

  await test("capped stat: raw contributions may exceed the capped effective value", async () => {
    const r = await S.solveLexicographic({
      targets: ["Dodge"], mlCap: 34, dodgeCap: 5,
      worn: [slot("Boots", [item("B", "Boots", [["Dodge", "Enhancement", 10]])])],
      augments: [],
    }, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.Dodge, 5, "headline is the capped value");
    const parts = r.breakdown.Dodge;
    const rawSum = parts.reduce((s, p) => s + p.value, 0);
    assert.strictEqual(rawSum, 10, "raw contribution is above the cap");
    assert.ok(rawSum > r.effective.Dodge, "naive sum != effective for a capped stat");
    assert.strictEqual(parts[0].slot, "Boots", "the capped contributor still attributes to its slot");
  });

  await test("U4: whyThis flags a boolean win; whyThisLine renders presence not +1", async () => {
    const r = await S.solveLexicographic({
      targets: ["Salt"], mlCap: 34, dodgeCap: null,
      worn: [slot("Trinket", [item("T", "Trinket", [["Salt", "boolean", 1]])])],
    }, highs);
    const wins = R.whyThis(r, { slot: "Trinket", variant_id: "T" });
    assert.strictEqual(wins.length, 1);
    assert.strictEqual(wins[0].stat, "Salt");
    assert.strictEqual(wins[0].boolean, true, "the win is flagged boolean");
    const line = R.whyThisLine(r, { slot: "Trinket", variant_id: "T" });
    assert.ok(line.includes("✓ Salt"), "presence marker in the why-this line");
    assert.ok(!line.includes("+1"), "no magnitude for a boolean win");
  });

  await test("U4: attributionList renders a boolean contribution as presence", async () => {
    const html = R.attributionList([{
      bonus_type: "boolean", value: 1, source: "Some Trinket", sourceKind: "worn",
      slots: ["Trinket"], hostIds: ["T"], isSet: false,
    }]);
    assert.ok(html.includes("✓"), "presence glyph, not a magnitude");
    assert.ok(html.includes("feature"), "type labeled 'feature', not 'boolean'");
    assert.ok(!html.includes("+1"), "no +1 for a boolean contribution");
  });

  console.log(`\n${passed} passed`);
})();
