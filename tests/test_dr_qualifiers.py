"""#223 — the DR qualifier split at the planner-record seam.

The defect: a bypass qualifier stored in the bonus-type field gave every
qualifier its own additive bucket, so ranking DR summed to totals the game
never grants (reproduced at 45 against real HiGHS). The ruling
(docs/wiki-evidence/damage-reduction-stacking.md) forbids both the sum and a
naive max across qualifiers.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import dr_qualifiers as dr  # noqa: E402


def _raises(exc, fn, *args, **kwargs):
    try:
        fn(*args, **kwargs)
    except exc as e:
        return e
    raise AssertionError(f"expected {exc.__name__}, nothing raised")


def _rec(name, *affixes):
    return {"name": name, "affixes": [dict(a) for a in affixes]}


def _dr(qualifier, value):
    return {"name": "DR", "type": qualifier, "value": str(value)}


def test_unconditional_dr_is_untouched():
    rec = _rec("Epic Golden Greaves", _dr("-", 15))
    stats = dr.apply([rec])
    (affix,) = rec["affixes"]
    assert affix == {"name": "DR", "type": "-", "value": "15"}
    assert stats["kept_numeric"] == 1
    assert stats["material_receipts"] == 0
    assert stats["demoted_presence"] == 0


def test_material_dr_joins_the_unconditional_bucket_with_a_receipt():
    rec = _rec("Berserker Bracers", _dr("Adamantine", 5))
    stats = dr.apply([rec])
    (affix,) = rec["affixes"]
    # Retyped into the shared bucket, so two unconditional sources take a max...
    assert affix["type"] == "-"
    assert affix["value"] == "5"
    # ...while the receipt still names the engraved enchantment.
    assert affix["via"] == "DR 5/Adamantine"
    assert stats["kept_numeric"] == 1
    assert stats["material_receipts"] == 1


def test_conditional_dr_demotes_to_a_named_presence_affix():
    rec = _rec("Garzad's Helm", _dr("Good", 10))
    stats = dr.apply([rec])
    (affix,) = rec["affixes"]
    # The magnitude is not comparable without naming the attacker, so it stops
    # being a number: presence, named for the full enchantment.
    assert affix["name"] == "DR 10/Good"
    assert affix["type"] == "Bool"
    assert affix["value"] == 1
    assert stats["demoted_presence"] == 1
    assert stats["demoted_names"] == ["DR 10/Good"]


def test_epic_dr_is_conditional():
    # The sharpest case in the ruling: reporting DR 15/Epic as a flat 15 would
    # over-claim to exactly the player fighting the epic bosses that bypass it.
    rec = _rec("Epic Blademark's Docent", _dr("Epic", 15))
    dr.apply([rec])
    (affix,) = rec["affixes"]
    assert affix["name"] == "DR 15/Epic"
    assert affix["type"] == "Bool"


def test_the_issue_223_reproduction_no_longer_sums():
    """The four-item repro from #223: 15/- + 15/Epic + 10/Good + 5/Adamantine
    reported 45. After the split, the numeric buckets can only yield 15."""
    records = [
        _rec("Epic Golden Greaves", _dr("-", 15)),
        _rec("Epic Blademark's Docent", _dr("Epic", 15)),
        _rec("Garzad's Helm", _dr("Good", 10)),
        _rec("Berserker Bracers", _dr("Adamantine", 5)),
    ]
    dr.apply(records)
    numeric = [a for r in records for a in r["affixes"] if a["name"] == "DR"]
    # Every surviving numeric DR shares ONE bucket key (stat, type) — the
    # solver's same-bucket rule is max, so the reportable total is 15, not 45.
    assert {a["type"] for a in numeric} == {"-"}
    assert max(int(a["value"]) for a in numeric) == 15
    assert sum(1 for a in numeric) == 2  # `-` and Adamantine; Epic/Good demoted


def test_unclassified_qualifier_fails_the_build():
    rec = _rec("Future Item", _dr("Chitin", 10))
    err = _raises(SystemExit, dr.apply, [rec])
    assert "Chitin" in str(err)


def test_a_sweep_that_touches_nothing_refuses_to_pass():
    _raises(ValueError, dr.apply,
            [_rec("No DR Here", {"name": "Strength", "type": "Enhancement",
                                 "value": "8"})])


def test_non_dr_affixes_pass_through_untouched():
    rec = _rec("Mixed Item",
               {"name": "Strength", "type": "Enhancement", "value": "8"},
               _dr("Lawful", 5))
    dr.apply([rec])
    strength = rec["affixes"][0]
    assert strength == {"name": "Strength", "type": "Enhancement", "value": "8"}
