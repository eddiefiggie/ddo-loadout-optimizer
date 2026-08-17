// #91 (U3, KTD10) — the Utility tier's measured perf gate. NOT part of the test
// suite (the suite glob is tests/*.test.js): run it by hand and record the
// numbers in the PR.
//
// Widening targetSet by the counting set (~800 presence names) materializes
// buckets and indicator vars in every sentinel-present solve. This measures the
// golden fixture set cold-solve time twice per fixture:
//   (a) BASELINE — the fixture exactly as ratified (no counting set threaded);
//   (b) UTILITY  — the same fixture with the sentinel APPENDED to its targets
//       and the counting set threaded (the conditional widening otherwise makes
//       (b) solve the identical un-widened program and the gate passes
//       vacuously).
// Budget: median(b) <= 2 x median(a). Over budget -> stop and surface (the
// plan's lever is trimming/tiering the counting set, not lazy minting).
//
// ROSTER (#343) — the gate measures the SHIPPED counting set by default, but the
// lever KTD10 describes is the roster itself, so a roster decision needs an A/B
// and the gate could not do one. Set ROSTER to compare alternates on identical
// fixtures and machine conditions:
//   shipped (default) — vocab.utilityCounting, whatever the build stamped
//   pre343            — the 38-name roster: tier-1 minus the six worn defensive
//                       toggles, plus the 24 admitted untyped procs
//   hybrid            — the counterfactual: the six toggles added AND the procs
//                       still counted (44 names)
// Measured 2026-08-16 on one developer machine. Sample counts are stated
// because they are uneven, and ranges rather than points because these are
// wall-clock medians that drift with machine load:
//   shipped  1.50-1.75x  (many runs across the session, including the
//                         pre-parameterization gate — same code path)
//   pre343   2.09x       (1 run)
//   hybrid   2.09-2.26x  (4 runs)
// Budget 2.0x. Re-measure rather than cite these.
// That A/B is the real justification for #343 dropping the procs from the count:
// `hybrid` closes the reported bug too, but no sample of it came in under
// budget. Note hybrid's best sample (2.09x) is nearer the line than its worst,
// so the margin is real but not comfortable.
// Only `shipped` is asserted against the budget; the alternates report and exit 0.
//
// Usage:  node tests/perf_utility.js
//         ROSTER=hybrid node tests/perf_utility.js
"use strict";
const path = require("path");
const fs = require("fs");
const { performance } = require("perf_hooks");
const { buildModel, UTILITY_SENTINEL } = require("../web/model.js");
const { solveLexicographic } = require("../web/solver.js");
const { normalizeDataset, buildPickerVocabulary } = require("../web/dataset.js");
const { resolveQuery } = require("./parity/capture_golden.js");

