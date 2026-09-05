# Legendary Green Steel — hosts, tiers, and the aspect bonus that is out of scope

**Status: MODELLED (#194), tier-per-altar. The matched-tier aspect bonus is a
standing non-goal and is disclosed per result, not modelled.**

No ddowiki harvest was run for this. Every value here is structural — read from
the gear-planner dump the pipeline already treats as the single source of truth
for item affixes and crafting menus — or is the standing ruling #653 recorded from
its read of the `Legendary Green Steel items` page. What that read established and
what it did not is kept apart below, because the second half is the one a future
harvest would settle.

## The hosts are declared, not inferred

`data/seed/compendium/raw/gearplanner_items.json` carries 48 `Legendary Green
Steel *` records at ML 26. Each names its crafting menus in its own `crafting[]`:

| host class | count | `crafting[]` | marker stamped |
|---|---|---|---|
| accessory blank (Belt, Boots, Bracers, Cloak, Gloves, Goggles, Helm, Necklace) | 8 | `T1 (Equipment)`, `T2 (Equipment)`, `T3 (Equipment)` | `legendary_green_steel_tiers` (`item_class: accessory`) |
| weapon blank | 40 | `T1 (Weapon)`, `T2 (Weapon)`, `T3 (Weapon)` | `legendary_green_steel_tiers` (`item_class: weapon`) |

That is the same structural link `essence_slots` uses for the Gem of Many Facets:
the item says which menus it has. `src/planner_items.py` reads the label and
nothing else — no name match, no ML heuristic. The 47 heroic `Green Steel *`
blanks (ML 11–12) declare no tier label and receive no marker; heroic Green Steel
upgrades at the non-Legendary altars and has no menu in the catalog.

**Superseded 2026-09-04 (#687):** the weapon half no longer carries the legacy
`thunder_forged` key. Both blank classes now live in ONE container,
`legendary_green_steel`, keyed by `(item_class, tier)`, with one host marker
(`legendary_green_steel_tiers`, each slot naming its class), one solver loop, one
family key (`lgs`) and one persisted result key (`lgsPlaced`; saves carrying the
old `tfPlaced` / `gsPlaced` migrate on load). #653's finding stands unchanged:
the `T*(Weapon)` menus are Legendary Green Steel weapon recipes (every option
records a Legendary Altar as its station) and Thunder-Forged has no menu in the
catalog at all. The 42 `Thunder-Forged Alloy *` weapons declare no tier label
and cannot be stamped; `expects_stations` is the guard, whatever the pool is
called.

## One effect per altar

From #653's read of the page's own navigation ("Tier 1/2/3 Augment recipes
(Equipment / Weapon bonus effects)") and the station each option records: the
three menus are the three Legendary Altars — Invasion (T1), Subjugation (T2),
Devastation (T3) — and a blank takes **one** effect at **each**. The accessory
pool was modelled as a single pick over all three tiers until #194; that
under-credited every host by two effects. Both halves are now per-tier
single-pick, the shape the weapon half always had.

The pools themselves, read from `gearplanner_crafting.json`:

| pool | options | multi-affix | bonus types by tier |
|---|---|---|---|
| accessory (`legendary_green_steel`, `item_class: accessory`) | 81 | 24 | T1 Enhancement / Competence / Profane / Resistance / Untyped, T2 Insight, T3 Quality / Competence |
| weapon (`legendary_green_steel`, `item_class: weapon`) | 35 | 1 | T1 Enhancement / Equipment, T2 Insight / Quality, T3 Exceptional |

18 accessory options are the ability-skills umbrellas (`Charisma Skills +22
Competence`, …). They expand inside the option, never across the record list,
through the same `spell_focus` pass the Nearly Complete Skill menus use, and the
option is renamed to its engraved label (`Competence Charisma Skills`).

## Not modelled: the matched-tier aspect bonus

Green Steel's combinatorial half — the extra bonus a **matched** combination of
tier choices unlocks (the Dominion / Opposition / Ethereal / Material aspects,
and the dual- and triple-shard effects) — is not in the pools and is not
modelled. `AGENTS.md` lists the exhaustive Green Steel combinatorial space as a
non-goal: only the endgame-relevant subset ships, with niche configurations
disclosed as out of scope per result. That disclosure is the `LEGENDARY GREEN
STEEL` notice, which fires whenever a blank is equipped and states that a build
which also matches its aspects may be worth more than shown.

**What a future harvest would have to establish before this could change:** the
per-aspect effects with their bonus types and magnitudes, and the exact matching
rule (which tier choices count as "matched"). Nothing on disk states either, and
the pools carry no aspect option, so there is no value to infer from. Do not add
one by analogy.

## What is asserted at build time

- `tests/test_planner_items.py` — 8 + 40 hosts, all ML 26, all named `Legendary
  Green Steel *`, three tiers each; heroic blanks unmarked; a Thunder-Forged
  Alloy weapon unmarked.
- `tests/test_container_registry.py` — both containers reachable, 8 / 40 hosts,
  the accessory pool's expansion pass left its stamp.
- `build_dataset.py` — fails when either pool has options and no verified host.
