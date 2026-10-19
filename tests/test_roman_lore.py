"""#887 — roman-numeral element lores, and the guards that keep the +10 honest.

The correction raises ~100 records by ten. The guards matter more than the
arithmetic: an entry must stop the build the day upstream starts applying the
template's +10 itself, or the catalog over-credits by ten in silence.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import roman_lore as L  # noqa: E402

DATASET = os.path.join(ROOT, "web", "data", "items.json")


def _rec(name, *affixes):
    return {"name": name, "affixes": [{"name": n, "type": "Equipment", "value": v} for n, v in affixes]}


def _shard(**items):
    return {"items": {k: [{"stat": s, "numeral": r, "from": str(L.roman_to_int(r)),
                           "to": str(L.roman_to_int(r) + 10)} for s, r in v] for k, v in items.items()}}


def _raises(fn, needle):
    try:
        fn()
    except SystemExit as e:
        assert needle in str(e), str(e)
        return
    raise AssertionError(f"expected a build failure mentioning {needle!r}")


def test_roman_to_int():
    assert [L.roman_to_int(s) for s in ("I", "II", "IV", "V", "VI", "IX", "X", "XII")] == [1, 2, 4, 5, 6, 9, 10, 12]


def test_the_bare_numeral_is_raised_by_ten_on_the_base_and_its_upgraded_twin():
    recs = [_rec("Rod", ("Void Lore", "6")), _rec("Rod [Upgraded]", ("Void Lore", "6")), _rec("Other", ("Void Lore", "6"))]
    cov = L.apply(recs, _shard(Rod=[("Void Lore", "VI")]))
    assert [r["affixes"][0]["value"] for r in recs] == ["16", "16", "6"]
    assert cov == {"items": 1, "values_changed": 2, "entries": 1}


def test_universal_spell_lore_and_other_stats_are_untouched():
    recs = [_rec("Fire", ("Lightning Lore", "7"), ("Spell Lore", "8"))]
    L.apply(recs, _shard(Fire=[("Lightning Lore", "VII")]))
    assert [(a["name"], a["value"]) for a in recs[0]["affixes"]] == [("Lightning Lore", "17"), ("Spell Lore", "8")]


def test_an_entry_already_at_plus_ten_means_upstream_fixed_it_and_fails():
    _raises(lambda: L.apply([_rec("Rod", ("Void Lore", "16"))], _shard(Rod=[("Void Lore", "VI")])),
            "delete this entry")


def test_a_moved_value_fails():
    _raises(lambda: L.apply([_rec("Rod", ("Void Lore", "7"))], _shard(Rod=[("Void Lore", "VI")])),
            "the data moved")


def test_an_entry_reaching_no_record_fails():
    _raises(lambda: L.apply([_rec("Other", ("Void Lore", "6"))], _shard(Rod=[("Void Lore", "VI")])),
            "reached no catalog record")


def test_an_entry_whose_numbers_break_the_template_rule_fails():
    bad = {"items": {"Rod": [{"stat": "Void Lore", "numeral": "VI", "from": "6", "to": "15"}]}}
    _raises(lambda: L.apply([_rec("Rod", ("Void Lore", "6"))], bad), "the template's rule")


# ---- the shipped shard ---------------------------------------------------------------

def test_the_shipped_shard_is_internally_consistent_and_populated():
    shard = L.load()
    assert L.check_shard(shard) == []
    # #907 — 90/103 before: every switched family (all of them) now takes its lores from
    # our own wiki harvest; one entry remains, on an item kept whole by the overlay.
    # (Was: the 48 weapons, 55 entries, now take their lores from our own wiki harvest, whose Spelllore mapper applies the template's +10 itself; each
    # entry fired its stale guard and moved to `_retired`.
    assert len(shard["items"]) == 1 and sum(len(v) for v in shard["items"].values()) == 1
    assert all(e["stat"].endswith(" Lore") and e["stat"] != "Spell Lore"
               for v in shard["items"].values() for e in v), "element lores only; Spell Lore is the +0 case"


def test_every_exclusion_says_why():
    shard = L.load()
    assert len(shard["no_catalog_affix"]) == 9 and all(x.get("why") for x in shard["no_catalog_affix"])
    assert sum(len(v) for v in shard["not_in_catalog"].values()) == 14
    assert [h["item"] for h in shard["handled_elsewhere"]] == ["Wretched Twilight"]


# ---- the built dataset -----------------------------------------------------------------

def _built():
    if not os.path.exists(DATASET):
        return None
    with open(DATASET, encoding="utf-8") as fh:
        return json.load(fh)


def _own(data, item, stat):
    return [a["value"] for v in data["items"] if v["source_item"] == item
            for a in v["affixes"] if a.get("name") == stat and not a.get("via")]


def test_the_built_catalog_credits_the_template_value():
    data = _built()
    if data is None:
        return
    assert _own(data, "Pale Rod", "Void Lore") == ["16"]
    assert _own(data, "Epic Halcyonia", "Healing Lore") == ["20"]
    assert _own(data, "Brine Shaman's Staff", "Ice Lore") == ["11"]
    assert _own(data, "Shroud of the Abbot [Upgraded]", "Lightning Lore") == ["15"], "twins inherit the fix"
    # Universal Spell Lore is the +0 case: the build expands it into each element
    # (stamped `via`), and those stay at the numeral while the item's own
    # Lightning Lore VII becomes 17.
    mu = [(a["value"], a.get("via")) for v in data["items"] if v["source_item"] == "St. Mu'Ray's Fire"
          for a in v["affixes"] if a.get("name") == "Lightning Lore"]
    assert sorted(mu, key=str) == sorted([("17", None), ("8", "Spell Lore")], key=str), mu
    # #907 — the weapon entries retired (see the shard test); their values are now the
    # harvest's, which the per-item assertions above still pin.
    assert data["metadata"]["roman_element_lore_coverage"] == {"items": 1, "values_changed": 1, "entries": 1}
