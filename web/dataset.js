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
          var stamp = {};
          stamp[PROVENANCE_KEY] = sourceLabel("Sheltering", a.type, SHELTERING_UNPREFIXED);
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
          // R12: the item is engraved "Blurry", not "Concealment" — the derived
          // component names the composite it came from. A composite is stored as
          // `Bool` presence, which is not a bonus type, so the label is bare.
          if (!prev || c.value > prev.value) {
            var stampedComp = Object.assign({}, c);
            stampedComp[PROVENANCE_KEY] = String(a.name);
            derived.set(c.name, stampedComp);
          }
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

/** Walk a loaded dataset once, normalizing every item[] variant in place, and
 *  return the same dataset object (for convenient chaining). Also installs the
 *  stacking-equivalence map from `metadata.stacking_equivalence` so the solver's
 *  bucket keys collapse equivalent affix types (Insight Natural -> Insight). */
function normalizeDataset(dataset) {
  if (!dataset || !Array.isArray(dataset.items)) return dataset;
  const meta = dataset.metadata || {};
  const equiv = meta.stacking_equivalence || {};
  dataset._stackEquiv = equiv;
  installStackEquiv(equiv);
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
]);

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

/** Every crafting-pool affix as [name, type, value] (all pools carry the legacy
 *  {stat,bonus_type} shape — the normalizer does not touch pools, and the solver
 *  reads them the same legacy way). */
function _craftingAffixTriples(ds) {
  const out = [];
  const push = (n, t, v) => { if (n != null && n !== "") out.push([n, t, v]); };
  for (const pool of [ds.seal, ds.nearly_complete, ds.viktranium, ds.thunder_forged, ds.green_steel]) {
    for (const o of pool || []) push(o.stat, o.bonus_type, o.value);
  }
  for (const arr of Object.values(ds.nearly_complete_per_item || {})) {
    for (const o of arr || []) push(o.stat, o.bonus_type, o.value);
  }
  for (const ins of ds.dino_inserts || []) {
    const affs = (ins.affixes && ins.affixes.length) ? ins.affixes : [ins];
    for (const a of affs) push(a.stat, a.bonus_type, a.value);
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
  const untypedOnly = new Set();
  const typedSeen = new Set();
  const untypedSeen = new Set();
  for (const [name, type, value] of [..._itemAffixTriples(ds), ..._craftingAffixTriples(ds)]) {
    if (PRESENCE_TYPES.has(type)) continue;      // on/off is `presence`, not this
    const c = canonical(name);
    if (!c) continue;
    if (type == null || type === "") { if (_isMagnitude(value)) untypedSeen.add(c); }
    else typedSeen.add(c);
  }
  for (const c of untypedSeen) if (!typedSeen.has(c) && magnitude.has(c)) untypedOnly.add(c);

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
  for (const s of [...suggest]) {
    if (expandedAway[String(s).trim().toLowerCase()]) suggest.delete(s);
  }
  return { suggestions: [...suggest].sort(), known, canonical, presence, magnitude, untypedOnly, expandedAway };
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
 *  expanded away. */
function migratePriorities(priorities, vocab) {
  const out = [];
  const seen = new Set();
  const substitutions = [];
  for (const p of (Array.isArray(priorities) ? priorities : [])) {
    const to = expandedAwayFor(vocab, p);
    if (to) substitutions.push({ from: p, to: to.slice() });
    for (const name of (to || [p])) {
      const key = String(name == null ? "" : name).trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return { priorities: out, substitutions };
}

/** #169 — the player-facing sentence for a set of load-time substitutions.
 *
 *  `droppedBounds` names any min/max the substitution had to discard. Saying so
 *  is not optional: a floor the player set is a number they chose, and removing
 *  it silently changes what the solver optimizes for without telling them. */
function migrationMessage(substitutions, droppedBounds, droppedCredits) {
  if (!substitutions || !substitutions.length) return null;
  const parts = substitutions.map((s) => `"${s.from}" -> ${s.to.join(", ")}`);
  let msg = `This character ranked ${parts.length > 1 ? "names" : "a name"} that ` +
    `now expand${parts.length > 1 ? "" : "s"} into the stats they actually grant: ` +
    `${parts.join("; ")}. Your priorities were updated to match.`;
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

// Browser: expose a global so app.js can normalize the fetched dataset without a
// module system. Node: CommonJS export for the tests + parity harness.
if (typeof window !== "undefined") {
  window.DatasetNormalizer = { normalizeDataset, normalizeItem, normalizeAffix, isNoiseAffix, parseAffixValue, buildPickerVocabulary, presenceWordCapCasualties, migrateLoadout, expandedAwayFor, expandedAwayMessage, migratePriorities, migrationMessage };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { normalizeDataset, normalizeItem, normalizeAffix, isNoiseAffix, parseAffixValue, buildPickerVocabulary, presenceWordCapCasualties, migrateLoadout, expandedAwayFor, expandedAwayMessage, migratePriorities, migrationMessage };
}
