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
