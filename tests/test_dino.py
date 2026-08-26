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
    # #334 — an ELIGIBLE blank is stamped with the two fields the native attach in
    # build_dataset stamps: the membership list, and a deep copy of the catalog def
    # (a bare `sets` list is solver-inert).
    #
    # #338 — and nothing beyond them. `parsed_set_bonuses` plus the umbrella and
    # spell-focus tier expansions used to be replicated here, because the blanks
    # joined `variants` only after the native tier passes had already run. They now
    # join BEFORE those passes, so replicating any of it would be a second owner
    # free to drift from the first — which is how three other passes (parrying,
    # heightened-awareness, speed) came to be skipped on blanks entirely. The tier
    # itself is asserted against a real native carrier in
    # test_built_blanks_are_dread_isle_pieces_shaped_like_natives, which is the only
    # comparison that can catch drift.
    blanks, _, _, _ = dino.build_dino(_seed())
    assert blanks, "seed produces blanks"
    carriers = [b for b in blanks if dino.carries_intrinsic_set(b)]
    assert carriers, "some blanks carry the set"
    for b in carriers:
        assert b["sets"] == [_DREAD]
        assert [s["set"] for s in b["set_bonus"]] == [_DREAD]
        assert b["set_bonus"][0].get("piece_bonuses"), "catalog def carries piece bonuses"
        assert "parsed_set_bonuses" not in b, \
            f"{b['slot']}: tier parsing belongs to the pipeline, not build_dino (#338)"


def _mixed_seed():
    """A seed carrying one of each kind: a plain accessory (carrier), a Set-Bonus
    host, and a weapon (both non-carriers)."""
    seed = _seed()
    seed["crafted_hosts"] = [
        {"host_category": "Non-Minor Artifact Accessories",
         "items": ["Dinosaur Bone Helmet"], "set_bonus_slot": True,
         "iod_slots": [{"type": "Scale", "category": "Accessory"}]},
        {"host_category": "Weapons", "set_bonus_slot": False,
         "iod_slots": [{"type": "Fang", "category": "Weapon"}]},
    ]
    return seed


def test_set_bonus_hosts_and_weapons_carry_no_intrinsic_set():
    # The wiki withholds the set from the three Set-Bonus hosts (their ONE set
    # comes from the Set Bonus augment) and from Dinosaur Bone weapons; stamping
    # it made one host pay for one set and deliver two.
    # docs/wiki-evidence/dino-set-bonus-hosts.md
    blanks, _, _, _ = dino.build_dino(_mixed_seed())
    excluded = [b for b in blanks if not dino.carries_intrinsic_set(b)]
    assert {b["slot"] for b in excluded} == {"Helmet", "Main Hand"}, \
        "the Set-Bonus host and the weapon blank are excluded"
    for b in excluded:
        assert b.get("sets") in (None, []), f"{b['slot']} must carry no sets list"
        assert b.get("set_bonus") == [], f"{b['slot']} must carry no set def"
        assert not b.get("parsed_set_bonuses"), f"{b['slot']} must register no tier"
    # The carriers in the same build are untouched.
    carriers = [b for b in blanks if dino.carries_intrinsic_set(b)]
    assert {b["slot"] for b in carriers} == {"Boots", "Necklace"}
    assert all(b["sets"] == [_DREAD] for b in carriers)
    # And the split is exactly the wiki's: no Set-Bonus host, no weapon, is a carrier.
    for b in blanks:
        if b.get("dino_set_bonus_slot") or b.get("category") == "weapon":
            assert not dino.carries_intrinsic_set(b)
        else:
            assert dino.carries_intrinsic_set(b)


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
    carriers = [b for b in blanks if dino.carries_intrinsic_set(b)]
    assert len(carriers) == 7, \
        f"6 Minor Artifact accessories + the Rune Arm carry it, got {len(carriers)}"
    for b in carriers:
        assert b["sets"] == [_DREAD]
        assert [s["set"] for s in b["set_bonus"]] == [_DREAD]
        tiers = [t for t in b["parsed_set_bonuses"] if t["set"] == _DREAD]
        assert tiers == native_tiers, \
            f"blank {b['slot']} tiers drift from the native carrier's"
    for b in blanks:
        if dino.carries_intrinsic_set(b):
            continue
        assert _DREAD not in (b.get("sets") or []), \
            f"blank {b['slot']} must not carry the set it buys at its Set Bonus slot"
    # Native carriers are unchanged: still present, still intrinsic-only.
    natives = [v for v in dataset["items"]
               if v.get("source") != "dino_crafting_blank"
               and _DREAD in (v.get("sets") or [])]
    assert len(natives) >= 90, "the native Dread Isle carriers are still present"
    assert all("set_membership_slot" not in v for v in natives)


