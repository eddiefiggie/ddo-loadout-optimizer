# Weapon exclusivity: which one-handed weapons may be wielded twice (#902)

**Harvested 2026-10-17** from ddowiki category membership, same-origin through the in-app Browser pane. Shard: `data/seed/compendium/weapon_exclusivity.json`, read by `src/weapon_exclusivity.py`, which stamps `duplicable_weapon`.

## The ruling

**A one-handed weapon may be wielded as two copies, one per hand, unless it is Exclusive or a Minor Artifact.** This is the ring ruling (`ring-exclusivity.md`) applied to the hands. The mechanic quotes and the argument for reading category absence as a stated negative are there and are not repeated here.

| Population (one-handed weapon pages the catalog links to) | Count |
|---|---:|
| Pages | 2,528 (2,531 records) |
| Exclusive (`Category:Exclusive`) | 17 |
| Minor Artifact (`Category:{1,3,4,5} Slot Minor Artifacts`) | 0 |
| No binding category, quarantined | 2 |
| **Duplicable** | **2,509** |

The 17 Exclusive weapons are:
- the Echo / Legendary Echo / Reflection of the Artblade, Crownblade and Warblade
- the three Hellfire Crossbows
- three Epic Ornamented Daggers
- both Scepters of the Ogre Magi
- the Short Broom of Mystery

All 17 also appear by name in the Exclusive list read in the same session, which corroborates the hash match.

The two quarantined pages are `Silver Blade of the Flame` and its Legendary tier. Neither page is in any binding category Template:Bind emits (Binds on acquire, Binds on equip, Unbound). With no binding recorded, the template's `exclusive` default cannot be read as a stated "no", so they are refused rather than defaulted.

The catalog's own `artifact` flag agrees with the wiki: no one-handed weapon is a Minor Artifact on either side. `check` fails the build if that drifts.

## Method

1. List every `Item:` member (namespace 500) of the eight categories through the MediaWiki API, paced at about 1.5 s.
2. The Browser pane cannot hand a dump to disk, and its privacy guard strips `| = & ?`. So the 2,528 catalog titles crossed as SHA-256 prefixes (8 hex characters each) in one string. Its digest was checked on both sides (`e9fdefece96b`). The page then returned only the exception indexes, which were mapped back to titles locally.
3. Population: every catalog weapon where `web/model.js` `isBothHandsWeapon` is false. That covers 32 weapon types, disjoint from the two-handed types (measured). They are listed in the shard as `population_types`, and `check` fails the build when a weapon of those types has no entry.

## What the solver does with it

- One weapon x-var is still capped at one hand. A second copy is a second item, so a duplicable weapon gets an appended off-hand twin: id `X::twin`, tied to `X` in the main hand.
- The twin is minted only where the off hand already offers the weapon, so the TWF declaration and the off-hand type picks still decide legality.
- The twin carries its own augment and crafting slots and counts as a set piece. *Last Line of Defense* (two Kindlings) now completes in a free solve.
