---
title: Where a per-item gate may live in this solver — and the two places it must not
module: solver
date: 2026-08-06
problem_type: design_pattern
component: tooling
severity: high
applies_when:
  - "Adding a rule that removes an item from consideration in one slot only"
  - "The new rule has a user-pin escape hatch that must survive pin reconciliation"
  - "A gate must distinguish 'never equippable' from 'wrong for THIS slot'"
  - "Code inside buildModel reads pinnedIds and means 'the player pinned it'"
  - "UI copy asserts why a result looks the way it does, including restored snapshots"
tags:
  - gates
  - pinning
  - solver
  - layering
  - off-hand
  - escape-hatch
  - ui-state
---

# Where a per-item gate may live in this solver — and the two places it must not

## Context

`web/model.js` funnels every "may this item be considered?" question through one
predicate. `variantConflict(v, query, gates)` (`web/model.js:201`) returns `null`
when a variant is equippable under the query, or a short human reason when it is
not. `eligible()` filters the whole dataset on `=== null` (`web/model.js:325-328`),
and `pinConflict` is a one-line re-export of the same function so the pin UI's
advisory text cannot drift from what the solver enforces (`web/model.js:285-287`).
That single-authority design is deliberate and it has paid off repeatedly — verification
status, the ML cap, the mlFloor pin exemption, the weapon/style lock, the off-hand
style rules, the race/docent rule, armor proficiency, alignment, the Artifact
opt-in, and the set-augment ownership gate all live there as one ordered list.

