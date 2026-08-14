---
title: Stamp shared test fixtures when production code adds a required field to their data shape
module: tests
date: 2026-08-14
problem_type: convention
component: testing_framework
severity: high
root_cause: missing_workflow_step
resolution_type: test_fix
symptoms:
  - A suite stays fully green across a PR that changed the required shape of the data it constructs
  - Positive assertions in the suite fail loudly (e.g. expected 3 hosted copies, got 0) only after someone notices and starts debugging
  - Absence/threshold assertions (no bonus below N copies, empty when unset) keep passing even though the code path that would prove them is no longer reachable
  - A plan or review predicted a shared fixture helper would need updating, phrased as an inert-suite risk
applies_when:
  - Production code starts requiring a new field on a data shape that test fixtures construct by hand
  - Multiple test suites build their inputs through one shared fixture helper function
  - A change makes a code path fail-closed on a field's presence (absence now means zero/excluded rather than a default)
  - Reviewing whether an existing green suite still proves what it claims after a schema change
  - Writing or reviewing absence-shaped assertions (bonus does not fire, count stays at zero, below-threshold stays excluded)
tags:
  - testing
  - fixtures
  - vacuity
  - schema-evolution
  - fail-closed
  - solver
  - required-field
related_components:
  - tests/solver.test.js
  - web/solver.js
---

**Learning:** When code adds a required field to a data shape, un-stamped fixtures make suites go inert — and absence-shaped assertions go vacuous rather than red.

## Context

PR #318 (merged 2026-08-14) made the solver's set-augment family fail-closed on `def.fits_slots`: a def without the baked color matrix hosts no copies (exclude-until-verified at the solver seam). The gate in `web/solver.js` (~line 454):

```js
// #316 fail-closed: no baked matrix on the def -> the set hosts no copies.
const defFits = (def.fits_slots || []).filter((c) => presentColors.has(c));
if (!defFits.length) continue;
```

The pre-existing U3–U5 set-augment suites in `tests/solver.test.js` build every def through one shared helper, `augSetDef`. The plan-review residual predicted the trap: without stamping the helper, every one of those suites goes inert under the new fail-closed rule — the solver silently skips the whole set-augment family for every fixture def.

The failure splits into two grades:

1. **Presence-shaped assertions** ("3 copies → bonus is 10") fail LOUDLY. Annoying but safe — someone notices.
2. **Absence-shaped assertions** ("2 copies → 0", "no bonus with unequipped host", "≤ N copies placed") pass VACUOUSLY. A solver that places *nothing* satisfies them all — so a regression in the very rules those tests pin becomes invisible while the suite stays green.

The shipped fix stamps the helper — `augSetDef` defaults `fits_slots` to the seven standard colors, mirroring the build, with an override param (`tests/solver.test.js` ~line 2290):

```js
function augSetDef(affixes, pieces = 3, fits) {
  return {
    ...
    // #316 — the baked color matrix the build forwards onto every def; the
    // solver is fail-closed without it, so fixtures mirror the build.
    fits_slots: fits || ["Blue", "Colorless", "Green", "Orange", "Purple", "Red", "Yellow"],
  };
}
```

An absence-shaped test that would have gone vacuous — the 2-copies arm of "U3 set-augment: 3-piece bonus ABSENT with 2 copies, PRESENT (once) with 3":

```js
assert.strictEqual(r2.effective.StatA, 0, "2 copies < 3-piece threshold -> no bonus");
```

Without the stamp, `StatA === 0` because the family never ran — not because the threshold rule held.

And the fail-closed behavior got its own dedicated test so the helper's default can never mask it (`tests/solver.test.js` ~line 2475):

```js
await test("#316 fail-closed: a def without the baked matrix hosts no copies", async () => {
  const def = { "AugSet": augSetDef([["StatA", "Artifact", 10]], 3, []) };
  delete def.AugSet.fits_slots;
  ...
  assert.strictEqual(r.effective.StatA, 0, "no matrix -> no copies -> no bonus");
  assert.strictEqual((r.setAugmentsPlaced || []).length, 0);
});
```

## Guidance

1. **Stamp fixtures in the same change that adds the required field.** Grep the tests for every constructor, helper, and inline literal that builds the shape, and stamp them all — mirroring the build's default — before the fail-closed gate lands. The fixture helper is part of the data contract, not test-local convenience.
2. **Classify each existing assertion as presence-shaped or absence-shaped.** Presence assertions ("feature fires → value X") fail loud when fixtures go stale. Absence assertions ("below threshold → 0", "never more than N") are the risk set: an inert feature satisfies them all. Once, deliberately run the absence tests against an un-stamped fixture and watch them pass vacuously — that proves you know exactly which assertions are exposed.
3. **Give the fail-closed behavior its own dedicated test** (field deleted → feature inert, both the value AND the placement list asserted empty). Otherwise the helper's default means no test in the tree ever exercises the missing-field path, and the fail-closed rule itself can silently regress.
4. **Keep ONE helper as the fixture source** so the stamp lives in one place — the same single-source rule production follows. Twenty inline def literals would have needed twenty stamps and missed some; one `augSetDef` needed one.

## Why This Matters

A fail-closed gate is exclude-until-verified applied at a seam — exactly right for production data that might have join drift. But the same gate turns every un-stamped test fixture into excluded data, and the suite gives no signal that its subject stopped executing. Green absence tests then certify rules the solver never evaluated. The next regression in those rules (threshold arithmetic, y ≤ x host binding, copy caps) ships behind a fully green suite. Vacuous green is strictly worse than red: red gets fixed the same day; vacuous green persists until a player files the bug.

## When to Apply

- Adding a required field to a data shape that an existing feature (and its test fixtures) constructs — especially when the consumer becomes fail-closed on that field.
- Introducing any exclude-until-verified / fail-closed gate over records that tests fabricate via helpers or literals.
- Reviewing a PR that adds a gate: ask "which existing tests build this shape, and which of their assertions are absence-shaped?"
- Auditing suspiciously green suites after a schema change — check whether the feature under test actually ran (assert on a placement/side-effect list, not only the value).

## Examples

- `tests/solver.test.js` — `augSetDef` helper (~2290) with the stamped `fits_slots` default and the "fixtures mirror the build" comment; the U3 2-copies-no-bonus arm (~2304) as the canonical absence-shaped assertion; the dedicated "#316 fail-closed" test (~2475).
- `web/solver.js` — the fail-closed gate (~454–456): `defFits` empty → `continue`.
- PR #318 (merged 2026-08-14); predicted as a plan-review residual before implementation.
- Related standing rules: `docs/solutions/conventions/exclude-until-verified-data-gates.md`; CLAUDE.md "Prove a new test fails against the pre-change tree" (the same vacuity risk, caught at authoring time).
- The test-fixture member of the PR #318 rule family — the four runtime-layer siblings live in `docs/solutions/design-patterns/`: `add-a-solver-preference-as-a-pinned-post-stage.md`, `every-solver-family-report-needs-a-load-bearing-guard.md`, `canonicalization-guards-need-a-trial-reassignment-and-identity-check.md`, `widening-eligibility-must-re-derive-derived-constraints.md`. PR #323 added a second test-fixture-layer sibling with a different mechanism (a per-surface loop over structures the fixture never materialized, not a schema-driven stamp): `docs/solutions/conventions/assert-non-vacuity-for-every-surface-in-a-loop-test.md`.
