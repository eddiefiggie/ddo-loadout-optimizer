"""U1/U2 — Viktranium Experiment ("Lamordia") crafting parser (strict provenance).

Viktranium Experiment crafting (Update 75, The Chill of Ravenloft) is the system whose in-data slots the
enrichment mislabels "Lamordia" (the ``{{Lamordia Slot|<type>|<category>}}``
template). An item carries **typed** slots — Melancholic / Dolorous / Miserable /
Woeful — and each typed slot is filled from an option pool that depends on BOTH
the slot's type AND the item's category (Weapon / Accessory / Armor). So unlike
Nearly Complete's single-category key, the pool key is ``(slot_type, category)``
(KTD1). Each option has a Heroic (ML8) and Legendary (ML34) magnitude; the tier
is derived from the host item's ML (KTD3), so a record is emitted per tier.

Structurally this is the same gated select-one choice-slot as Nearly Complete and
the Dino inserts, so this module mirrors ``src/nearly_complete.py``: it turns the
freshly-sourced seed (``data/seed/viktranium.json``) into structured option
records and QUARANTINES anything it cannot verify.

Strict wiki provenance. An option is solver-eligible only with a canonical
``slot_type`` and ``category``, a canonical ``bonus_type`` (in
``affix_parser.BONUS_TYPES``), a present ``stat`` (run through
the item pipeline stat name to match the item pipeline's vocabulary), an integer
per-tier ``value``, and a non-empty ``wiki_url``. Anything else is quarantined
with a reason, never inferred. Weapon procs ("On hit: 2d6 Fire Damage", material
types), descriptive effects ("You have Deathblock"), and multi-affix options are
quarantined — no magnitude is ever invented to rescue one. Sourced via
Claude-in-Chrome (plain fetch returns empty for ddowiki).

``structure_from_raw`` is the regeneration path: it parses the committed raw
effect text (``data/seed/compendium/raw/viktranium.json``) into the structured
seed via ``affix_parser``, so ``viktranium.json`` is reproducible from raw (U5).
"""
from __future__ import annotations

import re

from src.affix_parser import BONUS_TYPES, parse_line
from src import crafting_catalog

# The four Viktranium slot types (the wiki's recipe-table names).
SLOT_TYPES = {"Melancholic", "Dolorous", "Miserable", "Woeful"}
# Viktranium host tier boundary: Legendary is ML>=30 (matches solver.js
# lamordiaTier, the single source of truth), Heroic below. Native option MLs are
# Heroic ML8 / Legendary ML34.
_VIK_LEGENDARY_ML = 30


def _vik_tier_from_ml(ml):
    return "legendary" if (ml or 0) >= _VIK_LEGENDARY_ML else "heroic"
# The three item categories. Keyed to the singular form the ``{{Lamordia Slot}}``
# template uses on host items; the recipe-table headings use the plural, which
# ``normalize_category`` folds in.
CATEGORIES = {"Weapon", "Accessory", "Armor"}
_CATEGORY_ALIASES = {
    "weapons": "Weapon", "weapon": "Weapon",
    "accessories": "Accessory", "accessory": "Accessory",
    "armors": "Armor", "armor": "Armor",
}


def normalize_category(cat):
    """Fold a recipe-table heading ("Accessories") or template arg ("Accessory")
    to the canonical singular category key. Returns None if unrecognized."""
    return _CATEGORY_ALIASES.get((cat or "").strip().lower())


# The base seed (data/seed/ddo_items.json) predates the {{Lamordia Slot}}
# template and encodes host slots as human-readable enhancement strings. These
# flow through the affix parser (not enrich.py), where they would otherwise be
# dropped as noise — so a base-seed Lamordia host would look slot-less (the
# silent value-loss trap). ``parse_base_lamordia`` recovers them. Three shapes:
#   "Lamordia: <Type> Slot (<Category>)"
#   "Lamordia: <T1> / <T2> / <T3> Slots (<Category>)"
#   "Lamordia weapon slots: <T1> / <T2> / ..."   (category implied Weapon)
_BASE_WEAPON = re.compile(r"^Lamordia\s+weapon\s+slots?\s*:\s*(.+)$", re.I)
_BASE_TYPED = re.compile(r"^Lamordia\s*:\s*(.+?)\s+Slots?\s*\(([^)]+)\)\s*$", re.I)


