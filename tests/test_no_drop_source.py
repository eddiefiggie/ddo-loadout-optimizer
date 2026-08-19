"""#262 — the wiki-confirmed "no known live drop source" flag and its guards.

The shard may only carry claims the wiki settled, and every claim must be able
to go stale LOUDLY: these tests prove the closed-vocabulary, anti-orphan,
evidence-completeness, and staleness guards each fire, that the empty seed is
FULLY inert (AE2 — no per-variant flags AND no coverage metadata block), and
that the shipped 2-entry shard passes the whole guard set against the real
roster and flags exactly the seeded items in the built dataset.
"""
import json
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import no_drop_source  # noqa: E402
from src import planner_items  # noqa: E402

SHARD = os.path.join(ROOT, "data", "seed", "compendium", "no_drop_source.json")

# The two wiki-confirmed items the shipped shard seeds (heroic and legendary
# tiers are DISTINCT wiki pages, so each carries its own entry + URL).
BRACERS_HEROIC = "Bracers of the Spider Queen"
BRACERS_LEGENDARY = "Legendary Bracers of the Spider Queen"


def _retired_2026_08_18():
    """The #374/U4 retirement block: `{item name: recorded evidence}`."""
    with open(SHARD, encoding="utf-8") as fh:
        doc = json.load(fh)
    return (doc.get("_retired") or {}).get(
        "2026-08-18-gear-planner-refresh", {}).get("entries") or {}



def _raises(exc, fn, *args, **kwargs):
    try:
        fn(*args, **kwargs)
    except exc as e:
        return e
    raise AssertionError(f"expected {exc.__name__}, nothing raised")


def _rec(name, quests=()):
    """A minimal planner record: the staleness guard keys off the raw `quests`
    list (KTD8 — the list, not the derived location_quest string)."""
    return {"name": name, "quests": list(quests)}


def _entry(name=BRACERS_LEGENDARY, verdict=no_drop_source.CONFIRMED, **over):
    e = {
        "verdict": verdict,
        "provenance": "stated",
        "evidence": "Location section empty — no quest, no chest listed",
        "wiki_url": "https://ddowiki.com/page/Item:Legendary_Bracers_of_the_Spider_Queen",
        "harvested": "2026-08-12",
    }
    e.update(over)
    return {name: e}


def _variant(source_item, location_quest="", category="item", **over):
    v = {"source_item": source_item, "variant_id": source_item,
         "category": category, "location_quest": location_quest}
    v.update(over)
    return v


# --- the loader --------------------------------------------------------------

def test_an_absent_shard_file_loads_inert():
    """Labeled deliberate no-op (KTD4 divergence from ml36's refuse-empty):
    disclosure is fail-safe-absent, so no shard means no flags, not a failure."""
    assert no_drop_source.load(os.path.join(ROOT, "no", "such", "shard.json")) == {}


