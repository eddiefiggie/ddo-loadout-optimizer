"""#899 — triaging the wiki delta sorts every changed Item: page into one bucket
and drafts supplement entries for review, never deciding a value itself."""
import importlib.util
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location(
    "triage_wiki_delta", os.path.join(ROOT, "scripts", "triage_wiki_delta.py"))
T = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(T)

RAW = [
    {"name": "Spectral Axe (level 28)", "ml": 28, "slot": "Weapon", "type": "Great Axes",
     "affixes": [{"name": "Enhancement Bonus (Weapon)", "type": "Enhancement", "value": "+12"},
                 {"name": "Crushing", "type": "Bool", "value": 1}]},
    {"name": "Spectral Axe (level 20)", "ml": 20, "slot": "Weapon", "type": "Great Axes",
     "affixes": [{"name": "Enhancement Bonus (Weapon)", "type": "Enhancement", "value": "+9"}]},
    {"name": "Old Ring", "ml": 10, "slot": "Ring", "type": "", "affixes": []},
]
DUMP = {"since": "2026-10-13", "items": {
    "Old Ring": {"edits": 2, "ml": "10"},
    "Spectral Axe (level 32)": {"created": True, "ml": "32", "type": "Great Axe", "slot": "",
                                "enchantments": ["*{{Enhancement bonus~w~15}}", "*{{Crushing~15}}"],
                                "tooltips": ["+15 Enhancement Bonus: +15 to attack.", "Platinum Piece: 1"]},
    "Spectral Axe (level 40)": {"created": True, "ml": "40", "enchantments": [], "tooltips": ["x"]},
    "Hexblood Crown": {"created": True, "ml": "1", "type": "Cosmetic Headwear"},
    "A Stranger Thing": {"created": True, "ml": "30", "type": "Ring"},
    "Gone Page": {"created": True, "missing": True},
}}


def _run():
    return T.triage(DUMP, RAW, "2026-10-17")


def test_every_page_lands_in_exactly_one_bucket():
    out = _run()
    flat = [r["name"] if isinstance(r, dict) else r for rows in out.values() for r in rows]
    assert sorted(flat) == sorted(DUMP["items"])
    assert out["in_upstream"] == ["Old Ring"] and out["cosmetic"] == ["Hexblood Crown"]
    assert out["missing"] == ["Gone Page"] and out["manual"] == ["A Stranger Thing"]


def test_a_tier_drafts_from_the_nearest_lower_sibling_with_its_own_enhancement():
    d = {r["name"]: r["entry"] for r in _run()["sibling"]}["Spectral Axe (level 32)"]
    assert d["sibling"] == "Spectral Axe (level 28)" and d["ml"] == 32
    assert d["url"] == "/page/Item:Spectral_Axe_(level_32)"
    assert d["affixes"] == [["Enhancement Bonus (Weapon)", "Enhancement", "+15"], ["Crushing", "Bool", 1]]
    assert d["evidence"] == ["+15 Enhancement Bonus: +15 to attack."], "currency noise is dropped"
    assert d["harvested"] == "2026-10-17" and "SIBLING" in d["review"][0]


def test_a_draft_without_the_pages_enhancement_keeps_the_siblings_and_says_so():
    d = {r["name"]: r["entry"] for r in _run()["sibling"]}["Spectral Axe (level 40)"]
    assert d["affixes"][0] == ["Enhancement Bonus (Weapon)", "Enhancement", "+12"]
    assert d["review"] == ["every magnitude below is the SIBLING's — check each against `evidence`"]


def test_a_draft_copied_unread_into_the_shard_is_refused():
    import sys
    sys.path.insert(0, ROOT)
    from src import wiki_supplement as W
    drafts = {r["name"]: r["entry"] for r in _run()["sibling"]}
    out = W.expand(RAW, {"items": drafts})
    assert out["records"] == [] and len(out["problems"]) == len(drafts)


def test_the_report_names_every_bucket():
    body = T.report(_run(), "2026-10-13")
    for label in ("Sibling-buildable", "manual read", "Could not be read", "Cosmetic", "Already upstream"):
        assert label in body
