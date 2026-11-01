// #951 — real catalog -> normalizer -> model -> HiGHS. The set is carried by
// both pinned items; its one bonus must activate only at two pieces, once.
// Wiki revisions and the shared-parser audit: docs/wiki-evidence/adamancy-luck.md.
"use strict";
const assert = require("assert");
const { test, fail } = require("./_harness");
const { solveEnv } = require("./parity/capture_golden.js");
const { buildModel } = require("../web/model.js");
const { solveLexicographic } = require("../web/solver.js");

const SET = "Unbreakable Adamancy";
const HELMET = "Epic Minos Legens";
const ARMOR = "Epic Chain of Conviction";
const TARGETS = ["Physical Sheltering", "Magical Sheltering"];

(async () => {
  const { dataset, highs } = await solveEnv();
  const members = dataset.items.filter((x) => (x.sets || []).includes(SET));

  await test("Adamancy: every catalog member carries the two-piece Luck bonus", () => {
    assert.ok(members.length > 0, "no set members inspected");
    for (const item of members) {
      const tiers = item.parsed_set_bonuses.filter((t) => t.set === SET);
      assert.strictEqual(tiers.length, 1, item.variant_id);
      assert.strictEqual(tiers[0].pieces_required, 2, item.variant_id);
      assert.deepStrictEqual(tiers[0].flagged, []);
      assert.deepStrictEqual(tiers[0].affixes.map((a) =>
        [a.stat, a.bonus_type, a.value, a.unit]).sort(),
      TARGETS.map((stat) => [stat, "Luck", 5, "flat"]).sort(), item.variant_id);
    }
  });

  async function solve(withArmor, credit) {
    const ids = withArmor ? [HELMET, ARMOR] : [HELMET];
    const items = dataset.items.filter((x) => ids.includes(x.variant_id));
    assert.strictEqual(items.length, ids.length, "real fixture items must exist");
    const slotConstraints = { Helmet: { type: "pin", variant_id: HELMET } };
    if (withArmor) slotConstraints.Armor = { type: "pin", variant_id: ARMOR };
    // Declared values exercise the existing player-input path, not invented gear.
    const declaredCredits = credit == null ? {} : Object.fromEntries(TARGETS.map((stat) =>
      [`${stat}||Luck`, { stat, bonus_type: "Luck", value: credit }]));
    const result = await solveLexicographic(buildModel(items, {
      mlCap: 27, targets: TARGETS, slotConstraints, declaredCredits,
    }), highs);
    assert.strictEqual(result.status, "optimal");
    assert.deepStrictEqual(result.chosen.map((x) => x.variant.variant_id).sort(), ids.sort());
    return result;
  }

  await test("Adamancy: one piece grants only the helmet's 24 Enhancement PRR/MRR", async () => {
    const r = await solve(false);
    assert.deepStrictEqual(r.perTarget, { "Physical Sheltering": 24, "Magical Sheltering": 24 });
    assert.deepStrictEqual(r.setsActive, []);
    for (const stat of TARGETS) {
      assert.ok(!r.breakdown[stat].some((a) => a.bonus_type === "Luck"));
    }
  });

  await test("Adamancy: two pieces add exactly 5 Luck beside 24 Enhancement PRR/MRR", async () => {
    const r = await solve(true);
    assert.deepStrictEqual(r.perTarget, { "Physical Sheltering": 29, "Magical Sheltering": 29 });
    for (const stat of TARGETS) {
      const luck = r.breakdown[stat].filter((a) => a.bonus_type === "Luck");
      assert.strictEqual(luck.length, 1, "two member definitions must not double-count the bonus");
      assert.strictEqual(luck[0].value, 5);
      assert.strictEqual(luck[0].sourceKind, "set");
    }
  });

  await test("Adamancy: lower, equal and higher Luck credits use only the highest value", async () => {
    for (const [credit, total] of [[3, 29], [5, 29], [7, 31]]) {
      const r = await solve(true, credit);
      for (const stat of TARGETS) {
        assert.strictEqual(r.perTarget[stat], total, `${stat}, declared Luck ${credit}`);
        const luck = r.breakdown[stat].filter((a) => a.bonus_type === "Luck");
        assert.strictEqual(luck.length, 1);
        assert.strictEqual(luck[0].value, Math.max(5, credit));
      }
    }
  });
})().catch((err) => fail("Adamancy setup", err));