def test_an_empty_harvested_map_loads_inert():
    """Labeled deliberate no-op — the exclude-until-verified empty-seed exception."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump({"_meta": {"note": "empty fixture"}, "harvested": {}}, fh)
        path = fh.name
    try:
        assert no_drop_source.load(path) == {}
    finally:
        os.unlink(path)


def test_check_no_ops_on_an_empty_seed():
    """Labeled deliberate no-op guard: with zero entries there is nothing to
    vouch for and nothing to flag — check() must not raise and must report
    having inspected nothing."""
    result = no_drop_source.check({}, [_rec("Anything", quests=["Some Quest"])])
    assert result["checked"] == 0
    assert result["confirmed"] == [] and result["wiki_has_source"] == []


# --- the guards (proven by corruption: value and its evidence together) ------

def test_a_clean_confirmed_entry_passes_keyed_by_item_name():
    result = no_drop_source.check(_entry(), [_rec(BRACERS_LEGENDARY)])
    assert result["confirmed"] == [BRACERS_LEGENDARY]
    assert result["checked"] == 1


def test_a_wiki_has_source_entry_passes_and_is_reported_separately():
    entries = _entry(name="Some Event Item", verdict=no_drop_source.WIKI_HAS_SOURCE)
    result = no_drop_source.check(entries, [_rec("Some Event Item")])
    assert result["wiki_has_source"] == ["Some Event Item"]
    assert result["confirmed"] == []


def test_an_unknown_verdict_fails_naming_the_entry():
    """The vocabulary is CLOSED: unverified / page_missing items are never
    written to the shard (they live in the docs tracker only), so any verdict
    outside the two classes is a corrupt entry, not a third state."""
    for bad in ("unverified", "page_missing", "confirmed", ""):
        entries = _entry(verdict=bad)
        err = _raises(SystemExit, no_drop_source.check,
                      entries, [_rec(BRACERS_LEGENDARY)])
        assert BRACERS_LEGENDARY in str(err) and "verdict" in str(err), (bad, err)


def test_a_roster_absent_entry_fails_the_build():
    """The anti-orphan guard (the assert_all_reached pattern): an entry naming
    no roster item means the item was renamed or dropped upstream — the quiet
    staleness this shard family exists to prevent."""
    err = _raises(SystemExit, no_drop_source.check,
                  _entry(name="Bracers of the Renamed Queen"),
                  [_rec(BRACERS_LEGENDARY)])
    assert "Bracers of the Renamed Queen" in str(err)


def test_a_confirmed_entry_missing_its_evidence_fails():
    """A confirmed_no_source claim rests on its snapshot + URL + date; corrupt
    each one away and the guard must go red naming the missing field."""
    for field in ("evidence", "wiki_url", "harvested"):
        entries = _entry(**{field: ""})
        err = _raises(SystemExit, no_drop_source.check,
                      entries, [_rec(BRACERS_LEGENDARY)])
        assert BRACERS_LEGENDARY in str(err) and field in str(err), (field, err)


def test_staleness_a_nonempty_upstream_quests_array_fails_naming_the_entry():
    """AE4 / R9: the wiki/gear-planner now records a source — un-flagging is a
    deliberate review event, never automatic. Keys off the raw `quests` list on
    the PLANNER record, not the derived location_quest string."""
    err = _raises(SystemExit, no_drop_source.check, _entry(),
                  [_rec(BRACERS_LEGENDARY, quests=["Reclaiming the Rift"])])
    assert BRACERS_LEGENDARY in str(err)
    assert "Reclaiming the Rift" in str(err)


def test_staleness_fires_for_wiki_has_source_entries_too():
    """A wiki_has_source entry whose item's upstream quests filled in means the
    backfill landed — the entry has left the triage universe and retiring it is
    a review event, not a silent pass."""
    entries = _entry(name="Some Event Item", verdict=no_drop_source.WIKI_HAS_SOURCE)
    err = _raises(SystemExit, no_drop_source.check, entries,
                  [_rec("Some Event Item", quests=["New Quest"])])
    assert "Some Event Item" in str(err)


# --- stamping (only-when-set) ------------------------------------------------

def test_stamp_sets_true_on_confirmed_variants_and_nothing_anywhere_else():
    """ONLY-WHEN-SET (the QUARANTINE_FIELD precedent / 353KB null-stamping
    lesson): a flagged variant carries `no_drop_source: True`; every other
    variant carries NO key at all — never False, never null."""
    variants = [_variant(BRACERS_LEGENDARY),
                _variant("Ordinary Boots", location_quest="Some Quest")]
    n = no_drop_source.stamp(variants, _entry())
    assert n == 1
    assert variants[0].get(no_drop_source.FIELD) is True
    assert no_drop_source.FIELD not in variants[1]


def test_a_wiki_has_source_entry_stamps_nothing():
    variants = [_variant("Some Event Item")]
    entries = _entry(name="Some Event Item", verdict=no_drop_source.WIKI_HAS_SOURCE)
    assert no_drop_source.stamp(variants, entries) == 0
    assert no_drop_source.FIELD not in variants[0]


def test_stamp_refuses_a_broken_join():
    """Confirmed entries that reach zero variants mean the join key moved —
    a zero-stamped pass with entries present must be impossible."""
    _raises(SystemExit, no_drop_source.stamp,
            [_variant("Ordinary Boots", location_quest="Some Quest")], _entry())


def test_stamp_refuses_a_partial_join_miss_naming_the_missing_entry():
    """Review finding #3 — the guard is PER-ENTRY, not aggregate: with two
    confirmed entries and variants matching only one, the pass must fail
    naming the unmatched name (an 18-of-19 join miss silently un-discloses
    one item while coverage still counts it)."""
    entries = {
        "Matched Item": {"verdict": no_drop_source.CONFIRMED},
        "Vanished Item": {"verdict": no_drop_source.CONFIRMED},
    }
    variants = [_variant("Matched Item")]
    try:
        no_drop_source.stamp(variants, entries)
    except SystemExit as e:
        assert "Vanished Item" in str(e)
        assert "Matched Item" not in str(e), "only the MISSING names are reported"
    else:
        raise AssertionError("a partial join miss must raise")
    # The matched variant was still stamped before the guard fired.
    assert variants[0].get(no_drop_source.FIELD) is True


def test_a_duplicated_shard_key_fails_the_load():
    """Review finding #1 — plain json.load keeps only the LAST duplicate key,
    silently discarding a verdict before any guard sees it. The loader must
    reject the document instead."""
    raw = ('{"_meta": {"note": "dup fixture"}, "harvested": {'
           '"Twice Item": {"verdict": "wiki_has_source"}, '
           '"Twice Item": {"verdict": "confirmed_no_source"}}}')
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        fh.write(raw)
        path = fh.name
    try:
        _raises(SystemExit, no_drop_source.load, path)
    finally:
        os.unlink(path)


# --- coverage (counts derive from the dataset, never hardcoded) --------------

def test_coverage_universe_is_exactly_the_empty_string_worn_variants():
    """R3 universe selection, extended by #93: the empty STRING (a worn item
    whose harvest recorded no quest) enters the universe, and so does a
    RETIRED PSEUDO-SOURCE location (`Special event items`) — a recorded value
    that names no live source. Augment records carry location_quest null and
    the Dino blanks carry no key at all; a real quest stays out."""
    variants = [
        _variant(BRACERS_LEGENDARY),                                # in universe, confirmed
        _variant("Mystery Cloak"),                                  # in universe, unverified
        _variant("Event Relic",
                 location_quest="Special event items"),             # pseudo-source — IN (#93)
        _variant("Sourced Helm", location_quest="A Quest"),         # sourced — out
        _variant("Sapphire of Whatever", location_quest=None,
                 category="augment"),                               # null — out
        {"source_item": "Dinosaur Bone Belt", "variant_id": "Dinosaur Bone Belt",
         "category": "item"},                                       # no key — out
    ]
    no_drop_source.stamp(variants, _entry())
    cov = no_drop_source.coverage(variants, _entry())
    assert cov["triage_universe"] == 3
    assert cov["confirmed_no_source"] == 1
    assert cov["wiki_has_source"] == 0
    assert cov["unverified"] == 2
    assert cov["flagged_variants"] == 1
    assert cov["confirmed_items"] == [BRACERS_LEGENDARY]
    assert cov.get("note")


def test_a_retired_pseudo_source_is_not_staleness_but_a_real_quest_is():
    """#93 — for an entry whose planner record's raw `quests` is exactly the
    retired pseudo-source, guard (d) must NOT fire: that recorded value is the
    admission signal, not evidence of a live source. A real quest beside it
    still trips the guard."""
    entries = {"Event Relic": {"verdict": no_drop_source.CONFIRMED,
                               "provenance": "stated", "evidence": "e",
                               "wiki_url": "https://ddowiki.com/page/Item:Event_Relic",
                               "harvested": "2026-08-13"}}
    result = no_drop_source.check(
        entries, [_rec("Event Relic", quests=["Special event items"])])
    assert result["confirmed"] == ["Event Relic"]
    _raises(SystemExit, no_drop_source.check, entries,
            [_rec("Event Relic", quests=["Special event items", "A Real Quest"])])


# --- the build pipeline ------------------------------------------------------

def _build_with_shard(path):
    import build_dataset
    original = build_dataset.NO_DROP_SOURCE_PATH
    build_dataset.NO_DROP_SOURCE_PATH = path
    try:
        return build_dataset.build()
    finally:
        build_dataset.NO_DROP_SOURCE_PATH = original


def test_an_empty_seed_build_is_fully_inert():
    """AE2 (labeled deliberate no-op guard): an empty fixture shard must yield
    a dataset with ZERO no_drop_source fields AND NO no_drop_source_coverage
    metadata block — the inert path emits nothing at all."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump({"_meta": {"note": "empty fixture"}, "harvested": {}}, fh)
        path = fh.name
    try:
        ds = _build_with_shard(path)
    finally:
        os.unlink(path)
    assert "no_drop_source_coverage" not in ds["metadata"]
    assert not [v for v in ds["items"] if no_drop_source.FIELD in v]


