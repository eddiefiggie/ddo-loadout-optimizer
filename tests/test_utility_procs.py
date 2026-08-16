"""#91 (U1) — the Utility tier's counting vocabulary and the untyped-proc gate.

`metadata.utility_counting_set` = (Bool presence names passing the
presence-minus-magnitude test) ∪ (allow-dispositioned untyped weapon procs).
These tests pin the derivation (Ghost Touch counts; the four dual-nature names
fall out via the magnitude subtraction), the candidate rule that makes this
gate's population the deliberate complement of `untyped_rankable`'s (the two
gates' stale-checks must never fight over one name), and the adjudication
guard — including the zero-candidate refusal and the stale-entry failure.

Admitted names enter the counting set and `metadata.utility_untyped_admitted`
(the picker's presence path) but NEVER `metadata.rankable_affixes` — a
declared-credit control on Holy/Vampirism is the documented defect
`web/dataset.js` warns against.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import build_dataset  # noqa: E402
from src import untyped_rankable  # noqa: E402
from src import utility_procs  # noqa: E402
from src import vocabulary  # noqa: E402
from src import name_corrections  # noqa: E402

SHARD = os.path.join(ROOT, "data", "seed", "compendium", "utility_procs.json")
DATASET = os.path.join(ROOT, "web", "data", "items.json")
NAME_SHARD = os.path.join(ROOT, "data", "seed", "compendium", "affix_name_corrections.json")

DUAL_NATURE = ("Deception", "Smoke Screen", "Protection from Evil", "Underwater Action")


def _rec(name, slot, affixes):
    return {"name": name, "slot": slot, "affixes": affixes}


def _untyped(name, value="1"):
    return {"name": name, "value": value}


def _bool(name, value="1"):
    return {"name": name, "type": "Bool", "value": value}


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


def _real_counting_set(uproc_allow=frozenset()):
    recs = _real_records()
    untyped_allow, _ = untyped_rankable.load(
        os.path.join(ROOT, "data", "seed", "compendium", "untyped_rankable.json"))
    rankable = build_dataset.rankable_affixes(recs, untyped_allow)
    return utility_procs.counting_set(recs, rankable, uproc_allow), rankable


# ------------------------------------------------------------ the counting set

def test_the_counting_set_contains_the_bool_presence_names():
    counting, _ = _real_counting_set()
    assert "Ghost Touch" in counting
    assert "Feather Falling" in counting


def test_the_four_dual_nature_names_fall_out_via_the_magnitude_subtraction():
    # Each ships a Bool line on some items AND a real rankable magnitude on
    # others; their value is already expressible as a ranked stat (R5), so the
    # presence-minus-magnitude subtraction must drop them.
    counting, rankable = _real_counting_set()
    for n in DUAL_NATURE:
        assert n in rankable, n
        assert n not in counting, n


def test_a_sentence_or_clicky_bool_line_never_counts():
    recs = [_rec("A", "Boots", [_bool("Ghost Touch"),
                                _bool("3 Charges (Recharged/Day: 3)"),
                                _bool("This is a five word sentence")])]
    out = utility_procs.counting_set(recs, [], set())
    assert out == ["Ghost Touch"]


def test_an_allowed_untyped_name_enters_the_counting_set_but_never_rankable():
    recs = [_rec("Sword A", "Weapon", [_untyped("Holy", "6")]),
            _rec("Sword B", "Weapon", [_untyped("Holy", "6")])]
    counting = utility_procs.counting_set(recs, [], {"Holy"})
    assert "Holy" in counting
    # NOT rankable_affixes: an admitted proc must never gain the declared-credit
    # control (KTD4) — rankable_affixes never sees the utility allow-list.
    assert "Holy" not in build_dataset.rankable_affixes(recs)


def test_a_quarantined_name_counts_zero():
    recs = [_rec("Sword A", "Weapon", [_untyped("Holy", "6"), _bool("Ghost Touch")]),
            _rec("Sword B", "Weapon", [_untyped("Holy", "6")])]
    # Quarantine = not in the allow set handed to counting_set. AE5 at the
    # pipeline layer: the unreviewed name contributes nothing.
    assert utility_procs.counting_set(recs, [], set()) == ["Ghost Touch"]


def test_the_counting_set_values_arrive_as_strings():
    # Dataset values are strings ('1', '3') — the derivation must not assume ints.
    recs = [_rec("A", "Weapon", [_untyped("Holy", "6"), _bool("Ghost Touch", "1")])]
    assert utility_procs.counting_set(recs, [], {"Holy"}) == ["Ghost Touch", "Holy"]


# ------------------------------------------------------------- candidate rule

def test_a_weapon_only_untyped_name_is_a_candidate():
    recs = [_rec("Sword A", "Weapon", [_untyped("Holy", "6")]),
            _rec("Sword B", "Weapon", [_untyped("Holy", "6")])]
    found = utility_procs.candidates(recs)
    assert "Holy" in found
    assert found["Holy"]["items"] == 2


def test_an_offhand_only_untyped_name_is_a_candidate_under_either_slot_spelling():
    for slot in ("Offhand", "Off Hand"):
        recs = [_rec("Orb", slot, [_untyped("Maiming", "3")])]
        assert "Maiming" in utility_procs.candidates(recs), slot


def test_a_name_reaching_a_worn_slot_belongs_to_the_other_gate():
    # The disjointness invariant: untyped_rankable claims names that REACH a
    # worn slot; this gate claims names that never do. One name, one gate.
    recs = [_rec("Sword", "Weapon", [_untyped("Dazing", "2")]),
            _rec("Goggles", "Goggles", [_untyped("Dazing", "2")])]
    assert "Dazing" not in utility_procs.candidates(recs)
    assert "Dazing" in untyped_rankable.candidates(recs)


def test_a_typed_affix_is_never_a_candidate():
    recs = [_rec("Sword", "Weapon", [{"name": "Holy", "type": "Enhancement", "value": "6"}])]
    assert utility_procs.candidates(recs) == {}


def test_a_bool_affix_is_never_a_candidate():
    # Bool procs (Echo's Whelming Shockwave...) already count via the presence
    # half; the review gate is for the UNTYPED population only.
    recs = [_rec("Sword", "Weapon", [_bool("Whelming Shockwave")])]
    assert utility_procs.candidates(recs) == {}


def test_an_unbalanced_paren_name_is_not_a_candidate():
    recs = [_rec("Sword", "Weapon", [_untyped("Required Trait: Chaotic (UMD", "5")])]
    assert utility_procs.candidates(recs) == {}


def test_the_two_gates_populations_are_disjoint_on_the_real_roster():
    recs = _real_records()
    ours = set(utility_procs.candidates(recs))
    theirs = set(untyped_rankable.candidates(recs))
    assert ours, "the proc population went missing"
    assert not (ours & theirs), sorted(ours & theirs)


# ------------------------------------------------------------------- the guard

def test_guard_fails_by_name_on_an_undispositioned_candidate():
    recs = [_rec("Sword A", "Weapon", [_untyped("New Weapon Proc", "3")])]
    err = _raises(SystemExit, utility_procs.assert_adjudicated, recs, set(), set())
    assert "New Weapon Proc" in str(err)
    assert "unadjudicated" in str(err)


def test_guard_passes_when_the_candidate_is_allowed_or_quarantined():
    recs = [_rec("Sword A", "Weapon", [_untyped("New Weapon Proc", "3")])]
    assert utility_procs.assert_adjudicated(recs, {"New Weapon Proc"}, set()) == 1
    assert utility_procs.assert_adjudicated(recs, set(), {"New Weapon Proc"}) == 1


def test_guard_refuses_to_inspect_zero_candidates():
    # A non-empty roster whose candidate rule matches nothing must refuse, not
    # pass vacuously — that is how a gate that guards nothing looks exactly
    # like a gate that guards everything.
    recs = [_rec("Boots", "Boots", [{"name": "Dexterity", "type": "Enhancement", "value": "8"}])]
    err = _raises(SystemExit, utility_procs.assert_adjudicated, recs, set(), set())
    assert "no candidates" in str(err)
    err = _raises(SystemExit, utility_procs.assert_adjudicated, [], set(), set())
    assert "no candidates" in str(err)


def test_guard_fails_on_a_stale_allow_entry():
    # Upstream typed it, renamed it, or gave it a worn-slot carrier (moving it
    # to untyped_rankable's population) — the ruling is pinned to data that moved.
    recs = [_rec("Sword A", "Weapon", [_untyped("Still Here", "3")])]
    err = _raises(SystemExit, utility_procs.assert_adjudicated,
                  recs, {"Still Here", "Gone Upstream"}, set())
    assert "Gone Upstream" in str(err)
    assert "no longer match" in str(err)


def test_a_missing_shard_loads_two_empty_sets():
    allow, quarantined = utility_procs.load(os.path.join(ROOT, "nope.json"))
    assert allow == set() and quarantined == set()


# ------------------------------------------------- presence-predicate parity

def test_the_presence_predicate_mirrors_the_web_picker():
    # Spot-pin the mirrored predicate against web/dataset.js's documented
    # behavior: noise chars, the four-word cap, and the PRESENCE_ALLOW
    # overrides. A drift here means the stamped counting set disagrees with
    # what the picker badges as presence.
    assert utility_procs.is_presence_targetable("Ghost Touch")
    assert utility_procs.is_presence_targetable("Feather Falling")
    assert not utility_procs.is_presence_targetable("Grants a 5% chance to daze")
    assert not utility_procs.is_presence_targetable("Clicky: Haste")
    assert not utility_procs.is_presence_targetable("A name of five whole words")
    assert utility_procs.is_presence_targetable("Kick 'Em While They're Down")
    assert utility_procs.is_presence_targetable("Legendary Tet-zik, The Enlightened Change")
    assert not utility_procs.is_presence_targetable("")


# ------------------------------------------------------------- shipping shard

def test_the_shipping_shard_allows_only_wiki_verified_names():
    with open(SHARD, encoding="utf-8") as fh:
        raw = json.load(fh)
    for e in raw["allow"]:
        assert e["wiki_url"] and e["evidence"], e["name"]


def test_every_quarantined_entry_carries_a_reason():
    with open(SHARD, encoding="utf-8") as fh:
        raw = json.load(fh)
    assert raw["quarantined"]
    for e in raw["quarantined"]:
        assert e.get("reason"), e


def test_the_shipping_seed_adjudicates_the_real_roster_completely():
    allow, quarantined = utility_procs.load(SHARD)
    checked = utility_procs.assert_adjudicated(_real_records(), allow, quarantined)
    assert checked == len(allow) + len(quarantined)


def test_the_built_dataset_stamps_the_counting_vocabulary():
    # The stamp is the authority the app consumes (KTD3): non-empty
    # utility_counting_set, its untyped half in utility_untyped_admitted, the
    # dual-nature names out, and no admitted name leaking into
    # rankable_affixes (KTD4 — the declared-credit defect).
    with open(DATASET, encoding="utf-8") as fh:
        meta = json.load(fh)["metadata"]
    counting = meta["utility_counting_set"]
    admitted = meta["utility_untyped_admitted"]
    assert counting and counting == sorted(set(counting))
    assert "Ghost Touch" in counting
    for n in DUAL_NATURE:
        assert n not in counting, n
    assert set(admitted) <= set(counting)
    assert not set(admitted) & set(meta["rankable_affixes"])
    allow, quarantined = utility_procs.load(SHARD)
    assert sorted(allow) == admitted
    cov = meta["utility_procs_coverage"]
    assert cov["candidates"] == cov["allowed"] + cov["quarantined"] > 0


def test_no_quarantined_name_leaks_into_the_shipping_counting_set():
    _, quarantined = utility_procs.load(SHARD)
    counting, _ = _real_counting_set(utility_procs.load(SHARD)[0])
    # A quarantined UNTYPED name stays out of the counting set. NB some names
    # (Holy) also ship a Bool line on a few items — those count via the
    # presence half by design (R5); the quarantine governs only the untyped
    # admission channel, so the assertion excludes the Bool-presence names.
    recs = _real_records()
    bool_presence = utility_procs.presence_counting_names(recs)
    for n in sorted(quarantined - bool_presence):
        assert n not in counting, n
