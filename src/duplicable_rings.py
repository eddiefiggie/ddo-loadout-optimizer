"""#442 — which rings may be worn twice, from per-item wiki evidence.

DDO's **Unique Equipped** property decides whether a player may wear two copies
of an item. #335 let the solver equip a second copy of a ring to complete a set,
and shipped narrowed to a single hard-coded name because the dataset carried no
per-item evidence. #442 was opened to widen that from a code constant to a
harvested field.

**The harvest found that the field #442 assumed exists does not.** All 131
set-member ring item pages were read on 2026-08-27
(`docs/wiki-evidence/duplicable-rings.md`):

  * **zero** carry a `unique` / `uniqueequipped` template parameter;
  * **zero** contain the word "unique" anywhere in their wikitext;
  * 23 carry a free-text `tips` parameter, and exactly **two** of those say
    anything about wearing a second copy — the two Legendary Katra rings.

So the widening this module performs is one ring, and that is not a shortfall:
it is the whole of what the wiki states. The value of doing it is that the claim
now lives in a dated shard with each item's verbatim citation, instead of a
comment beside a `Set` literal in `web/model.js`, and the next person who wonders
whether the list should be longer can read the negative result rather than
re-running the harvest.

**Fail-closed, and that direction is load-bearing.** A ring absent from the shard
is NOT duplicable. Reading silence as permission would let the solver hand back a
loadout with two rings a player cannot equip — a confidently-reported optimum
that is simply wrong at the character sheet, which is this project's worst
output. The reverse error (refusing a duplicate that is legal) costs a set bonus
the player can still reach another way, and it is visible to them.
"""
from __future__ import annotations

import json
import os


def load(path: str) -> dict:
    """Read the shard. Raises if it is missing or has no entries."""
    if not os.path.exists(path):
        raise SystemExit(f"duplicable rings shard not found: {path}")
    with open(path) as fh:
        shard = json.load(fh)
    if not (shard.get("harvested") or {}):
        raise SystemExit(
            "duplicable rings shard is empty — refusing to build a fail-closed gate "
            "over zero records, which would silently disable #335 rather than narrow it")
    return shard


def duplicable_names(shard: dict) -> set:
    """The names the wiki STATES may be worn twice. Only `stated` provenance counts."""
    out = set()
    for name, entry in (shard.get("harvested") or {}).items():
        entry = entry or {}
        if entry.get("provenance") != "stated":
            continue
        if (entry.get("value") or {}).get("duplicable") is True:
            out.add(name)
    return out


def check(shard: dict, variants) -> dict:
    """Validate the shard against the catalog it will be stamped onto.

    Every named ring must still exist, still be a Ring, and still carry a
    `set_bonus` — a second copy of a set-less ring adds nothing, because
    same-name/same-type affixes collapse to a max rather than summing, so an entry
    that lost its set membership is a stale claim rather than a live one.

    Returns `{"checked", "stamped", "problems"}`. Problems are returned rather
    than raised so the caller reports them all at once.
    """
    by_name = {}
    for v in variants or []:
        by_name.setdefault(v.get("source_item") or v.get("variant_id"), []).append(v)

    problems = []
    stamped = 0
    names = duplicable_names(shard)
    for name in sorted(names):
        recs = by_name.get(name)
        if not recs:
            problems.append(
                f"{name!r} is named in the duplicable-ring shard but is not in the "
                "catalog — an upstream rename, or a claim that has gone stale")
            continue
        for rec in recs:
            if rec.get("slot") != "Ring":
                problems.append(
                    f"{name!r} is no longer a Ring (slot {rec.get('slot')!r}) — the "
                    "duplicate-wear rule is specific to the two-Ring slot")
            elif not (rec.get("set_bonus") or []):
                problems.append(
                    f"{name!r} no longer carries a set_bonus, so a second copy would "
                    "add nothing: duplicate affixes collapse to a max rather than summing")
            else:
                stamped += 1
    return {"checked": len(names), "stamped": stamped, "problems": problems}


def apply(variants, shard: dict) -> dict:
    """Stamp `duplicable_ring: True` on every variant the wiki states may be doubled.

    Only the true case is stamped. An absent field is the fail-closed default, and
    writing `False` on 9,000 records would carry no more information while
    inviting a reader to treat the flag as harvested for all of them.
    """
    names = duplicable_names(shard)
    stamped = 0
    for v in variants or []:
        name = v.get("source_item") or v.get("variant_id")
        if name in names and v.get("slot") == "Ring" and (v.get("set_bonus") or []):
            v["duplicable_ring"] = True
            stamped += 1
    return {"names": len(names), "stamped": stamped}
