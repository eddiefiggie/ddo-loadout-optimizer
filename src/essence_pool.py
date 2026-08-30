"""Essence Crafting option pool for Trinket hosts — the Gem of Many Facets (#193, #599).

The Gem carries three Essence Crafting menus on one Trinket (Prefix, Suffix,
Extra) and, until now, zero affixes: the slots were declared and disclosed as
inert because the data behind them was incomplete. Three separate harvests have
since closed the gaps, and this module is where they meet.

An option may only be offered when **all three** of the following are sourced. Any
one missing and the effect stays out, because a crafted effect the solver can see
is one it will put in a finished loadout:

1. **Placement** — which menu it can go in. `essence_crafting.json`, table 1b.
2. **Bonus type** — which bucket it competes in. `essence_bonus_type.json` (#193).
   Without it a crafted effect either double-counts against real gear or wrongly
   collapses with it.
3. **Magnitude** — the ML curve. Reached through `essence_curve_join` (#599),
   never by indexing `values_by_ml` with an effect name, which silently returns
   the wrong row.

A fourth join happens here and nowhere else: **effect name to CATALOG stat name**.
`Insightful Constitution` is not a stat — it is `Constitution` in the `Insight`
bucket, and the solver only ever buckets on (stat, bonus_type). Effects whose stat
does not land on a name the catalog already uses are excluded by name below,
never guessed at.

The result is deliberately a minority of what the game offers, and
`coverage()` exists so the player is told so rather than shown a short menu with
no explanation.
"""
from __future__ import annotations

import json
import os

from src import essence_curve_join as curve_join

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CRAFTING_SHARD = os.path.join(ROOT, "data", "seed", "compendium", "essence_crafting.json")
BONUS_TYPE_SHARD = os.path.join(ROOT, "data", "seed", "compendium", "essence_bonus_type.json")

HOST_SLOT_TYPE = "Trinket"
TRINKET_MENUS = ("Prefix", "Suffix", "Extra")
_LABEL_PREFIX = "Essence Crafting: Trinket - "

INSIGHTFUL_PREFIX = "Insightful "

# Verbatim from the Essence Crafting values table (table 3b), Notes:
#   "Effects that grant insight bonuses can be applied to items ML 10 and higher
#    only, regardless of prefix/suffix/extra slot."
# The heroic Gem is ML 5, so this is not hypothetical — it is the difference
# between offering that Gem nine Insight options and offering it none.
INSIGHT_MIN_ML = 10

# A SECOND, separate ML-10 rule, from two other sentences:
#   "Extra enchantment slots are not available on items under minimum level 10."
#       — Essence Crafting, Components
#   "If the item is ML 10 or greater, it has a 'Mark of House Cannith Slot'"
#       — Essence Crafting steps
# That gates the SLOT rather than the effect. The two coincide today only because
# every Extra effect this pool offers happens to be Insight-typed; they are kept
# apart so a non-Insight Extra effect cannot arrive later and quietly skip it.
EXTRA_SLOT_MIN_ML = 10

# The crafted minimum level is the CRAFTER's choice, not a property the item
# arrives with: "This shard determines the minimum level of the item, the power
# level of scaling effect shards crafted onto the item" (Essence Crafting, Steps).
# Shards exist for ML 1-36.
#
# The solver reads the HOST's ml as the level to craft at, and that is correct
# only because of two things that are checked rather than assumed:
#
#   1. Every offered option's ML curve is monotonic non-decreasing and peaks at
#      36, so crafting at the highest available level is always optimal. Asserted
#      in tests/test_essence_pool.py.
#   2. The highest available level for a named item appears to be its own ML — a
#      Legendary Gem (ML 30) refuses an ML 36 shard. That is a PLAYER OBSERVATION
#      (maintainer, 2026-08-30), NOT a wiki statement; see
#      docs/wiki-evidence/essence-crafting.md for where it was searched for.
#
# Both matter beyond the Gem. When the Rune Arm, Ring and Melee menus are sourced,
# their hosts are blanks with no meaningful native ML, and reading a host record's
# ml will produce ML 1 values for an item a player would craft at 34.
MAX_SHARD_ML = 36

# Only hosts whose record is `verified` get live slots. `Trinket [Crafted]` — a
# blank craftable trinket — declares the same three menus but is `quarantined`
# ("no solver-eligible affixes") and carries ML 1, which is a placeholder rather
# than a sourced minimum level. Crafting onto an unverified host would build real
# numbers on a record we do not trust.
REQUIRED_VERIFICATION = "verified"

# Effects excluded even though all three shards cover them. Each needs a reason,
# and the reason is always the same shape: a join this module would have to GUESS.
EXCLUDED_EFFECTS = {
    "Natural Armor": (
        "The catalog has no `Natural Armor` stat — it models natural armour as "
        "stat `Armor Class` in the `Natural` bucket (149 named affixes). Mapping "
        "onto that is an unsourced stat rename, and it would sit on top of the "
        "bonus type's own weakest evidence shape (`page-subject`, used once). Two "
        "stacked judgement calls on one value is how a wrong number gets shipped. "
        "Sourcing either half admits it — this is a one-line change."),
}


class PoolError(Exception):
    """The inputs are shaped in a way the pool cannot trust."""


