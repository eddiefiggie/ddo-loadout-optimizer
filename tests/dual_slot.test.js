// #915 — dual-slot items (Chains, Five Rings, Shackles), against the REAL HiGHS.
// Run: node tests/dual_slot.test.js
//
// Each is worn in either of two slots, as its wiki tips state. The model offers the
// item in both under its own id and the solver caps that at one physical item; a
// wiki-duplicable item (not Exclusive, not a Minor Artifact) also gets a second copy
// in the other slot, tied to the copy in its own slot — the #902 weapon pattern.
const assert = require("assert");
const path = require("path");
const S = require("../web/solver.js");
const M = require("../web/model.js");

const vendor = path.join(__dirname, "..", "web", "vendor") + "/";
const Highs = require(vendor + "highs.js");
const { atest: test } = require("./_harness");

const aff = (rows) => rows.map(([stat, bonus_type, value]) =>
  ({ stat, bonus_type, name: stat, type: bonus_type, value, unit: "flat" }));
function item(id, slot, affixes, extra) {
  return Object.assign({ variant_id: id, source_item: id, slot, category: "item", type: `${slot} items`,
    affixes: aff(affixes), scaling: [], set_bonus: [], augment_slots: [], verification: "verified", ml: 8 },
  extra || {});
}
const chains = (extra) => item("Chains", "Necklace", [["Strength", "Enhancement", 5]],
  Object.assign({ alt_slots: ["Belt"] }, extra || {}));
const ids = (r, slot) => r.chosen.filter((c) => c.slot === slot).map((c) => c.variant.variant_id);
const solve = (highs, variants, q) => S.solveLexicographic(M.buildModel(variants, Object.assign({ mlCap: 34 }, q)), highs);
const colorless = { augment_slots_norm: { colors: ["Colorless"], quarantined: [] } };
const aug = (id, stat) => ({ variant_id: id, source_item: id, slot: "Augment", category: "augment",
  aug_color: { color: "Colorless", raw: "Colorless", reason: null }, fits_slots: ["Colorless"],
  affixes: aff([[stat, "Enhancement", 6]]), scaling: [], set_bonus: [], augment_slots: [], verification: "verified", ml: 1 });

