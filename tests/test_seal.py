"""Seal-slot crafting: NATIVE pool (gearplanner_crafting.json), strict quarantine,
coverage, and native host detection.

The Undeath pool sources to 18 options (6 stats x 3 bonus tiers); Fire/Gloom/Mist
are present-but-pending (no sourced pool). Host detection is native — the reader
recovers "Sealed in X" markers from the gear-planner item crafting[] list (U7:
the legacy seal.json seed + the enrich_from_planner import script were purged)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src import seal  # noqa: E402
from src import planner_items  # noqa: E402


def test_undeath_pool_sources_to_18_options():
    parsed = seal.build_seal()
    recs = [r for r in parsed["records"] if r["seal_type"] == "Undeath"]
    assert len(recs) == 18, f"expected 18 Undeath options, got {len(recs)}"
    stats = {"Strength", "Constitution", "Dexterity", "Intelligence", "Wisdom", "Charisma"}
    tiers = {("Enhancement", 15), ("Insight", 7), ("Quality", 3)}
    seen = {(r["stat"], (r["bonus_type"], r["value"])) for r in recs}
    for s in stats:
        for t in tiers:
            assert (s, t) in seen, f"missing {s} at {t}"
    for r in recs:
        assert isinstance(r["value"], int) and r["value"] > 0


def test_stub_pools_are_pending_not_errors():
    cov = seal.build_seal()["coverage"]
    assert cov["seal_types_sourced"] == ["Fire", "Undeath"]
    assert set(cov["seal_types_pending"]) == {"Gloom", "Mist"}
    assert cov["options_eligible"] == 24          # Undeath 18 + Fire 6


def test_fire_pool_is_presence_not_invented_magnitude():
    """Fire's six options are `{{Unique enchantment}}` procs.

    Five reduce an ENEMY stat and one grants temporary hitpoints on a cooldown, so
    none carries a magnitude the wearer receives. Recording them as presence is the
    accurate reading, not a shortfall — crediting `-7 MRR` to the player would
    invent a number the wiki states about the enemy. The same six names already
    ship as Bool presence via Viktranium and the Dino inserts, so this is a third
    route to effects the dataset already models.
    See docs/wiki-evidence/sealed-in-fire.md.
    """
    fire = [r for r in seal.build_seal()["records"] if r["seal_type"] == "Fire"]
    assert len(fire) == 6, fire
    assert {r["stat"] for r in fire} == {
        "Legendary Affirmation", "Legendary Ash", "Legendary Dust",
        "Legendary Ooze", "Legendary Salt", "Legendary Vacuum"}
    for r in fire:
        assert r["bonus_type"] == "Bool", r
        assert r["value"] == 1, r
        assert r["domain"] == "weapons", r


def test_bad_option_is_quarantined_not_guessed():
    bad = {"pools": [{"seal_type": "Undeath", "domain": "clothing/jewelry",
                      "wiki_url": "https://ddowiki.com/page/Ritual_Table",
                      "options": [
                          {"name": "Bogus", "stat": "Strength", "bonus_type": "Nonsense", "value": 15},
                          {"name": "NoMag", "stat": "Wisdom", "bonus_type": "Quality"},
                          {"name": "Good", "stat": "Charisma", "bonus_type": "Enhancement", "value": 15},
                      ]}]}
    parsed = seal.parse_seal(bad)
    assert len(parsed["records"]) == 1  # only the clean option survives
    reasons = " ".join(q["reason"] for q in parsed["quarantined"])
    assert "unrecognized bonus type" in reasons
    assert "missing magnitude" in reasons


def test_unrecognized_seal_type_and_missing_wiki_url_quarantine():
    bad = {"pools": [
        {"seal_type": "Bogus", "domain": "x", "wiki_url": "https://ddowiki.com/", "options": []},
        {"seal_type": "Undeath", "domain": "clothing/jewelry", "wiki_url": "",
         "options": [{"name": "S", "stat": "Strength", "bonus_type": "Enhancement", "value": 15}]},
    ]}
    parsed = seal.parse_seal(bad)
    reasons = " ".join(q["reason"] for q in parsed["quarantined"])
    assert "unrecognized seal type" in reasons
    assert "missing wiki_url" in reasons
    assert parsed["records"] == []


def test_normalize_seal_type_folds_prefix_and_case():
    assert seal.normalize_seal_type("Sealed in Undeath") == "Undeath"
    assert seal.normalize_seal_type("undeath") == "Undeath"
    assert seal.normalize_seal_type("Sealed in Fire") == "Fire"
    assert seal.normalize_seal_type("Amber") is None
    assert seal.normalize_seal_type("") is None


# --- native host detection (planner_items reads crafting[] "Sealed in X") ---

def test_native_record_detects_crafting_seal():
    it = {"name": "Test Trinket", "slot": "Trinket", "ml": 33,
          "affixes": [{"name": "Dodge", "type": "Enhancement", "value": 15}],
          "crafting": ["Sealed in Undeath", "Green Augment Slot"]}
    rec = planner_items._record(it, {"Undeath"})
    assert rec["seal_slots"] == [{"seal_type": "Undeath", "category": "Trinket"}]
    assert "Green" in rec["augment_slots"]


def test_native_record_gates_unsourced_seal_type():
    # Mist is present in the dump but not sourced (no pool) -> not a live host.
    it = {"name": "Misty", "slot": "Trinket", "ml": 33, "affixes": [],
          "crafting": ["Sealed in Mist"]}
    rec = planner_items._record(it, {"Undeath"})
    assert "seal_slots" not in rec


def test_native_record_no_seal_yields_no_slots():
    it = {"name": "Plain Ring", "slot": "Ring", "ml": 33,
          "affixes": [{"name": "Strength", "type": "Enhancement", "value": 15}],
          "crafting": ["Yellow Augment Slot"]}
    rec = planner_items._record(it, {"Undeath"})
    assert "seal_slots" not in rec


# --- dataset wiring (native, end-to-end) ------------------------------------

from src.variants import expand_dataset  # noqa: E402
import build_dataset  # noqa: E402


def test_seal_slots_flow_through_expand_dataset_onto_variant():
    item = {"name": "Seal Trinket", "category": "item", "slot": "Trinket",
            "affixes": [{"name": "Dodge", "type": "Enhancement", "value": "15"}],
            "seal_slots": [{"seal_type": "Undeath", "category": "Trinket"}],
            "_enriched": True, "minimum_level": 33}
    variants = expand_dataset([item])
    assert variants and all(
        v.get("seal_slots") == [{"seal_type": "Undeath", "category": "Trinket"}]
        for v in variants)


def test_build_exposes_seal_pool_and_counts_hosts():
    out = build_dataset.build()
    assert len(out["seal"]) == 24                       # Undeath 18 + Fire 6
    assert out["metadata"]["seal_coverage"]["hosts_active"] >= 1
    assert out["metadata"]["seal_coverage"]["seal_types_sourced"] == ["Fire", "Undeath"]


def test_fire_hosts_reach_the_solver():
    """66 gear-planner items carried a Sealed in Fire marker against an unsourced
    pool, so the whole Undying Age weapon family shipped with an inert slot. A
    player ranking `Legendary Ash` saw Viktranium weapons respond and these stay
    silent, which is what surfaced #195."""
    out = build_dataset.build()
    fire_hosts = [it for it in out["items"]
                  if any(s.get("seal_type") == "Fire" for s in (it.get("seal_slots") or []))]
    assert len(fire_hosts) >= 60, len(fire_hosts)
    assert all(h["slot"] in ("Weapon", "Off Hand") for h in fire_hosts), \
        "Fire is a weapon upgrade; a non-weapon host means the marker was misread"
    names = {h["source_item"] for h in fire_hosts}
    assert "Deathly Longsword of the Undying Age" in names, sorted(names)[:5]


def test_undeath_hosts_reach_the_solver_natively():
    # The 9 Undeath seal hosts are surfaced NATIVELY from gear-planner crafting[]
    # (e.g. Ophael's Cincture), no cross-source graft. Invariant: 9 solver-active.
    out = build_dataset.build()

    def key(it):
        return it.get("source_item") or it.get("variant_id") or it.get("name")
    undeath = {key(it) for it in out["items"]
               if any(s.get("seal_type") == "Undeath" for s in (it.get("seal_slots") or []))}
    assert len(undeath) == 9, f"expected 9 Undeath hosts, got {len(undeath)}: {sorted(undeath)}"
