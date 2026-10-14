"""#871 — named assertions for the gear-planner c36b45e (Update 81.4) re-vendor.

Written BEFORE the golden was regenerated, per
docs/solutions/conventions/a-gate-cascade-is-the-refresh-report-not-an-obstacle.md:
each pins one adjudicated behaviour so a golden diff cannot quietly absorb it.
Adjudication of record: docs/reports/2026-10-13-gear-planner-u81-4-refresh.md.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import planner_items  # noqa: E402

DATASET = os.path.join(ROOT, "web", "data", "items.json")


def _built():
    if not os.path.exists(DATASET):
        return None  # generated artifact; the build job asserts it
    with open(DATASET, encoding="utf-8") as fh:
        return json.load(fh)


def _by_source(data):
    out = {}
    for v in data["items"]:
        out.setdefault(v.get("source_item"), []).append(v)
    return out


# ---- upgrade augment slots: ONE slot of a chosen colour (#878) --------------------

def test_a_single_colour_upgrade_is_that_slot():
    crafting = ["Upgradeable - Secondary Augment"]
    assert planner_items._augment_slots(
        crafting, {"Upgradeable - Secondary Augment": ["Green"]}) == ["Green"]


def test_a_multi_colour_upgrade_is_one_choice_slot_not_one_per_colour():
    crafting = ["Upgradeable - Primary Augment"]
    out = planner_items._augment_slots(
        crafting, {"Upgradeable - Primary Augment": ["Yellow", "Blue"]})
    assert out == ["Yellow or Blue"], "one slot, never Yellow AND Blue"


def test_plain_slots_are_unchanged_and_other_crafting_is_ignored():
    assert planner_items._augment_slots(
        ["Red Augment Slot", "Sealed in Fire", "Colorless Augment Slot"]) == ["Red", "Colorless"]


def test_epic_chain_of_conviction_has_two_slots_not_three():
    """The over-credit #871 removed: 397c673 listed Blue + Green + Yellow.
    Wiki: "Upgradeable - Primary Augment (Yellow Augment Slot or Blue Augment Slot)",
    "Upgradeable - Secondary Augment (Green Augment Slot)". #878 — the choice is
    now a slot of its own kind rather than a quarantined one."""
    data = _built()
    if data is None:
        return
    v = _by_source(data)["Epic Chain of Conviction"][0]
    norm = v["augment_slots_norm"]
    assert sorted(norm["colors"]) == ["Green", "Yellow or Blue"]
    assert norm["quarantined"] == []


def test_every_upgrade_host_has_one_slot_per_upgrade():
    """One slot per upgrade key, whatever its permitted colours — never one per
    colour (the 397c673 over-credit), never zero (the #871 interim)."""
    data = _built()
    if data is None:
        return
    with open(planner_items.RAW_PATH, encoding="utf-8") as fh:
        raw = json.load(fh)
    hosts = {r["name"]: r["augmentUpgrades"] for r in raw if r.get("augmentUpgrades")}
    assert len(hosts) == 32, len(hosts)
    by = _by_source(data)
    for name, upgrades in hosts.items():
        choices = sorted(" or ".join(c) for c in upgrades.values() if len(c) > 1)
        for v in by[name]:
            norm = v["augment_slots_norm"]
            assert sorted(c for c in norm["colors"] if " or " in c) == choices, name
            assert norm["quarantined"] == [], name


# ---- wiki-stated minimum levels upstream lost --------------------------------------

def test_ml_correction_applies_level_and_restores_a_missing_quest():
    fixed = planner_items.apply_ml_correction(
        {"name": "X", "ml": 1, "quests": None},
        {"from_ml": 1, "ml": 12, "quests": ["The Night Revels"]})
    assert fixed["ml"] == 12 and fixed["quests"] == ["The Night Revels"]


def test_ml_correction_fails_once_upstream_ships_the_fix():
    try:
        planner_items.apply_ml_correction({"name": "X", "ml": 12}, {"from_ml": 1, "ml": 12})
    except ValueError as e:
        assert "stale" in str(e)
    else:
        raise AssertionError("a correction upstream already ships must fail the build")


def test_ml_correction_fails_when_upstream_changes_again():
    try:
        planner_items.apply_ml_correction({"name": "X", "ml": 7}, {"from_ml": 1, "ml": 12})
    except ValueError as e:
        assert "re-read the wiki" in str(e)
    else:
        raise AssertionError("a correction must not land on a record it was not written against")


def test_ml_correction_naming_no_record_fails_the_load():
    try:
        planner_items.load_planner_items(ml_corrections={"No Such Item": {"from_ml": 1, "ml": 5}})
    except ValueError as e:
        assert "No Such Item" in str(e)
    else:
        raise AssertionError("an orphaned correction must fail, not go quiet")


def test_the_night_revels_items_ship_at_their_wiki_levels():
    data = _built()
    if data is None:
        return
    by = _by_source(data)
    want = {"Cloak of Night (level 4)": 4, "Cloak of Night (level 8)": 8,
            "Cloak of Night (level 12)": 12, "Cloak of Night (level 16)": 16,
            "Epic Cloak of Night (level 20)": 20, "Epic Cloak of Night (level 24)": 24,
            "Epic Cloak of Night (level 28)": 28, "Bottled Fear": 5}
    for name, ml in want.items():
        for v in by[name]:
            assert v["ml"] == ml, (name, v["ml"])
            assert v["location_quest"] == "The Night Revels", name


# ---- U81.4 Lahar augments -----------------------------------------------------------

def test_the_four_new_lahar_rubies_ship_at_their_release_note_levels():
    data = _built()
    if data is None:
        return
    by = _by_source(data)
    want = {"Ruby of Bludgeoning Blows": ("Bludgeoning Type Bypass", 1),
            "Ruby of Piercing Precision": ("Piercing Type Bypass", 1),
            "Ruby of Slashing Strikes": ("Slashing Type Bypass", 1),
            "Ruby of the Quori": ("Crystal", 8)}
    for name, (affix, ml) in want.items():
        v = by[name][0]
        assert v["ml"] == ml, (name, v["ml"])
        assert v["aug_color"]["color"] == "Red", name
        assert [a["name"] for a in v["affixes"]] == [affix], name


def test_existing_lahar_rubies_were_standardised_to_ml4_and_ml8():
    """U81.4: "Alignment based augments are now level 4, and Material based augments
    are now level 8"."""
    data = _built()
    if data is None:
        return
    by = _by_source(data)
    for name in ("Ruby of Good", "Ruby of Evil", "Ruby of Chaos", "Ruby of Order"):
        assert [v["ml"] for v in by[name]] == [4], name
    for name in ("Ruby of Adamantine Arms", "Ruby of Iron Blows", "Ruby of Silvered Strikes"):
        assert [v["ml"] for v in by[name]] == [8], name


# ---- Sneak Attack Bonus is Deception -------------------------------------------------

def test_no_sneak_attack_bonus_survives_and_the_type_corrections_follow_the_rename():
    data = _built()
    if data is None:
        return
    assert not any(a["name"] == "Sneak Attack Bonus"
                   for v in data["items"] for a in v.get("affixes") or [])
    v = _by_source(data)["Assassin Initiate's Leathers (level 13)"][0]
    assert {"name": "Deception", "type": "Enhancement", "value": "2", "eligible": True} \
        in v["affixes"], "the #613 retype from the pseudo-type `Sneak Attack` still lands"
