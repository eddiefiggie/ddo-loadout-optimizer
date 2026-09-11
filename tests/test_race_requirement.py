"""R18 (#740) — the wiki-sourced race lock, and the guard that keeps it honest."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import race_requirement as rr  # noqa: E402

VOCAB_PATH = os.path.join(ROOT, "data", "seed", "compendium", "race_vocabulary.json")
SHARD_PATH = os.path.join(ROOT, "data", "seed", "compendium", "race_requirement.json")


def _vocab():
    with open(VOCAB_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def _shard(**entries):
    return {"harvested": entries}


def _rec(name, url, **extra):
    return {"name": name, "url": url, **extra}


def _stated(text):
    return {"value": {"race_text": text}, "provenance": "stated"}


# ---- the join -------------------------------------------------------------

def test_stated_race_is_stamped_as_the_app_label():
    rec = _rec("Hidden Armlets", "/page/Item:Hidden_Armlets")
    stats = rr.apply([rec], _shard(**{
        "Item:Hidden Armlets": _stated("Aasimar Scourge")}), _vocab())

    assert rec["race_req"] == "Aasimar Scourge"
    assert stats["gated"] == 1


def test_case_variant_folds_to_the_canonical_label():
    """The wiki carries both `Warforged` and `warforged`; one gate, one label."""
    rec = _rec("X", "/page/Item:X")
    rr.apply([rec], _shard(**{"Item:X": _stated("warforged")}), _vocab())
    assert rec["race_req"] == "Warforged"


def test_sun_elf_maps_to_the_label_the_wizard_offers():
    """`Sun Elf` is the one harvested value with no exact label in the race list."""
    rec = _rec("X", "/page/Item:X")
    rr.apply([rec], _shard(**{"Item:X": _stated("Sun Elf")}), _vocab())
    assert rec["race_req"] == "Sun Elf (Morninglord)"


def test_stated_no_gate_leaves_the_field_absent():
    """A page that STATES `None` is evidence of no lock — it must not become one."""
    rec = _rec("Cowl", "/page/Item:Cowl")
    stats = rr.apply([rec], _shard(**{"Item:Cowl": _stated("None")}), _vocab())

    assert "race_req" not in rec
    assert stats["stated_no_gate"] == 1


def test_pet_equipment_is_never_a_character_gate():
    """`Pet` as an unmatched race would exclude the item from all 30 races."""
    for text in ("Pet", "Iron Defender", "Bladeforged, Warforged - Iron Defender"):
        rec = _rec("X", "/page/Item:X")
        rr.apply([rec], _shard(**{"Item:X": _stated(text)}), _vocab())
        assert "race_req" not in rec, f"{text!r} must not gate a character"


def test_unsourced_provenance_is_not_stamped():
    rec = _rec("X", "/page/Item:X")
    stats = rr.apply([rec], _shard(**{
        "Item:X": {"value": {"race_text": "Warforged"}, "provenance": "defaulted"}}), _vocab())

    assert "race_req" not in rec
    assert stats["unsourced"] == 1


def test_a_record_the_harvest_never_covered_fails_open():
    rec = _rec("X", "/page/Item:X")
    stats = rr.apply([rec], _shard(), _vocab())
    assert "race_req" not in rec
    assert stats["uncovered"] == 1


def test_the_join_uses_the_record_url_not_the_variant_wiki_url():
    """Measured before the module was written: the absolute URL joins 0 of 542.

    A variant's `wiki_url` is absolute (`https://ddowiki.com/page/Item:X`) while a
    planner record's `url` is relative. Stripping `/page/` from the absolute form
    yields `https://ddowiki.comItem:X`, which matches nothing — and every guard
    still passes, because "nothing was gated" reads exactly like "nothing needed
    gating" once the join is broken. Pinned so the shapes cannot be swapped.
    """
    assert rr.title_for("/page/Item:Hidden_Armlets") == "Item:Hidden Armlets"
    assert rr.title_for("https://ddowiki.com/page/Item:Hidden_Armlets") != "Item:Hidden Armlets"


# ---- the build guard ------------------------------------------------------

def test_vocabulary_guard_passes_on_the_real_shard():
    with open(SHARD_PATH, encoding="utf-8") as fh:
        shard = json.load(fh)
    assert rr.assert_vocabulary(shard, _vocab()) == len(shard["harvested"])


def test_vocabulary_guard_fails_on_an_unclassified_value():
    """Corrupt the input the gate exists to reject, and confirm it goes red."""
    shard = _shard(**{"Item:X": _stated("Warforged"),
                      "Item:Y": _stated("Githzerai")})
    try:
        rr.assert_vocabulary(shard, _vocab())
    except rr.RaceVocabularyError as exc:
        assert "Githzerai" in str(exc), "the failure must name the value to classify"
        assert "Item:Y" in str(exc), "...and where it was seen"
    else:
        assert False, "an unclassified race_text must fail the build, not fail open"


def test_vocabulary_guard_refuses_to_inspect_zero_entries():
    """A gate that inspects nothing is not a gate (conventions/prove-a-guard-fails)."""
    for empty in (_shard(), {"harvested": {"Item:X": {"value": {}, "provenance": "stated"}}}):
        try:
            rr.assert_vocabulary(empty, _vocab())
        except rr.RaceVocabularyError as exc:
            assert "0 entries" in str(exc)
        else:
            assert False, "an empty or mis-keyed shard must fail rather than pass for free"


def test_classify_separates_unclassified_from_classified_no_gate():
    """Two different facts: `.get()` returns None for both, so membership decides."""
    known = rr.classify(_vocab())
    assert "None" in known and known["None"] is None, "classified, no gate"
    assert "Githzerai" not in known, "unclassified — must be distinguishable"


# ---- coverage -------------------------------------------------------------

def test_coverage_counts_after_the_join_not_the_shard():
    recs = [_rec("A", "/page/Item:A"), _rec("B", "/page/Item:B"), _rec("C", "/page/Item:C")]
    rr.apply(recs, _shard(**{"Item:A": _stated("Warforged"),
                             "Item:B": _stated("Warforged"),
                             "Item:C": _stated("None")}), _vocab())
    cov = rr.coverage(recs)
    assert cov == {"gated_records": 2, "distinct_races": 1, "by_race": {"Warforged": 2}}
