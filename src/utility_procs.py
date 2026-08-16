"""#91 (Utility tier) — adjudication of UNTYPED weapon/off-hand proc names.

`untyped_rankable.py` separates the untyped population into worn-gear magnitude
stats (its candidates — a name must REACH a non-weapon slot) and everything
else. The "everything else" is the proc population this module reviews: Holy,
Vampirism, Chilling, Maiming, the Bane family — untyped names that appear ONLY
on Weapon/Off Hand slots. The Utility tier wants to count the ones a player
actually feels; exclude-until-verified wants nobody to count an unreviewed one.

**The rule identifies candidates; it does not admit them.** A name enters the
utility counting set only by appearing on the curated `allow` list, verified
against the wiki. Everything else the rule catches goes on `quarantined` with a
reason. A candidate on neither list fails the build, so a new untyped weapon
proc is a reviewed event instead of a silent zero-count.

The candidate rule is `untyped + numeric + well-formed + every carrying slot is
Weapon/Off Hand`. It is the deliberate complement of `untyped_rankable`'s
"reaches a worn slot" rule, so the two gates' populations are disjoint and
their stale-checks can never fight over one name: a quarantined proc that later
gains a worn-slot carrier stops being a candidate HERE (stale — build fails,
review event) and becomes a candidate THERE.

Admitted names feed `metadata.utility_counting_set` and
`metadata.utility_untyped_admitted` (a presence-path picker entry) — NEVER
`metadata.rankable_affixes`, which would hand Holy/Vampirism the declared-credit
control `web/dataset.js` documents as a defect for exactly these names.

This module also derives the Bool half of the counting set:
`presence_counting_names` mirrors `web/dataset.js`'s presence predicate
(`_PRESENCE_NOISE` + the four-word cap + PRESENCE_ALLOW/PRESENCE_DENY) so the
stamped set is authoritative and app and Python tests agree. Keep the three
constants in lockstep with `web/dataset.js` — a parity drift means the picker
badges a name the counting set does not count, or vice versa.
"""
from __future__ import annotations

import json
import os
import re

from src.untyped_rankable import NON_WORN_SLOTS, _is_numeric, _well_formed

PRESENCE_TYPES = frozenset({"boolean", "Bool"})

# --- MIRROR of web/dataset.js (_PRESENCE_NOISE / PRESENCE_DENY / PRESENCE_ALLOW).
# Same regex, same four-word cap, same override lists. dataset.js keeps its copy
# because it must classify cached datasets built before this stamp existed; the
# parity tests in tests/test_utility_procs.py + tests/dataset.test.js guard the
# two copies against drift.
_PRESENCE_NOISE = re.compile(
    r"[.%:]|\bchance\b|\bwhen you\b|\byour\b|\bclicky\b|\bupgrade"
    r"|\bper (?:rest|day)\b|\bcharges?\b|\(\d|\d/day", re.IGNORECASE)
PRESENCE_DENY = frozenset()
PRESENCE_ALLOW = frozenset({
    "Kick 'Em While They're Down",
    "Way of the Sun Soul",
    "Lifeblood of the Undead Prince",
    "Path of the Fire Dragon",
    "Path of the Guarding Stone",
    "Brilliance of the Shattered Sun",
    "Vile Grip of the Hidden Hand",
    "Legendary Vile Grip of the Hidden Hand",
    "Legendary Tet-zik, The Enlightened Change",
})


def is_presence_targetable(name) -> bool:
    """The web picker's presence predicate, mirrored exactly (see block above)."""
    n = str(name or "").strip()
    if not n:
        return False
    if n in PRESENCE_DENY:
        return False
    if n in PRESENCE_ALLOW:
        return True
    if _PRESENCE_NOISE.search(n):
        return False
    return len(n.split()) <= 4


def presence_counting_names(records) -> set:
    """Every Bool/boolean-typed affix name on the records that passes the
    presence predicate — the raw Bool half of the counting set, BEFORE the
    magnitude subtraction (`counting_set` applies it)."""
    out = set()
    for r in records or []:
        for a in r.get("affixes") or []:
            if a.get("type") in PRESENCE_TYPES and is_presence_targetable(a.get("name")):
                out.add(str(a.get("name")).strip())
    return out


