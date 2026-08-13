"""#207 — wiki-sourced value corrections and their stale guard.

The guard is the reason this mechanism is safe to have at all: a correction that
silently pins a number over a source that has since moved is how the value being
corrected here went wrong in the first place. These tests prove the guard fires.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import value_corrections  # noqa: E402

SHARD = os.path.join(ROOT, "data", "seed", "compendium", "item_value_corrections.json")


def _rec(name, affixes):
    return {"name": name, "affixes": affixes}


def _corr(name="Spell Focus Mastery", type_="Equipment", frm="5", to="8"):
    return {"name": name, "type": type_, "from": frm, "to": to}


def test_a_matching_correction_overwrites_the_value():
    records = [_rec("Ring", [{"name": "Spell Focus Mastery", "type": "Equipment", "value": "5"}])]
    cov = value_corrections.apply(records, {"Ring": [_corr()]})
    assert records[0]["affixes"][0]["value"] == "8"
    assert cov == {"items_corrected": 1, "values_changed": 1}


def test_other_affixes_on_the_item_are_untouched():
    records = [_rec("Ring", [
        {"name": "Spell Focus Mastery", "type": "Equipment", "value": "5"},
        {"name": "Wizardry", "type": "Insight", "value": "155"},
    ])]
    value_corrections.apply(records, {"Ring": [_corr()]})
    assert records[0]["affixes"][1]["value"] == "155"


def test_a_different_bonus_type_is_not_corrected():
    # Sacred Spell Focus Mastery is a separate affix and must not be swept up.
    records = [_rec("Ring", [{"name": "Spell Focus Mastery", "type": "Sacred", "value": "3"}])]
    try:
        value_corrections.apply(records, {"Ring": [_corr()]})
    except SystemExit:
        pass          # correct: no Equipment-typed affix to correct
    assert records[0]["affixes"][0]["value"] == "3"


def test_stale_from_value_fails_the_build():
    """The load-bearing guard: upstream moved, so the correction must be re-verified."""
    records = [_rec("Ring", [{"name": "Spell Focus Mastery", "type": "Equipment", "value": "7"}])]
    try:
        value_corrections.apply(records, {"Ring": [_corr(frm="5")]})
    except SystemExit as e:
        assert "re-verify" in str(e), str(e)
        assert records[0]["affixes"][0]["value"] == "7", "nothing was written on a stale entry"
        return
    raise AssertionError("a stale `from` value must fail the build, not pin a number over it")


def test_a_vanished_affix_fails_the_build():
    records = [_rec("Ring", [{"name": "Wizardry", "type": "Insight", "value": "155"}])]
    try:
        value_corrections.apply(records, {"Ring": [_corr()]})
    except SystemExit as e:
        assert "no 'Spell Focus Mastery'" in str(e) or "re-verify" in str(e), str(e)
        return
    raise AssertionError("a correction targeting an absent affix must fail the build")


def test_an_item_absent_from_the_roster_is_a_silent_no_op():
    # The roster varies with the harvest; a correction waiting for an item to
    # reappear is not an error.
    records = [_rec("Other", [{"name": "Wizardry", "type": "Insight", "value": "10"}])]
    cov = value_corrections.apply(records, {"Ring": [_corr()]})
    assert cov == {"items_corrected": 0, "values_changed": 0}


def test_missing_shard_file_yields_no_corrections():
    assert value_corrections.load(os.path.join(ROOT, "does", "not", "exist.json")) == {}


def test_meta_keys_are_stripped_from_the_shard():
    loaded = value_corrections.load(SHARD)
    assert not any(str(k).startswith("_") for k in loaded)


def test_the_shipped_shard_carries_its_wiki_evidence():
    """Every correction states the rendered tooltip it came from, not just a number."""
    with open(SHARD, encoding="utf-8") as fh:
        raw = json.load(fh)
    for item, entries in raw.items():
        if str(item).startswith("_"):
            continue
        for e in entries:
            for field in ("name", "type", "from", "to", "tooltip", "wiki_url", "verified"):
                assert e.get(field), f"{item}: correction is missing {field!r}"
            assert str(e["to"]) in e["tooltip"], (
                f"{item}: the corrected value {e['to']!r} does not appear in the "
                f"recorded tooltip — the evidence does not support the number")


def test_the_argonnessen_correction_is_the_one_we_verified():
    loaded = value_corrections.load(SHARD)
    entry = loaded["Legendary Argonnessen Eye Band"][0]
    assert (entry["name"], entry["type"], entry["from"], entry["to"]) == (
        "Spell Focus Mastery", "Equipment", "5", "8")


# --- #288: the U81 Reign pull-back batch -----------------------------------------

def test_the_288_batch_covers_the_seven_drifted_reigns():
    loaded = value_corrections.load(SHARD)
    reigns = {"Orcus' Reign": 1, "Juiblex's Reign": 3, "Demogorgon's Reign": 2,
              "Fraz-Urb'luu's Reign": 4, "Zuggtmoy's Reign": 4,
              "Lolth's Reign": 1, "Graz'zt's Reign": 1}
    for item, n in reigns.items():
        assert len(loaded.get(item) or []) == n, (item, len(loaded.get(item) or []))
    # Verified-and-unchanged artifacts must NOT carry entries: Baphomet's and
    # Yeenoghu's Reigns match the wiki, as do all six ML32 Unholy Defiler
    # artifacts (swept 2026-08-13).
    for item in ("Baphomet's Reign", "Yeenoghu's Reign", "Beltstrap of Forbidden Tomes",
                 "Blade-Barbed Bandolier", "Buckle of Assimilation",
                 "Desolation Spectacles", "Eyes of Defilement", "Misery Monocle"):
        assert item not in loaded, f"{item} was verified unchanged — no entry belongs"


def test_the_built_reigns_score_the_wiki_values():
    path = os.path.join(os.path.dirname(__file__), "..", "web", "data", "items.json")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as fh:
        items = {i["variant_id"]: i for i in json.load(fh)["items"]}

    def aff(item, name, type_):
        return next(a for a in items[item]["affixes"]
                    if a["name"] == name and a["type"] == type_)

    assert aff("Orcus' Reign", "Necromancy Focus", "Insight")["value"] == "8"
    # The gap entry: the pull-back ADDED Quality False Life +15 to Orcus.
    assert aff("Orcus' Reign", "False Life", "Quality")["value"] == "15"
    # ... and rebuilding is idempotent about it: exactly one such affix.
    assert sum(1 for a in items["Orcus' Reign"]["affixes"]
               if a["name"] == "False Life") == 1
    assert aff("Juiblex's Reign", "Sheltering", "Insight")["value"] == "21"
    assert aff("Juiblex's Reign", "False Life", "Profane")["value"] == "56"
    # Value AND type corrected, in that order (16->15 at Enhancement, then
    # Enhancement->Insight): the tooltip states an Insight bonus.
    assert aff("Juiblex's Reign", "Acid Absorption", "Insight")["value"] == "15"
    assert not any(a["name"] == "Acid Absorption" and a["type"] == "Enhancement"
                   for a in items["Juiblex's Reign"]["affixes"])
    assert aff("Demogorgon's Reign", "Fortification", "Insight")["value"] == "87"
    assert aff("Fraz-Urb'luu's Reign", "Command", "Competence")["value"] == "8"
    assert aff("Fraz-Urb'luu's Reign", "Evocation Focus", "Equipment")["value"] == "16"
    assert aff("Zuggtmoy's Reign", "Corrosion", "Quality")["value"] == "43"
    assert aff("Lolth's Reign", "Sheltering", "Insight")["value"] == "21"
    assert aff("Graz'zt's Reign", "Armor Class", "Natural")["value"] == "16"
    # Demogorgon's Potency 31->30 lands pre-expansion, so it surfaces as the ten
    # element spellpowers at the corrected value (#290 interaction).
    assert aff("Demogorgon's Reign", "Nullification", "Quality")["value"] == "30"
    # The verified-unchanged control pair really is unchanged.
    assert aff("Baphomet's Reign", "Sheltering", "Quality")["value"] == "11"
    assert aff("Yeenoghu's Reign", "Deadly", "Quality")["value"] == "4"
