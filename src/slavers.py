"""#766 — Slaver's crafting: ONE container for the four typed slots, sourced natively.

The six Slaver's hosts — ``Chains``, ``Five Rings``, ``Shackles`` at heroic (ML 8)
and legendary (ML 28) — each declare four typed crafting slots in their own
``crafting[]`` (``Slaver's Prefix Slot`` … ``Legendary Slaver's Bonus Slot``) and a
``Slaver's Set Bonus`` slot. Fifteen more items per tier carry only the Set Bonus
slot. All of it sat on ``crafting_coverage.UNSERVED_ALLOWLIST`` under the note
"No pool", which was true of the *pipeline* and false of the source: the
gear-planner crafting catalog carries every one of the eight option pools with
native bonus types (Prefix 10, Suffix 25, Extra 27, Bonus 30 per tier), and the
two set-bonus pools naming three Slave Lord's sets each.

SHAPE. Mirrors Legendary Green Steel (``src/legendary_green_steel.py``): ATOMIC,
one record per craftable option carrying its own ``affixes`` list, keyed by
``(slot, tier)``. A host carries ``slavers_slots`` — ``[{slot, tier}]``, one per
declared label — and the solver takes at most one option per declared slot from
the pool keyed by the same pair (``Σ <= 1`` per slot, gated on the host).

THE TIER IS IN THE LABEL, NOT THE HOST'S ML. Viktranium derives its tier from the
host's ML with a 30 boundary (``lamordiaTier``). ``Legendary Chains`` is ML 28,
so that rule would file a legendary host under the heroic pool and hand it
``Charisma +5`` where the wiki says ``+13``. The label says ``Legendary``; the
label is the source, and ``parse_label`` is the one place it is read.

THE SET BONUS SLOT is chosen membership — the Vecna Lost Purpose primitive — and
lives in ``src/membership.py`` (``attach_slavers_set_bonus_slots``); this module
only names the pools it reads.

No wiki_url gate and no type remap: the options are the catalog's own, typed,
exactly as the Legendary Green Steel pool is taken. The Suffix pools carry
``Resistance`` — the all-saves umbrella — so ``build_dataset`` runs the
``spell_focus`` pass INSIDE each option (declared on the registry entry), never
across the record list.
"""
from __future__ import annotations

import re

from src import crafting_catalog

SLOTS = ("Prefix", "Suffix", "Extra", "Bonus")
TIERS = ("heroic", "legendary")
# The data's own vocabulary. The wiki's page title for this system was not
# readable from the build container and is deliberately not asserted here
# (plan 2026-09-14-007); relabelling is a one-line change once it is read.
STATION = "Slaver's crafting"

LABEL_RE = re.compile(r"^(Legendary )?Slaver's (Prefix|Suffix|Extra|Bonus) Slot$")
SET_BONUS_RE = re.compile(r"^(Legendary )?Slaver's Set Bonus$")


def pool_key(slot: str, tier: str) -> str:
    """The catalog menu key AND the host `crafting[]` label — they are the same
    string, which is what lets the coverage gate key the served labels off the
    records themselves rather than off this module's name."""
    return f"{'Legendary ' if tier == 'legendary' else ''}Slaver's {slot} Slot"


POOL_KEYS = {(slot, tier): pool_key(slot, tier) for tier in TIERS for slot in SLOTS}
SET_BONUS_KEYS = {"heroic": "Slaver's Set Bonus", "legendary": "Legendary Slaver's Set Bonus"}


def parse_label(label) -> tuple | None:
    """`"Legendary Slaver's Prefix Slot"` -> ("Prefix", "legendary"); None if not a
    Slaver's typed-slot label. Exact match, no name inference."""
    m = LABEL_RE.match(str(label or ""))
    if not m:
        return None
    return m.group(2), ("legendary" if m.group(1) else "heroic")


def parse_set_bonus_label(label) -> str | None:
    """`"Slaver's Set Bonus"` -> "heroic", `"Legendary Slaver's Set Bonus"` ->
    "legendary"; None otherwise."""
    m = SET_BONUS_RE.match(str(label or ""))
    if not m:
        return None
    return "legendary" if m.group(1) else "heroic"


def set_names_for_tier(tier: str, catalog: dict = None) -> list:
    """The set names the tier's `Slaver's Set Bonus` pool offers, in native order.
    NOT filtered to sets the catalog defines — that resolution, and the
    disclosure of the names it drops, is `membership.attach_slavers_set_bonus_slots`."""
    catalog = crafting_catalog.load_catalog() if catalog is None else catalog
    return [o.get("set") for o in crafting_catalog.menu_options(SET_BONUS_KEYS[tier], catalog)
            if o.get("set")]


def _option_name(affixes: list) -> str:
    """The catalog's Slaver's options carry no `name`, so the option IS its affix
    — named the way the wizard's picker already renders a nameless row
    (`craftOptionName`): `Charisma +5 (Enhancement)`. Unique within a pool,
    because two options differing only in bonus type differ here too."""
    a = affixes[0]
    stat, ty, val = a.get("stat"), a.get("bonus_type"), a.get("value")
    if ty == "Bool":
        return str(stat)
    return f"{stat} +{val} ({ty})"


def build_slavers(catalog: dict = None) -> dict:
    """Source the pool from `gearplanner_crafting.json`.

    Returns `{records, quarantined, coverage, source_options}`. `coverage` carries
    the source/eligible counts per pool and per tier so the registry gate can
    judge option -> record cardinality, and the build fills in the host counts.
    """
    catalog = crafting_catalog.load_catalog() if catalog is None else catalog
    records, by_pool, by_tier = [], {}, {}
    for tier in TIERS:
        by_tier[tier] = {"source_options": 0, "options_eligible": 0}
        for slot in SLOTS:
            key = POOL_KEYS[(slot, tier)]
            opts = crafting_catalog.menu_options(key, catalog)
            eligible = 0
            for opt in opts:
                affixes = [crafting_catalog.legacy_affix(aff)
                           for aff in crafting_catalog.iter_affixes(opt)]
                if not affixes:
                    continue   # an option may be DROPPED (nothing to craft), never split
                records.append({
                    "name": opt.get("name") or _option_name(affixes),
                    "slot": slot,
                    "tier": tier,
                    "pool_key": key,
                    "ml": opt.get("ml"),
                    "affixes": affixes,
                    "source_stations": crafting_catalog.source_stations(opt),
                })
                eligible += 1
            by_pool[key] = {"source_options": len(opts), "options_eligible": eligible}
            by_tier[tier]["source_options"] += len(opts)
            by_tier[tier]["options_eligible"] += eligible
    source_options = crafting_catalog.count_menu_options(POOL_KEYS.values(), catalog)
    coverage = {
        "source_options": source_options,
        "options_eligible": len(records),
        "options_split": 0,
        "by_pool": by_pool,
        "by_tier": by_tier,
        "source": "gearplanner_crafting.json: " + ", ".join(POOL_KEYS.values()),
    }
    return {"records": records, "quarantined": [], "coverage": coverage,
            "source_options": source_options}
