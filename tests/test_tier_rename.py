"""#850 — tier-rename families: the sweep, the adjudication guard, and the stamp.

A counted presence effect that changes NAME on an item family's upgrade
(`Ethereal` at ML 8 -> `Ghostly` at ML 30) used to be a hand sweep in a triage
note. These pin the sweep's definition (consecutive tiers, one name dropped AND
one gained, counted names only, category-scoped families), every guard failure
including the zero-transition refusal, and that the built dataset stamps the
population with every transition ruled.
"""
import copy
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import tier_rename as T  # noqa: E402

ITEMS = os.path.join(ROOT, "web", "data", "items.json")
COUNTING = ["Blurry", "Dusk", "Ethereal", "Ghostly", "Lesser Displacement", "True Seeing", "Freedom of Movement"]


def _rec(category, name, ml, bools):
    return {"category": category, "source_item": name, "ml": ml,
            "affixes": [{"name": b, "type": "Bool", "value": "1"} for b in bools]}


def _raises(fn, *a, **k):
    try:
        fn(*a, **k)
    except SystemExit as e:
        return str(e)
    raise AssertionError("expected SystemExit, nothing raised")


def _fixture():
    return [
        _rec("augment", "Wraithborn Emerald", 8, ["Ethereal"]),
        _rec("augment", "Legendary Wraithborn Emerald", 30, ["Ghostly"]),
        _rec("item", "Cloak of Autumn", 5, ["Blurry", "Wind Through The Trees"]),
        _rec("item", "Legendary Cloak of Autumn", 29, ["Lesser Displacement", "Wind Through The Trees"]),
        # a pure GAIN is not a rename: nothing was dropped
        _rec("item", "Boots of Roaming", 6, []),
        _rec("item", "Legendary Boots of Roaming", 28, ["Freedom of Movement"]),
        # a pure DROP is not a rename either
        _rec("item", "Seer's Circlet", 4, ["True Seeing"]),
        _rec("item", "Epic Seer's Circlet", 22, []),
        # an item and an augment sharing a base name are NOT one family
        _rec("item", "Wraithborn Emerald", 12, ["Blurry"]),
        # a name outside the counting set changing is invisible here
        _rec("item", "Bane Blade", 5, ["Undead Bane"]),
        _rec("item", "Legendary Bane Blade", 29, ["Dragon Bane"]),
        # two variants of ONE tier name share the tier (min ML, union of presence)
        _rec("item", "Legendary Cloak of Autumn", 31, ["Lesser Displacement"]),
    ]


def test_family_base_strips_only_the_two_tier_prefixes():
    assert T.family_base("Legendary Wraithborn Emerald") == "Wraithborn Emerald"
    assert T.family_base("Epic Ethereal Ring") == "Ethereal Ring"
    assert T.family_base("Lesser Bracers of Wind") == "Lesser Bracers of Wind", "Lesser is a name, not a tier"
    assert T.family_base("  Legendary  X ") == "X"


def test_sweep_finds_renames_and_ignores_gains_drops_and_uncounted_names():
    tr = T.sweep(_fixture(), COUNTING)
    keys = [t["key"] for t in tr]
    assert keys == ["Blurry -> Lesser Displacement", "Ethereal -> Ghostly"], keys
    eth = next(t for t in tr if t["key"] == "Ethereal -> Ghostly")
    assert eth["families"] == [{"category": "augment", "base": "Wraithborn Emerald",
                                "from": "Wraithborn Emerald", "from_ml": 8,
                                "to": "Legendary Wraithborn Emerald", "to_ml": 30}]
    blur = next(t for t in tr if t["key"] == "Blurry -> Lesser Displacement")
    assert blur["families"][0]["to_ml"] == 29, "two variants of one tier name share the tier at its lowest ML"
    assert blur["dropped"] == ["Blurry"] and blur["gained"] == ["Lesser Displacement"]


def test_a_three_tier_family_reports_each_consecutive_transition():
    recs = [_rec("item", "Veil", 3, ["Dusk"]), _rec("item", "Epic Veil", 20, ["Blurry"]),
            _rec("item", "Legendary Veil", 30, ["Lesser Displacement"])]
    keys = [t["key"] for t in T.sweep(recs, COUNTING)]
    assert keys == ["Blurry -> Lesser Displacement", "Dusk -> Blurry"], keys


def _ruled(**extra):
    base = {
        "Blurry -> Lesser Displacement": {"disposition": "joined", "stat": "Concealment", "evidence": "x"},
        "Ethereal -> Ghostly": {"disposition": "distinct", "sentence": "not merged", "evidence": "x"},
    }
    base.update(extra)
    return {"ruled": base}