def is_base_lamordia_line(line):
    """True if an enhancement string is a base-seed Lamordia slot marker."""
    s = str(line).strip()
    return bool(_BASE_WEAPON.match(s) or _BASE_TYPED.match(s))


def parse_base_lamordia(enhancements):
    """Parse base-seed Lamordia slot markers into ``lamordia_slots`` records
    ``[{type, category}]``. Unknown slot types / categories are skipped, never
    inferred (strict provenance)."""
    slots = []
    for line in enhancements or []:
        s = str(line).strip()
        m = _BASE_WEAPON.match(s)
        if m:
            for t in re.split(r"\s*/\s*", m.group(1).strip()):
                if t.strip() in SLOT_TYPES:
                    slots.append({"type": t.strip(), "category": "Weapon"})
            continue
        m = _BASE_TYPED.match(s)
        if m:
            category = normalize_category(m.group(2))
            if category is None:
                continue
            for t in re.split(r"\s*/\s*", m.group(1).strip()):
                if t.strip() in SLOT_TYPES:
                    slots.append({"type": t.strip(), "category": category})
    return slots


# ---------------------------------------------------------------------------
# Regeneration path: raw harvested effect text -> structured seed (U5).
# ---------------------------------------------------------------------------

def _affix_from_effect(effect):
    """Parse one option's effect text into a single ``(stat, bonus_type, value,
    unit)`` affix, or return ``(None, reason)``.

    Strict: only a lone, cleanly value-bearing affix qualifies. Procs, material
    types, descriptive effects, and multi-affix options yield no affix and carry
    a reason for quarantine — never inferred.
    """
    text = (effect or "").strip()
    if not text:
        return None, "empty effect"
    # An option may list several stat lines (newline-joined). Parse each; only a
    # single clean affix qualifies as a select-one option (multi-affix deferred).
    segments = [s.strip().rstrip(".").strip()
                for s in text.replace("\r", "\n").split("\n") if s.strip()]
    affixes = []
    for seg in segments:
        r = parse_line(seg)
        if r["kind"] == "affix":
            affixes.extend(r["affixes"])
    if not affixes:
        return None, "no parseable magnitude (proc / material / descriptive)"
    if len(affixes) > 1:
        return None, f"multi-affix option ({len(affixes)} affixes) — deferred"
    a = affixes[0]
    return {"stat": a["stat"], "bonus_type": a["bonus_type"],
            "value": a["value"], "unit": a["unit"]}, None


def structure_from_raw(raw, wiki_url):
    """Parse the raw harvested tables into a structured seed dict.

    ``raw`` is the harvested list of ``{heading, count, rows:[{name, heroic,
    legendary}]}`` tables (headings like "Melancholic (Accessories)"). Returns
    ``{"metadata": ..., "pools": [...]}`` where each pool is
    ``{slot_type, category, wiki_url, options:[{name, stat, bonus_type, unit,
    heroic_value, legendary_value}]}``. Rows whose Heroic/Legendary effects do
    not both parse to the same single affix are dropped from the seed and land
    in the returned ``quarantined`` list with a reason.
    """
    pools = {}
    quarantined = []
    for table in raw or []:
        heading = (table.get("heading") or "").strip()
        m = re.match(r"^(\w+)\s*\(([^)]+)\)", heading)
        if not m:
            continue
        slot_type = m.group(1)
        category = normalize_category(m.group(2))
        if slot_type not in SLOT_TYPES or category is None:
            continue
        for row in table.get("rows") or []:
            name = (row.get("name") or "").strip()
            h_aff, h_reason = _affix_from_effect(row.get("heroic"))
            l_aff, l_reason = _affix_from_effect(row.get("legendary"))
            if h_aff is None or l_aff is None:
                quarantined.append({
                    "raw": f"{slot_type}/{category}/{name}",
                    "reason": h_reason or l_reason,
                })
                continue
            # Heroic and Legendary must describe the same stat + bonus type;
            # only the magnitude scales across tiers.
            if (h_aff["stat"], h_aff["bonus_type"], h_aff["unit"]) != \
               (l_aff["stat"], l_aff["bonus_type"], l_aff["unit"]):
                quarantined.append({
                    "raw": f"{slot_type}/{category}/{name}",
                    "reason": "heroic/legendary stat or bonus-type mismatch",
                })
                continue
            key = (slot_type, category)
            pools.setdefault(key, []).append({
                "name": name,
                "stat": h_aff["stat"],
                "bonus_type": h_aff["bonus_type"],
                "unit": h_aff["unit"],
                "heroic_value": h_aff["value"],
                "legendary_value": l_aff["value"],
            })
    pool_list = [
        {"slot_type": st, "category": cat, "wiki_url": wiki_url, "options": opts}
        for (st, cat), opts in sorted(pools.items())
    ]
    seed = {
        "metadata": {
            "system": "Update 75 (The Chill of Ravenloft) — Viktranium Experiment crafting "
                      "(the in-data \"Lamordia\" typed slots; Lamordia is the Ravenloft domain "
                      "these augments are themed on)",
            "note": "Sourced from ddowiki.com/page/Viktranium_Experiment_crafting "
                    "via Claude-in-Chrome (plain fetch returns empty for ddowiki). "
                    "Typed choice-slot: pool keyed by (slot_type, item-category); "
                    "Heroic ML8 / Legendary ML34 magnitudes. Regenerable from "
                    "data/seed/compendium/raw/viktranium.json via "
                    "src.viktranium.structure_from_raw.",
            "wiki_url": wiki_url,
        },
        "pools": pool_list,
    }
    return seed, quarantined


