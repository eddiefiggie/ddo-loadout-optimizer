"""#91 (U1) — the Utility tier's counting vocabulary and the untyped-proc gate.

`metadata.utility_counting_set` = Bool presence names passing the
presence-minus-magnitude test, RESTRICTED to the curated tier-1 list. Since
#343 the allow-dispositioned untyped weapon procs are NOT unioned in.
These tests pin the derivation (Ghost Touch counts; the four dual-nature names
fall out via the magnitude subtraction), the candidate rule that makes this
gate's population the deliberate complement of `untyped_rankable`'s (the two
gates' stale-checks must never fight over one name), and the adjudication
guard — including the zero-candidate refusal and the stale-entry failure.

Admitted names enter `metadata.utility_untyped_admitted` (the picker's
presence path) but NEVER `metadata.rankable_affixes` — a
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


def _rankable_names(recs=None):
    """The curated magnitude vocabulary, derived the same way build_dataset does."""
    recs = _real_records() if recs is None else recs
    untyped_allow, _ = untyped_rankable.load(
        os.path.join(ROOT, "data", "seed", "compendium", "untyped_rankable.json"))
    return build_dataset.rankable_affixes(recs, untyped_allow)


def _retired_2026_08_18():
    """The #374/U4 retirement block: `{name: entry}`. The 2026-08-18 refresh
    re-encoded the type field, giving 104 of this shard's adjudicated names a
    real `Bool` type — an untyped-proc adjudication has nothing left to match on
    a name that is no longer untyped."""
    with open(SHARD, encoding="utf-8") as fh:
        return (json.load(fh).get("_retired_2026_08_18") or {}).get("entries") or {}


def _real_untyped_candidates():
    """The untyped-weapon-proc candidate names on the real roster — the exact
    population this shard adjudicates. A retired name must not be in it."""
    return set(utility_procs.candidates(_real_records()))


def _real_bool_names():
    """Every `Bool`-typed affix name on the real item roster."""
    return utility_procs.presence_counting_names(_real_records())


def _real_counting_set():
    recs = _real_records()
    untyped_allow, _ = untyped_rankable.load(
        os.path.join(ROOT, "data", "seed", "compendium", "untyped_rankable.json"))
    rankable = build_dataset.rankable_affixes(recs, untyped_allow)
    return utility_procs.counting_set(recs, rankable), rankable


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


def test_a_bool_name_outside_tier1_does_not_count():
    # KTD10 — the perf-gate fallback: the Bool half is restricted to the curated
    # tier-1 list. Keen is a real Bool presence name (189 carriers) that passes
    # the presence predicate, and it still must not count in v1.
    recs = [_rec("A", "Boots", [_bool("Keen"), _bool("Ghost Touch")])]
    assert utility_procs.counting_set(recs, []) == ["Ghost Touch"]
    assert "Keen" not in utility_procs.UTILITY_TIER1_PRESENCE


def test_the_real_counting_set_is_tier1_only():
    # #343 — the shipped restriction, end to end: every counted name is a tier-1
    # Bool name. The admitted untyped procs used to be unioned in and were 24 of
    # the 38 counted names; they no longer count. Tier-2 presence names remain
    # out (derivable, not quarantined — nothing filed per name).
    allow, _ = utility_procs.load(SHARD)
    counting, _ = _real_counting_set()
    assert set(counting) <= utility_procs.UTILITY_TIER1_PRESENCE
    for n in ("Keen", "Adamantine", "Returning"):
        assert n not in counting, n
    assert "Ghost Touch" in counting
    # The worn defensive toggles are the point of #343.
    for n in ("Ghostly", "True Seeing", "Blurry", "Freedom of Movement",
              "Blindness Immunity", "Deathblock"):
        assert n in counting, f"{n} is why this change exists"
    assert not (allow & set(counting)), "no admitted untyped proc is counted any more"


def test_a_sentence_or_clicky_bool_line_never_counts():
    recs = [_rec("A", "Boots", [_bool("Ghost Touch"),
                                _bool("3 Charges (Recharged/Day: 3)"),
                                _bool("This is a five word sentence")])]
    out = utility_procs.counting_set(recs, [])
    assert out == ["Ghost Touch"]


def test_an_allowed_untyped_name_is_no_longer_counted_and_still_not_rankable():
    # #343 — an admitted untyped proc used to be unioned into the count. It is
    # not any more. It also still must not reach rankable_affixes, which would
    # hand it the declared-credit control (KTD4) — that half is unchanged.
    recs = [_rec("Sword A", "Weapon", [_untyped("Holy", "6")]),
            _rec("Sword B", "Weapon", [_untyped("Holy", "6")])]
    assert "Holy" not in utility_procs.counting_set(recs, [])
    assert "Holy" not in build_dataset.rankable_affixes(recs)
    # #374/U4 — it used to stay ADMITTED, and the assertion here was
    # `"Holy" in allow`, because the allow list was what kept it in the picker.
    # The refresh re-encoded the type field and upstream now types every `Holy`
    # instance `Bool`, so it is no longer an untyped candidate at all and its
    # adjudication was retired (with per-entry evidence). The PROPERTY the old
    # line guarded — "this name must not silently drop out of the picker" — is
    # what is asserted now, on the route that actually carries it today:
    # dataset.js adds every `Bool`-typed item affix to `presence`/`suggest`
    # regardless of the admitted list, so the picker path survives the retirement.
    allow, _ = utility_procs.load(SHARD)
    assert "Holy" not in allow, "retired names must leave the live allow list"
    retired = _retired_2026_08_18()
    assert retired.get("Holy", {}).get("retired_from") == "allow"
    assert (retired["Holy"].get("retired_2026_08_18") or "").strip(), \
        "a retirement must record why the adjudication no longer applies"
    bool_recs = [_rec("Sword A", "Weapon", [_bool("Holy")]),
                 _rec("Sword B", "Weapon", [_bool("Holy")])]
    assert "Holy" in utility_procs.presence_counting_names(bool_recs), \
        "the picker's presence path must still reach it, or the retirement dropped it"
    assert "Holy" not in build_dataset.rankable_affixes(bool_recs), \
        "and it still must not get a declared-credit control (KTD4, unchanged)"
    # the real roster is what makes that route live, not just the fixture
    assert "Holy" in _real_bool_names(), \
        "upstream must actually type Holy `Bool` — that is the premise of the retirement"


# #343 — two tests were REMOVED here rather than left passing for the wrong
# reason. `test_a_quarantined_name_counts_zero` had already conceded in its own
# comment that it held "a fortiori" once untyped procs stopped counting at all.
# `test_the_counting_set_values_arrive_as_strings` claimed to pin that the
# derivation "must not assume ints", but presence_counting_names never reads the
# affix value — only its type and name — so int values returned an identical
# result and the claim was unfalsifiable. Both duplicated
# test_the_counting_set_contains_the_bool_presence_names, which does the work.


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


def test_presence_not_counted_is_the_presence_population_minus_the_counted():
    """#380 — the display split, derived rather than curated.

    The set that expressed "rankable, not counted" was the untyped-weapon-proc
    allow list. Upstream typed every one of them `Bool` on 2026-08-18, the
    candidate rule stopped seeing them, the allow list emptied, and the split
    went dark with nothing failing. The meaning never depended on untypedness,
    so it is derived from the population that carries these effects now."""
    recs = _real_records()
    rankable = _rankable_names()
    counting = utility_procs.counting_set(recs, rankable)
    out = utility_procs.presence_not_counted(recs, counting, rankable)
    assert out == sorted(set(out)), "sorted and deduplicated"
    # Non-vacuity in both directions: the population is real, and the
    # subtraction actually removed something.
    assert len(out) > 100, f"the not-counted population must be real ({len(out)})"
    assert counting, "and the counting set must be non-empty for the subtraction to mean anything"
    assert not (set(out) & set(counting)), "disjoint from the counting set by construction"
    # Every member is a presence name — the set must never name a magnitude
    # stat, or the exclusion sentence would fire on ordinary ranked stats.
    assert set(out) <= utility_procs.presence_counting_names(recs)
    # The dual-nature names are subtracted, exactly as counting_set subtracts
    # them: their value is already expressible as a ranked magnitude.
    assert not (set(out) & set(rankable)), "no dual-nature magnitude name survives"
    # The anchor case: the reported proc is named again.
    assert "Undead Bane" in out, "the proc whose disclosure went dark is named once more"
    assert "Ghostly" in counting and "Ghostly" not in out


def test_an_empty_counting_set_leaves_the_whole_presence_population_not_counted():
    """The degenerate direction, asserted rather than assumed: with nothing
    counted, every presence name is not-counted. A derivation that silently
    returned empty here would reproduce the #380 collapse."""
    recs = _real_records()
    every = utility_procs.presence_not_counted(recs, [], [])
    assert set(every) == utility_procs.presence_counting_names(recs)
    rankable = _rankable_names()
    assert len(every) > len(utility_procs.presence_not_counted(
        recs, utility_procs.counting_set(recs, rankable), rankable)), \
        "and subtracting a non-empty counting set must actually shrink it"


