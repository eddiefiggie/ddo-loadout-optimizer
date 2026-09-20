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


# --- #823 — the tier boundary is a claim, so it is asserted ------------------

def _host(ml, name, **kw):
    rec = {"ml": ml, "variant_id": name, "nearly_complete": "Ability Score"}
    rec.update(kw)
    return rec


def _real_roster():
    """Two hosts on each pole, named the way the real roster names them."""
    return [_host(11, "Band of the Imprisoned One"),
            _host(11, "Astral Spore Pendant"),
            _host(35, "Legendary Band of the Imprisoned One"),
            _host(35, "Legendary Astral Spore Pendant")]


def test_823_the_two_ml_constants_are_the_documented_recipe_tiers():
    assert nearly_complete.NC_HEROIC_ML == 11
    assert nearly_complete.NC_LEGENDARY_ML == 35


def test_823_the_js_copy_of_the_boundary_matches_the_python_one():
    """A boundary that drifts between the pipeline and the solver mis-tiers
    silently, so the two copies are pinned to each other rather than each to a
    literal. Read out of model.js's source: it is a browser script, and this
    suite has no JS runtime."""
    src = open(os.path.join(ROOT, "web", "model.js"), encoding="utf-8").read()
    for name, expected in (("NC_HEROIC_ML", nearly_complete.NC_HEROIC_ML),
                           ("NC_LEGENDARY_ML", nearly_complete.NC_LEGENDARY_ML)):
        line = f"const {name} = {expected};"
        assert line in src, f"web/model.js must carry `{line}` (python says {expected})"


def test_823_the_solver_derives_nc_tier_rather_than_re_inlining_the_threshold():
    """The defect this guards is not the number being wrong — it is the number
    being COPIED. `lamordiaTier` states the rule one channel over; this asserts
    the Nearly Complete path actually follows it."""
    solver = open(os.path.join(ROOT, "web", "solver.js"), encoding="utf-8").read()
    assert "const tier = _ncTier(xv.variant);" in solver
    assert '(xv.variant.ml || 0) >= 35' not in solver, (
        "solver.js re-inlined the Nearly Complete boundary again")


def test_823_a_clean_roster_passes_and_reports_both_poles():
    out = nearly_complete.assert_tier_boundary_is_real(_real_roster())
    assert out == {"hosts": 4, "heroic": 2, "legendary": 2,
                   "boundary_ml": 35, "explicit_nc_tier": 0}


def test_823_a_host_stranded_between_the_poles_fails():
    """The Viktranium failure shape: a legendary host below the boundary, tiered
    heroic by `>=` alone and handed the heroic magnitude in silence."""
    roster = _real_roster() + [_host(34, "Legendary Lamordian Bowler")]
    try:
        nearly_complete.assert_tier_boundary_is_real(roster)
    except SystemExit as e:
        assert "neither recipe tier" in str(e) and "34" in str(e)
        assert "Legendary Lamordian Bowler" in str(e)
    else:
        raise AssertionError("a stranded host must fail the build")


def test_823_a_name_that_contradicts_the_derived_tier_fails():
    """Two independent signals; when they disagree the build stops rather than
    picking the one that happens to be cheaper to read."""
    roster = _real_roster() + [_host(11, "Legendary Chamber Boots")]
    try:
        nearly_complete.assert_tier_boundary_is_real(roster)
    except SystemExit as e:
        assert "name and ML-derived tier disagree" in str(e)
    else:
        raise AssertionError("a name/ML disagreement must fail the build")


def test_823_an_explicit_nc_tier_wakes_the_dead_branch_and_fails():
    """`nc_tier || <derive>` has a left branch that is null on all 140 hosts. If
    upstream populates it, somebody must decide whether it overrides or must
    agree — this refuses to let that decision happen by default."""
    roster = _real_roster() + [_host(35, "Legendary Balorskin Gauntlets",
                                     nc_tier="heroic")]
    try:
        nearly_complete.assert_tier_boundary_is_real(roster)
    except SystemExit as e:
        assert "explicit `nc_tier`" in str(e)
        assert "Legendary Balorskin Gauntlets" in str(e)
    else:
        raise AssertionError("an explicit nc_tier must fail the build")


def test_823_the_host_guard_refuses_to_inspect_zero_hosts():
    for empty in ([], [{"ml": 35, "variant_id": "Legendary Thing"}]):
        try:
            nearly_complete.assert_tier_boundary_is_real(empty)
        except SystemExit as e:
            assert "pass vacuously" in str(e)
        else:
            raise AssertionError("zero hosts must not read as success")


def test_823_the_option_guard_refuses_to_inspect_zero_options():
    try:
        nearly_complete.assert_option_mls_are_the_two_recipe_tiers({})
    except SystemExit as e:
        assert "pass vacuously" in str(e)
    else:
        raise AssertionError("an empty pool must not read as success")


def test_823_an_option_off_the_two_recipe_mls_fails():
    cat = {nearly_complete._NATIVE_NC_KEY["Ability Score"]: {
        "*": [{"ml": 11, "affixes": []}, {"ml": 20, "affixes": []}]}}
    try:
        nearly_complete.assert_option_mls_are_the_two_recipe_tiers(cat)
    except SystemExit as e:
        assert "neither recipe tier" in str(e) and "20" in str(e)
    else:
        raise AssertionError("an off-tier option must fail the build")


def test_823_the_real_option_pool_sits_on_the_two_recipe_mls():
    from src import crafting_catalog
    walked = nearly_complete.assert_option_mls_are_the_two_recipe_tiers(
        crafting_catalog.load_catalog())
    assert walked > 0
