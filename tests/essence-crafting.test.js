// Essence Crafting on the Gem of Many Facets (#193 / #599) — run against the REAL
// HiGHS engine. Run: node tests/essence-crafting.test.js
//
// The Gem carries three Essence Crafting menus on one Trinket. Three separate
// harvests had to land before any of this could be wired: the PLACEMENT (which
// menu), the BONUS TYPE (which bucket it competes in) and the ML CURVE (what it
// is worth at the host's level). The tests here are mostly about the second and
// third, because those are the ones that fail silently.
const assert = require("assert");
const path = require("path");
const S = require("../web/solver.js");
const M = require("../web/model.js");

const vendor = path.join(__dirname, "..", "web", "vendor") + "/";
const Highs = require(vendor + "highs.js");

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  PASS", name); }
  catch (e) { console.log("  FAIL", name, "\n   ", e.message); process.exitCode = 1; }
}

function item(id, slot, affixes, extra) {
  return Object.assign({
    variant_id: id, source_item: id, slot,
    affixes: (affixes || []).map(([stat, bonus_type, value]) =>
      ({ stat, bonus_type, name: stat, type: bonus_type, value, unit: "flat" })),
    scaling: [], set_bonus: [], augment_slots: [],
  }, extra || {});
}
function slot(name, variants, card = 1) { return { slot: name, cardinality: card, variants }; }

// A Gem-shaped host: no affixes of its own, three Essence menus, an ML.
function gem(id, ml) {
  return item(id, "Trinket", [], {
    ml, minimum_level: ml,
    essence_slots: [{ menu: "Prefix" }, { menu: "Suffix" }, { menu: "Extra" }],
  });
}
// One pool option. `curve[ml-1]` is the magnitude at a host of that ML.
function opt(menu, effect, stat, bonus_type, curve, min_ml) {
  return { menu, effect, name: "Essence Crafting: " + effect, stat, bonus_type,
           unit: "flat", values_by_ml: curve, min_ml: min_ml || 1,
           curve_row: "test", wiki_url: "" };
}
const flat = (v) => Array.from({ length: 36 }, () => String(v));
// The real ability curves, abbreviated: Enhancement tops out at 15, Insight at 7.
const ABILITY = ["1","2","2","3","4","4","5","5","5","6","6","6","7","7","8","8","8","9",
                 "9","9","10","10","11","11","11","12","12","12","13","13","14","14","14","15","15","15"];
const INS_ABILITY = ["0","0","0","1","1","1","2","2","2","2","2","2","3","3","3","3","3","4",
                     "4","4","4","4","5","5","5","5","5","5","6","6","6","6","6","7","7","7"];

function modelWith(host, pool, targets, mlCap = 34) {
  return { targets, mlCap, worn: [slot("Trinket", [host])], essenceCrafting: pool };
}

async function solve(model) {
  const prog = S.buildProgram(model);
  const highs = await Highs({ locateFile: (f) => vendor + f });
  return { prog, result: await S.solveLexicographic(model, highs) };
}

