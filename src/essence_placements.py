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

from src import essence_combined
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
#: The gear-planner type each one-to-one worn slot holds. A THIRD vocabulary,
#: anatomical, and the reason `SLOT_GROUPS` can be checked at all: the wiki does
#: not know these names, so their agreement with the group names is independent
#: rather than circular.
#:
#: Asserted by `assert_slot_groups_match_the_catalog`, which is what makes the
#: 1:1 half of the join a verified claim instead of a written one.
ONE_TO_ONE_CATALOG_TYPE = {
    "Helmet": "Head items",
    "Goggles": "Eye items",
    "Necklace": "Neck items",
    "Cloak": "Back items",
    "Belt": "Waist items",
    "Ring": "Finger items",
    "Gloves": "Hand items",
    "Boots": "Feet items",
    "Bracers": "Wrist items",
    "Trinket": "Trinket items",
    "Quiver": "Quiver items",
}

#: The catalog types `Off Hand` holds, which must be exactly the union of the
#: three groups that slot claims. Written out so a new off-hand kind breaks the
#: guard rather than silently joining `Shields`.
OFF_HAND_CATALOG_TYPES = {
    "Bucklers", "Small shields", "Large shields", "Tower shields",
    "Orbs", "Rune Arms",
}

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

#: #799 — the bonuses Essence Crafting applies AUTOMATICALLY with the Minimum
#: Level shard. They are not enchantments and occupy no menu:
#:
#:   "These bonuses do not require a separate shard or take up a slot
#:    (suffix/prefix/extra), nor is one possible to craft."
#:        - `Essence Crafting`, table 3b footnote
#:
#: `essence_curve_join.UNCRAFTABLE_ROWS` already excludes their curves from the
#: CRAFTABLE pool, correctly — nobody crafts them. That is why #599 harvested the
#: rows and nothing ever read them: excluded from one pool and never added to
#: another. This is the other half.
#:
#: Only the Enhancement Bonus is modelled. The other two rows are real, sourced
#: and carried here so the player can be TOLD about them, because neither is
#: expressible: `Weapon Dice` and a Spellcasting Implement MAGNITUDE are not in
#: the affix registry, so nothing could rank either, and minting a stat the
#: catalog does not use would give it a private bucket that stacks with every
#: real item.
ENHANCE_ROW = "Enhance bonus*"

#: Which placement group takes an automatic Enhancement Bonus, and the spelling
#: that group's own slot uses. From the wiki, which names exactly three kinds:
#:
#:   "you don't need to craft an Enhancement Bonus shard for Weapons, Shields, or
#:    Armors (including Robes, Outfit, and Docents). A scaled Enhancement Bonus is
#:    applied automatically when you apply a Minimum Level shard."
#:
#: Orbs and Rune Arms are deliberately ABSENT. They are off-hand items and the
#: sentence does not name them, so they get nothing rather than a guess — the
#: same refusal `SLOT_GROUPS` makes for thrown weapons.
#:
#: The spellings are measured, not assumed, and they are why #792 mattered: slot
#: `Weapon` carries `(Weapon)` 3,259 times, slot `Armor` carries `(Armor)` 935,
#: and slot `Off Hand` — which is where Shields live — carries `(Armor)` 304
#: times against 2 bare. A shield takes the ARMOUR spelling.
ENHANCE_GROUPS = {
    "Melee weapons": "Enhancement Bonus (Weapon)",
    "Ranged weapons": "Enhancement Bonus (Weapon)",
    "Shields": "Enhancement Bonus (Armor)",
    "Armors": "Enhancement Bonus (Armor)",
}

ENHANCE_BONUS_TYPE = "Enhancement"

#: #804 — the Melee/Ranged split `table 1b` names and never defines.
WEAPON_SPLIT_SHARD = os.path.join(
    ROOT, "data", "seed", "compendium", "ranged_weapon_types.json")


