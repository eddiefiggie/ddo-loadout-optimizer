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

/** Normalize one item (variant): its affixes, and the item-level legacy
 *  aliases the character gate / UI read. In place. */
function normalizeItem(it) {
  if (!it || typeof it !== "object") return it;
  const affixes = it.affixes;
  if (Array.isArray(affixes)) for (const a of affixes) normalizeAffix(a);
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
  for (const it of dataset.items) normalizeItem(it);
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
const PRESENCE_ALLOW = new Set([]);

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
  // known = the unfiltered union (canonicalized), plus every suggestion.
  const known = new Set();
  for (const n of _allAffixNames(ds)) { const c = canonical(n); if (c) known.add(c); }
  for (const c of suggest) known.add(c);
  for (const n of (ds._affixRegistry || meta.affix_registry || [])) { const c = canonical(n); if (c) known.add(c); }
  return { suggestions: [...suggest].sort(), known, canonical, presence };
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
  window.DatasetNormalizer = { normalizeDataset, normalizeItem, normalizeAffix, parseAffixValue, buildPickerVocabulary, migrateLoadout };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { normalizeDataset, normalizeItem, normalizeAffix, parseAffixValue, buildPickerVocabulary, migrateLoadout };
}
