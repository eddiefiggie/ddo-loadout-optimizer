---
title: "Carrying a lexicographic stage's result forward as a COUNT lets later stages substitute freely"
module: solver
date: 2026-08-18
problem_type: design_pattern
component: tooling
severity: high
tags:
  - milp
  - lexicographic
  - solver
  - invariants
  - locks
  - utility-tier
  - alternatives
applies_when:
  - A lexicographic stage's achieved result is locked into every solve that follows it
  - The locked quantity is an aggregate (a count, a sum, a total) over several indicator variables
  - The stage's members are distinguishable to the player — named effects, chosen sets, specific items
  - Adding an ORDER or a preference to a stage whose result was previously locked by cardinality
  - Reviewing a `>= N` constraint threaded into a tie-break, a settle stage, or alternatives generation
related_components:
  - web/solver.js
  - web/alternatives.js
---

## Context

The Utility tier (#91) solved a stage that maximized the number of distinct presence
effects on the loadout, then pushed its achieved result into every solve that came
after — the tie-break, both settle stages, the colorless post-stage, and the generic
Alternatives families. It carried that result as **one aggregate constraint**:

```
Σ u_e >= count
```

That is a correct statement of "do not end up with fewer effects than the stage
found". It is not a statement of "keep the effects the stage found", and while every
effect was worth exactly 1 the difference was invisible: one effect was as good as
another, so a swap changed nothing a player could see.

The moment the tier gained an **order** (#348), the difference became the whole
feature. A count floor is satisfied by any equal-size set, so a later stage could
trade the player's first-choice effect for a lower-ranked one and still satisfy the
lock. Reproduced on a two-slot synthetic model before it was fixed: the stage
secured `{Blunt Trauma, Ghost Touch}` and the returned loadout carried
`{Feather Falling, Ghost Touch}`.

## Guidance

**Lock the SET, not its cardinality.** Emit one constraint per member the stage
actually achieved:

```
u_e >= 1        (for each secured effect e)
```

instead of one constraint over their sum. This is the same constraint class and the
same threading sites; only the bodies change. It is strictly stronger, and it cannot
make a later stage infeasible, because the incumbent solution already satisfies every
one of them.

**Source the set from the guarded report, never from the raw indicator primal.**
An indicator is only trustworthy where something pushes it down. On any path that
runs `tieBreak:false` — all of alternatives generation — nothing minimizes an
unconstrained indicator, and the solver may float one to 1 on spare capacity. Read
the members from the same z-backed, guarded predicate the receipts use (a
contribution in that member's buckets actually fired). See
`every-solver-family-report-needs-a-load-bearing-guard.md` for that rule's own
falsification.

**A per-member lock also gives you a prefix to slice.** Once the members are
individually locked, an intentional relaxation becomes "lock the first N, free the
tail" — which is how #348 expressed "an alternative may give up low-priority
effects but never a high-priority one". A count floor cannot express that at all; it
can only say *how many* may go, never *which*.

## Why This Matters

The aggregate lock is not wrong when the members are genuinely interchangeable — it
is a correct encoding of an indifference that really exists. The failure mode is that
**the indifference expires quietly**. Nothing in the constraint records the
assumption, so when a later feature makes the members distinguishable, the lock keeps
compiling, keeps solving, and starts silently substituting.

That is also why it survived review for a whole feature cycle: with every effect
worth 1, no test could tell a substitution from a no-op, and no player could either.
The bug was latent from the day the count lock shipped and became reachable only when
ordering landed.

## When to Apply

Whenever a solve carries a stage's achievement forward, ask what the constraint
actually pins. If the answer is "how many" and the members have names the player
would recognize, the encoding is one feature away from substituting them.

The tell to grep for: a `>=` constraint whose left side is a sum over indicator
variables, threaded into stages that run after the one that produced it.

## Examples

Before — one aggregate body, satisfied by any equal-size set:

```js
let count = 0;
for (const [, meta] of program.utilityMeta) {
  if (meta.zNames.some((z) => uprim(z) > 0.5)) count++;
}
if (count > 0) utilityExtra.push(`${program.utilityVars.join(" + ")} >= ${count}`);
```

After — one body per achieved member, read through the guarded predicate:

```js
for (const o of orderedVars) {
  const meta = program.utilityMeta.get(o.u);
  if (meta && meta.zNames.some((z) => uprim(z) > 0.5)) {
    secured.push(o.name);
    utilityExtra.push(`${o.u} >= 1`);   // the SET, not its size
  }
}
```

The regression test asserts set preservation rather than a hardcoded set — whatever
the stage secured must survive the tie-break and both settle stages — and was proven
to fail against the pre-change tree before the fix landed
(`prove-a-test-fails-against-the-pre-change-tree.md`).

Shipped in #348 U2. The four golden fixtures that moved kept `perTarget` and
`effective` identical with unchanged slot counts: only which item filled a slot
changed, which is the lock holding the secured effects in place.
