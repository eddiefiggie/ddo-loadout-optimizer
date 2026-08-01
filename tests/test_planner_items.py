"""U3 — gear-planner raw-dump reader (structured affixes, KTD5/KTD6)."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src import planner_items as P  # noqa: E402

HERE = os.path.dirname(__file__)
RAW = os.path.join(HERE, "..", "data", "seed", "compendium", "raw", "gearplanner_items.json")
BOOL_SEED = os.path.join(HERE, "..", "data", "seed", "boolean_features.json")


def _bool_allowlist():
    raw = json.load(open(BOOL_SEED, encoding="utf-8"))
    return [s for s in raw if isinstance(s, str) and not s.startswith("_")]


def _records():
    recs, stats = P.load_planner_items(boolean_allowlist=_bool_allowlist())
    return recs, stats


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
    # affixes are structured (clean), not free-text enhancements
    stats = {a["stat"]: a for a in r["structured_affixes"]}
    assert "Magical Sheltering" in stats
    assert stats["Magical Sheltering"]["bonus_type"] == "Insight"


def test_slot_names_normalized_to_pipeline_vocab():
    recs, _ = _records()
    # Raw dump uses "Helm"/"Offhand"; pipeline expects "Helmet"/"Off Hand".
    slots = {r["slot"] for r in recs}
    assert "Helmet" in slots and "Helm" not in slots
    assert "Off Hand" in slots and "Offhand" not in slots


def test_null_typed_affixes_quarantined_not_emitted():
    recs, _ = _records()
    # No emitted affix should carry a proc/descriptor stat like "Holy" or "Vampirism"
    # (they are null-typed in the dump -> quarantined per KTD6).
    emitted = {a["stat"] for r in recs for a in r["structured_affixes"]}
    assert "Holy" not in emitted
    assert "Vampirism" not in emitted
    # ...but they are disclosed in structured_flagged somewhere.
    flagged = {f["raw"].split(" (")[0] for r in recs for f in r["structured_flagged"]}
    assert "Holy" in flagged


def test_bool_affix_gated_by_allowlist():
    recs, _ = _records()
    emitted = {a["stat"] for r in recs for a in r["structured_affixes"]
               if a["bonus_type"] == "boolean"}
    # "Ghost Touch" is on the curated allowlist -> emitted as a boolean presence.
    assert "Ghost Touch" in emitted
    # "Acid" is a Bool NOT on the allowlist -> must not be an emitted boolean.
    assert "Acid" not in emitted


def test_value_unit_detects_percent_vs_flat():
    # Direct unit-of-work test (the old version asserted a tautology).
    assert P._value_unit("5%")[1] == "pct"
    assert P._value_unit("3")[1] == "flat"
    assert P._value_unit("-10")[1] == "flat"


def test_seal_hosts_recovered_when_seal_type_verified():
    # Positive path: "Sealed in Undeath" hosts become seal_slots when Undeath has a
    # verified pool; and NOT when the seal type is unverified (Mist/Gloom).
    recs_on, stats_on = P.load_planner_items(boolean_allowlist=_bool_allowlist(),
                                             verified_seal_types={"Undeath"})
    hosts = [r for r in recs_on if r.get("seal_slots")]
    assert stats_on["planner_seal_hosts"] == len(hosts) >= 1
    gauntlet = _by_name(recs_on, "Bauble of Draconic Resistance")
    assert gauntlet["seal_slots"] == [{"seal_type": "Undeath", "category": gauntlet["slot"]}]
    # Mist appears in the dump but has no verified pool -> no seal host emitted.
    recs_off, stats_off = P.load_planner_items(boolean_allowlist=_bool_allowlist(),
                                               verified_seal_types=set())
    assert stats_off["planner_seal_hosts"] == 0


def test_null_typed_allowlisted_stat_is_emitted_not_quarantined():
    # KTD6 allowlist: a genuinely-real typeless stat (Magical Efficiency) is emitted
    # as a live affix, not quarantined with the procs.
    recs, _ = _records()
    emitted = {a["stat"]: a for r in recs for a in r["structured_affixes"]}
    if "Magical Efficiency" in {a.get("name") for it in json.load(open(RAW))
                                for a in it.get("affixes") or []}:
        assert "Magical Efficiency" in emitted
        assert emitted["Magical Efficiency"]["bonus_type"] == "Enhancement"


def test_host_pipeline_names_excluded():
    # The Dinosaur Bone hosts (owned by the dino seed's synthetic bodies) are
    # dropped when passed as exclude_names, so they can't double-list (KTD6 trap).
    recs, stats = P.load_planner_items(boolean_allowlist=_bool_allowlist(),
                                       exclude_names={"Dinosaur Bone Belt", "Dinosaur Bone Ring"})
    names = {r["name"] for r in recs}
    assert "Dinosaur Bone Belt" not in names and "Dinosaur Bone Ring" not in names
    assert stats["planner_host_pipeline_names_excluded"] == 2


def test_intra_dump_name_collisions_collapsed_and_reported():
    recs, stats = _records()
    names = [r["name"] for r in recs]
    assert len(names) == len(set(names)), "reader must not emit duplicate names"
    # 144 raw dup-name groups collapse to one each (disclosed, not silent).
    assert stats["planner_name_collisions_collapsed"] == 144

# KTD5 no-dropped-names was a migration-time invariant (verified: 0 of the retired
# shard's 6,195 names dropped). Ongoing coverage — that every reader name reaches
# the built dataset — lives in test_planner_import.py, without a git dependency.
