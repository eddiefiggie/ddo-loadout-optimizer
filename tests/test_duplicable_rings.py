"""#442 — the duplicable-ring shard, its guard, and the fail-closed direction.

The gate decides whether the solver may hand a player two copies of one ring. The
two errors are not symmetric — wrongly ALLOWING one produces a loadout that
cannot be equipped, which is indistinguishable from a correct one until they try
— so most of this file is about proving the refusals hold.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import duplicable_rings  # noqa: E402

SHARD_PATH = os.path.join(ROOT, "data", "seed", "compendium", "duplicable_rings.json")
DATASET_PATH = os.path.join(ROOT, "web", "data", "items.json")


def _ring(name, **over):
    rec = {"source_item": name, "variant_id": name, "slot": "Ring",
           "set_bonus": [{"set": "Some Set"}]}
    rec.update(over)
    return rec


def _shard(**entries):
    return {"harvested": entries}


def _entry(dup=True, provenance="stated"):
    return {"value": {"duplicable": dup}, "provenance": provenance,
            "raw": "2 rings, identical or not, can be used for the set bonus."}


def _dataset():
    if not os.path.exists(DATASET_PATH):
        return None  # generated artifact; the build itself is the gate
    with open(DATASET_PATH) as fh:
        return json.load(fh)


# --- the shard --------------------------------------------------------------

def test_the_shipped_shard_states_exactly_the_two_harvested_rings():
    shard = duplicable_rings.load(SHARD_PATH)
    assert duplicable_rings.duplicable_names(shard) == {
        "Legendary Katra's Razor Wit", "Legendary Katra's Wit"}


def test_every_shipped_entry_carries_its_verbatim_citation():
    """The whole point of moving this out of a code constant is that each claim
    now travels with the sentence it came from."""
    shard = duplicable_rings.load(SHARD_PATH)
    for name, entry in shard["harvested"].items():
        assert entry.get("provenance") == "stated", name
        assert entry.get("raw"), f"{name} has no quoted wiki line"
        assert "rings" in entry["raw"].lower(), f"{name}'s citation does not mention rings"
        assert entry.get("harvested"), f"{name} has no harvest date"


def test_an_empty_shard_is_refused_rather_than_silently_disabling_the_feature():
    """An empty fail-closed list would turn #335 off entirely while every guard
    stayed green — a feature disappearing quietly, which is worse than a red build."""
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump({"harvested": {}}, fh)
        path = fh.name
    try:
        duplicable_rings.load(path)
    except SystemExit as e:
        assert "empty" in str(e)
    else:
        raise AssertionError("an empty shard must stop the build")
    finally:
        os.unlink(path)


def test_a_missing_shard_stops_the_build():
    try:
        duplicable_rings.load(os.path.join(ROOT, "no", "such", "shard.json"))
    except SystemExit as e:
        assert "not found" in str(e)
    else:
        raise AssertionError("a missing shard must stop the build")


# --- the fail-closed direction ----------------------------------------------

def test_only_stated_provenance_grants_duplication():
    for prov in ("defaulted", "unsourced", None, "guessed"):
        shard = _shard(**{"X": {"value": {"duplicable": True}, "provenance": prov}})
        assert duplicable_rings.duplicable_names(shard) == set(), prov


def test_a_false_or_missing_value_never_grants_duplication():
    assert duplicable_rings.duplicable_names(
        _shard(X={"value": {"duplicable": False}, "provenance": "stated"})) == set()
    assert duplicable_rings.duplicable_names(
        _shard(X={"value": {}, "provenance": "stated"})) == set()
    # Not truthiness: only the boolean True. A stray "yes" is unverified input.
    assert duplicable_rings.duplicable_names(
        _shard(X={"value": {"duplicable": "yes"}, "provenance": "stated"})) == set()


def test_apply_stamps_only_the_named_rings_and_only_the_true_case():
    named = _ring("Legendary Katra's Wit")
    other = _ring("Some Other Ring")
    cov = duplicable_rings.apply([named, other], _shard(**{"Legendary Katra's Wit": _entry()}))
    assert named.get("duplicable_ring") is True
    assert "duplicable_ring" not in other, \
        "the absent field IS the fail-closed default; writing False adds no information"
    assert cov == {"names": 1, "stamped": 1}


def test_apply_refuses_a_named_record_that_is_not_an_eligible_ring():
    """The shard names an ITEM; the stamp still checks the record. A ring that lost
    its set membership, or is not a Ring, gets nothing."""
    notring = _ring("Legendary Katra's Wit", slot="Belt")
    setless = _ring("Legendary Katra's Wit", set_bonus=[])
    duplicable_rings.apply([notring, setless], _shard(**{"Legendary Katra's Wit": _entry()}))
    assert "duplicable_ring" not in notring
    assert "duplicable_ring" not in setless


# --- the build guard ---------------------------------------------------------

def test_the_guard_reports_a_ring_that_left_the_catalog():
    r = duplicable_rings.check(_shard(Ghost=_entry()), [])
    assert any("not in the catalog" in p for p in r["problems"]), r["problems"]


def test_the_guard_reports_a_ring_that_stopped_being_a_ring():
    r = duplicable_rings.check(_shard(X=_entry()), [_ring("X", slot="Belt")])
    assert any("no longer a Ring" in p for p in r["problems"]), r["problems"]


def test_the_guard_reports_a_ring_that_lost_its_set_bonus():
    """A second copy of a set-less ring buys nothing: duplicate affixes at the same
    name and bonus type collapse to a max rather than summing."""
    r = duplicable_rings.check(_shard(X=_entry()), [_ring("X", set_bonus=[])])
    assert any("no longer carries a set_bonus" in p for p in r["problems"]), r["problems"]


def test_a_clean_shard_reports_no_problems_and_counts_what_it_checked():
    r = duplicable_rings.check(_shard(X=_entry()), [_ring("X")])
    assert r == {"checked": 1, "stamped": 1, "problems": []}


# --- the shipped dataset ------------------------------------------------------

def test_the_built_dataset_stamps_exactly_the_two_rings():
    data = _dataset()
    if data is None:
        return
    stamped = sorted({i["source_item"] for i in data["items"] if i.get("duplicable_ring")})
    assert stamped == ["Legendary Katra's Razor Wit", "Legendary Katra's Wit"], stamped
    assert data["metadata"]["duplicable_ring_coverage"]["problems"] == []


def test_no_heroic_katra_ring_is_stamped():
    """The wiki states the tip on the Legendary pages only. Assuming the heroic
    pair behaves the same would be inferring a game value from an absence — the
    permissive direction, which is the one that produces an unequippable answer."""
    data = _dataset()
    if data is None:
        return
    for i in data["items"]:
        if i.get("source_item") in ("Katra's Wit", "Katra's Razor Wit"):
            assert not i.get("duplicable_ring"), i["source_item"]


def test_the_stamp_reaches_only_set_carrying_rings():
    data = _dataset()
    if data is None:
        return
    n = 0
    for i in data["items"]:
        if i.get("duplicable_ring"):
            assert i.get("slot") == "Ring", i.get("source_item")
            assert i.get("set_bonus"), i.get("source_item")
            n += 1
    assert n == 2, f"the loop must actually inspect the two stamped rings, saw {n}"
