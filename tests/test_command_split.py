"""#192 — the `Command` enchantment expands into six Charisma skills and a Hide
penalty at the planner-record seam. Ruling: docs/wiki-evidence/command.md."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import command_split  # noqa: E402
from src.spell_focus import PROVENANCE_KEY, SKILLS_CHA  # noqa: E402

ITEMS = os.path.join(ROOT, "web", "data", "items.json")
CHA = ["Bluff", "Diplomacy", "Haggle", "Intimidate", "Perform", "Use Magic Device"]


def _rec(name, *affixes):
    return {"name": name, "affixes": [dict(a) for a in affixes]}


def test_the_roster_is_the_wiki_s_six_and_the_penalty_is_the_wiki_s_minus_six():
    # Command_(enchantment) Notes: "+x bonus to Bluff, Diplomacy, Haggle, Intimidate,
    # Perform, and Use Magic Device and imposes a -6 penalty to Hide."
    assert list(SKILLS_CHA) == CHA
    assert command_split.EXPANDED_AWAY == {"command": CHA}
    assert (command_split.PENALTY_STAT, command_split.PENALTY_TYPE, command_split.PENALTY_VALUE) == ("Hide", "Penalty", -6)


def test_competence_command_becomes_six_competence_skills_and_a_hide_penalty():
    rec = _rec("Coin Belt", {"name": "Command", "type": "Competence", "value": "2"},
               {"name": "Strength", "type": "Enhancement", "value": "6"})
    cov = command_split.apply([rec])
    rows = [(a["name"], a["type"], a["value"], a.get(PROVENANCE_KEY)) for a in rec["affixes"]]
    assert rows == [(s, "Competence", "2", "Command") for s in CHA] + [
        ("Hide", "Penalty", "-6", "Command"), ("Strength", "Enhancement", "6", None)]
    assert cov["records_expanded"] == 1 and cov["affixes_minted"] == 7
    assert cov["by_version"] == {"Command": 1, "Insightful Command": 0}
    assert cov["unexpanded"] == []


def test_insight_command_keeps_its_type_and_carries_the_engraved_name():
    rec = _rec("Citadel's Gaze", {"name": "Command", "type": "Insight", "value": "7"})
    command_split.apply([rec])
    assert all(a["type"] == "Insight" and a["value"] == "7" and a[PROVENANCE_KEY] == "Insightful Command"
               for a in rec["affixes"] if a["name"] in CHA)
    pen = [a for a in rec["affixes"] if a["name"] == "Hide"]
    assert pen == [{"name": "Hide", "type": "Penalty", "value": "-6", PROVENANCE_KEY: "Insightful Command"}]


def test_an_unstated_version_or_magnitude_is_left_folded_and_named_never_guessed():
    bad_type = _rec("X", {"name": "Command", "type": "Enhancement", "value": "3"})
    bad_value = _rec("Y", {"name": "Command", "type": "Competence", "value": "n/a"})
    cov = command_split.apply([bad_type, bad_value])
    assert cov["records_expanded"] == 0
    assert [a["name"] for a in bad_type["affixes"]] == ["Command"]
    assert [a["name"] for a in bad_value["affixes"]] == ["Command"]
    assert cov["unexpanded"] == [{"record": "X", "type": "Enhancement", "value": "3"},
                                 {"record": "Y", "type": "Competence", "value": "n/a"}]


def test_non_command_records_and_clickies_are_untouched():
    rec = _rec("Boneshard Flute", {"name": "Command Undead clicky", "type": "Bool", "value": 1})
    before = json.dumps(rec)
    cov = command_split.apply([rec])
    assert json.dumps(rec) == before and cov["records_expanded"] == 0


def test_built_dataset_carries_no_folded_command_and_every_carrier_has_the_seven():
    if not os.path.exists(ITEMS):
        return
    data = json.load(open(ITEMS, encoding="utf-8"))
    folded = [it["source_item"] for it in data["items"]
              if any(a.get("name") == "Command" for a in it.get("affixes") or [])]
    assert folded == [], folded
    carriers = [it for it in data["items"]
                if any(a.get(PROVENANCE_KEY) in ("Command", "Insightful Command") for a in it.get("affixes") or [])]
    assert len(carriers) >= 40, len(carriers)
    for it in carriers:
        via = {a[PROVENANCE_KEY] for a in it["affixes"] if a.get(PROVENANCE_KEY) in ("Command", "Insightful Command")}
        assert len(via) == 1, (it["source_item"], via)
        (label,) = via
        want_type = "Insight" if label == "Insightful Command" else "Competence"
        mine = [a for a in it["affixes"] if a.get(PROVENANCE_KEY) == label]
        assert sorted(a["name"] for a in mine) == sorted(CHA + ["Hide"]), it["source_item"]
        assert all(a["type"] == want_type for a in mine if a["name"] != "Hide"), it["source_item"]
        pen = [a for a in mine if a["name"] == "Hide"]
        assert pen and pen[0]["type"] == "Penalty" and str(pen[0]["value"]) == "-6", it["source_item"]
    cov = data["metadata"]["command_split_coverage"]
    assert cov["records_expanded"] == len(carriers) and cov["unexpanded"] == []
    assert data["metadata"]["expanded_away_names"]["command"] == CHA
    assert "Command" not in data["metadata"]["rankable_affixes"], "the enchantment name is no longer offered as a stat"
    for skill in CHA + ["Hide"]:
        assert skill in data["metadata"]["rankable_affixes"], skill
