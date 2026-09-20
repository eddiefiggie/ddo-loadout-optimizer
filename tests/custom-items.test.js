// #773 — player-authored items. Run: node tests/custom-items.test.js
//
// Four things are worth the reader's attention here, because each closes a way
// this feature could have shipped looking correct:
//
//  1. The refusals are tested one at a time, by REASON. A validator that returns
//     `ok: false` for everything passes a "rejects bad input" test, and the
//     player's experience of it is a form that will not submit and will not say
//     why. Each case below asserts the sentence names the field.
//  2. The minted record's key set is compared against the CATALOG's. A custom
//     item is only cheap to support because it is the same shape as everything
//     else; a missing field is a downstream reader that silently behaves
//     differently on the player's item than on a real one.
//  3. The no-context `_canDeclare` fallback is proved to agree with wizard.js's
//     `canDeclareCredit` over the real vocabulary — the module comment claims the
//     two are one rule and not two, and this is the assertion behind that claim.
//  4. The end-to-end case is the REPORTED one, solved through the real solver:
//     a crafted off-hand dagger carrying Assassinate at two bonus types, pinned
//     to the off hand, with the rest of the build filling in around it.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); console.log("PASS " + name); passed++; }
  catch (e) { console.log("FAIL " + name + " \n  " + (e && e.message)); failed++; process.exitCode = 1; }
};

const C = require("../web/custom-items.js");
const { normalizeDataset, buildPickerVocabulary } = require("../web/dataset.js");
const { canDeclareCredit } = require("../web/wizard.js");
const { CREDIT_BONUS_TYPES } = require("../web/model.js");

const DATASET = path.join(__dirname, "..", "web", "data", "items.json");
const raw = JSON.parse(fs.readFileSync(DATASET, "utf8"));
const dataset = normalizeDataset(raw);
const vocab = buildPickerVocabulary(dataset);
const catalogNames = new Set(dataset.items.map((v) => v.source_item || v.variant_id));
// #795 — the placement table travels on ctx, exactly as the browser passes it.
// A test that let the module reach for a global would be validating against
// something the app does not use.
const placements = raw.essence_placements;
// #817 — the skill membership the rule uses, read from table 2c's own Group
// column rather than restated here.
const SKILL_NAMES = new Set(JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "data", "seed", "compendium",
            "essence_recipe_groups.json"), "utf8")).scaling_groups.Skill);
const ctx = { vocab, catalogNames, canDeclare: canDeclareCredit, placements };
// Taken from the built catalog rather than hard-coded: a literal name would rot
// the moment the roster renamed it, and the test would then pass by testing
// nothing (a name the catalog no longer has cannot collide with it).
const A_REAL_CATALOG_NAME = dataset.items.find((v) => v.category !== "augment").source_item;

/** The reporter's item, rebuilt on the crafting bench (#795).
 *
 *  A Cannith-crafted dagger at ML 36. Under the placement model the three effects
 *  they described fall into the three menus a Melee weapon actually has, and the
 *  mapping is the feature working rather than a coincidence:
 *
 *    Prefix  Armor-Piercing
 *    Suffix  Assassinate
 *    Extra   Insightful Assassinate      <- the game's OWN name for it
 *
 *  The last line is the point. Before this, the form made them decompose the
 *  in-game "Insightful Assassinate" into `Assassinate` + the `Insight` bonus type
 *  by hand; now they pick the enchantment the game shows them. It is still
 *  `Assassinate` in the `Insight` bucket underneath — three buckets of one stat —
 *  which is why the report asked for Quality Assassinate to be found elsewhere.
 *
 *  None of the three is `sourced`: the wiki publishes no bonus type for them, so
 *  the player supplies it and the item is disclosed as player-authored. */
function dagger(over) {
  return Object.assign({
    uid: 1, name: "My Cannith dagger", slot: "Weapon", type: "Daggers", ml: 36,
    augments: ["Red"],
    affixes: [
      { menu: "Prefix", effect: "Armor-Piercing", bonus_type: "Enhancement", value: 25 },
      { menu: "Suffix", effect: "Assassinate", bonus_type: "Enhancement", value: 8 },
      { menu: "Extra", effect: "Insightful Assassinate", bonus_type: "Insight", value: 4 },
    ],
  }, over || {});
}

/** #810 — an item whose enchantment the wiki does NOT value, so the player still
 *  supplies the number. `Healing Amplification` has no resolvable ML curve
 *  (`essence_curve_join` quarantines it as unmapped), which is exactly what makes
 *  it the right fixture for the value rules: since #810 a magnitude the wiki
 *  publishes is filled and locked, so those rules are unreachable through an
 *  enchantment like `Assassinate`. Found by listing placements rather than
 *  assumed — 35 of 523 still take a player value. */
function playerValued(over) {
  return Object.assign({
    uid: 5, name: "My gloves", slot: "Gloves", ml: 30, augments: [],
    affixes: [{ menu: "Suffix", effect: "Healing Amplification",
                bonus_type: "Quality", value: 20 }],
  }, over || {});
}

/** A ring whose Prefix enchantment the wiki fully publishes: bonus type AND the
 *  magnitude at every ML. The form fills both and locks them, and the value is
 *  NOT a player assertion. */
function sourcedRing(over) {
  return Object.assign({
    uid: 2, name: "My CC ring", slot: "Ring", ml: 20, augments: [],
    affixes: [{ menu: "Prefix", effect: "Charisma" }],
  }, over || {});
}

// ---------------------------------------------------------------------------
// Acceptance

test("#773: the reported item validates, and the cleaned entry is what gets stored", () => {
  const v = C.validateEntry(dagger(), ctx);
  assert.deepStrictEqual(v.errors, [], "no refusal");
  assert.ok(v.ok);
  assert.strictEqual(v.entry.name, "My Cannith dagger");
  assert.strictEqual(v.entry.ml, 36, "ML is stored as a number, not the typed string");
  assert.deepStrictEqual(v.entry.augments, ["Red"]);
  assert.strictEqual(v.entry.affixes.length, 3);
  for (const a of v.entry.affixes) {
    assert.strictEqual(typeof a.value, "number", "values are numbers by the time they are stored");
  }
});

test("#773: a typed string ML and typed string values are accepted and coerced", () => {
  // The form's inputs are strings. Refusing them would make the panel unusable
  // while the unit tests stayed green, which is the failure this case exists for.
  const v = C.validateEntry(playerValued({ ml: "30",
    affixes: [{ menu: "Suffix", effect: "Healing Amplification",
                bonus_type: "Quality", value: "3" }] }), ctx);
  assert.ok(v.ok, v.errors.join(" | "));
  assert.strictEqual(v.entry.ml, 30);
  assert.strictEqual(v.entry.affixes[0].value, 3);
});

test("#773: a worn slot needs no type, and a stray one is dropped rather than refused", () => {
  const v = C.validateEntry({
    uid: 2, name: "My CC ring", slot: "Ring", type: "Daggers", ml: 32,
    augments: [], affixes: [{ menu: "Prefix", effect: "Constitution" }],
  }, ctx);
  assert.ok(v.ok, v.errors.join(" | "));
  assert.strictEqual(v.entry.type, "", "a Ring carries no type, and the stray value is not an error the player could see coming");
});

// ---------------------------------------------------------------------------
// Refusals — one at a time, each asserting the sentence names its own field.

/** #795 — fixtures are FOUND in the published table, never written down.
 *  A literal "Belts / Suffix / Deathblock" would rot the moment the harvest
 *  moved it, and the test would then pass by testing nothing. */
function findPlacement(pred) {
  const g = placements.groups;
  for (const group of Object.keys(g)) {
    for (const menu of ["Prefix", "Suffix", "Extra"]) {
      for (const row of g[group][menu] || []) {
        if (pred(row, group, menu)) return { group, menu, row };
      }
    }
  }
  return null;
}
/** The catalog slot that hosts a group, from the table's own map. */
function slotForGroup(group) {
  const m = placements.slot_groups;
  return Object.keys(m).find((s0) => (m[s0] || []).indexOf(group) >= 0);
}

const REFUSALS = [

  ["a name the catalog already uses", dagger({ name: A_REAL_CATALOG_NAME }), /already the name/i],
  ["an unknown slot", dagger({ slot: "Pocket" }), /slot/i],
  ["a weapon with no type", dagger({ type: "" }), /kind of weapon/i],
  ["a type the taxonomy does not know", dagger({ type: "Spoons" }), /not a type/i],
  ["an ML below the floor", dagger({ ml: 0 }), /Minimum level/],
  ["an ML above the cap", dagger({ ml: 37 }), /Minimum level/],
  ["a fractional ML", dagger({ ml: 12.5 }), /whole number/],
  ["no effects at all", dagger({ affixes: [] }), /at least one enchantment/i],
  ["an enchantment this item type cannot host",
   dagger({ affixes: [{ menu: "Suffix", effect: "Doom Aura", bonus_type: "Quality", value: 3 }] }),
   /cannot be crafted/i],
  ["a bonus type outside the list",
   dagger({ affixes: [{ menu: "Suffix", effect: "Assassinate", bonus_type: "Shiny", value: 3 }] }), /bonus type/i],
  ["a zero value",
   playerValued({ affixes: [{ menu: "Suffix", effect: "Healing Amplification", bonus_type: "Quality", value: 0 }] }), /above zero/i],
  ["a negative value",
   playerValued({ affixes: [{ menu: "Suffix", effect: "Healing Amplification", bonus_type: "Quality", value: -4 }] }), /above zero/i],
  ["a value over the ceiling",
   playerValued({ affixes: [{ menu: "Suffix", effect: "Healing Amplification", bonus_type: "Quality", value: 100000 }] }), /ceiling/i],
  // #795 — the placement rules themselves.
  ["an enchantment in the wrong menu",
   dagger({ affixes: [{ menu: "Prefix", effect: "Assassinate", bonus_type: "Quality", value: 3 }] }),
   /cannot be crafted into the Prefix menu/i],
  ["two enchantments in one menu",
   dagger({ affixes: [
     { menu: "Suffix", effect: "Assassinate", bonus_type: "Quality", value: 3 },
     { menu: "Suffix", effect: "Deadly", bonus_type: "Quality", value: 2 }] }),
   /both in the Suffix menu/i],
  ["the Extra menu below ML 10",
   dagger({ ml: 9, affixes: [{ menu: "Extra", effect: "Insightful Assassinate", bonus_type: "Insight", value: 4 }] }),
   /Extra menu is not available/i],
  ["a quiver, which cannot be Essence Crafted",
   dagger({ slot: "Quiver", type: "", affixes: [{ menu: "Prefix", effect: "Assassinate", bonus_type: "Quality", value: 3 }] }),
   /cannot be Essence Crafted/i],
  ["a thrown weapon, whose crafting group the wiki does not state",
   dagger({ type: "Throwing Daggers" }), /does not say which one/i],
  ["an augment colour that is not one", dagger({ augments: ["Chartreuse"] }), /colour/i],
];

