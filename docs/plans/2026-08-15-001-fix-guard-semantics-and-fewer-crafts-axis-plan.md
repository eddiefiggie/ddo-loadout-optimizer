---
title: Guard Semantics Under Caps and Credits + Fewer-Crafts Axis - Plan
type: fix
date: 2026-08-15
topic: guard-semantics-and-fewer-crafts-axis
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Guard Semantics Under Caps and Credits + Fewer-Crafts Axis - Plan

## Goal Capsule

- **Objective:** Close issues #322 and #321 in one PR. #322: tighten the load-bearing report guards so a fired-but-invisible contribution (clamped out by a stat cap, or merely substituting for a declared credit) no longer reports a placement, with seam tests for both shapes. #321: count Thunder-Forged and Green Steel placements in the fewer-crafts alternatives axis at every counting site.
- **Product authority:** Issues #322 and #321, the standing rule in `docs/solutions/design-patterns/every-solver-family-report-needs-a-load-bearing-guard.md`, and the parent plan `docs/plans/2026-08-14-002-fix-placed-family-report-guards-plan.md`.
- **Execution profile:** Single PR, squash-merged, body carries `Closes #321` and `Closes #322` (closing keywords, not bare refs). Player-facing behavior changes, so the build-stamp trio bumps together.
- **Stop conditions:** A golden diff that cannot be traced to a specific tightened condition; a seam test that cannot be proven red against the pre-change tree; any evidence the credit-floor or cap machinery behaves differently than the Planning Contract describes. Surface, don't work around.

---

## Product Contract

### Summary

Refine the PR #323 fired-contribution guard from contribution-level to outcome-level ("did the player's visible result change?") for the two shapes where those diverge, and bring the fewer-crafts alternatives axis into agreement with the guarded families by counting Thunder-Forged and Green Steel placements.

### Problem Frame

PR #323 guards every `*Placed` family: a placement reports only when a contribution it gates fired (`prim(z) > 0.5`). PR review found two shapes where a fired contribution changes nothing the player sees, so a phantom-shaped recommendation survives the guard:

1. **Capped stats.** The clamp lives entirely in the `d` var (`0 <= d_<stat> <= cap`); z vars for a capped stat carry no objective pressure once raw exceeds the cap, so a craft var and its z can float together on any solve path. Read-back computes `effective = min(cap, raw)`, clamping the contribution out of the visible total — yet the placement reports. The guard's own comment ("a guarded report always agrees with the displayed totals, on every solve path") is false in this shape.
2. **Credit floors.** The declared-credit floor row sums all z vars in the bucket, so a craft z with value at or below the floor can seat instead of the free (gate-less) credit z. The craft then reports as load-bearing while duplicating a bonus the player already declared they hold — a useless farm instruction, the exact defect class the guard family exists to prevent.

Separately, the fewer-crafts alternatives axis counts five craft families (augments, dino, nc, vik, seal) and deliberately excluded `tfPlaced`/`gsPlaced` while they were unguarded floats. Since #319 all families are guard-filtered, so the exclusion's correctness rationale is gone; the product ruling is that a Thunder-Forged tier pick or Green Steel craft is exactly the grind the "fewer crafting steps" trade-off axis exists to let a player avoid. (`computeScale`'s crafts figure counts tf/gs too — along with roll groups and set-membership picks — but it measures model scale, not player grind; the two counters intentionally cover different populations, and this PR does not unify them.)

### Requirements

