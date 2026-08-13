// U7 staged-lexicographic solver tests — run against the REAL HiGHS engine.
// Run: node tests/solver.test.js
const assert = require("assert");
const path = require("path");
const S = require("../web/solver.js");
const { normalizeDataset } = require("../web/dataset.js");

const vendor = path.join(__dirname, "..", "web", "vendor") + "/";
const Highs = require(vendor + "highs.js");

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  PASS", name); }
  catch (e) { console.log("  FAIL", name, "\n   ", e.message); process.exitCode = 1; }
}

// build a worn variant + a single-variant slot
function item(id, slot, affixes) {
  return {
    variant_id: id, source_item: id, slot,
    affixes: affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, name: stat, type: bonus_type, value, unit: "flat" })),
    scaling: [], set_bonus: [], augment_slots: [],
  };
}
function slot(name, variants, card = 1) { return { slot: name, cardinality: card, variants }; }

// a worn item that also offers augment slots of the given colors (U3)
function host(id, slotName, affixes, colors) {
  const v = item(id, slotName, affixes);
  v.augment_slots_norm = { colors: colors || [], quarantined: [] };
  return v;
}
// the compatibility matrix inverse the build bakes onto each augment (mirrors src/colors.fits_slots)
const AUG_FITS_SLOTS = {
  Red: ["Red", "Purple", "Orange"], Blue: ["Blue", "Purple", "Green"], Yellow: ["Yellow", "Orange", "Green"],
  Orange: ["Orange"], Green: ["Green"], Purple: ["Purple"],
  Colorless: ["Colorless", "Red", "Blue", "Yellow", "Orange", "Green", "Purple"],
  Moon: ["Moon"], Sun: ["Sun"],
};
// an augment record: its color lives in aug_color (U2-normalized); fits_slots is baked (U5)
function augment(id, color, affixes) {
  return {
    variant_id: id, source_item: id, category: "augment", slot: color,
    aug_color: { color, raw: color, reason: null }, fits_slots: AUG_FITS_SLOTS[color] || [],
    affixes: affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, name: stat, type: bonus_type, value, unit: "flat" })),
    scaling: [], set_bonus: [], augment_slots: [],
  };
}
// a worn item that belongs to a set and carries the set's parsed tier bonuses (U5)
function setPiece(id, slotName, affixes, setName, tiers) {
  const v = item(id, slotName, affixes);
  v.set_bonus = [{ set: setName }];
  v.parsed_set_bonuses = (tiers || []).map((t) => ({
    set: setName, pieces_required: t.n, pieces_label: `${t.n} Pieces`,
    affixes: t.affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, name: stat, type: bonus_type, value, unit: "flat" })),
    flagged: [],
  }));
  return v;
}
// an item that is BOTH an intrinsic set member AND a Colorless augment host (U4) —
// slotting a set augment into it must override (suppress) its own named set bonus.
function setHost(id, slotName, affixes, setName, tiers, colors) {
  const v = setPiece(id, slotName, affixes, setName, tiers);
  v.augment_slots_norm = { colors: colors || [], quarantined: [] };
  return v;
}

