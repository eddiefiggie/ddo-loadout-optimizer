"""#915 — which dual-slot items may be worn twice, one copy in each slot.

The ring and weapon rule (#566, #902) over a different pair of slots: duplicable
unless Exclusive or a Minor Artifact, fail-closed, and refused when the shard and
the catalog stop describing each other."""
import copy
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src import dual_slot as DS  # noqa: E402


def _v(name, slot, alt, **kw):
    return dict({"source_item": name, "slot": slot, "alt_slots": alt,
                 "wiki_url": "https://ddowiki.com/page/Item:" + name.replace(" ", "_")}, **kw)


SHARD = {"items": {"Chains": {"provenance": "stated", "slot_categories": ["Neck items", "Waist items"],
                              "value": {"exclusive": False, "minor_artifact": False, "duplicable": True}}}}
CHAINS = _v("Chains", "Necklace", ["Belt"])


def test_a_covered_duplicable_item_is_stamped():
    vs = [copy.deepcopy(CHAINS), {"source_item": "Plain", "slot": "Belt"}]
    assert DS.check(SHARD, vs)["problems"] == []
    assert DS.apply(vs, SHARD) == 1 and vs[0]["duplicable_worn"] is True and "duplicable_worn" not in vs[1]


def test_an_exclusive_item_is_not_stamped():
    sh = copy.deepcopy(SHARD)
    sh["items"]["Chains"]["value"] = {"exclusive": True, "minor_artifact": False, "duplicable": False}
    vs = [copy.deepcopy(CHAINS)]
    assert DS.apply(vs, sh) == 0 and "duplicable_worn" not in vs[0]


def test_an_uncovered_dual_slot_item_fails_rather_than_defaulting():
    p = DS.check(SHARD, [CHAINS, _v("Shackles", "Bracers", ["Boots"])])["problems"]
    assert any("'Shackles'" in x and "no entry" in x for x in p)


def test_categories_that_stop_naming_both_slots_fail():
    p = DS.check(SHARD, [_v("Chains", "Necklace", ["Cloak"])])["problems"]
    assert any("drifted" in x for x in p)


def test_a_stale_entry_and_an_empty_population_fail():
    assert any("stale" in x for x in DS.check(SHARD, [{"source_item": "Chains", "slot": "Necklace"}])["problems"])
    assert any("inspected nothing" in x for x in DS.check(SHARD, [])["problems"])


def test_the_committed_shard_reads_every_slot_category_in_the_vocabulary():
    sh = DS.load()
    cats = set(DS.SLOT_CATEGORY.values())
    assert len(sh["items"]) == 6
    for name, e in sh["items"].items():
        assert set(e["slot_categories"]) <= cats and len(e["slot_categories"]) == 2, name
