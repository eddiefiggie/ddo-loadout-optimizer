"""#88 / #214 — drop affixes the wiki states are conditional, ramping or temporary.

gear-planner stores an affix as a flat `(name, type, value)`. It has no field for
"only while a trigger keeps firing", so a buff that ramps to a maximum is stored
AS that maximum, unconditionally. Credited flat, the optimizer then grants
permanently what the game grants only during a window.

The live case this module was built for: `Meridian Fragment` and `Crystallized
Drop of Tea` store `Universal Spell Power | Psionic | 24`, while the wiki says

    once every three seconds when you take physical damage, you get +8 Psionic
    Bonus to Universal Spell Power. This can stack up to three times and each
    stack lasts for 20 seconds.

So 24 is 8 x 3, reachable only while being hit, decaying after 20 seconds. And
because Universal Spell Power CROSS-ADDS into all ten element spellpowers
(#290/#301), the over-credit does not stay local — it lands on every spellpower
a caster ranks.

**Dropped, not re-valued.** The wiki states no sustained figure, so any number we
wrote would be invented, and the standing rule is that a visible gap beats a
confident wrong one. This is the same disposition `Deific Focus` received on the
same shape.

This is a NARROW, curated mechanism, not the general fix. #214 tracks the real
problem — that conditional and ramping effects are indistinguishable from flat
ones in the data — and this module is deliberately a per-affix quarantine with
wiki evidence, in the shape of the corrections family, rather than a heuristic.
"""
from __future__ import annotations

import json
import os


def load(path: str) -> dict:
    """`{record_name: [entry, ...]}` with `_*` meta keys stripped. A missing file
    yields `{}` — the overlay is optional."""
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)
    return dict((raw.get("quarantined") or {}))


def apply(records: list, quarantine: dict) -> dict:
    """Remove each quarantined affix in place. Returns a coverage dict.

    Raises `SystemExit` when an entry's recorded `from_value` no longer matches
    what the record carries: upstream re-encoded the affix, so the ruling must be
    re-read against the wiki rather than reapplied on faith.
    """
    by_name = {}
    for r in records:
        by_name.setdefault(r.get("name"), r)

    problems = []
    dropped = 0
    hit_names = set()
    for record_name in sorted(quarantine):
        rec = by_name.get(record_name)
        if rec is None:
            continue
        affixes = rec.get("affixes") or []
        for entry in quarantine[record_name]:
            key = (entry.get("name"), entry.get("type"))
            matches = [a for a in affixes if (a.get("name"), a.get("type")) == key]
            if not matches:
                problems.append(
                    f"{record_name}: no {key[0]!r} affix typed {key[1]!r} to quarantine "
                    "— gear-planner's record changed; re-read the wiki ruling")
                continue
            for a in matches:
                if str(a.get("value")) != str(entry.get("from_value")):
                    problems.append(
                        f"{record_name}: {key[0]!r} now reads {a.get('value')!r} upstream "
                        f"but the ruling was made against {entry.get('from_value')!r} — "
                        "re-verify before reapplying")
                    continue
                hit_names.add(record_name)
                rec["affixes"] = [x for x in rec["affixes"] if x is not a]
                affixes = rec["affixes"]
                dropped += 1

    if problems:
        raise SystemExit(
            "conditional affix quarantine is stale — the upstream data moved:\n  "
            + "\n  ".join(problems))
    return {"dropped": dropped, "hit_names": sorted(hit_names)}


def assert_all_reached(quarantine: dict, *coverages) -> None:
    """Fail the build when an entry reached no record in ANY channel — the quiet
    staleness this family exists to prevent."""
    reached = set()
    for cov in coverages:
        reached.update((cov or {}).get("hit_names") or [])
    missing = set(quarantine) - reached
    if missing:
        raise SystemExit(
            "conditional affix quarantine entr(ies) reached no record in any channel: "
            + ", ".join(sorted(repr(m) for m in missing)))