def build_weapon_split() -> dict:
    """The sourced half of the split, plus the types the wiki leaves unplaced.

    `table 1b` names `Melee weapons` and `Ranged weapons` and never says which DDO
    weapon types are in each. #795 wrote the mapping by hand from
    `WeaponTaxonomy.STYLE_OF_TYPE`, whose axis is HANDEDNESS, and labelled it a
    construction. This sources the half that can be sourced.

    RANGED is enumerated: `Ranged weapons` carries `Table: Basic Ranged Weapons`,
    nine rows, bows and crossbows.

    MELEE IS NOT, and is deliberately absent from the shard. There is no `Melee
    weapons` article and no category for it, so melee remains the COMPLEMENT —
    every type that is neither sourced-ranged nor unplaced. That is an inference
    and is labelled one; writing the melee types out here would dress it up as a
    harvest. `tests/custom-items.test.js` asserts the three sets are total and
    disjoint over the taxonomy, which is what keeps the complement honest.

    UNPLACED is a refusal with positive evidence now, not silence: the five thrown
    types are absent from the ranged enumeration and `Thrown weapons` lists
    `Ranged weapons` under See also, a sibling rather than a parent; `Handwrap`
    never calls them either and says they "are not programmed as weapons by
    design".
    """
    with open(WEAPON_SPLIT_SHARD, encoding="utf-8") as fh:
        shard = json.load(fh)
    names = shard["ranged"]["wiki_names"]
    mapping = shard["ranged"]["name_to_type"]
    unplaced = sorted(t for group in shard["unplaced"].values() for t in group)

    missing = [n for n in names if n not in mapping]
    if missing:
        raise PlacementError(
            f"ranged weapon name(s) with no taxonomy type: {missing}. An "
            "unmapped name is a weapon the split cannot place, which would "
            "silently fall into the melee complement")
    types = sorted(set(mapping.values()))
    if not types:
        raise PlacementError("no ranged types — this would put every weapon in melee")
    overlap = sorted(set(types) & set(unplaced))
    if overlap:
        raise PlacementError(
            f"type(s) both sourced-ranged and unplaced: {overlap}. The two sets "
            "must be disjoint or a weapon is refused and served at once")
    return {
        "ranged_types": types,
        "unplaced_types": unplaced,
        "melee_is_complement": True,
        "wiki_urls": shard["_meta"]["sources"],
    }

#: Stated by the wiki, real in game, and NOT modelled. Carried so the bench can
#: disclose them rather than look complete while granting nothing.
UNMODELLED_AUTOMATIC = (
    {
        "row": "Weapon dice mult*",
        "label": "a weapon dice multiplier",
        "applies_to": "weapons",
        "quote": "A Weapon dice multiplier is automatically applied to a weapon.",
        "why_not": "weapon dice are not a rankable stat in this catalog - "
                   "`affix_parser` classes them as non-magnitude, so there is no "
                   "bucket a multiplier could join",
    },
    {
        "row": "Spellcasting implement*",
        "label": "a Spellcasting Implement bonus equal to the item's minimum level",
        "applies_to": "weapons and shields carrying a spell-related enchantment",
        "quote": "A Spellcasting Implement bonus is added when a spell-related "
                 "shard is applied to a weapon or shield. This bonus is equal to "
                 "the item's minimum level.",
        "why_not": "the catalog carries only a Bool `item becomes a Spellcasting "
                   "Implement`, never a magnitude, so there is no stat to rank",
    },
)


