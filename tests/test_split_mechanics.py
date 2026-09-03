"""#683 — DISCLOSED name splits and the population guard that keeps them honest.

The shard holds a family the repo has deliberately NOT resolved: one wiki mechanic
under two spellings, where one wiki page says the sources stack and another types
them so they cannot. The disclosure quotes real set counts to the player, so the
guard's whole job is to fail when those counts move. These tests prove it fires,
in each direction it can rot, and that the shard carries nothing the solver reads.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import split_mechanics  # noqa: E402

SHARD = os.path.join(ROOT, "data", "seed", "compendium",
                     "split_mechanic_disclosures.json")
DATASET = os.path.join(ROOT, "web", "data", "items.json")


def _entry(**over):
    e = {
        "mechanic": "M",
        "spellings": ["A", "B"],
        "one_mechanic_evidence": "wiki names both under one heading",
        "contested_stacking": "one page says stack, another types them the same",
        "contested_summary": "the two pages disagree",
        "wiki_url": "https://ddowiki.com/page/X",
        "expected_sets": {"ch": {"A": 2, "B": 3}},
    }
    e.update(over)
    return e


def _raises(fn, *args, **kwargs):
    try:
        fn(*args, **kwargs)
    except SystemExit as e:
        return str(e)
    raise AssertionError("expected SystemExit, nothing raised")


# ------------------------------------------------------------------- measure

def test_measure_counts_distinct_sets_not_occurrences():
    """A set grants its tier bonus on every piece. Counting occurrences would
    report a two-piece set as two sources and overstate what the notice quotes."""
    pairs = [("A", "SetOne"), ("A", "SetOne"), ("A", "SetOne"), ("A", "SetTwo")]
    got = split_mechanics.measure(["A"], {"ch": pairs})
    assert got == {"ch": {"A": 2}}, got


def test_measure_reports_zero_for_a_spelling_absent_from_a_channel():
    """The zero is the point: a declared 0 asserts absence, so a refresh that
    starts emitting the spelling there trips the guard."""
    got = split_mechanics.measure(["A", "B"], {"ch": [("A", "S")]})
    assert got == {"ch": {"A": 1, "B": 0}}, got


# --------------------------------------------------------------------- guard

def test_guard_fires_when_a_declared_count_drifts():
    measured = {"ch": {"A": 4, "B": 3}}
    err = _raises(split_mechanics.assert_population, [_entry()], measured, inspected=10)
    assert "now reaches 4" in err and "declared 2" in err, err


def test_guard_fires_when_a_channel_declared_empty_starts_emitting():
    measured = {"ch": {"A": 2, "B": 3}, "other": {"A": 1, "B": 0}}
    entry = _entry(expected_sets={"ch": {"A": 2, "B": 3}, "other": {"A": 0, "B": 0}})
    err = _raises(split_mechanics.assert_population, [entry], measured, inspected=10)
    assert "now reaches 1" in err and "other" in err, err


def test_guard_fires_when_a_declared_channel_was_never_measured():
    """Declaring a count for a channel nobody measured is an unchecked claim, which
    is exactly the shape the guard exists to refuse."""
    err = _raises(split_mechanics.assert_population, [_entry()], {}, inspected=10)
    assert "was not measured" in err, err


def test_guard_refuses_to_inspect_zero_records():
    """A guard that inspects nothing would report every declared count as drift to
    zero and fail for the wrong reason — or pass vacuously if ever inverted."""
    err = _raises(split_mechanics.assert_population, [_entry()],
                  {"ch": {"A": 2, "B": 3}}, inspected=0)
    assert "empty record set" in err, err


def test_guard_requires_both_halves_of_the_evidence():
    for field in ("one_mechanic_evidence", "contested_stacking",
                  "contested_summary", "wiki_url"):
        err = _raises(split_mechanics.assert_population, [_entry(**{field: ""})],
                      {"ch": {"A": 2, "B": 3}}, inspected=10)
        assert field in err, (field, err)


def test_guard_refuses_a_family_of_one_spelling():
    err = _raises(split_mechanics.assert_population, [_entry(spellings=["A"])],
                  {"ch": {"A": 2}}, inspected=10)
    assert "at least two" in err, err


def test_guard_refuses_an_entry_declaring_no_population():
    err = _raises(split_mechanics.assert_population, [_entry(expected_sets={})],
                  {"ch": {"A": 2, "B": 3}}, inspected=10)
    assert "no expected_sets" in err, err


def test_a_matching_population_passes():
    split_mechanics.assert_population([_entry()], {"ch": {"A": 2, "B": 3}}, inspected=10)


def test_no_entries_is_a_no_op_even_with_zero_records():
    split_mechanics.assert_population([], {}, inspected=0)


# ------------------------------------------------------- the shipped discipline

def test_the_stamp_carries_no_value_the_solver_could_read():
    """The shard's whole premise is that the stacking axis is UNSETTLED. A value or
    a bonus type reaching the browser payload is how an unsettled question quietly
    becomes a modelled one."""
    stamped = split_mechanics.stamp(
        [_entry(value=1, bonus_type="Artifact")], {"ch": {"A": 2, "B": 3}})
    for fam in stamped:
        assert "value" not in fam, fam
        assert "bonus_type" not in fam, fam


def test_the_shipped_shard_declares_the_dataset_it_actually_has():
    """The counts the player is shown come from the built dataset, so this asserts
    the shard against the real thing rather than against a fixture."""
    if not os.path.exists(DATASET):
        return                                  # dataset is gitignored; CI builds it
    with open(DATASET, encoding="utf-8") as fh:
        d = json.load(fh)
    entries = split_mechanics.load(SHARD)
    assert entries, "the shard lost its entries"
    spellings = [s for e in entries for s in e.get("spellings") or []]
    measured = split_mechanics.measure(spellings, {
        "parsed_set_bonuses": ((a.get("stat"), t.get("set"))
                               for v in d["items"]
                               for t in v.get("parsed_set_bonuses") or []
                               for a in t.get("affixes") or []),
        "membership_set_defs": ((a.get("stat"), n)
                                for n, m in (d.get("membership_set_defs") or {}).items()
                                for t in m.get("tiers") or []
                                for a in t.get("affixes") or []),
    })
    split_mechanics.assert_population(entries, measured, inspected=len(d["items"]))


def test_the_shipped_stamp_reaches_the_dataset_metadata():
    if not os.path.exists(DATASET):
        return
    with open(DATASET, encoding="utf-8") as fh:
        meta = json.load(fh)["metadata"]
    fams = meta.get("split_mechanic_disclosures")
    assert fams, "the disclosure never reached metadata — the notice renders nothing"
    fam = fams[0]
    assert fam["total_sets"] == sum(fam["sets_per_spelling"].values()), fam
    assert len(fam["spellings"]) >= 2, fam
