"""Legendary Green Steel — ONE crafting container for both blank classes (#687).

A Legendary Green Steel blank is upgraded at three Legendary Altars (Invasion /
Subjugation / Devastation), taking ONE effect at each altar it declares. The
solver models that as a multi-tier choice-slot: a host carries
``legendary_green_steel_tiers`` — a list of ``{tier, item_class}`` slots — and
each slot takes at most one option from the pool keyed by the same pair. The
shape is Viktranium's per-slot select-one (``src/viktranium.py``), applied per
altar.

The pool is sourced natively from the gear-planner crafting catalog's six
``T<n> (Equipment|Weapon)`` menus (``crafting_catalog.legendary_green_steel_records``).
No wiki_url gate, no type remap, no quarantine: every option in those menus
records a Legendary Altar as its station, which ``container_registry`` asserts
(#653) — that guard, not this module's name, is what keeps a relabelled pool out.

History, so nobody re-derives it: this replaces ``src/green_steel.py`` (the
accessory half) and ``src/thunder_forged.py`` (the weapon half, under a name
describing a system with NO menu in the catalog — Thunder-Forged is crafted at
the Magma Forge in Thunderholme, not at a Legendary Altar). The two halves had
identical shapes, two host markers, two solver loops and two persisted result
keys; #687 folded them into one family once #194 made both reachable.
"""
from __future__ import annotations

from src import crafting_catalog

CLASSES = crafting_catalog.LEGENDARY_GREEN_STEEL_CLASSES
TIERS = (1, 2, 3)


def build_legendary_green_steel(catalog=None):
    """Source the pool from ``gearplanner_crafting.json`` via ``crafting_catalog``.

    Returns ``{records, quarantined, coverage, source_options}``. ``coverage``
    carries the totals the registry gate and the build's host loop read, plus a
    per-class breakdown so the two blank populations stay individually visible.
    """
    records = crafting_catalog.legendary_green_steel_records(catalog)
    # The SOURCE option count, per class and in total, so the fan-out gate can
    # judge option -> record cardinality (one record per OPTION; a multi-affix
    # option is never split — see the registry entry).
    by_class = {}
    for item_class in CLASSES:
        keys = [crafting_catalog.LEGENDARY_GREEN_STEEL_KEYS[(item_class, t)] for t in TIERS]
        recs = [r for r in records if r["item_class"] == item_class]
        by_tier = {}
        for r in recs:
            by_tier[r["tier"]] = by_tier.get(r["tier"], 0) + 1
        by_class[item_class] = {
            "source_options": crafting_catalog.count_menu_options(keys, catalog),
            "options_eligible": len(recs),
            "by_tier": by_tier,
            "tiers_sourced": sorted(by_tier),
            "tiers_pending": sorted(t for t in TIERS if by_tier.get(t, 0) == 0),
            "source": "gearplanner_crafting.json: " + ", ".join(keys),
        }
    source_options = sum(c["source_options"] for c in by_class.values())
    coverage = {
        "source_options": source_options,
        "options_split": len(records) - source_options,
        "options_eligible": len(records),
        "options_quarantined": 0,
        "quarantined": [],
        "pending": len(records) == 0,
        "by_class": by_class,
        "source": "gearplanner_crafting.json: "
                  + ", ".join(crafting_catalog.LEGENDARY_GREEN_STEEL_KEYS[(c, t)]
                              for c in CLASSES for t in TIERS),
        "note": "ONE multi-tier choice-slot pool for both Legendary Green Steel blank "
                "classes (#687): options keyed by (item_class, tier) over the native "
                "T1/T2/T3 Equipment and Weapon menus — the Altars of Invasion / "
                "Subjugation / Devastation. Hosts are the ML-26 `Legendary Green Steel *` "
                "blanks, whose own crafting[] declares their tiers "
                "(`legendary_green_steel_tiers`, #194). One record per OPTION carrying "
                "its `affixes` list; the solver takes one option per declared slot. The "
                "matched-tier aspects are disclosed per result, not modelled.",
    }
    return {"records": records, "quarantined": [], "coverage": coverage,
            "source_options": source_options}
