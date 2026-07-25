---
title: Encoding exact gear optimization as a client-side MILP
module: solver
date: 2026-07-25
last_updated: 2026-07-25
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
  - gated-contribution
  - dominance-pruning
applies_when:
  - "Choose-one-per-slot selection where stats stack by bonus-type with caps and ranked priorities"
  - "Turning a provably-optimal requirement into a client-side (in-browser) exact solve"
  - "Encoding max-of-selected, threshold, or clamp semantics into a linear program"
  - "Folding heterogeneous conditional sources (augments with slot capacity, set bonuses with piece thresholds) into one exact model without combinatorial variant expansion"
---

# Encoding exact gear optimization as a client-side MILP

## Context

The DDO Loadout Optimizer's solver (U6–U8, Milestone 2) had to be **provably optimal** yet run **entirely in the browser** on a static GitHub Pages site. The problem: pick one item per gear slot to maximize a *ranked* list of target stats, where stats obey DDO's stacking rules (different bonus types add; within one type only the highest counts) plus stat caps. This note captures the encoding patterns that made an exact MILP tractable and correct via HiGHS compiled to WebAssembly (`highs-js`), verified by known-answer tests against the real engine (`tests/solver.test.js`).

## Guidance

**1. Dominance-prune before you build the model — but only where the objective is max-aggregation.** For a given target set, drop any per-slot variant beaten on every dimension that can matter (each target's per-bonus-type value, set membership, augment-slot count by color, **and typed Dino-crafting slot count by type**) by a same-slot peer — it can never be in an optimal solution. This collapses a naive ~10⁸ combination space to a tiny model, so the MILP is near-instant (`web/model.js` `dominanceFilter`; measured <100 ms per solve). **The comparison surface must stay a superset of every dimension the objective reads — see the two failure modes below.**

**The soundness argument holds only while every objective is "take the max of what's equipped." The moment an objective COUNTS equipped items, dominance becomes unsound in any multi-pick slot.** DDO set bonuses count pieces: a tier fires at ≥N equipped members. In a cardinality-2 slot (two Rings), equipping *both* rings of a set is a legitimate way to reach the threshold — but if one ring dominates the other on the query targets, dominance prunes it, the second piece vanishes, and the threshold silently becomes unreachable. The result is a confidently-wrong "provably optimal" set (real repro: *Seasons of the Feywild*'s 6-piece tier needing both rings). Fix: skip dominance for set-member variants when `cardinality > 1` (`web/model.js` `dominanceFilter`, the `cardinality` guard). The augment pool is safe from this because augments only feed max-buckets, never a count — but note augment dominance must still be done **within a color**, never across colors (different colors occupy different slots, so a Blue augment can never dominate a Red one).

**The same filter has a second, distinct failure mode: an *incomplete comparison surface*.** The set-threshold case above is an objective-*shape* change (a count) invalidating a sound filter; this one is subtler — the comparator's dimension list silently fell behind the variant model, with the objective shape unchanged. Isle of Dread "Dino crafting" added **blank host variants** (Dinosaur Bone Belt/Boots/…) whose entire worth is a set of typed Dino insert slots (`dino_slots_norm`, e.g. `["Scale","Fang","Claw","Horn"]`) and which carry **no affixes, no sets, no augment colors**. Because `dominates()` didn't read `dino_slots_norm`, a blank was `<=` on every surface it *did* compare, so any affix-bearing item in the same slot dominated it and `dominanceFilter` pruned it before the solve — taking its slot capacity with it, so the 55 Dino inserts had nowhere to go and a Resistance/PRR/MRR solve returned **0**. The unit suite stayed green throughout: `tests/model.test.js` starts from an *already-built* model, downstream of the prune, so a slot-only host lost before the solve was invisible to it — the bug surfaced only in an end-to-end solve against the built dataset. Fix: add a `dino_slots_norm` multiset check mirroring the augment-color one (A must hold ≥ as many slots of each type as B), reusing `countColors` (`web/model.js` `dominates`; regression in `tests/model.test.js`, "an affix item does not dominate a Dino blank"; fixed in PR [#2](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/2)). The same blank-host / `dino_slots_norm` "only reads `affixes[]`" trap also hit the item browser one layer up — see `browse-visibility-for-separate-source-pools.md`.

**2. Bonus-type stacking = a "select-one" group per `(stat, bonus_type)` bucket, NOT a naive max.** For each bucket, add binary `z` vars over the contributing sources with `sum(z) <= 1` and `z_i <= x_i` (the source's item must be equipped). Effective stat = sum over bonus types of `value_i * z_i`. Because the objective maximizes it, the solver selects the single highest *equipped* value per type, and sums across types — exactly the stacking rule (`web/solver.js` `buildProgram` / `encodeStage`).

**2b. Generalize the select-one source into a "gated contribution" so heterogeneous sources share one model.** Milestone 3 added augments and set bonuses to the objective. Rather than a second code path per source type, generalize the `z` var: a contribution is a `(stat, bonus_type, value)` whose `z` is available only when *all* of its `gates` (a list of enabling binaries) are 1 — emit one `z <= gate` per gate. A worn affix has a single gate (its item pick var, identical to before); the new sources add more gates plus their backing structural vars/constraints:
- **Augment** — a placement binary `p`; the augment's stat is a contribution gated by `[p]`; per color, `sum(p of color) <= sum(open_slots_of_color(item) * x_item)` bounds placements by aggregate open capacity on equipped items (KTD2: aggregate per-color capacity, not per-physical-slot identity — reconstruct a concrete slot for display afterward).
- **Set threshold** — a binary `set_active` with the linear indicator `N * set_active - sum(equipped pieces of the set) <= 0` (can only be 1 at ≥N pieces); the tier's stats are contributions gated by `[set_active]`. Under the lexicographic solve this completes a set only when its bonus advances a ranked target — no special-case logic.
- **Crafting add-on (planned)** — the same shape: an option gated by `[x_item, track_choice]`, mutually exclusive within a track. Independent tracks are independent gates, so an item taking a slot AND an augment AND an upgrade is additive vars, **not** a combinatorial variant explosion.

All of them feed the same `(stat, bonus_type)` max-buckets from #2, so cross-source stacking (a worn Enhancement maxed against an augment Enhancement, plus an Insightful summed) is correct for free. Implementation: `web/solver.js` `buildProgram` `extraVars`/`extraConstraints` seam.

**3. A stat cap is a CLAMP, not a ceiling — this is the subtle bug.** A hard constraint `effective_dodge <= cap` does **not** clamp; it makes equipping any item whose dodge exceeds the cap *infeasible*, so the solver drops the item and reports 0. Instead introduce a continuous `d` with `d <= cap` (bound) and `d <= raw` (constraint), and let the objective maximize `d`. Then `d = min(raw, cap)` — a real clamp (`web/solver.js` `encodeStage`, the `d_<stat>` handling).

**4. Lexicographic priority = staged solves with prior objectives locked as equalities, plus a deterministic tie-break.** Solve stage k maximizing target k subject to `effective(target_j) == V_j` for all j<k (the values won in earlier stages). After the last target, run one more stage that minimizes a deterministic key (e.g. `sum (i+1)*x_i`) with all targets locked, so repeated runs return the *same* canonical set (`web/solver.js` `solveLexicographic`).

**5. Client-side HiGHS-WASM.** Vendor `highs.js` + `highs.wasm` (~3.4 MB); init once with `Highs({ locateFile })` (browser global `Module`, or `require` in node); feed a CPLEX **LP-format string** to `highs.solve(lp)`; read `res.Status` (`"Optimal"`), `res.ObjectiveValue`, and `res.Columns[name].Primal`. It runs identically in node, so the same known-answer tests validate browser behavior.

## Why This Matters

The clamp-vs-ceiling distinction (#3) is a silent correctness trap: the naive `effective <= cap` encoding passes casual inspection, produces feasible-looking output, and is *wrong* — it forbids the best item instead of capping its contribution, so a capped target (dodge) with any strong source degrades to 0 and the loadout omits the item. It was caught only by a known-answer test asserting "the dodge item is still equipped." The select-one encoding (#2) is likewise the difference between a solver that respects DDO stacking and one that double-counts same-type bonuses. Getting these two wrong doesn't crash — it produces a confidently-wrong "best-in-slot", the exact failure the tool exists to avoid.

The dominance/threshold interaction (#1) is the same class of trap one layer up: a **pre-filter that is provably correct for one objective shape silently violates optimality once you add an objective of a different shape.** Max-aggregation makes "a dominated same-slot peer can never help" true; a piece-*count* threshold makes it false in multi-pick slots. The lesson generalizes beyond this codebase — any Pareto/dominance reduction encodes assumptions about how the objective consumes the kept set, and adding a counting, threshold, or set-cover objective can invalidate a filter that was sound the day it was written. The Dino-slot bug (guidance #1) is the **second failure mode of the same filter**: not an objective-shape change but an **incomplete comparison surface** — a new *value-carrying dimension* (typed Dino slots) was added to the variant model without being added to `dominates()`, so a slot-only host was wrongly dominated and pruned. Both reduce to one invariant: **the pre-filter's comparison surface must remain a superset of every dimension the objective reads** — re-audit it both when the objective's *shape* changes and when a variant gains a new dimension of value. And note *where* each was caught: the threshold bug by an adversarial review with a runnable repro; the Dino-slot bug only by an end-to-end solve — a dominance/pre-filter defect hides from any unit test that begins from an already-built model, so cover the filter with a full-pipeline solve, not just solver-given-model tests. Both pinned by regressions in `tests/model.test.js` ("keeps a dominated set-member in a multi-pick slot"; "an affix item does not dominate a Dino blank").

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

**Refinements from the Milestone 2 code review (fixed):** two edge bugs — a capped target with *zero* eligible sources reported the cap instead of 0 (the `d <= raw` constraint was skipped when `raw` was empty; now it emits `d <= 0`), and multiple weapon *types* modeled as independent slots so the solver could equip several weapons at once (now all weapon-category variants compete for one main-hand slot, rune-arm separate). Both pinned by known-answer tests.

**Milestone 3 (augments + set bonuses now optimized, PR [#1](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/1)):** the gated-contribution generalization (#2b) folded augments and set bonuses into the objective. Its two-model adversarial review caught the P1 dominance/threshold unsoundness (#1) plus several parser bugs — the most instructive being that reusing a permissive text parser (`affix_parser._parse_value_bearing`) across a new caller silently bypassed its noise/dice/scaling guards and fabricated affixes; routing the new set-bonus parser through the *guarded* `parse_line` entry point fixed it (see `parsing-ddo-wiki-affix-text.md`). **Crafting / gear upgrade paths remain deferred** (need live wiki sourcing) but the gated-contribution shape (#2b, "Crafting add-on") is already designed for them. Older open items from M2 (contributes-display overstatement, null-ML bypass, scaling-formula duplication, `d_<stat>` name fragility) persist.
