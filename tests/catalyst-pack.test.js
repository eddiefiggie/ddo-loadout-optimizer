// #729 — Catalyst Crafting items and the content-ownership filter.
//
// Player report: "I have Terror of Demogorgon unchecked in content and No niche
// crafting checked, but Catalyst Crafting items are still added to build."
//
// Root cause of the first half: all 84 Catalyst records carried
// `location_pack: null`, and the #246 filter KEEPS an unsourced variant by design
// ("removes only what it can POSITIVELY determine is behind content the player
// says they do not have"). The pack was absent because the #495 harvest read
// categories and the quest infobox `adpack`, while the Catalyst Crafting page
// states its Terror of Demogorgon requirement in PROSE.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const M = require("../web/model.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  PASS", name); }
  catch (e) { console.log("  FAIL", name, "\n   ", e.message); process.exitCode = 1; }
}

const DS = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf8"));
const CATALYST = DS.items.filter((v) => v.location_quest === "Catalyst Crafting");

test("every Catalyst record is attributed to its expansion", () => {
  assert.strictEqual(CATALYST.length, 84, "population");
  for (const v of CATALYST) {
    assert.strictEqual(v.location_pack, "Terror of Demogorgon", v.variant_id);
    assert.strictEqual(v.location_kind, "crafting",
      "still a crafting source — the pack says what you must OWN, kind says what it IS");
  }
});

test("the reported case: unchecking the expansion now excludes them", () => {
  // A pack list that omits Terror of Demogorgon is the player's "unchecked".
  const owned = ["Free to Play", "Isle of Dread"];
  const m = M.buildModel(CATALYST.slice(0, 25), { mlCap: 36, targets: [], ownedPacks: owned });
  const kept = new Set((m.packExcluded || []).map((v) => v.variant_id));
  assert.ok(kept.size > 0, "at least one Catalyst variant must be excluded");
  // Nothing Catalyst survives into candidacy.
  const survived = (m.xVars || []).filter((x) => x.variant
    && x.variant.location_quest === "Catalyst Crafting");
  assert.strictEqual(survived.length, 0,
    "a player who unchecked Terror of Demogorgon must not be handed its crafted items");
});

test("ticking the expansion keeps them, so the fix is a filter and not a ban", () => {
  const owned = ["Terror of Demogorgon"];
  const m = M.buildModel(CATALYST.slice(0, 25), { mlCap: 36, targets: [], ownedPacks: owned });
  const excluded = (m.packExcluded || []).filter((v) => v.location_quest === "Catalyst Crafting");
  assert.strictEqual(excluded.length, 0, "owned content stays available");
});

test("an absent ownedPacks still filters nothing", () => {
  const m = M.buildModel(CATALYST.slice(0, 10), { mlCap: 36, targets: [] });
  assert.deepStrictEqual(m.packExcluded, [], "absent means filter nothing, as #246 documents");
});

console.log(`\n${passed} passed`);
