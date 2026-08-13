---
title: "A golden fixture ranking an expanded-away name uses aliasTargets, so it solves what a migrated saved build solves"
module: tests
date: 2026-08-13
problem_type: convention
component: testing_framework
severity: medium
tags:
  - ddo
  - golden-fixture
  - parity
  - aliastargets
  - expanded-away
  - priority-migration
  - re-ratification
applies_when:
  - "A stat a golden fixture ranks becomes expanded-away (joins the universal-expansion table, gets folded, or otherwise stops existing as an item-carried stat name)"
  - "Writing a new parity fixture whose ranked priority is a provenance label or umbrella name rather than a concrete stat"
  - "Re-ratifying a golden diff where one fixture's perTarget shows a ranked stat at zero"
---

# A golden fixture ranking an expanded-away name uses aliasTargets, so it solves what a migrated saved build solves

## Context

When #290 expanded `Potency` into the ten element spellpowers (PR #294), no item affix
carried the stat name `Potency` any more. The `endgame-caster-ml32` golden fixture ranked
it as a raw solver target — and its ratified solve silently degraded to `Potency: 0` while
the solver optimized the remaining priorities. The fixture no longer modeled anything a
player experiences: a real player who ranked Potency is migrated on load, so their solve
credits the ten expanded stats.

A golden fixture pins solver behavior byte-for-byte, so this failure mode is quiet and
absolute: the guard keeps passing, but what it protects is a query shape no user can
produce. The repo's rule that golden diffs are re-ratified *deliberately* is the moment
this gets caught — a ranked stat at zero in a perTarget diff is the tell.

## Guidance

`tests/parity/fixtures.json` supports `query.aliasTargets` as the fixture-side answer.
The capture harness (`resolveQuery` in `tests/parity/capture_golden.js:36-64`) resolves
that list through the **same** `buildPickerVocabulary` + `migratePriorities` pair
(imported from `web/dataset.js`) that the priority picker and the saved-character load
path use — so the fixture solves exactly what a migrated saved build gets, at the same
ranks, with non-alias names passing through unchanged.

```json
"query": {
  "mlCap": 32,
  "aliasTargets": ["Universal Spell Power", "Potency", "Wisdom", "Charisma"]
}
```

Three properties make this the convention rather than one option among several:

- **Do not hand-copy the expansion into `targets`.** A pasted list of the family's
  concrete stats is frozen at authoring time; when the expansion table changes (a member
  added, an ordering change), the fixture silently diverges from what migration produces.
  `aliasTargets` re-derives from the live table on every capture.
- **Do not leave the dead name in `targets`.** The solve stays deterministic and green
  while ranking a stat nothing can satisfy — the pinned behavior is a lie about the
  product.
- **The harness throws when no substitution occurs** ("no longer a provenance alias —
  the fixture would degrade into ranking a name no item carries",
  `tests/parity/capture_golden.js:60-63`), and it refuses a fixture stating both
  `targets` and `aliasTargets`. Drift between the fixture and the expansion table is
  loud, not silent.

Record the why in the fixture's `note` field when converting one — the ratification
rationale is part of the fixture (`endgame-caster-ml32`'s note documents the #290
conversion).

## Why This Matters

Golden fixtures are the repo's strongest guard: they fail on any solver change, so
whatever they pin becomes the de facto definition of correct. A fixture ranking an
expanded-away name pins the wrong thing with full confidence — every future diff is
judged against a solve no player can reach. Routing fixtures through the app's own
migration path keeps the guard's subject and the product's behavior the same object,
and it is also what made the #290 re-ratification honest: the fixture's dead
`Potency: 0` became real spellpower credit, matching what a loaded saved character
actually solves.

## When to Apply

- Any batch that expands a stat away (a name joins the universal-expansion family
  table, a display-name fold lands, an umbrella is registered): grep
  `tests/parity/fixtures.json` for the affected names and convert any fixture ranking
  one.
- Writing a fixture that deliberately exercises the label path — the precedent pair
  `provenance-alias-sacred-dc-ml34` / `provenance-components-sacred-dc-ml34` ranks a
  label via `aliasTargets` and its components via `targets` and asserts the two solves
  are byte-identical, which is the end-to-end proof the substitution machinery works.
- During deliberate golden re-ratification: a ranked stat at zero in the perTarget diff
  means the fixture, not the solver, needs the change.

## Examples

The #290 conversion, before and after:

```json
// before — pinned a solve no player can produce after the expansion
"targets": ["Universal Spell Power", "Potency", "Wisdom", "Charisma"]
// ratified perTarget: { "Potency": 0, ... }

// after — resolves through migratePriorities like a loaded saved build
"aliasTargets": ["Universal Spell Power", "Potency", "Wisdom", "Charisma"]
// ratified perTarget: { "Combustion": 335, "Corrosion": 333, ..., "Nullification": 225, ... }
```

## Related

- `docs/solutions/design-patterns/universal-stat-expansion-family.md` — the expansion
  pattern that creates expanded-away names; its Examples section carries the one-line
  version of this convention.
- `docs/solutions/workflow-issues/golden-solve-guard-missing-from-local-test-sweep.md` —
  the sibling golden-guard convention: the guard only protects when its file actually runs.
- `docs/solutions/conventions/prove-a-test-fails-against-the-pre-change-tree.md` — the
  general honesty rule this convention instantiates for pinned solver output.
- Issues #290 / PR #294 (the conversion), #136 (the picker redirect machinery the
  migration path came from).
