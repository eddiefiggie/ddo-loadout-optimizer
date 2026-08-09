"""U7 (#169) — the Parrying expansion at the planner-record seam."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import enchantment_split  # noqa: E402
from src import parrying_split  # noqa: E402

SAVES = ("Fortitude Save", "Reflex Save", "Will Save")


def _rec(name, *affixes):
    return {"name": name, "url": f"/page/Item:{name.replace(' ', '_')}",
            "affixes": [dict(a) for a in affixes]}


def _parrying(value, type_="Insight"):
    return {"name": "Parrying", "type": type_, "value": str(value)}


def _affix(name, type_, value):
    return {"name": name, "type": type_, "value": str(value)}


def _entry(version, magnitude, provenance="stated"):
    return {"value": {"version": version, "armor_class": magnitude, "saves": magnitude},
            "provenance": provenance, "raw": "{{Parrying|%s}}" % version}


def _shard(**entries):
    return {"harvested": entries}


def _by_name(rec):
    out = {}
    for a in rec["affixes"]:
        out.setdefault(a["name"], []).append(a)
    return out


# --- AE1-AE4: the version is what carries the magnitude ------------------------

def test_arabic_item_grants_insight_ac_and_all_three_saves():
    """AE1, the silent case. Today this item contributes nothing to any of them."""
    rec = _rec("Admiral's Cummerbund", _parrying(2))
    stats = parrying_split.apply([rec], _shard(**{"Admiral's Cummerbund": _entry("2", 2)}))

    affixes = _by_name(rec)
    assert "Parrying" not in affixes
    assert affixes["Armor Class"][0]["value"] == "2"
    assert affixes["Armor Class"][0]["type"] == "Insight"
    for save in SAVES:
        assert affixes[save][0]["value"] == "2", save
        assert affixes[save][0]["type"] == "Insight", save
    assert stats["armor_class_corrected"] == 0, "an Arabic magnitude is already correct"


def test_roman_eight_grants_four_not_eight():
    """AE2, the over-grant. Parrying VIII is a rank, not a magnitude."""
    rec = _rec("Oathblade", _parrying(8))
    stats = parrying_split.apply([rec], _shard(**{"Oathblade": _entry("VIII", 4)}))

    affixes = _by_name(rec)
    assert affixes["Armor Class"][0]["value"] == "4"
    for save in SAVES:
        assert affixes[save][0]["value"] == "4", save
    assert stats["armor_class_corrected"] == 1


def test_identical_stored_magnitudes_diverge_on_version():
    """AE3, the magnitude collision. Both records store 4; one grants 2.

    This is the whole reason the version is per-item evidence. A model reading
    the stored number could not produce these two answers.
    """
    ring = _rec("Bladed Steel Ring", _parrying(4))
    arabic = _rec("Epic Tourney Armor", _parrying(4))
    parrying_split.apply([ring, arabic], _shard(**{
        "Bladed Steel Ring": _entry("IV", 2),
        "Epic Tourney Armor": _entry("4", 4),
    }))

    assert _by_name(ring)["Armor Class"][0]["value"] == "2"
    assert _by_name(arabic)["Armor Class"][0]["value"] == "4"


def test_roman_one_is_left_alone():
    """AE4. Parrying I is +1, so the stored 1 is already right — it must not be
    swept into the Roman correction by a halving formula."""
    rec = _rec("Ethereal Bracers", _parrying(1))
    stats = parrying_split.apply([rec], _shard(**{"Ethereal Bracers": _entry("I", 1)}))

    assert _by_name(rec)["Armor Class"][0]["value"] == "1"
    assert stats["armor_class_corrected"] == 0


# --- R2a / KTD6: suppression keys on the stacking bucket, not the name ---------

def test_a_differently_bucketed_armor_class_still_receives_the_insight_one():
    """86 Parrying items already carry an Armor-, Shield-, or Deflection-typed
    Armor Class. Those stack with an Insight one, so the record must end up with
    both."""
    rec = _rec("Tourney Armor", _affix("Armor Class", "Armor", 8), _parrying(2))
    stats = parrying_split.apply([rec], _shard(**{"Tourney Armor": _entry("2", 2)}))

    acs = {(a["type"], a["value"]) for a in _by_name(rec)["Armor Class"]}
    assert acs == {("Armor", "8"), ("Insight", "2")}
    assert stats["primary_suppressed"] == 0


def test_a_same_bucket_armor_class_suppresses_the_primary_but_not_the_saves():
    """The other half of R2a. Same stat, same bucket -> only the higher counts,
    so the folded affix is dropped rather than renamed into a duplicate. The
    saves are separate stats and are still granted."""
    rec = _rec("Hypothetical", _affix("Armor Class", "Insight", 5), _parrying(2))
    stats = parrying_split.apply([rec], _shard(**{"Hypothetical": _entry("2", 2)}))

    affixes = _by_name(rec)
    assert len(affixes["Armor Class"]) == 1
    assert affixes["Armor Class"][0]["value"] == "5"
    assert stats["primary_suppressed"] == 1 and stats["renamed"] == 0
    for save in SAVES:
        assert affixes[save][0]["value"] == "2", save


def test_a_curated_equivalent_type_counts_as_the_same_bucket():
    """`Insight Natural` collapses to `Insight` in the curated table, and
    `web/model.js` buckets the same way. A rule comparing raw type strings would
    treat these as stacking and emit a duplicate."""
    rec = _rec("Hypothetical", _affix("Armor Class", "Insight Natural", 5), _parrying(2))
    stats = parrying_split.apply([rec], _shard(**{"Hypothetical": _entry("2", 2)}))

    assert stats["primary_suppressed"] == 1
    assert len(_by_name(rec)["Armor Class"]) == 1


def test_an_existing_save_in_another_bucket_does_not_block_the_insight_save():
    """Four Parrying items carry a Quality or Resistance Reflex Save. A
    name-keyed anti-shadow rule would withhold their Insight Reflex Save."""
    rec = _rec("Scourge's Guise", _affix("Reflex Save", "Quality", 3), _parrying(2))
    stats = parrying_split.apply([rec], _shard(**{"Scourge's Guise": _entry("2", 2)}))

    reflex = {(a["type"], a["value"]) for a in _by_name(rec)["Reflex Save"]}
    assert reflex == {("Quality", "3"), ("Insight", "2")}
    assert stats["reflex_added"] == 1


def test_a_name_keyed_rule_would_have_withheld_that_contribution():
    """Pins KTD6 to a demonstrated difference rather than an argument. Swapping
    the bucket key for the name key must visibly lose the contribution."""
    cfg_name_keyed = enchantment_split.SplitConfig(
        folded_name="Parrying", primary_name="Armor Class", primary_key="armor_class",
        primary_corrected_stat="armor_class_corrected",
        extras=(("saves", "Reflex Save", "reflex_added"),),
        shadow_key=enchantment_split.name_only, label="name-keyed")

    rec = _rec("Scourge's Guise", _affix("Reflex Save", "Quality", 3), _parrying(2))
    stats = enchantment_split.rewrite_all(
        [rec], _shard(**{"Scourge's Guise": _entry("2", 2)}),
        lambda r: r.get("name"), cfg_name_keyed)

    assert stats["reflex_added"] == 0, "name-keyed suppression is the defect KTD6 avoids"


# --- quarantine and coverage ---------------------------------------------------

def test_an_unsourced_item_keeps_nothing_and_is_quarantined():
    rec = _rec("Mystery Item", _parrying(6))
    stats = parrying_split.apply([rec], _shard(**{
        "Mystery Item": {"value": {}, "provenance": "unsourced",
                         "raw": ""}}))

    affixes = _by_name(rec)
    assert stats["quarantined"] == 1
    assert all(save not in affixes for save in SAVES), "quarantined items grant no saves"


def test_an_item_absent_from_the_shard_keeps_the_folded_affix_and_is_counted():
    rec = _rec("Brand New Item", _parrying(3))
    stats = parrying_split.apply([rec], _shard())

    assert stats["uncovered"] == 1
    assert "Parrying" in _by_name(rec), "an uncovered item must not be silently rewritten"


def test_applying_twice_is_idempotent():
    shard = _shard(**{"Oathblade": _entry("VIII", 4)})
    rec = _rec("Oathblade", _parrying(8))
    parrying_split.apply([rec], shard)
    first = json.dumps(rec, sort_keys=True)
    parrying_split.apply([rec], shard)

    assert json.dumps(rec, sort_keys=True) == first


# --- the guard -----------------------------------------------------------------

def test_a_roman_numeral_outside_the_confirmed_lookup_is_reported():
    """R5/KTD5. Three points were each confirmed individually; a fourth numeral
    must fail rather than be extrapolated."""
    shard = {"harvested": {"Invented": _entry("II", 1)},
             "snapshots": {"{{parrying|ii}}": {"tooltip": (
                 "Parrying II: Passive: +1 Insight bonus to Armor Class, +1 Insight "
                 "bonus to Fortitude, Reflex, and Will Saving throws.")}}}
    report = parrying_split.check_against_snapshots(shard)

    assert any("outside the confirmed" in p for p in report["problems"]), report


def test_a_roman_magnitude_disagreeing_with_the_lookup_is_reported():
    shard = {"harvested": {"Oathblade": _entry("VIII", 8)},
             "snapshots": {"{{parrying|viii}}": {"tooltip": (
                 "Parrying VIII: Passive: +8 Insight bonus to Armor Class, +8 Insight "
                 "bonus to Fortitude, Reflex, and Will Saving throws.")}}}
    report = parrying_split.check_against_snapshots(shard)

    assert any("must grant 4" in p for p in report["problems"]), report


def test_a_version_disagreeing_with_its_own_invocation_is_reported():
    entry = _entry("VIII", 4)
    entry["value"]["version"] = "IV"
    report = parrying_split.check_against_snapshots({"harvested": {"Oathblade": entry}})

    assert any("disagrees with" in p for p in report["problems"]), report


def test_an_unreadable_tooltip_verifies_nothing_rather_than_passing():
    shard = {"harvested": {"Oathblade": _entry("VIII", 4)},
             "snapshots": {"{{parrying|viii}}": {"tooltip": "reworded by an editor"}}}
    report = parrying_split.check_against_snapshots(shard)

    assert any("no known dialect" in p for p in report["problems"]), report


def test_the_guard_refuses_to_pass_over_an_empty_shard():
    for shard in ({}, {"harvested": {}}):
        try:
            parrying_split.check_against_snapshots(shard)
        except ValueError:
            continue
        raise AssertionError("an empty shard must not report a clean guard")


def test_both_tooltip_dialects_read():
    arabic = "Parrying +6: +6 Insight bonus to Armor Class, +6 Insight bonus to Saves."
    roman = ("Parrying VIII: Passive: +4 Insight bonus to Armor Class, +4 Insight "
             "bonus to Fortitude, Reflex, and Will Saving throws.")
    assert parrying_split.tooltip_armor_class(arabic) == 6
    assert parrying_split.tooltip_saves(arabic) == 6
    assert parrying_split.tooltip_armor_class(roman) == 4
    assert parrying_split.tooltip_saves(roman) == 4
    assert parrying_split.tooltip_armor_class("") is None
    assert parrying_split.tooltip_saves("") is None


# --- the shipped shard and the built dataset -----------------------------------

def test_parrying_is_expanded_away_to_exactly_the_four_stats():
    assert parrying_split.EXPANDED_AWAY == {
        "parrying": ["Armor Class", "Fortitude Save", "Reflex Save", "Will Save"]}


def test_the_built_dataset_carries_the_correction_and_no_folded_affix():
    path = os.path.join(ROOT, "web", "data", "items.json")
    if not os.path.exists(path):
        return  # generated artifact; the build itself is the gate
    with open(path) as fh:
        data = json.load(fh)

    assert not [1 for it in data["items"]
                for a in it.get("affixes") or [] if a.get("name") == "Parrying"]
    assert "Parrying" not in data["metadata"]["rankable_affixes"]
    assert data["metadata"]["expanded_away_names"]["parrying"] == [
        "Armor Class", "Fortitude Save", "Reflex Save", "Will Save"]

    coverage = data["metadata"]["parrying_split_coverage"]
    assert coverage["uncovered"] == 0 and coverage["quarantined"] == 0
    assert coverage["armor_class_corrected"] == 4, "R7: exactly four items are corrected"

    # R7/R8 by name, read out of the shipped dataset rather than a fixture.
    want = {"Oathblade": "4", "Balizarde, Protector of the King": "4",
            "Bracers of the Sun Soul": "4", "Bladed Steel Ring": "2",
            "Ethereal Bracers": "1"}
    seen = {}
    for it in data["items"]:
        if it.get("source_item") in want:
            for a in it.get("affixes") or []:
                if a.get("name") == "Armor Class" and a.get("type") == "Insight":
                    seen[it["source_item"]] = a["value"]
    assert seen == want, seen


# --- U4: the guard cannot pass vacuously ---------------------------------------

def test_an_all_unsourced_shard_fails_rather_than_reporting_a_clean_count():
    """Speed's guard increments its counter for an `unsourced` entry BEFORE any
    snapshot lookup, so a shard that verified nothing returns a healthy-looking
    number. `compared` is what makes that impossible here."""
    shard = {"harvested": {"A": {"value": {}, "provenance": "unsourced", "raw": ""},
                           "B": {"value": {}, "provenance": "unsourced", "raw": ""}},
             "snapshots": {}}
    try:
        parrying_split.check_against_snapshots(shard)
    except ValueError as exc:
        assert "compared no derived value" in str(exc)
        return
    raise AssertionError("a shard that compared nothing must not pass")


def test_a_stated_entry_that_never_reached_a_comparison_is_reported():
    shard = {"harvested": {"Oathblade": _entry("VIII", 4)}, "snapshots": {}}
    report = parrying_split.check_against_snapshots(shard)

    assert report["compared"] == 0
    assert any("no tooltip snapshot" in p for p in report["problems"]), report


def test_the_shipped_shard_compares_every_entry():
    from src import harvest
    shard = harvest.load_shard(
        os.path.join(ROOT, "data", "seed", "compendium", "parrying_version.json"),
        "parrying_version")
    report = parrying_split.check_against_snapshots(shard)

    assert not report["problems"], report["problems"][:3]
    assert report["compared"] == len(shard["harvested"]) == 139


def test_the_guard_makes_no_network_call():
    """Offline by construction — it reads a dict. Pinned so a future 'just fetch
    the tooltip' convenience cannot make the build depend on a throttled wiki."""
    import socket
    from src import harvest
    shard = harvest.load_shard(
        os.path.join(ROOT, "data", "seed", "compendium", "parrying_version.json"),
        "parrying_version")

    real = socket.socket

    def _forbidden(*a, **k):
        raise AssertionError("the guard must not open a socket")

    socket.socket = _forbidden
    try:
        parrying_split.check_against_snapshots(shard)
    finally:
        socket.socket = real
