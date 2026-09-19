"""#795 — the FULL Essence Crafting placement table, for the player-authored item
builder.

`essence_pool` and this module read the same shard and answer different questions,
and the difference is who supplies the number.

`essence_pool` serves the SOLVER's catalog. An option it offers becomes a
contribution in a finished loadout, so it may only be offered when placement,
bonus type AND magnitude are all sourced. 36 of 708 placements clear that bar,
and the other 672 are correctly withheld — a crafted effect with a guessed type
either double-counts against real gear or wrongly collapses with it.

This module serves the BUILDER, where the player is the one asserting the item
exists and what is on it. The bonus type and value come from them and are
disclosed as player-authored, exactly as they are today. So the bar that binds
`essence_pool` does not bind here, and withholding 672 placements would refuse to
let a player describe gear they are holding — which is the whole feature.

What this module must NOT do is let the two drift into each other. Every record
carries `sourced`, and for a sourced one the wiki's own bonus type and ML curve
travel with it so the builder can fill them in and LOCK them. A sourced value is
not a player assertion and must never be labelled as one; an unsourced one is,
and must always be.

Essence Crafting is Cannith Crafting, renamed in U79 — see the shard's
`_meta.note`. That is why this serves the only player report on file, which asks
for "a couple of CC rings".
"""
from __future__ import annotations

import json
import os

from src import essence_curve_join as curve_join
from src import essence_pool
from src import spell_focus

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

MENUS = essence_pool.MENUS

#: The catalog slot a player picks -> the placement group(s) that slot can host.
#:
#: EXPLICIT, for the reason `essence_pool.HOST_FAMILIES` is: the join is not
#: pluralisation. `Helmet` is `Headgear` and `Armor` is `Armors`; a `+ "s"` rule
#: would serve Headgear nothing and look like the game simply offers less.
#:
#: Two slots are genuinely ambiguous and take a sub-pick, because the game's
#: placement lists differ between them — a Melee weapon and a Ranged weapon do not
#: host the same effects, and neither do a Shield, an Orb and a Rune Arm.
#:
#: `Quiver` maps to NOTHING. It is not essence-craftable, and the empty list is the
#: sourced statement of that rather than an omission; `assert_slot_map_covers_the_table`
#: fails if a group is invented for it.
SLOT_GROUPS = {
    "Armor": ["Armors"],
    "Helmet": ["Headgear"],
    "Goggles": ["Goggles"],
    "Necklace": ["Necklaces"],
    "Trinket": ["Trinkets"],
    "Cloak": ["Cloaks"],
    "Belt": ["Belts"],
    "Ring": ["Rings"],
    "Gloves": ["Gloves"],
    "Boots": ["Boots"],
    "Bracers": ["Bracers"],
    "Quiver": [],
    "Weapon": ["Melee weapons", "Ranged weapons"],
    "Off Hand": ["Shields", "Orbs", "Rune Arms"],
}

INSIGHT_MIN_ML = essence_pool.INSIGHT_MIN_ML
EXTRA_SLOT_MIN_ML = essence_pool.EXTRA_SLOT_MIN_ML


class PlacementError(RuntimeError):
    pass


def assert_slot_map_covers_the_table(placements) -> int:
    """A completeness claim needs a guard, not a date.

    `SLOT_GROUPS` claims to map every catalog slot onto the groups it can host.
    Both sides are readable at build time, so assert it rather than writing "all 16
    groups are covered" in a comment that cannot notice the shard growing a
    seventeenth.

    Fails in both directions: a group the map never reaches would be silently
    uncraftable in the builder, and a group the map invents would be a picker with
    no table behind it.
    """
    if not placements:
        raise PlacementError("empty placements table — this guard would pass vacuously")
    table = set(placements)
    mapped = {g for groups in SLOT_GROUPS.values() for g in groups}
    unreachable = sorted(table - mapped)
    invented = sorted(mapped - table)
    if unreachable or invented:
        raise PlacementError(
            f"SLOT_GROUPS does not match the placements table: "
            f"unreachable={unreachable} invented={invented}")
    return len(table)


