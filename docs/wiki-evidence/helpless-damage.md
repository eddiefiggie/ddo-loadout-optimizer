# Wiki evidence — helpless damage is ONE stat (#305)

**Harvest:** Claude-in-Chrome, same-origin read of ddowiki, 2026-08-13.
**Source:** `https://ddowiki.com/page/Helpless`, section "Increasing extra damage
vs helpless opponents" — the hub page lists every gear source of the mechanic in
ONE unified table, which is the equivalence statement #305 needed:

> Items — Silent Avenger set: 5% / 10% (3 pieces); Part of the Family: 5% / 15%;
> Perfected Wrath: 15%; Eminence of Spring: 15%; Eminence of Summer: 15%;
> Desert's Starless Nights: 5% / 10% / 15%; Kundarak Delving Equipment:
> 5% / 10% / 15%; Huntmaster's Favor: 15%; The Labyrinthian Inferno: 15%;
> Dread Stalker: 15%; Temple's Inferno: 5% / 15%; The Fury's Rage: 5% / 15%
> (Lost Purpose); Delight of the Devourer: 5% / 15% (Lost Purpose); The
> Traveler's Guidance: 5% / 15% (Lost Purpose); Curse of Cruelty (Deck of Many
> Curses): 2%.
> Augments — Solar Gem of Cruelty (Heroic) 5%; Solar Gem of Cruelty (Legendary)
> 15%; Cruel Cut: 15% (3 piece augment set).

Corroborating: `Lunar_and_Solar_Gems` Solar table row (harvested 2026-08-13 for
#290): `Cruelty — Artifact Bonus to Damage to Helpless Enemies +5% +10% +15%`.
The mechanic is percent extra damage against helpless targets; every gear source
above is Artifact-typed in the dataset with values matching this table.

## The fragmentation this resolves (census, built dataset 2026-08-13)

Canonical (rankable, carried by the Solar Cruelty gems): `Damage to helpless enemies`.

Fold-away spellings verified in solver-relevant channels:

| Spelling | Channel | Sets |
|---|---|---|
| `Additional Damage to Helpless Targets` | membership defs | (Legendary) Delight of the Devourer, The Fury's Rage, The Traveler's Guidance |
| `damage vs. helpless` | membership defs | Dread Stalker |
| `Damage vs. Helpless` | augment set defs | Cruel Cut |
| `damage versus the Helpless` | item-attached set tiers | Eminence of Spring, Eminence of Summer |
| `Helplessness Damage` | item-attached set tiers | Kundarak Delving (x3), Legendary Perfected Wrath, Temple's Inferno (x2) |
| `damage vs the Helpless` | item-attached set tiers | Huntmaster's Favor, Part of the Family (x2), The Labyrinthian Inferno |
| `Damage vs the Helpless` | item-attached set tiers | The (Legendary) Desert's Starless Nights |
| `Damage vs. the Helpless` | item-attached set tiers | The Epic Desert's Starless Nights |
| `Damage vs. Helpless opponents` | item-attached set tiers | Remodeling Renegade (x2) |
| `Damage vs. Helpless Opponents` | item-attached set tiers | Silent Avenger (x2) |
| `damage vs. the helpless` | inert `dino_sets` only | Dread Stalker (raw wiki text) |

**Co-occurrence check (fold precondition):** no item and no single set def carries
two of these names — the same-container co-occurrence rule does not bar folding.

**Units, recorded not normalized:** the mechanic is percent per the wiki, but the
stored `unit` markers are inconsistent (`None` on the native carriers, `flat` on
most set tiers, `pct` on Cruel Cut). This fix folds NAMES only; unit markers stay
as stored, because the bucket key is `(stat, bonus_type)` and every source is the
same Artifact percent magnitude. If unit-sensitive ranking (#189) ever lands,
these markers need a pass.

**Out of scope, recorded:** `Curse of Cruelty (Deck of Many Curses): 2%` appears
on the wiki page but nowhere in the dataset — missing content, not fragmentation.
Non-gear sources (feats, enhancements, destiny mantles) are out of the optimizer's
domain.