def test_the_built_dataset_stamps_the_not_counted_split():
    """#380 — the stamp the app consumes, and its disjointness."""
    with open(DATASET, encoding="utf-8") as fh:
        meta = json.load(fh)["metadata"]
    not_counted = meta["utility_presence_not_counted"]
    counting = meta["utility_counting_set"]
    assert not_counted == sorted(set(not_counted))
    assert len(not_counted) > 100, f"populated ({len(not_counted)})"
    assert not (set(not_counted) & set(counting)), "disjoint from the counted half"
    # KTD4 — the same rule the untyped half carries: a not-counted name must not
    # gain a declared-credit control by leaking into rankable_affixes.
    assert not (set(not_counted) & set(meta["rankable_affixes"]))
    assert "Undead Bane" in not_counted


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
    # #343 — admitted untyped procs are no longer counted. They stay ADMITTED
    # (the stamp is unchanged) because the picker reads it to make them
    # individually rankable; only the counting union went away.
    assert not (set(admitted) & set(counting))
    assert not set(admitted) & set(meta["rankable_affixes"])
    allow, quarantined = utility_procs.load(SHARD)
    assert sorted(allow) == admitted
    cov = meta["utility_procs_coverage"]
    assert cov["candidates"] == cov["allowed"] + cov["quarantined"] > 0
    # #91 (U3, KTD10) — the tier-1 restriction is DISCLOSED: the stamp states
    # the curated size, the full derivable population it was cut from, and
    # that widening happens in measured batches.
    assert cov["tier1_size"] == len(utility_procs.UTILITY_TIER1_PRESENCE)
    assert cov["full_presence_population"] > cov["tier1_size"]
    assert "measured batches" in cov["note"]


