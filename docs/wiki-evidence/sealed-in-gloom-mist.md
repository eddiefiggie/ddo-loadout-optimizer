# Wiki evidence — the Sealed in Gloom and Sealed in Mist pools (#195)

**Verified:** 2026-08-15 (Chrome-MCP, same-origin from a ddowiki tab)
**Sources:** https://ddowiki.com/page/Sealed_in_Gloom ·
https://ddowiki.com/page/Sealed_in_Mist ·
https://ddowiki.com/page/Augmentation_Altar ·
https://ddowiki.com/page/Ritual_Table (negative finding)

`Sealed in Gloom` and `Sealed in Mist` are the last two members of the seal
family, on **Den of Vipers** raid loot (Temple of Silith-tar, U72). Both pools
sat unsourced, so all 22 hosts had an inert slot. The Mist half had a named
player report (2026-08-14 batch): *"It's not seeing Clank's Sealed in Mist
attribute."*

## They unseal at the Augmentation Altar, not the Ritual Table — CONFIRMED

The Ritual Table page has **no Gloom or Mist section** (its only seal sections
are *Sealed in Fire weapon upgrades* and *Sealed in Undeath clothing / jewelry
upgrades*; the Gloom/Mist-adjacent headings there are item-creation recipes).
Both enchantment pages state the venue outright:

> "It can have its power unsealed at the **Augmentation Altar**, adding one
> effect. Attempting to add another will remove the original."

That is the family's single-pick wording verbatim, so both are the same
select-one choice slot as Undeath and Fire. The
[Augmentation Altar](https://ddowiki.com/page/Augmentation_Altar) (found inside
the Den of Vipers raid, upgrades cost **20 Hydra Scales**) states the mutual
exclusion per row: *"Removed: Any previous added Augmentation Altar effects"*.
The page also notes that applying an effect does not remove the Sealed-in-Mist
marker itself — the effect can be replaced later.

## The Mist pool — CONFIRMED, six options, single-pick, weapons

From the Augmentation Altar table, each option applies to *"Raid Den of Vipers
Weapons"*, requirement *"Sealed in Mist item"*. The six options: **Legendary
Affirmation, Legendary Ash, Legendary Dust, Legendary Ooze, Legendary Salt,
Legendary Vacuum.**

These are the **same six `{{Unique enchantment}}` procs as the Fire pool**,
already effect-verified page-by-page during the Fire harvest — five reduce an
*enemy* stat, one grants temporary hitpoints on a cooldown, none grants the
wearer a persistent magnitude (`docs/wiki-evidence/sealed-in-fire.md` records
the effect text verbatim). Presence is the accurate reading, and the same six
names already ship as `Bool` presence via Fire, Viktranium, and the Dino
inserts — Mist is a **fourth crafting route to effects the dataset already
models**, not a new modelling decision.

Matches the native `Sealed in Mist` pool in `gearplanner_crafting.json`
exactly (six Bool options, same names).

## The Gloom pool — CONFIRMED, 18 options, single-pick, equipment

From the Augmentation Altar table's *Ability bonus* row, applying to *"Raid Den
of Vipers Equipment"*, requirement *"Sealed in Gloom item"*: select one of the
six abilities (Strength / Constitution / Dexterity / Intelligence / Wisdom /
Charisma) at **+15**, the same at **Insightful +7**, or the same at **Quality
+3**. 18 options — the same shape as Undeath.

**The bonus types are wiki-stated, not inferred.** The rendered cell says only
"Strength +15", but the tooltip layer behind every entry links the bonus type
explicitly: each +15 entry carries an **Enhancement bonus** link, each +7 an
**Insight bonus** link, each +3 a **Quality bonus** link. (The
bundled-template-values-live-in-the-tooltip rule, applied in the confirming
direction for once.) This also re-confirms the native catalog's
`Insight`-not-`Insightful` typing.

Matches the native `Sealed in Gloom` pool in `gearplanner_crafting.json`
exactly (18 options: six abilities × Enhancement 15 / Insight 7 / Quality 3).

## Hosts — CONFIRMED, exact match

Both enchantment pages enumerate their hosts, and they match the gear-planner
markers exactly, all ML 33:

- **Mist: 18 weapons** (the page's list = our 18 `crafting[]` markers,
  including `Clank, the Echo of Despair`).
- **Gloom: 4 accessories** — `Rocard, Champion's Cuffs` (Bracers),
  `Trifalny, Gauntlet of Grace` (Gloves), `The Hydra's Heart` (Trinket),
  `Syne, the Way of the Melody` (Goggles).

Unlike Fire (which had seven zero-affix seal-only weapons needing
re-admission), **every Gloom/Mist host carries base affixes**, so none is
pruned by the verification gate.

## What this does not settle

The Mist procs inherit the #214 limitation recorded for Fire: proc rates and
uptime are invisible to the solver, so all six are indistinguishable once
present. Nothing new is worsened.

With this harvest the seal family is **complete**: all four pools
(Undeath, Fire, Gloom, Mist) are verified and solver-live.
