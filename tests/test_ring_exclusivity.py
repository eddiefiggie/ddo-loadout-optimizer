"""#566 — the ring-exclusivity blocklist, its guards, and what survived the flip.

The gate decides whether the solver may hand a player two copies of one ring.
The two errors are still not symmetric — wrongly ALLOWING one produces a loadout
that cannot be equipped, which is indistinguishable from a correct one until they
try — so most of this file is about proving the refusals hold, exactly as its
#442 predecessor was.

What changed is the polarity, not the direction of caution. #442 asked "does any
page state that two copies work?" and found two that did. #566 asks "does the
wiki record a disqualifier?", because duplicability is not a per-item property —
it is the absence of Exclusive and Minor Artifact, both of which ARE recorded.
Fail-closed moved rather than disappearing: a ring absent from the shard is still
refused, and `check` now fails the build if the shard ever stops covering the
catalog, so that refusal cannot start firing silently.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import ring_exclusivity  # noqa: E402

SHARD_PATH = os.path.join(ROOT, "data", "seed", "compendium", "ring_exclusivity.json")
CORROBORATION_PATH = os.path.join(ROOT, "data", "seed", "compendium", "duplicable_rings.json")
DATASET_PATH = os.path.join(ROOT, "web", "data", "items.json")

#: What the shipped build stamps. NOT the 100 set-member rings the raw seed's
#: `sets` field suggests: three Deadly Diabolist rings (heroic/Epic/Legendary)
#: are duplicable and carry a set upstream, but that set's only affix buffs
#: summons and hirelings, which the optimizer does not model — so the built
#: records carry no `set_bonus` and a second copy could never pay for itself.
#: The two numbers describe different populations; this is the one that ships.
SHIPPED_STAMPED = 97


def _ring(name, **over):
    rec = {"source_item": name, "variant_id": name, "slot": "Ring",
           "set_bonus": [{"set": "Some Set"}]}
    rec.update(over)
    return rec


def _shard(**entries):
    return {"harvested": entries}


def _entry(exclusive=False, artifact=False, provenance="stated"):
    return {"value": {"exclusive": exclusive, "minor_artifact": artifact,
                      "duplicable": not (exclusive or artifact)},
            "provenance": provenance, "raw": "Category:Exclusive"}


def _dataset():
    if not os.path.exists(DATASET_PATH):
        return None  # generated artifact; the build itself is the gate
    with open(DATASET_PATH) as fh:
        return json.load(fh)


# --- the shard ---------------------------------------------------------------

def test_the_shipped_shard_covers_the_whole_harvested_ring_population():
    shard = ring_exclusivity.load(SHARD_PATH)
    assert len(shard["harvested"]) == 435
    assert shard["counts"] == {"population": 435, "exclusive": 45,
                               "minor_artifact": 19, "both": 1, "duplicable": 372}


def test_every_shipped_entry_is_stated_and_cites_what_it_read():
    shard = ring_exclusivity.load(SHARD_PATH)
    for name, entry in shard["harvested"].items():
        assert entry.get("provenance") == "stated", name
        assert entry.get("raw"), f"{name} records no reading"
        assert entry.get("harvested"), f"{name} has no harvest date"
        v = entry["value"]
        # duplicable is DERIVED from the two disqualifiers, never recorded loose
        assert v["duplicable"] is (not (v["exclusive"] or v["minor_artifact"])), name


def test_the_two_corroborating_rings_come_out_duplicable():
    """#442 confirmed these from verbatim `tips` prose — a different field
    entirely. The blocklist reproducing them is the rule's predictive test."""
    shard = ring_exclusivity.load(SHARD_PATH)
    dup = ring_exclusivity.duplicable_names(shard)
    for n in ("Legendary Katra's Wit", "Legendary Katra's Razor Wit"):
        assert n in dup, n


def test_the_heroic_katras_are_duplicable_too():
    """#442 refused these because no page carried the tip, and said outright it
    suspected the heroic pages were simply unwritten rather than different. They
    are — all four Katras record a binding with no exclusive flag."""
    shard = ring_exclusivity.load(SHARD_PATH)
    dup = ring_exclusivity.duplicable_names(shard)
    assert "Katra's Wit" in dup
    assert "Katra's Razor Wit" in dup


def test_a_missing_or_empty_shard_stops_the_build():
    import tempfile
    try:
        ring_exclusivity.load(os.path.join(ROOT, "no", "such", "shard.json"))
    except SystemExit as e:
        assert "not found" in str(e)
    else:
        raise AssertionError("a missing shard must stop the build")

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump({"harvested": {}}, fh)
        path = fh.name
    try:
        ring_exclusivity.load(path)
    except SystemExit as e:
        # An empty shard reads as "nothing is duplicable" — the feature vanishing
        # quietly with every guard green, which is worse than a red build.
        assert "empty" in str(e)
    else:
        raise AssertionError("an empty shard must stop the build")
    finally:
        os.unlink(path)


