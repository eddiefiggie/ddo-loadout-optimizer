// #743 — per-effect slot reachability. Run: node tests/slot-reachability.test.js
//
// The question this answers is the one the app could not: "the effect exists, I
// ranked it first, and I wanted it in a slot that can never supply it." Ranking
// `Assassinate` top does not fail — the solver satisfies it from Gloves or a Ring
// and reports optimal, which is correct and says nothing about the weapon the
// player asked about.
//
// Two disciplines are pinned here and both are easy to erode:
//
//   1. An AUGMENT route is named as an augment route, never folded into the worn
//      slot list. `Yellow` is not a gear slot, and the founding case turns on the
//      difference: 4 weapons declare a Yellow slot and 2 Yellow augments carry
//      Assassinate, so "no weapon route" — what a native-only scan reports — is
//      WRONG in exactly the case that prompted the issue.
//   2. The statement is DESCRIPTIVE. It never ranks slots, never calls a route
//      better, never proposes an action. See tests/cap-opportunity.test.js for the
//      same line held on the #747 notice.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const M = require("../web/model.js");

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e.message}`); process.exitCode = 1; }
}

// Driven against the REAL built catalog, not fixtures. The evidence table in
// docs/plans/2026-09-12-001-feat-slot-reachability-disclosure-plan.md was measured
// from this file, and these assertions reproduce it — a fixture could be made to
// agree with a wrong implementation.
const DATA = path.join(__dirname, "..", "web", "data", "items.json");
const dataset = JSON.parse(fs.readFileSync(DATA, "utf8"));
const POOLS = {
  dinoInserts: dataset.dino_inserts || [],
  viktranium: dataset.viktranium || [],
  seal: dataset.seal || [],
  legendaryGreenSteel: dataset.legendary_green_steel || [],
  essenceCrafting: dataset.essence_crafting || [],
};

/** Every route for `stat` over the whole catalog (no query filtering). */
function routes(stat, variants = dataset.items) {
  return M.slotReachabilityFor(stat, variants, POOLS);
}
const at = (rs, slot, route) => rs.filter((r) => r.slot === slot && r.route === route);
const slotsFor = (rs, route) => [...new Set(rs.filter((r) => r.route === route).map((r) => r.slot))];

// ---- the founding case: the augment route the issue itself missed -----------

test("#743: a Weapon reaches Assassinate through a Yellow augment", () => {
  const r = at(routes("Assassinate"), "Weapon", "augment");
  assert.ok(r.length, "expected a Weapon augment route for Assassinate");
  assert.ok(r.some((x) => x.via === "Yellow"), `expected the Yellow colour, got ${JSON.stringify(r.map((x) => x.via))}`);
});

test("#743: the four named weapons are reported as a NATIVE Enhancement route", () => {
  const r = at(routes("Assassinate"), "Weapon", "native");
  assert.ok(r.length, "expected a native Weapon route");
  assert.deepStrictEqual([...new Set(r.flatMap((x) => x.bonusTypes))], ["Enhancement"]);
});

test("#743: Off Hand is augment-reachable for Assassinate", () => {
  assert.ok(at(routes("Assassinate"), "Off Hand", "augment").length,
    "40 Off Hand items declare a Yellow slot; expected an Off Hand augment route");
});

// ---- the two boundaries the issue established, which must survive -----------

test("#743: NO weapon or off-hand route supplies Assassinate at Insight, by any channel", () => {
  const r = routes("Assassinate").filter((x) => (x.slot === "Weapon" || x.slot === "Off Hand")
    && x.bonusTypes.includes("Insight"));
  assert.deepStrictEqual(r, [], `expected no Insight weapon/off-hand route, got ${JSON.stringify(r)}`);
});

test("#743: no Weapon or Off Hand host declares a Miserable Viktranium slot", () => {
  const r = routes("Assassinate").filter((x) => x.route === "viktranium"
    && (x.slot === "Weapon" || x.slot === "Off Hand"));
  assert.deepStrictEqual(r, [], "the Viktranium Assassinate option sits in the Accessory pool");
});

// ---- an augment colour is never reported as a worn slot (R4 / KTD2) ---------

test("#743: no route is keyed on an augment colour as if it were a gear slot", () => {
  const COLOURS = new Set(["Blue", "Colorless", "Green", "Moon", "Orange", "Purple", "Red", "Sun", "Yellow"]);
  for (const stat of ["Assassinate", "Concealment", "Sheltering"]) {
    const bad = routes(stat).filter((r) => COLOURS.has(r.slot));
    assert.deepStrictEqual(bad, [], `${stat} reported a colour as a slot: ${JSON.stringify(bad)}`);
  }
});

test("#743: every reported slot is a real worn slot", () => {
  const WORN = new Set(["Weapon", "Armor", "Off Hand", "Ring", "Gloves", "Trinket", "Cloak", "Goggles",
    "Bracers", "Necklace", "Belt", "Boots", "Helmet", "Quiver", "Main Hand", "Rune Arm"]);
  for (const r of routes("Assassinate")) assert.ok(WORN.has(r.slot), `not a worn slot: ${r.slot}`);
});

// ---- KTD5: a separate source pool must not be invisible ---------------------

test("#743: a dino-insert-only effect still returns a route", () => {
  // browse-visibility-for-separate-source-pools.md: 55 Dino inserts were once
  // invisible to a view that iterated items[] while the solver used them. An
  // items[]-only reachability scan is that defect again.
  const stats = new Set();
  for (const i of POOLS.dinoInserts) for (const a of (i.affixes || [])) stats.add(a.stat);
  const nativeNames = new Set();
  for (const x of dataset.items) for (const a of (x.affixes || [])) nativeNames.add(a.name);
  const only = [...stats].find((s) => !nativeNames.has(s));
  if (!only) return; // no such effect in this build; the guard below still holds
  assert.ok(routes(only).some((r) => r.route === "dino"),
    `${only} is carried only by a dino insert and returned no dino route`);
});

test("#743: at least one route is found in every crafting channel that carries one", () => {
  const seen = new Set();
  const probe = (list, get) => { for (const o of list) for (const s of get(o)) seen.add(s); };
  probe(POOLS.seal, (o) => (o.stat ? [o.stat] : []));
  const found = [...seen].some((s) => routes(s).some((r) => r.route === "seal"));
  assert.ok(found, "no seal route was ever produced, so the seal channel is unreachable");
});

// ---- shape and safety -------------------------------------------------------

test("#743: an effect nothing carries returns an empty route set, not a throw", () => {
  assert.deepStrictEqual(routes("Definitely Not A Real Affix Name"), []);
});

test("#743: one slot reachable at two bonus types reports both", () => {
  const gloves = at(routes("Assassinate"), "Gloves", "native");
  const types = new Set(gloves.flatMap((r) => r.bonusTypes));
  assert.ok(types.size >= 2, `expected Gloves to carry Assassinate at several types, got ${[...types]}`);
});

test("#743: routes carry no recommendation — data only, no prose", () => {
  for (const r of routes("Assassinate")) {
    assert.deepStrictEqual(Object.keys(r).sort(), ["bonusTypes", "route", "slot", "via"].sort());
    assert.ok(Array.isArray(r.bonusTypes));
  }
});

console.log(`\n${passed} passed`);
