---
title: A solver-auto legality constraint needs an escape hatch when user pins force a violation
module: solver
date: 2026-08-02
problem_type: design_pattern
component: tooling
severity: high
applies_when:
  - "The solver auto-adds a hard constraint to encode an equip/legality rule (a mutex, an exactly-one, an at-most-one)"
  - "A user can force decision variables ON via pins that emit `x = 1` bodies"
  - "Two individually-legal pins can jointly violate the auto-added rule"
tags:
  - milp
  - constraints
  - pinning
  - user-intent
  - feasibility
  - solver
  - mutex
---

# A solver-auto legality constraint needs an escape hatch when user pins force a violation

## Context

The optimizer added a **hand mutex** (R1/R3, PR #113): a two-handed main-hand weapon
(two-handed melee, a bow, or an unclassifiable untyped Dino host) and any off-hand item
are mutually exclusive — a two-handed weapon occupies both hands. It is emitted as a
solve-time inequality in `web/solver.js` `buildProgram`:

```
Σ(both-hands main pick-vars) + Σ(off-hand pick-vars) <= 1
```

The first cut reasoned: *an inequality `<= 1` is always satisfiable at zero (pick neither),
unlike the Artifact `= 1`, so no feasibility guard is needed.* That reasoning is true for
the **solver's own free picks** — and it is exactly the trap. It ignores **pins**.

A user can force a pick var ON. `slotConstraintBodies` emits one `x = 1` per pinned variant
present in the slot pool (`web/solver.js`, in `slotConstraintBodies` — `bodies.push(\`${xv.name} = 1\`)`).
So when a user pins a two-handed weapon to Main Hand **and** pins any off-hand item, the
mutex sum is forced to `1 + 1 = 2`, the constraint reads `2 <= 1`, the first lexicographic
priority stage returns non-`Optimal`, and `solveLexicographic` bails to
`{ status: "infeasible" }` (`web/solver.js:1015`). The user gets **no loadout at all** —
on exactly the tank + pinned-shield workflow the mutex was built to serve.

`reconcilePinLegality` cannot catch this: each pin is *individually* legal (a lone
greatsword is a legal main hand; a lone shield is a legal off-hand), so neither is dropped.
The only pre-existing guard was `dualPinMutexConflict` in `web/wizard.js` — a **non-blocking**
advisory the user can freely ignore before solving.

## Guidance

**When the solver auto-adds a hard constraint to encode a legality rule, and user pins can
force the decision variables that constraint governs, the constraint needs a feasibility
escape hatch: detect when the pins already force a violation and relax (omit) the
auto-constraint, honoring the user's explicit — illegal, but warned — pins rather than
returning nothing.**

This is not the same move as relaxing a *best-effort* target
([best-effort-constraints-need-a-joint-feasibility-pass.md](./best-effort-constraints-need-a-joint-feasibility-pass.md)
relaxes soft floors the solver itself probes). Here the constraint is a **hard legality
rule**, and the thing that overrides it is an **explicit user pin**. The resolution is to
produce a deliberately illegal-but-requested build (a two-handed weapon *and* an off-hand
equipped together), the same way the Artifact `= 1` constraint already yields to two pinned
Artifacts.

The escape hatch already existed one constraint over, for the Artifact "exactly one"
(`web/solver.js:196`): `if (pinnedOnArtifacts <= 1 && arts.some(...notForcedToZero))` — the
`= 1` is asserted **only** when the user has not force-pinned two-or-more Artifacts on. The
hand mutex now mirrors it (`web/solver.js:349`): emit `Σ <= 1` **only** when the conflict is
not already forced by a pinned both-hands main *and* a pinned off-hand:

```javascript
// pinnedHandIds: variant_ids the user pinned into Main/Off Hand this solve.
let pinnedBothHandsMain = false;
let pinnedOffHand = false;
for (const xv of xVars) {
  if (xv.slot === "Main Hand" && _isBothHandsWeapon(xv.variant)) {
    bothHandsMainVars.push(xv.name);
    if (isPinned(xv)) pinnedBothHandsMain = true;
  } else if (xv.slot === "Off Hand") {
    offHandVars.push(xv.name);
    if (isPinned(xv)) pinnedOffHand = true;
  }
}
if (bothHandsMainVars.length && offHandVars.length && !(pinnedBothHandsMain && pinnedOffHand)) {
  extraConstraints.push(`${[...bothHandsMainVars, ...offHandVars].join(" + ")} <= 1`);
}
```

The user is still told the pins conflict, through the existing `dualPinMutexConflict`
wizard advisory — the relaxation changes what the *solver* returns, not what the *UI*
discloses.

## Why This Matters

The failure is the worst kind: silent, and triggered by the tool's own headline feature.
The whole point of the hand mutex + pinning batch was tank builds with a pinned shield; a
user who also pins a two-handed weapon is expressing two contradictory hard constraints, and
"return no build" strands them with zero feedback beyond an advisory they already dismissed.
An `<= 1` inequality *looks* unconditionally safe — that is precisely why the pin-forced
`= 1` interaction slips past review. Two reviewers split on this exact point: a correctness
pass verified the *unpinned* case (satisfiable at zero) and signed off; only an adversarial
pass that traced the *pinned* path found the `2 <= 1` bail.

The general trap: **`<= k` and `= k` constraints are only "always satisfiable" for variables
the solver is free to choose. Any variable a user can pin to `1` removes that freedom, and a
hard constraint over pinned variables can become infeasible.** Every auto-added legality
constraint that governs pinnable slots needs the same audit the Artifact `= 1` got.

## When to Apply

- Any solver-auto hard constraint (`<= 1` mutex, `= 1` exactly-one, at-most-one per group)
  whose variables include slots the user can **pin**.
- Whenever adding a new equip-legality rule to `buildProgram`: ask "what happens if the user
  pins both sides of this?" before assuming an inequality is safe.
- Any constraint layer where `reconcilePinLegality`-style per-item checks pass but a *pair*
  of individually-legal choices jointly violates a rule — per-item legality is necessary but
  not sufficient (cf. [best-effort-constraints-need-a-joint-feasibility-pass.md](./best-effort-constraints-need-a-joint-feasibility-pass.md),
  the same "individually legal ≠ jointly feasible" root cause for soft floors).

Related: this *honors* the conflicting pins (deliberately illegal build), which is the
opposite resolution from
[suppress-dont-erase-user-constraints-on-transient-invalidity.md](./suppress-dont-erase-user-constraints-on-transient-invalidity.md)
— there a *transiently* illegal pin is suppressed-but-kept; here a *mutually* conflicting
pair of pins is kept and honored. Choose per intent: an unsatisfiable-with-current-config
pin is suppressed; two explicit pins the user set against each other are honored with a
warning. See also
[milp-encoding-for-gear-optimization.md](./milp-encoding-for-gear-optimization.md) #7 (a
hard `>=`/`=` makes the whole MILP `Infeasible`) — the reason the base problem must stay
feasible and the constraints *you* add are the only source of infeasibility.

