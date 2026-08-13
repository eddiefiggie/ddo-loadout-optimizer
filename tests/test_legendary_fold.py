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
    prefixed = []
    based = {}
    for it in data["items"]:
        for a in it.get("affixes") or []:
            if (a.get("name") or "").lower() in folded:
                prefixed.append((it["variant_id"], a["name"]))
            if a.get("type") == "Legendary" and a.get(PROVENANCE_KEY):
                based.setdefault(a["name"], 0)
                based[a["name"]] += 1
    assert prefixed == [], "no built affix keeps the prefixed stat name"
    # All five base stats are represented at type Legendary with receipts
    # (85 affixes at fold time: 14+22+3+34+12).
    assert set(based) == {"Accuracy", "Armor-Piercing", "Deadly",
                          "Conditioning", "Spell Penetration"}, based
    assert sum(based.values()) == 85, based
