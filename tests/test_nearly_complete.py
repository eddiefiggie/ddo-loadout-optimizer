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



def test_built_dataset_carries_nearly_complete_pool():
    # U3: the real build wires the pool + coverage into the dataset.
    import build_dataset
    dataset = build_dataset.build()
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
    items = build_dataset.build()["items"]
    nc_hosts = sum(1 for it in items if it.get("nearly_complete"))
    lam_hosts = sum(1 for it in items if it.get("lamordia_slots"))
    # Floors, not exact counts: the regression to catch is the flip STRANDING these
    # markers (nc 70->0, lamordia 108->6 without the graft). A floor well above the
    # stranded residual guards that without breaking on a legitimate catalog refresh.
    assert nc_hosts >= 60, f"Nearly-Complete hosts stranded by the flip: {nc_hosts}"
    assert lam_hosts >= 100, f"Lamordia hosts stranded by the flip: {lam_hosts}"
    # grafted list values are independent copies (no shared ref across variants)
    lam_lists = [it["lamordia_slots"] for it in items if it.get("lamordia_slots")]
    assert len({id(x) for x in lam_lists}) == len(lam_lists), "lamordia_slots lists are shared by reference"


# --- #371: the per-item host set the planner gate reads ------------------------

def test_per_item_hosts_reports_the_hosts_each_pool_really_covers():
    """`per_item_hosts` is the gate `src/planner_items.py` marks hosts from, so it
    must read the SAME pools `build_nearly_complete` reads. 43 `Nearly Finished`
    hosts and 2 `Almost There` — the measured upstream coverage."""
    hosts = nearly_complete.per_item_hosts()

    assert set(hosts) == {"Nearly Finished", "Almost There"}
    assert len(hosts["Nearly Finished"]) == 43
    assert hosts["Almost There"] == {"Collective Sight", "Legendary Collective Sight"}
    assert "Legendary Alchemist's Crown" in hosts["Nearly Finished"]
    # It cannot drift from the pool the builder emits.
    built = nearly_complete.build_nearly_complete()["per_item"]
    assert set(built) == hosts["Nearly Finished"] | hosts["Almost There"]


def test_a_host_whose_options_carry_no_affix_is_not_covered():
    """An empty option list would mark a slot and then offer nothing to put in
    it — the inert slot the marker exists to prevent, re-created by the gate
    itself. Coverage means options WITH affixes."""
    catalog = {"Nearly Finished": {"Hollow Crown": [{"affixes": []}, {}],
                                   "Real Crown": [{"affixes": [
                                       {"name": "Wisdom", "type": "Quality", "value": 3}]}]},
               "Almost There": {}}

    hosts = nearly_complete.per_item_hosts(catalog)

    assert hosts["Nearly Finished"] == {"Real Crown"}
    assert hosts["Almost There"] == set()


def test_the_insight_cap_across_both_per_item_pools_is_six():
    """#371's contested value. The reporter expected Insightful +7 at ML<=33; the
    pools cap Insight at +6 for every ability, and the wiki agrees (Legendary
    Alchemist's Crown reads Wisdom +13 / Insightful Wisdom +6 / Quality Wisdom
    +3). Recorded so the +7 is not manufactured on a later pass — see
    docs/wiki-evidence/nearly-finished.md."""
    abilities = {"Strength", "Dexterity", "Constitution",
                 "Intelligence", "Wisdom", "Charisma"}
    per_item = nearly_complete.build_nearly_complete()["per_item"]

    caps = {}
    for recs in per_item.values():
        for r in recs:
            if r["stat"] in abilities:
                caps[r["bonus_type"]] = max(caps.get(r["bonus_type"], 0), r["value"])

    assert caps == {"Enhancement": 14, "Insight": 6, "Quality": 3}, caps
    assert per_item["Legendary Alchemist's Crown"] == [
        {"stat": "Wisdom", "bonus_type": "Enhancement", "value": 13, "unit": "flat",
         "pool": "Nearly Finished"},
        {"stat": "Wisdom", "bonus_type": "Insight", "value": 6, "unit": "flat",
         "pool": "Nearly Finished"},
        {"stat": "Wisdom", "bonus_type": "Quality", "value": 3, "unit": "flat",
         "pool": "Nearly Finished"},
    ]
