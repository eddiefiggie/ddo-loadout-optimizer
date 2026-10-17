"""#874 — the interim wiki supplement: built in upstream's shape, and retired the
moment upstream catches up.

The guard that matters most is the retirement one. A supplement record that
outlived the upstream parse of the same item would shadow it, or duplicate it.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import planner_items  # noqa: E402
from src import wiki_supplement as W  # noqa: E402

DATASET = os.path.join(ROOT, "web", "data", "items.json")

SIB = {"name": "Spectral Axe (level 28)", "ml": 28, "slot": "Weapon", "type": "Great Axes",
       "quests": ["The Night Revels"], "url": "/page/Item:Spectral_Axe_(level_28)",
       "affixes": [{"name": "Enhancement Bonus (Weapon)", "type": "Enhancement", "value": "+12"}]}
ENTRY = {"sibling": "Spectral Axe (level 28)", "ml": 32, "url": "/page/Item:Spectral_Axe_(level_32)",
         "affixes": [["Enhancement Bonus (Weapon)", "Enhancement", "+15"], ["Crushing", "Bool", 1]],
         "evidence": ["+15 Enhancement Bonus: +15 enhancement bonus to attack and damage rolls."],
         "harvested": "2026-10-17"}


def _shard(**items):
    return {"items": items}


def test_a_record_is_built_from_its_sibling_with_the_pages_level_and_affixes():
    out = W.expand([SIB], _shard(**{"Spectral Axe (level 32)": ENTRY}))
    assert out["problems"] == []
    (rec,) = out["records"]
    assert rec["name"] == "Spectral Axe (level 32)" and rec["ml"] == 32
    assert rec["slot"] == "Weapon" and rec["type"] == "Great Axes" and rec["quests"] == ["The Night Revels"]
    assert rec["url"] == "/page/Item:Spectral_Axe_(level_32)"
    assert rec["affixes"] == [{"name": "Enhancement Bonus (Weapon)", "type": "Enhancement", "value": "+15"},
                              {"name": "Crushing", "type": "Bool", "value": 1}]
    assert SIB["ml"] == 28 and SIB["affixes"][0]["value"] == "+12", "the sibling itself is untouched"


def test_upstream_carrying_the_item_retires_the_entry_loudly():
    upstream = dict(SIB, name="Spectral Axe (level 32)")
    out = W.expand([SIB, upstream], _shard(**{"Spectral Axe (level 32)": ENTRY}))
    assert out["records"] == []
    assert any("upstream now carries this item" in p for p in out["problems"])


def test_a_missing_sibling_or_missing_evidence_fails():
    assert any("sibling" in p for p in W.expand([], _shard(**{"Spectral Axe (level 32)": ENTRY}))["problems"])
    bare = dict(ENTRY, evidence=[])
    assert any("evidence" in p for p in W.expand([SIB], _shard(**{"Spectral Axe (level 32)": bare}))["problems"])


def test_the_shipped_shard_builds_cleanly_against_upstream():
    with open(planner_items.RAW_PATH, encoding="utf-8") as fh:
        raw = json.load(fh)
    out = W.expand(raw, W.load())
    assert out["problems"] == [], out["problems"]
    assert out["coverage"] == {"entries": 6, "records": 6}
    names = sorted(r["name"] for r in out["records"])
    assert names == sorted(f"Spectral {k} (level {n})" for k in ("Great Axe", "Great Crossbow", "Warhammer")
                           for n in (32, 36))


def test_the_built_records_match_their_upstream_siblings_shape():
    if not os.path.exists(DATASET):
        return
    with open(DATASET, encoding="utf-8") as fh:
        data = json.load(fh)
    by = {v["source_item"]: v for v in data["items"]}
    for kind in ("Great Axe", "Great Crossbow", "Warhammer"):
        sib = by[f"Spectral {kind} (level 28)"]
        for lvl in (32, 36):
            v = by[f"Spectral {kind} (level {lvl})"]
            assert v["ml"] == lvl and v["slot"] == sib["slot"] and v["verification"] == "verified"
            assert v["wiki_url"].endswith(f"Spectral_{kind.replace(' ', '_')}_(level_{lvl})")
            assert sorted(a["name"] for a in v["affixes"]) == sorted(a["name"] for a in sib["affixes"])
            assert [a["value"] for a in v["affixes"] if a["name"] == "Enhancement Bonus (Weapon)"] == ["15"]
    assert data["metadata"]["wiki_supplement_coverage"] == {"entries": 6, "records": 6}
