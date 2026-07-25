// U7 staged-lexicographic solver tests — run against the REAL HiGHS engine.
// Run: node tests/solver.test.js
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

// build a worn variant + a single-variant slot
function item(id, slot, affixes) {
  return {
    variant_id: id, source_item: id, slot,
    affixes: affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, value, unit: "flat" })),
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
// an augment record: its color lives in aug_color (U2-normalized)
function augment(id, color, affixes) {
  return {
    variant_id: id, source_item: id, category: "augment", slot: color,
    aug_color: { color, raw: color, reason: null },
    affixes: affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, value, unit: "flat" })),
    scaling: [], set_bonus: [], augment_slots: [],
  };
}
// a worn item that belongs to a set and carries the set's parsed tier bonuses (U5)
function setPiece(id, slotName, affixes, setName, tiers) {
  const v = item(id, slotName, affixes);
  v.set_bonus = [{ set: setName }];
  v.parsed_set_bonuses = (tiers || []).map((t) => ({
    set: setName, pieces_required: t.n, pieces_label: `${t.n} Pieces`,
    affixes: t.affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, value, unit: "flat" })),
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
  function dinoHost(id, slotName, dinoTypes, affixes) {
    const v = item(id, slotName, affixes || []);
    v.dino_slots_norm = dinoTypes || [];
    return v;
  }
  // a Dino insert record (one (dino_type, stat, bonus_type, value))
  function dinoIns(dino_type, stat, bonus_type, value) {
    return { dino_type, stat, bonus_type, value, wiki_url: "wiki" };
  }

  await test("Dino/AE1: insert counts only when its host is equipped + placed", async () => {
    const withHost = {
      targets: ["Constitution"], mlCap: 34, dodgeCap: null,
      worn: [slot("Boots", [dinoHost("B", "Boots", ["Scale"])])],
      dinoInserts: [dinoIns("Scale", "Constitution", "Enhancement", 14)],
    };
    const a = await S.solveLexicographic(withHost, highs);
    assert.strictEqual(a.effective.Constitution, 14, "placed into the open Scale slot");
    assert.ok(a.dinoPlaced.some((d) => d.stat === "Constitution"), "reported as placed");

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

  console.log(`\n${passed} passed`);
})();
