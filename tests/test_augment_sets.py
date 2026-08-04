"""U1 — Augment Sets (21 "Set Augment: X" Colorless augments). Validates the seed
data/seed/compendium/augment_sets.json builds into the SAME def shape the
membership/intrinsic set path emits: {set_name: {tiers:[{pieces_required, affixes,
...}], tier, wiki_url}} with pre-typed, umbrella-expanded {stat, bonus_type, value}
affixes. Data + defs only; solver wiring is a later unit.

Evidence: docs/wiki-evidence/augment-sets.md (Chrome-MCP DOM read, verified 2026-08-04)."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src import membership  # noqa: E402
from src.affix_parser import BONUS_TYPES  # noqa: E402

SEED_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "seed",
                         "compendium", "augment_sets.json")

# The 21 canonical Set Augment names (docs/wiki-evidence/augment-sets.md table).
EXPECTED = {
    "Alluring Elocution", "Arcane Barrier", "Arcane Guardian", "Bold Tactician",
    "Brutal Blows", "Cruel Cut", "Cunning Impact", "Dusk Raider", "Esoterica",
    "Imbued Infusion", "Legendary Bulwark", "Paragon Guard", "Perfect Silence",
    "Piercing Mind", "Quickblade", "Subtle Blade", "Touch of Power",
    "Tough Shields", "Truthful Blow", "Visions of the Beyond", "Wild Fortitude",
}


def test_seed_has_the_21_named_sets():
    seed = json.load(open(SEED_PATH, encoding="utf-8"))["sets"]
    assert set(seed) == EXPECTED, "the seed lists exactly the 21 Set Augments"


def test_all_21_defs_load_with_three_pieces_and_a_typed_affix():
    defs = membership.build_augment_set_defs()
    assert set(defs) == EXPECTED, f"all 21 sets resolve, got {sorted(defs)}"
    for name, d in defs.items():
        # single-tier, always 3 Pieces Equipped
        assert len(d["tiers"]) == 1, f"{name} is single-tier"
        tier = d["tiers"][0]
        assert tier["pieces_required"] == 3, f"{name} fires at 3 pieces"
        assert tier["affixes"], f"{name} carries at least one affix"
        for a in tier["affixes"]:
            assert a["stat"], f"{name} affix has a stat"
            assert isinstance(a["value"], int), f"{name} affix value is numeric"
            # every affix is typed: a known DDO bonus type, or the explicit Untyped marker
            assert a["bonus_type"] in BONUS_TYPES or a["bonus_type"] == "Untyped", \
                f"{name} affix carries a valid bonus type, got {a['bonus_type']!r}"


def test_bonus_values_match_the_wiki_evidence():
    defs = membership.build_augment_set_defs()

    def affix_set(name):
        return {(a["stat"], a["bonus_type"], a["value"])
                for a in defs[name]["tiers"][0]["affixes"]}

    assert ("Charisma", "Artifact", 3) in affix_set("Alluring Elocution")
    assert ("Universal Spell Power", "Artifact", 25) in affix_set("Touch of Power")
    assert ("Physical Resistance Rating", "Artifact", 30) in affix_set("Tough Shields")
    # multi-stat bonuses split into one affix per stat
    assert ("Melee Power", "Artifact", 15) in affix_set("Dusk Raider")
    assert ("Ranged Power", "Artifact", 15) in affix_set("Dusk Raider")
    assert ("Doublestrike", "Artifact", 15) in affix_set("Quickblade")
    assert ("Doubleshot", "Artifact", 15) in affix_set("Quickblade")


def test_legendary_bulwark_is_a_legendary_bonus_not_artifact():
    defs = membership.build_augment_set_defs()
    affixes = defs["Legendary Bulwark"]["tiers"][0]["affixes"]
    assert len(affixes) == 1
    a = affixes[0]
    assert a["bonus_type"] == "Legendary", "Legendary Bulwark is a LEGENDARY bonus"
    assert (a["stat"], a["value"]) == ("Maximum Hit Points", 10)
    # and nothing else in the roster leaks a Legendary type onto an Artifact set
    for name, d in defs.items():
        if name == "Legendary Bulwark":
            continue
        for a in d["tiers"][0]["affixes"]:
            assert a["bonus_type"] != "Legendary", f"{name} should be Artifact/Untyped, not Legendary"


def test_twenty_of_twentyone_are_artifact():
    defs = membership.build_augment_set_defs()
    artifact = sum(1 for name, d in defs.items()
                   if all(a["bonus_type"] == "Artifact" for a in d["tiers"][0]["affixes"]))
    assert artifact == 20, f"20 Artifact sets (+1 Legendary Bulwark), got {artifact}"


def test_malformed_entry_is_excluded_not_defaulted():
    # A set whose only affix has an unknown bonus type OR a non-numeric value must be
    # DROPPED entirely (exclude-until-verified) — never emitted as an empty/defaulted def.
    raw = {
        "_meta": {"wiki_url": "x"},
        "sets": {
            "Good Set": {"pieces_required": 3,
                         "affixes": [{"stat": "Charisma", "bonus_type": "Artifact", "value": 3}]},
            "Bad Type": {"pieces_required": 3,
                         "affixes": [{"stat": "Charisma", "bonus_type": "Legenary", "value": 3}]},
            "Bad Value": {"pieces_required": 3,
                          "affixes": [{"stat": "Charisma", "bonus_type": "Artifact", "value": "lots"}]},
            "No Stat": {"pieces_required": 3,
                        "affixes": [{"stat": "", "bonus_type": "Artifact", "value": 3}]},
            "No Threshold": {"affixes": [{"stat": "Charisma", "bonus_type": "Artifact", "value": 3}]},
        },
    }
    defs = membership.build_augment_set_defs(raw=raw)
    assert set(defs) == {"Good Set"}, f"only the valid set survives, got {sorted(defs)}"
    assert "Bad Type" not in defs and "Bad Value" not in defs


def test_partial_affix_drop_keeps_the_valid_one():
    # One good + one bad affix -> the bad affix is dropped, the set still resolves on
    # its valid affix (a set is only excluded when NOTHING valid survives).
    raw = {"sets": {"Mixed": {"pieces_required": 3, "affixes": [
        {"stat": "Strength", "bonus_type": "Artifact", "value": 3},
        {"stat": "Dexterity", "bonus_type": "Nonsense", "value": 3},
    ]}}}
    defs = membership.build_augment_set_defs(raw=raw)
    stats = {(a["stat"], a["bonus_type"]) for a in defs["Mixed"]["tiers"][0]["affixes"]}
    assert ("Strength", "Artifact") in stats
    assert ("Dexterity", "Nonsense") not in stats


def test_defs_share_the_membership_def_shape():
    # The augment-set defs resolve through the same def shape/vocabulary as the
    # intrinsic/membership catalog path: {tiers:[{pieces_required, pieces_label,
    # affixes, wiki_url}], tier, wiki_url} with the same affix keys.
    mdefs = membership.build_membership_set_defs()
    adefs = membership.build_augment_set_defs()
    sample_m = next(iter(mdefs.values()))
    sample_a = next(iter(adefs.values()))
    assert set(sample_a) >= {"tiers", "tier", "wiki_url"}
    assert set(sample_a) == set(sample_m), "same top-level def keys as membership defs"
    tier_m = sample_m["tiers"][0]
    tier_a = sample_a["tiers"][0]
    assert set(tier_a) == set(tier_m), "same tier keys as membership defs"
    for a in tier_a["affixes"]:
        assert {"stat", "bonus_type", "value"} <= set(a)


def test_umbrella_expansion_applied_to_augment_affixes():
    # An "all Ability Scores" augment affix umbrella-expands into the six abilities,
    # proving augment defs run through the SAME umbrella path membership defs use.
    raw = {"sets": {"Umb": {"pieces_required": 3, "affixes": [
        {"stat": "all Ability Scores", "bonus_type": "Artifact", "value": 2}]}}}
    defs = membership.build_augment_set_defs(raw=raw)
    stats = {a["stat"] for a in defs["Umb"]["tiers"][0]["affixes"]}
    for ability in ("Strength", "Dexterity", "Constitution",
                    "Intelligence", "Wisdom", "Charisma"):
        assert ability in stats
    assert "all Ability Scores" not in stats