## Prevention

A regression test that pins **both** sides and asserts the solve stays feasible — the
unpinned mutex tests never exercise the pin-forced path
(`tests/solver.test.js`, "R1/R3 feasibility: conflicting hand pins ... relax the mutex, not
no-build"):

```javascript
const model = {
  targets: ["Strength", "Constitution"],
  worn: [slot("Main Hand", [twoH]), slot("Off Hand", [shield])],
  query: { slotConstraints: {
    "Main Hand": { type: "pin", variant_id: "GS" },
    "Off Hand":  { type: "pin", variant_id: "Shield" } } },
};
const res = await S.solveLexicographic(model, highs);
assert.notStrictEqual(res.status, "infeasible", "conflicting hand pins must not bail the whole solve");
const chosen = (res.chosen || []).map((c) => c.variant.variant_id);
assert.ok(chosen.includes("GS") && chosen.includes("Shield"), "both force-pinned hands are honored");
```

When you add any auto-constraint over pinnable slots, add its pin-both-sides test alongside
the ordinary "the rule fires" test — the feasibility escape hatch is invisible without it.

## Related

- [`where-a-per-item-gate-may-live-in-the-solver.md`](where-a-per-item-gate-may-live-in-the-solver.md)
  — the same audit extended from **constraints** to **gates**. Note the two invert on the same
  function: here `reconcilePinLegality` catches too little (two individually-legal pins), there it
  catches too much (it drops any pin whose gate is non-null). It also supplies a third case for the
  suppress-vs-honor decision below — a pin that is legal per-variant but wrong for the slot it was
  placed in.
- [`suppress-dont-erase-user-constraints-on-transient-invalidity.md`](suppress-dont-erase-user-constraints-on-transient-invalidity.md)
  — the reconciliation contract this escape hatch operates alongside.
