"""U5 (#162) — attach wiki-sourced item material and its metal classification.

gear-planner transcribes the enchantment list from a wiki item page and takes only
minimum level, slot, and item type from the header block. Everything else in that
header — material, proficiency, race/alignment locks — is absent by construction,
because a stat calculator only needs "what does this add?", never "can this
character equip it?". The optimizer needs the second question too, and the answer
lives entirely in the half nobody copied.

This module folds the harvested material onto planner records so the build can
stamp it, and exposes the metal classification the druidic-oath gate reads.

Exclude-until-verified throughout: a material we did not source, or one whose
metalness the wiki does not state, is left unclassified and every consumer fails
open. A druid keeping one option they should not have is a smaller harm than the
optimizer silently narrowing the pool on a guess — and the coverage numbers make
the gap visible rather than letting it pass as completeness.
"""
from __future__ import annotations

import urllib.parse


def title_for(url: str) -> str:
    """`/page/Item:Adherence` -> `Item:Adherence` (the shard's key)."""
    return urllib.parse.unquote((url or "").replace("/page/", "")).replace("_", " ")


def apply(records, shard: dict) -> dict:
    """Stamp `material` onto every record the shard covers, in place.

    Only a `stated` provenance yields a material; `defaulted` and `unsourced`
    leave the field absent so downstream gates fail open on them.
    """
    harvested = (shard or {}).get("harvested") or {}
    stats = {"stamped": 0, "unsourced": 0, "uncovered": 0}

    for rec in records or []:
        entry = harvested.get(title_for(rec.get("url")))
        if entry is None:
            stats["uncovered"] += 1
            continue
        if entry.get("provenance") != "stated":
            stats["unsourced"] += 1
            continue
        material = (entry.get("value") or {}).get("material")
        if material:
            rec["material"] = material
            stats["stamped"] += 1

    return stats


def classification(seed: dict) -> dict:
    """`{material_name: "metal" | "non_metal"}` from the curated seed.

    A material in neither list is absent from the map — callers must treat an
    absent lookup as unknown and fail open, never as non-metal.
    """
    out = {}
    for name in (seed or {}).get("metal") or []:
        out[name] = "metal"
    for name in (seed or {}).get("non_metal") or []:
        out[name] = "non_metal"
    return out


def coverage(records, seed: dict) -> dict:
    """Per-material counts plus how many stamped records are classifiable.

    `unclassified` is the number the oath gate will fail open on — the honest
    measure of how complete the druid restriction actually is.
    """
    cls = classification(seed)
    counts = {"stamped": 0, "metal": 0, "non_metal": 0, "unclassified": 0}
    by_material = {}
    for rec in records or []:
        material = rec.get("material")
        if not material:
            continue
        counts["stamped"] += 1
        by_material[material] = by_material.get(material, 0) + 1
        counts[cls.get(material, "unclassified")] += 1
    return {**counts, "by_material": dict(sorted(by_material.items()))}


class MaterialCoverageError(Exception):
    """A gated item arrived with no material entry — the harvest work order grew."""


def assert_coverage(records, shard: dict, gated_types, gated_slots) -> int:
    """Fail the build when a shield or body-armor record has no shard entry (U7/R10).

    DELTA-ONLY by construction: an item already harvested resolves, so a refreshed
    upstream snapshot surfaces only its genuinely NEW items. The failure lists them
    by name — that list is the harvest work order, not a wall to climb.

    An entry with `unsourced` provenance RESOLVES: the wiki was checked and is
    silent. That is the reviewed known-unsourced state, and it is what keeps a page
    that genuinely states no material from blocking the build forever. Only an item
    with no entry at all fails.
    """
    harvested = (shard or {}).get("harvested") or {}
    missing = []
    checked = 0
    for rec in records or []:
        slot, typ = rec.get("slot"), rec.get("type")
        # NOTE the slot vocabulary: planner RECORDS carry "Off Hand" (normalized by
        # planner_items._slot), while the RAW gear-planner dump carries "Offhand".
        # scripts/merge_harvest.py builds its roster from the raw dump and so matches
        # on the raw spelling. Using the raw spelling here made this gate silently
        # inert — it matched nothing and passed unconditionally.
        if not ((slot == "Off Hand" and typ in gated_types)
                or (slot == "Armor" and typ in gated_slots)):
            continue
        checked += 1
        if title_for(rec.get("url")) not in harvested:
            missing.append(rec.get("name"))
    if not checked:
        # Self-guard against the inertness above: a gate that inspects nothing is not
        # a gate. If the slot/type vocabulary drifts again, fail loudly here rather
        # than passing every build for free.
        raise MaterialCoverageError(
            "material coverage gate inspected 0 items — the slot/type vocabulary has "
            "drifted and the gate is inert. Expected records with slot 'Off Hand' or "
            "'Armor' matching the gated type sets.")
    if missing:
        shown = ", ".join(sorted(missing)[:10])
        more = f" (+{len(missing) - 10} more)" if len(missing) > 10 else ""
        raise MaterialCoverageError(
            f"{len(missing)} gated item(s) have no material entry: {shown}{more}. "
            f"Harvest them with `python3 scripts/merge_harvest.py --field material "
            f"--missing-only`, or record them as unsourced if the wiki is silent. "
            f"A shield or body armor with no entry would silently pass the druidic "
            f"oath gate.")
    return checked
