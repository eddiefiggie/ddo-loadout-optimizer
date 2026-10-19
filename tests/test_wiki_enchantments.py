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


# --- tier 2 (#907) ---

def test_save_defaults_follow_each_branch_of_the_template():
    assert _map("{{Save|Fortitude|4}}") == [("Fortitude Save", "Resistance", 4)]
    assert _map("{{Save|e|6}}") == [("Enchantment Save", "Resistance", 6)]
    assert _map("{{Save|i|2}}") == [("Illusion Save", "Enhancement", 2)]
    assert _map("{{Save|Fortitude|3|Insightful}}") == [("Fortitude Save", "Insight", 3)]
    assert _map("{{Save|Reflex|2|Determination}}") == [("Determined Reflex Save", "Determination", 2)]
    assert _map("{{Save|w|-2}}") == [("Will Save", "Penalty", -2)]


def test_skills_default_to_competence_and_groups_to_exceptional():
    assert _map("{{Skills|intim|3}}") == [("Intimidate", "Competence", 3)]
    assert _map("{{Skills|Nimble|7|Insightful}}") == [("Nimble Skills Bonus", "Insight", 7)]
    assert _map("{{Skills|Alluring|8}}") == [("Alluring Skills Bonus", "Exceptional", 8)]
    assert _map("{{Skills|Haggle|3|enh|prefix=Enhanced}}") == [("Haggle", "Enhancement", 3)]


def test_spelllore_adds_ten_to_roman_element_lores_and_not_to_spell_lore():
    assert _map("{{Spelllore|Void|iv}}") == [("Negative Lore", "Equipment", 14)]
    assert _map("{{Spelllore|Spell|VI}}") == [("Spell Lore", "Equipment", 6)]
    assert _map("{{Spelllore|Acid|21}}") == [("Acid Lore", "Equipment", 21)]
    assert _map("{{Spelllore|Frozen Depths|+8}}") == [("Frozen Depths Lore", "Equipment", 8)]


def test_spell_power_types_and_equipment_default():
    assert _map("{{SpellPower|Devotion|30}}") == [("Positive Spell Power", "Equipment", 30)]
    assert _map("{{Spell Power|Impulse|48}}") == [("Force Spell Power", "Equipment", 48)]
    assert _map("{{SpellPower|Corrosion|38|Insightful}}") == [("Acid Spell Power", "Insight", 38)]


def test_focus_fortification_amplification_and_natural_armor():
    assert _map("{{Spell Focus|Spell|II}}") == [("Spell Focus", "Equipment", 2)]
    assert _map("{{Spell Focus|Rune Arm|4}}") == [("Rune Arm Focus", "Equipment", 4)]
    assert _map("{{Fortification|0|10}}") == [("Fortification", "Insight", 10)]
    assert _map("{{Fortification|2}}") == [("Fortification", "Enhancement", 75)]
    assert _map("{{HealingAmp|14|Positive|Competence}}") == [("Healing Amplification", "Competence", 14)]
    assert _map("{{HealingAmp|53|R}}") == [("Repair Amplification", "Enhancement", 53)]
    assert _map("{{NaturalArmor|2|prefix=Insightful}}") == [("Armor Class", "Insight Natural", 2)]


def test_enhancement_wizardry_and_hit_points():
    assert _map("{{Enhancement bonus|s|5}}") == [("Enhancement Bonus (Armor)", "Enhancement", 5)]
    assert _map("{{Enhancement bonus|w|-1}}") == [("Enhancement Bonus (Weapon)", "Penalty", -1)]
    assert _map("{{Wizardry|V|Insightful}}") == [("Wizardry", "Insight", 5)]
    assert _map("{{Hp|Vitality|20}}") == [("False Life", "Vitality", 20)]
    assert _map("{{Hp|Greater Elemental Energy}}") == [("Greater Elemental Energy", "Bool", 1)]


def test_tier_two_calls_we_do_not_read_yet_are_unmapped():
    for line in ("{{Wizardry|M}}", "{{Enhancement bonus|i|1}}", "{{Tactics|Tendon Slice|6}}",
                 "{{Spell Focus|Deific Focus|3}}", "{{Fortification|4}}", "{{Skills|Bluffing|3|enh}}"):
        try:
            _map(line)
        except E.Unmapped:
            continue
        raise AssertionError(f"{line} must be Unmapped")
