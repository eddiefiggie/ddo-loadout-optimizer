---
title: Every solver family readSolution reports needs its own load-bearing guard
module: solver
date: 2026-08-14
problem_type: design_pattern
component: tooling
severity: high
tags:
  - solver
  - tie-break
  - alternatives
  - load-bearing-guard
  - set-augments
  - reported-family
  - milp
  - floating-variables
applies_when:
  - Adding a new solver-derived family to readSolution that reports based on a placement/indicator variable (e.g. prim(var) > 0.5)
  - The re-solve path runs with tieBreak:false (e.g. alternatives generation), so nothing in the objective minimizes placement/indicator variables
  - HiGHS (or any MILP solver) may set an unconstrained placement variable to 1 opportunistically whenever spare capacity exists, even though that placement is not load-bearing
  - The reported family could steer the player toward useless action (farming, buying, avoiding an item) based on a floated, non-load-bearing placement
related_components:
  - web/solver.js
---

## Context

The optimizer's MILP has two solve paths with different var-minimization guarantees, and `readSolution` serves both.

**Optimum path.** The lexicographic solve runs a final tie-break stage, and `solveConstrained` with `tieBreak: true` runs one too. The tie-break objective explicitly minimizes the discretionary placement var classes (`minVars` in `encodeStage`, `web/solver.js`):

```js
const minVars = [...(program.jokerVars || []), ...(program.memberVars || []), ...(program.setAugVars || [])];
```

On this path a joker/membership/set-augment var is 1 only when a locked constraint forces it — i.e. only when it is load-bearing.

**Alternatives path.** Every generator in `generateAlternatives` calls `solveConstrained(..., tieBreak: false)` to halve solve count (set-activation, rebalance, unranked-stat, fewer-crafts). With `tieBreak: false`, `solveConstrained` returns straight from the phase-1 primal with no tie-break and no settle stage. Nothing minimizes the discretionary vars, so HiGHS may float any of them to 1 for free whenever capacity allows, and a naive `prim(var) > 0.5` report shows phantom placements: useless farm instructions, or phantom suppression of the host item's own set.

This bit three times, once per family, before the pattern was named:

1. **jokerPlaced** (Gem of Many Facets) — guarded by `realShort`: report only when the set is active AND real (non-joker) pieces fall short of the threshold.
2. **membershipPlaced** (Cannith Repurposing / Dino Set-Bonus) — guarded by set activity (`activeSetNames`).
3. **setAugmentsPlaced** (Set Augments, PR #318) — shipped unguarded in the first implementation; the PR's post-implementation multi-agent review caught it ("below-threshold copy floats on alternatives re-solves are no longer reported as placements"). Fixed by counting placed copies per set and reporting only when the count reaches the tier's threshold (`setAugCount >= pieces_required`), because a below-threshold Set Augment copy grants NOTHING in-game.

## Guidance

When adding a new placement-var family whose placements `readSolution` reports:

1. **Define load-bearing for THAT family, and encode it as a report guard.** Ask: under what condition does this placement actually change the player's outcome? Set is active and real pieces fall short (joker); set is active (membership); enough copies to fire the tier (set augments). The guard lives in `readSolution`, next to the family's report loop, so it holds on every solve path.
2. **Never trust a comment claiming the solve only places load-bearing vars — verify which paths minimize the var.** The tie-break comment truthfully says a var "is set to 1 only when a locked constraint forces it" — *on the tie-break path*. Grep for `tieBreak: false` call sites and check whether the new var class appears in `minVars`; even when it does, the alternatives path never runs that objective.
3. **The guard test is deterministic at the report layer even when the float itself is nondeterministic.** You cannot write a test that reliably makes HiGHS float a var — but you can feed `readSolution` a primal where the var is 1 and its load-bearing condition is false, and assert the report omits it. Test the guard, not the float.

### Before/after sketch (the PR #318 fix, compact)

```js
// BEFORE — trusts the primal; correct only on the tie-break path:
const setAugmentsPlaced = [];
for (const [y, meta] of program.setAugMeta || [])
  if (prim(y) > 0.5) setAugmentsPlaced.push(meta);   // floats report as placements

// AFTER — load-bearing guard: a copy counts only if its set's tier actually fires:
const setAugCount = new Map();
for (const [y, meta] of program.setAugMeta || [])
  if (prim(y) > 0.5) setAugCount.set(meta.set, (setAugCount.get(meta.set) || 0) + 1);
for (const [y, meta] of program.setAugMeta || [])
  if (prim(y) > 0.5 && setAugCount.get(meta.set) >= (meta.pieces_required || 3))
    setAugmentsPlaced.push({ ...meta, slot_color: setAugColorByY.get(y) || "Colorless" });
```

## Why This Matters

A phantom placement is player-facing misinformation: it prescribes farming a craft (Cauldron runs, membership picks, Gem swaps) that buys literally nothing, and for set augments it also displays the host's own native set as suppressed for no benefit. Because the float only appears on alternatives re-solves, the optimum path looks perfect in testing — the bug hides in exactly the surface (the Alternatives tab) least covered by golden tests (see `docs/solutions/workflow-issues/golden-solve-guard-missing-from-local-test-sweep.md` on the golden guard's optimum-path scope). Three independent instances of the same class (jokers, memberships, set augments) confirm this is a structural property of the two-path architecture, not a one-off: any future family (Essence Crafting wildcards, new self-seeding primitives) will hit it again unless the guard is designed in from the start.

## When to Apply

- Adding any new binary placement/choice var family to `buildProgram` whose placements `readSolution` reports (crafting picks, wildcard items, membership choices, copy-counted augments).
- Reviewing a PR that adds a `*Placed` array to the `readSolution` return.
- Adding a new alternatives generator or any new `solveConstrained(..., tieBreak: false)` call site — audit which reported var classes it can float.
- Debugging a report that shows a craft/pick only in Alternatives, never in the main result: suspect an unguarded float before suspecting the model.

## Examples

- `web/solver.js` `readSolution` — the three shipped guards side by side: jokerPlaced's `realShort` (set active AND real pieces short), membershipPlaced's `activeSetNames`, and setAugmentsPlaced's `setAugCount >= pieces_required` (PR #318, found by that PR's post-implementation review).
- `web/solver.js` `generateAlternatives` — the `tieBreak: false` call sites where floats arise.
- `web/solver.js` `encodeStage` — `minVars`: the tie-break objective that disciplines these vars on the optimum path only.
- Sibling concerns on the same PR, at other layers: `add-a-solver-preference-as-a-pinned-post-stage.md` (pin granularity on the optimum-path stage chain) and `canonicalization-guards-need-a-trial-reassignment-and-identity-check.md` (projection-layer trial-assignment guard) — three layers, one PR, three standing rules.
