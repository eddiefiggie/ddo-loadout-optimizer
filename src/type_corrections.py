"""#259 — wiki-sourced corrections to a gear-planner affix BONUS TYPE.

The fourth member of the corrections family, and deliberately a separate
mechanism from its siblings for the same reason they are separate from each
other: each one changes exactly one field and nothing else does.

* ``gap_corrections`` is ADDITIVE — it may not overwrite anything.
* ``value_corrections`` (#207) overwrites the VALUE and nothing else.
* ``name_corrections`` (#227) renames the AFFIX NAME and nothing else.
* This module overwrites the TYPE and nothing else.

A wrong type is a different defect from a wrong value: the magnitude is
correct, but the affix lands in the wrong stacking bucket. `Legendary Moment
to Legendary Moment` stores `Action Boost Charges` as ``Untyped`` while the
wiki tooltip states "+3 **Enhancement** bonus" — and every worn source of the
stat is Enhancement-typed, so the untyped augment stacked with all of them for
a total the game never grants. Same defect class as #223, opposite direction:
there a qualifier posed as a type and over-split; here a missing type
over-stacks.

**The stale guard is the point**, inherited verbatim from #207: each entry
records ``from`` — the type gear-planner carries today — and the build FAILS
when it no longer matches, rather than silently pinning a type over a source
that has since changed. The ``value`` field is recorded as evidence binding
the entry to the tooltip that proves it, and is asserted the same way.

Applied to BOTH the item planner records and the augment pool: the join is by
record name in each, and an entry naming a record absent from one channel is a
silent no-op there (the two shipping entries are augments; the guard fires in
the channel that carries them).
"""
from __future__ import annotations

import json
import os


def load(path: str) -> dict:
    """`{record_name: [correction, …]}` with `_*` meta keys stripped.

    A missing file yields `{}` — the overlay is optional and the build stays
    deterministic without it.
    """
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)
    return {k: v for k, v in raw.items() if not str(k).startswith("_")}


def apply(records: list, corrections: dict) -> dict:
    """Overwrite corrected affix types in place. Returns a coverage dict.

    Raises `SystemExit` when an entry's ``from`` type or recorded ``value`` no
    longer matches what the record carries, or when it targets an affix the
    record does not have. All three mean the upstream data moved and the
    correction must be re-verified against the wiki rather than reapplied on
    faith.

    An entry naming a record absent from THIS list is a silent no-op — the
    entry may live in another channel (item vs augment pool). What must not be
    silent is an entry absent from every channel: after all channels have
    applied, `assert_all_reached` closes that gap.
    """
    by_name = {}
    for r in records:
        by_name.setdefault(r.get("name"), r)   # first wins, matching loader dedup

    problems = []
    records_corrected = 0
    types_changed = 0
    hit_names = set()
    for record_name in sorted(corrections):
        rec = by_name.get(record_name)
        if rec is None:
            continue
        hit_names.add(record_name)
        affixes = rec.get("affixes") or []
        touched = False
        for corr in corrections[record_name]:
            key = (corr.get("name"), corr.get("from"))
            matches = [a for a in affixes
                       if (a.get("name"), a.get("type")) == key]
            if not matches:
                problems.append(
                    f"{record_name}: no {key[0]!r} affix typed {key[1]!r} to correct "
                    "— gear-planner's record changed; re-verify against the wiki")
                continue
            for a in matches:
                current_value = str(a.get("value"))
                expected_value = str(corr.get("value"))
                if current_value != expected_value:
                    problems.append(
                        f"{record_name}: {key[0]!r} now reads value {current_value!r} "
                        f"upstream, but the correction was verified against "
                        f"{expected_value!r} — re-verify against the wiki before "
                        "reapplying")
                    continue
                a["type"] = str(corr.get("to"))
                types_changed += 1
                touched = True
        if touched:
            records_corrected += 1

    if problems:
        raise SystemExit(
            "affix type corrections are stale — the upstream data moved:\n  "
            + "\n  ".join(problems))

    return {"records_corrected": records_corrected,
            "types_changed": types_changed,
            "hit_names": sorted(hit_names)}


def assert_all_reached(corrections: dict, *coverages) -> None:
    """Fail the build when an entry reached no record in ANY channel.

    The per-channel silent no-op is correct (an augment is absent from the item
    roster by design), but an entry absent from every channel means the record
    was renamed or dropped upstream — the quiet staleness this family exists to
    prevent. Called once, after every channel has been applied.
    """
    reached = set()
    for cov in coverages:
        reached.update((cov or {}).get("hit_names") or [])
    missing = set(corrections) - reached
    if missing:
        raise SystemExit(
            "affix type correction(s) reached no record in any channel: "
            + ", ".join(sorted(repr(m) for m in missing))
            + " — renamed or dropped upstream; re-verify against the wiki")
