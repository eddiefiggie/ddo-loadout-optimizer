// U1 — weapon/off-hand taxonomy (4 DDO-verified styles). Run: node tests/weapon-taxonomy.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const T = require("../web/weapon-taxonomy.js");

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e.message}`); process.exitCode = 1; }
}

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8"));
const items = Array.isArray(raw) ? raw : raw.items;
const weaponTypes = [...new Set(items.filter((v) => v.slot === "Weapon" && v.type).map((v) => v.type))];
const offHandTypes = [...new Set(items.filter((v) => v.slot === "Off Hand" && v.type).map((v) => v.type))];

test("four styles: one-hand, thf, ranged, unarmed", () => {
  assert.deepStrictEqual(T.STYLES.map((s) => s.id), ["one-hand", "thf", "ranged", "unarmed"]);
  assert.ok(T.STYLES.find((s) => s.id === "thf").label === "Two Handed Fighting");
});

test("every dataset weapon type has a style assignment (no orphan)", () => {
  const orphans = T.orphanWeaponTypes(weaponTypes);
  assert.deepStrictEqual(orphans, [], `unmapped weapon types: ${orphans.join(", ")}`);
});

test("THF is two-handed melee only — no bows, no one-handers", () => {
  const thf = T.weaponTypesForStyle("thf", weaponTypes);
  assert.ok(thf.includes("Falchions") && thf.includes("Quarterstaffs"));
  assert.ok(!thf.includes("Long Bows"), "bows are Ranged, not THF");
  assert.ok(!thf.includes("Long Swords"));
});

test("Ranged holds bows and ALL crossbows (incl. light/heavy)", () => {
  const r = T.weaponTypesForStyle("ranged", weaponTypes);
  for (const t of ["Long Bows", "Short Bows", "Light Crossbows", "Heavy Crossbows",
    "Great Crossbows", "Repeating Heavy Crossbows", "Repeating Light Crossbows"]) {
    assert.ok(r.includes(t), `${t} should be Ranged`);
  }
  assert.ok(!r.includes("Long Swords"));
});

test("one-hand holds one-handed + light + thrown, not crossbows or two-handers", () => {
  const one = T.weaponTypesForStyle("one-hand", weaponTypes);
  assert.ok(one.includes("Long Swords") && one.includes("Rapiers") && one.includes("Bastard Swords"));
  assert.ok(one.includes("Darts"), "thrown are one-handed");
  assert.ok(!one.includes("Light Crossbows"), "crossbows are Ranged, not one-hand");
  assert.ok(!one.includes("Falchions") && !one.includes("Handwraps"));
});

test("unarmed is exactly Handwraps", () => {
  assert.deepStrictEqual(T.weaponTypesForStyle("unarmed", weaponTypes), ["Handwraps"]);
});

test("off-hand ITEM enabled for one-hand/unarmed, disabled for THF/ranged", () => {
  assert.strictEqual(T.offHandEnabledForStyle("one-hand"), true);
  assert.strictEqual(T.offHandEnabledForStyle("unarmed"), true);
  assert.strictEqual(T.offHandEnabledForStyle("thf"), false);
  assert.strictEqual(T.offHandEnabledForStyle("ranged"), false, "a crossbow/bow takes both hands");
});

test("a second weapon (TWF) is allowed only in the one-hand style", () => {
  assert.strictEqual(T.twfWeaponAllowedForStyle("one-hand"), true);
  assert.strictEqual(T.twfWeaponAllowedForStyle("unarmed"), false);
  assert.strictEqual(T.twfWeaponAllowedForStyle("thf"), false);
  assert.strictEqual(T.twfWeaponAllowedForStyle("ranged"), false);
});

test("offHandWeaponTypes are the one-handed weapons (dataset-intersected)", () => {
  const w = T.offHandWeaponTypes(weaponTypes);
  assert.ok(w.includes("Long Swords") && w.includes("Rapiers") && w.includes("Daggers"));
  assert.ok(!w.includes("Falchions") && !w.includes("Light Crossbows"), "only one-handed weapons dual-wield");
});

test("OFF_HAND_TYPES matches the dataset's distinct off-hand types", () => {
  assert.deepStrictEqual([...T.OFF_HAND_TYPES].sort(), [...offHandTypes].sort());
  assert.strictEqual(T.OFF_HAND_EMPTY, "empty");
});

if (!process.exitCode) console.log(`\n${passed} passed`);
