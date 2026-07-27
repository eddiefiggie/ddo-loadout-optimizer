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
      affixes: affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, value, unit: "flat" })),
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
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8"));
    // "Diversion" is carried ONLY by enriched compendium items, so a positive
    // achieved value proves an enriched item entered the solver pool, survived the
    // dominance filter, and was selected — not just that it "verified".
    const query = { mlCap: 34, targets: ["Diversion"], armorType: null, weaponSetup: null, classRace: null };
    const model = buildModel(data.items, query, data.dino_inserts, data.nearly_complete);
    const res = await S.solveLexicographic(model, highs);
    assert.strictEqual(res.status, "optimal");
    assert.ok(res.effective["Diversion"] > 0, "an enriched item supplying Diversion was selected");
    const pick = res.chosen.find((c) => (c.variant.affixes || []).some((a) => a.stat === "Diversion"));
    assert.ok(pick, "the selected loadout includes the Diversion-carrying enriched item");
  });

  await test("U81 Nearly-Complete crafts onto a real enriched host (real dataset)", async () => {
    const fs = require("fs");
    const { buildModel } = require("../web/model.js");
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8"));
    // Enriched ML35 items now carry `nearly_complete` category slots; the solver
    // must craft the best option from that category's pool onto the host.
    const query = { mlCap: 36, targets: ["Constitution"], armorType: null, weaponSetup: null, classRace: null };
    const model = buildModel(data.items, query, data.dino_inserts, data.nearly_complete);
    const res = await S.solveLexicographic(model, highs);
    assert.strictEqual(res.status, "optimal");
    assert.ok((res.ncPlaced || []).length > 0, "at least one NC craft was placed onto a host");
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
    v.minimum_level = ml == null ? 35 : ml;
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
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8"));
    // Acid Spellpower is supplied by the Viktranium pool; targeting it must craft a
    // Lamordia augment onto one of the real hosts (proves the host survived the
    // dominance filter and the pool was consumed — the load-bearing checks).
    const query = { mlCap: 36, targets: ["Acid Spellpower"], armorType: null, weaponSetup: null, classRace: null };
    const model = buildModel(data.items, query, data.dino_inserts, data.nearly_complete, data.viktranium);
    const res = await S.solveLexicographic(model, highs);
    assert.strictEqual(res.status, "optimal");
    assert.ok((res.vikPlaced || []).length > 0, "at least one Viktranium craft was placed onto a host");
    const craft = res.vikPlaced.find((n) => n.stat === "Acid Spellpower");
    assert.ok(craft && craft.value > 0, "a Lamordia host crafted an Acid Spellpower option from its pool");
    assert.ok(craft.item, "the craft names its host item");
    // Every real host is a Legendary (ML34) item, so the craft MUST pull the
    // legendary magnitude (regression guard for the ML>=35 mis-tier bug: a heroic
    // value here would mean the legendary pool went unreachable). Assert the exact
    // legendary value for the chosen (slot_type, category), derived from the data.
    assert.strictEqual(craft.tier, "legendary", "an ML34 host crafts at the legendary tier");
    const expected = data.viktranium.find((o) => o.stat === "Acid Spellpower"
      && o.slot_type === craft.slot_type && o.category === craft.category && o.tier === "legendary");
    assert.ok(expected && craft.value === expected.value,
      `craft value ${craft.value} matches the legendary pool value ${expected && expected.value}`);
    assert.ok(craft.value > 35, "legendary magnitude exceeds the heroic one (would have been ~35)");
  });

  await test("Dino crafts a multi-affix insert onto a real host end-to-end (real dataset)", async () => {
    const fs = require("fs");
    const { buildModel } = require("../web/model.js");
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8"));
    // "Sneak Attack Damage" is supplied ONLY by the multi-affix Fang insert
    // (Accessory). Targeting it must select a real Dino blank host and place the
    // multi-affix unit (proves the blank survived dominance + the pool was
    // consumed all-or-nothing — the load-bearing checks).
    const query = { mlCap: 34, targets: ["Sneak Attack Damage"], armorType: null, weaponSetup: null, classRace: null };
    const model = buildModel(data.items, query, data.dino_inserts, data.nearly_complete, data.viktranium);
    const res = await S.solveLexicographic(model, highs);
    assert.strictEqual(res.status, "optimal");
    assert.ok(res.effective["Sneak Attack Damage"] > 0, "the crafted insert advances the target");
    const unit = (res.dinoPlaced || []).find((d) => (d.affixes || []).some((a) => a.stat === "Sneak Attack Damage"));
    assert.ok(unit, "a Dino insert supplying Sneak Attack Damage was placed onto a real host");
    assert.ok(unit.affixes.length >= 2, "the placed unit is the multi-affix insert (both affixes ride one placement)");
  });

  await test("Dino crafts an Armor-typed multi-affix insert onto the real armor blank end-to-end (real dataset)", async () => {
    const fs = require("fs");
    const { buildModel } = require("../web/model.js");
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8"));
    // "Repair Healing Amplification" is supplied ONLY by the Armor-typed
    // multi-affix "Silverscale" insert (Scale). Targeting it must select the real
    // Dinosaur Bone Armor blank and place an ARMOR-typed insert — proving two-key
    // (category) routing AND multi-affix placement end-to-end on the real data.
    const query = { mlCap: 34, targets: ["Repair Healing Amplification"], armorType: null, weaponSetup: null, classRace: null };
    const model = buildModel(data.items, query, data.dino_inserts, data.nearly_complete, data.viktranium);
    const res = await S.solveLexicographic(model, highs);
    assert.strictEqual(res.status, "optimal");
    const unit = (res.dinoPlaced || []).find((d) => (d.affixes || []).some((a) => a.stat === "Repair Healing Amplification"));
    assert.ok(unit, "an Armor-typed Dino insert supplying Repair Healing Amplification was placed");
    assert.strictEqual(unit.category, "Armor", "the placed insert is Armor-category (two-key routing held)");
    assert.ok(unit.affixes.length >= 2, "the placed unit is the multi-affix Silverscale insert");
    assert.ok(res.effective["Repair Healing Amplification"] > 0, "the crafted armor insert advances the target");
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
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8"));
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
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8"));
    const r4 = data.items.find(v => (v.source_item || v.variant_id) === "The Theurgy of Autumn");
    assert.ok(r4, "The Theurgy of Autumn is solver-active in the dataset");
    const corr = (r4.affixes || []).find(a => a.stat === "Corrosion");
    assert.ok(corr && corr.value > 0, "it carries a parsed Corrosion spellpower affix");
    const weak = item("WeakRing", r4.slot, [["Corrosion", corr.bonus_type, Math.max(1, corr.value - 50)]]);
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
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8"));
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

  console.log(`\n${passed} passed`);
})();
