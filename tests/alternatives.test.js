// U1 — solveConstrained: relaxed locks + forced constraints + gain objective, with a
// tie-break stage for a deterministic build. Run against the REAL HiGHS engine.
// Run: node tests/alternatives.test.js
const assert = require("assert");
const path = require("path");
const S = require("../web/solver.js");
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
function setHost(id, slotName, affixes, setName, tiers) {
  const v = item(id, slotName, affixes);
  v.set_bonus = [{ set: setName }];
  v.augment_slots_norm = { colors: [], quarantined: [] };
  v.parsed_set_bonuses = (tiers || []).map((t) => ({
    set: setName, pieces_required: t.n, pieces_label: `${t.n} Pieces`,
    affixes: t.affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, value, unit: "flat" })),
    flagged: [],
  }));
  return v;
}

// A model where the optimum SKIPS a set: Ring picks the plain +20 over the set member
// (+10 base + 3 set = 13). Forcing the set active is a trade (costs 7 Constitution).
const tier = [{ n: 2, affixes: [["Constitution", "Insightful", 3]] }];
const tradeModel = () => ({
  targets: ["Constitution"], mlCap: 34, dodgeCap: null,
  worn: [
    slot("Ring", [
      setHost("Ring Alpha", "Ring", [["Constitution", "Enhancement", 10]], "Alpha", tier),
      item("Ring Plain", "Ring", [["Constitution", "Enhancement", 20]]),
    ]),
    slot("Necklace", [setHost("Neck Alpha", "Necklace", [], "Alpha", tier)]),
  ],
  augments: [],
});

(async () => {
  const highs = await Highs({ locateFile: (f) => vendor + f });

  await test("optimum skips the set (baseline for the trade)", async () => {
    const r = await S.solveLexicographic(tradeModel(), highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.Constitution, 20, "the plain +20 ring wins outright");
    assert.strictEqual(r.setsActive.length, 0, "the set is not active in the optimum");
  });

  await test("forcing a set active is a real trade (Constitution drops), with a deterministic build", async () => {
    const opt = await S.solveLexicographic(tradeModel(), highs);
    const alphaVar = [...opt.program.setMeta].find(([, m]) => m.set === "Alpha")[0];
    const alt = S.solveConstrained(opt.program, highs, {
      objectiveStat: "Constitution",
      locks: [{ stat: "Constitution", value: 20, give: 10 }], // allow the give
      extra: [`${alphaVar} = 1`],                              // force the set active
    });
    assert.strictEqual(alt.status, "optimal");
    assert.strictEqual(alt.effective.Constitution, 13, "10 base + 3 set = 13 (costs 7 vs the optimum)");
    assert.ok(alt.setsActive.some((s) => s.set === "Alpha"), "the forced set is active");
    // the enriched shape the shared renderers need
    assert.ok(alt.breakdown && alt.breakdown.Constitution, "carries breakdown (shared renderers read result.breakdown)");
    assert.ok(alt.capped, "carries capped");
    // determinism: same call yields the same chosen item set
    const alt2 = S.solveConstrained(opt.program, highs, {
      objectiveStat: "Constitution",
      locks: [{ stat: "Constitution", value: 20, give: 10 }],
      extra: [`${alphaVar} = 1`],
    });
    const ids = (a) => a.chosen.map((c) => c.variant.variant_id).sort();
    assert.deepStrictEqual(ids(alt), ids(alt2), "same inputs -> identical chosen build");
    assert.ok(ids(alt).includes("Ring Alpha"), "the set-member ring is equipped");
  });

  await test("a too-tight relaxed lock makes the forced trade infeasible", async () => {
    const opt = await S.solveLexicographic(tradeModel(), highs);
    const alphaVar = [...opt.program.setMeta].find(([, m]) => m.set === "Alpha")[0];
    const alt = S.solveConstrained(opt.program, highs, {
      objectiveStat: "Constitution",
      locks: [{ stat: "Constitution", value: 20, give: 3 }], // floor 17 > the 13 the trade yields
      extra: [`${alphaVar} = 1`],
    });
    assert.strictEqual(alt.status, "infeasible", "cannot drop Constitution to 13 with only a give of 3");
  });

  // ---- U2: the four gain generators ----

  await test("set-activation generator surfaces the skipped set as a trade", async () => {
    const opt = await S.solveLexicographic(tradeModel(), highs);
    const alts = S.generateAlternatives(opt, tradeModel(), highs);
    const setAlt = alts.find((a) => a.gainAxis === "set" && a.meta.set === "Alpha");
    assert.ok(setAlt, "produced a set-activation candidate for Alpha");
    assert.strictEqual(setAlt.sol.effective.Constitution, 13, "the set build trades Constitution down to 13");
    assert.ok(setAlt.sol.setsActive.some((s) => s.set === "Alpha"), "Alpha is active in the candidate");
  });

  await test("rebalance generator trades a higher priority for a lower one", async () => {
    const model = {
      targets: ["Strength", "Constitution"], mlCap: 34, dodgeCap: null,
      worn: [slot("Gloves", [
        item("Glove A", "Gloves", [["Strength", "Enhancement", 20]]),
        item("Glove B", "Gloves", [["Strength", "Enhancement", 18], ["Constitution", "Enhancement", 12]]),
      ])],
      augments: [],
    };
    const opt = await S.solveLexicographic(model, highs);
    assert.strictEqual(opt.effective.Strength, 20);
    assert.strictEqual(opt.effective.Constitution, 0, "optimum takes max Strength, no Constitution");
    const alts = S.generateAlternatives(opt, model, highs);
    const reb = alts.find((a) => a.gainAxis === "rebalance");
    assert.ok(reb, "produced a rebalance candidate");
    assert.ok(reb.sol.effective.Constitution > opt.effective.Constitution, "gains on the lower priority");
    assert.ok(reb.sol.effective.Strength >= 18, "gives up Strength only within the bounded give");
  });

  await test("unranked-stat generator finds a zero-cost strict improvement", async () => {
    const model = {
      targets: ["Strength"], mlCap: 34, dodgeCap: null,
      worn: [slot("Boots", [
        item("Boots Low", "Boots", [["Strength", "Enhancement", 10], ["Fortitude", "Enhancement", 5]]),
        item("Boots High", "Boots", [["Strength", "Enhancement", 10], ["Fortitude", "Enhancement", 15]]),
      ])],
      augments: [],
    };
    const opt = await S.solveLexicographic(model, highs);
    assert.strictEqual(opt.effective.Strength, 10);
    const alts = S.generateAlternatives(opt, model, highs);
    const un = alts.find((a) => a.gainAxis === "unranked" && a.meta.stat === "Fortitude");
    assert.ok(un, "produced an unranked-stat candidate for Fortitude");
    assert.strictEqual(un.meta.zeroCost, true, "the Fortitude gain costs no Strength");
    assert.strictEqual(un.sol.effective.Strength, 10, "Strength is unchanged");
    assert.ok(un.sol.chosen.some((c) => c.variant.variant_id === "Boots High"), "equips the higher-Fortitude boots");
  });

  console.log(`\n${passed} passed`);
})();
