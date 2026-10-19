"""#907 — enchantment template mappers: the bonus type is the stacking rule, so each
default is pinned to the template code that renders it."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import wiki_enchantments as E  # noqa: E402

EVIDENCE = os.path.join(ROOT, "data", "seed", "compendium", "enchantment_template_evidence.json")


def _map(line):
    name, pos, named = E.parse_call(line)
    return E.MAPPERS[name](pos, named)


def test_every_mapped_default_is_pinned_to_the_code_that_renders_it():
    with open(EVIDENCE, encoding="utf-8") as fh:
        ev = json.load(fh)["templates"]
    assert set(ev) == set(E.TEMPLATE_DEFAULTS), "every mapper's default needs its code evidence, and only those"
    for t, (default, quote) in E.TEMPLATE_DEFAULTS.items():
        assert ev[t]["default"] == default and quote in ev[t]["excerpt"], t


def test_resistance_defaults_to_a_resistance_bonus_as_its_code_renders_not_its_notes():
    assert _map("{{Resistance|5}}") == [("Resistance", "Resistance", 5)]


def test_a_lower_case_roman_reads_as_the_template_renders_it():
    assert _map("{{Deadly|x}}") == [("Deadly", "Competence", 10)]


def test_competence_defaults_and_roman_magnitudes():
    assert _map("{{Accuracy|VI}}") == [("Accuracy", "Competence", 6)]
    assert _map("{{Deadly|XI|Insightful}}") == [("Deadly", "Insight", 11)]


def test_seeker_exc_is_an_insight_bonus_per_the_templates_own_switch():
    assert _map("{{seeker|4|exc}}") == [("Seeker", "Insight", 4)]
    assert _map("{{Seeker|6}}") == [("Seeker", "Enhancement", 6)]


def test_stat_reads_ability_amount_type_and_a_negative_is_a_penalty():
    assert _map("{{Stat|INT|8}}") == [("Intelligence", "Enhancement", 8)]
    assert _map("{{Stat|CHA|3|Insightful}}") == [("Charisma", "Insight", 3)]
    assert _map("{{Stat|CON|-2}}") == [("Constitution", "Penalty", -2)]
    assert _map("{{Stat|Well Rounded|2|Profane}}") == [("Well Rounded", "Profane", 2)]


def test_sheltering_reads_a_numbered_named_argument_as_positional():
    assert _map("{{Sheltering|17|3=Physical}}") == [("Physical Sheltering", "Enhancement", 17)]
    assert _map("{{Sheltering|10|Insightful|Magical}}") == [("Magical Sheltering", "Insight", 10)]


def test_doublestrike_takes_a_percent_string():
    assert _map("{{Doublestrike|9%}}") == [("Doublestrike", "Enhancement", 9)]


def test_an_unreadable_call_is_unmapped_never_guessed():
    # (`{{Accuracy|x}}` is NOT here: the template upper-cases before Roman2Dec, so it
    # renders X = 10 — a stated value.)
    for line in ("{{Stat|Body|6}}", "{{Doublestrike|Calamitous Blows}}", "{{Accuracy|q}}"):
        try:
            _map(line)
        except E.Unmapped:
            continue
        raise AssertionError(f"{line} must be Unmapped")


def test_only_the_items_own_lines_count_nested_lines_are_sub_options():
    mapped, unmapped = E.affixes("* {{Stat|STR|6}}\n** {{Stat|STR|8}}\n* {{Holy|4|1}}\n* plain text")
    assert mapped == [("Strength", "Enhancement", 6)]
    assert unmapped == [("Holy", "no mapper")]
