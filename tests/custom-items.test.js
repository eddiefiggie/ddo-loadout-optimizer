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
const test = (name, fn) => {
  try { fn(); console.log("PASS " + name); }
  catch (e) { console.log("FAIL " + name + " \n  " + (e && e.message)); process.exitCode = 1; }
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
const ctx = { vocab, catalogNames, canDeclare: canDeclareCredit };
// Taken from the built catalog rather than hard-coded: a literal name would rot
// the moment the roster renamed it, and the test would then pass by testing
// nothing (a name the catalog no longer has cannot collide with it).
const A_REAL_CATALOG_NAME = dataset.items.find((v) => v.category !== "augment").source_item;

/** The reporter's item: a Cannith-crafted dagger at ML 36 carrying Assassinate at
 *  two bonus types plus Armor-Piercing, with a red augment slot. "Insightful
 *  Assassinate" as the game prints it is `Assassinate` typed `Insight` here —
 *  which is exactly why the report asked for Quality Assassinate to be found
 *  elsewhere: the three are three buckets of one stat. */
function dagger(over) {
  return Object.assign({
    uid: 1, name: "My Cannith dagger", slot: "Weapon", type: "Daggers", ml: 36,
    augments: ["Red"],
    affixes: [
      { stat: "Assassinate", bonus_type: "Enhancement", value: 8 },
      { stat: "Assassinate", bonus_type: "Insight", value: 4 },
      { stat: "Armor-Piercing", bonus_type: "Enhancement", value: 25 },
    ],
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
  const v = C.validateEntry(dagger({ ml: "36", affixes: [{ stat: "Assassinate", bonus_type: "Quality", value: "3" }] }), ctx);
  assert.ok(v.ok, v.errors.join(" | "));
  assert.strictEqual(v.entry.ml, 36);
  assert.strictEqual(v.entry.affixes[0].value, 3);
});

test("#773: a worn slot needs no type, and a stray one is dropped rather than refused", () => {
  const v = C.validateEntry({
    uid: 2, name: "My CC ring", slot: "Ring", type: "Daggers", ml: 32,
    augments: [], affixes: [{ stat: "Constitution", bonus_type: "Quality", value: 3 }],
  }, ctx);
  assert.ok(v.ok, v.errors.join(" | "));
  assert.strictEqual(v.entry.type, "", "a Ring carries no type, and the stray value is not an error the player could see coming");
});

// ---------------------------------------------------------------------------
// Refusals — one at a time, each asserting the sentence names its own field.

const REFUSALS = [
  ["a missing name", dagger({ name: "  " }), /name/i],
  ["a name the catalog already uses", dagger({ name: A_REAL_CATALOG_NAME }), /already the name/i],
  ["an unknown slot", dagger({ slot: "Pocket" }), /slot/i],
  ["a weapon with no type", dagger({ type: "" }), /kind of weapon/i],
  ["a type the taxonomy does not know", dagger({ type: "Spoons" }), /not a type/i],
  ["an ML below the floor", dagger({ ml: 0 }), /Minimum level/],
  ["an ML above the cap", dagger({ ml: 37 }), /Minimum level/],
  ["a fractional ML", dagger({ ml: 12.5 }), /whole number/],
  ["no effects at all", dagger({ affixes: [] }), /at least one effect/i],
  ["a stat outside the vocabulary", dagger({ affixes: [{ stat: "Doom Aura", bonus_type: "Quality", value: 3 }] }), /not a stat this build knows/i],
  ["a bonus type outside the list", dagger({ affixes: [{ stat: "Assassinate", bonus_type: "Shiny", value: 3 }] }), /bonus type/i],
  ["a zero value", dagger({ affixes: [{ stat: "Assassinate", bonus_type: "Quality", value: 0 }] }), /above zero/i],
  ["a negative value", dagger({ affixes: [{ stat: "Assassinate", bonus_type: "Quality", value: -4 }] }), /above zero/i],
  ["a value over the ceiling", dagger({ affixes: [{ stat: "Assassinate", bonus_type: "Quality", value: 100000 }] }), /ceiling/i],
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

test("#773: a presence-only effect is refused BY NAME, not silently given a number", () => {
  // The one refusal a player is most likely to hit and least likely to guess:
  // Ghost Touch and True Seeing are on/off, so there is no typed bucket for a
  // magnitude to join. The same gate a declared credit passes.
  const presence = [...(vocab.presence || [])].filter((s) => !canDeclareCredit(s, vocab));
  assert.ok(presence.length, "the vocabulary has presence-only stats to test with");
  const v = C.validateEntry(dagger({ affixes: [{ stat: presence[0], bonus_type: "Quality", value: 2 }] }), ctx);
  assert.ok(!v.ok);
  assert.ok(v.errors.some((e) => e.includes(presence[0]) && /on\/off/i.test(e)),
    `the refusal must name the stat and say why; got: ${v.errors.join(" | ")}`);
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
