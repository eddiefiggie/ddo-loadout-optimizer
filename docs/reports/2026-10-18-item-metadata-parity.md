# Item metadata parity: our wiki harvest against gear-planner (#906)

Harvest `items-20261018`: 8,072 pages, 2026-10-18. Comparator: gear-planner pinned at c36b45e, 8,222 records. Produced by `python3 scripts/diff_harvest_meta.py items-20261018`.

| Field | Equal | Ruled: wiki right | Ruled: keep gear-planner | Page edited after the pin | We decline to read | Unruled |
|---|---:|---:|---:|---:|---:|---:|
| Minimum level | 8,205 | 1 | 0 | 7 | 9 | **0** |
| Slot | 8,215 | 0 | 6 | 0 | 1 | **0** |
| Type | 8,213 | 2 | 6 | 0 | 1 | **0** |
| Quests | 8,076 | 11 | 0 | 0 | 135 | **0** |

## What the categories hold

- **Minimum level 0 → 1 (186 pages):** the wiki writes 0 for "no minimum"; the catalog uses 1 for the same fact. This is a stated convention in `src/wiki_item_meta.py`.
- **Edited after the pin (7):** Cloak of Night tiers whose pages state the real level. gear-planner has 1. `item_ml_corrections.json` already corrects them.
- **Wiki right:**
  - 10 Sharn minor artifacts, where gear-planner's "Sharn quests" is a grouping label and the page names the quest.
  - Fire Touch Heavy Mace (Cannith, not Essence, Crafting Tutorial).
  - Two armor types gear-planner contradicts on the same revision.
  - Bottled Fear's ML 5 (edited hours before the pin).
- **Keep gear-planner (12 field rulings):** Chains, Five Rings and Shackles (and their Legendary tiers) can be worn in either of two slots. The page records one and gear-planner the other. Modelling both is #915.
- **Declined (never infer):**
  - 9 pages state no minimum level. gear-planner fills in 1.
  - *Leaves of the Forest* is a family index page the build already drops.
  - 135 Night Revels pages migrated on 2026-10-17 now state a `turn in` recipe instead of a quest.
- **Not compared:**
  - `rare`. gear-planner reads it from the rare-loot page, not item pages (#916).
  - `pack`. It is not on item pages; it comes from the quest via our pack mapping.

Every ruling, with its evidence, is in `data/seed/compendium/harvest_meta_rulings.json`.

## What switching would change

Ruled and edited-after-pin values replace gear-planner's: 21 field values. The 145 declined fields keep their current value until a decision on each. That decision is the remaining step of #906.
