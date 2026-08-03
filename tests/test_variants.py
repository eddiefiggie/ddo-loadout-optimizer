"""Tier-variant expansion + the native gear-planner affix path.

The base seed was purged in U7, so these exercise the expansion logic with
synthetic items: the free-text tier/enhancement path (still used for ML-line
ladders) and the NATIVE `affixes` path (gear-planner records). Stat-name
canonicalization moved to the web picker (affix_aliases), so the Python path keeps
names verbatim."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.variants import expand_item, expand_dataset  # noqa: E402


def _free_text(name="Test Item", slot="Ring", enhancements=None, **over):
    base = {"name": name, "category": "weapon" if slot == "Weapon" else "item",
            "slot": slot, "minimum_level": 10, "binding": None,
            "location_quest": "", "wiki_url": "", "augment_slots": [],
            "set_bonus": [], "enhancements": enhancements or []}
    base.update(over)
    return base


def _native(name="Native Ring", slot="Ring", affixes=None, **over):
    base = {"name": name, "category": "weapon" if slot == "Weapon" else "item",
            "slot": slot, "minimum_level": 20, "type": None, "crafting": [],
            "sets": [], "artifact": False, "binding": None, "location_quest": "",
            "wiki_url": "", "augment_slots": [], "set_bonus": [],
            "affixes": affixes if affixes is not None else [
                {"name": "Intimidate", "type": "Competence", "value": "3"}]}
    base.update(over)
    return base


def test_ml_line_item_expands_to_per_tier_variants():
    it = _free_text(name="Tiered Ring", enhancements=[
        "ML3: Seeker +3", "ML10: Seeker +6", "ML20: Seeker +10"])
    variants = expand_item(it)
    assert len(variants) == 3
    mls = sorted(v["minimum_level"] for v in variants)
    assert mls[0] == 3
    seeker_by_ml = {v["minimum_level"]: a["value"]
                    for v in variants for a in v["affixes"] if a["stat"] == "Seeker"}
    assert seeker_by_ml.get(3) == 3
    assert max(seeker_by_ml.values()) > seeker_by_ml[3]


def test_non_tiered_item_yields_single_variant_at_item_ml():
    it = _free_text(enhancements=["Seeker +5"], minimum_level=12)
    variants = expand_item(it)
    assert len(variants) == 1
    assert variants[0]["minimum_level"] == 12


def test_prose_only_tiered_item_is_flagged_not_fabricated():
    it = _free_text(enhancements=["Diplomacy +10"], minimum_level=5,
                    upgradeable="Upgradeable at ML 5/10/15/20/25/30")
    v = expand_item(it)
    assert len(v) == 1
    assert v[0]["tier_values_incomplete"] is True
    assert v[0]["tier_ml_list"] == [5, 10, 15, 20, 25, 30]
    assert v[0]["minimum_level"] == 5


def test_variants_carry_default_restriction_and_armor_fields():
    armor = expand_item(_free_text(slot="Armor", enhancements=["Physical Sheltering +10"]))
    assert armor[0]["restrictions"] == "unknown"
    # No native `type` -> armor_type stays "unknown" (fail-open)
    assert armor[0]["armor_type"] == "unknown"


def test_native_armor_stamps_lowercase_armor_type():
    # U2: native `type` -> lowercase armor class, matching web/dataset.js ARMOR_TYPE_MAP
    heavy = expand_item(_native(name="Plate", slot="Armor", type="Heavy armor"))
    assert heavy[0]["armor_type"] == "heavy"
    cloth = expand_item(_native(name="Robe", slot="Armor", type="Cloth armor"))
    assert cloth[0]["armor_type"] == "cloth"
    # Docents stay "unknown" — handled by the race gate, not the armor-type filter
    doc = expand_item(_native(name="Adamantine Docent", slot="Armor", type="Docents"))
    assert doc[0]["armor_type"] == "unknown"
    # non-armor slots carry no armor_type
    ring = expand_item(_native(name="Ring", slot="Ring"))
    assert ring[0]["armor_type"] is None


def test_expand_dataset_covers_all_items():
    items = [_free_text(name=f"Item {i}", enhancements=["Seeker +5"]) for i in range(3)]
    variants = expand_dataset(items)
    assert {v["source_item"] for v in variants} == {it["name"] for it in items}
    assert len(variants) >= len(items)


def test_expand_dataset_wraps_bad_item_with_name():
    bad = {"name": "Broken Item"}  # missing required fields
    try:
        expand_dataset([bad])
        assert False, "expected ValueError"
    except ValueError as e:
        assert "Broken Item" in str(e)


# --- native gear-planner affix path -----------------------------------------

def test_native_affixes_used_verbatim_and_skip_parser():
    # A record carrying a native `affixes` list must NOT go through
    # parse_enhancements. Prove it by making the parser explode.
    import src.variants as V
    orig = V.parse_enhancements
    V.parse_enhancements = lambda *_a, **_k: (_ for _ in ()).throw(
        AssertionError("parse_enhancements must not run on the native path"))
    try:
        v = expand_item(_native())[0]
    finally:
        V.parse_enhancements = orig
    assert len(v["affixes"]) == 1
    a = v["affixes"][0]
    assert (a["stat"], a["bonus_type"], a["value"]) == ("Intimidate", "Competence", 3)
    assert v["minimum_level"] == 20


def test_native_string_value_coerced_and_percent_flat_detected():
    v = expand_item(_native(affixes=[
        {"name": "Dodge", "type": "Enhancement", "value": "7"},
        {"name": "Fortification", "type": "Insight", "value": "150%"},
        {"name": "Concentration", "type": "Penalty", "value": "-50"},
    ]))[0]
    by = {a["stat"]: a for a in v["affixes"]}
    assert by["Dodge"]["value"] == 7 and by["Dodge"]["unit"] == "flat"
    assert by["Fortification"]["unit"] == "pct"
    assert by["Concentration"]["value"] == -50


def test_native_names_kept_verbatim_no_remap():
    # No vocab remap on the native path: a native name passes through unchanged.
    v = expand_item(_native(affixes=[{"name": "Insight Natural", "type": "Insight", "value": "3"}]))[0]
    assert v["affixes"][0]["stat"] == "Insight Natural"


def test_native_record_carries_marker_fields():
    v = expand_item(_native(augment_slots=["Yellow"], set_bonus=[{"set": "Forbidden Knowledge"}]))[0]
    assert v["augment_slots"] == ["Yellow"]
    assert v["set_bonus"] == [{"set": "Forbidden Knowledge"}]


def test_native_variant_affix_objects_are_not_shared():
    v = expand_item(_native(affixes=[
        {"name": "Seeker", "type": "Enhancement", "value": "5"},
        {"name": "Deadly", "type": "Enhancement", "value": "5"}]))[0]
    ids = [id(a) for a in v["affixes"]]
    assert len(ids) == len(set(ids))
