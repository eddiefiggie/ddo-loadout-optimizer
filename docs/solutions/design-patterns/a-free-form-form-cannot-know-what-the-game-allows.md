---
title: "A free-form form cannot know what the game allows"
module: web
date: 2026-09-18
problem_type: design_pattern
component: custom-items
severity: medium
tags:
  - player-input
  - essence-crafting
  - placement-rules
  - pickers
  - disclosure
applies_when: >
  Building a form that lets a player describe a real in-game object, where the
  game constrains which parts can go where.
---

## The problem

#773 let a player describe gear the catalog lacks: name, slot, minimum level, and
up to twelve free-form effects, each a stat plus a bonus type plus a number. The
vocabulary was constrained — a stat outside the picker list was refused — but
**placement was not checked at all**. Nothing stopped a player putting `Assassinate`
on a helmet, and nothing told them that the enchantment they actually crafted has a
published magnitude the tool already knew.

Free-form input is the right default when you do not know the shape of what the
player is describing. Here the shape was known, sourced, and sitting unused in the
repo.

## What made the refactor possible

`data/seed/compendium/essence_crafting.json` carries `placements` for all **16**
essence-craftable item groups — 708 placements, harvested verbatim from
`Essence Crafting/table 1b`. `src/essence_pool.py` uses only the fully-sourced
intersection of it, and correctly so: it feeds the SOLVER, where an effect with a
guessed bonus type either double-counts against real gear or wrongly collapses
with it.

The builder is a different question, and the difference is **who supplies the
number**:

| | who supplies bonus type and value | how much of the table is usable |
| --- | --- | --- |
| `essence_pool` (solver) | the wiki, or the effect is withheld | 36 of 708 |
| `essence_placements` (builder) | the player, disclosed as theirs | 523 of 708 |

So the bar that legitimately binds one does not bind the other. Reusing one
module for both would have meant either withholding 487 placements from a player
describing gear they are holding, or letting guessed types into the solver.

## The shape of the fix

- The build publishes the whole table with a per-row `sourced` marker and the
  effect-to-catalog-stat join already applied.
- The form renders **one row per menu the item actually has** — not a
  grow-your-own list with an "+ Another effect" button. An Essence Crafted item
  carries one enchantment per menu, so a list offers a shape the game does not
  have, and lets a player build two Prefixes and be refused on save.
- Where the wiki publishes the bonus type AND the ML curve, the form fills both
  and **locks** them. That value is not a player assertion and must not be labelled
  as one — though the ITEM stays player-authored, because owning it is the
  unverifiable claim either way.

## Three things that had to be refused rather than guessed

- **`Quiver`** maps to no group. The empty list is the sourced statement that
  quivers cannot be crafted, and a guard fails if a group is ever invented for it.
- **Thrown weapons and Handwraps.** `table 1b` names "Melee weapons" and "Ranged
  weapons" and never says which DDO weapon types are in each. The obvious shortcut —
  read `WeaponTaxonomy.STYLE_OF_TYPE` — is wrong, because its axis is *handedness*:
  it marks all five thrown types `one-hand`, and thrown weapons are one-handed AND
  ranged. Reading it here would be asking a source a question it does not answer.
- **185 unrankable placements** naming umbrella stats (`Spell Lore` and friends)
  that are expanded away before a player sees a picker. Withheld from the published
  table entirely: a row that can be chosen and can never score is not reference
  data, it is a trap.

## What the guards caught that review did not

Four defects, none found by reading:

1. **The container gate** refused the new top-level key until it was declared as a
   non-container, with the reason it is not a solver pool.
2. **`test_spell_focus.py`** found the 52 umbrella-named rows (185 placements) in
   the first cut of the table.
3. **The curve-join allowlist** refused a second caller. Admitting it was only
   legitimate alongside a new assertion that every sourced row really did pass both
   of the pool builder's checks — widening an allowlist without that is weakening a
   guard to make new code pass.
4. **Opening the form in a browser** found an orphaned `<datalist>` still
   interpolating a deleted variable. The whole panel threw on open, and every test
   was green: the source-slice guard checked for the `list="…"` attribute and not
   for the element. It also found a stale-draft bug where `onchange` re-rendered
   the bench from the previous minimum level.

## Rule

When the game constrains what can go where, and that constraint is already
harvested, the form should **be** the constraint rather than validate against it.
And a UI change is not verified until the UI has been opened — a source-slice test
proves a string is present, not that the panel renders.
