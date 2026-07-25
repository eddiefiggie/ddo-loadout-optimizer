"""M4 — compendium roster-layer tests (index build, enriched cross-ref, dedupe)."""
import json
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import compendium  # noqa: E402


def _roster_dir(tmp, categories):
    """Write a roster_test.json shard into tmp and return the dir."""
    path = os.path.join(tmp, "roster_test.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"metadata": {"layer": "roster"}, "categories": categories}, fh)
    return tmp


def test_wiki_url_derives_from_name():
    assert compendium.wiki_url("Abyssal Compass") == "https://ddowiki.com/page/Item:Abyssal_Compass"
    # apostrophes are preserved (MediaWiki keeps them in titles)
    assert compendium.wiki_url("Aussiredar's Gem") == "https://ddowiki.com/page/Item:Aussiredar's_Gem"


def test_indexed_status_and_counts():
    with tempfile.TemporaryDirectory() as tmp:
        d = _roster_dir(tmp, [
            {"category": "Trinket items", "slot": "Trinket", "armor_type": None,
             "items": ["Alpha", "Beta", "Gamma"]},
        ])
        recs, cov = compendium.build_compendium(enriched_names=set(), dirpath=d)
        assert cov["total_indexed"] == 3
        assert cov["indexed_only"] == 3
        assert cov["enriched_matched"] == 0
        assert all(r["status"] == "indexed" for r in recs)
        assert cov["by_slot"] == {"Trinket": 3}


def test_enriched_cross_reference():
    with tempfile.TemporaryDirectory() as tmp:
        d = _roster_dir(tmp, [
            {"category": "Trinket items", "slot": "Trinket",
             "items": ["Alpha", "Beta", "Gamma"]},
        ])
        recs, cov = compendium.build_compendium(enriched_names={"Beta"}, dirpath=d)
        assert cov["enriched_matched"] == 1
        assert cov["indexed_only"] == 2
        by_name = {r["name"]: r["status"] for r in recs}
        assert by_name["Beta"] == "enriched"
        assert by_name["Alpha"] == "indexed"


def test_dedupe_same_name_same_slot():
    """Armor-type cross-listings recur; a (name, slot) pair is indexed once."""
    with tempfile.TemporaryDirectory() as tmp:
        d = _roster_dir(tmp, [
            {"category": "Cloth armor", "slot": "Armor", "armor_type": "cloth",
             "items": ["Robe of X"]},
            {"category": "Light armor", "slot": "Armor", "armor_type": "light",
             "items": ["Robe of X", "Leather of Y"]},
        ])
        recs, cov = compendium.build_compendium(enriched_names=set(), dirpath=d)
        assert cov["total_indexed"] == 2  # Robe of X counted once
        names = [r["name"] for r in recs]
        assert names.count("Robe of X") == 1


def test_type_fields_preserved():
    with tempfile.TemporaryDirectory() as tmp:
        d = _roster_dir(tmp, [
            {"category": "Heavy armor", "slot": "Armor", "armor_type": "heavy",
             "items": ["Full Plate of Z"]},
            {"category": "Great Axes", "slot": "Weapon", "weapon_type": "Great Axes",
             "items": ["Axe of W"]},
        ])
        recs, _ = compendium.build_compendium(enriched_names=set(), dirpath=d)
        by_name = {r["name"]: r for r in recs}
        assert by_name["Full Plate of Z"]["armor_type"] == "heavy"
        assert by_name["Axe of W"]["weapon_type"] == "Great Axes"


def test_missing_dir_returns_empty():
    recs, cov = compendium.build_compendium(dirpath="/nonexistent/compendium/dir")
    assert recs == []
    assert cov["total_indexed"] == 0


def test_real_roster_shard_loads():
    """The shipped worn-slot roster shard parses and yields the expected scale."""
    recs, cov = compendium.build_compendium(enriched_names=set())
    # 4,300+ worn-slot named items indexed across the 12 worn slots + Rune Arm
    assert cov["total_indexed"] > 4000
    assert "Ring" in cov["by_slot"] and cov["by_slot"]["Ring"] > 400
    assert "Armor" in cov["by_slot"]
