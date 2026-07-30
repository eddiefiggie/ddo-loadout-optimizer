// U1 — crafting-system metadata registry. Run: node tests/crafting-systems.test.js
const assert = require("assert");
const { SYSTEMS, get, systemForStation, actionLabel } = require("../web/crafting-systems.js");

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e.message}`); process.exitCode = 1; }
}

test("every system resolves its correct labels", () => {
  assert.strictEqual(get("nearly-finished").action_label, "Apply Nearly Finished option: {effect}");
  assert.strictEqual(get("vecna-lost-purpose").action_label, "Awaken Set Bonus: {set_name}");
  assert.strictEqual(get("isle-of-dread-set-bonus").action_label, "Slot Set Bonus augment: {set_name}");
  assert.strictEqual(get("viktranium").action_label, "Slot {slot_type} Viktranium augment: {effect}");
  assert.strictEqual(get("nearly-completed").action_label, "Apply Nearly Completed option: {effect}");
  assert.strictEqual(get("sun-moon").action_label, "Slot {slot_type} Augment: {effect}");
});

test("systemForStation forks Vecna vs Isle of Dread", () => {
  assert.strictEqual(systemForStation("Cannith Repurposing Station"), "vecna-lost-purpose");
  assert.strictEqual(systemForStation("Dinosaur Bone crafting"), "isle-of-dread-set-bonus");
});

test("an unknown station returns null (safe default)", () => {
  assert.strictEqual(systemForStation("Nowhere"), null);
  assert.strictEqual(get("no-such-system"), null);
});

test("actionLabel fills placeholders and leaves unknown ones visible", () => {
  assert.strictEqual(actionLabel("vecna-lost-purpose", { set_name: "Legendary Vol's Influence" }),
    "Awaken Set Bonus: Legendary Vol's Influence");
  assert.strictEqual(actionLabel("viktranium", { slot_type: "Melancholic", effect: "Constitution +15" }),
    "Slot Melancholic Viktranium augment: Constitution +15");
  // missing value stays as the visible placeholder
  assert.strictEqual(actionLabel("vecna-lost-purpose", {}), "Awaken Set Bonus: {set_name}");
});

test("only the Vecna system uses 'awaken' in its labels", () => {
  for (const id of Object.keys(SYSTEMS)) {
    const s = SYSTEMS[id];
    const text = `${s.action_label} ${s.result_label} ${s.system_name}`.toLowerCase();
    if (id === "vecna-lost-purpose") {
      assert.ok(/awaken/.test(text), "Vecna should keep awaken");
    } else {
      assert.ok(!/awaken/.test(text), `${id} must not use 'awaken': ${text}`);
    }
  }
});

if (!process.exitCode) console.log(`\n${passed} passed`);
