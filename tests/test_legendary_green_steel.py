"""#194/#687 — the ONE Legendary Green Steel container: both blank classes, one
pool keyed by (item_class, tier), one host marker carrying the class.

Replaces tests/test_green_steel.py and tests/test_thunder_forged.py, whose two
modules were the same shape under two names — the second describing a system
(Thunder-Forged) with no menu in the catalog at all (#653)."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src import legendary_green_steel as lgs  # noqa: E402
from src import crafting_catalog as CC  # noqa: E402

ITEMS = os.path.join(os.path.dirname(__file__), "..", "web", "data", "items.json")


def test_native_build_sources_both_classes_from_the_catalog():
    out = lgs.build_legendary_green_steel()
    recs = out["records"]
    assert len(recs) == 116 == out["source_options"], "81 accessory + 35 weapon options, one record each"
    assert out["coverage"]["options_split"] == 0
    assert out["coverage"]["pending"] is False
    by = out["coverage"]["by_class"]
    assert set(by) == {"accessory", "weapon"}
    assert (by["accessory"]["source_options"], by["accessory"]["options_eligible"]) == (81, 81)
    assert (by["weapon"]["source_options"], by["weapon"]["options_eligible"]) == (35, 35)
    assert by["accessory"]["tiers_sourced"] == by["weapon"]["tiers_sourced"] == [1, 2, 3]
    assert by["accessory"]["tiers_pending"] == by["weapon"]["tiers_pending"] == []
    assert "gearplanner_crafting.json" in out["coverage"]["source"]
    for r in recs:
        # ATOMIC: the option carries its affixes; the flat per-affix shape must not linger.
        assert "affixes" in r and r["affixes"], r
        assert "stat" not in r, r
        assert {"stat", "bonus_type", "value", "unit"} <= set(r["affixes"][0])
        # Keyed by BOTH the class and the altar, and the menu key agrees with them.
        assert r["item_class"] in CC.LEGENDARY_GREEN_STEEL_CLASSES, r
        assert r["tier"] in (1, 2, 3), r
        assert r["tier_key"] == CC.LEGENDARY_GREEN_STEEL_KEYS[(r["item_class"], r["tier"])], r
        # #653 — every option records the Legendary Altar as its station.
        assert r["source_stations"] and all("Legendary Altar" in st for st in r["source_stations"]), r
    multi = [r for r in recs if len(r["affixes"]) > 1]
    assert len([r for r in multi if r["item_class"] == "accessory"]) == 24
    assert len([r for r in multi if r["item_class"] == "weapon"]) == 1


def test_records_are_deterministic_in_class_then_tier_order():
    recs = lgs.build_legendary_green_steel()["records"]
    order = [(r["item_class"], r["tier"]) for r in recs]
    assert order == sorted(order, key=lambda k: (CC.LEGENDARY_GREEN_STEEL_CLASSES.index(k[0]), k[1]))


def test_dataset_exposes_one_pool_and_the_hosts_by_class():
    data = json.load(open(ITEMS, encoding="utf-8"))
    assert "legendary_green_steel" in data, "items.json exposes the unified pool"
    for legacy in ("green_steel", "thunder_forged"):
        assert legacy not in data, f"the legacy `{legacy}` pool key must be gone"
        assert f"{legacy}_coverage" not in data["metadata"]
    cov = data["metadata"]["legendary_green_steel_coverage"]
    assert cov["hosts_active"] == 48, cov
    assert cov["tier_slots_active"] == 144, cov
    assert cov["hosts_pending"] == [], cov
    assert cov["by_class"]["accessory"]["hosts_active"] == 8
    assert cov["by_class"]["accessory"]["tier_slots_active"] == 24
    assert cov["by_class"]["weapon"]["hosts_active"] == 40
    assert cov["by_class"]["weapon"]["tier_slots_active"] == 120
    hosts = [it for it in data["items"] if it.get("legendary_green_steel_tiers")]
    assert len(hosts) == 48
    assert all(it["source_item"].startswith("Legendary Green Steel") for it in hosts)
    acc = [it for it in hosts if it["legendary_green_steel_tiers"][0]["item_class"] == "accessory"]
    wpn = [it for it in hosts if it["legendary_green_steel_tiers"][0]["item_class"] == "weapon"]
    assert (len(acc), len(wpn)) == (8, 40)
    assert {it["slot"] for it in acc} == {"Belt", "Boots", "Bracers", "Cloak",
                                          "Gloves", "Goggles", "Helmet", "Necklace"}
    assert all(it["category"] == "weapon" for it in wpn)
    for it in hosts:
        cls = it["legendary_green_steel_tiers"][0]["item_class"]
        assert it["legendary_green_steel_tiers"] == [
            {"tier": 1, "item_class": cls}, {"tier": 2, "item_class": cls}, {"tier": 3, "item_class": cls}], it["source_item"]
    # No real Thunder-Forged item is stamped, and no legacy marker survives anywhere.
    for it in data["items"]:
        assert not it.get("thunder_forged_tiers") and not it.get("green_steel_tiers") \
            and not it.get("green_steel_slot"), it["source_item"]
        if "Thunder-Forged" in it["source_item"]:
            assert not it.get("legendary_green_steel_tiers"), it["source_item"]
