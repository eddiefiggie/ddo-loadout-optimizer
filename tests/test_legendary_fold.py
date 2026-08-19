"""#287 — fold Legendary-prefixed numeric stats into their base stats.

The wiki models these as the SAME enchantment with `Legendary` as the bonus-type
parameter ({{Accuracy|2|Legendary}}); gear-planner's display name keeps the
prefix, and the dataset adopted it as the stat name, so a plain `Accuracy`
priority scored zero on every carrier. The fold renames the five wiki-verified
stats and stamps the engraved name as the provenance receipt.

The load-bearing cases are the guards: a blanket prefix-strip would silently
fold a future unverified stat (never-infer), and a fold that stops running
would quietly re-split the buckets. Both directions must go red.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import legendary_fold  # noqa: E402
from src.spell_focus import PROVENANCE_KEY  # noqa: E402


def _rec(*affixes):
    return {"name": "Test Item", "affixes": [dict(a) for a in affixes]}


def _aff(name, type_="Legendary", value="2"):
    return {"name": name, "type": type_, "value": value}


# ---- the fold -------------------------------------------------------------------

def test_all_five_stats_fold_to_their_base_names():
    pairs = {
        "Legendary Accuracy": "Accuracy",
        "Legendary Armor-Piercing": "Armor-Piercing",
        "Legendary Deadly": "Deadly",
        "Legendary Conditioning": "Conditioning",
        "Legendary Spell Penetration": "Spell Penetration",
    }
    for engraved, base in pairs.items():
        rec = _rec(_aff(engraved))
        legendary_fold.apply([rec])
        a = rec["affixes"][0]
        assert a["name"] == base, engraved
        assert a["type"] == "Legendary", "the bonus type is the whole point"
        assert a[PROVENANCE_KEY] == engraved, "receipt names what the item engraves"


def test_value_and_unrelated_keys_survive_the_fold():
    rec = _rec({"name": "Legendary Accuracy", "type": "Legendary",
                "value": "5", "eligible": True})
    legendary_fold.apply([rec])
    a = rec["affixes"][0]
    assert a["value"] == "5" and a["eligible"] is True


def test_bool_legendary_procs_pass_through_untouched():
    rec = _rec(_aff("Legendary Slime", type_="Bool", value="1"),
               _aff("Legendary Demonic Shield", type_="Bool", value="1"))
    cov = legendary_fold.apply([rec])
    assert [a["name"] for a in rec["affixes"]] == [
        "Legendary Slime", "Legendary Demonic Shield"]
    assert not any(PROVENANCE_KEY in a for a in rec["affixes"])
    assert cov["folded"] == 0


def test_coverage_counts_the_folds():
    rec = _rec(_aff("Legendary Accuracy"), _aff("Legendary Deadly", value="3"))
    cov = legendary_fold.apply([rec])
    assert cov["folded"] == 2


def test_coverage_reports_per_name_fires_over_the_whole_fold_table():
    # #381 — every FOLD key is present with a count, zeros included. A caller
    # unioning channels must never have to tell "this channel folded none" apart
    # from "this channel forgot the key".
    rec = _rec(_aff("Legendary Accuracy"), _aff("Legendary Deadly", value="3"))
    cov = legendary_fold.apply([rec])
    assert set(cov["by_name"]) == set(legendary_fold.FOLD)
    assert cov["by_name"]["legendary accuracy"] == 1
    assert cov["by_name"]["legendary deadly"] == 1
    assert cov["by_name"]["legendary conditioning"] == 0
    assert cov["records"] == 1
    assert cov["folded"] == 2, "the pre-existing key still means what it meant"


# ---- #381: retired labels, DERIVED from what fired ---------------------------------

def _cov(*fired, records=1):
    """A channel coverage in which exactly ``fired`` folded."""
    return {"folded": len(fired), "records": records,
            "by_name": {k: (1 if k in fired else 0) for k in legendary_fold.FOLD}}


def test_a_fold_entry_that_no_channel_fired_is_retired_to_its_base_stat():
    retired = legendary_fold.retired_labels(_cov("legendary conditioning"))
    assert retired["legendary accuracy"] == ["Accuracy"]
    assert retired["legendary armor-piercing"] == ["Armor-Piercing"]
    assert retired["legendary deadly"] == ["Deadly"]
    assert retired["legendary spell penetration"] == ["Spell Penetration"]
    assert "legendary conditioning" not in retired, (
        "an entry that FIRED is live, not retired")


def test_retirement_is_the_UNION_across_channels_not_any_one_of_them():
    # `Legendary Conditioning` folds on the augment channel ALONE — name_corrections
    # mints it there from `False Life (%)`. Judging any single channel would retire
    # a label the build still resolves.
    items = _cov()
    sets = _cov()
    augments = _cov("legendary conditioning")
    assert "legendary conditioning" in legendary_fold.retired_labels(items)
    assert "legendary conditioning" not in legendary_fold.retired_labels(
        sets, items, augments)


def test_retirement_is_keyed_on_FIRING_not_on_raw_occurrences():
    # The distinction this whole derivation rests on. All five names have zero RAW
    # occurrences in the refreshed snapshot; `Legendary Conditioning` still resolves
    # because a rename upstream of the fold mints it. A record that arrives already
    # spelled `Conditioning` never fires the entry; one renamed INTO the engraved
    # name does — and only the second keeps the label alive.
    already_folded = _rec({"name": "Conditioning", "type": "Legendary", "value": "15"})
    renamed_in = _rec(_aff("Legendary Conditioning", value="15"))
    assert "legendary conditioning" in legendary_fold.retired_labels(
        legendary_fold.apply([already_folded]))
    assert "legendary conditioning" not in legendary_fold.retired_labels(
        legendary_fold.apply([renamed_in]))


def test_retired_labels_refuses_zero_channels():
    try:
        legendary_fold.retired_labels()
    except SystemExit as e:
        assert "no channel coverage" in str(e)
    else:
        raise AssertionError("zero channels cannot establish that nothing folded")


def test_retired_labels_refuses_zero_records():
    try:
        legendary_fold.retired_labels(_cov(records=0), _cov(records=0))
    except SystemExit as e:
        assert "inspected zero records" in str(e)
    else:
        raise AssertionError("a vacuous pass would retire every label")


def test_retired_labels_refuses_an_empty_fold_table():
    saved = dict(legendary_fold.FOLD)
    legendary_fold.FOLD.clear()
    try:
        legendary_fold.retired_labels({"by_name": {}, "records": 1})
    except SystemExit as e:
        assert "FOLD is empty" in str(e)
    else:
        raise AssertionError("an empty allowlist vouches for nothing")
    finally:
        legendary_fold.FOLD.update(saved)


def test_retired_labels_refuses_a_channel_with_drifted_counts():
    try:
        legendary_fold.retired_labels({"folded": 0, "records": 5})
    except SystemExit as e:
        assert "no usable by_name counts" in str(e)
    else:
        raise AssertionError("a coverage without per-name counts proves nothing")


def test_a_retired_label_whose_target_left_the_vocabulary_fails_the_build():
    # Migrating a saved priority onto a dead name is worse than not migrating: the
    # player is told the priority was repaired and it still scores nothing.
    retired = {"legendary accuracy": ["Accuracy"]}
    legendary_fold.assert_targets_rankable(retired, ["Accuracy", "Deadly"])
    try:
        legendary_fold.assert_targets_rankable(retired, ["Deadly"])
    except SystemExit as e:
        assert "absent from the shipped picker vocabulary" in str(e)
        assert "'Accuracy'" in str(e)
    else:
        raise AssertionError("a retired label must never migrate onto a dead name")


def test_built_dataset_retires_exactly_the_four_adopted_labels():
    path = os.path.join(ROOT, "web", "data", "items.json")
    if not os.path.exists(path):
        return
    with open(path) as fh:
        data = json.load(fh)
    meta = data["metadata"]
    assert meta["retired_labels"] == {
        "legendary accuracy": ["Accuracy"],
        "legendary armor-piercing": ["Armor-Piercing"],
        "legendary deadly": ["Deadly"],
        "legendary spell penetration": ["Spell Penetration"],
    }, meta["retired_labels"]
    # The survivor, asserted from the OTHER side: it is a provenance label rather
    # than a retired one, which is the whole fire-vs-occurrence distinction.
    assert "Legendary Conditioning" in meta["provenance_labels"]
    rankable = set(meta["rankable_affixes"])
    for targets in meta["retired_labels"].values():
        for t in targets:
            assert t in rankable, t
    # And the two maps stay disjoint — a name cannot both redirect as shorthand
    # and be renamed in place; the player would get two contradictory sentences.
    assert not (set(meta["retired_labels"]) & set(meta["expanded_away_names"]))


# ---- the guards -----------------------------------------------------------------

def test_an_unknown_numeric_legendary_stat_fails_the_build():
    # A sixth 'Legendary X' at bonus type Legendary is a NEW enchantment nobody
    # verified — folding it would guess, skipping it would silently re-split.
    rec = _rec(_aff("Legendary Vitality", value="3"))
    try:
        legendary_fold.apply([rec])
    except SystemExit as e:
        assert "Legendary Vitality" in str(e)
    else:
        raise AssertionError("an un-adjudicated Legendary stat must fail the build")


def test_a_known_name_at_a_foreign_type_fails_the_build():
    # 'Legendary Accuracy' typed anything but Legendary means upstream moved —
    # adjudicate rather than fold on faith.
    rec = _rec(_aff("Legendary Accuracy", type_="Competence"))
    try:
        legendary_fold.apply([rec])
    except SystemExit as e:
        assert "Legendary Accuracy" in str(e)
    else:
        raise AssertionError("a foreign-typed known name must fail the build")


def test_apply_refuses_an_empty_record_set():
    try:
        legendary_fold.apply([])
    except SystemExit:
        pass
    else:
        raise AssertionError("an empty walk is not a pass")


# ---- the built dataset ------------------------------------------------------------

def test_built_dataset_carries_no_prefixed_stat_and_credits_the_base():
    path = os.path.join(ROOT, "web", "data", "items.json")
    if not os.path.exists(path):
        return
    with open(path) as fh:
        data = json.load(fh)
    folded = dict(legendary_fold.FOLD)
    targets = set(folded.values())
    prefixed = []
    based = {}      # base stat at type Legendary WITH a fold receipt
    native = {}     # base stat at type Legendary that upstream already emitted
    for it in data["items"]:
        for a in it.get("affixes") or []:
            if (a.get("name") or "").lower() in folded:
                prefixed.append((it["variant_id"], a["name"]))
            if a.get("type") == "Legendary" and a.get("name") in targets:
                bucket = based if a.get(PROVENANCE_KEY) else native
                bucket[a["name"]] = bucket.get(a["name"], 0) + 1
    assert prefixed == [], "no built affix keeps the prefixed stat name"
    # #374/U4 — re-ratified. The EMITTED data is byte-for-byte the same shape it
    # was: all five base stats at type Legendary, 87 affixes, same per-stat counts
    # (14 + 22 + 3 + 36 + 12). What moved is the ROUTE four of them take.
    #
    # The 2026-08-18 refresh had upstream adopt this exact fold: it now emits the
    # BASE name at `type: "Legendary"` for Accuracy, Armor-Piercing, Deadly and
    # Spell Penetration, so those four arrive already-folded and carry no receipt
    # — there was nothing to rewrite. The fold becomes inert for them (it has no
    # `assert_all_reached`, so that would otherwise be silent, which is exactly why
    # it is pinned here). See the migration report §4.
    #
    # `Conditioning` is the one family still routed through the fold, and for the
    # opposite reason: upstream FOLDED `Legendary Conditioning` away into
    # `False Life (%)`, our canon-defence correction renames it back above this
    # fold, and it folds to `Conditioning` — including the two Solar Gem of
    # Enduring augments #376 added (34 worn carriers + 2 = 36).
    assert set(based) == {"Conditioning"}, based
    assert based["Conditioning"] == 36, based
    assert native == {"Accuracy": 14, "Armor-Piercing": 22, "Deadly": 3,
                      "Spell Penetration": 12}, native
    # the population as a whole is unchanged, which is the claim that matters
    assert set(based) | set(native) == targets
    assert sum(based.values()) + sum(native.values()) == 87, (based, native)
