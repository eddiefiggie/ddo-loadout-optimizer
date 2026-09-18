"""#769 — the crafting set-name correction: the overlay, its guards, and the
player-facing result it exists to produce.

The defect: the `Slaver's Set Bonus` pools named `Slave Lord's Endurance` where
`gearplanner_sets.json` defines `Slave's Endurance`, so `src/membership.py` dropped
the name and disclosed it, and NO Slaver's host could be solved into the Endurance
set at either tier. The wiki (`Named item sets`, pageid 9371) states `Slave's
Endurance`, so the set catalog is right and the crafting pool carries the stale
spelling.

The trap worth keeping: the PATTERN argued for the opposite fix. Might and Sorcery
are spelled identically in both files and only Endurance differs, which makes the
catalog look like the side breaking its own pattern. Reading the page reversed the
obvious answer, which is why `apply` refuses an entry that cites no page.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src import crafting_set_names as CSN  # noqa: E402
from src import crafting_catalog  # noqa: E402
from src import slavers  # noqa: E402

ITEMS = os.path.join(os.path.dirname(__file__), "..", "web", "data", "items.json")

GOOD = {"pool": "P", "source_set": "Old", "canonical_set": "New",
        "wiki_url": "https://ddowiki.com/page/X", "verified": "2026-09-18",
        "evidence": "the page says New"}


def _pool(*names):
    return {"P": {"*": [{"set": n} for n in names]}}


def _raises(cat, corrections):
    try:
        CSN.apply(cat, corrections)
    except SystemExit as exc:
        return str(exc)
    return None


# --- the overlay itself -------------------------------------------------------------

def test_apply_renames_only_the_named_set_and_leaves_the_rest_alone():
    cat = _pool("Old", "Keep", "Other")
    out = CSN.apply(cat, [GOOD])
    assert [o["set"] for o in cat["P"]["*"]] == ["New", "Keep", "Other"]
    assert out == {"renamed": 1, "pools": ["P"], "hit": ["Old"]}


def test_no_corrections_is_a_no_op_and_never_touches_the_catalog():
    cat = _pool("Old")
    assert CSN.apply(cat, []) == {"renamed": 0, "pools": [], "hit": []}
    assert [o["set"] for o in cat["P"]["*"]] == ["Old"]


# --- the guards, each proven to FIRE ------------------------------------------------

def test_guard_refuses_to_inspect_an_empty_catalog():
    """'Found nothing to rename' and 'nothing was loaded' must not look alike."""
    msg = _raises({}, [GOOD])
    assert msg and "empty catalog" in msg


def test_guard_demands_the_page_that_states_the_name():
    """An unsourced rename is an inference. The pattern argued for the opposite
    fix here, so this guard is the one standing between a read and a guess."""
    for missing in ("wiki_url", "verified", "evidence"):
        entry = dict(GOOD)
        entry[missing] = None
        msg = _raises(_pool("Old"), [entry])
        assert msg and "cites no wiki_url/verified/evidence" in msg, missing


def test_guard_fires_when_upstream_has_adopted_the_name():
    """The rename has become a silent no-op — delete the entry, do not pin it."""
    msg = _raises(_pool("Other"), [GOOD])
    assert msg and "no longer in" in msg and "silent no-op" in msg


def test_guard_fires_when_the_canonical_is_already_in_the_pool():
    """Renaming onto it would collapse two options into one and SHRINK the pool a
    host may choose from — a pool quietly losing a member is the #769 defect."""
    msg = _raises(_pool("Old", "New"), [GOOD])
    assert msg and "already in" in msg and "collapse" in msg


def test_guard_fires_on_a_missing_pool_and_on_a_malformed_entry():
    assert "is missing or is not a menu pool" in (_raises({"Q": {"*": []}}, [GOOD]) or "")
    assert "malformed correction" in (_raises(_pool("Old"), [{"pool": "P"}]) or "")


# --- the shipped shard, against the real catalog -------------------------------------

def test_the_shipped_corrections_are_live_and_reach_the_real_pools():
    corrections = CSN.load()
    assert corrections, "refuse to pass over zero corrections"
    cat = crafting_catalog.load_catalog()
    for corr in corrections:
        names = [o.get("set") for o in cat[corr["pool"]]["*"]]
        assert corr["canonical_set"] in names, corr
        assert corr["source_set"] not in names, corr
        # Evidence is not optional and the guard above proves it; assert it is
        # actually present on what ships, not merely required in the abstract.
        assert corr["wiki_url"] and corr["verified"] and corr["evidence"], corr


def test_both_tiers_name_the_catalogs_spelling_after_the_correction():
    cat = crafting_catalog.load_catalog()
    assert slavers.set_names_for_tier("heroic", cat) == [
        "Slave Lord's Might", "Slave Lord's Sorcery", "Slave's Endurance"]
    assert slavers.set_names_for_tier("legendary", cat) == [
        "Legendary Slave Lord's Might", "Legendary Slave Lord's Sorcery",
        "Legendary Slave's Endurance"]


# --- the result a player gets --------------------------------------------------------

def test_the_endurance_set_is_reachable_in_the_built_dataset():
    """The acceptance criterion: a Slaver's host can be solved into the Endurance
    set at each tier, and nothing is left disclosed as unresolved."""
    with open(ITEMS, encoding="utf-8") as fh:
        data = json.load(fh)
    assert data["metadata"]["slavers_coverage"]["set_names_unresolved"] == {}

    defs = data["membership_set_defs"]
    for name in ("Slave's Endurance", "Legendary Slave's Endurance"):
        assert name in defs, name

    members = [it for it in data["items"]
               if (it.get("set_membership_slot") or {}).get("station") == slavers.STATION]
    assert members, "refuse to pass over zero membership hosts"
    for it in members:
        tier = "legendary" if it["source_item"].startswith("Legendary ") else "heroic"
        want = "Legendary Slave's Endurance" if tier == "legendary" else "Slave's Endurance"
        pool = it["set_membership_slot"]["pool"]
        # A host that is already an intrinsic member is not offered its own set
        # again; every other host must be able to choose Endurance.
        intrinsic = {s.get("set") for s in it.get("set_bonus") or []} | set(it.get("sets") or [])
        if want not in intrinsic:
            assert want in pool, (it["source_item"], pool)


def test_the_sets_spell_saves_resolves_into_the_name_items_carry():
    """#769's second half. `Spell Saves` lived ONLY in the two Endurance set tiers,
    so admitting the set made it rankable for the first time and the umbrella
    detector flagged it. It is the set channel's spelling of `Spell Save`, which 93
    item affixes carry and which already holds an atomic ruling — so it is renamed
    into that name rather than adjudicated as a second, distinct stat. Without this
    the set's headline defensive affix scores zero for anyone ranking the name
    items engrave."""
    with open(ITEMS, encoding="utf-8") as fh:
        data = json.load(fh)
    tiers = data["membership_set_defs"]["Slave's Endurance"]["tiers"]
    assert tiers, "refuse to pass over zero tiers"
    stats = {a["stat"] for t in tiers for a in t["affixes"]}
    assert "Spell Save" in stats
    assert "Spell Saves" not in stats
