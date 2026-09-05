"""Only the worn channel carries penalties, and the build says so (#614).

The wiki's stacking page states the rule the solver now implements:

    * Bonuses of the same type do not stack ...
    * Penalties always stack.

`web/solver.js` admits negative worn affixes as FORCED, additive terms — no
`Sum(z) <= 1` cap, and a lower bound pinning each z to its gate. That work was
scoped to the worn channel because the worn channel is where every penalty is:
all 36 signed records sit on items, and the seven crafting pools, the set
bonuses and the scaling rows carry none.

**That is a fact about today's data, not a property of the pipeline.** The other
eleven `value > 0` gates still stand, so a negative arriving in one of those
channels would be silently discarded exactly as the worn ones were — the same
defect, in a place nobody is looking.

So the scope is asserted rather than assumed. If a penalty appears in another
channel, this fails and names it, and the fix is to extend the forcing to that
channel rather than to widen this list.
"""
from __future__ import annotations

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET = os.path.join(ROOT, "web", "data", "items.json")

#: Every channel the solver reads contributions from, besides worn item affixes.
UNFORCED_POOLS = ("dino_inserts", "nearly_complete", "viktranium", "seal",
                  "legendary_green_steel", "essence_crafting")


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _pool_negatives(recs):
    out = []
    for r in recs or []:
        rows = r.get("affixes") or ([r] if r.get("stat") is not None else [])
        for a in rows:
            n = _num(a.get("value"))
            if n is not None and n < 0:
                out.append(f"{r.get('name')}: {a.get('stat') or a.get('name')} = {n}")
    return out


def _load():
    with open(DATASET, encoding="utf-8") as fh:
        return json.load(fh)


def test_the_worn_channel_still_carries_penalties():
    """Refuse to inspect nothing.

    If this reaches zero the forcing code below is dead, and the three tests that
    follow would pass by vacuity while the feature had quietly stopped existing.
    """
    if not os.path.exists(DATASET):
        return
    d = _load()
    worn = [a for it in d.get("items", []) for a in (it.get("affixes") or [])
            if (_num(a.get("value")) or 0) < 0]
    assert len(worn) >= 30, (
        f"only {len(worn)} negative worn affixes — the penalty population "
        "collapsed upstream, and the solver's forcing path is now untested by "
        "the real data. Re-verify before assuming this is an improvement.")


def test_no_crafting_pool_carries_a_penalty():
    if not os.path.exists(DATASET):
        return
    d = _load()
    for pool in UNFORCED_POOLS:
        offenders = _pool_negatives(d.get(pool))
        assert not offenders, (
            f"{pool} carries negative value(s): {offenders}. The solver forces "
            "penalties in the WORN channel only; this one still discards them at "
            "its `value > 0` gate, so these would be silently dropped. Extend the "
            "forcing to this channel rather than deleting its gate — an unforced "
            "negative z is set to 0 by the objective and changes nothing.")


def test_no_set_bonus_carries_a_penalty():
    if not os.path.exists(DATASET):
        return
    d = _load()
    offenders = []
    for it in d.get("items", []):
        for tier in (it.get("parsed_set_bonuses") or []):
            for a in (tier.get("affixes") or []):
                n = _num(a.get("value"))
                if n is not None and n < 0:
                    offenders.append(f"{tier.get('set')}: {a.get('stat')} = {n}")
    assert not offenders, (
        f"set bonus tier(s) carry a penalty: {sorted(set(offenders))}. Set tiers "
        "are gated on `value > 0` too, and a set penalty would additionally need "
        "the tier's own activation semantics thought through.")


def test_no_scaling_row_carries_a_penalty():
    if not os.path.exists(DATASET):
        return
    d = _load()
    offenders = []
    for it in d.get("items", []):
        for s in (it.get("scaling") or []):
            for field in ("value", "per_level", "base"):
                n = _num(s.get(field))
                if n is not None and n < 0:
                    offenders.append(f"{it.get('source_item')}: {s.get('stat')}.{field} = {n}")
    assert not offenders, (
        f"scaling row(s) carry a negative: {sorted(set(offenders))}. Scaling is "
        "evaluated through `scaleAt` and gated separately; a scaling penalty needs "
        "its own forcing path.")