def _load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _stat_name(effect: str) -> str:
    """The catalog stat an effect contributes to.

    `Insightful Constitution` -> `Constitution`. The Insightful part is the BONUS
    TYPE, not the stat, and conflating them would give the crafted effect a
    private bucket that stacks with everything.
    """
    return effect[len(INSIGHTFUL_PREFIX):] if effect.startswith(INSIGHTFUL_PREFIX) else effect


def essence_slots(crafting, verification=None) -> list:
    """The Trinket Essence menus a host declares, or [] when it may not have them.

    Reads the same `crafting` labels the compendium already shows the player, so
    the slots the solver fills are exactly the slots the item is documented to
    have.
    """
    if verification is not None and verification != REQUIRED_VERIFICATION:
        return []
    out, seen = [], set()
    for c in crafting or []:
        if not isinstance(c, str) or not c.startswith(_LABEL_PREFIX):
            continue
        menu = c[len(_LABEL_PREFIX):].strip()
        if menu in TRINKET_MENUS and menu not in seen:
            seen.add(menu)
            out.append({"menu": menu})
    return sorted(out, key=lambda s: TRINKET_MENUS.index(s["menu"]))


def build_trinket_pool(catalog_stats=None, catalog_units=None) -> dict:
    """Every craftable Trinket option the three harvests fully support.

    `catalog_stats` is the set of affix stat names the built dataset actually
    uses. It is REQUIRED in the real build: an option naming a stat nothing else
    uses gets a bucket to itself and therefore stacks with every real item, which
    is the double-count the whole bonus-type harvest exists to prevent.

    `catalog_units` is `{stat: {units the catalog uses}}`. The unit is taken from
    the catalog rather than assumed, because it is not cosmetic: Doublestrike is a
    PERCENTAGE and every named Doublestrike affix is stored as `pct`. An option
    claiming `flat` for it would put a percentage and a flat number in one bucket
    and compare them directly. A stat the catalog spells BOTH ways is skipped
    rather than resolved by majority vote.
    """
    crafting = _load(CRAFTING_SHARD)
    bonus_types = _load(BONUS_TYPE_SHARD)["harvested"]
    placements = crafting["placements"]
    if HOST_SLOT_TYPE + "s" not in placements:
        raise PoolError(f"no {HOST_SLOT_TYPE} placements: the crafting shard changed shape")
    menus = placements[HOST_SLOT_TYPE + "s"]

    resolved = curve_join.resolve_all()
    mapping = resolved["mapping"]
    curves = crafting["values_by_ml"]["effects"]

    records, skipped = [], {}

    def skip(effect, menu, reason):
        skipped.setdefault(reason, set()).add(effect)

    for menu in TRINKET_MENUS:
        for effect in menus.get(menu, []):
            if effect in EXCLUDED_EFFECTS:
                skip(effect, menu, "excluded")
                continue
            bt = bonus_types.get(effect)
            if not bt or bt.get("provenance") != "stated":
                skip(effect, menu, "no-bonus-type")
                continue
            entry = mapping.get(effect)
            if entry is None:
                skip(effect, menu, "no-curve-row")
                continue
            stat = _stat_name(effect)
            if catalog_stats is not None and stat not in catalog_stats:
                skip(effect, menu, "stat-not-in-catalog")
                continue
            curve = curves.get(entry["row"])
            if not curve or len(curve) != 36:
                skip(effect, menu, "malformed-curve")
                continue
            unit = "flat"
            if catalog_units is not None:
                units = catalog_units.get(stat) or set()
                if len(units) != 1:
                    skip(effect, menu, "ambiguous-unit" if units else "no-catalog-unit")
                    continue
                unit = next(iter(units))
            bonus_type = bt["value"]["bonus_type"]
            records.append({
                "menu": menu,
                "effect": effect,
                "name": f"Essence Crafting: {effect}",
                "stat": stat,
                "bonus_type": bonus_type,
                "unit": unit,
                "values_by_ml": list(curve),
                # Carried per option rather than derived in the solver: the wiki
                # states the rule for insight bonuses specifically, so the option
                # that needs the gate is the one that should name it.
                "min_ml": INSIGHT_MIN_ML if bonus_type == "Insight" else 1,
                "curve_row": entry["row"],
                "wiki_url": "https://ddowiki.com/page/Essence_Crafting",
            })

    if not records:
        raise PoolError(
            "refusing to emit an empty Essence Crafting pool: the shards produced no "
            "option at all, which means a join broke rather than that the game changed")

    offered = {m: sum(1 for r in records if r["menu"] == m) for m in TRINKET_MENUS}
    total = {m: len(menus.get(m, [])) for m in TRINKET_MENUS}
    return {
        "records": records,
        "coverage": {
            "offered": offered,
            "total": total,
            "offered_all": sum(offered.values()),
            "total_all": sum(total.values()),
            "skipped": {k: sorted(v) for k, v in skipped.items()},
            "excluded_reasons": EXCLUDED_EFFECTS,
            "insight_min_ml": INSIGHT_MIN_ML,
            "note": ("Trinket menus only, and only effects whose PLACEMENT, BONUS TYPE and "
                     "ML CURVE are all sourced. The rest are disclosed to the player rather "
                     "than offered, because an unsourced crafted effect is indistinguishable "
                     "from a real one once it is inside a finished loadout."),
        },
    }
