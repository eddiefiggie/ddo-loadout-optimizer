---
title: "A single-pick option pool is judged by option→record cardinality, not by record shape"
module: build-pipeline
date: 2026-08-31
last_updated: 2026-08-31
problem_type: design-pattern
component: crafting-pools
severity: high
tags:
  - ddo
  - choice-slot
  - crafting
  - build-gate
  - integrity-gate
  - fan-out
  - container-registry
  - provenance
applies_when:
  - "Adding a crafting option pool the solver picks at most one record from"
  - "Adding an expansion pass (umbrella, spell focus, split shard) that runs over a pool"
  - "A pool's records are built from an upstream menu whose key does not name the crafting system"
  - "A pool has options but no item carries its host marker, so nothing reaches a solve"
---

# A single-pick option pool is judged by option→record cardinality, not by record shape

## Context

A **choice slot** admits at most one record from its pool: one Green Steel effect per host,
one Viktranium augment per typed slot, one Essence craft per menu. That is the whole premise
of the container, and it is what makes how the pool *stores* its options load-bearing.

If a pool keeps one record per **affix**, then a single craftable option granting three
things becomes three mutually exclusive records — and the slot, taking one, delivers one
third of the effect. The player is offered a part of a thing the game gives whole.

This is not hypothetical. It shipped in Viktranium: a craft granting seven spell schools
delivered exactly one, because two expansion passes had fanned one option into seven records
and the slot could hold one of them.

## The mistake worth naming

The first cut of the gate modelled the defect as **"FLAT shape plus a declared expansion
pass"**. That is one way the defect arises, not the defect itself, and modelling it that way
missed two real failures:

- **A fan-out wearing ATOMIC clothing.** Two halves of a split option, each wrapped in a
  one-element `affixes` list, satisfy every structural test — the declared-ATOMIC check was
  `"affixes" in rec`, and a one-element list satisfies it.
- **Splits at construction with no expansion pass at all.** Green Steel and Thunder-Forged
  each split multi-affix options where they were built, declared no pass, and were both
  certified safe.

**A container that turns one source option into two records has already shipped the bug** —
whatever shape those records wear, whether or not a pass is declared, and whether the split
happened in a pass or at construction.

## The pattern

Judge the **count**, against what the source offered:

- **FLAT** — one record per affix; the stat and bonus type sit on the record.
  Safe only while every source option is single-affix, so `len(records) == n_source_options`
  **exactly**.
- **ATOMIC** — one record per craftable option, carrying its own `affixes` list.
  An option may be *dropped* (nothing rankable in it) but never *split*, so
  `len(records) <= n_source_options`.

Each builder reports its own source-option count alongside its records, and the gate
**refuses to judge a container whose builder reported none** — so a new pool cannot arrive
countless and therefore unjudged.

Shape survives as corroboration, because a declaration drifts from the code it describes: a
container declared FLAT whose records carry `affixes` (or ATOMIC whose records do not) fails,
so the registry cannot quietly describe a container that has changed. But shape is the weaker
signal and must never be the only one.

## Three things the count does not catch

**1. A pool pointing at another system's recipes.** The upstream menu keys are generic —
`T1 (Weapon)`, `T2 (Equipment)` — so nothing in the data says which crafting system a menu
belongs to, and every mapping from a menu key to a named system is an inference by whoever
wrote the constant. One such inference was wrong for months: the `thunder_forged` container
held Legendary Green Steel *weapon* recipes, because `T*(Weapon)` was assumed to mean
Thunder-Forged. It does not; Thunder-Forged is crafted at a different station and has no menu
in the catalog at all.

Cardinality was perfect throughout. The fix is **provenance**: each record carries the
crafting station its own source names, and its container declares which stations it expects.
Structure cannot detect a correctly-shaped pool of the wrong system's data.

**2. A host that never reaches the solver.** A pool is reachable only through a *host marker*
on an item. A host whose entire value is its slots carries no affixes, so the dominance
pre-filter reads its bucket set as empty — and an empty set is a subset of every other, so any
rival with a single ranked affix prunes it. Every choice-slot family needs its slots counted
in that comparison. Declaring a family without adding it there leaves it unreachable in a way
no pool-level check detects: the pool is well-formed, the host exists, and no solve ever sees
it.

The Essence Crafting family shipped in exactly that state. At endgame ML caps every Gem was
eligible and every Gem was pruned, so the feature reached the solver on no endgame query —
and the disclosure meant to explain a short menu never rendered either, because it is only
built when a host was a candidate.

**3. Whether the pool's shape matches the game's.** Three altars are three tiers, so a
single-pick model of a three-tier system under-credits it by construction. That is a modelling
question the cardinality gate is silent about, and it is worth recording next to the
declaration rather than discovering later.

## Consequences

- Declare every single-pick pool, with its shape, its verdict, and its host marker.
  Containers are **discovered, not curated**: the gate walks the built dataset, and a
  top-level key that is neither a declared container nor a declared non-container fails
  the build — so a new pool cannot arrive unnoticed.
- A known-unsafe pool may be **declared honestly rather than fixed**, when it is inert and
  fixing it is disproportionate. That is a legitimate state, but keep the trigger keyed to
  the **host marker**, not to a record count: a record-count trigger for a pool that has been
  full and inert for months was spent long ago. And re-examine the "disproportionate" half
  periodically — the Green Steel entry declined an ATOMIC conversion as "a full-stack change
  (dataset.js, model.js, solver.js, projection.js and the exports)", and that was true when
  written and false a few containers later, once three other pools had gone ATOMIC and every
  consumer already read an `affixes` list.
- When converting, keep the leading on-target affix in the legacy flat fields. That is what
  makes the display layers a no-op and shrinks the change to the builders, the pool filters
  and the binding loops.
- "No host exists to test against" is not a reason to leave a pool unverified. A synthetic
  host is what makes an unreachable pool testable, and the solver suite already does this for
  every other choice-slot family.

## Where this lives

`src/container_registry.py` — the declarations and the gate.
`CONCEPTS.md` — [[Choice-slot container shape]] and [[Host marker]].
`docs/solutions/design-patterns/milp-encoding-for-gear-optimization.md` — the encoding this
enforces; its closing recommendation, *"the recurrence is the real lesson: enforce, don't
re-document"*, is what this gate operationalizes.
