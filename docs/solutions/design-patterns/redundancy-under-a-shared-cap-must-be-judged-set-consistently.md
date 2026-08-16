---
title: Judge redundancy under a shared cap on the removal SET, not per-item against the intact total
module: solver
date: 2026-08-15
problem_type: design_pattern
component: tooling
severity: high
tags:
  - solver
  - milp
  - redundancy
  - caps
  - cap-clamping
  - greedy-fixpoint
  - set-consistency
  - load-bearing-guard
  - visibility
  - review-technique
applies_when:
  - "Writing a redundancy/pruning test that asks 'is this contributor needed?' under a shared threshold (cap, floor, budget, quorum)"
  - "The threshold is fed by more than one contributor and contributors can be judged/removed independently"
  - "A prior fix already made the test per-item-correct but the items share the SAME threshold"
  - "Reviewing a plan or PR that adds or edits a cap-clamp / floor-substitution / budget visibility test"
related_components:
  - web/solver.js
  - tests/solver.test.js
---

## Context

PR #327 (closes #322; open/merge-ready as of this writing, not yet merged) tightened `visibleGateSet` in `web/solver.js` — the function `readSolution` uses to decide whether a fired placement is load-bearing enough to report (`every-solver-family-report-needs-a-load-bearing-guard.md` in this directory records the shipped "fired-and-visible" semantics this pattern generalizes). A placement is visible unless every tracked stat it feeds is capped and its contributions are clamped out — i.e. the stat would sit at the same displayed value with or without this placement.

Getting that "would the display be the same without it" test right went wrong twice in one day, at two different aggregation levels, inside the same PR's own iteration — each caught by an adversarial review pass before merge, not by the author's first draft:

**Level 1 — per-contribution vs per-placement (caught at plan doc-review).** The plan's first visibility condition tested one `z` contribution at a time: `raw − z.value < cap`. Counter-example: a single Dino insert gates two `z`'s on the same capped stat (`Melee Power`), worn 12 + z1 5 + z2 4 = raw 21, cap 15. Individually, `21 − 5 = 16 ≥ 15` and `21 − 4 = 17 ≥ 15` — both z's look dispensable, so the whole placement is reported as not load-bearing, even though together they hold the stat at its 15 cap and the placement is entirely responsible. Fix: sum a placement's contributions to a stat and test the sum (`web/solver.js`, `visibleGateSet`, the `pending` map keyed by gate → `Map(stat → sum)`). This is exactly the arm now pinned by `tests/solver.test.js`'s `"#322 guards: two contributions jointly holding a capped stat at cap keep their placement (sum test, R1)"`.

**Level 2 — per-placement vs full raw (caught at code review, adversarial confidence 100, independently corroborated and validated).** PR #327's initial implementation of the sum test (superseded within the same PR by the review fix; the branch squash-merges, so the intermediate state survives only as this quotation) judged each placement's sum against the SAME full, un-adjusted `raw(s)`:

```js
// BEFORE (PR #327's initial implementation) — every gate judged against the full, un-adjusted raw:
for (const [g, sums] of pending) {
  if (visible.has(g)) continue;
  for (const [s, sum] of sums) {
    // Clamped out only if the displayed total survives losing the whole sum.
    if (rawOf(s) - sum < capped[s]) { visible.add(g); break; }
  }
}
```

Counter-example (surfaced in review): worn 12, placement A contributes +5, placement B contributes +4 to the same capped stat (cap 15), raw = 21. Judged independently against the full raw: `21 − 5 = 16 ≥ 15` hides A, and `21 − 4 = 17 ≥ 15` hides B — BOTH are ruled non-load-bearing, even though the displayed capped total of 15 is unreachable from the reported build once both are gone (worn alone is only 12). This is the level-1 bug's shape recurring one level up, and it inverts the guard's own defect class: a guard built to stop the optimizer from *prescribing a useless farm* now *withholds a needed one* — the report claims a build that cannot produce the number it's showing.

