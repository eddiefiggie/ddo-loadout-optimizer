#!/usr/bin/env python3
"""Regenerate the R4 ML30-36 band enrichment from the committed raw harvest.

R4 first batch: the ML 30-36 endgame delta across the three target sets (Isle of
Dread U55, Myth Drannor U69, U81) — the 41 band items not already enriched.

Reproducibility contract: reads only
  - data/seed/compendium/raw/batch_r4.json   (harvested {{Named item}} enhancements)
  - data/seed/compendium/band_worklist.json  (slot + expansion attribution, U1)
  - the strict src.enrich parser
— no hand-authored values. Each item reaches exactly one terminal state:
  * >=1 mapped affix        -> data/seed/compendium/enriched_r4_<expansion>.json
  * zero mapped affixes      -> data/seed/compendium/quarantined_r4.json (reason + wiki_url)
Augment-slot / set markers alone do not count as a mapped affix.
"""
import json
import os
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import enrich, compendium  # noqa: E402

COMP = os.path.join(ROOT, "data", "seed", "compendium")
RAW = os.path.join(COMP, "raw", "batch_r4.json")
WORKLIST = os.path.join(COMP, "band_worklist.json")
QUAR_OUT = os.path.join(COMP, "quarantined_r4.json")


def _is_solver_active(rec):
    """True if the record carries an explicit solver-active contribution: a base
    stat affix OR a named-set membership (the set-bonus machinery consumes the
    `(set)` marker). Augment slots alone are capacity, not value — an item whose
    only enhancements are augment slots (e.g. a pure Dino-crafting host with no
    base stats and no named set) is quarantined, since its value lives entirely
    in the Dino-crafting seed pipeline, out of this batch's scope."""
    for e in rec.get("enhancements", []):
        if e.endswith("Augment Slot"):
            continue  # capacity only
        return True  # a base stat affix or a "(set)" marker
    return False


def main():
    raw = json.load(open(RAW, encoding="utf-8"))["items"]
    worklist = {w["name"]: w for w in json.load(open(WORKLIST, encoding="utf-8"))["worklist"]}

    by_expansion = defaultdict(list)
    quarantined = []
    skipped_active = []
    for name, r in raw.items():
        w = worklist.get(name)
        if w is None:
            raise SystemExit(f"raw item not in band work-list (stray): {name!r}")
        if w.get("status") == "already_enriched":
            # Solver-active from another pipeline (e.g. a Dino host blank). Never
            # re-emit — a duplicate name double-lists in the dataset (KTD6).
            skipped_active.append(name)
            continue
        slot = w["slot"]
        expansion = w["expansion"]
        ml = int(r["ml"]) if r.get("ml") else w.get("ml")
        wiki_url = compendium.wiki_url(name)
        rec = enrich.build_item_record(name, slot, r["enh"], wiki_url,
                                       minimum_level=ml, armor_type=w.get("armor_type"))
        rec["expansion"] = expansion
        if _is_solver_active(rec):
            by_expansion[expansion].append(rec)
        else:
            quarantined.append({
                "name": name, "slot": slot, "expansion": expansion, "ml": ml,
                "wiki_url": wiki_url, "reason": "no_base_stat_or_set",
                "detail": "augment/crafting host only; base stats none, no named set — "
                          "solver value is Dino-crafting inserts (host registration deferred)",
                "unmapped": rec.get("_enrich_unmapped", []),
            })

    total_enriched = 0
    for expansion, items in sorted(by_expansion.items()):
        out = {
            "metadata": {
                "layer": "enriched", "batch": f"batch_r4_{expansion}",
                "system": f"R4 ML30-36 band — {expansion}",
                "harvested": "2026-07-27", "count": len(items),
            },
            "items": items,
        }
        path = os.path.join(COMP, f"enriched_r4_{expansion}.json")
        json.dump(out, open(path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        total_enriched += len(items)
        unmapped = sum(len(it.get("_enrich_unmapped", [])) for it in items)
        print(f"wrote {len(items):3} enriched {expansion:14} -> {os.path.relpath(path, ROOT)}  (unmapped effects: {unmapped})")

    json.dump({
        "metadata": {"layer": "quarantined", "batch": "batch_r4", "harvested": "2026-07-27",
                     "count": len(quarantined)},
        "items": quarantined,
    }, open(QUAR_OUT, "w", encoding="utf-8"), indent=1, ensure_ascii=False)

    print(f"\ntotal: {total_enriched} enriched, {len(quarantined)} quarantined, "
          f"{len(skipped_active)} already solver-active (skipped) — of {len(raw)} raw items")
    if quarantined:
        print("quarantined:", ", ".join(q["name"] for q in quarantined))
    if skipped_active:
        print("already-active (other pipeline):", ", ".join(skipped_active))


if __name__ == "__main__":
    main()
