"""U2 — Viktranium ("Lamordia") crafting: seed parse, strict quarantine, and
end-to-end propagation of host slots through the variant pipeline."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src import viktranium  # noqa: E402
from src.enrich import parse_enhancement_field, build_item_record  # noqa: E402
from src.variants import expand_item, expand_dataset  # noqa: E402

SEED = os.path.join(os.path.dirname(__file__), "..", "data", "seed", "viktranium.json")
RAW = os.path.join(os.path.dirname(__file__), "..", "data", "seed",
                   "compendium", "raw", "viktranium.json")
WIKI = "https://ddowiki.com/page/Viktranium_Experiment_crafting"


def _seed():
    return json.load(open(SEED, encoding="utf-8"))


# --- seed load path -------------------------------------------------------

def test_seed_parses_to_tier_expanded_records():
    parsed = viktranium.parse_viktranium(_seed())
    recs = parsed["records"]
    assert recs, "expected eligible Viktranium options"
    # every eligible record is fully specified and wiki-traceable
    for r in recs:
        assert r["slot_type"] in viktranium.SLOT_TYPES
        assert r["category"] in viktranium.CATEGORIES
        assert r["stat"] and r["bonus_type"]
        assert r["bonus_type"] in viktranium.BONUS_TYPES
        assert isinstance(r["value"], int)
        assert r["tier"] in ("heroic", "legendary")
        assert r["wiki_url"]
    # both tiers expand: each option yields a heroic and a legendary record
    tiers = {r["tier"] for r in recs}
    assert tiers == {"heroic", "legendary"}
    assert len(recs) % 2 == 0


def test_pool_keyed_by_type_and_category():
    # KTD1: the same stat can live under different (type, category) pools; the
    # coverage keys prove the pool is two-dimensional, not category-only.
    cov = viktranium.parse_viktranium(_seed())["coverage"]
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


def test_committed_seed_regenerates_from_raw():
    # U5 reproducibility: viktranium.json is a pure function of the raw harvest.
    raw = json.load(open(RAW, encoding="utf-8"))["tables"]
    regen, _ = viktranium.structure_from_raw(raw, WIKI)
    assert regen == _seed()


def test_normalize_category_folds_plural_and_singular():
    assert viktranium.normalize_category("Accessories") == "Accessory"
    assert viktranium.normalize_category("Accessory") == "Accessory"
    assert viktranium.normalize_category("Weapons") == "Weapon"
    assert viktranium.normalize_category("Armor") == "Armor"
    assert viktranium.normalize_category("Bogus") is None


# --- host detection in enrich + variant propagation -----------------------

def test_lamordia_slot_template_becomes_host_marker():
    r = parse_enhancement_field("* {{Lamordia Slot|Melancholic|Accessory}}")
    assert r["lamordia_slots"] == [{"type": "Melancholic", "category": "Accessory"}]
    assert "Lamordia Slot" not in r["unmapped"]


def test_unknown_slot_type_is_recorded_not_hosted():
    r = parse_enhancement_field("* {{Lamordia Slot|Bogus|Accessory}}")
    assert r["lamordia_slots"] == []
    assert "Lamordia Slot" in r["unmapped"]


def test_two_lamordia_slots_both_captured():
    r = parse_enhancement_field(
        "* {{Lamordia Slot|Melancholic|Accessory}}\n"
        "* {{Lamordia Slot|Dolorous|Weapon}}")
    assert r["lamordia_slots"] == [
        {"type": "Melancholic", "category": "Accessory"},
        {"type": "Dolorous", "category": "Weapon"},
    ]


def test_host_flows_through_expand_dataset_onto_variant():
    # R4: an enriched host item carries lamordia_slots on its variant.
    rec = build_item_record(
        "Test Amulet", "Neck",
        "* {{Lamordia Slot|Melancholic|Accessory}}\n* {{Stat|CON|13}}",
        WIKI, minimum_level=34)
    assert rec["lamordia_slots"] == [{"type": "Melancholic", "category": "Accessory"}]
    variants = expand_dataset([rec])
    assert variants[0]["lamordia_slots"] == [
        {"type": "Melancholic", "category": "Accessory"}]


def test_non_host_item_has_null_lamordia_slots():
    v = expand_item(build_item_record("Plain Ring", "Ring", "* {{Stat|CON|13}}", WIKI))[0]
    assert v.get("lamordia_slots") in (None, [])
