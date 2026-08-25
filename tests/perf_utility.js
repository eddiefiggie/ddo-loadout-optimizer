// #91 (U3, KTD10) — the Utility tier's measured perf gate. Outside the
// tests/*.test.js glob because it is a wall-clock measurement rather than a unit
// test — but #443 wired CI to invoke it BY PATH, so it is no longer "run it by
// hand". It went unrun for four days while the counting roster widened from 20
// names to 25 and the ratio drifted from 1.80x to 2.35x; a guard nobody runs is
// not a guard. Still worth running locally and recording the numbers in the PR,
// since wall-clock is machine- and load-sensitive.
//
// Widening targetSet by the counting set (~800 presence names) materializes
// buckets and indicator vars in every sentinel-present solve. This measures the
// golden fixture set cold-solve time twice per fixture:
//   (a) BASELINE — the fixture exactly as ratified (no counting set threaded);
//   (b) UTILITY  — the same fixture with the sentinel APPENDED to its targets
//       and the counting set threaded (the conditional widening otherwise makes
//       (b) solve the identical un-widened program and the gate passes
//       vacuously).
//
// ---------------------------------------------------------------------------
// #466 — WHAT THIS GATE ASSERTS, AND WHY IT IS NO LONGER A MEDIAN
// ---------------------------------------------------------------------------
// Until 2026-08-24 the verdict was `median(b) <= 2.00 x median(a)`, medians
// taken ACROSS fixtures. #466 filed it as a coin flip (2 of 8 local runs over
// budget on unchanged code). Measuring it turned up two defects, and the
// flakiness was the smaller one.
//
//   1. The statistic was UNPAIRED, and worse, CROSS-FIXTURE. median(a) and
//      median(b) are the middle elements of two separately-sorted lists, and
//      those are different fixtures: on this tree median(a) came from
//      `endgame-dps-ml33` and median(b) from `aug-ceiling-32-int-caster-ml36`,
//      every run. The headline "ratio" divided one fixture's utility solve by
//      an unrelated fixture's baseline. Nothing cancelled, so it carried the
//      full machine-drift variance of both — which is exactly the flake #466
//      reported.
//
//   2. It was BLIND TO CONCENTRATED REGRESSIONS. A median only moves when the
//      middle of the distribution moves. Replaying the measured per-fixture
//      data with one fixture's added cost tripled:
//
//        scenario                  ratio-of-medians   cost-weighted   worst-ratio
//        baseline (today)                     1.87x           1.51x         3.72x
//        endgame-caster-ml32 x3               1.87x           1.79x         3.72x
//        trance-credit-additive-ml32 x3       1.87x           1.68x         9.14x
//        all added x1.5                       2.29x           1.76x         5.08x
//        all added x2                         2.70x           2.01x         6.44x
//
//      An 8-second regression on the most expensive fixture moved the old
//      statistic by 0.00x. That is the failure mode a perf gate exists to
//      catch, and it passed green.
//
// So the verdict is now TWO checks on PAIRED per-fixture measurements. (a) and
// (b) for a given fixture run back-to-back, so a load transient inflates both
// arms and largely cancels in that fixture's own ratio.
//
//   COST-WEIGHTED TOTAL — sum(b) / sum(a) <= 1.75
//     What the whole ratified workload costs a player. The most stable
//     statistic measured: 1.49-1.52x across six runs (three idle, three under
//     14-of-16-core contention), spread 0.03. Catches broad regressions and
//     concentrated ones in EXPENSIVE fixtures. Deliberately near-blind to
//     regressions in cheap fixtures — a 98 ms fixture tripling its added cost
//     is 376 ms nobody feels, and pretending otherwise is what made the old
//     gate cry wolf.
//     Budget 1.75x is a TIGHTENING from the old nominal 2.00x, affordable only
//     because the statistic got stable: headroom is 15%, about 8x the measured
//     run-to-run spread. It fires on `all added x1.5` (1.76x) and on a single
//     3x blowup in the dominant fixture (1.79x), neither of which the old
//     2.00x median caught.
//
//   WORST PER-FIXTURE RATIO — max(b/a) over fixtures with a >= 200 ms, <= 5.00
//     The catastrophe detector for a fixture too small to move the weighted
//     total. Catches `trance-credit-additive-ml32 x3` (9.14x) where the
//     cost-weighted check passes at 1.68x. Measured worst today is 3.72x
//     (`trance-credit-additive-ml32`, itself stable to +/-0.04), so headroom
//     is 34%.
//
//     The 200 ms FLOOR is a measurement floor, not a convenience. Per-fixture
//     ratio spread over the same six runs, by baseline cost:
//         16 ms +/-0.98 | 57 ms +/-0.27 | 62 ms +/-0.32 |  97 ms +/-0.10
//         98 ms +/-0.11 | 99 ms +/-0.15 | 133 ms +/-0.08 | 202 ms +/-0.04
//        208 ms +/-0.06 | ...every fixture above 200 ms lands at +/-0.06 or better
//     Below ~200 ms the ratio is fixed overhead and timer noise, not solve
//     cost. The floor splits exactly at that knee. Sub-floor fixtures still
//     appear in the report, marked, and still count toward the weighted total
//     — they are excluded only from the worst-ratio verdict.
//
// Note what the report makes visible that the old one hid: `endgame-caster-ml32`
// is ~70% of all baseline solve time. The gate was always mostly about that one
// fixture; now the table says so.
//
// KTD10's lever is unchanged: over budget -> stop and surface, and the response
// to a genuine regression is trimming/tiering the counting set, not lazy
// minting.
//
// ---------------------------------------------------------------------------
// ROSTER (#343) — the gate measures the SHIPPED counting set by default, but the
// lever KTD10 describes is the roster itself, so a roster decision needs an A/B
// and the gate could not do one. Set ROSTER to compare alternates on identical
// fixtures and machine conditions:
//   shipped (default) — vocab.utilityCounting, whatever the build stamped
//   pre343            — the 38-name roster: tier-1 minus the six worn defensive
//                       toggles, plus the 24 admitted untyped procs
//   hybrid            — the counterfactual: the six toggles added AND the procs
//                       still counted (44 names)
// Only `shipped` is asserted against the budgets; the alternates report and
// exit 0.
//
// HISTORICAL FIGURES — all of these were taken with the RETIRED ratio-of-medians
// statistic and are NOT comparable to the two numbers above. Kept because the
// #343 roster A/B still rests on them.
//   Measured 2026-08-16, one developer machine, ranges not points:
//     shipped  1.50-1.75x  (many runs)   pre343  2.09x (1 run)
//     hybrid   2.09-2.26x  (4 runs)
//   That A/B is the real justification for #343 dropping the procs from the
//   count: `hybrid` closes the reported bug too, but no sample of it came in
//   under the then-2.0x budget.
//   Re-measured 2026-08-18 after the gear-planner refresh (#374, U7), shipped
//   roster, 20 counted names both sides:
//     pre-refresh dataset (upstream ec3e595)   1.69x (2 runs, a=466 ms)
//     post-refresh dataset (upstream 767a7f7)  1.80-1.81x (2 runs, a=460-463 ms)
//   Both arms move with the data, so the refresh's own cost is the change in the
//   ABSOLUTE (a) medians (-0.6% to -1.3%: the refresh did not raise solve cost).
//   docs/reports/2026-08-18-gear-planner-canon-migration.md §18.
// Re-measure rather than cite any of these.
//
// Usage:  node tests/perf_utility.js
//         ROSTER=hybrid node tests/perf_utility.js
//         REPS=3 node tests/perf_utility.js   (median of N pairs per fixture;
//              default 1 — pairing plus the floor already deliver the stability
//              reps were meant to buy, and reps multiply a ~90 s gate)
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