(async () => {
  await test("the solver crafts into all three menus of one Gem", async () => {
    const pool = [
      opt("Prefix", "Constitution", "Constitution", "Enhancement", ABILITY),
      opt("Suffix", "Strength", "Strength", "Enhancement", ABILITY),
      opt("Extra", "Insightful Constitution", "Constitution", "Insight", INS_ABILITY, 10),
    ];
    const { prog, result } = await solve(
      modelWith(gem("Gem", 30), pool, ["Constitution", "Strength"]));
    assert.strictEqual(result.status, "optimal");
    const menus = new Set((result.essPlaced || []).map((m) => m.menu));
    assert.deepStrictEqual([...menus].sort(), ["Extra", "Prefix", "Suffix"],
      "all three menus are independent slots; crafting one must not spend the others");
  });

  await test("one craft per menu, never two", async () => {
    // Two Prefix options for the same ranked stat. Only one may be taken.
    const pool = [
      opt("Prefix", "Constitution", "Constitution", "Enhancement", ABILITY),
      opt("Prefix", "Strength", "Strength", "Enhancement", ABILITY),
    ];
    const { prog, result } = await solve(
      modelWith(gem("Gem", 30), pool, ["Constitution", "Strength"]));
    assert.strictEqual(result.status, "optimal");
    const taken = (result.essPlaced || []).filter((m) => m.menu === "Prefix");
    assert.ok(taken.length <= 1, `the Prefix menu holds one craft, took ${taken.length}`);
  });

  await test("the magnitude comes from the HOST's ML, not the top of the curve", async () => {
    // The same option on the heroic Gem (ML 5) and the legendary one (ML 30).
    const pool = [opt("Prefix", "Constitution", "Constitution", "Enhancement", ABILITY)];
    for (const [ml, expected] of [[5, 4], [20, 9], [30, 13]]) {
      const { prog, result } = await solve(
        modelWith(gem("G" + ml, ml), pool, ["Constitution"]));
      assert.strictEqual(result.status, "optimal");
      const taken = result.essPlaced || [];
      assert.strictEqual(taken.length, 1, `ML ${ml}: nothing was crafted`);
      assert.strictEqual(taken[0].value, expected,
        `ML ${ml} must read curve[${ml - 1}] = ${expected}, not the ML 36 value`);
    }
  });

  await test("Insight effects are refused below ML 10, and the wiki says why", async () => {
    // "Effects that grant insight bonuses can be applied to items ML 10 and
    // higher only, regardless of prefix/suffix/extra slot." The heroic Gem is ML 5.
    const pool = [opt("Extra", "Insightful Constitution", "Constitution", "Insight", flat(7), 10)];
    const heroic = await solve(modelWith(gem("Heroic", 5), pool, ["Constitution"]));
    assert.strictEqual([...heroic.prog.essMeta.keys()].length, 0,
      "an ML 5 host must not even be OFFERED an Insight craft");
    const legendary = await solve(modelWith(gem("Legendary", 30), pool, ["Constitution"]));
    assert.ok([...legendary.prog.essMeta.keys()].length > 0,
      "an ML 30 host must be offered it");
  });

  await test("a crafted effect competes with same-bucket gear instead of stacking", async () => {
    // THE reason the bonus type had to be harvested first. A necklace already
    // gives Constitution 15 Enhancement; crafting Constitution 13 Enhancement on
    // the Gem must add NOTHING, because one bucket keeps its maximum.
    const pool = [opt("Prefix", "Constitution", "Constitution", "Enhancement", ABILITY)];
    const model = {
      targets: ["Constitution"], mlCap: 34, essenceCrafting: pool,
      worn: [slot("Trinket", [gem("Gem", 30)]),
             slot("Necklace", [item("N", "Necklace", [["Constitution", "Enhancement", 15]])])],
    };
    const { result } = await solve(model);
    assert.strictEqual(result.status, "optimal");
    assert.strictEqual(result.perTarget.Constitution, 15,
      "same stat, same bonus type => one bucket, take the max. 15 + 13 = 28 would be the "
      + "double-count the whole bonus-type harvest exists to prevent.");
  });

  await test("a DIFFERENT bucket does add, which is why the type is worth harvesting", async () => {
    // Same necklace, but the craft is an Insight bonus. Different bucket => adds.
    const pool = [opt("Extra", "Insightful Constitution", "Constitution", "Insight", INS_ABILITY, 10)];
    const model = {
      targets: ["Constitution"], mlCap: 34, essenceCrafting: pool,
      worn: [slot("Trinket", [gem("Gem", 30)]),
             slot("Necklace", [item("N", "Necklace", [["Constitution", "Enhancement", 15]])])],
    };
    const { result } = await solve(model);
    assert.strictEqual(result.status, "optimal");
    assert.strictEqual(result.perTarget.Constitution, 21,
      "Enhancement 15 + Insight 6 (the ML 30 Insightful ability value) = 21");
  });

  await test("nothing is crafted into a host that carries no menus", async () => {
    const pool = [opt("Prefix", "Constitution", "Constitution", "Enhancement", ABILITY)];
    const plain = item("PlainTrinket", "Trinket", [], { ml: 30 });
    const { prog } = await solve(modelWith(plain, pool, ["Constitution"]));
    assert.strictEqual([...prog.essMeta.keys()].length, 0,
      "essence_slots is the host marker; an item without it is not a crafting host");
  });

  await test("the pool is filtered to ranked stats", async () => {
    const pool = [opt("Prefix", "Haggle", "Haggle", "Competence", flat(20))];
    const model = M.buildModel(
      [gem("Gem", 30)], { targets: ["Constitution"], mlCap: 34 },
      [], [], [], [], {}, [], [], {}, null, {}, pool);
    assert.strictEqual((model.essenceCrafting || []).length, 0,
      "an option for a stat nobody ranked is a variable the MILP can never use");
  });

  console.log(`\n  ${passed} passed`);
})();
