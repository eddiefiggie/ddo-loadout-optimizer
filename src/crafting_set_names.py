"""#769 — wiki-sourced corrections to a SET NAME inside a gear-planner crafting pool.

A `set`-bearing crafting option names the set a host may join; the set catalog
defines what that set grants. The two are different upstream files, and they can
disagree about the spelling of the same set. When they do, `membership` drops the
unmatched name and discloses it rather than mapping one onto the other — correct,
and it leaves the set unreachable. This module is where that disagreement is
settled, once, from the wiki.

This is the pool-level sibling of `name_corrections` (which renames an affix) and
deliberately separate. An affix correction rewrites `a["name"]` on every affix
dict in the roster; this rewrites the `set` field of a crafting option, which
`name_corrections._iter_affix_dicts` cannot even see — it walks `affixes` lists,
and a Set Bonus option has no affixes at all.

APPLIED AT `crafting_catalog.load_catalog`, the single load point, for the reason
#631 records there: the catalog is loaded by both the main build and the
referential-integrity check, and an overlay applied at one call site leaves the
other reading a different catalog.

**Corrective, not additive** — and that is the difference from `augment_tier_gap`,
which may only fill a hole upstream leaves. A rename by definition overwrites, so
the safety property has to come from somewhere else: every entry must cite the
wiki page that states the name, and both directions of staleness fail the build.

## Why a rename and never an alias

Aliasing the two spellings would assert they are the same set without saying which
one the game uses — and the app would still have to pick one to render. The wiki
states a name; this mints that name at the source and the disagreement is gone.
`src/membership.py` then resolves it like any other, with no special case.

## The two guards, and the defect each one catches

- **The source spelling must still be in the pool.** When upstream fixes its own
  data, this correction becomes a silent no-op pinning a rename nobody applies,
  and the entry should be deleted rather than left to rot. Failing loudly is what
  makes that a review event instead of a discovery years later.
- **The canonical spelling must NOT already be in the pool.** If upstream adopts
  the wiki's name while this entry still stands, renaming on top of it would
  collapse two options into one and silently shrink the pool a host may choose
  from. A pool that quietly loses a member is exactly the bug #769 reported.

Both mean the upstream data moved, and both demand a human re-read the wiki rather
than reapply the rename on faith.
"""
from __future__ import annotations

import json
import os

SHARD_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "seed",
                          "compendium", "crafting_set_name_corrections.json")


def load(path: str = SHARD_PATH) -> list:
    """The `corrections` list, or `[]` when the shard is absent (it is optional)."""
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)
    if not isinstance(raw, dict):
        return []
    return [c for c in (raw.get("corrections") or []) if isinstance(c, dict)]


def apply(crafting: dict, corrections: list) -> dict:
    """Rename corrected set names inside their crafting pools, in place.

    Returns a coverage dict `{renamed, pools, hit}`. Raises `SystemExit` when a
    correction cites no evidence, when its pool is missing or not a menu, when its
    source spelling is gone from that pool, or when its canonical spelling is
    already there.
    """
    if not corrections:
        return {"renamed": 0, "pools": [], "hit": []}

    # A rename must not inspect zero pools. An empty catalog would let every
    # correction report "source absent" and fail for the wrong reason, which reads
    # as staleness when the real fault is that nothing was loaded at all.
    if not crafting:
        raise SystemExit(
            "crafting set-name corrections cannot be applied to an empty catalog")

    problems = []
    renamed = 0
    pools_touched = set()
    hit = []

    for corr in corrections:
        pool_key = corr.get("pool")
        source = corr.get("source_set")
        canonical = corr.get("canonical_set")

        if not pool_key or not source or not canonical:
            problems.append(
                f"malformed correction {corr!r}: pool, source_set and "
                "canonical_set are all required")
            continue

        # An unsourced rename is the exact inference this repo does not make, so
        # the evidence is a hard requirement rather than a documentation habit.
        # `Slave's Endurance` LOOKED like the wrong side right up until the page
        # was read (#769): two of three sets agree on `Slave Lord's` across both
        # files, so the pattern argued for renaming the catalog, and the wiki said
        # the opposite. A correction that cannot show its page is a guess.
        if not (corr.get("wiki_url") and corr.get("verified") and corr.get("evidence")):
            problems.append(
                f"{source!r} -> {canonical!r} cites no wiki_url/verified/evidence — "
                "a set rename without the page that states the name is an inference, "
                "not a correction")
            continue

        pool = (crafting or {}).get(pool_key)
        if not isinstance(pool, dict) or not isinstance(pool.get("*"), list):
            problems.append(
                f"{source!r}: pool {pool_key!r} is missing or is not a menu pool")
            continue

        options = pool["*"]
        names = [o.get("set") for o in options if isinstance(o, dict)]

        if source not in names:
            problems.append(
                f"{source!r} is no longer in {pool_key!r} — upstream has changed or "
                "adopted the name, so this rename is a silent no-op. Re-read the wiki "
                "and delete the entry rather than pinning a rename nobody applies.")
            continue

        if canonical in names:
            problems.append(
                f"{canonical!r} is already in {pool_key!r} upstream — renaming "
                f"{source!r} onto it would collapse two options into one and shrink "
                "the pool a host may choose from. Upstream has adopted the wiki's "
                "name; delete the entry.")
            continue

        for opt in options:
            if isinstance(opt, dict) and opt.get("set") == source:
                opt["set"] = canonical
                renamed += 1
        pools_touched.add(pool_key)
        hit.append(source)

    if problems:
        raise SystemExit(
            "crafting set-name corrections are stale — the upstream data moved:\n  "
            + "\n  ".join(problems))

    return {"renamed": renamed, "pools": sorted(pools_touched), "hit": sorted(hit)}
