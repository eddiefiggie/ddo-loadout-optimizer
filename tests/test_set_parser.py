"""U4 — set-bonus parser tests, anchored to real seed piece_bonuses strings."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import set_parser  # noqa: E402


def _affix(affixes, stat_contains):
    for a in affixes:
        if stat_contains.lower() in a["stat"].lower():
            return a
    return None


def test_inline_typed_clause_parses_stat_type_value():
    # Real Saltmarsh Explorer 5-piece line.
    affixes, flagged = set_parser.parse_piece_text(
        "+5 Artifact bonus to Physical and Magical Resistance Rating; "
        "+1 Artifact bonus to all Ability Scores")
    prr = _affix(affixes, "Resistance Rating")
    assert prr is not None
    assert prr["bonus_type"] == "Artifact"
    assert prr["value"] == 5
    ab = _affix(affixes, "Ability Scores")
    assert ab is not None and ab["value"] == 1 and ab["bonus_type"] == "Artifact"
    assert flagged == []


def test_trailing_type_applies_to_all_clauses():
    # Real Wallwatch 3-piece line: the "(Artifact)" at the end types every clause.
    affixes, _ = set_parser.parse_piece_text(
        "+1 Sneak Attack Dice; +15% Fortification Bypass; +10% Doubleshot; "
        "+10 Ranged Power (Artifact)")
    rp = _affix(affixes, "Ranged Power")
    assert rp is not None and rp["bonus_type"] == "Artifact" and rp["value"] == 10
    # a clause earlier in the same line also picks up the trailing type
    ds = _affix(affixes, "Doubleshot")
    assert ds is not None and ds["bonus_type"] == "Artifact"


def test_untyped_clause_defaults_enhancement():
    affixes, _ = set_parser.parse_piece_text("+10 max Hit Points")
    hp = _affix(affixes, "Hit Points")
    assert hp is not None and hp["bonus_type"] == "Enhancement" and hp["value"] == 10


def test_pieces_required_from_label():
    parsed = set_parser.parse_set_bonuses([{
        "set": "Test Set",
        "piece_bonuses": {"5 Pieces": "+5 Artifact bonus to Dodge"},
        "wiki_url": "https://ddowiki.com/page/x",
    }])
    assert len(parsed) == 1
    assert parsed[0]["pieces_required"] == 5
    assert parsed[0]["set"] == "Test Set"
    assert parsed[0]["wiki_url"].startswith("https://ddowiki.com")


def test_vague_clause_is_flagged_not_defaulted():
    # AE5: no explicit magnitude -> quarantine the clause, never invent a value.
    affixes, flagged = set_parser.parse_piece_text("Immunity to Fear")
    assert affixes == []
    assert len(flagged) == 1
    assert flagged[0]["reason"]


def test_non_numeric_piece_label_is_flagged():
    parsed = set_parser.parse_set_bonuses([{
        "set": "Weird Set",
        "piece_bonuses": {"Set Bonus": "+5 Artifact bonus to Dodge"},
    }])
    assert parsed[0]["pieces_required"] is None
    assert any("piece count" in f["reason"] for f in parsed[0]["flagged"])


def test_trailing_type_does_not_override_explicit_inline_type():
    # A trailing "(Artifact)" must not re-type a clause that states its own type.
    affixes, _ = set_parser.parse_piece_text(
        "+15 Quality bonus to Fortification; +10 Ranged Power (Artifact)")
    fort = _affix(affixes, "Fortification")
    assert fort is not None and fort["bonus_type"] == "Quality", "explicit Quality preserved"
    rp = _affix(affixes, "Ranged Power")
    assert rp is not None and rp["bonus_type"] == "Artifact", "untyped clause takes the line type"


def test_membership_marker_is_not_minted_as_a_type():
    # "(Legendary set)" is a set-membership marker, not the "Legendary" bonus type.
    affixes, _ = set_parser.parse_piece_text("+8 Strength (Legendary set)")
    s = _affix(affixes, "Strength")
    assert s is not None
    assert s["bonus_type"] != "Legendary", "must not fabricate a bonus type from a marker"
    assert s["bonus_type"] == "Enhancement"


def test_non_magnitude_text_is_flagged_not_minted():
    # Dice/crit/proc text must be quarantined, never turned into an affix.
    for junk in ["Fireball 6d6", "Fortitude 19-20/x3"]:
        affixes, flagged = set_parser.parse_piece_text(junk)
        assert affixes == [], f"{junk!r} should mint no affix"
        assert len(flagged) == 1


def test_pieces_required_zero_is_not_a_threshold():
    parsed = set_parser.parse_set_bonuses([{
        "set": "Zero Set",
        "piece_bonuses": {"0 Pieces": "+99 Enhancement bonus to Charisma"},
    }])
    assert parsed[0]["pieces_required"] is None, "0 pieces is not a real threshold"


def test_prr_mrr_compound_splits_into_both_stats():
    # "+20 PRR/MRR" (value-first) must expand into both stats, canonicalized to
    # their "Sheltering" affix wording so a target matches every spelling.
    affixes, _ = set_parser.parse_piece_text("+20 PRR/MRR (Artifact)")
    stats = {a["stat"] for a in affixes}
    assert stats == {"Physical Sheltering", "Magical Sheltering"}, stats
    for a in affixes:
        assert a["value"] == 20 and a["bonus_type"] == "Artifact"


def test_whole_seed_set_bonuses_parse_without_exceptions():
    items = json.load(open(os.path.join(ROOT, "web", "data", "items.json"), encoding="utf-8"))["items"]
    total_affixes = 0
    for v in items:
        parsed = set_parser.parse_set_bonuses(v.get("set_bonus"))
        for tier in parsed:
            total_affixes += len(tier["affixes"])
    assert total_affixes > 0, "expected some structured set threshold-affixes from the seed"
