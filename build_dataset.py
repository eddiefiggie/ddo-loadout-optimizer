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
from src import set_parser as set_mod
from src import dino as dino_mod
from src import nearly_complete as nc_mod
from src import compendium as compendium_mod
from src import umbrella as umbrella_mod

import glob

HERE = os.path.dirname(os.path.abspath(__file__))
SEED_PATH = os.path.join(HERE, "data", "seed", "ddo_items.json")
DINO_SEED_PATH = os.path.join(HERE, "data", "seed", "dino_crafting.json")
NC_SEED_PATH = os.path.join(HERE, "data", "seed", "nearly_complete.json")
COMPENDIUM_DIR = os.path.join(HERE, "data", "seed", "compendium")
# Output lands inside web/ so that directory is a self-contained, deployable
# site root (GitHub Pages serves web/ as the root; the app fetches data/ relatively).
OUT_PATH = os.path.join(HERE, "web", "data", "items.json")


def load_seed(path: str = SEED_PATH) -> dict:
    """Load the immutable seed dataset."""
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def load_dino_seed(path: str = DINO_SEED_PATH) -> dict:
    """Load the Dino-crafting seed (freshly sourced; separate from the base seed)."""
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def load_nc_seed(path: str = NC_SEED_PATH) -> dict:
    """Load the U81 Nearly-Complete seed (freshly sourced; separate from the base seed)."""
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def load_enriched_items(dirpath: str = COMPENDIUM_DIR) -> list:
    """Load stat-enriched compendium items (data/seed/compendium/enriched_*.json).

    These are base-seed-shape records produced by src.enrich from item wikitext;
    they merge into the item pipeline so their parsed affixes become solver-active.
    """
    items = []
    for path in sorted(glob.glob(os.path.join(dirpath, "enriched_*.json"))):
        with open(path, "r", encoding="utf-8") as fh:
            items.extend(json.load(fh).get("items", []))
    return items


def build(seed: dict) -> dict:
    """Transform the seed into the optimizer dataset.

    Pipeline: parse enhancements[] (U2) -> expand tier variants + normalize
    vocab (U3) -> per-affix verification gate + coverage (U4). The output
    `items` are variant records; each carries `affixes`, `verification`, and
    flags. `metadata.coverage` records per-slot verified/quarantined counts.
    """
    # Merge stat-enriched compendium items into the base seed before expansion so
    # they flow through the identical parse (affix_parser) + verify pipeline and
    # become solver-active. Enriched records are strict (src.enrich); unmapped
    # effects are recorded, never fabricated.
    # Dedupe: skip enriched records whose name already exists (base seed wins — it
    # is the hand-verified source; a same-name enriched copy would double-list in
    # browse and put two identities of one item into the solver). Also drops any
    # cross-batch name collision.
    enriched_items = load_enriched_items()
    seen_names = {it.get("name") for it in seed["items"]}
    deduped = []
    for it in enriched_items:
        name = it.get("name")
        if name in seen_names:
            continue
        seen_names.add(name)
        deduped.append(it)
    enriched_items = deduped
    variants = expand_dataset(seed["items"] + enriched_items)  # parse enhancements + expand tiers
    for v in variants:                                  # U2 augment-color normalization
        colors_mod.annotate_variant(v)
        set_mod.annotate_variant(v)                     # U4 set-bonus threshold parsing
    # Expand umbrella ability affixes ("All Ability Scores +15", "Well Rounded")
    # into the six concrete abilities so single-ability targets get credited.
    umbrella_mod.expand_variants(variants)
    variants, cov = verify_mod.apply(variants)          # per-affix verification gate

    # U3 — Isle of Dread Dino crafting: append pre-verified blank host variants
    # (they carry typed Dino slots, no base affixes) and expose the insert pool
    # the solver places into those slots. Blanks are added AFTER verify so their
    # empty affix list does not quarantine them.
    dino_seed = load_dino_seed()
    dino_blanks, dino_inserts, dino_cov = dino_mod.build_dino(dino_seed)
    variants = variants + dino_blanks

    # U81 Nearly Complete: expose the parametric choice-slot effect pool. Items
    # carrying a `nearly_complete: <category>` field draw one option from it (host
    # items pending wiki; the pool + machinery ship now).
    nc = nc_mod.parse_nearly_complete(load_nc_seed())

    # Compendium roster: the complete named-item INDEX (name + slot + wiki link
    # for every named item on the wiki, harvested by category). Roster entries
    # are browse-only ("indexed") until their stats are enriched into real item
    # records; those already solver-active are cross-referenced as "enriched" so
    # the two layers do not double-count. Does not feed the solver.
    enriched_names = {v.get("source_item") for v in variants if v.get("source_item")}
    comp_records, comp_cov = compendium_mod.build_compendium(enriched_names)
    comp_cov["enriched_items"] = len(enriched_items)
    # Surface the strict-provenance disclosure: how many wiki effects were recorded
    # as unmapped (never guessed) across the enriched batches.
    comp_cov["enriched_unmapped_effects"] = sum(
        len(it.get("_enrich_unmapped", [])) for it in enriched_items)
    # U81 Nearly-Complete hosts activated via enrichment (items carrying an open
    # NC 4th-affix slot the solver crafts into).
    nc["coverage"]["hosts_activated"] = sum(
        1 for it in enriched_items if it.get("nearly_complete"))

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
            "set_coverage": set_mod.set_coverage(variants),
            "dino_coverage": dino_cov,
            "nc_coverage": nc["coverage"],
            "compendium_coverage": comp_cov,
            "pipeline_stage": "M4-compendium-roster",
        },
        "items": variants,
        "dino_inserts": dino_inserts,
        "nearly_complete": nc["records"],
        "compendium": comp_records,
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