# ---------------------------------------------------------------------------
# Load path: structured seed -> validated tier-expanded records (mirror NC).
# ---------------------------------------------------------------------------

def parse_pools(pools):
    """Parse the seed's pool list into ``(records, quarantined)``.

    Each eligible record is ``{slot_type, category, name, stat, bonus_type,
    value, unit, tier, wiki_url}``. Both tiers (heroic, legendary) expand to
    separate records.
    """
    records, quarantined = [], []
    for p in pools or []:
        slot_type = (p.get("slot_type") or "").strip()
        category = normalize_category(p.get("category"))
        wiki_url = (p.get("wiki_url") or "").strip()
        if slot_type not in SLOT_TYPES:
            quarantined.append({"raw": slot_type, "reason": "unrecognized slot type"})
            continue
        if category is None:
            quarantined.append({"raw": p.get("category"), "reason": "unrecognized category"})
            continue
        if not wiki_url:
            quarantined.append({"raw": f"{slot_type}/{category}", "reason": "missing wiki_url"})
            continue
        for opt in p.get("options") or []:
            name = (opt.get("name") or "").strip()
            stat = (opt.get("stat") or "").strip()
            bonus_type = (opt.get("bonus_type") or "").strip()
            unit = (opt.get("unit") or "flat").strip()
            if not stat or not bonus_type:
                quarantined.append({"raw": f"{slot_type}/{category}: {opt}",
                                    "reason": "missing stat or bonus_type"})
                continue
            if bonus_type not in BONUS_TYPES:
                quarantined.append({"raw": f"{slot_type}/{category}: {stat} ({bonus_type})",
                                    "reason": "unrecognized bonus type"})
                continue
            tier_values = {"heroic": opt.get("heroic_value"),
                           "legendary": opt.get("legendary_value")}
            for tier, val in tier_values.items():
                if not isinstance(val, int):
                    quarantined.append({"raw": f"{slot_type}/{category}/{name}/{tier}",
                                        "reason": "missing magnitude"})
                    continue
                records.append({
                    "slot_type": slot_type, "category": category, "name": name,
                    "stat": stat, "bonus_type": bonus_type, "value": val,
                    "unit": unit, "tier": tier, "wiki_url": wiki_url,
                })
    return records, quarantined


