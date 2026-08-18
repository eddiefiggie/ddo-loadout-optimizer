// U1 — solveConstrained: relaxed locks + forced constraints + gain objective, with a
// tie-break stage for a deterministic build. Run against the REAL HiGHS engine.
// Run: node tests/alternatives.test.js
const assert = require("assert");
const path = require("path");
const S = require("../web/solver.js");
const A = require("../web/alternatives.js");
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
function setHost(id, slotName, affixes, setName, tiers) {
  const v = item(id, slotName, affixes);
  v.set_bonus = [{ set: setName }];
  v.augment_slots_norm = { colors: [], quarantined: [] };
  v.parsed_set_bonuses = (tiers || []).map((t) => ({
    set: setName, pieces_required: t.n, pieces_label: `${t.n} Pieces`,
    affixes: t.affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, name: stat, type: bonus_type, value, unit: "flat" })),
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

  // ---- U3: trade-off analysis, dedupe, ranking ----

  await test("analyzeAlternative states the cost and the gain with tags", async () => {
    const opt = await S.solveLexicographic(tradeModel(), highs);
    const alts = S.generateAlternatives(opt, tradeModel(), highs);
    const setCand = alts.find((a) => a.gainAxis === "set");
    const an = A.analyzeAlternative(opt, setCand, { targets: ["Constitution"] });
    assert.ok(an.tags.includes("set bonus"), "tagged as a set-bonus trade");
    assert.deepStrictEqual(an.cost, [{ stat: "Constitution", delta: -7 }], "costs 7 Constitution");
    assert.strictEqual(an.costText, "-7 Constitution");
    assert.ok(/activates Alpha/.test(an.gainText), "names the gained set");
    assert.ok(an.activatedSets.includes("Alpha"), "records the newly-activated set for affix expansion (U7)");
  });

  await test("U7: renderAltCards names the concrete affixes an activated set grants", () => {
    const sol = {
      setsActive: [{ set: "Alpha", pieces_required: 2 }],
      chosen: [
        { slot: "Ring", variant: { variant_id: "Ring Alpha", set_bonus: [{ set: "Alpha" }],
          parsed_set_bonuses: [{ set: "Alpha", pieces_required: 2,
            affixes: [{ stat: "Constitution", bonus_type: "Insightful", value: 3, unit: "flat" }] }] } },
        { slot: "Necklace", variant: { variant_id: "Neck Alpha", set_bonus: [{ set: "Alpha" }], parsed_set_bonuses: [] } },
      ],
    };
    const html = R.renderAltCards([{ tags: ["set bonus"], gainText: "activates Alpha",
      costText: "-7 Constitution", activatedSets: ["Alpha"], sol }]);
    assert.ok(/alt-grants/.test(html), "renders a dedicated grants detail line");
    assert.ok(/Constitution \+3 Insightful/.test(html), "names the set's granted affix, not just the set");
  });

  await test("U7: renderAltCards omits the grants line for an alt that activates no set", () => {
    const html = R.renderAltCards([{ tags: ["rebalance"], gainText: "+5 Constitution", costText: "-3 Strength" }]);
    assert.ok(!/alt-grants/.test(html), "no grants line when nothing new is activated (gainText already names the delta)");
  });

  await test("U7: renderAltCards degrades gracefully when an activated set resolves no affixes", () => {
    // activatedSets names a set absent from the candidate's setsActive -> activeSetDetail
    // finds no entry. The card must not crash and must still name the set via gainText.
    const html = R.renderAltCards([{ tags: ["set bonus"], gainText: "activates Ghost",
      costText: "no priority cost", activatedSets: ["Ghost"], sol: { setsActive: [], chosen: [] } }]);
    assert.ok(!/alt-grants/.test(html), "no grants line when the set's affixes cannot be resolved");
    assert.ok(/activates Ghost/.test(html), "the gain text still names the set (no silent break)");
  });

  await test("rankAlternatives dedupes, drops within-K of the optimum, and caps to N", () => {
    const optimum = { chosen: [{ slot: "Ring", variant: { variant_id: "R1" } }, { slot: "Neck", variant: { variant_id: "N1" } }, { slot: "Boots", variant: { variant_id: "B1" } }],
      setsActive: [], augmentsPlaced: [], effective: {} };
    const mk = (ids, axis, extra = {}) => A.analyzeAlternative(optimum,
      { sol: { chosen: ids.map(([slot, id]) => ({ slot, variant: { variant_id: id } })), setsActive: [], augmentsPlaced: [], effective: {} }, gainAxis: axis, meta: extra },
      { targets: [] });
    const far = mk([["Ring", "R2"], ["Neck", "N2"], ["Boots", "B1"]], "set", { set: "X" });     // 2 slots differ -> kept
    const near = mk([["Ring", "R2"], ["Neck", "N1"], ["Boots", "B1"]], "rebalance");             // 1 slot differs -> dropped (K=2)
    const dup = mk([["Ring", "R2"], ["Neck", "N2"], ["Boots", "B1"]], "set", { set: "Y" });      // same build as `far`
    const ranked = A.rankAlternatives([far, near, dup], optimum, { n: 5, k: 2 });
    assert.strictEqual(ranked.length, 1, "near dropped (within K), dup deduped, far kept");
    assert.strictEqual(ranked[0].key, far.key);
    // ranking is deterministic across runs
    const again = A.rankAlternatives([dup, near, far], optimum, { n: 5, k: 2 });
    assert.deepStrictEqual(again.map((a) => a.key), ranked.map((a) => a.key));
  });

  // ---- U4: card rendering (a11y) ----

  await test("renderAltCards renders a keyboard listbox with tags, gain, and cost", () => {
    const ranked = [{ tags: ["set bonus", "cheaper crafting"], gainText: "activates Alpha", costText: "-7 Constitution" }];
    const html = R.renderAltCards(ranked);
    assert.ok(/role="listbox"/.test(html) && /role="option"/.test(html), "listbox + option roles");
    assert.ok(/aria-selected="false"/.test(html) && /tabindex="0"/.test(html), "single-select a11y state");
    assert.ok(/activates Alpha/.test(html) && /-7 Constitution/.test(html), "shows the gain and the cost");
    assert.ok(/set bonus/.test(html) && /cheaper crafting/.test(html), "shows the gain tags");
  });

  // ---- #321: TF/GS count as crafting steps ----

  await test("craftCount counts Thunder-Forged and Green Steel placements", () => {
    assert.strictEqual(A.craftCount({}), 0, "empty solution counts zero");
    const sol = { tfPlaced: [{ item: "CH", tier: 1 }], gsPlaced: [{ item: "CH", name: "Dim" }] };
    assert.strictEqual(A.craftCount(sol), 2, "one TF + one GS placement count as two crafting steps");
  });

  // ---- #91 U7 (KTD7/R11): the "more utility effects" family ----

  const SENT = require("../web/model.js").UTILITY_SENTINEL;

  // AE1-shaped: one weapon wins the ranked stat by +1; the loser carries two
  // counted effects. Tier at the bottom -> the optimum keeps the ranked winner
  // (count 0) and the utility family surfaces the proc-richer weapon.
  const echoModel = () => ({
    targets: ["A", SENT], mlCap: 34, dodgeCap: null,
    utilityCountingSet: new Set(["Ghost Touch", "Feather Falling"]),
    worn: [slot("Weapon", [
      item("Calamitous", "Weapon", [["A", "Enhancement", 10]]),
      item("Echo", "Weapon", [["A", "Enhancement", 9], ["Ghost Touch", "Bool", 1], ["Feather Falling", "Bool", 1]]),
    ])],
    augments: [],
  });

  await test("#348 U4/R17/KTD7: the utility gain axis is retired — the tier is only ever a cost", async () => {
    // The `more-utility` family used to surface Echo of Whelm as a gain: strictly
    // more counted effects for a bounded ranked cost. It is deleted, not redefined.
    // With the container pinned last and solved lexicographically under ranked-exact
    // locks, the optimum's container result is already lexicographically maximal at
    // those values, so a zero-cost strict win is impossible by construction — every
    // candidate the family could surface costs a ranked stat, and that trade is
    // better STATED (R14's priced disclosure, U5) than offered as a card.
    //
    // This replaces three tests that asserted the family's behavior in three
    // situations ("surfaces the proc-richer weapon", "no trade within the give
    // yields nothing", "a tie in count does not surface"). All three would now
    // assert the absence of something that cannot exist, which is not coverage.
    const opt = await S.solveLexicographic(echoModel(), highs);
    assert.strictEqual(opt.utilityCount, 0, "no utility reachable without surrendering a ranked point");
    const alts = S.generateAlternatives(opt, echoModel(), highs);
    assert.strictEqual(alts.filter((a) => a.gainAxis === "utility").length, 0,
      "no generator emits the retired axis");
    for (const a of alts) {
      const an = A.analyzeAlternative(opt, a, { targets: ["A", SENT] });
      assert.ok(!an.tags.includes("utility effects"), "no candidate is tagged as a utility gain");
      assert.ok(!/utility effects/.test(an.gainText || ""), "no candidate headlines a utility count");
    }
  });

  await test("#91 U7/KTD7: tier ranked first -> a set-activation alternative preserves the optimum's utility count", async () => {
    // Alpha completes two ways: Ring+Necklace (keeps the Ghost Touch trinket,
    // Constitution 13) or Ring+Trinket (sheds Ghost Touch, Constitution 19).
    // WITHOUT the threaded count lock the set family picks the higher-Constitution
    // completion and silently sheds the effect the player ranked FIRST; the lock
    // forces the Ring+Necklace completion. (The tier grants a target-stat bonus —
    // a set var is only minted when its tier touches a tracked stat.)
    const alphaTier = [{ n: 2, affixes: [["Constitution", "Profane", 1]] }];
    const mk = () => ({
      targets: [SENT, "Constitution"], mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(["Ghost Touch"]),
      worn: [
        slot("Ring", [
          setHost("rSet", "Ring", [["Constitution", "Enhancement", 10]], "Alpha", alphaTier),
          item("rPlain", "Ring", [["Constitution", "Enhancement", 20]]),
        ]),
        slot("Necklace", [
          setHost("nSet", "Necklace", [["Constitution", "Insight", 2]], "Alpha", alphaTier),
          item("nPlain", "Necklace", [["Constitution", "Insight", 3]]),
        ]),
        slot("Trinket", [
          setHost("tSet", "Trinket", [["Constitution", "Quality", 5]], "Alpha", alphaTier),
          item("tGT", "Trinket", [["Ghost Touch", "Bool", 1]]),
        ]),
      ],
      augments: [],
    });
    const opt = await S.solveLexicographic(mk(), highs);
    assert.strictEqual(opt.utilityCount, 1, "the tier ranked first collects Ghost Touch");
    assert.strictEqual(opt.effective.Constitution, 23, "20 Enh + 3 Insight under the count lock");
    assert.strictEqual(opt.setsActive.length, 0, "the optimum skips Alpha");
    const alts = S.generateAlternatives(opt, mk(), highs);
    const setAlt = alts.find((a) => a.gainAxis === "set" && a.meta.set === "Alpha");
    assert.ok(setAlt, "the set family still produces an Alpha candidate");
    assert.ok(setAlt.sol.setsActive.some((s) => s.set === "Alpha"), "Alpha is active in the candidate");
    assert.strictEqual(setAlt.sol.utilityReport.count, 1, "the count lock preserves the ranked-above effect");
    assert.ok(setAlt.sol.chosen.some((c) => c.variant.variant_id === "tGT"), "the Ghost Touch carrier keeps its slot");
    assert.strictEqual(setAlt.sol.effective.Constitution, 13, "the lock-respecting completion: 10 Enh + 2 Insight + 1 Profane tier");
  });

  // #348 (U4) — the lock threaded into the generic families is a PREFIX of
  // per-effect locks: everything above the shed depth is pinned, the tail is free.
  // Shed depth is alternativeGive(secured), and zero when the container is the only
  // priority. Shared fixture: Con stage takes rCon +
  // nGT/tFF carriers (24); the utility stage adds bWB -> count 3. Completing
  // Alpha requires its `pieces` member hosts, displacing that many carriers.
  const shedModel = (targets, pieces, order) => {
    const t = [{ n: pieces, affixes: [["Constitution", "Profane", 1]] }];
    return {
      targets, mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(["Ghost Touch", "Feather Falling", "Water Breathing"]),
      // Stated explicitly so these tests turn on the ORDER rather than on the
      // alphabetical accident of the effect names.
      utilityOrder: order || ["Ghost Touch", "Feather Falling", "Water Breathing"],
      worn: [
        slot("Ring", [item("rCon", "Ring", [["Constitution", "Enhancement", 20]])]),
        slot("Necklace", [
          item("nGT", "Necklace", [["Constitution", "Insight", 2], ["Ghost Touch", "Bool", 1]]),
          setHost("nSet", "Necklace", [], "Alpha", t),
        ]),
        slot("Trinket", [
          item("tFF", "Trinket", [["Constitution", "Quality", 2], ["Feather Falling", "Bool", 1]]),
          setHost("tSet", "Trinket", [], "Alpha", t),
        ]),
        slot("Boots", [
          item("bWB", "Boots", [["Water Breathing", "Bool", 1]]),
          ...(pieces === 3 ? [setHost("bSet", "Boots", [], "Alpha", t)] : []),
        ]),
      ],
      augments: [],
    };
  };

  await test("#348 U4/R16/AE8: a candidate may shed from the TAIL of the container order", async () => {
    // Alpha's 2-piece completion displaces the Ghost Touch and Feather Falling
    // carriers, keeping Water Breathing. Ordered with Water Breathing FIRST, the two
    // it sheds are the bottom two — a legal tail shed, so the trade surfaces and
    // names what it gives up.
    const ORDER = ["Water Breathing", "Ghost Touch", "Feather Falling"];
    const mk = () => shedModel(["Constitution", SENT], 2, ORDER);
    const opt = await S.solveLexicographic(mk(), highs);
    assert.strictEqual(opt.effective.Constitution, 24, "20 Enh + 2 Insight + 2 Quality");
    assert.deepStrictEqual(opt.utilityOrdered.secured, ORDER, "the optimum wears all three, in order");

    const alts = S.generateAlternatives(opt, mk(), highs);
    const setAlt = alts.find((a) => a.gainAxis === "set" && a.meta.set === "Alpha");
    assert.ok(setAlt, "the tail shed is legal, so the set trade surfaces");
    assert.ok(setAlt.sol.chosen.some((c) => c.variant.variant_id === "bWB"),
      "the top-ordered effect's carrier stays equipped — the prefix lock pinned it");

    // R16 — the loss is NAMED, in container order, never a bare count.
    const an = A.analyzeAlternative(opt, setAlt, { targets: ["Constitution", SENT] });
    assert.deepStrictEqual(an.shedEffects, ["Ghost Touch", "Feather Falling"],
      "the shed effects are listed in container order");
    assert.ok(/gives up Ghost Touch, Feather Falling/.test(an.costText),
      `costText names them: ${an.costText}`);
    assert.ok(!/utility effects/.test(an.costText), "and never as a bare count");
    assert.strictEqual(an.totalCost, 3 + 2, "the shed magnitude still joins totalCost");
  });

  await test("#348 U4/R16/AE8: the SAME trade is blocked when it would shed from the top", async () => {
    // Identical model, identical displacement — only the container order differs.
    // With Ghost Touch first and Water Breathing last, completing Alpha would shed
    // the top-ordered effect while KEEPING a lower-ordered one, which is exactly
    // what R6 forbids. The prefix lock makes it infeasible rather than filtering it
    // out after the fact.
    const mk = () => shedModel(["Constitution", SENT], 2, ["Ghost Touch", "Feather Falling", "Water Breathing"]);
    const opt = await S.solveLexicographic(mk(), highs);
    const alts = S.generateAlternatives(opt, mk(), highs);
    assert.ok(!alts.some((a) => a.gainAxis === "set" && a.meta.set === "Alpha"),
      "shedding the top-ordered effect to keep a lower one never surfaces");
  });

  await test("review fix 3: shedding BELOW the give floor stays blocked (tier not first)", async () => {
    // 3-piece Alpha displaces all three carriers -> count 0 < floor 1 -> the
    // candidate is proven infeasible and never surfaces.
    const opt = await S.solveLexicographic(shedModel(["Constitution", SENT], 3), highs);
    assert.strictEqual(opt.utilityReport.count, 3);
    const alts = S.generateAlternatives(opt, shedModel(["Constitution", SENT], 3), highs);
    assert.ok(!alts.some((a) => a.gainAxis === "set" && a.meta.set === "Alpha"),
      "a trade shedding below the relaxed floor is suppressed");
  });

  await test("review fix 3: the lock stays EXACT when the tier is ranked FIRST", async () => {
    // Sentinel at position 0: the count is the top priority, so the lock is
    // exact (>= 3) and the 2-effect shed of the 2-piece Alpha stays blocked.
    const opt = await S.solveLexicographic(shedModel([SENT, "Constitution"], 2), highs);
    assert.strictEqual(opt.utilityReport.count, 3, "the tier ranked first collects all three effects");
    const alts = S.generateAlternatives(opt, shedModel([SENT, "Constitution"], 2), highs);
    assert.ok(!alts.some((a) => a.gainAxis === "set" && a.meta.set === "Alpha"),
      "no give applies to the top-ranked tier — the exact lock suppresses the shed");
  });

  await test("#348 U4/R16: a pure utility shed can never claim 'no priority cost'", () => {
    // The fixture carries effect NAMES, not just a count. Production's readSolution
    // always writes both (count === effects.length), and #348 reads the names to say
    // which effects a trade gives up — a count-only fixture would exercise a shape
    // the writer never produces and would report no cost at all.
    // See docs/solutions/conventions/fixture-shape-must-mirror-the-production-writer.md
    const mkSol = (ids, report) => ({
      chosen: ids.map(([sl, id]) => ({ slot: sl, variant: { variant_id: id } })),
      setsActive: [], augmentsPlaced: [], effective: {},
      ...(report ? { utilityReport: report } : {}),
    });
    const two = { count: 2, effects: [{ name: "Ghostly", item: "R1" }, { name: "Deathblock", item: "N1" }] };
    const optimum = { ...mkSol([["Ring", "R1"], ["Neck", "N1"]], two),
      utilityOrdered: { secured: ["Ghostly", "Deathblock"], unsecured: [] } };
    const an = A.analyzeAlternative(optimum,
      { sol: mkSol([["Ring", "R2"], ["Neck", "N2"]], { count: 0, effects: [] }), gainAxis: "rebalance", meta: {} },
      { targets: [] });
    assert.deepStrictEqual(an.shedEffects, ["Ghostly", "Deathblock"], "both losses are named, in order");
    assert.strictEqual(an.utilDelta, -2);
    assert.strictEqual(an.costText, "gives up Ghostly, Deathblock", "the shed is the stated cost");
    assert.strictEqual(an.totalCost, 2, "the shed magnitude counts like a stat cost");
    // ...and results without a utilityReport (tier removed) are untouched:
    const bare = A.analyzeAlternative(mkSol([["Ring", "R1"]]),
      { sol: mkSol([["Ring", "R2"]]), gainAxis: "rebalance", meta: {} }, { targets: [] });
    assert.strictEqual(bare.costText, "no priority cost");
    assert.strictEqual(bare.totalCost, 0);
  });

  await test("#348 U4/KTD7: the interleave order has no utility slot", () => {
    // The axis is deleted, so there is nothing to rank. This replaces a test that
    // asserted "utility sorts after set and before the stat trades". Guarding the
    // absence still matters: an axis string surviving in one generator but not in
    // typeOrder sorts as `undefined`, which compares false against every number and
    // silently lands that candidate first.
    const optimum = { chosen: [{ slot: "Ring", variant: { variant_id: "R1" } }, { slot: "Neck", variant: { variant_id: "N1" } }, { slot: "Boots", variant: { variant_id: "B1" } }],
      setsActive: [], augmentsPlaced: [], effective: {} };
    const mk = (ids, axis, extra = {}) => A.analyzeAlternative(optimum,
      { sol: { chosen: ids.map(([slot, id]) => ({ slot, variant: { variant_id: id } })), setsActive: [], augmentsPlaced: [], effective: {} }, gainAxis: axis, meta: extra },
      { targets: [] });
    const reb = mk([["Ring", "R3"], ["Neck", "N3"], ["Boots", "B3"]], "rebalance", {});
    const crafts = mk([["Ring", "R4"], ["Neck", "N4"], ["Boots", "B4"]], "crafts", { optCrafts: 3 });
    const ranked = A.rankAlternatives([crafts, reb], optimum, { n: 5, k: 2 });
    assert.deepStrictEqual(ranked.map((a) => a.gainAxis), ["rebalance", "crafts"],
      "the remaining axes keep their relative order with no gap where utility was");
    for (const a of ranked) assert.ok(!a.tags.includes("utility effects"));
  });

  console.log(`\n${passed} passed`);
})();