def test_the_shipped_shard_passes_the_guards_against_the_real_roster():
    # Re-ratified after the 2026-08-13 triage populated the shard: 198 entries
    # (19 confirmed_no_source + 179 wiki_has_source) out of the 199-item
    # universe; the one remaining item (an invalid wiki title) is tracker-only
    # in docs/wiki-evidence/no-drop-source.md and deliberately NOT in the shard.
    #
    # #374/U4 — re-ratified 222 -> 216 and confirmed 40 -> 36. The 2026-08-18
    # gear-planner refresh started recording a quest source for six entries, which
    # fired the staleness guard; the guard says un-flagging is a manual review
    # event, so each was re-read on the wiki before being retired into
    # `_retired["2026-08-18-gear-planner-refresh"]`. Four of the six carried
    # `confirmed_no_source`, hence exactly -6 entries and -4 confirmed. The delta
    # is pinned as arithmetic below, not just as two new numbers.
    entries = no_drop_source.load(SHARD)
    assert len(entries) == 216
    retired = _retired_2026_08_18()
    assert len(retired) == 6 and not (set(retired) & set(entries)), \
        "a retired entry must leave the live shard, not sit in both"
    assert {BRACERS_HEROIC, BRACERS_LEGENDARY} <= set(entries)
    assert "Coronach (historic) [Crafted]" not in entries
    records, _stats = planner_items.load_planner_items()
    result = no_drop_source.check(entries, records)
    assert len(result["confirmed"]) == 36
    assert BRACERS_HEROIC in result["confirmed"]
    assert BRACERS_LEGENDARY in result["confirmed"]
    assert "Cataclysmic Buckler" in result["confirmed"]  # the #244 verdict
    # #93 — the exemplar and the still-obtainable event items.
    assert "Seeker Tap of Spellsight" in result["confirmed"]
    assert "Green Steel Greatclub" in result["wiki_has_source"]
    assert "The Admiral of Bling" in result["wiki_has_source"]
    assert result["checked"] == 216
    # Every confirmed entry carries its evidence chain (the guard enforces it;
    # this asserts the shipped data actually exercises that path 19 times).
    for name in result["confirmed"]:
        e = entries[name]
        assert e["evidence"] and e["wiki_url"] and e["harvested"]


