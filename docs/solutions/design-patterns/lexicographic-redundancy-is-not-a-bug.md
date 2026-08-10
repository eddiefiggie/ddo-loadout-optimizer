---
title: "Kinetic Lore ×4" redundancy is correct lexicographic output, not a solver bug
module: solver
date: 2026-08-02
last_updated: 2026-08-09
problem_type: design_pattern
component: tooling
severity: low
tags:
  - milp
  - lexicographic
  - caps
  - user-feedback
---

## The report

A tester ran priorities `Impulse, Kinetic Lore, Kinetic Intensity, Intelligence` and
got **Kinetic Lore slotted four times — two of which "provided nothing that wasn't
available on other gear" — and no Kinetic Intensity at all**. It reads like the solver
wastes slots on an already-maxed stat while ignoring a lower priority.

## The finding (characterize-first, U6/KTD6)

We reproduced it against the real HiGHS engine (`tests/solver.test.js`, the two `U6:`
tests). There is **no genuine zero-marginal bug** to fix in the tie-break:

1. **A truly redundant, same-bonus-type duplicate is already dropped.** When a second
   item's Kinetic Lore is the *same* bonus type as one already equipped, it adds nothing
   to that `(stat, bonus_type)` bucket (buckets are max-of-type, not additive). The
   deterministic tie-break (`Minimize Σ (i+1)·x`) then prefers *not* equipping it, so a
   freed slot goes to the next priority. The solver picks the Kinetic Intensity item, not
   the redundant Kinetic Lore one.

2. **Distinct-bonus-type stacking that consumes slots is correct, not redundant.** DDO
   Kinetic Lore comes in several bonus types (Enhancement, Insight, …) that *do* stack.
   Maximizing Kinetic Lore — a higher priority — legitimately equips several distinct-type
   sources across slots, and strict lexicographic order then leaves Kinetic Intensity (a
   lower priority) with only the slots left over. That is the tool doing exactly what the
   ranked priorities asked, even though it "looks" like waste. The tester's "provided
   nothing" is about *marginal player value*, not marginal *objective* value — the extra
   Kinetic Lore really is the max of its priority.

## The lever

The honest fix is **not** a solver change — it is telling the solver "enough Kinetic
Lore." A per-stat **cap** (U1) saturates the Kinetic Lore stage objective, so surplus
slots fall through to Kinetic Intensity. This is verified by the second `U6:` test
(`cap saturates KL; the freed slot now serves KI`).

## Why this matters

Do **not** add a tie-break rule to "drop objective-neutral picks" — the tie-break already
does for genuinely-neutral picks, and a stronger rule would wrongly demote legitimately
stacking distinct-type sources. Point users who want to stop over-investing in a stat at
the per-stat cap, and (later) at auto cap-awareness. The two `U6:` regression tests guard
against a future change silently breaking either property.

## Scope of "the tie-break already does" (added 2026-08-09, #206)

That claim is **item-scoped**, and the qualifier matters. The tie-break minimizes item
picks (`x` vars) plus joker, membership, and set-augment-copy vars — so each of those is
placed only when load-bearing. **Ordinary augment placements were never in that list**, so
for augments the property was not being enforced; it merely happened to hold, because
HiGHS leaves an unconstrained binary at 0.

The ruling's conclusion survives intact, and #206 confirmed it the expensive way. Adding
the placement vars to the tie-break objective *did* eliminate the gap — with zero value
drift — but reshuffled 5 of 11 golden loadouts, one of them equipping two more items to
shed one augment, because vars appended to that list inherit coefficients larger than
every item's. That is this doc's warning coming true, measured.

The gap is now closed by a separate stage that pins the settled loadout and then minimizes
only placements, which cannot demote a genuinely stacking distinct-type source: dropping
one would break a locked target value. See
[add-a-solver-preference-as-a-pinned-post-stage.md](./add-a-solver-preference-as-a-pinned-post-stage.md)
for the pattern and the measurements.
