"""#902 — which one-handed weapons may be wielded twice, one copy per hand.

The ring rule, extended to weapons: **an item may be held twice unless it is
Exclusive or a Minor Artifact.** Both are per-item wiki categories, so this is a
read, not an inference. `ring_exclusivity.py` carries the full argument for why
category absence is a stated negative; the short form is that `Template:Bind`
publishes `exclusive` with a default of false, so a page that records a binding
and is not in `Category:Exclusive` STATES that it is not Exclusive. A page with
no binding category states nothing, and is quarantined rather than defaulted.

Evidence and method: `docs/wiki-evidence/weapon-exclusivity.md`.

The solver had forbidden one weapon in both hands outright ("the same physical
item can't fill both hands"). That was right about one physical item and wrong
about the game: a second copy is a second item. A player reported it (#902).

Fail-closed, as for rings: only `stated` entries whose value says `duplicable:
True` are stamped. A weapon the shard does not cover is refused, and `check`
fails the build when a one-handed weapon arrives that the harvest never saw.
"""
from __future__ import annotations

import json
import os
from urllib.parse import unquote

SHARD_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "seed",
                          "compendium", "weapon_exclusivity.json")


def load(path: str = SHARD_PATH) -> dict:
    if not os.path.exists(path):
        raise SystemExit(f"weapon exclusivity shard not found: {path}")
    with open(path, encoding="utf-8") as fh:
        shard = json.load(fh)
    if not (shard.get("harvested") or {}):
        raise SystemExit("weapon exclusivity shard is empty — refusing to build a gate over zero records")
    return shard


def wiki_title(rec) -> str | None:
    """The `Item:` page a record describes, read from its own wiki url — so an
    `[Upgraded]` or `[Crafted]` twin resolves to its base's page, exactly as the
    harvest did."""
    url = rec.get("wiki_url") or ""
    i = url.find("/page/Item:")
    if i < 0:
        return None
    return unquote(url[i + len("/page/Item:"):]).replace("_", " ")


def duplicable_titles(shard: dict) -> set:
    out = set()
    for name, e in (shard.get("harvested") or {}).items():
        e = e or {}
        if e.get("provenance") == "stated" and (e.get("value") or {}).get("duplicable") is True:
            out.add(name)
    return out


def _population(variants, shard):
    types = set((shard.get("_meta") or {}).get("population_types") or [])
    return [v for v in variants or [] if v.get("category") == "weapon" and v.get("type") in types]


def check(shard: dict, variants) -> dict:
    """Coverage and artifact agreement. Problems are returned, not raised."""
    pop = _population(variants, shard)
    problems = []
    if not pop:
        problems.append("no one-handed weapon in the catalog matches the shard's population types — "
                        "refusing to pass a guard that inspected nothing")
    harvested = shard.get("harvested") or {}
    uncovered = sorted({wiki_title(v) or v.get("source_item") for v in pop if wiki_title(v) not in harvested})
    for n in uncovered[:10]:
        problems.append(f"{n!r} is a one-handed weapon with no entry in the weapon exclusivity shard — "
                        "re-harvest rather than letting it inherit a default")
    if len(uncovered) > 10:
        problems.append(f"... and {len(uncovered) - 10} more uncovered weapon(s)")
    shard_artifacts = {n for n, e in harvested.items() if ((e or {}).get("value") or {}).get("minor_artifact") is True}
    for v in pop:
        t = wiki_title(v)
        if bool(v.get("artifact")) != (t in shard_artifacts):
            problems.append(f"{t!r}: catalog `artifact` is {bool(v.get('artifact'))} but the wiki's Minor "
                            "Artifact categories say otherwise — the two sources have drifted")
    dup = duplicable_titles(shard)
    return {"weapons_in_population": len(pop), "uncovered": len(uncovered),
            "duplicable": sum(1 for v in pop if wiki_title(v) in dup),
            "blocked": sum(1 for v in pop if wiki_title(v) not in dup), "problems": problems}


def apply(variants, shard: dict) -> int:
    """Stamp `duplicable_weapon: True` on each duplicable one-handed weapon record.
    Only the true case is stamped; absence is the fail-closed default."""
    dup = duplicable_titles(shard)
    n = 0
    for v in _population(variants, shard):
        if wiki_title(v) in dup:
            v["duplicable_weapon"] = True
            n += 1
    return n
