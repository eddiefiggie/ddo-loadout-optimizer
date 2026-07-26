"""M4b — enrichment parser tests (strict template->affix rendering).

Examples are real wikitext lines surveyed from live DDO wiki endgame items.
Each rendered affix string is round-tripped through the actual affix_parser to
prove enrichment output is consumable by the existing pipeline (no bespoke format).
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import enrich  # noqa: E402
from src.affix_parser import parse_line  # noqa: E402


def _field(*lines):
    return "\n".join("* " + l for l in lines)


def _affixes(field):
    return enrich.parse_enhancement_field(field)["enhancements"]


def test_stat_ability_canonicalizes_and_types():
    r = enrich.parse_enhancement_field(_field("{{Stat|CON|13}}", "{{Stat|con|6|Insightful}}"))
    assert r["enhancements"] == ["Constitution +13", "Insightful Constitution +6"]


def test_stat_well_rounded_profane():
    assert _affixes(_field("{{Stat|Well Rounded|2|Profane}}")) == ["Profane Well Rounded +2"]


def test_skills_and_spellpower_and_focus():
    assert _affixes(_field("{{Skills|Jump|21}}")) == ["Jump +21"]
    assert _affixes(_field("{{SpellPower|Devotion|146}}")) == ["Devotion +146"]
    assert _affixes(_field("{{Spell Focus|Abjuration|7}}")) == ["Abjuration Spell Focus +7"]


def test_spell_focus_typed_and_universal():
    # typed school focus keeps its bonus type
    assert _affixes(_field("{{Spell Focus|Abjuration|3|Insightful}}")) == ["Insightful Abjuration Spell Focus +3"]
    # universal (value-first) focus
    assert _affixes(_field("{{Spell Focus|5|Insightful}}")) == ["Insightful Spell Focus +5"]


def test_save_carries_type_normalizes_case_and_rejects_typos():
    # bonus type carried (was silently dropped -> Enhancement)
    assert _affixes(_field("{{Save|Reflex|11|Resistance}}")) == ["Resistance Reflex Save +11"]
    # lowercase wiki arg normalized so saves aggregate ("will" -> "Will")
    assert _affixes(_field("{{Save|will|12}}")) == ["Will Save +12"]
    # malformed school (wiki typo {{Save|r|11}}) recorded unmapped, not emitted as junk
    r = enrich.parse_enhancement_field(_field("{{Save|r|11}}"))
    assert r["enhancements"] == [] and r["unmapped"] == ["Save"]


def test_elem_res_and_absorption_carry_type_and_need_element():
    assert _affixes(_field("{{Elemental Resistance|Fire|56|Insightful}}")) == ["Insightful Fire Resistance +56"]
    assert _affixes(_field("{{Absorption|Fire|20|Insightful}}")) == ["Insightful Fire Absorption +20%"]
    # element-less (numeric first arg) -> unmapped, never a bare "Resistance"
    assert enrich.parse_enhancement_field(_field("{{Elemental Resistance|15}}"))["enhancements"] == []


def test_stat_and_skills_reject_numeric_type_slot():
    # a stray numeric 4th arg must not become a bonus type ("5 Jump")
    assert _affixes(_field("{{Skills|Jump|21|5}}")) == ["Jump +21"]
    assert _affixes(_field("{{Stat|CON|13|5}}")) == ["Constitution +13"]


def test_sheltering_rejects_junk_bonus_type():
    # only a real DDO bonus type is treated as the type; "Guard" is dropped, not
    # folded into the stat name
    assert _affixes(_field("{{Sheltering|9|Physical|Guard}}")) == ["Physical Sheltering +9"]
    assert _affixes(_field("{{Sheltering|9|Quality|Magical}}")) == ["Quality Magical Sheltering +9"]


def test_idiomatic_wiki_spacing_parses():
    # "{{ Stat | CON | 13 }}" (spaces around name/args) must parse, not silently unmap
    assert _affixes(_field("{{ Stat | CON | 13 }}")) == ["Constitution +13"]
    assert _affixes(_field("{{ Skills | Jump | 21 }}")) == ["Jump +21"]


def test_malformed_template_line_recorded_not_dropped():
    # a template with trailing prose is recorded as unmapped (honest), not silently lost
    r = enrich.parse_enhancement_field("* {{Clicky|Rage}} on hit, 3/rest")
    assert r["enhancements"] == [] and r["unmapped"] == ["Clicky"]


def test_spell_power_and_lore_spaced_aliases_and_types():
    # both {{SpellPower|...}} and the armor {{Spell Power|...}} spaced form map,
    # and a trailing bonus type is carried, not dropped.
    assert _affixes(_field("{{SpellPower|Devotion|146}}")) == ["Devotion +146"]
    assert _affixes(_field("{{Spell Power|Universal|15|Exceptional}}")) == ["Exceptional Universal +15"]
    assert _affixes(_field("{{Spell Lore|Universal Spell|5|Exceptional}}")) == ["Exceptional Universal Spell Lore +5%"]


def test_hp_typed_and_multiarg():
    assert _affixes(_field("{{Hp|False Life|56}}")) == ["False Life +56"]
    assert _affixes(_field("{{Hp|False Life|56|Insightful}}")) == ["Insightful False Life +56"]
    assert _affixes(_field("{{Hp|Vitality|20}}")) == ["Vitality +20"]


def test_sheltering_prr_mrr():
    assert _affixes(_field("{{Sheltering|9|Quality|Physical}}")) == ["Quality Physical Sheltering +9"]
    assert _affixes(_field("{{Sheltering|12|Magical}}")) == ["Magical Sheltering +12"]
    assert _affixes(_field("{{Sheltering|7}}")) == ["Physical Sheltering +7"]


def test_resistance_and_absorption_units():
    assert _affixes(_field("{{Elemental Resistance|Fire|56}}")) == ["Fire Resistance +56"]
    assert _affixes(_field("{{Absorption|Poison|39}}")) == ["Poison Absorption +39%"]


def test_healamp_kinds_and_types():
    assert _affixes(_field("{{HealingAmp|14|N|Quality}}")) == ["Quality Negative Healing Amplification +14"]
    assert _affixes(_field("{{HealingAmp|15|Healing|Exceptional}}")) == ["Exceptional Positive Healing Amplification +15"]
    assert _affixes(_field("{{HealingAmp|15|Repair|Quality}}")) == ["Quality Repair Amplification +15"]
    # unknown kind is not guessed
    assert enrich.parse_enhancement_field(_field("{{HealingAmp|10|Bogus}}"))["enhancements"] == []


def test_armor_piercing_tactics_incite():
    assert _affixes(_field("{{Armor-Piercing|21}}")) == ["Armor-Piercing +21"]
    assert _affixes(_field("{{Armor-Piercing|11|Insightful}}")) == ["Insightful Armor-Piercing +11"]
    assert _affixes(_field("{{Tactics|Combat Mastery|10}}")) == ["Combat Mastery +10"]
    assert _affixes(_field("{{Incite|124}}")) == ["Incite +124"]
    # non-numeric value (roman numeral) is rejected, not fabricated
    assert enrich.parse_enhancement_field(_field("{{Speed|XIV}}"))["enhancements"] == []


def test_named_value_family():
    assert _affixes(_field("{{Fortification|156}}")) == ["Fortification +156"]
    assert _affixes(_field("{{Deadly|3|Quality}}")) == ["Quality Deadly +3"]
    assert _affixes(_field("{{Dodge|13}}")) == ["Dodge +13%"]
    assert _affixes(_field("{{Seeker|13}}")) == ["Seeker +13"]


def test_augment_and_sets_are_separated():
    r = enrich.parse_enhancement_field(_field(
        "{{Augment|yellow}}", "{{Augment|Colorless}}",
        "{{Named item sets|Adherent of the Mists Set (Legendary)}}"))
    assert r["augment_slots"] == ["Yellow", "Colorless"]
    assert r["sets"] == ["Adherent of the Mists Set (Legendary)"]
    assert r["enhancements"] == []  # not affixes


def test_unmapped_effects_are_recorded_not_guessed():
    r = enrich.parse_enhancement_field(_field(
        "{{Clicky|Rage (spell)|15|5|5|label=Rage}}",
        "{{Immunity|Intercession Ward}}",
        "{{Ghostly}}"))
    assert r["enhancements"] == []
    assert set(r["unmapped"]) == {"Clicky", "Immunity", "Ghostly"}


def test_nearly_complete_open_slot_sets_host_field():
    # {{Nearly Complete|<category>}} activates the item as a U81 NC host
    r = enrich.parse_enhancement_field(_field("{{Nearly Complete|Ability Score|1}}"))
    assert r["nearly_complete"] == "Ability Score"
    assert r["enhancements"] == []  # the slot is not itself an affix
    rec = enrich.build_item_record("Test Robe", "Armor", _field("{{Nearly Complete|Skill|1}}"),
                                   "w", minimum_level=35)
    assert rec["nearly_complete"] == "Skill"


def test_nearly_complete_unknown_category_recorded_not_hosted():
    # a category not in the NC pool must not silently become a host
    r = enrich.parse_enhancement_field(_field("{{Nearly Complete|Bogus Category|1}}"))
    assert r["nearly_complete"] is None
    assert r["unmapped"] == ["Nearly Complete"]


def test_nearly_finished_becomes_a_choice_slot_roll_group():
    # inline choice-slot: choose one of the listed ability options
    r = enrich.parse_enhancement_field(_field("{{Nearly Finished|{{Stat|str|13}}|{{Stat|dex|13}}|{{Stat|con|13}}}}"))
    assert r["enhancements"] == ["Rolls one of: Strength +13 / Dexterity +13 / Constitution +13"]
    # and the affix_parser turns it into a real option group
    res = parse_line(r["enhancements"][0])
    assert res["kind"] == "rolls"
    stats = [(o["stat"], o["bonus_type"], o["value"]) for o in res["options"]]
    assert stats == [("Strength", "Enhancement", 13), ("Dexterity", "Enhancement", 13), ("Constitution", "Enhancement", 13)]
    # mixed bonus types are preserved as distinct options
    r2 = enrich.parse_enhancement_field(_field("{{Nearly Finished|{{Stat|WIS|13}}|{{Stat|wis|6|Insightful}}|{{Stat|wis|3|Quality}}}}"))
    assert r2["enhancements"] == ["Rolls one of: Wisdom +13 / Insightful Wisdom +6 / Quality Wisdom +3"]


def test_unhandled_nested_composite_is_skipped():
    # a genuinely-unhandled wrapper with a sub-template arg must record, not harvest inner
    r = enrich.parse_enhancement_field(_field("{{Some Wrapper|{{Stat|CON|13}}}}"))
    assert r["enhancements"] == []
    assert r["unmapped"] == ["Some Wrapper"]


def test_rendered_strings_are_parseable_by_affix_parser():
    """Every enrichment affix string must be consumable by the real parser."""
    field = _field(
        "{{Stat|CON|13}}", "{{Stat|Well Rounded|2|Profane}}", "{{Skills|Jump|21}}",
        "{{Sheltering|9|Quality|Physical}}", "{{Elemental Resistance|Fire|56}}",
        "{{SpellPower|Devotion|146}}", "{{Spell Focus|Abjuration|7}}",
        "{{Fortification|156}}", "{{Deadly|3|Quality}}", "{{Absorption|Poison|39}}")
    for s in _affixes(field):
        res = parse_line(s)
        assert res["kind"] == "affix", f"{s!r} did not parse to an affix: {res}"
        assert res["affixes"][0]["value"] != 0


def test_specific_parse_results():
    """Spot-check that stat/type/value land correctly through the parser."""
    a = parse_line("Profane Well Rounded +2")["affixes"][0]
    assert (a["stat"], a["bonus_type"], a["value"]) == ("Well Rounded", "Profane", 2)
    a = parse_line("Quality Physical Sheltering +9")["affixes"][0]
    assert (a["stat"], a["bonus_type"], a["value"]) == ("Physical Sheltering", "Quality", 9)
    a = parse_line("Poison Absorption +39%")["affixes"][0]
    assert (a["stat"], a["value"], a["unit"]) == ("Poison Absorption", 39, "pct")


def test_shipped_batch_flows_through_pipeline_to_verified():
    """The committed first enrichment batch must parse->verify into solver-active
    variants through the real pipeline (integration, not just the renderer)."""
    import json
    from src.variants import expand_dataset
    from src import verify as verify_mod
    p = os.path.join(ROOT, "data", "seed", "compendium", "enriched_batch1.json")
    assert os.path.exists(p), "shipped enriched batch must exist"
    items = json.load(open(p, encoding="utf-8")).get("items", [])
    assert items, "enriched batch should carry items"
    variants, _ = verify_mod.apply(expand_dataset(items))
    verified = [v for v in variants if v.get("verification") == "verified"]
    # every batch1 item carries mapped affixes, so all must verify (exact, not >=)
    assert len(verified) == len(items), f"expected all {len(items)} enriched items verified, got {len(verified)}"
    faith = [v for v in variants if v.get("source_item", "").startswith("Legendary Band of Faith")]
    assert faith, "known enriched item present"
    assert any(a["stat"] == "Fortification" and a["value"] == 156 for a in faith[0].get("affixes", [])), \
        "enriched affix parsed correctly through the pipeline"


def test_build_item_record_shape():
    field = _field("{{Stat|CON|13}}", "{{Augment|yellow}}",
                   "{{Named item sets|Test Set}}", "{{Ghostly}}")
    rec = enrich.build_item_record("Test Ring", "Ring", field,
                                   "https://ddowiki.com/page/Item:Test_Ring",
                                   minimum_level=34)
    assert rec["name"] == "Test Ring" and rec["slot"] == "Ring"
    assert rec["minimum_level"] == 34
    assert "Constitution +13" in rec["enhancements"]
    assert "Yellow Augment Slot" in rec["enhancements"]
    assert "Test Set (set)" in rec["enhancements"]
    assert rec["augment_slots"] == ["Yellow"]
    assert rec["_enrich_unmapped"] == ["Ghostly"]


def test_build_item_record_derives_category_from_slot():
    # Category routes an item to a solver slot: a weapon reaches Main Hand only as
    # category "weapon", a rune arm only as "runearm" (model.js routes by category).
    # The constructor must derive this from slot — the old hardcoded "item" default
    # silently stranded 43 enriched weapons browse-only. Regression guard.
    field = _field("{{Stat|STR|15}}")
    weapon = enrich.build_item_record("Test Sword", "Weapon", field, "u")
    runearm = enrich.build_item_record("Test Arm", "Rune Arm", field, "u")
    worn = enrich.build_item_record("Test Ring", "Ring", field, "u")
    offhand = enrich.build_item_record("Test Shield", "Off Hand", field, "u")
    assert weapon["category"] == "weapon"
    assert runearm["category"] == "runearm"
    assert worn["category"] == "item"
    # Off Hand has no solver slot yet — shields stay browse-only "item", not weapon.
    assert offhand["category"] == "item"
