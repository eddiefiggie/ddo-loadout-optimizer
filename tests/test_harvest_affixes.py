"""#907 — switched families take their enchantments from our own wiki harvest.

The overlay matches an item's harvested affixes against gear-planner's as one set,
never one at a time, keeps an item whole when any mapped call was unreadable, and
refuses a dump it does not fully describe."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import harvest_affixes as HA  # noqa: E402
from src import planner_items  # noqa: E402

DATASET = os.path.join(ROOT, "web", "data", "items.json")


def _rec(name, affixes, slot="Weapon"):
    return {"name": name, "slot": slot, "affixes": [{"name": n, "type": t, "value": v} for n, t, v in affixes]}


def _apply(raw, records):
    return HA.apply(raw, {"records": records})


def test_two_legitimate_affixes_of_one_name_both_survive():
    gp = _rec("Amplin", [("Spell Focus Mastery", "Quality", "2"), ("Spell Focus Mastery", "Exceptional", "2")])
    out, st = _apply([gp], {"Amplin": {"affixes": [["Spell Focus Mastery", "Quality", 2],
                                                   ["Spell Focus Mastery", "Exceptional", 2]]}})
    assert out[0]["affixes"] == gp["affixes"] and st["unchanged"] == 2 and st["replaced"] == 0


def test_a_value_and_a_type_are_replaced_in_place_and_gaps_are_added():
    gp = _rec("W", [("Enhancement Bonus (Weapon)", "Enhancement", "+15"), ("Acid Lore", "Equipment", "5"),
                    ("Seeker", "Exceptional", "3"), ("Holy", "Bool", 1)])
    out, st = _apply([gp], {"W": {"affixes": [["Enhancement Bonus (Weapon)", "Enhancement", 15],
                                              ["Acid Lore", "Equipment", 15], ["Seeker", "Insight", 3],
                                              ["Deadly", "Competence", 4]]}})
    assert out[0]["affixes"] == [
        {"name": "Enhancement Bonus (Weapon)", "type": "Enhancement", "value": "+15"},
        {"name": "Acid Lore", "type": "Equipment", "value": "15"},
        {"name": "Seeker", "type": "Insight", "value": "3"},
        {"name": "Holy", "type": "Bool", "value": 1},
        {"name": "Deadly", "type": "Competence", "value": "4"}], "order kept; Holy untouched; Deadly added"
    assert (st["unchanged"], st["replaced"], st["added"]) == (1, 2, 1)


def test_an_item_with_an_unreadable_mapped_call_keeps_its_affixes_whole():
    gp = _rec("Magi Staff", [("Wizardry", "Enhancement", "100")])
    out, st = _apply([gp], {"Magi Staff": {"affixes": [], "unread": ["Wizardry"]}})
    assert out[0] is gp and st["kept_whole"] == 1


def test_other_families_are_not_touched():
    gp = _rec("Ring", [("Strength", "Enhancement", "5")], slot="Ring")
    out, _ = _apply([gp], {"Ring": {"affixes": [["Strength", "Enhancement", 6]]}})
    assert out[0] is gp


def test_a_switched_record_the_harvest_never_saw_is_refused():
    _, st = _apply([_rec("New Blade", [])], {"Other": {"affixes": []}})
    assert any("New Blade" in p for p in st["problems"])


def test_values_use_gear_planners_spelling():
    assert HA.fmt("Enhancement Bonus (Weapon)", 5) == "+5" and HA.fmt("Orb Bonus", 4) == "+4"
    assert HA.fmt("Enhancement Bonus (Weapon)", -1) == "-1" and HA.fmt("Strength", 6) == "6"


def test_the_committed_shard_covers_the_vendored_weapons():
    with open(planner_items.RAW_PATH, encoding="utf-8") as fh:
        raw = json.load(fh)
    _, st = HA.apply(raw, HA.load())
    assert st["problems"] == [] and st["records"] > 3000


def test_the_build_stamps_the_switch():
    if not os.path.exists(DATASET):
        raise AssertionError("web/data/items.json is missing — build it first")
    with open(DATASET, encoding="utf-8") as fh:
        ha = json.load(fh)["metadata"]["planner_coverage"]["harvest_affixes"]
    assert ha["families"] == ["Weapon"] and ha["records"] > 3000
    assert ha["replaced"] == 56 and ha["added"] == 0 and ha["kept_whole"] == 39
