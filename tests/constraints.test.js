// U6 — per-slot pin/lock/free constraints (node, zero-dependency; no HiGHS).
const assert = require("assert");
const M = require("../web/model.js");
const S = require("../web/solver.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  PASS", name); }
  catch (e) { console.log("  FAIL", name, "\n   ", e.message); process.exitCode = 1; }
}

function v(name, slot, con, opts = {}) {
  return {
    source_item: name, variant_id: name, slot, category: opts.category || "item",
    minimum_level: 10, ml: 10, verification: "verified",
    affixes: [{ stat: "Constitution", bonus_type: "Enhancement", name: "Constitution", type: "Enhancement", value: con, unit: "flat" }],
    scaling: [], set_bonus: [], augment_slots: [], restrictions: "unknown", armor_type: null,
  };
}

const targets = ["Constitution"];

test("slotConstraintBodies: pin -> var = 1, empty -> sum = 0, free -> skip", () => {
  const xVars = [
    { name: "x0", slot: "Trinket", variant: { variant_id: "T1" } },
    { name: "x1", slot: "Trinket", variant: { variant_id: "T2" } },
    { name: "x2", slot: "Belt", variant: { variant_id: "B1" } },
  ];
  const bodies = S.slotConstraintBodies(xVars, {
    Belt: { type: "pin", variant_id: "B1" },
    Trinket: { type: "empty" },
    Cloak: { type: "free" },
  });
  assert.ok(bodies.includes("x2 = 1"), "pin body");
  assert.ok(bodies.includes("x0 + x1 = 0"), "lock-empty body");
  assert.strictEqual(bodies.length, 2); // free emits nothing
});

test("slotConstraintBodies: a pin for a variant not in the pool is a no-op", () => {
  const xVars = [{ name: "x0", slot: "Belt", variant: { variant_id: "B1" } }];
  assert.deepStrictEqual(
    S.slotConstraintBodies(xVars, { Belt: { type: "pin", variant_id: "GONE" } }), []);
});

test("buildProgram injects slot constraints into extraConstraints", () => {
  const variants = [v("Big Belt", "Belt", 20), v("Trink", "Trinket", 12)];
  const query = {
    mlCap: 34, targets,
    slotConstraints: { Belt: { type: "pin", variant_id: "Big Belt" }, Trinket: { type: "empty" } },
  };
  const model = M.buildModel(variants, query);
  const program = S.buildProgram(model);
  const injected = S.slotConstraintBodies(program.xVars, query.slotConstraints);
  assert.strictEqual(injected.length, 2);
  injected.forEach((b) => assert.ok(program.extraConstraints.includes(b), `missing: ${b}`));
});

test("no slotConstraints -> buildProgram adds no pin/lock bodies (live behavior)", () => {
  const model = M.buildModel([v("Belt", "Belt", 20)], { mlCap: 34, targets });
  const program = S.buildProgram(model);
  const suspicious = program.extraConstraints.filter((b) => / = 1$| = 0$/.test(b));
  assert.strictEqual(suspicious.length, 0);
});

test("a pinned but dominated variant survives the dominance pre-filter", () => {
  // B (Con 5) is strictly dominated by A (Con 20) in the Ring slot; pinning B
  // must keep it so its pick var exists for the `= 1` constraint.
  const A = v("RingA", "Ring", 20), B = v("RingB", "Ring", 5);
  const query = { mlCap: 34, targets, slotConstraints: { Ring: { type: "pin", variant_id: "RingB" } } };
  const model = M.buildModel([A, B], query);
  const ring = model.worn.find((g) => g.slot === "Ring");
  const ids = ring.variants.map((x) => x.variant_id);
  assert.ok(ids.includes("RingB"), "pinned dominated variant was pruned");
  // and without the pin, B is correctly pruned
  const model2 = M.buildModel([A, B], { mlCap: 34, targets });
  const ring2 = model2.worn.find((g) => g.slot === "Ring");
  assert.ok(!ring2.variants.map((x) => x.variant_id).includes("RingB"));
});

test("pin-exemption also covers the Main Hand and Rune Arm slots", () => {
  const wA = { ...v("SwordA", "Weapon", 20), category: "weapon" };
  const wB = { ...v("SwordB", "Weapon", 5), category: "weapon" };   // dominated
  const rA = { ...v("RuneA", "RuneArm", 20), category: "runearm" };
  const rB = { ...v("RuneB", "RuneArm", 5), category: "runearm" };  // dominated
  const query = {
    mlCap: 34, targets,
    slotConstraints: {
      "Main Hand": { type: "pin", variant_id: "SwordB" },
      "Rune Arm": { type: "pin", variant_id: "RuneB" },
    },
  };
  const model = M.buildModel([wA, wB, rA, rB], query);
  const mh = model.worn.find((g) => g.slot === "Main Hand").variants.map((x) => x.variant_id);
  const ra = model.worn.find((g) => g.slot === "Rune Arm").variants.map((x) => x.variant_id);
  assert.ok(mh.includes("SwordB"), "pinned dominated weapon was pruned");
  assert.ok(ra.includes("RuneB"), "pinned dominated rune arm was pruned");
});

console.log(`\n${passed} passed`);