def build_automatic_bonuses(crafting) -> dict:
    """#799 — the automatic half, read from the same table 3b the pool uses.

    Refuses rather than emits a partial answer: a curve that is missing or the
    wrong length would otherwise silently grant nothing on every crafted weapon,
    which is indistinguishable from the bug this closes.
    """
    curves = crafting["values_by_ml"]["effects"]
    curve = curves.get(ENHANCE_ROW)
    if not curve or len(curve) != 36:
        raise PlacementError(
            f"{ENHANCE_ROW!r} is missing or not 36 rows - the automatic "
            "Enhancement Bonus cannot be derived, and emitting it empty would "
            "grant nothing while the bench claimed otherwise")
    missing = [r["row"] for r in UNMODELLED_AUTOMATIC if r["row"] not in curves]
    if missing:
        raise PlacementError(
            f"disclosed-but-unmodelled rows absent from table 3b: {missing}. "
            "The disclosure names them to the player; if the harvest no longer "
            "carries them the disclosure is describing something that is gone")
    return {
        "enhancement_bonus": {
            "groups": dict(ENHANCE_GROUPS),
            "bonus_type": ENHANCE_BONUS_TYPE,
            "values_by_ml": list(curve),
            "curve_row": ENHANCE_ROW,
        },
        "unmodelled": [dict(r) for r in UNMODELLED_AUTOMATIC],
        "wiki_url": "https://ddowiki.com/page/Essence_Crafting",
    }


class PlacementError(RuntimeError):
    pass


def assert_slot_groups_match_the_catalog(records) -> int:
    """#806 — the join, checked from the side the wiki cannot reach.

    `SLOT_GROUPS` relates the APP's slot vocabulary to the WIKI's group names.
    The wiki cannot state that correspondence, because it does not know
    gear-planner's names — so this is not sourceable, and pretending otherwise
    would be worse than leaving it written out. What it IS is checkable, from a
    third vocabulary the wiki also does not know: the anatomical gear-planner
    type each slot holds.

    Two shapes are asserted, and each is what makes its half of the join legible:

    - **One type per one-to-one slot.** `Helmet` holding only `Head items` is
      what licenses reading it as the wiki's `Headgear`. A slot that ever holds
      two kinds has stopped being one group, and the 1:1 claim should break
      loudly rather than widen quietly.
    - **`Off Hand` holds exactly the union of its three groups.** Shields, Orbs
      and Rune Arms, nothing else. A new off-hand kind would otherwise be swept
      into whichever group the reader assumed.

    `Weapon` is deliberately not checked here: #804 owns that split and asserts
    it over the taxonomy.

    Refuses to pass over an empty catalog.
    """
    if not records:
        raise PlacementError("no records — this guard would pass vacuously")
    seen = {}
    for rec in records:
        slot = rec.get("slot")
        if slot not in SLOT_GROUPS:
            continue
        t = rec.get("type")
        if t:
            seen.setdefault(slot, set()).add(t)

    problems = []
    for slot, expected in ONE_TO_ONE_CATALOG_TYPE.items():
        got = seen.get(slot) or set()
        if got != {expected}:
            problems.append(
                f"{slot}: expected exactly {{{expected!r}}}, catalog holds {sorted(got)}")
    off = seen.get("Off Hand") or set()
    if off != OFF_HAND_CATALOG_TYPES:
        problems.append(
            f"Off Hand: expected {sorted(OFF_HAND_CATALOG_TYPES)}, catalog holds {sorted(off)}")
    if problems:
        raise PlacementError(
            "SLOT_GROUPS no longer matches the catalog it claims to describe: "
            + "; ".join(problems))
    return len(ONE_TO_ONE_CATALOG_TYPE) + 1


