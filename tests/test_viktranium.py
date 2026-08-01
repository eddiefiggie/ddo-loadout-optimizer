"""U2 — Viktranium ("Lamordia") crafting: seed parse, strict quarantine, and
end-to-end propagation of host slots through the variant pipeline."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src import viktranium  # noqa: E402
from src.variants import expand_item  # noqa: E402

WIKI = "https://ddowiki.com/page/Viktranium_Experiment_crafting"


# --- native pool (gearplanner_crafting.json) ------------------------------

def test_native_pool_is_tier_expanded_and_two_dimensional():
    parsed = viktranium.build_viktranium()
    recs = parsed["records"]
    assert recs, "expected native Viktranium options"
    for r in recs:
        assert r["slot_type"] in viktranium.SLOT_TYPES
        assert r["category"] in viktranium.CATEGORIES
        assert r["stat"] and r["bonus_type"]
        assert r["tier"] in ("heroic", "legendary")
    cov = parsed["coverage"]
    assert any("/" in k for k in cov["by_pool"]), "pool keys must be type/category"
    assert len(cov["slot_types_sourced"]) >= 2
    assert len(cov["categories_sourced"]) >= 2


def test_unknown_bonus_type_is_quarantined_not_inferred():
    seed = {"pools": [{
        "slot_type": "Melancholic", "category": "Accessory", "wiki_url": WIKI,
        "options": [{"name": "X", "stat": "Charisma", "bonus_type": "Bogus",
                     "unit": "flat", "heroic_value": 5, "legendary_value": 15}],
    }]}
    parsed = viktranium.parse_viktranium(seed)
    assert parsed["records"] == []
    assert any("unrecognized bonus type" in q["reason"] for q in parsed["quarantined"])


def test_missing_magnitude_is_quarantined():
    seed = {"pools": [{
        "slot_type": "Dolorous", "category": "Weapon", "wiki_url": WIKI,
        "options": [{"name": "X", "stat": "Attack", "bonus_type": "Competence",
                     "unit": "flat", "heroic_value": None, "legendary_value": 23}],
    }]}
    parsed = viktranium.parse_viktranium(seed)
    # legendary still records; heroic quarantines rather than being invented
    assert len(parsed["records"]) == 1
    assert parsed["records"][0]["tier"] == "legendary"
    assert any("missing magnitude" in q["reason"] for q in parsed["quarantined"])


# --- raw -> structured regeneration (strict provenance) -------------------

def test_structure_from_raw_quarantines_procs_and_multiaffix():
    raw = [{"heading": "Melancholic (Weapons)", "count": 2, "rows": [
        # a weapon proc: no parseable magnitude -> quarantined
        {"name": "Melancholic Flames",
         "heroic": "Adds Adamantine material type. On hit: 2d6 Fire Damage.",
         "legendary": "Adds Adamantine material type. On hit: 16d6 Fire Damage."},
        # a clean stat affix -> eligible
        {"name": "Melancholic Charisma",
         "heroic": "+5 Enhancement bonus to Charisma.",
         "legendary": "+15 Enhancement bonus to Charisma."},
    ]}]
    seed, quar = viktranium.structure_from_raw(raw, WIKI)
    opts = seed["pools"][0]["options"]
    assert [o["name"] for o in opts] == ["Melancholic Charisma"]
    assert opts[0]["stat"] == "Charisma" and opts[0]["bonus_type"] == "Enhancement"
    assert opts[0]["heroic_value"] == 5 and opts[0]["legendary_value"] == 15
    assert any("Flames" in q["raw"] for q in quar)


def test_structure_from_raw_quarantines_genuine_multiaffix():
    # A single option whose effect lists two clean stat lines must hit the
    # multi-affix quarantine branch (len(affixes) > 1), never leak one affix.
    raw = [{"heading": "Melancholic (Armor)", "count": 1, "rows": [
        {"name": "Melancholic Converter",
         "heroic": "+19 Competence bonus to Positive Healing Amplification\n"
                   "+19 Enhancement bonus to Repair Amplification",
         "legendary": "+61 Competence bonus to Positive Healing Amplification\n"
                      "+61 Enhancement bonus to Repair Amplification"},
    ]}]
    seed, quar = viktranium.structure_from_raw(raw, WIKI)
    assert all(not p["options"] for p in seed["pools"]) or seed["pools"] == []
    assert any("multi-affix" in q["reason"] for q in quar)


def test_structure_from_raw_quarantines_cross_tier_mismatch():
    # a wiki inconsistency where the bonus type changes between tiers must NOT be
    # silently reconciled — it is quarantined.
    raw = [{"heading": "Miserable (Accessories)", "count": 1, "rows": [
        {"name": "Miserable Assassinate",
         "heroic": "+6 Enhancement bonus to Assassinate DCs.",
         "legendary": "+17 Equipment bonus to Assassinate DCs."},
    ]}]
    seed, quar = viktranium.structure_from_raw(raw, WIKI)
    assert seed["pools"] == [] or all(not p["options"] for p in seed["pools"])
    assert any("mismatch" in q["reason"] for q in quar)


def test_parse_base_lamordia_all_three_string_shapes():
    # The base seed encodes host slots as human-readable strings (not the
    # template). All three documented shapes must parse to lamordia_slots.
    single = viktranium.parse_base_lamordia(["Lamordia: Melancholic Slot (Accessory)"])
    assert single == [{"type": "Melancholic", "category": "Accessory"}]
    multi = viktranium.parse_base_lamordia(
        ["Lamordia: Melancholic / Dolorous / Miserable Slots (Accessory)"])
    assert multi == [
        {"type": "Melancholic", "category": "Accessory"},
        {"type": "Dolorous", "category": "Accessory"},
        {"type": "Miserable", "category": "Accessory"},
    ]
    weapon = viktranium.parse_base_lamordia(
        ["Lamordia weapon slots: Melancholic / Dolorous / Miserable / Woeful"])
    assert weapon == [
        {"type": "Melancholic", "category": "Weapon"},
        {"type": "Dolorous", "category": "Weapon"},
        {"type": "Miserable", "category": "Weapon"},
        {"type": "Woeful", "category": "Weapon"},
    ]


def test_parse_base_lamordia_skips_unknown_type_and_category():
    # Strict provenance: an unrecognized slot type or category is skipped, never
    # inferred into a bogus slot.
    assert viktranium.parse_base_lamordia(["Lamordia: Bogus Slot (Accessory)"]) == []
    assert viktranium.parse_base_lamordia(["Lamordia: Melancholic Slot (Nonsense)"]) == []
    assert viktranium.parse_base_lamordia(["Wizardry +269", "Seeker +8"]) == []


def test_is_base_lamordia_line_matches_only_markers():
    assert viktranium.is_base_lamordia_line("Lamordia: Melancholic Slot (Accessory)")
    assert viktranium.is_base_lamordia_line(
        "Lamordia weapon slots: Melancholic / Dolorous")
    assert not viktranium.is_base_lamordia_line("Wizardry +269")


def test_base_lamordia_line_stripped_from_affixes_not_leaked():
    # An enriched base-seed host: the Lamordia marker becomes a slot AND is
    # removed from affix parsing (not left in `flagged`).
    item = {
        "name": "Base Host", "category": "item", "slot": "Ring", "minimum_level": 34,
        "enhancements": ["Lamordia: Melancholic Slot (Accessory)", "Wizardry +269"],
        "binding": None, "location_quest": "", "wiki_url": WIKI,
    }
    v = expand_item(item)[0]
    assert v["lamordia_slots"] == [{"type": "Melancholic", "category": "Accessory"}]
    # the marker did not leak into affixes or flagged
    assert not any("amordia" in str(a.get("stat", "")).lower() for a in v["affixes"])
    assert not any("amordia" in str(f).lower() for f in v["flagged"])
    # the real affix still parsed
    assert any(a["stat"] == "Wizardry" for a in v["affixes"])


def test_normalize_category_folds_plural_and_singular():
    assert viktranium.normalize_category("Accessories") == "Accessory"
    assert viktranium.normalize_category("Accessory") == "Accessory"
    assert viktranium.normalize_category("Weapons") == "Weapon"
    assert viktranium.normalize_category("Armor") == "Armor"
    assert viktranium.normalize_category("Bogus") is None


# --- native host detection: planner_items reads crafting[] "<Type> (<Cat>)" --

def test_native_lamordia_host_marker_from_crafting():
    from src import planner_items as P
    rec = P._record({"name": "H", "slot": "Weapon", "ml": 34, "affixes": [],
                     "crafting": ["Melancholic (Weapon)", "Dolorous (Weapon)"]}, set())
    assert rec["lamordia_slots"] == [
        {"type": "Melancholic", "category": "Weapon"},
        {"type": "Dolorous", "category": "Weapon"}]


def test_native_lamordia_flows_onto_variant():
    from src.variants import expand_dataset
    rec = {"name": "Amulet", "category": "item", "slot": "Necklace", "ml": 34,
           "affixes": [{"name": "Constitution", "type": "Enhancement", "value": "13"}],
           "lamordia_slots": [{"type": "Melancholic", "category": "Accessory"}],
           "minimum_level": 34}
    v = expand_dataset([rec])[0]
    assert v["lamordia_slots"] == [{"type": "Melancholic", "category": "Accessory"}]
