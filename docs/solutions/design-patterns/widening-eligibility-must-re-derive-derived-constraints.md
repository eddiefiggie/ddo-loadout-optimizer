---
title: Widening an eligibility rule must re-derive every constraint whose coefficients were derived from the old predicate
module: solver
date: 2026-08-14
problem_type: design_pattern
component: tooling
severity: high
applies_when:
  - "Widening or otherwise changing an eligibility predicate/gate that other MILP constraints, caps, or coefficients were derived from"
  - "An implementation plan enumerates 'caps/constraints to preserve' by name instead of re-deriving them from the new predicate"
  - "A per-host, per-slot, or per-item coefficient (e.g. a slot count n) was computed under the OLD predicate's assumptions and is being carried forward unchanged"
tags:
  - solver
  - milp
  - eligibility
  - constraint-derivation
  - code-review
  - set-augments
related_components:
  - web/solver.js
  - web/model.js
---

## Context

PR #318 (merged 2026-08-14) widened set-augment host eligibility in `web/solver.js` Part A from "host has a literal `Colorless` slot" to "host's slots intersect the def's baked `fits_slots` matrix" — the #316 fix that lets a Green/Yellow-only host carry a set-augment copy. The widened eligibility in the current tree (`web/solver.js`):

```js
const defFits = (def.fits_slots || []).filter((c) => presentColors.has(c));
if (!defFits.length) continue;
const defFitsSet = new Set(defFits);
const ys = [];
for (const xv of xVars) {
  const usable = (((xv.variant.augment_slots_norm || {}).colors) || [])
    .filter((c) => defFitsSet.has(c));
  if (!usable.length) continue; // host exposes no compatible slot -> cannot hold a copy
```

The plan correctly preserved the #312/#317 caps (one copy per host, ≤3 overall) "unchanged over the per-host copy variables" — their *shape* does not depend on slot colors. (The related single-set-identity cap is a sibling constraint over the membership/awakening variables, untouched by this widening and deliberately outside the sketch below.) But the old constraint block also contained a fourth piece: a per-host slot-count cap `Σ ys − n·x ≤ 0` whose coefficient `n` was computed by filtering the host's slots to literal `"Colorless"`. That constraint's shape is predicate-independent, but its **coefficient encodes the old predicate**. Carried forward unchanged, a colored-only host gets `n = 0`, forcing all its copies to zero — the exact acceptance case the widening exists to enable becomes infeasible, while every pre-existing test stays green because every old fixture used Colorless hosts.

Code review flagged it at confidence 100, noting the plan's own Sources line listed "per-host caps" as a distinct piece of the current block — the omission was inside the unit's stated blast radius. The fix **removed** the cap as subsumed rather than re-deriving it: #312's one-copy-per-host cap keeps per-host pinned demand ≤ 1, and the per-copy color variables `c[y,sc]` exist only over the host's own compatible colors, so host attribution stays physically realizable without any count-based cap. The shipped comment records both halves (`web/solver.js`, the `#312` cap):

```js
// ... One copy per host, however many slots it exposes. (Also the
// constraint that keeps per-host pinned color demand ≤ 1, standing in
// for the removed per-host slot-count cap.)
if (ys.length > 1) extraConstraints.push(`${ys.join(" + ")} <= 1`);
```

and, in the block header comment: "the old per-host Colorless-count cap is subsumed and removed — reverting eligibility to literal Colorless zeroes colored-only hosts, see the AE1 deletion test."

The plan (`docs/plans/2026-08-14-001-fix-set-augment-any-slot-plan.md`, KTD2) now records the re-derivation requirement explicitly: "The fourth constraint in the current block — the per-host slot cap whose `n` counts literal Colorless slots — must also be re-derived: `n` becomes the count of host slots compatible with the def's matrix, or a colored-only host gets `n = 0` and every copy on it is forced to zero regardless of the widened gate."

The pin is the `#316/AE1` test in `tests/solver.test.js` ("a colored-slots-only host carries a set-augment copy, slot_color named"), whose fixture uses hosts exposing only `["Green", "Yellow"]`, `["Green"]`, `["Yellow"]` slots and asserts the 3-piece bonus fires. Its comment names the deletion-test role: "Deletion test target: revert eligibility to literal Colorless and this red-lines."

## Guidance

When widening (or otherwise changing) an eligibility predicate, run this audit before declaring the blast radius closed:

1. **Grep the code region for every use of the OLD predicate** — the literal filter string (here `"Colorless"`), and every color/count/coefficient computation downstream of it. Collect constraints the plan names AND ones it doesn't; the plan's own Sources/current-state inventory is a checklist to verify against the code, not a substitute for the grep.
2. **Classify each hit into one of three buckets:**
   - **Unchanged-shape** — the constraint's structure is predicate-independent (e.g. `Σ y ≤ 3` over per-host copy variables). Safe to carry forward verbatim.
   - **Re-derive** — the constraint's *coefficient or variable set* encodes the predicate (e.g. `n` = count of slots passing the old filter). It must be recomputed from the new predicate, or it silently enforces the old rule.
   - **Subsumed** — another constraint now carries the invariant. Prefer removal over re-derivation **when provable**, and write the subsumption argument down next to the surviving constraint (here: one-copy-per-host bounds demand ≤ 1, and per-copy color vars are defined only over host-compatible colors, so no count cap is needed).
