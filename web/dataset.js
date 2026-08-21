// U3 — load-time dataset normalizer ("logic, not data").
//
// items.json persists affixes in gear-planner's NATIVE shape
// `{name, type, value}` (value is a native STRING: "10", "9%", "-5") plus the
// per-affix `eligible` flag. It deliberately does NOT persist a numeric value,
// a unit, or the legacy field names. This module walks the loaded dataset ONCE
// and re-derives the runtime view every current consumer (solver.js, model.js,
// the UI, and the node/parity harnesses) still expects:
//
//   * per affix: a numeric `value` + `unit` parsed from the native string, and
//     the legacy aliases `stat` (= name) and `bonus_type` (= type).
//   * per item:  `minimum_level` (= ml) AND, symmetrically, `ml` (= minimum_level)
//     for the handful of records seeded with only the legacy field, so native `ml`
//     readers are always safe; plus `armor_type` derived from the native item
//     `type` ("Cloth armor" -> "cloth", …). `category` is already persisted; it is
//     left as-is.
//
// This is the ONLY place the legacy names survive. A later unit (U7) removes the
// aliases once the solver + UI read the native shape directly. The walk is
// idempotent: re-running it on an already-normalized dataset is a no-op.
//
// Value parsing mirrors src/variants._coerce_value + src/planner_items._value_unit
// EXACTLY: a trailing "%" means the pct unit (and is stripped for the number);
// only a fully-integer body coerces to a number, otherwise the string body
// passes through unchanged (so a non-numeric value keeps its old behavior).
"use strict";

// Native item `type` -> legacy `armor_type`. Docents (and every non-armor type)
// are absent, so their armor_type is left as-is — "as today".
const ARMOR_TYPE_MAP = {
  "Cloth armor": "cloth",
  "Light armor": "light",
  "Medium armor": "medium",
  "Heavy armor": "heavy",
};

/** Parse a native affix value string into `{value, unit}`.
 *  "9%" -> {value: 9, unit: "pct"}; "-5" -> {value: -5, unit: "flat"};
 *  "1d6" -> {value: "1d6", unit: "flat"} (non-integer passes through). */
function parseAffixValue(raw) {
  const s = raw == null ? "" : String(raw).trim();
  const unit = s.endsWith("%") ? "pct" : "flat";
  const body = s.replace(/%$/, "");
  const value = /^-?\d+$/.test(body) ? parseInt(body, 10) : body;
  return { value, unit };
}

/** Attach the numeric value + unit + legacy aliases to one native affix, in
 *  place. Idempotent: skips fields already present. Bidirectional so it doubles as
 *  a one-time migration for a PRE-OVERHAUL persisted loadout whose embedded affix
 *  carries ONLY the legacy `stat`/`bonus_type` (U5, Part C): native readers then
 *  find `name`/`type` too. Live native affixes already have `name`/`type`, so those
 *  branches never fire and the live-dataset output is unchanged (parity-neutral). */
function normalizeAffix(a) {
  if (!a || typeof a !== "object") return a;
  // Live native item affixes carry {name, type}; every affix/ML consumer reads
  // native now (U4a/U5), so the transitional native->legacy stat/bonus_type
  // aliases were removed in U7. The legacy->native direction is kept as a
  // migration for a PRE-OVERHAUL persisted loadout whose embedded affix carries
  // only the old stat/bonus_type (migrateLoadout).
  if (a.name == null && a.stat != null) a.name = a.stat;         // legacy -> native (old saves)
  if (a.type == null && a.bonus_type != null) a.type = a.bonus_type;
  if (typeof a.value === "string") {
    const parsed = parseAffixValue(a.value);
    a.value = parsed.value;
    if (a.unit == null) a.unit = parsed.unit;
  } else if (a.unit == null) {
    a.unit = "flat";
  }
  return a;
}

// Upstream gear-planner passthrough noise: an affix whose NAME carries no
// information — a bare enhancement "plus" the planner stored as its own name
// (e.g. "+14", "+1"), or a wiki filler placeholder. These arrive as Bool
// presence flags with no targetable stat, so they never enter the solver (the
// picker vocabulary excludes them); they only clutter the raw browse affix list.
// Dropped at normalize time so items.json at rest stays a faithful passthrough.
var NOISE_AFFIX_NAMES = new Set(["See the item description page for details."]);
// U1 (#136) — fallback for `metadata.expanded_away_names` on a dataset built before
// that field existed. Mirrors src/umbrella.py `_UMBRELLA` -> ABILITIES. Keyed lowercase.
// Bare "Sheltering" is NOT here: it expands to Physical/Magical Sheltering, a different
// mechanism, and is dropped by its own line in buildPickerVocabulary.
var EXPANDED_AWAY_FALLBACK = {
  "all ability scores": ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"],
  "all ability score": ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"],
  "well rounded": ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"],
  // #205 — universal spell-DC names, expanded into the seven schools by
  // src/spell_focus.py. Mirrors its `_UNIVERSAL` set.
  "spell focus mastery": ["Abjuration Focus", "Conjuration Focus", "Enchantment Focus", "Evocation Focus", "Illusion Focus", "Necromancy Focus", "Transmutation Focus"],
  "spell focus": ["Abjuration Focus", "Conjuration Focus", "Enchantment Focus", "Evocation Focus", "Illusion Focus", "Necromancy Focus", "Transmutation Focus"],
  // #249 — the compound absorption names, expanded into their elements by
  // src/absorption_split.py. Mirrors its `EXPANDED_AWAY`. `Electric Absorption`
  // is the dataset's spelling of the component the compound calls "Electricity";
  // redirecting to the compound's own wording would name a stat no item carries.
  // `Elemental Absorption` redirects to the UNION of five — its element set is
  // per-item, and five of the thirteen carriers do include Sonic.
  "fire and cold absorption": ["Fire Absorption", "Cold Absorption"],
  "electricity and acid absorption": ["Electric Absorption", "Acid Absorption"],
  "elemental absorption": ["Acid Absorption", "Cold Absorption", "Fire Absorption", "Electric Absorption", "Sonic Absorption"],
  // #191 — the resistance compound, expanded per item by
  // src/elemental_resistance_split.py. Redirects to the UNION of five: six of
  // the 58 carriers include Sonic behind the template's `4=` switch.
  "elemental resistance": ["Acid Resistance", "Cold Resistance", "Fire Resistance", "Electric Resistance", "Sonic Resistance"],
  // #211 — the umbrella detector's first sweep, expanded by
  // src/spell_focus.py's universal family (same-type expansion).
  "resistance": ["Fortitude Save", "Reflex Save", "Will Save"],
  "elemental resonance": ["Corrosion", "Combustion", "Magnetism", "Glaciation"],
  "combat mastery": ["Stunning", "Vertigo", "Shatter"],
  "charisma skills": ["Bluff", "Diplomacy", "Haggle", "Intimidate", "Perform", "Use Magic Device"],
  "dexterity skills": ["Balance", "Hide", "Move Silently", "Open Lock", "Tumble"],
  "intelligence skills": ["Disable Device", "Repair", "Search", "Spellcraft"],
  "constitution skills": ["Concentration"],
  "strength skills": ["Jump"],
  "wisdom skills": ["Heal", "Listen", "Spot"],
};
// U10 (R13) — the ORIGINATING enchantment names the build stamps (`via`), mapped to
// the stats each becomes. Fallback ONLY: `metadata.provenance_labels` is authoritative
// and a live scan of the loaded dataset covers anything it misses, so this constant
// matters just for a cached dataset built before either existed. Same role as
// EXPANDED_AWAY_FALLBACK above, keyed by the EXACT label (the scan lowercases).
//
// It is a mirror, and mirrors drift — tests/dataset.test.js pins every entry against
// the live build, so a wrong entry fails. Being INCOMPLETE is fine and expected: a
// newer expansion family implies a newer dataset, which carries the metadata.
var _SPELL_SCHOOLS = ["Abjuration Focus", "Conjuration Focus", "Enchantment Focus",
  "Evocation Focus", "Illusion Focus", "Necromancy Focus", "Transmutation Focus"];
var _ABILITIES = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"];
var PROVENANCE_LABEL_FALLBACK = {
  "Spell Focus": _SPELL_SCHOOLS.slice(),
  "Spell Focus Mastery": _SPELL_SCHOOLS.slice(),
  "Artifact Spell Focus Mastery": _SPELL_SCHOOLS.slice(),
  "Exceptional Spell Focus Mastery": _SPELL_SCHOOLS.slice(),
  "Insightful Spell Focus Mastery": _SPELL_SCHOOLS.slice(),
  "Profane Spell Focus": _SPELL_SCHOOLS.slice(),
  "Profane Spell Focus Mastery": _SPELL_SCHOOLS.slice(),
  "Quality Spell Focus": _SPELL_SCHOOLS.slice(),
  "Quality Spell Focus Mastery": _SPELL_SCHOOLS.slice(),
  "Sacred Spell Focus Mastery": _SPELL_SCHOOLS.slice(),
  "Artifact Well Rounded": _ABILITIES.slice(),
  "Enhancement Well Rounded": _ABILITIES.slice(),
  "Exceptional Well Rounded": _ABILITIES.slice(),
  "Profane Well Rounded": _ABILITIES.slice(),
  "Quality Well Rounded": _ABILITIES.slice(),
  "Parrying": ["Armor Class", "Fortitude Save", "Reflex Save", "Will Save"],
  "Speed": ["Movement Speed", "Melee Alacrity", "Ranged Alacrity"],
  "Heightened Awareness": ["Armor Class"],
};

