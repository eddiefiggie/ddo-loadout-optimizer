---
title: "Re-normalize an opt-in filter at query-build time when its validity depends on another input"
date: 2026-08-16
category: design-patterns
module: solver
problem_type: design_pattern
component: testing_framework
severity: medium
applies_when:
  - "Adding an opt-in filter whose meaningful range depends on another player input (e.g. a ceiling bounded by a cap)"
  - "A stored filter value can outlive the input that made it meaningful (the bounding input is edited later without re-touching the filter)"
  - "A disclosure or notice reports the filter as active"
tags: [opt-in-filter, clamp, query-build, stale-state, disclosure, ceiling]
related_components:
  - web/wizard.js
---

# Re-normalize an opt-in filter at query-build time when its validity depends on another input

## Context

The augment ML ceiling (#339, PR #341) is an opt-in filter bounded by another input: it only means something while it sits strictly below the ML cap. A player who sets ceiling 32 at cap 36 and later lowers the cap to 30 leaves a stored ceiling that is mathematically inert — the cap already excludes everything above 30 — yet a naive implementation keeps disclosing "augments restricted to ML 32" on every surface and export: an unrestricted solve reading as restricted, the inverse of the disclosure's promise. An input-time-only clamp cannot prevent this, because the *other* input moved after the clamp ran.

## Guidance

Put the authoritative clamp in the query builder, evaluated against the effective bounding input **at query time**; keep any input-handler clamp as display-layer convenience only. In this repo, one shared rule serves both layers (`web/wizard.js`, `clampAugCeiling`): a ceiling counts only when positive and strictly below the cap — anything else is `null` (unrestricted). `buildQuery` calls it against the effective cap on every solve, so a stale stored value re-normalizes to unrestricted instead of shipping into the query; the input's own handler calls the same helper so the two layers cannot drift on the boundary rule.

Pair it with a query-level test: a state carrying the stale combination (filter above the moved bound) must emit a null filter, no gate effect, and no disclosure lines.

## Why This Matters

A filter that ships stale into the query poisons everything downstream that trusts the query: the solve is correct (the tighter bound already dominates) but every disclosure, export, and saved record misdescribes it. Re-normalizing at the single point where the query is assembled fixes all consumers at once; patching each disclosure individually would re-fight the same bug per surface.

## When to Apply

- Any filter/bound pair where one player input defines the valid range of another.
- Persisted inputs generally: a stored value's meaning must be re-derived against the inputs live at use time, not trusted from write time.

## Examples

Before: input handler clamps on entry; cap later lowered; `buildQuery` emits the stored ceiling unchanged → disclosure claims a restriction the solve doesn't have. After: `buildQuery` re-clamps against the effective cap → stale ceiling becomes null; disclosure stays silent; a fresh below-cap ceiling still restricts and discloses.

## Related

- `docs/solutions/conventions/fixture-shape-must-mirror-the-production-writer.md` — the sibling #339 lesson about testing the disclosure that reads this query.
- Issue #339, PR #341.
