"""U2 — Legendary Green Steel single-pick choice-slot parser (strict provenance).
Validates the parser + the committed seed stub (pending harvest) + dataset wiring."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src import green_steel as gs  # noqa: E402

ITEMS = os.path.join(os.path.dirname(__file__), "..", "web", "data", "items.json")



def test_parses_flat_options():
    seed = {"metadata": {"wiki_url": "https://ddowiki.com/x"}, "options": [
        {"name": "Con item", "stat": "Constitution", "bonus_type": "Insightful", "value": 8, "unit": "flat"},
        {"name": "SP item", "stat": "Universal Spell Power", "bonus_type": "Artifact", "value": 25, "unit": "flat"}]}
    recs = gs.parse_green_steel(seed)["records"]
    by = {(r["stat"], r["bonus_type"], r["value"]) for r in recs}
    assert ("Constitution", "Insightful", 8) in by
    assert ("Universal Spell Power", "Artifact", 25) in by


def test_quarantines_bad_options():
    seed = {"metadata": {"wiki_url": "u"}, "options": [
        {"name": "proc", "stat": "Fire", "bonus_type": "Enhancement"},        # no value
        {"name": "x", "stat": "Str", "bonus_type": "Bogus", "value": 3},        # bad type
        {"name": "y", "stat": "", "bonus_type": "Enhancement", "value": 3}]}    # no stat
    out = gs.parse_green_steel(seed)
    assert out["records"] == []
    assert len(out["quarantined"]) == 3


def test_dataset_exposes_pool():
    data = json.load(open(ITEMS, encoding="utf-8"))
    assert "green_steel" in data, "items.json exposes the green_steel pool"
    assert "green_steel_coverage" in data["metadata"]


def test_native_build_sources_from_catalog():
    # U2/A2: the pool is now sourced NATIVELY from gearplanner_crafting.json
    # (T1/T2/T3 Equipment), not the legacy hand-harvested seed. The pools DO exist.
    out = gs.build_green_steel()
    assert len(out["records"]) > 50, "native Green Steel Equipment pools are populated"
    assert out["coverage"]["pending"] is False
    assert "gearplanner_crafting.json" in out["coverage"]["source"]
    r = out["records"][0]
    # #194 — ATOMIC: one record per craftable OPTION carrying its own `affixes`
    # list, so the legacy per-affix keys live one level in. The builder used to
    # emit one record per affix, which split each multi-affix option into
    # mutually exclusive siblings the solver could only take one of.
    assert "affixes" in r and r["affixes"], "atomic: the option carries its affixes"
    assert "stat" not in r, "the flat per-affix shape must not linger on the record"
    assert {"stat", "bonus_type", "value", "unit"} <= set(r["affixes"][0]), \
        "legacy solver-facing affix shape preserved INSIDE the option"
    assert any(len(x["affixes"]) > 1 for x in out["records"]), \
        "at least one multi-affix option survives whole — the point of the change"
