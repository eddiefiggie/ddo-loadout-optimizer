"""U1 — U81 Nearly Complete parser tests (strict provenance)."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import nearly_complete  # noqa: E402

_WIKI = "https://ddowiki.com/page/Nearly_Complete"


def _ability_cat():
    return {
        "category": "Ability Score", "heroic_value": 6, "legendary_value": 15,
        "wiki_url": _WIKI,
        "options": [{"stat": s, "bonus_type": "Enhancement"} for s in
                    ("Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma")],
    }


def test_ability_score_expands_to_both_tiers():
    records, quarantined = nearly_complete.parse_categories([_ability_cat()])
    assert quarantined == []
    assert len(records) == 12  # 6 abilities x 2 tiers
    leg_con = next(r for r in records if r["stat"] == "Constitution" and r["tier"] == "legendary")
    assert leg_con["bonus_type"] == "Enhancement" and leg_con["value"] == 15
    her_con = next(r for r in records if r["stat"] == "Constitution" and r["tier"] == "heroic")
    assert her_con["value"] == 6


def test_missing_wiki_url_is_quarantined():
    cat = _ability_cat(); cat["wiki_url"] = ""
    records, quarantined = nearly_complete.parse_categories([cat])
    assert records == []
    assert quarantined[0]["reason"] == "missing wiki_url"


def test_unrecognized_category_is_quarantined():
    cat = _ability_cat(); cat["category"] = "Bogus Category"
    records, quarantined = nearly_complete.parse_categories([cat])
    assert records == []
    assert quarantined[0]["reason"] == "unrecognized category"


def test_missing_magnitude_is_quarantined_not_inferred():
    cat = _ability_cat(); cat["legendary_value"] = None
    records, quarantined = nearly_complete.parse_categories([cat])
    # heroic records still parse; every legendary option quarantines
    assert all(r["tier"] == "heroic" for r in records)
    assert len(records) == 6
    assert any(q["reason"] == "missing magnitude" for q in quarantined)


def test_option_missing_bonus_type_is_quarantined():
    cat = _ability_cat(); cat["options"].append({"stat": "Vitality"})  # no bonus_type
    records, quarantined = nearly_complete.parse_categories([cat])
    assert any(q["reason"] == "missing stat or bonus_type" for q in quarantined)


def test_per_option_bonus_type_preserved():
    # Healing Amplification is the case where options carry distinct bonus types.
    cat = {"category": "Healing Amplification", "heroic_value": 24, "legendary_value": 62,
           "wiki_url": _WIKI, "options": [
               {"stat": "Positive Healing Amplification", "bonus_type": "Competence"},
               {"stat": "Repair Amplification", "bonus_type": "Enhancement"},
               {"stat": "Negative Healing Amplification", "bonus_type": "Profane"}]}
    records, _ = nearly_complete.parse_categories([cat])
    types = {r["stat"]: r["bonus_type"] for r in records if r["tier"] == "legendary"}
    assert types["Positive Healing Amplification"] == "Competence"
    assert types["Repair Amplification"] == "Enhancement"
    assert types["Negative Healing Amplification"] == "Profane"


def test_shipped_seed_parses_clean():
    seed_path = os.path.join(ROOT, "data", "seed", "nearly_complete.json")
    with open(seed_path, encoding="utf-8") as fh:
        seed = json.load(fh)
    result = nearly_complete.parse_nearly_complete(seed)
    cov = result["coverage"]
    # Regression pin on the full sourced pool (U2): all 6 categories, 0 quarantined.
    assert set(cov["categories_sourced"]) == nearly_complete.CATEGORIES
    assert cov["options_quarantined"] == 0, result["quarantined"]
    assert cov["options_eligible"] >= 60
    assert "pending" in cov["item_hosts"]
    for r in result["records"]:
        assert r["category"] in nearly_complete.CATEGORIES
        assert r["wiki_url"]
        assert r["tier"] in ("heroic", "legendary")
    # spot-check reconciled endgame values
    leg = {(r["stat"], r["category"]): r for r in result["records"] if r["tier"] == "legendary"}
    assert leg[("Constitution", "Ability Score")]["value"] == 15
    assert leg[("Positive Healing Amplification", "Healing Amplification")]["bonus_type"] == "Competence"


def test_built_dataset_carries_nearly_complete_pool():
    # U3: the real build wires the pool + coverage into the dataset.
    import build_dataset
    dataset = build_dataset.build(build_dataset.load_seed())
    assert "nearly_complete" in dataset
    assert len(dataset["nearly_complete"]) >= 60
    nc_cov = dataset["metadata"]["nc_coverage"]
    assert set(nc_cov["categories_sourced"]) == nearly_complete.CATEGORIES
    assert "pending" in nc_cov["item_hosts"]


def test_pass2_grafts_nc_and_lamordia_markers_onto_the_winner():
    # U1 (precedence-flip plan): the wiki-shard-only crafting markers survive the
    # gear-planner collision flip because Pass-2 grafts them from ANY loaded record
    # onto the winning body. Without the graft, a flip-only build strands them
    # (nearly_complete 70->0, lamordia 108->6). Guard the full host counts.
    import build_dataset
    items = build_dataset.build(build_dataset.load_seed())["items"]
    nc_hosts = sum(1 for it in items if it.get("nearly_complete"))
    lam_hosts = sum(1 for it in items if it.get("lamordia_slots"))
    assert nc_hosts == 70, f"Nearly-Complete host count changed: {nc_hosts}"
    assert lam_hosts == 108, f"Lamordia host count changed: {lam_hosts}"
    # grafted list values are independent copies (no shared ref across variants)
    lam_lists = [it["lamordia_slots"] for it in items if it.get("lamordia_slots")]
    assert len({id(x) for x in lam_lists}) == len(lam_lists), "lamordia_slots lists are shared by reference"
