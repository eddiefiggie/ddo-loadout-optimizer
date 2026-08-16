"""U3 — Dino dataset-integration tests (blank hosts + insert pool + coverage)."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import dino  # noqa: E402

_WIKI = "https://ddowiki.com/page/Dinosaur_Bone_crafting"


def _seed():
    return {
        "metadata": {"system": "Isle of Dread — Dino crafting", "sourcing_status": "test"},
        "items": [
            {"item": "Dinosaur Bone Boots", "slot": "accessory",
             "dino_slots": [{"type": "Scale"}, {"type": "Fang"},
                            {"type": "Claw"}, {"type": "Horn"}], "wiki_url": _WIKI},
            {"item": "Necklace", "slot": "accessory",
             "dino_slots": [{"type": "Scale"}], "wiki_url": _WIKI},
        ],
        "inserts": [
            {"type": "Scale", "effect": "+14 Enhancement bonus to Constitution", "wiki_url": _WIKI},
            {"type": "Claw", "effect": "+35 Enhancement bonus to Physical Resistance Rating", "wiki_url": _WIKI},
        ],
    }


def test_blank_variant_is_pre_verified_host_in_correct_slot():
    blanks, _, _, _ = dino.build_dino(_seed())
    boots = next(b for b in blanks if b["slot"] == "Boots")
    assert boots["verification"] == "verified"           # empty affixes must NOT quarantine it
    assert boots["affixes"] == []
    assert boots["dino_slots_norm"] == [
        "Scale||Accessory", "Fang||Accessory", "Claw||Accessory", "Horn||Accessory"]
    assert boots["minimum_level"] == 31


def test_necklace_blank_maps_to_necklace_slot():
    blanks, _, _, _ = dino.build_dino(_seed())
    neck = next(b for b in blanks if b["slot"] == "Necklace")
    assert neck["dino_slots_norm"] == ["Scale||Accessory"]


def test_insert_pool_sourced_natively_as_units():
    # U4b-ii: the insert OPTION POOL is now sourced natively from
    # gearplanner_crafting.json (the <Type> (<Category>) menu pools), NOT from the
    # seed's `inserts` — only the blank host BODIES still come from the seed. So
    # the pool is the native one regardless of the seed's inserts, keyed by
    # (dino_type, category) with each option carrying an `affixes` unit.
    _, inserts, _, _ = dino.build_dino(_seed())
    assert len(inserts) > 2, "native pool is larger than the tiny seed's 2 inserts"
    for i in inserts:
        assert i["dino_type"] in dino._DINO_TYPES
        assert i["category"] in ("Accessory", "Armor", "Weapon")
        assert i["affixes"] and all("stat" in a and "bonus_type" in a for a in i["affixes"])
    # multi-affix units (KTD4) flow through un-quarantined
    assert any(len(i["affixes"]) > 1 for i in inserts)
    # an explicit empty catalog yields NO inserts (proves the source is the catalog)
    _, empty_inserts, _, _ = dino.build_dino(_seed(), catalog={})
    assert empty_inserts == []


def test_coverage_reports_blank_hosts_and_native_inserts():
    _, inserts, _, cov = dino.build_dino(_seed())
    assert cov["blank_hosts"] == 2           # blanks still from the seed
    assert "quarantined" in cov
    # insert coverage now reflects the NATIVE pool, not the seed's inserts
    assert cov["inserts_eligible"] == len(inserts)
    assert cov["by_type"]["Scale"] > 1       # native Scale pool has many options
    assert cov["insert_source"].startswith("gearplanner_crafting.json")


def test_weapon_crafted_host_maps_to_main_hand():
    # A weapon blank maps to the Main Hand slot (category weapon), NOT deferred.
    seed = {"crafted_hosts": [
        {"host_category": "Weapons", "items": [],
         "iod_slots": [{"type": "Scale", "category": "Weapon"},
                       {"type": "Claw", "category": "Weapon"}],
         "set_bonus_slot": False}]}
    blanks, _, _, cov = dino.build_dino(seed)
    assert len(blanks) == 1
    assert blanks[0]["slot"] == "Main Hand"
    assert blanks[0]["category"] == "weapon"
    assert blanks[0]["dino_slots_norm"] == ["Scale||Weapon", "Claw||Weapon"]


def test_shield_host_is_deferred_not_dropped():
    # Shields/orbs have no Off Hand slot in the solver; they are disclosed as
    # deferred with a reason, not silently dropped (coverage would undercount).
    seed = {"crafted_hosts": [
        {"host_category": "Shields", "items": ["Buckler", "Orb"],
         "iod_slots": [{"type": "Scale", "category": "Weapon"}],
         "set_bonus_slot": False}]}
    blanks, _, _, cov = dino.build_dino(seed)
    assert blanks == []
    raws = {d["raw"] for d in cov["blanks_deferred"]}
    assert {"Buckler", "Orb"} <= raws
    assert any("Off Hand" in d["reason"] for d in cov["blanks_deferred"])


def test_armor_host_carries_set_bonus_flag():
    seed = {"crafted_hosts": [
        {"host_category": "Armors", "items": ["Robe"],
         "iod_slots": [{"type": "Scale", "category": "Armor"},
                       {"type": "Claw", "category": "Accessory"}],
         "set_bonus_slot": True}]}
    blanks, _, _, cov = dino.build_dino(seed)
    armor = next(b for b in blanks if b["slot"] == "Armor")
    assert armor["dino_set_bonus_slot"] is True
    assert "Armor" in cov["set_bonus_hosts"]


def test_set_records_passed_through():
    seed = {"set_augments": [
        {"set_name": "Dread Stalker", "threshold": 3,
         "tier_text": "+3 Artifact bonus to Sneak Attack Dice", "wiki_url": _WIKI}]}
    _, _, sets, cov = dino.build_dino(seed)
    assert len(sets) == 1
    assert sets[0]["set"] == "Dread Stalker"
    assert "DEFERRED" in cov["set_bonus_status"]


def test_empty_seed_yields_nothing_gracefully():
    # Blanks + set records come from the seed (empty -> none). The insert pool is
    # native, so pass an explicit empty catalog to keep this a pure empty-input case.
    blanks, inserts, sets, cov = dino.build_dino({}, catalog={})
    assert blanks == [] and inserts == [] and sets == []
    assert cov["blank_hosts"] == 0


_DREAD = "The Legendary Dread Isle's Curse"


def test_blanks_carry_intrinsic_dread_isle_membership():
    # #334 — every blank is stamped with the FULL native field chain, not a bare
    # `sets` list (which the solver never reads).
    blanks, _, _, _ = dino.build_dino(_seed())
    assert blanks, "seed produces blanks"
    for b in blanks:
        assert b["sets"] == [_DREAD]
        assert [s["set"] for s in b["set_bonus"]] == [_DREAD]
        assert b["set_bonus"][0].get("piece_bonuses"), "catalog def carries piece bonuses"
        tiers = b["parsed_set_bonuses"]
        assert tiers and all(t["set"] == _DREAD for t in tiers)
        assert any(t["pieces_required"] and t["affixes"] for t in tiers), \
            "at least one solvable threshold tier"


def test_blank_set_bonus_def_is_a_deep_copy():
    # Mutating one blank's copy must not leak into the catalog or a sibling record.
    from src import set_catalog
    blanks, _, _, _ = dino.build_dino(_seed())
    assert len(blanks) >= 2
    a, b = blanks[0], blanks[1]
    a["set_bonus"][0]["piece_bonuses"]["99 Pieces"] = "MUTATED"
    a["set_bonus"][0]["set"] = "MUTATED"
    assert "99 Pieces" not in b["set_bonus"][0]["piece_bonuses"]
    assert b["set_bonus"][0]["set"] == _DREAD
    fresh = set_catalog.definition_for(_DREAD, {}, set_catalog.load_catalog())
    assert "99 Pieces" not in (fresh.get("piece_bonuses") or {})
    assert fresh.get("set") == _DREAD


def test_missing_catalog_def_fails_loudly():
    # Strict: a catalog without the set must never ship set-less blanks silently.
    try:
        dino.build_dino(_seed(), sets_catalog={})
    except SystemExit as e:
        assert "no catalog definition" in str(e)
    else:
        raise AssertionError("expected SystemExit for a missing catalog def")


def test_membership_only_catalog_def_skips_tier_stamp_gracefully():
    # The set is KNOWN to the catalog but membership-only (every affix flagged ->
    # set_bonus=None). That is not the missing-set failure: the blanks still count
    # as pieces (`sets` stamped), and the set_bonus/tier stamp is skipped — the
    # same disclosed posture the native channel takes for membership-only sets.
    from src import set_catalog
    cat = {set_catalog.canonical(_DREAD): {"set_bonus": None, "flagged": []}}
    blanks, _, _, _ = dino.build_dino(_seed(), sets_catalog=cat)
    assert blanks, "membership-only must not abort the build"
    for b in blanks:
        assert b["sets"] == [_DREAD]
        assert b["set_bonus"] == []
        assert "parsed_set_bonuses" not in b


_BUILT = None


def _built():
    """Memoize the (expensive) real build so the dataset tests share one run."""
    global _BUILT
    if _BUILT is None:
        import build_dataset
        _BUILT = build_dataset.build()
    return _BUILT


def test_built_blanks_are_dread_isle_pieces_shaped_like_natives():
    # #334 end-to-end: all eleven blanks carry the three set fields, shaped
    # byte-identically to a native carrier's (pins the umbrella/spell-focus tier
    # recipe against pipeline drift), and the def name matches the exported
    # membership_set_defs byte-exactly (a typo means silent no-membership).
    dataset = _built()
    blanks = [v for v in dataset["items"] if v.get("source") == "dino_crafting_blank"]
    assert len(blanks) == 11, f"expected the 11 blanks, got {len(blanks)}"
    assert blanks[0]["sets"][0] in dataset["membership_set_defs"], \
        "stamped name matches membership_set_defs byte-exactly"
    native = next(v for v in dataset["items"]
                  if v.get("source") != "dino_crafting_blank"
                  and _DREAD in (v.get("sets") or []))
    native_tiers = [t for t in native["parsed_set_bonuses"] if t["set"] == _DREAD]
    assert native_tiers, "the native carrier parses Dread Isle tiers"
    for b in blanks:
        assert b["sets"] == [_DREAD]
        assert [s["set"] for s in b["set_bonus"]] == [_DREAD]
        tiers = [t for t in b["parsed_set_bonuses"] if t["set"] == _DREAD]
        assert tiers == native_tiers, \
            f"blank {b['slot']} tiers drift from the native carrier's"
    # Native carriers are unchanged: still present, still intrinsic-only.
    natives = [v for v in dataset["items"]
               if v.get("source") != "dino_crafting_blank"
               and _DREAD in (v.get("sets") or [])]
    assert len(natives) >= 90, "the native Dread Isle carriers are still present"
    assert all("set_membership_slot" not in v for v in natives)


def test_built_set_bonus_hosts_pool_excludes_the_intrinsic_set():
    # KTD3 (#334): the Armor/Helmet/Cloak blanks' Set-Bonus pool must not offer
    # the set they now carry intrinsically — one item can never count as two
    # Dread Isle pieces. Other synthesis fields are untouched.
    dataset = _built()
    blanks = [v for v in dataset["items"] if v.get("source") == "dino_crafting_blank"]
    hosts = [b for b in blanks if b.get("set_membership_slot")]
    assert sorted(h["slot"] for h in hosts) == ["Armor", "Cloak", "Helmet"]
    for h in hosts:
        pool = h["set_membership_slot"]["pool"]
        assert _DREAD not in pool, f"{h['slot']} pool still offers the intrinsic set"
        assert len(pool) == 5, "the other 5 Dino sets remain choosable"
    for b in blanks:
        assert b["dino_slots_norm"], "dino slots unchanged"
        assert b["augment_slots"] == [], "augment slots unchanged"


def test_built_dataset_carries_dino_blanks_and_inserts():
    # End-to-end: the real build wires the shipped seed through.
    dataset = _built()
    assert "dino_inserts" in dataset
    assert len(dataset["dino_inserts"]) >= 1
    blanks = [v for v in dataset["items"] if v.get("source") == "dino_crafting_blank"]
    assert len(blanks) >= 1
    valid_slots = dino._ACCESSORY_WORN | {"Armor", "Main Hand", "Rune Arm"}
    for b in blanks:
        assert b["verification"] == "verified"
        assert b["slot"] in valid_slots
        assert b["dino_slots_norm"]
    assert dataset["metadata"]["dino_coverage"]["blank_hosts"] == len(blanks)
    # M2: two-key weapon/armor slots present in at least one blank.
    all_keys = {k for b in blanks for k in b["dino_slots_norm"]}
    assert any(k.endswith("||Weapon") for k in all_keys)
    assert any(k.endswith("||Armor") for k in all_keys)