The Two Weapon Fighting declaration (PR #160, closing issue #137) was the first
feature where the obvious home was the wrong one. The feature is small to state: a
character who has declared TWF fights with two weapons, so shields, orbs, and rune
arms leave off-hand candidacy — unless the player explicitly pins one, which is the
escape hatch. Stating it that way makes `variantConflict` look like the natural
place to put it. It is not. Putting it there breaks the feature; and a *second*,
unrelated pin bug in the same feature turns out to be unfixable inside
`variantConflict` for the opposite reason.

Three traps surfaced in one feature, and together they describe the actual shape
of the gate architecture: `variantConflict` answers *equippability*, and it is
slot-blind. Anything that is not equippability, or that needs to know which slot
it is being asked about, belongs somewhere else.

## Guidance

**A pin-overridable rule cannot live in `variantConflict`.**
`reconcilePinLegality` in `web/wizard.js:236-255` walks every pinned variant and
drops any pin whose gate predicate is non-null. So a rule expressed in
`variantConflict` is, by construction, a rule that also deletes pins. If the rule
has the form "…unless the player pinned it", encoding it as a conflict makes the
feature delete its own override. Its correct home is the **pool assembly** inside
`buildModel` — for this feature, the off-hand pool at `web/model.js:616-630`.
Candidacy is a pool question, not an equippability question.

**`variantConflict` is slot-blind, so it can never say "wrong for THIS slot".**
It takes `(v, query, gates)` and no slot key. Be precise about what that means,
because `variantConflict` does mention the off hand — the whole `v.slot === "Off
Hand"` branch at `web/model.js:232-236`. That gate reads `v.slot`, the variant's
*home* slot, which is a property of the item; it never learns the slot the caller
is asking about. A shield's home slot is always "Off Hand", so "is this shield legal
off-hand gear for this style?" is answerable there. "Is this *weapon* legal in the
off hand *right now*?" is not, because the weapon's home slot says nothing about
which hand it is being considered for. An off-hand weapon pin made without
the declaration is a one-handed weapon that passes `mainHandWeaponOk`
(`web/model.js:135-137`), so `variantConflict` returns `null` and nothing
suppresses the pin. Meanwhile `allowedOffHandWeaponTypes` returns `null` because
the query is undeclared (`web/model.js:114-120`), so that same weapon never enters
the off-hand pool at `web/model.js:627-630`. The pin then constrains a variant that
is absent from its own slot — a **no-build**, not graceful suppression. The fix is
a second predicate, `pinSlotConflict(v, slotKey, query)` (`web/model.js:305-311`),
**layered on top of** `variantConflict` and consulted beside it by
`reconcilePinLegality` (`web/wizard.js:248`). It deliberately returns `null` for a
pinned shield on a declared build — that return is load-bearing, and it is exactly
what keeps trap 1's escape hatch intact.

**`pinnedIds` inside `buildModel` is not just the player's pins.**
When `query.includeArtifact` is on, the code adds every eligible Artifact to
`pinnedIds` so the dominance pre-filter cannot prune one (`web/model.js:577-579`).
That reuse of the pin-exemption seam is correct for its own purpose and quietly
poisonous for any rule that means "unless the PLAYER pinned it". Snapshot a
separate `explicitPins` set *before* the injection (`web/model.js:571`) and read
that. Otherwise every Artifact shield sits in a declared build's off hand with
nobody having pinned it.

**Never infer state from a rendered artifact.**
`boundNotice` in `web/results.js:482-517` originally inferred "a pin overrode the
exclusion" from an off-hand ITEM merely being present in a declared build. That
inference is sound only if the displayed result was solved under the *current*
query. A restored saved snapshot is not re-solved on load, and the U4 migration
(`twfMigrationNeeded`, `web/wizard.js:180-184`) turns the declaration on for
exactly such a snapshot. The result was the UI telling a player "your pinned Tower
Shield overrode that" when they had pinned nothing. The fix is to consult the
actual `slotConstraints["Off Hand"]` pin (`web/results.js:506-508`). Two correct
units composed into a statement neither produced alone.

## Why This Matters

Each trap fails silently, and three of the four fail in a direction that looks
like success.

Trap 1 does not throw; it produces a build where the escape hatch simply never
works, and the player's pinned shield vanishes from the results with a "dropped an
illegal pin" toast that is technically honest and completely wrong. Trap 2 does
not throw either — it hands the MILP a `= 1` constraint on a pick variable that
does not exist in the model, which surfaces as an infeasible solve rather than as
"that pin isn't valid here". The user-visible difference between graceful
suppression and a no-build is the difference between a working tool and a broken
one.

Trap 3 is the most dangerous because it is a *conditional* leak: everything works
until the player checks "Include an Artifact", at which point one specific class of
excluded item silently re-enters the pool. Nothing in the feature's own test
surface would notice, because the feature's tests do not set `includeArtifact`. It
took a purpose-written test to pin it (`tests/model.test.js:1123-1133`,
"the Artifact exemption must NOT smuggle an unpinned shield past the exclusion").

The bonus trap matters for a different reason: it is a correctness bug in
*disclosure*, not in the solve. This project's whole claim is "provably optimal,
and here is honestly what bounded it". A notice that fabricates a pin the player
never made is worse than no notice, because it is the surface the player trusts to
explain a surprising result. The general rule — do not reconstruct input state by
reading output state — applies anywhere a saved snapshot can be shown without
being re-solved, which in this app is every restored character.

## When to Apply

Apply this before adding any new per-item rule to `web/model.js`. Ask two
questions in order:

1. **Does the rule have an "unless the player pinned it" clause, or any other
   user override?** If yes, it does not go in `variantConflict` — it goes in the
   relevant pool assembly inside `buildModel`, reading `explicitPins`, not
   `pinnedIds`.
2. **Does the rule depend on which slot the item is being considered for?** If
   yes, `variantConflict` structurally cannot express it. Add or extend a
   slot-aware predicate layered above it, and wire it into `reconcilePinLegality`
   beside the existing check rather than folding it in.

If both answers are no, `variantConflict` remains the right home and the
single-authority property is preserved.

Two style facts are worth pinning with tests whenever a declaration-keyed rule
touches the off hand:

- **`unarmed` is the *other* style whose off-hand allow-list is unrestricted.**
  `offHandTypesForStyle` returns `null` for it, so a declaration-keyed exclusion
  that forgets its style guard would silently empty the unarmed off hand. It needs
  an explicit test alongside `sword-board` and `crossbow`
  (`tests/model.test.js:1098-1104`). The guard itself lives in
  `offHandItemsExcluded` (`web/model.js:129-132`), which is keyed on the style that
  permits a second weapon, not on the flag alone.
- **`twfWeaponAllowedForStyle` is true for `one-hand` ONLY**
  (`web/weapon-taxonomy.js:107-109`, pinned by
  `tests/weapon-taxonomy.test.js:74-79`). Never re-derive that list at a call site;
  call the taxonomy and let the test hold the line.

Finally, when a rule needs one advisory answer in more than one surface, export a
single predicate for it. `offHandItemsExcluded` is read by the pool assembly
(`web/model.js:624`), by the wizard's pin flow (`web/wizard.js:729-731`), and by
the results notice (`web/results.js:493`) — so what the pin list says and what the
results notice says cannot disagree.

## Examples

### Trap 1 — the exclusion in the wrong place vs. the right place

Wrong. Expressed as a gate, this is also a pin-deletion rule, because
`reconcilePinLegality` drops any pin whose `variantConflict` is non-null:

```js
// web/model.js, inside variantConflict — DO NOT DO THIS
if (v.slot === "Off Hand" && v.category !== "weapon" && offHandItemsExcluded(query))
  return "you declared Two Weapon Fighting";
// => reconcilePinLegality now deletes the pinned shield the escape hatch protects.
```

Right — the shipped form, in the off-hand pool assembly
(`web/model.js:616-626`), reading the pre-injection snapshot:

```js
let offHandPool = elig.filter((v) => v.slot === "Off Hand");
if (offHandItemsExcluded(query)) {
  offHandPool = offHandPool.filter((v) => explicitPins.has(variantKey(v)));
}
```

Guarded by `tests/model.test.js:1115-1122` — the pinned shield survives, and *only*
the pinned one (the unpinned orb and rune arm still leave).

### Trap 2 — what slot-blindness costs, and the layered fix

`variantConflict` sees nothing wrong with an undeclared off-hand weapon pin, which
is exactly what `tests/model.test.js:1145-1154` asserts:

```js
assert.strictEqual(M.variantConflict(twfSword, q), null, "variantConflict alone sees nothing wrong");
assert.ok(M.pinSlotConflict(twfSword, "Off Hand", q), "the slot-aware predicate catches it");
assert.strictEqual(M.pinSlotConflict(twfSword, "Main Hand", q), null, "the same weapon is fine in the main hand");
```

The predicate itself is deliberately narrow — it is inert for every slot and
category it does not own (`web/model.js:305-311`):

```js
function pinSlotConflict(v, slotKey, query) {
  if (!v || slotKey !== "Off Hand" || v.category !== "weapon") return null;
  const allow = allowedOffHandWeaponTypes(query || {});
  if (allow == null) return "your character hasn't declared Two Weapon Fighting";
  if (!offHandWeaponOk(v, allow)) return "this weapon type isn't in your off-hand weapon picks";
  return null;
}
```

Note the `v.category !== "weapon"` early return: that is what makes a pinned
shield return `null` on a declared build, keeping trap 1's hatch alive. It is
asserted directly at `tests/model.test.js:1165-1172`. Both authorities are then
consulted side by side, never merged (`web/wizard.js:248`):

```js
if (it && (_pinConflict(it, query) !== null || _pinSlotConflict(it, slot, query) !== null)) {
  removePinFrom(slotConstraints, slot, vid, cardOf);
  dropped.push({ slot, id: vid });
}
```

### Trap 3 — `explicitPins` vs. `pinnedIds`

The ordering is the whole fix (`web/model.js:562-579`):

```js
const pinnedIds = new Set();
for (const c of Object.values(query.slotConstraints || {})) {
  for (const id of pinnedVariantIds(c)) pinnedIds.add(id);
}
const explicitPins = new Set(pinnedIds);   // snapshot BEFORE the widening below

if (query.includeArtifact) {
  for (const v of elig) if (v.artifact) pinnedIds.add(variantKey(v));
}
```

Reading `pinnedIds` in the off-hand filter would have let every eligible Artifact
shield through unpinned. `tests/model.test.js:1123-1133` fails on exactly that
substitution.

### Bonus — consult the pin, do not infer it

Wrong (the shipped-then-fixed inference): "there is an off-hand item in a declared
build, therefore the player pinned it." Right (`web/results.js:503-513`):

```js
const offPins = _pinnedVariantIds(((query && query.slotConstraints) || {})["Off Hand"]);
const pinned = !!offItem && offPins.includes(offItem.variant_id || offItem.source_item);
```

…which yields three distinct messages for three distinct states: the pin overrode
the exclusion; the build predates the declaration, so re-solve; or nothing is in
the off hand and you may pin one to bring it back. The stale-snapshot branch is not
theoretical — `tests/results.test.js:875-886` reproduces it through the U4
migration path and asserts the notice never says "pinned".

## Related

- [`gate-the-value-source-not-just-the-eligibility-filter.md`](gate-the-value-source-not-just-the-eligibility-filter.md) —
  sibling placement rule, same "which door does this gate belong on?" question in the
  same file. It covers the **value** door (a `variantConflict` gate that is a no-op);
  this doc covers the **candidacy** door (a `variantConflict` gate that destroys pins).
  Its closing advice to "keep the `variantConflict` filter too" is unsafe for any gate a
  pin must override.
- [`auto-legality-constraints-need-a-pin-conflict-escape-hatch.md`](auto-legality-constraints-need-a-pin-conflict-escape-hatch.md) —
  the same escape-hatch principle one layer up, in solver constraint emission. It calls
  for auditing every auto-added legality rule over pinnable slots; this doc extends that
  audit from **constraints** to **gates**. Note the two invert on the same function: there
  `reconcilePinLegality` catches too little, here it catches too much.
- [`suppress-dont-erase-user-constraints-on-transient-invalidity.md`](suppress-dont-erase-user-constraints-on-transient-invalidity.md) —
  establishes the suppress-don't-erase contract for `reconcilePinLegality` that trap 2
  shows can silently fail to engage when the legality predicate is slot-blind.
  `pinSlotConflict` is its direct extension.
- [`milp-encoding-for-gear-optimization.md`](milp-encoding-for-gear-optimization.md) —
  owns the `pinnedIds` dominance-exemption seam trap 3 is a hazard note on. It sanctions
  widening `pinnedIds` without noting that the set thereby stops meaning "the player's pins".
- [`browse-visibility-for-separate-source-pools.md`](browse-visibility-for-separate-source-pools.md) —
  the only other view-layer doc; nearest neighbour for the "never infer state from a
  rendered artifact" rule.
- `docs/plans/2026-08-05-003-feat-off-hand-dual-wield-plan.md` — the plan whose KTD1,
  KTD2, and KTD6 notes are the primary-source record of all three traps.
- Issue #137 (the report), PR #160 (the fix), issue #107 (the predecessor that produced
  the escape-hatch doc), issue #111 (sword-and-board shield size/type selection — the next
  feature likely to narrow off-hand candidacy and face all three traps).
