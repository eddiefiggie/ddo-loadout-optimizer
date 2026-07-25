---
title: Encoding exact gear optimization as a client-side MILP
module: solver
date: 2026-07-25
problem_type: design_pattern
component: tooling
severity: medium
tags:
  - milp
  - optimization
  - highs-wasm
  - lexicographic
  - stacking
  - ddo
applies_when:
  - "Choose-one-per-slot selection where stats stack by bonus-type with caps and ranked priorities"
  - "Turning a provably-optimal requirement into a client-side (in-browser) exact solve"
  - "Encoding max-of-selected, threshold, or clamp semantics into a linear program"
---

# Encoding exact gear optimization as a client-side MILP

## Context

The DDO Loadout Optimizer's solver (U6–U8, Milestone 2) had to be **provably optimal** yet run **entirely in the browser** on a static GitHub Pages site. The problem: pick one item per gear slot to maximize a *ranked* list of target stats, where stats obey DDO's stacking rules (different bonus types add; within one type only the highest counts) plus stat caps. This note captures the encoding patterns that made an exact MILP tractable and correct via HiGHS compiled to WebAssembly (`highs-js`), verified by known-answer tests against the real engine (`tests/solver.test.js`).

## Guidance

**1. Dominance-prune before you build the model.** For a given target set, drop any per-slot variant beaten on every dimension that can matter (each target's per-bonus-type value, set membership, augment-slot count) by a same-slot peer — it can never be in an optimal solution. This collapses a naive ~10⁸ combination space to a tiny model, so the MILP is near-instant (`web/model.js` `dominanceFilter`; measured <100 ms per solve).

**2. Bonus-type stacking = a "select-one" group per `(stat, bonus_type)` bucket, NOT a naive max.** For each bucket, add binary `z` vars over the contributing sources with `sum(z) <= 1` and `z_i <= x_i` (the source's item must be equipped). Effective stat = sum over bonus types of `value_i * z_i`. Because the objective maximizes it, the solver selects the single highest *equipped* value per type, and sums across types — exactly the stacking rule (`web/solver.js` `buildProgram` / `encodeStage`).

**3. A stat cap is a CLAMP, not a ceiling — this is the subtle bug.** A hard constraint `effective_dodge <= cap` does **not** clamp; it makes equipping any item whose dodge exceeds the cap *infeasible*, so the solver drops the item and reports 0. Instead introduce a continuous `d` with `d <= cap` (bound) and `d <= raw` (constraint), and let the objective maximize `d`. Then `d = min(raw, cap)` — a real clamp (`web/solver.js` `encodeStage`, the `d_<stat>` handling).

**4. Lexicographic priority = staged solves with prior objectives locked as equalities, plus a deterministic tie-break.** Solve stage k maximizing target k subject to `effective(target_j) == V_j` for all j<k (the values won in earlier stages). After the last target, run one more stage that minimizes a deterministic key (e.g. `sum (i+1)*x_i`) with all targets locked, so repeated runs return the *same* canonical set (`web/solver.js` `solveLexicographic`).

**5. Client-side HiGHS-WASM.** Vendor `highs.js` + `highs.wasm` (~3.4 MB); init once with `Highs({ locateFile })` (browser global `Module`, or `require` in node); feed a CPLEX **LP-format string** to `highs.solve(lp)`; read `res.Status` (`"Optimal"`), `res.ObjectiveValue`, and `res.Columns[name].Primal`. It runs identically in node, so the same known-answer tests validate browser behavior.

## Why This Matters

The clamp-vs-ceiling distinction (#3) is a silent correctness trap: the naive `effective <= cap` encoding passes casual inspection, produces feasible-looking output, and is *wrong* — it forbids the best item instead of capping its contribution, so a capped target (dodge) with any strong source degrades to 0 and the loadout omits the item. It was caught only by a known-answer test asserting "the dodge item is still equipped." The select-one encoding (#2) is likewise the difference between a solver that respects DDO stacking and one that double-counts same-type bonuses. Getting these two wrong doesn't crash — it produces a confidently-wrong "best-in-slot", the exact failure the tool exists to avoid.

## When to Apply

Any exact optimization shaped like *choose one option per slot; contributions aggregate by category with per-category caps; objectives are ranked, not weighted*. The patterns are game-agnostic — gear optimizers, config/feature selection under caps, resource assignment with priority tiers.

## Examples

Cap as a clamp (the fix), in LP terms:

```
\ WRONG — forbids the item instead of clamping:
c: 20 z_dodge <= 4          \ infeasible when z_dodge = 1

\ RIGHT — d = min(raw, cap), objective maximizes d:
Maximize
 obj: d_Dodge
Subject To
 cap:  d_Dodge - 20 z_dodge <= 0     \ d <= raw
Bounds
 0 <= d_Dodge <= 4                    \ d <= cap
```

Stacking select-one (only highest of a type counts):

```
\ two items both give Enhancement INT (10 and 6): only one z may be 1
c: z_int_enh_A + z_int_enh_B <= 1
c: z_int_enh_A - x_A <= 0
c: z_int_enh_B - x_B <= 0
\ objective term: 10 z_int_enh_A + 6 z_int_enh_B  -> picks 10, not 16
```

Verified by `tests/solver.test.js` against the real HiGHS engine: same-type does-not-stack, different-type sums, dodge-cap clamps with the item still equipped, lexicographic priority-1-maxed-at-cost-of-priority-2, and cross-run determinism.

**Refinements from the code review (fixed):** two edge bugs in this code were caught and fixed — a capped target with *zero* eligible sources reported the cap instead of 0 (the `d <= raw` constraint was skipped when `raw` was empty; now it emits `d <= 0`), and multiple weapon *types* were modeled as independent slots so the solver could equip several weapons at once (now all weapon-category variants compete for one main-hand slot, rune-arm separate). Both were pinned by known-answer tests. Set-bonus and augment optimization remain deferred (their bonuses are still free text — see `parsing-ddo-wiki-affix-text.md`); the four lower-priority review findings (contributes-display overstatement, null-ML bypass, scaling-formula duplication, `d_<stat>` name fragility) are also open.