**Guard semantics (#322)**

- R1. A crafted placement whose fired contributions are all invisible under a stat cap does not report as placed, and no surface — chip, breakdown attribution, or export — shows it. Clamped-out is judged placement-level: a placement's contributions to a capped stat are clamped out only if raw minus their sum still meets the cap. A per-contribution test would hide a placement whose contributions jointly hold the stat at cap.
- R2. A crafted placement whose fired contribution seats in a declared-credit bucket at a value at or below the credit floor does not report as placed.
- R3. A placement with at least one visible fired contribution still reports — the multi-affix rule from the #319 tests (load-bearing means SOME gated z is visible, never ALL) is preserved under both new conditions.
- R4. The stale invariant comment on the guard helper and the load-bearing condition stated in `docs/solutions/design-patterns/every-solver-family-report-needs-a-load-bearing-guard.md` (Guidance step 1 and the Examples catalog) are updated to the outcome-level semantics.

**Fewer-crafts axis (#321)**

- R5. Thunder-Forged and Green Steel placements count as crafting steps at all four counting sites together: `craftVars`, `optCrafts`, `solCrafts` in `web/solver.js`, and `craftCount` in `web/alternatives.js`.
- R6. Roll-group and set-membership placements stay excluded from the axis, with both exclusions recorded as intended in a comment at the counting site.

**Verification**

- R7. A capped-stat seam test and a credited-bucket seam test exist via the exported `readSolution` seam, each with a positive arm and a non-vacuity assertion, and each proven red against the pre-change tree. A counting test pins tf/gs inclusion in the axis.

### Scope Boundaries

- **Out of scope:** any change to which z the solver actually seats (the tighten is read-layer only — solve outcomes, totals, and goldens are expected byte-identical); modelling cap or credit behavior differently in the LP; the `computeScale` crafts readout (already counts tf/gs).
- **Deferred to Follow-Up Work:** none — the research sweep surfaced no new deferral. The roll-group exclusion is a decided non-goal recorded in code (R6), not deferred work.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Count tf/gs in the fewer-crafts axis** (session-settled: user-approved — chosen over recording the exclusion as intended: a TF tier or GS craft is exactly the grind the fewer-crafts trade-off exists to trade away, and post-#319 guarding makes inclusion float-safe).
- KTD2. **Tighten both #322 shapes rather than document them as limits.** The shipped guard's stated invariant (report agrees with displayed totals) is already false under caps, so "document as intended" would mean shipping a code comment that contradicts the code; both tightened conditions are cheap and deterministic at read time; and a fired-but-invisible placement is a phantom-shaped farm instruction, the defect class this guard family exists for.
- KTD3. **Visibility condition.** The stats a z feeds are every s in targetList ∪ keys(cappedStats) for which `bucketCountsFor(bucketKey, s)` is truthy — never the bucket's own stat alone (a clamped cross-add source still raises uncapped sibling totals). A fired z is *credit-substitutable* iff its bucket carries a declared-credit floor and its value does not exceed that floor; those z's are dropped first. Cap clamping is then judged **per placement, per stat**: a placement's surviving fired contributions to a capped stat s are clamped out only if `raw(s) − sum(those contributions, with rawExpr's bucket weighting) ≥ cap(s)`. A placement is load-bearing iff it has a surviving fired contribution feeding some stat that is uncapped or not clamped out under this sum test. Uncapped, uncredited buckets short-circuit to visible, so the eleven-family guard behavior is unchanged outside the two shapes.
- KTD4. **Roll groups and set-membership picks stay out of the fewer-crafts axis.** Roll-group options select which random roll a drop carries, and a chosen set membership is a build-identity choice (which set the item counts toward) rather than a per-item grind step; neither is a crafting step in the axis's player-grind sense, unlike the seven grindable craft families. Both exclusions are recorded in a comment per the issue's "record as intended" arm.
- KTD5. **Export `creditBuckets` on the built program** rather than re-deriving floors from `creditMeta` at read time — it already exists as a local in `buildProgram` and the return-site addition is minimal; re-derivation would duplicate the floor computation the constraint row uses.

### Sources & Research

- Guard helper and its invariant comment: `web/solver.js:1394-1402` (`firedGateSet`); consumption in `readSolution` at 1423-1450; per-family bespoke guards 1455-1501.
- Cap machinery: `cappedStats` built at `web/solver.js:164-174`; clamp encoding 1147-1153, 1168; read-back `effective = min(cap, raw)` at 1408-1414; `rawExpr`/`bucketCountsFor` at 1066-1073 carry the cross-add weighting KTD3 must reuse.
- Credit machinery: gate-less credit z construction 232-253 (`creditBuckets` local at 235-241, not returned); floor row 1049-1053; `buildCreditReport` (1762-1820) already discriminates credit z's from gear z's — the pattern KTD3's credit test mirrors.
- Counting sites: `craftVars`/`optCrafts`/`solCrafts` at `web/solver.js:1964-1982`; `craftCount` at `web/alternatives.js:5-8`, consumed at :38, :45, :59. `tfPlaced`/`gsPlaced` metas share the counted families' shape; only `.length` is used.
- Test seam and pattern to mirror: `readSolution` exported for tests at `web/solver.js:1987-1991`; the #319 guard-test block at `tests/solver.test.js:3951-4096` (`guardModel`, `zsForGate`, `primalOf`, omission+positive arms, real-solve backstop whose `craftHost` already carries `thunder_forged_tiers` and `green_steel_slot`).
- Conventions that bind this work: `docs/solutions/conventions/assert-non-vacuity-for-every-surface-in-a-loop-test.md`, `docs/solutions/conventions/prove-a-test-fails-against-the-pre-change-tree.md` (copy gitignored `web/data/items.json` into the scratch tree first), `docs/solutions/conventions/shared-classic-script-globals-use-var-not-const.md` (if any list is shared across the two classic scripts), `docs/solutions/workflow-issues/golden-solve-guard-missing-from-local-test-sweep.md`.

---

## Implementation Units

### U1. Tighten the guard to visible-z semantics

- **Goal:** Fired-but-invisible contributions stop reporting placements under caps (R1) and credit floors (R2) while the multi-affix rule holds (R3).
- **Requirements:** R1, R2, R3; KTD2, KTD3, KTD5.
- **Dependencies:** none.
- **Files:** `web/solver.js`, `tests/solver.test.js`.
- **Approach:** Add `creditBuckets` to the `buildProgram` return (KTD5). In `readSolution`, replace the flat `firedGateSet` membership with a visible-gate set built per KTD3: drop credit-substitutable z's first, then judge cap clamping per gate (placement), per capped stat, using the sum of that gate's surviving contributions. Compute per-stat raw totals once (they are already computed for `targetList`; extend to capped stats reached only by fired z's). Apply the same visibility predicate inside `breakdownByTarget` (web/solver.js:1295-1377) so attribution never names a hidden placement's source; verify whether `web/projection.js` carries breakdown content into exports and, if so, confirm the filter covers that path too. Rewrite the stale "always agrees with the displayed totals" comment to state the outcome-level condition. The ordinary-augment identity join (`firedAugIds`) and the three bespoke guards (joker/membership/set-augment) inherit visibility through the same set where they consume it; do not fork per-family logic.
- **Execution note:** Prove both new seam tests red against the pre-change tree (scratch export of the base commit with generated data copied in), and mutation-check the tightened condition per the standing-rule doc's recipe.
- **Test scenarios** (synthetic-primal seam tests in the #319 block's style, each with non-vacuity assertions on the minted metas):
  - Capped-stat omission arm: craft var + its z fired, a larger worn z filling the stat past the cap — family array empty and `effective` unchanged by the craft z.
  - Capped-stat positive arm: same model with raw under the cap — placement reports.
  - Multi-affix arm: one craft var gating two z's, one fully clamped and one visible — placement reports (R3).
  - Joint-saturation arm: one craft var gating two z's on the same capped stat, each individually within the clamp margin (`raw − z.value ≥ cap` for both) but jointly holding the stat at cap — placement reports (R1's placement-level sum test).
  - Breakdown arm: for an omitted placement, its source appears in no stat's parts in `breakdownByTarget`.
  - Credited-bucket omission arm: declared credit sharing a bucket with a craft z of value at or below the floor; primal seats the craft z — placement does not report. (Pins defensive behavior: in real solves a below-floor craft z is LP-infeasible as the bucket's sole contributor, so this state is synthetic-only — note that in the test.)
  - Credited-bucket positive arm: craft z value strictly above the floor — placement reports.
  - Existing #319 guard block and the real-solve backstop stay green unmodified.
- **Verification:** All `tests/*.test.js` files green run one per node invocation; `tests/solver_golden.test.js` byte-identical (any diff is a stop condition to triage, not blanket-accept).

### U2. Count Thunder-Forged and Green Steel in the fewer-crafts axis

- **Goal:** The fewer-crafts alternatives axis treats tf/gs placements as crafting steps everywhere it counts (R5) and records the roll-group exclusion (R6).
- **Requirements:** R5, R6; KTD1, KTD4.
- **Dependencies:** U1 (the counted placements must already be visible-guarded so the axis never counts a phantom).
- **Files:** `web/solver.js`, `web/alternatives.js`, `tests/solver.test.js`, `tests/alternatives.test.js`.
- **Approach:** Append `tfMeta`/`gsMeta` keys to `craftVars` and the two `.length` terms to `optCrafts` and `solCrafts` in `generateAlternatives`; add the same two terms to `craftCount` in `web/alternatives.js`. All four sites move in one commit. Add a comment at the counting site recording that roll groups and set-membership picks are excluded as intended (KTD4).
- **Test scenarios:**
  - `craftCount` unit test: synthetic solution carrying one `tfPlaced` and one `gsPlaced` entry counts 2; empty arrays count 0.
  - Real-solve counting test: clone the #319 backstop fixture into a new test (U1 requires the original to stay green unmodified) and give its craft host a genuinely valuable Thunder-Forged tier so the placement is load-bearing; assert `craftCount` reflects it — proving the readSolution-to-count wiring end to end.
  - Existing `analyzeAlternative` fixtures stay green (they are null-safe against the new terms).
- **Verification:** `tests/alternatives.test.js` and `tests/solver.test.js` green; the fewer-crafts axis still only surfaces when `solCrafts < optCrafts`.

### U3. Docs and build stamp

- **Goal:** The standing rule states the shipped semantics (R4) and the deploy is version-visible.
- **Requirements:** R4; repo build-stamp rule.
- **Dependencies:** U1, U2.
- **Files:** `docs/solutions/design-patterns/every-solver-family-report-needs-a-load-bearing-guard.md`, `web/index.html`, `web/app.js`, `README.md`.
- **Approach:** Update the standing-rule doc's Guidance step 1 condition to visible-z (outcome-level) semantics, refresh the Examples catalog's stated condition, and note the two shapes and their seam tests. Bump the build-stamp trio together: `?v=` cache-busts in `web/index.html`, `BUILD` in `web/app.js`, `**Current build:**` in `README.md`.
- **Test expectation:** none beyond `tests/test_build_stamp.py`, which enforces the stamp agreement — doc content changes carry no behavioral tests.
- **Verification:** `python3 tests/run_tests.py` green.

---

## Verification Contract

| Gate | Command | Applies to |
|---|---|---|
| Python suite (includes build-stamp guard) | `python3 tests/run_tests.py` | U1-U3 |
| JS suite, one file per invocation | `for t in tests/*.test.js; do node "$t"; done` | U1, U2 |
| Golden solver check | `node tests/solver_golden.test.js` (runs in the sweep; never skip) | U1 |
| Prove-red | New seam and counting tests fail against the base commit in a scratch export with `web/data/items.json` copied in | U1, U2 |
| Mutation check | Corrupt each tightened condition (drop the cap test, drop the floor comparison) and confirm the matching seam test goes red, then restore | U1 |

## Definition of Done

- R1-R7 all demonstrably satisfied; all five Verification Contract gates green.
- Goldens byte-identical, or any diff traced to a specific condition and deliberately re-ratified with rationale.
- The standing-rule doc and the guard comment state the same condition the code enforces.
- Build-stamp trio bumped together in the same PR.
- PR body carries `Closes #321` and `Closes #322`; squash-merged; no experimental or dead code in the diff.
