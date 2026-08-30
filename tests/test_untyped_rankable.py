"""#227 — adjudication of untyped affixes that are real worn-gear magnitude stats.

`rankable_affixes()` skips untyped affixes because the untyped population is
overwhelmingly weapon procs and banes. `Enhanced Ki` proved the premise has
exceptions. These tests pin the candidate rule that separates the two
populations, and prove the adjudication guard fires — including the
zero-candidate refusal, which caught a real shape bug during implementation
(the pipeline normalizes untyped affixes to `type: None` rather than omitting
the key, so a rule keyed on key-absence silently matched nothing).
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import build_dataset  # noqa: E402
from src import untyped_rankable  # noqa: E402
from src import vocabulary  # noqa: E402
from src import name_corrections  # noqa: E402

SHARD = os.path.join(ROOT, "data", "seed", "compendium", "untyped_rankable.json")
NAME_SHARD = os.path.join(ROOT, "data", "seed", "compendium", "affix_name_corrections.json")


def _rec(name, slot, affixes):
    return {"name": name, "slot": slot, "affixes": affixes}


def _untyped(name, value="1"):
    return {"name": name, "value": value}


def _normalized_untyped(name, value="1"):
    # The shape planner_items._native_affixes produces: all three keys, type None.
    return {"name": name, "type": None, "value": value}


def _raises(exc, fn, *args, **kwargs):
    try:
        fn(*args, **kwargs)
    except exc as e:
        return e
    raise AssertionError(f"expected {exc.__name__}, nothing raised")


def _real_records():
    recs = vocabulary._load(vocabulary.ITEMS_PATH)
    name_corrections.apply(recs, name_corrections.load(NAME_SHARD))
    return recs


# ------------------------------------------------------------- candidate rule

def test_a_worn_untyped_magnitude_on_two_items_is_a_candidate():
    recs = [_rec("Icewalkers", "Boots", [_untyped("Enhanced Ki")]),
            _rec("Moonrise Bracers", "Bracers", [_untyped("Enhanced Ki", "3")])]
    found = untyped_rankable.candidates(recs)
    assert "Enhanced Ki" in found
    assert found["Enhanced Ki"]["items"] == 2


def test_the_rule_matches_both_the_raw_and_the_normalized_untyped_shape():
    # The raw file omits `type`; the pipeline sets it to None. Matching only one
    # shape makes the rule find nothing in the other, silently.
    raw = [_rec("A", "Boots", [_untyped("Enhanced Ki")]),
           _rec("B", "Boots", [_untyped("Enhanced Ki")])]
    norm = [_rec("A", "Boots", [_normalized_untyped("Enhanced Ki")]),
            _rec("B", "Boots", [_normalized_untyped("Enhanced Ki")])]
    assert "Enhanced Ki" in untyped_rankable.candidates(raw)
    assert "Enhanced Ki" in untyped_rankable.candidates(norm)


def test_a_typed_affix_is_never_a_candidate():
    recs = [_rec("A", "Boots", [{"name": "Deadly", "type": "Insight", "value": "2"}]),
            _rec("B", "Boots", [{"name": "Deadly", "type": "Insight", "value": "2"}])]
    assert untyped_rankable.candidates(recs) == {}


def test_a_weapon_only_untyped_name_is_not_a_candidate():
    recs = [_rec("Sword A", "Weapon", [_untyped("Holy", "6")]),
            _rec("Sword B", "Weapon", [_untyped("Holy", "6")])]
    assert untyped_rankable.candidates(recs) == {}


def test_an_offhand_only_untyped_name_is_not_a_candidate_under_either_slot_spelling():
    for slot in ("Offhand", "Off Hand"):
        recs = [_rec("Rune Arm A", slot, [_untyped("Rune Arm Imbue: Fire", "5")]),
                _rec("Rune Arm B", slot, [_untyped("Rune Arm Imbue: Fire", "5")])]
        assert untyped_rankable.candidates(recs) == {}, slot


def test_a_name_reaching_a_worn_slot_is_a_candidate_even_when_it_also_appears_on_weapons():
    recs = [_rec("Sword", "Weapon", [_untyped("Dazing", "2")]),
            _rec("Goggles", "Goggles", [_untyped("Dazing", "2")])]
    assert "Dazing" in untyped_rankable.candidates(recs)


def test_a_one_item_untyped_name_is_not_a_candidate():
    recs = [_rec("Only", "Boots", [_untyped("Lonely Effect")])]
    assert untyped_rankable.candidates(recs) == {}


def test_a_non_numeric_untyped_value_is_not_a_candidate():
    recs = [_rec("A", "Boots", [_untyped("Some Effect", "grants a thing")]),
            _rec("B", "Boots", [_untyped("Some Effect", "grants a thing")])]
    assert untyped_rankable.candidates(recs) == {}


def test_an_unbalanced_paren_name_is_not_a_candidate():
    # Upstream parse leakage, e.g. "Required Trait: Chaotic (UMD".
    recs = [_rec("A", "Armor", [_untyped("Required Trait: Chaotic (UMD", "5")]),
            _rec("B", "Armor", [_untyped("Required Trait: Chaotic (UMD", "5")])]
    assert untyped_rankable.candidates(recs) == {}


# ------------------------------------------------------------------- the guard

def test_guard_fails_on_a_candidate_in_neither_list():
    recs = [_rec("A", "Boots", [_untyped("New Untyped Stat", "3")]),
            _rec("B", "Cloak", [_untyped("New Untyped Stat", "3")])]
    err = _raises(SystemExit, untyped_rankable.assert_adjudicated, recs, set(), set())
    assert "New Untyped Stat" in str(err)
    assert "unadjudicated" in str(err)


def test_guard_passes_when_the_candidate_is_allowed_or_quarantined():
    recs = [_rec("A", "Boots", [_untyped("New Untyped Stat", "3")]),
            _rec("B", "Cloak", [_untyped("New Untyped Stat", "3")])]
    assert untyped_rankable.assert_adjudicated(recs, {"New Untyped Stat"}, set()) == 1
    assert untyped_rankable.assert_adjudicated(recs, set(), {"New Untyped Stat"}) == 1


def test_guard_fails_when_an_adjudicated_name_no_longer_matches_any_candidate():
    # Upstream typed it, renamed it, or dropped it — the ruling is pinned to data
    # that moved, and silently keeping it would hide that.
    recs = [_rec("A", "Boots", [_untyped("Still Here", "3")]),
            _rec("B", "Cloak", [_untyped("Still Here", "3")])]
    err = _raises(SystemExit, untyped_rankable.assert_adjudicated,
                  recs, {"Still Here"}, {"Gone Upstream"})
    assert "Gone Upstream" in str(err)
    assert "no longer match" in str(err)


def test_guard_refuses_to_inspect_zero_candidates():
    err = _raises(SystemExit, untyped_rankable.assert_adjudicated, [], set(), set())
    assert "no candidates" in str(err)


def test_a_missing_shard_loads_two_empty_sets():
    allow, quarantined = untyped_rankable.load(os.path.join(ROOT, "nope.json"))
    assert allow == set() and quarantined == set()


# ------------------------------------------------------- rankable_affixes wiring

def test_an_empty_allow_list_reproduces_the_prior_rankable_vocabulary():
    # The fail-safe direction: with nothing adjudicated, the untyped skip is
    # exactly what it was before this mechanism existed.
    recs = _real_records()
    assert build_dataset.rankable_affixes(recs, frozenset()) == \
        build_dataset.rankable_affixes(recs)


def test_the_allow_list_admits_only_its_own_names():
    recs = _real_records()
    base = set(build_dataset.rankable_affixes(recs, frozenset()))
    with_ki = set(build_dataset.rankable_affixes(recs, frozenset({"Enhanced Ki"})))
    assert with_ki - base == {"Enhanced Ki"}


def test_an_allowed_name_still_has_to_clear_every_other_filter():
    # The allow-list buys a name past the TYPE check only — a one-item untyped
    # affix is still not a rankable stat.
    recs = [_rec("Only", "Boots", [_normalized_untyped("Lonely Effect", "3")])]
    assert "Lonely Effect" not in build_dataset.rankable_affixes(
        recs, frozenset({"Lonely Effect"}))


def test_the_proc_population_stays_out_with_the_shipping_seed():
    allow, _ = untyped_rankable.load(SHARD)
    ranked = set(build_dataset.rankable_affixes(_real_records(), allow))
    for proc in ("Holy", "Vampirism", "Maiming", "Chilling", "Undead Bane",
                 "Evil Outsider Bane", "Anarchic"):
        assert proc not in ranked, proc


# ------------------------------------------------------------- shipping shard

def test_the_shipping_shard_allows_only_wiki_verified_names():
    with open(SHARD, encoding="utf-8") as fh:
        raw = json.load(fh)
    assert [e["name"] for e in raw["allow"]] == ["Enhanced Ki"]
    for e in raw["allow"]:
        assert e["wiki_url"] and e["evidence"] and e["verified"]


def test_every_quarantined_entry_carries_a_reason():
    with open(SHARD, encoding="utf-8") as fh:
        raw = json.load(fh)
    assert raw["quarantined"]
    for e in raw["quarantined"]:
        assert e.get("reason"), e


def test_the_shipping_seed_adjudicates_the_real_roster_completely():
    allow, quarantined = untyped_rankable.load(SHARD)
    checked = untyped_rankable.assert_adjudicated(_real_records(), allow, quarantined)
    assert checked == len(allow) + len(quarantined)


def test_no_quarantine_entry_is_still_unreviewed():
    """#230 — every one of the 22 was adjudicated against the wiki on 2026-08-29.

    The old reason was the literal word "unreviewed", which is a placeholder rather
    than a verdict. A new candidate arriving later may legitimately be unreviewed, but
    it must then also carry no `verified` date — the two together would be a lie."""
    import json, os
    shard = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         "data", "seed", "compendium", "untyped_rankable.json")
    with open(shard, encoding="utf-8") as fh:
        d = json.load(fh)
    q = d["quarantined"]
    assert q, "refusing to pass over an empty quarantine"
    CATS = {"no-wiki-page", "proc", "conditional", "unrankable-concept", "parse-gap", "not-a-stat"}
    for e in q:
        assert e.get("category") in CATS, f"{e['name']}: no adjudicated category"
        assert e.get("reason") and "unreviewed" not in e["reason"], \
            f"{e['name']}: still carries the placeholder reason"
        assert e.get("wiki_url"), f"{e['name']}: no wiki url recorded"
        assert e.get("verified"), f"{e['name']}: adjudicated with no date"


def test_the_adjudication_records_why_none_were_admitted():
    """A sweep that admits nothing must say so, or it reads as a sweep that never ran."""
    import json, os
    shard = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         "data", "seed", "compendium", "untyped_rankable.json")
    with open(shard, encoding="utf-8") as fh:
        d = json.load(fh)
    a = d.get("_adjudication_2026_08_29")
    assert a, "the sweep's own record is missing"
    assert sum(a["categories"].values()) == len(d["quarantined"]), \
        "the category tally must cover every quarantined name"
    assert a.get("revisit_when"), "a verdict with no revisit condition cannot be reopened deliberately"
