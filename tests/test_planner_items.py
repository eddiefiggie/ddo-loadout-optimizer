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
