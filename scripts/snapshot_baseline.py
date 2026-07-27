#!/usr/bin/env python3
"""Snapshot the pre-R4 solver-active item names for the band frontier (U1/KTD6).

`src.band_frontier` marks a band item `already_enriched` when it is already
solver-active from some *other* pipeline (base seed, prior enriched shards, or a
host pipeline like Dino / Nearly Complete / Viktranium / seal). The authority is
the built dataset MINUS the R4 shards — so this script builds that baseline and
writes the name set to `data/seed/compendium/band_categories/solver_active_baseline.json`.

Run after non-R4 content changes (new enriched batch, new host seed) so the
baseline stays current. It temporarily moves the R4 shards aside, builds, snapshots,
and restores them — leaving `web/data/items.json` rebuilt with the R4 shards in place.
"""
import glob
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

COMP = os.path.join(ROOT, "data", "seed", "compendium")
OUT = os.path.join(COMP, "band_categories", "solver_active_baseline.json")


def _r4_shards():
    return (glob.glob(os.path.join(COMP, "enriched_r4_*.json"))
            + glob.glob(os.path.join(COMP, "quarantined_r4.json")))


def main():
    held = []
    for p in _r4_shards():
        tmp = p + ".held"
        os.rename(p, tmp)
        held.append((p, tmp))
    try:
        import build_dataset as B
        ds = B.build(B.load_seed())
        names = sorted({(it.get("source_item") or it.get("variant_id") or it.get("name"))
                        for it in ds["items"]} - {None})
    finally:
        for p, tmp in held:
            os.rename(tmp, p)

    json.dump({
        "note": "solver-active item names built from all seeds EXCEPT the R4 batch — "
                "the stable baseline band_frontier uses to mark already_enriched (KTD6).",
        "harvested": "2026-07-27",
        "count": len(names),
        "names": names,
    }, open(OUT, "w", encoding="utf-8"), indent=0)
    print(f"wrote {len(names)} baseline solver-active names -> {os.path.relpath(OUT, ROOT)}")

    # rebuild the real dataset (with R4 shards restored) so web/data is current
    import build_dataset as B
    B.write(B.build(B.load_seed()))
    print("rebuilt web/data/items.json with R4 shards in place")


if __name__ == "__main__":
    main()
