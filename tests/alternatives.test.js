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

  // #480 — the rebalance candidate must state the MINIMUM concession that buys its
  // gain. Phase 1 alone leaves the traded-from stat unconstrained anywhere inside
  // its give window among the solutions attaining the gain, so HiGHS returns an
  // incidental vertex and the card overstates the price. Ring Y1 and Ring Y2 deliver
  // the IDENTICAL +50 Doublestrike; only Y2 keeps Strength at 19.
  const minimalModel = () => ({
    targets: ["Strength", "Doublestrike"], mlCap: 34, dodgeCap: null,
    worn: [slot("Ring", [
      item("Ring X", "Ring", [["Strength", "Enhancement", 20]]),
      item("Ring Y1", "Ring", [["Strength", "Enhancement", 18], ["Doublestrike", "Enhancement", 50]]),
      item("Ring Y2", "Ring", [["Strength", "Enhancement", 19], ["Doublestrike", "Enhancement", 50]]),
    ])],
    augments: [],
  });

  await test("#480: the rebalance candidate states the MINIMAL concession, not a give-window vertex", async () => {
    const opt = await S.solveLexicographic(minimalModel(), highs);
    assert.strictEqual(opt.effective.Strength, 20, "optimum takes the plain +20 ring");
    assert.strictEqual(opt.effective.Doublestrike, 0);
    assert.strictEqual(S.alternativeGive(20), 2, "the give window admits BOTH Y1 (18) and Y2 (19)");
    const reb = S.generateAlternatives(opt, minimalModel(), highs)
      .find((a) => a.gainAxis === "rebalance");
    assert.ok(reb, "produced a rebalance candidate");
    // The whole point: 19, exactly — not merely ">= 18", which is what the
    // pre-#480 tree returned and what a loose assertion would let through.
    assert.strictEqual(reb.sol.effective.Strength, 19, "costs ONE point of Strength, not two");
    assert.ok(reb.sol.chosen.some((c) => c.variant.variant_id === "Ring Y2"),
      "equips the variant that buys the same gain for less");
  });

  await test("#480: re-tightening never lowers the gain it was bought with", async () => {
    const opt = await S.solveLexicographic(minimalModel(), highs);
    const reb = S.generateAlternatives(opt, minimalModel(), highs)
      .find((a) => a.gainAxis === "rebalance");
    assert.strictEqual(reb.sol.effective.Doublestrike, 50,
      "the traded-to priority still holds its phase-1 maximum");
  });

  await test("#480: a pair with no slack is unchanged by the re-tighten stage", async () => {
    // Only one build attains the Constitution gain, so there is nothing to tighten.
    const model = {
      targets: ["Strength", "Constitution"], mlCap: 34, dodgeCap: null,
      worn: [slot("Gloves", [
        item("Glove A", "Gloves", [["Strength", "Enhancement", 20]]),
        item("Glove B", "Gloves", [["Strength", "Enhancement", 18], ["Constitution", "Enhancement", 12]]),
      ])],
      augments: [],
    };
    const opt = await S.solveLexicographic(model, highs);
    const reb = S.generateAlternatives(opt, model, highs).find((a) => a.gainAxis === "rebalance");
    assert.ok(reb, "produced a rebalance candidate");
    assert.strictEqual(reb.sol.effective.Strength, 18, "the only build that buys the gain is still returned");
    assert.strictEqual(reb.sol.effective.Constitution, 12);
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

  // ---- #481: the concession axis ----

  // A ONE-SLOT concession: conceding 3 Strength makes Ring Y stage-optimal, and Ring
  // is the only slot that changes. This is the common shape of a small concession and
  // the exact shape the shared K=2 distinctness filter would throw away.
  const oneSlotModel = () => ({
    targets: ["Strength", "Doublestrike"], mlCap: 34, dodgeCap: null,
    worn: [slot("Ring", [
      item("Ring X", "Ring", [["Strength", "Enhancement", 20]]),
      item("Ring Y", "Ring", [["Strength", "Enhancement", 17], ["Doublestrike", "Enhancement", 30]]),
    ])],
    augments: [],
  });
  const asCandidate = (probe, stat) => ({
    sol: probe.sol, gainAxis: "concession",
    meta: { stat, cap: probe.cap, concession: probe.concession },
  });

  await test("#481: a concession is analyzed as its own axis, with the gain as the headline", async () => {
    const opt = await S.solveLexicographic(oneSlotModel(), highs);
    const query = { targets: ["Strength", "Doublestrike"] };
    const probe = await S.probeConcession(oneSlotModel(), opt.program, highs, "Strength",
      opt.program.targetList, opt.perTarget || opt.effective, {});
    assert.ok(probe, "the probe found a concession");
    const a = A.analyzeAlternative(opt, asCandidate(probe, "Strength"), query);
    assert.ok(a.tags.includes("concession"), "carries its own axis tag");
    assert.strictEqual(a.gainText, "+30 Doublestrike", "the headline is what the trade buys");
    assert.ok(/-3 Strength/.test(a.costText), "…and the concession is stated as a cost");
  });

  await test("#481 (KTD5): a ONE-SLOT concession survives ranking, and is dropped without the exemption", async () => {
    const opt = await S.solveLexicographic(oneSlotModel(), highs);
    const query = { targets: ["Strength", "Doublestrike"] };
    const probe = await S.probeConcession(oneSlotModel(), opt.program, highs, "Strength",
      opt.program.targetList, opt.perTarget || opt.effective, {});
    const a = A.analyzeAlternative(opt, asCandidate(probe, "Strength"), query);
    assert.strictEqual(a.minDistinct, 1, "the family carries its own minimum distinctness");
    assert.strictEqual(A.rankAlternatives([a], opt, {}).length, 1, "kept");
    // The counterfactual: the SAME candidate under the shared K is thrown away. This
    // is what makes the exemption load-bearing rather than incidental — a one-item
    // swap is the most valuable thing the probe can find, and the shared filter
    // exists to drop near-identical builds.
    const shared = { ...a, minDistinct: null };
    assert.strictEqual(A.rankAlternatives([shared], opt, {}).length, 0,
      "…and would be silently dropped without it");
  });

  await test("#481: a concession that costs a LOWER priority states that loss as a cost row", async () => {
    // Strength > Doublestrike > Deadly. Conceding Strength unlocks an Insight
    // Doublestrike that outranks the Necklace's, flipping the Necklace to the
    // Enhancement source and taking its Deadly with it.
    const lossy = () => ({
      targets: ["Strength", "Doublestrike", "Deadly"], mlCap: 34, dodgeCap: null,
      worn: [
        slot("Ring", [
          item("Ring X", "Ring", [["Strength", "Enhancement", 20]]),
          item("Ring Y", "Ring", [["Strength", "Enhancement", 17], ["Doublestrike", "Insight", 30]]),
        ]),
        slot("Necklace", [
          item("Neck P", "Necklace", [["Doublestrike", "Insight", 20], ["Deadly", "Enhancement", 25]]),
          item("Neck Q", "Necklace", [["Doublestrike", "Enhancement", 12]]),
        ]),
      ],
      augments: [],
    });
    const opt = await S.solveLexicographic(lossy(), highs);
    const query = { targets: ["Strength", "Doublestrike", "Deadly"] };
    const probe = await S.probeConcession(lossy(), opt.program, highs, "Strength",
      opt.program.targetList, opt.perTarget || opt.effective, {});
    const a = A.analyzeAlternative(opt, asCandidate(probe, "Strength"), query);
    assert.ok(/-25 Deadly/.test(a.costText), "the loss beneath the gain is a stated cost");
    assert.ok(a.costText !== "no priority cost", "a lossy trade can never read as free");
    const html = R.renderAltCards([a]);
    assert.ok(/Deadly -25/.test(html), "…and it reaches the rendered card");
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
    // #475 — the grants are ROWS in the Gains section now, not a `grants …` line.
    // U7's guarantee is unchanged: an alternative that says only "activates Alpha"
    // makes the player go and look up what Alpha does.
    assert.ok(/pd-slabel">Gains</.test(html), "the set's grants get a Gains section");
    assert.ok(/<span class="pd-ln-where">set<\/span><span class="pd-ln-what">Constitution \+3 Insightful/.test(html),
      "names the set's granted affix as its own row, not just the set");
  });

  await test("U7: renderAltCards omits the grants line for an alt that activates no set", () => {
    const html = R.renderAltCards([{ tags: ["rebalance"], gainText: "+5 Constitution", costText: "-3 Strength" }]);
    assert.ok(!/pd-slabel">Gains</.test(html),
      "no Gains section when nothing new is activated and no ranked stat went up");
  });

  await test("U7: renderAltCards degrades gracefully when an activated set resolves no affixes", () => {
    // activatedSets names a set absent from the candidate's setsActive -> activeSetDetail
    // finds no entry. The card must not crash and must still name the set via gainText.
    const html = R.renderAltCards([{ tags: ["set bonus"], gainText: "activates Ghost",
      costText: "no priority cost", activatedSets: ["Ghost"], sol: { setsActive: [], chosen: [] } }]);
    assert.ok(!/pd-slabel">Gains</.test(html), "no Gains section when the set's affixes cannot be resolved");
    assert.ok(/activates Ghost/.test(html), "the headline still names the set (no silent break)");
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
    // #475 — the COST comes from the structured `cost` array now, not from the
    // joined `costText` string. Re-parsing a rendered sentence back into data is
    // how two surfaces come to disagree about a number; `costText` survives for
    // the callers that want the one-line form.
    const ranked = [{ tags: ["set bonus", "cheaper crafting"], gainText: "activates Alpha",
      costText: "-7 Constitution", cost: [{ stat: "Constitution", delta: -7 }] }];
    const html = R.renderAltCards(ranked);
    assert.ok(/role="listbox"/.test(html) && /role="option"/.test(html), "listbox + option roles");
    assert.ok(/aria-selected="false"/.test(html) && /tabindex="0"/.test(html), "single-select a11y state");
    assert.ok(/activates Alpha/.test(html), "shows the gain as the card's headline");
    assert.ok(/<span class="pd-ln-what">Constitution -7<\/span>/.test(html), "…and the cost as a row");
    assert.ok(/set bonus/.test(html) && /cheaper crafting/.test(html), "shows the axis tags");
    assert.ok(!/alt-tag/.test(html), "…as the head's label, not as pill chips (#475)");
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

  await test("#348 U4: the cost accounting reads the GUARDED source, not the stage count", async () => {
    // Restores the guard `review fix 2` provided for the retired more-utility family.
    // The family is gone, but the confusable pair it protected against is NOT: a solve
    // result still carries BOTH `utilityCount` (the stage's lock-time value) and the
    // guarded, z-backed `utilityReport` / `utilityOrdered` the player actually sees.
    // Those two can differ, and alternatives.js still consumes utility state to state
    // what a trade gives up. Reaching for the stage count would measure a player-facing
    // claim against a number no surface displays.
    //
    // The technique is the original's: force the two apart, then assert the consumer
    // followed the guarded one.
    const mk = () => shedModel(["Constitution", SENT], 2, ["Water Breathing", "Ghost Touch", "Feather Falling"]);
    const opt = await S.solveLexicographic(mk(), highs);
    const alts = S.generateAlternatives(opt, mk(), highs);
    const setAlt = alts.find((a) => a.gainAxis === "set" && a.meta.set === "Alpha");
    assert.ok(setAlt, "the tail-shed candidate exists to analyze");

    const truth = A.analyzeAlternative(opt, setAlt, { targets: ["Constitution", SENT] });
    assert.deepStrictEqual(truth.shedEffects, ["Ghost Touch", "Feather Falling"]);

    // Now corrupt ONLY the stage count, leaving every guarded field intact.
    const corrupted = { ...opt, utilityCount: 0 };
    const after = A.analyzeAlternative(corrupted, setAlt, { targets: ["Constitution", SENT] });
    assert.deepStrictEqual(after.shedEffects, truth.shedEffects,
      "the named losses are unchanged — the stage count is not what the cost line reads");
    assert.strictEqual(after.costText, truth.costText);
    assert.strictEqual(after.utilDelta, truth.utilDelta);
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

  // -------------------------------------------------------------------------
  // #499 — the bar. The Alternatives tab showed the best five candidates on
  // five axes, whatever they cost. These tests pin the rule that replaced that.
  // -------------------------------------------------------------------------

  /** An analyzed candidate with a chosen cost/gain profile, without going
   *  through a solve. `analyzeAlternative` derives cost/gains from the deltas
   *  between two `effective` maps, so the fixture states both totals and lets
   *  the real analyzer do the subtraction — a hand-built `cost` array would pin
   *  the bar against a shape the analyzer might stop producing. */
  function candidate(optEffective, altEffective, targets, axis) {
    const optimum = { chosen: [{ slot: "Ring", variant: { variant_id: "R1" } }],
      setsActive: [], augmentsPlaced: [], effective: optEffective };
    const cand = A.analyzeAlternative(optimum,
      { sol: { chosen: [{ slot: "Ring", variant: { variant_id: "R2" } }], setsActive: [],
        augmentsPlaced: [], effective: altEffective },
        gainAxis: axis || "rebalance", meta: {} },
      { targets });
    return { optimum, cand, query: { targets } };
  }

  await test("#499: the suggestion that broke trust is rejected, at every bar setting", () => {
    // THE case, verbatim from the maintainer report: +1 of a low-ranked affix
    // bought with 5 points of a higher-ranked one. It must not come back at any
    // setting a player can choose — this is the rule, not a default.
    const { optimum, cand, query } = candidate(
      { "Melee Power": 300, Doublestrike: 40, Dodge: 20 },
      { "Melee Power": 295, Doublestrike: 40, Dodge: 21 },
      ["Melee Power", "Doublestrike", "Dodge"]);
    assert.deepStrictEqual(cand.cost.map((c) => [c.stat, c.delta]), [["Melee Power", -5]],
      "the fixture really does cost 5 of priority 1");
    assert.deepStrictEqual(cand.gains.map((g) => [g.stat, g.delta]), [["Dodge", 1]],
      "…to buy 1 of priority 3");
    for (const lossPct of [0, 2, 5, 10, 50, 100]) {
      const v = A.tradeVerdict(cand, optimum, query, { lossPct });
      assert.ok(!v.passes, `bar ${lossPct}% still lets it through`);
    }
    // And it is the RANK-WEIGHTED test that keeps it out once the bar is wide
    // open: 5/300 is only 1.7%, so the proportional test alone would admit it at
    // any bar of 2% or more. That is precisely the blind spot the second test
    // covers, so assert the mechanism and not merely the outcome.
    const wide = A.tradeVerdict(cand, optimum, query, { lossPct: 100 });
    assert.ok(wide.lossPct < 2, "the proportional test finds this loss small…");
    assert.ok(wide.ratio < A.MIN_GAIN_RATIO, "…and the rank-weighted test is what rejects it");
  });

  await test("#499: free upgrades pass at the shipped default, and cost-bearing ones do not", () => {
    const free = candidate({ "Melee Power": 300, Dodge: 20 }, { "Melee Power": 300, Dodge: 24 },
      ["Melee Power", "Dodge"]);
    const fv = A.tradeVerdict(free.cand, free.optimum, free.query, {});
    assert.ok(fv.free && fv.passes, "+4 Dodge for nothing is a free upgrade");
    assert.strictEqual(A.DEFAULT_LOSS_PCT, 0, "the shipped default is free-only");

    // A trade that is genuinely good — a small loss low down buying a large gain
    // — is still withheld at the default, because the default promises free.
    const good = candidate({ Doublestrike: 60, "Melee Power": 300 },
      { Doublestrike: 57, "Melee Power": 342 }, ["Doublestrike", "Melee Power"]);
    assert.ok(!A.tradeVerdict(good.cand, good.optimum, good.query, {}).passes,
      "withheld at the default…");
    assert.ok(A.tradeVerdict(good.cand, good.optimum, good.query, { lossPct: 10 }).passes,
      "…and offered once the player opens the bar to 10%");
  });

  await test("#499: neither test alone is enough — each covers the other's blind spot", () => {
    // Blind spot of the PROPORTIONAL test: a big absolute loss riding on a big
    // total. 30 Melee Power is a real loss, but it is only 10% of 300.
    const bigTotal = candidate({ "Melee Power": 300, Dodge: 20 },
      { "Melee Power": 270, Dodge: 25 }, ["Melee Power", "Dodge"]);
    const b = A.tradeVerdict(bigTotal.cand, bigTotal.optimum, bigTotal.query, { lossPct: 10 });
    assert.ok(b.lossPct <= 10, "the proportional test is satisfied");
    assert.ok(!b.passes, "but rank weighting rejects paying priority 1 for priority 2");

    // Blind spot of the RANK-WEIGHTED test: a trade paid out of a small total
    // into a large one, where weighting raises no objection because the gain is
    // on a LOWER priority and huge. 15 of a 20-point stat is most of it.
    const smallTotal = candidate({ Doublestrike: 20, Dodge: 5 },
      { Doublestrike: 5, Dodge: 400 }, ["Doublestrike", "Dodge"]);
    const sm = A.tradeVerdict(smallTotal.cand, smallTotal.optimum, smallTotal.query, { lossPct: 10 });
    assert.ok(sm.ratio >= A.MIN_GAIN_RATIO, "the rank-weighted test is satisfied");
    assert.ok(!sm.passes, "but losing 75% of a priority is not a small concession");
  });

  await test("#499: an upgrade that sheds a utility effect is never free", () => {
    // #348 settled that the tier is a cost and never a gain. A "free upgrade"
    // that quietly drops Ghostly is exactly the hidden price the bar exists to
    // stop, so a shed effect must break `free` even when no stat moves down.
    const SENT = "__utility__";
    const mkSol = (id, report) => ({
      chosen: [{ slot: "Ring", variant: { variant_id: id } }],
      setsActive: [], augmentsPlaced: [], effective: { Dodge: 20 },
      utilityReport: report,
    });
    const optimum = Object.assign(mkSol("R1", { count: 1, effects: [{ name: "Ghostly", item: "R1" }] }),
      { utilityOrdered: { secured: ["Ghostly"], unsecured: [] } });
    const cand = A.analyzeAlternative(optimum,
      { sol: mkSol("R2", { count: 0, effects: [] }), gainAxis: "rebalance", meta: {} },
      { targets: ["Dodge", SENT] });
    assert.deepStrictEqual(cand.shedEffects, ["Ghostly"], "the fixture sheds an effect");
    assert.deepStrictEqual(cand.cost, [], "…and no ranked stat moves down");
    const v = A.tradeVerdict(cand, optimum, { targets: ["Dodge", SENT] },
      { utilitySentinel: SENT });
    assert.ok(!v.free, "a shed effect is a cost, so this is not free");
    assert.ok(!v.passes, "and it does not pass a free-only bar");
  });

  await test("#499: filterUpgrades keeps the ranking it was handed and tags each verdict", () => {
    const free = candidate({ Dodge: 20 }, { Dodge: 24 }, ["Dodge"]);
    const costly = candidate({ "Melee Power": 300, Dodge: 20 },
      { "Melee Power": 295, Dodge: 21 }, ["Melee Power", "Dodge"]);
    const kept = A.filterUpgrades([costly.cand, free.cand], free.optimum, free.query, {});
    assert.strictEqual(kept.length, 1, "only the free one survives the default bar");
    assert.ok(kept[0].verdict.free, "and it carries the verdict that let it through");
    // Rejections carry a verdict too, so a caller can say WHY rather than
    // silently showing a shorter list.
    const v = A.tradeVerdict(costly.cand, costly.optimum, costly.query, {});
    assert.ok(!v.passes && typeof v.lossPct === "number" && typeof v.ratio === "number",
      "a rejection is explainable, not just absent");
  });

  await test("#499: a gain outside the ranked list can only ever be free", () => {
    // Observed on a real ML20 melee solve: of the five candidates the generator
    // produced, two were `unranked` — they cost nothing on any ranked stat but
    // shed Ethereal and Immunity to Fear to buy a stat the player never asked
    // for. Weighted gain is measured over the ranked priorities, so a candidate
    // gaining outside that list scores zero and passes only by costing nothing.
    // That is the rule, not a gap: an unranked stat is one rung BELOW the
    // low-ranked affix in the report that motivated the bar.
    const SENT = "__utility__";
    const mkSol = (id, report) => ({
      chosen: [{ slot: "Ring", variant: { variant_id: id } }],
      setsActive: [], augmentsPlaced: [], effective: { Dodge: 20 }, utilityReport: report,
    });
    const optimum = Object.assign(mkSol("R1", { count: 1, effects: [{ name: "Ethereal", item: "R1" }] }),
      { utilityOrdered: { secured: ["Ethereal"], unsecured: [] } });
    const cand = A.analyzeAlternative(optimum,
      { sol: mkSol("R2", { count: 0, effects: [] }), gainAxis: "unranked",
        meta: { stat: "Repair Amplification", zeroCost: false } },
      { targets: ["Dodge", SENT] });
    assert.deepStrictEqual(cand.gains, [], "the gain is off the ranked list, so nothing scores it");
    for (const lossPct of [0, 2, 5, 10, 100]) {
      assert.ok(!A.tradeVerdict(cand, optimum, { targets: ["Dodge", SENT] },
        { lossPct, utilitySentinel: SENT }).passes, `bar ${lossPct}% must still refuse it`);
    }
    // …and the same axis IS admitted when it genuinely costs nothing.
    const freeCand = A.analyzeAlternative(optimum,
      { sol: mkSol("R2", { count: 1, effects: [{ name: "Ethereal", item: "R2" }] }),
        gainAxis: "unranked", meta: { stat: "Repair Amplification", zeroCost: true } },
      { targets: ["Dodge", SENT] });
    assert.ok(A.tradeVerdict(freeCand, optimum, { targets: ["Dodge", SENT] },
      { utilitySentinel: SENT }).passes, "a free unranked gain is exactly what the default is for");
  });

  console.log(`\n${passed} passed`);
})();