(async () => {
  const highs = await Highs({ locateFile: (f) => vendor + f });

  await test("AE2: same bonus-type does NOT stack (only highest counts)", async () => {
    const model = {
      targets: ["Intelligence"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [item("R", "Ring", [["Intelligence", "Enhancement", 10]])]),
             slot("Necklace", [item("N", "Necklace", [["Intelligence", "Enhancement", 6]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.Intelligence, 10, "max(10,6), not 16");
  });

  await test("different bonus-types DO stack (sum)", async () => {
    const model = {
      targets: ["Intelligence"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [item("R", "Ring", [["Intelligence", "Enhancement", 10]])]),
             slot("Necklace", [item("N", "Necklace", [["Intelligence", "Insightful", 6]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.Intelligence, 16);
  });

  await test("U4b-i: stacking-equivalence — 'Insight Natural' and 'Insight' do NOT stack (same bucket)", async () => {
    // Curated equivalence: "Insight Natural" collapses to the "Insight" bucket, so
    // an item typed "Insight Natural +10" and one typed "Insight +6" (same stat)
    // take the MAX, not the sum. Install the map (dataset.js does this on load).
    const M = require("../web/model.js");
    M.setStackEquiv({ "Insight Natural": "Insight", "Primal Natural": "Primal" });
    try {
      const collapse = {
        targets: ["Intelligence"], mlCap: 34, dodgeCap: null,
        worn: [slot("Ring", [item("R", "Ring", [["Intelligence", "Insight Natural", 10]])]),
               slot("Necklace", [item("N", "Necklace", [["Intelligence", "Insight", 6]])])],
      };
      const rc = await S.solveLexicographic(collapse, highs);
      assert.strictEqual(rc.status, "optimal");
      assert.strictEqual(rc.effective.Intelligence, 10, "equivalent types share a bucket: max(10,6), not 16");

      // Non-equivalent types (Insight + Enhancement) still stack (sum), unaffected.
      const stackModel = {
        targets: ["Intelligence"], mlCap: 34, dodgeCap: null,
        worn: [slot("Ring", [item("R", "Ring", [["Intelligence", "Insight", 10]])]),
               slot("Necklace", [item("N", "Necklace", [["Intelligence", "Enhancement", 6]])])],
      };
      const rs = await S.solveLexicographic(stackModel, highs);
      assert.strictEqual(rs.effective.Intelligence, 16, "distinct types stack: 10 + 6");
    } finally {
      M.setStackEquiv({}); // reset shared module state so later tests see identity
    }
  });

  await test("U3/#109: same-type Negative Amplification does NOT stack across channels (worn + augment)", async () => {
    // The reported double-count (Hooves 'Negative Amplification Profane 61' + a Lamordia
    // Viktranium 'Negative Amplification Profane 61') is a same-bucket collision: the
    // wiki types neg-amp (Insight/Quality/Profane), so same type -> only the highest
    // counts. Worn + a crafted/augment source share the "stat||type" bucket and the
    // Σz<=1 constraint, so they collapse. (The spurious 'Enhancement' neg-amp of #109
    // is already gone from the data, so the two real sources are both Profane.)
    const collapse = {
      targets: ["Negative Amplification"], mlCap: 34, dodgeCap: null,
      worn: [slot("Trinket", [host("Hooves", "Trinket", [["Negative Amplification", "Profane", 61]], ["Colorless"])])],
      augments: [augment("ProfaneNegAmpGem", "Colorless", [["Negative Amplification", "Profane", 61]])],
    };
    const rc = await S.solveLexicographic(collapse, highs);
    assert.strictEqual(rc.status, "optimal");
    assert.strictEqual(rc.effective["Negative Amplification"], 61, "same-type worn + augment collapse: max(61,61)=61, not 122");

    // Control: genuinely different types (Profane worn + Insight augment) DO stack, per DDO rules.
    const stackModel = {
      targets: ["Negative Amplification"], mlCap: 34, dodgeCap: null,
      worn: [slot("Trinket", [host("Hooves", "Trinket", [["Negative Amplification", "Profane", 61]], ["Colorless"])])],
      augments: [augment("InsightNegAmpGem", "Colorless", [["Negative Amplification", "Insight", 20]])],
    };
    const rs = await S.solveLexicographic(stackModel, highs);
    assert.strictEqual(rs.effective["Negative Amplification"], 81, "distinct types stack: 61 + 20");
  });

  await test("U2/AE1: boolean feature is presence — two sources do NOT stack", async () => {
    const model = {
      targets: ["Salt"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [item("R", "Ring", [["Salt", "boolean", 1]])]),
             slot("Necklace", [item("N", "Necklace", [["Salt", "boolean", 1]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.Salt, 1, "presence is 1 even with two Salt sources, never 2");
  });

  await test("U3/AE2: a targeted boolean prefers a loadout that has it", async () => {
    // One Trinket slot; only one variant grants Salt. With Salt ranked, the
    // solver must equip the Salt-bearing variant.
    const model = {
      targets: ["Salt"], mlCap: 34, dodgeCap: null,
      worn: [slot("Trinket", [
        item("noSalt", "Trinket", [["Accuracy", "Enhancement", 10]]),
        item("hasSalt", "Trinket", [["Salt", "boolean", 1]]),
      ])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.Salt, 1, "the Salt-bearing variant is chosen for a Salt target");
    assert.strictEqual(r.chosen[0].variant.variant_id, "hasSalt");
  });

  await test("U3: a non-target boolean never perturbs the optimum (soundness)", async () => {
    // Salt is NOT a target; a Salt source must not change which item wins the
    // slot on the real (Accuracy) target.
    const model = {
      targets: ["Accuracy"], mlCap: 34, dodgeCap: null,
      worn: [slot("Trinket", [
        item("hiAcc", "Trinket", [["Accuracy", "Enhancement", 10]]),
        item("saltLowAcc", "Trinket", [["Accuracy", "Enhancement", 6], ["Salt", "boolean", 1]]),
      ])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.Accuracy, 10, "the higher-Accuracy item wins; Salt is irrelevant");
    assert.strictEqual(r.chosen[0].variant.variant_id, "hiAcc");
  });

  await test("AE3: dodge cap clamps (item still equipped)", async () => {
    const model = {
      targets: ["Dodge"], mlCap: 34, dodgeCap: 4,
      worn: [slot("Ring", [item("R", "Ring", [["Dodge", "Enhancement", 20]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.Dodge, 4, "clamped to cap, not forbidden");
    assert.strictEqual(r.chosen.length, 1, "the dodge item is still equipped");
  });

  await test("U1: user cap clamps a stat (item still equipped)", async () => {
    const model = {
      targets: ["Intelligence"], mlCap: 34, dodgeCap: null, userCaps: { Intelligence: 5 },
      worn: [slot("Ring", [item("R", "Ring", [["Intelligence", "Enhancement", 20]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.Intelligence, 5, "clamped to the user cap, not forbidden");
    assert.strictEqual(r.chosen.length, 1, "the item is still equipped");
  });

  await test("U1: a cap frees a slot for the next priority (AE1)", async () => {
    // A stacks across two slots (Enhancement on Ring + Insight on Necklace); B needs a slot.
    const worn = () => [
      slot("Ring", [item("rA", "Ring", [["A", "Enhancement", 10]]), item("rB", "Ring", [["B", "Enhancement", 10]])]),
      slot("Necklace", [item("nA", "Necklace", [["A", "Insight", 10]]), item("nB", "Necklace", [["B", "Insight", 10]])]),
    ];
    const uncapped = await S.solveLexicographic({ targets: ["A", "B"], mlCap: 34, dodgeCap: null, worn: worn() }, highs);
    assert.strictEqual(uncapped.effective.A, 20, "uncapped: A stacks across both slots");
    assert.strictEqual(uncapped.effective.B, 0, "uncapped: both slots spent maximizing A");
    const capped = await S.solveLexicographic({ targets: ["A", "B"], mlCap: 34, dodgeCap: null, userCaps: { A: 10 }, worn: worn() }, highs);
    assert.strictEqual(capped.effective.A, 10, "capped: A saturates at the cap");
    assert.strictEqual(capped.effective.B, 10, "capped: the freed slot now serves B");
  });

  await test("U1: user Dodge cap and armor dodge cap take the min", async () => {
    const worn = () => [slot("Ring", [item("R", "Ring", [["Dodge", "Enhancement", 20]])])];
    const a = await S.solveLexicographic({ targets: ["Dodge"], mlCap: 34, dodgeCap: 10, userCaps: { Dodge: 4 }, worn: worn() }, highs);
    assert.strictEqual(a.effective.Dodge, 4, "user cap 4 < armor cap 10 wins");
    const b = await S.solveLexicographic({ targets: ["Dodge"], mlCap: 34, dodgeCap: 4, userCaps: { Dodge: 10 }, worn: worn() }, highs);
    assert.strictEqual(b.effective.Dodge, 4, "armor cap 4 < user cap 10 wins");
  });

  await test("U1: query.targetCaps flows through buildModel into a clamped solve", async () => {
    // End-to-end plumbing guard (KTD3/KTD7): a cap on a stat that is a priority
    // survives the cap-unaware dominance pre-filter and clamps in the real solve.
    const M = require("../web/model.js");
    const ring = {
      source_item: "R", variant_id: "R", slot: "Ring", category: "item",
      minimum_level: 30, ml: 30, verification: "verified",
      affixes: [{ stat: "Intelligence", bonus_type: "Enhancement", name: "Intelligence", type: "Enhancement", value: 20, unit: "flat" }],
      scaling: [], set_bonus: [], augment_slots: [], restrictions: "unknown", armor_type: null,
    };
    const model = M.buildModel([ring], { mlCap: 34, targets: ["Intelligence"], targetCaps: { Intelligence: 7 }, targetFloors: {} });
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.Intelligence, 7, "the user cap from the query clamps end-to-end");
  });

  await test("U2: reachable floor is met, then the rest is maximized", async () => {
    // Floor B >= 10 forces the B item; A is then maximized in the other slot.
    const model = {
      targets: ["A"], mlCap: 34, dodgeCap: null, floors: { B: 10 },
      worn: [
        slot("Ring", [item("rB", "Ring", [["B", "Enhancement", 10]])]),
        slot("Necklace", [item("nA", "Necklace", [["A", "Enhancement", 10]])]),
      ],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.A, 10, "priority A still maximized");
    assert.deepStrictEqual(r.floorReport, [], "floor met, no shortfall");
    assert.ok(r.chosen.some((c) => c.variant.variant_id === "rB"), "the B item is equipped to meet the floor");
  });

  await test("U2: unreachable floor is best-effort, never infeasible", async () => {
    const model = {
      targets: ["A"], mlCap: 34, dodgeCap: null, floors: { B: 100 },
      worn: [
        slot("Ring", [item("rB", "Ring", [["B", "Enhancement", 10]]), item("rA", "Ring", [["A", "Enhancement", 10]])]),
      ],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal", "returns a loadout, not infeasible");
    assert.strictEqual(r.floorReport.length, 1);
    assert.strictEqual(r.floorReport[0].stat, "B");
    assert.strictEqual(r.floorReport[0].floor, 100);
    assert.strictEqual(r.floorReport[0].achieved, 10, "reports the best achievable");
  });

  await test("U2: two jointly-infeasible floors relax in reverse-priority order", async () => {
    // One slot can hold only PRR or MRR. Both floors are individually reachable (10)
    // but not together. PRR is the higher priority, so MRR's floor is relaxed.
    const model = {
      targets: ["PRR", "MRR"], mlCap: 34, dodgeCap: null, floors: { PRR: 10, MRR: 10 },
      worn: [slot("Trinket", [
        item("tP", "Trinket", [["PRR", "Enhancement", 10]]),
        item("tM", "Trinket", [["MRR", "Enhancement", 10]]),
      ])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal", "never bails to infeasible");
    assert.strictEqual(r.effective.PRR, 10, "the higher-priority floor is kept");
    const mrr = r.floorReport.find((f) => f.stat === "MRR");
    assert.ok(mrr && mrr.achieved === 0, "the lower-priority floor is relaxed and reported");
  });

  // U6 (KTD6) — characterize the "Kinetic Lore ×4, no Kinetic Intensity" report.
  // Finding: no genuine zero-marginal bug survives. A same-bonus-type duplicate that
  // adds nothing is already dropped by the tie-break in favor of the next priority;
  // distinct-bonus-type stacking that legitimately consumes slots is CORRECT strict
  // lexicographic, and a per-stat cap (U1) is the intended lever to free slots.
  await test("U6: a zero-marginal same-type duplicate is dropped for the next priority", async () => {
    const model = {
      targets: ["KL", "KI"], mlCap: 34, dodgeCap: null,
      worn: [
        slot("Ring", [item("klA", "Ring", [["KL", "Enhancement", 10]])]),
        slot("Necklace", [item("klDup", "Necklace", [["KL", "Enhancement", 10]]), item("kiX", "Necklace", [["KI", "Enhancement", 10]])]),
      ],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.KL, 10, "KL maxed (same bonus type does not stack)");
    assert.strictEqual(r.effective.KI, 10, "the freed slot serves the next priority");
    assert.ok(r.chosen.some((c) => c.variant.variant_id === "kiX"), "next priority served");
    assert.ok(!r.chosen.some((c) => c.variant.variant_id === "klDup"), "the redundant duplicate is NOT equipped");
  });

  await test("set-tab: a membership-awakened set carries its granted affixes on setsActive", async () => {
    // A Lost Purpose host (no static set_bonus) that awakens a set from the runtime def.
    // The Set Bonuses tab reads these affixes off setsActive, since the host carries none.
    const host = {
      variant_id: "Host", source_item: "Host", slot: "Armor",
      affixes: [], scaling: [], set_bonus: [], parsed_set_bonuses: [], augment_slots: [],
      set_membership_slot: { pool: ["MySet"], station: "Cannith Repurposing Station" },
    };
    const model = {
      targets: ["Intelligence"], mlCap: 34, dodgeCap: null,
      worn: [slot("Armor", [host])],
      membershipSetDefs: { MySet: { tiers: [
        { pieces_required: 1, pieces_label: "1 Piece", affixes: [
          { stat: "Intelligence", bonus_type: "Artifact", value: 3, unit: "flat" },
          { stat: "Strength", bonus_type: "Artifact", value: 3, unit: "flat" },
        ] },
      ] } },
    };
    const r = await S.solveLexicographic(model, highs);
    const active = (r.setsActive || []).find((s) => s.set === "MySet");
    assert.ok(active, "the set is completed via membership");
    assert.ok((active.affixes || []).some((a) => a.stat === "Intelligence" && a.value === 3),
      "setsActive carries the granted affixes for the Set tab to render");
  });

  await test("U6: distinct-type stacking consumes slots (correct); a cap is the lever", async () => {
    const worn = () => [
      slot("Ring", [item("klE", "Ring", [["KL", "Enhancement", 10]])]),
      slot("Necklace", [item("klI", "Necklace", [["KL", "Insight", 10]]), item("kiX", "Necklace", [["KI", "Enhancement", 10]])]),
    ];
    const nocap = await S.solveLexicographic({ targets: ["KL", "KI"], mlCap: 34, dodgeCap: null, worn: worn() }, highs);
    assert.strictEqual(nocap.effective.KL, 20, "distinct types stack — KL legitimately uses both slots");
    assert.strictEqual(nocap.effective.KI, 0, "KI unserved: correct strict-lexicographic output, not a bug");
    const capped = await S.solveLexicographic({ targets: ["KL", "KI"], mlCap: 34, dodgeCap: null, userCaps: { KL: 10 }, worn: worn() }, highs);
    assert.strictEqual(capped.effective.KL, 10, "cap saturates KL");
    assert.strictEqual(capped.effective.KI, 10, "the freed slot now serves KI");
  });

  await test("AE1: lexicographic — priority 1 maxed even at cost of priority 2", async () => {
    // one slot, must choose: v1 gives A=10/B=0, v2 gives A=0/B=10. A has priority.
    const model = {
      targets: ["Accuracy", "Deadly"], mlCap: 34, dodgeCap: null,
      worn: [slot("Trinket", [
        item("hiA", "Trinket", [["Accuracy", "Enhancement", 10]]),
        item("hiB", "Trinket", [["Deadly", "Enhancement", 10]]),
      ])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.Accuracy, 10, "priority 1 maxed");
    assert.strictEqual(r.effective.Deadly, 0, "priority 2 sacrificed to keep priority 1");
    assert.strictEqual(r.chosen[0].variant.variant_id, "hiA");
  });

  await test("reversing priority flips the choice", async () => {
    const model = {
      targets: ["Deadly", "Accuracy"], mlCap: 34, dodgeCap: null,
      worn: [slot("Trinket", [
        item("hiA", "Trinket", [["Accuracy", "Enhancement", 10]]),
        item("hiB", "Trinket", [["Deadly", "Enhancement", 10]]),
      ])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.Deadly, 10);
    assert.strictEqual(r.chosen[0].variant.variant_id, "hiB");
  });

  await test("capped target with NO source reports 0, not the cap", async () => {
    const model = {
      targets: ["Dodge"], mlCap: 34, dodgeCap: 4,
      worn: [slot("Ring", [item("R", "Ring", [["Intelligence", "Enhancement", 10]])])], // no Dodge anywhere
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.Dodge, 0, "no dodge source -> 0, not the cap");
  });

  await test("solve is deterministic across runs (tie-break)", async () => {
    const mk = () => ({
      targets: ["Intelligence"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [item("R1", "Ring", [["Intelligence", "Enhancement", 5]]),
                           item("R2", "Ring", [["Intelligence", "Enhancement", 5]])], 1)],
    });
    const a = await S.solveLexicographic(mk(), highs);
    const b = await S.solveLexicographic(mk(), highs);
    assert.deepStrictEqual(a.chosen.map((c) => c.variant.variant_id), b.chosen.map((c) => c.variant.variant_id));
  });

  await test("U1 primitive: a contribution is gated by ALL of its gates", async () => {
    // A hand-built program with a two-gate contribution must emit one
    // `z - gate <= 0` per gate, and declare the extra structural binary.
    const program = {
      xVars: [{ name: "x0", slot: "Ring", cardinality: 1, variant: {} }],
      zByBucket: new Map([["Strength||Enhancement", [{ name: "z0", gates: ["x0", "g1"], value: 5 }]]]),
      extraVars: ["g1"],
      extraConstraints: ["g1 - x0 <= 0"],
      cappedStats: {},
      targetList: ["Strength"],
      model: {},
    };
    const lp = S.encodeStage(program, { objectiveStat: "Strength", sense: "max", locks: [] });
    assert.ok(lp.includes("z0 - x0 <= 0"), "gate on the item pick var");
    assert.ok(lp.includes("z0 - g1 <= 0"), "gate on the extra structural binary");
    assert.ok(/\bg1 - x0 <= 0\b/.test(lp), "extraConstraint injected verbatim");
    assert.ok(/Binary[\s\S]*\bg1\b/.test(lp), "extra binary declared");
  });

  await test("U3/AE2: augment counts only with a matching open slot", async () => {
    const withSlot = {
      targets: ["Resistance"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [host("R", "Ring", [], ["Blue"])])],
      augments: [augment("SapphireRes5", "Blue", [["Resistance", "Enhancement", 5]])],
    };
    const a = await S.solveLexicographic(withSlot, highs);
    assert.strictEqual(a.effective.Resistance, 5, "placed into the open Blue slot");

    const wrongColor = {
      targets: ["Resistance"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [host("R", "Ring", [], ["Red"])])], // no Blue slot
      augments: [augment("SapphireRes5", "Blue", [["Resistance", "Enhancement", 5]])],
    };
    const b = await S.solveLexicographic(wrongColor, highs);
    assert.strictEqual(b.effective.Resistance, 0, "no matching open slot -> augment cannot count");
  });

  await test("U3/AE4: augment obeys bonus-type stacking with worn", async () => {
    const sameType = {
      targets: ["Resistance"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [host("R", "Ring", [["Resistance", "Enhancement", 4]], ["Blue"])])],
      augments: [augment("A", "Blue", [["Resistance", "Enhancement", 5]])],
    };
    const s = await S.solveLexicographic(sameType, highs);
    assert.strictEqual(s.effective.Resistance, 5, "same type -> max(4,5), not 9");

    const diffType = {
      targets: ["Resistance"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [host("R", "Ring", [["Resistance", "Enhancement", 4]], ["Blue"])])],
      augments: [augment("A", "Blue", [["Resistance", "Insightful", 5]])],
    };
    const d = await S.solveLexicographic(diffType, highs);
    assert.strictEqual(d.effective.Resistance, 9, "different types -> 4 + 5");
  });

  await test("U3: per-color capacity bounds placements (one slot -> one augment)", async () => {
    const oneSlot = {
      targets: ["Resistance", "Intelligence"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [host("R", "Ring", [], ["Blue"])])], // exactly one Blue slot
      augments: [
        augment("Res", "Blue", [["Resistance", "Enhancement", 5]]),
        augment("Int", "Blue", [["Intelligence", "Enhancement", 5]]),
      ],
    };
    const r = await S.solveLexicographic(oneSlot, highs);
    assert.strictEqual(r.effective.Resistance, 5, "priority 1 augment placed");
    assert.strictEqual(r.effective.Intelligence, 0, "only one Blue slot -> second augment cannot fit");

    const twoSlots = {
      targets: ["Resistance", "Intelligence"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [host("R", "Ring", [], ["Blue", "Blue"])])], // two Blue slots
      augments: [
        augment("Res", "Blue", [["Resistance", "Enhancement", 5]]),
        augment("Int", "Blue", [["Intelligence", "Enhancement", 5]]),
      ],
    };
    const r2 = await S.solveLexicographic(twoSlots, highs);
    assert.strictEqual(r2.effective.Intelligence, 5, "two Blue slots -> both augments fit");
  });

  await test("U3: Lunar/Solar augments only fill Moon/Sun slots", async () => {
    const moonSlot = {
      targets: ["Resistance"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [host("R", "Ring", [], ["Moon"])])],
      augments: [augment("Lunar", "Moon", [["Resistance", "Enhancement", 5]])],
    };
    assert.strictEqual((await S.solveLexicographic(moonSlot, highs)).effective.Resistance, 5);

    const blueSlot = {
      targets: ["Resistance"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [host("R", "Ring", [], ["Blue"])])],
      augments: [augment("Lunar", "Moon", [["Resistance", "Enhancement", 5]])],
    };
    assert.strictEqual((await S.solveLexicographic(blueSlot, highs)).effective.Resistance, 0,
      "a Moon augment cannot go in a Blue slot");
  });

  await test("U3/AE1: a Red augment fits an Orange slot (multi-fit)", async () => {
    const m = {
      targets: ["Strength"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [host("R", "Ring", [], ["Orange"])])], // only an Orange slot
      augments: [augment("RedStr", "Red", [["Strength", "Enhancement", 15]])], // a Red augment
    };
    assert.strictEqual((await S.solveLexicographic(m, highs)).effective.Strength, 15,
      "a Red augment legally fills an Orange slot");
  });

  await test("U3/AE2: a Colorless augment fits a colored (Blue) slot", async () => {
    const m = {
      targets: ["Strength"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [host("R", "Ring", [], ["Blue"])])],
      augments: [augment("DiamondStr", "Colorless", [["Strength", "Enhancement", 15]])],
    };
    assert.strictEqual((await S.solveLexicographic(m, highs)).effective.Strength, 15,
      "Colorless fits any colored slot");
  });

  await test("U3/AE3: two slots take two different bonus types (stack), not two same-type", async () => {
    const m = {
      targets: ["Constitution"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [host("R", "Ring", [], ["Orange", "Orange"])])], // two Orange slots
      augments: [
        augment("EnhCon", "Red", [["Constitution", "Enhancement", 15]]),   // Red fits Orange
        augment("InsCon", "Yellow", [["Constitution", "Insightful", 7]]),  // Yellow fits Orange
      ],
    };
    assert.strictEqual((await S.solveLexicographic(m, highs)).effective.Constitution, 22,
      "Enhancement 15 + Insightful 7 stack across the two slots (not two same-type)");
  });

  await test("U3: a Unique-Equipped augment is placed at most once across slots", async () => {
    const uniq = augment("UniqStr", "Red", [["Strength", "Enhancement", 15]]);
    uniq.unique_equipped = true;
    const m = {
      targets: ["Strength"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [host("R", "Ring", [], ["Orange", "Orange"])])], // two compatible slots
      augments: [uniq],
    };
    const r = await S.solveLexicographic(m, highs);
    assert.strictEqual(r.effective.Strength, 15, "unique-equipped counts once even with two open slots");
    assert.strictEqual((r.augmentsPlaced || []).length, 1, "placed at most once");
  });

  await test("U3: a placement record is self-describing — it carries the augment's affixes", async () => {
    // The record is what every surface downstream renders from, and `persist.js`
    // stores it WITHOUT the catalog — so if the affixes don't ride along here,
    // a reloaded build has no way back to them. Dropping this field is exactly
    // how the Set Bonuses set-like list and the text exports went name-only.
    const m = {
      targets: ["Strength"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [host("R", "Ring", [], ["Orange"])])],
      augments: [augment("SolarStr", "Red", [["Strength", "Enhancement", 15]])],
    };
    const placed = (await S.solveLexicographic(m, highs)).augmentsPlaced || [];
    assert.strictEqual(placed.length, 1, "the augment is placed");
    assert.deepStrictEqual((placed[0].affixes || []).map((a) => [a.name, a.type, a.value]),
      [["Strength", "Enhancement", 15]],
      "the placement record carries the affixes the augment grants");
  });

  await test("U3: same bonus-type across two slots does NOT inflate one bucket (bucket-max)", async () => {
    // Two Orange slots and two same-typed augments (Con Enhancement 15 and 10).
    // Both can be placed (capacity allows), but they share the (Constitution,
    // Enhancement) bucket, so bucket-max keeps only the highest — the invariant the
    // no-used-once design rests on. A regression that summed slots would give 25.
    const m = {
      targets: ["Constitution"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [host("R", "Ring", [], ["Orange", "Orange"])])],
      augments: [
        augment("EnhCon15", "Red", [["Constitution", "Enhancement", 15]]),
        augment("EnhCon10", "Yellow", [["Constitution", "Enhancement", 10]]),
      ],
    };
    assert.strictEqual((await S.solveLexicographic(m, highs)).effective.Constitution, 15,
      "max(15,10) across two slots, not 25 — same-type never stacks");
  });

  await test("U3: an augment cannot be placed on an UNequipped host", async () => {
    // One Ring slot, two competitors: A carries a Blue augment slot; B has no slot
    // but wins the slot on the priority-1 target (Strength 20 > A's 10). The Int
    // augment fits only A's Blue slot, so once B is equipped its supply is 0 and
    // the augment cannot count. A broken host->capacity gate would leak Int = 5.
    const m = {
      targets: ["Strength", "Intelligence"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [
        host("A", "Ring", [["Strength", "Enhancement", 10]], ["Blue"]),
        item("B", "Ring", [["Strength", "Enhancement", 20]]),
      ])],
      augments: [augment("Int", "Blue", [["Intelligence", "Enhancement", 5]])],
    };
    const r = await S.solveLexicographic(m, highs);
    assert.strictEqual(r.effective.Strength, 20, "B wins the slot on the priority target");
    assert.strictEqual(r.effective.Intelligence, 0, "augment's host is unequipped -> it cannot be placed");
    assert.strictEqual((r.augmentsPlaced || []).length, 0, "no placement without an equipped compatible host");
  });

  await test("U5/AE1: set stat counts only at the piece threshold", async () => {
    const tier = [{ n: 2, affixes: [["Strength", "Enhancement", 10]] }];
    const twoPieces = {
      targets: ["Strength"], mlCap: 34, dodgeCap: null,
      worn: [
        slot("Ring", [setPiece("R", "Ring", [], "TestSet", tier)]),
        slot("Necklace", [setPiece("N", "Necklace", [], "TestSet", tier)]),
      ],
    };
    const a = await S.solveLexicographic(twoPieces, highs);
    assert.strictEqual(a.effective.Strength, 10, "2 pieces -> set bonus active");
    assert.strictEqual(a.chosen.length, 2, "both set pieces equipped");

    const onePiece = {
      targets: ["Strength"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [setPiece("R", "Ring", [], "TestSet", tier)])],
    };
    const b = await S.solveLexicographic(onePiece, highs);
    assert.strictEqual(b.effective.Strength, 0, "1 piece < threshold -> no set bonus");
  });

  await test("U5: set bonus obeys bonus-type stacking with worn", async () => {
    const sameType = {
      targets: ["Strength"], mlCap: 34, dodgeCap: null,
      worn: [
        slot("Ring", [setPiece("R", "Ring", [["Strength", "Enhancement", 6]], "TestSet",
          [{ n: 2, affixes: [["Strength", "Enhancement", 10]] }])]),
        slot("Necklace", [setPiece("N", "Necklace", [], "TestSet",
          [{ n: 2, affixes: [["Strength", "Enhancement", 10]] }])]),
      ],
    };
    const s = await S.solveLexicographic(sameType, highs);
    assert.strictEqual(s.effective.Strength, 10, "same type -> max(worn 6, set 10)");

    const diffType = {
      targets: ["Strength"], mlCap: 34, dodgeCap: null,
      worn: [
        slot("Ring", [setPiece("R", "Ring", [["Strength", "Enhancement", 6]], "TestSet",
          [{ n: 2, affixes: [["Strength", "Insightful", 10]] }])]),
        slot("Necklace", [setPiece("N", "Necklace", [], "TestSet",
          [{ n: 2, affixes: [["Strength", "Insightful", 10]] }])]),
      ],
    };
    const d = await S.solveLexicographic(diffType, highs);
    assert.strictEqual(d.effective.Strength, 16, "different types -> worn 6 + set 10");
  });

  // ---- U4: Isle of Dread Dino crafting (typed slot-pools) ----
  // a Dinosaur Bone blank host: worn item with typed Dino slots, no base affixes
  // Slots are keyed `type||category`; a bare "Scale" is treated as Accessory so
  // the pre-M2 tests read naturally.
  function dinoHost(id, slotName, dinoTypes, affixes) {
    const v = item(id, slotName, affixes || []);
    v.dino_slots_norm = (dinoTypes || []).map((t) => (t.includes("||") ? t : `${t}||Accessory`));
    return v;
  }
  // a Dino insert UNIT (one (dino_type, category) carrying >=1 affix)
  function dinoIns(dino_type, stat, bonus_type, value, category) {
    return {
      dino_type, category: category || "Accessory",
      affixes: [{ stat, bonus_type, value, unit: "flat" }], wiki_url: "wiki",
    };
  }
  // a multi-affix Dino insert UNIT (KTD4): several affixes from one placement
  function dinoMulti(dino_type, affixes, category) {
    return {
      dino_type, category: category || "Accessory",
      affixes: affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, name: stat, type: bonus_type, value, unit: "flat" })),
      wiki_url: "wiki",
    };
  }

  await test("Dino/AE1: insert counts only when its host is equipped + placed", async () => {
    const withHost = {
      targets: ["Constitution"], mlCap: 34, dodgeCap: null,
      worn: [slot("Boots", [dinoHost("B", "Boots", ["Scale"])])],
      dinoInserts: [dinoIns("Scale", "Constitution", "Enhancement", 14)],
    };
    const a = await S.solveLexicographic(withHost, highs);
    assert.strictEqual(a.effective.Constitution, 14, "placed into the open Scale slot");
    assert.ok(a.dinoPlaced.some((d) => d.affixes.some((x) => x.stat === "Constitution")), "reported as placed");

    const noHost = {
      targets: ["Constitution"], mlCap: 34, dodgeCap: null,
      worn: [slot("Boots", [item("B", "Boots", [])])], // host has no Dino slots
      dinoInserts: [dinoIns("Scale", "Constitution", "Enhancement", 14)],
    };
    const b = await S.solveLexicographic(noHost, highs);
    assert.strictEqual(b.effective.Constitution, 0, "no Scale slot -> insert cannot count");
  });

  await test("Dino/AE2: an insert fills only a matching-type slot", async () => {
    const wrongType = {
      targets: ["Constitution"], mlCap: 34, dodgeCap: null,
      worn: [slot("Boots", [dinoHost("B", "Boots", ["Fang"])])], // Fang slot, not Scale
      dinoInserts: [dinoIns("Scale", "Constitution", "Enhancement", 14)],
    };
    const r = await S.solveLexicographic(wrongType, highs);
    assert.strictEqual(r.effective.Constitution, 0, "a Scale insert cannot fill a Fang slot");
  });

  await test("Dino/AE3: per-type capacity bounds placements (one Scale slot -> one insert)", async () => {
    const oneSlot = {
      targets: ["Constitution", "Strength"], mlCap: 34, dodgeCap: null,
      worn: [slot("Boots", [dinoHost("B", "Boots", ["Scale"])])], // one Scale slot
      dinoInserts: [
        dinoIns("Scale", "Constitution", "Enhancement", 14),
        dinoIns("Scale", "Strength", "Enhancement", 14),
      ],
    };
    const r = await S.solveLexicographic(oneSlot, highs);
    assert.strictEqual(r.effective.Constitution, 14, "priority-1 insert placed");
    assert.strictEqual(r.effective.Strength, 0, "only one Scale slot -> second insert cannot fit");

    const twoSlots = {
      targets: ["Constitution", "Strength"], mlCap: 34, dodgeCap: null,
      worn: [
        slot("Boots", [dinoHost("B", "Boots", ["Scale"])]),
        slot("Belt", [dinoHost("W", "Belt", ["Scale"])]),
      ],
      dinoInserts: [
        dinoIns("Scale", "Constitution", "Enhancement", 14),
        dinoIns("Scale", "Strength", "Enhancement", 14),
      ],
    };
    const r2 = await S.solveLexicographic(twoSlots, highs);
    assert.strictEqual(r2.effective.Strength, 14, "two Scale slots (Boots+Belt) -> both inserts fit");
  });

  await test("Dino/AE4: insert obeys bonus-type stacking with worn", async () => {
    const sameType = {
      targets: ["Constitution"], mlCap: 34, dodgeCap: null,
      worn: [slot("Boots", [dinoHost("B", "Boots", ["Scale"], [["Constitution", "Enhancement", 10]])])],
      dinoInserts: [dinoIns("Scale", "Constitution", "Enhancement", 14)],
    };
    const s = await S.solveLexicographic(sameType, highs);
    assert.strictEqual(s.effective.Constitution, 14, "same type -> max(worn 10, dino 14), not 24");

    const diffType = {
      targets: ["Constitution"], mlCap: 34, dodgeCap: null,
      worn: [slot("Boots", [dinoHost("B", "Boots", ["Scale"], [["Constitution", "Enhancement", 10]])])],
      dinoInserts: [dinoIns("Scale", "Constitution", "Insightful", 7)],
    };
    const d = await S.solveLexicographic(diffType, highs);
    assert.strictEqual(d.effective.Constitution, 17, "different types -> worn 10 + dino 7");
  });

  await test("Dino/KTD4: a multi-affix insert applies ALL affixes from one placement", async () => {
    const m = {
      targets: ["Sneak Attacks", "Sneak Attack Damage"], mlCap: 34, dodgeCap: null,
      worn: [slot("Boots", [dinoHost("B", "Boots", ["Fang"])])], // one Fang slot
      dinoInserts: [dinoMulti("Fang", [
        ["Sneak Attacks", "Enhancement", 11],
        ["Sneak Attack Damage", "Enhancement", 17],
      ])],
    };
    const r = await S.solveLexicographic(m, highs);
    assert.strictEqual(r.effective["Sneak Attacks"], 11, "first affix applied");
    assert.strictEqual(r.effective["Sneak Attack Damage"], 17, "second affix applied from the SAME placement");
  });

  await test("Dino/KTD4: a multi-affix insert is all-or-nothing (never half-placed)", async () => {
    // Only the FIRST affix is a target; the unit must still bring both or neither.
    // With a single Fang slot and a rival single-affix insert that scores the
    // same on the priority target, the multi-affix unit is not preferred, but if
    // placed it brings both — verify it never contributes only one affix.
    const m = {
      targets: ["Sneak Attacks"], mlCap: 34, dodgeCap: null,
      worn: [slot("Boots", [dinoHost("B", "Boots", ["Fang"])])],
      dinoInserts: [dinoMulti("Fang", [
        ["Sneak Attacks", "Enhancement", 11],
        ["Sneak Attack Damage", "Enhancement", 17],
      ])],
    };
    const r = await S.solveLexicographic(m, highs);
    const placed = r.dinoPlaced.find((d) => d.affixes.some((a) => a.stat === "Sneak Attacks"));
    assert.ok(placed, "the multi-affix unit is placed for the target");
    assert.strictEqual(placed.affixes.length, 2, "and it carries BOTH affixes (all-or-nothing)");
  });

  await test("Dino/KTD1: a Weapon-typed insert cannot fill an Accessory slot", async () => {
    const q = {
      targets: ["Constitution"], mlCap: 34, dodgeCap: null,
      worn: [slot("Boots", [dinoHost("B", "Boots", ["Scale||Accessory"])])],
      dinoInserts: [dinoIns("Scale", "Constitution", "Enhancement", 14, "Weapon")],
    };
    const r = await S.solveLexicographic(q, highs);
    assert.strictEqual(r.effective.Constitution, 0, "Scale(Weapon) insert cannot fill a Scale(Accessory) slot");
  });

  await test("Dino/KTD1: a Weapon-typed insert fills a matching Weapon slot", async () => {
    const q = {
      targets: ["Constitution"], mlCap: 34, dodgeCap: null,
      worn: [slot("Main Hand", [dinoHost("W", "Main Hand", ["Scale||Weapon"])])],
      dinoInserts: [dinoIns("Scale", "Constitution", "Enhancement", 14, "Weapon")],
    };
    const r = await S.solveLexicographic(q, highs);
    assert.strictEqual(r.effective.Constitution, 14, "Scale(Weapon) insert fills a Scale(Weapon) slot");
  });

  // ---- U81 Nearly Complete (parametric choice-slot) ----
  // a worn item carrying a Nearly-Complete slot of a category at a tier
  function ncHost(id, slotName, category, tier, affixes) {
    const v = item(id, slotName, affixes || []);
    v.nearly_complete = category;
    v.nc_tier = tier || "legendary";
    return v;
  }
  function ncOpt(category, stat, bonus_type, value, tier) {
    return { category, stat, bonus_type, value, tier: tier || "legendary", unit: "flat" };
  }
  const ABIL_POOL = [
    ncOpt("Ability Score", "Constitution", "Enhancement", 15),
    ncOpt("Ability Score", "Strength", "Enhancement", 15),
  ];

  await test("NC/AE1: solver crafts the option that best advances the ranked targets", async () => {
    const conFirst = {
      targets: ["Constitution", "Strength"], mlCap: 34, dodgeCap: null,
      worn: [slot("Boots", [ncHost("B", "Boots", "Ability Score", "legendary")])],
      nearlyComplete: ABIL_POOL,
    };
    const a = await S.solveLexicographic(conFirst, highs);
    assert.strictEqual(a.effective.Constitution, 15, "crafts +15 Con for a Con-first ranking");
    assert.ok(a.ncPlaced.some((n) => n.stat === "Constitution"), "reported as crafted");

    const strFirst = { ...conFirst, targets: ["Strength", "Constitution"] };
    const b = await S.solveLexicographic(strFirst, highs);
    assert.strictEqual(b.effective.Strength, 15, "swapping priority crafts +15 Str instead");
  });

  await test("NC/AE2: at most one option per slot (single irreversible choice)", async () => {
    const oneSlot = {
      targets: ["Constitution", "Strength"], mlCap: 34, dodgeCap: null,
      worn: [slot("Boots", [ncHost("B", "Boots", "Ability Score", "legendary")])],
      nearlyComplete: ABIL_POOL,
    };
    const r = await S.solveLexicographic(oneSlot, highs);
    assert.strictEqual(r.effective.Constitution, 15, "priority-1 crafted");
    assert.strictEqual(r.effective.Strength, 0, "one slot -> only one option, not both");
    assert.strictEqual(r.ncPlaced.length, 1, "exactly one craft placed");
  });

  await test("NC/AE3: crafted option obeys bonus-type stacking with worn", async () => {
    const sameType = {
      targets: ["Constitution"], mlCap: 34, dodgeCap: null,
      worn: [slot("Boots", [ncHost("B", "Boots", "Ability Score", "legendary", [["Constitution", "Enhancement", 10]])])],
      nearlyComplete: [ncOpt("Ability Score", "Constitution", "Enhancement", 15)],
    };
    assert.strictEqual((await S.solveLexicographic(sameType, highs)).effective.Constitution, 15,
      "same type -> max(worn 10, nc 15), not 25");

    const diffType = {
      targets: ["Constitution"], mlCap: 34, dodgeCap: null,
      worn: [slot("Boots", [ncHost("B", "Boots", "Insightful Ability Score", "legendary", [["Constitution", "Enhancement", 10]])])],
      nearlyComplete: [ncOpt("Insightful Ability Score", "Constitution", "Insight", 7)],
    };
    assert.strictEqual((await S.solveLexicographic(diffType, highs)).effective.Constitution, 17,
      "different types -> worn Enhancement 10 + nc Insight 7");
  });

  await test("NC/host-gating: an unequipped NC host cannot craft (n <= x_item)", async () => {
    // Two candidates for one Ring slot: the NC host is intrinsically weaker; a
    // rival with a strictly better target stat is equipped instead, so the host's
    // craft must NOT apply. This is the constraint that dominates() must also not prune.
    const m = {
      targets: ["Constitution"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [
        ncHost("H", "Ring", "Ability Score", "legendary"),          // craftable +15 Con, no base
        item("R", "Ring", [["Constitution", "Enhancement", 30]]),   // strictly better intrinsically
      ])],
      nearlyComplete: ABIL_POOL,
    };
    const r = await S.solveLexicographic(m, highs);
    assert.strictEqual(r.effective.Constitution, 30, "the better rival is equipped");
    assert.strictEqual(r.ncPlaced.length, 0, "the unequipped host cannot craft");
  });

  await test("NC/cross-item: Σn<=1 is per host item, not global", async () => {
    const m = {
      targets: ["Constitution", "Strength"], mlCap: 34, dodgeCap: null,
      worn: [
        slot("Boots", [ncHost("B", "Boots", "Ability Score", "legendary")]),
        slot("Gloves", [ncHost("G", "Gloves", "Ability Score", "legendary")]),
      ],
      nearlyComplete: ABIL_POOL,
    };
    const r = await S.solveLexicographic(m, highs);
    assert.strictEqual(r.effective.Constitution, 15, "host 1 crafts Con");
    assert.strictEqual(r.effective.Strength, 15, "host 2 crafts Str (separate slot)");
    assert.strictEqual(r.ncPlaced.length, 2, "two hosts -> two crafts");
  });

  await test("NC/tier: a heroic host pulls the heroic magnitude, not legendary", async () => {
    const pool = [
      ncOpt("Ability Score", "Constitution", "Enhancement", 6, "heroic"),
      ncOpt("Ability Score", "Constitution", "Enhancement", 15, "legendary"),
    ];
    const m = {
      targets: ["Constitution"], mlCap: 34, dodgeCap: null,
      worn: [slot("Boots", [ncHost("B", "Boots", "Ability Score", "heroic")])],
      nearlyComplete: pool,
    };
    assert.strictEqual((await S.solveLexicographic(m, highs)).effective.Constitution, 6,
      "heroic host -> +6, not the legendary +15");
  });

  await test("NC: tier + ML36 — a legendary slot applies at mlCap 36", async () => {
    const m36 = {
      targets: ["Constitution"], mlCap: 36, dodgeCap: null,
      worn: [slot("Boots", [ncHost("B", "Boots", "Ability Score", "legendary")])],
      nearlyComplete: ABIL_POOL,
    };
    assert.strictEqual((await S.solveLexicographic(m36, highs)).effective.Constitution, 15);

    // an item with no nearly_complete field contributes nothing new
    const none = {
      targets: ["Constitution"], mlCap: 36, dodgeCap: null,
      worn: [slot("Boots", [item("B", "Boots", [])])],
      nearlyComplete: ABIL_POOL,
    };
    assert.strictEqual((await S.solveLexicographic(none, highs)).effective.Constitution, 0,
      "no NC slot on the item -> pool unused");
  });

  await test("enriched compendium item is solver-selectable end-to-end (real dataset)", async () => {
    const fs = require("fs");
    const { buildModel } = require("../web/model.js");
    const data = normalizeDataset(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8")));
    // "Diversion" is carried ONLY by enriched compendium items, so a positive
    // achieved value proves an enriched item entered the solver pool, survived the
    // dominance filter, and was selected — not just that it "verified".
    const query = { mlCap: 34, targets: ["Diversion"], armorType: null, weaponSetup: null, classRace: null };
    const model = buildModel(data.items, query, data.dino_inserts, data.nearly_complete);
    const res = await S.solveLexicographic(model, highs);
    assert.strictEqual(res.status, "optimal");
    assert.ok(res.effective["Diversion"] > 0, "an enriched item supplying Diversion was selected");
    const pick = res.chosen.find((c) => (c.variant.affixes || []).some((a) => (a.name != null ? a.name : a.stat) === "Diversion"));
    assert.ok(pick, "the selected loadout includes the Diversion-carrying enriched item");
  });

  await test("U81 Nearly-Complete crafts onto a real enriched host (real dataset)", async () => {
    const fs = require("fs");
    const { buildModel } = require("../web/model.js");
    const data = normalizeDataset(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8")));
    // Real ML35 items carry `nearly_complete` category slots. Solve over ONLY the
    // real NC hosts so the host's crafted option is the source of the target — the
    // precedence-flip plan (U4) made this pool-scoped: over the FULL dataset the
    // richer gear-planner bodies can supply Constitution without the craft, so
    // asserting placement in the whole-dataset optimum is no longer meaningful.
    // This still exercises the real hosts + real pool end-to-end.
    const ncHosts = data.items.filter((v) => v.nearly_complete);
    assert.ok(ncHosts.length > 0, "the real dataset carries Nearly-Complete hosts");
    const query = { mlCap: 36, targets: ["Constitution"], armorType: null, weaponSetup: null, classRace: null };
    const model = buildModel(ncHosts, query, data.dino_inserts, data.nearly_complete);
    const res = await S.solveLexicographic(model, highs);
    assert.strictEqual(res.status, "optimal");
    assert.ok((res.ncPlaced || []).length > 0, "at least one NC craft was placed onto a real host");
    const craft = res.ncPlaced.find((n) => n.stat === "Constitution");
    assert.ok(craft && craft.value > 0, "an NC host crafted a Constitution option from its category pool");
  });

  await test("roll-group choice-slot: solver picks the best option, exactly one", async () => {
    const rg = item("RG", "Ring", []);
    rg.roll_groups = [{ options: [
      { stat: "Constitution", bonus_type: "Enhancement", value: 13, unit: "flat" },
      { stat: "Strength", bonus_type: "Enhancement", value: 13, unit: "flat" },
    ] }];
    const con = { targets: ["Constitution"], mlCap: 34, dodgeCap: null, worn: [slot("Ring", [rg])] };
    const r = await S.solveLexicographic(con, highs);
    assert.strictEqual(r.effective.Constitution, 13, "crafts the Con option for a Con target");
    assert.strictEqual((r.rollPlaced || []).length, 1, "exactly one option placed (Sum<=1 per group)");
    assert.strictEqual(r.rollPlaced[0].stat, "Constitution");
    // the same item pivots to Strength when that is the target
    const str = { targets: ["Strength"], mlCap: 34, dodgeCap: null, worn: [slot("Ring", [rg])] };
    assert.strictEqual((await S.solveLexicographic(str, highs)).effective.Strength, 13);
  });

  // ---- U81 Viktranium ("Lamordia") typed choice-slot ----
  // a worn host carrying typed Lamordia slots; tier derives from ML (>=35 legendary),
  // matching the solver's derivation — no explicit tier field on the host.
  function vikHost(id, slotName, slots, ml, affixes) {
    const v = item(id, slotName, affixes || []);
    v.lamordia_slots = slots;        // [{type, category}]
    v.minimum_level = v.ml = ml == null ? 35 : ml;
    return v;
  }
  // FLAT legacy option (one record per affix) — the pre-atomicity shape a stale
  // cached dataset can still deliver. The whole VIK_POOL block below is the
  // back-compat regression guard: these must keep solving unchanged.
  function vikOpt(slot_type, category, stat, bonus_type, value, tier) {
    return { slot_type, category, stat, bonus_type, value, tier: tier || "legendary", unit: "flat" };
  }
  // NATIVE atomic option (one record per craftable option, carrying its affix
  // list) — mirrors the Dino insert UNIT. Several affixes ride ONE placement.
  function vikMulti(slot_type, category, affixes, tier, name) {
    return {
      slot_type, category, tier: tier || "legendary", name: name || `${slot_type} option`,
      affixes: affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, value, unit: "flat" })),
    };
  }
  const SCHOOLS = ["Abjuration Focus", "Conjuration Focus", "Enchantment Focus", "Evocation Focus",
    "Illusion Focus", "Necromancy Focus", "Transmutation Focus"];
  // The real "universal spell DC" option: seven school affixes, one bonus type,
  // one craft. Was seven competing records before atomicity.
  const VIK_UNIVERSAL = vikMulti("Dolorous", "Armor",
    SCHOOLS.map((s) => [s, "Profane", 1]), "legendary", "Dolorous Invigorator (legendary)");
  const VIK_POOL = [
    vikOpt("Melancholic", "Accessory", "Constitution", "Enhancement", 15, "legendary"),
    vikOpt("Melancholic", "Accessory", "Strength", "Enhancement", 15, "legendary"),
    vikOpt("Melancholic", "Accessory", "Constitution", "Enhancement", 5, "heroic"),
    vikOpt("Melancholic", "Accessory", "Strength", "Enhancement", 5, "heroic"),
  ];

  await test("VIK/AE1: crafts the option that best advances the ranked targets", async () => {
    const conFirst = {
      targets: ["Constitution", "Strength"], mlCap: 36, dodgeCap: null,
      worn: [slot("Neck", [vikHost("H", "Neck", [{ type: "Melancholic", category: "Accessory" }])])],
      viktranium: VIK_POOL,
    };
    const a = await S.solveLexicographic(conFirst, highs);
    assert.strictEqual(a.effective.Constitution, 15, "crafts +15 Con for a Con-first ranking");
    assert.ok((a.vikPlaced || []).some((n) => n.stat === "Constitution"), "reported as crafted");
    const b = await S.solveLexicographic({ ...conFirst, targets: ["Strength", "Constitution"] }, highs);
    assert.strictEqual(b.effective.Strength, 15, "swapping priority crafts +15 Str instead");
  });

  await test("VIK/AE2: at most one option per slot (single irreversible choice)", async () => {
    const m = {
      targets: ["Constitution", "Strength"], mlCap: 36, dodgeCap: null,
      worn: [slot("Neck", [vikHost("H", "Neck", [{ type: "Melancholic", category: "Accessory" }])])],
      viktranium: VIK_POOL,
    };
    const r = await S.solveLexicographic(m, highs);
    assert.strictEqual(r.effective.Constitution, 15, "priority-1 crafted");
    assert.strictEqual(r.effective.Strength, 0, "one slot -> only one option, not both");
    assert.strictEqual(r.vikPlaced.length, 1, "exactly one craft placed");
  });

  await test("VIK/two-slots: two Lamordia slots on one item craft independently", async () => {
    // Σn<=1 is PER SLOT, so an item with two slots gets two independent choices.
    const m = {
      targets: ["Constitution", "Strength"], mlCap: 36, dodgeCap: null,
      worn: [slot("Neck", [vikHost("H", "Neck", [
        { type: "Melancholic", category: "Accessory" },
        { type: "Melancholic", category: "Accessory" },
      ])])],
      viktranium: VIK_POOL,
    };
    const r = await S.solveLexicographic(m, highs);
    assert.strictEqual(r.effective.Constitution, 15, "slot 1 crafts Con");
    assert.strictEqual(r.effective.Strength, 15, "slot 2 crafts Str");
    assert.strictEqual(r.vikPlaced.length, 2, "two slots -> two crafts");
  });

  await test("VIK/quarterstaff (#282): a variant-marked option reaches only its matching host", async () => {
    // The Weapon pools ship a `(quarterstaff)` sibling whose differing entries the
    // pipeline emits variant-marked: `quarterstaff: true` (quarterstaff hosts only),
    // `false` (everything else), unmarked (identical in both pools — any host).
    const qsPool = [
      // Base "Dolorous Focus": no implement bonuses; never offered to a quarterstaff.
      { ...vikMulti("Dolorous", "Weapon", [["Spell Focus Mastery", "Equipment", 8]],
        "legendary", "Dolorous Focus (legendary)"), quarterstaff: false },
      // Quarterstaff "Dolorous Focus": adds the implement bonus; quarterstaffs only.
      { ...vikMulti("Dolorous", "Weapon",
        [["Universal Spell Power", "Implement", 15], ["Spell Focus Mastery", "Equipment", 8]],
        "legendary", "Dolorous Focus (legendary)"), quarterstaff: true },
      // Unmarked: identical in both pools, serves any Weapon host.
      vikOpt("Dolorous", "Weapon", "Constitution", "Enhancement", 10, "legendary"),
    ];
    const host = (weaponType) => {
      const v = vikHost("H", "Main Hand", [{ type: "Dolorous", category: "Weapon" }], 34);
      v.type = weaponType;
      return v;
    };
    const solveFor = async (weaponType, targets) => S.solveLexicographic({
      targets, mlCap: 34, dodgeCap: null,
      worn: [slot("Main Hand", [host(weaponType)])], viktranium: qsPool,
    }, highs);

    const qs = await solveFor("Quarterstaffs", ["Universal Spell Power"]);
    assert.strictEqual(qs.effective["Universal Spell Power"], 15,
      "a quarterstaff host crafts the quarterstaff variant's implement bonus");
    const sword = await solveFor("Bastard Swords", ["Universal Spell Power"]);
    assert.strictEqual(sword.effective["Universal Spell Power"], 0,
      "a non-quarterstaff host must never receive the quarterstaff-only bonus");
    // The base variant still serves the non-quarterstaff host under the same name.
    const swordSFM = await solveFor("Bastard Swords", ["Spell Focus Mastery"]);
    assert.strictEqual(swordSFM.effective["Spell Focus Mastery"], 8,
      "the base variant reaches the non-quarterstaff host");
    // An unmarked option (identical in both pools) reaches both hosts.
    for (const t of ["Quarterstaffs", "Bastard Swords"]) {
      assert.strictEqual((await solveFor(t, ["Constitution"])).effective.Constitution, 10,
        `an unmarked option serves a ${t} host`);
    }
  });

  await test("VIK/AE3: crafted option obeys bonus-type stacking with worn", async () => {
    const sameType = {
      targets: ["Constitution"], mlCap: 36, dodgeCap: null,
      worn: [slot("Neck", [vikHost("H", "Neck", [{ type: "Melancholic", category: "Accessory" }], 35,
        [["Constitution", "Enhancement", 10]])])],
      viktranium: [vikOpt("Melancholic", "Accessory", "Constitution", "Enhancement", 15, "legendary")],
    };
    assert.strictEqual((await S.solveLexicographic(sameType, highs)).effective.Constitution, 15,
      "same type -> max(worn 10, craft 15), not 25");
    const diffType = {
      targets: ["Constitution"], mlCap: 36, dodgeCap: null,
      worn: [slot("Neck", [vikHost("H", "Neck", [{ type: "Melancholic", category: "Accessory" }], 35,
        [["Constitution", "Enhancement", 10]])])],
      viktranium: [vikOpt("Melancholic", "Accessory", "Constitution", "Quality", 7, "legendary")],
    };
    assert.strictEqual((await S.solveLexicographic(diffType, highs)).effective.Constitution, 17,
      "different types -> worn Enhancement 10 + craft Quality 7");
  });

  await test("VIK/tier: tier follows host ML — ML34 is legendary, a low-ML host is heroic", async () => {
    // Regression guard for the tier-boundary bug: EVERY real Lamordia host is
    // ML34 (a Legendary item), so an ML34 host must pull the LEGENDARY magnitude.
    const legendary = {
      targets: ["Constitution"], mlCap: 34, dodgeCap: null,
      worn: [slot("Neck", [vikHost("H", "Neck", [{ type: "Melancholic", category: "Accessory" }], 34)])],
      viktranium: VIK_POOL,
    };
    assert.strictEqual((await S.solveLexicographic(legendary, highs)).effective.Constitution, 15,
      "ML34 legendary host -> +15 (legendary), not the heroic +5");
    // A genuinely heroic host (Viktranium heroic recipes are ML8/11) pulls +5.
    const heroic = {
      targets: ["Constitution"], mlCap: 34, dodgeCap: null,
      worn: [slot("Neck", [vikHost("H", "Neck", [{ type: "Melancholic", category: "Accessory" }], 11)])],
      viktranium: VIK_POOL,
    };
    assert.strictEqual((await S.solveLexicographic(heroic, highs)).effective.Constitution, 5,
      "ML11 heroic host -> +5 (heroic), not the legendary +15");
  });

  await test("VIK/host-gating: an unequipped host cannot craft (n <= x_item)", async () => {
    // The intrinsically weaker Lamordia host loses its slot to a stronger rival, so
    // its craft must NOT apply — the constraint dominates() must also not prune.
    const m = {
      targets: ["Constitution"], mlCap: 36, dodgeCap: null,
      worn: [slot("Ring", [
        vikHost("H", "Ring", [{ type: "Melancholic", category: "Accessory" }]),   // craftable +15, no base
        item("R", "Ring", [["Constitution", "Enhancement", 30]]),                  // strictly better intrinsically
      ])],
      viktranium: VIK_POOL,
    };
    const r = await S.solveLexicographic(m, highs);
    assert.strictEqual(r.effective.Constitution, 30, "the better rival is equipped");
    assert.strictEqual(r.vikPlaced.length, 0, "the unequipped host cannot craft");
  });

  await test("VIK/pool-key: an option is placed only into a slot of its (type, category)", async () => {
    // The host's slot is Dolorous/Weapon; a Melancholic/Accessory option must not fit.
    const m = {
      targets: ["Constitution"], mlCap: 36, dodgeCap: null,
      worn: [slot("Main Hand", [vikHost("W", "Main Hand", [{ type: "Dolorous", category: "Weapon" }])])],
      viktranium: [vikOpt("Melancholic", "Accessory", "Constitution", "Enhancement", 15, "legendary")],
    };
    const r = await S.solveLexicographic(m, highs);
    assert.strictEqual(r.effective.Constitution, 0, "wrong (type, category) pool -> no craft");
    assert.strictEqual((r.vikPlaced || []).length, 0);
  });

  // ---- Viktranium options are ATOMIC (R1/R2) -------------------------------
  // A Viktranium option is one craftable native option carrying an affix list,
  // not one record per affix. Crafting the universal spell-DC option grants its
  // bonus type and value to all seven schools AT ONCE (R1), so a caster ranking
  // two schools need not spend two Viktranium slots (R2).

  await test("VIK/atomic R1: one craft of a universal option grants ALL seven schools", async () => {
    const m = {
      targets: ["Necromancy Focus", "Evocation Focus"], mlCap: 36, dodgeCap: null,
      worn: [slot("Armor", [vikHost("H", "Armor", [{ type: "Dolorous", category: "Armor" }])])],
      viktranium: [VIK_UNIVERSAL],
    };
    const r = await S.solveLexicographic(m, highs);
    assert.strictEqual(r.effective["Necromancy Focus"], 1, "priority-1 school crafted");
    assert.strictEqual(r.effective["Evocation Focus"], 1,
      "priority-2 school comes from the SAME craft — one option, all seven schools");
    assert.strictEqual(r.vikPlaced.length, 1, "exactly ONE craft, not one per school");
    assert.strictEqual((r.vikPlaced[0].affixes || []).length, 7,
      "the placement record carries the option's whole affix list");
  });

  await test("VIK/atomic R2: two schools do not cost two Viktranium slots", async () => {
    // Two hosts, one Dolorous/Armor slot each. Each host's craft grants BOTH
    // ranked schools, so the second slot is free for something else — the
    // reported bug (AE1) was a caster forced to burn a slot per school.
    const m = {
      targets: ["Necromancy Focus", "Evocation Focus", "Constitution"], mlCap: 36, dodgeCap: null,
      worn: [
        slot("Armor", [vikHost("A", "Armor", [{ type: "Dolorous", category: "Armor" }])]),
        slot("Neck", [vikHost("B", "Neck", [{ type: "Dolorous", category: "Armor" }])]),
      ],
      viktranium: [
        VIK_UNIVERSAL,
        vikMulti("Dolorous", "Armor", [["Constitution", "Enhancement", 15]], "legendary", "Dolorous Con"),
      ],
    };
    const r = await S.solveLexicographic(m, highs);
    assert.strictEqual(r.effective["Necromancy Focus"], 1, "school 1 from the universal craft");
    assert.strictEqual(r.effective["Evocation Focus"], 1, "school 2 from the SAME universal craft");
    assert.strictEqual(r.effective.Constitution, 15,
      "the second slot was free for Constitution — two schools cost ONE slot");
  });

  await test("VIK/atomic: ONE binary gates every on-target affix of an option", async () => {
    const model = {
      targets: ["Necromancy Focus", "Evocation Focus"], mlCap: 36, dodgeCap: null,
      worn: [slot("Armor", [vikHost("H", "Armor", [{ type: "Dolorous", category: "Armor" }])])],
      viktranium: [VIK_UNIVERSAL],
    };
    const program = S.buildProgram(model);
    const vks = [...program.vikMeta.keys()];
    assert.strictEqual(vks.length, 1, "one option -> exactly one placement binary (not one per affix)");
    for (const stat of ["Necromancy Focus", "Evocation Focus"]) {
      const terms = [].concat(...[...program.zByBucket]
        .filter(([k]) => k.split("||")[0] === stat).map(([, zs]) => zs));
      assert.ok(terms.length >= 1, `${stat} has a bucket term`);
      assert.ok(terms.every((z) => (z.gates || []).includes(vks[0])),
        `every ${stat} contribution is gated on the single option binary ${vks[0]}`);
    }
  });

  await test("VIK/atomic: an OFF-target affix of a selected option adds no objective term", async () => {
    const model = {
      targets: ["Necromancy Focus"], mlCap: 36, dodgeCap: null,
      worn: [slot("Armor", [vikHost("H", "Armor", [{ type: "Dolorous", category: "Armor" }])])],
      viktranium: [vikMulti("Dolorous", "Armor", [
        ["Necromancy Focus", "Profane", 1],
        ["Assassinate", "Profane", 1],   // off-target: rides along, scores nothing
      ])],
    };
    const program = S.buildProgram(model);
    assert.ok([...program.zByBucket.keys()].some((k) => k.split("||")[0] === "Necromancy Focus"),
      "the on-target affix is bucketed");
    assert.ok(![...program.zByBucket.keys()].some((k) => k.split("||")[0] === "Assassinate"),
      "the off-target affix contributes no bucket term");
    assert.strictEqual([...program.vikMeta.keys()].length, 1, "still one binary for the option");
  });

  await test("VIK/atomic: Σn<=1 per slot still holds, and two slots still craft independently", async () => {
    const pool = [
      vikMulti("Melancholic", "Accessory", [["Constitution", "Enhancement", 15]]),
      vikMulti("Melancholic", "Accessory", [["Strength", "Enhancement", 15]]),
    ];
    const one = {
      targets: ["Constitution", "Strength"], mlCap: 36, dodgeCap: null,
      worn: [slot("Neck", [vikHost("H", "Neck", [{ type: "Melancholic", category: "Accessory" }])])],
      viktranium: pool,
    };
    const a = await S.solveLexicographic(one, highs);
    assert.strictEqual(a.effective.Constitution, 15, "priority-1 crafted");
    assert.strictEqual(a.effective.Strength, 0, "one slot -> at most one option");
    assert.strictEqual(a.vikPlaced.length, 1, "exactly one craft placed");

    const two = {
      ...one,
      worn: [slot("Neck", [vikHost("H", "Neck", [
        { type: "Melancholic", category: "Accessory" },
        { type: "Melancholic", category: "Accessory" },
      ])])],
    };
    const b = await S.solveLexicographic(two, highs);
    assert.strictEqual(b.effective.Constitution, 15, "slot 1 crafts Con");
    assert.strictEqual(b.effective.Strength, 15, "slot 2 crafts Str");
    assert.strictEqual(b.vikPlaced.length, 2, "two slots -> two independent crafts");
  });

  await test("U81 Viktranium crafts onto a real host end-to-end (real dataset)", async () => {
    const fs = require("fs");
    const { buildModel } = require("../web/model.js");
    const data = normalizeDataset(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8")));
    // The seal/dino/viktranium pools now live in the native gear-planner catalog, so
    // this test DERIVES its target from the loaded pool instead of hard-targeting a
    // legacy affix name (which would re-break on every catalog refresh). Intent is
    // unchanged: a real Lamordia host crafts a LEGENDARY option at the legendary
    // magnitude — the regression guard for the ML>=35 mis-tier bug.
    //
    // #260 — the guard solves at cap 35, not 36. The ML36 augment tier's Ruby
    // spell powers (Equipment 166) out-value every hostable legendary option
    // (159), so at cap 36 no craft can be the best source of anything and the
    // candidate search would come up dry. Cap 35 is the mis-tier bug's own band
    // (an ML>=35 host), the ML36 stones are ineligible there, and the search
    // below mirrors the same eligibility so a candidate it picks is one the
    // solve can genuinely reach.
    const GUARD_CAP = 35;
    const itemMax = (stat) => {
      let m = 0;
      for (const it of data.items) {
        if ((it.ml || 0) > GUARD_CAP) continue;
        for (const a of (it.affixes || []))
          if ((a.name != null ? a.name : a.stat) === stat && typeof a.value === "number" && a.value > m) m = a.value;
      }
      return m;
    };
    // (slot_type, category) pairs that a real item actually offers as a Lamordia slot.
    const hostKeys = new Set();
    for (const it of data.items) for (const ls of (it.lamordia_slots || [])) hostKeys.add(ls.type + "|" + ls.category);
    // An option is ATOMIC: one record per craftable option carrying an `affixes`
    // list (flat single-affix records still read, for back-compat).
    const affixesOf = (o) => (o.affixes && o.affixes.length) ? o.affixes : (o.stat ? [o] : []);
    // Pick a legendary option affix that (a) has a real host for its (slot_type,
    // category), (b) out-values every worn item for its stat (so the craft is
    // genuinely reached, not made redundant by an item), and (c) has a strictly
    // weaker heroic counterpart (so "legendary magnitude > heroic" is a real
    // assertion). Deterministic: strongest first, stat name as the tie-break.
    const cands = [];
    for (const o of data.viktranium) {
      if (o.tier !== "legendary" || !hostKeys.has(o.slot_type + "|" + o.category)) continue;
      for (const a of affixesOf(o)) {
        if (!(a.value > 35) || !(a.value > itemMax(a.stat))) continue;
        const heroic = data.viktranium.find((h) => h.tier === "heroic" && h.slot_type === o.slot_type
          && h.category === o.category && affixesOf(h).some((b) => b.stat === a.stat && b.value < a.value));
        if (heroic) cands.push({ stat: a.stat, value: a.value, heroic });
      }
    }
    const pick = cands.sort((a, b) => b.value - a.value || (a.stat < b.stat ? -1 : 1))[0];
    assert.ok(pick, "the native pool offers a hostable legendary option for the regression guard");
    const query = { mlCap: GUARD_CAP, targets: [pick.stat], armorType: null, weaponSetup: null, classRace: null };
    const model = buildModel(data.items, query, data.dino_inserts, data.nearly_complete, data.viktranium);
    const res = await S.solveLexicographic(model, highs);
    assert.strictEqual(res.status, "optimal");
    assert.ok((res.vikPlaced || []).length > 0, "at least one Viktranium craft was placed onto a host");
    // The placement record is self-describing: it carries the option's whole
    // affix list, so a multi-affix craft is findable by any affix it grants.
    // Several typed slots can each craft the stat under DIFFERENT bonus types
    // (they stack), so take the strongest — that is the one the tier guard is about.
    const valOf = (c) => c.affixes.find((a) => a.stat === pick.stat).value;
    const crafts = res.vikPlaced.filter((n) => (n.affixes || []).some((a) => a.stat === pick.stat));
    assert.ok(crafts.length, `a Lamordia host crafted a ${pick.stat} option from its pool`);
    const craft = crafts.reduce((best, c) => (valOf(c) > valOf(best) ? c : best));
    assert.ok(craft.item, "the craft names its host item");
    // Every real host is a Legendary item, so the craft MUST pull the legendary
    // magnitude (a heroic value here would mean the legendary pool went unreachable —
    // the ML>=35 mis-tier bug). Assert the exact legendary value for the chosen
    // (slot_type, category), and that it beats the heroic magnitude of the same option.
    assert.strictEqual(craft.tier, "legendary", "a legendary host crafts at the legendary tier");
    const got = craft.affixes.find((a) => a.stat === pick.stat);
    assert.strictEqual(got.value, pick.value,
      `craft value ${got.value} matches the legendary pool value ${pick.value}`);
    const heroicVal = affixesOf(pick.heroic).find((b) => b.stat === pick.stat).value;
    assert.ok(got.value > heroicVal,
      `legendary magnitude ${got.value} exceeds the heroic one ${heroicVal}`);
    assert.ok(got.value > 35, "legendary magnitude exceeds the heroic tier band");
    assert.ok(res.effective[pick.stat] >= pick.value, "the craft advances the ranked target");
  });

  await test("Dino crafts a multi-affix insert onto a real host end-to-end (real dataset)", async () => {
    const fs = require("fs");
    const { buildModel } = require("../web/model.js");
    const data = normalizeDataset(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8")));
    // DERIVED from the native pool (see the Viktranium test above for why): a non-Armor
    // multi-affix insert carrying an affix that exists on NO worn item and NO Viktranium
    // option — dino-unique, so the target can be reached ONLY by crafting that insert.
    // Intent unchanged: a multi-affix insert rides ONE placement onto a real blank host.
    const known = new Set();
    for (const it of data.items) for (const a of (it.affixes || [])) known.add(a.name != null ? a.name : a.stat);
    for (const o of data.viktranium) known.add(o.stat);
    let target = null;
    for (const ins of data.dino_inserts) {
      if (ins.category === "Armor" || (ins.affixes || []).length < 2) continue;
      const uniq = (ins.affixes || []).find((a) => !known.has(a.stat));
      if (uniq) { target = uniq.stat; break; }
    }
    assert.ok(target, "the native pool offers a dino-unique multi-affix non-Armor insert");
    const query = { mlCap: 34, targets: [target], armorType: null, weaponSetup: null, classRace: null };
    const model = buildModel(data.items, query, data.dino_inserts, data.nearly_complete, data.viktranium);
    const res = await S.solveLexicographic(model, highs);
    assert.strictEqual(res.status, "optimal");
    assert.ok(res.effective[target] > 0, "the crafted insert advances the target");
    const unit = (res.dinoPlaced || []).find((d) => (d.affixes || []).some((a) => a.stat === target));
    assert.ok(unit, `a Dino insert supplying ${target} was placed onto a real host`);
    assert.ok(unit.affixes.length >= 2, "the placed unit is the multi-affix insert (both affixes ride one placement)");
  });

  await test("Dino crafts an Armor-typed multi-affix insert onto the real armor blank end-to-end (real dataset)", async () => {
    const fs = require("fs");
    const { buildModel } = require("../web/model.js");
    const data = normalizeDataset(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8")));
    // DERIVED from the native pool: an Armor-category multi-affix insert whose magnitude
    // affix out-values every worn item AND every Viktranium option for that stat, so the
    // dino craft is the SOLE way to reach the target — forcing the real Dinosaur Bone
    // Armor blank to be equipped. Intent unchanged: two-key (category) routing AND
    // multi-affix placement end-to-end on the real data.
    const globalMax = (stat) => {
      let m = 0;
      for (const it of data.items) for (const a of (it.affixes || []))
        if ((a.name != null ? a.name : a.stat) === stat && typeof a.value === "number" && a.value > m) m = a.value;
      for (const o of data.viktranium)
        if (o.stat === stat && typeof o.value === "number" && o.value > m) m = o.value;
      return m;
    };
    let target = null;
    for (const ins of data.dino_inserts) {
      if (ins.category !== "Armor" || (ins.affixes || []).length < 2) continue;
      const win = (ins.affixes || []).find((a) => typeof a.value === "number" && a.value > 0 && a.value > globalMax(a.stat));
      if (win) { target = win.stat; break; }
    }
    assert.ok(target, "the native pool offers a dino-winning Armor multi-affix insert");
    const query = { mlCap: 34, targets: [target], armorType: null, weaponSetup: null, classRace: null };
    const model = buildModel(data.items, query, data.dino_inserts, data.nearly_complete, data.viktranium);
    const res = await S.solveLexicographic(model, highs);
    assert.strictEqual(res.status, "optimal");
    const unit = (res.dinoPlaced || []).find((d) => (d.affixes || []).some((a) => a.stat === target));
    assert.ok(unit, `an Armor-typed Dino insert supplying ${target} was placed`);
    assert.strictEqual(unit.category, "Armor", "the placed insert is Armor-category (two-key routing held)");
    assert.ok(unit.affixes.length >= 2, "the placed unit is a multi-affix Armor insert");
    assert.ok(res.effective[target] > 0, "the crafted armor insert advances the target");
    const armorBlank = res.chosen.find((c) => c.variant.source === "dino_crafting_blank" && c.slot === "Armor");
    assert.ok(armorBlank, "the real Dinosaur Bone Armor blank was equipped to host the insert");
  });

  // ---- Seal ("Sealed in X") single-pick choice-slot ----
  function sealHost(id, slotName, seals, affixes) {
    const v = item(id, slotName, affixes || []);
    v.seal_slots = seals;            // [{seal_type, category}]
    return v;
  }
  function sealOpt(seal_type, stat, bonus_type, value) {
    return { seal_type, stat, bonus_type, value, unit: "flat" };
  }
  const SEAL_POOL = [
    sealOpt("Undeath", "Constitution", "Enhancement", 15),
    sealOpt("Undeath", "Strength", "Enhancement", 15),
    sealOpt("Undeath", "Constitution", "Insightful", 7),
    sealOpt("Undeath", "Constitution", "Quality", 3),
  ];

  await test("SEAL/AE1: unseals the option that best advances the ranked targets", async () => {
    const conFirst = {
      targets: ["Constitution", "Strength"], mlCap: 34, dodgeCap: null,
      worn: [slot("Trinket", [sealHost("H", "Trinket", [{ seal_type: "Undeath", category: "Trinket" }])])],
      seal: SEAL_POOL,
    };
    const a = await S.solveLexicographic(conFirst, highs);
    assert.strictEqual(a.effective.Constitution, 15, "unseals +15 Con for a Con-first ranking");
    assert.ok((a.sealPlaced || []).some((n) => n.stat === "Constitution"), "reported as unsealed");
    const b = await S.solveLexicographic({ ...conFirst, targets: ["Strength", "Constitution"] }, highs);
    assert.strictEqual(b.effective.Strength, 15, "swapping priority unseals +15 Str instead");
  });

  await test("SEAL/single-pick: one option per seal slot, mutually exclusive", async () => {
    const m = {
      targets: ["Constitution", "Strength"], mlCap: 34, dodgeCap: null,
      worn: [slot("Trinket", [sealHost("H", "Trinket", [{ seal_type: "Undeath", category: "Trinket" }])])],
      seal: SEAL_POOL,
    };
    const r = await S.solveLexicographic(m, highs);
    assert.strictEqual(r.effective.Constitution, 15, "priority-1 unsealed");
    assert.strictEqual(r.effective.Strength, 0, "one seal slot -> only one option, not both");
    assert.strictEqual(r.sealPlaced.length, 1, "exactly one unseal placed");
  });

  await test("SEAL/AE3: single-pick respects bonus-type stacking (picks a different tier)", async () => {
    // Con Enhancement is already capped by a worn affix; the seal's best move for a
    // Con-first ranking is the Insightful tier (a different bonus type -> it stacks).
    const m = {
      targets: ["Constitution"], mlCap: 34, dodgeCap: null,
      worn: [slot("Trinket", [sealHost("H", "Trinket", [{ seal_type: "Undeath", category: "Trinket" }],
        [["Constitution", "Enhancement", 15]])])],
      seal: SEAL_POOL,
    };
    const r = await S.solveLexicographic(m, highs);
    // worn Enhancement 15 + seal Insightful 7 = 22 (different types stack); NOT 30
    // (two Enhancement values don't stack) and NOT just 15.
    assert.strictEqual(r.effective.Constitution, 22, "unseals the Insightful tier to stack past the capped Enhancement");
    assert.strictEqual(r.sealPlaced.length, 1, "still one unseal");
    assert.strictEqual(r.sealPlaced[0].bonus_type, "Insightful", "chose the stacking tier, not a redundant Enhancement");
  });

  await test("seal unseals onto a real Undeath host end-to-end (real dataset)", async () => {
    const fs = require("fs");
    const { buildModel } = require("../web/model.js");
    const data = normalizeDataset(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8")));
    assert.ok((data.seal || []).length > 0, "the built dataset exposes the seal pool");
    // Undeath hosts are clothing/jewelry; targeting abilities the Ritual Table pool
    // supplies must reach a real Undeath host and generate its unseal options in the
    // MILP (proves dataset -> variant -> host -> seal machinery, past dominance).
    const query = { mlCap: 34, targets: ["Wisdom", "Charisma", "Intelligence"], armorType: null, weaponSetup: null, classRace: null };
    const model = buildModel(data.items, query, data.dino_inserts, data.nearly_complete, data.viktranium, data.seal);
    const program = S.buildProgram(model);
    assert.ok(program.sealMeta.size > 0, "a real Undeath host generated seal unseal options in the program");
  });


  await test("#245: excludeCraftingSystems removes every crafted placement from a real solve", async () => {
    const fs = require("fs");
    const { buildModel } = require("../web/model.js");
    const data = normalizeDataset(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8")));
    // The #245 reproduction: ML9, Charisma then Constitution. With crafting on,
    // the wildcard families make Lamordia bases win slots on a +1 crafted margin.
    const q = { mlCap: 9, targets: ["Charisma", "Constitution"], armorType: null, weaponSetup: null, classRace: null };
    const build = (query) => buildModel(data.items, query,
      data.dino_inserts, data.nearly_complete, data.viktranium, data.seal,
      data.membership_set_defs, data.thunder_forged, data.green_steel);
    const off = await S.solveLexicographic(build(q), highs);
    assert.strictEqual(off.status, "optimal");
    const on = await S.solveLexicographic(build({ ...q, excludeCraftingSystems: true }), highs);
    assert.strictEqual(on.status, "optimal");
    const placements = (r) => [].concat(r.vikPlaced || [], r.sealPlaced || [], r.ncPlaced || [],
      r.dinoPlaced || [], r.tfPlaced || [], r.gsPlaced || [], r.membershipPlaced || []);
    assert.strictEqual(placements(on).length, 0, "flag on: no crafted placement of any family");
    // The flag can only remove crafted points, never add: the opt-out optimum is
    // bounded by the full one on the first priority.
    assert.ok((on.perTarget.Charisma || 0) <= (off.perTarget.Charisma || 0),
      "P1 without crafting cannot exceed P1 with it");
  });


  await test("U8/#110 R10-clause-2: blocking every Artifact under the opt-in cannot no-build", async () => {
    const fs = require("fs");
    const { buildModel } = require("../web/model.js");
    const data = normalizeDataset(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8")));
    const artifacts = data.items.filter((v) => v.artifact).map((v) => v.variant_id);
    assert.ok(artifacts.length > 0, "the roster carries Minor Artifacts");
    const q = { mlCap: 36, targets: ["Constitution"], includeArtifact: true,
      blocklist: artifacts, armorType: null, weaponSetup: null, classRace: null };
    const model = buildModel(data.items, q);
    const res = await S.solveLexicographic(model, highs);
    assert.strictEqual(res.status, "optimal",
      "the Artifact equality is not emitted when no Artifact pick survives — no infeasibility");
    assert.ok(!(res.chosen || []).some((c) => c.variant && c.variant.artifact),
      "and no artifact is worn, falling through to the best-non-Artifact disclosure");
  });

  await test("SEAL/mismatch: a pool option for a different seal_type is not applied", () => {
    // A Fire-sealed host with an Undeath-only pool unseals nothing — the solver's
    // opt.seal_type !== slot.seal_type filter excludes the mismatched pool.
    const program = S.buildProgram({
      targets: ["Constitution"], mlCap: 34, dodgeCap: null,
      worn: [slot("Trinket", [sealHost("H", "Trinket", [{ seal_type: "Fire", category: "Trinket" }])])],
      seal: SEAL_POOL, // Undeath options only
    });
    assert.strictEqual(program.sealMeta.size, 0, "no unseal option is generated for a seal_type absent from the pool");
  });

  await test("R4: a real enriched band item is selected by HiGHS over a weaker rival", async () => {
    // Pull an actual R4-enriched variant from the built dataset and prove it flows
    // through the real engine and wins on its own stat (past dominance) — the U5
    // end-to-end proof that the ML30-36 band is genuinely solver-active.
    const fs = require("fs");
    const data = normalizeDataset(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8")));
    const r4 = data.items.find(v => (v.source_item || v.variant_id) === "The Theurgy of Autumn");
    assert.ok(r4, "The Theurgy of Autumn is solver-active in the dataset");
    const corr = (r4.affixes || []).find(a => (a.name != null ? a.name : a.stat) === "Corrosion");
    assert.ok(corr && corr.value > 0, "it carries a parsed Corrosion spellpower affix");
    const corrType = corr.type != null ? corr.type : corr.bonus_type;
    const weak = item("WeakRing", r4.slot, [["Corrosion", corrType, Math.max(1, corr.value - 50)]]);
    const model = {
      targets: ["Corrosion"], mlCap: 34, dodgeCap: null,
      worn: [slot(r4.slot, [r4, weak])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.ok(r.chosen.some(c => c.variant && (c.variant.source_item || c.variant.variant_id) === "The Theurgy of Autumn"),
      "HiGHS equips the enriched R4 item, not the weaker rival");
    assert.ok(r.effective.Corrosion >= corr.value, "its Corrosion reaches the loadout total");
  });

  await test("Sets/U4: enriched set members activate a set threshold via HiGHS (>=N, not below)", async () => {
    // End-to-end proof that enriched gear now counts toward set bonuses: equip real
    // enriched Dread Isle's Curse members from the built dataset and confirm the
    // 5-piece bonus activates at 5 pieces and not at 4.
    const fs = require("fs");
    const data = normalizeDataset(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8")));
    const SET = "The Legendary Dread Isle's Curse";
    const members = data.items.filter(it => (it.set_bonus || []).some(s => s.set === SET));
    const bySlot = {};
    for (const it of members) if (!bySlot[it.slot]) bySlot[it.slot] = it;
    const pieces = Object.values(bySlot)
      .filter(v => ["Bracers", "Boots", "Gloves", "Belt", "Necklace", "Trinket", "Goggles", "Cloak", "Helmet"].includes(v.slot))
      .slice(0, 5);
    assert.ok(pieces.length === 5, "need 5 enriched Dread Isle members in distinct slots");
    const mk = vs => ({ targets: ["Universal Spell Power"], mlCap: 34, dodgeCap: null,
      worn: vs.map(v => ({ slot: v.slot, cardinality: 1, variants: [v] })) });
    const r5 = await S.solveLexicographic(mk(pieces), highs);
    const r4 = await S.solveLexicographic(mk(pieces.slice(0, 4)), highs);
    assert.ok(r5.setsActive.some(s => s.set === SET), "5 enriched pieces activate the set");
    assert.ok(r5.effective["Universal Spell Power"] >= 25, "the set's Universal Spell Power reaches the total");
    assert.ok(!r4.setsActive.some(s => s.set === SET), "4 pieces do NOT activate the set (threshold honored)");
  });

  // U6 (plan 2026-08-05-002, #139) — the joker path is LIVE, not retired. The
  // wildcard-set feature was restored and every Gem of Many Facets tier is now
  // wired (docs/wiki-evidence/gem-of-many-facets.md); solver.js builds joker vars
  // and model.js accounts for joker groups in dominance. The tests below reproduce
  // the reported behavior against correct per-tier data BEFORE any solver change —
  // per the plan, the solver is touched only if the data-correct case still fails.

  await test("U6: a wildcard completes one set from EACH of its two pools", async () => {
    // Two sets, each one piece short. The Gem's pools offer both, one per group —
    // so a correct solve completes both at once, which is the two-set behavior the
    // report said users never saw.
    const A = "Vulkoor's Might", B = "Might of the Abishai";
    const tiersA = [{ n: 2, affixes: [["Strength", "Artifact", 4]] }];
    const tiersB = [{ n: 2, affixes: [["Constitution", "Artifact", 6]] }];
    const gem = item("GEM", "Trinket", []);
    gem.joker_set_groups = [[A, "Marshwalker"], [B, "Oasis of Morality"]];
    const model = {
      targets: ["Strength", "Constitution"], mlCap: 34, dodgeCap: null,
      worn: [
        slot("Ring", [setPiece("RA", "Ring", [["Strength", "Enhancement", 1]], A, tiersA)]),
        slot("Necklace", [setPiece("NB", "Necklace", [["Constitution", "Enhancement", 1]], B, tiersB)]),
        slot("Trinket", [gem]),
      ],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    const active = (r.setsActive || []).map((s) => s.set);
    assert.ok(active.includes(A), `${A} completed via the wildcard: ${JSON.stringify(active)}`);
    assert.ok(active.includes(B), `${B} completed via the wildcard: ${JSON.stringify(active)}`);
  });

  await test("U6: a wildcard picks at most ONE set per pool (no double-count)", async () => {
    // Both candidates in the SAME group are one piece short. Only one may complete —
    // the one-pick-per-group rule — so the wildcard cannot satisfy both.
    const A = "Vulkoor's Might", B = "Marshwalker";
    const t = (stat) => [{ n: 2, affixes: [[stat, "Artifact", 5]] }];
    const gem = item("GEM", "Trinket", []);
    gem.joker_set_groups = [[A, B]];   // one group holding both
    const model = {
      targets: ["Strength", "Constitution"], mlCap: 34, dodgeCap: null,
      worn: [
        slot("Ring", [setPiece("RA", "Ring", [["Strength", "Enhancement", 1]], A, t("Strength"))]),
        slot("Necklace", [setPiece("NB", "Necklace", [["Constitution", "Enhancement", 1]], B, t("Constitution"))]),
        slot("Trinket", [gem]),
      ],
    };
    const r = await S.solveLexicographic(model, highs);
    const active = (r.setsActive || []).map((s) => s.set).filter((n) => n === A || n === B);
    assert.strictEqual(active.length, 1, `exactly one set per pool, got ${JSON.stringify(active)}`);
  });

  // ---- Chosen set-membership slot (Cannith Repurposing Station / Dino Set-Bonus) ----
  function memberHost(id, slotName, pool, affixes, station) {
    const v = item(id, slotName, affixes || []);
    v.set_membership_slot = { pool, station: station || "Cannith Repurposing Station" };
    return v;
  }
  function memberDef(tiers) {
    return { tiers: tiers.map((t) => ({
      pieces_required: t.n, pieces_label: `${t.n} Pieces`,
      affixes: t.affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, name: stat, type: bonus_type, value, unit: "flat" })),
    })) };
  }

  await test("MEMBERSHIP/awaken-only: 3 Lost Purpose items awaken one set to hit a 3-piece threshold (no intrinsic member)", async () => {
    // The case the joker structurally CANNOT do: complete a set with zero fixed
    // members equipped, purely from chosen-membership pieces (self-seeded threshold).
    const SET = "Legendary Vol's Influence";
    const DEFS = { [SET]: memberDef([{ n: 3, affixes: [["Constitution", "Profane", 8]] }]) };
    const pool = [SET];
    const model = {
      targets: ["Constitution"], mlCap: 34, dodgeCap: null, membershipSetDefs: DEFS,
      worn: [
        slot("Helmet", [memberHost("H1", "Helmet", pool)]),
        slot("Cloak", [memberHost("H2", "Cloak", pool)]),
        slot("Gloves", [memberHost("H3", "Gloves", pool)]),
      ],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.ok(r.setsActive.some((s) => s.set === SET), "membership-only completion activates the set (joker cannot do this)");
    assert.strictEqual(r.effective.Constitution, 8, "the set's 3-piece bonus reaches the total");
    assert.strictEqual((r.membershipPlaced || []).length, 3, "three membership picks reported");
    // determinism
    const again = await S.solveLexicographic(model, highs);
    assert.deepStrictEqual(again.membershipPlaced, r.membershipPlaced, "membership assignment is deterministic");
  });

  await test("MEMBERSHIP/below-threshold: 2 of 3 do not activate", async () => {
    const SET = "Legendary Vol's Influence";
    const DEFS = { [SET]: memberDef([{ n: 3, affixes: [["Constitution", "Profane", 8]] }]) };
    const model = {
      targets: ["Constitution"], mlCap: 34, dodgeCap: null, membershipSetDefs: DEFS,
      worn: [slot("Helmet", [memberHost("H1", "Helmet", [SET])]),
             slot("Cloak", [memberHost("H2", "Cloak", [SET])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.ok(!r.setsActive.some((s) => s.set === SET), "2 pieces below the 3-piece threshold do not activate");
  });

  await test("MEMBERSHIP/single-pick: one host joins exactly one set", async () => {
    const DEFS = {
      SetA: memberDef([{ n: 1, affixes: [["Strength", "Profane", 5]] }]),
      SetB: memberDef([{ n: 1, affixes: [["Constitution", "Profane", 5]] }]),
    };
    const model = {
      targets: ["Strength", "Constitution"], mlCap: 34, dodgeCap: null, membershipSetDefs: DEFS,
      worn: [slot("Helmet", [memberHost("H1", "Helmet", ["SetA", "SetB"])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual((r.membershipPlaced || []).length, 1, "one host joins exactly one set, not both");
    assert.strictEqual(r.effective.Strength, 5, "the priority-1 set is the one chosen");
    assert.strictEqual(r.effective.Constitution, 0, "the second set is not chosen on the same host");
  });

  await test("MEMBERSHIP/fixed+chosen-membership mix: a fixed Forbidden Knowledge weapon + 1 chosen-membership piece complete a 2-piece tier", async () => {
    const SET = "Legendary Forbidden Knowledge";
    const tier = [{ n: 2, affixes: [["Constitution", "Profane", 10]] }];
    const DEFS = { [SET]: memberDef(tier) };
    const weapon = setPiece("FKWeapon", "Main Hand", [["Constitution", "Enhancement", 1]], SET,
      [{ n: 2, affixes: [["Constitution", "Profane", 10]] }]);
    const model = {
      targets: ["Constitution"], mlCap: 34, dodgeCap: null, membershipSetDefs: DEFS,
      worn: [slot("Main Hand", [weapon]),
             slot("Helmet", [memberHost("LP", "Helmet", [SET])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.ok(r.setsActive.some((s) => s.set === SET), "fixed weapon piece + 1 chosen-membership piece complete the 2-piece tier");
    assert.strictEqual((r.membershipPlaced || []).length, 1, "one membership pick reported (the weapon is intrinsic, not a membership pick)");
  });

  await test("MEMBERSHIP/no-fabrication: a membership pick with no set benefit is not placed", async () => {
    const SET = "Legendary Vol's Influence";
    const DEFS = { [SET]: memberDef([{ n: 3, affixes: [["Constitution", "Profane", 8]] }]) };
    // only one host -> a 3-piece set can never complete -> no membership pick fired
    const model = {
      targets: ["Constitution"], mlCap: 34, dodgeCap: null, membershipSetDefs: DEFS,
      worn: [slot("Helmet", [memberHost("H1", "Helmet", [SET])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual((r.membershipPlaced || []).length, 0, "a non-load-bearing membership pick is not fabricated");
  });

  await test("MEMBERSHIP/real items: an awaken-only set is awakened on real Lost Purpose gear", async () => {
    // The full feature: real dataset + real buildModel. When an awaken-only Vecna set
    // (no intrinsic members) is genuinely the best path for the ranked targets, real
    // Legendary University Lost Purpose armor/helm/cloak hosts awaken it. Delight of
    // the Devourer gives both these stats, so completing its 3-piece tier wins.
    const fs = require("fs");
    const { buildModel } = require("../web/model.js");
    const data = normalizeDataset(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8")));
    const lp = data.items.filter((v) => (v.set_membership_slot || {}).station === "Cannith Repurposing Station");
    assert.ok(lp.length === 44, "all 44 Lost Purpose items carry a Cannith membership slot");
    const query = { mlCap: 32, targets: ["Additional Damage to Helpless Targets", "Melee and Ranged Power"], armorType: null, weaponSetup: null, classRace: null };
    const model = buildModel(data.items, query, data.dino_inserts, data.nearly_complete, data.viktranium, data.seal, data.membership_set_defs);
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    const memberSets = new Set((r.membershipPlaced || []).map((m) => m.set));
    assert.ok(memberSets.size > 0, "at least one Vecna set is awakened on real Lost Purpose gear");
    assert.ok((r.membershipPlaced || []).every((m) => m.station === "Cannith Repurposing Station"),
      "every membership prescription names the Cannith Repurposing Station");
    // whatever set was chosen is genuinely active (load-bearing guard holds on real data)
    const active = new Set((r.setsActive || []).map((s) => s.set));
    for (const s of memberSets) assert.ok(active.has(s), `${s} is active where chosen`);
  });

  await test("MEMBERSHIP/dino: a Dinosaur Bone Set-Bonus host joins a Dino set at its own station", async () => {
    // U4: the shared primitive also drives Dino Set-Bonus. 3 Dinosaur Bone Armor/Helmet/
    // Cloak hosts join the same 3-piece Dino set (Dread Stalker) — reported at the
    // Dinosaur Bone crafting station, not the Cannith one.
    const SET = "Dread Stalker";
    const DEFS = { [SET]: memberDef([{ n: 3, affixes: [["Melee Power", "Artifact", 15]] }]) };
    const dinoHost = (id, slotName) => {
      const v = item(id, slotName, []);
      v.set_membership_slot = { pool: [SET], station: "Dinosaur Bone crafting" };
      return v;
    };
    const model = {
      targets: ["Melee Power"], mlCap: 32, dodgeCap: null, membershipSetDefs: DEFS,
      worn: [slot("Armor", [dinoHost("DA", "Armor")]), slot("Helmet", [dinoHost("DH", "Helmet")]),
             slot("Cloak", [dinoHost("DC", "Cloak")])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.ok(r.setsActive.some((s) => s.set === SET), "the Dino set activates from 3 chosen Set-Bonus slots");
    assert.strictEqual((r.membershipPlaced || []).length, 3, "three Dino membership picks reported");
    assert.ok(r.membershipPlaced.every((m) => m.station === "Dinosaur Bone crafting"), "reported at the Dino station");
  });

  await test("MEMBERSHIP/no over-report on tieBreak:false (alternatives path)", async () => {
    // A Lost Purpose host equipped for its plain worn affix, but its 3-piece set
    // cannot complete (only one such host). On a tieBreak:false solve (the path every
    // alternative re-solve takes) the member var may float to 1 for free — but the set
    // is inactive, so no membership pick must be prescribed (it would buy nothing).
    const SET = "Legendary Vol's Influence";
    const DEFS = { [SET]: memberDef([{ n: 3, affixes: [["Universal Spell Power", "Artifact", 25]] }]) };
    const host = memberHost("LP", "Helmet", [SET], [["Constitution", "Enhancement", 12]]);
    const model = {
      targets: ["Constitution"], mlCap: 34, dodgeCap: null, membershipSetDefs: DEFS,
      worn: [slot("Helmet", [host])],
    };
    const program = S.buildProgram(model);
    const r = S.solveConstrained(program, highs, { objectiveStat: "Constitution", sense: "max", tieBreak: false });
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual((r.membershipPlaced || []).length, 0, "no membership pick reported when the set is inactive on a tieBreak:false solve");
  });

  await test("MEMBERSHIP/end-to-end: real exported set defs self-seed an membership-only completion", async () => {
    // The full path: build_dataset exported membership_set_defs -> the solver
    // self-seeds a threshold with NO fixed member equipped -> 3 Lost Purpose hosts
    // join Legendary Vol's Influence and complete its 3-piece Artifact bonus.
    const fs = require("fs");
    const data = normalizeDataset(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8")));
    const defs = data.membership_set_defs || {};
    assert.ok(Object.keys(defs).length === 28, "items.json exports all 28 membership set defs (22 Vecna + 6 Dino)");
    const SET = "Legendary Vol's Influence";
    assert.ok(defs[SET], "the real Legendary Vol's Influence def is present");
    const lp = (slotName) => memberHost(`LP-${slotName}`, slotName, [SET]);
    const model = {
      targets: ["Universal Spell Power"], mlCap: 34, dodgeCap: null,
      membershipSetDefs: defs,
      worn: [slot("Helmet", [lp("Helmet")]), slot("Cloak", [lp("Cloak")]), slot("Gloves", [lp("Gloves")])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.ok(r.setsActive.some((s) => s.set === SET), "the real def self-seeds and the set activates from 3 chosen pieces");
    assert.strictEqual(r.effective["Universal Spell Power"], 25, "the set's real +25 Artifact USP reaches the total");
    assert.strictEqual((r.membershipPlaced || []).length, 3, "three membership picks prescribed");
    assert.ok(r.membershipPlaced.every((m) => m.station === "Cannith Repurposing Station"), "prescriptions name the station");
  });

  // ---- Legendary Thunder-Forged (multi-tier choice-slot) ----
  function tfHost(id, slotName, tiers, affixes) {
    const v = item(id, slotName, affixes || []);
    v.thunder_forged_tiers = tiers.map((t) => ({ tier: t }));
    return v;
  }
  function tfOpt(tier, stat, bonus_type, value) {
    return { tier, stat, bonus_type, value, unit: "flat" };
  }

  await test("TF/multi-tier: a Thunder-Forged host crafts one option per tier independently", async () => {
    const POOL = [
      tfOpt(1, "Strength", "Enhancement", 4),
      tfOpt(2, "Constitution", "Insightful", 3),
      tfOpt(3, "Strength", "Profane", 2),
    ];
    const model = {
      targets: ["Strength", "Constitution"], mlCap: 34, dodgeCap: null,
      thunderForged: POOL,
      worn: [slot("Main Hand", [tfHost("W", "Main Hand", [1, 2, 3])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual((r.tfPlaced || []).length, 3, "one pick per tier (3 tiers)");
    // Strength Enhancement 4 (T1) + Strength Profane 2 (T3) stack (different types) = 6
    assert.strictEqual(r.effective.Strength, 6, "T1 + T3 Strength stack across bonus types");
    assert.strictEqual(r.effective.Constitution, 3, "T2 Constitution crafted");
  });

  await test("TF/tier-keyed: an option for the wrong tier is not craftable in that tier", () => {
    // Pool only has a Tier-2 option; a host with only Tier 1 crafts nothing.
    const program = S.buildProgram({
      targets: ["Constitution"], mlCap: 34, dodgeCap: null,
      thunderForged: [tfOpt(2, "Constitution", "Insightful", 3)],
      worn: [slot("Main Hand", [tfHost("W", "Main Hand", [1])])],
    });
    assert.strictEqual(program.tfMeta.size, 0, "no craft option generated for an absent tier");
  });

  // ---- Legendary Green Steel (single-pick choice-slot) ----
  function gsHost(id, slotName, affixes) {
    const v = item(id, slotName, affixes || []);
    v.green_steel_slot = true;
    return v;
  }
  function gsOpt(name, stat, bonus_type, value) {
    return { name, stat, bonus_type, value, unit: "flat" };
  }

  await test("GS/single-pick: a Green Steel host crafts exactly one endgame option", async () => {
    const POOL = [
      gsOpt("Con item", "Constitution", "Insightful", 8),
      gsOpt("Str item", "Strength", "Insightful", 8),
    ];
    const model = {
      targets: ["Constitution", "Strength"], mlCap: 34, dodgeCap: null,
      greenSteel: POOL,
      worn: [slot("Trinket", [gsHost("H", "Trinket")])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual((r.gsPlaced || []).length, 1, "exactly one Green Steel craft");
    assert.strictEqual(r.effective.Constitution, 8, "priority-1 crafted");
    assert.strictEqual(r.effective.Strength, 0, "one slot -> only one option, not both");
  });

  await test("GS/stacking: single-pick respects bonus-type stacking (picks the stacking tier)", async () => {
    // Con Insightful already capped by a worn affix; the GS best move for a Con-first
    // ranking is a different bonus type (Quality) so it stacks.
    const POOL = [gsOpt("Con insight", "Constitution", "Insightful", 8), gsOpt("Con quality", "Constitution", "Quality", 4)];
    const model = {
      targets: ["Constitution"], mlCap: 34, dodgeCap: null,
      greenSteel: POOL,
      worn: [slot("Trinket", [gsHost("H", "Trinket", [["Constitution", "Insightful", 10]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    // worn Insightful 10 + GS Quality 4 = 14 (different types stack); NOT 18, NOT just 10.
    assert.strictEqual(r.effective.Constitution, 14, "crafts the Quality tier to stack past the capped Insightful");
    assert.strictEqual(r.gsPlaced[0].bonus_type, "Quality", "chose the stacking tier");
  });

  // U6 — AE4 end-to-end: slot constraints honored through the real HiGHS solve
  await test("AE4: a pinned (weaker) variant is force-equipped over the optimum", async () => {
    const model = {
      targets: ["Constitution"], mlCap: 34, dodgeCap: null,
      worn: [slot("Trinket", [
        item("TrinkStrong", "Trinket", [["Constitution", "Enhancement", 20]]),
        item("TrinkWeak", "Trinket", [["Constitution", "Enhancement", 5]]),
      ])],
      query: { slotConstraints: { Trinket: { type: "pin", variant_id: "TrinkWeak" } } },
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.chosen[0].variant.variant_id, "TrinkWeak", "pin forces the weaker item");
    assert.strictEqual(r.effective.Constitution, 5, "and the solve honors it, not the 20 optimum");
  });

  await test("AE4: lock-empty leaves the slot empty (and stays feasible)", async () => {
    const model = {
      targets: ["Constitution"], mlCap: 34, dodgeCap: null,
      worn: [slot("Trinket", [item("T", "Trinket", [["Constitution", "Enhancement", 20]])])],
      query: { slotConstraints: { Trinket: { type: "empty" } } },
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal", "lock-empty must not make the solve infeasible");
    assert.strictEqual(r.chosen.length, 0, "the trinket slot is empty");
    assert.strictEqual(r.effective.Constitution || 0, 0, "no contribution from the locked slot");
  });

  // ---- U3: Artifact opt-in "exactly one" constraint + R6 fallback ----------
  // an Artifact-quality worn item (the U1 flag; the solver reads xv.variant.artifact)
  function artItem(id, slotName, affixes) { const v = item(id, slotName, affixes); v.artifact = true; return v; }

  await test("U3/AE1: box on equips exactly one Artifact, the best-scoring", async () => {
    // Two Artifacts in different slots; same bonus type so equipping both would
    // not out-score one. Exactly-one must pick the higher (Acc 10 over Acc 5).
    const model = {
      targets: ["Accuracy"], mlCap: 34, dodgeCap: null,
      worn: [slot("Trinket", [artItem("artHi", "Trinket", [["Accuracy", "Enhancement", 10]])]),
             slot("Ring", [artItem("artLo", "Ring", [["Accuracy", "Enhancement", 5]])])],
      query: { includeArtifact: true },
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    const arts = r.chosen.filter((c) => c.variant.artifact);
    assert.strictEqual(arts.length, 1, "exactly one Artifact equipped");
    assert.strictEqual(arts[0].variant.variant_id, "artHi", "the best-scoring Artifact");
    assert.strictEqual(r.effective.Accuracy, 10);
  });

  await test("U3/AE4: never two — only one Artifact even when both are strong", async () => {
    // Each Artifact maxes a different target; without the constraint the solver
    // would equip both. Exactly-one forces a single pick.
    const model = {
      targets: ["Accuracy", "Deadly"], mlCap: 34, dodgeCap: null,
      worn: [slot("Trinket", [artItem("artAcc", "Trinket", [["Accuracy", "Enhancement", 10]])]),
             slot("Ring", [artItem("artDead", "Ring", [["Deadly", "Enhancement", 10]])])],
      query: { includeArtifact: true },
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.chosen.filter((c) => c.variant.artifact).length, 1, "never two Artifacts");
    assert.strictEqual(r.effective.Accuracy, 10, "priority 1 target maxed by the chosen Artifact");
    assert.strictEqual(r.effective.Deadly || 0, 0, "the second Artifact is not equipped");
  });

  await test("U3/R6: box on but no Artifact flagged -> feasible non-Artifact build", async () => {
    const model = {
      targets: ["Intelligence"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [item("R", "Ring", [["Intelligence", "Enhancement", 10]])])], // none flagged
      query: { includeArtifact: true },
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal", "no Artifact data must not make the solve infeasible");
    assert.strictEqual(r.chosen.filter((c) => c.variant.artifact).length, 0);
    assert.strictEqual(r.effective.Intelligence, 10, "best non-Artifact build still returned");
  });

  await test("U3/R6: only Artifact's slot locked empty -> feasible, no infeasibility", async () => {
    // The sole Artifact sits in the Trinket slot, which the user locks empty.
    // The =1 constraint must NOT be added (else infeasible); R6 fallback fires.
    const model = {
      targets: ["Accuracy", "Intelligence"], mlCap: 34, dodgeCap: null,
      worn: [slot("Trinket", [artItem("artT", "Trinket", [["Accuracy", "Enhancement", 10]])]),
             slot("Ring", [item("R", "Ring", [["Intelligence", "Enhancement", 8]])])],
      query: { includeArtifact: true, slotConstraints: { Trinket: { type: "empty" } } },
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal", "locked-away Artifact must not make the solve infeasible");
    assert.strictEqual(r.chosen.filter((c) => c.variant.artifact).length, 0, "no Artifact equipped");
    assert.strictEqual(r.effective.Intelligence, 8, "the free non-Artifact slot still fills");
  });

  await test("U3: a non-conflicting pin coexists with the equipped Artifact", async () => {
    // Artifact in a free Trinket slot; a pin on a different slot (Ring -> ring2).
    const model = {
      targets: ["Accuracy", "Constitution"], mlCap: 34, dodgeCap: null,
      worn: [slot("Trinket", [artItem("artT", "Trinket", [["Accuracy", "Enhancement", 10]])]),
             slot("Ring", [item("ring1", "Ring", [["Constitution", "Enhancement", 5]]),
                           item("ring2", "Ring", [["Constitution", "Enhancement", 3]])])],
      query: { includeArtifact: true, slotConstraints: { Ring: { type: "pin", variant_id: "ring2" } } },
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    const ids = r.chosen.map((c) => c.variant.variant_id);
    assert.ok(ids.includes("artT"), "the sole free Artifact is equipped (exactly-one)");
    assert.ok(ids.includes("ring2"), "the honored pin coexists");
    assert.strictEqual(r.chosen.filter((c) => c.variant.artifact).length, 1);
  });

  await test("U3: Artifact pinned to its OWN slot -> equipped, exactly one, no false R6", async () => {
    const model = {
      targets: ["Accuracy"], mlCap: 34, dodgeCap: null,
      worn: [slot("Trinket", [artItem("artT", "Trinket", [["Accuracy", "Enhancement", 10]])]),
             slot("Ring", [item("R", "Ring", [["Accuracy", "Enhancement", 3]])])],
      query: { includeArtifact: true, slotConstraints: { Trinket: { type: "pin", variant_id: "artT" } } },
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.ok(r.chosen.some((c) => c.variant.variant_id === "artT"), "the pinned Artifact is equipped");
    assert.strictEqual(r.chosen.filter((c) => c.variant.artifact).length, 1);
  });

  await test("U3: sole Artifact's cardinality-1 slot pinned to ANOTHER item -> feasible R6 fallback", async () => {
    // Trinket holds the only Artifact but is pinned to a different (non-artifact)
    // Trinket item, so the Artifact cannot be placed -> exactly-one must drop.
    const model = {
      targets: ["Accuracy", "Intelligence"], mlCap: 34, dodgeCap: null,
      worn: [slot("Trinket", [artItem("artT", "Trinket", [["Accuracy", "Enhancement", 10]]),
                              item("plainT", "Trinket", [["Intelligence", "Enhancement", 6]])])],
      query: { includeArtifact: true, slotConstraints: { Trinket: { type: "pin", variant_id: "plainT" } } },
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal", "foreign pin on the sole Artifact's slot must stay feasible");
    assert.strictEqual(r.chosen.filter((c) => c.variant.artifact).length, 0, "no Artifact equipped");
    assert.ok(r.chosen.some((c) => c.variant.variant_id === "plainT"), "the pin is honored");
  });

  await test("U3: Artifact Ring coexists with a foreign-pinned Ring (cardinality 2)", async () => {
    const model = {
      targets: ["Accuracy", "Constitution"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [artItem("artRing", "Ring", [["Accuracy", "Enhancement", 10]]),
                           item("ring2", "Ring", [["Constitution", "Enhancement", 5]]),
                           item("ring3", "Ring", [["Constitution", "Enhancement", 3]])], 2)],
      query: { includeArtifact: true, slotConstraints: { Ring: { type: "pin", variant_id: "ring2" } } },
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    const ids = r.chosen.map((c) => c.variant.variant_id);
    assert.ok(ids.includes("artRing"), "the Artifact ring takes the free Ring slot");
    assert.ok(ids.includes("ring2"), "the pinned ring is honored");
    assert.strictEqual(r.chosen.filter((c) => c.variant.artifact).length, 1);
  });

  await test("U3: TWO Artifacts force-pinned in different slots -> feasible, not infeasible", async () => {
    // The pins assert two Artifacts (the user's explicit choice); adding
    // sum(artifacts)=1 would be infeasible (2=1). The guard drops the constraint
    // so the pins stand and the solve does not collapse to the generic error.
    const model = {
      targets: ["Accuracy", "Deadly"], mlCap: 34, dodgeCap: null,
      worn: [slot("Trinket", [artItem("artT", "Trinket", [["Accuracy", "Enhancement", 10]])]),
             slot("Necklace", [artItem("artN", "Necklace", [["Deadly", "Enhancement", 10]])])],
      query: { includeArtifact: true,
        slotConstraints: { Trinket: { type: "pin", variant_id: "artT" }, Necklace: { type: "pin", variant_id: "artN" } } },
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal", "two pinned Artifacts must not make the solve infeasible");
    const ids = r.chosen.map((c) => c.variant.variant_id);
    assert.ok(ids.includes("artT") && ids.includes("artN"), "both explicitly-pinned Artifacts stand");
  });

  await test("U3: a STALE pin in the sole Artifact's slot does not suppress exactly-one", async () => {
    // The pin references a variant not present in the slot (ghost). It resolves
    // to nothing, so the slot is actually free and the Artifact must be required.
    const model = {
      targets: ["Accuracy"], mlCap: 34, dodgeCap: null,
      worn: [slot("Trinket", [artItem("artT", "Trinket", [["Accuracy", "Enhancement", 10]])])],
      query: { includeArtifact: true, slotConstraints: { Trinket: { type: "pin", variant_id: "ghost" } } },
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.chosen.filter((c) => c.variant.artifact).length, 1, "stale pin must not drop the Artifact");
  });

  await test("U3/KTD2 soundness: exactly-one does not sacrifice a non-Artifact's secondary stat", async () => {
    // Trinket: artifact B (Acc10/Deadly10) vs non-artifact A (Acc8/Deadly8).
    // Necklace: artifact C (Acc12). Priorities [Accuracy, Deadly].
    // Stage 1 picks C (Acc 12) as the one Artifact, forcing B off. The optimum
    // then equips non-artifact A in Trinket for Deadly 8 — which is only reachable
    // if A survived pruning (it would be wrongly pruned by B without the fix).
    const model = {
      targets: ["Accuracy", "Deadly"], mlCap: 34, dodgeCap: null,
      worn: [slot("Trinket", [artItem("B", "Trinket", [["Accuracy", "Enhancement", 10], ["Deadly", "Enhancement", 10]]),
                              item("A", "Trinket", [["Accuracy", "Enhancement", 8], ["Deadly", "Enhancement", 8]])]),
             slot("Necklace", [artItem("C", "Necklace", [["Accuracy", "Enhancement", 12]])])],
      query: { includeArtifact: true },
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.Accuracy, 12, "priority 1 maxed by the one Artifact (C)");
    assert.strictEqual(r.effective.Deadly, 8, "non-Artifact A supplies Deadly — it must not have been pruned by B");
    assert.strictEqual(r.chosen.filter((c) => c.variant.artifact).length, 1, "still exactly one Artifact");
  });

  await test("U3: exactly-one solve is deterministic across runs", async () => {
    const mk = () => ({
      targets: ["Accuracy"], mlCap: 34, dodgeCap: null,
      worn: [slot("Trinket", [artItem("artHi", "Trinket", [["Accuracy", "Enhancement", 10]])]),
             slot("Ring", [artItem("artLo", "Ring", [["Accuracy", "Enhancement", 10]])])],
      query: { includeArtifact: true },
    });
    const a = await S.solveLexicographic(mk(), highs);
    const b = await S.solveLexicographic(mk(), highs);
    assert.deepStrictEqual(a.chosen.map((c) => c.variant.variant_id), b.chosen.map((c) => c.variant.variant_id));
    assert.strictEqual(a.chosen.filter((c) => c.variant.artifact).length, 1);
  });

  await test("TWF hand-mutex: a shared weapon can't fill both hands", () => {
    const M = require("../web/model.js");
    // A single Rapier qualifies for BOTH the main-hand lock and the off-hand-weapon
    // lock (overlapping sets) — the exact case the mutex guards.
    const rapier = { source_item: "Twin Rapier", variant_id: "Twin Rapier", slot: "Weapon",
      category: "weapon", type: "Rapiers", minimum_level: 10, ml: 10, verification: "verified",
      affixes: [{ name: "Strength", type: "Enhancement", value: 8, unit: "flat" }],
      scaling: [], set_bonus: [], augment_slots: [] };
    // plan 003 U2/KTD3 — the declaration is now what enables the off-hand weapon;
    // the type picks stay as refinement.
    const model = M.buildModel([rapier], { mlCap: 34, targets: ["Strength"], style: "one-hand",
      twoWeaponFighting: true, weaponTypes: ["Rapiers"], offHandWeapons: ["Rapiers"] });
    const mh = model.worn.find((s) => s.slot === "Main Hand");
    const oh = model.worn.find((s) => s.slot === "Off Hand");
    assert.ok(mh && oh, "both hand slots are built");
    assert.ok(mh.variants.some((v) => v.variant_id === "Twin Rapier") &&
      oh.variants.some((v) => v.variant_id === "Twin Rapier"), "the Rapier is a candidate in both hands");
    const program = S.buildProgram(model);
    assert.ok(program.extraConstraints.some((c) => /^x\d+ \+ x\d+ <= 1$/.test(c)),
      "a hand-mutex `xA + xB <= 1` pairs the shared weapon's two pick-vars (load-bearing, not cosmetic)");
  });

  await test("U2/B5: pinning two different rings equips BOTH (real solve)", async () => {
    // R3 is the strongest ring; unpinned the solver would prefer it. Pinning R1
    // and R2 via a Ring list must force both into the cardinality-2 slot instead.
    const R1 = item("R1", "Ring", [["Intelligence", "Enhancement", 3]]);
    const R2 = item("R2", "Ring", [["Intelligence", "Enhancement", 4]]);
    const R3 = item("R3", "Ring", [["Intelligence", "Enhancement", 10]]);
    const model = {
      targets: ["Intelligence"], mlCap: 34, dodgeCap: null,
      query: { slotConstraints: { Ring: { type: "pin", variant_ids: ["R1", "R2"] } } },
      worn: [slot("Ring", [R1, R2, R3], 2)],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    const ringIds = r.chosen.filter((c) => c.slot === "Ring").map((c) => c.variant.variant_id).sort();
    assert.deepStrictEqual(ringIds, ["R1", "R2"], "both pinned rings equipped, not the stronger R3");
  });

  await test("U2/U4: Artifact exactly-one drops when a Ring list fills the slot (real solve)", async () => {
    // artRing is the ONLY Artifact; the cardinality-2 Ring slot is pinned FULL with
    // two non-Artifacts, so artRing is forced to zero. The 'exactly one Artifact'
    // constraint must then be DROPPED (not asserted against an unplaceable Artifact),
    // else the solve goes infeasible. Guards the `resolving.length >= cardinality`
    // branch in buildProgram's forcedToZero (untested by the single-pin Artifact cases).
    const artRing = item("artRing", "Ring", [["Intelligence", "Enhancement", 10]]); artRing.artifact = true;
    const R2 = item("R2", "Ring", [["Intelligence", "Enhancement", 3]]);
    const R3 = item("R3", "Ring", [["Intelligence", "Enhancement", 4]]);
    const model = {
      targets: ["Intelligence"], mlCap: 34, dodgeCap: null,
      query: { includeArtifact: true, slotConstraints: { Ring: { type: "pin", variant_ids: ["R2", "R3"] } } },
      worn: [slot("Ring", [artRing, R2, R3], 2)],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal", "feasible: exactly-one is dropped, not asserted against a forced-off Artifact");
    const ringIds = r.chosen.filter((c) => c.slot === "Ring").map((c) => c.variant.variant_id).sort();
    assert.deepStrictEqual(ringIds, ["R2", "R3"], "the two pinned non-Artifact rings equip");
    assert.ok(!r.chosen.some((c) => c.variant.artifact), "the Artifact ring is forced to zero (none equipped)");
  });

  // --- R1/R3 hand mutex (U1) — end-to-end against real HiGHS ---
  await test("R1/R3: a two-handed main + an off-hand item can't co-occur (hand mutex)", async () => {
    const twoH = { ...item("GS", "Main Hand", [["Strength", "Enhancement", 20]]), category: "weapon", type: "Great Swords" };
    const shield = { ...item("Shield", "Off Hand", [["Constitution", "Enhancement", 20]]), type: "Large shields" };
    const model = { targets: ["Strength", "Constitution"], worn: [slot("Main Hand", [twoH]), slot("Off Hand", [shield])] };
    const chosen = ((await S.solveLexicographic(model, highs)).chosen || []).map((c) => c.variant.variant_id);
    assert.ok(!(chosen.includes("GS") && chosen.includes("Shield")), "2H main + off-hand shield never co-occur");
  });

  await test("R1: a one-handed main + an off-hand shield DO co-occur (mutex doesn't fire)", async () => {
    const oneH = { ...item("LS", "Main Hand", [["Strength", "Enhancement", 20]]), category: "weapon", type: "Long Swords" };
    const shield = { ...item("Shield", "Off Hand", [["Constitution", "Enhancement", 20]]), type: "Large shields" };
    const model = { targets: ["Strength", "Constitution"], worn: [slot("Main Hand", [oneH]), slot("Off Hand", [shield])] };
    const chosen = ((await S.solveLexicographic(model, highs)).chosen || []).map((c) => c.variant.variant_id);
    assert.ok(chosen.includes("LS") && chosen.includes("Shield"), "1H main + shield co-occur");
  });

  await test("R3: a bow main and an off-hand item can't co-occur (bows are both-hands)", async () => {
    const bow = { ...item("Bow", "Main Hand", [["Strength", "Enhancement", 20]]), category: "weapon", type: "Long Bows" };
    const shield = { ...item("Shield", "Off Hand", [["Constitution", "Enhancement", 20]]), type: "Large shields" };
    const model = { targets: ["Strength", "Constitution"], worn: [slot("Main Hand", [bow]), slot("Off Hand", [shield])] };
    const chosen = ((await S.solveLexicographic(model, highs)).chosen || []).map((c) => c.variant.variant_id);
    assert.ok(!(chosen.includes("Bow") && chosen.includes("Shield")), "bow main + off-hand never co-occur");
  });

  await test("R3: an untyped Dino weapon host (type null) is both-hands — no off-hand alongside", async () => {
    const dino = { ...item("DinoWeap", "Main Hand", [["Strength", "Enhancement", 20]]), category: "weapon", type: null };
    const shield = { ...item("Shield", "Off Hand", [["Constitution", "Enhancement", 20]]), type: "Large shields" };
    const model = { targets: ["Strength", "Constitution"], worn: [slot("Main Hand", [dino]), slot("Off Hand", [shield])] };
    const chosen = ((await S.solveLexicographic(model, highs)).chosen || []).map((c) => c.variant.variant_id);
    assert.ok(!(chosen.includes("DinoWeap") && chosen.includes("Shield")), "untyped host treated as two-handed (KTD3)");
  });

  await test("R1/R3 feasibility: conflicting hand pins (2H main + off-hand) relax the mutex, not no-build", async () => {
    // A user force-pins BOTH a two-handed main AND an off-hand. Each pin is individually
    // legal, so reconcilePinLegality drops neither; without the guard the mutex reads
    // `2 <= 1` and the WHOLE solve bails to infeasible. The guard must relax the mutex so
    // the user still gets their (illegal, wizard-warned) build rather than nothing.
    const twoH = { ...item("GS", "Main Hand", [["Strength", "Enhancement", 20]]), category: "weapon", type: "Great Swords" };
    const shield = { ...item("Shield", "Off Hand", [["Constitution", "Enhancement", 20]]), type: "Large shields" };
    const model = {
      targets: ["Strength", "Constitution"],
      worn: [slot("Main Hand", [twoH]), slot("Off Hand", [shield])],
      query: { slotConstraints: { "Main Hand": { type: "pin", variant_id: "GS" }, "Off Hand": { type: "pin", variant_id: "Shield" } } },
    };
    const res = await S.solveLexicographic(model, highs);
    assert.notStrictEqual(res.status, "infeasible", "conflicting hand pins must not bail the whole solve");
    const chosen = (res.chosen || []).map((c) => c.variant.variant_id);
    assert.ok(chosen.includes("GS") && chosen.includes("Shield"), "both force-pinned hands are honored (relaxed mutex)");
  });

  // ---------------------------------------------------------------------------
  // U3 — Set Augment source family. A Set Augment carries NO stats and may be
  // slotted (into a Colorless slot) up to 3 times; the 3-piece Artifact bonus
  // fires at exactly 3 owned copies. Copies feed the EXISTING set-threshold
  // engine. Defs come from model.augment_set_defs (mirrors membershipSetDefs);
  // hosts are equipped items exposing a Colorless slot.
  // ---------------------------------------------------------------------------
  // A set-augment def, shaped exactly like items.json augment_set_defs entries.
  function augSetDef(affixes, pieces = 3) {
    return {
      tiers: [{
        pieces_required: pieces, pieces_label: `${pieces} Pieces Equipped`,
        affixes: affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, value, unit: "flat" })),
        wiki_url: "https://ddowiki.com/page/Augment_Slot/Set_Augment",
      }],
      tier: "augment", wiki_url: "https://ddowiki.com/page/Augment_Slot/Set_Augment",
    };
  }

  await test("U3 set-augment: 3-piece bonus ABSENT with 2 copies, PRESENT (once) with 3", async () => {
    const def = { "AugSet": augSetDef([["StatA", "Artifact", 10]]) };
    // 2 colorless-slot hosts -> at most 2 copies -> below the 3-piece threshold.
    const two = {
      targets: ["StatA"], mlCap: 34, dodgeCap: null, augment_set_defs: def,
      worn: [slot("Ring", [host("H1", "Ring", [], ["Colorless"])]),
             slot("Necklace", [host("H2", "Necklace", [], ["Colorless"])])],
    };
    const r2 = await S.solveLexicographic(two, highs);
    assert.strictEqual(r2.status, "optimal");
    assert.strictEqual(r2.effective.StatA, 0, "2 copies < 3-piece threshold -> no bonus");

    // 3 colorless-slot hosts -> exactly 3 copies -> the 3-piece bonus fires ONCE.
    const three = {
      targets: ["StatA"], mlCap: 34, dodgeCap: null, augment_set_defs: def,
      worn: [slot("Ring", [host("H1", "Ring", [], ["Colorless"])]),
             slot("Necklace", [host("H2", "Necklace", [], ["Colorless"])]),
             slot("Trinket", [host("H3", "Trinket", [], ["Colorless"])])],
    };
    const r3 = await S.solveLexicographic(three, highs);
    assert.strictEqual(r3.status, "optimal");
    assert.strictEqual(r3.effective.StatA, 10, "3 copies -> 3-piece bonus applied exactly once (10, not 30)");
  });

  await test("U3 set-augment: Σ_i y ≤ 3 — never more than 3 copies even with 4 hosts", async () => {
    const def = { "AugSet": augSetDef([["StatA", "Artifact", 10]]) };
    const model = {
      targets: ["StatA"], mlCap: 34, dodgeCap: null, augment_set_defs: def,
      worn: [slot("Ring", [host("H1", "Ring", [], ["Colorless"])]),
             slot("Necklace", [host("H2", "Necklace", [], ["Colorless"])]),
             slot("Trinket", [host("H3", "Trinket", [], ["Colorless"])]),
             slot("Goggles", [host("H4", "Goggles", [], ["Colorless"])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.StatA, 10, "bonus fires (>=3 hosts available)");
    assert.strictEqual((r.setAugmentsPlaced || []).length, 3, "at most 3 copies owned, never 4");
  });

  await test("U3 set-augment: a copy requires its host equipped (y ≤ x)", async () => {
    // Slot 2 offers TWO mutually-exclusive colorless hosts (cardinality 1), so only
    // ONE equips -> at most 2 distinct equipped hosts -> 2 copies -> no 3-piece. If
    // y<=x were absent, the solver could count a copy on the UNequipped variant to
    // fabricate a 3rd piece and wrongly activate the set.
    const def = { "AugSet": augSetDef([["StatA", "Artifact", 10]]) };
    const model = {
      targets: ["StatA"], mlCap: 34, dodgeCap: null, augment_set_defs: def,
      worn: [slot("Ring", [host("H1", "Ring", [], ["Colorless"])]),
             slot("Necklace", [host("H2", "Necklace", [], ["Colorless"]),
                               host("H3", "Necklace", [], ["Colorless"])], 1)],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.StatA, 0, "only 2 hosts can be equipped -> no 3rd copy, no bonus");
    assert.ok((r.setAugmentsPlaced || []).length <= 2, "never more copies than equipped hosts");
  });

  await test("U3 set-augment: Colorless capacity is shared, not double-booked", async () => {
    // 3 colorless-slot hosts = 3 physical Colorless slots. The set 3-piece (StatA)
    // needs all 3 slots for its copies; an ordinary Colorless augment (StatB) also
    // wants a Colorless slot. Lexicographic StatA first -> 3 set copies consume all 3
    // slots, so StatB cannot ALSO be served. If the copies did not consume Colorless
    // supply, the ordinary augment would slot "for free" and StatB would be 7.
    const def = { "AugSet": augSetDef([["StatA", "Artifact", 10]]) };
    const model = {
      targets: ["StatA", "StatB"], mlCap: 34, dodgeCap: null, augment_set_defs: def,
      augments: [augment("ord", "Colorless", [["StatB", "Enhancement", 7]])],
      worn: [slot("Ring", [host("H1", "Ring", [], ["Colorless"])]),
             slot("Necklace", [host("H2", "Necklace", [], ["Colorless"])]),
             slot("Trinket", [host("H3", "Trinket", [], ["Colorless"])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.StatA, 10, "priority StatA: 3 copies fill all 3 Colorless slots");
    assert.strictEqual(r.effective.StatB, 0, "no Colorless slot left for the ordinary augment (shared supply)");
  });

  await test("U3 set-augment: 3-piece Artifact bonus lands in its bucket — collapses vs a competing Artifact, stacks vs a distinct type", async () => {
    const def = { "AugSet": augSetDef([["StatA", "Artifact", 10]]) };
    const hosts = () => [
      slot("Ring", [host("H1", "Ring", [], ["Colorless"])]),
      slot("Necklace", [host("H2", "Necklace", [], ["Colorless"])]),
      slot("Trinket", [host("H3", "Trinket", [], ["Colorless"])]),
    ];
    // Same bucket (StatA||Artifact): a worn Artifact +6 must NOT stack with the set's
    // Artifact +10 — only the highest counts.
    const collapse = {
      targets: ["StatA"], mlCap: 34, dodgeCap: null, augment_set_defs: def,
      worn: [...hosts(), slot("Gloves", [item("W", "Gloves", [["StatA", "Artifact", 6]])])],
    };
    const rc = await S.solveLexicographic(collapse, highs);
    assert.strictEqual(rc.effective.StatA, 10, "same bucket: max(10 set, 6 worn) = 10, not 16");
    // Distinct type (Enhancement) still stacks with the set's Artifact bonus.
    const stack = {
      targets: ["StatA"], mlCap: 34, dodgeCap: null, augment_set_defs: def,
      worn: [...hosts(), slot("Gloves", [item("W", "Gloves", [["StatA", "Enhancement", 6]])])],
    };
    const rs = await S.solveLexicographic(stack, highs);
    assert.strictEqual(rs.effective.StatA, 16, "distinct types stack: 10 Artifact + 6 Enhancement");
  });

  // U4 — Suppression: slotting a Set Augment into a host item "overrides its Set
  // Bonus" (DDO wiki). The host's OWN intrinsic named set(s) are suppressed while a
  // copy sits in one of its Colorless slots. Modeled linearly: a per-host binary
  // hosts_i (>= each copy y on i, clamped to 1) is subtracted from item i's intrinsic
  // (x_i) piece terms in every set S it belongs to. The augment-set's OWN tier is
  // built from y copies (never x_i), so it is naturally unaffected.
  // ---------------------------------------------------------------------------
  await test("U4 suppression: a set augment on an intrinsic member drops that member's own set bonus", async () => {
    const def = { "AugSet": augSetDef([["StatA", "Artifact", 10]]) };
    const S2 = [{ n: 2, affixes: [["StatS", "Set", 50]] }]; // SetS 2-piece bonus
    // P1 & P2 are BOTH SetS members AND Colorless hosts; H3 is a set-less host.
    // Maximizing StatA (ranked first) forces 3 copies onto P1,P2,H3 -> P1 & P2 each
    // host a copy -> their intrinsic SetS membership is suppressed -> SetS drops out.
    const model = {
      targets: ["StatA", "StatS"], mlCap: 34, dodgeCap: null, augment_set_defs: def,
      worn: [slot("Ring", [setHost("P1", "Ring", [], "SetS", S2, ["Colorless"])]),
             slot("Necklace", [setHost("P2", "Necklace", [], "SetS", S2, ["Colorless"])]),
             slot("Trinket", [host("H3", "Trinket", [], ["Colorless"])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.StatA, 10, "3 copies -> augment 3-piece fires");
    assert.strictEqual((r.setAugmentsPlaced || []).length, 3, "3 copies placed (on P1, P2, H3)");
    assert.strictEqual(r.effective.StatS, 0, "P1 & P2 each host a copy -> their own SetS is overridden (suppressed)");
  });

  await test("U4 suppression: a set augment on a SET-LESS host suppresses nothing (no spurious change)", async () => {
    const def = { "AugSet": augSetDef([["StatA", "Artifact", 10]]) };
    const S2 = [{ n: 2, affixes: [["StatS", "Set", 50]] }];
    // The 3 copies ride on set-less hosts; SetS members expose no Colorless slot, so
    // they host no copy and their bonus must remain fully intact.
    const model = {
      targets: ["StatA", "StatS"], mlCap: 34, dodgeCap: null, augment_set_defs: def,
      worn: [slot("Ring", [host("H1", "Ring", [], ["Colorless"])]),
             slot("Necklace", [host("H2", "Necklace", [], ["Colorless"])]),
             slot("Trinket", [host("H3", "Trinket", [], ["Colorless"])]),
             slot("Gloves", [setPiece("P1", "Gloves", [], "SetS", S2)]),
             slot("Boots", [setPiece("P2", "Boots", [], "SetS", S2)])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.StatA, 10, "3 set-less hosts carry the copies");
    assert.strictEqual(r.effective.StatS, 50, "SetS members host no copy -> bonus intact (no spurious suppression)");
  });

  await test("U4/R8: solver DECLINES to place a copy where it would suppress a HIGHER-ranked set", async () => {
    const def = { "AugSet": augSetDef([["StatA", "Artifact", 10]]) };
    const S2 = [{ n: 2, affixes: [["StatS", "Set", 50]] }];
    // Only 3 Colorless hosts exist and TWO of them (P1,P2) are the SetS members, so
    // the ONLY way to complete the augment set is to suppress SetS. With StatS ranked
    // ABOVE StatA, the staged lexicographic solve must keep SetS and forgo the augment
    // set entirely — no special rule, it emerges from suppression + priority ordering.
    const model = {
      targets: ["StatS", "StatA"], mlCap: 34, dodgeCap: null, augment_set_defs: def,
      worn: [slot("Ring", [setHost("P1", "Ring", [], "SetS", S2, ["Colorless"])]),
             slot("Necklace", [setHost("P2", "Necklace", [], "SetS", S2, ["Colorless"])]),
             slot("Trinket", [host("H3", "Trinket", [], ["Colorless"])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.StatS, 50, "higher-ranked SetS is kept");
    assert.strictEqual(r.effective.StatA, 0, "completing the augment set would suppress SetS -> declined");
    assert.strictEqual((r.setAugmentsPlaced || []).length, 0, "no copy placed (partial copies buy nothing; tie-break minimizes y)");
  });

  await test("U4: an item hosting MULTIPLE copies suppresses its own set exactly once (hosts_i clamped)", async () => {
    // The model creates one copy (y) per host per augment set, so "multiple copies on
    // one host" means copies of DIFFERENT set augments. Item i (2 Colorless slots) is a
    // SetS member AND hosts one AugA copy AND one AugB copy. hosts_i is a single clamped
    // binary >= each copy, so i's SetS membership is removed ONCE (not per copy), and the
    // multi-copy-single-host path stays feasible.
    const def = { "AugA": augSetDef([["StatA", "Artifact", 10]]),
                  "AugB": augSetDef([["StatB", "Artifact", 10]]) };
    const S2 = [{ n: 2, affixes: [["StatS", "Set", 50]] }];
    const model = {
      targets: ["StatA", "StatB", "StatS"], mlCap: 34, dodgeCap: null, augment_set_defs: def,
      worn: [slot("Ring", [setHost("i", "Ring", [], "SetS", S2, ["Colorless", "Colorless"])]),
             // AugA's other two hosts
             slot("Necklace", [host("A1", "Necklace", [], ["Colorless"])]),
             slot("Trinket", [host("A2", "Trinket", [], ["Colorless"])]),
             // AugB's other two hosts
             slot("Goggles", [host("B1", "Goggles", [], ["Colorless"])]),
             slot("Belt", [host("B2", "Belt", [], ["Colorless"])]),
             // the second SetS member (no Colorless -> not a host)
             slot("Gloves", [setPiece("P2", "Gloves", [], "SetS", S2)])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.StatA, 10, "AugA 3-piece fires (i, A1, A2)");
    assert.strictEqual(r.effective.StatB, 10, "AugB 3-piece fires (i, B1, B2)");
    assert.strictEqual((r.setAugmentsPlaced || []).length, 6, "6 copies placed; i hosts 2 of them");
    assert.strictEqual(r.effective.StatS, 0, "i hosts copies -> SetS suppressed once; P2 alone < 2 pieces");
  });

  // U5 — Dominance guard audit for the Set-Augment source family. The risk (three
  // recurrences documented in milp-encoding-for-gear-optimization.md): a pre-solve
  // dominanceFilter prunes items by their OWN affix buckets, so an item whose only
  // marginal worth is exposing a Colorless slot to HOST a needed set-augment copy
  // could be pruned before it can host one — making a 3-piece set unreachable.
  //
  // FINDING: dominates() is ALREADY safe for this family — no new guard needed.
  // "Exposes a Colorless slot" is not a new value dimension; it is augment-slot
  // capacity, which dominates() already accounts for via its augment-color multiset
  // check (variantAugColors -> the raw `augment_slots` list). For real-shaped data
  // (norm.colors is DERIVED from raw augment_slots at build time, src/colors.py),
  // "A dominates B" therefore implies A holds >= B's Colorless capacity, so A is
  // itself a viable host — B is never wrongly pruned. These tests pin that, per the
  // checklist's "prove it with a test" mandate, plus the objective-reads-the-tier
  // and ordinary-dominance-still-works audits. (dominanceFilter/dominates live in
  // model.js, out of this unit's edit scope; asserting them from here is deliberate.)
  //
  // A buildModel-ELIGIBLE worn item that mirrors REAL data: verified, ML in-band,
  // and — the load-bearing detail for this audit — raw `augment_slots` populated in
  // lockstep with augment_slots_norm.colors, so the dominance guard (reads raw) and
  // the solver's set-augment host check (reads norm) see the same Colorless capacity.
  function eligItem(id, slotName, affixes, colors) {
    return {
      variant_id: id, source_item: id, slot: slotName, category: "item",
      ml: 30, minimum_level: 30, verification: "verified",
      restrictions: "unknown", armor_type: null,
      affixes: (affixes || []).map(([stat, bt, v]) => ({ stat, bonus_type: bt, name: stat, type: bt, value: v, unit: "flat" })),
      scaling: [], set_bonus: [], parsed_set_bonuses: [],
      augment_slots: (colors || []).map((c) => `${c} Augment Slot`),        // raw (guard reads this)
      augment_slots_norm: { colors: colors || [], quarantined: [] },        // normalized (solver reads this)
    };
  }

  await test("U5: dominates() already treats a Colorless slot as a value dimension (no new guard needed)", async () => {
    const M = require("../web/model.js");
    const ts = new Set(["StatA", "StatB"]);
    const strong = eligItem("strong", "Trinket", [["StatB", "Enhancement", 5]], []);  // affix, NO Colorless slot
    const clHost = eligItem("clHost", "Trinket", [], ["Colorless"]);                  // value-less, exposes a Colorless slot
    const weak = eligItem("weak", "Trinket", [["StatB", "Enhancement", 1]], []);      // strictly worse, no slot
    // The whole point: an affix item that lacks a Colorless slot must NOT dominate a
    // value-less Colorless host, or a needed set-augment copy would lose its only host.
    assert.strictEqual(M.dominates(strong, clHost, ts, 34), false,
      "affix-without-slot must NOT dominate a value-less Colorless host (Colorless capacity is a value dimension)");
    // Ordinary dominance is untouched: the strong item still beats a genuinely worse no-slot peer.
    assert.strictEqual(M.dominates(strong, weak, ts, 34), true,
      "ordinary dominance still prunes a strictly-worse no-slot peer");
  });

  await test("U5: a value-less Colorless host needed to host a set-augment copy is NOT pruned (end-to-end)", async () => {
    // The set-augment 3-piece (StatA) is the top target; the ONLY way to reach 3
    // copies is to keep all three Colorless hosts — including one that is bucket-
    // dominated by its slot-mate and whose sole worth is its Colorless slot.
    const M = require("../web/model.js");
    const def = { "AugSet": augSetDef([["StatA", "Artifact", 30]]) };
    const query = { mlCap: 34, targets: ["StatA", "StatB"], targetCaps: {}, targetFloors: {} };
    const variants = [
      eligItem("N", "Necklace", [], ["Colorless"]),                       // dedicated host
      eligItem("C", "Cloak", [], ["Colorless"]),                          // dedicated host
      eligItem("Taffix", "Trinket", [["StatB", "Enhancement", 5]], []),   // bucket-dominates its slot-mate, NO slot
      eligItem("Thost", "Trinket", [], ["Colorless"]),                    // value-less, the 3rd (and only remaining) Colorless host
    ];
    const model = M.buildModel(variants, query);
    model.augment_set_defs = def;
    const trinket = model.worn.find((w) => w.slot === "Trinket");
    assert.ok(trinket && trinket.variants.some((v) => v.variant_id === "Thost"),
      "the value-less Colorless host survived dominanceFilter despite a bucket-dominating slot-mate");
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.StatA, 30,
      "3rd Colorless host kept -> 3 copies -> set-augment 3-piece completes end-to-end (objective reads the tier)");
    assert.strictEqual((r.setAugmentsPlaced || []).length, 3, "exactly 3 copies placed");
  });

  await test("U5: a full 3-piece set-augment build is reachable — every contested Colorless host survives", async () => {
    // All three set slots are contested by an affix rival that bucket-dominates the
    // value-less Colorless host. All three hosts must survive for the set to complete.
    const M = require("../web/model.js");
    const def = { "AugSet": augSetDef([["StatA", "Artifact", 30]]) };
    const query = { mlCap: 34, targets: ["StatA", "StatB"], targetCaps: {}, targetFloors: {} };
    const slots = ["Necklace", "Cloak", "Trinket"];
    const variants = [];
    for (const s of slots) {
      variants.push(eligItem(`${s}_affix`, s, [["StatB", "Enhancement", 5]], []));  // affix, no slot
      variants.push(eligItem(`${s}_host`, s, [], ["Colorless"]));                   // value-less Colorless host
    }
    const model = M.buildModel(variants, query);
    model.augment_set_defs = def;
    for (const s of slots) {
      const w = model.worn.find((x) => x.slot === s);
      assert.ok(w && w.variants.some((v) => v.variant_id === `${s}_host`),
        `${s}'s Colorless host survived the pre-filter (mutually non-dominating with its affix rival)`);
    }
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.StatA, 30, "3 hosts kept across contested slots -> the 3-piece set is reachable");
    assert.strictEqual((r.setAugmentsPlaced || []).length, 3, "exactly 3 copies placed");
  });

  await test("U5 (regression): ordinary dominance still prunes a genuinely dominated item with no hosting value", async () => {
    // Neither candidate exposes a Colorless slot; one is strictly better. The worse
    // one has no set-augment-hosting value, so it must still be pruned (no over-guard).
    const M = require("../web/model.js");
    const query = { mlCap: 34, targets: ["StatB"], targetCaps: {}, targetFloors: {} };
    const variants = [
      eligItem("G_strong", "Goggles", [["StatB", "Enhancement", 10]], []),
      eligItem("G_weak", "Goggles", [["StatB", "Enhancement", 5]], []),  // strictly worse, no slot
    ];
    const model = M.buildModel(variants, query);
    const g = model.worn.find((w) => w.slot === "Goggles");
    assert.strictEqual(g.variants.length, 1, "the strictly-worse no-slot item is pruned by ordinary dominance");
    assert.strictEqual(g.variants[0].variant_id, "G_strong", "the dominator is the survivor");
  });

  // -------------------------------------------------------------------------
  // U5 (plan 2026-08-05-001, #140) — boolean composites carry a wiki-verified
  // magnitude that is now written onto the item. Evidence:
  // docs/wiki-evidence/boolean-composites.md
  // -------------------------------------------------------------------------

  await test("U5: a Blurry item now contributes Concealment where it scored zero before", async () => {
    const { normalizeItem } = require("../web/dataset.js");
    const carrier = item("BLUR", "Cloak", []);
    carrier.affixes = [{ name: "Blurry", type: "Bool", value: 1 }];
    normalizeItem(carrier);
    const model = {
      targets: ["Concealment"], mlCap: 34, dodgeCap: null,
      worn: [slot("Cloak", [carrier])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.Concealment, 20, "the wiki-stated 20% is scored");
  });

  await test("U5: two concealment composites take the MAX, not the sum (wiki stacking rule)", async () => {
    const { normalizeItem } = require("../web/dataset.js");
    const a = item("BLUR", "Cloak", []);
    a.affixes = [{ name: "Blurry", type: "Bool", value: 1 }];
    const b = item("LD", "Goggles", []);
    b.affixes = [{ name: "Lesser Displacement", type: "Bool", value: 1 }];
    normalizeItem(a); normalizeItem(b);
    const model = {
      targets: ["Concealment"], mlCap: 34, dodgeCap: null,
      worn: [slot("Cloak", [a]), slot("Goggles", [b])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.Concealment, 25, "same bonus type buckets to max(20,25), never 45");
  });

  await test("U5: Crown of Summer contributes all three verified components", async () => {
    const { normalizeItem } = require("../web/dataset.js");
    const helm = item("COS", "Helmet", []);
    helm.affixes = [{ name: "Crown of Summer", type: "Bool", value: 1 }];
    normalizeItem(helm);
    const model = {
      targets: ["Healing Amplification", "Melee Power", "Ranged Power"], mlCap: 34, dodgeCap: null,
      worn: [slot("Helmet", [helm])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective["Healing Amplification"], 15);
    assert.strictEqual(r.effective["Melee Power"], 10);
    assert.strictEqual(r.effective["Ranged Power"], 5);
  });

  await test("U5/KTD4b: a solve ranking no written component is unchanged (no-regression)", async () => {
    const { normalizeItem } = require("../web/dataset.js");
    // Same two items, solved for a stat the decomposition never touches. Adding
    // affixes to an item must not perturb a solve that does not target them —
    // buckets are only built for targetSet stats.
    const mk = () => {
      const a = item("BLUR", "Cloak", [["Constitution", "Enhancement", 8]]);
      a.affixes.push({ name: "Blurry", type: "Bool", value: 1 });
      const b = item("PLAIN", "Cloak", [["Constitution", "Enhancement", 6]]);
      return [a, b];
    };
    const withComposite = mk(); withComposite.forEach(normalizeItem);
    const model = {
      targets: ["Constitution"], mlCap: 34, dodgeCap: null,
      worn: [slot("Cloak", withComposite)],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.Constitution, 8, "the Constitution answer is untouched by U5");
  });

  await test("U5: Greater Heroism stays QUARANTINED — no components written", async () => {
    const { normalizeItem } = require("../web/dataset.js");
    const it = { affixes: [{ name: "Greater Heroism", type: "Bool", value: 1 }] };
    normalizeItem(it);
    assert.deepStrictEqual(it.affixes.map((a) => a.name), ["Greater Heroism"],
      "the wiki states a magnitude for the SPELL, not the item enchantment");
  });

  // ---- plan 003 U2 — the reported bug, end to end on the real HiGHS engine ----

  await test("U2/003 (R3/AE1): a declared build takes a WEAPON off-hand where it used to take a shield", async () => {
    const M = require("../web/model.js");
    // The reported shape: the shield genuinely out-values the second weapon on the
    // ranked stat. That is why "let one-handed weapons compete on merit" would NOT
    // have fixed this — the solver has no weapon-versus-shield value model, so the
    // shield wins on stats every time and the bug survives the fix.
    const mk = () => {
      const sword = item("Longsword", "Main Hand", [["Constitution", "Enhancement", 8]]);
      sword.category = "weapon"; sword.type = "Long Swords"; sword.verification = "verified"; sword.ml = 20;
      // Distinct ranked stats, so single-cardinality dominance keeps BOTH weapons in
      // the pool — otherwise the surviving one would be the only candidate for both
      // hands and the mutex would leave the off hand empty for the wrong reason.
      const offSword = item("Shortsword", "Main Hand", [["Dexterity", "Enhancement", 7]]);
      offSword.category = "weapon"; offSword.type = "Short Swords"; offSword.verification = "verified"; offSword.ml = 20;
      const shield = item("Tower Shield", "Off Hand", [["Constitution", "Enhancement", 25]]);
      shield.type = "Tower shields"; shield.verification = "verified"; shield.ml = 20;
      return [sword, offSword, shield];
    };
    const q = (extra) => Object.assign({ mlCap: 34, targets: ["Constitution", "Dexterity"], style: "one-hand" }, extra);
    const offHandOf = (r) => (r.chosen.find((c) => c.slot === "Off Hand") || {}).variant;

    // BEFORE the declaration: the shield wins the off hand. This is the reported bug.
    const before = await S.solveLexicographic(M.buildModel(mk(), q({})), highs);
    assert.strictEqual(offHandOf(before).source_item, "Tower Shield",
      "undeclared: the shield still wins the off hand, exactly as today");

    // AFTER declaring: the off hand holds a one-handed weapon instead.
    const after = await S.solveLexicographic(M.buildModel(mk(), q({ twoWeaponFighting: true })), highs);
    const off = offHandOf(after);
    assert.ok(off, "a declared build still fills the off hand");
    assert.strictEqual(off.category, "weapon", "a declared build's off hand holds a WEAPON");
    // …and the hand mutex still stops one item filling both hands.
    const main = (after.chosen.find((c) => c.slot === "Main Hand") || {}).variant;
    assert.notStrictEqual(main.variant_id, off.variant_id, "the same weapon cannot fill both hands");
  });

  await test("U2/003 (R8): a pinned shield still equips on a declared build", async () => {
    const M = require("../web/model.js");
    const sword = item("Longsword", "Main Hand", [["Constitution", "Enhancement", 8]]);
    sword.category = "weapon"; sword.type = "Long Swords"; sword.verification = "verified"; sword.ml = 20;
    const offSword = item("Shortsword", "Main Hand", [["Dexterity", "Enhancement", 7]]);
    offSword.category = "weapon"; offSword.type = "Short Swords"; offSword.verification = "verified"; offSword.ml = 20;
    const shield = item("Tower Shield", "Off Hand", [["Constitution", "Enhancement", 25]]);
    shield.type = "Tower shields"; shield.verification = "verified"; shield.ml = 20;
    const model = M.buildModel([sword, offSword, shield],
      { mlCap: 34, targets: ["Constitution", "Dexterity"], style: "one-hand", twoWeaponFighting: true,
        slotConstraints: { "Off Hand": { type: "pin", variant_id: "Tower Shield" } } });
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal", "the pin does not make the query unsolvable");
    assert.strictEqual((r.chosen.find((c) => c.slot === "Off Hand") || {}).variant.source_item, "Tower Shield",
      "the player's pin overrides the exclusion");
  });

  // --- #169 U5: the wiki's cross-affix non-stacking note, against SHIPPED data ---
  // The Heightened Awareness page states: "Does not stack with the insight bonus
  // to AC provided by the parrying suffix." Nothing implements that rule. Both
  // affixes now emit Armor Class typed Insight, and the bucket-max core caps each
  // (stat, bonus_type) bucket at one contributor, so it enforces itself. This
  // pins that: retyping either affix would silently restore double-counting, and
  // the six golden fixtures cannot catch it because none of them ranks Armor Class.
  await test("#169: Parrying and Heightened Awareness Insight AC take the max, not the sum", async () => {
    const fs = require("fs");
    const dsPath = path.join(__dirname, "..", "web", "data", "items.json");
    if (!fs.existsSync(dsPath)) return console.log("    (skipped — dataset not built)");
    const data = normalizeDataset(JSON.parse(fs.readFileSync(dsPath, "utf8")));

    // Admiral's Cummerbund (Belt) carries Parrying +2; Crown of Bone (Helmet)
    // carries Heightened Awareness 6. Both are Insight AC after the expansion.
    const pick = (name) => {
      const v = data.items.find((i) => i.source_item === name);
      assert.ok(v, `${name} must be in the built dataset`);
      const ac = (v.affixes || []).find((a) => a.name === "Armor Class" && a.type === "Insight");
      assert.ok(ac, `${name} must carry an Insight Armor Class after the expansion`);
      return { v, ac };
    };
    const parry = pick("Admiral's Cummerbund");
    const aware = pick("Crown of Bone");
    assert.strictEqual(Number(parry.ac.value), 2);
    assert.strictEqual(Number(aware.ac.value), 6);

    const model = {
      targets: ["Armor Class"], mlCap: 34, dodgeCap: null,
      worn: [slot("Belt", [parry.v]), slot("Helmet", [aware.v])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective["Armor Class"], 6,
      "max(2, 6) — the wiki says these do not stack; 8 would be the double-count");
  });

  await test("#169: Insight AC still stacks with a differently-typed Armor Class", async () => {
    // The other half. Suppressing on stat name alone would collapse these too,
    // withholding the fix from the 86 Parrying items carrying an Armor-typed AC.
    const model = {
      targets: ["Armor Class"], mlCap: 34, dodgeCap: null,
      worn: [slot("Belt", [item("P", "Belt", [["Armor Class", "Insight", 2]])]),
             slot("Armor", [item("A", "Armor", [["Armor Class", "Armor", 8]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective["Armor Class"], 10, "different buckets sum: 2 + 8");
  });

  // --- U1 (#171-adjacent, declared stat credits) --------------------------------
  // A credit is a contribution with an EMPTY gate list. Everything here rides on
  // the existing one-contributor-per-bucket cap, except the last three, which
  // pin the free-binary defect: with no gates, nothing forces z_credit to 1, so
  // on a tieBreak:false path it can settle at 0 and the reported total silently
  // omits a bonus the player unconditionally holds.

  const credit = (stat, bonus_type, value) => ({ stat, bonus_type, value });

  await test("U1: Covers AE1. a credit displaces weaker same-bucket gear", async () => {
    const model = {
      targets: ["CM", "KI"], mlCap: 34, dodgeCap: null,
      credits: [credit("CM", "Insight", 7)],
      worn: [
        slot("Ring", [item("cmWeak", "Ring", [["CM", "Insight", 5]])]),
        slot("Necklace", [item("kiX", "Necklace", [["KI", "Enhancement", 10]])]),
      ],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.CM, 7, "the bucket resolves to the credit, not the item");
    assert.ok(!r.chosen.some((c) => c.variant.variant_id === "cmWeak"), "the beaten item is not equipped");
    assert.strictEqual(r.effective.KI, 10, "the freed slot serves the next priority");
  });

  await test("U1: Covers AE2. stronger gear still wins its bucket", async () => {
    const model = {
      targets: ["CM"], mlCap: 34, dodgeCap: null,
      credits: [credit("CM", "Insight", 7)],
      worn: [slot("Ring", [item("cmStrong", "Ring", [["CM", "Insight", 9]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.CM, 9, "max-of-type, not the credit");
    assert.ok(r.chosen.some((c) => c.variant.variant_id === "cmStrong"), "the stronger item is equipped");
  });

  await test("U1: Covers AE4. a credit stacks across buckets, never within one", async () => {
    const model = {
      targets: ["CM"], mlCap: 34, dodgeCap: null,
      credits: [credit("CM", "Insight", 7)],
      worn: [slot("Ring", [item("cmEnh", "Ring", [["CM", "Enhancement", 5]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.CM, 12, "Insight 7 + Enhancement 5 occupy different buckets");
  });

  await test("U1: a credit equal to its gear does not double the bucket", async () => {
    const model = {
      targets: ["CM"], mlCap: 34, dodgeCap: null,
      credits: [credit("CM", "Insight", 7)],
      worn: [slot("Ring", [item("cmEqual", "Ring", [["CM", "Insight", 7]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.CM, 7, "one contributor per bucket, counted once");
  });

  await test("U1: two credits on one stat in different buckets both contribute", async () => {
    const model = {
      targets: ["CM"], mlCap: 34, dodgeCap: null,
      credits: [credit("CM", "Insight", 7), credit("CM", "Sacred", 4)],
      worn: [slot("Ring", [item("none", "Ring", [["KI", "Enhancement", 1]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.CM, 11, "distinct bonus types stack");
  });

  await test("U1: a stacking-equivalent bonus type competes rather than stacks", async () => {
    const M = require("../web/model.js");
    M.setStackEquiv({ Insightful: "Insight" });
    try {
      const model = {
        targets: ["CM"], mlCap: 34, dodgeCap: null,
        credits: [credit("CM", "Insight", 7)],
        worn: [slot("Ring", [item("cmEquiv", "Ring", [["CM", "Insightful", 5]])])],
      };
      const r = await S.solveLexicographic(model, highs);
      assert.strictEqual(r.effective.CM, 7, "the equivalence table collapses both into one bucket");
    } finally {
      M.setStackEquiv({});
    }
  });

  await test("U1: Covers R3. no declared credits leaves the solve unchanged", async () => {
    const base = () => ({
      targets: ["CM", "KI"], mlCap: 34, dodgeCap: null,
      worn: [
        slot("Ring", [item("cmA", "Ring", [["CM", "Insight", 5]])]),
        slot("Necklace", [item("kiX", "Necklace", [["KI", "Enhancement", 10]])]),
      ],
    });
    const without = await S.solveLexicographic(base(), highs);
    const empty = await S.solveLexicographic({ ...base(), credits: [] }, highs);
    assert.deepStrictEqual(empty.effective, without.effective, "an empty credit list changes nothing");
    assert.deepStrictEqual(
      empty.chosen.map((c) => c.variant.variant_id).sort(),
      without.chosen.map((c) => c.variant.variant_id).sort(),
      "the same items are equipped");
    assert.strictEqual(without.effective.CM, 5, "and the pre-feature answer is unchanged");
  });

  await test("U1: a credited stat holds its floor with the tie-break disabled", async () => {
    // The free-binary defect's home. With tieBreak:false and a relaxed lock, a
    // credit that is not the gain objective carries no objective coefficient, so
    // nothing pulls its z to 1 unless a constraint does.
    const model = {
      targets: ["CM", "KI"], mlCap: 34, dodgeCap: null,
      credits: [credit("CM", "Insight", 7)],
      worn: [
        slot("Ring", [item("cmWeak", "Ring", [["CM", "Insight", 5]])]),
        slot("Necklace", [item("kiX", "Necklace", [["KI", "Enhancement", 10]])]),
      ],
    };
    const program = S.buildProgram(model);
    // Mirrors the alternatives call shape: maximize a DIFFERENT stat while holding
    // the credited one only within a give. Nothing then rewards z_credit.
    const r = S.solveConstrained(program, highs, {
      objectiveStat: "KI", sense: "max", tieBreak: false,
      locks: [{ stat: "CM", value: 7, give: 7 }],
    });
    assert.strictEqual(r.status, "optimal");
    assert.ok(r.effective.CM >= 7,
      `a credited stat must never report below its credit; got ${r.effective.CM}`);
  });

  await test("U1: every alternative loadout reports the credited stat at or above its credit", async () => {
    // The credited stat must rank BELOW the maximized one. `rebalance` locks only
    // `targets.slice(0, j)` and maximizes target j, so a credited stat after j is
    // neither locked nor rewarded — the one place z_credit is genuinely free. The
    // set-activation family does not expose it: setGive(7) is 4, so its lock
    // (CM >= 3) already forces z_credit to 1.
    // The necklace trade has to fit inside alternativeGive (10% of the leader) or
    // rebalance proves infeasible and produces nothing: Con 22 -> give 2 -> the
    // Con-2 necklace can be swapped for the KI-8 one and still clear Con >= 20.
    const model = {
      targets: ["Con", "KI", "CM"], mlCap: 34, dodgeCap: null,
      credits: [credit("CM", "Insight", 7)],
      worn: [
        slot("Ring", [item("conR", "Ring", [["Con", "Enhancement", 20]])]),
        slot("Necklace", [
          // Insight-typed so it STACKS with the ring's Enhancement Con — a
          // same-bucket duplicate would add nothing and the optimum would already
          // have taken the trade, leaving rebalance no candidate to produce.
          item("conN", "Necklace", [["Con", "Insight", 2]]),
          item("kiN", "Necklace", [["KI", "Enhancement", 8]]),
        ]),
      ],
      augments: [],
    };
    const optimum = await S.solveLexicographic(model, highs);
    assert.strictEqual(optimum.effective.CM, 7, "the optimum credits CM");
    const alts = await S.generateAlternatives(optimum, model, highs);
    assert.ok(Array.isArray(alts) && alts.length, "the generators produced alternatives to check");
    for (const alt of alts) {
      const eff = (alt.sol && alt.sol.effective) || {};
      assert.ok((eff.CM || 0) >= 7,
        `the ${alt.gainAxis} alternative reported CM=${eff.CM}, below the declared 7`);
    }
  });

  await test("U1: a stronger AUGMENT in the credited bucket still wins", async () => {
    // Regression: the credit lower bound was emitted before augments/sets/crafting
    // joined zByBucket, so it summed only the worn+credit subset while the bucket
    // cap covered everything. Choosing the augment drove the constrained subset to
    // zero and violated the bound, forcing the solver onto the weaker credit —
    // CM resolved to 7 against an Insight-10 augment, breaking R5. The constraint
    // is now emitted after every push. Worn-only tests cannot catch this.
    const model = {
      targets: ["CM"], mlCap: 34, dodgeCap: null,
      credits: [credit("CM", "Insight", 7)],
      worn: [slot("Ring", [host("ringHost", "Ring", [], ["Colorless"])])],
      augments: [augment("augCM", "Colorless", [["CM", "Insight", 10]])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.CM, 10, "the augment beats the credit and must be used");
    assert.ok(r.chosen.some((c) => c.variant.variant_id === "ringHost"), "its host is equipped");
  });

  await test("U1: a weaker augment in the credited bucket does not drag the total down", async () => {
    const model = {
      targets: ["CM"], mlCap: 34, dodgeCap: null,
      credits: [credit("CM", "Insight", 7)],
      worn: [slot("Ring", [host("ringHost", "Ring", [], ["Colorless"])])],
      augments: [augment("augWeak", "Colorless", [["CM", "Insight", 3]])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.CM, 7, "the credit still holds the bucket");
  });

  await test("U1: a stronger SET-TIER bonus in the credited bucket still wins", async () => {
    // The same ordering trap on a different late-pushed channel.
    const tier = [{ n: 2, affixes: [["CM", "Insight", 11]] }];
    const model = {
      targets: ["CM"], mlCap: 34, dodgeCap: null,
      credits: [credit("CM", "Insight", 7)],
      worn: [
        slot("Ring", [setPiece("rA", "Ring", [], "Alpha", tier)]),
        slot("Necklace", [setPiece("nA", "Necklace", [], "Alpha", tier)]),
      ],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.CM, 11, "the completed set tier beats the credit");
  });

  await test("U1: a credit on a bucketed-but-untargeted stat never contributes silently", async () => {
    // targetList is model.targets, NOT the widened targetSet, so a credit on a
    // stat that is bucketed but not a target would not surface in `effective`.
    // It must either be reported or be provably absent — never counted invisibly.
    const model = {
      targets: ["KI"], mlCap: 34, dodgeCap: null,
      credits: [credit("CM", "Insight", 7)],
      worn: [slot("Ring", [item("kiX", "Ring", [["KI", "Enhancement", 10]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.KI, 10, "the targeted stat is unaffected");
    const cm = r.effective.CM;
    assert.ok(cm === undefined || cm === 7,
      `an untargeted credit must be absent or fully reported, got ${cm}`);
  });


  // ---- U4 — floor participation and credit-aware disclosure (R7, R9, R10) -----

  await test("U4: Covers AE3. a credit satisfies part of a floor", async () => {
    // The credit's Insight 7 plus a different-bucket Enhancement 5 clears a floor
    // of 10; Insight gear could not have closed the gap, because the credit holds
    // that bucket.
    const model = {
      targets: ["CM"], mlCap: 34, dodgeCap: null,
      credits: [credit("CM", "Insight", 7)],
      floors: { CM: 10 },
      worn: [slot("Ring", [item("enh", "Ring", [["CM", "Enhancement", 5]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.CM, 12, "7 + 5 across two buckets");
    assert.deepStrictEqual(r.floorReport, [], "the floor is met, so it is not reported unmet");
  });

  await test("U4: a floor a credit counts toward reports the loadout's gear contribution", async () => {
    const model = {
      targets: ["CM"], mlCap: 34, dodgeCap: null,
      credits: [credit("CM", "Insight", 7)],
      floors: { CM: 10 },
      worn: [slot("Ring", [item("enh", "Ring", [["CM", "Enhancement", 5]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    const entry = (r.creditReport || []).find((c) => c.stat === "CM");
    assert.ok(entry, "the credit is reported");
    assert.strictEqual(entry.value, 7);
    assert.strictEqual(entry.bonus_type, "Insight");
    assert.strictEqual(entry.floor, 10, "the floor it helped meet");
    assert.strictEqual(entry.gearInLoadout, 5,
      "the gear in THIS loadout supplies 5 — an attribution the data supports, not a counterfactual");
  });

  await test("U4: a credit that lost its bucket claims no floor", async () => {
    const model = {
      targets: ["CM"], mlCap: 34, dodgeCap: null,
      credits: [credit("CM", "Insight", 2)],
      floors: { CM: 5 },
      worn: [slot("Ring", [item("ins", "Ring", [["CM", "Insight", 9]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    const entry = (r.creditReport || []).find((c) => c.stat === "CM");
    assert.ok(entry, "the credit is still reported as present");
    assert.strictEqual(entry.won, false, "the Insight 9 gear beat the declared 2");
    assert.strictEqual(entry.floor, null, "a credit that contributes nothing counts toward no floor");
  });

  await test("U4: a floor still unmet with a credit reports unmet, credit counted", async () => {
    const model = {
      targets: ["CM"], mlCap: 34, dodgeCap: null,
      credits: [credit("CM", "Insight", 7)],
      floors: { CM: 99 },
      worn: [slot("Ring", [item("enh", "Ring", [["CM", "Enhancement", 5]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    const unmet = r.floorReport.find((f) => f.stat === "CM");
    assert.ok(unmet, "still reported unmet");
    assert.strictEqual(unmet.achieved, 12, "and what WAS achieved includes the credit");
  });

  await test("U4: Covers R10 (narrowed). the report names the best gear the credit beat", async () => {
    const model = {
      targets: ["CM"], mlCap: 34, dodgeCap: null,
      credits: [credit("CM", "Insight", 7)],
      worn: [slot("Ring", [item("weak", "Ring", [["CM", "Insight", 5]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    const entry = (r.creditReport || []).find((c) => c.stat === "CM");
    assert.ok(entry, "the credit is reported");
    assert.strictEqual(entry.beatGear, 5,
      "the best eligible gear in that bucket, which the credit displaced");
  });

  await test("U4: a credit that lost its bucket reports no displacement", async () => {
    const model = {
      targets: ["CM"], mlCap: 34, dodgeCap: null,
      credits: [credit("CM", "Insight", 4)],
      worn: [slot("Ring", [item("strong", "Ring", [["CM", "Insight", 9]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    const entry = (r.creditReport || []).find((c) => c.stat === "CM");
    assert.ok(entry, "still reported");
    assert.strictEqual(entry.beatGear, null, "it beat nothing — the gear won the bucket");
    assert.strictEqual(entry.won, false);
  });

  await test("U4: creditReport is plain JSON with no reference to the program", async () => {
    // KTD6 — a restored character is displayed WITHOUT re-solving, and `program` is
    // excluded from the saved snapshot as cyclic and non-JSON. A notice that read
    // program at render time would vanish on load.
    const r = await S.solveLexicographic(creditModelU4(), highs);
    const round = JSON.parse(JSON.stringify(r.creditReport));
    assert.deepStrictEqual(round, r.creditReport, "survives a stringify round-trip unchanged");
    assert.ok(!JSON.stringify(r.creditReport).includes("zByBucket"));
  });

  await test("U4: no credits declared means no creditReport entries", async () => {
    const model = {
      targets: ["CM"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [item("enh", "Ring", [["CM", "Enhancement", 5]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.ok(Array.isArray(r.creditReport), "the field is always present, so its absence cannot pass for empty");
    assert.deepStrictEqual(r.creditReport, [], "R3 — nothing added when nothing is declared");
  });

  function creditModelU4() {
    return {
      targets: ["CM"], mlCap: 34, dodgeCap: null,
      credits: [credit("CM", "Insight", 7)],
      floors: { CM: 10 },
      worn: [slot("Ring", [item("enh", "Ring", [["CM", "Enhancement", 5]])])],
    };
  }


  // --- U4 review findings: the arithmetic must survive its own counterexamples ---

  await test("U4: gearInLoadout never sums picks that compete for one slot", async () => {
    // Reported 11 (an Insight 6 plus an Enhancement 5) for a player who owns ONE
    // ring slot. Reading the credit's own bucket as "best present" while reading
    // every other bucket as "best selected" mixed a hypothetical with an actual.
    const model = {
      targets: ["CM"], mlCap: 34, dodgeCap: null, floors: { CM: 12 },
      credits: [credit("CM", "Insight", 7)],
      worn: [slot("Ring", [item("ins", "Ring", [["CM", "Insight", 6]]),
                           item("enh", "Ring", [["CM", "Enhancement", 5]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    const e = r.creditReport[0];
    assert.strictEqual(e.gearInLoadout, 5, "one slot supplies one contribution");
    assert.ok(e.gearInLoadout <= r.effective.CM,
      "the gear figure can never exceed the total it is a part of");
  });

  await test("U4: gearInLoadout matches the gear actually in the shown loadout", async () => {
    // Ground truth. A3 forbids a counterfactual solve at RUNTIME; a test may run
    // one, and this is the check that would have caught the false floor claim.
    const base = () => ({
      targets: ["Dodge", "CM"], mlCap: 34, dodgeCap: null, floors: { CM: 10 },
      worn: [slot("Ring", [item("a", "Ring", [["CM", "Enhancement", 5], ["Dodge", "Enhancement", 3]]),
                           item("b", "Ring", [["CM", "Enhancement", 12]])])],
    });
    const withC = await S.solveLexicographic({ ...base(), credits: [credit("CM", "Insight", 7)] }, highs);
    const e = withC.creditReport[0];
    // The claim is about THIS loadout, so it must equal this loadout's gear sum.
    const gearSum = withC.breakdown.CM.filter((p) => p.sourceKind !== "declared")
      .reduce((n, p) => n + p.value, 0);
    assert.strictEqual(e.gearInLoadout, gearSum,
      "the reported figure is the shown loadout's gear, verifiable from its own breakdown");

    // And the number must NOT be read as "what gear alone would reach" — a
    // credit-free solve of the same inputs reaches more, by picking differently.
    const without = await S.solveLexicographic(base(), highs);
    assert.ok(without.effective.CM > e.gearInLoadout,
      `premise of the fix: a credit-free solve reaches ${without.effective.CM}, not ${e.gearInLoadout} — ` +
      "which is why the sentence must not claim to describe it");
  });

  await test("U4: beatGear ignores gear the player locked out of the build", async () => {
    const model = {
      targets: ["CM"], mlCap: 34, dodgeCap: null,
      credits: [credit("CM", "Insight", 7)],
      query: { slotConstraints: { Ring: { type: "empty" } } },
      worn: [slot("Ring", [item("ins", "Ring", [["CM", "Insight", 6]])]),
             slot("Gloves", [item("g", "Gloves", [["CM", "Enhancement", 5]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.creditReport[0].beatGear, null,
      "an item in a slot the player emptied is not gear the credit beat");
    assert.ok(!r.chosen.some((c) => c.slot === "Ring"), "premise: the ring slot is empty");
  });

  await test("U4: two credits on one stat report one floor between them", async () => {
    const model = {
      targets: ["CM"], mlCap: 34, dodgeCap: null, floors: { CM: 10 },
      credits: [credit("CM", "Insight", 7), credit("CM", "Profane", 4)],
      worn: [slot("Ring", [item("enh", "Ring", [["CM", "Enhancement", 2]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.creditReport.length, 2, "both are reported");
    const Proj = require("../web/projection.js");
    const floorLines = Proj.creditNoticeLines(r).filter((l) => /Your floor of/.test(l));
    assert.strictEqual(floorLines.length, 1,
      `one floor, one sentence — two would each read as a sufficient explanation: ${JSON.stringify(floorLines)}`);
    assert.ok(/7 Insight and 4 Profane/.test(floorLines[0]), "and it names both declarations");
  });

  // ---- #239 U1: the saturation report -------------------------------------
  //
  // A ranked stat is "saturated" when every bonus-type bucket carrying it in the
  // live pool is filled at that bucket's best reachable value. Priority 1 is at
  // its global maximum on EVERY solve (stage 1 maximizes it), so saturation alone
  // would fire constantly and read as noise. KTD3 gates the report on the pool
  // still holding UNUSED sources for the stat — the case where a player has an
  // actual reason to expect more gear to help. The negative tests below are the
  // load-bearing half: an ungated report passes the positive test just as well.
  const sat = (r, stat) => (r.saturationReport || []).find((e) => e.stat === stat);

  await test("U1/#239: a stat whose buckets are full with sources left over is reported", async () => {
    const model = {
      targets: ["KL"], mlCap: 34, dodgeCap: null,
      worn: [
        // Two Equipment sources, same bucket: only the best can ever count.
        slot("Goggles", [item("best-equip", "Goggles", [["KL", "Equipment", 24]]),
                         item("lesser-equip", "Goggles", [["KL", "Equipment", 20]])]),
        // A second, different bucket — adds to the first rather than competing.
        slot("Ring", [item("art", "Ring", [["KL", "Artifact", 6]])]),
      ],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.KL, 30, "premise: 24 Equipment + 6 Artifact across two buckets");
    const e = sat(r, "KL");
    assert.ok(e, "the stat is reported saturated");
    assert.deepStrictEqual(e.bonusTypes.slice().sort(), ["Artifact", "Equipment"],
      "both carrying bonus types are named");
    assert.strictEqual(e.unusedSources, 1, "the 20 Equipment source could never have helped");
    assert.strictEqual(e.total, 30);
  });

  await test("U1/#239: a stat with no unused sources is NOT reported, though it is maxed", async () => {
    const model = {
      targets: ["KL"], mlCap: 34, dodgeCap: null,
      worn: [slot("Goggles", [item("only", "Goggles", [["KL", "Equipment", 24]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.KL, 24, "premise: it IS at its ceiling");
    // Assert the field exists before asserting it is empty: "no entry" is
    // trivially true when the feature is absent, which is how an unfalsifiable
    // test passes against the pre-change tree and covers nothing.
    assert.ok(Array.isArray(r.saturationReport), "the report exists");
    assert.ok(!sat(r, "KL"),
      "nothing went unused, so the player has no reason to expect more — reporting it would be noise on every solve");
  });

  await test("U1/#239: a bucket left unfilled means the stat is not saturated", async () => {
    const model = {
      targets: ["KL"], mlCap: 34, dodgeCap: null,
      worn: [
        slot("Goggles", [item("equip", "Goggles", [["KL", "Equipment", 24]])]),
        // Two Artifact sources in ONE slot: the better one is taken, so the
        // bucket IS filled at its best. Add a competing higher-value source in a
        // slot the solve cannot also take, and the ceiling is not reached.
        slot("Ring", [item("art-lo", "Ring", [["KL", "Artifact", 6]]),
                      item("other", "Ring", [["Unranked", "Equipment", 99]])]),
      ],
    };
    const r = await S.solveLexicographic(model, highs);
    // Both buckets are filled at their reachable best here, and one Ring source
    // went unused — but it carries no KL, so it is not an unused KL source.
    assert.ok(Array.isArray(r.saturationReport), "the report exists");
    const e = sat(r, "KL");
    assert.ok(!e || e.unusedSources > 0,
      "an entry may only exist when a source carrying THIS stat went unused");
  });

  await test("U1/#239: an absent bonus type and an explicit Untyped stay separate buckets", async () => {
    const model = {
      targets: ["KL"], mlCap: 34, dodgeCap: null,
      worn: [
        slot("Goggles", [item("native", "Goggles", [["KL", null, 6]]),
                         item("native-lo", "Goggles", [["KL", null, 4]])]),
        slot("Ring", [item("aug", "Ring", [["KL", "Untyped", 4]])]),
      ],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.KL, 10,
      "6 + 4 — two buckets that SUM; collapsing them would read 6 and is the #235 revert");
    const e = sat(r, "KL");
    assert.ok(e, "saturated with the 4 native source unused");
    assert.strictEqual(e.bonusTypes.length, 2, "two distinct buckets are named");
    assert.ok(e.bonusTypes.includes("Untyped"), "the explicit Untyped bucket");
    assert.ok(e.bonusTypes.includes("untyped"),
      "the absent-type bucket renders as a word, never the literal string 'null'");
  });

  await test("U1/#239: a stat nothing in the pool carries produces no entry", async () => {
    const model = {
      targets: ["Absent"], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [item("r", "Ring", [["Other", "Equipment", 5]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.ok(Array.isArray(r.saturationReport), "the field is always present, so its absence cannot pass for empty");
    assert.ok(!sat(r, "Absent"), "the zero-source path owns this case, not saturation");
  });

  await test("U1/#239: saturationReport is plain JSON with no reference to the program", async () => {
    const model = {
      targets: ["KL"], mlCap: 34, dodgeCap: null,
      worn: [slot("Goggles", [item("a", "Goggles", [["KL", "Equipment", 24]]),
                              item("b", "Goggles", [["KL", "Equipment", 20]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    const round = JSON.parse(JSON.stringify(r.saturationReport));
    assert.deepStrictEqual(round, r.saturationReport, "survives a stringify round-trip unchanged");
    assert.ok(!JSON.stringify(r.saturationReport).includes("zByBucket"));
  });

  // ---- #239: the empty-slot report ----------------------------------------
  //
  // These drive a REAL solve. The first version of this feature counted
  // "tie-broken filler" picks and was tested against hand-built `chosen` arrays
  // containing filler items — a shape no solve produces. It passed every test
  // and returned 0 on the live dataset. `chosen` carries only slots where an
  // item contributes; the rest come back EMPTY, which is what a player with a
  // short priority list is actually looking at.

  await test("#239: worn slots the solve did not fill are reported empty", async () => {
    const model = {
      targets: ["KL"], mlCap: 34, dodgeCap: null,
      worn: [
        slot("Goggles", [item("g", "Goggles", [["KL", "Equipment", 24]])]),
        slot("Ring", [item("r", "Ring", [["Unranked", "Equipment", 9]])]),
        slot("Boots", [item("b", "Boots", [["Unranked", "Equipment", 9]])]),
      ],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.chosen.length, 1, "premise: only the contributing slot is filled");
    assert.strictEqual(r.emptySlots.count, 2, "the other two worn slots are empty");
    assert.deepStrictEqual(r.emptySlots.slots.slice().sort(), ["Boots", "Ring"]);
  });

  await test("#239: a fully-used loadout reports no empty slots", async () => {
    const model = {
      targets: ["KL"], mlCap: 34, dodgeCap: null,
      worn: [
        slot("Goggles", [item("g", "Goggles", [["KL", "Equipment", 24]])]),
        slot("Ring", [item("r", "Ring", [["KL", "Artifact", 6]])]),
      ],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.chosen.length, 2, "premise: both slots contribute");
    assert.strictEqual(r.emptySlots.count, 0);
  });

  await test("#239: a slot the player locked empty is not reported as empty", async () => {
    const model = {
      targets: ["KL"], mlCap: 34, dodgeCap: null,
      query: { slotConstraints: { Boots: { type: "empty" } } },
      worn: [
        slot("Goggles", [item("g", "Goggles", [["KL", "Equipment", 24]])]),
        slot("Boots", [item("b", "Boots", [["KL", "Equipment", 20]])]),
      ],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.emptySlots.count, 0,
      "the player chose that — reporting it back as 'nothing could improve your priorities' is wrong");
  });

  await test("#239: emptySlots is plain JSON", async () => {
    const model = {
      targets: ["KL"], mlCap: 34, dodgeCap: null,
      worn: [slot("Goggles", [item("g", "Goggles", [["KL", "Equipment", 24]])]),
             slot("Ring", [item("r", "Ring", [["Unranked", "Equipment", 9]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r.emptySlots)), r.emptySlots);
  });

  // ---- U6/#249: the compound-absorption quarantine report ------------------
  //
  // Quarantine is decided in Python against the seed shard, and neither the
  // solver nor the model receives dataset metadata — so the build stamps the
  // exclusion on the variant and the solver reads it back off `model.worn`.
  // Built here rather than at render time for the reason `saturationReport` is:
  // a restored character is never re-solved, so a render-time derivation from
  // the pool would go quiet on load.

  // A worn candidate the build excluded a compound absorption affix from.
  function quarantined(id, slotName, stat, reason, components) {
    const v = item(id, slotName, [["KL", "Equipment", 1]]);
    v.absorption_quarantined = [{ stat, reason, components }];
    return v;
  }
  const FIVE = ["Acid Absorption", "Cold Absorption", "Fire Absorption",
                "Electric Absorption", "Sonic Absorption"];

  await test("U6/#249: a quarantined carrier in the pool is reported when its stat is ranked", async () => {
    const model = {
      targets: ["Fire Absorption"], mlCap: 34, dodgeCap: null,
      worn: [
        slot("Goggles", [item("g", "Goggles", [["Fire Absorption", "Enhancement", 10]])]),
        slot("Helmet", [quarantined("Cyran Guard", "Helmet", "Elemental Absorption", "absent", FIVE)]),
      ],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.deepStrictEqual(r.absorptionQuarantine, [{
      item: "Cyran Guard", stat: "Elemental Absorption", reason: "absent", components: FIVE,
    }], "the exclusion is named with its reason");
  });

  await test("U6/#249: a quarantined carrier is silent when no component is ranked", async () => {
    // The saturation report's KTD3 rule: a disclosure that fires regardless of
    // what the player asked for is noise, and noise is how a real disclosure
    // stops being read. Nothing here bears on a Dodge build.
    const model = {
      targets: ["Dodge"], mlCap: 34, dodgeCap: null,
      worn: [
        slot("Goggles", [item("g", "Goggles", [["Dodge", "Enhancement", 10]])]),
        slot("Helmet", [quarantined("Cyran Guard", "Helmet", "Elemental Absorption", "absent", FIVE)]),
      ],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.deepStrictEqual(r.absorptionQuarantine, []);
  });

  await test("U6/#249: the report is present and empty when nothing was quarantined", async () => {
    const model = {
      targets: ["Fire Absorption"], mlCap: 34, dodgeCap: null,
      worn: [slot("Goggles", [item("g", "Goggles", [["Fire Absorption", "Enhancement", 10]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.ok(Array.isArray(r.absorptionQuarantine),
      "the field is always present, so its absence cannot pass for empty");
    assert.strictEqual(r.absorptionQuarantine.length, 0);
  });

  await test("U6/#249: a carrier offered in two slots is reported once", async () => {
    const model = {
      targets: ["Cold Absorption"], mlCap: 34, dodgeCap: null,
      worn: [
        slot("Ring", [quarantined("Twin Ward", "Ring", "Elemental Absorption", "unconfirmed", FIVE)], 2),
        slot("Helmet", [quarantined("Twin Ward", "Helmet", "Elemental Absorption", "unconfirmed", FIVE)]),
      ],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.absorptionQuarantine.length, 1,
      "one excluded affix is one disclosure, however many slots could host it");
  });

  await test("U6/#249: absorptionQuarantine is plain JSON", async () => {
    const model = {
      targets: ["Fire Absorption"], mlCap: 34, dodgeCap: null,
      worn: [slot("Helmet", [quarantined("Cyran Guard", "Helmet", "Elemental Absorption", "absent", FIVE)])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r.absorptionQuarantine)), r.absorptionQuarantine);
  });

  console.log(`\n${passed} passed`);
})();