for (const [label, entry, pattern] of REFUSALS) {
  test(`#773: ${label} is refused, and the sentence says which field`, () => {
    const v = C.validateEntry(entry, ctx);
    assert.ok(!v.ok, "must be refused");
    assert.ok(v.errors.some((e) => pattern.test(e)),
      `no error matched ${pattern}; got: ${v.errors.join(" | ")}`);
  });
}

test("#773 -> #774: a presence-only effect is no longer refused, it is a flag", () => {
  // This test used to assert the OPPOSITE, and the change is deliberate. #773
  // shipped without on/off effects and refused them by name; #774 admits them as
  // flags, because the measurement showed the Utility tier counts them through
  // the ordinary bucket machinery with no special case (see the solve test).
  //
  // Kept rather than deleted, and pointed at the population it used to refuse, so
  // the reversal is legible to whoever finds this next instead of looking like a
  // guard someone quietly dropped.
  // #795 — over presence-only PLACEMENTS now, not over the whole vocabulary: an
  // on/off stat that no item type can host is not a case this form can reach, and
  // asserting it would test the validator against input the picker cannot produce.
  const rows = [];
  const g = placements.groups;
  for (const group of Object.keys(g)) {
    for (const menu of ["Prefix", "Suffix", "Extra"]) {
      for (const row of g[group][menu] || []) {
        if (row.rankable && !row.sourced && C.isPresenceEffect(row.stat, vocab, ctx)) {
          rows.push({ group, menu, row });
        }
      }
    }
  }
  assert.ok(rows.length, "the placement table has presence-only enchantments to test with");
  for (const { group, menu, row } of rows.slice(0, 25)) {
    const slot = slotForGroup(group);
    // Skip the two ambiguous slots: their group needs a type, which this loop
    // does not have, and the branch under test is the flag one.
    if ((placements.slot_groups[slot] || []).length !== 1) continue;
    const v = C.validateEntry({ uid: 9, name: "Flag " + row.effect, slot, ml: 20,
      augments: [], affixes: [{ menu, effect: row.effect }] }, ctx);
    assert.deepStrictEqual(v.errors, [], `${row.effect} was refused: ${v.errors.join(" | ")}`);
    assert.strictEqual(v.entry.affixes[0].presence, true);
    assert.strictEqual(v.entry.affixes[0].bonus_type, undefined);
  }
});

test("#773: the no-context fallback is the SAME rule as wizard.js's canDeclareCredit", () => {
  // The module comment claims these are one rule read two ways rather than two
  // rules that happen to agree. wizard.js cannot be required from custom-items.js
  // (it requires custom-items.js back), so the agreement is asserted here instead
  // of being hoped for — over every name in the real vocabulary.
  const names = [...(vocab.known || [])];
  assert.ok(names.length > 100, "a real vocabulary, not a fixture");
  const disagree = [];
  for (const stat of names) {
    // Same entry twice: once with the injected predicate, once without.
    const withCtx = C.validateEntry(dagger({ affixes: [{ stat, bonus_type: "Quality", value: 3 }] }), ctx);
    const without = C.validateEntry(dagger({ affixes: [{ stat, bonus_type: "Quality", value: 3 }] }),
      { vocab, catalogNames });
    if (withCtx.ok !== without.ok) disagree.push(stat);
  }
  assert.deepStrictEqual(disagree, [],
    `the injected and fallback predicates disagree on: ${disagree.slice(0, 8).join(", ")}`);
});

// ---------------------------------------------------------------------------
// The minted record

test("#773: the minted record carries every field a catalog record carries", () => {
  // The whole feature rests on a custom item being the SAME shape as a catalog
  // one — that is what buys pinning, dominance, the augment capacity walk, the
  // results card and all six exports without a line of new code in any of them.
  // A field the pipeline stamps and this record omits is a reader that quietly
  // behaves differently on the player's item.
  // The INTERSECTION over every worn/wielded catalog record, not the union.
  //
  // A field present on all 8,047 of them is one a downstream reader may assume
  // without checking, so omitting it is a real divergence. A field only some
  // carry is only-when-set BY DESIGN — `duplicable_ring`, `block_identity`,
  // `material_class`, `location_lineage`, the four crafting-host markers — and
  // every reader of those already tests for presence (`v.duplicable_ring === true`,
  // `v.location_lineage || NO_SOURCE`). A custom item must NOT carry them: the
  // duplicable-ring allowlist in particular is a wiki-cited legality claim, and
  // minting it onto a player's ring would be the tool inventing that citation.
  //
  // Augments are excluded because they live in the same array with a different
  // shape entirely (`set`, `fits_slots`, `aug_color`), and a custom item is
  // never an augment.
  const worn = dataset.items.filter((v) => v.category !== "augment");
  assert.ok(worn.length > 5000, "a real roster, not a fixture");
  let catalogKeys = null;
  for (const v of worn) {
    const keys = new Set(Object.keys(v));
    if (catalogKeys === null) catalogKeys = keys;
    else for (const k of [...catalogKeys]) if (!keys.has(k)) catalogKeys.delete(k);
  }
  const mine = new Set(Object.keys(C.toVariant(C.validateEntry(dagger(), ctx).entry)));
  // Stamped by web/dataset.js's normalizeItem on load — over our record too, in
  // `customPool` — rather than at mint time.
  const ADDED_BY_NORMALIZER = new Set(["_affixProvenance", "_compositeOf", "unit"]);
  const missing = [...catalogKeys].filter((k) => !mine.has(k) && !ADDED_BY_NORMALIZER.has(k));
  assert.deepStrictEqual(missing, [],
    `the minted record omits fields EVERY catalog record carries: ${missing.join(", ")}`);
});

test("#773: the record is marked player-authored, and that marker is what identifies it", () => {
  const rec = C.toVariant(C.validateEntry(dagger(), ctx).entry);
  assert.strictEqual(rec.player_authored, true);
  assert.ok(C.isCustomVariant(rec));
  // Read the MARKER, never the id shape: a record carrying a custom-looking id
  // without the marker must not pass as player-authored, because every
  // disclosure surface keys on the marker and it would solve, place and export
  // as if the catalog had vouched for it.
  assert.ok(!C.isCustomVariant({ variant_id: "custom:9" }),
    "an id-shaped impostor with no marker is not player-authored");
  assert.ok(!C.isCustomVariant(dataset.items[0]), "and no catalog record is");
});

test("#773: verification is the solver's gate, not a sourcing claim", () => {
  // model.js refuses any variant whose verification is not "verified" with "this
  // item isn't verified", so a custom item must carry it to be placeable at all.
  // The pairing with player_authored is the point: the record is eligible AND
  // labelled, and neither field can be read as the other.
  const rec = C.toVariant(C.validateEntry(dagger(), ctx).entry);
  assert.strictEqual(rec.verification, "verified");
  assert.strictEqual(rec.player_authored, true);
});

test("#773: the id is the name plus the suffix, on BOTH name fields", () => {
  // The suffix is the structural half of the disclosure: this app prints
  // `variant_id` on the paperdoll and in the exports, and `source_item ||
  // variant_id` in the pin list, so both must carry it or the provenance would
  // show on some surfaces and vanish on others.
  const rec = C.toVariant(C.validateEntry(dagger(), ctx).entry);
  assert.strictEqual(rec.variant_id, "My Cannith dagger (yours)");
  assert.strictEqual(rec.source_item, rec.variant_id, "both name fields carry the suffix");
  assert.ok(C.isCustomId(rec.variant_id));
  assert.ok(!C.isCustomId(A_REAL_CATALOG_NAME));
  assert.strictEqual(C.customId({ name: "  Spaced  " }), "Spaced (yours)");
  assert.strictEqual(C.customId({ name: "" }), "", "a nameless entry mints no id");
});

test("#773: no catalog name contains the suffix, so a collision is impossible", () => {
  // The claim the whole identity scheme rests on, asserted against the BUILT
  // roster rather than assumed. If a future harvest ever produced a name
  // containing "(yours)", this goes red here instead of silently letting a
  // player's item capture a catalog item's pin.
  const clash = dataset.items.filter((v) =>
    String(v.source_item || "").includes("(yours)") || String(v.variant_id || "").includes("(yours)"));
  assert.deepStrictEqual(clash.map((v) => v.variant_id), []);
});

test("#773: a name already containing the suffix is refused rather than doubled", () => {
  const v = C.validateEntry(dagger({ name: "My ring (yours)" }), ctx);
  assert.ok(!v.ok);
  assert.ok(v.errors.some((e) => /Leave/.test(e) && /yours/.test(e)), v.errors.join(" | "));
});