// U5 (#140) — boolean composites that carry a wiki-verified numeric effect but are
// stored as `Bool` presence, so the solver could not weigh them. Values and bonus
// types are transcribed from docs/wiki-evidence/boolean-composites.md; nothing here
// is inferred. Percentages store as bare numbers with unit "flat", matching Dodge
// and Fortification.
//
// `Greater Heroism` is deliberately ABSENT: the wiki states a magnitude for the
// SPELL but not for the item enchantment, so it stays QUARANTINED per KTD5. Do not
// add it from the spell page — that would be inference (see the evidence doc).
var COMPOSITE_COMPONENTS = {
  "Blurry": [{ name: "Concealment", type: "Enhancement", value: 20, unit: "flat" }],
  "Lesser Displacement": [{ name: "Concealment", type: "Enhancement", value: 25, unit: "flat" }],
  "Crown of Summer": [
    { name: "Healing Amplification", type: "Enhancement", value: 15, unit: "flat" },
    { name: "Melee Power", type: "Enhancement", value: 10, unit: "flat" },
    { name: "Ranged Power", type: "Enhancement", value: 5, unit: "flat" },
  ],
};

// R12 — every expansion family stamps the ORIGINATING enchantment name onto each
// affix it emits, under the key `src/spell_focus.py` writes (PROVENANCE_KEY).
// Two of the families expand HERE rather than at build time (bare Sheltering and
// the boolean composites), so they stamp here. Presence of the key is also the
// expanded/native discriminator: an affix the item states itself never carries it.
var PROVENANCE_KEY = "via";
// How the wiki spells a typed variant's prefix. Mirrors src/spell_focus.py
// `_TYPE_PREFIX`: the Insight variant is engraved "Insightful", never "Insight".
var TYPE_PREFIX = { Insight: "Insightful" };
/** The enchantment name as the wiki writes it. `unprefixed` names the bonus
 *  types this family renders WITHOUT a prefix — its default type, the one the
 *  wiki writes bare. */
function sourceLabel(name, type, unprefixed) {
  var base = String(name == null ? "" : name).trim();
  if (!type || (unprefixed && unprefixed.has(type))) return base;
  return (TYPE_PREFIX[type] || type) + " " + base;
}
// Sheltering IS a typed family — the wiki lists "Insightful Sheltering" and
// "Quality Sheltering" categories. Its Enhancement variant is the default and is
// engraved bare ("usually an enhancement bonus unless otherwise stated"), so
// Enhancement takes no prefix. See docs/wiki-evidence/sheltering.md.
var SHELTERING_UNPREFIXED = new Set(["Enhancement"]);

/** #253 — the set-bonus half of the bare-Sheltering expansion. A set tier's
 *  affixes are legacy-shaped ({stat, bonus_type}); 283 of them carried a bare
 *  `Sheltering` this family's item-side expansion never reached, so they named
 *  a stat no item carries and were inert — and the bare label read as a live
 *  native stat, which is what kept it off the picker (see 6316c11).
 *  Same rules as the item side: both halves, same value + bonus type, skip a
 *  half the tier already states, stamp the originating enchantment. Idempotent
 *  (the produced stats are not "Sheltering"). Returns the array unchanged when
 *  there is nothing to expand, so callers can assign unconditionally. */
function expandShelteringTierAffixes(affixes) {
  if (!Array.isArray(affixes)) return affixes;
  if (!affixes.some(function (a) { return a && a.stat === "Sheltering"; })) return affixes;
  var present = new Set(affixes.map(function (a) { return a && a.stat; }));
  var out = [];
  for (const a of affixes) {
    if (a && a.stat === "Sheltering") {
      var stamp = {};
      stamp[PROVENANCE_KEY] = sourceLabel("Sheltering", a.bonus_type, SHELTERING_UNPREFIXED);
      if (!present.has("Physical Sheltering")) out.push(Object.assign({}, a, { stat: "Physical Sheltering" }, stamp));
      if (!present.has("Magical Sheltering")) out.push(Object.assign({}, a, { stat: "Magical Sheltering" }, stamp));
    } else {
      out.push(a);
    }
  }
  return out;
}

function isNoiseAffix(a) {
  if (!a || typeof a !== "object") return false;
  var name = a.name != null ? a.name : a.stat;
  if (name == null) return false;
  name = String(name).trim();
  if (NOISE_AFFIX_NAMES.has(name)) return true;
  return /^[+-]?\d+%?$/.test(name); // bare number, optionally signed / percent
}

/** Normalize one item (variant): its affixes, and the item-level legacy
 *  aliases the character gate / UI read. In place. */
function normalizeItem(it) {
  if (!it || typeof it !== "object") return it;
  var affixes = it.affixes;
  if (Array.isArray(affixes)) {
    var cleaned = affixes.filter(function (a) { return !isNoiseAffix(a); });
    if (cleaned.length !== affixes.length) { it.affixes = cleaned; affixes = cleaned; }
    for (const a of affixes) normalizeAffix(a);
    // U2 — bare "Sheltering" grants BOTH Physical and Magical Resistance Rating
    // (https://ddowiki.com/page/Sheltering; see docs/wiki-evidence/sheltering.md).
    // Expand it into the two named affixes, same value + bonus type, so it satisfies
    // PRR/MRR targets and collapses with an explicit Physical/Magical Sheltering of
    // the same type. This lives here (the item-affix seam, before variantBuckets in
    // model.js) because the affix alias table is one->one and cannot fan out.
    // Idempotent: the produced names are not "Sheltering", so a second pass is a no-op.
    if (affixes.some(function (a) { return a && a.name === "Sheltering"; })) {
      // Skip an expanded name the item already carries explicitly (8 items hold both
      // a bare Sheltering and an explicit Physical/Magical one) — avoids a duplicate
      // browse line. The solver keeps the max per bucket either way, so this is tidiness.
      var present = new Set(affixes.map(function (a) { return a && a.name; }));
      var expanded = [];
      for (const a of affixes) {
        if (a && a.name === "Sheltering") {
          // R12: the item is engraved "Sheltering" / "Insightful Sheltering", not
          // "Physical Sheltering" — each half names the enchantment it came from.
          //
          // #253 — the BARE label is stamped again. 6316c11 withheld it because
          // 283 set-bonus tier affixes carried a bare `Sheltering` this expansion
          // never reached, so the name read as a live native stat, the collision
          // guard dropped it from the picker, and the stamp displayed a name the
          // picker refused (R13's violation). The set-bonus channel now expands
          // too (expandShelteringTierAffixes), no channel carries the bare name
          // as a live stat, and the label resolves like the typed variants do.
          var label = sourceLabel("Sheltering", a.type, SHELTERING_UNPREFIXED);
          var stamp = {};
          stamp[PROVENANCE_KEY] = label;
          if (!present.has("Physical Sheltering")) expanded.push(Object.assign({}, a, { name: "Physical Sheltering" }, stamp));
          if (!present.has("Magical Sheltering")) expanded.push(Object.assign({}, a, { name: "Magical Sheltering" }, stamp));
        } else {
          expanded.push(a);
        }
      }
      it.affixes = expanded;
      affixes = expanded;
    }
    // U5 (#140) — write the wiki-verified components of a boolean composite onto the
    // item so its real value can be weighed. ADDITIVE, and deliberately UNLIKE the
    // bare-Sheltering expansion above: that one REPLACES the affix and drops the name
    // from picker suggestions; this one KEEPS the boolean, so the effect stays
    // targetable as presence. The originating report wanted the ITEM secured, not just
    // its numbers — once components can be satisfied from unrelated gear, a
    // presence-only target is the only thing that still forces the carrier in.
    // Do NOT "fix" this into consistency with Sheltering.
    if (affixes.some(function (a) { return a && COMPOSITE_COMPONENTS[a.name]; })) {
      // Never shadow a component the item states explicitly (its own value wins), and
      // when two composites contribute the same stat keep the HIGHEST — the solver
      // maxes per bucket anyway, so this only avoids a redundant browse line.
      var stated = new Set(affixes.map(function (a) { return a && a.name; }));
      var derived = new Map();
      for (const a of affixes) {
        var comps = a && COMPOSITE_COMPONENTS[a.name];
        if (!comps) continue;
        for (const c of comps) {
          if (stated.has(c.name)) continue;
          var prev = derived.get(c.name);
          // Deliberately NOT stamped with the provenance key, unlike every other
          // expansion family. Those REPLACE the affix they expand, so the engraved
          // name would be lost without the stamp and R8's collapse restores it.
          // This expansion is ADDITIVE — the composite stays on the item — so the
          // engraved name is already on screen, and stamping would make the collapse
          // fold `Concealment +20 Enhancement` into a second line reading
          // `Blurry +20` beside the item's own `Blurry +1 Bool`: the same name twice
          // with two unrelated numbers, the component's stat gone, and a magnitude
          // attached to an enchantment whose in-game cell states none.
          if (!prev || c.value > prev.value) derived.set(c.name, c);
        }
      }
      // Idempotent: a second pass sees the derived names in `stated` and adds nothing.
      if (derived.size) {
        var added = [];
        derived.forEach(function (c) { added.push(Object.assign({}, c)); });
        it.affixes = affixes.concat(added);
      }
    }
  }
  // #253 — the same expansion on the item's OWN set-bonus tiers. The solver
  // reads tier stats from parsed_set_bonuses (setTiers in solver.js), so a bare
  // `Sheltering` here was inert: it named a stat no target matches.
  if (Array.isArray(it.parsed_set_bonuses)) {
    for (const tier of it.parsed_set_bonuses) {
      if (tier) tier.affixes = expandShelteringTierAffixes(tier.affixes);
    }
  }
  // Every ML consumer reads native `ml` now (U7 removed the item minimum_level
  // alias); the reverse is kept so a PRE-OVERHAUL persisted loadout (only
  // minimum_level) still gains native `ml`.
  if (it.ml == null && it.minimum_level != null) it.ml = it.minimum_level;
  const at = ARMOR_TYPE_MAP[it.type];
  if (at) it.armor_type = at;
  // The one legacy-shaped rune-arm host ("Dinosaur Bone Rune Arm") carries
  // category "runearm" / slot "Rune Arm". The solver's Off Hand slot keys on
  // slot === "Off Hand" and the off-hand gate on `type`, so normalize it into that
  // shape: it stays equippable (it hosts rune-arm dino inserts) AND obeys
  // two-hand exclusivity and off-hand type locks like every other rune arm.
  if (it.category === "runearm" || it.slot === "Rune Arm") {
    it.slot = "Off Hand";
    if (it.type == null) it.type = "Rune Arms";
  }
  return it;
}

