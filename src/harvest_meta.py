"""#906 — overlay our own wiki-harvested item metadata on the vendored records.

Own item harvest (#911), Phase 1. For each gear-planner raw record the build
takes minimum level, slot, type and quests from `wiki_item_meta.json` — the
values the item's wiki page states, read by `src/wiki_item_meta.py` — instead of
gear-planner's. Affixes are untouched (Phase 2, #907).

Three rules:

  * A field the page does not state keeps gear-planner's value, counted as a
    fallback in the coverage stamp. Nothing is inferred to fill it.
  * A field `harvest_meta_rulings.json` rules for gear-planner keeps it.
  * `worn_slots` (#915) has no gear-planner counterpart: it is the pair of body
    slots a dual-slot item's tips state, and `planner_items` turns it into the
    record's `alt_slots`.
  * Every vendored record must be in the shard, or the build fails: a re-vendor
    that brings records the harvest never saw needs a re-harvest, not a silent
    fallback to upstream for everything new.
"""
from __future__ import annotations

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHARD_PATH = os.path.join(ROOT, "data", "seed", "compendium", "wiki_item_meta.json")
RULINGS_PATH = os.path.join(ROOT, "data", "seed", "compendium", "harvest_meta_rulings.json")
FIELDS = ("ml", "slot", "type", "quests", "worn_slots")


def load(path: str = SHARD_PATH) -> dict:
    with open(path, encoding="utf-8") as fh:
        shard = json.load(fh)
    if not shard.get("records"):
        raise SystemExit("wiki_item_meta.json carries no records — refusing to overlay nothing")
    return shard


def load_rulings(path: str = RULINGS_PATH) -> dict:
    with open(path, encoding="utf-8") as fh:
        return {(r["name"], r["field"]): r["ruling"] for r in json.load(fh)["rulings"]}


def apply(raw_items, shard: dict, rulings: dict | None = None):
    """Return `(records, stats)`: copies of `raw_items` with harvested metadata laid
    over them, and per-field counts. `stats["problems"]` non-empty means the shard
    no longer describes the vendored dump and nothing may ship."""
    rulings = rulings or {}
    recs = shard.get("records") or {}
    excluded = shard.get("excluded") or {}
    stats = {"records": 0, "problems": []}
    for f in FIELDS:
        stats[f] = {"wiki": 0, "changed": 0, "fallback": 0, "ruled_gp": 0}
    out, uncovered = [], []
    for it in raw_items:
        name = it.get("name")
        if name in excluded:
            out.append(it)
            continue
        h = recs.get(name)
        if h is None:
            uncovered.append(name)
            out.append(it)
            continue
        stats["records"] += 1
        fixed = dict(it)
        for f in FIELDS:
            if rulings.get((name, f)) == "gp":
                stats[f]["ruled_gp"] += 1
            elif f in h:
                stats[f]["wiki"] += 1
                if h[f] != it.get(f):
                    stats[f]["changed"] += 1
                fixed[f] = list(h[f]) if isinstance(h[f], list) else h[f]
            else:
                stats[f]["fallback"] += 1
        out.append(fixed)
    for n in uncovered[:10]:
        stats["problems"].append(f"{n!r} is vendored but the metadata harvest never saw it — re-harvest "
                                 "(scripts/browser/harvest_items.js) and regenerate wiki_item_meta.json")
    if len(uncovered) > 10:
        stats["problems"].append(f"... and {len(uncovered) - 10} more uncovered record(s)")
    stale = sorted(n for n in recs if n not in {it.get("name") for it in raw_items})
    for n in stale[:10]:
        stats["problems"].append(f"{n!r} is in wiki_item_meta.json but no longer vendored — regenerate the shard")
    return out, stats
