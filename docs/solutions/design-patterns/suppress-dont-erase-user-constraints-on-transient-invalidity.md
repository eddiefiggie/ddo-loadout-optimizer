---
title: Suppress, don't erase, a user constraint that is invalid only for the current config
module: solver
date: 2026-08-02
problem_type: design_pattern
component: tooling
severity: high
applies_when:
  - "A user-set constraint (a pin, lock, filter) can become illegal for the current config, then legal again"
  - "Code reconciles constraints before an operation that would otherwise force an illegal value"
  - "A cleanup sweep prunes constraints that 'did not take effect' in the last result"
tags:
  - pinning
  - constraints
  - user-intent
  - state-mutation
  - solver
  - wizard
  - milp
---

# Suppress, don't erase, a user constraint that is invalid only for the current config

## Context

The optimizer lets a user **pin** an item into a slot. A pin illegal for the current character (a docent pinned by a non-Forged race, a cloth robe under a Heavy build) must not be forced into the loadout (R4a). The first implementation removed the illegal pin from the live `state.slotConstraints` before solving.

That silently destroyed user intent: pin Heavy Plate to Armor (legal for a Human), flip race to Warforged (pin now illegal, dropped), flip back to Human — the pin is **gone**. A pin illegal only for a *transient* config was erased permanently, with no notice (the reconciler even returned a `dropped[]` list "for disclosure" that the caller ignored).

A second, subtler copy of the same bug lived in the pre-existing post-solve sweep: it pruned any pin whose item "did not land" in the result. Once R4a stopped force-landing illegal pins, that sweep started deleting them too — so even reconciling a copy at solve time was not enough on its own.

## Guidance

When code invalidates a user-set constraint that is illegal **only for the current configuration** (not permanently gone), **suppress it for the current operation without deleting it from persistent state**, and make any cleanup sweep distinguish *transiently invalid* from *permanently gone*.

Two rules, both required:

1. **Reconcile a copy, not the source of truth.** Build the operation's input from a shallow copy of the user's constraints and reconcile *that*; leave persistent state intact. The constraint is suppressed for this (illegal) run and honored again the moment the config makes it legal. The user already sees the conflict through the existing per-item advisory — no state change is needed to communicate it.

2. **Cleanup prunes only what is permanently gone.** A "didn't take effect last time" sweep must drop a constraint **only** when its target no longer exists at all (absent from the catalog / pool) — never when the target exists but is merely illegal for the current config. The transiently-illegal one is kept so a config fix restores it.

If a design genuinely must drop a user constraint from persistent state, **surface it visibly** (consume the disclosure list) — never delete silently.

## Why This Matters

Silent, permanent loss of an explicit user choice is among the worst trust failures a tool can have: the user set a pin, did nothing to remove it, and it vanished because of an unrelated, reverted toggle. It is also invisible in tests that only check the happy path — the pin is simply absent on the next solve. The fix is cheap (reconcile a copy; add one predicate to the sweep) but only if you recognize that **"invalid right now" and "gone forever" are different states** and must be handled differently.

## When to Apply

- Any user-set constraint (pin, lock, saved filter, favorite) that can flip legal/illegal as surrounding config changes.
- Any pre-solve/pre-render reconciliation that mutates the same object the user's choices live in — copy first.
- Any "prune what didn't apply" cleanup — gate it on genuine absence, not on non-application.

## Examples

Erases user intent (before) vs suppresses-only (after), in `web/wizard.js` `solve()`:

```javascript
// BEFORE — reconcile mutates live state; a transient illegal config erases the pin
reconcilePinLegality(state.slotConstraints, itemByPinId, query, slotCardOf);
query.slotConstraints = { ...state.slotConstraints };

// AFTER — copy first, reconcile the copy; state.slotConstraints is never touched
query.slotConstraints = { ...state.slotConstraints };
reconcilePinLegality(query.slotConstraints, itemByPinId, query, slotCardOf);
```

The post-solve sweep must keep config-illegal pins, pruning only genuinely-absent ones:

```javascript
// BEFORE — drops any pin that didn't land (now includes legally-suppressed pins)
const stale = _pinnedVariantIds(c).filter((vid) => !landed(vid));

// AFTER — drop only when the item is truly gone from the catalog; a present-but-
// illegal pin (itemByPinId non-null) is kept and honored again when config is fixed
const stale = _pinnedVariantIds(c).filter((vid) => !landed(vid) && !itemByPinId(vid));
```

## Related

- [[milp-encoding-for-gear-optimization]] — the pinning / dominance-filter machinery this reconciliation feeds.
- [[browse-visibility-for-separate-source-pools]] — another "compute the true state at the view/derivation layer, don't mutate the canonical store" instance.
- [[where-a-per-item-gate-may-live-in-the-solver]] — the suppression contract established here can silently fail to *engage*: the legality predicate is slot-blind, so a pin that is wrong only for the slot it was placed in is never seen. `pinSlotConflict` is the slot-aware layer that closes that gap.
