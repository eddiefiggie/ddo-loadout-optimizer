"""R4 band frontier — the ML 30-36 endgame work-list for the three target
content sets (U81, Isle of Dread, Myth Drannor).

The enumeration already exists: `data/seed/compendium/band_categories/` holds the
harvested membership of `Category:Minimum level 30..36 items` cross-referenced
with each item's `Update NN named items` and `... set items` categories
(harvested same-origin via the ddowiki MediaWiki API — server-side fetch is
blocked). This module intersects that band with the roster (for slot/armor type)
and the already-enriched corpus, and emits the attributed work-list.

Attribution (KTD3): the wiki's `Update NN named items` category is the expansion
tag. The three target sets map to their release updates:
  - Update 55 -> Isle of Dread   (Dinosaur Bone / "Dread Isle's Curse")
  - Update 69 -> Myth Drannor
  - Update 81 -> U81             (Demonweb / Abyss)
Band items outside these updates are other content, out of this batch's scope.

Terminal state (KTD6): each work-list item is `already_enriched` (present in a
prior `enriched_*.json` shard or the base seed) or `pending` (the delta U3 must
enrich or quarantine). Matching is exact against the item name, which is the wiki
page-title minus the `Item:` prefix on both sides.
"""
from __future__ import annotations

import glob
import json
import os

from src import compendium

HERE = os.path.dirname(os.path.abspath(__file__))
COMPENDIUM_DIR = os.path.join(HERE, "..", "data", "seed", "compendium")
ATTR_PATH = os.path.join(COMPENDIUM_DIR, "band_categories", "ml30_36_attribution.json")
WORKLIST_PATH = os.path.join(COMPENDIUM_DIR, "band_worklist.json")

# Update number -> target expansion slug. The hard membership gate is the ML band
# (an item is in the attribution only if it is ML 30-36); expansion narrows it to
# the three sets in scope.
TARGET_UPDATES = {55: "isle_of_dread", 69: "myth_drannor", 81: "u81"}


def load_attribution(path: str = ATTR_PATH) -> dict:
    """Return the harvested `{name: {ml, update, sets}}` band attribution map."""
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)["attr"]


BASELINE_PATH = os.path.join(COMPENDIUM_DIR, "band_categories", "solver_active_baseline.json")


def enriched_names(dirpath: str = COMPENDIUM_DIR) -> set:
    """Names already solver-active *before* this R4 batch (KTD6 `already_enriched`).

    Read from the committed baseline snapshot `solver_active_baseline.json` — the
    solver-active item names from the dataset built from every seed EXCEPT the R4
    shards. This is the stable, non-circular authority: it captures items produced
    by any pipeline (base seed, prior `enriched_*` shards, and host pipelines like
    Dino / Nearly Complete / Viktranium / seal whose blanks never land in
    `enriched_*.json`), yet excludes R4's own output so the delta stays fixed after
    R4 lands. Regenerate with `scripts/snapshot_baseline.py` after non-R4 content
    changes. See `enriched_names`'s callers in `build_worklist`.
    """
    with open(BASELINE_PATH, "r", encoding="utf-8") as fh:
        return set(json.load(fh)["names"])


def _roster_lookup(dirpath: str = COMPENDIUM_DIR) -> dict:
    """name -> {slot, armor_type?, weapon_type?} from the roster shards."""
    lut = {}
    for c in compendium.load_roster(dirpath):
        meta = {"slot": c.get("slot")}
        if c.get("armor_type"):
            meta["armor_type"] = c["armor_type"]
        if c.get("weapon_type"):
            meta["weapon_type"] = c["weapon_type"]
        for name in c.get("items", []):
            lut.setdefault(name, meta)
    return lut


