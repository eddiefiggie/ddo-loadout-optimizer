// #348 (U1) — the Utility container's ENCODING GATE. NOT part of the test suite
// (the suite glob is tests/*.test.js): run it by hand and record the numbers in
// the PR, exactly like tests/perf_utility.js.
//
// The container pursues its effects in the player's order (R6). The reference
// realization is one sub-rank stage per effect, which measured 3.94x median /
// 6.93x worst against a 2.0x budget — unaffordable. The candidate realization is
// ONE stage maximizing a weighted sum of the per-effect indicators, with weights
// chosen so a higher-ordered effect outranks every lower-ordered effect combined.
//
// This harness answers the three questions U1 exists to answer:
//
//   1. EQUIVALENCE — does the weighted stage select the same ordered effect set
//      as the sequential reference, on every sentinel-ranking fixture, at every
//      container size up to N?
//   2. N — where does it stop? Weights grow as 2^(k-1), so the container cap is
//      whatever size the encoding still reproduces exactly, minus a margin.
//   3. READABILITY (KTD2) — can the secured set be read off the weighted result
//      by the guarded z-backed read, matching what the reference secured? Every
//      lock and receipt downstream is built on that read, never on the raw u
//      primal, because alternatives run tieBreak:false where an indicator can
//      float up on spare capacity.
//
// GAP TOLERANCE. The shipped solve path calls highs.solve(lp) with NO options, so
// it runs at HiGHS defaults including mip_rel_gap. A weighted objective spans
// 2^0..2^(k-1); at k=20 the default relative gap admits an error far larger than
// the lowest-ordered weight, so the solver may stop on a solution that is wrong
// in exactly the effects the player ranked last. Both encodings here run with the
// gap pinned to 0. The harness ALSO runs the weighted encoding at HiGHS defaults
// to measure how far the unpinned path drifts — that number is the argument for
// pinning it in production, not just in the gate.
//
// Usage:  node tests/encoding_equivalence.js
//         SIZES=4,8,12,16,20 node tests/encoding_equivalence.js
//         FIXTURES=heroic-str-melee,mid-caster node tests/encoding_equivalence.js
"use strict";
const path = require("path");
const fs = require("fs");
const { performance } = require("perf_hooks");
const { buildModel, UTILITY_SENTINEL } = require("../web/model.js");
const { buildProgram, encodeStage, effectiveOf } = require("../web/solver.js");
const { normalizeDataset, buildPickerVocabulary } = require("../web/dataset.js");
const { resolveQuery } = require("./parity/capture_golden.js");

const ROOT = path.join(__dirname, "..");
const DATASET = path.join(ROOT, "web", "data", "items.json");
const FIXTURES = path.join(__dirname, "parity", "fixtures.json");

// #348 (KTD8) — the container's DEFAULT ORDER, read from the SHIPPED constant.
//
// #349 — this was a hardcoded 20-name copy, left here when U1 predated U3's move
// of the constant into web/dataset.js. It silently stopped measuring the thing it
// exists to measure: `DEFAULT_ORDER.slice(0, k)` on a stale 20-name list returns
// 20 names for every k above 20, so a run at SIZES=26 reported "size 26, 17 agree"
// while comparing 20-effect vectors. A gate that can stop checking without failing
// is the exact shape this repo has been bitten by, so the copy is gone: the order
// now comes from the same declaration the app and the solver use, and the run
// header prints its length so a size above it is visible rather than silent.
const { UTILITY_CONTAINER_DEFAULT_ORDER: DEFAULT_ORDER } = require("../web/dataset.js");

// Gap pinned to zero: the whole point of the gate is an EXACT comparison, and a
// relative gap on a weighted objective is precisely the failure mode being tested.
const PINNED = { mip_rel_gap: 0, mip_abs_gap: 0 };

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The guarded, z-backed read (KTD2). An effect counts as secured only when a
 *  contribution in one of its buckets actually fired — never because its own
 *  indicator floated to 1. This mirrors readSolution's utilityReport rule and is
 *  the ONLY presence read this harness trusts on either side of the comparison. */
function securedSet(program, res) {
  const prim = (n) => (res.Columns[n] ? res.Columns[n].Primal : 0);
  const out = new Set();
  for (const [, meta] of program.utilityMeta || []) {
    if (meta.zNames.some((z) => prim(z) > 0.5)) out.add(meta.name);
  }
  return out;
}

/** Raw indicator read — deliberately NOT used for comparison. Kept so the gate can
 *  report how often the two reads disagree, which is the evidence that KTD2's
 *  guarded read is load-bearing rather than defensive boilerplate. */
function floatedSet(program, res, uByName) {
  const prim = (n) => (res.Columns[n] ? res.Columns[n].Primal : 0);
  const out = new Set();
  for (const [name, u] of uByName) if (prim(u) > 0.5) out.add(name);
  return out;
}

