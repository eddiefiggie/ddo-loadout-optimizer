---
module: solver
date: 2026-08-03
last_updated: 2026-08-09
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when: shipping any data-pipeline, solver, or scoring change that could alter an optimal loadout
tags:
  - golden-tests
  - solver
  - regression-guard
  - ci-deploy
  - test-suite
related_components:
  - build_dataset.py
  - web/solver.js
  - web/dataset.js
---

# Run (and re-ratify) the golden-solve guard when a fix changes optimal builds

## Context

The optimizer has a golden-solve regression guard — `tests/solver_golden.test.js` — that pins the optimal loadout for a fixed set of fixtures against `tests/parity/golden.json` (6 endgame fixtures at the time of writing; the set has since grown, and the test asserts the exact count so it cannot silently shrink). It is the broadest test of *unintended* changes to which items the solver picks — but not a complete one; see the scope limit below.

The trap: this guard is **not** in the ad-hoc per-file test sweep people run by hand (`node tests/solver.test.js tests/model.test.js tests/browse.test.js tests/results.test.js …`), but CI's "Run JS tests" step **does** run it (and the deploy reruns the full suite before publishing). So a change can pass every local test you ran, merge, and then fail the deploy on the golden guard — leaving a merged fix un-deployed while `main`'s Pages deploy is red.

This happened this session: the bare-`Sheltering` → `Physical + Magical Sheltering` expansion (PR #125) *intentionally* changed two golden fixtures (`endgame-tank-ml34`, `endgame-dex-ml36` — Physical Sheltering rose as newly-scored Sheltering items got picked). The local ad-hoc suite was green, the PR merged, and the deploy then failed on the golden guard until a follow-up (PR #126) re-ratified the baseline.

## Guidance

When a change could alter an optimal solve — any change to the data pipeline (`build_dataset.py`, `data/seed/**`, which regenerates `web/data/items.json`), the solver (`web/solver.js`), the load-time normalizer (`web/dataset.js`), or any scoring / bonus-type / affix-name logic — **run the golden guard locally before shipping**, not just the per-file tests:

```
node tests/solver_golden.test.js
```

When it fails **because the change is an intentional, verified improvement** (not a regression), re-ratify the baseline rather than reverting the fix:

```
node tests/parity/capture_golden.js   # regenerates tests/parity/golden.json
```

Before committing the regenerated `golden.json`, confirm the diff is **contained to the fixtures you expected to change** and that **no priority target regressed** (only lower-priority or tied stats should move). Then commit it. `web/data/items.json` is a gitignored generated artifact, but `tests/parity/golden.json` is committed and IS the ratified baseline.

## Why This Matters

The golden guard exists to catch the exact failure mode the tool is built to prevent — a silent change to which loadout is "optimal." Because it is gated in CI but absent from the hand-run local list, the safety net only fires *after* merge, where a red result is a **stuck deploy** (the site stays on the previous build) rather than a bad deploy. Re-ratifying blindly is the opposite danger: it would launder a real regression into the baseline. So the discipline is two-sided — always run it, and only regenerate after confirming the solve change is a correct improvement.

## The guard can be green while the thing it protects is gone

Running the guard is necessary, not sufficient. Its fixtures solve the **tie-break-enabled optimum path**, so a mechanism that only binds on other solve paths is invisible to it.

A concrete case: a per-bucket lower bound was added to the solver to keep a declared stat credit from dropping out on `tieBreak:false` paths (every Alternatives generator). Fixtures were added specifically to pin the credited solves. **Deleting the constraint left every fixture green** — on the optimum path the stage objective pulls the value up unaided, so nothing the fixtures exercise depends on the constraint at all. The finding is recorded as a `SCOPE LIMIT` comment in `tests/solver_golden.test.js` itself.

The lesson is not to distrust the guard but to know what it covers: it pins *which items get picked on the optimum path*. For a constraint that binds elsewhere, ask "which line would I delete to make this go red?" and delete it. See `docs/solutions/conventions/prove-a-test-fails-against-the-pre-change-tree.md`.

## When to Apply

- Editing `data/seed/**` or `build_dataset.py` (regenerates the dataset).
- Editing `web/solver.js`, `web/model.js`, or `web/dataset.js` normalization.
- Any change to affix scoring, bonus-type equivalence, or set/joker data.
- Any "correctness fix" expected to change what the optimizer picks — that is precisely when the golden diff is expected and must be re-ratified, not when it can be skipped.

## Examples

**What broke it:**
- Local pre-ship run: `node tests/solver.test.js tests/model.test.js tests/browse.test.js tests/results.test.js` → golden guard never ran → merged → CI "Run JS tests" failed on `endgame-tank-ml34` and `endgame-dex-ml36` → Pages deploy red.

**The correct handling (fix-forward):**
- Diffed golden vs current: only `Physical Sheltering` changed (tank 125→126, dex 134→136); no priority target regressed → the change was a correct improvement.
- `node tests/parity/capture_golden.js` → verified the diff was contained to those two fixtures → committed `tests/parity/golden.json` → deploy green.

**The habit to adopt:** include the golden guard in the pre-ship JS sweep for any solve-affecting change — as a **per-file loop**, never as a multi-file `node` invocation:

```bash
for t in tests/*.test.js; do node "$t" || echo "FAIL $t"; done
```

An earlier version of this doc recommended `node tests/solver_golden.test.js tests/solver.test.js tests/model.test.js …`, which is the very trap the doc exists to warn about: **`node a.js b.js` runs only the first file.** That command silently executes the golden guard and nothing else, so the sweep it was supposed to widen actually narrowed. Verified on the current tree — it prints one suite's summary and exits 0. See `docs/solutions/developer-experience/verify-js-tests-with-full-loop-not-tail.md`.
