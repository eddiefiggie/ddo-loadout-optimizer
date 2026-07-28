"""U7 — chosen-set-membership build export. Validates src/membership.py turns the
Vecna set seed into the runtime membership_set_defs table (tiered, umbrella-expanded)
the solver self-seeds from, and that build_dataset exports it into items.json."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src import membership  # noqa: E402

ITEMS = os.path.join(os.path.dirname(__file__), "..", "web", "data", "items.json")


def test_build_membership_set_defs_shape():
    defs = membership.build_membership_set_defs(membership.load_seed())
    assert len(defs) == 22, f"expected 22 set defs, got {len(defs)}"
    vol = defs["Legendary Vol's Influence"]
    assert vol["tier"] == "legendary" and vol["ml"] == 32
    tier = vol["tiers"][0]
    assert tier["pieces_required"] == 3
    stats = {(a["stat"], a["bonus_type"], a["value"]) for a in tier["affixes"]}
    assert ("Universal Spell Power", "Artifact", 25) in stats
    assert ("Spell Critical Damage", "Legendary", 15) in stats


def test_umbrella_expansion_applied():
    # 'all Ability Scores' must expand to the six concrete abilities so single-ability
    # targets are credited (mirrors intrinsic-set handling).
    defs = membership.build_membership_set_defs(membership.load_seed())
    fk = defs["Legendary Forbidden Knowledge"]
    t4 = next(t for t in fk["tiers"] if t["pieces_required"] == 4)
    stats = {a["stat"] for a in t4["affixes"]}
    for ability in ("Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"):
        assert ability in stats, f"{ability} expanded from 'all Ability Scores'"
    assert "all Ability Scores" not in stats, "umbrella stat is expanded, not left literal"


def test_forbidden_knowledge_keeps_all_three_thresholds():
    defs = membership.build_membership_set_defs(membership.load_seed())
    fk = defs["Legendary Forbidden Knowledge"]
    thresholds = sorted(t["pieces_required"] for t in fk["tiers"])
    assert thresholds == [3, 4, 5]


def test_items_json_exports_membership_set_defs():
    # build_dataset must export the table so the browser solver can self-seed.
    with open(ITEMS, encoding="utf-8") as fh:
        data = json.load(fh)
    m = data.get("membership_set_defs")
    assert m and len(m) == 22, "items.json exports all 22 membership set defs"
    cov = data["metadata"].get("membership_coverage")
    assert cov and cov["sets"] == 22 and cov["tiers"] >= 26
