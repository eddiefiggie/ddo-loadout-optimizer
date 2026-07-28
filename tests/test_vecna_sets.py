"""U1 — Vecna Unleashed set definitions (chosen-set-membership / Cannith Repurposing
Station). Validates data/seed/vecna_sets.json parses cleanly through the strict
set-bonus parser into tiered defs, under strict provenance (nothing inferred)."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.set_parser import parse_piece_text  # noqa: E402

SEED = os.path.join(os.path.dirname(__file__), "..", "data", "seed", "vecna_sets.json")

_BASES = [
    "Forbidden Knowledge", "Armaments of the Archons", "Delight of the Devourer",
    "Devils' Infernal Dance", "The Fury's Rage", "Heart of Blades",
    "The Keeper's Coffin", "Minion of the Mockery", "The Shadow's Emptiness",
    "The Traveler's Guidance", "Vol's Influence",
]


def _sets():
    return json.load(open(SEED, encoding="utf-8"))["sets"]


def test_all_11_sets_present_both_tiers():
    # 11 sets x (Heroic + Legendary) = 22 entries.
    sets = _sets()
    assert len(sets) == 22, f"expected 22 entries, got {len(sets)}"
    for b in _BASES:
        assert b in sets, f"heroic {b} missing"
        assert f"Legendary {b}" in sets, f"legendary {b} missing"


def test_every_tier_parses_with_no_flags():
    # Strict provenance: every piece_bonuses line yields explicit affixes, none flagged.
    sets = _sets()
    total = 0
    for name, spec in sets.items():
        for label, text in spec["piece_bonuses"].items():
            affixes, flagged = parse_piece_text(text)
            assert flagged == [], f"{name} / {label} flagged: {flagged}"
            assert affixes, f"{name} / {label} produced no affixes"
            total += len(affixes)
    assert total >= 88, f"expected all set-bonus affixes parsed, got {total}"


def test_forbidden_knowledge_is_multi_threshold():
    # Forbidden Knowledge is the only multi-threshold Vecna set (3/4/5 pieces).
    fk = _sets()["Legendary Forbidden Knowledge"]
    assert set(fk["piece_bonuses"].keys()) == {"3 Pieces", "4 Pieces", "5 Pieces"}
    assert fk["has_intrinsic_members"], "Forbidden Knowledge has fixed raid members"


def test_legendary_values_exceed_heroic():
    # {{HELstats}}: the Legendary tier scales up. Spot-check Vol's USP (20 -> 25).
    sets = _sets()
    h, _ = parse_piece_text(sets["Vol's Influence"]["piece_bonuses"]["3 Pieces"])
    l, _ = parse_piece_text(sets["Legendary Vol's Influence"]["piece_bonuses"]["3 Pieces"])
    husp = next(a["value"] for a in h if a["stat"] == "Universal Spell Power")
    lusp = next(a["value"] for a in l if a["stat"] == "Universal Spell Power")
    assert (husp, lusp) == (20, 25), f"expected (20, 25), got {(husp, lusp)}"


def test_bonus_types_are_profane_artifact_or_legendary():
    # Forbidden Knowledge = Profane; the other 10 = Artifact; a few lines = Legendary.
    for name, spec in _sets().items():
        for text in spec["piece_bonuses"].values():
            affixes, _ = parse_piece_text(text)
            for a in affixes:
                assert a["bonus_type"] in {"Profane", "Artifact", "Legendary"}, \
                    f"{name}: unexpected bonus type {a['bonus_type']}"
