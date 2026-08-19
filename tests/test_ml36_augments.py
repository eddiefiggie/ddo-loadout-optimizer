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
    """The integration fact: 63 entries, guarded clean, injectable.

    #374/U4 — the catalog is now renamed before the check, which is what the
    shipped build does (`build_dataset.py` applies `name_corrections` to
    `crafting` immediately above `ml36_augments.check`, pinned by
    `test_374_the_build_pins_the_rename_above_the_ml36_check`). Before the
    refresh the raw catalog already spelled the Ruby spell-power line in our
    canon, so reading it un-renamed was equivalent; the refresh flipped those
    eight names upstream, so an un-renamed read now compares our canon against
    upstream's generic and fails — which is the point of KTD8, not a defect
    here. Nothing about what this test asserts has changed: same 63 entries,
    same per-color counts.
    """
    entries = ml36_augments.load(SHARD)
    assert len(entries) == 63
    crafting = crafting_catalog.load_catalog()
    name_corrections.apply(crafting, name_corrections.load(CORRECTIONS))
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


# ---------------------------------------------------------------------------
# #374/KTD8 — the crafting rename must run BEFORE this guard.
#
# Eight shard entries (the Ruby spell-power line) carry affix names that are our
# canon. `check` compares each entry's affix vocabulary to its gear-planner
# sibling's, so once upstream flips to generic names the sibling and the shard
# disagree and the build dies here — before any of the migration's work runs.
# Renaming the catalog first makes the comparison our canon against our canon.
# ---------------------------------------------------------------------------

from src import name_corrections  # noqa: E402
from src import vocabulary  # noqa: E402

CORRECTIONS = os.path.join(ROOT, "data", "seed", "compendium",
                           "affix_name_corrections.json")

_FLIP = {
    "Combustion": "Fire Spell Power", "Devotion": "Positive Spell Power",
    "Nullification": "Negative Spell Power", "Glaciation": "Cold Spell Power",
    "Impulse": "Force Spell Power", "Magnetism": "Electric Spell Power",
    "Resonance": "Sonic Spell Power", "Corrosion": "Acid Spell Power",
}


def _refreshed_catalog():
    """The real catalog with upstream's post-flip spelling — what U4 vendors."""
    catalog = crafting_catalog.load_catalog()
    for a in name_corrections._iter_affix_dicts(catalog):
        if a.get("name") in _FLIP:
            a["name"] = _FLIP[a["name"]]
    return catalog


def test_374_the_shard_carries_eight_protected_canon_names():
    entries = ml36_augments.load(SHARD)
    protected = sorted(n for n, e in entries.items()
                       if any(a["name"] in vocabulary.PROTECTED_CANON
                              for a in e["affixes"]))
    assert len(protected) == 8, protected
    assert all(n.startswith("Ruby of ") for n in protected), protected


def test_374_check_fails_on_a_refreshed_catalog_that_was_not_renamed_first():
    """Rename AFTER this guard and the build never reaches the migration."""
    entries = ml36_augments.load(SHARD)
    err = _raises(SystemExit, ml36_augments.check, entries, _refreshed_catalog())
    assert "no longer matches its sibling's" in str(err)
    assert "Ruby of Combustion 166" in str(err)


def test_374_check_passes_once_the_crafting_rename_runs_first():
    """The shipped ordering: name_corrections at the catalog load point, then
    check. `pristine` now means pristine with respect to TIER CONTENT."""
    catalog = _refreshed_catalog()
    name_corrections.apply(catalog, name_corrections.load(CORRECTIONS))
    counts = ml36_augments.check(ml36_augments.load(SHARD), catalog)
    assert counts["Red"] == 14


def test_374_the_build_pins_the_rename_above_the_ml36_check():
    """A source-order pin, because the ordering is the whole of KTD8 and nothing
    else in the suite would notice the two lines being swapped."""
    src = open(os.path.join(ROOT, "build_dataset.py"), encoding="utf-8").read()
    rename = src.index("name_corrections_mod.apply(crafting, _name_corrections)")
    check = src.index("ml36_augments_mod.check(_ml36_entries, crafting)")
    assert rename < check, "the crafting rename must precede ml36_augments.check"
