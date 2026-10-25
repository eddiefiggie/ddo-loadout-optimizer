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
    gp = _rec("Costume", [("Strength", "Enhancement", "5")], slot="Cosmetic")
    out, _ = _apply([gp], {"Costume": {"affixes": [["Strength", "Enhancement", 6]]}})
    assert out[0] is gp


def test_a_switched_record_the_harvest_never_saw_is_refused():
    _, st = _apply([_rec("New Blade", [])], {"Other": {"affixes": []}})
    assert any("New Blade" in p for p in st["problems"])


def test_a_weapon_kind_on_a_non_weapon_keeps_the_item_whole():
    gp = _rec("Shield of Tireless Aid", [("Enhancement Bonus (Armor)", "Enhancement", "+5")], slot="Offhand")
    out, st = _apply([gp], {"Shield of Tireless Aid": {"affixes": [["Enhancement Bonus (Weapon)", "Enhancement", 5]]}})
    assert out[0] is gp and st["weapon_kind_on_non_weapon"] == 1


def test_values_use_gear_planners_spelling():
    assert HA.fmt("Enhancement Bonus (Weapon)", 5) == "+5" and HA.fmt("Orb Bonus", 4) == "+4"
    assert HA.fmt("Enhancement Bonus (Weapon)", -1) == "-1" and HA.fmt("Strength", 6) == "6"


def test_the_committed_shard_covers_the_vendored_dump():
    with open(planner_items.RAW_PATH, encoding="utf-8") as fh:
        raw = json.load(fh)
    _, st = HA.apply(raw, HA.load())
    assert st["problems"] == [] and st["records"] > 3000


def test_the_build_stamps_the_switch():
    if not os.path.exists(DATASET):
        raise AssertionError("web/data/items.json is missing — build it first")
    with open(DATASET, encoding="utf-8") as fh:
        ha = json.load(fh)["metadata"]["planner_coverage"]["harvest_affixes"]
    # #907 — every family switched: weapons first (56 replaced, 39 kept whole), then
    # armor, offhand, jewelry, clothing and quivers. `added` is the wiki-stated affixes
    # gear-planner never parsed (mostly rune arms, already supplied downstream).
    assert set(ha["families"]) >= {"Weapon", "Armor", "Offhand", "Ring", "Helm", "Boots"}
    # 129/31/415 when every family first switched; then the qualified-text rule was
    # narrowed to mapped calls (a qualified augment slot produces no affix) and 141
    # presence templates gained a mapper, so far fewer items are kept whole.
    # Tier 3 (typed effects) then read 3,167 more affixes exactly as gear-planner has
    # them, typed Distant Incite on both Crownblade cloaks, and added Chulchannad's
    # Claw's Cold Absorption; a declined form (charge absorption, Enhanced Ghostly)
    # keeps an item whole only beside a read call of its own template (3 items).
    # Skills' Stat Skills, Linguistics and Persuasion branches (2026-10-25) freed 57
    # items (57 variants) and confirmed 200 affixes, all exactly as gear-planner has
    # them, so replaced/added did not move.
    assert ha["replaced"] == 126 and ha["added"] == 32 and ha["kept_whole"] == 147
    assert ha["unchanged"] == 23933
    assert ha["weapon_kind_on_non_weapon"] == 7
