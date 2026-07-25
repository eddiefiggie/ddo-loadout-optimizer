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
    blanks, _, _ = dino.build_dino(_seed())
    boots = next(b for b in blanks if b["item"] == "Dinosaur Bone Boots")
    assert boots["slot"] == "Boots"                      # maps onto a worn slot
    assert boots["verification"] == "verified"           # empty affixes must NOT quarantine it
    assert boots["affixes"] == []
    assert boots["dino_slots_norm"] == ["Scale", "Fang", "Claw", "Horn"]
    assert boots["minimum_level"] == 31


def test_necklace_blank_maps_to_necklace_slot():
    blanks, _, _ = dino.build_dino(_seed())
    neck = next(b for b in blanks if b["item"] == "Necklace")
    assert neck["slot"] == "Necklace"
    assert neck["dino_slots_norm"] == ["Scale"]


def test_insert_pool_returned_as_records():
    _, inserts, _ = dino.build_dino(_seed())
    assert len(inserts) == 2
    con = next(i for i in inserts if i["stat"] == "Constitution")
    assert con["dino_type"] == "Scale" and con["value"] == 14


def test_coverage_reports_blank_hosts_and_quarantine():
    _, _, cov = dino.build_dino(_seed())
    assert cov["blank_hosts"] == 2
    assert "quarantined" in cov
    assert cov["by_type"]["Scale"] == 1


def test_non_accessory_blank_is_quarantined_not_dropped():
    # A weapon/armor blank maps to no worn accessory slot; it must be recorded
    # with a reason, not silently dropped (coverage would otherwise undercount).
    seed = {"items": [{"item": "Legendary Bottle o' Rum", "slot": "weapon",
                       "dino_slots": [{"type": "Scale"}], "wiki_url": _WIKI}],
            "inserts": []}
    blanks, _, cov = dino.build_dino(seed)
    assert blanks == []
    assert cov["blank_hosts"] == 0
    assert cov["blanks_quarantined"][0]["raw"] == "Legendary Bottle o' Rum"
    assert "non-accessory" in cov["blanks_quarantined"][0]["reason"]


def test_empty_seed_yields_nothing_gracefully():
    blanks, inserts, cov = dino.build_dino({})
    assert blanks == [] and inserts == []
    assert cov["blank_hosts"] == 0


def test_built_dataset_carries_dino_blanks_and_inserts():
    # End-to-end: the real build wires the shipped seed through.
    import build_dataset
    dataset = build_dataset.build(build_dataset.load_seed())
    assert "dino_inserts" in dataset
    assert len(dataset["dino_inserts"]) >= 1
    blanks = [v for v in dataset["items"] if v.get("source") == "dino_crafting_blank"]
    assert len(blanks) >= 1
    # every blank is verified, in an accessory worn slot, and carries typed Dino slots
    for b in blanks:
        assert b["verification"] == "verified"
        assert b["slot"] in dino._ACCESSORY_WORN
        assert b["dino_slots_norm"]
    assert dataset["metadata"]["dino_coverage"]["blank_hosts"] == len(blanks)
