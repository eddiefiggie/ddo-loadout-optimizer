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

  console.log(`\n${passed} passed`);
})();
