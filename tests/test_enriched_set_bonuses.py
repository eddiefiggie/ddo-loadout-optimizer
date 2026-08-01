"""U3 — enriched set members carry set_bonus after the build-time attach."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import build_dataset as B
from src import set_catalog as SC


def _build():
    return B.build()


def _key(it):
    return it.get("source_item") or it.get("variant_id") or it.get("name")


def test_enriched_member_gets_set_bonus_with_parsed_affixes():
    ds = _build()
    mag = next(it for it in ds["items"] if _key(it) == "Legendary Magma Waders")
    sets = [s["set"] for s in mag.get("set_bonus", [])]
    assert "The Legendary Dread Isle's Curse" in sets
    tiers = [t for t in mag.get("parsed_set_bonuses", []) if t["pieces_required"] == 5]
    assert tiers, "the 5-piece Dread Isle tier must be parsed onto the enriched member"
    stats = {(a["stat"], a["bonus_type"]) for a in tiers[0]["affixes"]}
    # Dread Isle's Curse is base-defined (base-def-wins): its 5-piece grants Profane
    # Physical Sheltering + Universal Spell Power (verbatim wiki stats).
    assert ("Physical Sheltering", "Profane") in stats
    assert ("Universal Spell Power", "Profane") in stats


def test_overlap_set_shares_one_canonical_name():
    # Adherent of the Mists (Legendary): base spelling lacks " Set", enriched has it.
    # After canonicalization both must carry the SAME .set so pieces count together.
    ds = _build()
    names = set()
    for it in ds["items"]:
        for s in it.get("set_bonus", []):
            if "Adherent of the Mists" in s.get("set", "") and "Legendary" in s.get("set", ""):
                names.add(s["set"])
    assert names == {"Adherent of the Mists (Legendary)"}, f"Adherent split across names: {names}"


def test_novelty_set_member_gets_membership_but_no_bonus():
    ds = _build()
    # Legendary Cooking By the Book has no catalog def -> members carry no set_bonus for it.
    for it in ds["items"]:
        for s in it.get("set_bonus", []):
            assert s.get("set") != "Legendary Cooking By the Book"


def test_no_enriched_item_gains_a_set_it_is_not_a_member_of():
    ds = _build()
    catalog = SC.load_catalog()
    base = {}  # base seed purged (U7); all defs come from the catalog
    known = {SC.canonical(n) for n in ["Legendary Cooking By the Book"]}
    for it in ds["items"]:
        for s in it.get("set_bonus", []):
            ck = SC.canonical(s["set"])
            assert ck in base or ck in catalog or ck in known, f"phantom set {s['set']!r} on {_key(it)}"


def test_set_only_piece_survives_verification():
    # A set member with no base affix (only augment slots + set marker) must not be
    # quarantined — its value is its set-threshold contribution (verify admits it).
    ds = _build()
    survivors = [it for it in ds["items"]
                 if it.get("set_bonus") and it.get("verification") == "verified"
                 and not it.get("affixes")]
    # at least some pure set-piece hosts should survive
    assert survivors, "expected at least one stat-less set piece to be verified via set membership"