def test_built_blanks_went_through_the_pipeline_verify_gate():
    # #338 — the blanks used to be appended AFTER `verify_mod.apply`, carrying a
    # `verification` stamped at synthesis and an empty reason list. They now enter
    # `variants` ahead of every native tier pass, so the real gate is what decides
    # them and the reason is the gate's own.
    #
    # Non-vacuous where it matters: the four blanks carrying no intrinsic set have
    # no affixes, no augment colors and no `parsed_set_bonuses`, so they reach the
    # verify clause #338 added and nothing else. Before this change they could not
    # have survived the gate at all — which is exactly why they bypassed it.
    dataset = _built()
    blanks = [v for v in dataset["items"] if v.get("source") == "dino_crafting_blank"]
    assert len(blanks) == 11, f"expected the 11 blanks, got {len(blanks)}"
    for b in blanks:
        assert b["verification"] == "verified", \
            f"blank {b['slot']} left the solve at the verify gate"
        assert b["verification_reasons"], \
            f"blank {b['slot']} carries no reason — it did not pass through the gate"
    non_carriers = [b for b in blanks if not dino.carries_intrinsic_set(b)]
    assert {b["slot"] for b in non_carriers} == {"Armor", "Helmet", "Cloak", "Main Hand"}
    for b in non_carriers:
        assert not b.get("affixes") and not b.get("scaling")
        assert not (b.get("augment_slots_norm") or {}).get("colors")
        assert not b.get("parsed_set_bonuses")
        assert any("insert slots" in r for r in b["verification_reasons"]), \
            f"blank {b['slot']} must be admitted on its insert slots, not by accident"


def test_built_coverage_counts_every_emitted_variant():
    # #338 — the coverage disclosure is computed inside `verify_mod.apply`, so the
    # late append left the eleven blanks out of it: `variant_count` read 9099
    # against 9110 emitted records, and the two weapon-side slots the blanks alone
    # occupy had no bucket at all. A coverage model that does not count what ships
    # is a disclosure nobody can check the dataset against.
    dataset = _built()
    cov = dataset["metadata"]["coverage"]
    assert cov["variant_count"] == len(dataset["items"]), \
        "the coverage model must count every emitted record"
    assert cov["totals"]["verified"] + cov["totals"]["quarantined"] == len(dataset["items"])
    for b in (v for v in dataset["items"] if v.get("source") == "dino_crafting_blank"):
        assert b["slot"] in cov["by_slot"], \
            f"slot {b['slot']!r} ships a record but has no coverage bucket"


def test_quarterstaff_pools_merge_only_the_entries_that_differ():
    # #283 — gear-planner ships a `(quarterstaff)` sibling of the Fang and Scale
    # Weapon pools. Merged on #282's model: an option identical in BOTH pools
    # stays ONE unmarked record serving any weapon host; only an option that
    # DIFFERS is emitted per variant. Duplicating all 14 would double-count every
    # insert a quarterstaff can take.
    from src import crafting_catalog
    records, _, cov = dino._native_insert_records(crafting_catalog.load_catalog())
    assert cov["quarterstaff_pools_sourced"] == [
        "Fang (Weapon) (quarterstaff)", "Scale (Weapon) (quarterstaff)"], \
        "both sibling pools are sourced (Claw and Horn ship none)"
    assert cov["quarterstaff_options"] == 14
    assert cov["quarterstaff_options_identical"] == 10, \
        "10 of the 14 are identical to their base twin and dedupe to one record"
    marked = [r for r in records if r.get("quarterstaff") is not None]
    assert len(marked) == 8, "the 4 differing entries, emitted per variant"
    names = sorted({r.get("name") for r in marked})
    assert names == ["Brightscale", "Iridiscent Fang", "Iridiscent Scale",
                     "Shadowscale"], names
    # Every differing entry exists on BOTH sides, and the quarterstaff side is
    # the richer one — these deltas are additive implement bonuses, so a
    # quarterstaff is never offered LESS than the base weapon.
    for name in names:
        pair = {r["quarterstaff"]: r for r in marked if r.get("name") == name}
        assert set(pair) == {True, False}, f"{name} must exist on both sides"
        assert len(pair[True]["affixes"]) > len(pair[False]["affixes"]), \
            f"{name}: the quarterstaff version must be the richer one"