def test_no_quarantined_name_leaks_into_the_shipping_admitted_stamp():
    # #343 — this test USED to assert quarantined names stay out of the counting
    # set. That became structurally unfalsifiable: counting_set is now
    # (presence & TIER1) - rankable, so no untyped name can enter it by any
    # route, and the old loop ran over `quarantined - bool_presence`, a set
    # disjoint from the counting set by construction. It could not fail for any
    # shard content — promoting a quarantined name into `allow` left the whole
    # suite green.
    #
    # Since #343 the quarantine governs exactly ONE live channel: admission to
    # metadata.utility_untyped_admitted, which is what makes a proc individually
    # rankable in the picker. That is what this pins now.
    #
    # #374/U4 — the live `allow` list is now EMPTY: the refresh typed all 24
    # admitted procs `Bool`, so every one of them was retired (with per-entry
    # evidence) and the untyped adjudication has nothing left to admit. Reading
    # the disjointness off the shipped file would therefore pass vacuously — the
    # exact failure mode the two vacuity guards below were written to prevent.
    #
    # So the property is asserted where it is still falsifiable: across the union
    # of the live lists AND the retirement block, which is the full set of names
    # this shard has ever dispositioned. A name cannot be admitted and quarantined
    # at once in ANY of those states, and a retired name cannot be quietly
    # re-admitted while its quarantine entry stands.
    allow, quarantined = utility_procs.load(SHARD)
    retired = _retired_2026_08_18()
    assert not allow, (
        "the live allow list is empty post-refresh; a name reappearing here needs "
        "its own untyped-candidate evidence, not the retired adjudication")
    assert quarantined, "an empty quarantine list would make this pass vacuously"
    assert retired, "an empty retirement block would make this pass vacuously"
    assert not (allow & quarantined), "a name on both lists has no defined disposition"

    retired_allow = {n for n, e in retired.items() if e.get("retired_from") == "allow"}
    retired_quar = {n for n, e in retired.items()
                    if e.get("retired_from") == "quarantined"}
    assert len(retired_allow) == 24 and len(retired_quar) == 80, \
        (len(retired_allow), len(retired_quar))
    assert not (retired_allow & retired_quar), \
        "a retired name must record exactly one list it came from"
    # the disposition stays single-valued across the retirement boundary too
    assert not (retired_allow & quarantined), sorted(retired_allow & quarantined)
    assert not (retired_quar & allow), sorted(retired_quar & quarantined & allow)
    # every retired name states the premise of its retirement
    for n, e in retired.items():
        assert e.get("retired_from") in ("allow", "quarantined"), n
        assert (e.get("retired_2026_08_18") or "").strip(), f"{n}: no stated reason"
        assert n not in _real_untyped_candidates(), (
            f"{n}: retired as no-longer-untyped, but the roster still carries an "
            f"untyped instance — the adjudication is still live")
