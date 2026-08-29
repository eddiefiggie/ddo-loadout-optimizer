// #206 — a zero-value augment is never recommended.
// Run: node tests/no-op-augments.test.js
//
// HONEST SCOPE: these are "nothing changed" guards, and they pass against the
// pre-change tree. The reported behavior was never reproduced — a sweep of all
// golden fixtures plus the reporter's own priority list found zero no-op
// placements, because HiGHS happens to leave an unconstrained placement binary at
// 0. What changed is that the model now *decides* it rather than inheriting it
// from branch order. These tests pin the outcome so a future regression from
// either direction — a solver upgrade, a program restructure, a new constraint
// that flips the branch — fails here instead of shipping a loadout that tells the
// player to farm an augment worth nothing.
"use strict";
const assert = require("assert");
const path = require("path");
const S = require("../web/solver.js");

const ROOT = path.join(__dirname, "..");

let passed = 0;
async function test(name, fn) {
  try { await fn(); console.log("  PASS", name); passed++; }
  catch (e) { console.log("  FAIL", name, "\n   ", e.stack || e.message); process.exitCode = 1; }
}

function item(id, slot, affixes, colors) {
  return {
    variant_id: id, source_item: id, slot,
    affixes: affixes.map(([stat, bt, v]) => ({
      stat, bonus_type: bt, name: stat, type: bt, value: v, unit: "flat",
    })),
    scaling: [], set_bonus: [], augment_slots: [],
    augment_slots_norm: colors ? { colors, quarantined: [] } : undefined,
  };
}

function augment(id, color, affixes) {
  return {
    variant_id: id, source_item: id, aug_color: { color }, fits_slots: [color],
    affixes: affixes.map(([stat, bt, v]) => ({
      stat, bonus_type: bt, name: stat, type: bt, value: v, unit: "flat",
    })),
    scaling: [], set_bonus: [],
  };
}

const slot = (name, variants, card = 1) => ({ slot: name, cardinality: card, variants });

(async () => {
  const Highs = require(path.join(ROOT, "web", "vendor", "highs.js"));
  const highs = await Highs({ locateFile: (f) => path.join(ROOT, "web", "vendor", f) });

  await test("a strictly redundant augment is not recommended", async () => {
    // The reported shape: a +13 same-type source on the host, and a +8 augment of
    // the SAME name and SAME bonus type. Per the wiki, same type does not stack —
    // only the highest applies — so the augment is worth exactly zero.
    const host = item("Host", "Ring", [["Conjuration Focus", "Equipment", 13]], ["Yellow"]);
    const aug = augment("Topaz of Conjured Power", "Yellow",
      [["Conjuration Focus", "Equipment", 8]]);
    const r = await S.solveLexicographic({
      targets: ["Conjuration Focus"], mlCap: 34,
      worn: [slot("Ring", [host])], augments: [aug],
    }, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.perTarget["Conjuration Focus"], 13,
      "same bonus type takes the highest — never the sum");
    assert.deepStrictEqual(r.augmentsPlaced || [], [],
      "an augment contributing nothing must not be recommended");
  });

  await test("an augment that does contribute is still recommended", async () => {
    // The discriminator. Without this, the test above would also pass against a
    // solver that had simply stopped placing augments at all.
    const host = item("Host", "Ring", [["Conjuration Focus", "Equipment", 13]], ["Yellow"]);
    const aug = augment("Topaz of Insightful Conjuration", "Yellow",
      [["Conjuration Focus", "Insight", 4]]);   // different type -> stacks
    const r = await S.solveLexicographic({
      targets: ["Conjuration Focus"], mlCap: 34,
      worn: [slot("Ring", [host])], augments: [aug],
    }, highs);
    assert.strictEqual(r.perTarget["Conjuration Focus"], 17, "different types stack: 13 + 4");
    assert.deepStrictEqual((r.augmentsPlaced || []).map((a) => a.variant_id),
      ["Topaz of Insightful Conjuration"],
      "a contributing augment is still placed");
  });

  await test("the better of two same-type augments is the one recommended", async () => {
    const host = item("Host", "Ring", [["Conjuration Focus", "Equipment", 2]], ["Yellow"]);
    const weak = augment("Topaz of Conjuration", "Yellow", [["Conjuration Focus", "Equipment", 5]]);
    const strong = augment("Topaz of Conjured Power", "Yellow", [["Conjuration Focus", "Equipment", 8]]);
    const r = await S.solveLexicographic({
      targets: ["Conjuration Focus"], mlCap: 34,
      worn: [slot("Ring", [host])], augments: [weak, strong],
    }, highs);
    assert.strictEqual(r.perTarget["Conjuration Focus"], 8, "the host's 2 is dominated by the 8");
    assert.deepStrictEqual((r.augmentsPlaced || []).map((a) => a.variant_id),
      ["Topaz of Conjured Power"], "only the winning augment is placed");
  });

  console.log(`\n${passed} passed`);
})();
