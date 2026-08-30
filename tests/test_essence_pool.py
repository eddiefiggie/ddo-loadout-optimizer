"""#193 — the Essence Crafting option pool, and what it refuses to offer.

The Gem of Many Facets carries three Essence Crafting menus on one Trinket. An
option reaches the solver only when FOUR things are sourced, and each of these
tests is one of them failing:

  placement -> which menu (table 1b)
  bonus type -> which bucket it competes in (#193). Missing for 135 of 157.
  ML curve -> what it is worth at the host's level (#599). Missing for 37.
  catalog stat -> the name the solver already buckets under.

The pool is deliberately a MINORITY of the game's menu — 25 of 170 — and
`coverage` exists so the player is told that rather than shown a short list with
no explanation.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import essence_pool

DATASET = os.path.join(ROOT, "web", "data", "items.json")


def _dataset():
    with open(DATASET) as fh:
        return json.load(fh)


def _catalog():
    stats, units = set(), {}
    for it in _dataset()["items"]:
        for a in it.get("affixes") or []:
            n = a.get("name")
            if not n:
                continue
            stats.add(n)
            units.setdefault(n, set()).add("flat")
    return stats, units


def test_every_option_carries_a_sourced_bonus_type():
    """The dimension the whole harvest existed for. An option without it would
    either double-count against real gear or wrongly collapse with it."""
    with open(os.path.join(ROOT, "data", "seed", "compendium",
                           "essence_bonus_type.json")) as fh:
        harvested = json.load(fh)["harvested"]
    stats, units = _catalog()
    for rec in essence_pool.build_trinket_pool(stats, units)["records"]:
        entry = harvested.get(rec["effect"])
        assert entry and entry["provenance"] == "stated", \
            f"{rec['effect']} is offered without a stated bonus type"
        assert entry["value"]["bonus_type"] == rec["bonus_type"], \
            f"{rec['effect']}: pool says {rec['bonus_type']}, shard says {entry['value']['bonus_type']}"


def test_insightful_effects_contribute_to_the_base_stat_not_a_stat_of_their_own():
    """`Insightful Constitution` is Constitution in the Insight bucket. Treating
    the name as a stat would give it a private bucket that stacks with every
    Constitution item in the game."""
    stats, units = _catalog()
    for rec in essence_pool.build_trinket_pool(stats, units)["records"]:
        if rec["effect"].startswith("Insightful "):
            assert rec["stat"] == rec["effect"][len("Insightful "):], \
                f"{rec['effect']} contributes to {rec['stat']!r}"
            assert rec["bonus_type"] == "Insight", rec


def test_every_option_names_a_stat_the_catalog_already_uses():
    """A stat nothing else uses keys a bucket of its own, so the crafted effect
    would stack with everything — the double-count arriving through the front
    door."""
    stats, units = _catalog()
    for rec in essence_pool.build_trinket_pool(stats, units)["records"]:
        assert rec["stat"] in stats, f"{rec['effect']} -> {rec['stat']!r}, unknown to the catalog"


def test_an_unknown_stat_is_dropped_rather_than_offered():
    """Prove the catalog gate bites. With an empty catalog nothing may pass, and
    the builder must refuse rather than emit an unbucketable pool."""
    try:
        essence_pool.build_trinket_pool(catalog_stats=set(), catalog_units={})
    except essence_pool.PoolError:
        return
    raise AssertionError("an empty catalog produced options instead of refusing")


def test_insight_options_carry_the_wiki_minimum_level_and_others_do_not():
    """"Effects that grant insight bonuses can be applied to items ML 10 and
    higher only." The heroic Gem is ML 5, so this is the difference between
    offering it nine Insight options and offering it none."""
    stats, units = _catalog()
    for rec in essence_pool.build_trinket_pool(stats, units)["records"]:
        expected = essence_pool.INSIGHT_MIN_ML if rec["bonus_type"] == "Insight" else 1
        assert rec["min_ml"] == expected, f"{rec['effect']}: min_ml {rec['min_ml']}"


def test_every_curve_covers_all_thirty_six_minimum_levels():
    """The solver reads `values_by_ml[ml - 1]`. A short curve would index
    undefined and silently credit nothing, or credit the wrong level."""
    stats, units = _catalog()
    for rec in essence_pool.build_trinket_pool(stats, units)["records"]:
        assert len(rec["values_by_ml"]) == 36, f"{rec['effect']}: {len(rec['values_by_ml'])} values"


def test_natural_armor_is_excluded_and_says_why():
    """The one effect with all three shards behind it that is still refused. Its
    stat would have to be renamed onto `Armor Class`/`Natural` unsourced, on top
    of the bonus type's own weakest evidence shape. Two stacked judgement calls on
    one value is how a wrong number ships."""
    assert "Natural Armor" in essence_pool.EXCLUDED_EFFECTS
    reason = essence_pool.EXCLUDED_EFFECTS["Natural Armor"]
    assert "Armor Class" in reason and "unsourced" in reason
    stats, units = _catalog()
    pool = essence_pool.build_trinket_pool(stats, units)
    assert not [r for r in pool["records"] if r["effect"] == "Natural Armor"]


def test_the_coverage_report_says_how_much_of_the_menu_is_missing():
    """The disclosure's source. Offering 25 of 170 without saying so would read as
    the whole menu."""
    stats, units = _catalog()
    cov = essence_pool.build_trinket_pool(stats, units)["coverage"]
    assert cov["offered_all"] == 25, cov["offered_all"]
    assert cov["total_all"] == 170, cov["total_all"]
    assert cov["offered_all"] < cov["total_all"] / 2, \
        "coverage grew past half the menu — re-read the disclosure wording before trusting it"
    assert cov["skipped"]["no-bonus-type"], "the biggest gap must be named, not summarised away"


def test_only_verified_hosts_get_live_menus():
    """`Trinket [Crafted]` declares the same three menus, is quarantined, and
    carries a placeholder ML 1. Crafting real numbers onto a record we do not
    trust is how an unverified item becomes a recommendation."""
    labels = ["Essence Crafting: Trinket - Prefix"]
    assert essence_pool.essence_slots(labels, "verified") == [{"menu": "Prefix"}]
    assert essence_pool.essence_slots(labels, "quarantined") == []
    assert essence_pool.essence_slots(labels, "indexed") == []


def test_the_built_dataset_gives_the_gem_its_three_menus_and_nothing_else_any():
    """End of the pipeline. Three verified Gem tiers, three menus each, and no
    other item in the catalog carrying a live Essence slot."""
    hosts = {it["source_item"]: it for it in _dataset()["items"] if it.get("essence_slots")}
    assert set(hosts) == {"Gem of Many Facets [Crafted]",
                          "Epic Gem of Many Facets [Crafted]",
                          "Legendary Gem of Many Facets [Crafted]"}, sorted(hosts)
    for name, it in hosts.items():
        assert [s["menu"] for s in it["essence_slots"]] == ["Prefix", "Suffix", "Extra"], name


def test_the_heroic_gem_can_reach_no_insight_option():
    """ML 5 against a minimum of 10. Its Extra menu is empty in game, and the
    notice says so rather than letting it read as missing data."""
    ds = _dataset()
    heroic = next(it for it in ds["items"] if it["source_item"] == "Gem of Many Facets [Crafted]")
    assert heroic["ml"] < essence_pool.INSIGHT_MIN_ML
    reachable = [o for o in ds["essence_crafting"] if heroic["ml"] >= o["min_ml"]]
    assert reachable, "the heroic Gem must still reach the non-Insight options"
    assert not [o for o in reachable if o["bonus_type"] == "Insight"]


# --- the ML premise (2026-08-30) -----------------------------------------------

def test_every_ml_curve_is_monotonic_and_peaks_at_the_top():
    """The whole reason reading the host's `ml` is correct.

    The crafted minimum level is the CRAFTER's choice — "This shard determines the
    minimum level of the item, the power level of scaling effect shards crafted
    onto the item" — so the solver ought to be choosing an ML, not reading one. It
    gets away with reading the host's because crafting at the highest available
    level is always optimal, and that is only true while every curve rises.

    The moment one option peaks mid-range, "take the top" stops being optimal and
    the solver has to search the ML instead. This fails then, rather than quietly
    crediting a value below the best one.
    """
    stats, units = _catalog()
    records = essence_pool.build_trinket_pool(stats, units)["records"]
    assert len(records) > 20, "the pool is too small for this to be measuring anything"
    for rec in records:
        vals = [float(str(v).strip().rstrip("%")) for v in rec["values_by_ml"]]
        drops = [(i + 1, a, b) for i, (a, b) in enumerate(zip(vals, vals[1:])) if b < a]
        assert not drops, (
            f"{rec['effect']} ({rec['menu']}) falls at ML {drops[0][0]}: "
            f"{drops[0][1]} -> {drops[0][2]}. Crafting at the highest ML is no longer "
            "always optimal, so the solver can no longer read the host's ml and take "
            "the top — it has to choose an ML. See docs/wiki-evidence/essence-crafting.md.")
        assert vals[-1] == max(vals), f"{rec['effect']}: peak is not at ML 36"


def test_the_two_ml_ten_gates_are_kept_apart():
    """`INSIGHT_MIN_ML` gates the EFFECT; `EXTRA_SLOT_MIN_ML` gates the SLOT. Two
    sentences, two rules, and they coincide today only because every Extra effect
    offered happens to be Insight-typed. Folding them into one constant would let a
    non-Insight Extra effect arrive later and skip the slot rule silently."""
    assert essence_pool.INSIGHT_MIN_ML == essence_pool.EXTRA_SLOT_MIN_ML == 10
    stats, units = _catalog()
    extra = [r for r in essence_pool.build_trinket_pool(stats, units)["records"]
             if r["menu"] == "Extra"]
    assert extra, "no Extra options at all — the coincidence below is untested"
    non_insight = [r["effect"] for r in extra if r["bonus_type"] != "Insight"]
    assert not non_insight, (
        f"an Extra effect is not Insight-typed: {non_insight}. The two ML-10 rules no "
        "longer coincide, so the SLOT gate has to be applied in its own right — the "
        "solver currently only enforces the effect gate via `min_ml`.")


def test_the_shard_ceiling_is_recorded_as_a_player_observation():
    """The ceiling — a named item cannot be crafted above its own ML — is the one
    input here that is NOT from the wiki. It has to stay labelled as such, or a
    later reader will treat it as sourced and build on it."""
    doc = os.path.join(ROOT, "docs", "wiki-evidence", "essence-crafting.md")
    with open(doc) as fh:
        text = fh.read()
    assert "The ceiling is NOT wiki-sourced" in text
    assert "player observation" in text.lower()
    assert "Mysterious Ring" in text, "the nearest contrary signal must stay recorded"
    assert str(essence_pool.MAX_SHARD_ML) in text or "ML 1 through 36" in text
