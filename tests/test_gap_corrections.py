"""U7.5 — wiki-validated gap-corrections overlay.

gear-planner's parser UNDER-parses a small set of collision items; the overlay
(`data/seed/gap_corrections.json`) restores ONLY the genuinely-missing affixes,
sourced from the retired hand-verified base seed and spot-validated against the
DDO wiki. Applied ADDITIVELY by build_dataset (append; never overwrite; skip a
(name,type) the item already has so it can NEVER double-count).

These tests assert:
  1. Ophael's Cincture carries the 6 base-ability +15 Enhancement affixes after
     the build (the confirmed wiki gap), alongside its full +15/+7/+3 block.
  2. The overlay never adds a (name,type) an item already has (anti-double-count).
  3. gear-planner's own native affixes (Deception / Seeker) survive untouched.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import build_dataset as B  # noqa: E402

ABILITIES = ["Strength", "Constitution", "Dexterity",
             "Intelligence", "Wisdom", "Charisma"]


def _ophael_affixes():
    ds = B.build()
    for it in ds["items"]:
        if it["source_item"] == "Ophael's Cincture":
            # build() carries legacy-shaped affixes {stat,bonus_type,value}.
            return [(a.get("stat"), a.get("bonus_type"), a.get("value")) for a in it["affixes"]]
    raise AssertionError("Ophael's Cincture not in built dataset")


def test_ophael_carries_six_base_ability_plus15():
    affs = _ophael_affixes()
    for ab in ABILITIES:
        assert (ab, "Enhancement", 15) in affs, f"missing {ab} Enhancement +15: {affs}"


def test_ophael_carries_full_all_abilities_block():
    affs = _ophael_affixes()
    # +15/+7/+3 to ALL ability scores == 18 affixes (6 abilities x 3 types).
    for ab in ABILITIES:
        assert (ab, "Enhancement", 15) in affs
        assert (ab, "Insight", 7) in affs
        assert (ab, "Quality", 3) in affs


def test_ophael_native_deception_seeker_preserved():
    affs = _ophael_affixes()
    # gear-planner's own parse must survive verbatim (overlay is additive-only).
    assert ("Deception", "Enhancement", 12) in affs
    assert ("Deception", "Insight", 6) in affs
    assert ("Seeker", "Enhancement", 15) in affs


def test_apply_never_double_counts_existing_name_type():
    # Anti-double-count: an overlay affix whose (name,type) the record already has
    # must be SKIPPED, not appended.
    records = [{
        "name": "Fixture Item", "ml": 20,
        "affixes": [
            {"name": "Strength", "type": "Enhancement", "value": "10"},
            {"name": "Deception", "type": "Insight", "value": "6"},
        ],
    }]
    corrections = {"Fixture Item": [
        {"name": "Strength", "type": "Enhancement", "value": "15"},  # already present -> skip
        {"name": "Constitution", "type": "Enhancement", "value": "15"},  # genuine -> add
    ]}
    cov = B.apply_gap_corrections(records, corrections)
    affs = [(a["name"], a["type"]) for a in records[0]["affixes"]]
    # Strength/Enhancement appears exactly once (the original), NOT doubled.
    assert affs.count(("Strength", "Enhancement")) == 1
    assert ("Constitution", "Enhancement") in affs
    # And the pre-existing Strength keeps its original value (never overwritten).
    strengths = [a["value"] for a in records[0]["affixes"]
                 if (a["name"], a["type"]) == ("Strength", "Enhancement")]
    assert strengths == ["10"], strengths
    assert cov["items_corrected"] == 1
    assert cov["affixes_added"] == 1
    assert cov["affixes_skipped_already_present"] == 1


def test_overlay_file_contains_only_ophael():
    corrections = B.load_gap_corrections()
    # The minimal sanctioned exception: Ophael's Cincture is the sole genuine gap
    # across all base∪gear-planner collision items.
    assert set(corrections.keys()) == {"Ophael's Cincture"}, list(corrections.keys())
    assert len(corrections["Ophael's Cincture"]) == 18