test("#773: two of the player's own items cannot share a name", () => {
  // They would share an id, and a pin on one would equip the other.
  const out = C.customPool([dagger({ uid: 1 }), dagger({ uid: 2 })], ctx);
  assert.strictEqual(out.variants.length, 1, "the first keeps the name");
  assert.strictEqual(out.rejected.length, 1, "the duplicate is reported, not silently merged");
  assert.strictEqual(out.rejected[0].entry.uid, 2);
  assert.ok(out.rejected[0].errors.some((e) => /already have an item of your own/i.test(e)),
    out.rejected[0].errors.join(" | "));
});

test("#773: a weapon slot mints category weapon; a worn slot and the off hand mint item", () => {
  // Read off the catalog: all 3,316 slot-`Weapon` records are category `weapon`,
  // and all 592 slot-`Off Hand` ones (shields, orbs, rune arms) are `item`.
  const w = C.toVariant(C.validateEntry(dagger(), ctx).entry);
  assert.strictEqual(w.category, "weapon");
  const r = C.toVariant(C.validateEntry({
    uid: 3, name: "My CC ring", slot: "Ring", ml: 30, augments: [],
    affixes: [{ stat: "Constitution", bonus_type: "Quality", value: 3 }] }, ctx).entry);
  assert.strictEqual(r.category, "item");
  const o = C.toVariant(C.validateEntry({
    uid: 4, name: "My orb", slot: "Off Hand", type: "Orbs", ml: 30, augments: [],
    affixes: [{ stat: "Constitution", bonus_type: "Quality", value: 3 }] }, ctx).entry);
  assert.strictEqual(o.category, "item");
});

// ---------------------------------------------------------------------------
// The pool

test("#773: customPool mints the valid entries and SEPARATES the rest with reasons", () => {
  const good = dagger();
  const bad = dagger({ uid: 2, name: "Broken", affixes: [{ stat: "Doom Aura", bonus_type: "Quality", value: 1 }] });
  const out = C.customPool([good, bad], ctx);
  assert.strictEqual(out.variants.length, 1, "only the valid one is minted");
  assert.strictEqual(out.rejected.length, 1, "and the invalid one is reported, never dropped");
  assert.strictEqual(out.rejected[0].entry.uid, 2, "the rejection names WHICH entry, so the panel can flag it in place");
  assert.ok(out.rejected[0].errors.length);
});

test("#773: customPool runs the shared normalizer, so values arrive parsed", () => {
  // Not cosmetic: the bucket model reads numeric values and units. A record that
  // skipped normalizeItem would be a subtly different shape from every other
  // variant in the pool, in a way nothing downstream checks for.
  const [rec] = C.customPool([dagger()], ctx).variants;
  for (const a of rec.affixes) {
    assert.strictEqual(typeof a.value, "number", `${a.name} kept a string value`);
    assert.ok(a.unit, `${a.name} has no unit`);
  }
});

test("#773: customPool honours the per-character ceiling", () => {
  const many = [];
  for (let i = 1; i <= C.CUSTOM_LIMIT + 5; i += 1) many.push(dagger({ uid: i, name: "Dagger " + i }));
  const out = C.customPool(many, ctx);
  assert.strictEqual(out.variants.length, C.CUSTOM_LIMIT);
});

test("#773: every bonus type the panel offers is one the solver's bucket model knows", () => {
  // One list, not two. A type offered here but absent from CREDIT_BONUS_TYPES
  // would name a bucket `equivType` cannot resolve, and the affix would be
  // accepted, placed, and score into nothing.
  assert.deepStrictEqual(C.bonusTypes(), CREDIT_BONUS_TYPES);
  assert.ok(C.bonusTypes().length > 20);
});

// ---------------------------------------------------------------------------
// The disclosure

test("#773: the notice names the described items that were actually PLACED", () => {
  const rec = C.toVariant(C.validateEntry(dagger(), ctx).entry);
  const msg = C.playerAuthoredNotice([{ slot: "Off Hand", variant: rec }, { slot: "Ring", variant: dataset.items[0] }]);
  assert.ok(msg && msg.includes("My Cannith dagger"), msg);
  assert.ok(/not wiki-sourced/i.test(msg), "the disclosure must say what it is disclosing");
  assert.ok(!msg.includes(dataset.items[0].source_item), "a catalog item is not named by it");
});

test("#773: a build that placed none of the player's items discloses nothing", () => {
  // Keyed on the CHOSEN loadout, not the declared list: an item described but not
  // picked has not shaped the answer, and saying it did would be its own
  // inaccuracy — the mirror of the failure the notice exists to prevent.
  assert.strictEqual(C.playerAuthoredNotice([{ slot: "Ring", variant: dataset.items[0] }]), null);
  assert.strictEqual(C.playerAuthoredNotice([]), null);
  assert.strictEqual(C.playerAuthoredNotice(null), null);
});

// ---------------------------------------------------------------------------
// #774 — on/off effects. A presence-only stat is a FLAG: no bonus type, no
// magnitude, minted as `Bool` exactly as the catalog carries it.
//
// The measurement that shaped this is in custom-items-solve.test.js: a described
// item carrying `Ghost Touch` is counted by the Utility tier through the ordinary
// bucket machinery, and the tier's own receipt already credits it under the
// `(yours)` name. Neither the solver nor the tier needed a line of new code —
// which is why this file only has to prove the validator and the mint.

// #795 — a presence-only effect that is ALSO a real placement. Both halves
// matter: the validator's flag branch only runs for a stat the vocabulary calls
// presence-only, and the placement rules only let through an effect the item type
// can actually host. Found rather than named, so a harvest that moves it cannot
// leave this file green against nothing.
const FLAG = findPlacement((r) => r.rankable && !r.sourced
  && C.isPresenceEffect(r.stat, vocab, ctx));
assert.ok(FLAG, "the placement table has a presence-only enchantment to test with");
const PRESENCE_NAME = FLAG.row.stat;
const FLAG_SLOT = slotForGroup(FLAG.group);
/** An item of the type that CAN host the flag above. */
function flagItem(over) {
  return Object.assign({
    uid: 3, name: "My flag item", slot: FLAG_SLOT, type: "", ml: 20, augments: [],
    affixes: [{ menu: FLAG.menu, effect: FLAG.row.effect }],
  }, over || {});
}

test("#774: a presence-only effect is ACCEPTED, and stored as a flag", () => {
  const v = C.validateEntry(flagItem(), ctx);
  assert.deepStrictEqual(v.errors, [], "no refusal");
  assert.deepStrictEqual(v.entry.affixes, [{
    menu: FLAG.menu, effect: FLAG.row.effect, stat: PRESENCE_NAME,
    presence: true, sourced: false }],
    "a flag carries neither a bonus type nor a value");
});

test("#774: a flag mints as Bool 1, the shape the catalog uses", () => {
  const rec = C.toVariant(C.validateEntry(flagItem(), ctx).entry);
  assert.deepStrictEqual(rec.affixes, [
    { name: PRESENCE_NAME, type: "Bool", value: "1", eligible: true },
  ]);
  // The same shape a catalog item carries it in — asserted against the real
  // roster, not assumed, because that identity is the whole reason the Utility
  // tier needs no special case.
  const carrier = dataset.items.find((it) => (it.affixes || [])
    .some((a) => a && a.name === PRESENCE_NAME && a.type === "Bool"));
  assert.ok(carrier, `no catalog item carries ${PRESENCE_NAME} as Bool`);
});

test("#774: a stat's typed and flag forms cannot be mixed up", () => {
  // Numeric and flag rows coexist on one item, each keeping its own shape — and
  // now they must also be in DIFFERENT menus, because an item carries one each.
  const typed = findPlacement((r, g, m) => g === FLAG.group && m !== FLAG.menu
    && r.rankable && !r.sourced && !C.isPresenceEffect(r.stat, vocab, ctx));
  assert.ok(typed, "the flag's own item type has a typed enchantment in another menu");
  const v = C.validateEntry(flagItem({ affixes: [
    { menu: typed.menu, effect: typed.row.effect, bonus_type: "Quality", value: 3 },
    { menu: FLAG.menu, effect: FLAG.row.effect },
  ] }), ctx);
  assert.deepStrictEqual(v.errors, [], v.errors.join(" | "));
  assert.strictEqual(v.entry.affixes.length, 2);
  assert.strictEqual(v.entry.affixes[0].presence, undefined, "a typed row is not a flag");
  assert.strictEqual(v.entry.affixes[1].presence, true);
  assert.strictEqual(v.entry.affixes[1].bonus_type, undefined, "a flag carries no bonus type");
});

test("#774: a presence stat is a flag even when the entry claims a type and value", () => {
  // The form stops offering those controls once it knows the stat is on/off, so
  // a leftover value is stale UI state rather than something the player asked
  // for. Dropping it silently is right; refusing would strand them on a row they
  // cannot fix.
  const v = C.validateEntry(flagItem({ affixes: [
    { menu: FLAG.menu, effect: FLAG.row.effect, bonus_type: "Quality", value: 7 }] }), ctx);
  assert.deepStrictEqual(v.errors, [], v.errors.join(" | "));
  assert.deepStrictEqual(v.entry.affixes, [{
    menu: FLAG.menu, effect: FLAG.row.effect, stat: PRESENCE_NAME,
    presence: true, sourced: false }]);
});

test("#774: an untyped-only stat is still refused, and the reason is its own", () => {
  // The third kind, and the one that stays out: a real magnitude carried untyped
  // on every source. There is no bonus type to pick and no bucket a value would
  // join, so it is neither a flag nor a typed row.
  // #795 — this used to feed the validator an untyped-only stat directly. Under
  // the placement model it cannot: placement is checked FIRST, so an effect that
  // is not in the table is refused as uncraftable before the untyped branch is
  // reached, and an effect that IS in the table would have to carry an
  // untyped-only stat.
  //
  // Measured: NO placement does. So the assertion that matters is the invariant
  // itself, not a case the picker can no longer produce — a guard rather than a
  // date, so a harvest that adds one turns this red and somebody decides
  // deliberately instead of the branch quietly coming back to life.
  const untyped = new Set(vocab.untypedOnly || []);
  assert.ok(untyped.size, "the vocabulary has untyped-only stats at all");
  const offending = [];
  const gg = placements.groups;
  for (const group of Object.keys(gg)) {
    for (const menu of ["Prefix", "Suffix", "Extra"]) {
      for (const row of gg[group][menu] || []) {
        if (untyped.has(row.stat)) offending.push(`${group}/${menu}/${row.effect}`);
      }
    }
  }
  assert.deepStrictEqual(offending, [],
    "a placement whose stat carries no bonus type anywhere — the builder would offer "
    + "an enchantment with no bucket for its value to join");
  // The branch stays in `validateEntry` regardless: `backup.js` imports files this
  // app did not write, and a hand-edited entry is not bound by the picker.
  assert.ok(typeof C.validateEntry === "function");
});

