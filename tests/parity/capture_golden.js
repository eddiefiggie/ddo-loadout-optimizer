// U8 forward golden-guard capture — the ratified/accepted POST-overhaul outcomes.
//
// Distinct from capture_baseline.js (the frozen pre-overhaul BEFORE image kept as
// the historical record): this records the CURRENT accepted solve of each fixture
// so tests/solver_golden.test.js can assert future builds don't drift the optimum.
//
// Reuses the same machinery as capture_baseline.js — buildModel +
// solveLexicographic + normalizeDataset — and records per fixture: perTarget,
// effective, and the chosen loadout (slot + variant id).
//
// Usage:  node tests/parity/capture_golden.js   # -> tests/parity/golden.json
"use strict";
const path = require("path");
const fs = require("fs");
const { buildModel } = require("../../web/model.js");
const { solveLexicographic } = require("../../web/solver.js");
const { normalizeDataset, buildPickerVocabulary, migratePriorities } = require("../../web/dataset.js");

const ROOT = path.join(__dirname, "..", "..");
const DATASET = path.join(ROOT, "web", "data", "items.json");
const FIXTURES = path.join(__dirname, "fixtures.json");

function chosenId(c) {
  const v = c && c.variant;
  if (!v) return null;
  return v.variant_id || v.source_item || (typeof v === "string" ? v : JSON.stringify(v));
}

// The deterministic canonical form asserted by the golden guard.
function chosenSorted(r) {
  return (r.chosen || [])
    .map((c) => ({ slot: c.slot, variant: chosenId(c) }))
    .sort((a, b) => (a.slot + a.variant).localeCompare(b.slot + b.variant));
}

/** A fixture's effective query.
 *
 *  A fixture normally states `query.targets` outright. A fixture may instead state
 *  `query.aliasTargets` — a PROVENANCE LABEL, the originating enchantment name the
 *  item surfaces print ("Sacred Spell Focus Mastery"), which is not itself an affix
 *  any item carries. Those are resolved here through the SAME
 *  `buildPickerVocabulary` + `migratePriorities` pair the priority picker and the
 *  saved-character load path use, so the fixture solves what a player actually gets
 *  rather than a hand-copied expansion that can drift out of step with the table.
 *
 *  A label that stops resolving THROWS rather than falling through to ranking the
 *  literal name. Falling through would leave a green fixture ranking a stat nothing
 *  carries — a guard that can stop checking without failing, which is the shape this
 *  repo has been bitten by (see the declared-credits guard in solver_golden.test.js).
 */
function resolveQuery(fx, vocab) {
  const q = fx.query || {};
  const alias = q.aliasTargets;
  if (!Array.isArray(alias) || !alias.length) return { query: q, substitutions: [] };
  if (Array.isArray(q.targets) && q.targets.length) {
    throw new Error(`fixture ${fx.name}: states BOTH targets and aliasTargets — ` +
      "the resolved list would silently win and the stated one would never be solved");
  }
  const { priorities, substitutions } = migratePriorities(alias, vocab);
  if (!substitutions.length) {
    throw new Error(`fixture ${fx.name}: aliasTargets ${JSON.stringify(alias)} is no longer a ` +
      "provenance alias — the fixture would degrade into ranking a name no item carries");
  }
  const resolved = Object.assign({}, q, { targets: priorities });
  delete resolved.aliasTargets;
  return { query: resolved, substitutions };
}

async function solveAll() {
  const Highs = require(path.join(ROOT, "web", "vendor", "highs.js"));
  const highs = await Highs({ locateFile: (f) => path.join(ROOT, "web", "vendor", f) });
  const dataset = normalizeDataset(JSON.parse(fs.readFileSync(DATASET, "utf8")));
  // Built from the NORMALIZED dataset, matching web/app.js -> web/wizard.js
  // `pickerVocabulary(dataset)`: the vocabulary a fixture's alias resolves through
  // must be the one the running app builds, not a differently-prepared twin.
  const vocab = buildPickerVocabulary(dataset);
  const fixtures = JSON.parse(fs.readFileSync(FIXTURES, "utf8"));

  const solves = {};
  // Side channel, deliberately NOT part of the snapshot. golden.json pins the
  // ratified OUTCOME (status/perTarget/effective/chosen) and its shape is shared by
  // every fixture; the evidence a specific fixture exists to show — which crafts the
  // solve placed, what an alias resolved to — belongs to the assertions, not to the
  // ratified record. Keeping it out means adding a fixture never rewrites the pinned
  // entries of the fixtures already ratified.
  const details = {};
  for (const fx of fixtures) {
    const { query, substitutions } = resolveQuery(fx, vocab);
    const model = buildModel(
      dataset.items, query,
      dataset.dino_inserts, dataset.nearly_complete, dataset.viktranium,
      dataset.seal, dataset.membership_set_defs, dataset.thunder_forged, dataset.green_steel,
    );
    const r = await solveLexicographic(model, highs);
    solves[fx.name] = {
      status: r.status,
      perTarget: r.perTarget || null,
      effective: r.effective || null,
      chosen: chosenSorted(r),
    };
    details[fx.name] = {
      targets: (query.targets || []).slice(),
      substitutions,
      vikPlaced: (r.vikPlaced || []).map((m) => ({
        item: m.item, name: m.name, slot_type: m.slot_type, category: m.category, tier: m.tier,
        affixes: (m.affixes || []).map((a) => ({
          stat: a.stat, bonus_type: a.bonus_type, value: a.value, via: a.via || null,
        })),
      })),
    };
  }
  return { solves, count: fixtures.length, details };
}

module.exports = { solveAll, chosenSorted, chosenId, resolveQuery };

if (require.main === module) {
  solveAll().then(({ solves, count }) => {
    const snapshot = {
      schema_note: "U8 forward golden guard — ratified post-overhaul accepted solves (perTarget, effective, chosen slot+variant). Regenerate with: node tests/parity/capture_golden.js",
      generated: "2026-08-09",
      dataset: "web/data/items.json (9045 items)",
      fixture_count: count,
      solves,
    };
    const out = path.join(__dirname, "golden.json");
    fs.writeFileSync(out, JSON.stringify(snapshot, null, 1));
    for (const name of Object.keys(solves)) console.log(`  captured ${name}: ${solves[name].status}`);
    console.log(`golden: ${count} fixtures -> ${path.relative(ROOT, out)}`);
  }).catch((e) => { console.error(e); process.exit(1); });
}
