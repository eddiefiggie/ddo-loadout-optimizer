// U1 — weapon/off-hand taxonomy. Run: node tests/weapon-taxonomy.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const T = require("../web/weapon-taxonomy.js");

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e.message}`); process.exitCode = 1; }
}

// Distinct dataset `type` values for the Weapon / Off Hand slots — the ground
// truth the taxonomy must cover (KTD6).
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8"));
const items = Array.isArray(raw) ? raw : raw.items;
const weaponTypes = [...new Set(items.filter((v) => v.slot === "Weapon" && v.type).map((v) => v.type))];
const offHandTypes = [...new Set(items.filter((v) => v.slot === "Off Hand" && v.type).map((v) => v.type))];

test("every dataset weapon type has a style assignment (no orphan)", () => {
  const orphans = T.orphanWeaponTypes(weaponTypes);
  assert.deepStrictEqual(orphans, [], `unmapped weapon types: ${orphans.join(", ")}`);
});

test("two-hand includes 2H melee + ranged, excludes 1H melee and unarmed", () => {
  const two = T.weaponTypesForStyle("two-hand", weaponTypes);
  assert.ok(two.includes("Falchions"));
  assert.ok(two.includes("Long Bows"), "ranged buckets under two-hand");
  assert.ok(two.includes("Repeating Heavy Crossbows"));
  assert.ok(!two.includes("Long Swords"));
  assert.ok(!two.includes("Handwraps"));
});

test("one-hand includes 1H melee + thrown + feat-1H, excludes 2H and ranged", () => {
  const one = T.weaponTypesForStyle("one-hand", weaponTypes);
  assert.ok(one.includes("Long Swords"));
  assert.ok(one.includes("Darts"), "thrown buckets under one-hand");
  assert.ok(one.includes("Bastard Swords"), "feat-1H stays one-hand");
  assert.ok(one.includes("Dwarven War Axes"));
  assert.ok(!one.includes("Great Axes"));
  assert.ok(!one.includes("Long Bows"));
});

test("unarmed is exactly Handwraps", () => {
  assert.deepStrictEqual(T.weaponTypesForStyle("unarmed", weaponTypes), ["Handwraps"]);
});

test("weaponTypesForStyle intersects with the dataset (KTD6) and sorts", () => {
  const subset = ["Long Swords", "Rapiers"]; // a Falchion is 2H and absent from this subset
  const one = T.weaponTypesForStyle("one-hand", subset);
  assert.deepStrictEqual(one, ["Long Swords", "Rapiers"]);
  // unbounded call returns all mapped members for the style
  assert.ok(T.weaponTypesForStyle("one-hand").length > subset.length);
});

test("off-hand enabled for one-hand/unarmed, disabled for two-hand", () => {
  assert.strictEqual(T.offHandEnabledForStyle("two-hand"), false);
  assert.strictEqual(T.offHandEnabledForStyle("one-hand"), true);
  assert.strictEqual(T.offHandEnabledForStyle("unarmed"), true);
  assert.strictEqual(T.offHandEnabledForStyle(null), true, "unset style is permissive");
});

test("OFF_HAND_TYPES matches the dataset's distinct off-hand types", () => {
  assert.deepStrictEqual([...T.OFF_HAND_TYPES].sort(), [...offHandTypes].sort(),
    `taxonomy off-hand types diverge from dataset: ${offHandTypes.join(", ")}`);
  assert.strictEqual(T.OFF_HAND_EMPTY, "empty");
});

if (!process.exitCode) console.log(`\n${passed} passed`);
