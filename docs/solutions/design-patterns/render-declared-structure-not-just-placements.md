---
title: "A surface built from placements under-reports declared structure, and the gap looks exactly like missing data"
module: results
date: 2026-08-20
problem_type: design_pattern
component: ui
severity: high
tags:
  - display
  - crafting
  - viktranium
  - lamordia
  - projection
  - exports
  - disclosure
applies_when:
  - An item DECLARES a fixed structure (craft slots, augment slots, tiers) that the solver then fills or does not fill
  - A surface renders one row per PLACEMENT the solver made, rather than one row per declared unit
  - A player is expected to reason about what the item can hold, not only about what the solve chose
  - A grouping primitive scans some carrier channels and a new channel later starts carrying the same key
---

## Context

The Viktranium (Lamordia) system gives an item a fixed set of craft slots — `lamordia_slots: [{type, category}, ...]`, up to four. The solver fills a slot only when some option in that slot's pool advances a ranked stat; otherwise it places nothing there.

`craftSlotChips` built its chips from `maps.vikByItem` — the **placements**. So a slot with no scoring option rendered *nothing at all*. An item that ships with four slots displayed as a three-slot item, and the player had no way to tell that apart from "this tool has no data for that slot."

That ambiguity is not hypothetical. It is how [#365](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/365) was reported: *"I've done loadouts with The Deathly Shroud and it didn't put anything in the Woeful slot."* The report was read as a missing-option bug and triaged as a pool gap. The pool gap was real, but the reason the player could *see* it as an absence — rather than as an empty slot — was this rendering choice.

It was never a single-item quirk either. At ML36 the Legendary Cataclysmic Buckler declared 4 slots and rendered 1; the Legendary Calamitous Bastard Sword declared 4 and rendered 1; the Legendary Contraption Keyring declared 3 and rendered 2.

## Guidance

**Render the declared structure, and mark the unfilled units — do not let them vanish.**

Ask which the unit is:

- **Discretionary** (an augment slot the player may leave open): rendering only what was placed is fine.
- **Identity** (a Lamordia slot; a seal slot; a tier the item ships with): the unit exists whether or not the solve used it, so it must appear, marked as unfilled, with the reason.

Derive the unfilled set as a **multiset difference** against the declared list, from one shared helper both the app and the exports read:

```js
function unfilledVikSlots(variant, placed) {
  const declared = (variant && variant.lamordia_slots) || [];
  if (!declared.length) return [];
  const filled = new Map();
  for (const p of placed || []) filled.set(p.slot_type, (filled.get(p.slot_type) || 0) + 1);
  const out = [];
  for (const slot of declared) {
    const n = filled.get(slot.type) || 0;
    if (n > 0) { filled.set(slot.type, n - 1); continue; }   // consume one, don't clear the type
    out.push({ slot_type: slot.type, category: slot.category || null });
  }
  return out;  // then sort by the registry's declared slot order
}
```

A set difference would be wrong: an item declaring two slots of one type would show zero open after one craft landed.

**Say why it is empty, not just that it is.** `left empty — no option adds to your ranked stats` distinguishes "the pool holds nothing that helps you" from "we have no data here." A bare "empty" reproduces the original ambiguity in fewer pixels.

**The same blindness applies to grouping primitives, not just chips.** `bundleGroups` collected `via`-stamped multi-stat enchantments from items and placed augments — the two channels that carried `via` when it was written. Since then the crafted pools started carrying it too: 24 Viktranium options, 12 Nearly Complete, 7 Dino inserts. Every one of those bundles was fully credited in the solve and named nowhere, which is the "solve-visible but share-invisible" shape this project has ruled against. Widening the scan is the same lesson one level up: enumerate the channels that *can* carry the key, not the ones that carried it the day the code was written.

When widening, scope the claim to what a fixture can falsify. `rollPlaced`/`sealPlaced`/`tfPlaced`/`gsPlaced` are flat single-affix records with no `affixes` array, so they cannot reach a 2+ member floor at all. They are left unscanned deliberately, and the guard asserts that **of the data**:

```js
for (const key of ["rollPlaced", "sealPlaced", "tfPlaced", "gsPlaced"]) {
  assert.ok(r[key].length, `${key} guard inspects a real record, not an empty list`);
  for (const o of r[key]) assert.ok(!Array.isArray(o.affixes), `${key} records carry no affixes array`);
}
```

Asserting the scan list instead would restate the code; asserting the data means the guard goes red the day one of those channels gains a multi-affix option.

## Why This Matters

A dropped unit is not a cosmetic gap — it is a **false negative the player cannot distinguish from a data gap**, so it converts into a bug report about the wrong thing. #365 spent a full investigation on the Woeful pool's contents because the empty slot presented as an absence rather than as a slot.

It also compounds badly with `docs/solutions/conventions/exclude-until-verified-data-gates.md`. This project's whole credibility argument is that a visible gap beats a confident wrong number. A slot that silently disappears is the opposite: an *invisible* gap, presented as a complete answer.

## When to Apply

Reach for this whenever a render loop iterates the solver's output where the item's declared structure is what the player is reasoning about:

- Craft-slot chips and their export equivalents (this case).
- Any future per-declaration surface: seal slots, Thunder-Forged tiers, per-item upgrade pools.
- Any `via`/provenance grouping primitive, whenever a new pool starts stamping the key.

The tell during review: the loop's source is a `*Placed` list or a `byItem` map built from one, while the thing on screen is described to the player as a property of the item.

## Examples

Before — chips come from placements only, so an unfilled slot is indistinguishable from no slot:

```js
const viks = (maps.vikByItem.get(v.variant_id) || [])
  .map((n) => `<span class="chip lamordia">${esc(Proj.craftLabel(n, "vik"))}</span>`);
```

After — the declared-but-empty slots are disclosed, from the shared helper every export also reads:

```js
const vikPlaced = maps.vikByItem.get(v.variant_id) || [];
const viks = vikPlaced.map((n) => `<span class="chip lamordia">${esc(Proj.craftLabel(n, "vik"))}</span>`);
viks.push(...Proj.unfilledVikSlots(v, vikPlaced).map((s) =>
  `<span class="chip lamordia unfilled">${esc(Proj.craftLabel(s, "vikEmpty"))}</span>`));
```

The unfilled entry also rides `craftingForItem`, so the shared projection carries it into all six exports — the app and the share cannot disagree about how many slots an item has.

Shipped in [#395](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/395), closing [#370](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/370). The same PR's investigation is a second, smaller lesson worth keeping: **both causes the issue proposed were wrong.** #370 named the augment channel and a Sets-tab filter; a headless repro against real data disproved both in minutes and pointed at a channel nobody had listed. Reproduce before fixing what a report *says* is broken — see `docs/solutions/developer-experience/browser-verify-against-real-data-not-just-unit-tests.md`.
