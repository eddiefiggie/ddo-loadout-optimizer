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

test("six styles: one-hand, sword-board, thf, ranged(bow), crossbow, unarmed", () => {
  assert.deepStrictEqual(T.STYLES.map((s) => s.id), ["one-hand", "sword-board", "thf", "ranged", "crossbow", "unarmed"]);
  assert.strictEqual(T.STYLES.find((s) => s.id === "thf").label, "Two Handed Fighting");
  assert.strictEqual(T.STYLES.find((s) => s.id === "crossbow").label, "Crossbow + Rune Arm");
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

test("Ranged (Bow) holds only bows; crossbows are their own style", () => {
  const r = T.weaponTypesForStyle("ranged", weaponTypes);
  assert.deepStrictEqual(r.sort(), ["Long Bows", "Short Bows"]);
  assert.strictEqual(T.offHandEnabledForStyle("ranged"), false, "a bow takes both hands");
});

test("Crossbow style holds ALL crossbows and allows a rune-arm off-hand only", () => {
  const c = T.weaponTypesForStyle("crossbow", weaponTypes);
  for (const t of ["Light Crossbows", "Heavy Crossbows", "Great Crossbows",
    "Repeating Heavy Crossbows", "Repeating Light Crossbows"]) {
    assert.ok(c.includes(t), `${t} should be a Crossbow-style weapon`);
  }
  assert.ok(!c.includes("Long Bows"), "bows are not crossbows");
  assert.strictEqual(T.offHandEnabledForStyle("crossbow"), true, "a crossbow can take a rune arm");
  assert.deepStrictEqual(T.offHandTypesForStyle("crossbow"), ["Rune Arms"], "rune arm only — no shield/orb");
  assert.strictEqual(T.twfWeaponAllowedForStyle("crossbow"), false, "no dual-wield with a crossbow");
  assert.strictEqual(T.offHandTypesForStyle("one-hand"), null, "one-hand off-hand is unrestricted");
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


// --- U2: Sword & Board style ---
test("U2: Sword & Board is a selectable style", () => {
  assert.ok(T.STYLES.some((s) => s.id === "sword-board" && /sword/i.test(s.label)));
});
test("U2: S&B off-hand is the four shield types only (no Orbs/Rune Arms)", () => {
  assert.deepStrictEqual(T.offHandTypesForStyle("sword-board"),
    ["Bucklers", "Small shields", "Large shields", "Tower shields"]);
});
test("U2: S&B enables the off hand and forbids a TWF second weapon", () => {
  assert.strictEqual(T.offHandEnabledForStyle("sword-board"), true);
  assert.strictEqual(T.twfWeaponAllowedForStyle("sword-board"), false);
});
test("U2: S&B main hand draws from the one-handed weapon bucket", () => {
  const sb = T.weaponTypesForStyle("sword-board");
  const one = T.weaponTypesForStyle("one-hand");
  assert.deepStrictEqual(sb, one, "S&B main-hand weapon types equal the one-hand bucket");
  assert.ok(!sb.includes("Great Swords") && !sb.includes("Quarterstaffs"), "no two-handers");
});


if (!process.exitCode) console.log(`\n${passed} passed`);
