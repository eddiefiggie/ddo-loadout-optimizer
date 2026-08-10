"""#227 — wiki-sourced affix NAME corrections and their two stale guards.

The rename is what makes `Enhanced Ki` rankable at all: the picker canonicalizes a
typed name, but the solver matches item affixes by name, so a canonical the data
does not carry scores zero. The guards are what keep the rename from rotting —
one fires when the source name disappears upstream, the other when the canonical
name arrives upstream natively. These tests prove both fire.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import name_corrections  # noqa: E402
from src import vocabulary  # noqa: E402

SHARD = os.path.join(ROOT, "data", "seed", "compendium", "affix_name_corrections.json")
ALIASES = os.path.join(ROOT, "data", "seed", "compendium", "affix_aliases.json")


def _rec(name, affixes):
    return {"name": name, "affixes": affixes}


def _corr(source="Ki", canonical="Enhanced Ki"):
    return {"source_name": source, "canonical_name": canonical}


def _raises(exc, fn, *args, **kwargs):
    try:
        fn(*args, **kwargs)
    except exc as e:
        return e
    raise AssertionError(f"expected {exc.__name__}, nothing raised")


# --------------------------------------------------------------------- rename

def test_the_rename_applies_to_every_occurrence():
    records = [
        _rec("Icewalkers", [{"name": "Ki", "value": "1"}]),
        _rec("Legendary Icewalkers", [{"name": "Ki", "value": "5"}]),
    ]
    cov = name_corrections.apply(records, [_corr()])
    assert [r["affixes"][0]["name"] for r in records] == ["Enhanced Ki", "Enhanced Ki"]
    assert cov == {"names_corrected": 1, "affixes_renamed": 2}


def test_the_rename_preserves_the_value_and_the_absent_type():
    records = [_rec("Legendary Icewalkers", [{"name": "Ki", "value": "5"}])]
    name_corrections.apply(records, [_corr()])
    affix = records[0]["affixes"][0]
    assert affix["value"] == "5"
    assert "type" not in affix


def test_other_affixes_are_untouched():
    records = [_rec("Legendary Icewalkers", [
        {"name": "Ki", "value": "5"},
        {"name": "Superior Reinforced Fists", "type": "Bool", "value": 1},
    ])]
    name_corrections.apply(records, [_corr()])
    assert records[0]["affixes"][1]["name"] == "Superior Reinforced Fists"


def test_the_rename_reaches_an_untyped_affix_the_registry_gate_cannot_see():
    # vocabulary.iter_affixes requires name+type+value together, so it does not
    # yield an untyped affix at all. The rename must not inherit that blindness —
    # it is the exact gap that hid this enchantment.
    records = [_rec("Icewalkers", [{"name": "Ki", "value": "1"}])]
    assert list(vocabulary.iter_affixes(records)) == []
    name_corrections.apply(records, [_corr()])
    assert records[0]["affixes"][0]["name"] == "Enhanced Ki"


def test_no_corrections_is_a_no_op():
    records = [_rec("Icewalkers", [{"name": "Ki", "value": "1"}])]
    cov = name_corrections.apply(records, [])
    assert records[0]["affixes"][0]["name"] == "Ki"
    assert cov == {"names_corrected": 0, "affixes_renamed": 0}


def test_a_missing_shard_loads_empty():
    assert name_corrections.load(os.path.join(ROOT, "does", "not", "exist.json")) == []


# ---------------------------------------------------------------------- guards

def test_guard_fires_when_the_source_name_is_gone_upstream():
    records = [_rec("Icewalkers", [{"name": "Reinforced Fists", "type": "Bool", "value": 1}])]
    err = _raises(SystemExit, name_corrections.apply, records, [_corr()])
    assert "'Ki'" in str(err)
    assert "no longer present" in str(err)


def test_guard_fires_when_the_canonical_name_arrives_upstream_natively():
    records = [
        _rec("Icewalkers", [{"name": "Ki", "value": "1"}]),
        _rec("Some New Item", [{"name": "Enhanced Ki", "value": "3"}]),
    ]
    err = _raises(SystemExit, name_corrections.apply, records, [_corr()])
    assert "'Enhanced Ki'" in str(err)
    assert "already a native" in str(err)


def test_guard_refuses_to_inspect_zero_records():
    err = _raises(SystemExit, name_corrections.apply, [], [_corr()])
    assert "empty record set" in str(err)


def test_a_malformed_correction_fails_rather_than_being_skipped():
    records = [_rec("Icewalkers", [{"name": "Ki", "value": "1"}])]
    err = _raises(SystemExit, name_corrections.apply, records, [{"source_name": "Ki"}])
    assert "malformed" in str(err)


# ------------------------------------------------------------- shipping shard

def test_the_shipping_shard_renames_ki_and_cites_the_wiki():
    entries = name_corrections.load(SHARD)
    assert len(entries) == 1
    e = entries[0]
    assert e["source_name"] == "Ki"
    assert e["canonical_name"] == "Enhanced Ki"
    assert e["wiki_url"].endswith("/Enhanced_Ki")
    assert e["evidence"]


def test_every_correction_has_a_matching_alias_so_the_upstream_name_still_resolves():
    # The rename makes the wiki name canonical; without the alias, a player typing
    # the gear-planner name they saw elsewhere would be told it is not a real affix.
    alias_map, _ = vocabulary.load_affix_aliases(ALIASES)
    for e in name_corrections.load(SHARD):
        assert alias_map.get(e["source_name"]) == e["canonical_name"], (
            f"{e['source_name']!r} is renamed but not aliased")


def test_the_shipping_shard_applies_cleanly_to_the_real_roster():
    records = vocabulary._load(vocabulary.ITEMS_PATH)
    cov = name_corrections.apply(records, name_corrections.load(SHARD))
    assert cov["names_corrected"] == 1
    assert cov["affixes_renamed"] == 19
    assert not any(a.get("name") == "Ki"
                   for r in records for a in (r.get("affixes") or []))