def test_an_empty_corroboration_set_is_refused():
    """A cross-check over zero records asserts nothing while reporting success —
    the inspect-nothing shape this repo bans."""
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump({"harvested": {}}, fh)
        path = fh.name
    try:
        ring_exclusivity.load_corroboration(path)
    except SystemExit as e:
        assert "asserts nothing" in str(e) or "names no duplicable ring" in str(e)
    else:
        raise AssertionError("an empty corroboration shard must stop the build")
    finally:
        os.unlink(path)


# --- the fail-closed direction ----------------------------------------------

def test_only_stated_provenance_is_read_at_all():
    for prov in ("defaulted", "unsourced", None, "guessed"):
        shard = _shard(X=_entry(provenance=prov))
        assert ring_exclusivity.duplicable_names(shard) == set(), prov
        assert ring_exclusivity.blocked_names(shard) == {}, prov


def test_duplicable_requires_the_boolean_true_not_truthiness():
    assert ring_exclusivity.duplicable_names(
        _shard(X={"value": {"duplicable": "yes"}, "provenance": "stated"})) == set()
    assert ring_exclusivity.duplicable_names(
        _shard(X={"value": {}, "provenance": "stated"})) == set()


def test_blocked_names_reports_which_disqualifier_applied():
    shard = _shard(E=_entry(exclusive=True), A=_entry(artifact=True),
                   B=_entry(exclusive=True, artifact=True), D=_entry())
    assert ring_exclusivity.blocked_names(shard) == {
        "E": "Exclusive", "A": "a Minor Artifact", "B": "Exclusive and a Minor Artifact"}


def test_apply_stamps_only_duplicable_set_carrying_rings():
    dup, excl, art = _ring("D"), _ring("E"), _ring("A")
    shard = _shard(D=_entry(), E=_entry(exclusive=True), A=_entry(artifact=True))
    cov = ring_exclusivity.apply([dup, excl, art], shard)
    assert dup.get("duplicable_ring") is True
    assert "duplicable_ring" not in excl
    assert "duplicable_ring" not in art, \
        "the absent field IS the fail-closed default; writing False adds no information"
    assert cov["stamped"] == 1


def test_apply_refuses_a_duplicable_ring_that_is_not_an_eligible_record():
    notring = _ring("D", slot="Belt")
    setless = _ring("D", set_bonus=[])
    cov = ring_exclusivity.apply([notring, setless], _shard(D=_entry()))
    assert "duplicable_ring" not in notring
    assert "duplicable_ring" not in setless
    # A set-less ring is duplicable but unstampable, and that is worth counting
    # separately from a blocked one — it is not a refusal, it is a no-op.
    assert cov["duplicable_but_setless"] == 1


def test_a_ring_absent_from_the_shard_is_never_stamped():
    """Fail-closed survives the polarity flip: silence is still not permission."""
    orphan = _ring("Nobody Harvested Me")
    ring_exclusivity.apply([orphan], _shard(D=_entry()))
    assert "duplicable_ring" not in orphan


# --- the crafted-twin identity ------------------------------------------------

def test_a_crafted_record_resolves_to_its_base_pages_reading():
    """`X [Crafted]` is one game item's second state, not a second item — it has
    no wiki page, so its exclusivity is its base's. Resolution goes through the
    identity map, never a suffix test."""
    base = _ring("Mysterious Ring")
    crafted = _ring("Mysterious Ring [Crafted]")
    identity = {"Mysterious Ring [Crafted]": "Mysterious Ring",
                "Mysterious Ring": "Mysterious Ring"}
    shard = _shard(**{"Mysterious Ring": _entry()})
    cov = ring_exclusivity.apply([base, crafted], shard, identity=identity)
    assert base.get("duplicable_ring") is True
    assert crafted.get("duplicable_ring") is True
    assert cov["stamped"] == 2
    # ...and without the identity map it is uncovered, not silently duplicable.
    r = ring_exclusivity.check(shard, [crafted], identity=None)
    assert any("no entry in the exclusivity shard" in p for p in r["problems"])


def test_a_crafted_record_inherits_a_block_as_well_as_a_pass():
    crafted = _ring("Amara's Band [Crafted]")
    identity = {"Amara's Band [Crafted]": "Amara's Band"}
    ring_exclusivity.apply([crafted], _shard(**{"Amara's Band": _entry(exclusive=True)}),
                           identity=identity)
    assert "duplicable_ring" not in crafted


# --- the build guards ---------------------------------------------------------

def test_the_coverage_guard_fires_on_a_ring_the_harvest_never_saw():
    """The assertion that stops the evidence doc's '426 of 426' going stale. A new
    ring from an upstream refresh must fail the build, not inherit a default."""
    r = ring_exclusivity.check(_shard(D=_entry()), [_ring("D"), _ring("Newcomer")])
    assert any("Newcomer" in p and "no entry in the exclusivity shard" in p
               for p in r["problems"]), r["problems"]
    assert r["uncovered"] == 1