test("#774: the presence fallback is the SAME rule as wizard.js's isPresenceOnly", () => {
  // The same guard the `canDeclare` fallback carries, for the same reason: the
  // module cannot require wizard.js back, so agreement is asserted over the real
  // vocabulary rather than hoped for. This is the assertion that caught the
  // missing `magnitude` clause on the sibling predicate.
  const { isPresenceOnly } = require("../web/wizard.js");
  const names = [...(vocab.known || [])];
  const disagree = names.filter((s) =>
    C.isPresenceEffect(s, vocab, { isPresenceOnly }) !== C.isPresenceEffect(s, vocab, null));
  assert.deepStrictEqual(disagree, [],
    `injected and fallback presence predicates disagree on: ${disagree.slice(0, 8).join(", ")}`);
});

test("#774: an item whose ONLY effect is a flag is legal", () => {
  // A crafted Ghost Touch ring with nothing else on it is a real item, and the
  // "at least one effect" rule must count a flag as an effect.
  const v = C.validateEntry(flagItem({ uid: 1, name: "My flag-only item" }), ctx);
  assert.deepStrictEqual(v.errors, [], v.errors.join(" | "));
  assert.ok(v.ok);
});


// ---------------------------------------------------------------------------
// #795 — the Essence Crafting bench.

test("#797: the affix cap IS the menu count, and the rule behind it is sourced", () => {
  // #795 shipped one-enchantment-per-menu from a plan doc and called it
  // wiki-stated. #797 harvested it:
  //
  //   "Each craftable item has a prefix and a suffix enchantment slot."
  //   "A Mark of House Cannith can be used to add a third extra enchantment slot."
  //   "(An error will pop up if you already have a Suffix, Prefix, or Insightful
  //    bonus and are trying to install a second one.)"
  //
  // The cap must therefore be DERIVED from the menu list rather than written down
  // beside it. Two independent numbers drift: a fourth menu would otherwise be
  // silently uncraftable, and a lowered cap would refuse a legal item while the
  // form still rendered a row for it.
  assert.strictEqual(C.AFFIX_MAX, C.MENUS.length,
    "the cap is the menu count, not a separate sanity number");
  assert.deepStrictEqual(C.MENUS, ["Prefix", "Suffix", "Extra"]);
  // And the placement table agrees on the same three, so the model and the data
  // cannot disagree about how many slots an item has.
  for (const menus of Object.values(placements.groups)) {
    assert.deepStrictEqual(Object.keys(menus).sort(), [...C.MENUS].sort());
  }
});

test("#795: a sourced enchantment fills its own type and value, and ignores the player's", () => {
  // The whole point of the sourced branch: when the wiki publishes the bonus type
  // AND the magnitude at this ML, the player is not asked and cannot be wrong.
  const row = C.placementFor("Rings", "Prefix", "Charisma", ctx);
  assert.ok(row && row.sourced, "Rings/Prefix/Charisma is a sourced placement");
  const v = C.validateEntry(sourcedRing({ ml: 20 }), ctx);
  assert.deepStrictEqual(v.errors, [], v.errors.join(" | "));
  const a = v.entry.affixes[0];
  assert.strictEqual(a.sourced, true);
  assert.strictEqual(a.bonus_type, row.bonus_type, "the type comes from the wiki, not the form");
  assert.strictEqual(a.value, Number(row.values_by_ml[19]), "ML 20 reads row 20 of the curve");
  // A player value on a sourced row is stale UI state, not a request: overridden
  // rather than refused, because the form stops offering the control.
  const w = C.validateEntry(sourcedRing({ ml: 20,
    affixes: [{ menu: "Prefix", effect: "Charisma", bonus_type: "Quality", value: 999 }] }), ctx);
  assert.deepStrictEqual(w.errors, []);
  assert.strictEqual(w.entry.affixes[0].value, Number(row.values_by_ml[19]),
    "the player's number does not win over a published one");
  assert.strictEqual(w.entry.affixes[0].bonus_type, row.bonus_type);
});

test("#795: the sourced value follows the item's minimum level", () => {
  const row = C.placementFor("Rings", "Prefix", "Charisma", ctx);
  const at = (ml) => C.validateEntry(sourcedRing({ ml }), ctx).entry.affixes[0].value;
  assert.strictEqual(at(1), Number(row.values_by_ml[0]));
  assert.strictEqual(at(36), Number(row.values_by_ml[35]));
  assert.notStrictEqual(at(1), at(36), "the curve is not flat, so this test can fail");
});

test("#795: an Insight enchantment is refused below ML 10, by its own rule", () => {
  // Two independent ML-10 gates, and this is the EFFECT one. The wiki states it
  // for insight bonuses specifically, separately from the Extra-slot rule.
  const ins = C.placementFor("Rings", "Extra", "Insightful Charisma", ctx);
  assert.ok(ins && ins.min_ml === 10, "Insightful Charisma carries the ML 10 floor");
  // At ML 9 the Extra menu is gone too, so the refusal names the menu; the effect
  // rule is what `effectsFor` enforces, and it is checked directly.
  assert.strictEqual(C.effectsFor("Rings", "Extra", 9, ctx).length, 0,
    "no Extra enchantment is offered below ML 10");
  assert.ok(C.effectsFor("Rings", "Extra", 10, ctx).length > 0, "and they appear at 10");
});

test("#795: the Extra MENU is gated on the item's level, not on the effect's", () => {
  assert.deepStrictEqual(C.menusFor("Rings", 9, ctx), ["Prefix", "Suffix"]);
  assert.deepStrictEqual(C.menusFor("Rings", 10, ctx), ["Prefix", "Suffix", "Extra"]);
});

test("#795: every catalog slot maps onto the placement table, in both directions", () => {
  // A completeness claim needs a guard. Both sides are readable, so assert the
  // map rather than writing "all 16 groups are covered" in a comment that cannot
  // notice the shard growing a seventeenth.
  const table = new Set(Object.keys(placements.groups));
  const mapped = new Set();
  for (const gs of Object.values(placements.slot_groups)) gs.forEach((g) => mapped.add(g));
  assert.deepStrictEqual([...table].filter((g) => !mapped.has(g)), [],
    "a placement group no slot can reach would be silently uncraftable");
  assert.deepStrictEqual([...mapped].filter((g) => !table.has(g)), [],
    "a slot mapped to a group the table lacks would be a picker with nothing behind it");
  assert.strictEqual(table.size, 16, "the wiki's 16 equipment groups");
});

test("#795: a quiver is refused, and the empty group list is the reason", () => {
  assert.deepStrictEqual(placements.slot_groups.Quiver, [],
    "the empty list is the sourced statement that quivers cannot be crafted");
  const r = C.essenceGroupFor("Quiver", "", ctx);
  assert.ok(!r.group);
  assert.ok(/cannot be Essence Crafted/i.test(r.refused), r.refused);
});

test("#804: the RANGED half is sourced, and it agrees with what #795 constructed", () => {
  // This agreement is what retires the construction. #795 mapped handedness onto
  // the two groups and labelled it a guess; `Table: Basic Ranged Weapons`
  // enumerates nine bows and crossbows, which fold onto exactly the seven types
  // that guess called Ranged. It was right — and now a divergence goes red
  // instead of passing quietly.
  const split = placements.weapon_split;
  assert.ok(split, "the split is published");
  const T = require("../web/weapon-taxonomy.js");
  const byHandedness = Object.keys(T.STYLE_OF_TYPE).filter((t) => {
    const st = T.STYLE_OF_TYPE[t];
    return st === T.RANGED || st === T.CROSSBOW;
  }).sort();
  assert.deepStrictEqual([...split.ranged_types].sort(), byHandedness,
    "the sourced enumeration and the handedness construction must agree");
  assert.strictEqual(split.ranged_types.length, 7);
});

test("#804: every weapon type is sourced-ranged, refused, or melee — exactly one", () => {
  // The guard that keeps the melee COMPLEMENT honest. Melee has no article and no
  // category, so it is defined as "everything else"; a complement is only safe
  // while the other two sets are known and the three partition the population.
  // Total AND disjoint, asserted over the taxonomy rather than over a list
  // written here.
  const T = require("../web/weapon-taxonomy.js");
  const types = Object.keys(T.STYLE_OF_TYPE);
  assert.ok(types.length > 30, "a real population");
  const seen = { "Melee weapons": [], "Ranged weapons": [], refused: [] };
  for (const t of types) {
    const r = C.essenceGroupFor("Weapon", t, ctx);
    const key = r.group || "refused";
    assert.ok(key in seen, `${t} resolved to an unexpected group ${r.group}`);
    seen[key].push(t);
  }
  // Total: nothing fell through.
  assert.strictEqual(
    seen["Melee weapons"].length + seen["Ranged weapons"].length + seen.refused.length,
    types.length, "every type landed in exactly one bucket");
  // Disjoint by construction above (one push per type), so the check that adds
  // information is that the SOURCED sets are what they claim.
  const split = placements.weapon_split;
  assert.deepStrictEqual(seen["Ranged weapons"].sort(), [...split.ranged_types].sort());
  assert.deepStrictEqual(seen.refused.sort(), [...split.unplaced_types].sort());
  // And melee is the remainder, non-empty and NOT overlapping either source.
  assert.ok(seen["Melee weapons"].length > 20);
  for (const t of seen["Melee weapons"]) {
    assert.ok(!split.ranged_types.includes(t), `${t} is melee and sourced-ranged`);
    assert.ok(!split.unplaced_types.includes(t), `${t} is melee and refused`);
  }
  assert.strictEqual(split.melee_is_complement, true,
    "the shard must keep saying melee is an inference, not a harvest");
});

