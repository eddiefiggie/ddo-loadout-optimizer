"""#879 — the `[Upgraded]` twin: a heroic raid item after its one-time upgrade.

gear-planner c36b45e marks 25 heroic named items `Upgradeable Item` (the
Stormreaver and Black Abbot raid loot, ML13-14) and carries, per item, a
one-option pool of the affixes the upgrade leaves the item with. The wiki states
the same upgrade per item as `X -> Y` replacements and `Adds X` lines, done once
with a Seal at the Stormreaver Monument or the Fountain of Necrotic Might. So the
upgrade is a fixed upgraded STATE of the item, not a choice, and the closer model
is a second record of the same item rather than a crafting slot:

  * the base record — the item as it drops;
  * `<name> [Upgraded]` — the same item after the upgrade, its base affixes with
    each replaced one overwritten and each added one appended.

Theoretical best-in-slot assumes access to everything, so the upgraded record
normally wins and the dominance filter prunes the base. The two are ONE GAME ITEM
to the player, so `identity` maps both onto the base name for the blocklist, in
the map `crafted_twins.derive` builds for the `[Crafted]` twin (#547): blocking
either name blocks the item instead of handing the player its twin.

WHY A SHARD AND NOT THE POOL ALONE. The pool says what the item ends up with but
not which base affix each entry overwrites (`Telekinetic` -> `Greater
Telekinetic` is a rename, not an addition), and a pool is upstream data that can
drift. `data/seed/compendium/upgradeable_items.json` transcribes each wiki block
in upstream's vocabulary, and `expand` refuses the build unless every pool affix
is either an `upgrade` entry there or an explicitly `quarantined` one, every
upstream host is transcribed, and every transcribed host still exists. A pool
value that moves, or a host upstream adds, fails loudly rather than shipping.
"""
from __future__ import annotations

import copy
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHARD_PATH = os.path.join(ROOT, "data", "seed", "compendium", "upgradeable_items.json")
CRAFTING_PATH = os.path.join(ROOT, "data", "seed", "compendium", "raw", "gearplanner_crafting.json")

POOL_KEY = "Upgradeable Item"
SUFFIX = " [Upgraded]"


def load_shard(path=SHARD_PATH):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def load_pools(path=CRAFTING_PATH):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh).get(POOL_KEY) or {}


def _key(name, type_, value=None):
    k = (str(name), str(type_))
    return k if value is None else k + (str(value),)


def _affix_key(a):
    return _key(a.get("name"), a.get("type"), a.get("value"))


def expand(raw_items, pools, shard):
    """Build the `[Upgraded]` raw records for `raw_items` (gear-planner shape).

    Returns `{"records": [...], "identity": {name: base_name}, "problems": [...],
    "coverage": {...}}`. Problems are RETURNED so the caller reports every one at
    once; a non-empty list means nothing here may ship.
    """
    items = (shard or {}).get("items") or {}
    problems = []
    hosts = {}
    for it in raw_items or []:
        if POOL_KEY in (it.get("crafting") or []) and it.get("name") not in hosts:
            hosts[it["name"]] = it
    names = {it.get("name") for it in raw_items or []}

    for n in sorted(set(hosts) - set(items)):
        problems.append(f"{n!r} is an upstream `{POOL_KEY}` host the shard does not "
                        "transcribe — read its wiki page and add it")
    for n in sorted(set(items) - set(hosts)):
        problems.append(f"{n!r} is transcribed but no upstream record marks it "
                        f"`{POOL_KEY}` — renamed or removed upstream")
    for n in sorted(set(pools) - set(hosts)):
        problems.append(f"the `{POOL_KEY}` pool has an entry for {n!r}, which no "
                        "upstream record marks as a host")

    records, identity = [], {}
    modelled = no_stat = quarantined_affixes = 0
    for name in sorted(set(hosts) & set(items)):
        base, entry = hosts[name], items[name]
        opts = pools.get(name)
        if entry.get("no_stat_upgrade"):
            no_stat += 1
            if opts:
                problems.append(f"{name!r} is ruled `no_stat_upgrade` but upstream "
                                "now carries a pool for it — re-read the wiki")
            continue
        upgrade = entry.get("upgrade") or []
        if not upgrade:
            problems.append(f"{name!r} has neither an `upgrade` nor a `no_stat_upgrade` ruling")
            continue
        if not opts or len(opts) != 1:
            problems.append(f"{name!r}: expected a one-option pool, upstream has "
                            f"{len(opts or [])} — the upgrade is no longer one fixed state")
            continue
        pool_affixes = opts[0].get("affixes") or []

        quarantined = [q.get("pool") for q in entry.get("quarantined") or []]
        want = sorted([_key(*u["to"]) for u in upgrade] + [_key(*q) for q in quarantined])
        have = sorted(_affix_key(a) for a in pool_affixes)
        if want != have:
            problems.append(f"{name!r}: the pool no longer matches the wiki transcription "
                            f"(pool {have!r}, transcribed {want!r})")
            continue

        affixes = [copy.deepcopy(a) for a in base.get("affixes") or []]
        ok = True
        for u in upgrade:
            rep = u.get("replace")
            if not rep:
                continue
            hits = [i for i, a in enumerate(affixes) if _key(a.get("name"), a.get("type")) == _key(*rep)]
            if len(hits) != 1:
                problems.append(f"{name!r}: the upgrade replaces {tuple(rep)!r}, which the "
                                f"base carries {len(hits)} times (expected exactly once)")
                ok = False
                continue
            affixes.pop(hits[0])
        if not ok:
            continue
        by_key = {_affix_key(a): a for a in pool_affixes}
        for u in upgrade:
            a = copy.deepcopy(by_key[_key(*u["to"])])  # upstream's own shape
            if u.get("emit"):
                # The wiki block's own name for it (see the shard's `_emit`): a
                # Striding line written already split, so the page-joined speed
                # harvest of the BASE item cannot rewrite the upgraded value.
                a["name"], a["type"], a["value"] = u["emit"][0], u["emit"][1], u["emit"][2]
            affixes.append(a)
        quarantined_affixes += len(quarantined)

        up_name = name + SUFFIX
        if up_name in names:
            problems.append(f"{up_name!r} already exists upstream — the twin name is taken")
            continue
        rec = copy.deepcopy(base)
        rec["name"] = up_name
        rec["affixes"] = affixes
        rec["crafting"] = [c for c in base.get("crafting") or [] if c != POOL_KEY]
        rec["upgraded_from"] = {
            "item": name,
            "upgrader": entry.get("upgrader"),
            "not_credited": list(entry.get("not_credited") or [])
            + [f"{q['pool'][0]} {q['pool'][2]} ({q['reason']})" for q in entry.get("quarantined") or []],
        }
        records.append(rec)
        identity[name] = name
        identity[up_name] = name
        modelled += 1

    return {
        "records": records,
        "identity": identity,
        "problems": problems,
        "coverage": {
            "hosts": len(hosts),
            "upgraded_records": modelled,
            "no_stat_upgrade": no_stat,
            "quarantined_affixes": quarantined_affixes,
        },
    }