// U4b-i — resolve model.js's stacking-equivalence installer across both runtimes:
// browser (model.js loaded as a plain script -> `setStackEquiv` is a global) and
// Node/tests (require the shared module, same cached instance the solver uses).
function installStackEquiv(map) {
  if (typeof setStackEquiv !== "undefined") { setStackEquiv(map); return; }
  if (typeof require !== "undefined") {
    try { require("./model.js").setStackEquiv(map); } catch (e) { /* model.js absent: no-op */ }
  }
}

// U1 (#290/#291) — same two-runtime bridge for the cross-add map
// {target_stat: [source_stats]} (metadata.cross_add): stats whose bucket totals
// flat-ADD into the target across buckets. Solver crediting reads
// crossAddSourcesFor (solver.js bucketCountsFor). #300 — the setter lives in
// cross-add.js, the module that OWNS the one _CROSS_ADD instance (model.js only
// re-exports it), so the require branch reaches the owner directly.
function installCrossAdd(map) {
  if (typeof setCrossAdd !== "undefined") { setCrossAdd(map); return; }
  if (typeof require !== "undefined") {
    try { require("./cross-add.js").setCrossAdd(map); } catch (e) { /* cross-add.js absent: no-op */ }
  }
}

/** Walk a loaded dataset once, normalizing every item[] variant in place, and
 *  return the same dataset object (for convenient chaining). Also installs the
 *  stacking-equivalence map from `metadata.stacking_equivalence` so the solver's
 *  bucket keys collapse equivalent affix types (Insight Natural -> Insight), and
 *  the cross-add map from `metadata.cross_add` (U1 #290/#291). */
function normalizeDataset(dataset) {
  if (!dataset || !Array.isArray(dataset.items)) return dataset;
  const meta = dataset.metadata || {};
  const equiv = meta.stacking_equivalence || {};
  dataset._stackEquiv = equiv;
  installStackEquiv(equiv);
  const crossAdd = meta.cross_add || {};
  dataset._crossAdd = crossAdd;
  installCrossAdd(crossAdd);
  // U5 — surface the affix-name registry + alias table so the picker vocabulary
  // (buildPickerVocabulary) can canonicalize a variant name to the ONE canonical
  // that gear/augments/crafting share.
  dataset._affixRegistry = meta.affix_registry || [];
  dataset._affixAliases = meta.affix_aliases || {};
  // #162 — derive each item's metal/non-metal class from its wiki-sourced material.
  // Logic-not-data at the load seam, the same shape as ARMOR_TYPE_MAP above: the
  // curated map lives in metadata, the per-item class is derived from it here so the
  // druidic-oath gate in model.js reads one field. An item with no material, or a
  // material the map does not classify, gets NO class — and every consumer fails
  // open on that, rather than treating unknown as non-metal.
  const materialClass = meta.material_classification || {};
  for (const it of dataset.items) {
    const cls = it.material ? materialClass[it.material] : undefined;
    if (cls) it.material_class = cls;
    normalizeItem(it);
  }
  // #253 — the set-definition channels carry the same legacy-shaped tier affixes
  // as parsed_set_bonuses (the membership self-seed and the set-augment family in
  // solver.js read these defs directly), so a bare `Sheltering` there was inert
  // by the same route. Two live today, both in membership_set_defs.
  for (const defs of [dataset.membership_set_defs, dataset.augment_set_defs]) {
    for (const def of Object.values(defs || {})) {
      for (const tier of def.tiers || []) {
        if (tier) tier.affixes = expandShelteringTierAffixes(tier.affixes);
      }
    }
  }
  return dataset;
}

// ---------------------------------------------------------------------------
// U5 — priority-picker vocabulary (shared by web/query.js and web/wizard.js).
//
// The picker's SUGGESTIONS are the UNION of every place a rankable affix can come
// from, each canonicalized through the alias table so a selected target matches
// gear, augments, AND crafting by one canonical name. Sources: the build's curated
// item/scaling/set-bonus vocabulary (metadata.rankable_affixes — clean, ≥2-item +
// CORE_STATS) UNIONED with every crafting pool (seal, nearly_complete[/per_item],
// viktranium, dino_inserts, thunder_forged, green_steel, membership set defs). The
// crafting union closes the gap where a CRAFTING-ONLY affix could not be selected
// even though the solver matches it.
//
// Rankability filter on the crafting MAGNITUDE contribution: drop the non-rankable
// descriptor/penalty types and require a numeric magnitude (you rank a magnitude).
// Bool/boolean presence affixes are added SEPARATELY as build-around effects: the
// discrete, named on/off effects players chase (Ghost Touch, Bone Paws, immunities,
// SALT...) ARE suggested + flagged in `presence`; only the ~280 sentence/clicky/
// flavor Bool lines stay hidden (still typeable via `known`).
//
// `known` is the UNfiltered union of every affix name present on any source
// (canonicalized) — a free-typed target is validated against it, so a user may type
// ANY real affix (a Bool presence, a crafting-only one) even when it is not a
// suggestion; `canonical()` maps a typed value through the alias table first.
const NON_RANKABLE_TYPES = new Set([
  "Penalty", "Sneak Attack", "Bludgeoning", "Piercing", "Slashing",
  "Good", "Evil", "Lawful", "Chaotic",
]);
const PRESENCE_TYPES = new Set(["boolean", "Bool"]);

