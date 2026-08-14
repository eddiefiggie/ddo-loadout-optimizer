"""U1 — Update 81 "Nearly Complete" crafting parser (strict wiki provenance).

Nearly Complete lets an item gain one extra affix chosen from a **category**
menu (Ability Score, Insightful Ability Score, Quality Ability Score, Healing
Amplification, Skill, Spell Focus). Each category fixes the bonus type per option
and shares a per-tier magnitude (Heroic ML11 / Legendary ML35); the player picks
the stat. Structurally this is the augment/Dino choice-slot with a parametric,
category-shared option pool — so this parser mirrors `src/dino_parser.py`: it
turns a freshly-sourced seed (``data/seed/nearly_complete.json``) into structured
option records and QUARANTINES anything it cannot verify.

Strict wiki provenance (KTD2). An option record is solver-eligible only with a
canonical category, a canonical ``bonus_type`` (in ``affix_parser.BONUS_TYPES``),
a present ``stat`` (run through the item pipeline stat name to match the item
pipeline's vocabulary), an integer per-tier ``value``, and a non-empty
``wiki_url``. Anything else is quarantined with a reason, never inferred.
Choosing between two source spellings of a bonus type (e.g. the release notes'
"Competence Positive Amplification" vs the Nearly_Complete page's wording) is a
seed-authoring reconciliation, not parser logic — the parser only rejects a type
outside the canonical set. Sourced via Claude-in-Chrome (plain fetch returns
empty for ddowiki).
"""
from __future__ import annotations

from src.affix_parser import BONUS_TYPES
from src import crafting_catalog

# The six Nearly Complete categories (the wiki's names on the Nearly_Complete page).
CATEGORIES = {
    "Ability Score", "Insightful Ability Score", "Quality Ability Score",
    "Healing Amplification", "Skill", "Spell Focus",
}

# Native menu-pool key per category in gearplanner_crafting.json.
_NATIVE_NC_KEY = {c: f"Nearly Complete: {c}" for c in CATEGORIES}
# Per-item Nearly Complete pools — keyed by HOST NAME, not category. These are a
# DISTINCT mechanism from the category menu path (review F5: never conflated).
_NC_PER_ITEM_KEYS = ["Nearly Finished", "Almost There"]
# Nearly Complete host tier boundary: Legendary is ML35 (matches the solver's
# host-tier derivation in solver.js), Heroic ML11.
_NC_LEGENDARY_ML = 35


def _nc_tier_from_ml(ml):
    return "legendary" if (ml or 0) >= _NC_LEGENDARY_ML else "heroic"


def parse_categories(cats):
    """Parse the seed's category list into ``(records, quarantined)``.

    Each eligible record is ``{category, stat, bonus_type, value, unit, tier,
    wiki_url}``. Both tiers (heroic, legendary) expand to separate records.
    """
    records, quarantined = [], []
    for c in cats or []:
        category = (c.get("category") or "").strip()
        wiki_url = (c.get("wiki_url") or "").strip()
        if category not in CATEGORIES:
            quarantined.append({"raw": category, "reason": "unrecognized category"})
            continue
        if not wiki_url:
            quarantined.append({"raw": category, "reason": "missing wiki_url"})
            continue
        tier_values = {"heroic": c.get("heroic_value"), "legendary": c.get("legendary_value")}
        for opt in c.get("options") or []:
            stat = (opt.get("stat") or "").strip()
            bonus_type = (opt.get("bonus_type") or "").strip()
            if not stat or not bonus_type:
                quarantined.append({"raw": f"{category}: {opt}", "reason": "missing stat or bonus_type"})
                continue
            if bonus_type not in BONUS_TYPES:
                quarantined.append({"raw": f"{category}: {stat} ({bonus_type})", "reason": "unrecognized bonus type"})
                continue
            for tier, val in tier_values.items():
                if not isinstance(val, int):
                    quarantined.append({"raw": f"{category}/{stat}/{tier}", "reason": "missing magnitude"})
                    continue
                records.append({
                    "category": category, "stat": stat, "bonus_type": bonus_type,
                    "value": val, "unit": "flat", "tier": tier, "wiki_url": wiki_url,
                })
    return records, quarantined


