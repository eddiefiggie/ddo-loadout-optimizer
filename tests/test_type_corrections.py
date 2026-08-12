"""#259 — wiki-sourced bonus-type corrections and their stale guards.

Same safety argument as its #207 sibling: the guards are what make the
mechanism safe to have. A type correction that silently pins over a moved
source — or silently reaches nothing after an upstream rename — recreates the
staleness it exists to fix. These tests prove every guard fires.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import type_corrections  # noqa: E402

SHARD = os.path.join(ROOT, "data", "seed", "compendium", "affix_type_corrections.json")


def _rec(name, affixes):
    return {"name": name, "affixes": affixes}


def _corr(name="Action Boost Charges", frm="Untyped", to="Enhancement", value="3"):
    return {"name": name, "from": frm, "to": to, "value": value}


def _moment(type_="Untyped", value="3"):
    return _rec("Legendary Moment to Legendary Moment",
                [{"name": "Action Boost Charges", "type": type_, "value": value}])


def test_a_matching_correction_overwrites_the_type_and_only_the_type():
    records = [_moment()]
    cov = type_corrections.apply(
        records, {"Legendary Moment to Legendary Moment": [_corr()]})
    (affix,) = records[0]["affixes"]
    assert affix["type"] == "Enhancement"
    assert affix["value"] == "3"          # the magnitude is not this module's field
    assert affix["name"] == "Action Boost Charges"
    assert cov["records_corrected"] == 1
    assert cov["types_changed"] == 1


def test_an_affix_already_carrying_another_type_is_not_swept_up():
    # An Enhancement-typed sibling is a different stacking bucket; correcting it
    # from `Untyped` must not touch it.
    records = [_moment(type_="Enhancement")]
    try:
        type_corrections.apply(
            records, {"Legendary Moment to Legendary Moment": [_corr()]})
    except SystemExit:
        pass          # correct: no Untyped affix left to correct — upstream moved
    assert records[0]["affixes"][0]["type"] == "Enhancement"


def test_a_stale_from_type_fails_the_build():
    """Upstream already retyped the affix; reapplying on faith must fail."""
    records = [_moment(type_="Insight")]
    try:
        type_corrections.apply(
            records, {"Legendary Moment to Legendary Moment": [_corr()]})
    except SystemExit as e:
        assert "re-verify" in str(e), str(e)
        assert records[0]["affixes"][0]["type"] == "Insight", \
            "nothing may be written on a stale entry"
        return
    raise AssertionError("a stale `from` type must fail the build")


def test_a_moved_value_fails_the_build():
    """The value binds the entry to the tooltip that proved it. A different
    magnitude upstream means the record is no longer the one verified."""
    records = [_moment(value="5")]
    try:
        type_corrections.apply(
            records, {"Legendary Moment to Legendary Moment": [_corr(value="3")]})
    except SystemExit as e:
        assert "re-verify" in str(e), str(e)
        assert records[0]["affixes"][0]["type"] == "Untyped"
        return
    raise AssertionError("a moved value must fail the build, not retype on faith")


def test_a_record_absent_from_this_channel_is_a_silent_no_op():
    # The entry may live in the other channel (item vs augment pool).
    records = [_rec("Other", [{"name": "Wizardry", "type": "Insight", "value": "10"}])]
    cov = type_corrections.apply(
        records, {"Legendary Moment to Legendary Moment": [_corr()]})
    assert cov["records_corrected"] == 0
    assert cov["types_changed"] == 0


def test_an_entry_reaching_no_channel_fails_the_build():
    """The cross-channel guard: a renamed record upstream must not turn the
    correction into a silent no-op everywhere."""
    corrections = {"Legendary Moment to Legendary Moment": [_corr()]}
    empty = type_corrections.apply([], corrections)
    try:
        type_corrections.assert_all_reached(corrections, empty, empty)
    except SystemExit as e:
        assert "no record in any channel" in str(e), str(e)
        return
    raise AssertionError("an unreached entry must fail the build")


def test_all_reached_passes_when_any_channel_carries_the_record():
    corrections = {"Legendary Moment to Legendary Moment": [_corr()]}
    items_cov = type_corrections.apply([], corrections)          # silent no-op
    augments_cov = type_corrections.apply([_moment()], corrections)
    type_corrections.assert_all_reached(corrections, items_cov, augments_cov)


def test_missing_shard_file_yields_no_corrections():
    assert type_corrections.load(os.path.join(ROOT, "does", "not", "exist.json")) == {}


def test_the_shipped_shard_carries_its_wiki_evidence():
    """Every correction states the rendered tooltip it came from, and the
    tooltip must state the corrected type — evidence, not assertion."""
    with open(SHARD, encoding="utf-8") as fh:
        raw = json.load(fh)
    entries_seen = 0
    for record, entries in raw.items():
        if str(record).startswith("_"):
            continue
        for e in entries:
            entries_seen += 1
            for field in ("name", "from", "to", "value", "tooltip", "wiki_url",
                          "verified"):
                assert e.get(field), f"{record}: correction is missing {field!r}"
            assert str(e["to"]) in e["tooltip"], (
                f"{record}: the corrected type {e['to']!r} does not appear in the "
                f"recorded tooltip — the evidence does not support it")
            assert str(e["value"]) in e["tooltip"], (
                f"{record}: the binding value {e['value']!r} does not appear in "
                f"the recorded tooltip")
    assert entries_seen >= 2, "the shipped shard lost its Moment to Moment entries"


def test_the_moment_corrections_are_the_ones_we_verified():
    loaded = type_corrections.load(SHARD)
    legendary = loaded["Legendary Moment to Legendary Moment"][0]
    assert (legendary["name"], legendary["from"], legendary["to"],
            legendary["value"]) == ("Action Boost Charges", "Untyped",
                                    "Enhancement", "3")
    heroic = loaded["Moment to Moment"][0]
    assert (heroic["from"], heroic["to"], heroic["value"]) == (
        "Untyped", "Enhancement", "1")
