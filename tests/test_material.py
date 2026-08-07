"""U5 (#162) — wiki-sourced item material and its metal classification."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import material  # noqa: E402

CLASS_PATH = os.path.join(ROOT, "data", "seed", "compendium", "material_classification.json")


def _seed():
    with open(CLASS_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def _rec(name, url, **extra):
    return {"name": name, "url": url, **extra}


def _shard(**entries):
    return {"harvested": entries}


def test_stated_material_is_stamped():
    rec = _rec("Adherence", "/page/Item:Adherence")
    stats = material.apply([rec], _shard(**{
        "Item:Adherence": {"value": {"material": "Steel"}, "provenance": "stated"}}))

    assert rec["material"] == "Steel"
    assert stats["stamped"] == 1


def test_unsourced_material_is_not_stamped():
    """`unsourced` means the wiki is silent — the field stays absent so gates fail open."""
    rec = _rec("Mystery", "/page/Item:Mystery")
    stats = material.apply([rec], _shard(**{
        "Item:Mystery": {"value": None, "provenance": "unsourced"}}))

    assert "material" not in rec
    assert stats["unsourced"] == 1


def test_record_absent_from_the_shard_is_untouched():
    rec = _rec("Unharvested", "/page/Item:Unharvested")
    stats = material.apply([rec], _shard())

    assert "material" not in rec
    assert stats["uncovered"] == 1


def test_apply_is_idempotent():
    rec = _rec("Adherence", "/page/Item:Adherence")
    shard = _shard(**{"Item:Adherence": {"value": {"material": "Steel"},
                                         "provenance": "stated"}})
    material.apply([rec], shard)
    before = dict(rec)
    material.apply([rec], shard)
    assert rec == before


def test_classification_maps_both_lists():
    cls = material.classification(_seed())
    assert cls["Steel"] == "metal"
    assert cls["Mithral"] == "metal"
    assert cls["Leather"] == "non_metal"


def test_wood_family_is_non_metal():
    """Darkwood and Densewood are the load-bearing cases: they are the non-metal
    medium armors the old cloth+light approximation wrongly excluded from druids."""
    cls = material.classification(_seed())
    assert cls["Darkwood"] == "non_metal"
    assert cls["Densewood"] == "non_metal", \
        "Densewood is 'as hard as steel' but is wood, not an alloy"
    assert cls["Wood"] == "non_metal"


def test_unstated_metalness_is_left_unclassified():
    """Crystal's metalness is not stated on the wiki, so it must be in NEITHER list —
    the gate fails open on it rather than the seed guessing a side."""
    seed = _seed()
    assert "Crystal" not in seed["metal"]
    assert "Crystal" not in seed["non_metal"]
    assert "Crystal" not in material.classification(seed)


def test_every_classified_material_appears_in_exactly_one_list():
    seed = _seed()
    overlap = set(seed["metal"]) & set(seed["non_metal"])
    assert not overlap, f"a material cannot be both metal and non-metal: {overlap}"


def test_coverage_counts_unclassified_separately():
    """`unclassified` is the honest measure of how complete the restriction is."""
    recs = [
        _rec("a", "/page/Item:a", material="Steel"),
        _rec("b", "/page/Item:b", material="Leather"),
        _rec("c", "/page/Item:c", material="Crystal"),
        _rec("d", "/page/Item:d"),
    ]
    cov = material.coverage(recs, _seed())

    assert cov["stamped"] == 3
    assert cov["metal"] == 1
    assert cov["non_metal"] == 1
    assert cov["unclassified"] == 1
    assert cov["by_material"]["Crystal"] == 1
