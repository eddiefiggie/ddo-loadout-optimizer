---
module: solver
date: 2026-08-03
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

The optimizer has a golden-solve regression guard — `tests/solver_golden.test.js` — that pins the optimal loadout for **6 endgame fixtures** against `tests/parity/golden.json`. It is the only test that catches *unintended* changes to which items the solver picks.

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

**The habit to adopt:** include `tests/solver_golden.test.js` in the pre-ship JS sweep for any solve-affecting change, e.g.:

```
node tests/solver_golden.test.js tests/solver.test.js tests/model.test.js tests/dataset.test.js tests/results.test.js
```
