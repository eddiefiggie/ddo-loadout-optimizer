"""#260 — the wiki-sourced ML36 augment tier and its guards.

The guards are what make a gap-fill shard safe to have: one that goes stale
silently (upstream adds the tier, a sibling gets re-typed, a tooltip stops
stating the value) recreates the staleness it exists to fix. These tests prove
every guard fires — and that the shipped shard passes them against the real
catalog.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import ml36_augments  # noqa: E402
from src import crafting_catalog  # noqa: E402

SHARD = os.path.join(ROOT, "data", "seed", "compendium", "ml36_augments.json")


def _raises(exc, fn, *args, **kwargs):
    try:
        fn(*args, **kwargs)
    except exc as e:
        return e
    raise AssertionError(f"expected {exc.__name__}, nothing raised")


def _entry(name="Diamond of Strength +15", color="Colorless",
           sibling="Diamond of Strength +14",
           affixes=None, tooltip=None):
    return {name: {
        "color": color, "ml": 36, "sibling": sibling,
        "affixes": affixes or [{"name": "Strength", "type": "Enhancement", "value": "15"}],
        "tooltip": tooltip if tooltip is not None else
            "Drag this augment into a slot to upgrade an item with a +15 "
            "Enhancement Bonus to Strength.",
        "wiki_url": "https://ddowiki.com/page/Item:Diamond_of_Strength_%2B15",
        "verified": "2026-08-12",
    }}


def _catalog(sib_name="Diamond of Strength +14", sib_affixes=None, extra=None):
    pool = [{"name": sib_name, "ml": 32,
             "affixes": sib_affixes or [{"name": "Strength", "type": "Enhancement", "value": "14"}]}]
    if extra:
        pool.extend(extra)
    return {"Colorless Augment Slot": {"*": pool}}


def test_a_clean_entry_passes_and_counts():
    counts = ml36_augments.check(_entry(), _catalog())
    assert counts == {"Colorless": 1}


def test_upstream_adding_the_tier_fails_the_build():
    """The staleness guard: gear-planner catches up -> retire the shard entry."""
    cat = _catalog(extra=[{"name": "Diamond of Strength +15", "ml": 36,
                           "affixes": [{"name": "Strength", "type": "Enhancement", "value": "15"}]}])
    err = _raises(SystemExit, ml36_augments.check, _entry(), cat)
    assert "retire" in str(err)


def test_a_vanished_sibling_fails_the_build():
    err = _raises(SystemExit, ml36_augments.check,
                  _entry(sibling="Diamond of Strength +13"), _catalog())
    assert "anchor is broken" in str(err)


def test_a_retyped_sibling_fails_the_build():
    """The vocabulary anchor: upstream re-typing the family must not pass."""
    cat = _catalog(sib_affixes=[{"name": "Strength", "type": "Insight", "value": "14"}])
    err = _raises(SystemExit, ml36_augments.check, _entry(), cat)
    assert "re-typed the family" in str(err)


def test_a_tooltip_that_stops_stating_the_value_fails_the_build():
    err = _raises(SystemExit, ml36_augments.check,
                  _entry(tooltip="Drag this augment into a slot."), _catalog())
    assert "evidence does not support" in str(err)


def test_a_dice_entry_verifies_its_dice_token():
    e = _entry(name="Ruby of Flame (10d6)", color="Colorless",
               sibling="Diamond of Strength +14",
               affixes=[{"name": "Flaming", "type": "Untyped", "value": "10"}],
               tooltip="upgrade a weapon with an additional 10d6 Fire damage on hit.")
    # sibling vocabulary won't match here — build a matching catalog
    cat = {"Colorless Augment Slot": {"*": [
        {"name": "Diamond of Strength +14", "ml": 32,
         "affixes": [{"name": "Flaming", "type": "Untyped", "value": "9"}]}]}}
    assert ml36_augments.check(e, cat) == {"Colorless": 1}


def test_an_empty_shard_refuses_to_pass():
    _raises(ValueError, ml36_augments.check, {}, _catalog())


def test_inject_appends_in_native_shape():
    cat = _catalog()
    cov = ml36_augments.inject(_entry(), cat)
    pool = cat["Colorless Augment Slot"]["*"]
    assert cov == {"injected": 1, "per_color": {"Colorless": 1}}
    added = pool[-1]
    assert added["name"] == "Diamond of Strength +15"
    assert added["ml"] == 36
    assert added["affixes"] == [{"name": "Strength", "type": "Enhancement", "value": "15"}]


def test_the_shipped_shard_passes_against_the_real_catalog():
    """The integration fact: 63 entries, guarded clean, injectable."""
    entries = ml36_augments.load(SHARD)
    assert len(entries) == 63
    crafting = crafting_catalog.load_catalog()
    counts = ml36_augments.check(entries, crafting)
    assert counts == {"Blue": 13, "Colorless": 26, "Red": 14, "Yellow": 10}
    cov = ml36_augments.inject(entries, crafting)
    assert cov["injected"] == 63


def test_the_shipped_shard_carries_its_wiki_evidence():
    with open(SHARD, encoding="utf-8") as fh:
        raw = json.load(fh)
    entries = raw["harvested"]
    for name, e in entries.items():
        for field in ("color", "ml", "sibling", "affixes", "tooltip", "wiki_url", "verified"):
            assert e.get(field), f"{name}: entry is missing {field!r}"
        assert e["ml"] == 36, f"{name}: not ML36"
        assert len(e["affixes"]) == 1, f"{name}: expected exactly one affix"
