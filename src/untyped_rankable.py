"""#227 — which UNTYPED gear-planner affixes are real magnitude stats.

`rankable_affixes()` skips every affix with no bonus type, on the premise that
untyped names are overwhelmingly weapon procs and banes. The premise holds in
aggregate: of 183 distinct untyped names across ~5,400 raw item affixes, the
population is dominated by Holy, Chilling, Vampirism, Maiming, and the Bane
family. Admitting them wholesale would bury the picker.

But the premise has exceptions, and `Enhanced Ki` is one — a genuine worn-gear
magnitude on 19 variants across 5 slots, which no player could rank because it
happens to arrive untyped. This module separates the two populations.

**The rule identifies candidates; it does not admit them.** A name enters the
rankable vocabulary only by appearing on the curated `allow` list, verified
against the wiki. Everything else the rule catches goes on `quarantined` with a
reason. A candidate on neither list fails the build, which makes a new untyped
worn stat a reviewed event instead of a silent omission — the same
exclude-until-verified shape the artifact and alignment gates use.

The candidate rule is `untyped + numeric + >= 2 distinct items + well-formed +
reaches a worn slot`. Weapon and off-hand slots are excluded from "worn" because
that is where the proc population and the rune-arm imbue family live; requiring a
name to appear somewhere else is what separates `Enhanced Ki` (boots, goggles,
necklaces, bracers, armor, trinkets) from `Holy` (weapons).
"""
from __future__ import annotations

import json
import os

# Slots whose affixes are dominated by weapon procs, banes, and the rune-arm
# imbue family. A name that appears ONLY here is not a worn-gear magnitude stat.
# Both spellings are listed because this module runs against the pipeline records,
# where `planner_items._SLOT_MAP` has already rewritten `Offhand` to `Off Hand`,
# and against the raw file in tests and one-off audits, where it has not.
NON_WORN_SLOTS = frozenset({"Weapon", "Offhand", "Off Hand"})


def _is_numeric(v) -> bool:
    if isinstance(v, (int, float)):
        return True
    if isinstance(v, str):
        try:
            float(v.strip().rstrip("%"))
            return True
        except ValueError:
            return False
    return False


def _well_formed(name: str) -> bool:
    """Reject leaked partial effect text — unbalanced brackets mean the upstream
    parse split mid-phrase (`Required Trait: Chaotic (UMD`)."""
    return name.count("(") == name.count(")") and name.count("[") == name.count("]")


def candidates(records: list) -> dict:
    """`{affix_name: {"items": n, "slots": {slot: count}}}` for every untyped
    affix that looks like a real worn-gear magnitude stat.

    An affix is untyped when it carries no bonus type — which the two shapes in
    this pipeline express differently. The raw gear-planner file omits the `type`
    key entirely (which is why `vocabulary.iter_affixes`, requiring name+type+value
    together, cannot see these names at all). `planner_items._native_affixes`
    then normalizes every affix to all three keys with `type: None`. Both mean
    untyped, and this rule must match either, or it silently finds nothing —
    which is exactly what the zero-candidate refusal in `assert_adjudicated`
    exists to catch.
    """
    slots_by_name = {}
    items_by_name = {}
    for r in records or []:
        slot = r.get("slot")
        item = r.get("name")
        for a in r.get("affixes") or []:
            if a.get("type") not in (None, ""):
                continue
            name = a.get("name")
            if not isinstance(name, str) or not name:
                continue
            if not _is_numeric(a.get("value")):
                continue
            if not _well_formed(name):
                continue
            slots_by_name.setdefault(name, {})
            slots_by_name[name][slot] = slots_by_name[name].get(slot, 0) + 1
            items_by_name.setdefault(name, set()).add(item)

    out = {}
    for name, slots in slots_by_name.items():
        if len(items_by_name[name]) < 2:
            continue
        if not any(s not in NON_WORN_SLOTS for s in slots):
            continue
        out[name] = {"items": len(items_by_name[name]), "slots": dict(slots)}
    return out


def load(path: str) -> tuple:
    """`(allow, quarantined)` as name sets, with `_*` meta keys ignored.

    A missing file yields two empty sets. That is the fail-safe direction: an
    empty `allow` reproduces the pre-feature vocabulary exactly, and an empty
    `quarantined` makes every candidate an unadjudicated build failure rather
    than a silent admission.
    """
    if not os.path.exists(path):
        return set(), set()
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)
    if not isinstance(raw, dict):
        return set(), set()
    allow = {e["name"] for e in (raw.get("allow") or [])
             if isinstance(e, dict) and e.get("name")}
    quarantined = {e["name"] for e in (raw.get("quarantined") or [])
                   if isinstance(e, dict) and e.get("name")}
    return allow, quarantined


def assert_adjudicated(records: list, allow: set, quarantined: set) -> int:
    """Fail (raise `SystemExit`) on any candidate in neither list. Returns the
    number of candidates checked.

    Refuses to inspect zero candidates: an empty roster would let this pass
    vacuously, which is how a gate that guards nothing looks exactly like a gate
    that guards everything.
    """
    found = candidates(records)
    if not found:
        raise SystemExit(
            "untyped-rankable adjudication found no candidates to check — the "
            "roster is empty or the candidate rule stopped matching")

    unadjudicated = sorted(set(found) - set(allow) - set(quarantined))
    if unadjudicated:
        lines = [f"{n!r} on {found[n]['items']} items, slots {found[n]['slots']}"
                 for n in unadjudicated]
        raise SystemExit(
            "unadjudicated untyped affixes — each is numeric, on two or more "
            "items, and reaches a worn slot, so it may be a real magnitude stat "
            "no player can rank. Verify against the DDO wiki, then add it to "
            "allow or quarantined in data/seed/compendium/untyped_rankable.json:"
            "\n  " + "\n  ".join(lines))

    stale = sorted((set(allow) | set(quarantined)) - set(found))
    if stale:
        raise SystemExit(
            "untyped-rankable entries no longer match any candidate — upstream "
            "typed them, renamed them, or dropped them, so the adjudication is "
            "pinned to data that moved:\n  " + "\n  ".join(repr(s) for s in stale))

    return len(found)
