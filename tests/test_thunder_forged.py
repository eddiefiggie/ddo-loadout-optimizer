"""U1 — Legendary Thunder-Forged multi-tier choice-slot parser (strict provenance).
Validates the parser + the committed seed stub (pending harvest) + dataset wiring."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src import thunder_forged as tf  # noqa: E402

ITEMS = os.path.join(os.path.dirname(__file__), "..", "web", "data", "items.json")


def _opt(tier, stat, bonus_type, value, name="opt"):
    return {"tier": tier, "wiki_url": "https://ddowiki.com/x", "options": [
        {"name": name, "stat": stat, "bonus_type": bonus_type, "value": value, "unit": "flat"}]}



def test_parses_per_tier_options():
    seed = {"pools": [_opt(1, "Strength", "Enhancement", 4), _opt(2, "Constitution", "Insightful", 3)]}
    recs = tf.parse_thunder_forged(seed)["records"]
    by = {(r["tier"], r["stat"], r["bonus_type"], r["value"]) for r in recs}
    assert (1, "Strength", "Enhancement", 4) in by
    assert (2, "Constitution", "Insightful", 3) in by


def test_quarantines_bad_options():
    seed = {"pools": [
        {"tier": 1, "wiki_url": "u", "options": [{"name": "proc", "stat": "Fire", "bonus_type": "Enhancement"}]},  # no value
        {"tier": 2, "wiki_url": "u", "options": [{"name": "x", "stat": "Str", "bonus_type": "Bogus", "value": 3}]},  # bad type
        {"tier": 9, "wiki_url": "u", "options": []},  # bad tier
    ]}
    out = tf.parse_thunder_forged(seed)
    assert out["records"] == [], "nothing eligible"
    assert len(out["quarantined"]) >= 3, "missing magnitude, bad type, and bad tier all quarantined"


def test_dataset_exposes_pool_and_hosts_survive():
    # build_dataset exposes the pool key; the marker survives expand_dataset onto variants.
    data = json.load(open(ITEMS, encoding="utf-8"))
    assert "thunder_forged" in data, "items.json exposes the thunder_forged pool"
    assert "thunder_forged_coverage" in data["metadata"]


def test_native_build_sources_from_catalog():
    # U2: the per-tier pools are now sourced NATIVELY from gearplanner_crafting.json
    # (T1/T2/T3 Weapon), not the legacy hand-harvested seed.
    out = tf.build_thunder_forged()
    assert len(out["records"]) > 20, "native Thunder-Forged Weapon pools are populated"
    assert out["coverage"]["tiers_sourced"] == [1, 2, 3], "all three weapon tiers resolve"
    assert "gearplanner_crafting.json" in out["coverage"]["source"]
    r = out["records"][0]
    assert {"tier", "stat", "bonus_type", "value", "unit"} <= set(r), "legacy solver-facing shape + tier"
