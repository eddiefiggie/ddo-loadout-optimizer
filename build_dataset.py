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
from src import viktranium as vik_mod
from src import seal as seal_mod
from src import compendium as compendium_mod
from src import band_frontier as band_mod
from src import umbrella as umbrella_mod

import glob

HERE = os.path.dirname(os.path.abspath(__file__))
SEED_PATH = os.path.join(HERE, "data", "seed", "ddo_items.json")
DINO_SEED_PATH = os.path.join(HERE, "data", "seed", "dino_crafting.json")
NC_SEED_PATH = os.path.join(HERE, "data", "seed", "nearly_complete.json")
VIK_SEED_PATH = os.path.join(HERE, "data", "seed", "viktranium.json")
SEAL_SEED_PATH = os.path.join(HERE, "data", "seed", "seal.json")
AUG_SEED_PATH = os.path.join(HERE, "data", "seed", "augments.json")
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


def load_vik_seed(path: str = VIK_SEED_PATH) -> dict:
    """Load the U81 Viktranium ("Lamordia") seed (freshly sourced; separate from base)."""
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def load_augment_seed(path: str = AUG_SEED_PATH) -> dict:
    """Load the sourced legendary augment pool (gear-planner import; separate from base)."""
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def load_seal_seed(path: str = SEAL_SEED_PATH) -> dict:
    """Load the seal-slot ("Sealed in X") pool seed (wiki-sourced; separate from base)."""
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
    base_by_name = {it.get("name"): it for it in seed["items"]}
    seen_names = set(base_by_name)
    deduped = []
    for it in enriched_items:
        name = it.get("name")
        if name in seen_names:
            # Base seed wins, but carry over a seal slot the base record lacks: the
            # gear-planner marks "Sealed in X" enchantments the hand-verified base
            # seed predates, so a base-seed sealed item would otherwise be stranded.
            base_it = base_by_name.get(name)
            if base_it is not None and it.get("seal_slots") and not base_it.get("seal_slots"):
                base_it["seal_slots"] = [dict(s) for s in it["seal_slots"]]  # copy: no shared ref across base + tier variants
            continue
        seen_names.add(name)
        deduped.append(it)
    enriched_items = deduped
    # Legendary augment pool (gear-planner import). Sourced augments SUPERSEDE a
    # same-name base-seed augment (richer source wins — opposite of the base-wins
    # rule for enriched gear), so the incidental base augments don't double-list.
    aug_pool = (load_augment_seed() or {}).get("items", [])
    aug_names = {a.get("name") for a in aug_pool}
    base_items = [it for it in seed["items"]
                  if not (it.get("category") == "augment" and it.get("name") in aug_names)]
    variants = expand_dataset(base_items + enriched_items + aug_pool)  # parse enhancements + expand tiers
    for v in variants:                                  # U2 augment-color normalization
        colors_mod.annotate_variant(v)
        set_mod.annotate_variant(v)                     # U4 set-bonus threshold parsing
        # Bake each augment's compatible slot colors (the wiki matrix, applied once
        # here) so the JS solver does plain set-membership per slot — the matrix
        # never crosses into JS (U3). Colored augments fit multiple slot colors;
        # Colorless fits every colored slot; Moon/Sun fit only their own.
        if v.get("category") == "augment":
            ac = (v.get("aug_color") or {}).get("color")
            v["fits_slots"] = sorted(colors_mod.fits_slots(ac)) if ac else []
    # Expand umbrella ability affixes ("All Ability Scores +15", "Well Rounded")
    # into the six concrete abilities so single-ability targets get credited.
    umbrella_mod.expand_variants(variants)
    variants, cov = verify_mod.apply(variants)          # per-affix verification gate

    # U3 — Isle of Dread Dino crafting: append pre-verified blank host variants
    # (they carry typed Dino slots, no base affixes) and expose the insert pool
    # the solver places into those slots. Blanks are added AFTER verify so their
    # empty affix list does not quarantine them.
    dino_seed = load_dino_seed()
    dino_blanks, dino_inserts, dino_sets, dino_cov = dino_mod.build_dino(dino_seed)
    variants = variants + dino_blanks

    # U81 Nearly Complete: expose the parametric choice-slot effect pool. Items
    # carrying a `nearly_complete: <category>` field draw one option from it (host
    # items pending wiki; the pool + machinery ship now).
    nc = nc_mod.parse_nearly_complete(load_nc_seed())

    # U81 Viktranium ("Lamordia") crafting: expose the typed choice-slot pool
    # keyed by (slot_type, item-category). Items carrying `lamordia_slots` draw
    # one option per slot from the matching pool (tier from host ML at solve time).
    vik = vik_mod.parse_viktranium(load_vik_seed())

    # Seal-slot crafting ("Sealed in X"): expose the single-pick choice-slot pool
    # keyed by seal_type. Items carrying `seal_slots` unseal one option from the
    # matching pool. Undeath sourced (Ritual Table); Fire/Gloom/Mist pending.
    sl = seal_mod.parse_seal(load_seal_seed())

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
    # R4 ML30-36 endgame-band coverage (U4): per (expansion, slot) enriched /
    # quarantined / pending across U81, Isle of Dread, Myth Drannor — honest
    # disclosure driven by the solver-active names in this very build.
    band_active = {(v.get("source_item") or v.get("variant_id") or v.get("name")) for v in variants}
    band_active.discard(None)
    band_cov = band_mod.band_coverage(band_active)
    # U81 Nearly-Complete hosts activated via enrichment (items carrying an open
    # NC 4th-affix slot the solver crafts into).
    nc["coverage"]["hosts_activated"] = sum(
        1 for it in enriched_items if it.get("nearly_complete"))
    # U81 Viktranium hosts activated across the whole item pipeline — enriched
    # items (via the {{Lamordia Slot}} template) AND base-seed items (via their
    # human-readable Lamordia strings). Counted from the final variants, deduped
    # by source item so tier variants of one host count once. Honest disclosure.
    vik_host_slots = {}
    for v in variants:
        if v.get("lamordia_slots"):
            vik_host_slots[v["source_item"]] = len(v["lamordia_slots"])
    vik["coverage"]["hosts_active"] = len(vik_host_slots)
    vik["coverage"]["slots_active"] = sum(vik_host_slots.values())

    # Seal-slot hosts, deduped by source item so tier variants count once. Honest
    # disclosure: a host is solver-ACTIVE only when it survives the verification
    # gate (a seal-only host with no base affixes is quarantined by the solver's
    # eligible() before the seal MILP runs) AND its seal_type has a sourced
    # (non-empty) pool. Everything else — an unsourced pool (Fire/Gloom/Mist
    # pending) or a quarantined seal-only host — is disclosed as PENDING, not
    # counted active, so the coverage note never overstates what the solver can craft.
    sourced_seals = set(sl["coverage"]["seal_types_sourced"])
    seal_active, seal_pending = {}, {}
    for v in variants:
        slots = v.get("seal_slots")
        if not slots:
            continue
        active_slots = [s for s in slots if s.get("seal_type") in sourced_seals]
        if active_slots and v.get("verification") == "verified":
            seal_active[v["source_item"]] = len(active_slots)
        else:
            seal_pending[v["source_item"]] = len(slots)
    sl["coverage"]["hosts_active"] = len(seal_active)
    sl["coverage"]["slots_active"] = sum(seal_active.values())
    sl["coverage"]["hosts_pending"] = len(seal_pending)

    # Augment pool coverage: legendary augments by intrinsic color (incl. Lunar/Solar).
    # The R5 wiki cross-check (augments the wiki has that the gear-planner lacks) is a
    # deferred harvest; disclosed as an empty delta with a note until it runs.
    aug_by_color = {}
    for a in aug_pool:
        c = colors_mod.normalize_color(a.get("slot")).get("color")
        if c:
            aug_by_color[c] = aug_by_color.get(c, 0) + 1
    augment_coverage = {
        "legendary_sourced": len(aug_pool),
        "by_color": dict(sorted(aug_by_color.items())),
        "source": "gear-planner crafting.json (intrinsic color); compatibility baked per-augment via the wiki matrix",
        "wiki_crosscheck_delta": [],
        "wiki_crosscheck_note": "wiki completeness cross-check (R5) is a deferred harvest",
    }

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
            "viktranium_coverage": vik["coverage"],
            "seal_coverage": sl["coverage"],
            "augment_coverage": augment_coverage,
            "compendium_coverage": comp_cov,
            "band_coverage": band_cov,
            "pipeline_stage": "M4-compendium-roster",
        },
        "items": variants,
        "dino_inserts": dino_inserts,
        "dino_sets": dino_sets,
        "nearly_complete": nc["records"],
        "viktranium": vik["records"],
        "seal": sl["records"],
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
