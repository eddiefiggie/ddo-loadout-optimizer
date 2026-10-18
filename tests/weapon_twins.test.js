// #902 — two copies of one duplicable weapon, one per hand, against the REAL HiGHS.
// Run: node tests/weapon_twins.test.js
//
// The hand cap stays: ONE weapon x-var can never fill both hands (that would double
// one physical item's augment and set supply). A wiki-duplicable weapon instead gets
// an appended off-hand twin — its own x-var and id, tied to the same weapon in the
// main hand — exactly the #335 ring pattern.
const assert = require("assert");
const path = require("path");
const S = require("../web/solver.js");
const M = require("../web/model.js");

const vendor = path.join(__dirname, "..", "web", "vendor") + "/";
const Highs = require(vendor + "highs.js");
const { atest: test } = require("./_harness");

const aff = (rows) => rows.map(([stat, bonus_type, value]) =>
  ({ stat, bonus_type, name: stat, type: bonus_type, value, unit: "flat" }));
function weapon(id, affixes, extra) {
  return Object.assign({ variant_id: id, source_item: id, slot: "Weapon", category: "weapon",
    type: "Long Swords", affixes: aff(affixes), scaling: [], set_bonus: [], augment_slots: [] }, extra || {});
}
function setWeapon(id, affixes, setName, tiers, extra) {
  return weapon(id, affixes, Object.assign({
    set_bonus: [{ set: setName }],
    parsed_set_bonuses: tiers.map((t) => ({ set: setName, pieces_required: t.n,
      pieces_label: `${t.n} Pieces`, affixes: aff(t.affixes), flagged: [] })),
  }, extra || {}));
}
const hands = (main, off) => [{ slot: "Main Hand", cardinality: 1, variants: main },
  { slot: "Off Hand", cardinality: 1, variants: off }];
const ids = (r, slot) => r.chosen.filter((c) => c.slot === slot).map((c) => c.variant.variant_id);

