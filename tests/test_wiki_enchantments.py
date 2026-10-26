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
    mapped, unmapped = E.affixes("* {{Stat|STR|6}}\n** {{Stat|STR|8}}\n* {{Augment|Colorless}}\n* plain text")
    assert mapped == [("Strength", "Enhancement", 6)]
    assert unmapped == [("Augment", "no mapper")]


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


def test_skills_stat_groups_linguistics_and_persuasion_follow_the_template_code():
    """Template:Skills rev 703569. The Stat Skills branch fixes the type to
    Exceptional and never reads {{{3}}}; Linguistics defaults to 10 and names no
    type; Persuasion takes no parameters. Each matches gear-planner's record."""
    assert _map("{{Skills|Dex|4}}") == [("Dexterity Skills", "Exceptional", 4)]
    assert _map("{{Skills|INT|6}}") == [("Intelligence Skills", "Exceptional", 6)]
    assert _map("{{Skills|Charisma|2}}") == [("Charisma Skills", "Exceptional", 2)]
    assert _map("{{Skills|WIS|2|Insightful}}") == [("Wisdom Skills", "Exceptional", 2)]
    assert _map("{{Skills|str|-2}}") == [("Strength Skills", "Penalty", -2)]
    assert _map("{{Skills|Linguistics|15}}") == [("Linguistics", "Untyped", 15)]
    assert _map("{{Skills|Linguistics}}") == [("Linguistics", "Untyped", 10)]
    assert _map("{{Skills|Persuasion}}") == [("Persuasion", "Bool", 1)]


def test_skills_command_defaults_and_parameterless_effects_are_presences():
    """Template:Skills rev 703569. Command renders `{{Int|{{{2|2}}}}}
    [[{{{3|competence}}} bonus]]`, so a bare call is 2 Competence. Shadow, Silent
    Moves, Songblade and Voice of Deceit take no parameters: each a presence, as
    gear-planner records them. The code matches names with spaces removed."""
    assert _map("{{Skills|Command}}") == [("Command", "Competence", 2)]
    assert _map("{{Skills|Command|7|Insight}}") == [("Command", "Insight", 7)]
    assert _map("{{skills|Command|8}}") == [("Command", "Competence", 8)]
    assert _map("{{Skills|Shadow}}") == [("Shadow", "Bool", 1)]
    assert _map("{{Skills|Silent Moves}}") == [("Silent Moves", "Bool", 1)]
    assert _map("{{Skills|Songblade}}") == [("Songblade", "Bool", 1)]
    assert _map("{{Skills|Voice of Deceit}}") == [("Voice of Deceit", "Bool", 1)]


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


def test_tier_two_calls_we_do_not_read_yet_are_unmapped_not_declined():
    # Plain Unmapped keeps the item whole. These are unknown kinds or values the
    # template states that the mapper does not read yet, so they must NOT be
    # declined: a declined call leaves its value on gear-planner for good.
    for line in ("{{Enhancement bonus|q|1}}", "{{Skills|Bluffing|3|enh}}", "{{SpellPower|Combustoin|20}}"):
        try:
            _map(line)
        except E.Declined:
            raise AssertionError(f"{line} must not be Declined")
        except E.Unmapped:
            continue
        raise AssertionError(f"{line} must be Unmapped")


def test_the_tier_two_rulings_named_forms_are_declined():
    """The tier-2 ruling's deliberate forms: named effects (Tendon Slice, Calamitous
    Blows, Pirate Vitality and Cleverness, the named SpellPower powers), Magi and
    Archmagi Wizardry, Deific Focus and legacy Construct Fortification."""
    for line in ("{{Tactics|Tendon Slice|6}}", "{{Tactics|Tendon Slice|10%}}", "{{Doublestrike|Calamitous Blows}}",
                 "{{Spell Focus|Deific Focus|3}}", "{{Spell Focus|Deific|III}}", "{{Fortification|4}}",
                 "{{Fortification|4|10}}", "{{Wizardry|M}}", "{{Wizardry|am}}", "{{Wizardry|Archmagi}}",
                 "{{Wizardry|IV}}", "{{Wizardry|VIII}}",
                 "{{Wizardry|Pirate Cleverness}}", "{{Hp|Pirate Vitality}}", "{{SpellPower|Spell Turmoil}}",
                 "{{SpellPower|Efficacy|20||0}}", "{{SpellPower|Power of Creeping Dust|142}}"):
        try:
            _map(line)
        except E.Declined:
            continue
        raise AssertionError(f"{line} must be Declined")
    assert _map("{{Doublestrike|5}}") == [("Doublestrike", "Enhancement", 5)]


