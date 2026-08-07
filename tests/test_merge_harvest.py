"""U1 — harvest driver + provenance model (issues #154, #162).

The wiki harvest runs in the browser; this is the repo-side half that turns a raw
dump into a seed shard. Two properties carry the weight:

  * PROVENANCE. Every value records whether the wiki STATED it or fell back to a
    template default. `Template:Speed` says outright that its attack-speed values
    are hand-maintained and unrecorded magnitudes silently render 5%, so a value
    we cannot distinguish from that default must never reach the solver.
  * IDEMPOTENT, DELTA-AWARE MERGE. A re-import must surface only genuinely new
    items, and must never silently overwrite a harvested value with a different
    one — a contradiction is a review event, not a merge.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import harvest  # noqa: E402


ROSTER = {"Item:Ash Boots", "Item:Brazenband", "Item:Cape of the Roc",
          "Item:Goatskin Boots (level 19)", "Item:Belt of the Ram"}

TODAY = "2026-08-07"


def _empty():
    return harvest.new_shard("speed_enchantment")


def _dump(**records):
    return records


def test_merge_adds_new_records_with_provenance_and_date():
    shard = _empty()
    stats = harvest.merge(shard, _dump(**{
        "Item:Ash Boots": {"value": {"movement": 30}, "provenance": "stated", "raw": "{{Striding|30}}"},
        "Item:Brazenband": {"value": {"movement": 30, "alacrity": 7}, "provenance": "stated", "raw": "{{Speed|VII}}"},
    }), ROSTER, today=TODAY)

    assert stats["added"] == 2, stats
    assert set(shard["harvested"]) == {"Item:Ash Boots", "Item:Brazenband"}
    for rec in shard["harvested"].values():
        assert rec["provenance"] == "stated"
        assert rec["harvested"] == TODAY
        assert rec["raw"]


def test_remerging_the_same_dump_is_a_noop():
    """Idempotent: no duplicates and no harvest-date churn on a repeat run."""
    shard = _empty()
    dump = _dump(**{"Item:Ash Boots": {"value": {"movement": 30},
                                       "provenance": "stated", "raw": "{{Striding|30}}"}})
    harvest.merge(shard, dump, ROSTER, today=TODAY)
    stats = harvest.merge(shard, dump, ROSTER, today="2026-09-01")

    assert stats["added"] == 0 and stats["unchanged"] == 1, stats
    assert shard["harvested"]["Item:Ash Boots"]["harvested"] == TODAY, \
        "a no-op re-merge must not churn the harvest date"


def test_contradicting_record_raises_rather_than_overwriting():
    shard = _empty()
    harvest.merge(shard, _dump(**{"Item:Ash Boots": {
        "value": {"movement": 30}, "provenance": "stated", "raw": "{{Striding|30}}"}}),
        ROSTER, today=TODAY)
    try:
        harvest.merge(shard, _dump(**{"Item:Ash Boots": {
            "value": {"movement": 15}, "provenance": "stated", "raw": "{{Striding|15}}"}}),
            ROSTER, today=TODAY)
    except harvest.HarvestError as exc:
        assert "Ash Boots" in str(exc), exc
    else:
        raise AssertionError("a contradicting value must raise, not overwrite")


def test_record_missing_provenance_is_rejected():
    shard = _empty()
    try:
        harvest.merge(shard, _dump(**{"Item:Ash Boots": {"value": {"movement": 30}}}),
                      ROSTER, today=TODAY)
    except harvest.HarvestError as exc:
        assert "provenance" in str(exc), exc
    else:
        raise AssertionError("a record with no provenance must be rejected")


def test_unknown_provenance_value_is_rejected():
    shard = _empty()
    try:
        harvest.merge(shard, _dump(**{"Item:Ash Boots": {
            "value": {"movement": 30}, "provenance": "probably"}}), ROSTER, today=TODAY)
    except harvest.HarvestError as exc:
        assert "probably" in str(exc), exc
    else:
        raise AssertionError("an unrecognized provenance value must be rejected")


def test_stated_provenance_requires_a_value():
    """`stated` asserts the wiki said it — an empty value contradicts the claim."""
    shard = _empty()
    try:
        harvest.merge(shard, _dump(**{"Item:Ash Boots": {
            "value": None, "provenance": "stated"}}), ROSTER, today=TODAY)
    except harvest.HarvestError as exc:
        assert "stated" in str(exc), exc
    else:
        raise AssertionError("stated provenance with no value must be rejected")


def test_defaulted_and_unsourced_records_may_carry_no_value():
    """Both are the exclude-until-verified outcomes: recorded, but never solver-fed."""
    shard = _empty()
    stats = harvest.merge(shard, _dump(**{
        "Item:Cape of the Roc": {"value": None, "provenance": "defaulted",
                                 "raw": "{{Speed|21}}"},
        "Item:Belt of the Ram": {"value": None, "provenance": "unsourced"},
    }), ROSTER, today=TODAY)

    assert stats["added"] == 2, stats
    assert harvest.solver_eligible(shard["harvested"]["Item:Cape of the Roc"]) is False
    assert harvest.solver_eligible(shard["harvested"]["Item:Belt of the Ram"]) is False


def test_dump_title_absent_from_the_roster_is_ignored():
    shard = _empty()
    stats = harvest.merge(shard, _dump(**{
        "Item:Ash Boots": {"value": {"movement": 30}, "provenance": "stated", "raw": "x"},
        "Item:Not In Our Roster": {"value": {"movement": 5}, "provenance": "stated", "raw": "y"},
    }), ROSTER, today=TODAY)

    assert stats["added"] == 1 and stats["off_roster"] == 1, stats
    assert "Item:Not In Our Roster" not in shard["harvested"]


def test_missing_only_lists_the_unharvested_roster_titles():
    """The delta list is the harvest work order — and what makes a re-import cheap."""
    shard = _empty()
    harvest.merge(shard, _dump(**{
        "Item:Ash Boots": {"value": {"movement": 30}, "provenance": "stated", "raw": "x"},
        "Item:Brazenband": {"value": {"movement": 30}, "provenance": "stated", "raw": "y"},
    }), ROSTER, today=TODAY)

    missing = harvest.missing_titles(shard, ROSTER)
    assert missing == sorted(ROSTER - {"Item:Ash Boots", "Item:Brazenband"}), missing
    assert len(missing) == 3


def test_coverage_counts_split_by_provenance():
    """Coverage is what `metadata` discloses, so results can say what was considered."""
    shard = _empty()
    harvest.merge(shard, _dump(**{
        "Item:Ash Boots": {"value": {"movement": 30}, "provenance": "stated", "raw": "x"},
        "Item:Cape of the Roc": {"value": None, "provenance": "defaulted", "raw": "y"},
        "Item:Belt of the Ram": {"value": None, "provenance": "unsourced"},
    }), ROSTER, today=TODAY)

    cov = harvest.coverage(shard, ROSTER)
    assert cov == {"stated": 1, "defaulted": 1, "unsourced": 1, "missing": 2, "roster": 5}, cov
