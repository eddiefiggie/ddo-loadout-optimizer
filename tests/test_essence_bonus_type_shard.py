"""#193 — the bonus-type harvest, and the guards that keep its claims honest.

`essence_crafting.json` holds every Essence Crafting PLACEMENT and every ML
CURVE. The solver needs a third thing it did not have: the BONUS TYPE, because
every contribution buckets as `(stat, bonus_type)` and a wrong type either
double-counts against real gear or wrongly collapses with it.

The 2026-08-27 ruling said no reachable source records the type. That was too
strong. Several effect pages group their sources under `=== <Type> bonus ===`
SECTION HEADINGS, so the type sits in the heading ABOVE the crafting line — a
proximity search cannot see it, and the original sampling was a proximity
search. A section-aware read of all 157 effect pages found 22 stated types.

These tests pin what that harvest may and may not claim. The load-bearing one is
`test_no_effect_is_typed_by_its_own_name`: `Insightful X` looks like a free win
and is not one, because the Seeker page names `Insightful Seeker` while assigning
Insight to the FORMER `Exceptional Seeker` instead.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

SHARD_PATH = os.path.join(ROOT, "data", "seed", "compendium", "essence_bonus_type.json")
PLACEMENTS_PATH = os.path.join(ROOT, "data", "seed", "compendium", "essence_crafting.json")
EVIDENCE_PATH = os.path.join(ROOT, "docs", "wiki-evidence", "essence-crafting-bonus-types.md")

# The bucket vocabulary the built dataset actually uses. A harvested type outside
# this set would key a bucket nothing else lands in, which silently makes the
# crafted effect stack with everything — the exact double-count the blocker warns
# about, arriving through the front door.
CATALOG_TYPES = {
    "Enhancement", "Equipment", "Insight", "Quality", "Competence", "Profane",
    "Resistance", "Armor", "Untyped", "Implement", "Exceptional", "Shield",
    "Artifact", "Deflection", "Natural", "Vitality", "Sacred", "Orb",
    "Legendary", "Luck", "Primal Natural", "Sneak Attack", "Festive",
    "Insight Natural", "Profane Natural", "Determination",
}


def _shard():
    with open(SHARD_PATH) as fh:
        return json.load(fh)


def _roster():
    with open(PLACEMENTS_PATH) as fh:
        placements = json.load(fh)["placements"]
    return {e for menus in placements.values() for eff in menus.values() for e in eff}


def test_every_harvested_name_is_a_real_craftable_effect():
    """The shard joins to the placement table by effect name. A name that is not
    in the roster joins to nothing and would be invisible dead data."""
    stray = sorted(set(_shard()["harvested"]) - _roster())
    assert not stray, f"harvested names that are not craftable effects: {stray}"


def test_only_stated_records_carry_a_bonus_type():
    """`stated` is the only solver-eligible provenance. An `unsourced` record
    carrying a type would be an inferred game value wearing a disclosure."""
    for name, rec in _shard()["harvested"].items():
        value = rec.get("value")
        if rec["provenance"] == "stated":
            assert value and value.get("bonus_type"), f"{name}: stated with no type"
        else:
            assert not value, f"{name}: provenance {rec['provenance']!r} but carries {value!r}"


def test_every_stated_type_is_one_the_catalog_buckets_on():
    """A type outside the catalog's vocabulary keys a bucket of its own, so the
    crafted effect would stack with every real item instead of competing."""
    for name, rec in _shard()["harvested"].items():
        if rec["provenance"] != "stated":
            continue
        bt = rec["value"]["bonus_type"]
        assert bt in CATALOG_TYPES, f"{name}: {bt!r} is not a bucket the catalog uses"


def test_every_stated_record_carries_its_evidence_and_how_it_was_joined():
    """A type without the sentence that sourced it cannot be re-checked, and the
    JOIN SHAPE is the reviewable part — `page-subject` and `named-variant` are
    weaker than `same-line` and a reader must be able to tell which they have."""
    shapes = {"same-line", "section-heading", "page-subject", "named-variant"}
    for name, rec in _shard()["harvested"].items():
        if rec["provenance"] != "stated":
            continue
        assert len(rec.get("raw") or "") > 30, f"{name}: no quoted evidence"
        join = rec["value"].get("join")
        assert join in shapes, f"{name}: join {join!r} is not a known shape"


def test_no_effect_is_typed_by_its_own_name():
    """THE rule this harvest turns on. 38 roster entries are `Insightful X`, and
    assuming they grant Insight would type them for free — which is inferring 38
    game values. `Insightful Seeker` is why it is forbidden: the Seeker page names
    it and then assigns Insight to the FORMER `Exceptional Seeker`, not to it.

    So every `Insightful X` typed as Insight must be sourced from a sentence that
    says so, and this asserts the counter-example specifically stayed unsourced.
    """
    harvested = _shard()["harvested"]
    seeker = harvested.get("Insightful Seeker")
    assert seeker is not None, "Insightful Seeker must be recorded, as the worked counter-example"
    assert seeker["provenance"] == "unsourced", (
        "Insightful Seeker was typed. The Seeker page names it but types the FORMER "
        "'Exceptional Seeker' as Insight instead — this is a name-inference, not a source.")
    assert "Exceptional" in seeker["raw"], "the counter-example must keep the sentence that earns it"

    for name, rec in harvested.items():
        if not name.startswith("Insightful ") or rec["provenance"] != "stated":
            continue
        assert "insight" in (rec.get("raw") or "").lower(), (
            f"{name} is typed Insight but its evidence never says so — that is its name, not a source.")


def test_the_roster_is_the_whole_system_not_just_what_was_harvested():
    """A coverage denominator that shrinks to fit the numerator always reports
    100%. The roster is all 157 effects across all 16 slots, and the shard is
    honestly a minority of it."""
    from scripts import merge_harvest
    assert len(merge_harvest.roster("essence_bonus_type")) == 157
    assert len(merge_harvest.roster("essence_bonus_type", "Trinkets")) == 134
    harvested = _shard()["harvested"]
    stated = [n for n, r in harvested.items() if r["provenance"] == "stated"]
    assert len(stated) < len(_roster()) / 2, (
        "the harvest now covers most of the system — re-read the evidence doc's "
        "coverage claim before trusting it, it was written at 22 of 157")


def test_the_shard_declares_that_it_is_not_wired():
    """Same discipline as the placement shard: consuming this requires deleting
    an assertion, so it cannot happen by accident."""
    meta = _shard()["_meta"]
    assert "NOT YET WIRED" in meta["status"]
    assert "bucket" in meta["note"].lower() or "bonus_type" in meta["note"]
    assert "supersedes" in meta, "the shard must say what earlier ruling it corrects"


def test_the_evidence_document_and_the_shard_agree_on_the_count():
    """A count is a claim about a population. Both sides are readable, so assert
    it rather than dating it."""
    stated = sum(1 for r in _shard()["harvested"].values() if r["provenance"] == "stated")
    assert stated == 22, stated
    with open(EVIDENCE_PATH) as fh:
        text = fh.read()
    assert "22 of 157" in text, "the evidence doc's coverage claim must match the shard"