test("#795/#804: the weapon types whose group the wiki does not state are refused by name", () => {
  // Never infer a value. `table 1b` names "Melee weapons" and "Ranged weapons"
  // and never says which DDO weapon types are in each; the taxonomy's axis is
  // handedness, which does not answer it. Thrown weapons are one-handed AND
  // ranged, so reading handedness would put them in the wrong group.
  const unplaced = placements.weapon_split.unplaced_types;
  assert.ok(unplaced.length, "there are refused weapon types");
  for (const t of unplaced) {
    const r = C.essenceGroupFor("Weapon", t, ctx);
    assert.ok(!r.group, `${t} must not resolve to a group`);
    assert.ok(/does not say which one/i.test(r.refused), r.refused);
  }
  // And the unambiguous ones still resolve, or this guard would pass by refusing
  // everything.
  assert.strictEqual(C.essenceGroupFor("Weapon", "Daggers", ctx).group, "Melee weapons");
  assert.strictEqual(C.essenceGroupFor("Weapon", "Long Bows", ctx).group, "Ranged weapons");
  assert.strictEqual(C.essenceGroupFor("Off Hand", "Tower shields", ctx).group, "Shields");
  assert.strictEqual(C.essenceGroupFor("Off Hand", "Rune Arms", ctx).group, "Rune Arms");
});

test("#795: a pre-refactor item is migrated, and every change is reported", () => {
  // The three outcomes a saved free-form item can have. Each is a change to a
  // build the player already had, so none may be silent.
  const legacy = { uid: 7, name: "Old ring", slot: "Ring", ml: 20, augments: [],
    affixes: [
      { stat: "Charisma", bonus_type: "Quality", value: 2 },   // -> sourced, revalued
      { stat: "Doom Aura", bonus_type: "Quality", value: 3 },  // -> dropped
    ] };
  const mig = C.migrateLegacyEntry(legacy, ctx);
  assert.deepStrictEqual(mig.dropped, ["Doom Aura"], "an uncraftable effect is named, not vanished");
  assert.strictEqual(mig.revalued.length, 1, "the sourced one is reported as revalued");
  assert.strictEqual(mig.revalued[0].stat, "Charisma");
  assert.strictEqual(mig.revalued[0].from, 2);
  assert.ok(mig.revalued[0].to > 0);
  assert.strictEqual(mig.entry.affixes.length, 1);
  assert.strictEqual(mig.entry.affixes[0].menu, "Prefix");
  assert.strictEqual(mig.entry.affixes[0].sourced, true);
  // The migrated entry validates, which is the point: a saved item keeps working.
  assert.ok(C.validateEntry(mig.entry, ctx).ok);
  // Idempotent: re-migrating an already-migrated entry changes nothing and
  // re-reports nothing, or opening the editor twice would double-report.
  const again = C.migrateLegacyEntry(mig.entry, ctx);
  assert.deepStrictEqual(again.revalued, []);
  assert.deepStrictEqual(again.dropped, []);
});

test("#795: customPool migrates saved items on the way to the solver", () => {
  // A pre-refactor item reaches the solver without anyone opening the editor. If
  // this path did not migrate, every saved custom item would be rejected on load
  // and the player would silently lose gear they had been solving with.
  const legacy = { uid: 8, name: "Old CC ring", slot: "Ring", ml: 20, augments: [],
    affixes: [{ stat: "Charisma", bonus_type: "Quality", value: 2 }] };
  const pool = C.customPool([legacy], ctx);
  assert.deepStrictEqual(pool.rejected, [], "a legacy item is not rejected");
  assert.strictEqual(pool.variants.length, 1);
  assert.strictEqual(pool.migrated.length, 1, "and the change is reported, not silent");
  assert.strictEqual(pool.migrated[0].revalued.length, 1);
});

test("#795: the reporter's own item is expressible, using the game's own names", () => {
  // The only player report on file asks for "a couple of CC rings", and Essence
  // Crafting IS Cannith Crafting (the U79 rename). The dagger from the same batch
  // is the sharper case: its three effects land in the three menus a Melee weapon
  // has, and the in-game name "Insightful Assassinate" is now a thing the player
  // PICKS rather than something they must decompose into Assassinate + Insight.
  const v = C.validateEntry(dagger(), ctx);
  assert.deepStrictEqual(v.errors, [], v.errors.join(" | "));
  assert.deepStrictEqual(v.entry.affixes.map((a) => [a.menu, a.effect, a.stat]), [
    ["Prefix", "Armor-Piercing", "Armor-Piercing"],
    ["Suffix", "Assassinate", "Assassinate"],
    ["Extra", "Insightful Assassinate", "Assassinate"],
  ]);
  // Underneath it is still Assassinate in two buckets, which is what makes the
  // report's "look for Quality Assassinate instead" the right consequence.
  const rec = C.toVariant(v.entry);
  const assassinate = rec.affixes.filter((a) => a.name === "Assassinate");
  assert.strictEqual(assassinate.length, 2);
  assert.notStrictEqual(assassinate[0].type, assassinate[1].type, "two buckets, one stat");
});


// ---------------------------------------------------------------------------
// #799 — what the Minimum Level shard applies on its own.

test("#799: a crafted weapon carries the Enhancement Bonus nobody crafts", () => {
  // The defect this closes: the bench asked for enchantments and granted only
  // those, so every crafted weapon, shield and armour under-reported by its
  // automatic Enhancement Bonus — a stat this tool already ranks, on an item it
  // already lets you describe.
  const rec = C.toVariant(C.validateEntry(dagger(), ctx).entry, ctx);
  const eb = rec.affixes.filter((a) => /^Enhancement Bonus/.test(a.name));
  assert.strictEqual(eb.length, 1, "exactly one, and not one per menu");
  assert.strictEqual(eb[0].name, "Enhancement Bonus (Weapon)",
    "the WEAPON spelling - #792's whole point, and a ring's would be (Armor)");
  assert.strictEqual(eb[0].type, "Enhancement");
  const curve = placements.automatic.enhancement_bonus.values_by_ml;
  assert.strictEqual(eb[0].value, String(Number(curve[35])), "the ML 36 row");
  // It is counted, or it would be decoration on the record.
  assert.strictEqual(rec.eligible_affix_count, 4, "3 chosen + 1 automatic");
});

test("#799: the automatic bonus follows the level, and is not stored on the entry", () => {
  const curve = placements.automatic.enhancement_bonus.values_by_ml;
  const at = (ml) => {
    const v = C.validateEntry(dagger({ ml }), ctx);
    const rec = C.toVariant(v.entry, ctx);
    // The ENTRY records only what the player chose - the cap and the menu model
    // depend on that, and a stored copy would go stale the moment they edit ML.
    assert.ok(!v.entry.affixes.some((a) => /^Enhancement Bonus/.test(a.stat || "")),
      "the automatic bonus must not be written into the player's choices");
    return rec.affixes.find((a) => /^Enhancement Bonus/.test(a.name)).value;
  };
  assert.strictEqual(at(36), String(Number(curve[35])));
  assert.strictEqual(at(20), String(Number(curve[19])));
  assert.notStrictEqual(at(20), at(36), "the curve is not flat, so this can fail");
});

test("#799: only the three kinds the wiki names get one", () => {
  // "you don't need to craft an Enhancement Bonus shard for Weapons, Shields, or
  //  Armors (including Robes, Outfit, and Docents)."
  //
  // Orbs and Rune Arms are off-hand items the sentence does not name, so they get
  // nothing rather than a guess. Asserted in BOTH directions, or a rule that
  // granted nothing to anyone would pass the first half.
  const got = (slot, type, ml) => C.automaticAffixes({ slot, type, ml: ml || 30 }, ctx);
  assert.strictEqual(got("Weapon", "Daggers")[0].stat, "Enhancement Bonus (Weapon)");
  assert.strictEqual(got("Weapon", "Long Bows")[0].stat, "Enhancement Bonus (Weapon)");
  assert.strictEqual(got("Armor", "")[0].stat, "Enhancement Bonus (Armor)");
  // A shield takes the ARMOUR spelling: slot `Off Hand` carries `(Armor)` 304
  // times in the catalog against 2 bare, measured rather than assumed.
  assert.strictEqual(got("Off Hand", "Tower shields")[0].stat, "Enhancement Bonus (Armor)");
  for (const [slot, type] of [["Off Hand", "Orbs"], ["Off Hand", "Rune Arms"],
                              ["Ring", ""], ["Trinket", ""], ["Cloak", ""]]) {
    assert.deepStrictEqual(got(slot, type), [],
      `${type || slot} is not a weapon, shield or armour and must get nothing`);
  }
});

test("#799: the two unmodelled bonuses are disclosed, to the right items only", () => {
  // Stated by the wiki, real in game, not rankable here. Disclosed rather than
  // silently missing - but only to items that would actually get them, because
  // telling a ring owner about a weapon dice multiplier is how a real disclosure
  // gets ignored.
  const labels = (slot, type) => C.unmodelledAutomatic({ slot, type, ml: 30 }, ctx)
    .map((r) => r.row).sort();
  assert.deepStrictEqual(labels("Weapon", "Daggers"),
    ["Spellcasting implement*", "Weapon dice mult*"]);
  assert.deepStrictEqual(labels("Off Hand", "Tower shields"), ["Spellcasting implement*"],
    "a shield gets no weapon dice");
  assert.deepStrictEqual(labels("Ring", ""), [], "a ring gets neither");
  // Each one says WHY it is not modelled, or the disclosure cannot be retired by
  // reading.
  for (const r of placements.automatic.unmodelled) {
    assert.ok((r.quote || "").length > 20, `${r.row} must carry its wiki sentence`);
    assert.ok((r.why_not || "").length > 20, `${r.row} must say why it is not modelled`);
  }
});

