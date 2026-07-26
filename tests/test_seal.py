"""U2 — Seal-slot crafting: seed parse, strict quarantine, coverage.

Covers the plan's U2 test scenarios: the Undeath pool parses to 18 options
(6 stats x 3 bonus tiers) with correct (stat, bonus_type, value); the stubbed
Fire/Gloom/Mist pools parse to zero options and are reported pending; ambiguous
lines quarantine, never guess."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src import seal  # noqa: E402

SEED = os.path.join(os.path.dirname(__file__), "..", "data", "seed", "seal.json")


def _seed():
    return json.load(open(SEED, encoding="utf-8"))


def test_undeath_pool_parses_to_18_options():
    parsed = seal.parse_seal(_seed())
    recs = [r for r in parsed["records"] if r["seal_type"] == "Undeath"]
    assert len(recs) == 18, f"expected 18 Undeath options, got {len(recs)}"
    stats = {"Strength", "Constitution", "Dexterity", "Intelligence", "Wisdom", "Charisma"}
    tiers = {("Enhancement", 15), ("Insightful", 7), ("Quality", 3)}
    seen = {(r["stat"], (r["bonus_type"], r["value"])) for r in recs}
    # every stat x tier combination is present exactly once
    for s in stats:
        for t in tiers:
            assert (s, t) in seen, f"missing {s} at {t}"
    # each record is fully specified and wiki-traceable
    for r in recs:
        assert r["bonus_type"] in {"Enhancement", "Insightful", "Quality"}
        assert isinstance(r["value"], int) and r["value"] > 0
        assert r["wiki_url"].startswith("https://ddowiki.com/")


def test_stub_pools_are_pending_not_errors():
    parsed = seal.parse_seal(_seed())
    cov = parsed["coverage"]
    assert cov["seal_types_sourced"] == ["Undeath"]
    assert set(cov["seal_types_pending"]) == {"Fire", "Gloom", "Mist"}
    assert cov["options_eligible"] == 18


def test_bad_option_is_quarantined_not_guessed():
    bad = {"pools": [{"seal_type": "Undeath", "domain": "clothing/jewelry",
                      "wiki_url": "https://ddowiki.com/page/Ritual_Table",
                      "options": [
                          {"name": "Bogus", "stat": "Strength", "bonus_type": "Nonsense", "value": 15},
                          {"name": "NoMag", "stat": "Wisdom", "bonus_type": "Quality"},
                          {"name": "Good", "stat": "Charisma", "bonus_type": "Enhancement", "value": 15},
                      ]}]}
    parsed = seal.parse_seal(bad)
    assert len(parsed["records"]) == 1  # only the clean option survives
    reasons = " ".join(q["reason"] for q in parsed["quarantined"])
    assert "unrecognized bonus type" in reasons
    assert "missing magnitude" in reasons


def test_normalize_seal_type_folds_prefix_and_case():
    assert seal.normalize_seal_type("Sealed in Undeath") == "Undeath"
    assert seal.normalize_seal_type("undeath") == "Undeath"
    assert seal.normalize_seal_type("Sealed in Fire") == "Fire"
    assert seal.normalize_seal_type("Amber") is None  # excluded from the family
    assert seal.normalize_seal_type("") is None


# --- U1: host detection in the gear-planner import ------------------------

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
from enrich_from_planner import build_record  # noqa: E402


def test_build_record_detects_crafting_seal():
    # Undeath seals live in crafting[]; the augment slot is still captured.
    it = {"name": "Test Trinket", "slot": "Trinket", "ml": 33,
          "affixes": [{"name": "Dodge", "type": "Enhancement", "value": 15}],
          "crafting": ["Sealed in Undeath", "Green Augment Slot"]}
    rec = build_record(it)
    assert rec["seal_slots"] == [{"seal_type": "Undeath", "category": "Trinket"}]
    assert "Green" in rec["augment_slots"]


def test_build_record_detects_bool_affix_seal():
    # Fire seals are affixes[] Bool markers, not crafting[] — proves that path.
    it = {"name": "Test Sword", "slot": "Weapon", "type": "Longswords", "ml": 33,
          "affixes": [{"name": "Sealed in Fire", "type": "Bool", "value": 1}],
          "crafting": []}
    rec = build_record(it)
    assert rec["seal_slots"] == [{"seal_type": "Fire", "category": "Weapon"}]


def test_build_record_no_seal_yields_no_slots():
    it = {"name": "Plain Ring", "slot": "Ring", "ml": 33,
          "affixes": [{"name": "Strength", "type": "Enhancement", "value": 15}],
          "crafting": ["Yellow Augment Slot"]}
    rec = build_record(it)
    assert "seal_slots" not in rec


def test_undyingage_batch_reaches_the_undeath_hosts():
    # Regression for the reachability gap: the 9 Undeath hosts carry
    # quests=["Threats Old and New"] and are absent from every wiki batch; without
    # the QUEST_MAP fix the planner import produced zero of them.
    path = os.path.join(os.path.dirname(__file__), "..", "data", "seed",
                        "compendium", "enriched_batch14_undyingage_planner.json")
    items = json.load(open(path, encoding="utf-8"))["items"]
    undeath = [it for it in items
               if any(s["seal_type"] == "Undeath" for s in it.get("seal_slots", []))]
    assert len(undeath) == 9, f"expected 9 reachable Undeath hosts, got {len(undeath)}"
