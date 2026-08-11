"""U3 (#169) — the Heightened Awareness expansion at the planner-record seam."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import heightened_awareness as ha  # noqa: E402

TIP = ("Heightened Awareness %d: This item helps you to quickly read situations with "
       "sharpness and clarity, allowing you to predict actions before they occur. "
       "You gain a +%d Insight bonus to AC.")


def _rec(name, *affixes):
    return {"name": name, "url": f"/page/Item:{name.replace(' ', '_')}",
            "affixes": [dict(a) for a in affixes]}


def _folded(value):
    return {"name": "Heightened Awareness", "type": "Insight", "value": str(value)}


def _affix(name, type_, value):
    return {"name": name, "type": type_, "value": str(value)}


def _entry(rank, provenance="stated"):
    value = {"version": str(rank)}
    if provenance == "stated":
        value["armor_class"] = rank
    return {"value": value, "provenance": provenance,
            "raw": "{{Heightened Awareness|%s}}" % rank}


def _shard(*names_ranks, **kw):
    harvested = {n: _entry(r, **kw) for n, r in names_ranks}
    snapshots = {("{{heightened awareness|%s}}" % r): {"tooltip": TIP % (r, r)}
                 for _n, r in names_ranks}
    return {"harvested": harvested, "snapshots": snapshots}


def _by_name(rec):
    out = {}
    for a in rec["affixes"]:
        out.setdefault(a["name"], []).append(a)
    return out


def test_a_confirmed_rank_yields_insight_armor_class():
    rec = _rec("Omniscience", _folded(4))
    stats = ha.apply([rec], _shard(("Omniscience", 4)))

    affixes = _by_name(rec)
    assert "Heightened Awareness" not in affixes
    assert affixes["Armor Class"][0]["value"] == "4"
    assert affixes["Armor Class"][0]["type"] == "Insight"
    assert stats["renamed"] == 1


def test_it_grants_no_saves():
    """Parrying's saves clause has no analogue here. Copying it across would be
    inference, not modelling."""
    rec = _rec("Omniscience", _folded(4))
    ha.apply([rec], _shard(("Omniscience", 4)))

    affixes = _by_name(rec)
    for save in ("Fortitude Save", "Reflex Save", "Will Save"):
        assert save not in affixes, save


def test_a_rank_with_no_harvested_tooltip_contributes_nothing():
    """R2. gear-planner's stored number is not evidence — the affix page has to
    state it, and "contributes nothing" has to include the PRIMARY stat. This
    test previously asserted only the quarantine counter while the affix was
    renamed into a scored `Armor Class` carrying the unverified number.
    """
    rec = _rec("Mystery", _folded(6))
    shard = {"harvested": {"Mystery": {"value": {}, "provenance": "unsourced",
                                       "raw": ""}}, "snapshots": {}}
    stats = ha.apply([rec], shard)

    assert stats["quarantined"] == 1 and stats["dropped_unstated"] == 1
    assert rec["affixes"] == [], "an unverified magnitude must not ship as Armor Class"
    audit = ha.audit_shard(shard)
    assert audit["unsourced"] == 1 and audit["titles"] == ["Mystery"]


def test_a_differently_bucketed_armor_class_still_receives_the_insight_one():
    """R2a. Nine of the 26 items carry an Armor- or Primal-Natural-typed AC."""
    rec = _rec("Crown of Bone", _affix("Armor Class", "Armor", 7), _folded(6))
    stats = ha.apply([rec], _shard(("Crown of Bone", 6)))

    acs = {(a["type"], a["value"]) for a in _by_name(rec)["Armor Class"]}
    assert acs == {("Armor", "7"), ("Insight", "6")}
    assert stats["primary_suppressed"] == 0


def test_a_same_bucket_armor_class_suppresses_the_duplicate():
    rec = _rec("Hypothetical", _affix("Armor Class", "Insight", 9), _folded(6))
    stats = ha.apply([rec], _shard(("Hypothetical", 6)))

    assert len(_by_name(rec)["Armor Class"]) == 1
    assert stats["primary_suppressed"] == 1


def test_applying_twice_is_idempotent():
    shard = _shard(("Omniscience", 4))
    rec = _rec("Omniscience", _folded(4))
    ha.apply([rec], shard)
    first = json.dumps(rec, sort_keys=True)
    ha.apply([rec], shard)
    assert json.dumps(rec, sort_keys=True) == first


def test_expanded_away_declares_armor_class():
    assert ha.EXPANDED_AWAY == {"heightened awareness": ["Armor Class"]}


# --- the guard -----------------------------------------------------------------

def test_a_value_disagreeing_with_its_tooltip_is_reported():
    shard = _shard(("Omniscience", 4))
    shard["harvested"]["Omniscience"]["value"]["armor_class"] = 9
    report = ha.check_against_snapshots(shard)

    assert any("tooltip states 4" in p for p in report["problems"]), report


def test_an_unreadable_tooltip_verifies_nothing():
    shard = _shard(("Omniscience", 4))
    shard["snapshots"]["{{heightened awareness|4}}"]["tooltip"] = "reworded"
    report = ha.check_against_snapshots(shard)

    assert any("no known dialect" in p for p in report["problems"]), report
    assert report["compared"] == 0


def test_a_roman_variant_fails_rather_than_being_read_as_arabic():
    """No Roman variant is listed today. If one appears in a future harvest it
    must fail loudly, not be silently accepted at its stored number."""
    shard = {"harvested": {"Future": {"value": {"version": "IV", "armor_class": 4},
                                      "provenance": "stated",
                                      "raw": "{{Heightened Awareness|IV}}"}},
             "snapshots": {}}
    report = ha.check_against_snapshots(shard)

    assert report["problems"], "an unsnapshotted Roman variant must not pass"
    assert report["compared"] == 0


def test_an_arabic_snapshot_paired_with_the_wrong_tooltip_is_reported():
    """#173, the consistent-corruption shape. Move the value AND its reference
    together: file `{{Heightened Awareness|4}}` under the +6 tooltip and derive 6
    from it. Nothing disagrees with anything — the derived value matches the
    snapshot it was read from — so the comparison passes by construction. Only a
    binding between the snapshot and the key it is filed under catches it. This
    shipped green in #169 because the fix its review made to `parrying_split`
    never travelled to this sibling."""
    shard = {"harvested": {"Anything": {"value": {"version": "4", "armor_class": 6},
                                        "provenance": "stated",
                                        "raw": "{{Heightened Awareness|4}}"}},
             "snapshots": {"{{heightened awareness|4}}": {"tooltip": TIP % (6, 6)}}}
    report = ha.check_against_snapshots(shard)

    assert any("must state +4" in p for p in report["problems"]), report
    assert report["compared"] == 1, "it must still count as compared, not skipped"


def test_an_isolated_corruption_alone_does_not_prove_the_binding():
    """The companion to the test above, and the reason it is not redundant. Moving
    only the derived value is caught by the plain comparison, so a suite built
    from isolated corruptions goes red without any binding assertion existing —
    which is exactly how #169 shipped eight red corruptions over a real hole."""
    shard = _shard(("Omniscience", 4))
    shard["harvested"]["Omniscience"]["value"]["armor_class"] = 6
    report = ha.check_against_snapshots(shard)

    assert any("tooltip states 4" in p for p in report["problems"]), report
    assert not any("must state +4" in p for p in report["problems"]), \
        "an isolated break must be caught by the comparison, not by the binding"