def build_worklist(dirpath: str = COMPENDIUM_DIR):
    """Return (worklist, coverage).

    `worklist` is the list of band items in the three target sets, each attributed
    and marked terminal-or-pending. `coverage` is the per-(expansion, slot)
    baseline: band_total / already_enriched / pending.
    """
    attr = load_attribution(os.path.join(dirpath, "band_categories", "ml30_36_attribution.json"))
    enriched = enriched_names(dirpath)
    roster = _roster_lookup(dirpath)

    worklist = []
    coverage = {}
    for name, a in sorted(attr.items()):
        update = a.get("update")
        expansion = TARGET_UPDATES.get(update)
        if expansion is None:
            continue  # out of the three target sets
        r = roster.get(name, {})
        slot = r.get("slot") or "Unknown"
        status = "already_enriched" if name in enriched else "pending"
        entry = {
            "name": name,
            "slot": slot,
            "expansion": expansion,
            "update": update,
            "ml": a.get("ml"),
            "sets": a.get("sets", []),
            "wiki_url": compendium.wiki_url(name),
            "status": status,
        }
        if r.get("armor_type"):
            entry["armor_type"] = r["armor_type"]
        if r.get("weapon_type"):
            entry["weapon_type"] = r["weapon_type"]
        worklist.append(entry)

        key = f"{expansion}/{slot}"
        c = coverage.setdefault(key, {"band_total": 0, "already_enriched": 0, "pending": 0})
        c["band_total"] += 1
        c["already_enriched" if status == "already_enriched" else "pending"] += 1

    return worklist, coverage


def band_coverage(solver_active_names, dirpath: str = COMPENDIUM_DIR):
    """Live per-(expansion, slot) coverage of the ML30-36 band, for honest UI
    disclosure. `solver_active_names` is the set of names solver-active in the
    freshly-built dataset (source_item keys). Each band item is classified:
      - enriched:    solver-active in the dataset
      - quarantined: in `quarantined_r4.json` (reason recorded), not solver-active
      - pending:     neither (still missing) — should be 0 once the batch is done
    Returns {"by_slot": {"<expansion>/<slot>": {...}}, "totals": {...}}.
    """
    worklist, _ = build_worklist(dirpath)
    quar = set()
    qpath = os.path.join(dirpath, "quarantined_r4.json")
    if os.path.exists(qpath):
        for q in json.load(open(qpath, encoding="utf-8")).get("items", []):
            quar.add(q["name"])
    active = set(solver_active_names)

    by_slot = {}
    totals = {"band_total": 0, "enriched": 0, "quarantined": 0, "pending": 0}
    for w in worklist:
        if w["name"] in active:
            state = "enriched"
        elif w["name"] in quar:
            state = "quarantined"
        else:
            state = "pending"
        key = f"{w['expansion']}/{w['slot']}"
        c = by_slot.setdefault(key, {"band_total": 0, "enriched": 0, "quarantined": 0, "pending": 0})
        c["band_total"] += 1
        c[state] += 1
        totals["band_total"] += 1
        totals[state] += 1
    return {"by_slot": by_slot, "totals": totals}


def write_worklist(path: str = WORKLIST_PATH, dirpath: str = COMPENDIUM_DIR):
    worklist, coverage = build_worklist(dirpath)
    pending = sum(1 for w in worklist if w["status"] == "pending")
    out = {
        "metadata": {
            "layer": "band-frontier",
            "band": "ML 30-36",
            "target_updates": TARGET_UPDATES,
            "source": "data/seed/compendium/band_categories/ml30_36_attribution.json",
            "harvested": "2026-07-27",
            "total": len(worklist),
            "pending": pending,
        },
        "coverage": coverage,
        "worklist": worklist,
    }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1, ensure_ascii=False)
    return out


if __name__ == "__main__":
    out = write_worklist()
    m = out["metadata"]
    print(f"wrote {m['total']} band items ({m['pending']} pending) -> {os.path.relpath(WORKLIST_PATH, os.path.join(HERE, '..'))}")
    for key in sorted(out["coverage"]):
        c = out["coverage"][key]
        print(f"  {key:34} band={c['band_total']:3} enriched={c['already_enriched']:3} pending={c['pending']:3}")
