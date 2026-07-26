#!/usr/bin/env python3
"""Import the legendary augment pool from the gear-planner crafting data (U1).

Source: illusionistpm/ddo-gear-planner `site/src/assets/crafting.json` (ddowiki-
derived), committed at data/seed/compendium/raw/gearplanner_crafting.json. It keys
augments by their INTRINSIC color slot ("Red Augment Slot", "Moon Augment Slot",
...); the wiki compatibility matrix (src/colors.py) is layered on later at build
time, not here. Each augment carries parsed affixes {name, type, value}; we
convert those to affix STRINGS carrying their bonus TYPE and run them through THIS
repo's strict affix_parser (via the normal variant pipeline), so provenance and
eligibility are decided by our own parser. Bool procs and base enhancement bonuses
are dropped (non-ranked). Filtered to legendary ML.

Usage: python3 scripts/import_augments.py
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

SRC = os.path.join(ROOT, "data", "seed", "compendium", "raw", "gearplanner_crafting.json")
OUT = os.path.join(ROOT, "data", "seed", "augments.json")
ENDGAME_ML = 29

# "<Color> Augment Slot" key -> the intrinsic augment color (annotate_variant reads
# the record's `slot` to set aug_color). Moon/Sun map to the Lunar/Solar colors.
SLOT_KEY_COLOR = {
    "Red Augment Slot": "Red", "Blue Augment Slot": "Blue", "Yellow Augment Slot": "Yellow",
    "Orange Augment Slot": "Orange", "Green Augment Slot": "Green", "Purple Augment Slot": "Purple",
    "Colorless Augment Slot": "Colorless", "Moon Augment Slot": "Moon", "Sun Augment Slot": "Sun",
}


def affix_to_string(a):
    """Planner affix {name,type,value} -> an affix string our parser reads, or None
    to drop it (proc/base-bonus/non-numeric). Mirrors scripts/enrich_from_planner.py."""
    name = (a.get("name") or "").strip()
    t = a.get("type")
    v = a.get("value")
    if t == "Bool":
        return None  # a proc/flag, not a magnitude
    if name.startswith("Enhancement Bonus"):
        return None  # base weapon/armor bonus, not a ranked stat
    try:
        int(str(v))
    except (TypeError, ValueError):
        return None  # non-numeric magnitude -> drop (strict)
    if t and t not in ("Enhancement", None):
        return f"{t} {name} +{v}"  # typed: "Insightful Constitution +7"
    return f"{name} +{v}"


def main():
    raw = json.load(open(SRC, encoding="utf-8"))
    records, dropped = [], 0
    by_color = {}
    for key, color in SLOT_KEY_COLOR.items():
        for a in (raw.get(key, {}) or {}).get("*", []) or []:
            if (a.get("ml") or 0) < ENDGAME_ML:
                continue
            enh = [s for s in (affix_to_string(x) for x in a.get("affixes", [])) if s]
            if not enh:
                dropped += 1  # no parseable typed affix (proc/clicky/dice)
                continue
            rec = {
                "name": a["name"], "category": "augment", "slot": color,
                "enhancements": enh, "minimum_level": a.get("ml"),
                "wiki_url": "https://ddowiki.com/page/Augment_Slot",
                "_source": "gear-planner-crafting",
            }
            if a.get("unique_equipped") or a.get("unique"):
                rec["unique_equipped"] = True
            records.append(rec)
            by_color[color] = by_color.get(color, 0) + 1

    out = {
        "metadata": {
            "layer": "augment-pool", "system": "legendary augment pool (gear-planner crafting import)",
            "source": "illusionistpm/ddo-gear-planner crafting.json (ddowiki-derived)",
            "harvested": "2026-07-26", "count": len(records),
            "note": "augments keyed by intrinsic color; the wiki compatibility matrix "
                    "(src/colors.py) is baked onto each record at build time (U5).",
        },
        "items": records,
    }
    json.dump(out, open(OUT, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"wrote {len(records)} legendary augments -> {os.path.relpath(OUT, ROOT)} "
          f"({dropped} dropped: no parseable typed affix)")
    print("  by color:", dict(sorted(by_color.items())))


if __name__ == "__main__":
    main()
