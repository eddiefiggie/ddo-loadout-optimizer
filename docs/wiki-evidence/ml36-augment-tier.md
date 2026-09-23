# Wiki evidence — the ML36 augment tier (#260)

**Status:** RETIRED 2026-09-22 — upstream carries the tier natively. See the closing section.
**Verified:** 2026-08-12 (Chrome-MCP, same-origin from a ddowiki tab)
**Sources:** https://ddowiki.com/page/Category:Minimum_level_36_augments (the
category table and membership list) and each member's `Item:` page (two batched
`prop=revisions` API calls, 32 + 31 titles; every entry's verbatim description
is recorded in the shard).

## The gap

A 2026-08-12 player report ("it has never suggested a level 36 augment") led
here. gear-planner's `crafting.json` — checked against upstream `master` the
same day, not just our vendored snapshot — tops out at **ML32** in every color
pool. The wiki's category holds **63 ML36 augments**: the top tier of the sale
lines (Diamond ability +15 / skill +22, Ruby spell power 166 / damage dice
10d6, Sapphire defenses, Topaz resistances 50 and Melee/Ranged Power +14). ML33
and ML35 categories do not exist; ML34 (168 pages) is the Dolorous/Melancholic
system, tracked separately as #261.

## What was recorded, and the vocabulary rule

The shard is `data/seed/compendium/ml36_augments.json`, loaded and guarded by
`src/ml36_augments.py`. Each entry records the page's **verbatim description**
(the slotted-effect tooltip: "Drag this augment into a slot to upgrade an item
with a +15 Enhancement Bonus to Strength…"), its wiki URL, its color (from the
item template's `type` field), and its **gear-planner sibling** — the highest
same-family augment upstream (`Diamond of Strength +14`, ML32).

The sibling is the vocabulary anchor: the emitted affix `(name, type)` is the
sibling's, asserted at build time, so the new tier speaks exactly the language
the pool already speaks. Two wordings that would otherwise tempt a re-mapping
are settled by that rule:

- **"Protection bonus" is the Deflection bonus.** `Sapphire of Protection +12`
  emits `Armor Class`/`Deflection`, like its +11 sibling and like the 169 worn
  affixes already typed `Deflection` in the dataset.
- **The elemental resistances state no bonus-type word** ("absorb the first 50
  points of Acid damage…"). The type is the sibling's (`Enhancement`), not a
  fresh reading.

Only the **value** is new, and the guard re-derives it from the entry's own
name token (`+22`, `166`, `(10d6)`, `50`) and requires it verbatim in the
recorded tooltip.

## The guards (all proven to fire in `tests/test_ml36_augments.py`)

- An entry whose name **appears upstream** fails the build — gear-planner added
  the tier; retire the shard entry rather than shipping a duplicate.
- A **vanished or re-typed sibling** fails the build — the anchor is broken.
- A tooltip that **stops stating the value** fails the build.
- An **empty shard** or an injection that touches nothing refuses to pass.

## Measured effect

At ML36, 33 of the 63 strictly beat every worn source in their bucket
(`Topaz of Melee Power +14` vs worn max 8; the +22 skill Diamonds vs worn max
20–21; the 166 Ruby spell powers vs worn max 156–162). Real-HiGHS solve,
targets `[Melee Power, Balance]`, ML36: **42/43 before → 44/44 after**. The
ability Diamonds (+15 Enhancement) are shadowed by worn endgame gear in pure
single-lens solves and earn their keep under slot pressure — that is the game
working as designed, not a gap.


---

## Retirement (2026-09-22)

The shard is gone. The 397c673 (2026-09-23) gear-planner re-vendor carries all 63 ML36
augments natively in every color pool, which is the exact condition the shard's own staleness
guard named as its retirement trigger: *"An entry whose name appears upstream fails the build
— gear-planner added the tier; retire the shard entry rather than shipping a duplicate."*

What was removed: `data/seed/compendium/ml36_augments.json`, `src/ml36_augments.py`,
`tests/test_ml36_augments.py`, the `load`/`check`/`inject` calls in `build_dataset.py`, and
the `metadata.ml36_augment_coverage` block (which nothing consumed).

What was kept: the 63 harvested tooltips, moved verbatim to
`docs/wiki-evidence/ml36-augment-tier-harvest.json` as an evidence artifact outside the seed
tree, so nothing can load it as a build input again. Retirement records evidence; it does not
delete it.

### The adjudication, per record

All 63 are present upstream. Compared against the catalog **after** `affix_name_corrections`
runs — comparing against the raw dump instead is what produced a first, wrong answer of 12
divergences, nine of which were only our canon (`Combustion`) meeting upstream's alias
(`Fire Spell Power`) before the rename that reconciles them.

- **59 byte-identical** on (name, type, value), pool and ML.
- **4 divergent**, all the elemental dice: `Ruby of Acid / Flame / Frost / Shock (10d6)`. This
  shard stored the dice count as the affix VALUE (`Bool 10`); upstream stores `Bool 1` at all
  ten tiers of each family and keeps the dice count in the item NAME. **Resolved in upstream's
  favour**, on two grounds: it is internally consistent across every sibling where ours was an
  outlier against its own nine, and `Bool` is a PRESENCE type (`web/dataset.js`
  `PRESENCE_TYPES`), so the value is never ranked as a magnitude and the change is
  behaviour-neutral. Our `10` was a latent defect, not a loss.

The augment SET the solver sees is therefore unchanged by this retirement — only the
provenance moved, from our wiki harvest to upstream. `Solar Gem of Arcana` (Heroic and
Legendary) made the same journey out of `augment_tier_gap.json` at the same refresh, at our
exact values, and upstream additionally supplies the acquisition quest we never had.

### What is NOT retired

`augment_tier_gap.json` survives with 82 entries. Upstream still carries only 17 Epic
(ML 20) Lunar/Solar gems out of 103 families, so that gap is real and unchanged — including
`Solar Gem of Arcana (Epic)`, now the only tier of its family upstream does not carry.