/** Run the ranked (non-sentinel) stages, returning the accumulated exact locks.
 *  This is solveLexicographic's loop with the sentinel removed — under #348 the
 *  container is pinned last, so every ranked stat solves before it. */
function rankedLocks(program, highs, ranked, timings) {
  const locks = [];
  for (const stat of ranked) {
    const t0 = performance.now();
    const res = highs.solve(encodeStage(program, { objectiveStat: stat, sense: "max", locks }), PINNED);
    timings.push(performance.now() - t0);
    if (res.Status !== "Optimal") return null;
    const prim = (n) => (res.Columns[n] ? res.Columns[n].Primal : 0);
    locks.push({ stat, value: effectiveOf(program, prim, stat) });
  }
  return locks;
}

/** SEQUENTIAL REFERENCE — one sub-rank stage per container effect, in order.
 *  Effect i is maximized under the ranked locks plus a hard lock on every
 *  higher-ordered effect already secured. This is the ground truth R6 describes. */
function solveSequential(program, highs, container, uByName, locks, timings) {
  const extra = [];
  const secured = [];
  for (const name of container) {
    const u = uByName.get(name);
    if (!u) { secured.push(false); continue; }
    const t0 = performance.now();
    const res = highs.solve(
      encodeStage(program, { objTerms: [{ coef: 1, name: u }], sense: "max", locks, extra }), PINNED);
    timings.push(performance.now() - t0);
    if (res.Status !== "Optimal") return null;
    const got = securedSet(program, res).has(name);
    secured.push(got);
    // Lock it only when it was genuinely secured; an unsecured effect must not
    // make every later stage infeasible.
    if (got) extra.push(`${u} >= 1`);
  }
  return { secured, extra };
}

/** WEIGHTED CANDIDATE — one stage. Weight 2^(k-1-i) makes effect i outrank every
 *  lower-ordered effect combined (2^m > sum of 2^0..2^(m-1)), which is what turns a
 *  single linear objective into strict lexicographic order over the indicators. */
function solveWeighted(program, highs, container, uByName, locks, timings, options) {
  const k = container.length;
  const objTerms = [];
  container.forEach((name, i) => {
    const u = uByName.get(name);
    if (u) objTerms.push({ coef: Math.pow(2, k - 1 - i), name: u });
  });
  if (!objTerms.length) return { secured: container.map(() => false), res: null };
  const t0 = performance.now();
  const res = highs.solve(encodeStage(program, { objTerms, sense: "max", locks }), options);
  timings.push(performance.now() - t0);
  if (res.Status !== "Optimal") return null;
  const got = securedSet(program, res);
  return { secured: container.map((n) => got.has(n)), res };
}

const fmt = (v) => v.map((b) => (b ? "1" : "0")).join("");