def test_quarterstaff_hosts_are_derived_from_the_pools_they_name():
    # #283 — which records get insert capacity is DERIVED (a host qualifies by
    # naming a `(quarterstaff)` pool in its own crafting list), never listed. A
    # third host gaining the reference upstream joins without an edit.
    hosts = dino.native_quarterstaff_hosts()
    assert sorted(hosts) == ["Attuned Bone Quarterstaff",
                             "Dinosaur Bone Quarterstaff"]
    for name, slots in hosts.items():
        # The keys are PHYSICAL — the `(quarterstaff)` tail is stripped, because
        # which VARIANT a host draws is a property of its weapon type resolved at
        # solve time, not something baked into the slot.
        assert slots == ["Claw||Weapon", "Fang||Weapon", "Horn||Weapon",
                         "Scale||Weapon"], (name, slots)
        assert not any("quarterstaff" in k for k in slots)


def test_a_quarterstaff_host_that_is_not_a_quarterstaff_fails_the_build():
    # The guard that keeps the derivation honest: the pool variant is keyed on the
    # host's declared TYPE, so a host drawing a quarterstaff pool while declaring
    # something else would silently receive the BASE versions its own crafting
    # list contradicts. Corrupt exactly that and confirm it goes red.
    bad = [{"name": "Impostor Bone Quarterstaff", "type": "Longswords",
            "crafting": {"Fang (Weapon) (quarterstaff)": {}}}]
    try:
        dino.native_quarterstaff_hosts(bad)
    except SystemExit as e:
        assert "declares type" in str(e) and "Longswords" in str(e)
    else:
        raise AssertionError("expected SystemExit for a non-quarterstaff host")


def test_a_named_quarterstaff_pool_missing_from_the_catalog_fails_the_build():
    # #283's own comment recorded the soft-read failure mode: a dropped upstream
    # key stops the pool being sourced and NOTHING fails. Prove the hard read.
    host = [{"name": "Dinosaur Bone Quarterstaff", "type": "Quarterstaffs",
             "crafting": {"Fang (Weapon) (quarterstaff)": {}}}]
    try:
        dino.native_quarterstaff_hosts(host, catalog={})
    except SystemExit as e:
        assert "the crafting catalog does not define" in str(e)
    else:
        raise AssertionError("expected SystemExit for an undefined pool")


def test_no_host_naming_a_quarterstaff_pool_is_drift_not_an_empty_case():
    # Refuses to inspect zero records: the two Bone Quarterstaffs named these
    # pools when #283 was written, so an empty result is upstream drift.
    try:
        dino.native_quarterstaff_hosts([{"name": "Plain Sword", "type": "Longswords",
                                         "crafting": {"Claw (Weapon)": {}}}])
    except SystemExit as e:
        assert "no gear-planner record names" in str(e)
    else:
        raise AssertionError("expected SystemExit for an empty host population")


def test_built_quarterstaff_hosts_carry_capacity_and_keep_their_affixes():
    # The defect #283 reports, end to end: both hosts shipped typed
    # `Quarterstaffs` with `dino_slots_norm` absent — zero insert capacity — while
    # the `(quarterstaff)` pools they name went unsourced entirely.
    #
    # And the #364 trap they must not fall into: unlike the eight synthetic
    # blanks, whose native counterparts carry NO affixes, these carry a real
    # +15 Enhancement Bonus. Nothing is synthesized over them, so it survives.
    dataset = _built()
    hosts = [v for v in dataset["items"]
             if v.get("variant_id") in ("Attuned Bone Quarterstaff",
                                        "Dinosaur Bone Quarterstaff")]
    assert len(hosts) == 2, f"both hosts still ship, got {len(hosts)}"
    for h in hosts:
        assert h.get("type") == "Quarterstaffs"
        assert h.get("category") == "weapon"
        assert h.get("dino_slots_norm") == [
            "Claw||Weapon", "Fang||Weapon", "Horn||Weapon", "Scale||Weapon"], \
            f"{h['variant_id']} carries no insert capacity — the #283 defect"
        assert h.get("affixes"), \
            f"{h['variant_id']} lost its own affixes (the #364 trap)"
        assert h.get("verification") == "verified"
    # The untyped blank is untouched and still there: it is how a NON-quarterstaff
    # Dino weapon is modelled, and it must keep passing every main-hand lock.
    blanks = [v for v in dataset["items"] if v.get("source") == "dino_crafting_blank"]
    assert len(blanks) == 11, f"the 11 blanks are unchanged, got {len(blanks)}"
    weapon_blank = next(b for b in blanks if b["slot"] == "Main Hand")
    assert weapon_blank["variant_id"] == "Dinosaur Bone Weapon"
    assert weapon_blank.get("type") is None, "the untyped blank stays untyped"


