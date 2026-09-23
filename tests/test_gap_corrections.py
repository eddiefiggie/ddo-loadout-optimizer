"""U7.5 gap-corrections overlay — now EMPTY (Ophael entry reverted 2026-08-02).

The overlay (`data/seed/gap_corrections.json`) restored genuinely-missing affixes
that gear-planner under-parsed. Its ONLY entry, Ophael's Cincture, was REMOVED: its
18 "ability score" affixes were NOT a real gap — they are the "Sealed in Undeath"
seal POOL (all 18 Undeath outcomes), already modeled as a SINGLE-PICK via the item's
`seal_slots`. The gap-fill duplicated the seal pool as flat all-apply affixes,
over-counting (a chosen seal grants ONE ability score, not all six). These tests
assert the corrected state, plus the additive-apply mechanism (still used should a
genuine gap ever appear).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import build_dataset as B  # noqa: E402

ABILITIES = ["Strength", "Constitution", "Dexterity",
             "Intelligence", "Wisdom", "Charisma"]


def _ophael():
    ds = B.build()
    for it in ds["items"]:
        if it["source_item"] == "Ophael's Cincture":
            return it
    raise AssertionError("Ophael's Cincture not in built dataset")


def _affixes(it):
    # build() carries legacy-shaped affixes {stat,bonus_type,value}.
    return [(a.get("stat"), a.get("bonus_type"), a.get("value")) for a in it["affixes"]]


def test_ophael_does_not_carry_flat_ability_affixes():
    # The bug: the gap-fill appended all 18 Undeath seal outcomes as flat, all-apply
    # affixes, so a solve credited +15/+7/+3 to EVERY ability score. They belong to
    # the single-pick seal, not the affix block.
    leaked = [a for a in _affixes(_ophael()) if a[0] in ABILITIES]
    assert leaked == [], f"ability scores leaked as flat affixes (must be seal-only): {leaked}"


def test_ophael_native_deception_seeker_preserved():
    affs = _affixes(_ophael())
    # gear-planner's own parse survives verbatim.
    assert ("Deception", "Enhancement", 12) in affs
    assert ("Deception", "Insight", 6) in affs
    assert ("Seeker", "Enhancement", 15) in affs


def test_ophael_ability_scores_come_from_the_undeath_seal():
    # The ability-score bonus is the single-pick "Sealed in Undeath" slot.
    seals = _ophael().get("seal_slots") or []
    assert any(s.get("seal_type") == "Undeath" for s in seals), seals


def test_overlay_carries_exactly_the_sanctioned_entries():
    # Ophael reverted (a misread of the seal pool, not a genuine gap). #288 added
    # the one genuine gap since: the U81 pull-back gave Orcus' Reign a Quality
    # False Life +15 that gear-planner's snapshot predates entirely. Pin the
    # exact contents so a drive-by addition to the sanctioned exception is loud.
    #
    # 397c673 — 22 keys, not one. The refresh's `[Crafted]` restructure collapsed 45
    # `X [Crafted]` records onto their base name and kept the SMALLER pre-craft affix
    # block, so 21 items silently lost 39 affixes the DDO wiki still states outright.
    # That is this shard's own definition of a genuine gap: the stat is absent from
    # gear-planner's native parse ENTIRELY, not merely typed differently. Each restored
    # affix is the (name, type, value) triple gear-planner itself carried at 767a7f7,
    # with the stat and magnitude re-confirmed on the item's own RENDERED wiki page.
    # Retire these the moment upstream restores the fuller parse.
    #
    # The roster is still pinned exactly, so a drive-by addition stays loud — that is
    # what this test is for, and widening it to a count would give that up.
    corrections = B.load_gap_corrections()
    assert sorted(corrections) == sorted([
        "Orcus' Reign",
        "Arcing Sky (level 13)", "Candlelight", "Chill of Winter (level 13)",
        "Chulchannad's Claw", "Flame Warden", "Flicker", "Glorious Obscenity",
        "Hand of the Tombs", "Khyber's Fury", "Lucid Dreams", "Recoyle",
        "Strinati's Hand Cannon", "The Devourer's Hunger", "The Disciplinator",
        "The Pea Shooter", "Thought Spike", "Thought Spike (starter)",
        "Tira's Splendor", "Titan's Fist", "Toven's Hammer", "Trial by Fire",
    ]), sorted(corrections)
    # Every restored affix cites the page it was re-read on, and the 2026-09-22 batch
    # says which snapshot it is repairing — an overlay entry with no provenance is how
    # a "temporary" workaround becomes permanent.
    for name, entries in corrections.items():
        for e in entries:
            assert e.get("wiki_url") and e.get("verified"), (name, e)
    entry = corrections["Orcus' Reign"][0]
    assert (entry["name"], entry["type"], entry["value"]) == (
        "False Life", "Quality", "15")
    assert entry.get("tooltip") and entry.get("wiki_url") and entry.get("verified"), \
        "a gap entry carries its rendered-tooltip evidence like every correction"


def test_apply_never_double_counts_existing_name_type():
    # Anti-double-count: an overlay affix whose (name,type) the record already has
    # must be SKIPPED, not appended. (The mechanism stays, ready for a real gap.)
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
    assert affs.count(("Strength", "Enhancement")) == 1
    assert ("Constitution", "Enhancement") in affs
    strengths = [a["value"] for a in records[0]["affixes"]
                 if (a["name"], a["type"]) == ("Strength", "Enhancement")]
    assert strengths == ["10"], strengths
    assert cov["items_corrected"] == 1
    assert cov["affixes_added"] == 1
    assert cov["affixes_skipped_already_present"] == 1