// Budgets and the measurement floor. See the header for how each was derived;
// none of the three is a round number picked for looks.
const WEIGHTED_BUDGET = 1.75;
const WORST_BUDGET = 5.0;
const FLOOR_MS = 200;

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

  const REPS = Math.max(1, parseInt(process.env.REPS || "1", 10) || 1);

  // An alternate that equals `shipped` is a VACUOUS A/B — it measures the
  // shipped roster twice and reports the difference as if it meant something.
  // Both alternates derive their extra names from metadata.utility_untyped_admitted,
  // which is [] on this dataset, so today `pre343` and `hybrid` both collapse
  // into `shipped`. Say so rather than printing a confident identical number:
  // the whole point of the ROSTER knob is that a roster claim be testable, and
  // a silently-collapsed alternate is the harness losing that ability again.
  // Tracked separately — this is disclosure, not the fix.
  const sameAsShipped = ROSTER_KEY !== "shipped"
    && roster.size === shipped.size && [...roster].every((n) => shipped.has(n));

  console.log(`roster: ${ROSTER_KEY} (${roster.size} counted names)`
    + (ROSTER_KEY === "shipped" ? "" : " — ALTERNATE, not asserted against the budgets")
    + (REPS > 1 ? `; REPS=${REPS} (per-fixture median of ${REPS} pairs)` : ""));
  if (sameAsShipped) {
    console.log(`  !! VACUOUS A/B: '${ROSTER_KEY}' is name-for-name identical to 'shipped'`);
    console.log(`     (metadata.utility_untyped_admitted is empty, so the alternates`);
    console.log(`      have nothing to add). Any difference below is run-to-run noise,`);
    console.log(`      not a roster effect. Do NOT record it as an A/B.`);
  }

  const rows = [];
  for (const fx of fixtures) {
    const { query } = resolveQuery(fx, vocab);

    // 2026-08-15 (#91 U8): the ratified fixtures now CARRY the sentinel (the
    // KTD9 re-ratification), so the pair is derived by stripping/ensuring it
    // rather than appending blindly — (a) must be the pre-feature program
    // (no sentinel, no counting set) and (b) must rank the sentinel exactly
    // once (a duplicate would iterate a second no-op stage and tax (b) for
    // something no real query encodes).
    const ranked = (query.targets || []).filter((t) => t !== UTILITY_SENTINEL);
    const qa = Object.assign({}, query, { targets: ranked });
    const qb = Object.assign({}, query, { targets: [...ranked, UTILITY_SENTINEL] });

    // PAIRED: (a) and (b) run back-to-back, REPS times, so a load transient
    // hits both arms of the same fixture and cancels in its ratio. This is the
    // #466 fix — the old statistic compared across fixtures and across time.
    const as = [], bs = [];
    let ra, rb;
    for (let i = 0; i < REPS; i++) {
      const a = await coldSolve(build(qa, null));
      as.push(a.ms); ra = a.r;
      const b = await coldSolve(build(qb, roster));
      bs.push(b.ms); rb = b.r;
    }
    const ta = median(as), tb = median(bs);
    rows.push({ name: fx.name, a: ta, b: tb, ratio: tb / ta, counted: ta >= FLOOR_MS });

    console.log(`  ${fx.name}: base ${ta.toFixed(0)} ms (${ra.status})`
      + ` | +utility ${tb.toFixed(0)} ms (${rb.status}`
      + `${rb.utilityCount != null ? `, count ${rb.utilityCount}` : ""})`
      + ` | ${(tb / ta).toFixed(2)}x`);
  }

  const sumA = rows.reduce((s, r) => s + r.a, 0);
  const sumB = rows.reduce((s, r) => s + r.b, 0);
  const weighted = sumB / sumA;
  const counted = rows.filter((r) => r.counted);
  // Refuse to inspect zero records. If nothing clears the floor the worst-ratio
  // check has no population, and reporting PASS would be a vacuous green — the
  // shape this repo has been bitten by before. A machine fast enough to put
  // every fixture under 200 ms means the floor needs re-deriving, not ignoring.
  if (!counted.length) {
    console.error(`\nPERF GATE: FAIL — no fixture reached the ${FLOOR_MS} ms measurement`
      + ` floor, so the worst-ratio check has nothing to assert on. Re-derive the`
      + ` floor from a fresh spread-vs-baseline sample (see header) rather than`
      + ` lowering it to whatever makes this run green.`);
    process.exitCode = 1;
    return;
  }
  const worstRow = counted.reduce((m, r) => (r.ratio > m.ratio ? r : m), counted[0]);

  // Sorted by cost, because the cost concentration is itself a thing a reader
  // needs to see: one fixture is most of this gate's wall clock.
  console.log(`\nper fixture, most expensive first (share = share of total baseline time):`);
  console.log(`  ${"fixture".padEnd(46)}${"base".padStart(9)}${"+util".padStart(9)}`
    + `${"added".padStart(9)}${"ratio".padStart(8)}${"share".padStart(8)}`);
  for (const r of [...rows].sort((x, y) => y.a - x.a)) {
    console.log(`  ${r.name.padEnd(46)}${r.a.toFixed(0).padStart(9)}`
      + `${r.b.toFixed(0).padStart(9)}${(r.b - r.a).toFixed(0).padStart(9)}`
      + `${(r.ratio.toFixed(2) + "x").padStart(8)}`
      + `${((r.a / sumA * 100).toFixed(1) + "%").padStart(8)}`
      + (r.counted ? "" : `   (under the ${FLOOR_MS} ms floor — not in the worst-ratio verdict)`));
  }

  console.log(`\nfixtures: ${rows.length} (${counted.length} at or above the ${FLOOR_MS} ms measurement floor)`);
  console.log(`(a) total baseline:        ${sumA.toFixed(0)} ms`);
  console.log(`(b) total sentinel-added:  ${sumB.toFixed(0)} ms`);
  console.log(`cost-weighted (b)/(a): ${weighted.toFixed(2)}x  — budget <= ${WEIGHTED_BUDGET.toFixed(2)}x`);
  console.log(`worst per-fixture ratio: ${worstRow.ratio.toFixed(2)}x`
    + ` (${worstRow.name})  — budget <= ${WORST_BUDGET.toFixed(2)}x`);

  if (ROSTER_KEY !== "shipped") {
    // An alternate roster is a measurement, not the shipping gate. Failing the
    // build on it would make an informational A/B look like a regression.
    console.log(`(informational — ROSTER=${ROSTER_KEY}; the budgets are asserted only on the shipped roster)`);
    return;
  }

  const failures = [];
  if (weighted > WEIGHTED_BUDGET) {
    failures.push(`cost-weighted ${weighted.toFixed(2)}x > ${WEIGHTED_BUDGET.toFixed(2)}x`);
  }
  if (worstRow.ratio > WORST_BUDGET) {
    failures.push(`worst per-fixture ${worstRow.ratio.toFixed(2)}x on ${worstRow.name}`
      + ` > ${WORST_BUDGET.toFixed(2)}x`);
  }
  if (failures.length) {
    console.log(`PERF GATE: FAIL — ${failures.join("; ")}`);
    console.log(`  stop and surface (KTD10). The lever is trimming/tiering the`);
    console.log(`  counting set, not lazy minting. Re-run before acting: this is`);
    console.log(`  wall clock, and REPS=3 raises confidence on a loaded machine.`);
    process.exitCode = 1;
    return;
  }
  console.log("PERF GATE: PASS");
}

main().catch((e) => { console.error(e); process.exit(1); });
