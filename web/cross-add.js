// #300 — the cross-add primitive, extracted from model.js (which had crossed the
// 1000-line reviewability threshold). This module OWNS the one _CROSS_ADD state
// instance and its API; it is where the next universal-stat mechanism lands.
//
// Two runtimes, one instance:
//   * Browser: loaded as a classic script BEFORE model.js (web/index.html), so
//     the top-level function declarations below are the globals model.js and
//     solver.js previously resolved from model.js. Nothing here may collide with
//     a top-level identifier in another web/*.js file (see docs/solutions/
//     conventions/shared-classic-script-globals-use-var-not-const.md).
//   * Node/tests: require("./cross-add.js") — dataset.js's installCrossAdd and
//     solver.js's resolver bridges require this module DIRECTLY; model.js
//     re-exports the same required functions for API compatibility. Node's
//     require cache keeps that a single shared _CROSS_ADD.

// U1 (#290/#291) — cross-add map {target_stat: [source_stats]}: stats whose
// bucket totals flat-ADD into the target's total ACROSS buckets (the wiki's
// fully-stacking universal sources — Universal Spell Power into the ten element
// spellpowers, Spell Lore/Universal Spell Lore into the element lores). The
// OPPOSITE contract from model.js's _STACK_EQUIV, which collapses same-bucket
// sources to the max. Emitted into items.json `metadata.cross_add` and
// installed here (dataset.js calls setCrossAdd on load, mirroring
// setStackEquiv). Solver crediting reads crossAddSourcesFor (solver.js
// bucketCountsFor).
let _CROSS_ADD = Object.create(null);
function setCrossAdd(map) {
  _CROSS_ADD = Object.create(null);
  if (map && typeof map === "object") {
    for (const k of Object.keys(map)) {
      if (Array.isArray(map[k])) _CROSS_ADD[k] = map[k].slice();
    }
  }
}
/** Source stats whose totals cross-add into `stat` — [] for an unmapped stat
 *  and for the uninstalled state (never a crash). */
const _NO_CROSS_ADD_SOURCES = Object.freeze([]);
function crossAddSourcesFor(stat) {
  const srcs = stat != null ? _CROSS_ADD[stat] : undefined;
  return Array.isArray(srcs) ? srcs : _NO_CROSS_ADD_SOURCES;
}

/** U2 (#290/#291) — widen a stat set in place with every member's cross-add
 *  SOURCE stats (an element spellpower pulls in Universal Spell Power; an
 *  element lore pulls in Spell Lore + Universal Spell Lore). THE single
 *  widening used by both buildModel (model.js — keeps universal-only items
 *  alive through the dominance pre-filter) and buildProgram (solver.js —
 *  builds the source buckets bucketCountsFor collects), so the two layers can
 *  never widen differently. */
function widenWithCrossAddSources(targetSet) {
  for (const stat of [...targetSet]) {
    for (const src of crossAddSourcesFor(stat)) targetSet.add(src);
  }
  return targetSet;
}

// exports for node tests; harmless in the browser
if (typeof module !== "undefined" && module.exports) {
  module.exports = { setCrossAdd, crossAddSourcesFor, widenWithCrossAddSources };
}