// Build-around presence effects (Bool) that ARE worth suggesting — Ghost Touch,
// Bone Paws, immunities, SALT, etc. Auto-classified from the name shape: a
// DISCRETE effect name qualifies; a full sentence, a clicky, an upgrade line, or a
// "%/N charges/per day" proc description does NOT (those ~280 stay hidden but
// remain free-typeable via `known`). A small curated override adjusts edge cases:
// PRESENCE_DENY force-hides, PRESENCE_ALLOW force-shows (both empty by default —
// the extension point for tightening the list, e.g. trimming weapon materials).
const _PRESENCE_NOISE = /[.%:]|\bchance\b|\bwhen you\b|\byour\b|\bclicky\b|\bupgrade|\bper (?:rest|day)\b|\bcharges?\b|\(\d|\d\/day/i;
const PRESENCE_DENY = new Set([]);
// #228 — named effects the word cap drops. The cap is a proxy for "is this a
// named effect or a sentence", and it splits the wrong way on any effect whose
// real name runs past four words. `Kick 'Em While They're Down` is five and was
// reported by a player who searched "kick" and got nothing. Entries here are
// wiki-verified: the effect has its own DDO wiki page naming it exactly this way.
// Everything else the cap catches stays hidden and free-typeable via `known`;
// tests/dataset.test.js pins that set so a new one surfaces instead of vanishing.
const PRESENCE_ALLOW = new Set([
  "Kick 'Em While They're Down",
  // #231 — the 2026-08-12 adjudication of the word-cap casualty list. Each entry
  // verified against the wiki that day; the ones it did NOT admit are recorded in
  // tests/dataset.test.js beside the pinned fixture, so the ruling is not re-made.
  "Way of the Sun Soul",                      // own page, Unique item enchantments;
                                              // NB the effect needs all 3 set pieces
                                              // + centered — presence marks a carrier,
                                              // not the threshold (#214's class)
  "Lifeblood of the Undead Prince",           // own page, Unique item enchantments
  "Path of the Fire Dragon",                  // own page, Unique item enchantments
  "Path of the Guarding Stone",               // own page, Unique item enchantments
  "Brilliance of the Shattered Sun",          // own page, Unique item enchantments
  "Vile Grip of the Hidden Hand",             // own page, Unique item enchantments
  "Legendary Vile Grip of the Hidden Hand",   // no separate page, but the Vile Grip
                                              // page names it exactly, with its own
                                              // Effect line (10d440) and item list (49)
  "Legendary Tet-zik, The Enlightened Change", // own page describing the monk-stance
                                               // effect on the Jidz-Tet'ka bracers
]);

// #91 (U3, KTD10) — the Utility tier's v1 CURATED Bool counting list ("tier 1").
// The full presence-minus-magnitude population (~800 names) blew the measured
// perf gate at 7.7x the 2x budget, so per KTD10's designed fallback the v1
// counting set admits a curated high-value subset and widens in MEASURED
// BATCHES from here. Contents: the PRESENCE_ALLOW wiki-adjudicated named
// effects, plus the plan's acceptance-example effects — Ghost Touch (AE4) and
// Echo of Whelm's three procs (AE1/AE2, the feature's marquee case). A name
// outside this list simply does not count in v1 — it is DERIVABLE from the
// presence population, not a quarantine ruling, so nothing is filed per name.
// Deliberately a SEPARATE constant from PRESENCE_ALLOW: that list's meaning is
// "named effects the four-word cap wrongly hides" (picker visibility), and
// entangling it with counting admission would make a future picker adjudication
// silently widen the counting set unreviewed.
// #343 widened this list with the six worn defensive toggles (Ghostly, True
// Seeing, Blurry, Freedom of Movement, Blindness Immunity, Deathblock) and
// made it the WHOLE counting set: the reviewed untyped procs are no longer
// unioned in, so this constant now bounds the count on its own.
// MIRRORED in src/utility_procs.py (the stamp derivation) — the stamped-set
// parity test in tests/dataset.test.js guards the two copies against drift.
const UTILITY_TIER1_PRESENCE = new Set([
  // The plan's Product Contract examples (must count for AE1/AE2/AE4):
  "Ghost Touch",
  "Whelming Shockwave",
  "Blunt Trauma",
  "Lesser Boneshatter",
  // The classic always-on utility archetype, pinned expected-in since U1:
  "Feather Falling",
  // #343 — the worn defensive toggles. Feather Falling above was the only one of
  // this archetype the original curation caught, which is exactly the bug: the
  // tier filled leftover slots with weapon procs and never reached for the
  // effects players actually notice. These six are the reported case (Ghostly,
  // True Seeing) plus their obvious peers.
  "Ghostly",
  "True Seeing",
  "Blurry",
  "Freedom of Movement",
  "Blindness Immunity",
  "Deathblock",
  // The PRESENCE_ALLOW wiki-adjudicated named effects:
  "Kick 'Em While They're Down",
  "Way of the Sun Soul",
  "Lifeblood of the Undead Prince",
  "Path of the Fire Dragon",
  "Path of the Guarding Stone",
  "Brilliance of the Shattered Sun",
  "Vile Grip of the Hidden Hand",
  "Legendary Vile Grip of the Hidden Hand",
  "Legendary Tet-zik, The Enlightened Change",
  // #349 (batch 1) — six more worn toggles, each admitted on a verbatim
  // wiki reading of a PASSIVE equipped effect. Candidates were found by
  // carrier slot, but admitted on the effect's nature: procs ("when you
  // are hit, N% chance"), magnitudes, materials and crafting markers are
  // refused with their reason in docs/wiki-evidence/utility-worn-toggles.md.
  "Lesser Displacement",
  "Ethereal",
  "Dusk",
  "Soundproof",
  "Immunity to Fear",
]);

/** #404 — COMPANION STATS: a second, differently-named source of the same in-game
 *  number that a player ranking the obvious name will never find on their own.
 *
 *  `Spell Intensity` and the ten element Intensities are separate rankable stats,
 *  and the wiki says they should be — `docs/wiki-evidence/universal-name-sweep.md`
 *  upheld that on re-harvest (#402), against three independent reads. But a player
 *  ranking `Void Intensity`, watching an augment labelled "Spell Critical Damage"
 *  not get slotted, has no way to learn that a second name carries it. Two reports
 *  arrived by that route before this hint existed.
 *
 *  Advisory ONLY. The hint never adds, reorders or substitutes anything — the
 *  player decides. That is the difference between this and the expanded-away path,
 *  which rewrites the list because the bare name can score nothing; here BOTH names
 *  score, they are simply not the same stat.
 *
 *  Membership is DERIVED, not remembered: a universal-shaped rankable name that is
 *  neither expanded away into a family nor a cross-add source for one is, by
 *  definition, a stat a player can only reach by knowing its name. The guard in
 *  `tests/dataset.test.js` recomputes that population and fails when a name in it
 *  is undeclared here — so the next `Spell Intensity` cannot arrive silently. The
 *  current population is exactly one: `Universal Spell Power` and `Universal Spell
 *  Lore` cross-add into their elements, and `Potency` / `Spell Lore` expand away.
 *
 *  No Python counterpart, for the same reason UTILITY_CONTAINER_DEFAULT_ORDER has
 *  none: the build derives nothing from it and only the picker reads it.
 */
const COMPANION_STATS = [
  {
    companion: "Spell Intensity",
    members: ["Fire Intensity", "Acid Intensity", "Healing Intensity", "Ice Intensity",
              "Kinetic Intensity", "Lightning Intensity", "Void Intensity",
              "Radiance Intensity", "Repair Intensity", "Sonic Intensity"],
    reason: "a separately-named enchantment that also raises spell critical damage "
          + "(the Solar Gem of Spell Critical Damage carries it) — rank it too if you "
          + "want items that grant it",
  },
];

/** The advisory sentence for adding `stat`, or null when there is nothing to say.
 *
 *  Returns null when the companion is ALREADY ranked — the hint exists to close a
 *  dead end, not to nag a player who has already found it. Pure, so the picker and
 *  its tests read one implementation. */
function companionHintFor(stat, priorities) {
  const ranked = new Set(Array.isArray(priorities) ? priorities : []);
  for (const entry of COMPANION_STATS) {
    if (!entry.members.includes(stat)) continue;
    if (ranked.has(entry.companion)) return null;
    return `Also consider "${entry.companion}" — ${entry.reason}.`;
  }
  return null;
}

/** #348 (U3, KTD8) — the container's DEFAULT ORDER.
 *
 *  R9 makes the order a product decision, so it is DECLARED here rather than
 *  derived from UTILITY_TIER1_PRESENCE's iteration order, which is an artifact of
 *  how the roster literal was edited: adding a name in the wrong place would
 *  silently re-rank what the solver pursues first.
 *
 *  The six worn defensive toggles lead, because they are the effects a player
 *  notices in play and the reported #343 bug was precisely that the tier never
 *  reached them. The fourteen inherited names follow.
 *
 *  This list has NO Python counterpart. The build pipeline derives the counting
 *  set's MEMBERSHIP (src/utility_procs.py, stamped into the dataset) and nothing
 *  in it consumes an order — order is read only by the solver stage and the
 *  curation panel. A mirrored copy would be a second thing to drift for no
 *  consumer. `tests/dataset.test.js` instead asserts this order covers the
 *  stamped counting set exactly, so a roster change that skips this list fails.
 */
const UTILITY_CONTAINER_DEFAULT_ORDER = [
  // The #343 worn defensive toggles, first.
  "Ghostly",
  "True Seeing",
  "Blurry",
  "Freedom of Movement",
  "Blindness Immunity",
  "Deathblock",
  // The classic always-on utility archetype.
  "Feather Falling",
  // The plan's Product Contract examples.
  "Ghost Touch",
  "Whelming Shockwave",
  "Blunt Trauma",
  "Lesser Boneshatter",
  // The PRESENCE_ALLOW wiki-adjudicated named effects.
  "Kick 'Em While They're Down",
  "Way of the Sun Soul",
  "Lifeblood of the Undead Prince",
  "Path of the Fire Dragon",
  "Path of the Guarding Stone",
  "Brilliance of the Shattered Sun",
  "Vile Grip of the Hidden Hand",
  "Legendary Vile Grip of the Hidden Hand",
  "Legendary Tet-zik, The Enlightened Change",
  // #349 batch 1 — appended after the inherited names rather than
  // interleaved: the six above them are the effects #343 established a
  // player notices first, and re-ranking those was not part of this batch.
  "Lesser Displacement",
  "Ethereal",
  "Dusk",
  "Soundproof",
  "Immunity to Fear",
];

/** #348 (U3) — the default container for a given counting set: the declared order,
 *  restricted to names the dataset actually stamps, with any stamped name the order
 *  does not mention appended in sorted order rather than dropped.
 *
 *  The append tail is a safety net, not a design: the dataset.test.js guard fails
 *  when it is non-empty, so a widened roster (#349) is forced through a deliberate
 *  ordering decision instead of silently landing at the bottom in alphabetical
 *  order. Dropping the name instead would be worse — a stamped effect the solver
 *  can never pursue is invisible in a way nothing reports. */
function defaultUtilityOrder(counting) {
  const have = (counting && typeof counting.has === "function") ? counting : new Set();
  const out = UTILITY_CONTAINER_DEFAULT_ORDER.filter((n) => have.has(n));
  const named = new Set(out);
  const rest = [...have].filter((n) => !named.has(n)).sort();
  return out.concat(rest);
}

/** #228 — every `Bool` presence name that reads like a named effect (it clears the
 *  noise filter) but is hidden anyway because it runs past the four-word cap, and
 *  has not been adjudicated onto PRESENCE_ALLOW. Sorted.
 *
 *  The cap is a proxy, not a rule: it stands in for "is this a named effect or a
 *  sentence", and it drops any effect whose real name is longer than four words.
 *  This report is what keeps that trade-off visible — the test suite pins the set,
 *  so a rebuild that introduces a new named effect fails instead of silently
 *  hiding it, which is how `Kick 'Em While They're Down` went unnoticed. */
function presenceWordCapCasualties(dataset) {
  const out = new Set();
  for (const [name, type] of _itemAffixTriples(dataset || {})) {
    if (!PRESENCE_TYPES.has(type)) continue;
    const n = String(name == null ? "" : name).trim();
    if (!n || PRESENCE_ALLOW.has(n) || PRESENCE_DENY.has(n)) continue;
    if (_PRESENCE_NOISE.test(n)) continue;
    if (n.split(/\s+/).length > 4) out.add(n);
  }
  return [...out].sort();
}

function _isPresenceTargetable(name) {
  const n = String(name == null ? "" : name).trim();
  if (!n) return false;
  if (PRESENCE_DENY.has(n)) return false;
  if (PRESENCE_ALLOW.has(n)) return true;
  if (_PRESENCE_NOISE.test(n)) return false;
  return n.split(/\s+/).length <= 4;
}

function _rankableType(type) {
  return type == null || (!NON_RANKABLE_TYPES.has(type) && !PRESENCE_TYPES.has(type));
}
function _isMagnitude(v) {
  return typeof v === "number" && !Number.isNaN(v);
}

/** Every crafting-pool affix as [name, type, value]. Pool affixes carry the legacy
 *  {stat,bonus_type} shape — the normalizer does not touch pools, and the solver
 *  reads them the same legacy way. Viktranium and Dino records are atomic UNITS
 *  whose affixes live under `affixes`; the rest are one affix per record. */
function _craftingAffixTriples(ds) {
  const out = [];
  const push = (n, t, v) => { if (n != null && n !== "") out.push([n, t, v]); };
  for (const pool of [ds.seal, ds.thunder_forged, ds.green_steel]) {
    for (const o of pool || []) push(o.stat, o.bonus_type, o.value);
  }
  for (const arr of Object.values(ds.nearly_complete_per_item || {})) {
    for (const o of arr || []) push(o.stat, o.bonus_type, o.value);
  }
  // Viktranium, Dino, and (#211) Nearly-Complete records are ATOMIC UNITS
  // carrying an `affixes` list — reading a singular `o.stat` would leave every
  // affix of a multi-affix option (the universal spell-DC craft's seven
  // schools, a Skill-menu craft's six skills) out of the picker vocabulary.
  // Flat single-affix records still read, for back-compat.
  for (const pool of [ds.viktranium, ds.dino_inserts, ds.nearly_complete]) {
    for (const o of pool || []) {
      const affs = (o.affixes && o.affixes.length) ? o.affixes : [o];
      for (const a of affs) push(a.stat, a.bonus_type, a.value);
    }
  }
  for (const def of Object.values(ds.membership_set_defs || {})) {
    for (const tier of (def.tiers || [])) for (const a of tier.affixes || []) push(a.stat, a.bonus_type, a.value);
  }
  return out;
}

/** Every item/scaling/set-bonus affix as [name, type, value]. Item affixes are
 *  native ({name,type}); scaling + set-bonus affixes are legacy at rest ({stat,
 *  bonus_type}) — read the same way the solver does. */
function _itemAffixTriples(ds) {
  const out = [];
  const push = (n, t, v) => { if (n != null && n !== "") out.push([n, t, v]); };
  for (const v of ds.items || []) {
    for (const a of v.affixes || []) push(a.name != null ? a.name : a.stat, a.type != null ? a.type : a.bonus_type, a.value);
    for (const s of v.scaling || []) push(s.stat, s.bonus_type, s.val_hi);
    for (const t of v.parsed_set_bonuses || []) for (const a of t.affixes || []) push(a.stat, a.bonus_type, a.value);
  }
  return out;
}

/** U10 (R13) — scan the LOADED dataset for what each expansion stamped.
 *
 *  Returns `{ labels: {label: [stats, in declared order]}, native: Set<name> }`.
 *
 *  Two reasons this runs at load time rather than trusting `metadata.provenance_labels`
 *  alone. First, two expansion families run HERE, not at build time (bare Sheltering
 *  and the boolean composites), so the build cannot know their labels. Second, a scan
 *  learns the next family with no registration step — the metadata is the same scan
 *  run earlier, not a different source of truth.
 *
 *  `native` is every affix name carried WITHOUT a provenance stamp — the names real
 *  affixes still supply. It is the collision guard: a label that is also a native name
 *  must never become an alias, or substituting it away destroys a live stat.
 *
 *  Order follows src/provenance.py: each expansion emits its group contiguously in
 *  declared order, but an expansion may SKIP a component the item already states, so
 *  the LONGEST group observed for a label wins (ties keep the first seen). */
function _provenanceScan(ds) {
  const labels = new Map();
  const native = new Set();
  const consider = (name, via) => {
    if (name == null || name === "") return;
    if (via == null || String(via).trim() === "") { native.add(String(name)); return null; }
    return String(via).trim();
  };
  for (const v of ds.items || []) {
    // Per item, per label, the ordered de-duplicated group that item emitted.
    const groups = new Map();
    const channels = [v.affixes || []];
    for (const t of v.parsed_set_bonuses || []) channels.push(t.affixes || []);
    for (const affixes of channels) {
      for (const a of affixes) {
        if (!a || typeof a !== "object") continue;
        const name = a.name != null ? a.name : a.stat;
        const via = consider(name, a[PROVENANCE_KEY]);
        if (!via) continue;
        if (!groups.has(via)) groups.set(via, []);
        const group = groups.get(via);
        if (!group.includes(String(name))) group.push(String(name));
      }
    }
    groups.forEach((group, via) => {
      const prev = labels.get(via);
      if (!prev || group.length > prev.length) labels.set(via, group);
    });
  }
  const out = {};
  labels.forEach((group, via) => { out[via] = group; });
  return { labels: out, native };
}

/** Every affix NAME present on any source (item + scaling + set-bonus + crafting),
 *  for the free-typed-input known set. Unfiltered. */
function _allAffixNames(ds) {
  const out = [];
  for (const [n] of _itemAffixTriples(ds)) out.push(n);
  for (const [n] of _craftingAffixTriples(ds)) out.push(n);
  return out;
}

/** Build the picker vocabulary. Returns { suggestions:[sorted], known:Set,
 *  canonical:(name)->canonicalName }. */
function buildPickerVocabulary(dataset) {
  const ds = dataset || {};
  const meta = ds.metadata || {};
  const aliases = ds._affixAliases || meta.affix_aliases || {};
  const canonical = (name) => {
    const n = String(name == null ? "" : name).trim();
    return (aliases[n] != null) ? aliases[n] : n;
  };
  const suggest = new Set();
  // Item/scaling/set-bonus vocabulary = the build's curated rankable-affix list
  // (already clean: ≥2-item + CORE_STATS, non-rankable/Bool already excluded). For
  // an older build without that metadata, derive a present-affix scan filtered to
  // the rankable types (so the fallback isn't noisier than the curated path).
  if (meta.rankable_affixes && meta.rankable_affixes.length) {
    for (const n of meta.rankable_affixes) { const c = canonical(n); if (c) suggest.add(c); }
  } else {
    for (const [name, type] of _itemAffixTriples(ds)) {
      if (_rankableType(type)) suggest.add(canonical(name));
    }
  }
  // Crafting-only additions: every crafting-pool affix that is rankable (numeric
  // magnitude, not a non-rankable descriptor/penalty, not a Bool/boolean presence).
  for (const [name, type, value] of _craftingAffixTriples(ds)) {
    if (_rankableType(type) && _isMagnitude(value)) suggest.add(canonical(name));
  }
  // Build-around presence effects: discrete on/off (Bool) effects from items AND
  // crafting pools (Ghost Touch, Bone Paws, immunities, SALT...) — added to
  // suggestions and flagged in `presence` so the UI can badge them as on/off (no
  // magnitude). Sentence/clicky/flavor Bool lines are filtered out here but stay
  // free-typeable via `known`.
  const presence = new Set();
  for (const [name, type] of _itemAffixTriples(ds)) {
    if (PRESENCE_TYPES.has(type) && _isPresenceTargetable(name)) { const c = canonical(name); suggest.add(c); presence.add(c); }
  }
  for (const [name, type] of _craftingAffixTriples(ds)) {
    if (PRESENCE_TYPES.has(type) && _isPresenceTargetable(name)) { const c = canonical(name); suggest.add(c); presence.add(c); }
  }
  // #91 (U1) — untyped weapon procs the utility-procs review ADMITTED (Holy,
  // Vampirism... once evidenced). They join the picker on the PRESENCE path —
  // suggested + on/off badge — and deliberately NOT via rankable_affixes: a
  // declared-credit control on these names reopens the exact defect described
  // at `magnitude` below (declaring "Holy 5" satisfies a floor arithmetically,
  // so the solver drops the item that actually grants it).
  for (const n of (meta.utility_untyped_admitted || [])) {
    const c = canonical(n); if (c) { suggest.add(c); presence.add(c); }
  }
  // `presence` means "appears as Bool on at least one item" — NOT "has no
  // magnitude". Four stats are both: Deception, Smoke Screen, Protection from
  // Evil, and Underwater Action ship a Bool line on some items and a real typed
  // magnitude on others (Deception carries Enhancement 3 and Enhancement 7).
  // A UI or query gate that reads `presence` alone treats those as on/off and
  // silently strips a floor the player set on a stat that genuinely has one.
  // `magnitude` is the set with a real rankable bucket, so `presence` minus
  // `magnitude` is the honest "on/off only, nothing to bound or declare" test.
  // Built from the CURATED rankable list, not from a raw `_rankableType` scan.
  // The raw scan treats an untyped affix row as rankable (`_rankableType(null)`
  // is true), and most on/off weapon effects carry an untyped damage line
  // alongside their Bool line — Holy ships `Bool 1` on 11 items and an untyped
  // `6` on 95. A raw-scan magnitude set therefore claims 61 presence stats have
  // magnitudes when the curated vocabulary recognizes 4, and every one of the
  // extra 57 (Holy, Vampirism, Wounding, Paralyzing, the Bane lines) would be
  // handed a declared-credit control. That reopens the exact defect the credit
  // presence gate exists to block: declaring "Holy 5" satisfies a `min 1 Holy`
  // floor arithmetically, so the solver drops the item that actually grants it.
  const magnitude = new Set();
  for (const n of (meta.rankable_affixes || [])) { const c = canonical(n); if (c) magnitude.add(c); }
  if (!magnitude.size) {
    // Fallback only for a cached dataset built before rankable_affixes existed.
    for (const [name, type] of _itemAffixTriples(ds)) {
      if (_rankableType(type) && !PRESENCE_TYPES.has(type)) magnitude.add(canonical(name));
    }
  }

  // #235 — stats whose magnitude comes ONLY from affixes with no bonus type.
  // `Enhanced Ki` is the first: gear-planner carries it untyped, and no source
  // gives it a type. Such a stat must not be offered a declared-credit control,
  // because that control asks the player to pick a bonus type. Picking `Untyped`
  // keys a bucket the gear cannot join and the two would sum into a double-count;
  // picking any other type is a bucket nothing in the game supplies.
  //
  // Deliberately NOT solved by folding an absent type into `Untyped` at the
  // bucket key. Real untyped bonuses stack (`CONCEPTS.md`), and 30 stats carry
  // both an absent type and an explicit `Untyped` — an item's own effect beside
  // an augment's — which are meant to add. Collapsing them would turn those sums
  // into maxes. The gate belongs on the control, not on the stacking rule.
  //
  // #380 — "untyped" has TWO spellings upstream. The 2026-08-18 gear-planner
  // refresh stopped omitting the `type` key and started emitting the literal
  // string `"Untyped"` (key-less affixes 5709 -> 90, `"Untyped"` 148 -> 886).
  // Three Python predicates of exactly this shape were widened for it in the same
  // migration; this is the fourth. Reading only the absent-key spelling made the
  // whole gate inert — `Enhanced Ki`, the stat it was built for, has all 19 of
  // its carriers typed with the literal string and read as TYPED, so the picker
  // offered a declared-credit control on a stat with no bonus type to declare.
  // This classifies the control, not the bucket key, so the stacking rule the
  // paragraph above protects is untouched.
  const untypedOnly = new Set();
  const typedSeen = new Set();
  const untypedSeen = new Set();
  const _isUntyped = (t) => t == null || t === "" || t === "Untyped";
  for (const [name, type, value] of [..._itemAffixTriples(ds), ..._craftingAffixTriples(ds)]) {
    if (PRESENCE_TYPES.has(type)) continue;      // on/off is `presence`, not this
    const c = canonical(name);
    if (!c) continue;
    if (_isUntyped(type)) { if (_isMagnitude(value)) untypedSeen.add(c); }
    else typedSeen.add(c);
  }
  for (const c of untypedSeen) if (!typedSeen.has(c) && magnitude.has(c)) untypedOnly.add(c);

  // #91 (U1) — the Utility tier's counting vocabulary, consumed from the build
  // stamp (metadata.utility_counting_set = presence-minus-magnitude Bool names,
  // restricted to the curated tier-1 list). #343 removed the admitted untyped
  // procs from the count; they remain in metadata.utility_untyped_admitted for
  // the picker, so the two sets are now disjoint. The stamp is authoritative — the Python pipeline
  // derives it with a mirror of the presence predicate above, so app and build
  // agree; nothing here re-derives it. Canonicalized through the alias table so
  // a counting predicate matches gear/augments/crafting by the ONE shared name.
  // Empty for a cached pre-stamp dataset: the tier then counts nothing rather
  // than counting an unreviewed name (exclude-until-verified).
  const utilityCounting = new Set();
  for (const n of (meta.utility_counting_set || [])) {
    const c = canonical(n); if (c) utilityCounting.add(c);
  }

  // #332/#380 — the names a player can rank individually that the Utility tier
  // never counts. They are already folded into `presence` and `suggest` above
  // (that is what makes Undead Bane rankable), but no surface could tell them
  // apart from a counted effect, because the distinguishing set was never
  // exposed.
  //
  // #380 RENAMED from `utilityAdmitted`. The old name meant "allow-dispositioned
  // UNTYPED weapon proc", and the 2026-08-18 re-encoding typed every one of them
  // `Bool` — so the candidate rule stopped seeing them, the shard's allow list
  // emptied, and the whole distinction went dark while nothing about the player-
  // facing meaning had changed. The meaning never depended on untypedness, so
  // the set is now derived from the presence population minus the counting set
  // (`metadata.utility_presence_not_counted`).
  //
  // Both halves are unioned: the derived population, and the shard's reviewed
  // untyped procs, which stay armed for their own population should upstream
  // ever emit an untyped weapon proc again. Canonicalized through the same alias
  // table as utilityCounting so a name matches by the ONE shared name. Disjoint
  // from utilityCounting by construction (the derivation subtracts it, and #343
  // removed the untyped half from the count) and asserted so in
  // tests/dataset.test.js — an overlap would mean a surface claiming both.
  //
  // Empty for a cached pre-stamp dataset, same fail-safe as utilityCounting: the
  // exclusion sentence then names nothing rather than naming an unreviewed stat.
  const utilityNotCounted = new Set();
  for (const key of ["utility_presence_not_counted", "utility_untyped_admitted"]) {
    for (const n of (meta[key] || [])) {
      const c = canonical(n); if (c) utilityNotCounted.add(c);
    }
  }

  // known = the unfiltered union (canonicalized), plus every suggestion.
  const known = new Set();
  for (const n of _allAffixNames(ds)) { const c = canonical(n); if (c) known.add(c); }
  for (const c of suggest) known.add(c);
  for (const n of (ds._affixRegistry || meta.affix_registry || [])) { const c = canonical(n); if (c) known.add(c); }
  // U2 — bare "Sheltering" is expanded into Physical + Magical Sheltering at load
  // (normalizeItem), so no item affix carries it anymore. Drop it as a standalone
  // picker suggestion: it's a shorthand for both PRR and MRR, not a targetable stat,
  // and offering it would point a priority at a target almost nothing satisfies.
  // Physical/Magical Sheltering (and the PRR/MRR aliases) are the real targets.
  // NOTE: this line stands on its own. It is deliberately NOT folded into the
  // expanded-away set below — Sheltering expands to PRR/MRR, umbrella names expand
  // to the six abilities, and src/umbrella.py's set drives that build-time rewrite.
  suggest.delete("Sheltering");
  // U1 (#136) — names the build expands away, so no item can carry them. Authoritative
  // source is metadata.expanded_away_names; the constant is the fallback for a stale
  // cached dataset built before that field existed. Keyed lowercase.
  const expandedAway = {};
  const emitted = meta.expanded_away_names;
  const src = (emitted && typeof emitted === "object" && Object.keys(emitted).length)
    ? emitted : EXPANDED_AWAY_FALLBACK;
  for (const k of Object.keys(src)) expandedAway[String(k).trim().toLowerCase()] = src[k].slice();

  // #381 — names this build RETIRED, mapped to what they became. Keyed lowercase,
  // same `{name: [stats]}` shape as `expandedAway`, DELIBERATELY a separate map:
  // an expanded-away name is shorthand for several stats and the player is told to
  // rank those instead, while a retired label is the SAME enchantment under a new
  // name — upstream adopted the build's `Legendary <stat>` fold, so the points are
  // still there, just under `Accuracy`. Reusing the expanded-away map would tell
  // the player their priority was shorthand for something it never was.
  //
  // No stale-cache fallback, and none is possible to need: a dataset built before
  // this field existed is one where the labels are still carried as live affixes,
  // so there is nothing to migrate. The map is derived per build (a label is
  // retired when NO channel folded it), so it grows itself on the next adoption.
  //
  // Never added to `suggest` or `known`: a retired label is migrated on load and
  // can never be newly picked, because no gear carries the name anymore.
  const retiredLabels = {};
  const retiredSrc = meta.retired_labels;
  if (retiredSrc && typeof retiredSrc === "object") {
    for (const k of Object.keys(retiredSrc)) {
      const to = retiredSrc[k];
      if (Array.isArray(to) && to.length) {
        retiredLabels[String(k).trim().toLowerCase()] = to.slice();
      }
    }
  }

  // U10 (R13/R14) — the enchantment names the item surfaces DISPLAY as an expansion's
  // origin must be rankable. `expanded_away_names` above is NOT that set: it carries
  // only the BARE keys a family declares ("spell focus mastery"), while the surfaces
  // print the bonus-type prefixed name ("Sacred Spell Focus Mastery"). Ranking what
  // the results printed therefore failed.
  //
  // Three sources, weakest first, so the freshest wins: the stale-cache mirror, the
  // build's emission, then a live scan (which alone sees the two families that expand
  // in THIS file). Every source is a scan of stamped data, never a family list — an
  // eighth family is included the moment it stamps its first affix.
  const scanned = _provenanceScan(ds);
  const metaLabels = (meta.provenance_labels && typeof meta.provenance_labels === "object")
    ? meta.provenance_labels : {};
  const provenanceLabels = {};
  for (const src2 of [PROVENANCE_LABEL_FALLBACK, metaLabels, scanned.labels]) {
    for (const label of Object.keys(src2)) {
      const stats = src2[label];
      if (!Array.isArray(stats) || !stats.length) continue;
      // Canonicalize the components: they become the player's actual priorities, so
      // they must be the ONE name gear/augments/crafting share. No-op today.
      const to = [];
      for (const s of stats) { const c = canonical(s); if (c && !to.includes(c)) to.push(c); }
      if (to.length) provenanceLabels[String(label).trim().toLowerCase()] = { label: String(label).trim(), to };
    }
  }
  // A label is admitted only when the stats it becomes are actually present HERE. A
  // label whose components this dataset does not carry is a dead entry: selecting it
  // would trade a name the player picked for priorities nothing can satisfy. It is
  // also what keeps the hardcoded fallback honest — the constant describes the shipped
  // catalog, and must not leak eighteen spell-focus names into a dataset with no such
  // gear. The two live sources pass it by construction (their components ARE stamped
  // affix names), so in practice this gates the mirror.
  for (const key of Object.keys(provenanceLabels)) {
    if (!provenanceLabels[key].to.every((s) => known.has(s))) delete provenanceLabels[key];
  }
  // THE COLLISION GUARD. A label that is ALSO the name of an affix carried without a
  // provenance stamp is a live stat, not an alias — `Blurry`, `Lesser Displacement`
  // and `Crown of Summer` are boolean composites whose components are ADDITIVE, and
  // whose boolean deliberately stays targetable as presence so the carrier item can
  // still be forced in. Aliasing one would substitute that presence target into its
  // components and silently drop the item that grants it: the shape of the incident in
  // docs/solutions/logic-errors/bonus-type-vocabulary-collides-with-bare-stat.md, where
  // a new vocabulary entry destroyed a bare stat of the same name and only code review
  // caught it. Such a label needs nothing done to it — being carried IS being rankable.
  for (const key of Object.keys(provenanceLabels)) {
    if (scanned.native.has(provenanceLabels[key].label)) delete provenanceLabels[key];
  }
  const labelKeys = Object.keys(provenanceLabels);
  for (const key of labelKeys) {
    const entry = provenanceLabels[key];
    // R14 — suggested, not merely accepted when typed exactly. A player reads the name
    // off the results; if it is not in the list there is nothing to find.
    suggest.add(entry.label);
    known.add(entry.label);
    // R13 — and it resolves, through the SAME map every add path and the saved-load
    // path already consult, so U11's substitution needs no second mechanism.
    // #255 — union INTO any declared entry, never replace it: the scan is a subset
    // of the declaration by construction (an expansion skips a component the item
    // already carries explicitly), so replacing would shrink the substitution when
    // every carrier of a family shadows the same component.
    const declared = expandedAway[key] || [];
    for (const s of entry.to) if (!declared.includes(s)) declared.push(s);
    expandedAway[key] = declared;
  }

  // An expanded-away name is stripped from suggestions ONLY when no surface displays
  // it as an origin (`Well Rounded`, `All Ability Scores` — the umbrella family
  // prefixes even its Enhancement variant, so its bare name is never engraved on
  // anything). Those keep removal-and-redirect. A bare name that IS a shipped label
  // (`Parrying`, `Speed`, `Spell Focus`) stays suggested and routes through the
  // substitution instead — the blanket rule suppressed exactly the names the results
  // print.
  for (const s of [...suggest]) {
    const key = String(s).trim().toLowerCase();
    if (expandedAway[key] && !provenanceLabels[key]) suggest.delete(s);
  }
  const labelMap = {};
  for (const key of labelKeys) labelMap[key] = provenanceLabels[key].to.slice();
  return { suggestions: [...suggest].sort(), known, canonical, presence, magnitude, untypedOnly,
           utilityCounting, utilityNotCounted,
           // #348 (U3) — the container's default contents AND order, derived from
           // the declared order restricted to what this dataset stamps. Carried
           // beside the set so every caller (solve, wizard, browse) reads ONE
           // ordering rather than re-deriving it and drifting.
           utilityOrder: defaultUtilityOrder(utilityCounting),
           expandedAway, provenanceLabels: labelMap, retiredLabels };
}

/** U10 — is this name an enchantment label an expansion stamps (as opposed to a bare
 *  expanded-away name no surface displays)? The add gate branches on it: a label
 *  substitutes, anything else still redirects. Own-property only, for the same reason
 *  `expandedAwayFor` is — priority names arrive from localStorage and imported files. */
function isProvenanceLabel(vocab, name) {
  const map = (vocab && vocab.provenanceLabels) || {};
  const key = String(name == null ? "" : name).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(map, key) && Array.isArray(map[key]) && map[key].length > 0;
}

/** U1 (#136) — the concrete stats an expanded-away name becomes, or null.
 *  Case-insensitive, because a free-typed value may not match the picker's casing.
 *  Shared by every add-a-priority path (wizard, query) and by the saved-character
 *  load check, so the rule lives in ONE place. */
function expandedAwayFor(vocab, name) {
  const map = (vocab && vocab.expandedAway) || {};
  const key = String(name == null ? "" : name).trim().toLowerCase();
  // Own-property only. A plain object literal inherits `constructor`, `toString`,
  // `valueOf` and friends from Object.prototype, and `Object.length === 1` sails
  // straight past a bare `hit && hit.length` check — so a priority named
  // "constructor" resolved to the Object *function*, and the load-path caller
  // then threw on `.slice()`, leaving the character permanently unloadable with
  // its priorities already half-overwritten. Priority names reach here from
  // localStorage and from imported character files, so they are not trusted input.
  if (!Object.prototype.hasOwnProperty.call(map, key)) return null;
  const hit = map[key];
  return (Array.isArray(hit) && hit.length) ? hit : null;
}

/** U1 (#136) — the player-facing redirect for an expanded-away name, or null. */
function expandedAwayMessage(vocab, name) {
  const to = expandedAwayFor(vocab, name);
  return to ? `"${name}" is shorthand for ${to.join(", ")} — rank those instead.` : null;
}

/** #381 — the stat a RETIRED enchantment label became, or null.
 *
 *  Own-property only, for exactly the reason `expandedAwayFor` documents above and
 *  in the same words: a priority named `constructor` reaches here from localStorage
 *  and from imported character files, inherits `Object` off the prototype chain, and
 *  `Object.length === 1` sails past a bare `hit && hit.length` — which is how the
 *  load path once threw with a character's priorities already half-overwritten. */
function retiredLabelFor(vocab, name) {
  const map = (vocab && vocab.retiredLabels) || {};
  const key = String(name == null ? "" : name).trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(map, key)) return null;
  const hit = map[key];
  return (Array.isArray(hit) && hit.length) ? hit : null;
}