def test_the_artifact_agreement_guard_fires_in_both_directions():
    # shard says artifact, catalog does not
    r = ring_exclusivity.check(_shard(A=_entry(artifact=True)), [_ring("A")])
    assert any("not flagged `artifact` in the catalog" in p for p in r["problems"]), r["problems"]
    # catalog says artifact, shard does not
    r = ring_exclusivity.check(_shard(D=_entry()), [_ring("D", artifact=True)])
    assert any("is not a Minor Artifact" in p for p in r["problems"]), r["problems"]


def test_the_corroboration_guard_fires_when_the_blocklist_contradicts_442():
    """If the blocklist ever blocks a ring #442 independently confirmed, the rule
    has broken against evidence it was not derived from."""
    r = ring_exclusivity.check(
        _shard(**{"Legendary Katra's Wit": _entry(exclusive=True)}),
        [_ring("Legendary Katra's Wit")],
        corroboration={"Legendary Katra's Wit": "2 rings, identical or not, ..."})
    assert any("contradicts a reading it must reproduce" in p for p in r["problems"]), r["problems"]


def test_the_shape_guard_fires_on_a_ring_that_stopped_being_a_ring():
    r = ring_exclusivity.check(_shard(D=_entry()), [_ring("D", slot="Belt")])
    assert any("no longer a Ring" in p for p in r["problems"]), r["problems"]


def test_a_clean_shard_reports_no_problems_and_counts_what_it_checked():
    r = ring_exclusivity.check(_shard(D=_entry(), E=_entry(exclusive=True)),
                               [_ring("D"), _ring("E")])
    assert r["problems"] == []
    assert r["rings_in_catalog"] == 2
    assert r["covered"] == 2 and r["uncovered"] == 0
    assert r["duplicable"] == 1 and r["blocked"] == 1


# --- the shipped dataset ------------------------------------------------------

def test_the_built_dataset_stamps_the_widened_population():
    data = _dataset()
    if data is None:
        return
    stamped = {i["source_item"] for i in data["items"] if i.get("duplicable_ring")}
    assert len(stamped) == SHIPPED_STAMPED, sorted(stamped)
    assert data["metadata"]["duplicable_ring_coverage"]["problems"] == []
    assert data["metadata"]["duplicable_ring_coverage"]["uncovered"] == 0


def test_the_built_dataset_stamps_all_four_katra_rings():
    """The case that opened the question. #442 stamped the Legendary pair only."""
    data = _dataset()
    if data is None:
        return
    seen = 0
    for i in data["items"]:
        if (i.get("source_item") or "").endswith(("Katra's Wit", "Katra's Razor Wit")):
            assert i.get("duplicable_ring") is True, i["source_item"]
            seen += 1
    assert seen == 4, f"the loop must inspect all four Katra rings, saw {seen}"


def test_the_built_dataset_refuses_every_exclusive_and_artifact_ring():
    data = _dataset()
    if data is None:
        return
    shard = ring_exclusivity.load(SHARD_PATH)
    blocked = ring_exclusivity.blocked_names(shard)
    seen = 0
    for i in data["items"]:
        if i.get("slot") == "Ring" and i.get("source_item") in blocked:
            assert not i.get("duplicable_ring"), \
                f"{i['source_item']} is {blocked[i['source_item']]} and must never be doubled"
            seen += 1
    assert seen >= 60, f"the loop must actually inspect the blocked rings, saw {seen}"


def test_the_stamp_reaches_only_set_carrying_rings():
    data = _dataset()
    if data is None:
        return
    n = 0
    for i in data["items"]:
        if i.get("duplicable_ring"):
            assert i.get("slot") == "Ring", i.get("source_item")
            assert i.get("set_bonus"), i.get("source_item")
            assert not i.get("artifact"), i.get("source_item")
            n += 1
    assert n == SHIPPED_STAMPED, f"expected {SHIPPED_STAMPED} stamped records, saw {n}"


def test_the_diabolist_rings_are_duplicable_but_unstamped():
    """The 100-vs-97 case, pinned so the distinction cannot quietly drift.

    These three are duplicable — nothing disqualifies them — and gear-planner
    lists a set for each. But Deadly Diabolist's only affix buffs summons and
    hirelings, which the optimizer does not model, so the built record carries no
    `set_bonus` and a second copy could never pay for itself.
    """
    shard = ring_exclusivity.load(SHARD_PATH)
    dup = ring_exclusivity.duplicable_names(shard)
    data = _dataset()
    seen = 0
    for name in ("Diabolist's Ring", "Epic Diabolist's Ring", "Legendary Diabolist's Ring"):
        assert name in dup, f"{name} carries no disqualifier and is duplicable"
        if data is None:
            continue
        for i in data["items"]:
            if i.get("source_item") == name:
                assert not i.get("set_bonus"), name
                assert not i.get("duplicable_ring"), name
                seen += 1
    if data is not None:
        assert seen == 3, f"the loop must inspect all three Diabolist rings, saw {seen}"