test("#799: neither unmodelled bonus is secretly rankable", () => {
  // The reason they are disclosed rather than modelled. If either name ever
  // enters the registry this turns red and the choice gets made again, instead
  // of the disclosure quietly describing something that is now expressible.
  const reg = new Set(raw.metadata.affix_registry);
  for (const name of ["Weapon Dice", "Spellcasting Implement", "Implement"]) {
    assert.ok(!reg.has(name), `${name} is rankable now - revisit #799`);
  }
});



// ---------------------------------------------------------------------------
// #800 — combined prefixes: one shard, two effects.

/** A ring with a combined prefix. `Fortifying` is Constitution + Fortification,
 *  both rankable, so it is servable; neither is sourced, so the player supplies
 *  both bonus types and both values. */
function comboRing(over) {
  return Object.assign({
    uid: 4, name: "My combined ring", slot: "Ring", ml: 30, augments: [],
    affixes: [{ menu: "Prefix", combined: "Fortifying",
                parts: [{ bonus_type: "Enhancement", value: 9 },
                        { bonus_type: "Quality", value: 4 }] }],
  }, over || {});
}

test("#800: a combined prefix is ONE row that mints TWO affixes", () => {
  const v = C.validateEntry(comboRing(), ctx);
  assert.deepStrictEqual(v.errors, [], v.errors.join(" | "));
  // One row, because the entry is menu-keyed and an item carries one shard per
  // slot. Two rows here would put two enchantments in one menu and the duplicate
  // check would refuse the entry on its next round-trip.
  assert.strictEqual(v.entry.affixes.length, 1);
  assert.strictEqual(v.entry.affixes[0].combined, "Fortifying");
  assert.strictEqual(v.entry.affixes[0].parts.length, 2);
  const rec = C.toVariant(v.entry, ctx);
  const chosen = rec.affixes.filter((a) => !/^Enhancement Bonus/.test(a.name));
  // #812 — the VALUES now come from the ML curve, not the entry: "Combined Shards
  // also use this scaling for their individual effects." The bonus types are
  // still the player's, because the wiki states neither.
  const recipe = C.combinedFor("Rings", "Fortifying", ctx);
  const at30 = (i) => String(Number(recipe.effects[i].values_by_ml[29]));
  assert.deepStrictEqual(chosen.map((a) => [a.name, a.type, a.value]), [
    ["Constitution", "Enhancement", at30(0)],
    ["Fortification", "Quality", at30(1)],
  ]);
});

test("#800: the stored entry re-validates unchanged", () => {
  // The round trip is the assertion that matters for the one-row shape: an entry
  // that validates once and is refused on reload would strand a saved item.
  const once = C.validateEntry(comboRing(), ctx);
  const twice = C.validateEntry(once.entry, ctx);
  assert.deepStrictEqual(twice.errors, [], twice.errors.join(" | "));
  assert.deepStrictEqual(twice.entry.affixes, once.entry.affixes);
});

test("#800: the pair is atomic — half a shard is never offered", () => {
  // The whole reason a recipe can be withheld. `container_registry` refuses a
  // pool where one option becomes two independently-selectable records; the same
  // rule applies here, so a recipe whose second effect cannot be ranked is
  // withheld WHOLE rather than served as its first.
  const cov = raw.metadata.essence_placement_coverage.combined;
  assert.ok(cov.withheld.length > 0, "some recipes are withheld, or this proves nothing");
  const servedNames = new Set(placements.combined.recipes.map((r) => r.name));
  for (const w of cov.withheld) {
    assert.ok(!servedNames.has(w.name), `${w.name} is withheld and served`);
    assert.ok(/withheld whole/.test(w.atomic), `${w.name} must say it is withheld whole`);
    assert.ok((w.reason || "").length > 10, `${w.name} must name the unrankable effect`);
  }
  // And every SERVED recipe has both halves resolved, or the atomicity claim is
  // decoration.
  for (const r of placements.combined.recipes) {
    assert.strictEqual(r.effects.length, 2, `${r.name} must carry exactly two effects`);
    for (const e of r.effects) {
      assert.ok(e.stat && vocab.known.has(e.stat),
        `${r.name}: ${e.effect} resolved to an unrankable stat`);
    }
  }
});

test("#800: a combined shard needs ML 20, a third gate from a third source", () => {
  // Three ML rules now, each gating a different thing and each separately
  // sourced: the Extra SLOT needs 10, an Insight EFFECT needs 10, and a combined
  // OPTION needs 20. They are kept apart so one moving cannot drag the others.
  assert.strictEqual(placements.combined.min_ml, 20);
  assert.ok(C.combinedOptions("Rings", 20, ctx).length > 0, "offered at 20");
  assert.deepStrictEqual(C.combinedOptions("Rings", 19, ctx), [], "and not at 19");
  const v = C.validateEntry(comboRing({ ml: 19 }), ctx);
  assert.ok(!v.ok);
  assert.ok(v.errors.some((e) => /minimum level 20/.test(e)), v.errors.join(" | "));
});

test("#800: a combined shard is a PREFIX and cannot go elsewhere", () => {
  for (const menu of ["Suffix", "Extra"]) {
    const v = C.validateEntry(comboRing({
      affixes: [{ menu, combined: "Fortifying", parts: [{}, {}] }] }), ctx);
    assert.ok(!v.ok, `${menu} must be refused`);
    assert.ok(v.errors.some((e) => /is a PREFIX/.test(e)), v.errors.join(" | "));
  }
});

test("#800: a recipe this item type cannot take is refused", () => {
  // `Armor Destroying` is Weapon-only. Offering it on a ring would be the same
  // defect as offering a prefix effect the group cannot host.
  const v = C.validateEntry(comboRing({
    affixes: [{ menu: "Prefix", combined: "Armor Destroying", parts: [{}, {}] }] }), ctx);
  assert.ok(!v.ok);
  assert.ok(v.errors.some((e) => /not a combined prefix this item type can take/.test(e)),
    v.errors.join(" | "));
});

test("#800: every recipe slot name maps onto a real placement group", () => {
  // A completeness claim needs a guard, in both directions: an unmapped slot
  // serves that recipe to nobody, and an invented group is a picker with no
  // table behind it.
  const groups = new Set(Object.keys(placements.groups));
  for (const r of placements.combined.recipes) {
    assert.ok(r.groups.length, `${r.name} reaches no group`);
    for (const g of r.groups) {
      assert.ok(groups.has(g), `${r.name} names group ${g}, which the table lacks`);
    }
  }
  // `Weapon` in the recipe table is undifferentiated, so a weapon recipe must
  // reach BOTH weapon groups - unlike table 1b, which names them separately.
  const wep = placements.combined.recipes.find((r) => r.name === "Armor Destroying");
  assert.deepStrictEqual(wep.groups.sort(), ["Melee weapons", "Ranged weapons"]);
});

test("#800: the harvest and what it serves, re-ratified deliberately", () => {
  const cov = raw.metadata.essence_placement_coverage.combined;
  // 107 recipes, and the split is an independent check on the harvest: the page
  // says "Update 81 introduced 100 more combined shards", and the table carries
  // exactly 100 U81 rows against 7 from U55.
  assert.strictEqual(cov.harvested, 107);
  assert.strictEqual(cov.served + cov.withheld.length, cov.harvested,
    "every recipe is either served or withheld - none silently vanishes");
  assert.strictEqual(cov.served, 78);
  assert.strictEqual(cov.withheld.length, 29);
});



// ---------------------------------------------------------------------------
// #810 — the ML curve defines the magnitude, independently of the bonus type.

test("#810: a magnitude the wiki publishes is filled, even when the type is not", () => {
  // The defect: `sourced` required BOTH facts, so 339 placements asked the player
  // to type a number the crafting table states, because a DIFFERENT fact about
  // the same effect was missing. `essence_pool` couples them for a real reason —
  // the solver needs a bucket — and that reasoning does not hold in a builder
  // that asks the player for the type.
  const row = C.placementFor("Melee weapons", "Suffix", "Assassinate", ctx);
  assert.strictEqual(row.magnitude_sourced, true, "the wiki values Assassinate");
  assert.strictEqual(row.type_sourced, false, "…and does not type it");
  assert.strictEqual(row.sourced, false, "so it is not FULLY sourced");

  const v = C.validateEntry(dagger({ ml: 36, affixes: [
    { menu: "Suffix", effect: "Assassinate", bonus_type: "Quality", value: 999 }] }), ctx);
  assert.deepStrictEqual(v.errors, [], v.errors.join(" | "));
  const a = v.entry.affixes[0];
  assert.strictEqual(a.value, Number(row.values_by_ml[35]), "the ML 36 row, not the 999");
  assert.strictEqual(a.bonus_type, "Quality", "the player's type is still theirs");
  assert.strictEqual(a.magnitude_sourced, true);
  assert.strictEqual(a.type_sourced, false);
});

test("#810: the magnitude follows the item's level", () => {
  const row = C.placementFor("Melee weapons", "Suffix", "Assassinate", ctx);
  const at = (ml) => C.validateEntry(dagger({ ml, affixes: [
    { menu: "Suffix", effect: "Assassinate", bonus_type: "Quality", value: 1 }] }),
    ctx).entry.affixes[0].value;
  assert.strictEqual(at(36), Number(row.values_by_ml[35]));
  assert.strictEqual(at(20), Number(row.values_by_ml[19]));
  assert.notStrictEqual(at(20), at(36), "the curve is not flat, so this can fail");
});

