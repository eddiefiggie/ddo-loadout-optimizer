"""#207 — wiki-sourced corrections to a gear-planner affix VALUE.

gear-planner is the single source of truth for *which* affixes an item has, read
structurally. The DDO Wiki is the source of truth for the *value*. When they
disagree and the wiki's rendered tooltip is unambiguous, the wiki wins.

This is a second, narrower exception to gear-planner sole-authority than
`gap_corrections`, and it is deliberately a separate mechanism rather than a
widening of that one. `gap_corrections` is ADDITIVE: it appends affixes
gear-planner is missing and SKIPS any `(name, type)` the item already carries, so
that removed Insightful/Insight double-counts can never creep back. Teaching it to
overwrite would put that guard at risk for the sake of one value. This module
overwrites and nothing else does.

**The stale guard is the point.** Each entry records `from` — the value
gear-planner carries today — and the build FAILS when it no longer matches. The
alternative is a correction that silently pins a number over a source that has
since changed, which is how the value being corrected here went wrong in the
first place. A correction file that cannot go stale unnoticed is the only kind
worth having.
"""
from __future__ import annotations

import json
import os


def load(path: str) -> dict:
    """`{item_name: [correction, …]}` with `_*` meta keys stripped.

    A missing file yields `{}` — the overlay is optional and the build stays
    deterministic without it.
    """
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)
    return {k: v for k, v in raw.items() if not str(k).startswith("_")}


def apply(records: list, corrections: dict) -> dict:
    """Overwrite corrected affix values in place. Returns a coverage dict.

    Raises `SystemExit` when an entry's `from` no longer matches what the record
    carries, or when it targets an affix the record does not have. Both mean the
    upstream data moved and the correction must be re-verified against the wiki
    rather than reapplied on faith.

    An entry naming an item absent from the roster is a silent no-op — the roster
    varies with the harvest, and a correction waiting for an item to reappear is
    not an error.
    """
    by_name = {}
    for r in records:
        by_name.setdefault(r.get("name"), r)   # first wins, matching loader dedup

    problems = []
    items_corrected = 0
    values_changed = 0

    for item_name in sorted(corrections):
        rec = by_name.get(item_name)
        if rec is None:
            continue
        affixes = rec.get("affixes") or []
        touched = False
        for corr in corrections[item_name]:
            key = (corr.get("name"), corr.get("type"))
            matches = [a for a in affixes
                       if (a.get("name"), a.get("type")) == key]
            if not matches:
                problems.append(
                    f"{item_name}: no {key[0]!r}/{key[1]!r} affix to correct — "
                    "gear-planner's parse changed; re-verify against the wiki")
                continue
            for a in matches:
                current = str(a.get("value"))
                expected = str(corr.get("from"))
                if current != expected:
                    problems.append(
                        f"{item_name}: {key[0]!r}/{key[1]!r} now reads {current!r} "
                        f"upstream, but the correction was recorded against "
                        f"{expected!r} — re-verify against the wiki before "
                        "reapplying")
                    continue
                a["value"] = str(corr.get("to"))
                values_changed += 1
                touched = True
        if touched:
            items_corrected += 1

    if problems:
        raise SystemExit(
            "item value corrections are stale — the upstream data moved:\n  "
            + "\n  ".join(problems))

    return {"items_corrected": items_corrected, "values_changed": values_changed}
