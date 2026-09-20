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
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

SHARD_PATH = os.path.join(ROOT, "data", "seed", "compendium", "essence_bonus_type.json")
PLACEMENTS_PATH = os.path.join(ROOT, "data", "seed", "compendium", "essence_crafting.json")
EVIDENCE_PATH = os.path.join(ROOT, "docs", "wiki-evidence", "essence-crafting-bonus-types.md")
TOOLTIP_PATH = os.path.join(ROOT, "data", "seed", "compendium", "affix_tooltip.json")

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


def _tooltips():
    with open(TOOLTIP_PATH) as fh:
        return json.load(fh)["harvested"]


def _catalog_types_in(text):
    """The bonus types a tooltip NAMES, in order, restricted to buckets the catalog
    knows. Restricting to `CATALOG_TYPES` is deliberate: a tooltip reading "a bonus
    to your attack rolls" names no type at all, and a word the catalog does not
    bucket on could not be used as one anyway. Both are absences, not findings."""
    lower = {t.lower(): t for t in CATALOG_TYPES}
    out = []
    for m in re.finditer(r"\b([A-Za-z]+(?:\s+[A-Za-z]+)?)\s+bonus\b", text or "", re.I):
        phrase = m.group(1).strip().lower()
        for candidate in (phrase, phrase.split()[-1]):
            if candidate in lower:
                out.append(lower[candidate])
                break
    return list(dict.fromkeys(out))


def _tooltip_vs_crafted():
    """Every effect with BOTH a wiki-stated crafted type and a tooltip naming a
    catalog type, split by whether the two agree. Computed, never listed."""
    tips, agree, disagree = _tooltips(), [], []
    for name, rec in _shard()["harvested"].items():
        if rec.get("provenance") != "stated":
            continue
        named = _catalog_types_in((tips.get(name) or {}).get("tooltip"))
        if not named:
            continue
        (agree if rec["value"]["bonus_type"] in named else disagree).append(name)
    return sorted(agree), sorted(disagree)


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
    assert stated == 23, stated
    with open(EVIDENCE_PATH) as fh:
        text = fh.read()
    assert "23 of 157" in text, "the evidence doc's coverage claim must match the shard"


def test_a_carrier_tooltip_is_not_admissible_for_a_crafted_type():
    """#764 — 39 of the untyped effects have a tooltip in `affix_tooltip.json`, which
    looks like 39 free types. Tested where the answer is already known: of the 22
    effects with a wiki-stated CRAFTED type, the ones that ALSO carry a tooltip
    would all agree if a carrier's tooltip were admissible.

    Three do not, and each is a different shape of the same mistake — a tooltip
    states its CARRIER's type, which is not the type Essence Crafting grants.

    Recomputed from both shards on every run rather than dated, so a re-harvest
    that changes any of it fails here instead of quietly restoring the shortcut.
    """
    agree, disagree = _tooltip_vs_crafted()
    overlap = len(agree) + len(disagree)

    # Refuse to inspect zero records: an empty overlap proves nothing and would
    # otherwise read as "no disagreement found".
    assert overlap >= 10, (
        f"only {overlap} effects carry both a stated crafted type and a tooltip naming a "
        "catalog type — too few to test admissibility on. Check the extractor before "
        "reading this as a clean result.")

    assert disagree == ["Constitution", "Healing Amplification", "Seeker"], (
        f"the carrier-tooltip disagreements changed: {disagree}. Re-read the #764 section "
        "of the evidence doc before touching it — the whole inadmissibility finding rests "
        "on this set.")

    tips = _tooltips()
    # `Constitution` and `Seeker` are engraved under a VARIANT label, so the tooltip
    # is not even about the same affix.
    assert tips["Constitution"]["label"] == "Quality Constitution +1"
    assert tips["Seeker"]["label"] == "Exceptional Seeker +5"

    # `Healing Amplification` is the load-bearing one: an EXACT label match that
    # still names a different bucket. It is what forbids the obvious rescue of
    # trusting a tooltip whose label equals the effect name.
    heal = tips["Healing Amplification"]
    assert heal["label"] == "Healing Amplification", (
        "the exact-label counter-example lost its exact label — without it, 'only trust "
        "a label-matched tooltip' becomes arguable again")
    assert _catalog_types_in(heal["tooltip"]) == ["Exceptional"]
    assert _shard()["harvested"]["Healing Amplification"]["value"]["bonus_type"] == "Competence"

    # The doc states these counts; both sides are readable, so assert rather than date.
    with open(EVIDENCE_PATH) as fh:
        text = fh.read()
    assert f"agrees on {len(agree)} and **contradicts on {len(disagree)}**" in text, (
        f"the evidence doc's admissibility count must match the shards: {len(agree)} agree, "
        f"{len(disagree)} contradict")