def build_placement_catalog(catalog_stats=None, catalog_units=None) -> dict:
    """Every placement in the table, annotated for the builder.

    `catalog_stats` gates `rankable`: an effect whose stat the catalog does not use
    cannot be ranked, so the picker must not offer it. That is the same reasoning
    `customStatOptions` already applies — offering a name the form then refuses is
    the worst version of a picker — applied one step earlier, at the data.

    Unlike `essence_pool.build_essence_pool`, a missing bonus type or curve is NOT a
    skip. It sets `sourced: false`, and the builder asks the player.
    """
    crafting = essence_pool._load(essence_pool.CRAFTING_SHARD)
    bonus_types = essence_pool._load(essence_pool.BONUS_TYPE_SHARD)["harvested"]
    placements = crafting["placements"]
    assert_slot_map_covers_the_table(placements)

    curves = crafting["values_by_ml"]["effects"]
    mapping = curve_join.resolve_all()["mapping"]

    groups, counts = {}, {}
    total = rankable_n = sourced_n = unrankable = 0
    for group, menus in placements.items():
        out = {}
        for menu in MENUS:
            rows = []
            for effect in menus.get(menu, []) or []:
                total += 1
                stat = essence_pool._stat_name(effect)
                # An UMBRELLA name is expanded away before a player ever sees the
                # picker — `Spell Lore` is not a stat anyone can rank, it becomes
                # the six schools. Offering it would be a row that can be chosen
                # and can never score, which is worse than not offering it, and
                # `tests/test_spell_focus.py` refuses to let one into the dataset
                # at all. Caught by that guard rather than by review: 52 of these
                # were in the first cut of this table.
                universal = spell_focus.is_universal(stat)
                rankable = ((catalog_stats is None or stat in catalog_stats)
                            and not universal)
                if rankable:
                    rankable_n += 1
                # The insight ML-10 gate binds on the EFFECT, and it must bind
                # whether or not the bonus type was harvested. Read from the
                # table's own naming convention: `Insightful X` is the insight
                # variant of `X`, which is already load-bearing — `_stat_name`
                # strips exactly this prefix to find the underlying stat, and has
                # since #193.
                #
                # This is not inferring the bonus type, which stays unsourced and
                # is still asked of the player. It applies a gate that only ever
                # REFUSES, which is the safe direction under exclude-until-verified:
                # the cost of being wrong is an enchantment offered one level late,
                # against a player crafting something the game would not let them.
                #
                # #797 corroborated the reading from the other end. The wiki
                # describes the ML-10 slot as the place "where another effect can
                # be applied (Insightful Strength, Insightful Accuracy, etc.)"
                # (`Essence Crafting steps`) - both of its own examples carry this
                # prefix. So the convention this line reads is the one the wiki
                # uses to describe the slot itself.
                insightful = effect.startswith(essence_pool.INSIGHTFUL_PREFIX)
                rec = {"effect": effect, "stat": stat, "rankable": rankable,
                       "sourced": False,
                       "min_ml": INSIGHT_MIN_ML if insightful else 1}
                bt = bonus_types.get(effect)
                entry = mapping.get(effect)
                curve = curves.get(entry["row"]) if entry else None
                unit, unit_ok = "flat", True
                if catalog_units is not None:
                    units = catalog_units.get(stat) or set()
                    # A stat the catalog spells BOTH ways is left unsourced rather
                    # than resolved by majority vote, exactly as the pool does: a
                    # percentage and a flat number in one bucket compare directly.
                    unit_ok = len(units) == 1
                    if unit_ok:
                        unit = next(iter(units))
                if (rankable and unit_ok and bt and bt.get("provenance") == "stated"
                        and curve and len(curve) == 36
                        and effect not in essence_pool.EXCLUDED_EFFECTS):
                    bonus_type = bt["value"]["bonus_type"]
                    rec.update({
                        "sourced": True,
                        "bonus_type": bonus_type,
                        "unit": unit,
                        "values_by_ml": list(curve),
                        "curve_row": entry["row"],
                        # The wiki states the insight rule for the EFFECT; the Extra
                        # slot rule is separate and gates the menu. Kept apart here
                        # for the same reason `essence_pool` keeps them apart.
                        "min_ml": (INSIGHT_MIN_ML
                                   if (bonus_type == "Insight" or insightful) else 1),
                    })
                    sourced_n += 1
                # Only offerable rows are PUBLISHED. The table exists to drive a
                # picker, and a row that can never be picked is not reference
                # data, it is a trap. The count of what was left out stays in
                # `coverage`, so the disclosure remains honest about how much of
                # the game this covers.
                if rankable:
                    rows.append(rec)
                else:
                    unrankable += 1
            out[menu] = rows
        groups[group] = out
        counts[group] = {m: len(out[m]) for m in MENUS}

    if not total:
        raise PlacementError(
            "refusing to emit an empty placement catalog: the shard produced no "
            "placement at all, which means the harvest broke rather than that the "
            "game changed")

    return {
        "groups": groups,
        "slot_groups": {k: list(v) for k, v in SLOT_GROUPS.items()},
        "extra_slot_min_ml": EXTRA_SLOT_MIN_ML,
        "insight_min_ml": INSIGHT_MIN_ML,
        "wiki_url": "https://ddowiki.com/page/Essence_Crafting",
        "coverage": {
            "placements_total": total,
            "rankable": rankable_n,
            "unrankable_withheld": unrankable,
            "sourced": sourced_n,
            "by_group": counts,
            "slots_without_a_group": sorted(
                s for s, g in SLOT_GROUPS.items() if not g),
        },
    }
