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

// ---- #734: two more crafting sources qualified on the same standard ----------
test("the crafting sources with a stated expansion requirement are attributed", () => {
  const want = {
    "Unholy Defiler of the Hidden Hand": ["Vecna Unleashed", 114],
    "Ritual Table": ["Magic of Myth Drannor", 71],
  };
  for (const [quest, [pack, count]] of Object.entries(want)) {
    const rows = DS.items.filter((v) => v.location_quest === quest);
    assert.strictEqual(rows.length, count, `${quest} population`);
    for (const v of rows) {
      assert.strictEqual(v.location_pack, pack, v.variant_id);
      assert.strictEqual(v.location_kind, "crafting", v.variant_id);
    }
  }
});

test("a crafting source whose page states no requirement stays unattributed", () => {
  // The checked-absence half. These pages were read and say nothing, so the
  // filter must keep their items — dropping them would be the guess #729's
  // `never_infer` rule exists to prevent.
  for (const quest of ["Stone of Change", "Cauldron of Sora Katra", "Epic Crafting"]) {
    const rows = DS.items.filter((v) => v.location_quest === quest);
    assert.ok(rows.length > 0, `${quest} carries no variants`);
    for (const v of rows) {
      assert.strictEqual(v.location_pack, null,
        `${v.variant_id}: attributed to a pack its page never states`);
    }
  }
});

test("introduced-with an expansion is not gated-behind it", () => {
  // #734 — the Sealed Altar case. Its page names Gravenhollow and no pack, and
  // Gravenhollow's page says the zone "is, however, accessible to all players,
  // even if you don't own the expansion". A location-based chain would have
  // attributed 90 variants to Terror of Demogorgon and wrongly excluded them
  // from players who can reach them. Pinned so a later sweep does not "finish
  // the job" by following that chain.
  const rows = DS.items.filter((v) => v.location_quest === "Sealed Altar");
  assert.strictEqual(rows.length, 90, "population");
  for (const v of rows) {
    assert.strictEqual(v.location_pack, null,
      "Gravenhollow is free to all players — the altar is not pack-gated");
  }
});

console.log(`\n${passed} passed`);
