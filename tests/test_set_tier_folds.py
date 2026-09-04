"""#695 — the reviewed local folds applied at the set-tier parse seam.

Generalises `helpless_fold` from one hard-coded family to an ALLOW-LIST, so a
second family (`Maximum Spell Points (%)`) can be folded where it has to be:
before the tier's stat reaches a bucket, and without the text round-trip that
disqualified `affix_name_corrections.json` for this channel.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import set_tier_folds, set_parser, vocabulary  # noqa: E402

ITEMS = os.path.join(ROOT, "web", "data", "items.json")


def _raises(fn, *a, **k):
    try:
        fn(*a, **k)
    except SystemExit as e:
        return str(e)
    raise AssertionError("expected SystemExit, nothing raised")


# ------------------------------------------------------------------- the scope

def test_the_seam_reads_the_LOCAL_section_never_the_merged_registry():
    """The bug this guard exists for: `registry_synonym_folds()` merges upstream's
    table with the local one, and applying upstream's half here is the mass drift
    `helpless_fold`'s SCOPE note declined. A note on #683 described widening this
    seam while pointing at the merged function, which would have shipped it."""
    merged = vocabulary.registry_synonym_folds()
    ours = set_tier_folds.fold_map()
    assert len(merged) > 100, "sanity: the merged map is the big one"
    assert len(ours) < 20, f"this seam must stay small, got {len(ours)}"
    # Upstream folds must NOT be applied here.
    assert set_tier_folds.fold_stat("Attack") == "Attack", \
        "Accuracy<-Attack is an UPSTREAM fold and must not reach the set channel"
    assert "Attack" in merged, "sanity: it really is in the merged map"


def test_the_allow_list_is_the_scope_not_every_local_family():
    """`Well Rounded` is a reviewed local family and deliberately excluded: folding
    it here changes what parse_piece_text returns (pinned by test_set_parser) for
    no dataset-level gain."""
    assert "Well Rounded" not in set_tier_folds.SET_TIER_CANONICALS
    assert set_tier_folds.fold_stat("all Ability Scores") == "all Ability Scores"
    assert set_tier_folds.SET_TIER_CANONICALS == frozenset({
        "Damage to helpless enemies", "Maximum Spell Points (%)"})


def test_every_allow_listed_canonical_actually_has_a_fold():
    """An allow-listed canonical with no reviewed spelling is an inert entry."""
    folded = set(set_tier_folds.fold_map().values())
    assert folded == set(set_tier_folds.SET_TIER_CANONICALS), \
        f"allow-list and registry disagree: {folded} vs {set(set_tier_folds.SET_TIER_CANONICALS)}"


def test_an_emptied_reviewed_section_is_refused_not_silently_ignored():
    orig, set_tier_folds._FOLD_CACHE = vocabulary._local_synonym_folds, None
    vocabulary._local_synonym_folds = lambda table: {}
    try:
        err = _raises(set_tier_folds.fold_map)
        assert "no_op" in err.replace(" ", "_") or "no-op" in err, err
    finally:
        vocabulary._local_synonym_folds = orig
        set_tier_folds._FOLD_CACHE = None


# -------------------------------------------------------------------- the fold

def test_the_fold_runs_at_the_parse_seam_and_leaves_raw_VERBATIM():
    """The whole reason this is not a name correction: `raw` is provenance and must
    keep the spelling the wiki engraved, while `stat` becomes the canonical."""
    affixes, flagged = set_parser.parse_piece_text(
        "+10 Legendary bonus to Maximum Spellpoints")
    assert flagged == [], flagged
    assert len(affixes) == 1, affixes
    a = affixes[0]
    assert a["stat"] == "Maximum Spell Points (%)", a
    assert a["raw"] == "+10 Legendary bonus to Maximum Spellpoints", \
        "tier raw must stay verbatim — it is the provenance of what the wiki said"
    assert a["value"] == 10 and a["bonus_type"] == "Legendary", a


def test_names_only_value_type_and_unit_are_untouched():
    before, _ = set_parser.parse_piece_text("+10 Legendary bonus to Maximum Spell Points (%)")
    after, _ = set_parser.parse_piece_text("+10 Legendary bonus to Maximum Spellpoints")
    assert after[0]["value"] == before[0]["value"]
    assert after[0]["bonus_type"] == before[0]["bonus_type"]


def test_the_helpless_family_still_folds_here():
    """#305's family must not regress when the seam is generalised."""
    affixes, _ = set_parser.parse_piece_text("+10 Artifact bonus to Helplessness Damage")
    assert affixes[0]["stat"] == "Damage to helpless enemies", affixes


# ------------------------------------------------------------------- the guard

def test_the_channel_guard_refuses_an_empty_channel():
    err = _raises(set_tier_folds.check_channel, "t", [])
    assert "zero stats" in err, err


def test_the_channel_guard_catches_a_surviving_spelling():
    err = _raises(set_tier_folds.check_channel, "t",
                  ["Melee Power", "Maximum Spellpoints", "Maximum Spellpoints"])
    assert "Maximum Spellpoints" in err and "2" in err, err


def test_the_channel_guard_passes_a_folded_channel():
    assert set_tier_folds.check_channel(
        "t", ["Melee Power", "Maximum Spell Points (%)"]) == 2


# ------------------------------------------------------- the shipped dataset

def test_the_shipped_dataset_carries_one_bucket_for_the_spell_point_percent():
    """#693/#695 — the defect was a THIRD name in its own bucket. After the fold the
    set tier and the Solar Gems share one stat, so they take the max as the game
    does rather than summing."""
    if not os.path.exists(ITEMS):
        return
    with open(ITEMS, encoding="utf-8") as fh:
        d = json.load(fh)
    stray = []
    canon = 0
    def walk(o):
        nonlocal canon
        if isinstance(o, dict):
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                if isinstance(v, dict):
                    n = v.get("name") or v.get("stat")
                    if n == "Maximum Spellpoints":
                        stray.append(n)
                    elif n == "Maximum Spell Points (%)":
                        canon += 1
                walk(v)
    walk(d)
    assert not stray, f"{len(stray)} occurrences still carry the fold-away spelling"
    assert canon >= 20, f"expected the folded set tier to join the canonical, got {canon}"
