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

HERE = os.path.dirname(os.path.abspath(__file__))
SEED_PATH = os.path.join(HERE, "data", "seed", "ddo_items.json")
OUT_PATH = os.path.join(HERE, "data", "items.json")


def load_seed(path: str = SEED_PATH) -> dict:
    """Load the immutable seed dataset."""
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def build(seed: dict) -> dict:
    """Transform the seed into the optimizer dataset.

    U1 is a passthrough: every seed item is carried through unchanged so the
    round-trip count is preserved. Later units insert parse/expand/verify
    stages here.
    """
    items = list(seed["items"])
    out = {
        "metadata": {
            "title": "DDO Loadout Optimizer — dataset",
            "source": seed["metadata"].get("source", ""),
            "seed_generated": seed["metadata"].get("generated", ""),
            "seed_count": len(seed["items"]),
            "item_count": len(items),
            "pipeline_stage": "U1-passthrough",
        },
        "items": items,
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
