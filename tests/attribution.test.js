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
    affixes: affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, name: stat, type: bonus_type, value, unit: "flat" })),
    scaling: [], set_bonus: [], augment_slots: [],
  };
}
function slot(name, variants, card = 1) { return { slot: name, cardinality: card, variants }; }
const AUG_FITS_SLOTS = { Blue: ["Blue", "Purple", "Green"] };
function augment(id, color, affixes) {
  return {
    variant_id: id, source_item: id, category: "augment", slot: color,
    aug_color: { color, raw: color, reason: null }, fits_slots: AUG_FITS_SLOTS[color] || [],
    affixes: affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, name: stat, type: bonus_type, value, unit: "flat" })),
    scaling: [], set_bonus: [], augment_slots: [],
  };
}
function setHost(id, slotName, affixes, setName, colors, tiers) {
  const v = item(id, slotName, affixes);
  v.set_bonus = [{ set: setName }];
  v.augment_slots_norm = { colors: colors || [], quarantined: [] };
  v.parsed_set_bonuses = (tiers || []).map((t) => ({
    set: setName, pieces_required: t.n, pieces_label: `${t.n} Pieces`,
    affixes: t.affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, name: stat, type: bonus_type, value, unit: "flat" })),
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


  // ---- U3 — a declared credit is attributed AS declared (R8) ------------------
  const Proj = require("../web/projection.js");
  const credit = (stat, bonus_type, value) => ({ stat, bonus_type, value });
  const creditModel = (extra) => Object.assign({
    targets: ["CM"], mlCap: 34, dodgeCap: null,
    credits: [credit("CM", "Insight", 7)],
    worn: [slot("Ring", [item("ring", "Ring", [["CM", "Enhancement", 5]])])],
  }, extra || {});

  await test("U3: a credit appears as a contributor marked declared, with no slot", async () => {
    const r = await S.solveLexicographic(creditModel(), highs);
    assert.strictEqual(r.effective.CM, 12, "premise: 7 credit + 5 enhancement across buckets");

    const part = r.breakdown.CM.find((p) => p.bonus_type === "Insight");
    assert.ok(part, "the credit is present in the breakdown");
    assert.strictEqual(part.sourceKind, "declared",
      `a gateless contribution must resolve to the declared kind, got ${part.sourceKind}`);
    assert.ok(part.source && /declar/i.test(part.source),
      `its label must say it was declared, got ${JSON.stringify(part.source)}`);
    assert.strictEqual(part.slot, null, "a credit occupies no slot");
    assert.strictEqual(part.hostIds, null, "and is driven by no item");
  });

  await test("U3: a credit is distinguishable from gear with the same value", async () => {
    // Same stat AND same bonus type is impossible (one bucket, one contributor),
    // so the honest comparison is same stat + same value in a different bucket.
    const r = await S.solveLexicographic(creditModel({ credits: [credit("CM", "Insight", 5)] }), highs);
    const parts = r.breakdown.CM;
    assert.strictEqual(parts.length, 2);
    const dec = parts.find((p) => p.sourceKind === "declared");
    const gear = parts.find((p) => p.sourceKind === "worn");
    assert.ok(dec && gear, "one of each kind");
    assert.strictEqual(dec.value, gear.value, "premise: identical magnitudes");
    assert.notStrictEqual(dec.source, gear.source, "but they must not read the same");
  });

  await test("U3: a credit that lost its bucket does not appear as a contributor", async () => {
    const r = await S.solveLexicographic(creditModel({
      credits: [credit("CM", "Insight", 4)],
      worn: [slot("Ring", [item("ring", "Ring", [["CM", "Insight", 9]])])],
    }), highs);
    assert.strictEqual(r.effective.CM, 9);
    assert.ok(!r.breakdown.CM.some((p) => p.sourceKind === "declared"),
      "the beaten credit contributes nothing and must not be listed");
  });

  await test("U3: the credit stays in the breakdown under a cap, and the sum reconciles", async () => {
    // Under a cap nothing forces a contributor's z to 1 once the stat reaches its
    // bound. Pre-existing for gear, but a CREDIT vanishing from a clamped breakdown
    // reads as a new bug — U1's per-bucket floor is what keeps it pinned.
    const r = await S.solveLexicographic(creditModel({ userCaps: { CM: 9 } }), highs);
    assert.strictEqual(r.effective.CM, 9, "clamped to the cap");
    const dec = r.breakdown.CM.find((p) => p.sourceKind === "declared");
    assert.ok(dec, "the credit must still be listed under a clamped total");
    assert.strictEqual(dec.value, 7);
    const raw = r.breakdown.CM.reduce((s, p) => s + p.value, 0);
    assert.ok(raw >= r.effective.CM, `raw ${raw} must be >= clamped ${r.effective.CM}`);
  });

  await test("U3: the equipped-item explanation never attributes a credit to an item", async () => {
    const r = await S.solveLexicographic(creditModel(), highs);
    assert.ok(r.chosen.some((c) => c.variant.variant_id === "ring"), "premise: the ring is equipped");
    const wins = Proj.whyThis(r, { slot: "Ring", variant_id: "ring" });
    const cm = wins.find((w) => w.stat === "CM");
    assert.ok(cm, "the ring wins CM");
    assert.strictEqual(cm.value, 5, `the ring is credited with 5, not the credit's 7 — got ${cm.value}`);
  });

  await test("U3: the projection carries the declared kind through to the view", async () => {
    const r = await S.solveLexicographic(creditModel(), highs);
    const attr = Proj.attributionByTarget(r);
    const dec = (attr.CM || []).find((c) => c.sourceKind === "declared");
    assert.ok(dec, "attributionByTarget must surface the declared contributor");
    assert.deepStrictEqual(dec.slots, [], "no slots to show");
    assert.deepStrictEqual(dec.hostIds, [], "and no host item");
    assert.strictEqual(dec.isSet, false);
  });


  await test("U3: a credited SOLVE reaches every export labelled — no hand-built breakdown", async () => {
    // The end-to-end guard. The per-format tests in exporters.test.js hand-build a
    // breakdown, so they prove only that the exporter echoes its input — they pass
    // against the pre-U3 tree. This one runs a real solve through
    // breakdownByTarget -> projection.project -> each exporter, which is the chain
    // U3 claims "cannot drift apart".
    const X = require("../web/exporters.js");
    const r = await S.solveLexicographic(creditModel(), highs);
    assert.strictEqual(r.breakdown.CM.find((p) => p.sourceKind === "declared").source,
      S.DECLARED_LABEL, "premise: the solver tagged it");

    const rec = { name: "E2E", inputs: { ml: 34, pool: "all", priorities: ["CM"] }, snapshot: r };
    for (const [fmt, fn] of [["markdown", X.toMarkdown], ["bbcode", X.toBBCode],
                             ["csv", X.toCsv], ["print", X.toPrintHtml]]) {
      const out = fn(rec);
      assert.ok(out.includes(S.DECLARED_LABEL),
        `${fmt} must carry the solver's declared label end to end`);
      assert.ok(!/undefined/.test(out), `${fmt} must not leak an undefined source`);
    }
  });

  await test("U3 (#290/#291): a cross-added SOLVE reaches every export labelled — no hand-built breakdown", async () => {
    // Same end-to-end contract as the declared-credit guard above: the per-format
    // tests in exporters.test.js hand-build a breakdown, so they prove only that
    // the exporter echoes its input. This runs a REAL solve with the cross-add map
    // installed, through breakdownByTarget -> projection -> each exporter, and
    // demands the "from Universal Spell Power" label — plus the app's own
    // attributionList receipt row.
    const X = require("../web/exporters.js");
    const Proj = require("../web/projection.js");
    const CAM = require("../web/model.js");
    CAM.setCrossAdd({ Combustion: ["Universal Spell Power"] });
    try {
      const model = {
        targets: ["Combustion"], mlCap: 34, dodgeCap: null,
        worn: [
          slot("Ring", [item("Ember Band", "Ring", [["Combustion", "Equipment", 100]])]),
          slot("Necklace", [item("Universal Torc", "Necklace", [["Universal Spell Power", "Implement", 50]])]),
        ],
      };
      const r = await S.solveLexicographic(model, highs);
      assert.strictEqual(r.breakdown.Combustion.find((p) => p.value === 50).crossAdd,
        "Universal Spell Power", "premise: the solver stamped it (U2)");

      const attr = Proj.attributionByTarget(r);
      const xa = attr.Combustion.find((c) => c.value === 50);
      assert.strictEqual(xa.crossAdd, "Universal Spell Power", "projection forwards the marker");
      assert.ok(/from Universal Spell Power/.test(R.attributionList(attr.Combustion)),
        "the Ranked Priorities receipt row labels it");

      const rec = { name: "E2E", inputs: { ml: 34, pool: "all", priorities: ["Combustion"] }, snapshot: r };
      for (const [fmt, fn] of [["markdown", X.toMarkdown], ["bbcode", X.toBBCode],
                               ["csv", X.toCsv], ["print", X.toPrintHtml]]) {
        const out = fn(rec);
        assert.ok(out.includes("from Universal Spell Power"),
          `${fmt} must carry the cross-add label end to end`);
        assert.ok(!/undefined/.test(out), `${fmt} must not leak an undefined field`);
      }
      const env = X.toPortableJSON(rec, "2026-08-13T00:00:00Z");
      assert.strictEqual(env.resolved.attribution.Combustion.sources.find((s) => s.value === 50).crossAdd,
        "Universal Spell Power", "the portable JSON carries the raw field");
    } finally { CAM.setCrossAdd({}); }
  });

  console.log(`\n${passed} passed`);
})();
