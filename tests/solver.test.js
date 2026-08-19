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
// U2 (#290/#291) — run `fn` with a cross-add map installed via model.js
// setCrossAdd (the load seam dataset.js drives), always resetting after so no
// test leaks a map into its neighbors.
const CAM = require("../web/model.js");
async function withCrossAdd(map, fn) {
  CAM.setCrossAdd(map);
  try { return await fn(); } finally { CAM.setCrossAdd({}); }
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

  // -------------------------------------------------------------------------
  // #91 (U3) — the Utility tier: a sentinel priority whose stage maximizes the
  // count of DISTINCT presence effects (the counting set) after every ranked
  // stat above it is locked, then locks that count into every later solve.
  // -------------------------------------------------------------------------
  const SENT = CAM.UTILITY_SENTINEL;
  const chosenIds = (r) => r.chosen.map((c) => `${c.slot}:${c.variant.variant_id}`).sort();

  await test("#91 U3/AE3: single-priority saturation — slots fill with utility gear, identical on re-run", async () => {
    // 'A' saturates on the Ring alone; the Necklace and Trinket carry only
    // presence effects. Tier-absent they'd stay empty; tier-present they fill.
    const mk = (targets) => ({
      targets, mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(["Ghost Touch", "Feather Falling"]),
      worn: [
        slot("Ring", [item("rA", "Ring", [["A", "Enhancement", 10]])]),
        slot("Necklace", [item("nGT", "Necklace", [["Ghost Touch", "Bool", 1]])]),
        slot("Trinket", [item("tFF", "Trinket", [["Feather Falling", "Bool", 1]])]),
      ],
    });
    const bare = await S.solveLexicographic(mk(["A"]), highs);
    assert.strictEqual(bare.chosen.length, 1, "tier-absent: only the A ring is equipped");
    const r = await S.solveLexicographic(mk(["A", SENT]), highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.A, 10, "the ranked stat is untouched");
    assert.strictEqual(r.utilityCount, 2, "both presence effects are collected");
    assert.deepStrictEqual(r.utilityEffects.map((e) => e.name).sort(), ["Feather Falling", "Ghost Touch"]);
    assert.strictEqual(r.chosen.length, 3, "the empty slots fill with utility gear");
    const again = await S.solveLexicographic(mk(["A", SENT]), highs);
    assert.deepStrictEqual(chosenIds(again), chosenIds(r), "re-run returns the identical loadout (R4)");
    assert.strictEqual(again.utilityCount, r.utilityCount);
  });

  await test("#91 U3: tier at bottom — every ranked stat matches the tier-absent solve exactly", async () => {
    // The lexicographic guarantee: a stat ranked ABOVE the tier never loses a
    // point to utility. hiA (A 10) must beat utilA (A 6 + Ghost Touch).
    const mk = (targets) => ({
      targets, mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(["Ghost Touch"]),
      worn: [slot("Trinket", [
        item("hiA", "Trinket", [["A", "Enhancement", 10]]),
        item("utilA", "Trinket", [["A", "Enhancement", 6], ["Ghost Touch", "Bool", 1]]),
      ])],
    });
    const bare = await S.solveLexicographic(mk(["A"]), highs);
    const r = await S.solveLexicographic(mk(["A", SENT]), highs);
    assert.strictEqual(r.effective.A, bare.effective.A, "A's value matches the tier-absent solve");
    assert.deepStrictEqual(chosenIds(r), chosenIds(bare), "the tier-absent winner keeps the slot");
    assert.strictEqual(r.utilityCount, 0, "no utility is reachable without surrendering a ranked point");
    assert.ok(!("perTargetUtility" in r) && !(SENT in (r.perTarget || {})), "the sentinel gets no perTarget entry");
    assert.ok(!(SENT in r.effective), "the sentinel gets no effective entry — it is not a stat");
  });

  await test("#91 U3/AE2: tier dragged above a low stat — utility wins the slot, stats above unchanged", async () => {
    const mk = (targets) => ({
      targets, mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(["Ghost Touch"]),
      worn: [
        slot("Ring", [item("rA", "Ring", [["A", "Enhancement", 10]])]),
        slot("Trinket", [
          item("tB", "Trinket", [["B", "Enhancement", 10]]),
          item("tU", "Trinket", [["B", "Enhancement", 6], ["Ghost Touch", "Bool", 1]]),
        ]),
      ],
    });
    const below = await S.solveLexicographic(mk(["A", "B", SENT]), highs);
    assert.strictEqual(below.effective.B, 10, "tier below B: B keeps its full value");
    assert.strictEqual(below.utilityCount, 0);
    const above = await S.solveLexicographic(mk(["A", SENT, "B"]), highs);
    assert.strictEqual(above.effective.A, 10, "the stat ABOVE the tier is unchanged");
    assert.strictEqual(above.utilityCount, 1, "the tier can now win the slot");
    assert.strictEqual(above.effective.B, 6, "B reports the cost its position now permits");
    assert.ok(above.chosen.some((c) => c.variant.variant_id === "tU"), "the utility carrier is equipped");
  });

  await test("#91 U3/AE4: two items sharing an effect — the distinct count increments once", async () => {
    // A locks both items in (Enhancement + Insight stack), so Ghost Touch is
    // present twice; the binary ceiling counts it once (R3).
    const model = {
      targets: ["A", SENT], mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(["Ghost Touch"]),
      worn: [
        slot("Ring", [item("rGT", "Ring", [["A", "Enhancement", 10], ["Ghost Touch", "Bool", 1]])]),
        slot("Necklace", [item("nGT", "Necklace", [["A", "Insight", 5], ["Ghost Touch", "Bool", 1]])]),
      ],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.A, 15, "both carriers equipped (stacking types)");
    assert.strictEqual(r.utilityCount, 1, "a duplicate effect adds zero");
    assert.deepStrictEqual(r.utilityEffects.map((e) => e.name), ["Ghost Touch"], "the receipt lists it once");
  });

  await test("#91 U3: an effect reachable only via an AUGMENT still counts (every-channel gate)", async () => {
    const model = {
      targets: [SENT], mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(["Ghost Touch"]),
      worn: [slot("Trinket", [host("H", "Trinket", [], ["Colorless"])])],
      augments: [augment("GTgem", "Colorless", [["Ghost Touch", "Bool", 1]])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.utilityCount, 1, "the augment-carried effect counts");
    assert.ok((r.augmentsPlaced || []).some((m) => m.variant_id === "GTgem"), "the carrier augment is placed and reported");
  });

  await test("#91 U3: an effect granted only by a SET TIER still counts (every-channel gate)", async () => {
    const model = {
      targets: [SENT], mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(["Ghost Touch"]),
      worn: [
        slot("Ring", [setPiece("p1", "Ring", [], "Spectral Pair", [{ n: 2, affixes: [["Ghost Touch", "Bool", 1]] }])]),
        slot("Necklace", [setPiece("p2", "Necklace", [], "Spectral Pair", [{ n: 2, affixes: [["Ghost Touch", "Bool", 1]] }])]),
      ],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.utilityCount, 1, "the tier-granted effect counts once the threshold fires");
    assert.ok((r.setsActive || []).some((m) => m.set === "Spectral Pair"), "the set is completed FOR the effect");
  });

  await test("#91 U3: a counting-set name absent from every variant mints no indicator, breaks nothing", async () => {
    const model = {
      targets: ["A", SENT], mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(["Utterly Absent Effect"]),
      worn: [slot("Ring", [item("rA", "Ring", [["A", "Enhancement", 10]])])],
    };
    const program = S.buildProgram(model);
    assert.strictEqual(program.utilityVars.length, 0, "no indicator is minted for an absent name");
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.A, 10);
    assert.strictEqual(r.utilityCount, 0);
    assert.deepStrictEqual(r.utilityEffects, []);
  });

  await test("#348 U2/R15: no solve after the container stage may swap a secured effect", async () => {
    // The count floor this replaces (`Σu >= count`) is satisfied by ANY equal-size
    // set, so the tie-break and settle stages could trade one secured effect for a
    // different one. This model reproduces exactly that against the pre-change tree:
    // two slots, three counting names, only two securable — the stage secures
    // {Blunt Trauma, Ghost Touch} (nGT + tBT) and the shipped count floor let the
    // final solve return {Feather Falling, Ghost Touch} (nGT + tFF) instead.
    //
    // The assertion is set preservation, not a hardcoded set: whatever the stage
    // secures, the returned loadout must carry the same effects. Ordering (R6) is
    // U3's; this unit only forbids the substitution ordering would be defenceless
    // against.
    const model = {
      targets: [SENT], mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(["Ghost Touch", "Feather Falling", "Blunt Trauma"]),
      worn: [
        slot("Necklace", [
          item("nGT", "Necklace", [["Ghost Touch", "Bool", 1]]),
          item("nFF", "Necklace", [["Feather Falling", "Bool", 1]]),
        ]),
        slot("Trinket", [
          item("tFF", "Trinket", [["Feather Falling", "Bool", 1]]),
          item("tBT", "Trinket", [["Blunt Trauma", "Bool", 1]]),
        ]),
      ],
    };

    // Re-run the container stage alone to learn what it secured, reading the same
    // guarded z-backed rule the stage itself uses (KTD2) — never the u primal. That
    // rule's own falsification lives in the "#91 U5/KTD6 guard" test above, which
    // injects synthetic primals through readSolution in both directions; the lock
    // built here applies the identical predicate at the stage site.
    //
    // The objective mirrors production's ordered weighting (#348 U3) rather than a
    // flat count: re-deriving with a different objective would compare the full
    // solve against a stage it never ran, which is a broken oracle, not a guard.
    const program = S.buildProgram(model);
    const ov = program.utilityOrderVars;
    const objTerms = ov.map((o, i) => ({ coef: Math.pow(2, ov.length - 1 - i), name: o.u }));
    const res = highs.solve(S.encodeStage(program, { objTerms, sense: "max", locks: [] }));
    assert.strictEqual(res.Status, "Optimal");
    const prim = (n) => (res.Columns[n] ? res.Columns[n].Primal : 0);
    const staged = [];
    for (const [, meta] of program.utilityMeta) {
      if (meta.zNames.some((z) => prim(z) > 0.5)) staged.push(meta.name);
    }
    assert.strictEqual(staged.length, 2, "the stage secures two of the three names");

    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.utilityCount, staged.length, "the count is preserved");
    assert.deepStrictEqual(
      r.utilityEffects.map((e) => e.name).sort(), staged.slice().sort(),
      "the SAME effects survive the tie-break and both settle stages — not merely as many");
    // The ordered receipt agrees with the effect list, and every container name is
    // accounted for exactly once as either secured or unsecured.
    assert.deepStrictEqual(r.utilityOrdered.secured.slice().sort(), staged.slice().sort());
    const accounted = r.utilityOrdered.secured.concat(r.utilityOrdered.unsecured.map((u) => u.name));
    assert.deepStrictEqual(accounted.slice().sort(),
      ["Blunt Trauma", "Feather Falling", "Ghost Touch"],
      "every container name is reported as secured or unsecured — none silently vanish");
  });

  await test("#348 U3/R6/AE1: order beats breadth — the top choice wins over two lower ones", async () => {
    // One slot, two ways to fill it: the top-ordered effect alone, or two
    // lower-ordered effects together. A count-maximizing tier takes the pair every
    // time — that is the value-blindness #348 exists to remove. An ordered container
    // must take the single effect the player ranked first, and taking the pair when
    // the order is reversed is what proves the choice is the ORDER's doing rather
    // than an artifact of the model.
    const mk = (order) => ({
      targets: [SENT], mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(["A-eff", "B-eff", "C-eff"]), utilityOrder: order,
      worn: [slot("Trinket", [
        item("tA", "Trinket", [["A-eff", "Bool", 1]]),
        item("tBC", "Trinket", [["B-eff", "Bool", 1], ["C-eff", "Bool", 1]]),
      ])],
    });

    const top = await S.solveLexicographic(mk(["A-eff", "B-eff", "C-eff"]), highs);
    assert.deepStrictEqual(top.utilityOrdered.secured, ["A-eff"],
      "the first-ordered effect is secured even though it costs two lower ones");
    assert.strictEqual(top.utilityCount, 1, "breadth is surrendered to order — one effect, not two");
    assert.deepStrictEqual(top.chosen.map((c) => c.variant.variant_id), ["tA"]);

    const pair = await S.solveLexicographic(mk(["B-eff", "C-eff", "A-eff"]), highs);
    assert.deepStrictEqual(pair.utilityOrdered.secured, ["B-eff", "C-eff"],
      "reversing the order takes the pair — the selection follows the order, not the model");
    assert.deepStrictEqual(pair.chosen.map((c) => c.variant.variant_id), ["tBC"]);
  });

  await test("#348 U3/R14: an unsecured effect says WHY — outbid or unreachable", async () => {
    // Two different facts a player acts on differently: an effect that lost the slot
    // (gear exists; something outranked it) and an effect nothing in the pool carries
    // at all (there is nothing to farm). Collapsing them into one "not secured" line
    // would send a player hunting for gear that does not exist in their band.
    const r = await S.solveLexicographic({
      targets: [SENT], mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(["Ghost Touch", "Feather Falling", "Nonexistent Effect"]),
      utilityOrder: ["Ghost Touch", "Nonexistent Effect", "Feather Falling"],
      worn: [slot("Trinket", [
        item("tGT", "Trinket", [["Ghost Touch", "Bool", 1]]),
        item("tFF", "Trinket", [["Feather Falling", "Bool", 1]]),
      ])],
    }, highs);
    assert.deepStrictEqual(r.utilityOrdered.secured, ["Ghost Touch"]);
    const byName = Object.fromEntries(r.utilityOrdered.unsecured.map((u) => [u.name, u.reason]));
    assert.strictEqual(byName["Feather Falling"], "outbid",
      "a carrier exists but lost the slot");
    assert.strictEqual(byName["Nonexistent Effect"], "unreachable",
      "no eligible variant carries it — no indicator was ever minted");
  });

  await test("#348 U3/R10: the same query and container return the same loadout", async () => {
    const mk = () => ({
      targets: ["A", SENT], mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(["Ghost Touch", "Feather Falling"]),
      utilityOrder: ["Feather Falling", "Ghost Touch"],
      worn: [
        slot("Ring", [item("rA", "Ring", [["A", "Enhancement", 10]])]),
        slot("Trinket", [
          item("tGT", "Trinket", [["Ghost Touch", "Bool", 1]]),
          item("tFF", "Trinket", [["Feather Falling", "Bool", 1]]),
        ]),
      ],
    });
    const a = await S.solveLexicographic(mk(), highs);
    const b = await S.solveLexicographic(mk(), highs);
    assert.deepStrictEqual(chosenIds(b), chosenIds(a));
    assert.deepStrictEqual(b.utilityOrdered, a.utilityOrdered);
    assert.deepStrictEqual(a.utilityOrdered.secured, ["Feather Falling"],
      "the declared order, not alphabetical order, decides the winner");
  });

  await test("#348 U5/R14/AE3: a reachable miss is priced; an unreachable one is not probed", async () => {
    // Ghost Touch loses the Trinket to the higher-ordered Blurry carrier, so it is
    // outbid and priceable. "Nonexistent Effect" has no carrier at all, so there is
    // no price to find and the probe must not spend a solve looking for one.
    const model = {
      targets: ["A", SENT], mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(["Blurry", "Ghost Touch", "Nonexistent Effect"]),
      utilityOrder: ["Blurry", "Ghost Touch", "Nonexistent Effect"],
      worn: [
        slot("Ring", [item("rA", "Ring", [["A", "Enhancement", 10]])]),
        slot("Trinket", [
          item("tBlur", "Trinket", [["A", "Enhancement", 4], ["Blurry", "Bool", 1]]),
          item("tGT", "Trinket", [["Ghost Touch", "Bool", 1]]),
        ]),
      ],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.deepStrictEqual(r.utilityOrdered.secured, ["Blurry"]);
    const price = r.utilityOrdered.price;
    assert.ok(price, "a price was computed");
    assert.strictEqual(price.name, "Ghost Touch",
      "the highest-ordered OUTBID effect is priced — not the unreachable one below it");
    assert.strictEqual(price.stat, "A", "priced against priority 1");
  });

  await test("#348 U5/KTD5: exactly one probe, however many effects went unsecured", async () => {
    // The budget is one MILP. Counted directly rather than inferred from wall time:
    // a probe-per-miss would scale with the container and is the thing KTD5 forbids.
    const mk = (names, order) => ({
      targets: ["A", SENT], mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(names), utilityOrder: order,
      worn: [
        slot("Ring", [item("rA", "Ring", [["A", "Enhancement", 10]])]),
        slot("Trinket", [
          item("tHi", "Trinket", [["A", "Enhancement", 4], [order[0], "Bool", 1]]),
          ...order.slice(1).map((n, i) => item(`t${i}`, "Trinket", [[n, "Bool", 1]])),
        ]),
      ],
    });
    const counting = (h) => { let n = 0; return { proxy: { solve: (...a) => { n++; return h.solve(...a); } }, count: () => n }; };

    const oneMiss = ["Blurry", "Ghost Touch"];
    const manyMiss = ["Blurry", "Ghost Touch", "Deathblock", "True Seeing", "Feather Falling"];
    const a = counting(highs);
    const ra = await S.solveLexicographic(mk(oneMiss, oneMiss), a.proxy);
    const b = counting(highs);
    const rb = await S.solveLexicographic(mk(manyMiss, manyMiss), b.proxy);

    assert.strictEqual(ra.utilityOrdered.unsecured.length, 1, "one miss");
    assert.ok(rb.utilityOrdered.unsecured.length >= 3, "several misses");
    assert.strictEqual(b.count(), a.count(),
      `solve count must not grow with the number of misses (${a.count()} vs ${b.count()})`);
  });

  await test("#348 U5: a container that secured everything runs no probe and prices nothing", async () => {
    const counting = (h) => { let n = 0; return { proxy: { solve: (...a) => { n++; return h.solve(...a); } }, count: () => n }; };
    const mk = (order) => ({
      targets: ["A", SENT], mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(order), utilityOrder: order,
      worn: [
        slot("Ring", [item("rA", "Ring", [["A", "Enhancement", 10]])]),
        slot("Trinket", [item("tBoth", "Trinket", [["Blurry", "Bool", 1], ["Ghost Touch", "Bool", 1]])]),
      ],
    });
    const full = counting(highs);
    const r = await S.solveLexicographic(mk(["Blurry", "Ghost Touch"]), full.proxy);
    assert.deepStrictEqual(r.utilityOrdered.unsecured, [], "nothing was missed");
    assert.strictEqual(r.utilityOrdered.price, null, "so nothing is priced");

    // ...and the probe genuinely did not run: same model with one effect made
    // unreachable-but-outbid costs exactly one more solve.
    const miss = counting(highs);
    await S.solveLexicographic({
      ...mk(["Blurry", "Ghost Touch"]),
      worn: [
        slot("Ring", [item("rA", "Ring", [["A", "Enhancement", 10]])]),
        slot("Trinket", [
          item("tB", "Trinket", [["A", "Enhancement", 4], ["Blurry", "Bool", 1]]),
          item("tG", "Trinket", [["Ghost Touch", "Bool", 1]]),
        ]),
      ],
    }, miss.proxy);
    assert.strictEqual(miss.count(), full.count() + 1,
      `the probe is exactly one solve (${full.count()} with no miss, ${miss.count()} with one)`);
  });

  await test("#348 U5: a zero give requires something BELOW priority 1 to be the block", async () => {
    // The invariant the priced disclosure's wording rests on. `give === 0` renders as
    // "costs nothing on <stat> — it is competing with your lower-ranked priorities",
    // which is only true if a lower-ranked priority exists and is the binding
    // constraint. The claim implies a falsifiable prediction: with exactly ONE ranked
    // stat there is nothing below priority 1, so a zero give must be unreachable.
    //
    // Both single-ranked shapes are exercised, because the second is the one that
    // would have made the copy a lie: an effect blocked only by a higher-ordered
    // container effect must route to the INFEASIBLE sentence, not to a zero.
    const mk = (targets, order, worn) => ({
      targets, mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(order), utilityOrder: order, worn,
    });

    // (a) one ranked stat, and securing the effect costs it -> a real price.
    const costsP1 = await S.solveLexicographic(mk(["A", SENT], ["Y", "X"], [
      slot("Trinket", [
        item("hiA", "Trinket", [["A", "Enhancement", 10]]),
        item("xA", "Trinket", [["A", "Enhancement", 6], ["X", "Bool", 1]]),
        item("yA", "Trinket", [["A", "Enhancement", 8], ["Y", "Bool", 1]]),
      ]),
    ]), highs);
    assert.ok(costsP1.utilityOrdered.price.give > 0,
      "with nothing below priority 1, an outbid effect must cost priority 1 something");
    assert.strictEqual(costsP1.utilityOrdered.price.free, false);

    // (b) one ranked stat, and the block is a HIGHER-ORDERED container effect, not a
    // stat. This must not surface as a zero — there is no lower-ranked priority for
    // it to be "competing with".
    const blockedAbove = await S.solveLexicographic(mk(["A", SENT], ["Y", "X"], [
      slot("Ring", [item("rA", "Ring", [["A", "Enhancement", 10]])]),
      slot("Trinket", [
        item("tX", "Trinket", [["X", "Bool", 1]]),
        item("tY", "Trinket", [["Y", "Bool", 1]]),
      ]),
    ]), highs);
    const bp = blockedAbove.utilityOrdered.price;
    assert.strictEqual(bp.infeasible, true, "it routes to the infeasible sentence");
    assert.strictEqual(bp.blockedByHigherOrder, true, "and names the ordering as the block");
    assert.notStrictEqual(bp.free, true, "and never renders as 'costs nothing'");

    // (c) control: two ranked stats with the block on priority 2 -> the zero case,
    // where the shipped wording is accurate.
    const onP2 = await S.solveLexicographic(mk(["A", "B", SENT], ["X"], [
      slot("Ring", [item("rA", "Ring", [["A", "Enhancement", 10]])]),
      slot("Trinket", [
        item("hiB", "Trinket", [["B", "Enhancement", 10]]),
        item("xB", "Trinket", [["B", "Enhancement", 4], ["X", "Bool", 1]]),
      ]),
    ]), highs);
    assert.strictEqual(onP2.utilityOrdered.price.give, 0);
    assert.strictEqual(onP2.utilityOrdered.price.free, true,
      "a zero appears exactly where a lower-ranked priority is the block");
  });

  await test("#91 U3/KTD10: a tier-2 name (carried, but outside the counting set) mints no indicator", async () => {
    // Keen is a real Bool presence effect excluded from the v1 tier-1 curation:
    // its carrier is equipped, but no u_e exists for it and it never counts.
    const model = {
      targets: ["A", SENT], mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(["Ghost Touch"]),
      worn: [slot("Ring", [item("rK", "Ring", [["A", "Enhancement", 10], ["Keen", "Bool", 1], ["Ghost Touch", "Bool", 1]])])],
    };
    const program = S.buildProgram(model);
    const names = [...program.utilityMeta.values()].map((m) => m.name);
    assert.deepStrictEqual(names, ["Ghost Touch"], "only the tier-1 name mints an indicator");
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.utilityCount, 1, "the tier-2 effect contributes nothing to the count");
    assert.deepStrictEqual(r.utilityEffects.map((e) => e.name), ["Ghost Touch"]);
  });

  await test("#91 U3: tier removed — the program is byte-identical to pre-feature (KTD3 A/B)", async () => {
    // Same model except for the sentinel: with the tier removed, the counting
    // set must be inert — identical encoded LP, identical solve.
    const worn = () => [slot("Trinket", [
      item("hiA", "Trinket", [["A", "Enhancement", 10]]),
      item("gt", "Trinket", [["Ghost Touch", "Bool", 1]]),
    ])];
    const withSet = {
      targets: ["A"], mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(["Ghost Touch"]), worn: worn(),
    };
    const preFeature = { targets: ["A"], mlCap: 34, dodgeCap: null, worn: worn() };
    const enc = (m) => S.encodeStage(S.buildProgram(m), { objectiveStat: "A", sense: "max", locks: [] });
    assert.strictEqual(enc(withSet), enc(preFeature), "byte-identical program with the tier removed");
    const a = await S.solveLexicographic(withSet, highs);
    const b = await S.solveLexicographic(preFeature, highs);
    assert.deepStrictEqual(chosenIds(a), chosenIds(b), "identical solution");
    assert.deepStrictEqual(a.effective, b.effective);
    assert.strictEqual(a.utilityCount, undefined, "no utility fields on a tier-removed result");
    assert.strictEqual(a.utilityEffects, undefined);
    // ...and nothing about the machinery perturbs the optimum (non-target soundness).
    assert.strictEqual(a.effective.A, 10);
    assert.strictEqual(a.chosen[0].variant.variant_id, "hiA");
  });

  await test("#91 U3/KTD3: buildModel widening keeps a utility-only item through dominance — only when the tier is ranked", async () => {
    const M = require("../web/model.js");
    const full = (id, affixes) => ({
      source_item: id, variant_id: id, slot: "Trinket", category: "item",
      minimum_level: 10, ml: 10, verification: "verified",
      affixes: affixes.map(([stat, t, v]) => ({ stat, bonus_type: t, name: stat, type: t, value: v, unit: "flat" })),
      scaling: [], set_bonus: [], augment_slots: [], restrictions: "unknown", armor_type: null,
    });
    const variants = [full("hiA", [["A", "Enhancement", 10]]), full("gtOnly", [["Ghost Touch", "Bool", 1]])];
    const counting = new Set(["Ghost Touch"]);
    const withTier = M.buildModel(variants, { mlCap: 34, targets: ["A", SENT] },
      [], [], [], [], {}, [], [], {}, counting);
    const ids = withTier.worn.find((g) => g.slot === "Trinket").variants.map((v) => v.variant_id);
    assert.ok(ids.includes("gtOnly"), "the utility-only item survives the dominance pre-filter");
    assert.strictEqual(withTier.utilityEnabled, true);
    const without = M.buildModel(variants, { mlCap: 34, targets: ["A"] },
      [], [], [], [], {}, [], [], {}, counting);
    const ids2 = without.worn.find((g) => g.slot === "Trinket").variants.map((v) => v.variant_id);
    assert.ok(!ids2.includes("gtOnly"), "tier removed: the pre-feature pool prunes it exactly as before");
    assert.strictEqual(without.utilityEnabled, false);
  });

  await test("#91 U3/KTD5: the settle stages preserve the locked count (no-op-augment drop can't strip the carrier)", async () => {
    // The Ghost Touch gem advances no RANKED stat, so once A is locked the
    // drop-no-op settle stage would minimize it away — the utility count lock
    // is the only thing keeping the placement. The host carries nothing at all,
    // so the tie-break would likewise shed it without the lock.
    const model = {
      targets: ["A", SENT], mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(["Ghost Touch"]),
      worn: [
        slot("Ring", [item("rA", "Ring", [["A", "Enhancement", 10]])]),
        slot("Trinket", [host("H", "Trinket", [], ["Colorless"])]),
      ],
      augments: [augment("GTgem", "Colorless", [["Ghost Touch", "Bool", 1]])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.A, 10);
    assert.strictEqual(r.utilityCount, 1);
    assert.ok((r.augmentsPlaced || []).some((m) => m.variant_id === "GTgem"),
      "the counted effect's only carrier survives dropNoOpAugments");
    assert.deepStrictEqual(r.utilityEffects.map((e) => e.name), ["Ghost Touch"]);
  });

  // -------------------------------------------------------------------------
  // #91 (U5, KTD6) — utilityReport: guarded, deterministic receipts on the
  // result. Attribution rule (R9, stated): the FIRST carrier in the tie-break's
  // item order (lowest x-index among equipped carriers); augments credit their
  // own variant_id (no solver-side host), craft picks credit their host item,
  // set tiers credit the set.
  // -------------------------------------------------------------------------
  await test("#91 U5/KTD6: utilityReport carries count + credited items on the solve result", async () => {
    const model = {
      targets: ["A", SENT], mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(["Ghost Touch", "Feather Falling"]),
      worn: [
        slot("Ring", [item("rA", "Ring", [["A", "Enhancement", 10]])]),
        slot("Necklace", [item("nGT", "Necklace", [["Ghost Touch", "Bool", 1]])]),
        slot("Trinket", [item("tFF", "Trinket", [["Feather Falling", "Bool", 1]])]),
      ],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.utilityReport.count, 2, "report count matches the achieved distinct count");
    assert.deepStrictEqual(
      [...r.utilityReport.effects].sort((a, b) => a.name.localeCompare(b.name)),
      [{ name: "Feather Falling", item: "tFF" }, { name: "Ghost Touch", item: "nGT" }],
      "each effect is credited to the item that carries it");
  });

  await test("#91 U5/AE4: a shared effect credits exactly one item — the lowest x-index carrier", async () => {
    // Both carriers are equipped (A stacks via Enhancement + Insight). The Ring
    // slot is built before the Necklace slot, so rGT holds the lower x-index
    // and takes the credit — deterministically, on every run.
    const model = {
      targets: ["A", SENT], mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(["Ghost Touch"]),
      worn: [
        slot("Ring", [item("rGT", "Ring", [["A", "Enhancement", 10], ["Ghost Touch", "Bool", 1]])]),
        slot("Necklace", [item("nGT", "Necklace", [["A", "Insight", 5], ["Ghost Touch", "Bool", 1]])]),
      ],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.effective.A, 15, "both carriers equipped");
    assert.deepStrictEqual(r.utilityReport.effects, [{ name: "Ghost Touch", item: "rGT" }],
      "credited once, to the first carrier in the tie-break's item order");
    const again = await S.solveLexicographic(model, highs);
    assert.deepStrictEqual(again.utilityReport, r.utilityReport, "attribution is deterministic");
  });

  await test("#91 U5: augment-carried credits the placement's own label; set-carried credits the set", async () => {
    const augModel = {
      targets: [SENT], mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(["Ghost Touch"]),
      worn: [slot("Trinket", [host("H", "Trinket", [], ["Colorless"])])],
      augments: [augment("GTgem", "Colorless", [["Ghost Touch", "Bool", 1]])],
    };
    const ra = await S.solveLexicographic(augModel, highs);
    assert.deepStrictEqual(ra.utilityReport.effects, [{ name: "Ghost Touch", item: "GTgem" }],
      "no solver-side host for an augment placement -> its own variant_id");
    const setModel = {
      targets: [SENT], mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(["Ghost Touch"]),
      worn: [
        slot("Ring", [setPiece("p1", "Ring", [], "Spectral Pair", [{ n: 2, affixes: [["Ghost Touch", "Bool", 1]] }])]),
        slot("Necklace", [setPiece("p2", "Necklace", [], "Spectral Pair", [{ n: 2, affixes: [["Ghost Touch", "Bool", 1]] }])]),
      ],
    };
    const rs = await S.solveLexicographic(setModel, highs);
    assert.deepStrictEqual(rs.utilityReport.effects, [{ name: "Ghost Touch", item: "Spectral Pair" }],
      "a tier-granted effect credits the set that grants it");
  });

  await test("#91 U5: a craft-carried effect credits the HOST item the pick sits on", async () => {
    // A roll-group option grants Ghost Touch; the credit resolves back to the
    // equipped host, not the pick's internal var.
    const hostV = item("ROLL-H", "Boots", [["A", "Enhancement", 5]]);
    hostV.roll_groups = [{ options: [{ stat: "Ghost Touch", bonus_type: "Bool", value: 1, unit: "flat" }] }];
    const model = {
      targets: ["A", SENT], mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(["Ghost Touch"]),
      worn: [slot("Boots", [hostV])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.deepStrictEqual(r.utilityReport.effects, [{ name: "Ghost Touch", item: "ROLL-H" }],
      "the roll pick's effect is credited to its host item");
  });

  await test("#91 U5/KTD6 guard: presence is z-backed — floated u omitted, fired z reported even with u=0", async () => {
    // Synthetic primal straight into readSolution (the #319 idiom). Review fix:
    // the report predicate is z-backed ONLY — u_e=1 with no backing z fired must
    // not enter the report (receipts never claim an effect no fired contribution
    // carries), while a fired z with u_e floated to 0 MUST enter it (after the
    // utility stage nothing pressures the u vars, so the final primal may hold
    // an arbitrary count-sized subset of u's up; reading u would under-report
    // genuinely present effects nondeterministically).
    const model = {
      targets: ["A", SENT], mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(["Ghost Touch"]),
      worn: [slot("Necklace", [item("nGT", "Necklace", [["A", "Enhancement", 2], ["Ghost Touch", "Bool", 1]])])],
    };
    const program = S.buildProgram(model);
    assert.strictEqual(program.utilityVars.length, 1, "one indicator minted");
    const u = program.utilityVars[0];
    const zs = program.utilityMeta.get(u).zNames;
    assert.ok(zs.length >= 1, "the indicator has backing contributions");
    const primalOf = (names) => ({ Columns: Object.fromEntries(names.map((n) => [n, { Primal: 1 }])) });
    const x = program.xVars[0].name;
    const floated = S.readSolution(primalOf([x, u]), program);
    // #332 added `rankedNotCounted` to the report, so assert the two fields this
    // guard is ABOUT rather than the whole object — a whole-object compare makes
    // every future report field a false failure here, and the claim is specifically
    // that a floated indicator contributes no counted effect.
    assert.strictEqual(floated.utilityReport.count, 0, "floated indicator: not counted");
    assert.deepStrictEqual(floated.utilityReport.effects, [],
      "floated indicator: omitted from the report");
    assert.deepStrictEqual(floated.utilityEffects, [], "and from the effect list");
    const fired = S.readSolution(primalOf([x, u, zs[0]]), program);
    assert.strictEqual(fired.utilityReport.count, 1, "fired indicator: counted once");
    assert.deepStrictEqual(fired.utilityReport.effects, [{ name: "Ghost Touch", item: "nGT" }],
      "fired indicator: reported with its credited carrier");
    // Review fix (the new direction): the z fired but the u floated to 0 —
    // the effect is genuinely present, so it IS in the report and the list.
    const zOnly = S.readSolution(primalOf([x, zs[0]]), program);
    assert.strictEqual(zOnly.utilityReport.count, 1, "z-only: counted from the backing z");
    assert.deepStrictEqual(zOnly.utilityReport.effects, [{ name: "Ghost Touch", item: "nGT" }],
      "fired z with a floated-to-0 u: reported — presence is z-backed, u primals are not consulted");
    assert.deepStrictEqual(zOnly.utilityEffects, [{ name: "Ghost Touch", present: true }],
      "the U3 effect list uses the same z-backed predicate");
  });

  await test("#91 U5: the tieBreak:false path (alternatives shape) carries the same guarded report", async () => {
    const model = {
      targets: ["A", SENT], mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(["Ghost Touch"]),
      worn: [
        slot("Ring", [item("rA", "Ring", [["A", "Enhancement", 10]])]),
        slot("Necklace", [item("nGT", "Necklace", [["Ghost Touch", "Bool", 1]])]),
      ],
    };
    const opt = await S.solveLexicographic(model, highs);
    const alt = S.solveConstrained(opt.program, highs, { objectiveStat: "A", tieBreak: false });
    assert.strictEqual(alt.status, "optimal");
    assert.ok(alt.utilityReport, "a solveConstrained result over a tier-ranked program carries the report");
    assert.deepStrictEqual(alt.utilityReport.effects.filter((e) => e.name === "Ghost Touch").length <= 1, true,
      "no duplicate receipts");
    for (const e of alt.utilityReport.effects) {
      assert.ok(e.item != null, `every reported effect names a credited carrier (${e.name})`);
    }
    assert.strictEqual(alt.utilityReport.count, alt.utilityReport.effects.length,
      "count and receipts agree on the same primal");
  });

  await test("#91 U5/R12: slots the Utility stage fills are NOT reported as empty", async () => {
    const mk = (targets) => ({
      targets, mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(["Ghost Touch", "Feather Falling"]),
      worn: [
        slot("Ring", [item("rA", "Ring", [["A", "Enhancement", 10]])]),
        slot("Necklace", [item("nGT", "Necklace", [["Ghost Touch", "Bool", 1]])]),
        slot("Trinket", [item("tFF", "Trinket", [["Feather Falling", "Bool", 1]])]),
      ],
    });
    const bare = await S.solveLexicographic(mk(["A"]), highs);
    assert.strictEqual(bare.emptySlots.count, 2, "tier-absent: the two utility-only slots are empty");
    const r = await S.solveLexicographic(mk(["A", SENT]), highs);
    assert.strictEqual(r.emptySlots.count, 0, "the invitation fires only for slots still empty post-Utility");
    assert.deepStrictEqual(r.emptySlots.slots, []);
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
  // #211 — an ATOMIC multi-affix NC option (the Skill-menu shape): one record,
  // one binary, every affix granted together.
  function ncMulti(category, affixes, tier, name) {
    return {
      category, tier: tier || "legendary", name: name || `${category} option`,
      affixes: affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, value, unit: "flat" })),
    };
  }

  await test("NC/atomic: a multi-affix Skill option grants ALL its skills on ONE binary", async () => {
    const skills = ["Bluff", "Diplomacy", "Haggle"];
    const pool = [ncMulti("Skill", skills.map((s) => [s, "Exceptional", 11]))];
    const q = {
      targets: ["Bluff", "Haggle"], mlCap: 36, dodgeCap: null,
      worn: [slot("Boots", [ncHost("B", "Boots", "Skill", "legendary")])],
      nearlyComplete: pool,
    };
    const program = S.buildProgram(q);
    assert.strictEqual([...program.ncMeta.keys()].length, 1,
      "one binary for the whole option, never one per affix");
    const r = await S.solveLexicographic(q, highs);
    assert.strictEqual(r.effective.Bluff, 11, "first ranked skill crafted");
    assert.strictEqual(r.effective.Haggle, 11,
      "the SAME craft credits the other ranked skill — one slot, not two");
    assert.strictEqual(r.ncPlaced.length, 1, "exactly one placement");
    assert.strictEqual((r.ncPlaced[0].affixes || []).length, 3,
      "the placement is self-describing with the option's whole affix list");
  });


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


  await test("#346: the no-niche-crafting rung removes every crafted placement from a real solve", async () => {
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
    const on = await S.solveLexicographic(build({ ...q, craftingRung: "no-niche-crafting" }), highs);
    assert.strictEqual(on.status, "optimal");
    const placements = (r) => [].concat(r.vikPlaced || [], r.sealPlaced || [], r.ncPlaced || [],
      r.dinoPlaced || [], r.tfPlaced || [], r.gsPlaced || [], r.membershipPlaced || []);
    assert.strictEqual(placements(on).length, 0, "rung on: no crafted placement of any family");
    // The rung can only remove crafted points, never add: the opt-out optimum is
    // bounded by the full one on the first priority.
    assert.ok((on.perTarget.Charisma || 0) <= (off.perTarget.Charisma || 0),
      "P1 without crafting cannot exceed P1 with it");
  });

  // #346 (U1, AE4) — the ladder nests on REAL data: each rung OFFERS a subset of
  // the rung above, and descending never improves the target vector
  // lexicographically. A rung that offered more, or bought a better
  // lexicographic outcome from a smaller pool, would mean the exclusion leaked.
  // (Two weaker invariants this test once asserted are wrong and are explained
  // inline below — neither chosen placements nor per-stat values need nest.)
  await test("#346: the rungs nest on a real solve and never improve the priority vector", async () => {
    const fs = require("fs");
    const { buildModel } = require("../web/model.js");
    const data = normalizeDataset(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8")));
    const targets = ["Melee Power", "Doublestrike", "Accuracy", "Deadly", "Seeker", "Armor-Piercing"];
    // `style` with a style id — NOT `weaponStyle: "Two Handed"`, which nothing
    // reads (web/model.js:210 + web/weapon-taxonomy.js STYLES) and which left
    // an earlier draft of this test solving unconstrained.
    const q = { mlCap: 15, targets, armorType: null, weaponSetup: null, style: "thf", classRace: null };
    const modelAt = (rung) => buildModel(data.items, { ...q, craftingRung: rung },
      data.dino_inserts, data.nearly_complete, data.viktranium, data.seal,
      data.membership_set_defs, data.thunder_forged, data.green_steel, data.augment_set_defs);
    const rungs = ["everything", "no-niche-crafting", "no-solar-lunar", "printed-only"];
    const models = {}, out = {};
    for (const rung of rungs) {
      models[rung] = modelAt(rung);
      out[rung] = await S.solveLexicographic(models[rung], highs);
      assert.strictEqual(out[rung].status, "optimal", `${rung} stays feasible`);
    }

    // The ladder nests in the OPTION POOL, which is the guarantee. It does NOT
    // nest in the chosen placements, and asserting that was this test's own bug:
    // once the constraint above was corrected to a real THF query, losing niche
    // crafting made the solver SUBSTITUTE a Solar Gem it had not needed at
    // "everything" — legitimate re-optimization over a smaller pool, not a leak.
    // Pool nesting is exact and needs no solve; the solve-level guarantees are
    // monotone non-improvement and the absence of each rung's own category.
    const poolIds = (m) => new Set((m.augments || []).map((a) => a.variant_id || a.name));
    const nichePools = ["viktranium", "seal", "thunderForged", "greenSteel", "dinoInserts",
      "nearlyComplete", "membershipSetDefs", "augment_set_defs"];
    for (let i = 1; i < rungs.length; i++) {
      const above = poolIds(models[rungs[i - 1]]), here = poolIds(models[rungs[i]]);
      for (const id of here) {
        assert.ok(above.has(id),
          `${rungs[i]} OFFERS ${id}, which ${rungs[i - 1]} did not — the ladder leaked`);
      }
      for (const p of nichePools) {
        const a = models[rungs[i - 1]][p], h = models[rungs[i]][p];
        const size = (x) => (Array.isArray(x) ? x.length : x ? Object.keys(x).length : 0);
        assert.ok(size(h) <= size(a),
          `${p} grew descending from ${rungs[i - 1]} to ${rungs[i]} — the ladder leaked`);
      }
      // Descending must not improve the target vector LEXICOGRAPHICALLY — the
      // first stat that differs must fall. Per-stat non-improvement is NOT
      // guaranteed and asserting it was this test's second bug: on this query
      // Seeker (priority 5) drops 12 -> 10 when niche crafting goes, which
      // RELAXES the stage-6 constraint set, so Armor-Piercing (priority 6)
      // rises 17 -> 22. That is strict lexicographic priority working — a lower
      // stat may gain once a higher ceiling falls — not a leak.
      const vAbove = targets.map((t) => out[rungs[i - 1]].perTarget[t] || 0);
      const vHere = targets.map((t) => out[rungs[i]].perTarget[t] || 0);
      const d = vHere.findIndex((v, k) => v !== vAbove[k]);
      if (d !== -1) {
        assert.ok(vHere[d] < vAbove[d],
          `${targets[d]} IMPROVED (${vAbove[d]} -> ${vHere[d]}) at the first differing priority ` +
          `descending from ${rungs[i - 1]} to ${rungs[i]} — a smaller pool cannot buy a better ` +
          "lexicographic outcome");
      }
    }
    const isSolarLunar = (a) => ["Sun", "Moon"].includes(a.color);
    assert.ok((out["no-solar-lunar"].augmentsPlaced || []).every((a) => !isSolarLunar(a)),
      "no Solar/Lunar gem survives its rung");
    assert.strictEqual((out["printed-only"].augmentsPlaced || []).length, 0,
      "the bottom rung places no augment at all");
  });

  // #346 (U1, AE7) — a rung can take a stat's LAST source out of the pool. Twenty
  // targetable stats are augment-only (Strikethrough, Sneak Attack Dice, Imbue
  // Dice, …), so the bottom rung drops them to zero.
  //
  // It does NOT go infeasible: per-stat floors are best-effort, so the solve
  // still reports optimal with the floor unmet. That is the honest failure mode
  // and the one U5's disclosure has to explain — a player who ranked
  // Strikethrough first sees a zero and no reason unless the notice names the
  // rung. Pinned here because a future change making floors hard would flip this
  // to infeasible and must be a deliberate, visible decision.
  await test("#346: a rung can remove a stat's only source, and the solve stays optimal at zero", async () => {
    const fs = require("fs");
    const { buildModel } = require("../web/model.js");
    const data = normalizeDataset(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8")));
    const q = { mlCap: 34, targets: ["Strikethrough"], targetFloors: { Strikethrough: 1 },
      armorType: null, weaponSetup: null, classRace: null };
    const build = (rung) => buildModel(data.items, { ...q, craftingRung: rung },
      data.dino_inserts, data.nearly_complete, data.viktranium, data.seal,
      data.membership_set_defs, data.thunder_forged, data.green_steel, data.augment_set_defs);

    const top = await S.solveLexicographic(build("everything"), highs);
    assert.strictEqual(top.status, "optimal");
    assert.ok(top.perTarget.Strikethrough > 0, "augments carry Strikethrough at the top rung");

    const bottom = await S.solveLexicographic(build("printed-only"), highs);
    assert.strictEqual(bottom.status, "optimal",
      "floors are best-effort — the solve does not go infeasible, it comes back short");
    assert.strictEqual(bottom.perTarget.Strikethrough, 0,
      "the bottom rung leaves no Strikethrough source in the pool");
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
    // Legendary University Lost Purpose armor/helm/cloak hosts awaken it.
    // #305 retarget: the original lead target ("Additional Damage to Helpless
    // Targets") was awaken-only-exclusive only because the helpless stat was
    // fragmented; the fold made it obtainable everywhere, so it no longer forces
    // awakening. Strikethrough Chance is the stat that still does: it exists in
    // NO channel except the (awaken-only) Heart of Blades membership defs.
    const fs = require("fs");
    const { buildModel } = require("../web/model.js");
    const data = normalizeDataset(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8")));
    const lp = data.items.filter((v) => (v.set_membership_slot || {}).station === "Cannith Repurposing Station");
    assert.ok(lp.length === 44, "all 44 Lost Purpose items carry a Cannith membership slot");
    const query = { mlCap: 32, targets: ["Strikethrough Chance", "Damage to helpless enemies"], armorType: null, weaponSetup: null, classRace: null };
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
    // #305 crediting on real data: the CANONICAL helpless priority is served at
    // the full Artifact magnitude (15) on the real dataset. (Set-tier crediting
    // under the canonical name specifically is pinned by the synthetic
    // "#305: set-tier credit under the canonical helpless name" test below.)
    assert.ok((r.effective["Damage to helpless enemies"] || 0) >= 15,
      `the canonical helpless priority is credited on real data (got ${r.effective["Damage to helpless enemies"]})`);
  });

  await test("#305: set-tier credit under the canonical helpless name", async () => {
    // A parsed_set_bonuses tier granting `Damage to helpless enemies` credits a
    // priority ranked under that exact name — the crediting the fragmentation
    // broke: pre-fold, ~19 sets granted this mechanic under 11 other spellings
    // and a canonical priority scored zero from all of them
    // (docs/wiki-evidence/helpless-damage.md).
    const CANON = "Damage to helpless enemies";
    const tier = [{ n: 2, affixes: [[CANON, "Artifact", 15]] }];
    const model = {
      targets: [CANON], mlCap: 34, dodgeCap: null,
      worn: [slot("Ring", [setPiece("R", "Ring", [], "Cruelty Set", tier)]),
             slot("Necklace", [setPiece("N", "Necklace", [], "Cruelty Set", tier)])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective[CANON], 15, "the completed 2-piece tier credits the ranked canonical stat");
    assert.ok(r.setsActive.some((s) => s.set === "Cruelty Set"), "the set is reported active");
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

  // #334 pair — shared scaffolding: one memoized real-dataset load plus the
  // Dread Isle lookups (blank finder + first-native-carrier-per-slot index)
  // both tests need.
  const DREAD_SET = "The Legendary Dread Isle's Curse";
  let _dreadData = null;
  const dreadData = () => {
    if (_dreadData === null) {
      const fs = require("fs");
      _dreadData = normalizeDataset(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8")));
    }
    return _dreadData;
  };
  const dreadBlank = (data, pred) =>
    data.items.find((v) => v.source === "dino_crafting_blank" && pred(v));
  const dreadNatives = (data, slots) => {
    const bySlot = {};
    for (const it of data.items) {
      if (it.source === "dino_crafting_blank") continue;
      if ((it.set_bonus || []).some((s) => s.set === DREAD_SET) && !bySlot[it.slot]) bySlot[it.slot] = it;
    }
    return slots.map((s) => bySlot[s]).filter(Boolean);
  };

  await test("#334: the Dinosaur Bone Rune Arm blank is a real Dread Isle's Curse piece (its 5th piece completes the set)", async () => {
    // The reported false trade: the set lived only on native carriers while the
    // insert slots lived only on set-less blanks. Real dataset end-to-end: the
    // Rune Arm blank + 4 native carriers reach the def's 5-piece threshold and
    // the set's stat credits; without the blank the same 4 natives do not.
    const data = dreadData();
    // The load normalizer worn-slots a runearm as Off Hand; find the blank by category.
    const blank = dreadBlank(data, (v) => v.category === "runearm");
    assert.ok(blank, "the Rune Arm blank is in the dataset");
    assert.ok((blank.set_bonus || []).some((s) => s.set === DREAD_SET), "the blank carries the set intrinsically");
    const natives = dreadNatives(data, ["Bracers", "Boots", "Gloves", "Belt"]);
    assert.strictEqual(natives.length, 4, "4 native carriers in distinct worn slots");
    const mk = (vs) => ({
      targets: ["Universal Spell Power"], mlCap: 34, dodgeCap: null,
      membershipSetDefs: data.membership_set_defs,
      worn: vs.map((v) => ({ slot: v.slot, cardinality: 1, variants: [v] })),
    });
    const r5 = await S.solveLexicographic(mk([...natives, blank]), highs);
    const r4 = await S.solveLexicographic(mk(natives), highs);
    assert.strictEqual(r5.status, "optimal");
    assert.ok(r5.setsActive.some((s) => s.set === DREAD_SET), "4 natives + the blank activate the 5-piece set");
    assert.ok((r5.effective["Universal Spell Power"] || 0) >= (r4.effective["Universal Spell Power"] || 0) + 25,
      "the set's +25 Universal Spell Power credits only with the blank as 5th piece");
    assert.ok(!r4.setsActive.some((s) => s.set === DREAD_SET), "the 4 natives alone do not activate it");
  });

  await test("#334/KTD3: one equipped blank never counts as two Dread Isle pieces", async () => {
    // The Helmet blank carries the set intrinsically AND has a Set-Bonus
    // membership slot. Its pool must no longer offer the intrinsic set, so
    // intrinsic piece + membership pick cannot both fire from one item: the
    // blank + 3 natives is 4 pieces, below the 5-piece threshold, and no
    // membership pick may join the intrinsic set to fake the 5th.
    const data = dreadData();
    const helm = dreadBlank(data, (v) => v.slot === "Helmet");
    assert.ok(helm, "the Helmet blank is in the dataset");
    assert.ok((helm.set_bonus || []).some((s) => s.set === DREAD_SET), "the Helmet blank carries the set intrinsically");
    assert.ok(!((helm.set_membership_slot || {}).pool || []).includes(DREAD_SET),
      "the intrinsic set has left the blank's Set-Bonus pool");
    const natives = dreadNatives(data, ["Bracers", "Boots", "Gloves"]);
    assert.strictEqual(natives.length, 3, "3 native carriers in distinct worn slots");
    const model = {
      targets: ["Universal Spell Power"], mlCap: 34, dodgeCap: null,
      membershipSetDefs: data.membership_set_defs,
      worn: [...natives, helm].map((v) => ({ slot: v.slot, cardinality: 1, variants: [v] })),
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.ok(!r.setsActive.some((s) => s.set === DREAD_SET),
      "4 pieces (3 natives + the blank's ONE intrinsic piece) stay below the 5-piece threshold");
    assert.ok(!(r.membershipPlaced || []).some((m) => m.set === DREAD_SET),
      "no membership pick joins the set the blank already carries");
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
  // slotted up to 3 times; the 3-piece Artifact bonus fires at exactly 3 owned
  // copies. Copies feed the EXISTING set-threshold engine. Defs come from
  // model.augment_set_defs (mirrors membershipSetDefs); hosts are equipped
  // items exposing any slot compatible with the def's fits_slots matrix
  // (#316 — any standard color, not only Colorless).
  // ---------------------------------------------------------------------------
  // A set-augment def, shaped exactly like items.json augment_set_defs entries.
  function augSetDef(affixes, pieces = 3, fits) {
    return {
      tiers: [{
        pieces_required: pieces, pieces_label: `${pieces} Pieces Equipped`,
        affixes: affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, value, unit: "flat" })),
        wiki_url: "https://ddowiki.com/page/Augment_Slot/Set_Augment",
      }],
      tier: "augment", wiki_url: "https://ddowiki.com/page/Augment_Slot/Set_Augment",
      // #316 — the baked color matrix the build forwards onto every def; the
      // solver is fail-closed without it, so fixtures mirror the build.
      fits_slots: fits || ["Blue", "Colorless", "Green", "Orange", "Purple", "Red", "Yellow"],
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

  await test("#316/AE1: a colored-slots-only host carries a set-augment copy, slot_color named", async () => {
    // The issue #316 repro shape: every host exposes ONLY colored slots. Under the
    // literal-Colorless rule these hosts were ineligible and the set could never
    // fire; under the def's baked matrix (a Set Augment is a Colorless augment,
    // and Colorless fits every standard color slot) all three carry a copy.
    // Deletion test target: revert eligibility to literal Colorless and this red-lines.
    const def = { "AugSet": augSetDef([["StatA", "Artifact", 10]]) };
    const model = {
      targets: ["StatA"], mlCap: 34, dodgeCap: null, augment_set_defs: def,
      worn: [slot("Ring", [host("H1", "Ring", [], ["Green", "Yellow"])]),
             slot("Necklace", [host("H2", "Necklace", [], ["Green"])]),
             slot("Trinket", [host("H3", "Trinket", [], ["Yellow"])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.StatA, 10, "3 copies on colored-only hosts -> 3-piece bonus fires");
    const placed = r.setAugmentsPlaced || [];
    assert.strictEqual(placed.length, 3, "one copy per host");
    for (const sa of placed) {
      assert.ok(["Green", "Yellow"].includes(sa.slot_color),
        `slot_color names the consumed colored slot, got ${sa.slot_color}`);
    }
  });

  await test("#316/AE3: a colored slot consumed by a copy blocks an ordinary augment of that color", async () => {
    // Colored twin of the shared-Colorless-capacity test: three single-Yellow-slot
    // hosts; the priority set's 3 copies eat all Yellow supply, so the ordinary
    // Yellow augment cannot also land. Names the newly-reachable colored bucket
    // directly rather than relying on the Colorless bucket's existing coverage.
    const def = { "AugSet": augSetDef([["StatA", "Artifact", 10]]) };
    const model = {
      targets: ["StatA", "StatB"], mlCap: 34, dodgeCap: null, augment_set_defs: def,
      augments: [augment("ordY", "Yellow", [["StatB", "Enhancement", 7]])],
      worn: [slot("Ring", [host("H1", "Ring", [], ["Yellow"])]),
             slot("Necklace", [host("H2", "Necklace", [], ["Yellow"])]),
             slot("Trinket", [host("H3", "Trinket", [], ["Yellow"])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.StatA, 10, "priority StatA: 3 copies fill all 3 Yellow slots");
    assert.strictEqual(r.effective.StatB, 0, "no Yellow slot left for the ordinary augment (shared supply)");
  });

  await test("#316/R2: a copy is never attributed a color its host lacks", async () => {
    // Aggregate per-color capacity is global, but the c vars exist only over each
    // host's own colors — so the reported color is always one the host exposes,
    // even when other equipped items supply different colors.
    const def = { "AugSet": augSetDef([["StatA", "Artifact", 10]]) };
    const hostColors = { H1: ["Colorless"], H2: ["Yellow"], H3: ["Green"] };
    const model = {
      targets: ["StatA"], mlCap: 34, dodgeCap: null, augment_set_defs: def,
      worn: [slot("Ring", [host("H1", "Ring", [], hostColors.H1)]),
             slot("Necklace", [host("H2", "Necklace", [], hostColors.H2)]),
             slot("Trinket", [host("H3", "Trinket", [], hostColors.H3)])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual((r.setAugmentsPlaced || []).length, 3);
    for (const sa of r.setAugmentsPlaced) {
      assert.ok((hostColors[sa.host] || []).includes(sa.slot_color),
        `${sa.host} reported ${sa.slot_color}, exposes ${hostColors[sa.host]}`);
    }
  });

  await test("#316/#312: one copy per host holds across colored slots", async () => {
    // A host with two compatible colored slots still holds ONE copy — the set
    // identity is single, however many slots the item exposes. Two hosts -> at
    // most 2 copies -> the 3-piece bonus cannot fire.
    const def = { "AugSet": augSetDef([["StatA", "Artifact", 10]]) };
    const two = {
      targets: ["StatA"], mlCap: 34, dodgeCap: null, augment_set_defs: def,
      worn: [slot("Ring", [host("H1", "Ring", [], ["Green", "Yellow"])]),
             slot("Necklace", [host("H2", "Necklace", [], ["Yellow"])])],
    };
    const r2 = await S.solveLexicographic(two, highs);
    assert.strictEqual(r2.status, "optimal");
    assert.strictEqual(r2.effective.StatA, 0, "2 hosts -> max 2 copies -> no 3-piece bonus");
    assert.ok((r2.setAugmentsPlaced || []).length <= 2, "one copy per host, colored slots included");
    // Positive arm (discriminates against the pre-change tree, where colored
    // hosts carry nothing): a third host lets the set fire with exactly one
    // copy per DISTINCT host — the double-slot host never contributes two.
    const three = {
      targets: ["StatA"], mlCap: 34, dodgeCap: null, augment_set_defs: def,
      worn: [slot("Ring", [host("H1", "Ring", [], ["Green", "Yellow"])]),
             slot("Necklace", [host("H2", "Necklace", [], ["Yellow"])]),
             slot("Trinket", [host("H3", "Trinket", [], ["Green"])])],
    };
    const r3 = await S.solveLexicographic(three, highs);
    assert.strictEqual(r3.status, "optimal");
    assert.strictEqual(r3.effective.StatA, 10, "3 distinct hosts -> bonus fires");
    const hosts3 = (r3.setAugmentsPlaced || []).map((s) => s.host).sort();
    assert.deepStrictEqual(hosts3, ["H1", "H2", "H3"], "one copy per distinct host");
  });

  await test("#316 fail-closed: a def without the baked matrix hosts no copies", async () => {
    // exclude-until-verified at the solver seam: a def the build failed to stamp
    // (join drift) must not fabricate placements from a JS-side assumption.
    const def = { "AugSet": augSetDef([["StatA", "Artifact", 10]], 3, []) };
    delete def.AugSet.fits_slots;
    const model = {
      targets: ["StatA"], mlCap: 34, dodgeCap: null, augment_set_defs: def,
      worn: [slot("Ring", [host("H1", "Ring", [], ["Colorless"])]),
             slot("Necklace", [host("H2", "Necklace", [], ["Colorless"])]),
             slot("Trinket", [host("H3", "Trinket", [], ["Colorless"])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.StatA, 0, "no matrix -> no copies -> no bonus");
    assert.strictEqual((r.setAugmentsPlaced || []).length, 0);
  });

  await test("#316/AE2: on ties, every copy prefers the Colorless slot", async () => {
    // Each host exposes a free Colorless AND a free Yellow slot; totals are
    // identical either way, so the final stage must land every copy Colorless.
    const def = { "AugSet": augSetDef([["StatA", "Artifact", 10]]) };
    const model = {
      targets: ["StatA"], mlCap: 34, dodgeCap: null, augment_set_defs: def,
      worn: [slot("Ring", [host("H1", "Ring", [], ["Colorless", "Yellow"])]),
             slot("Necklace", [host("H2", "Necklace", [], ["Colorless", "Yellow"])]),
             slot("Trinket", [host("H3", "Trinket", [], ["Colorless", "Yellow"])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.StatA, 10);
    const placed = r.setAugmentsPlaced || [];
    assert.strictEqual(placed.length, 3);
    for (const sa of placed) assert.strictEqual(sa.slot_color, "Colorless",
      `${sa.host} landed ${sa.slot_color}, expected Colorless on a tie`);
    assert.strictEqual((r.augmentsPlaced || []).length, 0, "the stage adds no placements");
  });

  await test("#316: Colorless-first is a preference, not a rule — forced colored slots stay colored", async () => {
    // Discriminator twin (stops the AE2 test passing vacuously against a stage
    // that hardcodes Colorless): two hosts expose no Colorless at all, so their
    // copies MUST keep their colored slots while H1's takes the Colorless.
    const def = { "AugSet": augSetDef([["StatA", "Artifact", 10]]) };
    const model = {
      targets: ["StatA"], mlCap: 34, dodgeCap: null, augment_set_defs: def,
      worn: [slot("Ring", [host("H1", "Ring", [], ["Colorless"])]),
             slot("Necklace", [host("H2", "Necklace", [], ["Yellow"])]),
             slot("Trinket", [host("H3", "Trinket", [], ["Green"])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.StatA, 10);
    const byHost = Object.fromEntries((r.setAugmentsPlaced || []).map((s) => [s.host, s.slot_color]));
    assert.deepStrictEqual(byHost, { H1: "Colorless", H2: "Yellow", H3: "Green" });
  });

  await test("#316: the Colorless preference never displaces a pinned ordinary augment", async () => {
    // An ordinary Yellow augment (fits Yellow/Orange/Green, never Colorless)
    // shares the hosts. Copies prefer Colorless, which leaves a Yellow slot for
    // the ordinary augment — both priorities are fully served, and the stage's
    // ordinary-placement pins guarantee StatB cannot be traded away.
    const def = { "AugSet": augSetDef([["StatA", "Artifact", 10]]) };
    const model = {
      targets: ["StatA", "StatB"], mlCap: 34, dodgeCap: null, augment_set_defs: def,
      augments: [augment("ordY", "Yellow", [["StatB", "Enhancement", 7]])],
      worn: [slot("Ring", [host("H1", "Ring", [], ["Colorless", "Yellow"])]),
             slot("Necklace", [host("H2", "Necklace", [], ["Colorless", "Yellow"])]),
             slot("Trinket", [host("H3", "Trinket", [], ["Colorless", "Yellow"])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.StatA, 10, "3 copies placed");
    assert.strictEqual(r.effective.StatB, 7, "the ordinary Yellow augment still lands");
    for (const sa of r.setAugmentsPlaced || []) {
      assert.strictEqual(sa.slot_color, "Colorless", "copies take Colorless, freeing Yellow");
    }
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

  await test("U4/#312: ONE copy per host — a second Colorless slot buys no second set identity", async () => {
    // Re-ratified for #312. Each set augment's own description states the rule:
    // "Slotting this Augment in any Augment Slot will override its Set Bonus to
    // the <X> set" — an item's Set Bonus identity is SINGLE, so a second copy on
    // the same item overrides the first and only the last counts in-game. The
    // pre-#312 model let item i (2 Colorless slots) host an AugA copy AND an
    // AugB copy and progress BOTH sets — the reported double-dip, one shape over.
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
    assert.strictEqual(r.effective.StatA, 10, "AugA 3-piece fires");
    assert.strictEqual(r.effective.StatB, 0,
      "only four non-i Colorless slots exist and i grants ONE identity, so a second aug set cannot reach 3");
    assert.strictEqual((r.setAugmentsPlaced || []).length, 3,
      "3 copies placed (partial AugB copies buy nothing; tie-break minimizes y)");
    // The solver routes AugA through the set-less hosts and PRESERVES SetS —
    // one-copy-per-host makes double-dipping impossible, and the lexicographic
    // solve then finds the strictly better arrangement the old model never
    // needed to look for.
    assert.strictEqual(r.effective.StatS, 50, "SetS fires (i + P2); no copy lands on i");
    assert.ok(!(r.setAugmentsPlaced || []).some((p) => p.host === "i"),
      "the SetS member hosts no copy — its set identity stays native");
  });

  await test("U4/#312: an AWAKENED membership and a hosted copy are mutually exclusive on one item", async () => {
    // The reported repro: a Lost Purpose hat awakened into Forbidden Knowledge
    // (chosen membership) while hosting a Perfect Silence copy counted toward
    // BOTH sets. The wiki rule overrides the host's Set Bonus — awakened or
    // native — so one item carries one set identity. The fixture makes host M
    // load-bearing for both sets; only the higher-ranked one may win.
    const def = { "AugSet": augSetDef([["StatA", "Artifact", 10]]) };
    const memDefs = { "MemSet": memberDef([{ n: 2, affixes: [["StatM", "Artifact", 50]] }]) };
    const model = {
      targets: ["StatM", "StatA"], mlCap: 34, dodgeCap: null,
      augment_set_defs: def, membershipSetDefs: memDefs,
      worn: [
        // M: the only awaken host for MemSet AND one of only three Colorless hosts.
        slot("Helmet", [(() => { const v = memberHost("M", "Helmet", ["MemSet"]);
                                 // the solver reads the NORMALIZED colors, not the raw list
                                 v.augment_slots_norm = { colors: ["Colorless"], quarantined: [] };
                                 return v; })()]),
        // MemSet's second piece: another awaken host (no Colorless slot).
        slot("Gloves", [memberHost("P2", "Gloves", ["MemSet"])]),
        // AugSet's other two hosts.
        slot("Necklace", [host("H2", "Necklace", [], ["Colorless"])]),
        slot("Trinket", [host("H3", "Trinket", [], ["Colorless"])]),
      ],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective.StatM, 50, "higher-ranked awakened set is kept (M + P2 awaken)");
    assert.strictEqual(r.effective.StatA, 0,
      "the augment set would need M's Colorless slot, but M's set identity is spent on the awakening");
    assert.ok((r.membershipPlaced || []).some((m) => m.host === "M"), "M's awakening is reported");
    assert.ok(!(r.setAugmentsPlaced || []).some((p) => p.host === "M"), "no copy on the awakened host");
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

  // ── U2 (#290/#291) — cross-add crediting ─────────────────────────────────
  // The wiki rule: the universal stats FULLY STACK — Universal Spell Power
  // flat-adds to every element spellpower's value, and Spell Lore + Universal
  // Spell Lore flat-add to every element lore. Buckets stay per-(stat, bonus-
  // type) max INTERNALLY; cross-add sums ACROSS buckets (the element's own plus
  // each source stat's), never merging them. Each test installs its own map via
  // the withCrossAdd helper (model.js setCrossAdd, the load seam dataset.js
  // drives), which always resets after.

  await test("U2 cross-add: an element priority counts Universal Spell Power buckets (100 + 50 = 150)", async () => {
    return withCrossAdd({ Combustion: ["Universal Spell Power"] }, async () => {
      const model = {
        targets: ["Combustion"], mlCap: 34, dodgeCap: null,
        worn: [
          slot("Ring", [item("elem", "Ring", [["Combustion", "Equipment", 100]])]),
          slot("Necklace", [item("usp", "Necklace", [["Universal Spell Power", "Implement", 50]])]),
        ],
      };
      const r = await S.solveLexicographic(model, highs);
      assert.strictEqual(r.status, "optimal");
      assert.strictEqual(r.effective.Combustion, 150, "element Equipment 100 + USP Implement 50 cross-add");
      assert.strictEqual(r.chosen.length, 2, "both the element item and the USP item are equipped");
    });
  });

  await test("U2 cross-add lore: Void Lore credits Spell Lore + Universal Spell Lore on one item (13 + 5 = 18, names never merged)", async () => {
    // The Undying-Age co-occurrence shape: ONE item carrying Spell Lore
    // Equipment 13 AND Universal Spell Lore Exceptional 5. The two universal
    // NAMES are distinct source stats whose buckets both cross-add into the
    // element lore — merging them into one name would collapse to max(13,5).
    return withCrossAdd({ "Void Lore": ["Spell Lore", "Universal Spell Lore"] }, async () => {
      const model = {
        targets: ["Void Lore"], mlCap: 34, dodgeCap: null,
        worn: [slot("Trinket", [item("undying", "Trinket", [
          ["Spell Lore", "Equipment", 13],
          ["Universal Spell Lore", "Exceptional", 5],
        ])])],
      };
      const r = await S.solveLexicographic(model, highs);
      assert.strictEqual(r.status, "optimal");
      assert.strictEqual(r.effective["Void Lore"], 18, "13 (Spell Lore|Equipment) + 5 (Universal Spell Lore|Exceptional)");
    });
  });

  await test("U2 cross-add breakdown: cross-added parts carry crossAdd naming the source stat; own parts carry none", async () => {
    return withCrossAdd({ Combustion: ["Universal Spell Power"] }, async () => {
      const model = {
        targets: ["Combustion"], mlCap: 34, dodgeCap: null,
        worn: [
          slot("Ring", [item("elem", "Ring", [["Combustion", "Equipment", 100]])]),
          slot("Necklace", [item("usp", "Necklace", [["Universal Spell Power", "Implement", 50]])]),
        ],
      };
      const r = await S.solveLexicographic(model, highs);
      const parts = r.breakdown.Combustion || [];
      const own = parts.find((p) => p.value === 100);
      assert.ok(own, "the element's own Equipment part is present");
      assert.ok(!own.crossAdd, "the element's own part carries no crossAdd marker");
      const xa = parts.find((p) => p.value === 50);
      assert.ok(xa, "the cross-added USP part appears under the element target");
      assert.strictEqual(xa.crossAdd, "Universal Spell Power", "the marker names the SOURCE stat");
      assert.strictEqual(xa.bonus_type, "Implement", "the part keeps its own bucket's bonus type");
      assert.strictEqual(xa.source, "usp", "attributed to the item that carries it");
    });
  });

  await test("U2 cross-add: two USP sources of the SAME bonus type still collapse to the higher (max within the source's bucket)", async () => {
    return withCrossAdd({ Combustion: ["Universal Spell Power"] }, async () => {
      const model = {
        targets: ["Combustion"], mlCap: 34, dodgeCap: null,
        worn: [
          slot("Ring", [item("uspHi", "Ring", [["Universal Spell Power", "Implement", 50]])]),
          slot("Necklace", [item("uspLo", "Necklace", [["Universal Spell Power", "Implement", 30]])]),
        ],
      };
      const r = await S.solveLexicographic(model, highs);
      assert.strictEqual(r.status, "optimal");
      assert.strictEqual(r.effective.Combustion, 50,
        "cross-add sums ACROSS buckets but never merges them: within USP||Implement only the higher counts");
    });
  });

  await test("U2 cross-add: USP Implement + USP Exceptional both count, and element Equipment adds on top", async () => {
    return withCrossAdd({ Combustion: ["Universal Spell Power"] }, async () => {
      const model = {
        targets: ["Combustion"], mlCap: 34, dodgeCap: null,
        worn: [
          slot("Ring", [item("uspImp", "Ring", [["Universal Spell Power", "Implement", 50]])]),
          slot("Necklace", [item("uspExc", "Necklace", [["Universal Spell Power", "Exceptional", 20]])]),
          slot("Trinket", [item("elem", "Trinket", [["Combustion", "Equipment", 100]])]),
        ],
      };
      const r = await S.solveLexicographic(model, highs);
      assert.strictEqual(r.effective.Combustion, 170, "100 (own Equipment) + 50 (USP Implement) + 20 (USP Exceptional)");
    });
  });

  await test("U2 cross-add: ranking BOTH the element and Universal Spell Power stays feasible; each target reports the shared source (double display)", async () => {
    // The shared z-vars appear in both stats' expressions — the same var carries
    // the same value into both stage locks, so the lexicographic locks are
    // mutually consistent. Each reported target total includes the shared
    // source, matching the in-game summary screen (element values are shown
    // AFTER universal is added).
    return withCrossAdd({ Nullification: ["Universal Spell Power"] }, async () => {
      const model = {
        targets: ["Nullification", "Universal Spell Power"], mlCap: 34, dodgeCap: null,
        worn: [
          slot("Ring", [item("elem", "Ring", [["Nullification", "Equipment", 100]])]),
          slot("Necklace", [item("usp", "Necklace", [["Universal Spell Power", "Implement", 50]])]),
        ],
      };
      const r = await S.solveLexicographic(model, highs);
      assert.strictEqual(r.status, "optimal", "shared vars in two locks never conflict");
      assert.strictEqual(r.perTarget.Nullification, 150, "the element target includes the shared USP source");
      assert.strictEqual(r.perTarget["Universal Spell Power"], 50, "the USP target reports its own value");
    });
  });

  await test("U2 cross-add: a cap on the ELEMENT stat clamps the combined element+USP value", async () => {
    return withCrossAdd({ Combustion: ["Universal Spell Power"] }, async () => {
      const model = {
        targets: ["Combustion"], mlCap: 34, dodgeCap: null, userCaps: { Combustion: 120 },
        worn: [
          slot("Ring", [item("elem", "Ring", [["Combustion", "Equipment", 100]])]),
          slot("Necklace", [item("usp", "Necklace", [["Universal Spell Power", "Implement", 50]])]),
        ],
      };
      const r = await S.solveLexicographic(model, highs);
      assert.strictEqual(r.effective.Combustion, 120, "min(cap 120, combined 150) — the cap sees the cross-added total");
    });
  });

  await test("U2 cross-add: a floor on the ELEMENT stat is satisfiable via USP sources alone", async () => {
    return withCrossAdd({ Combustion: ["Universal Spell Power"] }, async () => {
      const model = {
        targets: ["Accuracy"], mlCap: 34, dodgeCap: null, floors: { Combustion: 40 },
        worn: [
          slot("Ring", [item("acc", "Ring", [["Accuracy", "Enhancement", 10]])]),
          slot("Necklace", [item("usp", "Necklace", [["Universal Spell Power", "Implement", 50]])]),
        ],
      };
      const r = await S.solveLexicographic(model, highs);
      assert.strictEqual(r.status, "optimal");
      assert.deepStrictEqual(r.floorReport, [], "the floor is met — by cross-added USP, with no Combustion gear at all");
      assert.ok(r.chosen.some((c) => c.variant.variant_id === "usp"), "the USP item is equipped to carry the floor");
      assert.strictEqual(r.effective.Accuracy, 10, "the priority is still maximized");
    });
  });

  await test("U2 cross-add SEMANTIC PIN: a cap on the SOURCE stat governs only the source's own target; the element still counts raw source buckets", async () => {
    // Chosen semantic (mirrors per-stat cap behavior): a cap clamps the capped
    // stat's OWN reported/locked expression (d_<stat>), not the raw buckets other
    // stats cross-add. A player capping Universal Spell Power at 10 while ranking
    // an element sees USP report 10, while the element total still includes the
    // full raw USP contribution (the cap is a display/lock clamp on USP's target,
    // not a rewrite of the shared z-vars).
    return withCrossAdd({ Combustion: ["Universal Spell Power"] }, async () => {
      const model = {
        targets: ["Combustion", "Universal Spell Power"], mlCap: 34, dodgeCap: null,
        userCaps: { "Universal Spell Power": 10 },
        worn: [
          slot("Ring", [item("elem", "Ring", [["Combustion", "Equipment", 100]])]),
          slot("Necklace", [item("usp", "Necklace", [["Universal Spell Power", "Implement", 50]])]),
        ],
      };
      const r = await S.solveLexicographic(model, highs);
      assert.strictEqual(r.status, "optimal");
      assert.strictEqual(r.perTarget.Combustion, 150, "the element counts the RAW source buckets (uncapped)");
      assert.strictEqual(r.perTarget["Universal Spell Power"], 10, "the source's own target is clamped by its cap");
    });
  });

  await test("U2 cross-add: saturationReport spans source-stat buckets — labeled by their own type, no double-count, a beaten USP source reads as unused", async () => {
    // The element's census includes its cross-add source buckets, exactly as the
    // headline total does. The beaten USP 30 shares the winning USP 50's bucket,
    // so it is an unused source FOR the element — reported the same way a beaten
    // own-bucket source is, and never added into the total.
    return withCrossAdd({ Combustion: ["Universal Spell Power"] }, async () => {
      const model = {
        targets: ["Combustion"], mlCap: 34, dodgeCap: null,
        worn: [
          slot("Ring", [item("elem", "Ring", [["Combustion", "Equipment", 100]])]),
          slot("Necklace", [item("uspHi", "Necklace", [["Universal Spell Power", "Implement", 50]]),
                            item("uspLo", "Necklace", [["Universal Spell Power", "Implement", 30]])]),
        ],
      };
      const r = await S.solveLexicographic(model, highs);
      assert.strictEqual(r.status, "optimal");
      const e = (r.saturationReport || []).find((x) => x.stat === "Combustion");
      assert.ok(e, "the element is reported saturated — its census reaches into the source stat's buckets");
      assert.strictEqual(e.total, 150, "100 + 50; the beaten uspLo is never added (no double-count)");
      assert.deepStrictEqual(e.bonusTypes.slice().sort(), ["Equipment", "Implement"],
        "the source bucket is labeled with the SOURCE stat's own bonus type, exactly as an own bucket would be");
      assert.strictEqual(e.unusedSources, 1,
        "the beaten USP 30 counts as an unused source for the element, the way a beaten own-bucket source does");
    });
  });

  await test("U2 cross-add: a credit on the ELEMENT stat contests only its own exact bucket; a same-typed USP source neither beats nor inflates it", async () => {
    // The credit's bucket is the exact `Combustion||Implement` key — the USP item's
    // Implement 50 lives in `Universal Spell Power||Implement`, a different bucket,
    // so it can never read as gear the credit beat, and the two stack (USP fully
    // stacks). gearInLoadout deliberately spans the cross-add source buckets,
    // matching what the headline total counts (solver.js U2 comment).
    return withCrossAdd({ Combustion: ["Universal Spell Power"] }, async () => {
      const model = {
        targets: ["Combustion"], mlCap: 34, dodgeCap: null,
        credits: [credit("Combustion", "Implement", 20)],
        worn: [
          slot("Ring", [item("elem", "Ring", [["Combustion", "Equipment", 100]])]),
          slot("Necklace", [item("usp", "Necklace", [["Universal Spell Power", "Implement", 50]])]),
        ],
      };
      const r = await S.solveLexicographic(model, highs);
      assert.strictEqual(r.status, "optimal");
      assert.strictEqual(r.effective.Combustion, 170, "100 own + 50 cross-added + 20 credit — three buckets, all stack");
      const e = (r.creditReport || []).find((c) => c.stat === "Combustion");
      assert.ok(e, "the credit is reported");
      assert.strictEqual(e.won, true, "the credit wins its own (otherwise empty) Combustion||Implement bucket");
      assert.strictEqual(e.beatGear, null,
        "the USP Implement 50 is NOT gear the credit beat — the exact stat||type key keeps source-stat buckets out of the contest");
      const gearSum = r.breakdown.Combustion.filter((p) => p.sourceKind !== "declared")
        .reduce((n, p) => n + p.value, 0);
      assert.strictEqual(e.gearInLoadout, gearSum,
        "gearInLoadout matches the shown loadout's non-declared breakdown, cross-added sources included");
      assert.strictEqual(e.gearInLoadout, 150, "…which is 100 + 50, never the credit");
    });
  });

  await test("U2 cross-add: a credit declared ON the source stat flows into the element with its declared labeling intact", async () => {
    return withCrossAdd({ Combustion: ["Universal Spell Power"] }, async () => {
      const model = {
        targets: ["Combustion"], mlCap: 34, dodgeCap: null,
        credits: [credit("Universal Spell Power", "Sacred", 25)],
        worn: [slot("Ring", [item("elem", "Ring", [["Combustion", "Equipment", 100]])])],
      };
      const r = await S.solveLexicographic(model, highs);
      assert.strictEqual(r.status, "optimal");
      assert.strictEqual(r.perTarget.Combustion, 125,
        "USP fully stacks: the credited 25 counts in the element's target even though only USP was declared");
      const part = (r.breakdown.Combustion || []).find((p) => p.sourceKind === "declared");
      assert.ok(part, "the credited part appears under the element's breakdown");
      assert.strictEqual(part.value, 25);
      assert.strictEqual(part.crossAdd, "Universal Spell Power", "the part is marked cross-added from the SOURCE stat");
      assert.strictEqual(part.bonus_type, "Sacred", "and keeps the credit's own bucket type");
      assert.strictEqual(part.source, "declared, not from gear", "the credit's source labeling is intact");
      const e = (r.creditReport || []).find((c) => c.stat === "Universal Spell Power");
      assert.ok(e, "the source-stat credit is reported under its own stat");
      assert.strictEqual(e.won, true, "it won its (empty) USP||Sacred bucket");
      assert.strictEqual(e.gearInLoadout, 0, "no USP gear is worn; the element's Equipment 100 is not USP gear");
    });
  });

  await test("regression: a user cap on a MULTI-WORD stat solves (LP-safe d-var name, was a HiGHS parse crash)", async () => {
    // Pre-existing, independent of cross-add: `d_${stat}` minted an LP variable
    // containing spaces for any multi-word capped stat ("Physical Sheltering",
    // "Universal Spell Power"), and HiGHS aborted the whole solve with
    // "Unable to read LP model". Exposed by the U2 source-stat cap pin; fixed by
    // dVar()'s non-alphanumeric mapping. No cross-add map involved here.
    const model = {
      targets: ["Physical Sheltering"], mlCap: 34, dodgeCap: null,
      userCaps: { "Physical Sheltering": 25 },
      worn: [slot("Ring", [item("prr", "Ring", [["Physical Sheltering", "Enhancement", 60]])])],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.status, "optimal", "must not crash on the space-bearing cap var");
    assert.strictEqual(r.effective["Physical Sheltering"], 25, "clamped to the user cap");
  });

  await test("U2 cross-add: with NO map installed the solve is identical to the pre-change solver", async () => {
    CAM.setCrossAdd({}); // explicit uninstalled state
    const model = {
      targets: ["Combustion"], mlCap: 34, dodgeCap: null,
      worn: [
        slot("Ring", [item("elem", "Ring", [["Combustion", "Equipment", 100]])]),
        slot("Necklace", [item("usp", "Necklace", [["Universal Spell Power", "Implement", 50]])]),
      ],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.deepStrictEqual(r.perTarget, { Combustion: 100 }, "no cross-add: the element counts only its own buckets");
    assert.deepStrictEqual(r.chosen.map((c) => c.variant.variant_id), ["elem"],
      "the USP item is not even a candidate (no bucket), exactly as before the change");
  });

  // ---- #319 load-bearing report guards for the eight *Placed families ----
  // A placement var can float to 1 on any solve path that does not minimize it
  // (every tieBreak:false alternatives re-solve; the seven craft families even
  // on the optimum path). The reader must report a placement only when some
  // contribution it gates actually fired. These tests inject a synthetic primal
  // straight into readSolution (exported for tests) so the float is
  // DETERMINISTIC — a real tieBreak:false solve floats only at HiGHS's whim.
  function guardModel() {
    const dinoHostV = item("DINO-H", "Ring", []);
    dinoHostV.dino_slots_norm = ["Fang||Accessory"];
    const ncHostV = item("NC-H", "Neck", []);
    ncHostV.nearly_complete = "Scales"; ncHostV.ml = 20;
    const rollHostV = item("ROLL-H", "Boots", []);
    rollHostV.roll_groups = [{ options: [{ stat: "Melee Power", bonus_type: "Insightful", value: 3, unit: "flat" }] }];
    const vikHostV = vikHost("VIK-H", "Trinket", [{ type: "Melancholic", category: "Accessory" }], 35);
    const sealHostV = item("SEAL-H", "Belt", []);
    sealHostV.seal_slots = [{ seal_type: "Undeath", category: "Jewelry" }];
    const tfHostV = tfHost("TF-H", "Main Hand", [1]);
    const gsHostV = item("GS-H", "Gloves", []);
    gsHostV.green_steel_slot = true;
    const augHostV = host("AUG-H", "Helmet", [], ["Colorless"]);
    return {
      targets: ["Melee Power", "Strength"], mlCap: 36, dodgeCap: null,
      worn: [slot("Ring", [dinoHostV]), slot("Neck", [ncHostV]), slot("Boots", [rollHostV]),
             slot("Trinket", [vikHostV]), slot("Belt", [sealHostV]), slot("Main Hand", [tfHostV]),
             slot("Gloves", [gsHostV]), slot("Helmet", [augHostV])],
      dinoInserts: [{ dino_type: "Fang", category: "Accessory", name: "Sharp Fang",
        affixes: [{ stat: "Melee Power", bonus_type: "Artifact", value: 5, unit: "flat" },
                  { stat: "Strength", bonus_type: "Artifact", value: 2, unit: "flat" }] }],
      nearlyComplete: [{ category: "Scales", tier: "heroic", stat: "Melee Power", bonus_type: "Enhancement", value: 5, unit: "flat" }],
      viktranium: [vikOpt("Melancholic", "Accessory", "Melee Power", "Quality", 4, "legendary")],
      seal: [{ seal_type: "Undeath", stat: "Melee Power", bonus_type: "Profane", value: 3, unit: "flat" }],
      thunderForged: [tfOpt(1, "Melee Power", "Exceptional", 2)],
      greenSteel: [{ name: "Ethereal", stat: "Melee Power", bonus_type: "Sacred", value: 4, unit: "flat" }],
      augments: [augment("MPGem", "Colorless", [["Melee Power", "Enhancement", 6]])],
    };
  }
  // every z contribution gated by `g`, and a synthetic primal setting the named vars to 1
  function zsForGate(program, g) {
    const out = [];
    for (const [, zs] of program.zByBucket) for (const z of zs) if (z.gates.includes(g)) out.push(z.name);
    return out;
  }
  function primalOf(names) {
    return { Columns: Object.fromEntries(names.map((n) => [n, { Primal: 1 }])) };
  }

  await test("#319 guards: a floated craft var (no fired contribution) is omitted from all seven families", async () => {
    const program = S.buildProgram(guardModel());
    const fams = [["dinoMeta", "dinoPlaced"], ["ncMeta", "ncPlaced"], ["rollMeta", "rollPlaced"],
                  ["vikMeta", "vikPlaced"], ["sealMeta", "sealPlaced"], ["tfMeta", "tfPlaced"], ["gsMeta", "gsPlaced"]];
    for (const [metaKey, arrKey] of fams) {
      const metaMap = program[metaKey];
      assert.ok(metaMap && metaMap.size >= 1, `${metaKey} minted at least one var`);
      const v = [...metaMap.keys()][0];
      const floated = S.readSolution(primalOf([v]), program);
      assert.strictEqual((floated[arrKey] || []).length, 0, `${arrKey}: var=1 with no fired contribution is omitted`);
      assert.strictEqual(floated.effective["Melee Power"], 0, `${arrKey}: totals agree (nothing fired)`);
      const zs = zsForGate(program, v);
      assert.ok(zs.length >= 1, `${metaKey} var has a gated contribution`);
      const fired = S.readSolution(primalOf([v, zs[0]]), program);
      assert.strictEqual((fired[arrKey] || []).length, 1, `${arrKey}: var=1 with its contribution fired IS reported`);
    }
  });

  await test("#319 guards: a multi-affix placement is load-bearing when ANY of its contributions fires", async () => {
    const program = S.buildProgram(guardModel());
    const q = [...program.dinoMeta.keys()][0];
    const zs = zsForGate(program, q);
    assert.strictEqual(zs.length, 2, "the two-affix Dino insert gates two contributions");
    const r = S.readSolution(primalOf([q, zs[1]]), program);
    assert.strictEqual((r.dinoPlaced || []).length, 1, "one fired contribution of two keeps the placement reported");
  });

  await test("#319 guards: an augment color entry is omitted unless its placement identity fired", async () => {
    const program = S.buildProgram(guardModel());
    const p = [...program.augMeta.keys()][0];
    const pu = [...program.placeMeta.keys()][0];
    // value gates ride on pu, not p — a float sets both (Σp = pu) yet fires no z
    const floated = S.readSolution(primalOf([p, pu]), program);
    assert.strictEqual((floated.augmentsPlaced || []).length, 0, "floated augment placement is omitted");
    const zs = zsForGate(program, pu);
    assert.ok(zs.length >= 1, "the augment's identity var gates a contribution");
    const fired = S.readSolution(primalOf([p, pu, zs[0]]), program);
    assert.strictEqual((fired.augmentsPlaced || []).length, 1, "fired augment placement is reported");
    assert.strictEqual(fired.augmentsPlaced[0].slot_color, "Colorless", "color meta intact");
  });

  await test("#319 guards: only the fired augment of two placed is reported (identity join is per-variant)", async () => {
    const m = {
      targets: ["Melee Power", "Strength"], mlCap: 36, dodgeCap: null,
      worn: [slot("Helmet", [host("AUG-H2", "Helmet", [], ["Colorless", "Colorless"])])],
      augments: [augment("GemA", "Colorless", [["Melee Power", "Enhancement", 6]]),
                 augment("GemB", "Colorless", [["Strength", "Insightful", 3]])],
    };
    const program = S.buildProgram(m);
    const pOf = (vid) => [...program.augMeta].find(([, mm]) => mm.variant_id === vid)[0];
    const puOf = (vid) => [...program.placeMeta].find(([, mm]) => mm.variant_id === vid)[0];
    const zA = zsForGate(program, puOf("GemA"))[0];
    const r = S.readSolution(primalOf([pOf("GemA"), puOf("GemA"), zA, pOf("GemB"), puOf("GemB")]), program);
    assert.strictEqual((r.augmentsPlaced || []).length, 1, "only one of the two placed augments is reported");
    assert.strictEqual(r.augmentsPlaced[0].variant_id, "GemA", "the fired one");
  });

  await test("#319 guards hold on a real tieBreak:false solve; fewer-crafts counting sees no floats", async () => {
    // Ranked-but-redundant crafts: every craft option's stat IS ranked but is
    // outvalued by a larger same-bucket worn source, so the placement vars exist
    // (buildProgram's target gate admits them) while their gated z loses the
    // bucket and stays 0 — the float shape reachable on every alternatives
    // re-solve. If HiGHS happens not to float here, this test still pins the
    // guarded behavior (the deterministic #319 tests above carry the red proof).
    const armor = item("BIG", "Armor", [["Melee Power", "Artifact", 20], ["Melee Power", "Enhancement", 15]]);
    const craftHost = host("CH", "Ring", [], ["Colorless"]);
    craftHost.dino_slots_norm = ["Fang||Accessory"];
    craftHost.seal_slots = [{ seal_type: "Undeath", category: "Jewelry" }];
    craftHost.green_steel_slot = true;
    craftHost.nearly_complete = "Scales";
    craftHost.roll_groups = [{ options: [{ stat: "Melee Power", bonus_type: "Artifact", value: 2, unit: "flat" }] }];
    craftHost.lamordia_slots = [{ type: "Melancholic", category: "Accessory" }];
    craftHost.thunder_forged_tiers = [{ tier: 1 }];
    craftHost.minimum_level = craftHost.ml = 20; // heroic nc + lamordia tiers
    const model = {
      targets: ["Melee Power"], mlCap: 36, dodgeCap: null,
      worn: [slot("Armor", [armor]), slot("Ring", [craftHost])],
      dinoInserts: [{ dino_type: "Fang", category: "Accessory", name: "Dull Fang",
        affixes: [{ stat: "Melee Power", bonus_type: "Artifact", value: 5, unit: "flat" }] }],
      nearlyComplete: [{ category: "Scales", tier: "heroic", stat: "Melee Power", bonus_type: "Artifact", value: 2, unit: "flat" }],
      viktranium: [vikOpt("Melancholic", "Accessory", "Melee Power", "Artifact", 2, "heroic")],
      seal: [{ seal_type: "Undeath", stat: "Melee Power", bonus_type: "Artifact", value: 3, unit: "flat" }],
      thunderForged: [tfOpt(1, "Melee Power", "Artifact", 2)],
      greenSteel: [{ name: "Dim", stat: "Melee Power", bonus_type: "Artifact", value: 4, unit: "flat" }],
      augments: [augment("DimGem", "Colorless", [["Melee Power", "Enhancement", 6]])],
    };
    const program = S.buildProgram(model);
    for (const mk of ["augMeta", "dinoMeta", "ncMeta", "rollMeta", "vikMeta", "sealMeta", "tfMeta", "gsMeta"]) {
      assert.ok(program[mk] && program[mk].size >= 1, `${mk} minted at least one var (fixture is non-vacuous)`);
    }
    const r = S.solveConstrained(program, highs, { objectiveStat: "Melee Power", sense: "max", tieBreak: false });
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective["Melee Power"], 35, "worn sources win both buckets");
    for (const k of ["augmentsPlaced", "dinoPlaced", "ncPlaced", "rollPlaced", "vikPlaced", "sealPlaced", "tfPlaced", "gsPlaced"]) {
      assert.strictEqual((r[k] || []).length, 0, `${k}: no phantom placement on the tieBreak:false path`);
    }
    const A = require("../web/alternatives.js");
    assert.strictEqual(A.craftCount(r), 0, "fewer-crafts counting sees zero crafts");
  });

  // ---- #322 fired-but-invisible report guards (cap clamping + credit substitution) ----
  // A placement whose gated z FIRED can still be invisible in the displayed
  // outcome: clamped out by a stat cap, or merely substituting for a declared
  // credit. Same synthetic-primal seam as the #319 block above; the Dino family
  // stands in for all guarded families (they share visibleGateSet).
  function invisModel({ wornAffixes, dinoAffixes, userCaps, credits }) {
    const dinoHostV = item("DINO-H", "Ring", []);
    dinoHostV.dino_slots_norm = ["Fang||Accessory"];
    return {
      targets: ["Melee Power", "Strength"], mlCap: 36, dodgeCap: null,
      userCaps, credits,
      worn: [slot("Armor", [item("BIGMP", "Armor", wornAffixes || [])]), slot("Ring", [dinoHostV])],
      dinoInserts: [{ dino_type: "Fang", category: "Accessory", name: "Test Fang", affixes: dinoAffixes }],
    };
  }
  const xOf = (program, vid) => program.xVars.find((xv) => xv.variant.variant_id === vid).name;

  await test("#322 guards: a placement clamped out by a stat cap is omitted and moves no total", async () => {
    const program = S.buildProgram(invisModel({
      wornAffixes: [["Melee Power", "Enhancement", 20]],
      dinoAffixes: [{ stat: "Melee Power", bonus_type: "Artifact", value: 5, unit: "flat" }],
      userCaps: { "Melee Power": 15 },
    }));
    assert.strictEqual(program.cappedStats["Melee Power"], 15, "cap minted");
    assert.strictEqual(program.dinoMeta.size, 1, "dino placement minted");
    const q = [...program.dinoMeta.keys()][0];
    const zq = zsForGate(program, q);
    assert.strictEqual(zq.length, 1, "the insert gates one contribution");
    const xa = xOf(program, "BIGMP");
    const za = zsForGate(program, xa);
    assert.strictEqual(za.length, 1, "the worn item gates one contribution");
    // raw = 20 + 5 = 25, cap 15: raw - 5 = 20 >= 15, so the placement is clamped out.
    const r = S.readSolution(primalOf([xa, za[0], q, zq[0]]), program);
    assert.strictEqual((r.dinoPlaced || []).length, 0, "fired-but-clamped-out placement is omitted");
    assert.strictEqual(r.effective["Melee Power"], 15, "total sits at the cap");
    const rWithout = S.readSolution(primalOf([xa, za[0], q]), program);
    assert.strictEqual(rWithout.effective["Melee Power"], r.effective["Melee Power"],
      "the craft z changes no displayed total (that is WHY it is omitted)");
  });

  await test("#322 guards: the same placement with raw under the cap reports", async () => {
    const program = S.buildProgram(invisModel({
      wornAffixes: [["Melee Power", "Enhancement", 8]],
      dinoAffixes: [{ stat: "Melee Power", bonus_type: "Artifact", value: 5, unit: "flat" }],
      userCaps: { "Melee Power": 15 },
    }));
    assert.strictEqual(program.cappedStats["Melee Power"], 15, "cap minted");
    const q = [...program.dinoMeta.keys()][0];
    const zq = zsForGate(program, q);
    const xa = xOf(program, "BIGMP");
    // raw = 8 + 5 = 13 < 15: removing the insert would lower the displayed total.
    const r = S.readSolution(primalOf([xa, zsForGate(program, xa)[0], q, zq[0]]), program);
    assert.strictEqual((r.dinoPlaced || []).length, 1, "under-cap placement reports");
    assert.strictEqual(r.effective["Melee Power"], 13, "raw under the cap");
  });

  await test("#322 guards: multi-affix placement with one clamped and one visible contribution reports (R3)", async () => {
    const program = S.buildProgram(invisModel({
      wornAffixes: [["Melee Power", "Enhancement", 20]],
      dinoAffixes: [{ stat: "Melee Power", bonus_type: "Artifact", value: 5, unit: "flat" },
                    { stat: "Strength", bonus_type: "Artifact", value: 2, unit: "flat" }],
      userCaps: { "Melee Power": 15 },
    }));
    assert.strictEqual(program.cappedStats["Melee Power"], 15, "cap minted");
    const q = [...program.dinoMeta.keys()][0];
    const zq = zsForGate(program, q);
    assert.strictEqual(zq.length, 2, "the two-affix insert gates two contributions");
    const xa = xOf(program, "BIGMP");
    const r = S.readSolution(primalOf([xa, zsForGate(program, xa)[0], q, ...zq]), program);
    assert.strictEqual((r.dinoPlaced || []).length, 1,
      "SOME visible contribution (uncapped Strength) keeps the placement reported");
  });

  await test("#322 guards: two contributions jointly holding a capped stat at cap keep their placement (sum test, R1)", async () => {
    const program = S.buildProgram(invisModel({
      wornAffixes: [["Melee Power", "Enhancement", 12]],
      dinoAffixes: [{ stat: "Melee Power", bonus_type: "Artifact", value: 5, unit: "flat" },
                    { stat: "Melee Power", bonus_type: "Profane", value: 4, unit: "flat" }],
      userCaps: { "Melee Power": 15 },
    }));
    assert.strictEqual(program.cappedStats["Melee Power"], 15, "cap minted");
    const q = [...program.dinoMeta.keys()][0];
    const zq = zsForGate(program, q);
    assert.strictEqual(zq.length, 2, "the insert gates two same-stat contributions");
    const xa = xOf(program, "BIGMP");
    // raw = 12 + 5 + 4 = 21. Per-contribution each is within the clamp margin
    // (21 - 5 >= 15 and 21 - 4 >= 15) — a per-contribution test would hide the
    // placement — but jointly 21 - 9 = 12 < 15: the pair holds the stat at cap.
    const r = S.readSolution(primalOf([xa, zsForGate(program, xa)[0], q, ...zq]), program);
    assert.strictEqual((r.dinoPlaced || []).length, 1, "jointly load-bearing placement reports");
    assert.strictEqual(r.effective["Melee Power"], 15, "the stat sits at cap because of the pair");
  });

  await test("#322 guards: two SEPARATE placements jointly holding a capped stat cannot mask each other (set-consistent greedy)", async () => {
    // Two gates (a Dino insert and a Green Steel craft) on the same capped
    // stat, each individually within the clamp margin. Judged independently
    // against the FULL raw both would hide (21 - 5 >= 15 and 21 - 4 >= 15),
    // leaving the displayed 15 unreachable from the reported build (worn alone
    // is 12). The greedy set-consistent test deducts the first hidden gate's
    // sum before judging the next, so a surviving placement must keep the
    // stat at cap.
    const dinoHostV = item("DINO-H2", "Ring", []);
    dinoHostV.dino_slots_norm = ["Fang||Accessory"];
    const gsHostV = item("GS-H2", "Gloves", []);
    gsHostV.green_steel_slot = true;
    const program = S.buildProgram({
      targets: ["Melee Power"], mlCap: 36, dodgeCap: null,
      userCaps: { "Melee Power": 15 },
      worn: [slot("Armor", [item("BIGMP2", "Armor", [["Melee Power", "Enhancement", 12]])]),
             slot("Ring", [dinoHostV]), slot("Gloves", [gsHostV])],
      dinoInserts: [{ dino_type: "Fang", category: "Accessory", name: "Test Fang",
        affixes: [{ stat: "Melee Power", bonus_type: "Artifact", value: 5, unit: "flat" }] }],
      greenSteel: [{ name: "Dim", stat: "Melee Power", bonus_type: "Profane", value: 4, unit: "flat" }],
    });
    assert.strictEqual(program.cappedStats["Melee Power"], 15, "cap minted");
    assert.strictEqual(program.dinoMeta.size, 1, "dino placement minted");
    assert.strictEqual(program.gsMeta.size, 1, "GS placement minted");
    const qd = [...program.dinoMeta.keys()][0];
    const qg = [...program.gsMeta.keys()][0];
    const xa = xOf(program, "BIGMP2");
    const r = S.readSolution(primalOf([xa, zsForGate(program, xa)[0],
      qd, zsForGate(program, qd)[0], qg, zsForGate(program, qg)[0]]), program);
    const nDino = (r.dinoPlaced || []).length, nGs = (r.gsPlaced || []).length;
    assert.ok(nDino + nGs >= 1, "at least one jointly-saturating placement reports");
    assert.strictEqual(r.effective["Melee Power"], 15, "total sits at the cap");
    // The REPORTED set's contributions alone must still reach the cap.
    assert.ok(12 + nDino * 5 + nGs * 4 >= 15,
      "the reported placements' contributions keep the displayed capped total reachable");
  });

  await test("#322 guards: an omitted placement's source appears in no stat's breakdown parts", async () => {
    const program = S.buildProgram(invisModel({
      wornAffixes: [["Melee Power", "Enhancement", 20]],
      dinoAffixes: [{ stat: "Melee Power", bonus_type: "Artifact", value: 5, unit: "flat" }],
      userCaps: { "Melee Power": 15 },
    }));
    assert.strictEqual(program.dinoMeta.size, 1, "dino placement minted");
    const q = [...program.dinoMeta.keys()][0];
    const xa = xOf(program, "BIGMP");
    const res = primalOf([xa, zsForGate(program, xa)[0], q, zsForGate(program, q)[0]]);
    const prim = (name) => (res.Columns[name] ? res.Columns[name].Primal : 0);
    const bd = S.breakdownByTarget(program, prim);
    assert.ok(bd["Melee Power"].some((p) => p.sourceKind === "worn"),
      "the worn contribution still attributes (filter is placement-scoped)");
    for (const stat of Object.keys(bd)) {
      assert.ok(!bd[stat].some((p) => p.sourceKind === "dino"),
        `${stat}: the omitted placement is named by no attribution part`);
    }
  });

  await test("#322 guards: a placement seating at/below a declared-credit floor is omitted", async () => {
    // Pins DEFENSIVE behavior: in a real solve a below-floor craft z is
    // LP-infeasible as the bucket's sole contributor (the credit floor row plus
    // sum(z) <= 1 forbid it), so this state is reachable only through the
    // synthetic-primal seam — the guard still must not report it.
    const program = S.buildProgram(invisModel({
      dinoAffixes: [{ stat: "Melee Power", bonus_type: "Artifact", value: 5, unit: "flat" }],
      credits: [credit("Melee Power", "Artifact", 5)],
    }));
    assert.strictEqual(program.creditMeta.size, 1, "credit z minted");
    assert.strictEqual(program.dinoMeta.size, 1, "dino placement minted");
    const q = [...program.dinoMeta.keys()][0];
    const zq = zsForGate(program, q);
    assert.strictEqual(zq.length, 1, "the insert gates one contribution");
    const r = S.readSolution(primalOf([q, zq[0]]), program);
    assert.strictEqual((r.dinoPlaced || []).length, 0,
      "a craft z at the credit floor substitutes, grants nothing, and is omitted");
    // Non-vacuity: the floor structure the guard consumes was actually minted (KTD5).
    assert.strictEqual(program.creditBuckets.size, 1, "credit floor minted");
    assert.strictEqual([...program.creditBuckets.values()][0], 5, "floor is the credit value");
  });

  await test("#322 guards: a placement strictly above the credit floor reports", async () => {
    const program = S.buildProgram(invisModel({
      dinoAffixes: [{ stat: "Melee Power", bonus_type: "Artifact", value: 8, unit: "flat" }],
      credits: [credit("Melee Power", "Artifact", 5)],
    }));
    assert.strictEqual([...program.creditBuckets.values()][0], 5, "credit floor minted");
    const q = [...program.dinoMeta.keys()][0];
    const zq = zsForGate(program, q);
    const r = S.readSolution(primalOf([q, zq[0]]), program);
    assert.strictEqual((r.dinoPlaced || []).length, 1, "above-floor placement reports");
    assert.strictEqual(r.effective["Melee Power"], 8, "and its value shows in the total");
  });

  await test("#322 guards: a craft z feeding a capped own-stat AND an uncapped cross-add sibling stays visible", async () => {
    // Mixed bucket: the craft-gated z's bucket (Universal Spell Power||Artifact)
    // feeds the capped source stat AND cross-adds into an uncapped element
    // (bucketCountsFor). The own-stat sum test alone would hide the placement
    // (raw 25 - 5 >= cap 15); the uncapped-sibling short-circuit keeps it
    // visible because it still raises the element's displayed total.
    return withCrossAdd({ Combustion: ["Universal Spell Power"] }, async () => {
      const dinoHostV = item("DINO-H3", "Ring", []);
      dinoHostV.dino_slots_norm = ["Fang||Accessory"];
      const program = S.buildProgram({
        targets: ["Combustion", "Universal Spell Power"], mlCap: 36, dodgeCap: null,
        userCaps: { "Universal Spell Power": 15 },
        worn: [slot("Armor", [item("BIGUSP", "Armor", [["Universal Spell Power", "Enhancement", 20]])]),
               slot("Ring", [dinoHostV])],
        dinoInserts: [{ dino_type: "Fang", category: "Accessory", name: "USP Fang",
          affixes: [{ stat: "Universal Spell Power", bonus_type: "Artifact", value: 5, unit: "flat" }] }],
      });
      // Non-vacuity: the cap AND the cross-add mapping were both minted.
      assert.strictEqual(program.cappedStats["Universal Spell Power"], 15, "cap minted");
      assert.strictEqual(program.dinoMeta.size, 1, "dino placement minted");
      const q = [...program.dinoMeta.keys()][0];
      const zq = zsForGate(program, q);
      assert.strictEqual(zq.length, 1, "the insert gates one contribution");
      const zBucketKey = [...program.zByBucket].find(([, zs]) => zs.some((z) => z.gates.includes(q)))[0];
      assert.ok(S.bucketCountsFor(zBucketKey, "Combustion"), "the craft z's bucket cross-adds into the uncapped element");
      const xa = xOf(program, "BIGUSP");
      const r = S.readSolution(primalOf([xa, zsForGate(program, xa)[0], q, zq[0]]), program);
      assert.strictEqual((r.dinoPlaced || []).length, 1,
        "the uncapped cross-add sibling keeps the placement visible even though the own-stat is clamped past its cap");
      assert.strictEqual(r.effective["Universal Spell Power"], 15, "the own stat sits at its cap");
      assert.strictEqual(r.effective.Combustion, 25, "the element counts the raw cross-added buckets (20 + 5)");
    });
  });

  // ---- #325 visibility-guard corners: at-floor substitution attribution, ----
  // ---- credited∩capped net test, floored non-target stats ----

  await test("#325: an at-floor substituted placement leaves the DECLARED part in the breakdown", async () => {
    // The at-floor tie: a craft z at exactly the credit floor is a feasible
    // tied vertex (only strictly-below-floor seating is LP-infeasible). The
    // guard omits the placement — and before #325 nothing explained the total:
    // the proof panel summed to 0 while effective read 5 and creditReport said
    // gear supplied it.
    const program = S.buildProgram(invisModel({
      dinoAffixes: [{ stat: "Melee Power", bonus_type: "Artifact", value: 5, unit: "flat" }],
      credits: [credit("Melee Power", "Artifact", 5)],
    }));
    assert.strictEqual([...program.creditBuckets.values()][0], 5, "credit floor minted");
    const q = [...program.dinoMeta.keys()][0];
    const zq = zsForGate(program, q);
    const res = primalOf([q, zq[0]]);
    const prim = (n) => (res.Columns[n] ? res.Columns[n].Primal : 0);
    const r = S.readSolution(res, program);
    assert.strictEqual((r.dinoPlaced || []).length, 0, "the substituted placement stays omitted");
    assert.strictEqual(r.effective["Melee Power"], 5, "the total still holds the floor value");
    const parts = S.breakdownByTarget(program, prim)["Melee Power"] || [];
    const declared = parts.filter((p) => p.sourceKind === "declared");
    assert.strictEqual(declared.length, 1, "the DECLARED part is emitted in the hidden placement's place");
    assert.strictEqual(declared[0].value, 5, "at the floor value");
    assert.ok(!parts.some((p) => p.sourceKind === "dino"), "the hidden placement is still not named");
    const sum = parts.reduce((s, p) => s + p.value, 0);
    assert.ok(sum >= r.effective["Melee Power"],
      `receipts invariant: parts (${sum}) sum to at least the displayed effective (${r.effective["Melee Power"]})`);
  });

  await test("#325: creditReport's won/gearInLoadout follow the substitution rule", async () => {
    const model = invisModel({
      dinoAffixes: [{ stat: "Melee Power", bonus_type: "Artifact", value: 5, unit: "flat" }],
      credits: [credit("Melee Power", "Artifact", 5)],
    });
    const program = S.buildProgram(model);
    const q = [...program.dinoMeta.keys()][0];
    const zq = zsForGate(program, q);
    const res = primalOf([q, zq[0]]);
    const prim = (n) => (res.Columns[n] ? res.Columns[n].Primal : 0);
    const report = S.buildCreditReport(program, prim, model, []);
    assert.strictEqual(report.length, 1, "one credit reported");
    assert.strictEqual(report[0].won, true,
      "the credit wins its bucket when the seated craft merely substitutes for it");
    assert.strictEqual(report[0].gearInLoadout, 0,
      "a hidden placement is not the endorsed build's gear");
  });

  await test("#325: in a credited AND capped bucket the cap test uses value minus floor", async () => {
    // raw = 20 + 8 = 28, cap 24, floor 5. Removing the craft lets the credit
    // backfill the floor, so the displayed total loses only 8 - 5 = 3:
    // 28 - 3 = 25 >= 24 -> hidden. The gross test (28 - 8 = 20 < 24) would
    // have kept it visible — the pre-#325 over-report.
    const program = S.buildProgram(invisModel({
      wornAffixes: [["Melee Power", "Enhancement", 20]],
      dinoAffixes: [{ stat: "Melee Power", bonus_type: "Artifact", value: 8, unit: "flat" }],
      userCaps: { "Melee Power": 24 },
      credits: [credit("Melee Power", "Artifact", 5)],
    }));
    assert.strictEqual(program.cappedStats["Melee Power"], 24, "cap minted");
    assert.strictEqual([...program.creditBuckets.values()][0], 5, "credit floor minted");
    const q = [...program.dinoMeta.keys()][0];
    const zq = zsForGate(program, q);
    const xa = xOf(program, "BIGMP");
    const res = primalOf([xa, zsForGate(program, xa)[0], q, zq[0]]);
    const prim = (n) => (res.Columns[n] ? res.Columns[n].Primal : 0);
    const r = S.readSolution(res, program);
    assert.strictEqual((r.dinoPlaced || []).length, 0,
      "net of the credit floor the placement moves no displayed total, so it is omitted");
    assert.strictEqual(r.effective["Melee Power"], 24, "total sits at the cap");
    const parts = S.breakdownByTarget(program, prim)["Melee Power"] || [];
    assert.ok(parts.some((p) => p.sourceKind === "declared" && p.value === 5),
      "the DECLARED floor part backfills the hidden placement's bucket");
    const sum = parts.reduce((s, p) => s + p.value, 0);
    assert.ok(sum >= r.effective["Melee Power"],
      `receipts invariant under cap: parts (${sum}) >= displayed (${r.effective["Melee Power"]})`);
  });

  await test("#325: a craft strictly above cap-plus-floor slack still reports in a credited capped bucket", async () => {
    // Same shape, cap 27: 28 - 3 = 25 < 27 -> removing the craft would lower
    // the displayed total even after the credit backfills. Visible.
    const program = S.buildProgram(invisModel({
      wornAffixes: [["Melee Power", "Enhancement", 20]],
      dinoAffixes: [{ stat: "Melee Power", bonus_type: "Artifact", value: 8, unit: "flat" }],
      userCaps: { "Melee Power": 27 },
      credits: [credit("Melee Power", "Artifact", 5)],
    }));
    const q = [...program.dinoMeta.keys()][0];
    const zq = zsForGate(program, q);
    const xa = xOf(program, "BIGMP");
    const r = S.readSolution(primalOf([xa, zsForGate(program, xa)[0], q, zq[0]]), program);
    assert.strictEqual((r.dinoPlaced || []).length, 1, "net-of-floor load-bearing placement reports");
  });

  await test("#325: a z feeding a floored NON-target via cross-add stays visible when its capped target is slack", async () => {
    // The statUniverse gap: Universal Spell Power is floored but NOT a target,
    // and the craft z's own-stat bucket cross-adds into the capped target
    // Combustion. Judged on Combustion alone (raw 25 - 5 = 20 >= cap 15) the
    // placement would hide — but removing it would break the USP floor the
    // player asked for. flooredStats joins the universe, USP is uncapped, and
    // the uncapped-sibling short-circuit keeps the placement visible.
    return withCrossAdd({ Combustion: ["Universal Spell Power"] }, async () => {
      const dinoHostV = item("DINO-H4", "Ring", []);
      dinoHostV.dino_slots_norm = ["Fang||Accessory"];
      const program = S.buildProgram({
        targets: ["Combustion"], mlCap: 36, dodgeCap: null,
        userCaps: { Combustion: 15 },
        floors: { "Universal Spell Power": 5 },
        worn: [slot("Armor", [item("BIGCOMB", "Armor", [["Combustion", "Enhancement", 20]])]),
               slot("Ring", [dinoHostV])],
        dinoInserts: [{ dino_type: "Fang", category: "Accessory", name: "USP Fang",
          affixes: [{ stat: "Universal Spell Power", bonus_type: "Artifact", value: 5, unit: "flat" }] }],
      });
      // Non-vacuity: the floored non-target stat was stamped, and USP is not a target.
      assert.deepStrictEqual(program.flooredStats, ["Universal Spell Power"], "flooredStats stamped");
      assert.ok(!program.targetList.includes("Universal Spell Power"), "USP is genuinely a non-target");
      assert.strictEqual(program.cappedStats.Combustion, 15, "cap minted");
      const q = [...program.dinoMeta.keys()][0];
      const zq = zsForGate(program, q);
      assert.strictEqual(zq.length, 1, "the insert gates one contribution");
      const xa = xOf(program, "BIGCOMB");
      const r = S.readSolution(primalOf([xa, zsForGate(program, xa)[0], q, zq[0]]), program);
      assert.strictEqual((r.dinoPlaced || []).length, 1,
        "a placement supporting a floored non-target stat is load-bearing even when its capped target is slack");
    });
  });

  // ---- #321 Thunder-Forged / Green Steel join the fewer-crafts axis ----
  // Clone of the #319 backstop fixture (which must stay green unmodified): here
  // the TF tier OUTVALUES the worn Artifact source, so the placement is
  // load-bearing and the fewer-crafts counting must see it.
  await test("#321 a load-bearing Thunder-Forged placement counts as a crafting step", async () => {
    const armor = item("BIG", "Armor", [["Melee Power", "Artifact", 20], ["Melee Power", "Enhancement", 15]]);
    const craftHost = host("CH", "Ring", [], []);
    craftHost.thunder_forged_tiers = [{ tier: 1 }];
    craftHost.minimum_level = craftHost.ml = 20;
    const model = {
      targets: ["Melee Power"], mlCap: 36, dodgeCap: null,
      worn: [slot("Armor", [armor]), slot("Ring", [craftHost])],
      thunderForged: [tfOpt(1, "Melee Power", "Artifact", 25)],
    };
    const program = S.buildProgram(model);
    assert.ok(program.tfMeta && program.tfMeta.size >= 1, "tfMeta minted (fixture is non-vacuous)");
    const r = S.solveConstrained(program, highs, { objectiveStat: "Melee Power", sense: "max", tieBreak: false });
    assert.strictEqual(r.status, "optimal");
    assert.strictEqual(r.effective["Melee Power"], 40, "TF tier (25) beats the worn Artifact source (20)");
    assert.strictEqual((r.tfPlaced || []).length, 1, "the TF placement is load-bearing and reports");
    const A = require("../web/alternatives.js");
    assert.strictEqual(A.craftCount(r), 1, "fewer-crafts counting includes the TF placement");
  });

  await test("#321 generateAlternatives fewer-crafts axis sees a load-bearing Green Steel placement", async () => {
    // Real generateAlternatives run over a craft-bearing optimum: the GS craft
    // (25) outvalues the craft-free ring (20), so the optimum crafts it; the
    // fewer-crafts give (10% of 60 = 6) admits the craft-free ring (55 >= 54)
    // but NOT the bare host (35), so a genuine 0-craft alternative exists and
    // the gs terms in craftVars/optCrafts/solCrafts must all execute.
    const armor = item("BIG-GS", "Armor", [["Melee Power", "Artifact", 20], ["Melee Power", "Enhancement", 15]]);
    const gsHostV = item("GSCH", "Ring", []);
    gsHostV.green_steel_slot = true;
    const plainRing = item("PLAIN", "Ring", [["Melee Power", "Insightful", 20]]);
    const model = {
      targets: ["Melee Power"], mlCap: 36, dodgeCap: null,
      worn: [slot("Armor", [armor]), slot("Ring", [gsHostV, plainRing])],
      greenSteel: [{ name: "Ethereal", stat: "Melee Power", bonus_type: "Insightful", value: 25, unit: "flat" }],
    };
    const opt = await S.solveLexicographic(model, highs);
    assert.strictEqual(opt.status, "optimal");
    assert.ok(opt.program.gsMeta && opt.program.gsMeta.size >= 1, "gsMeta minted (fixture is non-vacuous)");
    assert.strictEqual(opt.effective["Melee Power"], 60, "GS craft (25) beats the craft-free ring (20)");
    assert.strictEqual((opt.gsPlaced || []).length, 1, "the GS placement is load-bearing in the optimum");
    const alts = S.generateAlternatives(opt, model, highs);
    const crafts = alts.find((a) => a.gainAxis === "crafts");
    assert.ok(crafts, "the fewer-crafts axis produced a candidate");
    assert.ok(crafts.meta.optCrafts >= 1, "optCrafts counting saw the GS placement");
    assert.strictEqual((crafts.sol.gsPlaced || []).length, 0, "the candidate drops the GS craft");
    assert.ok(crafts.sol.chosen.some((c) => c.variant.variant_id === "PLAIN"),
      "swaps to the craft-free ring within the bounded give");
    const A = require("../web/alternatives.js");
    assert.strictEqual(A.craftCount(crafts.sol), 0, "the candidate genuinely uses fewer crafting steps");
  });

  // -------------------------------------------------------------------------
  // #91 (U7, KTD7) — generateAlternatives and the Utility sentinel: the generic
  // families exclude it from target iteration and lock construction, and thread
  // the count lock into their re-solves instead. Review fix — the lock behaves
  // like a RANKED STAT, not an ultra-priority: exact only when the sentinel is
  // ranked FIRST; otherwise relaxed by alternativeGive, and any shed is stated
  // by alternatives.js cost accounting (never silent). These two tests
  // previously pinned the exact-lock-everywhere behavior and were rewritten to
  // the new rule per the code review.
  // -------------------------------------------------------------------------

  await test("#91 U7/KTD7 (review): sentinel mid-list — axes skip it; a within-give shed surfaces WITH its loss stated", async () => {
    // Optimum: A=10 (Ring), count stage picks the Ghost Touch trinket, B=6
    // under the count lock. A generic rebalance toward B must NOT iterate the
    // sentinel as a pair member (no {from|to: sentinel} candidate) and must
    // build no sentinel lock entry. With the tier NOT ranked first, the count
    // lock relaxes by alternativeGive(1)=2 -> floor 0, so the B-10 trinket
    // swap (shedding Ghost Touch) is a LEGAL trade — it surfaces, and the
    // analysis states the shed as a cost instead of suppressing the candidate.
    const model = {
      targets: ["A", SENT, "B"], mlCap: 34, dodgeCap: null,
      utilityCountingSet: new Set(["Ghost Touch"]),
      worn: [
        slot("Ring", [item("rA", "Ring", [["A", "Enhancement", 10]])]),
        slot("Trinket", [
          item("tU", "Trinket", [["B", "Enhancement", 6], ["Ghost Touch", "Bool", 1]]),
          item("tB", "Trinket", [["B", "Enhancement", 10]]),
        ]),
      ],
    };
    const r = await S.solveLexicographic(model, highs);
    assert.strictEqual(r.utilityCount, 1);
    assert.strictEqual(r.utilityReport.count, 1, "the displayed baseline");
    assert.strictEqual(r.effective.B, 6, "B pays the cost its position permits");
    const alts = S.generateAlternatives(r, model, highs);
    for (const a of alts) {
      assert.ok(a.meta.from !== SENT && a.meta.to !== SENT && a.meta.stat !== SENT,
        `generic axes never iterate the sentinel (got ${a.gainAxis}: ${JSON.stringify(a.meta)})`);
    }
    const reb = alts.find((a) => a.gainAxis === "rebalance" && a.meta.to === "B");
    assert.ok(reb, "the within-give shedding rebalance now surfaces (review fix)");
    assert.strictEqual(reb.sol.effective.B, 10, "the trade genuinely gains B");
    assert.strictEqual(reb.sol.utilityReport.count, 0, "it sheds the counted effect");
    const A2 = require("../web/alternatives.js");
    const an = A2.analyzeAlternative(r, reb, { targets: ["A", SENT, "B"] });
    // #348 (U4/R16) — the loss is NAMED now, not counted: "gives up Ghost Touch"
    // tells a player who curated an ordered container what the trade actually takes.
    assert.ok(/gives up Ghost Touch/.test(an.costText), "the shed is stated by name, never silent");
    assert.deepStrictEqual(an.shedEffects, ["Ghost Touch"]);
    assert.strictEqual(an.utilDelta, -1);
    assert.ok(an.totalCost >= 1, "totalCost includes the shed magnitude");
  });

  await test("#91 U7/KTD7 (review): fewer-crafts — shed surfaces with cost mid-list, exact lock blocks it when the tier is FIRST", async () => {
    // The #321 GS fixture shape, with the counted effect riding the GS HOST:
    // the crafts family's craft-free alternative is swapping to PLAIN (55 >=
    // 60 - give 6), which sheds Ghost Touch. Review fix: with the tier ranked
    // BELOW a stat the count lock relaxes by the give (floor 0 here), so the
    // swap surfaces as "1 fewer crafting steps" WITH the shed stated as a
    // cost; with the tier ranked FIRST the lock stays exact and the swap is
    // infeasible.
    const mk = (targets) => {
      const armor = item("BIG-GS", "Armor", [["Melee Power", "Artifact", 20], ["Melee Power", "Enhancement", 15]]);
      const gsHostV = item("GSCH", "Ring", [["Ghost Touch", "Bool", 1]]);
      gsHostV.green_steel_slot = true;
      const plainRing = item("PLAIN", "Ring", [["Melee Power", "Insightful", 20]]);
      return {
        targets, mlCap: 36, dodgeCap: null,
        utilityCountingSet: new Set(["Ghost Touch"]),
        worn: [slot("Armor", [armor]), slot("Ring", [gsHostV, plainRing])],
        greenSteel: [{ name: "Ethereal", stat: "Melee Power", bonus_type: "Insightful", value: 25, unit: "flat" }],
      };
    };
    const r = await S.solveLexicographic(mk(["Melee Power", SENT]), highs);
    assert.strictEqual(r.effective["Melee Power"], 60, "GS craft (25) beats the craft-free ring (20)");
    assert.strictEqual(r.utilityReport.count, 1, "the GS host carries the counted effect");
    assert.strictEqual((r.gsPlaced || []).length, 1, "the optimum crafts");
    const alts = S.generateAlternatives(r, mk(["Melee Power", SENT]), highs);
    const crafts = alts.find((a) => a.gainAxis === "crafts");
    assert.ok(crafts, "tier below the stat: the craft-free swap is a legal give-bounded trade (review fix)");
    assert.strictEqual((crafts.sol.gsPlaced || []).length, 0, "it genuinely drops the craft");
    const A2 = require("../web/alternatives.js");
    const an = A2.analyzeAlternative(r, crafts, { targets: ["Melee Power", SENT] });
    assert.ok(/gives up Ghost Touch/.test(an.costText), "the shed effect is stated by name");
    assert.strictEqual(an.totalCost, 5 + 1, "-5 Melee Power plus the shed effect");
    // Tier ranked FIRST: the count is the top priority -> exact lock -> the
    // shedding swap is infeasible and no crafts candidate exists.
    const rf = await S.solveLexicographic(mk([SENT, "Melee Power"]), highs);
    assert.strictEqual(rf.utilityReport.count, 1);
    assert.strictEqual((rf.gsPlaced || []).length, 1);
    const altsF = S.generateAlternatives(rf, mk([SENT, "Melee Power"]), highs);
    assert.ok(!altsF.some((a) => a.gainAxis === "crafts"),
      "no give applies to the top-ranked tier — the exact lock rules the shed out");
  });

  

  // #332 — the model->solver chain that makes rankedNotCounted non-empty. It had ZERO
  // coverage, which is the other half of why the disclosure shipped dead: even with the
  // call sites wired, nothing pinned that the object-shaped argument reaches the report.
  await test("#332: the object-shaped 11th argument feeds rankedNotCounted", async () => {
    const { buildModel } = require("../web/model.js");
    const mk = (n, t2, v) => ({ variant_id: "W", slot: "Main Hand", ml: 1, minimum_level: 1,
      verification: "verified", affixes: [{ name: n, type: t2, value: v }] });
    const items = [mk("Undead Bane", null, 6), mk("Ghostly", "Bool", 1)];
    items[1].variant_id = "R"; items[1].slot = "Ring 1";
    const q = { mlCap: 34, targets: ["Undead Bane", require("../web/model.js").UTILITY_SENTINEL], armorType: null,
      weaponSetup: null, classRace: null };
    const sets = { counting: new Set(["Ghostly"]), notCounted: new Set(["Undead Bane"]) };

    const m = buildModel(items, q, [], [], [], [], {}, [], [], {}, sets);
    assert.ok(m.utilityNotCountedSet, "the not-counted set reaches the model");
    const prog = S.buildProgram(m);
    assert.deepStrictEqual(prog.utilityRankedNotCounted, ["Undead Bane"],
      "a ranked not-counted name is recorded as not counted");

    // #380 renamed the key. The old one is still accepted, deliberately: a caller
    // built against the earlier shape must keep disclosing rather than resolve to
    // null and silently say nothing — the exact failure mode #380 was filed for.
    const legacy = { counting: new Set(["Ghostly"]), admitted: new Set(["Undead Bane"]) };
    const mLegacy = buildModel(items, q, [], [], [], [], {}, [], [], {}, legacy);
    assert.ok(mLegacy.utilityNotCountedSet, "the pre-#380 `admitted` key still resolves");
    assert.deepStrictEqual(S.buildProgram(mLegacy).utilityRankedNotCounted, ["Undead Bane"],
      "and produces the same exclusion names");

    // And the bare-Set form must NOT populate it — that is the pre-#332 shape.
    const bare = buildModel(items, q, [], [], [], [], {}, [], [], {}, new Set(["Ghostly"]));
    assert.strictEqual(bare.utilityNotCountedSet, null, "a bare Set carries no not-counted half");
    assert.deepStrictEqual(S.buildProgram(bare).utilityRankedNotCounted, [],
      "and yields no exclusion names, so the sentence stays silent");
  });


  console.log(`\n${passed} passed`);
})();
