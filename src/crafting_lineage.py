"""#285 — acquisition for items the wiki records as CRAFTED, not dropped.

WHY

#262's triage of the 199 empty-`location_quest` items found that most are not
unobtainable at all: they are the Epic or Legendary crafted version of a predecessor,
and the wiki records which one in the `{{Named item}}` template's `epic` / `legendary`
parameters. gear-planner carries neither, so they reached the player as "Source
unknown" — the least useful thing a farming list can say about an item that has a
perfectly well-documented way to get it.

WHAT IT STAMPS

`location_lineage = {kind, from}` and, where the record had no source at all,
`location_kind = "crafting"`. It never writes `location_quest`: the predecessor is an
ITEM, not a quest, and putting an item name in a quest field would make every surface
that groups by source render a lie.

ONE STEP, NEVER A CHAIN

Each entry records one step, verbatim. `Legendary X` points at `Epic X`, which has its
own entry pointing at `X`, which carries a real `location_quest`. A reader follows the
chain by composing entries. Resolving it here — writing `X`'s quest onto `Legendary X`
— would publish a claim no single wiki page makes, and would be wrong the moment one
link in the chain changes.
"""
import json
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHARD = os.path.join(HERE, "data", "seed", "compendium", "crafting_lineage.json")

KINDS = ("epic-crafted", "legendary-crafted")


def load(path: str = SHARD) -> dict:
    """`{item_name: {kind, from}}`. Missing file -> {} (the stage is additive)."""
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        return json.load(fh).get("entries") or {}


def apply_to(records: list, lineage: dict) -> dict:
    """Stamp `location_lineage` in place; return coverage.

    `location_kind` is set to `crafting` ONLY where the record has no source of its
    own. An item that already records a quest keeps that kind — the lineage is extra
    information about it, not a replacement for what it already told the player.
    """
    by_name = {}
    for r in records:
        by_name.setdefault(r.get("variant_id") or r.get("name"), r)
    stamped = kind_set = 0
    unmatched = []
    for name in sorted(lineage):
        rec = by_name.get(name)
        if rec is None:
            unmatched.append(name)
            continue
        e = lineage[name]
        rec["location_lineage"] = {"kind": e["kind"], "from": e["from"]}
        stamped += 1
        if not rec.get("location_quest"):
            rec["location_kind"] = "crafting"
            kind_set += 1
    return {"entries": len(lineage), "stamped": stamped,
            "kind_set_to_crafting": kind_set,
            "unmatched_entries": unmatched}


def check(records: list, lineage: dict) -> dict:
    """Fail the build when the shard has fallen behind the roster.

    Refuses zero records, and refuses an entry naming an item the roster lacks — a
    stale entry reads as coverage while stamping nothing.
    """
    if not records:
        raise AssertionError("crafting lineage: refusing to inspect zero records")
    if not lineage:
        raise AssertionError("crafting lineage: the shard is empty")
    cov = apply_to(records, lineage)
    if cov["unmatched_entries"]:
        raise AssertionError(
            "crafting lineage names items the roster lacks: "
            + ", ".join(cov["unmatched_entries"][:5]))
    # The predecessor must be real gear, or the disclosure sends the player nowhere.
    names = {r.get("variant_id") for r in records}
    dangling = sorted(e["from"] for e in lineage.values() if e["from"] not in names)
    cov["dangling_predecessors"] = dangling
    return cov
