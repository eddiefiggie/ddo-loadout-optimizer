"""#915 — which dual-slot items may be worn as two copies, one in each slot.

Chains, Five Rings and Shackles (and their Legendary tiers) are each worn in
either of two body slots, as their wiki tips state; the harvest reads the pair
(`src/wiki_item_meta.py`) and the record carries the second as `alt_slots`. One
physical item fills one slot. Whether a SECOND copy may fill the other is the
ring and weapon question (#566, #902) asked of a different pair of slots: an item
may be worn twice unless it is Exclusive or a Minor Artifact. Both are per-item
wiki categories, so this is a read, not an inference. Evidence and method:
`docs/wiki-evidence/dual-slot-items.md`.

Fail-closed, as for rings and weapons: only `stated` entries whose value says
`duplicable: True` are stamped, and `check` fails the build when a dual-slot item
arrives that the shard does not cover, or when a page's own body-slot categories
stop naming both slots its tips state.
"""
from __future__ import annotations

import json
import os

from src.weapon_exclusivity import wiki_title
from src.wiki_item_meta import BODY_SLOT

SHARD_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "seed",
                          "compendium", "dual_slot_exclusivity.json")

#: Catalog slot -> the wiki's body-slot category ("Belt" -> "Waist items").
SLOT_CATEGORY = {gp_slot: gp_type for gp_slot, gp_type in BODY_SLOT.values()}
#: `wiki_item_meta.BODY_SLOT` names Head "Helm"; the catalog renames it (planner_items).
SLOT_CATEGORY["Helmet"] = SLOT_CATEGORY["Helm"]


def load(path: str = SHARD_PATH) -> dict:
    if not os.path.exists(path):
        raise SystemExit(f"dual-slot exclusivity shard not found: {path}")
    with open(path, encoding="utf-8") as fh:
        shard = json.load(fh)
    if not (shard.get("items") or {}):
        raise SystemExit("dual-slot exclusivity shard is empty — refusing to build a gate over zero records")
    return shard


def _population(variants):
    return [v for v in variants or [] if v.get("alt_slots")]


def check(shard: dict, variants) -> dict:
    """Coverage and slot agreement. Problems are returned, not raised."""
    items = shard.get("items") or {}
    pop = _population(variants)
    problems = []
    if not pop:
        problems.append("no catalog item carries `alt_slots` — refusing to pass a guard that inspected nothing")
    seen = set()
    for v in pop:
        t = wiki_title(v) or v.get("source_item")
        seen.add(t)
        e = items.get(t)
        if e is None:
            problems.append(f"{t!r} is a dual-slot item with no entry in the dual-slot exclusivity shard — "
                            "read its categories rather than letting it inherit a default")
            continue
        want = sorted(SLOT_CATEGORY.get(s, f"?{s}") for s in [v.get("slot"), *v["alt_slots"]])
        if sorted(e.get("slot_categories") or []) != want:
            problems.append(f"{t!r}: the tips state {want} but the page's categories were read as "
                            f"{sorted(e.get('slot_categories') or [])} — the two have drifted")
        if bool(v.get("artifact")) != bool((e.get("value") or {}).get("minor_artifact")):
            problems.append(f"{t!r}: catalog `artifact` disagrees with the shard's Minor Artifact read")
    for t in sorted(set(items) - seen):
        problems.append(f"{t!r} is in the dual-slot exclusivity shard but no catalog item is dual-slot — stale")
    return {"dual_slot_items": len(pop), "problems": problems,
            "duplicable": sum(1 for v in pop if _duplicable(items.get(wiki_title(v) or v.get("source_item"))))}


def _duplicable(e) -> bool:
    e = e or {}
    return e.get("provenance") == "stated" and (e.get("value") or {}).get("duplicable") is True


def apply(variants, shard: dict) -> int:
    """Stamp `duplicable_worn: True` on each dual-slot item a second copy of which
    may fill its other slot. Only the true case is stamped; absence is the
    fail-closed default, and the solver then offers one copy only."""
    items = shard.get("items") or {}
    n = 0
    for v in _population(variants):
        if _duplicable(items.get(wiki_title(v) or v.get("source_item"))):
            v["duplicable_worn"] = True
            n += 1
    return n
