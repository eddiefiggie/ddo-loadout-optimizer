"""DDO named-item compendium — roster layer.

Loads the harvested roster (name + slot + wiki link for every named item on the
DDO wiki, enumerated by category) and exposes it as the complete item INDEX.

Two layers, disclosed honestly:
  - **indexed** — the roster knows the item exists (name, slot, wiki link) but its
    stats are not yet parsed. Browse-only; NOT fed to the solver.
  - **enriched** — the item has parsed affixes and is solver-active (it entered
    through the base-item pipeline). Cross-referenced here so the two layers do
    not double-count.

Harvested via the DDO wiki MediaWiki API (list=categorymembers), same-origin from
ddowiki.com — the only working access path (server-side fetch/curl are blocked).
Roster shards live in data/seed/compendium/roster_*.json.
"""
from __future__ import annotations

import glob
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
COMPENDIUM_DIR = os.path.join(HERE, "..", "data", "seed", "compendium")


def wiki_url(name: str) -> str:
    """Derive an item's wiki page URL from its name (spaces -> underscores)."""
    return "https://ddowiki.com/page/Item:" + name.replace(" ", "_")


def load_roster(dirpath: str = COMPENDIUM_DIR) -> list:
    """Load every roster_*.json shard and return the flat list of category blocks."""
    cats = []
    if not os.path.isdir(dirpath):
        return cats
    for path in sorted(glob.glob(os.path.join(dirpath, "roster_*.json"))):
        with open(path, "r", encoding="utf-8") as fh:
            d = json.load(fh)
        cats.extend(d.get("categories", []))
    return cats


def build_compendium(enriched_names=None, dirpath: str = COMPENDIUM_DIR):
    """Build the compendium index records + coverage from the roster shards.

    `enriched_names` is the set of item names already solver-active (their stats
    are parsed). Matching roster entries are marked `enriched`; the rest `indexed`.
    Names are de-duplicated across categories (armor-type cross-listings recur).
    Returns (records, coverage).
    """
    enriched = set(enriched_names or [])
    cats = load_roster(dirpath)
    records = []
    by_slot = {}
    seen = set()
    enriched_matched = 0
    indexed_only = 0
    for c in cats:
        slot = c.get("slot", "")
        for name in c.get("items", []):
            key = (name, slot)
            if key in seen:
                continue
            seen.add(key)
            is_enriched = name in enriched
            rec = {
                "name": name,
                "slot": slot,
                "wiki_url": wiki_url(name),
                "status": "enriched" if is_enriched else "indexed",
            }
            if c.get("armor_type"):
                rec["armor_type"] = c["armor_type"]
            if c.get("weapon_type"):
                rec["weapon_type"] = c["weapon_type"]
            if c.get("offhand_type"):
                rec["offhand_type"] = c["offhand_type"]
            records.append(rec)
            by_slot[slot] = by_slot.get(slot, 0) + 1
            if is_enriched:
                enriched_matched += 1
            else:
                indexed_only += 1
    coverage = {
        "total_indexed": len(records),
        "enriched_matched": enriched_matched,
        "indexed_only": indexed_only,
        "by_slot": by_slot,
        "source_categories": len(cats),
    }
    return records, coverage
