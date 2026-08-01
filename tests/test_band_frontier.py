"""U6 — src.band_frontier tests (native-roster ML30-36 band coverage).

`band_coverage` now derives the band directly from the built NATIVE roster (items
carry `ml` + `slot` + `wiki_url`), with no wiki-harvest shard, roster lookup, or
enriched-baseline snapshot. Under single-source completeness every band item is
`enriched` (pending/quarantined no longer occur). Isle of Dread is attributed via
the native Dino signal; the rest of the band is reported under `unattributed`.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src import band_frontier as bf


def _item(name, slot, ml=None, wiki_url=None):
    return {"source_item": name, "slot": slot, "ml": ml,
            "wiki_url": wiki_url or f"https://ddowiki.com/page/Item:{name.replace(' ', '_')}"}


def _dino(name, slot, ml=31):
    return {"source_item": name, "slot": slot, "ml": ml,
            "wiki_url": "https://ddowiki.com/page/Dinosaur_Bone_crafting"}


def test_band_is_native_ml30_36():
    items = [
        _item("In Band Low", "Ring", ml=30),
        _item("In Band High", "Belt", ml=36),
        _item("Below Band", "Ring", ml=29),
        _item("Above Band", "Ring", ml=37),
        _item("No ML", "Trinket", ml=None),
    ]
    cov = bf.band_coverage(items)
    assert cov["totals"]["band_total"] == 2  # only the two ML30-36 items
    keys = set(cov["by_slot"])
    assert "unattributed/Ring" in keys and "unattributed/Belt" in keys


def test_dino_attributed_to_isle_of_dread():
    items = [_dino("Dinosaur Bone Ring", "Ring"), _item("Legendary Thing", "Belt", ml=33)]
    cov = bf.band_coverage(items)
    assert cov["by_slot"]["isle_of_dread/Ring"]["band_total"] == 1
    assert cov["by_slot"]["unattributed/Belt"]["band_total"] == 1
    assert cov["expansions_attributed"] == ["isle_of_dread"]
    assert cov["attributed"] == 1 and cov["unattributed"] == 1


def test_dino_host_without_ml_still_in_band():
    # Synthetic Dino set-bonus hosts can lack an ml; the native Dino signal still
    # places them in the band (endgame Isle of Dread gear).
    items = [_dino("Dinosaur Bone Belt", "Belt", ml=None)]
    cov = bf.band_coverage(items)
    assert cov["by_slot"]["isle_of_dread/Belt"]["band_total"] == 1


def test_every_band_item_is_enriched():
    # Single-source completeness: pending and quarantined never occur.
    items = [_item("A", "Ring", ml=33), _dino("Dinosaur Bone Cloak", "Cloak")]
    cov = bf.band_coverage(items)
    assert cov["totals"]["pending"] == 0
    assert cov["totals"]["quarantined"] == 0
    assert cov["totals"]["enriched"] == cov["totals"]["band_total"]
    for c in cov["by_slot"].values():
        assert c["enriched"] == c["band_total"]
        assert c["pending"] == 0 and c["quarantined"] == 0


def test_dedupe_by_source_item():
    # Tier variants of one item count once in the band.
    items = [_item("Ring of X", "Ring", ml=33), _item("Ring of X", "Ring", ml=33)]
    cov = bf.band_coverage(items)
    assert cov["totals"]["band_total"] == 1


def test_coverage_reconciles():
    items = [_item("A", "Ring", ml=33), _item("B", "Ring", ml=34),
             _dino("Dinosaur Bone Boots", "Boots")]
    cov = bf.band_coverage(items)
    assert sum(c["band_total"] for c in cov["by_slot"].values()) == cov["totals"]["band_total"]
    assert cov["attributed"] + cov["unattributed"] == cov["totals"]["band_total"]


def test_attribution_is_disclosed_as_coarse():
    cov = bf.band_coverage([_item("A", "Ring", ml=33)])
    assert cov["attribution"] == "native-coarse"
    assert "Update NN" in cov["note"] or "Update" in cov["note"]