/** #381 — the player-facing disclosure for a retired label, or null.
 *
 *  Deliberately NOT the expanded-away wording. "X is shorthand for A, B — rank those
 *  instead" is false here: nothing was shorthand and nothing split. The game data
 *  started spelling one enchantment the way this build already scored it, so the
 *  priority keeps working and only its name changed. Say that. */
function retiredLabelMessage(vocab, name) {
  const to = retiredLabelFor(vocab, name);
  return to ? `"${name}" is now recorded as ${to.join(", ")} — same enchantment, ` +
    `new name, so rank ${to.length > 1 ? "those" : "that"} instead.` : null;
}

/** #169 — load migration for a SAVED CHARACTER's ranked priorities.
 *
 *  The add-a-priority paths refuse an expanded-away name, but nothing guarded the
 *  load path: `loadCharacter()` restored `priorities` verbatim. A player who
 *  ranked `Parrying` before it expanded would have loaded a priority that now
 *  matches no item — scoring zero, silently, with no way to tell it apart from a
 *  target nothing happens to carry.
 *
 *  Substitutes each expanded-away name with the concrete stats it became,
 *  preserving rank order and dropping duplicates (ranking both `Parrying` and
 *  `Heightened Awareness` must not yield `Armor Class` twice). Returns what
 *  changed so the caller can disclose it — a silent rewrite of a saved character
 *  is the same defect wearing different clothes.
 *
 *  Idempotent: replacements are concrete stats, which are never themselves
 *  expanded away.
 *
 *  Helpless-fold review — a saved name can also be a picker ALIAS whose canonical
 *  moved out from under it (the helpless-damage fold re-pointed 11 aliases at one
 *  canonical stat). Ranked pre-fold, `Additional Damage to Helpless Targets`
 *  restored to a priority matching nothing and scored zero silently — the same
 *  defect class in a different coat. So a name that is neither expanded away nor
 *  in the current `known` vocabulary resolves through `vocab.canonical` (the SAME
 *  alias table every add path consults) and substitutes its canonical, disclosed
 *  in the same {from, to} shape. Known names pass through untouched; a genuinely
 *  unknown non-aliased name keeps its current pass-through behavior. Still
 *  idempotent: a substituted canonical is known, so a second run skips it. */