def test_the_effects_with_a_carrier_tooltip_stayed_unsourced():
    """The shortcut, specifically not taken. Every effect this harvest could not type
    but which HAS a carrier tooltip must still be `unsourced` — typing it from the
    tooltip is the inference the test above forbids, and it would be invisible
    afterwards because a wrong type looks exactly like a right one."""
    tips, shard = _tooltips(), _shard()["harvested"]
    typed_from_a_tooltip = []
    for name, rec in shard.items():
        if rec.get("provenance") != "stated":
            continue
        raw = (rec.get("raw") or "")
        tip = (tips.get(name) or {}).get("tooltip")
        # A record whose evidence is the tooltip text, or whose join names a carrier
        # item, is typed from the wrong source.
        if tip and raw.strip() and raw.strip() in tip:
            typed_from_a_tooltip.append(name)
    assert not typed_from_a_tooltip, (
        f"typed from a carrier tooltip rather than a statement about crafting: "
        f"{typed_from_a_tooltip}")

    # And the population that shortcut would have raided is still refused.
    untyped_with_a_tooltip = sorted(
        n for n in _roster()
        if n in tips and tips[n].get("tooltip")
        and shard.get(n, {}).get("provenance") != "stated")
    assert len(untyped_with_a_tooltip) >= 30, (
        f"only {len(untyped_with_a_tooltip)} untyped effects carry a tooltip — this guard "
        "is meant to watch a population of ~39; re-read #764 if it has collapsed")


def test_the_shard_covers_the_whole_roster():
    """#764 — every craftable effect has been SEARCHED, and the shard says so.

    A completeness claim needs a guard rather than a date (AGENTS.md). "The roster
    has been fully searched" is a claim about a population readable at build time,
    so it is asserted: an effect with no entry is one nobody has looked up, and it
    is indistinguishable — from the coverage numbers alone — from one that was
    looked up and found silent. Those are different facts and the shard must
    separate them.

    Before this, 59 of the 157 had no entry at all. They were searched in one pass
    on 2026-09-18 and none could be typed; each now carries an `unsourced` record
    naming what was read. The next effect the wiki adds to a placement table will
    fail here rather than sit unexamined."""
    roster = _roster()
    shard = _shard()["harvested"]
    unsearched = sorted(roster - set(shard))
    assert not unsearched, (
        f"{len(unsearched)} craftable effect(s) have no bonus-type entry, so nothing "
        f"records whether the wiki was ever asked: {unsearched[:12]}")


def test_an_unsourced_entry_still_says_what_was_read():
    """An `unsourced` record whose `raw` is empty is worse than no record: it claims
    a search happened and shows nothing for it. Every one must name what it saw —
    a page that does not exist, a page that is silent, or a mention carrying no
    type — so a later reader can judge the search rather than repeat it."""
    thin = []
    for name, rec in _shard()["harvested"].items():
        if rec.get("provenance") != "unsourced":
            continue
        raw = (rec.get("raw") or "").strip()
        if not raw or not rec.get("harvested"):
            thin.append(name)
    assert not thin, f"unsourced entries that record no reading and no date: {thin}"


def test_the_roster_is_not_vacuously_covered():
    """Refuse to pass over an empty population: an empty roster or an empty shard
    would make both guards above succeed while asserting nothing."""
    assert len(_roster()) >= 150, f"roster collapsed to {len(_roster())}"
    assert len(_shard()["harvested"]) >= 150, "shard collapsed"