async function main() {
  const Highs = require(path.join(ROOT, "web", "vendor", "highs.js"));
  const highs = await Highs({ locateFile: (f) => path.join(ROOT, "web", "vendor", f) });
  const dataset = normalizeDataset(JSON.parse(fs.readFileSync(DATASET, "utf8")));
  const vocab = buildPickerVocabulary(dataset);
  const all = JSON.parse(fs.readFileSync(FIXTURES, "utf8"));

  const only = process.env.FIXTURES ? new Set(process.env.FIXTURES.split(",")) : null;
  const sizes = (process.env.SIZES || "4,8,12,16,20").split(",").map((s) => parseInt(s, 10));

  // The 17 fixtures that rank the sentinel are the equivalence bed. The other six
  // are the invariance control: they must not move at all, which is the sharpest
  // available signal that nothing leaked outside the tier.
  const bed = all.filter((f) => (f.query.targets || []).includes(UTILITY_SENTINEL));
  const control = all.filter((f) => !(f.query.targets || []).includes(UTILITY_SENTINEL));
  const fixtures = (only ? bed.filter((f) => only.has(f.name)) : bed);

  console.log(`#348 U1 — encoding equivalence gate`);
  console.log(`declared order: ${DEFAULT_ORDER.length} names (the shipped constant)`);
  console.log(`bed: ${fixtures.length}/${bed.length} sentinel-ranking fixtures`
    + `  control: ${control.length}  sizes: ${sizes.join(",")}  gap: pinned to 0\n`);

  const rows = [];
  let agree = 0, disagree = 0, firstBreak = null;
  const seqTimes = [], wtTimes = [];
  let floatDisagreements = 0, defaultGapDisagreements = 0;

  for (const fx of fixtures) {
    const { query: resolved } = resolveQuery(fx, vocab);
    const ranked = (resolved.targets || []).filter((t) => t !== UTILITY_SENTINEL);
    // The container is pinned LAST (R1): ranked stats first, sentinel appended.
    const targets = ranked.concat([UTILITY_SENTINEL]);

    for (const k of sizes) {
      if (k > DEFAULT_ORDER.length) {
        throw new Error(`SIZES asked for k=${k} but the declared order holds only `
          + `${DEFAULT_ORDER.length} names — widen UTILITY_CONTAINER_DEFAULT_ORDER first, `
          + "or this run would silently measure the shorter list.");
      }
      const container = DEFAULT_ORDER.slice(0, k);
      const query = Object.assign({}, resolved, { targets });
      const model = buildModel(
        dataset.items, query,
        dataset.dino_inserts, dataset.nearly_complete, dataset.viktranium,
        dataset.seal, dataset.membership_set_defs, dataset.thunder_forged, dataset.green_steel,
        {}, new Set(container),
      );
      const program = buildProgram(model);
      const uByName = new Map();
      for (const [u, meta] of program.utilityMeta || []) uByName.set(meta.name, u);

      const st = [], wt = [];
      const locks = rankedLocks(program, highs, ranked, st);
      if (!locks) { console.log(`  ${fx.name} k=${k}: ranked stages INFEASIBLE — skipped`); continue; }

      const seq = solveSequential(program, highs, container, uByName, locks, st);
      const wtd = solveWeighted(program, highs, container, uByName, locks, wt, PINNED);
      if (!seq || !wtd) { console.log(`  ${fx.name} k=${k}: stage INFEASIBLE — skipped`); continue; }

      const same = fmt(seq.secured) === fmt(wtd.secured);
      if (same) agree++; else {
        disagree++;
        if (!firstBreak) firstBreak = { fixture: fx.name, k, seq: fmt(seq.secured), wt: fmt(wtd.secured) };
      }

      // KTD2 evidence: does the raw indicator read disagree with the guarded one?
      if (wtd.res) {
        const floated = floatedSet(program, wtd.res, uByName);
        const guarded = new Set(container.filter((n, i) => wtd.secured[i]));
        if (floated.size !== guarded.size || [...floated].some((n) => !guarded.has(n))) floatDisagreements++;
      }

      // Unpinned-gap drift: the same weighted stage at HiGHS defaults.
      const dflt = solveWeighted(program, highs, container, uByName, locks, [], undefined);
      if (dflt && fmt(dflt.secured) !== fmt(wtd.secured)) defaultGapDisagreements++;

      seqTimes.push(st.reduce((a, b) => a + b, 0));
      wtTimes.push(wt.reduce((a, b) => a + b, 0));
      rows.push({ fixture: fx.name, k, same, seq: fmt(seq.secured), wt: fmt(wtd.secured),
        seqMs: Math.round(st.reduce((a, b) => a + b, 0)), wtMs: Math.round(wt.reduce((a, b) => a + b, 0)) });
      console.log(`  ${same ? "OK  " : "FAIL"} ${fx.name} k=${k}`
        + `  seq=${fmt(seq.secured)} wt=${fmt(wtd.secured)}`
        + `  ${Math.round(st.reduce((a, b) => a + b, 0))}ms vs ${Math.round(wt.reduce((a, b) => a + b, 0))}ms`);
    }
  }

  const byK = new Map();
  for (const r of rows) {
    if (!byK.has(r.k)) byK.set(r.k, { ok: 0, bad: 0 });
    byK.get(r.k)[r.same ? "ok" : "bad"]++;
  }

  console.log(`\n--- equivalence by container size ---`);
  console.log(`size | agree | disagree`);
  for (const k of [...byK.keys()].sort((a, b) => a - b)) {
    const v = byK.get(k);
    console.log(`${String(k).padStart(4)} | ${String(v.ok).padStart(5)} | ${String(v.bad).padStart(8)}`);
  }

  const largestClean = [...byK.entries()].filter(([, v]) => v.bad === 0).map(([k]) => k).sort((a, b) => a - b).pop();
  console.log(`\n--- verdict ---`);
  console.log(`comparisons        : ${rows.length}  (agree ${agree}, disagree ${disagree})`);
  console.log(`largest clean size : ${largestClean == null ? "none" : largestClean}`);
  if (firstBreak) {
    console.log(`first disagreement : ${firstBreak.fixture} k=${firstBreak.k}`);
    console.log(`                     seq=${firstBreak.seq}`);
    console.log(`                     wt =${firstBreak.wt}`);
  }
  console.log(`guarded-vs-raw read disagreements : ${floatDisagreements}`
    + ` (>0 means KTD2's z-backed read is load-bearing)`);
  console.log(`unpinned-gap drift                : ${defaultGapDisagreements}`
    + ` (>0 means production must pin the gap, not just this gate)`);
  console.log(`sequential median : ${Math.round(median(seqTimes))}ms`);
  console.log(`weighted median   : ${Math.round(median(wtTimes))}ms`);
  const ratio = median(wtTimes) ? median(seqTimes) / median(wtTimes) : 0;
  console.log(`sequential / weighted : ${ratio.toFixed(2)}x cheaper on the weighted path`);

  if (disagree > 0 && largestClean == null) {
    console.log(`\nGATE FAILED — no container size reproduced the reference. Return to the user;`);
    console.log(`the count-then-tiebreak fallback surrenders R6 and is not an implementation-time choice.`);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