def assert_the_two_slot_joins_agree(combined_groups) -> int:
    """#806 — `essence_combined.GROUP_OF_SLOT` maps a DIFFERENT wiki table's
    singular slot names onto the same 16 groups. Agreement between two
    independently-written joins is corroboration; disagreement is a bug in one of
    them, and until now the difference was silent.

    There is exactly one, and it is real rather than an error: **no combined
    prefix recipe lists a rune arm slot**, so `Rune Arms` is reached by
    `SLOT_GROUPS` and not by `GROUP_OF_SLOT`. Named here so the asymmetry reads
    as a fact about the recipe table instead of a hole in the join.
    """
    ours = {g for gs in SLOT_GROUPS.values() for g in gs}
    theirs = set(combined_groups)
    extra = sorted(theirs - ours)
    if extra:
        raise PlacementError(
            f"the combined-prefix join reaches group(s) the slot join does not: "
            f"{extra}. One of the two is wrong.")
    missing = sorted(ours - theirs)
    if missing != ["Rune Arms"]:
        raise PlacementError(
            f"expected `Rune Arms` to be the ONLY group no combined recipe "
            f"reaches; got {missing}. Either a recipe now covers rune arms, or "
            "another group has quietly lost its recipes.")
    return len(ours)


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
    magnitude_n = type_n = 0
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
                       # #810 — the two facts are INDEPENDENT and come from
                       # different harvests. `table 3b` publishes a magnitude for
                       # 120 of the 157 effects; a bonus type is `stated` for 22.
                       # Requiring both before using EITHER left 339 placements
                       # asking the player to type a number the wiki publishes.
                       #
                       # `essence_pool` couples them for a real reason — the solver
                       # needs a bucket, so an untyped effect must not be offered
                       # at all — and that reasoning was carried into the builder,
                       # where it does not hold: the builder asks the player for
                       # the type and discloses the answer as theirs.
                       "magnitude_sourced": False,
                       "type_sourced": False,
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
                usable = rankable and effect not in essence_pool.EXCLUDED_EFFECTS
                # The MAGNITUDE half. `unit_ok` still gates it: a stat the catalog
                # spells both flat and percent has no single unit, so a number
                # would land in a bucket it cannot be compared in.
                if usable and unit_ok and curve and len(curve) == 36:
                    rec.update({
                        "magnitude_sourced": True,
                        "unit": unit,
                        "values_by_ml": list(curve),
                        "curve_row": entry["row"],
                    })
                    magnitude_n += 1
                # The BONUS TYPE half, independently.
                if usable and bt and bt.get("provenance") == "stated":
                    bonus_type = bt["value"]["bonus_type"]
                    rec["type_sourced"] = True
                    rec["bonus_type"] = bonus_type
                    # The wiki states the insight rule for the EFFECT; the Extra
                    # slot rule is separate and gates the menu. Kept apart here
                    # for the same reason `essence_pool` keeps them apart.
                    if bonus_type == "Insight":
                        rec["min_ml"] = INSIGHT_MIN_ML
                    type_n += 1
                # `sourced` is kept as the CONJUNCTION — it is what a fully-locked
                # row is — but it is now derived from the two halves rather than
                # gating them.
                if rec["magnitude_sourced"] and rec["type_sourced"]:
                    rec["sourced"] = True
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

    # #800 — combined prefixes, keyed by the same group names. Built here so the
    # bench reads ONE published table rather than joining two in the browser.
    combined = essence_combined.build_combined_pool(
        catalog_stats=catalog_stats, placements=placements,
        # #812 — "Combined Shards also use this scaling for their individual
        # effects." Passed in rather than re-opened there: the shard's readers
        # are a named set and a guard enforces it.
        curves=crafting["values_by_ml"]["effects"])

    return {
        "groups": groups,
        "automatic": build_automatic_bonuses(crafting),
        "weapon_split": build_weapon_split(),
        "combined": {k: v for k, v in combined.items() if k != "coverage"},
        "slot_groups": {k: list(v) for k, v in SLOT_GROUPS.items()},
        "extra_slot_min_ml": EXTRA_SLOT_MIN_ML,
        "insight_min_ml": INSIGHT_MIN_ML,
        "wiki_url": "https://ddowiki.com/page/Essence_Crafting",
        "coverage": {
            "placements_total": total,
            "rankable": rankable_n,
            "unrankable_withheld": unrankable,
            "sourced": sourced_n,
            "magnitude_sourced": magnitude_n,
            "type_sourced": type_n,
            "by_group": counts,
            "slots_without_a_group": sorted(
                s for s, g in SLOT_GROUPS.items() if not g),
            "combined": combined["coverage"],
        },
    }
