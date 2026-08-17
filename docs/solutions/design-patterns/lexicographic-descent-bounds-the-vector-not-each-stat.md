---
title: Shrinking the option pool bounds the priority VECTOR, not each stat — a lower priority can rise
module: solver
date: 2026-08-16
problem_type: design_pattern
component: tooling
severity: medium
tags:
  - milp
  - lexicographic
  - solver
  - invariants
  - monotonicity
  - testing
  - crafting-rung
applies_when:
  - Asserting how a lexicographic solve responds to a narrowed candidate pool (a crafting rung, a blocklist, an ML ceiling, an opt-out)
  - Writing a monotonicity or nesting invariant over solver output across two option pools
  - A per-stat regression assertion is being used as the guard for an exclusion feature
  - Writing user-facing copy that tells a player what a restriction will do to their numbers
---

## The intuition, and why it is wrong

Taking options away can only make things worse. So if a player excludes crafting,
every stat should stay the same or fall — and a test can assert that per stat.

Both halves are false, and the #346 crafting-exclusion ladder shipped a test and a
line of UI copy that assumed them.

## What actually happens

Under strict lexicographic priority each stage locks the previous stages' won values
in as **equalities** before maximizing the next. A smaller option pool that lowers a
**high** priority therefore **relaxes** every later stage's constraint set — the bar
those stages must clear is now lower, so they have more room, and a **lower priority
can genuinely rise.**

Measured on the real dataset (ML15, `style: "thf"`, ranking Melee Power >
Doublestrike > Accuracy > Deadly > Seeker > Armor-Piercing):

| rung | Melee Power | Doublestrike | Accuracy | Deadly | Seeker | Armor-Piercing |
|---|---|---|---|---|---|---|
| everything | 25 | 23 | 23 | 14 | 12 | 17 |
| no-niche-crafting | 25 | 23 | 23 | 14 | **10** | **22** |
| no-solar-lunar | 25 | 23 | 18 | 10 | 10 | 17 |
| printed-only | 25 | 23 | 18 | 10 | 10 | 17 |

Seeker (priority 5) falls 12 -> 10, which frees stage 6, and Armor-Piercing rises
17 -> 22.

For the same reason **chosen placements do not nest either.** The solver re-optimizes
over the smaller pool and may *substitute* a source it never needed before — the same
step adds a Solar Gem the `everything` rung did not place, going from 4 placements
to 5. A "each rung's placements are a subset of the rung above" assertion is testing
a property the feature does not have.

## What IS guaranteed

- **The option pool nests, exactly.** Each rung offers a subset of the rung above.
  This is a model-level property — assert it on `model.augments` and the craft pools
  (`viktranium`, `seal`, `thunderForged`, `greenSteel`, `dinoInserts`,
  `nearlyComplete`, `membershipSetDefs`, `augment_set_defs`) with no solve at all.
- **The target vector never improves lexicographically.** Compare the two priority
  vectors in order; the first position that differs must have *fallen*. Positions
  after it may move either way.
- **Priority 1 alone is monotone.** Stage 1 maximizes over the whole feasible set,
  and a subset cannot hold a larger maximum.

## Guidance

Assert subset-ness on the pool and lexicographic non-improvement on the vector. Never
assert per-stat `<=` across two pools — it is false about the product and will go red
the moment the query is genuinely constrained.

This is not only a testing lesson. Any user-facing sentence of the form "turning this
off can only cost you" is subject to the same property. `web/wizard.js` shipped
exactly that ("Lower rungs mean smaller numbers you can actually reach") and it was
corrected in the same pass — a player who steps down a rung and sees a *bigger*
number after being told that reads the tool as broken.

## How it was found

Not by review of the claim itself. A test passed `weaponStyle: "Two Handed"` — a key
nothing in `web/` reads — so it solved **unconstrained**, where both rungs happen to
return an identical vector and the per-stat assertion could never fail. Correcting the
key to `style: "thf"` made the assertion go red immediately. See
[fixture-shape-must-mirror-the-production-writer.md](../conventions/fixture-shape-must-mirror-the-production-writer.md).

## Related

- `docs/solutions/design-patterns/milp-encoding-for-gear-optimization.md` — §4 describes
  the staged-solve-with-locked-equalities encoding this property falls out of.
- `docs/solutions/design-patterns/lexicographic-redundancy-is-not-a-bug.md` — a different
  counter-intuitive consequence of the same encoding.
- `CLAUDE.md` "Non-goals" — strict lexicographic priority is the only mode, so this
  property is permanent, not an artifact of the current solver.