def test_wizardry_signed_numbers_and_profane_life_force_follow_the_template_code():
    """#941. Template:Wizardry rev 700755 reads any number as is (`Ifnumber`), so
    `+195` is 195 spell points. Template:Hp rev 538996 strips spaces before its
    switch, so `Profane Life Force` is the `profanelifeforce` branch."""
    assert _map("{{Wizardry|+195}}") == [("Wizardry", "Enhancement", 195)]
    assert _map("{{wizardry|+19}}") == [("Wizardry", "Enhancement", 19)]
    assert _map("{{Wizardry|195}}") == [("Wizardry", "Enhancement", 195)]
    assert _map("{{Hp|Profane Life Force|44}}") == [("False Life", "Profane", 44)]
    assert _map("{{Hp|Profane Lifeforce|12}}") == [("False Life", "Profane", 12)]


def test_implement_and_orb_kinds_follow_the_templates_two_switches():
    assert _map("{{Enhancement bonus|i|1}}") == [("Universal Spell Power", "Implement", 3),
                                                  ("Enhancement Bonus (Weapon)", "Enhancement", 1)]
    assert _map("{{Enhancement bonus|io|6}}") == [("Universal Spell Power", "Implement", 18)]
    assert _map("{{Enhancement bonus|oi|4|10}}") == [("Universal Spell Power", "Implement", 10), ("Orb Bonus", "Orb", 4)]
    assert _map("{{Enhancement bonus|si|6|20}}") == [("Universal Spell Power", "Implement", 20),
                                                      ("Enhancement Bonus (Armor)", "Enhancement", 6)]
    assert _map("{{Enhancement bonus|o|4}}") == [("Orb Bonus", "Orb", 4)]


def test_a_call_followed_by_qualifying_text_is_conditional_and_not_read():
    mapped, unmapped = E.affixes("* {{hp|Vitality|20}} (only from chain end reward)\n* {{Stat|STR|6}}\n"
                                 "* {{Augment|Colorless}} (only from chain end reward)")
    assert mapped == [("Strength", "Enhancement", 6)]
    assert unmapped == [("<qualified>", "a call followed by qualifying text (conditional)")], \
        "a qualified augment slot produces no affix, so it does not count"


def test_a_presence_template_is_a_flag_stated_once():
    assert "Holy" in E.PRESENCE and "Ghostly" not in E.PRESENCE, "typed templates are not presence"
    mapped, _ = E.affixes("* {{Holy|4|1}}\n* {{Bewildering}}\n* {{Bewildering|3|critical}}")
    assert mapped == [("Holy", "Bool", 1), ("Bewildering", "Bool", 1)]


def test_no_presence_template_is_ever_a_typed_stat_in_the_catalog():
    """A presence flag drops any magnitude, so a template on the presence list must
    never appear in the vendored dump with a real bonus type — that would flatten a
    stacking stat into a flag."""
    with open(os.path.join(ROOT, "data", "seed", "compendium", "raw", "gearplanner_items.json"),
              encoding="utf-8") as fh:
        raw = json.load(fh)
    types = {}
    for r in raw:
        for a in r.get("affixes") or []:
            types.setdefault(a.get("name"), set()).add(a.get("type"))
    assert len(E.PRESENCE) > 100, "a guard over a near-empty list asserts little"
    typed = sorted(t for t in E.PRESENCE if types.get(t, {"Bool"}) - {"Bool"})
    assert typed == [], typed


