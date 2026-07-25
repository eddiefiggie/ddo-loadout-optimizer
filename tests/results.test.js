// U8 — build-sheet reconstruction tests (pure functions; no DOM).
const assert = require("assert");
const R = require("../web/results.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  PASS", name); }
  catch (e) { console.log("  FAIL", name, "\n   ", e.message); process.exitCode = 1; }
}

function chosenItem(id, slot, colors, sets, tiers) {
  return {
    slot,
    variant: {
      variant_id: id, slot,
      augment_slots_norm: { colors: colors || [], quarantined: [] },
      set_bonus: (sets || []).map((s) => ({ set: s })),
      parsed_set_bonuses: (tiers || []).map((t) => ({
        set: t.set, pieces_required: t.n, pieces_label: `${t.n} Pieces`,
        affixes: t.affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, value, unit: "flat" })),
        flagged: [],
      })),
    },
  };
}

test("assignAugments drops each placed augment into a matching open slot", () => {
  const chosen = [chosenItem("Ring", "Ring", ["Blue"]), chosenItem("Cloak", "Cloak", ["Red"])];
  const placed = [{ variant_id: "SapphireRes5", color: "Blue" }, { variant_id: "RubyStr", color: "Red" }];
  const out = R.assignAugments(chosen, placed);
  assert.deepStrictEqual(out.byIndex.get(0).map((a) => a.variant_id), ["SapphireRes5"]);
  assert.deepStrictEqual(out.byIndex.get(1).map((a) => a.variant_id), ["RubyStr"]);
  assert.strictEqual(out.unplaced.length, 0);
});

test("assignAugments respects per-item color capacity", () => {
  const chosen = [chosenItem("Ring", "Ring", ["Blue"])]; // one Blue slot only
  const placed = [{ variant_id: "A", color: "Blue" }, { variant_id: "B", color: "Blue" }];
  const out = R.assignAugments(chosen, placed);
  assert.strictEqual(out.byIndex.get(0).length, 1, "only one fits the single Blue slot");
  assert.strictEqual(out.unplaced.length, 1);
});

test("nearMissSetHints flags a set one piece short that would advance a target", () => {
  // Two equipped pieces of "Elite"; its 3-piece tier gives Dodge and would help.
  const tiers = [{ set: "Elite", n: 3, affixes: [["Dodge", "Insightful", 3]] }];
  const chosen = [
    chosenItem("A", "Ring", [], ["Elite"], tiers),
    chosenItem("B", "Cloak", [], ["Elite"], tiers),
  ];
  const hints = R.nearMissSetHints(chosen, ["Dodge"]);
  assert.strictEqual(hints.length, 1);
  assert.strictEqual(hints[0].set, "Elite");
  assert.strictEqual(hints[0].have, 2);
  assert.strictEqual(hints[0].need, 3);
});

test("nearMissSetHints stays silent when the next tier helps no target", () => {
  const tiers = [{ set: "Elite", n: 3, affixes: [["Dodge", "Insightful", 3]] }];
  const chosen = [
    chosenItem("A", "Ring", [], ["Elite"], tiers),
    chosenItem("B", "Cloak", [], ["Elite"], tiers),
  ];
  assert.strictEqual(R.nearMissSetHints(chosen, ["Strength"]).length, 0);
});

test("nearMissSetHints stays silent when not exactly one short", () => {
  const tiers = [{ set: "Elite", n: 3, affixes: [["Dodge", "Insightful", 3]] }];
  const chosen = [chosenItem("A", "Ring", [], ["Elite"], tiers)]; // only 1 of 3
  assert.strictEqual(R.nearMissSetHints(chosen, ["Dodge"]).length, 0);
});

// ---- U5: Dino insert assignment + coverage disclosure ----
function chosenBlank(id, slot, dinoTypes) {
  return { slot, variant: { variant_id: id, slot, dino_slots_norm: dinoTypes || [] } };
}
function placedInsert(dino_type, stat, bonus_type, value) {
  return { dino_type, stat, bonus_type, value, wiki_url: "wiki" };
}

test("assignDinoInserts drops each placed insert into a matching-type slot", () => {
  const chosen = [chosenBlank("Boots", "Boots", ["Scale", "Claw"])];
  const placed = [
    placedInsert("Scale", "Constitution", "Enhancement", 14),
    placedInsert("Claw", "Physical Resistance Rating", "Enhancement", 35),
  ];
  const out = R.assignDinoInserts(chosen, placed);
  const stats = out.byIndex.get(0).map((d) => d.stat).sort();
  assert.deepStrictEqual(stats, ["Constitution", "Physical Resistance Rating"]);
  assert.strictEqual(out.unplaced.length, 0);
});

test("assignDinoInserts respects per-type slot capacity", () => {
  const chosen = [chosenBlank("Boots", "Boots", ["Scale"])]; // one Scale slot
  const placed = [
    placedInsert("Scale", "Constitution", "Enhancement", 14),
    placedInsert("Scale", "Strength", "Enhancement", 14),
  ];
  const out = R.assignDinoInserts(chosen, placed);
  assert.strictEqual(out.byIndex.get(0).length, 1, "only one fits the single Scale slot");
  assert.strictEqual(out.unplaced.length, 1);
});

test("coverageNote discloses Dino crafting as optimized + names the pending pools", () => {
  const note = R.coverageNote({ metadata: { dino_coverage: { inserts_eligible: 55 } } });
  assert.ok(/Isle of Dread Dino crafting/.test(note), "names Dino crafting as optimized");
  assert.ok(/55 Accessory inserts/.test(note), "shows the eligible count");
  assert.ok(/Weapon\/Armor\/Raid/.test(note), "discloses the pending pools honestly");
});

console.log(`\n${passed} passed`);
