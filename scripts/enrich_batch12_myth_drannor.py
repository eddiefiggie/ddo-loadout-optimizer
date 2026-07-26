#!/usr/bin/env python3
"""Regenerate enriched_batch12_myth_drannor.json from the committed raw harvest.

Myth Drannor (Update 69) Legendary named gear — the endgame-band subset (196 of
the 614 Update 69 named items), consistent with the compendium's endgame scope.
Reproducibility contract: reads only data/seed/compendium/raw/batch12_myth_drannor.json
+ the strict enrich parser — no hand-authored values.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import enrich  # noqa: E402

RAW = os.path.join(ROOT, "data", "seed", "compendium", "raw", "batch12_myth_drannor.json")
OUT = os.path.join(ROOT, "data", "seed", "compendium", "enriched_batch12_myth_drannor.json")

ARMOR_TYPE = {
    "Cloth": "cloth", "Clothing": "cloth", "Light Armor": "light",
    "Medium Armor": "medium", "Heavy Armor": "heavy",
}
# Off Hand shield / orb / runearm item types (no Off Hand solver slot yet).
SHIELD_TYPES = {"Buckler", "Small", "Large", "Tower", "Orb"}


def main():
    raw = json.load(open(RAW, encoding="utf-8"))
    items, weap, runearm = [], 0, 0
    for name, r in raw["items"].items():
        slot = r.get("slot")
        wiki_type = r.get("type")
        # Bows/crossbows weren't roster-indexed: infer the weapon slot.
        if not slot:
            slot = "Weapon"
        ml = int(r["ml"]) if r.get("ml") else None
        wiki_url = f"https://ddowiki.com/page/Item:{name.replace(' ', '_')}"
        armor_type = ARMOR_TYPE.get(wiki_type) if slot == "Armor" else None
        rec = enrich.build_item_record(name, slot, r["enh"], wiki_url,
                                       minimum_level=ml, armor_type=armor_type)
        # Solver routing: weapons -> Main Hand (category weapon), rune arms ->
        # Rune Arm (category runearm). Shields keep category item (no Off Hand
        # solver slot yet — browse-only, disclosed).
        if slot == "Weapon":
            rec["category"] = "weapon"
            if wiki_type:
                rec["weapon_type"] = wiki_type
            weap += 1
        elif slot == "Rune Arm" or "Rune Arm" in name:
            rec["category"] = "runearm"
            rec["slot"] = "Rune Arm"
            runearm += 1
        items.append(rec)

    out = {
        "metadata": {
            "layer": "enriched", "batch": "batch12_myth_drannor",
            "system": "Myth Drannor (Update 69) Legendary named gear",
            "harvested": "2026-07-26", "count": len(items),
        },
        "items": items,
    }
    json.dump(out, open(OUT, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    unmapped = sum(len(it.get("_enrich_unmapped", [])) for it in items)
    withaffix = sum(1 for it in items if any(
        not e.endswith("Augment Slot") and not e.endswith("(set)") for e in it["enhancements"]))
    print(f"wrote {len(items)} enriched Myth Drannor items -> {os.path.relpath(OUT, ROOT)}")
    print(f"  weapons (category weapon): {weap}, rune arms: {runearm}")
    print(f"  items with >=1 mapped affix: {withaffix}")
    print(f"  unmapped effects (strict, never guessed): {unmapped}")


if __name__ == "__main__":
    main()
