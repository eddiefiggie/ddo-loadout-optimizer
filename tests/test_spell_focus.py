"""U1/U2/U3 (#205) — universal spell-DC expansion.

The load-bearing cases are the exclusions and the set-bonus channel. A test that
only proves "Spell Focus Mastery expands" would pass against a module that also
expanded Rune Arm Focus or spell lore, both of which would be real regressions.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import spell_focus  # noqa: E402

VIA = spell_focus.PROVENANCE_KEY


def _aff(stat, bt="Equipment", val=3, **extra):
    """An in-memory pipeline affix: `{stat, bonus_type, ...}`, not the at-rest shape."""
    return {"stat": stat, "bonus_type": bt, "value": val,
            "unit": "flat", "raw": "", "eligible": True, **extra}


# ---- what counts as universal -------------------------------------------------

def test_both_universal_names_are_recognized():
    assert spell_focus.is_universal("Spell Focus Mastery")
    assert spell_focus.is_universal("Spell Focus")


def test_detection_is_case_and_whitespace_insensitive():
    assert spell_focus.is_universal("  spell focus mastery ")


def test_rune_arm_focus_is_not_universal():
    # Wiki: "isn't directly tied to a Spell School but to the Rune Arm itself."
    assert not spell_focus.is_universal("Rune Arm Focus")


def test_deific_focus_is_not_universal():
    # No wiki article exists; quarantined rather than inferred from the name.
    assert not spell_focus.is_universal("Deific Focus")


def test_school_specific_names_are_not_universal():
    for school in spell_focus.SCHOOLS:
        assert not spell_focus.is_universal(school), school


def test_spell_lore_is_not_universal():
    # docs/wiki-evidence/spell-lore.md: universal and element lore genuinely
    # STACK. Treating either as an umbrella would collapse two real sources.
    for name in ("Spell Lore", "Universal Spell Lore", "Void Lore", "Fire Lore"):
        assert not spell_focus.is_universal(name), name


def test_unrelated_focus_names_are_not_universal():
    for name in ("Breath Weapon Focus", "Equipoised Focus", "Raging Focus",
                 "Weapon Focus: Falchion", "Dragonshard Focus: Sentinel"):
        assert not spell_focus.is_universal(name), name


# ---- item channel -------------------------------------------------------------

def test_universal_affix_becomes_seven_schools():
    out = spell_focus.expand_affixes([_aff("Spell Focus Mastery", "Sacred", 3)])
    assert [a["stat"] for a in out] == spell_focus.SCHOOLS
    assert len(out) == 7


def test_expansion_preserves_bonus_type_and_value():
    out = spell_focus.expand_affixes([_aff("Spell Focus Mastery", "Sacred", 3)])
    assert all(a["bonus_type"] == "Sacred" for a in out)
    assert all(a["value"] == 3 for a in out)


def test_expansion_preserves_unrelated_keys():
    out = spell_focus.expand_affixes([_aff("Spell Focus Mastery", eligible=False)])
    assert all(a["eligible"] is False for a in out)
    assert all(a["unit"] == "flat" for a in out)


def test_original_universal_name_is_gone():
    out = spell_focus.expand_affixes([_aff("Spell Focus Mastery")])
    assert not any(spell_focus.is_universal(a["stat"]) for a in out)


def test_bare_spell_focus_expands_identically():
    # Stormreaver's Napkin shape: the wiki's worked example credits it as
    # "+1 to her DCs", plural.
    out = spell_focus.expand_affixes([_aff("Spell Focus", "Equipment", 1)])
    assert [a["stat"] for a in out] == spell_focus.SCHOOLS


def test_excluded_affixes_pass_through_untouched():
    source = [_aff("Rune Arm Focus", "Equipment", 4),
              _aff("Void Lore"), _aff("Universal Spell Lore", "Exceptional", 5),
              _aff("Necromancy Focus"), _aff("Deific Focus", "Sacred", 3)]
    assert spell_focus.expand_affixes(source) == source


def test_expander_does_not_mutate_its_input():
    source = [_aff("Spell Focus Mastery")]
    snapshot = [dict(a) for a in source]
    spell_focus.expand_affixes(source)
    assert source == snapshot


# ---- set-bonus channel (the one `Parrying` missed) ----------------------------

def test_set_bonus_tier_expands():
    variants = [{"affixes": [], "parsed_set_bonuses": [
        {"affixes": [_aff("Spell Focus Mastery", "Profane", 1)]}]}]
    spell_focus.expand_variants(variants)
    tier = variants[0]["parsed_set_bonuses"][0]["affixes"]
    assert [a["stat"] for a in tier] == spell_focus.SCHOOLS
    assert all(a["bonus_type"] == "Profane" for a in tier)


def test_artifact_typed_set_bonus_expands():
    variants = [{"affixes": [], "parsed_set_bonuses": [
        {"affixes": [_aff("Spell Focus Mastery", "Artifact", 2)]}]}]
    spell_focus.expand_variants(variants)
    tier = variants[0]["parsed_set_bonuses"][0]["affixes"]
    assert len(tier) == 7
    assert all(a["value"] == 2 for a in tier)


def test_school_specific_set_bonus_is_untouched():
    source = [_aff("Evocation Focus", "Artifact", 2)]
    variants = [{"affixes": [], "parsed_set_bonuses": [{"affixes": list(source)}]}]
    spell_focus.expand_variants(variants)
    assert variants[0]["parsed_set_bonuses"][0]["affixes"] == source


def test_reports_both_channels_separately():
    # A zero here after a refactor means one channel stopped being reached — the
    # failure mode that shipped a set bonus granting an expanded-away stat.
    variants = [{
        "affixes": [_aff("Spell Focus Mastery")],
        "parsed_set_bonuses": [{"affixes": [_aff("Spell Focus Mastery", "Profane", 1)]}],
    }]
    stats = spell_focus.expand_variants(variants)
    assert stats["items"] == 1
    assert stats["set_bonuses"] == 1


def test_variant_with_no_set_bonuses_is_safe():
    variants = [{"affixes": [_aff("Spell Focus Mastery")]}]
    assert spell_focus.expand_variants(variants)["set_bonuses"] == 0


# ---- provenance ---------------------------------------------------------------

def test_expanded_affix_names_its_source_enchantment():
    out = spell_focus.expand_affixes([_aff("Spell Focus Mastery", "Sacred", 3)])
    assert all(a[VIA] == "Sacred Spell Focus Mastery" for a in out)


def test_equipment_type_uses_the_unprefixed_name():
    out = spell_focus.expand_affixes([_aff("Spell Focus Mastery", "Equipment", 5)])
    assert out[0][VIA] == "Spell Focus Mastery"


def test_insight_type_renders_as_insightful():
    out = spell_focus.expand_affixes([_aff("Spell Focus Mastery", "Insight", 4)])
    assert out[0][VIA] == "Insightful Spell Focus Mastery"


def test_native_school_affix_carries_no_provenance():
    out = spell_focus.expand_affixes([_aff("Necromancy Focus", "Sacred", 3)])
    assert VIA not in out[0]


# ---- expanded-away registration ----------------------------------------------

def test_both_names_map_to_the_seven_schools():
    away = spell_focus.expanded_away()
    assert set(away) == {"spell focus mastery", "spell focus"}
    assert all(v == spell_focus.SCHOOLS for v in away.values())


def test_expanded_away_keys_are_lowercased():
    assert all(k == k.lower() for k in spell_focus.expanded_away())


def test_expanded_away_returns_independent_lists():
    away = spell_focus.expanded_away()
    away["spell focus"].append("Tampered")
    assert spell_focus.expanded_away()["spell focus"] == spell_focus.SCHOOLS