def test_the_built_dataset_flags_the_seeded_items_and_counts_coverage():
    """The integration fact: the shipped shard flags exactly the two Spider
    Queen bracer tiers, and the coverage block's counts DERIVE from the built
    dataset (asserted against an in-test recount, not trusted)."""
    import build_dataset
    ds = build_dataset.build()
    flagged = sorted(v["source_item"] for v in ds["items"]
                     if v.get(no_drop_source.FIELD))
    # Re-ratified after the #93 event-item triage: 40 confirmed items, one
    # variant each. The original player-reported instances stay pinned by name.
    # #374/U4 — re-ratified 40 -> 36: the 2026-08-18 refresh records a quest source
    # for four previously `confirmed_no_source` items (both `… of the Deep`
    # families), each wiki-re-read before retirement. See the sibling shard test.
    assert len(flagged) == 36
    assert BRACERS_HEROIC in flagged and BRACERS_LEGENDARY in flagged
    assert "Cataclysmic Buckler" in flagged
    assert "Seeker Tap of Spellsight" in flagged   # the #93 exemplar
    assert "Green Steel Greatclub" not in flagged  # Festivult still grants it
    assert "The Admiral of Bling" not in flagged   # Crystal Cove recurs
    # Only-when-set at the build level: the flag, where present, is True.
    assert all(v[no_drop_source.FIELD] is True for v in ds["items"]
               if no_drop_source.FIELD in v)

    cov = ds["metadata"]["no_drop_source_coverage"]
    universe = [v for v in ds["items"]
                if v.get("location_quest") == ""
                or v.get("location_quest") in no_drop_source.RETIRED_PSEUDO_SOURCES]
    # Augments (location_quest: null) and the Dino blanks (no key) must fall
    # outside the universe by construction.
    assert not [v for v in universe if v.get("category") == "augment"]
    assert not [v for v in universe if v["source_item"].startswith("Dinosaur Bone")]
    assert cov["triage_universe"] == len({v["source_item"] for v in universe})
    # Current-roster expectation (like the ml36 63-entry count): 200 worn items
    # carry an empty location_quest today, plus the 24 `Special event items`
    # pseudo-source carriers (#93). A roster refresh may move this.
    #
    # #374/U4 — re-ratified 223 -> 224, and every part of the delta is attributed
    # to a named cause rather than read off the build:
    #   -6  the retired entries LEAVE the universe (upstream now records a quest
    #       source for each, which is exactly why they were retired)
    #   +7  upstream's scraper added seven `Flame Blade (level N)` tiers, all with
    #       an empty location_quest, so all seven enter the universe undispositioned
    #   ------
    #   +1  net, 223 -> 224
    # and correspondingly confirmed 40 -> 36 (four retired entries were
    # `confirmed_no_source`), wiki_has_source 182 -> 180 (the other two).
    assert cov["triage_universe"] == 224
    assert cov["confirmed_no_source"] == 36
    assert cov["wiki_has_source"] == 180
    # 224-item universe, 216 dispositioned in the shard: the remainder is the
    # single invalid-title item recorded tracker-only, plus the seven new
    # `Flame Blade` tiers awaiting triage. Named, so a NINTH cannot appear silently.
    assert cov["unverified"] == cov["triage_universe"] - 216 == 8
    undispositioned = sorted({v["source_item"] for v in universe}
                             - set(no_drop_source.load(SHARD)))
    assert undispositioned == ["Coronach (historic) [Crafted]"] + [
        f"Flame Blade (level {n})" for n in (1, 10, 15, 20, 25, 30, 5)], undispositioned
    assert cov["flagged_variants"] == 36
    assert BRACERS_HEROIC in cov["confirmed_items"]
    assert BRACERS_LEGENDARY in cov["confirmed_items"]
    assert len(cov["confirmed_items"]) == 36
    # the six retired items really did leave the universe — that is the premise
    # the retirement rests on, checked at the built-dataset level too
    assert not (set(_retired_2026_08_18()) & {v["source_item"] for v in universe})