def parse_nearly_complete(seed):
    """Parse a ``nearly_complete`` seed dict into structured records + coverage."""
    seed = seed or {}
    records, quarantined = parse_categories(seed.get("categories"))
    by_category = {}
    for r in records:
        by_category[r["category"]] = by_category.get(r["category"], 0) + 1
    coverage = {
        "categories_sourced": sorted({r["category"] for r in records}),
        "options_eligible": len(records),
        "options_quarantined": len(quarantined),
        "quarantined": quarantined,  # surface the reasons (mirrors dino coverage)
        "by_category": by_category,
        "item_hosts": "pending — U81 named-item pages not yet published",
    }
    return {"records": records, "quarantined": quarantined, "coverage": coverage}


def build_nearly_complete(catalog: dict = None) -> dict:
    """Native path (U4b-ii): source the Nearly Complete pools from
    ``gearplanner_crafting.json`` via ``crafting_catalog`` instead of the legacy
    ``nearly_complete.json`` seed. The strict parser gate is REMOVED, not swapped
    (F1) — native affixes flow through verbatim via ``legacy_affix``.

    TWO distinct pools (never conflated — review F5):
      * the 6 ``Nearly Complete: <category>`` MENU pools -> category ``records``
        (tier from the option's native ``ml``), the solver-consumed category path;
      * the ``Nearly Finished`` / ``Almost There`` PER-ITEM pools keyed by host
        name -> ``per_item`` ``{host: [{stat, bonus_type, value, unit, name?,
        pool}]}``, a separate per-host mechanism.

    Returns ``{records, per_item, quarantined, coverage}`` (superset of
    ``parse_nearly_complete``'s shape)."""
    catalog = crafting_catalog.load_catalog() if catalog is None else catalog

    # -- category menu path --------------------------------------------------
    # ATOMIC since #211: one record per craftable OPTION, carrying its own
    # `affixes` list — the same UNIT shape as a Viktranium option or a Dino
    # insert. The pool was FLAT (one record per affix) while every option
    # carried exactly one affix; the ability-skills umbrellas broke that
    # invariant, because their single stored affix expands into four-to-six
    # skills that one craft grants TOGETHER. A flat pool under the solver's
    # Sigma <= 1 would tell the player they get one skill of the six — the
    # exact Viktranium defect (src/container_registry.py) one channel over.
    records = []
    source_options = 0
    for category in sorted(CATEGORIES):
        key = _NATIVE_NC_KEY[category]
        if key not in catalog:
            continue
        for opt in crafting_catalog.menu_options(key, catalog):
            source_options += 1
            tier = _nc_tier_from_ml(opt.get("ml"))
            affixes = [crafting_catalog.legacy_affix(aff)
                       for aff in crafting_catalog.iter_affixes(opt)]
            if not affixes:
                continue
            name = (opt.get("name") or "").strip()
            records.append({"category": category, "tier": tier, "wiki_url": "",
                            **({"name": name} if name else {}),
                            "affixes": affixes})

    # -- per-item path (kept SEPARATE from the category path) ----------------
    per_item = {}
    per_item_source_options = 0
    for key in _NC_PER_ITEM_KEYS:
        if key not in catalog:
            continue
        for host, opts in crafting_catalog.peritem_options(key, catalog).items():
            bucket = per_item.setdefault(host, [])
            for opt in opts or []:
                per_item_source_options += 1
                name = (opt.get("name") or "").strip()
                for aff in crafting_catalog.iter_affixes(opt):
                    rec = crafting_catalog.legacy_affix(aff)
                    rec["pool"] = key
                    if name:
                        rec["name"] = name
                    bucket.append(rec)

    by_category = {}
    for r in records:
        by_category[r["category"]] = by_category.get(r["category"], 0) + 1
    coverage = {
        "source_options": source_options,
        "per_item_source_options": per_item_source_options,
        "categories_sourced": sorted({r["category"] for r in records}),
        "options_eligible": len(records),
        "options_quarantined": 0,
        "quarantined": [],
        "by_category": by_category,
        "source": "gearplanner_crafting.json: Nearly Complete: <category> menus "
                  "(category path) + Nearly Finished / Almost There (per-item path)",
        # Category-path host disclosure is still pending the U81 named-item pages;
        # the per-item path DOES carry real hosts (counted separately, not conflated).
        "item_hosts": "pending — U81 named-item pages not yet published (category path)",
        "per_item_hosts": len(per_item),
        "per_item_options": sum(len(v) for v in per_item.values()),
        "per_item_pools": list(_NC_PER_ITEM_KEYS),
    }
    return {"records": records, "per_item": per_item, "quarantined": [],
            "coverage": coverage, "source_options": source_options,
            "per_item_source_options": per_item_source_options}