# --- tier 3: typed effects (#907) ---

def test_bane_and_blast_names_follow_the_template_switches():
    assert _map("{{Bane|Halfling|lesser}}") == [("Lesser Halfling Bane", "Bool", 1)]
    assert _map("{{Bane|fey|3}}") == [("Feybane", "Bool", 1)]
    assert _map("{{Blast|Flaming|6}}") == [("Flaming Blast", "Bool", 1)]
    assert _map("{{Blast|Flaming|Greater}}") == [("Greater Flaming Blast", "Bool", 1)]


def test_absorption_reads_the_branches_that_name_a_bonus_type():
    assert _map("{{Absorption|Fire|10}}") == [("Fire Absorption", "Enhancement", 10)]
    assert _map("{{Absorption|Electricity|5}}") == [("Electric Absorption", "Enhancement", 5)]
    assert _map("{{Absorption|lightning|5|||Insight}}") == [("Electric Absorption", "Insight", 5)]
    assert _map("{{Absorption|Fire and Cold|8}}") == [("Fire and Cold Absorption", "Enhancement", 8)]
    assert _map("{{Absorption|Elemental|10}}") == [("Elemental Absorption", "Enhancement", 10)]


def test_absorption_forms_with_no_stated_bonus_type_are_declined():
    # The negative-energy branch renders "absorbs N% of all negative damage" with
    # no bonus type; the charge forms are clickies. Neither is a typed magnitude.
    for line in ("{{Absorption|Negative|20}}", "{{Absorption|Negative Energy|0|10}}",
                 "{{Absorption|Spell|0|20|no}}", "{{Absorption|Elemental|15|yes}}"):
        try:
            _map(line)
        except E.Declined:
            continue
        raise AssertionError(f"{line} must be Declined")


def test_speed_reads_an_integer_and_a_roman_numeral_alike():
    assert _map("{{Speed|15}}") == [("Speed", "Enhancement", 15)]
    assert _map("{{Speed|XV}}") == [("Speed", "Enhancement", 15)]
    assert _map("{{Speed|-10}}") == [("Speed", "Penalty", -10)]


def test_diversion_reads_the_kind_from_p2_and_the_bonus_type_from_p3():
    assert _map("{{Diversion|18|Mystic|Insightful}}") == [("Mystic Diversion", "Insight", 18)]
    assert _map("{{Diversion|8}}") == [("Diversion", "Enhancement", 8)]
    for line in ("{{Diversion|4|Insightful}}", "{{Diversion|10||Old}}"):
        try:
            _map(line)
        except E.Declined:
            continue
        raise AssertionError(f"{line} must be Declined")


def test_the_remaining_typed_effects():
    assert _map("{{Parrying|IV}}") == [("Parrying", "Insight", 4)]
    assert _map("{{ProtectionBonus|5}}") == [("Armor Class", "Deflection", 5)]
    assert _map("{{Incite|23||Distant}}") == [("Distant Incite", "Enhancement", 23)]
    assert _map("{{Spell Resistance|20}}") == [("Spell Resistance", "Enhancement", 20)]
    assert _map("{{Armor-Piercing|10%}}") == [("Armor-Piercing", "Enhancement", 10)]
    assert _map("{{Deception|5}}") == [("Deception", "Enhancement", 5)]


def test_a_declined_call_leaves_the_items_other_values_readable():
    mapped, unmapped = E.affixes("* {{Stat|STR|6}}\n* {{Ghostly|Enhanced}}")
    assert mapped == [("Strength", "Enhancement", 6)]
    assert unmapped == [("Ghostly", E.DECLINED + "Enhanced Ghostly")]


def test_a_declined_call_beside_a_read_call_of_its_template_is_not_declined():
    # The merge could pair gear-planner's affix for the declined call with ours.
    _, unmapped = E.affixes("* {{Diversion|8}}\n* {{Diversion|10||Old}}")
    assert unmapped == [("Diversion", "legacy Diversion (old)")]
