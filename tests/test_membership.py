"""U7/U3 — chosen-set-membership defs, sourced from the gear-planner set catalog
(single source of truth — the same defs that feed intrinsic set members). Validates
src/membership.py builds the runtime membership_set_defs table and that
build_dataset exports it + attaches set_membership_slot to the 44 Lost Purpose items."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src import membership  # noqa: E402

ITEMS = os.path.join(os.path.dirname(__file__), "..", "web", "data", "items.json")


def test_build_membership_set_defs_shape():
    defs = membership.build_membership_set_defs()
    assert len(defs) == 28, f"expected 28 set defs (22 Vecna + 6 Dino), got {len(defs)}"
    vol = defs["Legendary Vol's Influence"]
    assert vol["tier"] == "legendary"
    stats = {(a["stat"], a["bonus_type"], a["value"]) for t in vol["tiers"] for a in t["affixes"]}
    assert ("Universal Spell Power", "Artifact", 25) in stats
    assert ("Spell Critical Damage", "Legendary", 15) in stats


def test_uses_catalog_vocabulary_not_a_parallel_file():
    # The membership set def must match the catalog vocab intrinsic members use, so a
    # set gives identical stats whether crafted-in or intrinsically completed. The catalog
    # models Vol's spell-crit line as "Universal Spell Lore" / "Spell Focus Mastery".
    defs = membership.build_membership_set_defs()
    vol_stats = {a["stat"] for t in defs["Vol's Influence"]["tiers"] for a in t["affixes"]}
    assert "Universal Spell Lore" in vol_stats
    assert "Spell Focus Mastery" in vol_stats


def test_umbrella_expansion_applied():
    defs = membership.build_membership_set_defs()
    fk = defs["Legendary Forbidden Knowledge"]
    t4 = next(t for t in fk["tiers"] if t["pieces_required"] == 4)
    stats = {a["stat"] for a in t4["affixes"]}
    for ability in ("Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"):
        assert ability in stats, f"{ability} expanded from 'all Ability Scores'"
    assert "all Ability Scores" not in stats


def test_forbidden_knowledge_keeps_all_three_thresholds():
    defs = membership.build_membership_set_defs()
    fk = defs["Legendary Forbidden Knowledge"]
    assert sorted(t["pieces_required"] for t in fk["tiers"]) == [3, 4, 5]


def test_legendary_values_exceed_heroic():
    defs = membership.build_membership_set_defs()
    husp = next(a["value"] for t in defs["Vol's Influence"]["tiers"]
                for a in t["affixes"] if a["stat"] == "Universal Spell Power")
    lusp = next(a["value"] for t in defs["Legendary Vol's Influence"]["tiers"]
                for a in t["affixes"] if a["stat"] == "Universal Spell Power")
    assert (husp, lusp) == (20, 25)


def test_pool_for_tier_lists_same_tier_sets():
    heroic = membership.pool_for_tier("heroic")
    legendary = membership.pool_for_tier("legendary")
    assert len(heroic) == 11 and len(legendary) == 11
    assert "Vol's Influence" in heroic and "Legendary Vol's Influence" in legendary
    assert all(not n.startswith("Legendary ") for n in heroic)


def test_attach_lost_purpose_slots_by_tier():
    variants = [
        {"variant_id": "H", "lost_purpose": "heroic"},
        {"variant_id": "L", "lost_purpose": "legendary"},
        {"variant_id": "X"},  # no marker -> untouched
    ]
    n = membership.attach_lost_purpose_slots(variants)
    assert n == 2
    assert variants[0]["set_membership_slot"]["station"] == "Cannith Repurposing Station"
    assert len(variants[0]["set_membership_slot"]["pool"]) == 11
    assert "Legendary Vol's Influence" in variants[1]["set_membership_slot"]["pool"]
    assert "set_membership_slot" not in variants[2]


def test_items_json_exports_membership_set_defs():
    with open(ITEMS, encoding="utf-8") as fh:
        data = json.load(fh)
    m = data.get("membership_set_defs")
    assert m and len(m) == 28, "items.json exports all 28 membership set defs (22 Vecna + 6 Dino)"
    cov = data["metadata"].get("membership_coverage")
    assert cov and cov["sets"] == 28 and cov["tiers"] >= 26


def test_fire_over_morgrave_raid_gear_are_forbidden_knowledge_members():
    # U3: the Fire Over Morgrave raid weapons/shields ship solver-active (via the
    # gear-planner import) carrying fixed Legendary Forbidden Knowledge membership, so
    # FK can be completed by intrinsic raid pieces (not only awakened Lost Purpose gear).
    with open(ITEMS, encoding="utf-8") as fh:
        data = json.load(fh)
    raid = ["Marro, the Bone of Demons", "Ignition, the Fear and Flame",
            "Colossus, the Breaking Wall"]
    by_name = {}
    for v in data["items"]:
        key = v.get("source_item") or v.get("variant_id")
        by_name.setdefault(key, v)
    for name in raid:
        v = by_name.get(name)
        assert v, f"{name} is in the dataset"
        assert v.get("verification") == "verified", f"{name} is solver-active"
        sets = {s.get("set") for s in (v.get("set_bonus") or [])}
        assert "Legendary Forbidden Knowledge" in sets, f"{name} carries FK membership"


def test_items_json_has_44_lost_purpose_hosts():
    with open(ITEMS, encoding="utf-8") as fh:
        data = json.load(fh)
    hosts = [v for v in data["items"]
             if (v.get("set_membership_slot") or {}).get("station") == "Cannith Repurposing Station"]
    assert len(hosts) == 44, f"expected 44 Lost Purpose hosts, got {len(hosts)}"
    assert all(v.get("verification") == "verified" for v in hosts)
    assert all(len(v["set_membership_slot"]["pool"]) == 11 for v in hosts)


def test_items_json_has_dino_set_bonus_hosts():
    # U4: the Dinosaur Bone Armor/Helmet/Cloak Set-Bonus hosts join one of the 6
    # Dino sets at the Dinosaur Bone crafting station (same primitive, different pool).
    with open(ITEMS, encoding="utf-8") as fh:
        data = json.load(fh)
    dino = [v for v in data["items"]
            if (v.get("set_membership_slot") or {}).get("station") == "Dinosaur Bone crafting"]
    assert len(dino) >= 3, f"expected the 3 Dino Set-Bonus hosts, got {len(dino)}"
    assert all(v["slot"] in ("Armor", "Helmet", "Cloak") for v in dino), "only Armor/Helmet/Cloak carry a Set-Bonus slot"
    assert all(len(v["set_membership_slot"]["pool"]) == 6 for v in dino), "6 Dino sets in the pool"
