"""#933 — junk affix names: the narrow match, both affix shapes, the zero-sweep
refusal, and that the built dataset stamps a clean sweep.

The junk is what gear-planner `f202487` shipped while its parse was broken: a
bare dice expression as the whole name (`7d6`) and editor text ending `??`.
Dice inside a longer name are real effects and must keep passing.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import junk_affixes as J  # noqa: E402

ITEMS = os.path.join(ROOT, "web", "data", "items.json")


def _raises(fn, *a, **k):
    try:
        fn(*a, **k)
    except SystemExit as e:
        return str(e)
    raise AssertionError("expected SystemExit, nothing raised")


def _legacy(stat):
    return {"stat": stat, "bonus_type": "boolean", "value": 1, "eligible": True}


def _native(name):
    return {"name": name, "type": "Bool", "value": 1}


def _clean_out():
    """An in-memory dataset: items carry the pipeline's legacy shape, a crafting
    pool carries gear-planner's native shape."""
    return {
        "metadata": {"note": {"name": "7d6", "type": "Bool", "value": 1}},
        "items": [{"variant_id": "Bleeding Edge", "affixes": [
            _legacy("Venomed Ammunition - 1d6"), _legacy("Strength")]}],
        "viktranium": [{"name": "Red Augment Slot", "affixes": [
            _native("On each hit, deals 10d6 extra Law damage to all non-Lawful enemies.")]}],
    }


def test_bare_dice_and_double_question_mark_are_junk():
    for name in ("7d6", "13d10", " 4d4 ", "This is working as intended??"):
        assert J.junk_reason(name), name


def test_dice_inside_a_real_effect_name_is_not_junk():
    # All three ship in today's catalog.
    for name in ("Venomed Ammunition - 1d6", "Burning Ammunition - 1d8",
                 "Additional 2d8 Bane Damage to Fey creatures on hit",
                 "Strength", "d6", "1d", None, 7):
        assert J.junk_reason(name) is None, name


def test_a_clean_dataset_passes_and_counts_every_section_but_metadata():
    stamp = J.check(_clean_out(), min_inspected=1)
    # The metadata note holds a dice name and must not be swept.
    assert stamp == {"inspected": 3, "junk": 0}


def test_junk_in_the_legacy_item_shape_fails():
    out = _clean_out()
    out["items"][0]["affixes"].append(_legacy("7d6"))
    msg = _raises(J.check, out, min_inspected=1)
    assert "items['Bleeding Edge'].affixes[2]: '7d6'" in msg


def test_junk_in_the_native_pool_shape_fails():
    out = _clean_out()
    out["viktranium"][0]["affixes"].append(_native("This is working as intended??"))
    msg = _raises(J.check, out, min_inspected=1)
    assert "viktranium[0].affixes[1]" in msg and "??" in msg


def test_a_sweep_over_too_few_affixes_refuses():
    # Today's shapes renamed: the sweep sees nothing and must not call that clean.
    out = {"items": [{"affixes": [{"label": "7d6", "kind": "Bool"}]}]}
    msg = _raises(J.check, out)
    assert "inspected only 0" in msg


def test_the_built_dataset_stamps_a_clean_sweep():
    with open(ITEMS, encoding="utf-8") as fh:
        stamp = json.load(fh)["metadata"]["junk_affix_coverage"]
    assert stamp["junk"] == 0
    assert stamp["inspected"] >= J.MIN_INSPECTED
