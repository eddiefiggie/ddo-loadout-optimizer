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
  function vikOpt(slot_type, category, stat, bonus_type, value, tier) {
    return { slot_type, category, stat, bonus_type, value, tier: tier || "legendary", unit: "flat" };
  }
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

  await test("U81 Viktranium crafts onto a real host end-to-end (real dataset)", async () => {
    const fs = require("fs");
    const { buildModel } = require("../web/model.js");
    const data = normalizeDataset(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8")));
    // The seal/dino/viktranium pools now live in the native gear-planner catalog, so
    // this test DERIVES its target from the loaded pool instead of hard-targeting a
    // legacy affix name (which would re-break on every catalog refresh). Intent is
    // unchanged: a real Lamordia host crafts a LEGENDARY option at the legendary
    // magnitude — the regression guard for the ML>=35 mis-tier bug.
    const itemMax = (stat) => {
      let m = 0;
      for (const it of data.items) for (const a of (it.affixes || []))
        if ((a.name != null ? a.name : a.stat) === stat && typeof a.value === "number" && a.value > m) m = a.value;
      return m;
    };
    // (slot_type, category) pairs that a real item actually offers as a Lamordia slot.
    const hostKeys = new Set();
    for (const it of data.items) for (const ls of (it.lamordia_slots || [])) hostKeys.add(ls.type + "|" + ls.category);
    // Pick a legendary option that (a) has a real host for its (slot_type, category),
    // (b) out-values every worn item for its stat (so the craft is genuinely reached,
    // not made redundant by an item), and (c) has a strictly weaker heroic counterpart
    // (so "legendary magnitude > heroic" is a real assertion). Deterministic: strongest
    // first, stat name as the tie-break.
    const pick = data.viktranium
      .filter((o) => o.tier === "legendary" && o.value > 35 && hostKeys.has(o.slot_type + "|" + o.category)
        && o.value > itemMax(o.stat)
        && data.viktranium.some((h) => h.stat === o.stat && h.slot_type === o.slot_type
          && h.category === o.category && h.tier === "heroic" && h.value < o.value))
      .sort((a, b) => b.value - a.value || (a.stat < b.stat ? -1 : 1))[0];
    assert.ok(pick, "the native pool offers a hostable legendary option for the regression guard");
    const query = { mlCap: 36, targets: [pick.stat], armorType: null, weaponSetup: null, classRace: null };
    const model = buildModel(data.items, query, data.dino_inserts, data.nearly_complete, data.viktranium);
    const res = await S.solveLexicographic(model, highs);
    assert.strictEqual(res.status, "optimal");
    assert.ok((res.vikPlaced || []).length > 0, "at least one Viktranium craft was placed onto a host");
    const craft = res.vikPlaced.find((n) => n.stat === pick.stat);
    assert.ok(craft && craft.value > 0, `a Lamordia host crafted a ${pick.stat} option from its pool`);
    assert.ok(craft.item, "the craft names its host item");
    // Every real host is a Legendary item, so the craft MUST pull the legendary
    // magnitude (a heroic value here would mean the legendary pool went unreachable —
    // the ML>=35 mis-tier bug). Assert the exact legendary value for the chosen
    // (slot_type, category), and that it beats the heroic magnitude of the same option.
    assert.strictEqual(craft.tier, "legendary", "a legendary host crafts at the legendary tier");
    const expected = data.viktranium.find((o) => o.stat === pick.stat
      && o.slot_type === craft.slot_type && o.category === craft.category && o.tier === "legendary");
    assert.ok(expected && craft.value === expected.value,
      `craft value ${craft.value} matches the legendary pool value ${expected && expected.value}`);
    const heroicOpt = data.viktranium.find((o) => o.stat === pick.stat
      && o.slot_type === craft.slot_type && o.category === craft.category && o.tier === "heroic");
    assert.ok(heroicOpt && craft.value > heroicOpt.value,
      `legendary magnitude ${craft.value} exceeds the heroic one ${heroicOpt && heroicOpt.value}`);
    assert.ok(craft.value > 35, "legendary magnitude exceeds the heroic tier band");
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

  // (Retired U7) The Gem of Many Facets wildcard-set (joker) feature was removed —
  // the joker_sets.json seed is not in gear-planner's set model (accepted loss,
  // logged in the migration manifest). The solver's joker code path remains inert.

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

  console.log(`\n${passed} passed`);
})();
