"""U4 — augment-slot-only host admission past the verify gate."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src import verify  # noqa: E402


def _variant(affixes=None, slot_colors=None):
    return {
        "affixes": affixes or [], "scaling": [], "flagged": [],
        "augment_slots_norm": {"colors": slot_colors or [], "quarantined": []},
        "slot": "Weapon",
    }


def test_augment_slot_only_host_is_verified():
    v = verify.verify_variant(_variant(affixes=[], slot_colors=["Orange", "Purple"]))
    assert v["verification"] == "verified"
    assert "augment-slot host" in v["verification_reasons"][0]


def test_zero_affix_no_slots_stays_quarantined():
    v = verify.verify_variant(_variant(affixes=[], slot_colors=[]))
    assert v["verification"] == "quarantined"


def test_affix_bearing_item_still_verified():
    v = verify.verify_variant(_variant(affixes=[{"stat": "Strength", "value": 15}], slot_colors=[]))
    assert v["verification"] == "verified"
    assert v["verification_reasons"] == []


def test_cataclysmic_weapons_admitted_in_real_dataset():
    # Regression for quarantine "case A": the augment-slot-only Cataclysmic line.
    path = os.path.join(os.path.dirname(__file__), "..", "web", "data", "items.json")
    if not os.path.exists(path):
        return  # dataset not built; the build-based gate covers this
    items = json.load(open(path, encoding="utf-8"))["items"]
    cats = [v for v in items if "Cataclysmic" in (v.get("source_item") or "") and v.get("category") == "weapon"]
    assert cats, "Cataclysmic weapons present in the dataset"
    assert all(v.get("verification") == "verified" for v in cats), "Cataclysmic augment-slot hosts are admitted"
