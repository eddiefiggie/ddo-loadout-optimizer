---
title: Add a new solver preference as a pinned post-stage, not a tie-break term
module: solver
date: 2026-08-09
problem_type: design_pattern
component: tooling
severity: medium
tags:
  - milp
  - lexicographic
  - tie-break
  - highs-wasm
  - augments
  - determinism
  - user-feedback
applies_when:
  - Adding a "prefer fewer X" or "don't recommend useless X" rule to the solver
  - A reported pick looks wasteful but the totals are correct
  - Deciding whether a new preference belongs in the tie-break objective
---

## Context

Issue #206 reported a wasteful recommendation: a `+8` Conjuration augment slotted
alongside a `+13` same-bonus-type craft. Same name, same type, so the bucket takes
the max — the reported total was right, but the player was told to farm and spend
an augment worth nothing while a usable slot was consumed.

The obvious fix is to teach the tie-break to prefer fewer placements. The
tie-break already minimizes item picks, joker vars, member vars, and set-augment
copies (`web/solver.js`, `encodeStage`), so each of those is placed only when
load-bearing. Ordinary augment placement vars were simply missing from that list —
a one-line omission with a one-line fix.

**The one-line fix is wrong, and there was already a standing ruling saying so.**

## Guidance

**Do not add a new term to a shared tie-break objective whose coefficient scale
you do not control. Add the preference as its own stage, after the solution is
settled, with everything else pinned.**

The tie-break minimizes `Σ (i+1)·x` over items, then continues the coefficient
sequence for the other var classes. Any var appended to that list therefore gets a
coefficient **larger than every item's**, which makes "avoid one of these" outrank
"keep the item set small". That is not a tuning detail — it silently changes what
the tie-break optimizes for every query.

Measured, adding placement vars to that objective:

| Effect | Result |
|---|---|
| Target values (`perTarget`, `effective`) | **identical** in all 11 golden fixtures |
| Loadouts | **5 of 11 changed** |
| Worst case | one fixture equipped **two more items to shed one augment** |

Same score, different gear. Every saved build re-solves to different items for the
same numbers. That churn is a real user-facing cost, and it was being paid for a
defect that has never actually been observed.

The pinned post-stage has none of that. Pin every structural pick at the value the
tie-break chose — items, jokers, memberships, crafts — keep the target locks, and
minimize only the new preference:

```js
// after the tie-break solve, before reading the solution
const pin = [];
for (const xv of program.xVars) pin.push(`${xv.name} = ${at(xv.name) > 0.5 ? 1 : 0}`);
for (const v of [...jokerVars, ...memberVars, ...setAugVars]) {
  pin.push(`${v} = ${at(v) > 0.5 ? 1 : 0}`);
}
const res = highs.solve(encodeStage(program, {
  sense: "min",
  objTerms: placeVars.map((v) => ({ coef: 1, name: v })),
  locks,          // every target value still locked
  extra: pin,     // the whole loadout fixed
}));
```

Result: **0 fixtures with value drift, 0 with loadout change.** Items and totals
are identical by construction; the only thing that can move is the thing the new
preference is about. Cost is one extra MILP stage — 399ms -> 414ms mean across the
fixtures (+3.8%).

## Why This Matters

**Correctness by construction beats correctness by measurement.** The tie-break
version also produced zero value drift — the locks guarantee that much. What it
could not guarantee was that nothing *else* moved, and something else did. Pinning
the settled solution makes the blast radius provable instead of empirical: there is
no other free variable left to move.

**It also protects the existing ruling rather than overriding it.**
`lexicographic-redundancy-is-not-a-bug.md` warns: *"Do not add a tie-break rule to
'drop objective-neutral picks' — the tie-break already does for genuinely-neutral
picks, and a stronger rule would wrongly demote legitimately stacking distinct-type
sources."* The churn measured above is that warning coming true; reading the ruling
first would have skipped the whole detour.

**One scope correction to that ruling.** Its "the tie-break already does" is true
for **items** — `x` vars are in the minimization — and was **not** true for
**augment placements**, which were absent from it. The ruling's conclusion holds
(don't reach for a tie-break rule); its premise was item-scoped. A pinned post-stage
satisfies both: distinct-type sources that genuinely stack cannot be demoted,
because dropping one would break a locked target value and the stage would go
infeasible.

## When to Apply

Reach for a pinned post-stage when **all** of these hold:

- The preference is about *which of several equally-scoring solutions* to return,
  not about what scores well.
- The existing tie-break's coefficients are structural (positional, continuing
  sequences) rather than semantic, so a new term's weight is an accident.
- You can name what must not move, and pin it.

Stay in the tie-break when the preference genuinely belongs to the same ordering
the tie-break already expresses — for example, adding a new var class that should
rank alongside items by the same positional logic.

Do **not** reach for either when the pick is only *marginally* useless to the
player but genuinely maximal for the objective. That is the `Kinetic Lore ×4` case,
and its lever is a per-stat cap, not a solver rule.

## Examples

**Before — the tempting one-liner.** One new entry in the shared list:

```js
const minVars = [...jokerVars, ...memberVars, ...setAugVars, ...placeVars];
```

Zero value drift, 5 of 11 loadouts reshuffled, one equipping two more items to
shed one augment.

**After — its own stage.** Loadout pinned, then placements minimized. Zero drift,
zero churn, +3.8% solve time.

**Regression tests need a discriminator.** `tests/no-op-augments.test.js` pins
three cases, and the second exists to stop the first passing vacuously:

1. A `+8` augment under a same-type `+13` source: total is 13 (not 21), and the
   augment is **not** recommended.
2. A different-type `+4` augment: total is 17, and it **is** recommended — without
   this, case 1 would also pass against a solver that had stopped placing augments
   entirely.
3. Two same-type augments: only the winner is placed.

**State honestly what the change did.** These tests pass against the pre-change
tree, and the test file says so in its header. HiGHS already left the unconstrained
placement binary at 0, so nothing observable changed; a sweep of all golden
fixtures plus the reporter's own priority list found zero no-op placements. What
changed is that the model now *decides* it instead of inheriting it from branch
order. A doc that claimed a user-visible fix here would be wrong.
