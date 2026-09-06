"""#270 — the composite identity handle for a CRAFTED option.

The blocklist gate (#110) filters candidacy by `variant_id`. A crafted option
has none: it is a row in a pool, not a catalog record, and two of the seven
pools carry no `name` either. So "never craft this one" was inexpressible while
the options themselves were reachable — which became a live gap the moment #194
(PR #688) made 116 Legendary Green Steel recipes craftable.

THE KEY

    craft:<pool>:<pool key>:<option>

`<pool key>` is the pool's own discriminator and `<option>` is the row's `name`,
or `<stat>|<bonus_type>|<value>` for the pools whose rows have none. Stamped
HERE, at build time, so the browser never synthesises one — the same reason
`block_identity` is derived in the pipeline rather than by a name test in
`model.js`.

WHY `quarterstaff` IS PART OF THE KEY

The design recorded on #270 named six discriminators. Measured against the built
dataset before writing the gate, they produce **12 duplicate keys** — 8 in
`viktranium`, 4 in `dino_inserts`. Every one is a quarterstaff variant: the same
option name, the same slot/category, distinguished only by a `quarterstaff`
flag, and the quarterstaff row carries EXTRA affixes (Universal Spell Lore and
Universal Spell Power on top of the shared Spell Focus set).

A duplicate key is not a cosmetic problem here. The gate removes every row whose
key a player blocked, so one shared key means blocking `Iridiscent Fang` also
silently removes the quarterstaff option that grants strictly more — a block the
player never asked for, on a row the disclosure would not distinguish. The flag
is therefore part of the discriminator for the two pools that carry it, and the
uniqueness assertion in `tests/test_craft_identity.py` is what keeps it that way.

WHY `nearly_complete_per_item` IS INCLUDED

The design named six pools. There are seven sources of craftable options: the
per-item Nearly Complete pools (147 rows over 43 hosts, keyed by host name) are
solver-wired and equally craftable. Leaving them out would mean the blocklist
could name 665 options and not these, which reads as a bug rather than a scope
line. Their pool key is `<host>|<pool>`, the two things that locate the row.

STABILITY

The key is as stable as upstream's option names. A refresh that renames an option
makes a saved entry stale, which the existing stale-entry report (R7 of the
blocklist plan) already discloses — the same contract a renamed item has.
"""
from __future__ import annotations

PREFIX = "craft:"

#: Field stamped onto every option row.
KEY_FIELD = "block_key"


def _option(rec) -> str:
    """The row's own name, or its single affix spelled out when it has none."""
    name = (rec.get("name") or "").strip()
    if name:
        return name
    affixes = rec.get("affixes") or []
    if affixes:
        a = affixes[0]
        return f"{a.get('stat')}|{a.get('bonus_type')}|{a.get('value')}"
    return f"{rec.get('stat')}|{rec.get('bonus_type')}|{rec.get('value')}"


def _qs(rec) -> str:
    """The quarterstaff discriminator — empty unless the row carries the flag."""
    return "|qs" if rec.get("quarterstaff") else ""


#: `pool name -> the pool's own discriminator`. The single source of truth for
#: what locates a row inside its pool; the gate and the picker both read keys
#: produced here rather than deriving their own.
POOL_KEY = {
    "seal": lambda r: str(r.get("seal_type")),
    "viktranium": lambda r: f"{r.get('slot_type')}|{r.get('category')}{_qs(r)}",
    "dino_inserts": lambda r: f"{r.get('dino_type')}|{r.get('category')}{_qs(r)}",
    "nearly_complete": lambda r: str(r.get("category")),
    "legendary_green_steel": lambda r: str(r.get("tier")),
    "essence_crafting": lambda r: str(r.get("menu")),
}

#: Pools whose rows are a flat list under a top-level dataset key.
FLAT_POOLS = tuple(POOL_KEY)

#: The per-item pool, keyed by host name rather than flat — handled separately
#: because its discriminator needs the host, which is the dict key.
PER_ITEM_POOL = "nearly_complete_per_item"


def key_for(pool: str, rec, host: str = None) -> str:
    """The composite key for one option row."""
    if pool == PER_ITEM_POOL:
        pool_key = f"{host}|{rec.get('pool')}"
    else:
        pool_key = POOL_KEY[pool](rec)
    return f"{PREFIX}{pool}:{pool_key}:{_option(rec)}"


def stamp(dataset) -> dict:
    """Stamp `block_key` onto every crafted option row, in place.

    Returns a coverage report `{stamped, by_pool, distinct}` the build publishes,
    so a later refresh that collapses two options into one key is visible as a
    number rather than only as a failing test.
    """
    by_pool = {}
    keys = []
    for pool in FLAT_POOLS:
        rows = dataset.get(pool) or []
        for rec in rows:
            k = key_for(pool, rec)
            rec[KEY_FIELD] = k
            keys.append(k)
        by_pool[pool] = len(rows)
    per_item = dataset.get(PER_ITEM_POOL) or {}
    n = 0
    for host, rows in per_item.items():
        for rec in rows or []:
            k = key_for(PER_ITEM_POOL, rec, host=host)
            rec[KEY_FIELD] = k
            keys.append(k)
            n += 1
    by_pool[PER_ITEM_POOL] = n
    return {"stamped": len(keys), "distinct": len(set(keys)), "by_pool": by_pool}