def test_built_set_bonus_hosts_offer_all_six_dino_sets():
    # The Armor/Helmet/Cloak blanks buy their ONE set at the Set Bonus slot, from
    # the wiki's six-option augment table — the Curse included. They carry none
    # intrinsically, so the KTD3 single-identity filter removes nothing.
    # docs/wiki-evidence/dino-set-bonus-hosts.md
    dataset = _built()
    blanks = [v for v in dataset["items"] if v.get("source") == "dino_crafting_blank"]
    hosts = [b for b in blanks if b.get("set_membership_slot")]
    assert sorted(h["slot"] for h in hosts) == ["Armor", "Cloak", "Helmet"]
    for h in hosts:
        pool = h["set_membership_slot"]["pool"]
        assert _DREAD in pool, f"{h['slot']} pool must offer the Curse as a choice"
        assert len(pool) == 6, "all 6 Dino sets are choosable"
        assert _DREAD not in (h.get("sets") or []), \
            f"{h['slot']} must not also carry the set for free"
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


# --- #541: the synthesized blank is checked against the record it shadows -----
#
# #334 stamped the Curse on all eleven blanks from a hand-written rule while
# gear-planner said otherwise for four of them, and NOTHING compared the two —
# so a Set-Bonus host counted as a Curse piece and spent its Set Bonus slot on a
# second set for ten days, until a player noticed. Membership is now DERIVED from
# the natives each blank collapses, so the stamp cannot contradict the catalog;
# these prove the derivation is real and that every way of breaking it is loud.


def _dino_natives():
    """The gear-planner Dinosaur Bone records, deep-copied so a test may corrupt
    one without poisoning the module cache the other tests read."""
    import copy
    return [copy.deepcopy(it) for it in dino._load_planner_items()
            if (it.get("name") or "").startswith("Dinosaur Bone ")]


def _native_seed():
    from src import dino_native
    return dino_native.native_dino_seed()


def _expect_exit(fragment, **kwargs):
    """Run the real 11-blank build with `kwargs` and require SystemExit naming
    `fragment`. A guard nobody has watched fail is a guard nobody should trust."""
    try:
        dino.build_dino(_native_seed(), **kwargs)
    except SystemExit as e:
        assert fragment in str(e), f"expected {fragment!r} in the failure, got: {e}"
        return str(e)
    raise AssertionError(f"expected SystemExit mentioning {fragment!r}; the build passed")


def test_blank_membership_is_derived_from_the_natives_it_shadows():
    # The derivation is the SOURCE of the stamp, not a second opinion on it: what
    # gear-planner declares for the collapsed natives is what the blank claims.
    derived = dino.native_set_membership()
    blanks, _, _, cov = dino.build_dino(_native_seed())
    assert len(blanks) == 11, f"expected the 11 blanks, got {len(blanks)}"
    for b in blanks:
        assert b["slot"] in derived, \
            f"the {b['slot']} blank must be shadowed by a native record"
        assert list(b.get("sets") or []) == list(derived[b["slot"]]["sets"])
    # And the collapse really is many-to-one, so the unanimity rule has work to
    # do: one Armor blank stands in for the armor types, one Weapon blank for the
    # whole weapon table.
    assert cov["blank_set_shadow_counts"]["Armor"] >= 4
    assert cov["blank_set_shadow_counts"]["Main Hand"] >= 20
    carriers = [b for b in blanks if b.get("sets")]
    assert len(carriers) == 7, \
        f"6 Minor Artifact accessories + the Rune Arm, got {len(carriers)}"
    assert all(b["sets"] == [_DREAD] for b in carriers)


def test_a_derivation_that_contradicts_the_wiki_ruling_fails_the_build():
    # #334's exact defect, in both directions. gear-planner and
    # docs/wiki-evidence/dino-set-bonus-hosts.md are independent sources; when
    # they disagree a human rules on it, and the build does not ship either way.
    over = _dino_natives()          # the #334 direction: a Set-Bonus host given the set
    for it in over:
        if it.get("slot") == "Armor":
            it["sets"] = [_DREAD]
    msg = _expect_exit("disputed", planner_items=over)
    assert "'Armor'" in msg and "dino-set-bonus-hosts.md" in msg

    under = _dino_natives()         # the opposite: a real carrier stripped of it
    for it in under:
        if it.get("slot") == "Belt":
            it.pop("sets", None)
    _expect_exit("disputed", planner_items=under)


