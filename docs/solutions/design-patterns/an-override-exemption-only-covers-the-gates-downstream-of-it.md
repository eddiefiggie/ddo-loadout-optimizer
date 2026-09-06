---
title: "An override exemption only covers the gates downstream of where it lives"
module: wizard
date: 2026-09-05
problem_type: design_pattern
component: solver
severity: high
tags:
  - pins
  - constraints
  - filters
  - owned-gear
  - silent-failure
  - layering
applies_when:
  - Adding a filter that removes candidates before the model is built
  - Implementing an escape hatch or override that must beat "every" filter
  - A hard constraint names an entity that some other layer may have removed
  - Triaging a report whose symptom matches an issue already closed
related_components:
  - web/wizard.js
  - web/model.js
  - web/solver.js
---

# An override exemption only covers the gates downstream of where it lives

## The rule that existed

"A pin is an explicit instruction that overrides the filter" (KD5). It was
implemented three times — the ML floor (R8), the augment ceiling (#339), the
Artifact opt-in (#369) — and all three exemptions were placed inside
`variantConflict`, which is the right home for a *per-variant eligibility* gate.

## Why the rule still broke

The owned-gear pool is not one of those gates. It lives in `wizard.js`
`candidateItems()` and filters `dataset.items` **before** `buildModel` is called:

```
candidateItems()  ->  buildModel  ->  eligible/variantConflict  ->  solver
      ^ the pool filter                     ^ where all three exemptions live
```

A pinned unowned variant is removed at the first arrow, so the pick var the pin
constraint references is never created. `slotConstraintBodies` then behaves as
documented — "a pinned id absent from the pool is a silent no-op" — and
`reconcilePinLegality` cannot help either, because it consults weapon/armor/slot
legality and knows nothing about the player's import.

Result: the pin was neither honored, nor dropped, nor reported. The slot filled
with the best owned alternative and the player was told nothing (#721).

## The generalization

**An exemption is scoped to its layer, not to the concept it names.** Writing
"a pin overrides filters" in a comment beside one gate does not make it true of
filters added at other layers later — and the failure is silent by construction,
because a constraint naming an absent entity is a no-op rather than an error.

Two practical consequences:

1. When adding a filter that removes candidates **upstream** of the model, ask
   what hard constraints elsewhere may name the rows being removed. A pool
   filter and a slot constraint are the same decision made in two places.
2. Prefer making the no-op **loud**. If `slotConstraintBodies` had reported
   "pinned id X is not in the pool" instead of skipping, both #369 and #721
   would have been one-line diagnoses instead of two separate player reports.
   That remains unbuilt; it is the durable fix and worth filing if it recurs.

## The triage trap this also carries

#369's title was *"Pins can be silently replaced in owned-gear mode"* and its
investigation concluded **"owned-gear mode was a red herring — the variable is
the Artifact opt-in."** That conclusion was correct *for that report*: that
player owned the item they pinned, so the pool was not what dropped it.

A later report with the same symptom and the *opposite* precondition — the
player does **not** own the pinned item — is therefore not a duplicate, even
though the title matches almost word for word. **Read what a closed issue
actually ruled out, not what its title says it covered.** A red herring in one
reproduction is not a red herring in general, and the sentence that says so is
usually in a comment rather than the title.

## Symmetry: a silent override is the same bug wearing the other face

#369 chose "honor the pin, and say so" over "drop the pin, and say so", and the
"say so" half is not decoration. Having fixed the silent *discard*, shipping a
silent *override* would reproduce the same defect from the other direction: the
player's stated pool no longer describes the solve, and nothing on screen
admits it. The exemption and its disclosure ship together or neither ships.
