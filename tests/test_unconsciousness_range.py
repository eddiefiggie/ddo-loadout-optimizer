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
#: #649 — the canonical is the MECHANIC's name, not any one enchantment's. It was
#: `Undying` until then, which is the name of one of the four sources feeding the
#: stat; a priority list reading "Undying 225" beside an item card reading
#: "Weighty Asset" is what prompted the maintainer to ask what the two had to do
#: with each other. `Unconsciousness Range` is the wiki's own phrase for the
#: section that groups them and belongs to none of them.
CANON = "Unconsciousness Range"
#: Every engraved name that now folds into it — `Undying` included, which is the
#: change #649 made.
ENGRAVED = {"Undying", "Weighty Asset", "Holding On"}


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


def test_every_record_names_the_enchantment_it_is_actually_engraved_with():
    """No record scoring this stat may be silent about which enchantment it is.

    This inverts what it asserted before #649, and the inversion IS the change.
    While the canonical was `Undying`, the 14 records engraved "Undying" carried
    no `via` and correctly so — the name on the card was the canonical, and
    stamping provenance onto records the merge had not moved would have made them
    claim an engraving they did not have.

    Now the canonical is a mechanic name no item bears, so the situation reverses:
    a record with no `via` is one whose card cannot say what the player is
    actually wearing. Every one must carry a receipt, and every receipt must name
    a real enchantment rather than the canonical echoing itself.
    """
    if not os.path.exists(DATASET):
        return
    rows = [(n, a) for n, a in _records() if a.get("name") == CANON]
    assert len(rows) >= 15, f"only {len(rows)} {CANON} records — the guard inspects a real population"
    silent = [n for n, a in rows if not a.get("via")]
    assert not silent, (
        f"{len(silent)} record(s) score {CANON} while naming no enchantment: {silent[:6]}. "
        "The canonical is a mechanic, not a name any item is engraved with, so a "
        "missing `via` leaves the card unable to say what the player is wearing.")
    stray = sorted({a["via"] for _, a in rows} - ENGRAVED)
    assert not stray, f"receipts naming something that is not one of the merged enchantments: {stray}"


def test_the_augment_channel_keeps_its_receipt_too():
    """`Undying Sapphire`'s receipt survives the augment rebuild.

    Its own regression test because it did NOT survive at first, and nothing
    caught it: `crafting_catalog.augment_pool_records` rebuilds each augment's
    affixes through a whitelist, the crafting channel has already renamed them by
    then, and the augment name-correction pass that runs later can no longer match
    the name it would need to re-stamp. The receipt was destroyed silently between
    two passes that were each individually correct.
    """
    if not os.path.exists(DATASET):
        return
    with open(DATASET, encoding="utf-8") as fh:
        d = json.load(fh)
    sapphires = [it for it in d.get("items", [])
                 if "Undying Sapphire" in (it.get("variant_id") or "")]
    assert len(sapphires) == 2, [it.get("variant_id") for it in sapphires]
    for it in sapphires:
        for a in it.get("affixes") or []:
            assert a.get("name") == CANON, (it["variant_id"], a.get("name"))
            assert a.get("via") == "Undying", (
                f"{it['variant_id']} lost its engraved name in the augment rebuild")
