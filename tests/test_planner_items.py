"""gear-planner raw-dump reader — NATIVE schema + native host-marker surfacing.

The reader emits gear-planner's own record shape (native `affixes` block
verbatim) and surfaces every host choice-slot marker (augment / seal / lamordia /
nearly-complete / lost-purpose) NATIVELY from `crafting[]`. The legacy internal
remap + structured_affixes/boolean-allowlist were purged in U7."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src import planner_items as P  # noqa: E402

HERE = os.path.dirname(__file__)
RAW = os.path.join(HERE, "..", "data", "seed", "compendium", "raw", "gearplanner_items.json")


def _records():
    return P.load_planner_items()


def _by_name(recs, name):
    for r in recs:
        if r["name"] == name:
            return r
    raise AssertionError(f"{name} not produced by reader")


def test_known_item_maps_slot_ml_augments_and_set():
    recs, _ = _records()
    r = _by_name(recs, "Absorption Gauntlet")
    assert r["slot"] == "Gloves"
    assert r["minimum_level"] == 18
    assert r["augment_slots"] == ["Yellow"]
    assert "Forbidden Knowledge (set)" in r["enhancements"]
    aff = {a["name"]: a for a in r["affixes"]}
    assert "Magical Sheltering" in aff
    assert aff["Magical Sheltering"]["type"] == "Insight"


def test_slot_names_normalized_to_pipeline_vocab():
    recs, _ = _records()
    slots = {r["slot"] for r in recs}
    assert "Helmet" in slots and "Helm" not in slots
    assert "Off Hand" in slots and "Offhand" not in slots


def test_native_block_emitted_verbatim_from_dump():
    recs, _ = _records()
    r = _by_name(recs, "Absorption Gauntlet")
    assert r["type"] == "Hand items"        # native item type, not "weapon"/"item"
    assert r["ml"] == 18
    assert r["url"] == "/page/Item:Absorption_Gauntlet"
    assert r["sets"] == ["Forbidden Knowledge"]   # raw set names, no "(set)" marker
    assert r["artifact"] is False
    aff = {a["name"]: a for a in r["affixes"]}
    assert "Magical Sheltering" in aff
    assert aff["Magical Sheltering"]["type"] == "Insight"
    assert aff["Magical Sheltering"]["value"] == "10"   # verbatim string, not int
    assert set(aff["Magical Sheltering"].keys()) == {"name", "type", "value"}


def test_native_affixes_include_procs_verbatim():
    # The native `affixes` block is a clean passthrough — weapon/alignment procs the
    # old remap quarantined (e.g. "Holy") ARE present natively (no quarantine).
    recs, _ = _records()
    native = {a["name"] for r in recs for a in r["affixes"]}
    assert "Holy" in native


def test_native_artifact_flag_present_on_artifact_item():
    recs, _ = _records()
    r = _by_name(recs, "Band of Diani ir'Wynarn")
    assert r["artifact"] is True


def test_seal_hosts_recovered_when_seal_type_verified():
    recs_on, stats_on = P.load_planner_items(verified_seal_types={"Undeath"})
    hosts = [r for r in recs_on if r.get("seal_slots")]
    assert stats_on["planner_seal_hosts"] == len(hosts) >= 1
    host = _by_name(recs_on, "Bauble of Draconic Resistance")
    assert host["seal_slots"] == [{"seal_type": "Undeath", "category": host["slot"]}]
    # Unverified seal types (Mist/Gloom/Fire) yield no seal host.
    _, stats_off = P.load_planner_items(verified_seal_types=set())
    assert stats_off["planner_seal_hosts"] == 0


def test_host_pipeline_names_excluded():
    recs, stats = P.load_planner_items(
        exclude_names={"Dinosaur Bone Belt", "Dinosaur Bone Ring"})
    names = {r["name"] for r in recs}
    assert "Dinosaur Bone Belt" not in names and "Dinosaur Bone Ring" not in names
    assert stats["planner_host_pipeline_names_excluded"] == 2


def test_intra_dump_name_collisions_collapsed_and_reported():
    recs, stats = _records()
    names = [r["name"] for r in recs]
    assert len(names) == len(set(names)), "reader must not emit duplicate names"
    assert stats["planner_name_collisions_collapsed"] >= 100


# --- native host-marker extraction (from crafting[]) ------------------------

def test_lamordia_slots_extracted_and_deduped():
    it = {"name": "L", "slot": "Weapon", "ml": 34, "affixes": [],
          "crafting": ["Dolorous (Weapon)", "Dolorous (Weapon) (quarterstaff)",
                       "Melancholic (Weapon)", "Red Augment Slot"]}
    rec = P._record(it, set())
    assert rec["lamordia_slots"] == [
        {"type": "Dolorous", "category": "Weapon"},
        {"type": "Melancholic", "category": "Weapon"}]  # dedup drops the quarterstaff dup


def test_nearly_complete_marker_extracted():
    it = {"name": "N", "slot": "Trinket", "ml": 34, "affixes": [],
          "crafting": ["Nearly Complete: Quality Ability Score"]}
    assert P._record(it, set())["nearly_complete"] == "Quality Ability Score"


def test_lost_purpose_tier_extracted():
    assert P._record({"name": "A", "slot": "Ring", "ml": 34, "affixes": [],
                      "crafting": ["Legendary Lost Purpose"]}, set())["lost_purpose"] == "legendary"
    assert P._record({"name": "B", "slot": "Ring", "ml": 8, "affixes": [],
                      "crafting": ["Lost Purpose"]}, set())["lost_purpose"] == "heroic"


def test_marker_host_counts_reported():
    _, stats = _records()
    assert stats["planner_lamordia_hosts"] >= 100
    assert stats["planner_nearly_complete_hosts"] >= 100
    assert stats["planner_lost_purpose_hosts"] >= 40


# --- #194: Legendary Green Steel tier markers, read from crafting[] -------------

def test_lgs_tiers_extracted_by_item_class():
    """`T<n> (Equipment)` -> green_steel_tiers, `T<n> (Weapon)` -> thunder_forged_tiers.
    One slot per DECLARED tier, in tier order, and the two classes never cross."""
    acc = P._record({"name": "A", "slot": "Belt", "ml": 26, "affixes": [],
                     "crafting": ["T3 (Equipment)", "T1 (Equipment)", "T2 (Equipment)"]}, set())
    assert acc["green_steel_tiers"] == [{"tier": 1}, {"tier": 2}, {"tier": 3}]
    assert "thunder_forged_tiers" not in acc
    wpn = P._record({"name": "W", "slot": "Weapon", "ml": 26, "affixes": [],
                     "crafting": ["T1 (Weapon)", "T2 (Weapon)", "T3 (Weapon)", "T1 (Weapon)"]}, set())
    assert wpn["thunder_forged_tiers"] == [{"tier": 1}, {"tier": 2}, {"tier": 3}]
    assert "green_steel_tiers" not in wpn
    # Only the tiers the item declares — never all three on the strength of one.
    two = P._record({"name": "T", "slot": "Belt", "ml": 26, "affixes": [],
                     "crafting": ["T1 (Equipment)", "T2 (Equipment)"]}, set())
    assert two["green_steel_tiers"] == [{"tier": 1}, {"tier": 2}]
    # A real Thunder-Forged item declares no tier label and must get nothing.
    tfa = P._record({"name": "Thunder-Forged Alloy Longsword", "slot": "Weapon", "ml": 22,
                     "affixes": [], "crafting": ["Red Augment Slot"]}, set())
    assert "thunder_forged_tiers" not in tfa and "green_steel_tiers" not in tfa


def test_lgs_hosts_are_the_legendary_blanks_and_counted():
    """The population, measured: 8 accessory blanks and 40 weapon blanks, all ML 26,
    all named `Legendary Green Steel *`. The 47 heroic `Green Steel *` blanks
    declare no tier label and carry no marker."""
    recs, stats = _records()
    gs = [r for r in recs if r.get("green_steel_tiers")]
    tf = [r for r in recs if r.get("thunder_forged_tiers")]
    assert stats["planner_green_steel_hosts"] == len(gs) == 8
    assert stats["planner_lgs_weapon_hosts"] == len(tf) == 40
    for r in gs + tf:
        assert r["name"].startswith("Legendary Green Steel"), r["name"]
        assert r["ml"] == 26, (r["name"], r["ml"])
    assert all(r["green_steel_tiers"] == [{"tier": 1}, {"tier": 2}, {"tier": 3}] for r in gs)
    assert all(r["thunder_forged_tiers"] == [{"tier": 1}, {"tier": 2}, {"tier": 3}] for r in tf)
    heroic = [r for r in recs if r["name"].startswith("Green Steel")]
    assert len(heroic) >= 40
    assert not any(r.get("green_steel_tiers") or r.get("thunder_forged_tiers") for r in heroic)


# --- #371: the per-item Nearly Complete host gate ------------------------------

_NF_ITEM = {"name": "Legendary Alchemist's Crown", "slot": "Helm", "ml": 29,
            "affixes": [], "crafting": ["Nearly Finished", "Green Augment Slot"]}


def test_per_item_nearly_complete_marker_gated_on_the_pool_covering_this_host():
    """The seal gate's shape, one family over: a host is marked only when the
    per-item pool actually carries options for it. Ungated, the 22 declarers
    upstream never sourced would each grow a slot the solver cannot fill —
    exactly the inert slot #371 exists to remove."""
    covered = P._record(dict(_NF_ITEM), set(),
                        {"Nearly Finished": {"Legendary Alchemist's Crown"}})
    assert covered["nc_per_item_slots"] == [{"pool": "Nearly Finished"}]

    # Same item, pool has no entry for it -> no marker at all (not an empty list).
    uncovered = P._record(dict(_NF_ITEM), set(), {"Nearly Finished": {"Someone Else"}})
    assert "nc_per_item_slots" not in uncovered

    # No pool threaded at all -> the pre-#371 behavior, marker absent.
    assert "nc_per_item_slots" not in P._record(dict(_NF_ITEM), set(), None)


def test_a_host_declaring_both_per_item_pools_gets_both_slots():
    """`Collective Sight` declares `Almost There` AND `Nearly Finished`. They are
    two INDEPENDENT choices in game, so they must surface as two slots — one
    merged marker would silently halve what the item can craft."""
    it = {"name": "Collective Sight", "slot": "Goggles", "ml": 15, "affixes": [],
          "crafting": ["Almost There", "Nearly Finished", "Blue Augment Slot"]}
    rec = P._record(it, set(), {"Nearly Finished": {"Collective Sight"},
                                "Almost There": {"Collective Sight"}})
    assert rec["nc_per_item_slots"] == [{"pool": "Almost There"},
                                        {"pool": "Nearly Finished"}]


def test_per_item_host_count_reported_and_matches_the_live_pool():
    from src import nearly_complete as NC
    hosts = NC.per_item_hosts()
    recs, stats = P.load_planner_items(nc_per_item_hosts=hosts)
    marked = [r for r in recs if r.get("nc_per_item_slots")]
    assert stats["planner_nc_per_item_hosts"] == len(marked) == 43
    # And the gate is what produced that: with no pool threaded, zero hosts.
    _, off = P.load_planner_items()
    assert off["planner_nc_per_item_hosts"] == 0
