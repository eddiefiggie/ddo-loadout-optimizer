---
title: Gate a solver source-family at its value source, not just the eligibility filter
module: solver
date: 2026-08-04
problem_type: design_pattern
component: solver
severity: high
applies_when: adding a user-facing opt-in/ownership gate to a solver source-family whose value is generated from a model-level def dict rather than from worn-variant affixes
tags:
  - milp
  - solver
  - eligibility
  - opt-in
  - new-source-family
related_components:
  - web/model.js
  - web/solver.js
---

# Gate a solver source-family at its value source, not just the eligibility filter

## Context

Most gear in this optimizer earns its value through the **variant eligibility pool**:
`variantConflict`/`eligible` (`web/model.js`) decides which worn variants enter the solve, and
those variants' affixes are what the objective scores. So the natural place to add a user-facing gate
(e.g. an Artifact opt-in, an ownership filter) is a line in `variantConflict` — filter the variant out
of the pool and it contributes nothing.

Augment Sets (the Cauldron of Cadence set augments, PR #131) broke that assumption. They are a **new
source family**: the placed augments are *stat-less* variants, and their value comes entirely from the
solver reading a model-level def dict — `model.augment_set_defs` — directly in the `y[aug,i]` family
(`web/solver.js`), completely bypassing the worn/augment eligibility pool. An ownership gate was added
to `variantConflict` (`web/model.js:253`, `if (v.set_augment) …`), and it correctly filtered the
stat-less variants. But those variants never carried the value — so the gate was a **no-op for the
thing it was meant to gate**. A focused review proved it empirically: with an empty ownership set the
solver still placed 3 copies and fired the bonus.

## Guidance

When a solver source-family generates value from a **model-level input** (a def dict, a catalog, a
runtime table read straight by the encoder) rather than from the affixes of eligible worn variants,
**apply the user-facing gate to that model input at its source**, not (only) to the corresponding
variants in `variantConflict`. The variant filter and the value path are two different doors; gate the
one the value actually comes through.

Concretely for the def-dict case, filter the dict in `buildModel` before it reaches the model, keyed by
the same ownership key the variant gate uses (`web/model.js:637-644`):

```js
augment_set_defs: (() => {
  const owned = query.ownedSetAugments;
  const has = (k) => owned && (typeof owned.has === "function" ? owned.has(k)
    : Array.isArray(owned) ? owned.includes(k) : false);
  const out = {};
  for (const [name, def] of Object.entries(augmentSetDefs || {})) if (has(name)) out[name] = def;
  return out;
})(),
```

Empty/undefined ownership → empty dict → the family is inert. Keep the `variantConflict` filter too
(it's still correct for the stat-less variants and keeps them out of pickers), but do not rely on it
for value gating.

## Why This Matters

The gate contract was "default off — the family is inert until the player opts in." Because the gate
lived only on the eligibility filter, the real contract was silently violated: the optimizer
recommended set augments the player had never crafted (the exact over-fitting failure the ownership
gate existed to prevent). A gate that filters the *wrong door* looks present in the code and in
variant-level tests, so it gives false confidence — the existing tests asserted `eligible()` excluded
the variants and passed, while the solver placed them anyway.

There's a testing corollary: **test the gate on the path the value flows through.** A test that only
checks `eligible()`/`variantConflict` will not catch a value path that reads a model dict directly.
Assert the model input itself is gated (e.g. `buildModel(...).augment_set_defs` is empty when nothing
is owned), or assert end-to-end that the solve places nothing.

## When to Apply

- Adding an opt-in, ownership, content, or availability gate to **any** solver source-family that
  reads a model-level def/catalog dict directly (the joker/membership/set-augment style families in
  `web/solver.js`, not the ordinary worn-affix path).
- More generally: whenever a feature's *value* is produced by a code path distinct from the standard
  eligibility/selection filter, confirm the gate sits on the value path — filtering a proxy record
  that carries no value is a no-op.

## Examples

**The trap (gate on the eligibility filter only):**
- `variantConflict` excludes `v.set_augment` variants unless owned → the stat-less variants are
  filtered, but `buildModel` forwards **all** `augment_set_defs` regardless of ownership → the solver's
  `y`-family reads the full dict and scores unowned sets. Empty ownership, 3 copies still placed.

**The fix (gate the value source):**
- `buildModel` filters `augment_set_defs` by `query.ownedSetAugments` before the model is built. Empty
  ownership → `{}` → no `y` vars created → family inert. Regression test asserts
  `buildModel(...).augment_set_defs` is empty with empty ownership and holds only the owned set when one
  is marked.

**Related:** `docs/solutions/design-patterns/milp-encoding-for-gear-optimization.md` (the new-source-family
checklist this extends) and `docs/solutions/design-patterns/single-source-of-truth-for-set-definitions.md`.
