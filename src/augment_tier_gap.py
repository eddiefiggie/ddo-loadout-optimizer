"""#631 — augment tiers the upstream gear-planner crafting dump does not carry.

The DDO wiki's `Lunar Gem` page documents 103 Lunar/Solar gem families at three
tiers. Upstream carries 103 Heroic and 103 Legendary — and **17** Epic. Current
upstream `master` (checked 2026-08-30) carries the same 17, so this is not a stale
snapshot and a refresh does not fix it. Epic gems arrived with Update 73 (Tavern
Tales); upstream appears simply never to have scraped that tier.

Epic gems are ML 20, which is exactly the band a mid-level character reaches for,
so the effect was a player being offered a fifth of the augment pool the game gives
them, silently.

**Additive only, and that is the whole safety property.** This module may fill a
hole upstream leaves; it may never overwrite. An entry whose name is already in
the pool fails the build rather than silently winning, so an upstream fix can
never be shadowed by a stale local copy — the same contract `gap_corrections` has,
and for the same reason.

## Where each field comes from

The VALUE is the wiki's Epic column. The affix NAMES and BONUS TYPES are taken
from our own shipped **Heroic** record for the same gem, never from the wiki row.
That split is deliberate and was forced by measurement: the row's type text proved
unreliable — it reads `Profane` where the ruled type is `Profane Natural`
(bonus-type-equivalence §1), and it mis-assigns across adjacent rows — while the
`(affix, type)` shape is constant across tiers for all 103 bases. A gem's affix
list is also not derivable from its name: `Heal and Listen` grants Heal, Listen
AND Concentration.

The parse was validated against the 204 shipped Heroic/Legendary records before
any Epic value was trusted: 203 matched exactly. The single exception is excluded
from the shard rather than adopted.

## The stale guard

Each entry records the sibling record it was derived from, including that
sibling's affixes verbatim. The build FAILS when the sibling's shape no longer
matches, rather than pinning a derived value over a source that has moved. A
derived record whose derivation has gone stale is worse than an absent one,
because nothing about it looks wrong.
"""
from __future__ import annotations

import json
import os

SHARD_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "seed",
                          "compendium", "augment_tier_gap.json")


def load(path: str = SHARD_PATH) -> list:
    """The additions list, or `[]` when the shard is absent (it is optional)."""
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as fh:
        return json.load(fh).get("additions") or []


def _shape(affixes):
    return [(a.get("name"), a.get("type"), str(a.get("value"))) for a in affixes or []]


def apply(crafting: dict, additions: list) -> dict:
    """Append missing augment options to their pools, in place.

    Raises `SystemExit` when an addition's pool is missing, when its name already
    exists upstream (additive-only), or when the sibling it was derived from has
    changed shape. All three mean the upstream data moved and the derivation must
    be re-verified rather than reapplied on faith.
    """
    problems = []
    added = 0
    pools_touched = set()
    for entry in additions or []:
        pool_key = entry.get("pool")
        pool = (crafting or {}).get(pool_key)
        if not isinstance(pool, dict) or not isinstance(pool.get("*"), list):
            problems.append(f"{entry.get('name')!r}: pool {pool_key!r} is missing or not a menu")
            continue
        options = pool["*"]
        by_name = {o.get("name"): o for o in options if isinstance(o, dict)}

        name = entry.get("name")
        if name in by_name:
            problems.append(
                f"{name!r} is already in {pool_key!r} upstream — this shard is ADDITIVE "
                "only. Upstream has adopted it; delete the entry rather than shadowing "
                "a source that may now differ.")
            continue

        derived = entry.get("derived_from") or {}
        sib_name = derived.get("sibling")
        sib = by_name.get(sib_name)
        if sib is None:
            problems.append(
                f"{name!r}: the sibling {sib_name!r} it was derived from is gone from "
                f"{pool_key!r} — re-verify against the wiki before reapplying")
            continue
        if _shape(sib.get("affixes")) != _shape(derived.get("sibling_affixes")):
            problems.append(
                f"{name!r}: {sib_name!r} now reads {_shape(sib.get('affixes'))} upstream, "
                f"but the derivation was recorded against {_shape(derived.get('sibling_affixes'))} "
                "— the affix names and types were taken FROM that sibling, so a change "
                "there invalidates this entry")
            continue

        options.append({"affixes": [dict(a) for a in entry.get("affixes") or []],
                        "ml": entry.get("ml"), "name": name})
        pools_touched.add(pool_key)
        added += 1

    if problems:
        raise SystemExit(
            "augment tier-gap additions are stale — the upstream data moved:\n  "
            + "\n  ".join(problems))
    return {"added": added, "pools": sorted(pools_touched)}
