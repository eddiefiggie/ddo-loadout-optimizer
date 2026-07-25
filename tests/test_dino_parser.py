"""U1 — Isle of Dread Dino-crafting parser tests (strict provenance).

Insert fixtures are synthetic (the shipped seed's insert pool is sourced in U2),
but exercise the exact provenance gate that governs real records.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import dino_parser  # noqa: E402

_WIKI = "https://ddowiki.com/page/Update_55_named_items"


def test_happy_scale_insert_parses_to_eligible_record():
    records, quarantined = dino_parser.parse_inserts([
        {"type": "Scale", "effect": "+14 Constitution", "wiki_url": _WIKI},
    ])
    assert quarantined == []
    assert len(records) == 1
    r = records[0]
    assert r["dino_type"] == "Scale"
    assert r["stat"] == "Constitution"
    assert r["value"] == 14
    assert r["bonus_type"] == "Enhancement"
    assert r["wiki_url"] == _WIKI


def test_typed_effect_keeps_its_bonus_type():
    records, _ = dino_parser.parse_inserts([
        {"type": "Fang", "effect": "Insightful Constitution +7", "wiki_url": _WIKI},
    ])
    assert len(records) == 1
    assert records[0]["bonus_type"] == "Insightful"
    assert records[0]["value"] == 7
    assert records[0]["dino_type"] == "Fang"


def test_missing_wiki_url_is_quarantined_not_emitted():
    # AE5 — provenance gate. No wiki_url => never solver-eligible.
    records, quarantined = dino_parser.parse_inserts([
        {"type": "Scale", "effect": "+14 Constitution", "wiki_url": ""},
    ])
    assert records == []
    assert len(quarantined) == 1
    assert quarantined[0]["reason"] == "missing wiki_url"


def test_unparseable_effect_is_quarantined():
    # AE5 — magnitude gate. Non-magnitude text is never minted into a value.
    records, quarantined = dino_parser.parse_inserts([
        {"type": "Claw", "effect": "Ghostly", "wiki_url": _WIKI},
    ])
    assert records == []
    assert len(quarantined) == 1


def test_multi_affix_insert_is_quarantined():
    # Fang: Deception packs two affixes into one augment; the per-record model
    # can't represent "both apply from one slot", so it is quarantined.
    records, quarantined = dino_parser.parse_inserts([
        {"type": "Fang",
         "effect": "+11 Enhancement bonus to Sneak Attacks, "
                   "+17 Enhancement bonus to Sneak Attack Damage",
         "wiki_url": _WIKI},
    ])
    assert records == []
    assert quarantined[0]["reason"] == "multi-affix insert (unsupported)"


def test_compound_and_stat_stays_single_affix():
    # "Critical Confirmation and Critical Damage" is one bonus over a compound
    # stat (one value) — eligible, not multi-affix.
    records, quarantined = dino_parser.parse_inserts([
        {"type": "Fang", "effect": "+14 Enhancement bonus to Critical Confirmation and Critical Damage",
         "wiki_url": _WIKI},
    ])
    assert quarantined == []
    assert len(records) == 1
    assert records[0]["value"] == 14


def test_unrecognized_dino_type_is_quarantined():
    records, quarantined = dino_parser.parse_inserts([
        {"type": "Tooth", "effect": "+14 Constitution", "wiki_url": _WIKI},
    ])
    assert records == []
    assert quarantined[0]["reason"] == "unrecognized dino type"


def test_dino_type_is_case_insensitive():
    records, _ = dino_parser.parse_inserts([
        {"type": "horn", "effect": "+30 Physical Resistance Rating", "wiki_url": _WIKI},
    ])
    assert len(records) == 1
    assert records[0]["dino_type"] == "Horn"


def test_accessory_layout_parses_four_typed_slots():
    layouts, quarantined = dino_parser.parse_slot_layouts([
        {"item": "Dinosaur Bone Boots", "slot": "accessory",
         "dino_slots": [{"type": "Scale"}, {"type": "Fang"},
                        {"type": "Claw"}, {"type": "Horn"}],
         "wiki_url": _WIKI},
    ])
    assert quarantined == []
    assert layouts[0]["dino_slots"] == ["Scale", "Fang", "Claw", "Horn"]
    assert layouts[0]["slot"] == "accessory"


def test_weapon_layout_parses_single_scale_slot():
    layouts, _ = dino_parser.parse_slot_layouts([
        {"item": "Legendary Bottle o' Rum", "slot": "weapon",
         "dino_slots": [{"type": "Scale"}], "wiki_url": _WIKI},
    ])
    assert layouts[0]["dino_slots"] == ["Scale"]
    assert layouts[0]["slot"] == "weapon"


def test_item_without_wiki_url_is_quarantined_whole():
    layouts, quarantined = dino_parser.parse_slot_layouts([
        {"item": "Sketchy Boots", "slot": "accessory",
         "dino_slots": [{"type": "Scale"}], "wiki_url": ""},
    ])
    assert layouts == []
    assert quarantined[0]["reason"] == "missing wiki_url"


def test_slot_multiplicity_preserved():
    # Two Scale slots on one item => "Scale" appears twice (KTD3: capacity from data).
    layouts, _ = dino_parser.parse_slot_layouts([
        {"item": "Twin Scale Item", "slot": "accessory",
         "dino_slots": [{"type": "Scale"}, {"type": "Scale"}], "wiki_url": _WIKI},
    ])
    assert layouts[0]["dino_slots"] == ["Scale", "Scale"]


def test_value_last_multi_affix_is_quarantined():
    # An unsigned second magnitude (value-last) must still be caught, not minted
    # into one wrong-value record.
    records, quarantined = dino_parser.parse_inserts([
        {"type": "Fang", "effect": "Sneak Attacks 11, Sneak Attack Damage 17", "wiki_url": _WIKI},
    ])
    assert records == []
    assert quarantined[0]["reason"] == "multi-affix insert (unsupported)"


def test_unrecognized_slot_type_dropped_and_quarantined():
    layouts, quarantined = dino_parser.parse_slot_layouts([
        {"item": "Weird Boots", "slot": "accessory",
         "dino_slots": [{"type": "Scale"}, {"type": "Tooth"}], "wiki_url": _WIKI},
    ])
    assert layouts[0]["dino_slots"] == ["Scale"]      # bad slot dropped, item kept
    assert any(q["reason"].startswith("unrecognized dino slot type") for q in quarantined)


def test_shipped_seed_parses_clean_and_pins_the_pool():
    # The committed Accessory seed: item layouts + the real sourced insert pool.
    seed_path = os.path.join(ROOT, "data", "seed", "dino_crafting.json")
    with open(seed_path, encoding="utf-8") as fh:
        seed = json.load(fh)
    result = dino_parser.parse_dino_crafting(seed)
    cov = result["coverage"]
    assert result["quarantined"]["items"] == []      # every shipped item has a wiki_url
    assert cov["items_sourced"] >= 1
    # Regression pin on the real sourced data (not just synthetic fixtures):
    assert cov["inserts_eligible"] >= 50, cov
    assert cov["inserts_quarantined"] == 3, cov
    for t in ("Scale", "Fang", "Claw", "Horn"):
        assert cov["by_type"][t] > 0, f"no eligible {t} inserts"
    reasons = {q["reason"] for q in result["quarantined"]["inserts"]}
    assert "multi-affix insert (unsupported)" in reasons
    # Every eligible record carries a wiki_url (strict provenance, KTD2).
    for r in result["insert_records"]:
        assert r["wiki_url"]
    # Every shipped item layout carries only canonical Dino slot types.
    for layout in result["slot_layouts"]:
        for t in layout["dino_slots"]:
            assert t in dino_parser.DINO_TYPES
        assert layout["wiki_url"]
