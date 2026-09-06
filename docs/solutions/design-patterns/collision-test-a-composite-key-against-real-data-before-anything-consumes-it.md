---
title: "Collision-test a composite key against real data before anything consumes it"
module: pipeline
date: 2026-09-05
problem_type: design_pattern
component: dataset
severity: high
tags:
  - identity
  - composite-key
  - blocklist
  - crafted-options
  - silent-failure
applies_when:
  - Designing a composite key for rows that carry no id of their own
  - Adopting an identity scheme a plan or a previous PR settled on paper
  - Any gate that removes "every row matching this handle"
related_components:
  - src/craft_identity.py
  - web/model.js
---

# Collision-test a composite key against real data before anything consumes it

## What happened

#270 needed a handle for crafted options, which carry no `variant_id`. The
design was settled carefully in a prior plan and restated on the issue:

```
craft:<pool>:<pool key>:<option>
```

with each pool's discriminator named explicitly — `seal_type`,
`(slot_type, category)`, `tier`, `(dino_type, category)`, `category`, `menu`.
It reads as complete, and it was written by someone looking at the data.

Measured against the built dataset before writing the gate, it produced **12
duplicate keys** — 8 in `viktranium`, 4 in `dino_inserts`.

Every collision was a **quarterstaff variant**: the same option name, the same
slot and category, distinguished only by a `quarterstaff` boolean — and the
quarterstaff row carries *extra* affixes (Universal Spell Lore and Universal
Spell Power on top of the shared Spell Focus set).

## Why a duplicate key is worse than a missing one

A missing key fails loudly: the gate cannot find the row, nothing is removed,
and the player sees their block ignored — annoying, and immediately reportable.

A **shared** key fails silently and in the player's favour-shaped direction:
blocking `Iridiscent Fang` also removes the quarterstaff option that grants
strictly more. The solve is worse, the disclosure truthfully reports "an option
was withheld", and nothing anywhere says a second option went with it. The
player asked for one thing and got two, with the evidence of the second nowhere
on screen.

That asymmetry is why this check belongs *before* the consumer exists, not after
someone reports a bad build.

## The rule

**A composite key is a claim that its parts uniquely locate a row. Assert it
against the shipped data, in the build, before anything reads it.**

Concretely, in `src/craft_identity.py`:

- `stamp()` returns `{stamped, distinct, by_pool}` and the build **raises** when
  those two numbers disagree, naming the fix (widen `POOL_KEY`).
- The report is *published as metadata*, not merely asserted, because a later
  upstream refresh that renames an option into a collision is a **data** event —
  as a number it is visible; as a failing test alone it says nothing about how
  much of the pool moved.
- `tests/test_craft_identity.py` asserts uniqueness across all 812 rows, and
  separately asserts that the naive quarterstaff-blind key **still collides on
  exactly 12** — so the discriminator is proven to earn its place rather than
  merely being present, per
  `prove-a-guard-fails-before-trusting-it.md`.

## The generalisable half

A settled design is evidence about intent, not about data. The discriminators
named on #270 were right about what *distinguishes an option conceptually*; they
were wrong about what distinguishes a **row**, because one pool carries a
variant axis nobody thought of as identity. That gap is invisible to review and
obvious to a `Counter`.

Same shape as the population rule in `AGENTS.md` ("a count is a claim about a
population — look the population up"): here, a key is a claim about uniqueness,
and the population will tell you in one line whether the claim holds.
