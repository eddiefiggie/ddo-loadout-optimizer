#!/usr/bin/env python3
"""Enrich named gear from the community DDO gear-planner dataset (bulk, strict).

Source: illusionistpm/ddo-gear-planner `site/src/assets/items.json` (itself
ddowiki-parsed), committed at data/seed/compendium/raw/gearplanner_items.json.
Far more token-efficient than per-item wiki harvest: each item already carries
parsed affixes {name, type, value}. We convert those to affix STRINGS and run
them through THIS repo's strict `affix_parser` (via the normal variant pipeline),
so provenance and eligibility are still decided by our own parser — the planner
supplies the tuples, not the trusted values. Bool procs and base weapon/armor
enhancement bonuses are dropped (non-ranked). Crafting slots (Dino/Viktranium)
are NOT taken from here — those were sourced directly from the wiki.

Usage: python3 scripts/enrich_from_planner.py <expansion> where expansion is one
of the QUEST_MAP keys. Filters to endgame ML and excludes items already modeled
(Dinosaur Bone blanks) or already enriched from the wiki batches.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

SRC = os.path.join(ROOT, "data", "seed", "compendium", "raw", "gearplanner_items.json")

QUEST_MAP = {
    "iod": ["The Isle of Dread", "Dinosaur Crisis", "Isle of Dread (wilderness)"],
    "u81": ["Terror of Demogorgon", "The Underdark", "Underdark Arena: Ring of Fire"],
    "mythdrannor": ["Ruins of Myth Drannor", "Magic of Myth Drannor"],
    "lamordia": ["Land of Lamordia", "Viktranium Experiment crafting"],
}
ENDGAME_ML = 29
# planner slot -> our worn-slot vocabulary
SLOT_FIX = {"Offhand": "Off Hand"}
ARMOR_ML_TYPE = {"Cloth": "cloth", "Light": "light", "Medium": "medium", "Heavy": "heavy"}


def affix_to_string(a):
    """Convert a planner affix {name,type,value} to an affix string our parser
    reads, or None to drop it (proc/base-bonus)."""
    name = (a.get("name") or "").strip()
    t = a.get("type")
    v = a.get("value")
    if t == "Bool" or v in (None, "", 1) and t == "Bool":
        return None
    if name.startswith("Enhancement Bonus"):
        return None  # base weapon/armor bonus — not a ranked stat (as in wiki batches)
    try:
        int(str(v))
    except (TypeError, ValueError):
        return None  # non-numeric magnitude -> drop (strict)
    # "Insightful Constitution +7" shape: leading bonus-type word, then stat, then value.
    if t and t not in ("Enhancement", None):
        return f"{t} {name} +{v}"
    return f"{name} +{v}"


def build_record(it):
    slot = SLOT_FIX.get(it.get("slot"), it.get("slot"))
    enh = []
    for a in it.get("affixes", []):
        s = affix_to_string(a)
        if s:
            enh.append(s)
    aug = []
    for c in it.get("crafting", []) or []:
        if c.endswith("Augment Slot"):
            enh.append(c)
            aug.append(c.replace(" Augment Slot", ""))
    rec = {
        "name": it["name"], "category": "item", "slot": slot,
        "enhancements": enh, "augment_slots": aug,
        "minimum_level": it.get("ml"),
        "wiki_url": "https://ddowiki.com" + (it.get("url") or ""),
        "_enriched": True, "_source": "gear-planner",
    }
    # weapon / rune-arm solver routing (mirrors the wiki batches)
    ptype = (it.get("type") or "")
    if slot == "Weapon":
        rec["category"] = "weapon"
    elif slot == "Runearm" or ptype == "Runearms":
        rec["category"] = "runearm"
        rec["slot"] = "Rune Arm"
    return rec


def main(expansion):
    quests = QUEST_MAP[expansion]
    data = json.load(open(SRC, encoding="utf-8"))
    # already enriched from wiki batches -> skip to avoid duplicate work
    already = set()
    cdir = os.path.join(ROOT, "data", "seed", "compendium")
    for f in os.listdir(cdir):
        if f.startswith("enriched_batch") and f.endswith(".json"):
            for it in json.load(open(os.path.join(cdir, f)))["items"]:
                already.add(it["name"])
    picked = []
    for it in data:
        if not (set(it.get("quests") or []) & set(quests)):
            continue
        if (it.get("ml") or 0) < ENDGAME_ML:
            continue
        if it["name"].startswith("Dinosaur Bone"):
            continue  # modeled via the Dino crafting pipeline
        if it["name"] in already:
            continue  # already sourced from the wiki
        rec = build_record(it)
        if any(not e.endswith("Augment Slot") for e in rec["enhancements"]):
            picked.append(rec)

    out = {
        "metadata": {
            "layer": "enriched", "batch": f"batch14_{expansion}_planner",
            "system": f"{expansion} named gear (gear-planner import, strict re-parse)",
            "source": "illusionistpm/ddo-gear-planner items.json (ddowiki-derived)",
            "harvested": "2026-07-26", "count": len(picked),
        },
        "items": picked,
    }
    outpath = os.path.join(cdir, f"enriched_batch14_{expansion}_planner.json")
    json.dump(out, open(outpath, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"wrote {len(picked)} {expansion} named items -> {os.path.relpath(outpath, ROOT)}")
    for r in picked:
        print(f"  {r['name']} [{r['slot']}]: {[e for e in r['enhancements'] if not e.endswith('Augment Slot')]}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "iod")
