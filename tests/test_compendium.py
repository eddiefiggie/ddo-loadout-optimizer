"""U6 — compendium browse-index tests (native-roster derivation).

The index is now derived from the built NATIVE roster (each item's own
source_item + slot + wiki_url), not the retired roster_*.json shards. Under
single-source completeness every native item is solver-active, so every record is
`enriched` and the indexed-only layer has collapsed to 0.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import compendium  # noqa: E402


def _item(name, slot, **extra):
    """A minimal native-shaped item record (source_item + slot + wiki_url)."""
    rec = {"source_item": name, "slot": slot,
           "wiki_url": f"https://ddowiki.com/page/Item:{name.replace(' ', '_')}"}
    rec.update(extra)
    return rec


def test_wiki_url_derives_from_name():
    assert compendium.wiki_url("Abyssal Compass") == "https://ddowiki.com/page/Item:Abyssal_Compass"
    # apostrophes are preserved (MediaWiki keeps them in titles)
    assert compendium.wiki_url("Aussiredar's Gem") == "https://ddowiki.com/page/Item:Aussiredar's_Gem"


def test_every_native_item_is_enriched():
    # Single-source completeness: no known-but-unparsed layer, so every record is
    # enriched and indexed_only is 0 (completeness, not lost coverage).
    items = [_item("Alpha", "Trinket"), _item("Beta", "Trinket"), _item("Gamma", "Trinket")]
    recs, cov = compendium.build_compendium(items)
    assert cov["total_indexed"] == 3
    assert cov["enriched_matched"] == 3
    assert cov["indexed_only"] == 0
    assert all(r["status"] == "enriched" for r in recs)
    assert cov["by_slot"] == {"Trinket": 3}


def test_dedupe_same_name_same_slot():
    """Tier variants of one item recur; a (name, slot) pair indexes once."""
    items = [_item("Robe of X", "Armor"), _item("Robe of X", "Armor"),
             _item("Leather of Y", "Armor")]
    recs, cov = compendium.build_compendium(items)
    assert cov["total_indexed"] == 2  # Robe of X counted once
    names = [r["name"] for r in recs]
    assert names.count("Robe of X") == 1


def test_native_subtype_carried_by_slot():
    # The native `type` sub-type maps into the slot-specific browse field.
    items = [
        _item("Full Plate of Z", "Armor", type="Heavy armor"),
        _item("Axe of W", "Weapon", type="Great Axes", category="weapon"),
        _item("Orb of V", "Off Hand", type="orb"),
    ]
    recs, _ = compendium.build_compendium(items)
    by_name = {r["name"]: r for r in recs}
    assert by_name["Full Plate of Z"]["armor_type"] == "Heavy armor"
    assert by_name["Axe of W"]["weapon_type"] == "Great Axes"
    assert by_name["Orb of V"]["offhand_type"] == "orb"


def test_wiki_url_falls_back_when_absent():
    recs, _ = compendium.build_compendium([{"source_item": "No URL Item", "slot": "Ring"}])
    assert recs[0]["wiki_url"] == "https://ddowiki.com/page/Item:No_URL_Item"


def test_empty_input_returns_empty():
    recs, cov = compendium.build_compendium([])
    assert recs == []
    assert cov["total_indexed"] == 0
    assert cov["indexed_only"] == 0


def test_real_native_roster_indexes_the_full_dataset():
    """The built dataset's native roster indexes at the expected scale, all enriched."""
    import build_dataset as B
    ds = B.build(B.load_seed())
    recs, cov = compendium.build_compendium(ds["items"])
    # Native roster is a superset of the old ~7,658 wiki roster (~8,997 names).
    assert cov["total_indexed"] > 8000
    assert cov["indexed_only"] == 0
    assert cov["enriched_matched"] == cov["total_indexed"]
    assert all(r["status"] == "enriched" for r in recs)
    assert "Ring" in cov["by_slot"] and cov["by_slot"]["Ring"] > 400
    assert "Armor" in cov["by_slot"]