test("#810: every placement with a 36-row curve carries its magnitude", () => {
  // The guard against silent regression. If a future change re-couples the two
  // facts, this goes red with the count rather than quietly asking players for
  // published numbers again.
  const g = placements.groups;
  const missing = [];
  for (const group of Object.keys(g)) {
    for (const menu of ["Prefix", "Suffix", "Extra"]) {
      for (const r of g[group][menu] || []) {
        if (r.magnitude_sourced) {
          assert.ok(Array.isArray(r.values_by_ml) && r.values_by_ml.length === 36,
            `${group}/${menu}/${r.effect} claims a magnitude with no 36-row curve`);
        } else if (r.values_by_ml) {
          missing.push(`${group}/${menu}/${r.effect}`);
        }
      }
    }
  }
  assert.deepStrictEqual(missing, [],
    "a placement carries a curve but is not marked magnitude_sourced");
  const cov = raw.metadata.essence_placement_coverage;
  // Re-ratified deliberately: 426 of 523, up from the 87 that had BOTH facts.
  assert.strictEqual(cov.magnitude_sourced, 426);
  // #815 — 233 not 93: +140, every `Insightful X` placement. The rule reads the
  // harvest rather than defaulting: of the 22 effects whose type the wiki states,
  // all 9 spelled `Insightful X` are `Insight`, and the other 13 carry three
  // different types between them, so only the Insightful half gains one.
  // #817 — 334 not 233: +101, every non-Insightful SKILL. `Competence bonus`
  // names Essence Crafting as a source of competence to skills, and the one
  // skill #193 typed (`Haggle`) agrees. Enhancement, Quality and Exceptional do
  // not mention Essence Crafting at all, so nothing competes for the claim.
  // #817 — 340 not 334: +6, `Dodge`. Its type is stated on `Dodge bonus`, a page
  // #193 never opened because it read `Dodge`, which is silent.
  assert.strictEqual(cov.type_sourced, 340);
  assert.strictEqual(cov.sourced, 318, "the conjunction follows both halves");
  assert.ok(cov.sourced <= Math.min(cov.magnitude_sourced, cov.type_sourced),
    "the conjunction can never exceed either half");
});

test("#810: a value is still asked for when the wiki does not publish one", () => {
  // The branch must stay reachable, or the value rules above are dead code. 35 of
  // 523 placements have no resolvable curve and are not on/off flags.
  const v = C.validateEntry(playerValued(), ctx);
  assert.deepStrictEqual(v.errors, [], v.errors.join(" | "));
  const a = v.entry.affixes[0];
  assert.strictEqual(a.magnitude_sourced, false);
  assert.strictEqual(a.value, 20, "the player's number is kept");
});

test("#810: all three menus are offered at ML 10 and above, on every item type", () => {
  // The owner's other claim, checked rather than assumed. An Essence Crafted item
  // has three slots; below ML 10 the Extra one is withheld, which is sourced:
  // "Extra enchantment slots are not available on items under minimum level 10."
  for (const group of Object.keys(placements.groups)) {
    assert.deepStrictEqual(C.menusFor(group, 36, ctx), ["Prefix", "Suffix", "Extra"],
      `${group} must offer all three menus at ML 36`);
    assert.deepStrictEqual(C.menusFor(group, 10, ctx), ["Prefix", "Suffix", "Extra"],
      `${group} must offer all three at exactly ML 10`);
    assert.deepStrictEqual(C.menusFor(group, 9, ctx), ["Prefix", "Suffix"],
      `${group} must withhold Extra below ML 10`);
  }
});



// ---------------------------------------------------------------------------
// #812 — combined shards scale with ML, through the EXISTING join only.

test("#812: a combined half takes its magnitude from the curve, and ignores the player's", () => {
  //   "Scaling effects increase their values when placed in increasingly higher
  //    minimum level (ML) shard items. Combined Shards also use this scaling for
  //    their individual effects."   — `Essence Crafting enchantments`, Notes
  const recipe = C.combinedFor("Rings", "Fortifying", ctx);
  assert.ok(recipe.effects.every((e) => e.magnitude_sourced),
    "both halves of Fortifying resolve through the existing join");
  const v = C.validateEntry(comboRing({ ml: 30, affixes: [
    { menu: "Prefix", combined: "Fortifying",
      parts: [{ bonus_type: "Enhancement", value: 999 },
              { bonus_type: "Quality", value: 999 }] }] }), ctx);
  assert.deepStrictEqual(v.errors, [], v.errors.join(" | "));
  const parts = v.entry.affixes[0].parts;
  assert.strictEqual(parts[0].value, Number(recipe.effects[0].values_by_ml[29]));
  assert.strictEqual(parts[1].value, Number(recipe.effects[1].values_by_ml[29]));
  assert.strictEqual(parts[0].bonus_type, "Enhancement", "the type is still the player's");
});

test("#812: the join is reused, never widened to the recipe table's vocabulary", () => {
  // The recipe table names effects `table 1b` does not carry — `Entropic`,
  // `Anarchic`, `Acid Absorption`, `Deception`. Those must keep asking the
  // player: resolving a new vocabulary through a join validated against a
  // different one is the error `essence_curve_join` exists to refuse, and its
  // own opening example is what that error looks like.
  const all = placements.combined.recipes.flatMap((r) => r.effects);
  const sourced = all.filter((e) => e.magnitude_sourced);
  const asked = all.filter((e) => !e.magnitude_sourced);
  assert.ok(sourced.length > 20, `a real sourced population: ${sourced.length}`);
  assert.ok(asked.length > 20, `and a real asked-for one: ${asked.length}`);
  // Re-ratified deliberately: 51 of 156.
  assert.strictEqual(sourced.length, 51);
  assert.strictEqual(all.length, 156);
  // An unsourced half must carry NO curve, or the flag is decoration.
  for (const e of asked) {
    assert.ok(!e.values_by_ml && !e.curve_row,
      `${e.effect} is unsourced but carries a curve`);
  }
});



// ---------------------------------------------------------------------------
// #815 — the owner sweep: no name field, the Mark slot named, Insightful typed.

test("#815: a missing name is DERIVED, not refused", () => {
  // The bench stopped asking for one: you do not name a crafted item. It cannot
  // simply be dropped either — #773 made the name the `variant_id`, and that
  // issue's negative result records why an opaque id was wrong.
  const v = C.validateEntry({ uid: 1, slot: "Ring", ml: 30, augments: [],
    affixes: [{ menu: "Prefix", effect: "Constitution" }] }, ctx);
  assert.deepStrictEqual(v.errors, [], v.errors.join(" | "));
  // #828 RE-RATIFIED: the derived name is the ITEM, not its lead effect. This
  // asserted "Constitution Ring" until the summary began showing every effect
  // underneath — a title naming one of three, and changing whenever a higher
  // menu was filled, was the thing #828 replaced.
  assert.strictEqual(v.entry.name, "Essence Crafted Ring");
  // A combined shard named the item too ("Fortifying Ring"); it no longer does,
  // for the same reason. Its two effects show in the summary like any others.
  const w = C.validateEntry(comboRing({ name: "" }), ctx);
  assert.strictEqual(w.entry.name, "Essence Crafted Ring");
  // An explicit name is KEPT — that is what stops this renaming saved items and
  // stranding their pins.
  const x = C.validateEntry({ uid: 1, name: "My old ring", slot: "Ring", ml: 30,
    augments: [], affixes: [{ menu: "Prefix", effect: "Constitution" }] }, ctx);
  assert.strictEqual(x.entry.name, "My old ring");
});

test("#815: derived names do not collide within one character", () => {
  // Two entries sharing a name share an id, and a pin on one would equip the
  // other — the reason `CUSTOM_SUFFIX` exists at all.
  // #828 RE-RATIFIED: same rule, new base name. Collision matters MORE now —
  // two rings no longer differ by their lead effect, so "Essence Crafted Ring"
  // is a name a player can reach twice in a way "Constitution Ring" was not.
  const taken = new Set(["Essence Crafted Ring"]);
  const e = { slot: "Ring", affixes: [{ menu: "Prefix", effect: "Constitution" }] };
  assert.strictEqual(C.deriveName(e, ctx, taken), "Essence Crafted Ring 2");
  taken.add("Essence Crafted Ring 2");
  assert.strictEqual(C.deriveName(e, ctx, taken), "Essence Crafted Ring 3");
});

test("#815: the third menu is called the Mark of House Cannith to a player", () => {
  //   "If the item is ML 10 or greater, it has a 'Mark of House Cannith Slot',
  //    where another effect can be applied"      — `Essence Crafting steps`
  //
  // `Extra` is table 1b's own column name and stays the DATA key; it was the
  // wrong word to show, which is why the owner could not find the third slot.
  assert.deepStrictEqual(C.MENUS, ["Prefix", "Suffix", "Extra"], "the data key is unchanged");
  assert.strictEqual(C.menuLabel("Extra"), "Mark of House Cannith");
  assert.strictEqual(C.menuLabel("Prefix"), "Prefix");
  assert.strictEqual(C.menuLabel("Suffix"), "Suffix");
});

test("#815: every Insightful placement is typed Insight, and nothing else defaults", () => {
  // 9 of the 9 stated `Insightful X` effects are Insight; the other 13 stated
  // effects carry Enhancement, Competence and Natural between them. So the rule
  // is a reading of the harvest, and the non-Insightful half must still ask.
  const g = placements.groups;
  let insight = 0, askedNonInsightful = 0;
  for (const group of Object.keys(g)) {
    for (const menu of ["Prefix", "Suffix", "Extra"]) {
      for (const r of g[group][menu] || []) {
        if (r.effect.startsWith("Insightful ")) {
          assert.strictEqual(r.type_sourced, true, `${r.effect} must be typed`);
          assert.strictEqual(r.bonus_type, "Insight", `${r.effect} must be Insight`);
          insight++;
        } else if (!r.type_sourced) {
          askedNonInsightful++;
        }
      }
    }
  }
  assert.ok(insight > 100, `a real Insightful population: ${insight}`);
  assert.ok(askedNonInsightful > 100,
    "the non-Insightful half still asks — no Enhancement-by-default");
});



