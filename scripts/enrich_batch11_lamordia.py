#!/usr/bin/env python3
"""Regenerate enriched_batch11_lamordia.json from the committed raw harvest.

Lamordia named gear: the Legendary Cataclysmic weapons/shields (Viktranium
item-creation output) + the Lamordian clothing line. Every item is a Viktranium
host (carries {{Lamordia Slot|type|category}}), so enriching them activates
additional Viktranium hosts alongside their base affixes + augment slots.

Reproducibility contract: this reads only data/seed/compendium/raw/batch11_lamordia.json
and the strict enrich parser — no hand-authored values.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import enrich  # noqa: E402

RAW = os.path.join(ROOT, "data", "seed", "compendium", "raw", "batch11_lamordia.json")
OUT = os.path.join(ROOT, "data", "seed", "compendium", "enriched_batch11_lamordia.json")

# wiki `type` -> the pipeline's armor_type (dodge-cap model). Docent has no
# cloth/light/medium/heavy analogue in that model, so it is left unset.
ARMOR_TYPE = {
    "Cloth": "cloth", "Light Armor": "light", "Medium Armor": "medium",
    "Heavy Armor": "heavy",
}


def main():
    raw = json.load(open(RAW, encoding="utf-8"))
    items = []
    for name, r in raw["items"].items():
        slot = r["slot"]
        ml = int(r["ml"]) if r.get("ml") else None
        wiki_url = f"https://ddowiki.com/page/Item:{name.replace(' ', '_')}"
        armor_type = ARMOR_TYPE.get(r.get("type")) if slot == "Armor" else None
        rec = enrich.build_item_record(name, slot, r["enh"], wiki_url,
                                       minimum_level=ml, armor_type=armor_type)
        # A weapon reaches the solver's Main Hand only as category "weapon"
        # (model.js routes Main Hand by category==="weapon"); the default "item"
        # would strand it browse-only. Shields keep category "item" (no Off Hand
        # solver slot yet — browse-only, disclosed).
        if slot == "Weapon":
            rec["category"] = "weapon"
            if r.get("type"):
                rec["weapon_type"] = r["type"]
        items.append(rec)

    out = {
        "metadata": {
            "layer": "enriched",
            "batch": "batch11_lamordia",
            "system": "Lamordia named gear — Cataclysmic weapons/shields + Lamordian clothing (all Viktranium hosts)",
            "harvested": "2026-07-26",
            "count": len(items),
        },
        "items": items,
    }
    json.dump(out, open(OUT, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    # honest coverage summary
    hosts = sum(1 for it in items if it.get("lamordia_slots"))
    unmapped = sum(len(it.get("_enrich_unmapped", [])) for it in items)
    print(f"wrote {len(items)} enriched Lamordia items -> {os.path.relpath(OUT, ROOT)}")
    print(f"  Viktranium hosts activated: {hosts}")
    print(f"  weapons (category=weapon, solver Main Hand): {sum(1 for it in items if it.get('category')=='weapon')}")
    print(f"  unmapped effects (strict, never guessed): {unmapped}")


if __name__ == "__main__":
    main()
