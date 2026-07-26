#!/usr/bin/env python3
"""Regenerate a legacy list-shaped enriched batch from its committed raw.

Batches 1-10 predate the per-expansion enrich scripts but their raw files carry
the exact fields `src.enrich.build_item_record` consumes (name, slot, field,
wiki_url, minimum_level). This is the generic regenerator the raw metadata
promises ("enriched_*.json is regenerable from these via build_item_record"):
it rebuilds `data/seed/compendium/enriched_<batch>.json` from
`data/seed/compendium/raw/<batch>.json`, deriving `category` from `slot` so
weapons/rune arms route to their solver slots instead of stranding browse-only.

Usage:  python3 scripts/enrich_legacy_batch.py batch4_weapons batch7 batch8
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src import enrich  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMP = os.path.join(ROOT, "data", "seed", "compendium")


def regenerate(batch: str) -> None:
    raw_path = os.path.join(COMP, "raw", f"{batch}.json")
    out_path = os.path.join(COMP, f"enriched_{batch}.json")
    raw = json.load(open(raw_path, encoding="utf-8"))
    prev = json.load(open(out_path, encoding="utf-8")) if os.path.exists(out_path) else {}

    items = []
    for r in raw["items"]:
        rec = enrich.build_item_record(
            r["name"], r["slot"], r["field"], r["wiki_url"],
            minimum_level=r.get("minimum_level"),
            armor_type=r.get("armor_type"),
        )
        items.append(rec)

    meta = dict(prev.get("metadata", {}))
    meta["count"] = len(items)
    doc = {"metadata": meta, "items": items}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write("\n")

    cats = {}
    for it in items:
        cats[it["category"]] = cats.get(it["category"], 0) + 1
    print(f"  {batch}: {len(items)} items regenerated -> categories {cats}")


def main() -> None:
    batches = sys.argv[1:]
    if not batches:
        print(__doc__)
        sys.exit(2)
    for b in batches:
        regenerate(b)


if __name__ == "__main__":
    main()