def parse_viktranium(seed):
    """Parse a ``viktranium`` seed dict into structured records + coverage."""
    seed = seed or {}
    records, quarantined = parse_pools(seed.get("pools"))
    by_pool = {}
    for r in records:
        key = f"{r['slot_type']}/{r['category']}"
        by_pool[key] = by_pool.get(key, 0) + 1
    coverage = {
        "slot_types_sourced": sorted({r["slot_type"] for r in records}),
        "categories_sourced": sorted({r["category"] for r in records}),
        "options_eligible": len(records),
        "options_quarantined": len(quarantined),
        "quarantined": quarantined,  # surface the reasons (mirrors dino / NC coverage)
        "by_pool": by_pool,
        "item_hosts": "resolved from {{Lamordia Slot|...}} on enriched items "
                      "and human-readable Lamordia strings on base-seed items",
        # Honest scope disclosure (U5). The four typed augment pools
        # (Melancholic / Dolorous / Miserable / Woeful) that fill the {{Lamordia
        # Slot}} choice-slots are sourced. Weapon-proc / material-type / "You
        # have X" / multi-affix options are quarantined, never inferred. The
        # "Cataclysmic Weapons and Shields" arm of the Viktranium page is
        # item-CREATION (a new named weapon), not an affix choice-slot, so it is
        # deferred to named-gear sourcing (R4) rather than modeled here.
        "arms_note": "typed augment pools sourced; Cataclysmic weapon/shield "
                     "creation is item-creation (deferred to named-gear R4), "
                     "not a choice-slot",
    }
    return {"records": records, "quarantined": quarantined, "coverage": coverage}


def build_viktranium(catalog: dict = None) -> dict:
    """Native path (U4b-ii): source the Viktranium typed pools from
    ``gearplanner_crafting.json`` via ``crafting_catalog`` instead of the legacy
    ``viktranium.json`` seed. The strict parser gate is REMOVED, not swapped
    (F1) — native affixes flow through verbatim via ``legacy_affix``. The pool
    key is the native ``<SlotType> (<Category>)`` menu, Category in
    (Accessory, Armor, Weapon); the specialized ``(quarterstaff)`` /
    ``(artifact)`` variant pools are out of scope (no host slot references them).
    Tier is derived from the option's native ``ml``. Returns the same
    ``{records, quarantined, coverage}`` shape ``parse_viktranium`` does.

    **A choice-slot option is atomic**, so ONE native option becomes ONE record
    carrying its whole affix list — the ``{..., affixes: [...]}`` shape
    ``src/dino.py`` already proves for inserts. Removing the strict gate without
    adding that container left this path emitting one record PER affix, which
    told the solver a multi-affix option could be taken in halves and made the
    seven schools of an expanded universal spell-DC option seven *competing*
    options for the same slot. 23 of the 289 native options are genuinely
    multi-affix."""
    catalog = crafting_catalog.load_catalog() if catalog is None else catalog
    records = []
    # SOURCE option count, reported so the fan-out gate can hold this container to
    # one record per option. ATOMIC shape alone does not prove that — two halves of
    # a split option, each wrapped in a one-element `affixes` list, wear the same
    # shape. Only the count catches it (src/container_registry.py).
    source_options = 0
    for slot_type in sorted(SLOT_TYPES):
        for category in sorted(CATEGORIES):
            key = f"{slot_type} ({category})"
            if key not in catalog:
                continue  # not every (type, category) combination has a pool
            for opt in crafting_catalog.menu_options(key, catalog):
                source_options += 1
                affixes = [crafting_catalog.legacy_affix(a)
                           for a in crafting_catalog.iter_affixes(opt)]
                if not affixes:
                    continue
                records.append({
                    "slot_type": slot_type, "category": category,
                    "name": (opt.get("name") or "").strip(),
                    "tier": _vik_tier_from_ml(opt.get("ml")),
                    "affixes": affixes, "wiki_url": "",
                })
    by_pool = {}
    for r in records:
        k = f"{r['slot_type']}/{r['category']}"
        by_pool[k] = by_pool.get(k, 0) + 1
    coverage = {
        "source_options": source_options,
        "slot_types_sourced": sorted({r["slot_type"] for r in records}),
        "categories_sourced": sorted({r["category"] for r in records}),
        "options_eligible": len(records),
        "options_quarantined": 0,
        "quarantined": [],
        "by_pool": by_pool,
        "source": "gearplanner_crafting.json: <SlotType> (<Category>) menus",
        "item_hosts": "resolved from {{Lamordia Slot|...}} on enriched items "
                      "and human-readable Lamordia strings on base-seed items",
        "arms_note": "typed augment pools sourced natively (Accessory/Armor/Weapon); "
                     "(quarterstaff)/(artifact) variant pools deferred (no host slot "
                     "references them); Cataclysmic weapon/shield creation is "
                     "item-creation (deferred to named-gear R4), not a choice-slot",
    }
    return {"records": records, "quarantined": [], "coverage": coverage,
            "source_options": source_options}
