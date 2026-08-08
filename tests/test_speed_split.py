"""U3 (#154) — the Speed/Striding split at the planner-record seam."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import speed_split  # noqa: E402


def _rec(name, url, *affixes):
    return {"name": name, "url": url, "affixes": [dict(a) for a in affixes]}


def _speed(value):
    return {"name": "Speed", "type": "Enhancement", "value": str(value)}


def _shard(**entries):
    return {"harvested": entries}


def _by_name(rec):
    return {a["name"]: a for a in rec["affixes"]}


def test_striding_item_is_renamed_and_gains_no_alacrity():
    rec = _rec("Ash Boots", "/page/Item:Ash_Boots", _speed(30))
    speed_split.apply([rec], _shard(**{
        "Item:Ash Boots": {"value": {"movement": 30}, "provenance": "stated"}}))

    affixes = _by_name(rec)
    assert "Speed" not in affixes
    assert affixes["Movement Speed"]["value"] == "30"
    assert "Melee Alacrity" not in affixes and "Ranged Alacrity" not in affixes


def test_roman_rank_item_gains_both_alacrities_and_corrects_movement():
    """Speed XI is rank 11: 30% movement (5*11 capped), 11% attack speed.

    gear-planner stored the rank as if it were the movement percentage, so the
    movement value is corrected here too — not only the missing alacrity.
    """
    rec = _rec("Goatskin Boots", "/page/Item:Goatskin_Boots_(level_19)", _speed(11))
    stats = speed_split.apply([rec], _shard(**{
        "Item:Goatskin Boots (level 19)": {
            "value": {"movement": 30, "melee": 11, "ranged": 11},
            "provenance": "stated"}}))

    affixes = _by_name(rec)
    assert affixes["Movement Speed"]["value"] == "30", "movement must be corrected 11 -> 30"
    assert affixes["Melee Alacrity"]["value"] == "11"
    assert affixes["Ranged Alacrity"]["value"] == "11"
    assert stats["movement_corrected"] == 1


def test_movement_cap_does_not_cap_alacrity():
    """Speed XIX is 30% movement but 19% alacrity — one cap, not two."""
    rec = _rec("X", "/page/Item:X", _speed(19))
    speed_split.apply([rec], _shard(**{
        "Item:X": {"value": {"movement": 30, "melee": 19, "ranged": 19},
                   "provenance": "stated"}}))

    affixes = _by_name(rec)
    assert affixes["Movement Speed"]["value"] == "30"
    assert affixes["Melee Alacrity"]["value"] == "19"


def test_type_parameter_narrows_to_one_alacrity():
    """{{Speed|XV|Ranged}} grants ranged only — melee must not be invented."""
    rec = _rec("Epic Quiver of Alacrity", "/page/Item:Epic_Quiver_of_Alacrity", _speed(15))
    speed_split.apply([rec], _shard(**{
        "Item:Epic Quiver of Alacrity": {
            "value": {"movement": 30, "ranged": 15}, "provenance": "stated"}}))

    affixes = _by_name(rec)
    assert affixes["Ranged Alacrity"]["value"] == "15"
    assert "Melee Alacrity" not in affixes


def test_defaulted_magnitude_keeps_movement_and_grants_no_alacrity():
    """Template:Speed renders 5% for any magnitude nobody recorded, so a 5%
    reading is not evidence of a 5% bonus. Quarantine the alacrity, keep movement."""
    rec = _rec("Boots of the Battlemaster", "/page/Item:Boots_of_the_Battlemaster", _speed(15))
    stats = speed_split.apply([rec], _shard(**{
        "Item:Boots of the Battlemaster": {
            "value": {"movement": 15}, "provenance": "defaulted"}}))

    affixes = _by_name(rec)
    assert affixes["Movement Speed"]["value"] == "15"
    assert "Melee Alacrity" not in affixes and "Ranged Alacrity" not in affixes
    assert stats["quarantined"] == 1


def test_unsourced_item_is_renamed_but_gains_nothing():
    """Belt of the Ram used to be the fixture here. It was a bad reading — the
    page renders `Speed +15%` — so this uses a synthetic title instead."""
    rec = _rec("Silent Page", "/page/Item:Silent_Page", _speed(15))
    speed_split.apply([rec], _shard(**{
        "Item:Silent Page": {"value": None, "provenance": "unsourced"}}))

    affixes = _by_name(rec)
    assert affixes["Movement Speed"]["value"] == "15", "keep gear-planner's value"
    assert "Melee Alacrity" not in affixes


def test_audit_reports_unsourced_entries_as_harvest_suspects():
    audit = speed_split.audit_shard(_shard(**{
        "Item:Good": {"value": {"movement": 30}, "provenance": "stated",
                      "raw": "{{Striding|30}}"},
        "Item:Suspect": {"value": None, "provenance": "unsourced",
                         "raw": "no Striding/Speed template found (NONE)"}}))

    assert audit["inspected"] == 2
    assert audit["unsourced"] == 1
    assert audit["titles"] == ["Item:Suspect"]


def test_audit_refuses_to_inspect_an_empty_shard():
    """A check that scans nothing passes unconditionally and reads identical to a
    clean run — the exact way the material coverage gate went green on corrupt
    input (docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md)."""
    try:
        speed_split.audit_shard(_shard())
    except ValueError as exc:
        assert "empty" in str(exc)
    else:
        raise AssertionError("audit_shard must raise on an empty shard")


def test_shipped_shard_has_no_unsourced_entries_left():
    import json
    with open(os.path.join(ROOT, "data", "seed", "compendium",
                           "speed_enchantment.json")) as fh:
        shard = json.load(fh)

    audit = speed_split.audit_shard(shard)
    assert audit["inspected"] == 194
    assert audit["unsourced"] == 0, f"harvest suspects remain: {audit['titles']}"


def test_belt_of_the_ram_derives_movement_from_a_real_invocation():
    """Regression on the corrected entry: the wiki renders `Speed +15%`, and 15 is
    outside the recorded switch table, so it is `defaulted` — movement only."""
    rec = _rec("Belt of the Ram", "/page/Item:Belt_of_the_Ram", _speed(15))
    speed_split.apply([rec], _shard(**{
        "Item:Belt of the Ram": {"value": {"movement": 15},
                                 "provenance": "defaulted", "raw": "{{Speed|15}}"}}))

    affixes = _by_name(rec)
    assert affixes["Movement Speed"]["value"] == "15"
    assert "Melee Alacrity" not in affixes
    assert "Ranged Alacrity" not in affixes


def test_an_explicit_upstream_alacrity_is_never_shadowed():
    """Jorgundal's Collar carries Melee Alacrity natively; the split must not
    add a second one (the anti-double-count rule the gap overlay also uses)."""
    rec = _rec("Jorgundal's Collar", "/page/Item:Jorgundal%27s_Collar_(level_12)",
               _speed(25), {"name": "Melee Alacrity", "type": "Enhancement", "value": "10"})
    speed_split.apply([rec], _shard(**{
        "Item:Jorgundal's Collar (level 12)": {
            "value": {"movement": 25, "melee": 11, "ranged": 11}, "provenance": "stated"}}))

    melee = [a for a in rec["affixes"] if a["name"] == "Melee Alacrity"]
    assert len(melee) == 1, "must not add a second Melee Alacrity"
    assert melee[0]["value"] == "10", "the item's own value wins"


def test_record_absent_from_the_shard_is_left_folded():
    """Uncovered records keep the folded affix — the coverage gate makes that
    visible rather than the split silently inventing a reading."""
    rec = _rec("Unharvested", "/page/Item:Unharvested", _speed(30))
    stats = speed_split.apply([rec], _shard())

    assert stats["uncovered"] == 1
    assert _by_name(rec)["Speed"]["value"] == "30"


def test_apply_is_idempotent():
    rec = _rec("Goatskin Boots", "/page/Item:Goatskin_Boots_(level_19)", _speed(11))
    shard = _shard(**{"Item:Goatskin Boots (level 19)": {
        "value": {"movement": 30, "melee": 11, "ranged": 11}, "provenance": "stated"}})
    speed_split.apply([rec], shard)
    before = [dict(a) for a in rec["affixes"]]
    speed_split.apply([rec], shard)

    assert rec["affixes"] == before, "a second pass must add nothing"


def test_records_without_a_speed_affix_are_untouched():
    rec = _rec("Plain", "/page/Item:Plain",
               {"name": "Constitution", "type": "Enhancement", "value": "8"})
    speed_split.apply([rec], _shard())
    assert rec["affixes"] == [{"name": "Constitution", "type": "Enhancement", "value": "8"}]


def test_speed_is_declared_expanded_away_to_the_three_concrete_stats():
    assert speed_split.EXPANDED_AWAY["speed"] == [
        "Movement Speed", "Melee Alacrity", "Ranged Alacrity"]
