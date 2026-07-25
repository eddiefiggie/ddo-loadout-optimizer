"""U3 — tier-variant expansion + vocab tests."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.variants import expand_item, expand_dataset  # noqa: E402
from src import vocab  # noqa: E402

SEED = os.path.join(os.path.dirname(__file__), "..", "data", "seed", "ddo_items.json")


def _seed_item(name):
    d = json.load(open(SEED, encoding="utf-8"))
    for it in d["items"]:
        if it["name"] == name:
            return it
    raise AssertionError(f"{name} not in seed")


def test_ml_line_item_expands_to_per_tier_variants():
    # Ring of the Stalker encodes real per-tier data in ML-prefixed lines.
    variants = expand_item(_seed_item("Ring of the Stalker"))
    assert len(variants) >= 3
    mls = sorted(v["minimum_level"] for v in variants)
    assert mls[0] == 3  # lowest tier is ML3
    # The trap: a variant's affix VALUES must match its own tier, not a
    # single shared listing. Seeker climbs across tiers.
    seeker_by_ml = {}
    for v in variants:
        for a in v["affixes"]:
            if a["stat"] == "Seeker":
                seeker_by_ml[v["minimum_level"]] = a["value"]
    assert seeker_by_ml.get(3) == 3
    assert max(seeker_by_ml.values()) > seeker_by_ml[3]


def test_non_tiered_item_yields_single_variant_at_item_ml():
    it = _seed_item("Silver Pocketwatch")
    variants = expand_item(it)
    assert len(variants) == 1
    assert variants[0]["minimum_level"] == it["minimum_level"]


def test_prose_only_tiered_item_is_flagged_not_fabricated():
    # The Diplomancer describes its tiers only in prose; per-tier magnitudes are
    # not in the data, so we must NOT invent 6 affix-bearing variants.
    v = expand_item(_seed_item("The Diplomancer"))
    assert len(v) == 1
    var = v[0]
    assert var["tier_values_incomplete"] is True
    assert var["tier_ml_list"] == [5, 10, 15, 20, 25, 30]
    # equippable at its lowest tier
    assert var["minimum_level"] == 5


def test_variants_carry_default_restriction_and_armor_fields():
    armor = expand_item(_seed_item(
        next(it["name"] for it in json.load(open(SEED, encoding="utf-8"))["items"]
             if it["slot"] == "Armor")))
    assert armor[0]["restrictions"] == "unknown"
    assert armor[0]["armor_type"] == "unknown"


def test_rolls_become_option_groups_not_always_on():
    # Find an item whose enhancements include a "Rolls one of" line.
    d = json.load(open(SEED, encoding="utf-8"))
    roll_item = None
    for it in d["items"]:
        if any(str(e).lower().startswith("rolls one of") for e in it.get("enhancements", [])):
            roll_item = it
            break
    assert roll_item is not None
    v = expand_item(roll_item)[0]
    assert len(v["roll_groups"]) >= 1
    assert len(v["roll_groups"][0]["options"]) >= 2


def test_expand_dataset_covers_all_items():
    d = json.load(open(SEED, encoding="utf-8"))
    variants = expand_dataset(d["items"])
    # every source item yields at least one variant
    names = {v["source_item"] for v in variants}
    assert names == {it["name"] for it in d["items"]}
    assert len(variants) >= len(d["items"])


def test_vocab_core_stats_and_aliases():
    assert vocab.is_core_stat("Intelligence")
    assert vocab.is_core_stat("Con")  # alias
    assert not vocab.is_core_stat("Featherfalling")
    assert vocab.is_known_bonus_type("Insightful")
    assert not vocab.is_known_bonus_type("Bogus")
    assert vocab.normalize_stat("Con") == "Constitution"
    assert vocab.normalize_stat("Intelligence") == "Intelligence"


def test_expand_item_canonicalizes_alias_stats():
    # a synthetic item whose affix stat is an alias must come out canonicalized
    synthetic = {
        "name": "Test Ring", "guide_source": "test", "category": "item",
        "slot": "Ring", "minimum_level": 10, "binding": None,
        "location_quest": "", "enhancements": ["Con +5"], "upgradeable": "No",
        "augment_slots": [], "description": "", "wiki_url": "", "notes": "",
        "set_bonus": [],
    }
    v = expand_item(synthetic)[0]
    assert any(a["stat"] == "Constitution" for a in v["affixes"])


def test_tier_variants_do_not_share_affix_objects():
    # regression: base affixes must not be aliased across tier variants
    variants = expand_item(_seed_item("Ring of the Stalker"))
    ids = [id(a) for v in variants for a in v["affixes"]]
    assert len(ids) == len(set(ids)), "affix dicts are shared across variants"


def test_expand_dataset_wraps_bad_item_with_name():
    bad = {"name": "Broken Item"}  # missing required fields
    try:
        expand_dataset([bad])
        assert False, "expected ValueError"
    except ValueError as e:
        assert "Broken Item" in str(e)
