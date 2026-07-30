"""U2 affix-parser tests.

Two oracles per the plan:
  (a) essence_crafting_verification.per_item_affix_layout — effect identity /
      position only (no magnitudes).
  (b) a hand-checked spot set carrying explicit {stat, bonus_type, value} — the
      only oracle for the tuple fields.

Plus a whole-seed sweep asserting no exceptions, noise filtered, and value-less
lines flagged (not fatal), which is what the per-affix eligibility model (KTD5)
relies on.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.affix_parser import (  # noqa: E402
    parse_line, parse_enhancements, set_boolean_features)

SEED = os.path.join(os.path.dirname(__file__), "..", "data", "seed", "ddo_items.json")


def _affixes(line):
    """Return the list of affix dicts parse_line produced (may be empty)."""
    return parse_line(line)["affixes"]


def _one(line):
    a = _affixes(line)
    assert len(a) == 1, f"expected 1 affix for {line!r}, got {a}"
    return a[0]


# --- (b) hand-checked spot set: explicit {stat, bonus_type, value, unit} ---

def test_untyped_defaults_to_enhancement():
    a = _one("Intelligence +13")
    assert (a["stat"], a["bonus_type"], a["value"], a["unit"]) == (
        "Intelligence", "Enhancement", 13, "flat")


def test_typed_leading_word():
    assert _one("Quality Intelligence +3")["bonus_type"] == "Quality"
    a = _one("Insightful Constitution +4")
    assert (a["stat"], a["bonus_type"], a["value"]) == ("Constitution", "Insightful", 4)


def test_non_type_leading_word_stays_in_stat():
    # "Physical" is not a bonus type — it is part of the stat name.
    a = _one("Physical Sheltering +24")
    assert a["stat"] == "Physical Sheltering"
    assert a["bonus_type"] == "Enhancement"
    assert a["value"] == 24


def test_percent_unit():
    a = _one("Fortification +94%")
    assert a["value"] == 94 and a["unit"] == "pct"
    # no leading '+' still parses
    assert _one("Armor-Piercing 12%")["value"] == 12


def test_value_first_weapon_base():
    a = _one("+5 Enhancement Bonus")
    assert a["bonus_type"] == "Enhancement" and a["value"] == 5 and a["unit"] == "flat"


def test_trailing_paren_bonus_type():
    a = _one("Disable Device +19 (Competence)")
    assert (a["stat"], a["bonus_type"], a["value"]) == ("Disable Device", "Competence", 19)
    a2 = _one("Constitution +14 (Enhancement bonus)")
    assert (a2["stat"], a2["bonus_type"], a2["value"]) == ("Constitution", "Enhancement", 14)


def test_trailing_paren_named_effect():
    # "Damage +8 (Deadly)" -> the Deadly effect at magnitude 8.
    a = _one("Damage +8 (Deadly)")
    assert a["stat"] == "Deadly" and a["value"] == 8


def test_multi_stat_line():
    affixes = _affixes("Defense (Sheltering) +24 (PRR/MRR)")
    stats = sorted(x["stat"] for x in affixes)
    assert stats == ["MRR", "PRR"]
    assert all(x["value"] == 24 for x in affixes)


def test_no_plus_named_value():
    a = _one("Bleeding 4")
    assert a["stat"] == "Bleeding" and a["value"] == 4


def test_ml_scaling_is_flagged_scaling():
    r = parse_line("Dodge % (Enhancement; +1% ML1 up to +14% ML32)")
    assert r["kind"] == "scaling"
    s = r["scaling"]
    assert s["stat"] == "Dodge" and s["unit"] == "pct"
    assert s["val_lo"] == 1 and s["val_hi"] == 14
    assert s["ml_lo"] == 1 and s["ml_hi"] == 32


def test_rolls_option_group():
    r = parse_line("Rolls one of: Dexterity +8 / Intelligence +8 / Dodge +8%")
    assert r["kind"] == "rolls"
    assert len(r["options"]) == 3
    dex = [o for o in r["options"] if o["stat"] == "Dexterity"][0]
    assert dex["value"] == 8


def test_noise_lines_filtered():
    for noise in ["Blue Augment Slot", "Wallwatch (set)",
                  "Adherent of the Mists (Legendary set)",
                  "Lamordia weapon slots: Melancholic / Dolorous / Miserable / Woeful"]:
        r = parse_line(noise)
        assert r["kind"] == "noise", f"{noise!r} should be noise, got {r['kind']}"
        assert r["affixes"] == []


def test_value_less_named_is_flagged_not_fatal():
    for named in ["Blindness Immunity", "True Seeing", "Ghostly", "Accuracy"]:
        r = parse_line(named)
        assert r["kind"] == "unparsed"
        assert r["affixes"] == []
        assert r.get("reason")


# --- (a) essence-crafting effect-identity coverage ---

def test_essence_crafting_effects_surfaced_by_parser():
    """Run the essence-crafted items' real lines THROUGH the parser and assert
    the ground-truth effect identities (Seeker/Deadly/Search/Spot) are surfaced
    (as affixes or flagged), never silently dropped as noise. This ties parser
    output to oracle (a) — the earlier version grepped the seed and tested
    nothing about the parser."""
    d = json.load(open(SEED, encoding="utf-8"))
    surfaced = set()
    for item in d["items"]:
        if item["category"] != "essence_crafted":
            continue
        for line in item.get("enhancements", []):
            r = parse_line(line)
            # an essence effect name must not be classified as noise
            for effect in ["Seeker", "Deadly", "Search", "Spot"]:
                if effect in line:
                    assert r["kind"] != "noise", f"{line!r} wrongly dropped as noise"
                    surfaced.add(effect)
    # the goggles guarantee Seeker and Deadly are present in the seed
    assert {"Seeker", "Deadly"} <= surfaced


def test_negative_magnitude_keeps_its_sign():
    a = _one("Concentration -50")
    assert a["stat"] == "Concentration" and a["value"] == -50


def test_dice_crit_proc_lines_are_not_affixes():
    for line in ["Crit 18-20/x3", "Burning Ammunition 1d8", "Crit 19-20/x2",
                 "Blur (3 charges, 3/day)"]:
        r = parse_line(line)
        assert r["kind"] == "unparsed", f"{line!r} should be unparsed, got {r['kind']}"
        assert r["affixes"] == []


def test_value_first_percent_unit():
    a = _one("+15% attack speed")
    assert a["value"] == 15 and a["unit"] == "pct" and a["stat"] == "attack speed"


def test_trailing_paren_unknown_qualifier_falls_back_to_outer():
    a = _one("Sheltering +10 (Feywild)")
    assert a["stat"] == "Sheltering" and a["value"] == 10


def test_empty_and_none_lines_are_noise():
    assert parse_line("")["kind"] == "noise"
    assert parse_line(None)["kind"] == "noise"
    assert parse_line("   ")["kind"] == "noise"
    r = parse_enhancements(None)
    assert r == {"affixes": [], "flagged": [], "scaling": [], "rolls": []}


def test_scaling_extracts_bonus_type():
    s = parse_line("Dodge % (Enhancement; +1% ML1 up to +14% ML32)")["scaling"]
    assert s["bonus_type"] == "Enhancement"


# --- whole-seed sweep: no exceptions, per-affix tolerance ---

def test_whole_seed_parses_without_exceptions():
    d = json.load(open(SEED, encoding="utf-8"))
    total_lines = 0
    eligible = 0
    for item in d["items"]:
        res = parse_enhancements(item.get("enhancements", []))
        # parse_enhancements must never raise and must always return the buckets
        assert set(res) >= {"affixes", "flagged", "scaling", "rolls"}
        total_lines += len(item.get("enhancements", []))
        eligible += len(res["affixes"])
    # A meaningful fraction of lines yield clean value-bearing affixes.
    assert eligible > 200, f"only {eligible} eligible affixes parsed from the seed"


# --- bonus-type vocabulary: Equipment / Resistance / Insight (Dino pool) ---

def test_equipment_and_insight_bonus_types_recognized():
    # Value-first Dino lines: the leading type word must become the bonus_type.
    eq = parse_line("+9 Equipment bonus to Spell Penetration")["affixes"][0]
    assert eq["bonus_type"] == "Equipment" and eq["stat"] == "Spell Penetration" and eq["value"] == 9
    ins = parse_line("+10% Insight bonus to Fire Spell Crit Damage")["affixes"][0]
    assert ins["bonus_type"] == "Insight" and ins["stat"] == "Fire Spell Crit Damage"


def test_resistance_as_type_vs_bare_stat():
    # "Resistance" is BOTH a bonus type and a bare stat name; the parser must not
    # peel it when nothing remains as the stat (regression: this produced stat="").
    bare = parse_line("Resistance +3")["affixes"][0]
    assert bare["stat"] == "Resistance" and bare["bonus_type"] == "Enhancement" and bare["value"] == 3
    typed = parse_line("+12 Resistance bonus to all Saving Throws")["affixes"][0]
    assert typed["bonus_type"] == "Resistance" and typed["stat"] == "all Saving Throws"


def test_insight_is_distinct_from_insightful():
    # Distinct stacking buckets — they must not collapse into one type.
    a = parse_line("Insight Constitution +5")["affixes"][0]
    b = parse_line("Insightful Constitution +5")["affixes"][0]
    assert a["bonus_type"] == "Insight"
    assert b["bonus_type"] == "Insightful"
    assert a["bonus_type"] != b["bonus_type"]


# --- (U2) boolean-feature allowlist: value-less toggles become presence ---

def test_allowlisted_value_less_line_is_presence_affix():
    # An allowlisted value-less feature parses to {stat, boolean, 1} instead of
    # being dropped as unparsed.
    try:
        set_boolean_features(["Salt"])
        r = parse_line("Salt")
        assert r["kind"] == "affix"
        a = r["affixes"][0]
        assert (a["stat"], a["bonus_type"], a["value"]) == ("Salt", "boolean", 1)
    finally:
        set_boolean_features([])


def test_non_allowlisted_value_less_line_stays_unparsed():
    # A value-less line NOT on the allowlist is still dropped, even when the
    # allowlist holds other entries — no boolean is minted for procs/immunities.
    try:
        set_boolean_features(["Salt"])
        for named in ["Blindness Immunity", "True Seeing", "Accuracy"]:
            r = parse_line(named)
            assert r["kind"] == "unparsed", f"{named!r} should stay unparsed"
            assert r["affixes"] == []
    finally:
        set_boolean_features([])


def test_empty_allowlist_emits_no_boolean():
    # The exclude-until-verified default: with no allowlist, no value-less line
    # becomes a boolean affix — parsing behavior is unchanged.
    set_boolean_features([])
    r = parse_line("Salt")
    assert r["kind"] == "unparsed"
    assert r["affixes"] == []


def test_allowlist_ignores_underscore_and_non_string_entries():
    # Mirrors load_boolean_features filtering: `_README` docs and non-strings are
    # never treated as real features.
    try:
        set_boolean_features(["_README: docs", 123, None, "Salt"])
        assert parse_line("_README: docs")["kind"] == "unparsed"
        assert parse_line("Salt")["kind"] == "affix"
    finally:
        set_boolean_features([])


def test_allowlisted_boolean_does_not_stack_across_sources():
    # Two lines of the same boolean feature within one item collapse to a single
    # presence affix per line (value 1 each); the solver's bucket does the actual
    # non-stacking, but the parser must consistently emit value 1.
    try:
        set_boolean_features(["Salt"])
        parsed = parse_enhancements(["Salt", "Salt"])
        salt = [a for a in parsed["affixes"] if a["stat"] == "Salt"]
        assert len(salt) == 2
        assert all(a["value"] == 1 and a["bonus_type"] == "boolean" for a in salt)
    finally:
        set_boolean_features([])
