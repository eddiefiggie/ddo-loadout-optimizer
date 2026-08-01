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
const { normalizeDataset } = require("../../web/dataset.js");

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

async function solveAll() {
  const Highs = require(path.join(ROOT, "web", "vendor", "highs.js"));
  const highs = await Highs({ locateFile: (f) => path.join(ROOT, "web", "vendor", f) });
  const dataset = normalizeDataset(JSON.parse(fs.readFileSync(DATASET, "utf8")));
  const fixtures = JSON.parse(fs.readFileSync(FIXTURES, "utf8"));

  const solves = {};
  for (const fx of fixtures) {
    const model = buildModel(
      dataset.items, fx.query,
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
  }
  return { solves, count: fixtures.length };
}

module.exports = { solveAll, chosenSorted, chosenId };

if (require.main === module) {
  solveAll().then(({ solves, count }) => {
    const snapshot = {
      schema_note: "U8 forward golden guard — ratified post-overhaul accepted solves (perTarget, effective, chosen slot+variant). Regenerate with: node tests/parity/capture_golden.js",
      generated: "2026-08-01",
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