3. **Add a deletion test targeting the motivating case the widening exists to enable.** The old fixtures all satisfied the old predicate by construction, so they *cannot* catch a stale coefficient — a fixture that fails the old predicate but passes the new one is the only thing that can. Verify it red-lines when eligibility is reverted to the old predicate.

### Wrong vs right, compactly

```
Old block (predicate = literal Colorless):
  eligibility:  host has a "Colorless" slot
  cap A (#317): Σ_all y ≤ 3                      -- shape predicate-independent
  cap B (#312): Σ_host y ≤ 1                     -- shape predicate-independent
  cap C:        Σ_host y − n·x ≤ 0,  n = #Colorless slots on host   -- n ENCODES the predicate

WRONG widening: change eligibility to fits_slots ∩ host colors; keep A, B, C verbatim.
  -> colored-only host: eligible (new gate) but n = 0 (old coefficient)
  -> its copies forced to 0; the motivating case is infeasible; all old tests green.

RIGHT widening: change eligibility; keep A, B (unchanged-shape);
  for C, either re-derive n over the NEW predicate, or prove subsumption and delete
  (shipped: B keeps demand ≤ 1 and c-vars exist only over compatible colors, so C is
  redundant — removed, with the argument written into the #312 comment);
  then add the deletion test (#316/AE1: Green/Yellow-only hosts, bonus must fire).
```

## Why This Matters

- **The failure is invisible to the existing suite by construction.** Every fixture written under the old rule satisfied the old predicate, so a stale coefficient reproduces old behavior exactly on all of them. Green tests plus a merged plan is not evidence the widening works — only the new-territory fixture is.
- **The bug lands in the feature's own acceptance case.** The widening exists precisely for inputs the old predicate rejected; those are the inputs the stale coefficient zeroes out. The feature ships dead while looking done.
- **"Preserve the caps unchanged" is a trap phrase.** It is correct for shape-only constraints and wrong for coefficient-encoding ones — the distinction is whether any number or variable set in the constraint was *computed from* the old predicate, not whether the constraint conceptually relates to it.
- **Subsumption beats re-derivation when provable** — one less constraint to keep in sync with future predicate changes — but only with the argument recorded (here in the `#312` comment in `web/solver.js`), or the next reader re-adds the cap "for safety" and reintroduces the coupling.

## When to Apply

- Widening or narrowing any eligibility/filter predicate (slot colors, item categories, class gates, ML bands) where downstream constraints, counts, or coefficients were computed from the old filter.
- MILP/constraint-model edits generally: any time a variable's domain grows, audit every constraint whose coefficients were counted over the old domain.
- Reviewing a plan that says caps/invariants are "preserved unchanged" across a predicate change — check each preserved constraint for predicate-derived coefficients, especially ones the plan's own inventory lists as distinct pieces of the block being edited.
- Writing tests for a widening: the required fixture is one that fails the OLD predicate and passes the NEW one, with a note naming it as the deletion target.

## Examples

- **The shipped fix:** `web/solver.js` Part A — `defFits`/`usable` intersection gate; per-copy color vars `c[y,sc]` with `Σ_sc c = y`; `#312` one-copy cap comment recording that it "stands in for the removed per-host slot-count cap"; header comment recording the subsumption and pointing at the AE1 deletion test.
- **The deletion test:** `tests/solver.test.js`, `#316/AE1` — hosts with only `Green`/`Yellow` slots carry three copies and fire the 3-piece bonus; comment: "revert eligibility to literal Colorless and this red-lines." Companion `#316/AE3` proves the colored bucket shares capacity with ordinary augments (no cap needed to prevent double-booking).
- **The recorded requirement:** `docs/plans/2026-08-14-001-fix-set-augment-any-slot-plan.md`, KTD2 — "The fourth constraint in the current block … must also be re-derived: `n` becomes the count of host slots compatible with the def's matrix, or a colored-only host gets `n = 0`."
- **Where it was caught:** code review on PR #318, confidence 100 — the reviewer cross-checked the plan's Sources inventory (which listed "per-host caps" as a distinct current-block piece) against the diff and found the unaddressed fourth constraint.
- Sibling concerns from the same PR, at other layers: `add-a-solver-preference-as-a-pinned-post-stage.md` (post-stage pin granularity), `every-solver-family-report-needs-a-load-bearing-guard.md` (report-layer float guards), and `canonicalization-guards-need-a-trial-reassignment-and-identity-check.md` (projection-layer trial-assignment guard). Five standing rules from one PR: these four runtime layers plus the test-fixture layer (`docs/solutions/conventions/stamp-shared-fixtures-for-new-required-fields.md`).
