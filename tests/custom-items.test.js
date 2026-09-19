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
  const v = C.validateEntry(dagger({ ml: "36",
    affixes: [{ menu: "Suffix", effect: "Assassinate", bonus_type: "Quality", value: "3" }] }), ctx);
  assert.ok(v.ok, v.errors.join(" | "));
  assert.strictEqual(v.entry.ml, 36);
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
  ["a missing name", dagger({ name: "  " }), /name/i],
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
   dagger({ affixes: [{ menu: "Suffix", effect: "Assassinate", bonus_type: "Quality", value: 0 }] }), /above zero/i],
  ["a negative value",
   dagger({ affixes: [{ menu: "Suffix", effect: "Assassinate", bonus_type: "Quality", value: -4 }] }), /above zero/i],
  ["a value over the ceiling",
   dagger({ affixes: [{ menu: "Suffix", effect: "Assassinate", bonus_type: "Quality", value: 100000 }] }), /ceiling/i],
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

test("#795: the weapon types whose group the wiki does not state are refused by name", () => {
  // Never infer a value. `table 1b` names "Melee weapons" and "Ranged weapons"
  // and never says which DDO weapon types are in each; the taxonomy's axis is
  // handedness, which does not answer it. Thrown weapons are one-handed AND
  // ranged, so reading handedness would put them in the wrong group.
  assert.ok(C.WEAPON_GROUP_UNSTATED.length, "there are refused weapon types");
  for (const t of C.WEAPON_GROUP_UNSTATED) {
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

console.log(`\n${passed} passed, ${failed} failed`);
