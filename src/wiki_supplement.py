"""#874 — an interim supplement of wiki-harvested items, in gear-planner's own shape.

gear-planner is this catalog's single source of truth for item affixes, and it
stopped updating on 2026-10-14 (its Data Auto Updater crashes on a placeholder
minimum level; illusionistpm/ddo-gear-planner#223). Items the wiki gained after
its last good snapshot cannot reach the catalog through it.

`data/seed/compendium/wiki_supplement_items.json` carries the stat-bearing ones.
Each record is BUILT, not parsed: it copies the raw record of its nearest
existing sibling (same weapon family, a tier upstream already parses), then sets
the name, level and wiki url from the item's own page and the affixes in the
sibling's vocabulary, with the magnitude upstream stores taken from the page's
rendered tooltip. So the record has exactly the shape and vocabulary every
downstream stage already handles, and no free text is re-parsed.

THE RETIREMENT GUARD IS THE POINT. The moment upstream carries a record of the
same name, `expand` fails the build: the supplement must be deleted, never left
to shadow or duplicate the real parse.
"""
from __future__ import annotations

import copy
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHARD_PATH = os.path.join(ROOT, "data", "seed", "compendium", "wiki_supplement_items.json")


def load(path: str = SHARD_PATH) -> dict:
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def expand(raw_items, shard: dict) -> dict:
    """Build the supplement's raw records. Returns `{"records", "problems", "coverage"}`;
    a non-empty `problems` means nothing here may ship."""
    items = (shard or {}).get("items") or {}
    by_name = {}
    for it in raw_items or []:
        by_name.setdefault(it.get("name"), it)
    problems, records = [], []
    for name, e in sorted(items.items()):
        if name in by_name:
            problems.append(f"{name!r}: upstream now carries this item — delete its supplement "
                            "entry; the real parse supersedes it")
            continue
        sib = by_name.get(e.get("sibling"))
        if sib is None:
            problems.append(f"{name!r}: its sibling {e.get('sibling')!r} is no longer upstream — "
                            "the shape it was built from moved")
            continue
        if not e.get("evidence") or not e.get("harvested"):
            problems.append(f"{name!r}: a supplement record needs its wiki evidence and harvest date")
            continue
        if not isinstance(e.get("ml"), int) or not str(e.get("url", "")).startswith("/page/Item:"):
            problems.append(f"{name!r}: needs an integer ml and an Item: url")
            continue
        rec = copy.deepcopy(sib)
        rec["name"] = name
        rec["ml"] = e["ml"]
        rec["url"] = e["url"]
        rec["affixes"] = [{"name": n, "type": t, "value": v} for n, t, v in e.get("affixes") or []]
        rec.pop("augmentUpgrades", None)
        records.append(rec)
    return {"records": records, "problems": problems,
            "coverage": {"entries": len(items), "records": len(records)}}
