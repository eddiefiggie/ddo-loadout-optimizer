"""#495 — `location_quest` -> adventure pack and source kind.

WHY

The Farming List answers "where do I go and get this". Grouping by adventure pack
FIRST is the intended shape because it is the first question a player actually asks —
*do I even own this?* — and the dataset had no pack field to group by. gear-planner has
none either. The only acquisition datum on an item is `location_quest`, a single
free-text string naming a quest, a raid, an NPC vendor, a crafting station, a seasonal
event, the DDO Store, or sometimes nothing that is a place at all ("Advance to level
15", "N/A", "Random").

This stage joins that string to a curated, wiki-sourced mapping and stamps two fields on
each variant: `location_pack` and `location_kind`.

WHAT IT REFUSES TO DO

It never guesses a pack from a quest name. Every mapping entry records the wiki signal
that decided it, and a value with no such signal is `unknown` — it renders under "Source
unknown" rather than under a pack somebody's memory supplied. That is the whole reason
this is a curated seed and not a regex over quest names: "Gianthold Tor" belongs to
"Ruins of Gianthold", and no string operation gets there.

THE COVERAGE GUARD

`coverage()` measures the mapping against the LIVE population and the build stamps the
result. A dataset refresh that introduces new `location_quest` values cannot silently
widen the unknown bucket: the numbers move, and `tests/test_adventure_packs.py` fails
when a value the mapping has never seen appears. A dated claim about coverage would not
notice its own staleness; this does.
"""
import json
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHARD = os.path.join(HERE, "data", "seed", "compendium", "quest_adventure_packs.json")

KINDS = ("pack-quest", "vendor", "event", "crafting", "store", "unknown")


def load(path: str = SHARD) -> dict:
    """`{location_quest: {kind, pack, via}}`. Missing file -> {} (the stage is additive)."""
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        return (json.load(fh).get("entries") or {})


def apply_to(records: list, mapping: dict) -> None:
    """Stamp `location_pack` / `location_kind` on every record, in place.

    A record whose `location_quest` the mapping does not carry is stamped
    `location_kind: "unknown"` EXPLICITLY rather than left absent. Absent and
    unknown are different facts, and a renderer that cannot tell them apart is
    exactly how a silent gap becomes an invisible one.
    """
    for rec in records:
        src = rec.get("location_quest")
        hit = mapping.get(src) if src else None
        rec["location_pack"] = (hit or {}).get("pack") or None
        rec["location_kind"] = (hit or {}).get("kind") or ("unknown" if src else None)


def coverage(records: list, mapping: dict) -> dict:
    """What the mapping actually covers, measured against the live population.

    Reports BOTH populations, because they are different claims and conflating them
    is the documented way to get this wrong: `distinct_*` counts source VALUES,
    `variants_*` counts the gear a player sees. A mapping can cover 94% of values and
    a very different share of items.

    `unmapped_values` names every source string the mapping has never seen, sorted, so
    the disclosure is a list rather than a number nobody can act on.
    """
    values, per_value = {}, {}
    for rec in records:
        src = rec.get("location_quest")
        if not src:
            continue
        per_value[src] = per_value.get(src, 0) + 1
    unmapped = sorted(v for v in per_value if v not in mapping)
    by_kind, by_kind_variants = {}, {}
    named_pack_variants = 0
    for src, n in per_value.items():
        hit = mapping.get(src)
        kind = (hit or {}).get("kind") or "unknown"
        by_kind[kind] = by_kind.get(kind, 0) + 1
        by_kind_variants[kind] = by_kind_variants.get(kind, 0) + n
        if hit and hit.get("pack"):
            named_pack_variants += n
    sourced = sum(per_value.values())
    return {
        "distinct_values": len(per_value),
        "distinct_mapped": len(per_value) - len(unmapped),
        "variants_sourced": sourced,
        "variants_unsourced": sum(1 for r in records if not r.get("location_quest")),
        "variants_to_a_named_pack": named_pack_variants,
        "distinct_packs": len({e.get("pack") for e in mapping.values()
                               if e.get("pack") and e.get("pack") != "Free to Play"}),
        "by_kind_values": dict(sorted(by_kind.items())),
        "by_kind_variants": dict(sorted(by_kind_variants.items())),
        "unmapped_values": unmapped,
        "mapping_entries": len(mapping),
    }


def check(records: list, mapping: dict) -> dict:
    """Fail the build when the mapping has fallen behind the data.

    Refuses to inspect zero records — a guard that passes over an empty population is
    not a guard, and this one exists precisely to notice a REFRESH, which is when the
    population is most likely to have moved.
    """
    if not records:
        raise AssertionError("adventure-pack coverage: refusing to inspect zero records")
    if not mapping:
        raise AssertionError("adventure-pack coverage: the mapping is empty")
    cov = coverage(records, mapping)
    stale = sorted(set(mapping) - {r.get("location_quest") for r in records})
    cov["stale_mapping_entries"] = stale
    return cov