(async () => {
  const highs = await Highs({ locateFile: (f) => vendor + f });

  await test("#915: a dual-slot item fills its OTHER slot when its own is better spent", async () => {
    const neck = item("Better Necklace", "Necklace", [["Strength", "Insight", 9]]);
    const r = await solve(highs, [chains(), neck], { targets: ["Strength"] });
    assert.strictEqual(r.status, "optimal");
    assert.deepStrictEqual(ids(r, "Necklace"), ["Better Necklace"]);
    assert.deepStrictEqual(ids(r, "Belt"), ["Chains"], "Chains is worn as a belt");
    assert.strictEqual(r.perTarget.Strength, 14);
  });

  await test("#915: one physical item fills one slot — an unstamped item is never in both", async () => {
    const r = await solve(highs, [chains(colorless), aug("Str Aug", "Strength"), aug("Dex Aug", "Dexterity")],
      { targets: ["Strength", "Dexterity"] });
    const worn = [...ids(r, "Necklace"), ...ids(r, "Belt")];
    assert.deepStrictEqual(worn, ["Chains"], "one copy, in one slot");
    assert.strictEqual(r.perTarget.Dexterity || 0, 0, "one copy, one Colorless slot");
  });

  await test("#915: a duplicable item is worn twice, one copy per slot, each with its own crafting", async () => {
    const r = await solve(highs, [chains(Object.assign({ duplicable_worn: true }, colorless)),
      aug("Str Aug", "Strength"), aug("Dex Aug", "Dexterity")], { targets: ["Strength", "Dexterity"] });
    assert.strictEqual(r.status, "optimal");
    assert.deepStrictEqual(ids(r, "Necklace"), ["Chains"]);
    assert.deepStrictEqual(ids(r, "Belt"), [M.twinIdOf("Chains")], "the belt holds the second copy");
    assert.strictEqual(r.perTarget.Dexterity, 6, "two copies, two Colorless slots, both augments placed");
  });

  await test("#915: the second copy is never chosen without the first in the item's own slot", async () => {
    const neck = item("Pinned Necklace", "Necklace", [["Constitution", "Enhancement", 9]]);
    const r = await solve(highs, [chains(Object.assign({ duplicable_worn: true }, colorless)), neck,
      aug("Str Aug", "Strength"), aug("Dex Aug", "Dexterity")], { targets: ["Strength", "Dexterity"],
      slotConstraints: { Necklace: { type: "pin", variant_id: "Pinned Necklace" } } });
    assert.deepStrictEqual(ids(r, "Necklace"), ["Pinned Necklace"]);
    assert.deepStrictEqual(ids(r, "Belt"), ["Chains"], "the one copy moves to the belt, as itself");
  });

  await test("#915: a pin in the other slot holds, and pinning both slots equips two copies", async () => {
    const belt = item("Better Belt", "Belt", [["Strength", "Insight", 9]]);
    const one = await solve(highs, [chains(), belt], { targets: ["Strength"],
      slotConstraints: { Belt: { type: "pin", variant_id: "Chains" } } });
    assert.deepStrictEqual(ids(one, "Belt"), ["Chains"], "pinned as a belt, it is a belt");
    const pin = { type: "pin", variant_id: "Chains" };
    const both = await solve(highs, [chains({ duplicable_worn: true }), belt], { targets: ["Strength"],
      slotConstraints: { Necklace: pin, Belt: pin } });
    assert.strictEqual(both.status, "optimal");
    assert.deepStrictEqual(ids(both, "Necklace"), ["Chains"]);
    assert.deepStrictEqual(ids(both, "Belt"), [M.twinIdOf("Chains")]);
  });

  await test("#915: Five Rings fills the Trinket slot when both rings are better spent", async () => {
    const five = item("Five Rings", "Ring", [["Wisdom", "Enhancement", 5]], { alt_slots: ["Trinket"] });
    const r1 = item("Ring A", "Ring", [["Wisdom", "Insight", 7]]);
    const r2 = item("Ring B", "Ring", [["Wisdom", "Quality", 6]]);
    const r = await solve(highs, [five, r1, r2], { targets: ["Wisdom"] });
    assert.deepStrictEqual(ids(r, "Ring").sort(), ["Ring A", "Ring B"]);
    assert.deepStrictEqual(ids(r, "Trinket"), ["Five Rings"]);
    assert.strictEqual(r.perTarget.Wisdom, 18);
  });

  await test("#915: an item with no second copy must not prune a peer in either of its slots", () => {
    const peer = item("Plain Belt", "Belt", [["Strength", "Enhancement", 3]]);
    const ts = new Set(["Strength"]);
    const keptOne = M.dominanceFilter([chains(), peer], ts, 34);
    assert.ok(keptOne.some((v) => v.variant_id === "Plain Belt"),
      "Chains may be forced into the necklace, so the belt peer stays");
    const keptTwo = M.dominanceFilter([chains({ duplicable_worn: true }), peer], ts, 34);
    assert.ok(!keptTwo.some((v) => v.variant_id === "Plain Belt"),
      "with a second copy Chains can always fill the belt, so the prune is sound");
  });

  await test("#915: second copies are appended, leaving every existing x-var index fixed", () => {
    const worn = (v) => [{ slot: "Necklace", cardinality: 1, variants: [v] }, { slot: "Belt", cardinality: 1, variants: [v] }];
    const plain = S.buildProgram({ targets: ["Strength"], mlCap: 34, worn: worn(chains()) });
    const prog = S.buildProgram({ targets: ["Strength"], mlCap: 34, worn: worn(chains({ duplicable_worn: true })) });
    assert.strictEqual(prog.xVars.length, plain.xVars.length + 1);
    plain.xVars.forEach((xv, i) => assert.strictEqual(prog.xVars[i].name, xv.name));
    const tw = prog.xVars[prog.xVars.length - 1];
    assert.strictEqual(tw.slot, "Belt");
    assert.strictEqual(tw.twinOf, prog.xVars.find((x) => x.slot === "Necklace").name);
    assert.ok(plain.extraConstraints.includes("x0 + x1 <= 1"), "the one-copy cap");
  });

  await test("#915: the pin picker offers both slots and honors the one chosen", () => {
    const Wz = require("../web/wizard.js");
    assert.deepStrictEqual(Wz.pinHandsFor(chains()), ["Necklace", "Belt"]);
    assert.strictEqual(Wz.pinWornSlotOf(chains(), "Belt"), "Belt");
    assert.strictEqual(Wz.pinWornSlotOf(chains(), "Off Hand"), "Necklace", "a slot it cannot fill is ignored");
    assert.strictEqual(Wz.pinWornSlotOf(chains()), "Necklace");
  });

  await test("#915: browse lists a dual-slot item under both of its slots", () => {
    const B = require("../web/browse.js");
    const items = [chains(), item("Plain Belt", "Belt", [])];
    assert.deepStrictEqual(B.filterVariants(items, { slot: "Belt" }).map((v) => v.variant_id), ["Chains", "Plain Belt"]);
    assert.deepStrictEqual(B.filterVariants(items, { slot: "Necklace" }).map((v) => v.variant_id), ["Chains"]);
  });

  await test("#915: the real dataset carries the six dual-slot items, each duplicable", () => {
    const d = require("../web/data/items.json");
    const dual = d.items.filter((v) => (v.alt_slots || []).length);
    const got = Object.fromEntries(dual.map((v) => [v.source_item, [v.slot, ...v.alt_slots]]));
    assert.deepStrictEqual(got, {
      "Chains": ["Necklace", "Belt"], "Legendary Chains": ["Necklace", "Belt"],
      "Five Rings": ["Ring", "Trinket"], "Legendary Five Rings": ["Ring", "Trinket"],
      "Shackles": ["Bracers", "Boots"], "Legendary Shackles": ["Bracers", "Boots"],
    });
    assert.ok(dual.every((v) => v.duplicable_worn === true), "none is Exclusive or a Minor Artifact");
    assert.deepStrictEqual(d.metadata.dual_slot_coverage, { dual_slot_items: 6, duplicable: 6 });
    assert.ok(dual.every((v) => (v.slavers_slots || []).length === 4), "each copy keeps its Slaver's slots");
  });
})();
