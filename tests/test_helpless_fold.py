"""#305 — the helpless-damage fragmentation fold.

One wiki-verified mechanic (percent Artifact damage vs helpless targets;
docs/wiki-evidence/helpless-damage.md) was carried under ~12 spellings across
the set channels, so a `Damage to helpless enemies` priority credited only the
two Solar Gem of Cruelty affixes. These tests pin:

  * the reviewed fold family (registry local section) and its scoping,
  * the fold at each channel's seam (set_parser / membership defs / augment
    seed / dino parse), with `raw` verbatim,
  * the per-channel guards (present-spelling and refuse-zero both RED),
  * the built dataset: every solver-relevant channel carries ONLY the
    canonical spelling.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src import helpless_fold  # noqa: E402
from src import membership  # noqa: E402
from src import set_parser  # noqa: E402
from src import vocabulary  # noqa: E402
from src import dino_parser  # noqa: E402

ITEMS = os.path.join(os.path.dirname(__file__), "..", "web", "data", "items.json")

CANONICAL = "Damage to helpless enemies"
# The 11 fold-away spellings censused in docs/wiki-evidence/helpless-damage.md.
FOLD_AWAY = {
    "Additional Damage to Helpless Targets",
    "Damage vs the Helpless",
    "Damage vs. Helpless",
    "Damage vs. Helpless Opponents",
    "Damage vs. Helpless opponents",
    "Damage vs. the Helpless",
    "Helplessness Damage",
    "damage versus the Helpless",
    "damage vs the Helpless",
    "damage vs. helpless",
    "damage vs. the helpless",
}


def _load_items():
    with open(ITEMS, encoding="utf-8") as fh:
        return json.load(fh)


# --------------------------------------------------------------- the fold family

def test_fold_map_is_exactly_the_reviewed_family():
    folds = helpless_fold.fold_map()
    assert set(folds) == FOLD_AWAY, (
        f"fold map must be exactly the 11 reviewed spellings, got {sorted(folds)}")
    assert all(c == CANONICAL for c in folds.values())
    # scoping: the map must NOT drag upstream synonym folds (PRR etc.) along
    assert "Attack" not in folds and "PRR" not in folds


def test_registry_local_section_reaches_the_shared_fold_map():
    # the dino channel folds through registry_synonym_folds; the local section
    # must be merged there (that is what covers `damage vs. the helpless`)
    folds = vocabulary.registry_synonym_folds()
    for syn in FOLD_AWAY:
        assert folds.get(syn) == CANONICAL, f"{syn!r} missing from registry folds"


def test_local_section_does_not_disturb_the_u6_live_vs_frozen_gate():
    # the U6 gate diffs the UPSTREAM section only; the repo-local additions must
    # be invisible to it (adding them to `affix_synonyms` would read as 11
    # dropped-fold events on the next re-import)
    n = vocabulary.check_affix_synonyms(
        vocabulary.load_live_affix_synonyms(),
        vocabulary._load(vocabulary.AFFIX_SYNONYMS_REGISTRY_PATH))
    assert n == 94, f"expected the 94 upstream folds validated, got {n}"


def test_local_fold_colliding_with_an_upstream_fold_raises():
    table = {
        "affix_synonyms": [{"name": "Accuracy", "synonyms": ["Attack"]}],
        "local_affix_synonyms": [{"name": "Deadly", "synonyms": ["Attack"]}],
    }
    try:
        vocabulary._local_synonym_folds(table)
    except vocabulary.IntegrityError as e:
        assert "Attack" in str(e)
    else:
        raise AssertionError("a spelling folding two ways must raise")


# ------------------------------------------------------------- per-channel seams

def test_set_parser_folds_at_the_parse_seam_and_keeps_raw_verbatim():
    text = "+15 Artifact bonus to Damage vs. Helpless Opponents"
    tiers = set_parser.parse_set_bonuses(
        [{"set": "T", "wiki_url": "u", "piece_bonuses": {"3 Pieces": text}}])
    assert len(tiers) == 1
    stats = [(a["stat"], a["bonus_type"], a["value"]) for a in tiers[0]["affixes"]]
    assert stats == [(CANONICAL, "Artifact", 15)], stats
    assert tiers[0]["raw"] == text, "tier raw must stay verbatim"


def test_membership_defs_carry_only_the_canonical_spelling():
    defs = membership.build_membership_set_defs()
    stats = {a["stat"] for d in defs.values() for t in d["tiers"] for a in t["affixes"]}
    assert not (stats & FOLD_AWAY), f"fold-away spelling in membership defs: {stats & FOLD_AWAY}"
    # Dread Stalker (was `damage vs. helpless`) and the Legendary Vecna trio
    # (was `Additional Damage to Helpless Targets`) now carry the canonical
    for name in ("Dread Stalker", "Legendary Delight of the Devourer"):
        got = {(a["stat"], a["bonus_type"], a["value"])
               for t in defs[name]["tiers"] for a in t["affixes"]}
        assert any(s == CANONICAL and b == "Artifact" for s, b, _ in got), (
            f"{name} must grant {CANONICAL!r} as an Artifact bonus, got {sorted(got)}")


def test_augment_defs_carry_the_canonical_with_value_type_unit_untouched():
    defs = membership.build_augment_set_defs()
    affixes = defs["Cruel Cut"]["tiers"][0]["affixes"]
    assert [(a["stat"], a["bonus_type"], a["value"], a["unit"]) for a in affixes] == \
        [(CANONICAL, "Artifact", 15, "pct")]
    stats = {a["stat"] for d in defs.values() for t in d["tiers"] for a in t["affixes"]}
    assert not (stats & FOLD_AWAY)


def test_dino_parse_seam_folds_the_wiki_spelling():
    recs = dino_parser.parse_set_augments([{
        "name": "Dread Stalker", "set_name": "Dread Stalker", "threshold": 3,
        "tier_text": "+15% Artifact bonus to damage vs. the helpless",
        "wiki_url": "https://ddowiki.com/page/Dinosaur_Bone_crafting",
    }])
    assert [(a["stat"], a["bonus_type"]) for a in recs[0]["affixes"]] == \
        [(CANONICAL, "Artifact")]
    assert "damage vs. the helpless" in recs[0]["raw"], "raw stays verbatim"


# ------------------------------------------------------------------- the guards

def test_guard_red_a_surviving_fold_away_spelling_raises():
    try:
        helpless_fold.check_channel("t", [CANONICAL, "Helplessness Damage"])
    except SystemExit as e:
        assert "Helplessness Damage" in str(e) and "t" in str(e)
    else:
        raise AssertionError("a surviving fold-away spelling must fail the build")


def test_guard_red_zero_stats_is_a_failure_not_a_pass():
    try:
        helpless_fold.check_channel("t", [])
    except SystemExit as e:
        assert "zero" in str(e)
    else:
        raise AssertionError("an empty channel must be a guard failure")


def test_guard_green_counts_what_it_inspected():
    assert helpless_fold.check_channel("t", [CANONICAL, "Strength"]) == 2


# ------------------------------------------------------- the built dataset (#305)

def test_dataset_every_solver_channel_carries_only_the_canonical():
    data = _load_items()
    census = {}

    def see(chan, stat):
        if isinstance(stat, str) and stat in FOLD_AWAY:
            census.setdefault(chan, set()).add(stat)

    for v in data["items"]:
        for a in v.get("affixes") or []:
            see("items.affixes", a.get("name"))
            see("items.affixes", a.get("stat"))
        for t in v.get("parsed_set_bonuses") or []:
            for a in t.get("affixes") or []:
                see("parsed_set_bonuses", a.get("stat"))
    for chan in ("membership_set_defs", "augment_set_defs"):
        for d in (data.get(chan) or {}).values():
            for t in d.get("tiers") or []:
                for a in t.get("affixes") or []:
                    see(chan, a.get("stat"))
    for s in data.get("dino_sets") or []:
        for a in s.get("affixes") or []:
            see("dino_sets", a.get("stat"))
    assert not census, f"fold-away helpless spellings survived: {census}"


def test_dataset_set_tier_credit_reaches_the_canonical_name():
    # The crediting fix itself: the solver matches item/set affixes by literal
    # stat name, so these assertions are what turns ~19 sets from score-zero to
    # credited under a `Damage to helpless enemies` priority. (Solver-level
    # set-tier crediting for arbitrary stat names is already proven by
    # tests/solver.test.js `setPiece`/membership fixtures.)
    data = _load_items()
    # item-attached channel: Silent Avenger (Legendary) 3-piece tier
    tier_hits = [
        (t["set"], a["value"], a["bonus_type"])
        for v in data["items"] for t in v.get("parsed_set_bonuses") or []
        for a in t.get("affixes") or []
        if t.get("set") == "Silent Avenger (Legendary)" and a.get("stat") == CANONICAL]
    assert tier_hits and all(b == "Artifact" for _, _, b in tier_hits), tier_hits
    # membership-def channel: Dread Stalker
    ds = data["membership_set_defs"]["Dread Stalker"]
    got = [(a["stat"], a["bonus_type"], a["value"])
           for t in ds["tiers"] for a in t.get("affixes") or []]
    assert (CANONICAL, "Artifact", 15) in got, got
    # the priority remains rankable and picker-resolvable in every old spelling
    assert CANONICAL in data["metadata"]["rankable_affixes"]
    aliases = data["metadata"]["affix_aliases"]
    for syn in FOLD_AWAY:
        assert aliases.get(syn) == CANONICAL, f"picker alias missing for {syn!r}"


def test_dataset_raw_provenance_keeps_the_original_spellings():
    data = _load_items()
    raws = [t.get("raw") or "" for v in data["items"]
            for t in v.get("parsed_set_bonuses") or []]
    assert any("Damage vs. Helpless Opponents" in r for r in raws), \
        "verbatim tier raw must keep the wiki spelling"
    assert any("Helplessness Damage" in r for r in raws)
