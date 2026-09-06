"""#714 — expand the folded `Dragon's Edge` affix into the stat it grants.

`Dragon's Edge` is not a stat, and the number stored beside it is not a
magnitude. gear-planner stores `Dragon's Edge | Enhancement | N` on 18 records,
where **N is the enchantment's RANK**. The rendered tooltip states what the rank
actually grants:

    Dragon's Edge 3: +9% Enhancement bonus to bypass enemy Fortification.
                     On Crit: 3d8 Bleeding Damage to those that are vulnerable to it.

So a player ranking `Armor-Piercing` scored nothing from any carrier, and a
player who ranked the literal name `Dragon's Edge` was scored on ranks. This is
the same shape as `Parrying VIII` granting 4 (#169) and `Riposte IX` granting 5
and 4 (#546) — a numeral standing in for a magnitude, defensible only by
coincidence.

THE MAPPING IS A LOOKUP, NOT A FORMULA — and this one proves the rule pays

All three ranks the catalog carries were rendered individually:

    rank 2 -> 8%     rank 3 -> 9%     rank 7 -> 23%

#714's body reasonably asked "is 7 -> 21?", i.e. `rank x 3` fitted to the rank-3
point. It is 23. Nor is it `rank + 6`, which fits 2 and 3 and gives 13 for 7. The
step from 2 to 3 is +1 and the step from 3 to 7 is +14; no line passes through
all three. Any ratio fitted to one or two points would have shipped a wrong
number for a rank nobody rendered, and a wrong number is indistinguishable from
a right one in a finished loadout.

The trap is sharper still: the BLEED half of the same tooltip *does* scale
cleanly (`N d8`). Checking either half alone produces a confident wrong answer
about the other. So the shard's stored value is authoritative and an unlisted
rank is REFUSED rather than computed.

WHY `Armor-Piercing`, AND WHY THAT IS NOT AN INFERENCE

The wiki classifies it. https://ddowiki.com/page/Armor-Piercing lists this
enchantment in its own "Found on" section:

    Thunder-Forged crafting: Dragon's Edge +35%

Both are stated as an Enhancement bonus to bypassing enemy Fortification, and
the page's typed sections (Artifact / Insightful / Legendary Armor-Piercing)
match the buckets the catalog already carries for that stat. The `+35%` there is
the Thunder-Forged CRAFTED tier, not one of the item ranks — evidence of
classification, not a fourth value to store.

WHAT STAYS UNCREDITED

The `On Crit: Nd8 Bleeding Damage` half is a proc, and procs are not valued
(#331). It is recorded in the shard's `uncredited_note` so a later reader can see
it was read and declined rather than missed.
"""
from __future__ import annotations

import os

from src import enchantment_split as _es
from src import vocabulary as _vocab

FOLDED_NAME = "Dragon's Edge"
PRIMARY_NAME = "Armor-Piercing"

SHARD_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data", "seed", "compendium", "dragons_edge_version.json")


def _bucket(affix_type):
    """An affix type's stacking bucket, mirroring `equivType` in `web/model.js`."""
    return _vocab.stacking_bucket(affix_type)


# One contribution, so no `extras`. `dedupe_primary` is on for the same reason
# Riposte has it: if a carrier ever gains a native Armor-Piercing in the same
# bucket, the folded affix must be dropped rather than renamed into a duplicate
# row. No carrier does today (measured: 0 of 18), which is why this is a guard
# against a future refresh rather than a fix for a present bug.
_CONFIG = _es.SplitConfig(
    folded_name=FOLDED_NAME,
    primary_name=PRIMARY_NAME,
    primary_key="bypass",
    primary_corrected_stat="bypass_corrected",
    extras=(),
    shadow_key=_es.name_and_bucket(_bucket),
    label="dragon's edge shard",
    dedupe_primary=True,
    rename_requires_stated=True,
)


def rank_of(rec):
    """The rank this record stores, as the shard's string key, or None.

    Keyed on the affix's own VALUE rather than on the item, because the tooltip
    is a pure function of the rank: one shard entry serves every carrier at that
    rank, and a new carrier at a known rank needs no harvest at all.
    """
    for a in rec.get("affixes") or []:
        if (a.get("stat") or a.get("name")) == FOLDED_NAME:
            v = a.get("value")
            return None if v is None else str(v)
    return None


def apply(records, shard: dict) -> dict:
    """Rewrite the folded affix on every record whose RANK the shard covers.

    A record at a rank the shard does not list keeps the folded affix and
    increments `uncovered` — the gap stays visible rather than the split
    inventing a percentage for a rank nobody rendered.
    """
    return _es.rewrite_all(records, shard, rank_of, _CONFIG)


def audit_shard(shard: dict) -> dict:
    """`{ranks, stated, values}` — what the shard actually carries.

    Published by the build so a refresh that adds a rank without a tooltip is a
    number rather than only a failing test.
    """
    harvested = (shard or {}).get("harvested") or {}
    stated = {k: v for k, v in harvested.items()
              if (v or {}).get("provenance") == "stated"}
    return {
        "ranks": sorted(harvested),
        "stated": sorted(stated),
        "values": {k: (v.get("value") or {}).get("bypass") for k, v in sorted(stated.items())},
    }


def unlisted_ranks(records, shard: dict) -> list:
    """Ranks present in the data that the shard does not cover — the refusal set.

    An unlisted rank is not an error in itself (upstream may add one at any
    refresh); it is a HARVEST ORDER. The build reports it so the gap cannot sit
    unnoticed while those records quietly keep a rank where a magnitude belongs.
    """
    harvested = (shard or {}).get("harvested") or {}
    seen = set()
    for rec in records or []:
        r = rank_of(rec)
        if r is not None and r not in harvested:
            seen.add(r)
    return sorted(seen)