def test_every_shipped_arabic_snapshot_states_its_own_version():
    from src import harvest
    shard = harvest.load_shard(
        os.path.join(ROOT, "data", "seed", "compendium", "heightened_awareness.json"),
        "heightened_awareness")
    seen = 0
    for raw, snap in shard["snapshots"].items():
        version = ha.invocation_version(raw)
        if version and version.isdigit():
            assert ha.tooltip_armor_class(snap["tooltip"]) == int(version), raw
            seen += 1
    assert seen == len(shard["snapshots"]) and seen, \
        "every shipped snapshot is Arabic; a non-Arabic one means the wiki gained a variant"


def test_the_guard_refuses_to_pass_over_an_empty_shard():
    for shard in ({}, {"harvested": {}}):
        try:
            ha.check_against_snapshots(shard)
        except ValueError:
            continue
        raise AssertionError("an empty shard must not report a clean guard")


# --- the shipped shard and the built dataset -----------------------------------

def test_the_built_dataset_expands_every_instance():
    path = os.path.join(ROOT, "web", "data", "items.json")
    if not os.path.exists(path):
        return
    with open(path) as fh:
        data = json.load(fh)

    assert not [1 for it in data["items"]
                for a in it.get("affixes") or []
                if a.get("name") == "Heightened Awareness"]
    assert "Heightened Awareness" not in data["metadata"]["rankable_affixes"]
    assert data["metadata"]["expanded_away_names"]["heightened awareness"] == ["Armor Class"]

    coverage = data["metadata"]["heightened_awareness_coverage"]
    assert coverage["renamed"] == 26
    assert coverage["uncovered"] == 0 and coverage["quarantined"] == 0
    assert coverage["tooltip_guard_compared"] == 26, \
        "every entry must have been matched against a parsed tooltip"