def test_the_shipped_shard_carries_its_wiki_evidence():
    with open(SHARD, encoding="utf-8") as fh:
        raw = json.load(fh)
    for name, e in raw["harvested"].items():
        assert e["verdict"] in no_drop_source.VERDICTS, name
        if e["verdict"] == no_drop_source.CONFIRMED:
            for field in ("provenance", "evidence", "wiki_url", "harvested"):
                assert e.get(field), f"{name}: entry is missing {field!r}"
            assert e["provenance"] == "stated", name
            assert e["wiki_url"].startswith("https://ddowiki.com/page/Item:"), name


def test_374_every_retired_entry_records_the_review_that_un_flagged_it():
    """Un-flagging is "a manual review event, never automatic" — the module says so
    and the retirement is the only place that promise can be checked.

    Two arms, because either alone is waveable: every retired name must carry a
    non-empty evidence string, AND the refreshed upstream snapshot must actually
    record a quest for it. A retirement whose premise is not in the data is a
    no-drop flag deleted on assertion.
    """
    entries = _retired_2026_08_18()
    assert len(entries) == 6, sorted(entries)
    records, _stats = planner_items.load_planner_items()
    by_name = {r.get("name"): r for r in records}
    for name, evidence in entries.items():
        assert isinstance(evidence, str) and evidence.strip(), \
            f"{name}: retired with no recorded review"
        rec = by_name.get(name)
        assert rec is not None, f"{name}: retired but absent from the roster"
        quests = [q for q in (rec.get("quests") or []) if str(q).strip()]
        assert quests, (
            f"{name}: retired on the premise that upstream now records a source, "
            f"but the refreshed roster still records none — the no-drop flag is "
            f"still live and must not be retired")
    # and the retirement really is what moved the pinned counts
    assert len(no_drop_source.load(SHARD)) + len(entries) == 222, \
        "222 was the pre-refresh entry count; the delta must be exactly the retirement"