function migratePriorities(priorities, vocab) {
  const out = [];
  const seen = new Set();
  const substitutions = [];
  const retired = [];
  const known = (vocab && vocab.known instanceof Set) ? vocab.known : null;
  const canonicalFn = (vocab && typeof vocab.canonical === "function") ? vocab.canonical : null;
  for (const p of (Array.isArray(priorities) ? priorities : [])) {
    let to = expandedAwayFor(vocab, p);
    // #381 — a RETIRED label: upstream adopted one of the build's folds, so the
    // engraved name stopped arriving and left the vocabulary while the points
    // stayed put under the base stat. Substituted here, in the same pass and the
    // same rank position as an expansion, but reported SEPARATELY: it is not a
    // shorthand that expanded, and the disclosure must not say it was.
    //
    // Decided BEFORE the alias fallback below, which would otherwise see an
    // unknown name, find no alias, and pass it through unchanged — the exact
    // silent zero this migration exists to prevent. Idempotent: the replacement
    // is a live base stat, and a live stat is never a retired key.
    let wasRetired = false;
    if (!to) {
      const back = retiredLabelFor(vocab, p);
      if (back) { to = back; wasRetired = true; }
    }
    if (!to && known && canonicalFn) {
      const trimmed = String(p == null ? "" : p).trim();
      if (trimmed && !known.has(trimmed)) {
        const c = canonicalFn(trimmed);
        // `typeof c === "string"` — the alias table is a plain object literal, so
        // a name like `constructor` walks the prototype chain and yields the
        // Object FUNCTION (the exact hazard expandedAwayFor documents above).
        // An aliased name may itself map to an expanded-away canonical; chain
        // through the expansion so one load repairs both.
        if (typeof c === "string" && c && c !== trimmed) to = expandedAwayFor(vocab, c) || [c];
      }
    }
    if (to) (wasRetired ? retired : substitutions).push({ from: p, to: to.slice() });
    for (const name of (to || [p])) {
      const key = String(name == null ? "" : name).trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return { priorities: out, substitutions, retired };
}

/** #169 — the player-facing sentence for a set of load-time substitutions.
 *
 *  `droppedBounds` names any min/max the substitution had to discard. Saying so
 *  is not optional: a floor the player set is a number they chose, and removing
 *  it silently changes what the solver optimizes for without telling them. */
function migrationMessage(substitutions, droppedBounds, droppedCredits, opts) {
  // #381 — retired labels ride in via `opts.retired` rather than the substitution
  // list, because they need their OWN sentence: an expanded-away name became the
  // several stats it was shorthand for, a retired one is the same enchantment
  // wearing the name the game now uses. Merging them would tell a player their
  // `Legendary Accuracy` priority was shorthand, which it never was.
  const retired = (opts && Array.isArray(opts.retired)) ? opts.retired : [];
  const subs = substitutions || [];
  if (!subs.length && !retired.length) return null;
  if (!subs.length) return _retiredSentence(retired) + _droppedSuffix(droppedBounds, droppedCredits);
  const parts = subs.map((s) => `"${s.from}" -> ${s.to.join(", ")}`);
  // U11 (R15) — the picker add reuses this disclosure but not its wording: "This
  // character ranked…" is about a save being repaired, and reads as nonsense next to
  // a name the player just picked. Same clauses, different lead.
  //
  // The rank cost is stated because it is the surprising part. One alias resolving to
  // seven stats occupies SEVEN strict-lexicographic ranks, so ranking `Sacred Spell
  // Focus Mastery` first puts the player's second priority at rank eight. That is
  // correct under strict lexicographic priority — and it is exactly why the
  // substitution is disclosed inline rather than done silently. It is never collapsed
  // into one combined objective term: that is the weighted-sum mode the Non-goals list
  // declines, and it would silently trade the top stat away.
  let msg = (opts && opts.lead === "picker")
    ? `${parts.length > 1 ? "Those names are" : "That name is"} the enchantment as the ` +
      `item shows it, so ${parts.length > 1 ? "they were" : "it was"} added as the ` +
      `separate stats ${parts.length > 1 ? "they grant" : "it grants"}, in order: ` +
      `${parts.join("; ")}. Each takes its own rank, so anything ranked below moves down.`
    : `This character ranked ${parts.length > 1 ? "names" : "a name"} that ` +
      `now expand${parts.length > 1 ? "" : "s"} into the stats they actually grant: ` +
      `${parts.join("; ")}. Your priorities were updated to match.`;
  if (retired.length) msg += " " + _retiredSentence(retired);
  return msg + _droppedSuffix(droppedBounds, droppedCredits);
}

/** #381 — the retired-label clause. Leads with what the player cares about: the
 *  priority still scores. Nothing expanded, nothing was shorthand, no extra rank
 *  was consumed — the game data simply renamed one enchantment onto the base stat
 *  this build was already scoring it as. */
function _retiredSentence(retired) {
  const parts = retired.map((s) => `"${s.from}" -> ${s.to.join(", ")}`);
  const many = parts.length > 1;
  return `This character ranked ${many ? "names" : "a name"} the game data no longer ` +
    `uses: ${parts.join("; ")}. ${many ? "Those enchantments are" : "That enchantment is"} ` +
    `unchanged and still ${many ? "score" : "scores"} — ${many ? "they are" : "it is"} ` +
    `recorded under the base stat now, so your ${many ? "priorities were" : "priority was"} ` +
    `renamed in place.`;
}

/** The dropped-bounds and dropped-credit clauses, shared by every migration lead. */
function _droppedSuffix(droppedBounds, droppedCredits) {
  let msg = "";
  const dropped = [...new Set(droppedBounds || [])];
  if (dropped.length) {
    msg += ` The min/max you had set on ${dropped.map((d) => `"${d}"`).join(", ")} ` +
      `${dropped.length > 1 ? "were" : "was"} removed rather than copied onto the ` +
      `replacement stats — set ${dropped.length > 1 ? "them" : "it"} again if you still want ` +
      `${dropped.length > 1 ? "those limits" : "that limit"}.`;
  }
  // U5 — a dropped declared credit needs its OWN sentence. Folding it into the
  // bounds list told the player a min/max they never set had been removed, and
  // never mentioned the bonus that actually disappeared — the same silent-rewrite
  // defect this disclosure exists to prevent, just misaddressed.
  const credits = [...new Set(droppedCredits || [])];
  if (credits.length) {
    msg += ` The "already have" bonus${credits.length > 1 ? "es" : ""} you declared on ` +
      `${credits.map((d) => `"${d}"`).join(", ")} ` +
      `${credits.length > 1 ? "were" : "was"} removed rather than copied onto the ` +
      `replacement stats — declare ${credits.length > 1 ? "them" : "it"} again on the new ` +
      `stats if you still have ${credits.length > 1 ? "them" : "it"}.`;
  }
  return msg;
}

/** U5, Part C — one-time load migration for a persisted loadout snapshot. Runs the
 *  bidirectional affix/item normalizer over each chosen variant so a PRE-OVERHAUL
 *  save (embedded items carrying only legacy `stat`/`bonus_type`/`minimum_level`)
 *  gains the native `name`/`type`/`ml` the migrated readers use. Idempotent. */
function migrateLoadout(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.chosen)) return snapshot;
  for (const c of snapshot.chosen) if (c && c.variant) normalizeItem(c.variant);
  return snapshot;
}