def test_an_all_unsourced_shard_fails_rather_than_reporting_a_clean_count():
    shard = {"harvested": {"A": {"value": {}, "provenance": "unsourced", "raw": ""}},
             "snapshots": {}}
    try:
        ha.check_against_snapshots(shard)
    except ValueError as exc:
        assert "compared no derived value" in str(exc)
        return
    raise AssertionError("a shard that compared nothing must not pass")


def test_the_shipped_shard_compares_every_entry():
    from src import harvest
    shard = harvest.load_shard(
        os.path.join(ROOT, "data", "seed", "compendium", "heightened_awareness.json"),
        "heightened_awareness")
    report = ha.check_against_snapshots(shard)

    assert not report["problems"], report["problems"][:3]
    assert report["compared"] == len(shard["harvested"]) == 26


def test_the_guard_makes_no_network_call():
    import socket
    from src import harvest
    shard = harvest.load_shard(
        os.path.join(ROOT, "data", "seed", "compendium", "heightened_awareness.json"),
        "heightened_awareness")

    real = socket.socket

    def _forbidden(*a, **k):
        raise AssertionError("the guard must not open a socket")

    socket.socket = _forbidden
    try:
        ha.check_against_snapshots(shard)
    finally:
        socket.socket = real


# --- R12: provenance stamp -----------------------------------------------------
#
# The item shows "Heightened Awareness VIII"; the split emits an Armor Class.
# It names the enchantment it came from, under the key `src/spell_focus.py`
# writes, so a consumer can render what is engraved rather than the stat the
# value was credited to. No bonus-type prefix: the enchantment is Insight by
# definition and the wiki writes it bare.

def test_the_emitted_armor_class_names_the_heightened_awareness_enchantment():
    from src import spell_focus
    via = spell_focus.PROVENANCE_KEY

    rec = _rec("Legendary Spare Hand", _folded(8))
    ha.apply([rec], _shard(("Legendary Spare Hand", 8)))

    emitted = _by_name(rec)
    assert set(emitted) == {"Armor Class"}
    assert emitted["Armor Class"][0][via] == "Heightened Awareness"


def test_an_affix_the_record_already_carried_is_not_stamped():
    from src import spell_focus
    via = spell_focus.PROVENANCE_KEY

    rec = _rec("Legendary Spare Hand", _folded(8), _affix("Dodge", "Enhancement", 5))
    ha.apply([rec], _shard(("Legendary Spare Hand", 8)))

    assert via not in _by_name(rec)["Dodge"][0]
