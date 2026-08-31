"""Three enchantments, one stat, one bucket (#632).

The wiki's `Unconscious` page carries a section — "Extending unconsciousness
range" — that lists them together, and that section is the whole ruling:

    * Holding On:      +40 enhancement bonus
    * Undying:         enhancement bonus scaling with level
    * Undying Sapphire: +65 / +225 enhancement bonus
    * Weighty Asset:   +100 enhancement bonus

`Incapacitation range`, which the `Undying` enchantment links, REDIRECTS to that
same page, so the two spellings a reader might think distinguish them are one
mechanic.

## Why the ORDER of the fix mattered

Bucket keys are ``stat||equivType(type)``. `Weighty Asset` and `Holding On`
shipped as `Bool | 1` — invisible, so merely not counted. Recovering their
magnitudes WITHOUT first merging the names would have given three Enhancement
buckets that SUM: a player wearing `Legendary Lolth's Protection` (315) and a
`Weighty Asset` item would have been credited 415 for a game value of 315.

That is strictly worse than the state it replaced, which is why #632 specified
vocabulary first and magnitudes second, and why this file asserts the merge
rather than the magnitudes alone.

## What is asserted, and what deliberately is not

The merge and the shared bucket are asserted. The VALUES are wiki-sourced and
guarded by the two correction shards' own stale checks; re-asserting them here
would pin the same fact twice and drift.
"""
from __future__ import annotations

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET = os.path.join(ROOT, "web", "data", "items.json")

#: The engraved names the merge folds in, and the value each states on the wiki.
MERGED = {"Weighty Asset": "100", "Holding On": "40"}
CANON = "Undying"


def _records():
    with open(DATASET, encoding="utf-8") as fh:
        d = json.load(fh)
    return [(it.get("source_item"), a) for it in d.get("items", [])
            for a in (it.get("affixes") or [])]


def test_the_merged_names_no_longer_exist_as_their_own_stat():
    """A surviving `Weighty Asset` affix is a second bucket, and a second bucket sums."""
    if not os.path.exists(DATASET):
        return
    stray = sorted({n for n, a in _records() if a.get("name") in MERGED})
    assert not stray, (
        f"{sorted(MERGED)} still exist as their own affix name on: {stray}. They "
        "would take their own stacking bucket and ADD to Undying rather than "
        "collapsing against it — the 415-for-315 defect this merge exists to stop.")


def test_every_unconsciousness_source_shares_one_bucket():
    """One stat, one bonus type — so `Sum(z) <= 1` collapses them to the max."""
    if not os.path.exists(DATASET):
        return
    rows = [(n, a) for n, a in _records() if a.get("name") == CANON]
    assert len(rows) >= 15, f"only {len(rows)} {CANON} records — the guard inspects a real population"
    types = sorted({a.get("type") for _, a in rows})
    assert types == ["Enhancement"], (
        f"{CANON} carries {types}; the wiki types every source in the "
        "'Extending unconsciousness range' list as an enhancement bonus, and a "
        "second type here would split the bucket back apart.")


def test_the_merged_records_keep_their_engraved_name():
    """A merge changes which bucket an affix scores in, never what the item says.

    `via` is the established receipt (#205) and every item-centric surface reads
    it, so the card still shows `Weighty Asset` while the solver scores `Undying`.
    Without this the player sees a stat their item does not name.
    """
    if not os.path.exists(DATASET):
        return
    seen = {}
    for n, a in _records():
        if a.get("name") == CANON and a.get("via") in MERGED:
            seen.setdefault(a["via"], []).append((n, str(a.get("value"))))
    for engraved, value in MERGED.items():
        carriers = seen.get(engraved) or []
        assert carriers, (
            f"no record carries `via: {engraved}` — the merge either stopped "
            "reaching it, or stopped preserving the engraved name.")
        for item, got in carriers:
            assert got == value, (
                f"{item}: {engraved} reads {got}, expected {value} from the wiki's "
                "'Extending unconsciousness range' list.")


def test_the_unmerged_sources_are_untouched():
    """The 14 natively-named `Undying` records must carry no `via`.

    A merge that stamped provenance onto records it did not move would make every
    Undying item claim an engraving it does not have.
    """
    if not os.path.exists(DATASET):
        return
    native = [(n, a) for n, a in _records()
              if a.get("name") == CANON and a.get("via") is None]
    assert len(native) >= 12, f"only {len(native)} natively-named {CANON} records"