const ROOT = path.join(__dirname, "..");
const DATASET = path.join(ROOT, "web", "data", "items.json");
const FIXTURES = path.join(__dirname, "parity", "fixtures.json");

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main() {
  const Highs = require(path.join(ROOT, "web", "vendor", "highs.js"));
  const dataset = normalizeDataset(JSON.parse(fs.readFileSync(DATASET, "utf8")));
  const vocab = buildPickerVocabulary(dataset);
  const fixtures = JSON.parse(fs.readFileSync(FIXTURES, "utf8"));

  // COLD means cold: a FRESH HiGHS instance per solve. Reusing one instance
  // measurably inflates whichever solve runs later in the wasm heap (observed
  // +30-100% on the same model), which would tax (b) for running second
  // rather than for what it encodes.
  const coldSolve = async (model) => {
    const highs = await Highs({ locateFile: (f) => path.join(ROOT, "web", "vendor", f) });
    const t0 = performance.now();
    const r = await solveLexicographic(model, highs);
    return { ms: performance.now() - t0, r };
  };

  const build = (query, counting) => buildModel(
    dataset.items, query,
    dataset.dino_inserts, dataset.nearly_complete, dataset.viktranium,
    dataset.seal, dataset.membership_set_defs, dataset.thunder_forged,
    dataset.green_steel, dataset.augment_set_defs, counting);

  // #343 — the ROSTER A/B (see header). `pre343` and `hybrid` are derived from
  // the shipped stamp rather than hardcoded, so they stay correct as the roster
  // widens: the admitted procs come from metadata.utility_untyped_admitted, and
  // the six toggles from the named list below.
  const ROSTER_KEY = process.env.ROSTER || "shipped";
  const TOGGLES_343 = ["Ghostly", "True Seeing", "Blurry", "Freedom of Movement",
    "Blindness Immunity", "Deathblock"];
  const admitted = JSON.parse(fs.readFileSync(DATASET, "utf8"))
    .metadata.utility_untyped_admitted || [];
  const shipped = vocab.utilityCounting;
  const ROSTERS = {
    shipped,
    pre343: new Set([...[...shipped].filter((n) => !TOGGLES_343.includes(n)), ...admitted]),
    hybrid: new Set([...shipped, ...admitted]),
  };
  const roster = ROSTERS[ROSTER_KEY];
  if (!roster) {
    console.error(`unknown ROSTER '${ROSTER_KEY}' — expected one of: ${Object.keys(ROSTERS).join(", ")}`);
    process.exit(2);
  }
  console.log(`roster: ${ROSTER_KEY} (${roster.size} counted names)`
    + (ROSTER_KEY === "shipped" ? "" : " — ALTERNATE, not asserted against the budget"));

  const base = [], util = [];
  for (const fx of fixtures) {
    const { query } = resolveQuery(fx, vocab);

    // 2026-08-15 (#91 U8): the ratified fixtures now CARRY the sentinel (the
    // KTD9 re-ratification), so the pair is derived by stripping/ensuring it
    // rather than appending blindly — (a) must be the pre-feature program
    // (no sentinel, no counting set) and (b) must rank the sentinel exactly
    // once (a duplicate would iterate a second no-op stage and tax (b) for
    // something no real query encodes).
    const ranked = (query.targets || []).filter((t) => t !== UTILITY_SENTINEL);

    // (a) baseline — the pre-feature program (mirrors a tier-removed query).
    const qa = Object.assign({}, query, { targets: ranked });
    const { ms: ta, r: ra } = await coldSolve(build(qa, null));
    base.push(ta);

    // (b) utility — sentinel ranked last, counting set threaded.
    const q2 = Object.assign({}, query,
      { targets: [...ranked, UTILITY_SENTINEL] });
    const { ms: tb, r: rb } = await coldSolve(build(q2, roster));
    util.push(tb);

    console.log(`  ${fx.name}: base ${ta.toFixed(0)} ms (${ra.status})`
      + ` | +utility ${tb.toFixed(0)} ms (${rb.status}`
      + `${rb.utilityCount != null ? `, count ${rb.utilityCount}` : ""})`);
  }

  const ma = median(base), mb = median(util);
  const ratio = mb / ma;
  console.log(`\nfixtures: ${fixtures.length}`);
  console.log(`(a) baseline median cold solve: ${ma.toFixed(0)} ms`);
  console.log(`(b) sentinel-appended median:   ${mb.toFixed(0)} ms`);
  console.log(`ratio (b)/(a): ${ratio.toFixed(2)}x  — budget <= 2.00x`);
  if (ROSTER_KEY !== "shipped") {
    // An alternate roster is a measurement, not the shipping gate. Failing the
    // build on it would make an informational A/B look like a regression.
    console.log(`(informational — ROSTER=${ROSTER_KEY}; the budget is asserted only on the shipped roster)`);
    return;
  }
  console.log(ratio <= 2 ? "PERF GATE: PASS" : "PERF GATE: FAIL — stop and surface (KTD10)");
  if (ratio > 2) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
