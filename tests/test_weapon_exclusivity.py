"""#902 — which one-handed weapons may be wielded twice: the shard, its coverage
guard, and the stamp it drives. Fail-closed is the property under test."""
import copy
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import weapon_exclusivity as W  # noqa: E402

DATASET = os.path.join(ROOT, "web", "data", "items.json")


def _rec(name, type_="Long Swords", **kw):
    url = "https://ddowiki.com/page/Item:" + name.replace(" ", "_")
    return dict({"source_item": name, "variant_id": name, "category": "weapon", "type": type_,
                 "wiki_url": url}, **kw)


def _shard(**entries):
    return {"_meta": {"population_types": ["Long Swords"]}, "harvested": entries}


def _stated(dup, exclusive=False):
    return {"provenance": "stated", "value": {"exclusive": exclusive, "minor_artifact": False, "duplicable": dup}}


def test_a_stated_duplicable_weapon_is_stamped_and_an_exclusive_one_is_not():
    recs = [_rec("Free Blade"), _rec("Locked Blade")]
    shard = _shard(**{"Free Blade": _stated(True), "Locked Blade": _stated(False, exclusive=True)})
    assert W.check(shard, recs)["problems"] == []
    assert W.apply(recs, shard) == 1
    assert recs[0].get("duplicable_weapon") is True and "duplicable_weapon" not in recs[1]


def test_an_unsourced_entry_is_covered_but_never_stamped():
    recs = [_rec("Silent Blade")]
    shard = _shard(**{"Silent Blade": {"provenance": "unsourced", "value": {"duplicable": True}}})
    assert W.check(shard, recs)["problems"] == []
    assert W.apply(recs, shard) == 0 and "duplicable_weapon" not in recs[0]


def test_a_one_handed_weapon_the_harvest_never_saw_fails_the_build():
    recs = [_rec("Free Blade"), _rec("Brand New Blade")]
    probs = W.check(_shard(**{"Free Blade": _stated(True)}), recs)["problems"]
    assert any("Brand New Blade" in p and "re-harvest" in p for p in probs)


def test_the_guard_refuses_to_inspect_zero_weapons():
    probs = W.check(_shard(**{"Free Blade": _stated(True)}), [_rec("Axe", type_="Great Axes")])["problems"]
    assert any("inspected nothing" in p for p in probs)


def test_artifact_drift_between_the_wiki_and_the_catalog_fails():
    probs = W.check(_shard(**{"Relic": _stated(True)}), [_rec("Relic", artifact=True)])["problems"]
    assert any("drifted" in p for p in probs)


def test_an_upgraded_twin_resolves_to_its_base_page_through_its_url():
    rec = _rec("Base Blade")
    rec["source_item"] = "Base Blade [Upgraded]"
    shard = _shard(**{"Base Blade": _stated(True)})
    assert W.apply([rec], shard) == 1


def test_the_real_shard_covers_the_real_catalog():
    if not os.path.exists(DATASET):
        raise AssertionError("web/data/items.json is missing — build it first; a skip here would read as a pass")
    with open(DATASET, encoding="utf-8") as fh:
        items = json.load(fh)["items"]
    shard = W.load()
    assert shard["counts"] == {"population": 2528, "exclusive": 17, "minor_artifact": 0,
                               "unsourced": 2, "duplicable": 2509}
    clean = [copy.deepcopy(v) for v in items]
    cov = W.check(shard, clean)
    assert cov["problems"] == [] and cov["uncovered"] == 0 and cov["weapons_in_population"] == 2531


def test_the_guard_goes_red_when_a_real_entry_is_removed():
    """Proved on the real data, not a fixture: drop one harvested weapon and the
    build must refuse rather than let it fall through to a default."""
    if not os.path.exists(DATASET):
        raise AssertionError("web/data/items.json is missing — build it first")
    with open(DATASET, encoding="utf-8") as fh:
        items = json.load(fh)["items"]
    shard = copy.deepcopy(W.load())
    shard["harvested"].pop("Flametongue")
    probs = W.check(shard, items)["problems"]
    assert any("Flametongue" in p for p in probs)