def counting_set(records, rankable, untyped_admitted) -> list:
    """`metadata.utility_counting_set`: (Bool presence names passing
    presence-minus-magnitude) ∪ (allow-dispositioned untyped proc names). Sorted.

    The subtraction is what drops the four dual-nature names (Deception, Smoke
    Screen, Protection from Evil, Underwater Action) — they ship a Bool line on
    some items and a real rankable magnitude on others, and their value is
    already expressible as a ranked stat (R5)."""
    return sorted((presence_counting_names(records) - set(rankable or ()))
                  | set(untyped_admitted or ()))


def candidates(records) -> dict:
    """`{affix_name: {"items": n, "slots": {slot: count}}}` for every untyped
    affix name whose carriers are ALL Weapon/Off Hand slots — the proc
    population `untyped_rankable.candidates` deliberately excludes.

    Untyped matches both pipeline shapes (`type` absent in the raw file,
    `type: None` after `planner_items._native_affixes`), and both `Offhand`/
    `Off Hand` slot spellings, for the same reasons `untyped_rankable` does.
    Values in the dataset are strings ('1', '3'); `_is_numeric` handles both."""
    slots_by_name = {}
    items_by_name = {}
    numeric_by_name = {}
    for r in records or []:
        slot = r.get("slot")
        item = r.get("name")
        for a in r.get("affixes") or []:
            if a.get("type") not in (None, ""):
                continue
            name = a.get("name")
            if not isinstance(name, str) or not name:
                continue
            if not _well_formed(name):
                continue
            slots_by_name.setdefault(name, {})
            slots_by_name[name][slot] = slots_by_name[name].get(slot, 0) + 1
            items_by_name.setdefault(name, set()).add(item)
            numeric_by_name.setdefault(name, True)
            numeric_by_name[name] = numeric_by_name[name] and _is_numeric(a.get("value"))

    out = {}
    for name, slots in slots_by_name.items():
        if not numeric_by_name.get(name):
            continue
        # The complement of untyped_rankable's rule: EVERY carrying slot is a
        # weapon/off-hand slot. A name that reaches any worn slot belongs to the
        # other gate's population (or to neither), never to both.
        if any(s not in NON_WORN_SLOTS for s in slots):
            continue
        out[name] = {"items": len(items_by_name[name]), "slots": dict(slots)}
    return out


def load(path: str) -> tuple:
    """`(allow, quarantined)` as name sets, with `_*` meta keys ignored.

    A missing file yields two empty sets — the fail-safe direction: an empty
    `allow` counts zero untyped procs (exclude-until-verified), and an empty
    `quarantined` makes every candidate an unadjudicated build failure rather
    than a silent admission."""
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


def assert_adjudicated(records, allow, quarantined) -> int:
    """Fail (raise `SystemExit`) on any candidate in neither list. Returns the
    number of candidates checked.

    Refuses to inspect zero candidates: an empty roster would let this pass
    vacuously, which is how a gate that guards nothing looks exactly like a
    gate that guards everything."""
    found = candidates(records)
    if not found:
        raise SystemExit(
            "utility-procs adjudication found no candidates to check — the "
            "roster is empty or the candidate rule stopped matching")

    unadjudicated = sorted(set(found) - set(allow) - set(quarantined))
    if unadjudicated:
        lines = [f"{n!r} on {found[n]['items']} items, slots {found[n]['slots']}"
                 for n in unadjudicated]
        raise SystemExit(
            "unadjudicated untyped weapon procs — each may be a player-felt "
            "utility effect the counting set should include, or flavor it must "
            "not. Verify against the DDO wiki, then add it to allow or "
            "quarantined in data/seed/compendium/utility_procs.json:"
            "\n  " + "\n  ".join(lines))

    stale = sorted((set(allow) | set(quarantined)) - set(found))
    if stale:
        raise SystemExit(
            "utility-procs entries no longer match any candidate — upstream "
            "typed them, renamed them, dropped them, or gave them a worn-slot "
            "carrier (which moves them to untyped_rankable's population), so "
            "the adjudication is pinned to data that moved:\n  " +
            "\n  ".join(repr(s) for s in stale))

    return len(found)
