---
title: "A separate source pool is invisible to list views that iterate items[]"
module: web-ui
date: 2026-07-25
problem_type: design_pattern
component: ui
severity: medium
tags:
  - ddo
  - browse
  - data-model
  - projection
  - solver
  - view-layer
applies_when:
  - "A new stat/effect source is modeled as its own collection, not merged into the canonical items array"
  - "An inventory/browse/list view iterates only the canonical collection"
  - "Users report new content is missing from the browser even though the optimizer uses it"
---

# A separate source pool is invisible to list views that iterate items[]

## Context

The optimizer's stat sources are deliberately not all the same shape. Worn items live in `dataset.items[]`; augments, set bonuses, and Isle of Dread **Dino inserts** are separate pools the solver reads as distinct source families (see `docs/solutions/design-patterns/milp-encoding-for-gear-optimization.md`). Keeping the Dino insert pool as its own `dataset.dino_inserts` array is correct for the solver — it is a placement pool, not an equippable item.

But the item **browser** (`web/browse.js`) only ever iterated `dataset.items[]`. So the 55 Dino inserts never appeared in the inventory at all, and the 8 Dinosaur Bone blank *hosts* (which are in `items[]` but carry their value in typed Dino slots, not affixes) rendered as bare `—` rows. The feature optimized correctly, yet a user browsing "what Isle of Dread gear exists" found nothing — the exact report that surfaced this.

## Guidance

**When a source is modeled as its own pool for computation, it will not appear in any view that iterates the canonical collection. Reconcile the two with a display-only projection at the view layer — do not merge the pool into the canonical array.**

Build a pure function that returns *canonical items plus the auxiliary pool mapped into display rows*, and have the view render that instead of the raw array:

```js
// web/browse.js — display-only; the solver still reads dataset.dino_inserts.
function dinoInsertRow(ins) {
  return {
    variant_id: `${ins.dino_type}: ${ins.stat}`,
    slot: `Dino Insert (${ins.dino_type})`,
    verification: "verified", minimum_level: 31,
    affixes: [{ stat: ins.stat, bonus_type: ins.bonus_type, value: ins.value, unit: ins.unit || "flat" }],
    wiki_url: ins.wiki_url, dino_insert: true,
  };
}
function browsableItems(dataset) {
  return (dataset.items || []).concat((dataset.dino_inserts || []).map(dinoInsertRow));
}
```

And surface a host's non-affix value too — a blank's typed slots are its whole point:

```js
if ((v.dino_slots_norm || []).length) parts.push(`Isle of Dread slots: ${v.dino_slots_norm.join(" / ")}`);
```

Because the projection produces the same row shape as a real item, the existing filter/search/stat machinery works over it unchanged. (Fixed in PR #3.)

## Why This Matters

The two requirements pull in opposite directions: the solver wants sources as *clean, typed pools* (a Dino insert is not an item and must not be equippable), while a human wants *one browsable inventory of everything*. Injecting display rows into `items[]` to satisfy the browser would corrupt the solver's model (phantom equippable items). Merging at the view layer satisfies both: the canonical data stays honest, and the projection is throwaway. The alternative — leaving the pool invisible — means the content is real and optimized but un-inspectable, which reads to a user as "the feature isn't there."

The same trap applies to any non-affix value a list view assumes lives in `affixes[]`: a slot-only host, a set membership, an augment-slot color. If the row renderer only reads `affixes`, those items look empty. Surface the real value.

## When to Apply

Any time you add a stat/effect source as its own collection alongside `items[]` (the deferred Dino Weapon/Armor/Raid pools, filigree pools, a future crafting family) — add it to `browsableItems`' projection in the same change, or it silently won't be inspectable. Keep the projection pure so it stays unit-testable (`browsable pool row is findable by stat/type`, `blank surfaces its slots`) without a DOM.

## Examples

- **Before:** `Dinosaur Bone Boots · Boots · 31 · verified · —` and the 55 inserts absent; browser showed 182 items.
- **After:** `Dinosaur Bone Boots · … · Isle of Dread slots: Scale / Fang / Claw / Horn`, and `Scale: Fire Spell Crit Damage · Dino Insert (Scale) · … · +20%`; browser shows 237, inserts findable by the stat filter, the slot dropdown, or a text search on the type.

## Related

- `docs/solutions/design-patterns/milp-encoding-for-gear-optimization.md` — why the sources are separate pools in the first place (the solver-side rationale this view-layer pattern reconciles).
