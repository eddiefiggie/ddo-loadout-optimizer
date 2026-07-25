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
canonical category, an explicit ``(stat, bonus_type, value)`` per tier, and a
non-empty ``wiki_url``. Ambiguous records — a non-canonical category, an
unreconciled bonus type — are quarantined with a reason, never inferred. Sourced
via Claude-in-Chrome (plain fetch returns empty for ddowiki).
"""
from __future__ import annotations

# The six Nearly Complete categories (the wiki's names on the Nearly_Complete page).
CATEGORIES = {
    "Ability Score", "Insightful Ability Score", "Quality Ability Score",
    "Healing Amplification", "Skill", "Spell Focus",
}


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
        "by_category": by_category,
        "item_hosts": "pending — U81 named-item pages not yet published",
    }
    return {"records": records, "quarantined": quarantined, "coverage": coverage}
