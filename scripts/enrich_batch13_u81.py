#!/usr/bin/env python3
"""Regenerate enriched_batch13_u81_demogorgon.json from the committed raw harvest.

Update 81 (Terror of Demogorgon) Legendary named gear — 119 of 166 legendary
(the wiki is authoritative for this brand-new content). Nearly every item carries
{{Nearly Complete|category|1}}, so enrichment activates them as U81 Nearly-Complete
crafting hosts. Reproducibility: reads only the committed raw + strict enrich parser.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import enrich  # noqa: E402

RAW = os.path.join(ROOT, "data", "seed", "compendium", "raw", "batch13_u81_demogorgon.json")
OUT = os.path.join(ROOT, "data", "seed", "compendium", "enriched_batch13_u81_demogorgon.json")

WEAPON_TYPES = {
    "Bastard Sword", "Battle Axe", "Club", "Dagger", "Dart", "Dwarven War Axe",
    "Falchion", "Great Axe", "Great Club", "Great Sword", "Handaxe", "Handwrap",
    "Kama", "Khopesh", "Kukri", "Light Hammer", "Light Mace", "Long Sword", "Maul",
    "Morningstar", "Quarterstaff", "Rapier", "Scimitar", "Short Sword", "Sickle",
    "War Hammer", "Warhammer", "Heavy Mace", "Heavy Pick", "Light Pick",
    "Long Bow", "Short Bow", "Light Crossbow", "Heavy Crossbow", "Great Crossbow",
    "Repeating Heavy Crossbow", "Repeating Light Crossbow", "Shuriken",
    "Throwing Axe", "Throwing Dagger", "Throwing Hammer",
}
SHIELD_TYPES = {"Buckler", "Small", "Large", "Tower", "Orb"}
ARMOR_TYPE = {"Cloth Armor": "cloth", "Light Armor": "light",
              "Medium Armor": "medium", "Heavy Armor": "heavy"}
SLOT_BY_TYPE = {"Trinket": "Trinket", "Necklace": "Necklace", "Ring": "Ring",
                "Belt": "Belt", "Bracers": "Bracers", "Boots": "Boots",
                "Gloves": "Gloves", "Goggles": "Goggles", "Cloak": "Cloak",
                "Helm": "Helmet"}


def resolve(wiki_type, name):
    """Return (slot, category, armor_type)."""
    if wiki_type in WEAPON_TYPES:
        return "Weapon", "weapon", None
    if wiki_type in SHIELD_TYPES:
        return "Off Hand", "item", None
    if wiki_type in ARMOR_TYPE or wiki_type == "Docent":
        return "Armor", "item", ARMOR_TYPE.get(wiki_type)
    if wiki_type in SLOT_BY_TYPE:
        return SLOT_BY_TYPE[wiki_type], "item", None
    # Rune arms carry no weapon/armor `type` on the wiki (type field absent) — that
    # null-type is the signal, not the item name (a name-substring heuristic would
    # mis-slot any future null-type non-rune-arm item).
    if wiki_type is None or "Rune Arm" in name:
        return "Rune Arm", "runearm", None
    return None, "item", None


def main():
    raw = json.load(open(RAW, encoding="utf-8"))
    items, skipped = [], []
    for name, r in raw["items"].items():
        slot, category, armor_type = resolve(r.get("type"), name)
        if slot is None:
            skipped.append((name, r.get("type")))
            continue
        ml = int(r["ml"]) if r.get("ml") else None
        wiki_url = f"https://ddowiki.com/page/Item:{name.replace(' ', '_')}"
        rec = enrich.build_item_record(name, slot, r["enh"], wiki_url,
                                       minimum_level=ml, armor_type=armor_type)
        rec["category"] = category
        if category == "weapon" and r.get("type"):
            rec["weapon_type"] = r["type"]
        if category == "runearm":
            rec["slot"] = "Rune Arm"
        items.append(rec)

    out = {
        "metadata": {
            "layer": "enriched", "batch": "batch13_u81_demogorgon",
            "system": "Update 81 (Terror of Demogorgon) Legendary named gear (partial 119/166)",
            "harvested": "2026-07-26", "count": len(items),
        },
        "items": items,
    }
    json.dump(out, open(OUT, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    nc = sum(1 for it in items if it.get("nearly_complete"))
    unmapped = sum(len(it.get("_enrich_unmapped", [])) for it in items)
    print(f"wrote {len(items)} enriched U81 items -> {os.path.relpath(OUT, ROOT)}")
    print(f"  Nearly-Complete hosts activated: {nc}")
    print(f"  weapons: {sum(1 for it in items if it.get('category')=='weapon')}, "
          f"rune arms: {sum(1 for it in items if it.get('category')=='runearm')}")
    print(f"  unmapped effects (strict): {unmapped}")
    if skipped:
        print(f"  skipped (unresolved slot): {skipped}")


if __name__ == "__main__":
    main()
