"""Tests for src.band_frontier — the R4 ML30-36 band work-list (U1)."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src import band_frontier as bf


def _worklist():
    return bf.build_worklist()


def test_worklist_only_target_expansions():
    wl, _ = _worklist()
    assert wl, "work-list should not be empty"
    exps = {w["expansion"] for w in wl}
    assert exps == {"isle_of_dread", "myth_drannor", "u81"}
    # every entry's update maps to its expansion (attribution is the hard gate)
    for w in wl:
        assert bf.TARGET_UPDATES[w["update"]] == w["expansion"]


def test_every_item_has_a_roster_slot():
    # All 188 band items in the three sets are roster-indexed; none should be Unknown.
    wl, _ = _worklist()
    unknown = [w["name"] for w in wl if w["slot"] == "Unknown"]
    assert not unknown, f"band items missing a roster slot: {unknown}"


def test_status_is_terminal_or_pending():
    wl, _ = _worklist()
    for w in wl:
        assert w["status"] in ("already_enriched", "pending")


def test_known_attribution():
    wl, _ = _worklist()
    by_name = {w["name"]: w for w in wl}
    # Isle of Dread signature item (Dinosaur Bone / Dread Isle's Curse, U55)
    assert by_name["Dinosaur Bone Ring"]["expansion"] == "isle_of_dread"
    assert by_name["Dinosaur Bone Ring"]["update"] == 55
    # U81 Demonweb signature item
    assert by_name["Demogorgon's Reign"]["expansion"] == "u81"
    assert by_name["Demogorgon's Reign"]["update"] == 81


def test_coverage_reconciles_with_worklist():
    wl, cov = _worklist()
    # per-(expansion, slot) band_total sums to the work-list length
    assert sum(c["band_total"] for c in cov.values()) == len(wl)
    for c in cov.values():
        assert c["band_total"] == c["already_enriched"] + c["pending"]
    # coverage counts match a direct recount of the work-list
    for w in wl:
        key = f"{w['expansion']}/{w['slot']}"
        assert key in cov


def test_already_enriched_marks_track_the_corpus():
    # A pending item must NOT be in the enriched corpus; an already_enriched one must be.
    wl, _ = _worklist()
    enriched = bf.enriched_names()
    for w in wl:
        if w["status"] == "already_enriched":
            assert w["name"] in enriched
        else:
            assert w["name"] not in enriched


def test_attribution_source_carries_provenance():
    attr_path = os.path.join(bf.COMPENDIUM_DIR, "band_categories", "ml30_36_attribution.json")
    with open(attr_path, encoding="utf-8") as fh:
        d = json.load(fh)
    assert "ddowiki.com" in d.get("source", "")
    assert d.get("harvested")
    assert len(d["attr"]) >= 500  # the full ML30-36 band was harvested


def test_written_worklist_matches_builder():
    out = bf.write_worklist()
    wl, cov = _worklist()
    assert out["metadata"]["total"] == len(wl)
    assert out["metadata"]["pending"] == sum(1 for w in wl if w["status"] == "pending")
