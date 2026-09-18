"""#766 — Slaver's crafting: the native pool, the label-read host slots, the
Set Bonus membership slot, and the disclosure of the set name no def resolves.

The load-bearing trap is the tier: `Legendary Chains` is ML 28, below the ML-30
boundary Viktranium derives its tier from. Every host assertion here reads the
tier the LABEL carries, and one test pins the ML-28 host to the legendary pool.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src import slavers  # noqa: E402
from src import membership  # noqa: E402
from src import planner_items as PI  # noqa: E402

ITEMS = os.path.join(os.path.dirname(__file__), "..", "web", "data", "items.json")


def _dataset():
    with open(ITEMS, encoding="utf-8") as fh:
        return json.load(fh)


# --- the label is the source ------------------------------------------------------

def test_parse_label_reads_the_tier_from_the_label_and_nothing_else():
    assert slavers.parse_label("Slaver's Prefix Slot") == ("Prefix", "heroic")
    assert slavers.parse_label("Legendary Slaver's Bonus Slot") == ("Bonus", "legendary")
    for not_a_slot in ("Slaver's Set Bonus", "Slaver's Prefix", "Legendary Chains",
                       "Green Augment Slot", "", None):
        assert slavers.parse_label(not_a_slot) is None, not_a_slot
    assert slavers.parse_set_bonus_label("Slaver's Set Bonus") == "heroic"
    assert slavers.parse_set_bonus_label("Legendary Slaver's Set Bonus") == "legendary"
    assert slavers.parse_set_bonus_label("Slaver's Prefix Slot") is None


def test_pool_key_is_the_host_label():
    """The coverage gate keys served labels off each record's `pool_key`; that only
    works because the menu key and the `crafting[]` label are one string."""
    for (slot, tier), key in slavers.POOL_KEYS.items():
        assert slavers.parse_label(key) == (slot, tier), key


def test_planner_extracts_slots_from_labels_in_slot_order():
    got = PI._slavers_slots(["Legendary Slaver's Bonus Slot", "Green Augment Slot",
                             "Legendary Slaver's Prefix Slot", "Legendary Slaver's Prefix Slot"])
    assert got == [{"slot": "Prefix", "tier": "legendary"}, {"slot": "Bonus", "tier": "legendary"}]
    assert PI._slavers_slots(["Green Augment Slot"]) == []
    assert PI._slavers_set_bonus(["Legendary Slaver's Set Bonus"]) == "legendary"
    assert PI._slavers_set_bonus(["Slaver's Set Bonus", "Slaver's Prefix Slot"]) == "heroic"
    assert PI._slavers_set_bonus(["Slaver's Prefix Slot"]) is None


# --- the native pool ---------------------------------------------------------------

def test_native_build_sources_all_eight_pools_one_record_per_option():
    out = slavers.build_slavers()
    recs = out["records"]
    assert len(recs) == 184 == out["source_options"], "10+25+27+30 per tier, one record each"
    cov = out["coverage"]
    assert cov["options_split"] == 0
    assert cov["by_tier"]["heroic"]["source_options"] == cov["by_tier"]["legendary"]["source_options"] == 92
    for key, c in cov["by_pool"].items():
        assert c["source_options"] == c["options_eligible"] > 0, key
    assert "gearplanner_crafting.json" in cov["source"]
    seen = set()
    for r in recs:
        # ATOMIC: the option carries its affixes; the flat per-affix shape must not appear.
        assert "affixes" in r and r["affixes"], r
        assert "stat" not in r, r
        assert {"stat", "bonus_type", "value", "unit"} <= set(r["affixes"][0])
        assert r["slot"] in slavers.SLOTS and r["tier"] in slavers.TIERS, r
        assert r["pool_key"] == slavers.POOL_KEYS[(r["slot"], r["tier"])], r
        # The option name is unique within its pool — it is what the block key uses.
        k = (r["pool_key"], r["name"])
        assert k not in seen, f"two options share a name inside one pool: {k}"
        seen.add(k)
    # The Suffix pools carry the all-saves umbrella; before expansion it is ONE affix.
    res = [r for r in recs if r["name"].startswith("Resistance")]
    assert len(res) == 2 and all(len(r["affixes"]) == 1 for r in res)


def test_legendary_magnitudes_differ_from_heroic():
    """A tier read from ML would have handed `Legendary Chains` (ML 28) the heroic
    numbers. The two tiers are different pools with different values."""
    recs = slavers.build_slavers()["records"]
    def val(slot, tier, stat):
        return next(a["value"] for r in recs if r["slot"] == slot and r["tier"] == tier
                    for a in r["affixes"] if a["stat"] == stat)
    assert val("Prefix", "heroic", "Charisma") == 5
    assert val("Prefix", "legendary", "Charisma") == 13


# --- the built dataset --------------------------------------------------------------

def test_dataset_exposes_the_pool_the_hosts_and_the_membership_slots():
    data = _dataset()
    assert "slavers" in data
    cov = data["metadata"]["slavers_coverage"]
    assert cov["hosts_active"] == 6 and cov["slots_active"] == 24, cov
    assert cov["hosts_pending"] == [], cov
    assert cov["by_tier"]["heroic"]["hosts_active"] == cov["by_tier"]["legendary"]["hosts_active"] == 3
    assert cov["set_bonus_hosts"] == 30, cov
    # #769 — nothing is left unresolved. The pools used to name `Slave Lord's
    # Endurance` where the catalog defines `Slave's Endurance`, so the name was
    # dropped and the set was unreachable at BOTH tiers; the wiki says the catalog
    # is right and `crafting_set_name_corrections.json` renames the pool's spelling.
    # An empty dict here is the whole fix: every pool name now resolves to a def.
    assert cov["set_names_unresolved"] == {}, cov["set_names_unresolved"]

    hosts = [it for it in data["items"] if it.get("slavers_slots")]
    assert hosts, "refuse to pass over zero hosts"
    assert sorted(it["source_item"] for it in hosts) == sorted([
        "Chains", "Five Rings", "Shackles",
        "Legendary Chains", "Legendary Five Rings", "Legendary Shackles"])
    for it in hosts:
        tier = "legendary" if it["source_item"].startswith("Legendary ") else "heroic"
        assert it["slavers_slots"] == [{"slot": s, "tier": tier} for s in slavers.SLOTS], it["source_item"]
        assert it["verification"] == "verified"
        # Every host also carries the Set Bonus slot, as chosen membership.
        assert it["set_membership_slot"]["station"] == slavers.STATION
    # THE trap: an ML-28 host is a LEGENDARY host.
    lc = next(it for it in hosts if it["source_item"] == "Legendary Chains")
    assert lc["ml"] == 28 and lc["slavers_slots"][0]["tier"] == "legendary"

    # Membership: only names that resolved to a def are in any pool, and the
    # unresolved spelling appears nowhere.
    members = [it for it in data["items"]
               if (it.get("set_membership_slot") or {}).get("station") == slavers.STATION]
    assert len(members) == 30
    for it in members:
        pool = it["set_membership_slot"]["pool"]
        assert pool, it["source_item"]
        for n in pool:
            assert n in data["membership_set_defs"], n
    # #769 — the Endurance set is REACHABLE now, at both tiers. This assertion was
    # the inverse before the name correction (`not any("Endurance" in n ...)`), which
    # is what made the gap visible: one of the three sets the station offers was off
    # the table for every host.
    helm = next(it for it in members if it["source_item"] == "Executioner's Helm")
    assert helm["set_membership_slot"]["pool"] == [
        "Slave Lord's Might", "Slave Lord's Sorcery", "Slave's Endurance"]
    legendary = [it for it in members
                 if it["source_item"].startswith("Legendary ")]
    assert legendary, "refuse to pass over zero legendary hosts"
    for it in legendary:
        assert "Legendary Slave's Endurance" in it["set_membership_slot"]["pool"], it["source_item"]

    # The umbrella expanded INSIDE the option: one record, three saves, provenance kept.
    res = [r for r in data["slavers"] if r["name"].startswith("Resistance") and r["tier"] == "heroic"]
    assert len(res) == 1
    assert sorted(a["stat"] for a in res[0]["affixes"]) == ["Fortitude Save", "Reflex Save", "Will Save"]
    assert all(a.get("via") for a in res[0]["affixes"])
    assert all(r.get("block_key", "").startswith("craft:slavers:") for r in data["slavers"])


# --- membership attach, in isolation -------------------------------------------------

def test_attach_drops_unresolved_names_and_discloses_them():
    defs = {"Slave Lord's Might": {}, "Legendary Slave Lord's Sorcery": {}}
    fresh = {"slavers_set_bonus": "heroic", "set_bonus": [], "sets": []}
    intrinsic = {"slavers_set_bonus": "heroic", "set_bonus": [{"set": "Slave Lord's Might"}], "sets": []}
    taken = {"slavers_set_bonus": "legendary", "set_membership_slot": {"pool": ["X"], "station": "other"}}
    not_a_host = {"lost_purpose": "heroic"}
    out = membership.attach_slavers_set_bonus_slots([fresh, intrinsic, taken, not_a_host], defs)
    assert out["hosts"] == 2
    assert fresh["set_membership_slot"] == {"pool": ["Slave Lord's Might"], "station": slavers.STATION}
    # An intrinsic member of a pool set is not offered that set again (single identity).
    assert intrinsic["set_membership_slot"]["pool"] == []
    assert taken["set_membership_slot"]["station"] == "other", "an existing slot is left alone"
    assert "set_membership_slot" not in not_a_host
    # Every pool name the defs did not resolve is named, per tier — nothing is mapped.
    # The DROP MECHANISM is what this pins, with deliberately impoverished defs; it
    # is unchanged by #769. Only the Endurance spelling moved (`Slave Lord's
    # Endurance` -> `Slave's Endurance`), because these names come from the real
    # corrected pool.
    assert out["set_names_unresolved"] == {
        "heroic": ["Slave Lord's Sorcery", "Slave's Endurance"],
        "legendary": ["Legendary Slave Lord's Might", "Legendary Slave's Endurance"]}
