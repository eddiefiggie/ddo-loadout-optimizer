# Augment acquirability — the wiki's rarity taxonomy is the answer (#359)

**Ruled:** 2026-08-20. **Method:** same-origin harvest per `harvest-method.md`;
`action=query&list=categorymembers` over the rarity categories, paged on
`continue.cmcontinue`, ~1.5s apart. **Shard:**
`data/seed/compendium/augment_acquirability.json`. **Guard:**
`src/augment_acquirability.py` + `tests/test_augment_acquirability.py`.

## The question

Owned-augment mode (#359) needs to know, per augment: **can a player obtain
this without a specific named drop?** Restricting the pool to only what a
player's Trove export lists would cut 1,063 augments to about 123 — deleting
most of the pool, and most of what it deletes is gear nobody farms. You buy a
`Diamond of Constitution +12`; you do not hunt one.

## Why the name is not the answer

The tempting rule is the gem family: `Diamond of …` / `Ruby of …` / `Sapphire
of …` are the standard lines, so treat them as obtainable. That is exactly the
inference `AGENTS.md` forbids, and it is wrong on this data — the catalog
carries named Rubies and Diamonds that drop from one place, right beside the
vendor ones. `Meteoric Star Ruby` and `Ruby Eye of the Inferno` are not
`Ruby of Flame (2d6)`.

Nothing in our own data answers it either: `crafting` is `null` on all 1,063
augment records, and `location_quest` and `binding` are empty on every one.

## The ruling

The DDO wiki classifies **every** augment by rarity, and that taxonomy is the
split this feature needs:

| Category | Members | What it means |
| --- | --- | --- |
| `Category:Common augments` | 668 | vendor / Mysterious Remnant / generic chest loot |
| `Category:Uncommon augments` | 6 | the `Ruby Eye of …` line |
| `Category:Rare augments` | 1 | `Meteoric Star Ruby` |
| `Category:Named augments` | 1051 | one specific source — must actually be owned |

Corroborated by `Augment Slot/Purchasable Augments`, verbatim:

> Augments drop randomly in level-appropriate chests, the dragon gold piles in
> Return to Gianthold Tor, and can be bought from the DDO Store, but **some (if
> not all) augments can also be bought in-game for items found or earned in the
> normal course of questing.**

> **Mysterious Remnants can be traded in for augments of ML 1-20.**

and by the vendor coverage the same page describes: the Gianthold public area
sells ML 12/16/20/24 augments, and the `Randall Lyric` NPC line sells heroic
and legendary augments appropriate to their location.

**So: acquirable = Common ∪ Uncommon ∪ Rare = 675 names.** The seed holds
exactly those.

## Absence is a positive statement

A name **not** in the shard is drop-specific and usable only when the player's
own export lists it. That is a ruling, not a coverage gap — the complement is
`Category:Named augments`, and it is enumerated. This matters because the
normal reading of a missing entry in this repo is "not yet verified"; here it
is "verified as the other thing".

## The join, and why the guard asserts equality

All **675 of 675** seeded names matched a catalog augment by exact
`variant_id` at harvest time — zero unmatched in either direction. Because the
join was complete, the build guard asserts equality rather than a threshold: a
short join is upstream drift, not a known gap.

The failure it prevents is quiet. If a rename moved an augment out of the seed's
reach, it would silently reclassify from "anyone can buy this" to "you must own
this", and owned-augment mode would forget gear the player can trivially get —
with nothing on any surface saying so.

## Counterfactual

Measured on the real sample export at ML34, priorities Constitution > Strength >
Physical Sheltering:

```
owned items, ALL augments (today)          1063 augments   Con 37 / Str 36 / PS 125
owned items, owned + acquirable (#359)      745 augments   Con 34 / Str 33 / PS 124
```

Three points of Constitution and Strength, one of Physical Sheltering — the
honest cost of a loadout the player can actually assemble. And 745 rather than
123 is the whole argument for `owned ∪ acquirable` over strict-to-the-export.

## Re-harvesting

The categories are stable and enumerable; re-run when the augment roster grows:

```
action=query&list=categorymembers&cmtitle=Category:Common augments&cmlimit=500&cmtype=page
```

paged on `continue.cmcontinue`, then strip the `Item:` / `Augment:` title
prefixes. Bring the result back through the windowed export bridge described in
`harvest-method.md` — rendering the payload into the page and reading it with
`get_page_text` returns the whole set in one call, where the JS return channel
truncates near 1,000 characters.
