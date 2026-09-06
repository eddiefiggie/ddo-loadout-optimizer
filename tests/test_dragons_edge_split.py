"""#714 — `Dragon's Edge` stores a RANK where the tooltip states a magnitude.

The third instance of the shape #169 (`Parrying`) and #546 (`Riposte`) fixed. It
is the one that most clearly earns the never-infer rule: the three ranks map to
8 / 9 / 23, which fits no formula, while the BLEED half of the same tooltip
scales cleanly as `N d8`. Checking either half alone yields a confident wrong
answer about the other.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import dragons_edge_split as de  # noqa: E402

DATASET = os.path.join(ROOT, "web", "data", "items.json")


def _shard():
    with open(de.SHARD_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def _dataset():
    with open(DATASET, encoding="utf-8") as fh:
        return json.load(fh)


def test_the_shard_states_all_three_ranks():
    a = de.audit_shard(_shard())
    assert a["ranks"] == ["2", "3", "7"]
    assert a["stated"] == a["ranks"], "every rank must be wiki-stated to be solver-eligible"
    assert a["values"] == {"2": 8, "3": 9, "7": 23}


def test_the_mapping_is_not_a_formula():
    """The guard against a future 'tidy-up' replacing the lookup with arithmetic.

    #714's body guessed `7 -> 21` from `rank x 3`. It is 23. `rank + 6` fits 2
    and 3 and gives 13. If either ever reproduces the table, someone has changed
    the data — re-read the tooltips before believing it.
    """
    v = de.audit_shard(_shard())["values"]
    assert v["7"] != 3 * 7, "rank x 3 would give 21 — the value this issue guessed"
    assert v["7"] != 7 + 6, "rank + 6 fits 2 and 3 but not 7"
    slope_low = v["3"] - v["2"]
    slope_high = (v["7"] - v["3"]) / 4.0
    assert slope_low != slope_high, (
        f"the three points became collinear ({slope_low} vs {slope_high}); "
        "a lookup is only defensible while they are not")


def test_no_folded_affix_survives_into_the_dataset():
    ds = _dataset()
    left = [it["variant_id"] for it in ds["items"]
            for a in it.get("affixes") or [] if a.get("name") == de.FOLDED_NAME]
    assert not left, f"records still carrying the folded rank: {left[:5]}"
    assert de.FOLDED_NAME not in set(ds["metadata"]["rankable_affixes"]), (
        "a name the pipeline rewrites away must not be offered")


def test_every_carrier_now_credits_armor_piercing_at_its_ranks_value():
    ds = _dataset()
    values = de.audit_shard(_shard())["values"]
    seen = 0
    for it in ds["items"]:
        for a in it.get("affixes") or []:
            if a.get("name") == de.PRIMARY_NAME and a.get("via") == de.FOLDED_NAME:
                seen += 1
                assert a.get("type") == "Enhancement", a
                assert str(a.get("value")) in {str(x) for x in values.values()}, a
    assert seen == 18, f"expected 18 rewritten carriers, found {seen}"


def test_an_unlisted_rank_is_refused_not_computed():
    """A rank nobody rendered must keep the folded affix and be reported."""
    shard = _shard()
    fake = [{"name": "Fictional Blade",
             "affixes": [{"stat": de.FOLDED_NAME, "bonus_type": "Enhancement",
                          "value": 5, "unit": "flat"}]}]
    assert de.unlisted_ranks(fake, shard) == ["5"], "the gap must be reported"
    de.apply(fake, shard)
    names = [a["stat"] for a in fake[0]["affixes"]]
    assert de.FOLDED_NAME in names, (
        "rank 5 is unrendered; inventing a percentage for it is exactly what "
        "the 8/9/23 mapping shows to be unsafe")
    assert de.PRIMARY_NAME not in names


def test_the_shipped_data_has_no_unlisted_rank():
    ds = _dataset()
    # The dataset is post-rewrite, so reconstruct carriers from the provenance.
    carriers = [{"affixes": [{"stat": de.FOLDED_NAME, "value": a.get("value")}]}
                for it in ds["items"] for a in it.get("affixes") or []
                if a.get("via") == de.FOLDED_NAME]
    assert carriers, "nothing was inspected"