(async () => {
  const highs = await Highs({ locateFile: (f) => vendor + f });

  // Kindling-shaped: the set completes only with two copies of the one weapon.
  const twinSet = (stamped) => setWeapon("Kindling", [["Strength", "Enhancement", 5]], "Twin Flames",
    [{ n: 2, affixes: [["Doublestrike", "Artifact", 10]] }], stamped ? { duplicable_weapon: true } : {});

  await test("#902: a duplicable weapon completes a two-copy set, one copy per hand", async () => {
    const W = twinSet(true);
    const r = await S.solveLexicographic({ targets: ["Doublestrike"], mlCap: 34, worn: hands([W], [W]) }, highs);
    assert.strictEqual(r.status, "optimal");
    assert.deepStrictEqual(ids(r, "Main Hand"), ["Kindling"]);
    assert.deepStrictEqual(ids(r, "Off Hand"), [M.twinIdOf("Kindling")], "the off hand holds the second copy");
    assert.strictEqual(r.perTarget.Doublestrike, 10, "the two-piece tier fires");
  });

  await test("#902: an unstamped (Exclusive or unharvested) weapon keeps the one-copy rule", async () => {
    const W = twinSet(false);
    const r = await S.solveLexicographic({ targets: ["Doublestrike"], mlCap: 34, worn: hands([W], [W]) }, highs);
    assert.ok(ids(r, "Main Hand").length + ids(r, "Off Hand").length <= 1, "one copy at most");
    assert.strictEqual(r.perTarget.Doublestrike || 0, 0, "the set cannot complete");
  });

  await test("#902: the second copy carries its own augment slots", async () => {
    const W = weapon("Blank", [], { duplicable_weapon: true,
      augment_slots_norm: { colors: ["Colorless"], quarantined: [] } });
    const aug = (id, stat) => ({ variant_id: id, source_item: id, slot: "Augment", category: "augment",
      aug_color: { color: "Colorless", raw: "Colorless", reason: null }, fits_slots: ["Colorless"],
      affixes: aff([[stat, "Enhancement", 6]]), scaling: [], set_bonus: [], augment_slots: [] });
    const model = { targets: ["Strength", "Dexterity"], mlCap: 34, worn: hands([W], [W]),
      augments: [aug("Str Aug", "Strength"), aug("Dex Aug", "Dexterity")] };
    const r = await S.solveLexicographic(model, highs);
    assert.deepStrictEqual(ids(r, "Off Hand"), [M.twinIdOf("Blank")]);
    assert.strictEqual(r.perTarget.Strength, 6);
    assert.strictEqual(r.perTarget.Dexterity, 6, "two copies, two Colorless slots, both augments placed");
  });

  await test("#902: the twin is a SECOND copy — never chosen without the original in the main hand", async () => {
    const W = twinSet(true);
    const other = weapon("Other", [["Constitution", "Enhancement", 9]]);
    const model = { targets: ["Doublestrike", "Constitution"], mlCap: 34, worn: hands([W, other], [W]),
      query: { slotConstraints: { "Main Hand": { type: "pin", variant_id: "Other" } } } };
    const r = await S.solveLexicographic(model, highs);
    assert.deepStrictEqual(ids(r, "Main Hand"), ["Other"]);
    assert.ok(!ids(r, "Off Hand").includes(M.twinIdOf("Kindling")), "no twin without its original");
  });

  await test("#902: pinning the same weapon in both hands equips two copies, not an infeasible 2 <= 1", async () => {
    const W = weapon("Twin Rapier", [["Strength", "Enhancement", 5]], { type: "Rapiers", duplicable_weapon: true });
    const pin = { type: "pin", variant_id: "Twin Rapier" };
    const model = { targets: ["Strength"], mlCap: 34, worn: hands([W], [W]),
      query: { slotConstraints: { "Main Hand": pin, "Off Hand": pin } } };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.deepStrictEqual(ids(r, "Main Hand"), ["Twin Rapier"]);
    assert.deepStrictEqual(ids(r, "Off Hand"), [M.twinIdOf("Twin Rapier")]);
  });

  await test("#902: end to end through buildModel — a declared TWF build dual-wields the set weapon", async () => {
    const W = setWeapon("Kindling", [["Strength", "Enhancement", 5]], "Twin Flames",
      [{ n: 2, affixes: [["Doublestrike", "Artifact", 10]] }],
      { type: "Scimitars", duplicable_weapon: true, verification: "verified", ml: 20 });
    const other = weapon("Plain Scimitar", [["Strength", "Enhancement", 6]],
      { type: "Scimitars", verification: "verified", ml: 20 });
    const q = { mlCap: 34, targets: ["Doublestrike", "Strength"], style: "one-hand", twoWeaponFighting: true,
      weaponTypes: ["Scimitars"], offHandWeapons: ["Scimitars"] };
    const r = await S.solveLexicographic(M.buildModel([W, other], q), highs);
    assert.strictEqual(r.status, "optimal");
    assert.deepStrictEqual(ids(r, "Main Hand"), ["Kindling"]);
    assert.deepStrictEqual(ids(r, "Off Hand"), [M.twinIdOf("Kindling")]);
    assert.strictEqual(r.perTarget.Doublestrike, 10);
    const undeclared = await S.solveLexicographic(M.buildModel([W, other], Object.assign({}, q,
      { twoWeaponFighting: false, offHandWeapons: [] })), highs);
    assert.ok(!ids(undeclared, "Off Hand").some((id) => M.isTwinId(id)),
      "without Two Weapon Fighting there is no off-hand weapon, so no second copy");
  });

  await test("#902: an off-hand pin alone takes either copy, so the main hand stays free to match it", async () => {
    const W = twinSet(true);
    const model = { targets: ["Doublestrike"], mlCap: 34, worn: hands([W], [W]),
      query: { slotConstraints: { "Off Hand": { type: "pin", variant_id: "Kindling" } } } };
    const prog = S.buildProgram(model);
    assert.ok(prog.extraConstraints.some((c) => /^x\d+ \+ x\d+ = 1$/.test(c)), "x_off + x_twin = 1");
    const r = await S.solveLexicographic(model, highs);
    assert.deepStrictEqual(ids(r, "Main Hand"), ["Kindling"], "the pin did not push the main-hand copy out");
    assert.strictEqual(r.perTarget.Doublestrike, 10);
  });

  await test("#902: pinning a results row that is a second copy pins the item, not the twin id", () => {
    const Wz = require("../web/wizard.js");
    const sc = Wz.applyPinId({}, "Off Hand", M.twinIdOf("Kindling"), () => 1);
    assert.deepStrictEqual(sc["Off Hand"], { type: "pin", variant_id: "Kindling" });
  });

  await test("#902: a second copy is shown and exported under the weapon's own name", async () => {
    const Proj = require("../web/projection.js");
    const E = require("../web/exporters.js");
    const W = twinSet(true);
    const r = await S.solveLexicographic({ targets: ["Doublestrike"], mlCap: 34, worn: hands([W], [W]) }, highs);
    const off = r.chosen.find((c) => c.slot === "Off Hand").variant;
    assert.strictEqual(off.variant_id, M.twinIdOf("Kindling"), "the solver keeps the copies apart");
    assert.strictEqual(Proj.itemIdOf(off), "Kindling");
    assert.strictEqual(Proj.displayItemName(off), "Kindling");
    const rec = { name: "t", inputs: { ml: 34, pool: "all", priorities: ["Doublestrike"] }, snapshot: r };
    for (const k of ["toMarkdown", "toCsv", "toBBCode", "toPrintHtml", "toGearset"]) {
      const o = E[k](rec);
      const text = typeof o === "string" ? o : JSON.stringify(o);
      assert.ok(!/::twin/.test(text), `${k} never prints the internal twin id`);
      assert.ok((text.match(/Kindling/g) || []).length >= 2, `${k} lists both copies`);
    }
  });

  await test("#902: twins are appended, leaving every existing x-var index fixed", () => {
    const W = twinSet(true);
    const plain = S.buildProgram({ targets: ["Doublestrike"], mlCap: 34, worn: hands([twinSet(false)], [twinSet(false)]) });
    const prog = S.buildProgram({ targets: ["Doublestrike"], mlCap: 34, worn: hands([W], [W]) });
    assert.strictEqual(prog.xVars.length, plain.xVars.length + 1);
    plain.xVars.forEach((xv, i) => assert.strictEqual(prog.xVars[i].name, xv.name));
    const tw = prog.xVars[prog.xVars.length - 1];
    assert.strictEqual(tw.slot, "Off Hand");
    assert.strictEqual(tw.twinOf, prog.xVars.find((x) => x.slot === "Main Hand").name);
  });

  await test("#902: eligibility — weapon, stamped, and one-handed", () => {
    assert.strictEqual(M.isWeaponTwinEligible(weapon("A", [], { duplicable_weapon: true })), true);
    assert.strictEqual(M.isWeaponTwinEligible(weapon("B", [])), false, "unstamped is refused");
    assert.strictEqual(M.isWeaponTwinEligible(weapon("C", [], { duplicable_weapon: true, type: "Great Swords" })),
      false, "a two-handed weapon has no second hand to fill");
    assert.strictEqual(M.isWeaponTwinEligible(Object.assign(weapon("D", [], { duplicable_weapon: true }),
      { category: "item" })), false);
  });

  await test("#902: the real dataset stamps the wiki's duplicable one-handed weapons and only those", () => {
    const d = require("../web/data/items.json");
    const cov = d.metadata.duplicable_weapon_coverage;
    assert.ok(cov && cov.weapons_in_population > 2000, "the guard inspected the real population");
    assert.strictEqual(cov.uncovered, 0);
    const stamped = d.items.filter((v) => v.duplicable_weapon === true);
    assert.strictEqual(stamped.length, cov.duplicable);
    assert.ok(stamped.every((v) => M.isWeaponTwinEligible(v)), "every stamp is a one-handed weapon");
    const byName = new Map(d.items.map((v) => [v.source_item, v]));
    for (const n of ["Hellfire Crossbow", "Echo of the Artblade", "Short Broom of Mystery"]) {
      assert.ok(byName.has(n) && !byName.get(n).duplicable_weapon, `${n} is Exclusive on the wiki`);
    }
    assert.ok(!byName.get("Silver Blade of the Flame").duplicable_weapon,
      "a page with no binding category is quarantined, never defaulted");
  });
})();
