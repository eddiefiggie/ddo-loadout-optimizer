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


def test_percent_untyped_and_signed_rendering():
    # Percent stats ("Stat (%)") render as +N% Stat and parse to unit=pct on the real stat.
    text, _ = SC._clause({"name": "Armor Class (%)", "type": "Artifact", "value": "15"})
    assert text == "+15% Artifact bonus to Armor Class"
    parsed, flagged = set_parser.parse_piece_text(text)
    assert not flagged and parsed[0]["stat"] == "Armor Class" and parsed[0]["unit"] == "pct"
    # "Untyped" is the catalog's no-type marker -> rendered untyped, not flagged.
    text2, reason2 = SC._clause({"name": "Doublestrike", "type": "Untyped", "value": "5"})
    assert text2 == "+5 bonus to Doublestrike" and reason2 is None
    # negative values keep their sign
    text3, _ = SC._clause({"name": "Threat", "type": "Enhancement", "value": -5})
    assert text3 == "-5 bonus to Threat"


def test_definition_for_resolves_name_drift_against_catalog():
    # The base seed was purged (U7); all defs come from the gear-planner catalog.
    # The " Set" infix drift still canonicalizes into the catalog def.
    base = {}
    cat = _catalog()
    d = SC.definition_for("Adherent of the Mists Set (Legendary)", base, cat)
    assert d is not None
    assert d["set"] == "Adherent of the Mists (Legendary)"


def test_definition_for_none_for_undefined_novelty_set():
    base = {}  # base seed purged (U7)
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


# ---------------------------------------------------------------------------
# #374 — the sets channel is only reachable on the RAW catalog.
# ---------------------------------------------------------------------------

def test_374_load_raw_exposes_the_affix_dicts_that_load_catalog_synthesizes_away():
    """`load_catalog` renders `piece_bonuses` TEXT, so a pipeline rename applied to
    its output finds no `affixes` list and is a permanent silent no-op. The 121
    protected-name occurrences in gearplanner_sets.json are reachable only here."""
    import sys as _sys, os as _os
    _sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
    from src import name_corrections

    raw = SC.load_raw()
    assert len(list(name_corrections._iter_affix_dicts(raw))) > 1000
    assert list(name_corrections._iter_affix_dicts(SC.load_catalog())) == []


def test_374_catalog_from_raw_reads_the_corrected_raw_not_the_file():
    # #374/U4 — the probe name was hard-coded as `Combustion`, our canon, which
    # the refreshed sets file no longer carries: upstream flipped it to
    # `Fire Spell Power`, so the loop matched nothing and the mutation never
    # happened. Nothing about `catalog_from_raw` moved. The probe is now DERIVED
    # from the canon-defence shard — whichever spelling upstream currently emits
    # for that mechanic — so the next flip carries the fixture with it instead of
    # silently emptying it. The vacuity assert below is what caught this.
    import sys as _sys, os as _os
    _sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
    import json as _json
    with open(_os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))),
                            "data", "seed", "compendium",
                            "affix_name_corrections.json"), encoding="utf-8") as fh:
        probe = next(c["source_name"] for c in _json.load(fh)["corrections"]
                     if c["canonical_name"] == "Combustion")

    raw = SC.load_raw()
    hits = 0
    for tiers in raw.values():
        for tier in tiers:
            for a in tier.get("affixes") or []:
                if a.get("name") == probe:
                    a["name"] = "Renamed In Memory"
                    hits += 1
    assert hits, f"{probe!r} occurs nowhere in the raw sets — the fixture mutated nothing"
    text = " ".join(t for e in SC.catalog_from_raw(raw).values() if e["set_bonus"]
                    for t in e["set_bonus"]["piece_bonuses"].values())
    assert "Renamed In Memory" in text
    assert f"bonus to {probe}" not in text
    # `load_catalog` still reads the file, so it is unaffected.
    fresh = " ".join(t for e in SC.load_catalog().values() if e["set_bonus"]
                     for t in e["set_bonus"]["piece_bonuses"].values())
    assert "Renamed In Memory" not in fresh
    assert f"bonus to {probe}" in fresh
