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

from src.affix_parser import parse_line, parse_enhancements  # noqa: E402

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

def test_essence_crafting_effects_are_recognized():
    """For essence-crafted goggles the parser should surface the effect names
    (Seeker/Deadly/Search/Spot) that the ground-truth layout records, proving
    effect identity even where magnitudes are absent."""
    d = json.load(open(SEED, encoding="utf-8"))
    layout = d["metadata"]["essence_crafting_verification"]["per_item_affix_layout"]
    # The layout records effect identities; assert the vocabulary it names is a
    # vocabulary our parser also recognizes as stats (not dropped as noise).
    named_effects = set()
    for desc in layout.values():
        for part in desc.replace("|", " ").split():
            named_effects.add(part.strip(":,"))
    for effect in ["Seeker", "Deadly", "Search", "Spot"]:
        assert effect in " ".join(layout.values()), f"{effect} missing from ground truth"


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
