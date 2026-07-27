"""Tests for src.set_catalog — the enriched-gear set-definition catalog (U1)."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import set_catalog as SC
from src import set_parser


def _catalog():
    return SC.load_catalog()


def test_canonical_normalizes_set_infix_only():
    assert SC.canonical("Adherent of the Mists Set (Legendary)") == "Adherent of the Mists (Legendary)"
    assert SC.canonical("Dread Stalker Set") == "Dread Stalker"
    # tier prefixes are NOT stripped — genuine tiers stay distinct
    assert SC.canonical("Legendary Flamecleansed Fury") == "Legendary Flamecleansed Fury"
    assert SC.canonical("The Legendary Dread Isle's Curse") == "The Legendary Dread Isle's Curse"


def test_catalog_def_round_trips_through_set_parser():
    cat = _catalog()
    entry = cat["The Legendary Dread Isle's Curse"]["set_bonus"]
    assert entry and entry["set"] == "The Legendary Dread Isle's Curse"
    parsed = set_parser.parse_set_bonuses([entry])
    tier = next(t for t in parsed if t["pieces_required"] == 5)
    stats = {(a["stat"], a["bonus_type"], a["value"]) for a in tier["affixes"]}
    # from sets.json: Profane Melee Power +15, Ranged Power +15, Universal Spell Power +25 ...
    assert ("Melee Power", "Profane", 15) in stats
    assert ("Ranged Power", "Profane", 15) in stats
    assert not tier["flagged"], f"no clause should flag for a clean set: {tier['flagged']}"


def test_unknown_bonus_type_is_flagged_not_minted():
    # The provenance gate (KTD5): an unknown type must be flagged, never folded into
    # the stat as a bogus 'Deflection bonus to Armor Class'.
    text, reason = SC._clause({"name": "Armor Class", "type": "Deflection", "value": "10"})
    assert text is None and "unknown bonus type" in reason
    # a Bool proc flags (not a magnitude)
    text2, reason2 = SC._clause({"name": "Acid", "type": "Bool", "value": 1})
    assert text2 is None and "proc/flag" in reason2
    # a known type renders
    text3, _ = SC._clause({"name": "Melee Power", "type": "Profane", "value": "15"})
    assert text3 == "+15 Profane bonus to Melee Power"


def test_definition_for_base_wins_on_canonical_key():
    seed = json.load(open(os.path.join(ROOT, "data", "seed", "ddo_items.json"), encoding="utf-8"))["items"]
    base = SC.base_defs_from_seed(seed)
    cat = _catalog()
    # Adherent: enriched name has " Set"; base def keyed without it — must return the BASE entry
    d = SC.definition_for("Adherent of the Mists Set (Legendary)", base, cat)
    assert d is not None
    assert d["set"] == "Adherent of the Mists (Legendary)"
    assert d.get("source") != "gear-planner sets.json (ddowiki-derived)", "base def must win, not the catalog"


def test_definition_for_none_for_undefined_novelty_set():
    seed = json.load(open(os.path.join(ROOT, "data", "seed", "ddo_items.json"), encoding="utf-8"))["items"]
    base = SC.base_defs_from_seed(seed)
    cat = _catalog()
    assert SC.definition_for("Legendary Cooking By the Book", base, cat) is None


def test_reconciliation_audit_flags_unresolvable_and_passes_real_data():
    cat = _catalog()
    base = {}
    # An enriched set name that resolves to no def anywhere (and isn't known-undefined) flags.
    problems = SC.reconciliation_audit(base, cat, ["Totally Nonexistent Cabal (Legendary)"])
    assert any(p["canonical"] == "Totally Nonexistent Cabal (Legendary)" for p in problems)
    # The real Adherent " Set" drift canonicalizes into a catalog def -> NOT flagged.
    assert SC.reconciliation_audit(base, cat, ["Adherent of the Mists Set (Legendary)"]) == []
    # The known novelty set is allowed (disclosed membership-only), not flagged.
    assert SC.reconciliation_audit(base, cat, ["Legendary Cooking By the Book"],
                                   known_undefined=["Legendary Cooking By the Book"]) == []


def test_parse_rate_reports_applied_and_membership_only():
    cat = _catalog()
    r = SC.parse_rate(cat, ["The Legendary Dread Isle's Curse", "Legendary Cooking By the Book"])
    assert r["sets_with_applied_affixes"] >= 1
    assert "Legendary Cooking By the Book" in r["membership_only_sets"] or \
        "The Legendary Dread Isle's Curse" not in r["membership_only_sets"]
