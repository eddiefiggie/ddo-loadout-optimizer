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


# --- coverage (counts derive from the dataset, never hardcoded) --------------

def test_coverage_universe_is_exactly_the_empty_string_worn_variants():
    """R3 universe selection: augment records carry location_quest null and the
    Dino blanks carry no location_quest key at all — only the empty STRING
    (a worn item whose harvest recorded no quest) enters the universe."""
    variants = [
        _variant(BRACERS_LEGENDARY),                                # in universe, confirmed
        _variant("Mystery Cloak"),                                  # in universe, unverified
        _variant("Sourced Helm", location_quest="A Quest"),         # sourced — out
        _variant("Sapphire of Whatever", location_quest=None,
                 category="augment"),                               # null — out
        {"source_item": "Dinosaur Bone Belt", "variant_id": "Dinosaur Bone Belt",
         "category": "item"},                                       # no key — out
    ]
    no_drop_source.stamp(variants, _entry())
    cov = no_drop_source.coverage(variants, _entry())
    assert cov["triage_universe"] == 2
    assert cov["confirmed_no_source"] == 1
    assert cov["wiki_has_source"] == 0
    assert cov["unverified"] == 1
    assert cov["flagged_variants"] == 1
    assert cov["confirmed_items"] == [BRACERS_LEGENDARY]
    assert cov.get("note")


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
    entries = no_drop_source.load(SHARD)
    assert len(entries) == 198
    assert {BRACERS_HEROIC, BRACERS_LEGENDARY} <= set(entries)
    assert "Coronach (historic) [Crafted]" not in entries
    records, _stats = planner_items.load_planner_items()
    result = no_drop_source.check(entries, records)
    assert len(result["confirmed"]) == 19
    assert BRACERS_HEROIC in result["confirmed"]
    assert BRACERS_LEGENDARY in result["confirmed"]
    assert "Cataclysmic Buckler" in result["confirmed"]  # the #244 verdict
    assert result["checked"] == 198
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
    # Re-ratified after the 2026-08-13 triage: 19 confirmed items, one variant
    # each. The two original player-reported instances stay pinned by name.
    assert len(flagged) == 19
    assert BRACERS_HEROIC in flagged and BRACERS_LEGENDARY in flagged
    assert "Cataclysmic Buckler" in flagged
    # Only-when-set at the build level: the flag, where present, is True.
    assert all(v[no_drop_source.FIELD] is True for v in ds["items"]
               if no_drop_source.FIELD in v)

    cov = ds["metadata"]["no_drop_source_coverage"]
    universe = [v for v in ds["items"] if v.get("location_quest") == ""]
    # Augments (location_quest: null) and the Dino blanks (no key) must fall
    # outside the universe by construction.
    assert not [v for v in universe if v.get("category") == "augment"]
    assert not [v for v in universe if v["source_item"].startswith("Dinosaur Bone")]
    assert cov["triage_universe"] == len({v["source_item"] for v in universe})
    # Current-roster expectation (like the ml36 63-entry count): 199 worn items
    # carry an empty location_quest today. A roster refresh may move this.
    assert cov["triage_universe"] == 199
    assert cov["confirmed_no_source"] == 19
    assert cov["wiki_has_source"] == 179
    # 199-item universe, 198 dispositioned in the shard: the remainder is the
    # single invalid-title item recorded tracker-only.
    assert cov["unverified"] == cov["triage_universe"] - 198 == 1
    assert cov["flagged_variants"] == 19
    assert BRACERS_HEROIC in cov["confirmed_items"]
    assert BRACERS_LEGENDARY in cov["confirmed_items"]
    assert len(cov["confirmed_items"]) == 19


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
