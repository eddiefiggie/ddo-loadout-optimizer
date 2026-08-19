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

/** #211 — declared credits migrate through the same expanded-away map the app
 *  uses (`migrateCredits`), so a fixture declaring a credit on an
 *  expanded-away name (the Battle Trance's Insight Combat Mastery) solves what
 *  a restored saved character actually gets. No-op when nothing expands. */
function migrateFixtureCredits(query, vocab) {
  if (!query.declaredCredits) return query;
  const { migrateCredits } = require("../../web/dataset.js");
  return Object.assign({}, query,
    { declaredCredits: migrateCredits(query.declaredCredits, vocab).credits });
}

/** Load the solve environment once: the HiGHS instance, the normalized dataset,
 *  and the picker vocabulary built from it. Split out of `solveAll` so a test
 *  that only needs a handful of fixtures (or one ad-hoc query) reuses the SAME
 *  environment and the SAME `solveFixture` threading below, rather than growing
 *  a second copy of the buildModel argument list that can drift out of step. */
async function solveEnv() {
  const Highs = require(path.join(ROOT, "web", "vendor", "highs.js"));
  const highs = await Highs({ locateFile: (f) => path.join(ROOT, "web", "vendor", f) });
  const dataset = normalizeDataset(JSON.parse(fs.readFileSync(DATASET, "utf8")));
  // Built from the NORMALIZED dataset, matching web/app.js -> web/wizard.js
  // `pickerVocabulary(dataset)`: the vocabulary a fixture's alias resolves through
  // must be the one the running app builds, not a differently-prepared twin.
  const vocab = buildPickerVocabulary(dataset);
  return { highs, dataset, vocab };
}

/** Solve ONE fixture in a prepared environment. Returns `{ solve, detail }` —
 *  the ratified-shape outcome and the side-channel evidence. */
async function solveFixture(fx, env) {
  const { highs, dataset, vocab } = env;
  const { query: resolvedQuery, substitutions } = resolveQuery(fx, vocab);
  const query = migrateFixtureCredits(resolvedQuery, vocab);
  // #91 (U8, KTD3/KTD9) — the utility counting set rides as the buildModel
  // argument, exactly as web/query.js and web/wizard.js pass it
  // (`vocab.utilityCounting || null`). Without this the capture solves every
  // sentinel-appended fixture with ZERO indicators — a green golden that
  // covers none of the tier. The widening is conditional on the sentinel
  // being in the fixture's targets, so the tier-removed A/B twin (and any
  // pre-feature fixture) still builds the byte-identical pre-feature program.
  // augmentSetDefs stays {} (positional): the golden universe was ratified
  // without set-bonus augments; widening it would be its own deliberate
  // re-ratification, not a side effect of threading the counting set.
  const model = buildModel(
    dataset.items, query,
    dataset.dino_inserts, dataset.nearly_complete, dataset.viktranium,
    dataset.seal, dataset.membership_set_defs, dataset.thunder_forged, dataset.green_steel,
    {}, vocab.utilityCounting && vocab.utilityCounting.size
      // #348 (U3) — the capture solves what the app solves, ORDER included: a
      // golden captured in alphabetical order would ratify a loadout no player
      // can ever get.
      ? { counting: vocab.utilityCounting, admitted: vocab.utilityAdmitted || new Set(),
          order: vocab.utilityOrder || null }
      : null,
  );
  const r = await solveLexicographic(model, highs);
  return {
    solve: {
      status: r.status,
      perTarget: r.perTarget || null,
      effective: r.effective || null,
      chosen: chosenSorted(r),
    },
    detail: {
      targets: (query.targets || []).slice(),
      substitutions,
      // #339 — the placed regular-slot augments' variant ids, so the ceiling
      // fixture's guard can assert every one sits at/below the ceiling against
      // the dataset's per-augment ML. Side channel like the rest of `details`:
      // never part of the ratified golden.json snapshot.
      augmentsPlaced: (r.augmentsPlaced || []).map((m) => m.variant_id),
      vikPlaced: (r.vikPlaced || []).map((m) => ({
        item: m.item, name: m.name, slot_type: m.slot_type, category: m.category, tier: m.tier,
        affixes: (m.affixes || []).map((a) => ({
          stat: a.stat, bonus_type: a.bonus_type, value: a.value, via: a.via || null,
        })),
      })),
    },
  };
}

async function solveAll() {
  const env = await solveEnv();
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
    const { solve, detail } = await solveFixture(fx, env);
    solves[fx.name] = solve;
    details[fx.name] = detail;
  }
  return { solves, count: fixtures.length, details };
}

module.exports = { solveAll, solveEnv, solveFixture, chosenSorted, chosenId, resolveQuery };

if (require.main === module) {
  solveAll().then(({ solves, count }) => {
    // Provenance, DERIVED. Both fields were hand-written literals and both had
    // gone stale (2026-08-15 / 9045 items against a 9110-item build) — a
    // ratified snapshot that misreports which dataset ratified it is exactly the
    // provenance trap docs/solutions/workflow-issues/rebuild-the-dataset-before-
    // any-golden-capture.md is about.
    const itemCount = JSON.parse(fs.readFileSync(DATASET, "utf8")).items.length;
    // Local date, not `toISOString()` — a UTC slice stamps tomorrow's date on an
    // evening capture, which reads as a provenance error to the next reader.
    const d = new Date();
    const stamp = [d.getFullYear(), d.getMonth() + 1, d.getDate()]
      .map((n, i) => (i ? String(n).padStart(2, "0") : String(n))).join("-");
    const snapshot = {
      schema_note: "U8 forward golden guard — ratified post-overhaul accepted solves (perTarget, effective, chosen slot+variant). Regenerate with: node tests/parity/capture_golden.js",
      generated: stamp,
      dataset: `web/data/items.json (${itemCount} items)`,
      fixture_count: count,
      solves,
    };
    const out = path.join(__dirname, "golden.json");
    fs.writeFileSync(out, JSON.stringify(snapshot, null, 1));
    for (const name of Object.keys(solves)) console.log(`  captured ${name}: ${solves[name].status}`);
    console.log(`golden: ${count} fixtures -> ${path.relative(ROOT, out)}`);
  }).catch((e) => { console.error(e); process.exit(1); });
}