Fix (shipped in PR #327, current tree): a greedy fixpoint over gates in deterministic sorted order, each hidden gate deducting its per-stat sums from an adjusted raw before the next gate is judged:

```js
// AFTER (current tree, web/solver.js, visibleGateSet) — greedy fixpoint:
const adjustedRaw = new Map(); // stat -> raw minus contributions of gates already ruled hidden
const adjRawOf = (s) => (adjustedRaw.has(s) ? adjustedRaw.get(s) : rawOf(s));
for (const g of [...pending.keys()].sort()) {
  if (visible.has(g)) continue;
  const sums = pending.get(g);
  let isVisible = false;
  for (const [s, sum] of sums) {
    // Clamped out only if the displayed total survives losing the whole sum.
    if (adjRawOf(s) - sum < capped[s]) { isVisible = true; break; }
  }
  if (isVisible) { visible.add(g); continue; }
  for (const [s, sum] of sums) adjustedRaw.set(s, adjRawOf(s) - sum);
}
```

The invariant this establishes — "raw minus ALL hidden contributions still meets every cap" — holds by construction because each removal decision immediately updates the pool the next decision is judged against. The deterministic sort order also makes *which one of two interchangeable placements survives* stable across runs, which matters for a player-facing report. `tests/solver.test.js`'s `"#322 guards: two SEPARATE placements jointly holding a capped stat cannot mask each other (set-consistent greedy)"` is the executable spec for this level: it builds two separate craft placements on the same capped stat, each individually dispensable against the full raw, and asserts the reported placements' contributions alone still reach the displayed cap.

## Guidance

When you write (or review) any "is this contributor redundant under a shared threshold?" test — cap clamping, credit-floor substitution, budget slack, quorum satisfaction — treat it as a three-part obligation, not a one-line predicate:

1. **State the invariant over the removal SET, not over one removal.** The correctness property is "the total minus every contributor I'm about to drop still clears the threshold" — not "the total minus this one contributor still clears the threshold." Write that sentence down before writing the test; if you can't state it over a set, you haven't found the real invariant yet.
2. **Implement removal decisions that consume prior removal decisions.** A greedy fixpoint in a deterministic order is the cheap general shape: sort the candidates, and each time you rule one hidden/redundant, deduct its contribution from the pool before judging the next. Judging every candidate against the same intact starting total is the tell that the implementation is wrong even when each individual verdict looks locally defensible.
3. **Test with two items individually slack but jointly necessary — at EVERY aggregation level your code has.** This repo needed the adversarial pair twice: once where the "items" were two contributions inside one placement (level 1), and again where the "items" were two separate placements (level 2). A test suite that only checks one level looks complete and is not.

## Why This Matters

A per-item test against a shared, un-adjusted total is silently unsound whenever contributors can be jointly-but-not-individually load-bearing — and a shared cap/floor/budget by definition makes contributors interact through that shared resource. Get it wrong in the "hide a redundant thing" direction and you under-report (the level-1 bug: a real placement drops off the report, understating the build). Get it wrong in the "everyone judged against the intact total" direction and you can hide TOO MUCH at once (the level-2 bug: two placements each individually slack get jointly dropped, and the report now shows a total the reported build cannot produce — the more dangerous failure, because it inverts the guard's purpose from preventing a useless-farm prescription to withholding a needed one). Both bugs are invisible to a test suite that only ever exercises one contributor at a time against one threshold at a time; they require an adversarial fixture, and this PR needed two such fixtures at two different levels before the invariant actually held. The fact that a careful author shipped the level-2 bug immediately after fixing level-1, in the same PR, is itself the evidence this failure mode is easy to reintroduce even when you're actively thinking about it.

## When to Apply

- Writing any redundancy, pruning, or "is this still needed" test where multiple contributors feed the same capped/floored/budgeted/quorum-limited resource.
- Reviewing a plan or PR that adds a visibility/dead-code/redundancy condition phrased as `total - contribution < threshold` (or any of its floor/budget/quorum analogues) — check whether "contribution" is a single item's value or a judged-set's cumulative value, and whether the threshold pool shrinks as prior verdicts are applied.
- Any solver, allocator, or report layer that decides which of several placements/sources to display as load-bearing when they share a capacity constraint.
- **Do not apply** when contributions are independent with no shared threshold — e.g. each contributor has its own private cap, or removal of one item can never change whether another is needed. There the plain per-item test is correct and cheaper; adding a fixpoint there is unneeded complexity with no counter-example to justify it.

## Examples

- `web/solver.js`, function `visibleGateSet` — the greedy fixpoint block (`adjustedRaw` / `adjRawOf`, gates judged in `[...pending.keys()].sort()` order) and the invariant comment directly above the function are the shipped implementation.
- `tests/solver.test.js` — two tests are the executable spec for the two levels: `"#322 guards: two contributions jointly holding a capped stat at cap keep their placement (sum test, R1)"` (level 1, one placement's two contributions) and `"#322 guards: two SEPARATE placements jointly holding a capped stat cannot mask each other (set-consistent greedy)"` (level 2, two placements sharing one cap). Both construct the "individually slack, jointly necessary" counter-example this pattern is named for.
- Plan: `docs/plans/2026-08-15-001-fix-guard-semantics-and-fewer-crafts-axis-plan.md`. PR: #327 — open/merge-ready as of this writing, not yet merged. Follow-ups from the same review: #325 (credit/cap display corners), #326 (read-layer raw-total consolidation — note its consolidation must preserve this pattern's adjusted-raw deduction).

## Related

- `every-solver-family-report-needs-a-load-bearing-guard.md` (this directory) — the catalog/case study of the guard family whose visibility test this pattern got right; its "#322 refined fired to fired-and-VISIBLE" paragraph records the shipped semantics. That doc says *what* counts as load-bearing; this doc is *how to judge it soundly* under a shared cap.
- `best-effort-constraints-need-a-joint-feasibility-pass.md` (this directory) — the closest prior precedent of the same higher-level shape: individual checks prove only individual satisfiability, never joint behavior (there: two floors individually reachable, jointly infeasible; here: two contributors individually removable, jointly load-bearing).
- `lexicographic-redundancy-is-not-a-bug.md` (this directory) — a *different* redundancy question despite the name: item-level redundancy in the tie-break objective, ruled intended behavior. Don't conflate the two when searching "redundancy".
- `../conventions/assert-non-vacuity-for-every-surface-in-a-loop-test.md` — the test-side companion from the same guard lineage: coverage claims need fixtures that actually mint the surface, just as redundancy claims need fixtures that actually construct the joint case.
- `milp-encoding-for-gear-optimization.md` (this directory) — background for the cap/bucket vocabulary (per-stat caps, gated contribution vars) this pattern's examples assume.
