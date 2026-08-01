"""Umbrella ability-affix expansion tests."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import umbrella  # noqa: E402


def _aff(stat, bt="Enhancement", val=15):
    return {"stat": stat, "bonus_type": bt, "value": val, "unit": "flat"}


def test_is_umbrella_matches_all_spellings():
    for s in ["All Ability Scores", "all Ability Scores", "all ability scores", "Well Rounded", "well rounded"]:
        assert umbrella.is_umbrella(s), s
    for s in ["Constitution", "Strength", "Ability", "Wisdom"]:
        assert not umbrella.is_umbrella(s), s


def test_expand_variant_worn_affixes_preserve_type_and_value():
    v = {"affixes": [_aff("All Ability Scores", "Insightful", 7), _aff("Constitution", "Enhancement", 14)]}
    umbrella.expand_variants([v])
    # the umbrella affix became six ability affixes, all Insightful +7
    umb = [a for a in v["affixes"] if a["value"] == 7]
    assert sorted(a["stat"] for a in umb) == sorted(umbrella.ABILITIES)
    assert all(a["bonus_type"] == "Insightful" and a["unit"] == "flat" for a in umb)
    # the concrete Constitution affix is untouched (still present exactly once)
    con = [a for a in v["affixes"] if a["stat"] == "Constitution" and a["value"] == 14]
    assert len(con) == 1


def test_expand_set_bonus_threshold_affixes():
    v = {"affixes": [], "parsed_set_bonuses": [
        {"set": "S", "pieces_required": 5, "affixes": [_aff("all Ability Scores", "Artifact", 3)]}]}
    umbrella.expand_variants([v])
    stats = sorted(a["stat"] for a in v["parsed_set_bonuses"][0]["affixes"])
    assert stats == sorted(umbrella.ABILITIES)


def test_non_umbrella_variant_unchanged():
    v = {"affixes": [_aff("Dexterity", "Quality", 3)]}
    umbrella.expand_variants([v])
    assert v["affixes"] == [_aff("Dexterity", "Quality", 3)]


def test_shipped_dataset_has_no_umbrella_stats_left():
    import json
    p = os.path.join(ROOT, "web", "data", "items.json")
    if not os.path.exists(p):
        return
    d = json.load(open(p, encoding="utf-8"))
    for v in d["items"]:
        for a in v.get("affixes", []) or []:
            # items.json affixes are native at rest (U3): the stat name is `name`.
            stat = a.get("name", a.get("stat"))
            assert not umbrella.is_umbrella(stat), f"{v.get('source_item')}: {stat}"