/** #211 — migrate declared stat credits through the expanded-away map, exactly
 *  as migratePriorities does for ranked names. A saved character's "already
 *  have" credit on a name a family has since expanded away (a Battle Trance's
 *  Insight Combat Mastery) would otherwise go silently inert: the credit's
 *  bucket would no longer be a bucket any ranked target or affix feeds. The
 *  enchantment grants FULL magnitude to every component, so the credit splits
 *  at full value per component, same bonus type — one declared buff, several
 *  bucket entries, mirroring how the item affixes themselves expanded. */
// The expanded-away keys whose enchantment grants FULL magnitude to every
// component — the only families a declared credit may split across. The union
// and non-uniform keys must NOT split: `elemental resistance` redirects to the
// UNION of five (Sonic is per-item — splitting a credit would fabricate a
// Sonic Resistance value for the 52-of-58 carriers that grant none), and
// `speed`'s movement and attack-speed magnitudes differ. Extend deliberately,
// per key, with the wiki evidence — never derive from the expandedAway map,
// which encodes redirect targets, not grant semantics.
var CREDIT_SPLITTABLE = new Set([
  "spell focus mastery", "spell focus", "spell dcs", "resistance",
  "all saving throws", "saving throws", "combat mastery", "tactical dcs",
  "elemental resonance", "charisma skills", "dexterity skills",
  "intelligence skills", "constitution skills", "strength skills",
  "wisdom skills", "well rounded", "all ability scores", "all ability score",
]);