def test_check_stamps_every_transition_with_its_ruling():
    tr = T.sweep(_fixture(), COUNTING)
    stamp = T.check(tr, _ruled(), len(_fixture()))
    assert stamp["transition_count"] == 2 and stamp["family_count"] == 2
    assert stamp["by_disposition"] == {"joined": 1, "distinct": 1, "pending-wiki": 0}
    by = {e["key"]: e for e in stamp["transitions"]}
    assert by["Blurry -> Lesser Displacement"]["stat"] == "Concealment"
    assert "sentence" not in by["Blurry -> Lesser Displacement"]
    assert by["Ethereal -> Ghostly"]["sentence"] == "not merged"


def test_an_unruled_transition_fails_and_names_the_families():
    tr = T.sweep(_fixture(), COUNTING)
    adj = _ruled(); del adj["ruled"]["Ethereal -> Ghostly"]
    msg = _raises(T.check, tr, adj, 1)
    assert "Ethereal -> Ghostly" in msg and "Wraithborn Emerald" in msg and "no ruling" in msg


def test_a_stale_ruling_fails():
    tr = T.sweep(_fixture(), COUNTING)
    msg = _raises(T.check, tr, _ruled(**{"Dusk -> Ghostly": {"disposition": "distinct", "sentence": "s", "evidence": "e"}}), 1)
    assert "Dusk -> Ghostly" in msg and "stale" in msg


def test_a_joined_ruling_needs_a_stat_and_an_unjoined_one_a_sentence():
    tr = T.sweep(_fixture(), COUNTING)
    adj = _ruled(); del adj["ruled"]["Blurry -> Lesser Displacement"]["stat"]
    assert "shared stat" in _raises(T.check, tr, adj, 1)
    adj = _ruled(); del adj["ruled"]["Ethereal -> Ghostly"]["sentence"]
    assert "sentence" in _raises(T.check, tr, adj, 1)
    adj = _ruled(); adj["ruled"]["Ethereal -> Ghostly"]["disposition"] = "alias"
    assert "outside" in _raises(T.check, tr, adj, 1)
    adj = _ruled(); del adj["ruled"]["Ethereal -> Ghostly"]["evidence"]
    assert "evidence" in _raises(T.check, tr, adj, 1)


def test_zero_transitions_over_a_populated_catalog_is_a_broken_sweep():
    try:
        T.check([], {"ruled": {}}, 9000)
    except ValueError as e:
        assert "zero transitions" in str(e)
    else:
        raise AssertionError("an empty sweep over a populated catalog must not pass")
    # An empty catalog is the one case an empty sweep is honest about.
    assert T.check([], {"ruled": {}}, 0)["transition_count"] == 0


# --- the shipped adjudications cover the real sweep, and the build stamps it ----

def test_shipped_adjudications_cover_the_built_dataset_and_the_stamp_matches():
    if not os.path.exists(ITEMS):
        return
    data = json.load(open(ITEMS, encoding="utf-8"))
    tr = T.sweep(data["items"], data["metadata"]["utility_counting_set"])
    stamp = T.check(tr, T.load_adjudications(), len(data["items"]))
    stamped = data["metadata"]["tier_rename_families"]
    assert stamped == stamp, "the stamp is the sweep — rebuild after changing either"
    # The population the #746 addendum measured by hand, now a field. Ethereal ->
    # Ghostly is the reporter's worked example and is ruled distinct, not merged.
    keys = {e["key"]: e for e in stamped["transitions"]}
    assert keys["Ethereal -> Ghostly"]["disposition"] == "distinct"
    assert {f["base"] for f in keys["Ethereal -> Ghostly"]["families"]} >= {"Wraithborn Emerald", "Cold Iron Bracers"}
    assert keys["Blurry -> Lesser Displacement"]["disposition"] == "joined"
    assert keys["Blurry -> Lesser Displacement"]["stat"] == "Concealment"
    assert stamped["by_disposition"]["pending-wiki"] == 0, "every transition on the board today is ruled"
    # Every unjoined transition carries the sentence the result quotes.
    for e in stamped["transitions"]:
        if e["disposition"] != "joined":
            assert e.get("sentence"), e["key"]


def test_shipped_rulings_are_all_live():
    if not os.path.exists(ITEMS):
        return
    data = json.load(open(ITEMS, encoding="utf-8"))
    live = {t["key"] for t in T.sweep(data["items"], data["metadata"]["utility_counting_set"])}
    for k in T.load_adjudications()["ruled"]:
        assert k in live, f"{k} is ruled but no family carries that transition"