def test_an_unratified_set_name_stops_the_build():
    # gear-planner mirrors ddowiki, but a mirror can move ahead of the ruling. A
    # set name nobody has checked against the wiki is an inferred game value the
    # moment it is stamped, so the derivation is pinned to what
    # docs/wiki-evidence/dino-set-bonus-hosts.md actually ruled on.
    substituted = _dino_natives()          # a real carrier put in a different set
    for it in substituted:
        if it.get("slot") == "Belt":
            it["sets"] = ["Dread Stalker"]
    msg = _expect_exit("never ruled on", planner_items=substituted)
    assert "Dread Stalker" in msg and "'Belt'" in msg

    added = _dino_natives()                # ...or in one MORE set than was ruled on
    for it in added:
        if it.get("slot") == "Belt":
            it["sets"] = [_DREAD, "Dread Stalker"]
    _expect_exit("never ruled on", planner_items=added)


def test_a_cosmetic_set_suffix_is_not_an_unratified_name():
    # The pin compares on the canonical key, so gear-planner spelling the same set
    # `"... Set"` is not a false alarm — only a genuinely different set is. A pin
    # that cries wolf gets widened to shut it up, which is how it stops working.
    suffixed = _dino_natives()
    for it in suffixed:
        if it.get("sets"):
            it["sets"] = [f"{_DREAD} Set"]
    derived = dino.native_set_membership(suffixed)
    assert derived["Belt"]["sets"] == (f"{_DREAD} Set",)
    assert not derived["Armor"]["sets"]


def test_the_ratified_list_is_not_empty():
    # A pin with nothing in it is a pin that rejects everything; a pin that has
    # quietly grown is a ruling nobody wrote. Both are worth noticing here.
    assert dino.RATIFIED_SET_NAMES == frozenset({_DREAD}), \
        "widening this needs a ddowiki harvest recorded in docs/wiki-evidence/"


def test_a_split_between_the_collapsed_natives_fails_the_build():
    # One blank cannot honestly claim a membership its natives do not share, so a
    # split is worth failing on rather than resolving by majority or by first-wins.
    split = _dino_natives()
    for it in split:
        if it.get("name") == "Dinosaur Bone Robe":
            it["sets"] = [_DREAD]   # its three Armor siblings still carry none
            break
    else:
        raise AssertionError("the Robe native is gone — the fixture needs updating")
    msg = _expect_exit("disagree on set membership", planner_items=split)
    assert "Dinosaur Bone Robe" in msg


def test_zero_native_records_refuses_to_stamp():
    # Make it refuse to inspect nothing: a guard handed an empty population
    # reports success forever. An explicit empty list is a caller handing over
    # nothing, which is a failure — not an empty answer.
    _expect_exit("no 'Dinosaur Bone' records", planner_items=[])
    # A non-empty catalog that has lost the family reads the same way.
    _expect_exit("no 'Dinosaur Bone' records",
                 planner_items=[{"name": "Legendary Bracers of the Sun Soul",
                                 "slot": "Bracers", "sets": []}])


def test_a_blank_no_native_shadows_fails_the_build():
    # The join drifting is the failure #541 exists to forbid: an unshadowed blank
    # is a synthesized record nothing checks, which is where #334 lived.
    orphaned = [it for it in _dino_natives() if it.get("slot") != "Boots"]
    assert orphaned, "the fixture must stay non-empty so this is not the zero-record guard"
    msg = _expect_exit("no gear-planner Dinosaur Bone record shadows", planner_items=orphaned)
    assert "'Boots'" in msg


def test_built_coverage_discloses_the_derivation():
    # The population is stamped into the built dataset, so "how many blanks carry
    # the set, on whose authority" is read off the artifact, not recounted.
    cov = _built()["metadata"]["dino_coverage"]
    assert cov["blank_intrinsic_sets"]["Belt"] == [_DREAD]
    assert cov["blank_intrinsic_sets"]["Armor"] == []
    assert sum(1 for v in cov["blank_intrinsic_sets"].values() if v) == 7
    assert set(cov["blank_intrinsic_sets"]) == set(cov["blank_set_shadow_counts"])
    assert all(n >= 1 for n in cov["blank_set_shadow_counts"].values())
