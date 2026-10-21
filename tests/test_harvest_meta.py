"""#906 — the build takes item metadata from our own wiki harvest.

The overlay replaces stated fields, keeps gear-planner's value only where the page
states nothing (counted as a fallback) or a ruling says so, and refuses a vendored
dump it does not fully describe."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import harvest_meta as HM  # noqa: E402
from src import planner_items  # noqa: E402

DATASET = os.path.join(ROOT, "web", "data", "items.json")
RAW = [{"name": "A", "ml": 1, "slot": "Weapon", "type": "Daggers", "quests": ["Old"], "affixes": [{"name": "x"}]},
       {"name": "B", "ml": 7, "slot": "Belt", "type": "Waist items", "quests": None},
       {"name": "Index Page", "ml": 1, "slot": "Armor", "type": "Medium armor"}]
SHARD = {"records": {"A": {"ml": 12, "slot": "Weapon", "type": "Daggers", "quests": ["New"], "revid": 1},
                     "B": {"slot": "Necklace", "type": "Neck items", "revid": 2}},
         "excluded": {"Index Page": "not an item"}}


def test_stated_fields_replace_upstream_and_unstated_ones_fall_back():
    out, st = HM.apply(RAW, SHARD)
    a, b = out[0], out[1]
    assert (a["ml"], a["quests"]) == (12, ["New"]) and a["affixes"] == [{"name": "x"}], "affixes are untouched"
    assert b["ml"] == 7 and b["quests"] is None, "the page states no level or quest, so upstream's stays"
    assert b["slot"] == "Necklace"
    assert st["ml"] == {"wiki": 1, "changed": 1, "fallback": 1, "ruled_gp": 0}
    assert st["problems"] == [] and RAW[0]["ml"] == 1, "the input is not mutated"


def test_a_ruling_for_gear_planner_keeps_upstreams_value():
    out, st = HM.apply(RAW, SHARD, {("B", "slot"): "gp", ("B", "type"): "gp"})
    assert (out[1]["slot"], out[1]["type"]) == ("Belt", "Waist items")
    assert st["slot"]["ruled_gp"] == 1


def test_a_vendored_record_the_harvest_never_saw_is_refused():
    _, st = HM.apply(RAW + [{"name": "Brand New"}], SHARD)
    assert any("Brand New" in p and "re-harvest" in p for p in st["problems"])


def test_a_shard_record_no_longer_vendored_is_refused():
    _, st = HM.apply(RAW[:1] + RAW[2:], SHARD)
    assert any("'B'" in p and "no longer vendored" in p for p in st["problems"])


def test_a_quest_only_correction_supplies_its_quest_and_goes_stale_when_a_quest_arrives():
    corr = {"quests": ["The Night Revels"]}
    assert planner_items.apply_ml_correction({"name": "C", "ml": 4, "quests": None}, corr)["quests"] == ["The Night Revels"]
    try:
        planner_items.apply_ml_correction({"name": "C", "ml": 4, "quests": ["Joe"]}, corr)
    except ValueError as e:
        assert "stale" in str(e)
    else:
        raise AssertionError("a quest-only correction over a record with quests must fail")


def test_the_committed_shard_covers_the_vendored_dump():
    with open(planner_items.RAW_PATH, encoding="utf-8") as fh:
        raw = json.load(fh)
    _, st = HM.apply(raw, HM.load(), HM.load_rulings())
    assert st["problems"] == [], st["problems"][:3]
    assert st["records"] > 8000


def test_the_build_stamps_where_each_field_came_from():
    if not os.path.exists(DATASET):
        raise AssertionError("web/data/items.json is missing — build it first")
    with open(DATASET, encoding="utf-8") as fh:
        hm = json.load(fh)["metadata"]["planner_coverage"]["harvest_meta"]
    assert hm["ml"]["wiki"] > 8000 and hm["ml"]["fallback"] == 8
    # #915 — the dual-slot items take the wiki's infobox slot; the other one is
    # `worn_slots`, so no slot or type is ruled for gear-planner any more.
    assert hm["slot"]["ruled_gp"] == 0 and hm["slot"]["changed"] == 6 and hm["type"]["changed"] == 8
    assert hm["worn_slots"]["wiki"] == 12, "both gear-planner records of each of the six dual-slot items"
    assert hm["quests"]["changed"] == 11
