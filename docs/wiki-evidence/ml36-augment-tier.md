# Wiki evidence — the ML36 augment tier (#260)

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
