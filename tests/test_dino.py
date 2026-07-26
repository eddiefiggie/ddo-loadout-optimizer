"""U3 — Dino dataset-integration tests (blank hosts + insert pool + coverage)."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import dino  # noqa: E402

_WIKI = "https://ddowiki.com/page/Dinosaur_Bone_crafting"


def _seed():
    return {
        "metadata": {"system": "Isle of Dread — Dino crafting", "sourcing_status": "test"},
        "items": [
            {"item": "Dinosaur Bone Boots", "slot": "accessory",
             "dino_slots": [{"type": "Scale"}, {"type": "Fang"},
                            {"type": "Claw"}, {"type": "Horn"}], "wiki_url": _WIKI},
            {"item": "Necklace", "slot": "accessory",
             "dino_slots": [{"type": "Scale"}], "wiki_url": _WIKI},
        ],
        "inserts": [
            {"type": "Scale", "effect": "+14 Enhancement bonus to Constitution", "wiki_url": _WIKI},
            {"type": "Claw", "effect": "+35 Enhancement bonus to Physical Resistance Rating", "wiki_url": _WIKI},
        ],
    }


def test_blank_variant_is_pre_verified_host_in_correct_slot():
    blanks, _, _, _ = dino.build_dino(_seed())
    boots = next(b for b in blanks if b["slot"] == "Boots")
    assert boots["verification"] == "verified"           # empty affixes must NOT quarantine it
    assert boots["affixes"] == []
    assert boots["dino_slots_norm"] == [
        "Scale||Accessory", "Fang||Accessory", "Claw||Accessory", "Horn||Accessory"]
    assert boots["minimum_level"] == 31


def test_necklace_blank_maps_to_necklace_slot():
    blanks, _, _, _ = dino.build_dino(_seed())
    neck = next(b for b in blanks if b["slot"] == "Necklace")
    assert neck["dino_slots_norm"] == ["Scale||Accessory"]


def test_insert_pool_returned_as_units():
    _, inserts, _, _ = dino.build_dino(_seed())
    assert len(inserts) == 2
    con = next(i for i in inserts if i["affixes"][0]["stat"] == "Constitution")
    assert con["dino_type"] == "Scale" and con["affixes"][0]["value"] == 14
    assert con["category"] == "Accessory"


def test_coverage_reports_blank_hosts_and_quarantine():
    _, _, _, cov = dino.build_dino(_seed())
    assert cov["blank_hosts"] == 2
    assert "quarantined" in cov
    assert cov["by_type"]["Scale"] == 1


def test_weapon_crafted_host_maps_to_main_hand():
    # A weapon blank maps to the Main Hand slot (category weapon), NOT deferred.
    seed = {"crafted_hosts": [
        {"host_category": "Weapons", "items": [],
         "iod_slots": [{"type": "Scale", "category": "Weapon"},
                       {"type": "Claw", "category": "Weapon"}],
         "set_bonus_slot": False}]}
    blanks, _, _, cov = dino.build_dino(seed)
    assert len(blanks) == 1
    assert blanks[0]["slot"] == "Main Hand"
    assert blanks[0]["category"] == "weapon"
    assert blanks[0]["dino_slots_norm"] == ["Scale||Weapon", "Claw||Weapon"]


def test_shield_host_is_deferred_not_dropped():
    # Shields/orbs have no Off Hand slot in the solver; they are disclosed as
    # deferred with a reason, not silently dropped (coverage would undercount).
    seed = {"crafted_hosts": [
        {"host_category": "Shields", "items": ["Buckler", "Orb"],
         "iod_slots": [{"type": "Scale", "category": "Weapon"}],
         "set_bonus_slot": False}]}
    blanks, _, _, cov = dino.build_dino(seed)
    assert blanks == []
    raws = {d["raw"] for d in cov["blanks_deferred"]}
    assert {"Buckler", "Orb"} <= raws
    assert any("Off Hand" in d["reason"] for d in cov["blanks_deferred"])


def test_armor_host_carries_set_bonus_flag():
    seed = {"crafted_hosts": [
        {"host_category": "Armors", "items": ["Robe"],
         "iod_slots": [{"type": "Scale", "category": "Armor"},
                       {"type": "Claw", "category": "Accessory"}],
         "set_bonus_slot": True}]}
    blanks, _, _, cov = dino.build_dino(seed)
    armor = next(b for b in blanks if b["slot"] == "Armor")
    assert armor["dino_set_bonus_slot"] is True
    assert "Armor" in cov["set_bonus_hosts"]


def test_set_records_passed_through():
    seed = {"set_augments": [
        {"set_name": "Dread Stalker", "threshold": 3,
         "tier_text": "+3 Artifact bonus to Sneak Attack Dice", "wiki_url": _WIKI}]}
    _, _, sets, cov = dino.build_dino(seed)
    assert len(sets) == 1
    assert sets[0]["set"] == "Dread Stalker"
    assert "DEFERRED" in cov["set_bonus_status"]


def test_empty_seed_yields_nothing_gracefully():
    blanks, inserts, sets, cov = dino.build_dino({})
    assert blanks == [] and inserts == [] and sets == []
    assert cov["blank_hosts"] == 0


def test_built_dataset_carries_dino_blanks_and_inserts():
    # End-to-end: the real build wires the shipped seed through.
    import build_dataset
    dataset = build_dataset.build(build_dataset.load_seed())
    assert "dino_inserts" in dataset
    assert len(dataset["dino_inserts"]) >= 1
    blanks = [v for v in dataset["items"] if v.get("source") == "dino_crafting_blank"]
    assert len(blanks) >= 1
    valid_slots = dino._ACCESSORY_WORN | {"Armor", "Main Hand", "Rune Arm"}
    for b in blanks:
        assert b["verification"] == "verified"
        assert b["slot"] in valid_slots
        assert b["dino_slots_norm"]
    assert dataset["metadata"]["dino_coverage"]["blank_hosts"] == len(blanks)
    # M2: two-key weapon/armor slots present in at least one blank.
    all_keys = {k for b in blanks for k in b["dino_slots_norm"]}
    assert any(k.endswith("||Weapon") for k in all_keys)
    assert any(k.endswith("||Armor") for k in all_keys)
