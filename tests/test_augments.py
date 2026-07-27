"""U1 — legendary augment pool import (gear-planner crafting.json)."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

from import_augments import affix_to_string  # noqa: E402

POOL = os.path.join(os.path.dirname(__file__), "..", "data", "seed", "augments.json")


def _pool():
    return json.load(open(POOL, encoding="utf-8"))["items"]


def test_affix_to_string_carries_bonus_type():
    assert affix_to_string({"name": "Constitution", "type": "Insightful", "value": "7"}) == "Insightful Constitution +7"
    assert affix_to_string({"name": "Balance", "type": "Competence", "value": "10"}) == "Competence Balance +10"


def test_affix_to_string_drops_procs_and_base_bonus():
    assert affix_to_string({"name": "Immunity to Fear", "type": "Bool", "value": 1}) is None
    assert affix_to_string({"name": "Enhancement Bonus (Weapon)", "type": "Enhancement", "value": "1"}) is None
    assert affix_to_string({"name": "Something", "type": "Enhancement", "value": "notanumber"}) is None


def test_pool_has_legendary_augments_across_colors_and_lunar_solar():
    items = _pool()
    colors = {it["slot"] for it in items}
    # colored + Lunar/Solar all represented (the prior 49-augment pool lacked Orange, Moon, Sun)
    assert {"Red", "Blue", "Yellow", "Colorless", "Moon", "Sun"} <= colors
    assert len(items) > 49, "the sourced pool must exceed the old incidental 49"


def test_every_pooled_augment_is_typed():
    # Full-import (all levels): the pool spans every ML, but every entry must be a
    # rankable typed augment (procs/untyped are dropped at import).
    for it in _pool():
        assert (it.get("minimum_level") or 0) >= 1, it["name"]
        assert it["category"] == "augment"
        assert it["enhancements"], it["name"]  # at least one parseable typed affix


def test_moon_and_sun_augments_are_present():
    items = _pool()
    assert any(it["slot"] == "Moon" for it in items), "Lunar (Moon) augments sourced"
    assert any(it["slot"] == "Sun" for it in items), "Solar (Sun) augments sourced"


# --- U5: build wiring + fits_slots bake ---------------------------------------

import build_dataset  # noqa: E402


def test_build_bakes_fits_slots_and_exposes_coverage():
    out = build_dataset.build({"metadata": {}, "items": []})
    augs = [v for v in out["items"] if v.get("category") == "augment"]
    assert augs, "augment pool loaded into the build"
    red = next((v for v in augs if (v.get("aug_color") or {}).get("color") == "Red"), None)
    assert red and set(red["fits_slots"]) == {"Red", "Purple", "Orange"}, "Red augment baked with matrix inverse"
    cov = out["metadata"]["augment_coverage"]
    assert cov["legendary_sourced"] >= 200
    assert "Moon" in cov["by_color"] and "Sun" in cov["by_color"], "Lunar/Solar disclosed"
