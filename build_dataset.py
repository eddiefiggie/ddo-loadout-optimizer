#!/usr/bin/env python3
"""Dataset build pipeline for ddo-loadout-optimizer.

Reads the immutable seed (imported from ddo-item-puller) and produces
`data/items.json`, the static dataset the web app fetches.

Pipeline stages (filled in across implementation units):
  U1  load seed + write passthrough dataset      (this unit)
  U2  parse enhancements[] -> parsed_affixes[]    (src.affix_parser)
  U3  expand tier variants + normalize vocab      (src.variants, src.vocab)
  U4  per-affix verification gate + coverage       (src.verify)

Run:  python3 build_dataset.py
Output path is __file__-relative, so it works from any directory.
"""
from __future__ import annotations

import json
import os

from src.variants import expand_dataset
from src import verify as verify_mod
from src import colors as colors_mod

HERE = os.path.dirname(os.path.abspath(__file__))
SEED_PATH = os.path.join(HERE, "data", "seed", "ddo_items.json")
# Output lands inside web/ so that directory is a self-contained, deployable
# site root (GitHub Pages serves web/ as the root; the app fetches data/ relatively).
OUT_PATH = os.path.join(HERE, "web", "data", "items.json")


def load_seed(path: str = SEED_PATH) -> dict:
    """Load the immutable seed dataset."""
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def build(seed: dict) -> dict:
    """Transform the seed into the optimizer dataset.

    Pipeline: parse enhancements[] (U2) -> expand tier variants + normalize
    vocab (U3) -> per-affix verification gate + coverage (U4). The output
    `items` are variant records; each carries `affixes`, `verification`, and
    flags. `metadata.coverage` records per-slot verified/quarantined counts.
    """
    variants = expand_dataset(seed["items"])            # parse enhancements + expand tiers
    for v in variants:                                  # U2 augment-color normalization
        colors_mod.annotate_variant(v)
    variants, cov = verify_mod.apply(variants)          # per-affix verification gate
    out = {
        "metadata": {
            "title": "DDO Loadout Optimizer — dataset",
            "source": seed["metadata"].get("source", ""),
            "seed_generated": seed["metadata"].get("generated", ""),
            "seed_count": len(seed["items"]),
            "variant_count": len(variants),
            "item_count": len(variants),
            "coverage": cov,
            "color_coverage": colors_mod.color_coverage(variants),
            "pipeline_stage": "M3-sources",
        },
        "items": variants,
    }
    return out


def write(dataset: dict, path: str = OUT_PATH) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(dataset, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def main() -> None:
    seed = load_seed()
    dataset = build(seed)
    write(dataset)
    print(
        f"Wrote {OUT_PATH}: {dataset['metadata']['item_count']} items "
        f"(seed {dataset['metadata']['seed_count']})."
    )


if __name__ == "__main__":
    main()
