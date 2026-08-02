---
title: Best-effort constraints need a joint-feasibility pass, not per-constraint probing
module: solver
date: 2026-08-02
problem_type: design_pattern
component: tooling
tags:
  - milp
  - constraints
  - lexicographic
  - best-effort
  - floors
---

## Context

The optimizer added optional per-stat **floors** — "give me at least 300 PRR, then
maximize everything else." The product contract is that a floor is *best-effort*: an
unreachable floor never returns an empty result; the solver gets as close as it can and
discloses the shortfall (see [milp-encoding-for-gear-optimization.md](./milp-encoding-for-gear-optimization.md)
#7, which documents that a hard `>= value` constraint makes the whole MILP `Infeasible`).

The obvious implementation probes each floor **in isolation**: solve `max(stat)` alone;
if the achieved value clears the floor, add a `>= floor` lock carried into every stage;
otherwise lock the stat at its achieved max and record a shortfall. This passes the
single-floor tests. It has a trap.

## Guidance

Probing constraints one at a time proves each is *individually* satisfiable — it says
nothing about whether they are satisfiable *together*. Two constraints that each pass in
isolation can compete for the same decision variables and be **jointly infeasible**. So a
best-effort constraint layer over a staged/lexicographic solve needs three steps, not one:

1. **Probe each constraint individually** to set its target value (reachable -> the floor;
   unreachable -> its achieved-in-isolation max, recorded as a shortfall).
2. **Verify the joint set solves.** Assemble *all* the constraint locks and run one
   feasibility solve (in a lexicographic solver, the first priority stage with every lock
   active is exactly this check). If it is `Optimal`, you are done.
3. **Relax on failure, in reverse-priority order.** If the joint solve is not `Optimal`,
   drop the lowest-priority constraint to what is reachable *under the others* (record the
   extra shortfall) and re-check. Repeat until it solves. As a last resort, drop the
   constraint locks entirely rather than let a stage bail.

The safety net that makes "never returns no result" true: the **base problem is always
feasible** — the all-variables-unpicked assignment satisfies every structural constraint
(each slot picks at most its cardinality, each bucket at most one source). So a solve can
only become infeasible through the constraints *you* add. Relax those far enough and
feasibility is guaranteed to return.

## Why This Matters

Without the joint check, the failure is silent until a real user hits it. In this solver,
a PRR floor and an MRR floor are each individually reachable (a defensive item exists for
each), but they compete for the same defensive slots and can't both be met. The naive
per-floor probe passes each, pushes both `>= ` locks, and the first priority stage then
returns non-`Optimal` — `solveLexicographic` bails to `infeasible` and the user is stranded
at an empty result **exactly when they asked for the most**. That directly violates the
best-effort contract, and a single-floor test never catches it.

This bug was caught in plan review before implementation, not in production — the value of
the review was naming "each floor is probed in isolation" as the smell.

## When to Apply

Any **soft / best-effort constraint layer over a staged or lexicographic solver** where
more than one user-set constraint can interact — floors, minimums, "reserve at least N",
budget-style caps that must all hold. The trigger is: constraints are validated
independently but enforced together. If your feasibility check and your enforcement set
are not the same set, you have this gap.

It does **not** apply to a single constraint (nothing to be jointly infeasible with), or to
hard constraints where returning "no result" is the intended contract.

## Examples

Buggy shape — per-floor probe, then enforce all (returns infeasible for competing floors):

```js
for (const fl of floors) {
  const achieved = probeMax(program, highs, fl.stat, []); // isolation only
  fl.value = achieved >= fl.floor ? fl.floor : achieved;
}
locks.push(...floors.map(fl => ({ stat: fl.stat, value: fl.value, floor: true })));
// -> first priority stage can now be Infeasible; solve bails.
```

Correct shape — probe, then joint-verify + reverse-priority relaxation:

```js
// floors sorted highest-priority-first
const jointOk = () => highs.solve(encodeStage(program,
  { objectiveStat: probeStat, sense: "max", locks: floorLocks(floors) })).Status === "Optimal";
for (let i = floors.length - 1; i >= 0 && !jointOk(); i--) {
  // relax the lowest-priority floor to what's reachable under the others
  const others = floors.filter((_, j) => j !== i);
  floors[i].value = probeMax(program, highs, floors[i].stat, floorLocks(others));
}
const useFloors = jointOk() ? floors : []; // last resort: drop rather than bail
```

The regression tests that guard both properties live in `tests/solver.test.js`
(`U2: two jointly-infeasible floors relax in reverse-priority order`, and the reachable /
unreachable single-floor cases). The end-to-end path was also verified in the browser: an
unreachable floor returns an `OPTIMAL` loadout with a "best achievable was N" disclosure,
never an empty result.

## Related

- [milp-encoding-for-gear-optimization.md](./milp-encoding-for-gear-optimization.md) — the
  base MILP encoding; #7 documents why a raw `>= value` constraint makes the solve infeasible.
- [lexicographic-redundancy-is-not-a-bug.md](./lexicographic-redundancy-is-not-a-bug.md) —
  a companion characterization from the same feature: per-stat caps (not a tie-break change)
  are the lever for over-served stats.