function migrateCredits(credits, vocab) {
  const out = {};
  const substitutions = [];
  const put = (stat, bonus_type, value) => {
    const key = `${stat}||${bonus_type}`;
    // Highest-of-type, matching the game rule the credit models: a player
    // declaring both an umbrella buff and a component buff of the same type
    // keeps the larger, never silently the later-written one.
    if (!out[key] || out[key].value < value) {
      out[key] = { stat, bonus_type, value };
    }
  };
  for (const row of Object.values(credits || {})) {
    if (!row || !row.stat) continue;
    const key = String(row.stat).trim().toLowerCase();
    const to = expandedAwayFor(vocab, row.stat);
    if (to && to.length && CREDIT_SPLITTABLE.has(key)) {
      substitutions.push({ from: row.stat, to: to.slice() });
      for (const s of to) put(s, row.bonus_type, row.value);
    } else {
      // A credit on a non-splittable expanded-away name stays untouched: it
      // was inert before this migration existed, and fabricating component
      // values would be worse than inertness.
      put(row.stat, row.bonus_type, row.value);
    }
  }
  return { credits: out, substitutions };
}

// Browser: expose a global so app.js can normalize the fetched dataset without a
// module system. Node: CommonJS export for the tests + parity harness.
if (typeof window !== "undefined") {
  window.DatasetNormalizer = { COMPOSITE_COMPONENTS, companionHintFor, COMPANION_STATS, normalizeDataset, normalizeItem, normalizeAffix, isNoiseAffix, parseAffixValue, buildPickerVocabulary, presenceWordCapCasualties, migrateLoadout, expandedAwayFor, expandedAwayMessage, migratePriorities, migrationMessage, migrateCredits, isProvenanceLabel, retiredLabelFor, retiredLabelMessage, PROVENANCE_LABEL_FALLBACK, EXPANDED_AWAY_FALLBACK };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { UTILITY_CONTAINER_DEFAULT_ORDER, defaultUtilityOrder,
    COMPANION_STATS, companionHintFor,
    COMPOSITE_COMPONENTS, normalizeDataset, normalizeItem, normalizeAffix, isNoiseAffix, parseAffixValue, buildPickerVocabulary, presenceWordCapCasualties, migrateLoadout, expandedAwayFor, expandedAwayMessage, migratePriorities, migrationMessage, migrateCredits, isProvenanceLabel, retiredLabelFor, retiredLabelMessage, PROVENANCE_LABEL_FALLBACK, EXPANDED_AWAY_FALLBACK, UTILITY_TIER1_PRESENCE };
}
