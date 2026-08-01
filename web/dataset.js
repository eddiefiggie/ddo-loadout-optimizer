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
 *  place. Idempotent: skips fields already present. */
function normalizeAffix(a) {
  if (!a || typeof a !== "object") return a;
  if (a.stat == null && a.name != null) a.stat = a.name;
  if (a.bonus_type == null && a.type != null) a.bonus_type = a.type;
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
  if (it.minimum_level == null && it.ml != null) it.minimum_level = it.ml;
  if (it.ml == null && it.minimum_level != null) it.ml = it.minimum_level;
  const at = ARMOR_TYPE_MAP[it.type];
  if (at) it.armor_type = at;
  return it;
}

/** Walk a loaded dataset once, normalizing every item[] variant in place, and
 *  return the same dataset object (for convenient chaining). */
function normalizeDataset(dataset) {
  if (!dataset || !Array.isArray(dataset.items)) return dataset;
  for (const it of dataset.items) normalizeItem(it);
  return dataset;
}

// Browser: expose a global so app.js can normalize the fetched dataset without a
// module system. Node: CommonJS export for the tests + parity harness.
if (typeof window !== "undefined") {
  window.DatasetNormalizer = { normalizeDataset, normalizeItem, normalizeAffix, parseAffixValue };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { normalizeDataset, normalizeItem, normalizeAffix, parseAffixValue };
}