// ---------------------------------------------------------------------------
// #817 — Essence Crafting gives a SKILL a Competence bonus.

test("#817: every non-Insightful skill is typed Competence", () => {
  //   "Sources of competence bonus to skills: Named or randomly generated items,
  //    Essence Crafting, Colorless Augments"        — `Competence bonus`
  //
  // Sourced from the OTHER DIRECTION: #193 read all 157 effect pages; the
  // bonus-type pages were never read, and one of them states this. `Haggle`, the
  // one skill #193 did type, agrees — and Enhancement, Quality and Exceptional
  // do not mention Essence Crafting at all, so nothing competes for the claim.
  const g = placements.groups;
  let skills = 0;
  for (const group of Object.keys(g)) {
    for (const menu of ["Prefix", "Suffix", "Extra"]) {
      for (const r of g[group][menu] || []) {
        if (r.effect.startsWith("Insightful ")) continue;
        if (!SKILL_NAMES.has(r.effect)) continue;
        assert.strictEqual(r.type_sourced, true, `${r.effect} must be typed`);
        assert.strictEqual(r.bonus_type, "Competence",
          `${r.effect} is a skill and must be Competence`);
        skills++;
      }
    }
  }
  assert.ok(skills > 80, `a real skill population: ${skills}`);
});

test("#817: an Insightful skill stays Insight — the rules are ordered", () => {
  // `Insightful Balance` is a skill AND an Insightful effect. #815's rule wins,
  // and it must: the insight variant is not a competing answer for the base, it
  // is a different enchantment. `Insightful Haggle` is stated Insight, which is
  // the same ordering read off the harvest.
  const g = placements.groups;
  const insightfulSkills = [];
  for (const group of Object.keys(g)) {
    for (const menu of ["Prefix", "Suffix", "Extra"]) {
      for (const r of g[group][menu] || []) {
        if (!r.effect.startsWith("Insightful ")) continue;
        const base = r.effect.slice("Insightful ".length);
        if (!SKILL_NAMES.has(base)) continue;
        assert.strictEqual(r.bonus_type, "Insight",
          `${r.effect} is an Insightful skill and must stay Insight`);
        insightfulSkills.push(r.effect);
      }
    }
  }
  assert.ok(insightfulSkills.length > 10,
    `the ordering must actually be exercised: ${insightfulSkills.length}`);
});

test("#817: what still asks is smaller, and is not a skill", () => {
  // The gap after the rule: 121 placements across 23 effects, none of them a
  // skill. Re-ratified deliberately — this number should only ever fall.
  const g = placements.groups;
  const asking = new Set();
  let n = 0;
  for (const group of Object.keys(g)) {
    for (const menu of ["Prefix", "Suffix", "Extra"]) {
      for (const r of g[group][menu] || []) {
        if (r.type_sourced) continue;
        if (C.isPresenceEffect(r.stat, vocab, ctx)) continue;
        assert.ok(!SKILL_NAMES.has(r.effect),
          `${r.effect} is a skill and should have been typed`);
        asking.add(r.effect); n++;
      }
    }
  }
  assert.strictEqual(n, 115);
  assert.strictEqual(asking.size, 22);
  assert.ok(!asking.has("Dodge"), "Dodge is sourced from the `Dodge bonus` page");
});


// --- #828 — a finished item reads like a loadout entry --------------------

test("#828: the item is named Essence Crafted <type>", () => {
  assert.strictEqual(C.essenceCraftedName({ slot: "Ring" }), "Essence Crafted Ring");
  assert.strictEqual(C.essenceCraftedName({ slot: "Trinket" }), "Essence Crafted Trinket");
  // Where the slot needed a type to resolve its enchantment group, the TYPE is
  // the kind of item the player chose, so it is what the name says.
  assert.strictEqual(C.essenceCraftedName({ slot: "Weapon", type: "Daggers" }),
    "Essence Crafted Daggers");
  assert.strictEqual(C.essenceCraftedName({ slot: "Off Hand", type: "Shields" }),
    "Essence Crafted Shields");
  // Never a bare "Essence Crafted " with nothing after it.
  assert.strictEqual(C.essenceCraftedName({}), "Essence Crafted item");
  assert.strictEqual(C.essenceCraftedName(null), "Essence Crafted item");
});

test("#828: the name does not change when another menu is filled", () => {
  // The defect the rename fixes: the old name was the lead effect in MENU
  // order, so crafting a prefix onto a ring that already had a suffix renamed
  // the item — and a pin on the old name stranded.
  const suffixOnly = { slot: "Ring", affixes: [{ menu: "Suffix", effect: "Constitution" }] };
  const both = { slot: "Ring", affixes: [
    { menu: "Prefix", effect: "Charisma" },
    { menu: "Suffix", effect: "Constitution" }] };
  assert.strictEqual(C.deriveName(suffixOnly, ctx), C.deriveName(both, ctx),
    "adding a prefix must not rename the item");
});

test("#828: nativeAffixes mints the shape the loadout renders", () => {
  const v = C.validateEntry({ uid: 1, slot: "Ring", ml: 30, augments: [],
    affixes: [{ menu: "Prefix", effect: "Constitution" }] }, ctx);
  const rows = C.nativeAffixes(v.entry, ctx);
  assert.ok(rows.length, "an entry with an effect yields at least one affix");
  for (const a of rows) {
    assert.ok(a.name, "every record carries a native `name`");
    assert.ok("value" in a, "every record carries a `value`");
    assert.ok(a.origin === "chosen" || a.origin === "automatic",
      `origin must say where the affix came from, got ${a.origin}`);
    assert.strictEqual(typeof a.sourced, "boolean",
      "sourced must be a boolean — a summary must not leave provenance undefined");
  }
});

test("#828: the pool and the summary describe the item from ONE mapping", () => {
  // Two renderings of one item is the defect this closes. The pool's affixes
  // must be exactly nativeAffixes', minus the two display-only keys.
  const v = C.validateEntry({ uid: 1, slot: "Ring", ml: 30, augments: [],
    affixes: [{ menu: "Prefix", effect: "Constitution" }] }, ctx);
  const pool = C.customPool([v.entry], ctx);
  assert.deepStrictEqual(pool.rejected, [], "the fixture entry must be accepted");
  assert.strictEqual(pool.variants.length, 1);
  const mine = C.nativeAffixes(v.entry, ctx);
  // Compared by MEANING, not representation: the solver's records go on through
  // the dataset normalizer, which parses the magnitude to a number and attaches
  // the unit. That is the normalizer's job and not a second description of the
  // item — what must not differ is which affixes there are and what they say.
  assert.deepStrictEqual(
    pool.variants[0].affixes.map((a) => [a.name, a.type, Number(a.value)]),
    mine.map((a) => [a.name, a.type, Number(a.value)]),
    "the solver's copy and the summary's copy must agree affix for affix");
  for (const a of pool.variants[0].affixes) {
    assert.ok(!("origin" in a) && !("sourced" in a),
      "display-only keys must not reach the solver's records");
  }
});

test("#828: a combined prefix contributes both effects, still one slot", () => {
  const v = C.validateEntry(comboRing({ name: "" }), ctx);
  const rows = C.nativeAffixes(v.entry, ctx);
  const chosen = rows.filter((a) => a.origin === "chosen");
  assert.ok(chosen.length >= 2,
    "a combined shard grants two effects and the summary shows both");
  const menus = (v.entry.affixes || []).length;
  assert.strictEqual(menus, 1, "and it still occupies exactly one menu row");
});

test("#828: an automatic grant is listed, and marked as not a choice", () => {
  // It used to be withheld from the summary, which was right for a form and
  // wrong for an item summary: the loadout shows it, so the bench must too.
  const v = C.validateEntry({ uid: 1, slot: "Weapon", type: "Daggers", ml: 30,
    augments: [], affixes: [{ menu: "Prefix", effect: "Constitution" }] }, ctx);
  const auto = C.automaticAffixes(v.entry, ctx);
  if (!auto.length) return;  // only item kinds the shard grants a bonus to
  const rows = C.nativeAffixes(v.entry, ctx);
  assert.strictEqual(rows.filter((a) => a.origin === "automatic").length, auto.length,
    "every automatic grant appears in the summary");
});

test("#828: a blanked row is withheld, from the summary AND the solver", () => {
  // Migration blanks a row it cannot resolve. One of those rendered as " +null"
  // — found in the browser, not by the suite. An affix named "" would also take
  // a stacking bucket of its own in the solver.
  const e = { uid: 1, name: "Essence Crafted Ring", slot: "Ring", ml: 30, augments: [],
    affixes: [{ stat: "", bonus_type: "", value: null, presence: false },
              { menu: "Suffix", effect: "Dexterity", stat: "Dexterity",
                bonus_type: "Enhancement", value: 13, unit: "flat", sourced: true }] };
  const rows = C.nativeAffixes(e, ctx);
  assert.deepStrictEqual(rows.filter((a) => a.origin === "chosen").map((a) => a.name),
    ["Dexterity"], "the blanked row must not become a nameless affix");
  for (const a of C.customPool([e], ctx).variants[0].affixes) {
    assert.ok(String(a.name || "").trim(), "a nameless affix must not reach the solver");
  }
});

test("#828: a presence flag carries no magnitude and claims no provenance", () => {
  // `Eternal Faith` read as "Magnitude as you declared it" in the browser. It
  // has no magnitude at all, so neither sourced nor declared is true of it.
  const e = { uid: 1, slot: "Ring", ml: 30, augments: [],
    affixes: [{ menu: "Prefix", effect: "Eternal Faith", stat: "Eternal Faith",
                presence: true, sourced: false }] };
  const rows = C.nativeAffixes(e, ctx);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].type, "Bool", "a flag is minted as a presence affix");
  assert.strictEqual(rows[0].name, "Eternal Faith");
});

process.on("exit", () => { console.log(`\n${passed} passed, ${failed} failed`); });
