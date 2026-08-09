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
    state it."""
    rec = _rec("Mystery", _folded(6))
    shard = {"harvested": {"Mystery": {"value": {}, "provenance": "unsourced",
                                       "raw": ""}}, "snapshots": {}}
    stats = ha.apply([rec], shard)

    assert stats["quarantined"] == 1
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


def test_compared_is_zero_when_every_entry_is_quarantined():
    """`checked` alone would report a healthy count over a shard that verified no
    magnitude at all."""
    shard = {"harvested": {"A": {"value": {}, "provenance": "unsourced", "raw": ""},
                           "B": {"value": {}, "provenance": "unsourced", "raw": ""}},
             "snapshots": {}}
    report = ha.check_against_snapshots(shard)

    assert report["checked"] == 2 and report["compared"] == 0
    assert not report["problems"]


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
