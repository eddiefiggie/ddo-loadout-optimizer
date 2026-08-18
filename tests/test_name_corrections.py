"""#227 — wiki-sourced affix NAME corrections and their two stale guards.

The rename is what makes `Enhanced Ki` rankable at all: the picker canonicalizes a
typed name, but the solver matches item affixes by name, so a canonical the data
does not carry scores zero. The guards are what keep the rename from rotting —
one fires when the source name disappears upstream, the other when the canonical
name arrives upstream natively. These tests prove both fire.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import name_corrections  # noqa: E402
from src import vocabulary  # noqa: E402

SHARD = os.path.join(ROOT, "data", "seed", "compendium", "affix_name_corrections.json")
ALIASES = os.path.join(ROOT, "data", "seed", "compendium", "affix_aliases.json")


def _rec(name, affixes):
    return {"name": name, "affixes": affixes}


def _corr(source="Ki", canonical="Enhanced Ki"):
    return {"source_name": source, "canonical_name": canonical}


def _raises(exc, fn, *args, **kwargs):
    try:
        fn(*args, **kwargs)
    except exc as e:
        return e
    raise AssertionError(f"expected {exc.__name__}, nothing raised")


# --------------------------------------------------------------------- rename

def test_the_rename_applies_to_every_occurrence():
    records = [
        _rec("Icewalkers", [{"name": "Ki", "value": "1"}]),
        _rec("Legendary Icewalkers", [{"name": "Ki", "value": "5"}]),
    ]
    cov = name_corrections.apply(records, [_corr()])
    assert [r["affixes"][0]["name"] for r in records] == ["Enhanced Ki", "Enhanced Ki"]
    assert cov == {"names_corrected": 1, "affixes_renamed": 2, "hit_names": ["Ki"]}


def test_the_rename_preserves_the_value_and_the_absent_type():
    records = [_rec("Legendary Icewalkers", [{"name": "Ki", "value": "5"}])]
    name_corrections.apply(records, [_corr()])
    affix = records[0]["affixes"][0]
    assert affix["value"] == "5"
    assert "type" not in affix


def test_other_affixes_are_untouched():
    records = [_rec("Legendary Icewalkers", [
        {"name": "Ki", "value": "5"},
        {"name": "Superior Reinforced Fists", "type": "Bool", "value": 1},
    ])]
    name_corrections.apply(records, [_corr()])
    assert records[0]["affixes"][1]["name"] == "Superior Reinforced Fists"


def test_the_rename_reaches_an_untyped_affix_the_registry_gate_cannot_see():
    # vocabulary.iter_affixes requires name+type+value together, so it does not
    # yield an untyped affix at all. The rename must not inherit that blindness —
    # it is the exact gap that hid this enchantment.
    records = [_rec("Icewalkers", [{"name": "Ki", "value": "1"}])]
    assert list(vocabulary.iter_affixes(records)) == []
    name_corrections.apply(records, [_corr()])
    assert records[0]["affixes"][0]["name"] == "Enhanced Ki"


def test_an_item_named_like_the_source_affix_is_not_renamed():
    # An item record carries a `name` too. Matching on the key alone renamed the
    # 8,188 item names alongside the affixes, so a future correction whose source
    # collides with an item name would silently rewrite items.
    records = [_rec("Ki", [{"name": "Ki", "value": "1"}]),
               _rec("Icewalkers", [{"name": "Ki", "value": "1"}])]
    name_corrections.apply(records, [_corr()])
    assert records[0]["name"] == "Ki", "the ITEM keeps its name"
    assert records[0]["affixes"][0]["name"] == "Enhanced Ki", "the AFFIX is renamed"


def test_an_item_named_like_the_canonical_does_not_trip_the_collision_guard():
    # `present` was built from every dict with a `name`, so an item named like the
    # canonical failed the build claiming gear-planner emits it as an affix.
    records = [_rec("Enhanced Ki", [{"name": "Reinforced Fists", "type": "Bool", "value": 1}]),
               _rec("Icewalkers", [{"name": "Ki", "value": "1"}]),
               _rec("Moonrise Bracers", [{"name": "Ki", "value": "3"}])]
    cov = name_corrections.apply(records, [_corr()])
    assert cov["affixes_renamed"] == 2
    assert records[0]["name"] == "Enhanced Ki"


def test_the_real_roster_yields_only_affixes_never_item_records():
    records = vocabulary._load(vocabulary.ITEMS_PATH)
    yielded = list(name_corrections._iter_affix_dicts(records))
    assert yielded, "refuses to inspect nothing"
    assert not any("slot" in d or "affixes" in d for d in yielded), \
        "an item record must never be treated as an affix"


def test_no_corrections_is_a_no_op():
    records = [_rec("Icewalkers", [{"name": "Ki", "value": "1"}])]
    cov = name_corrections.apply(records, [])
    assert records[0]["affixes"][0]["name"] == "Ki"
    assert cov == {"names_corrected": 0, "affixes_renamed": 0}


def test_a_missing_shard_loads_empty():
    assert name_corrections.load(os.path.join(ROOT, "does", "not", "exist.json")) == []


# ---------------------------------------------------------------------- guards

def test_guard_fires_when_the_source_name_is_gone_from_EVERY_channel():
    """#376 moved this guard, it did not remove it.

    Once the family has more than one channel, a per-channel miss is expected —
    an augment-pool name is absent from the item roster by design — so `apply`
    is silent and `assert_all_reached` owns staleness after every channel has
    run. The rot this guards against (a correction nobody applies) is unchanged.
    """
    records = [_rec("Icewalkers", [{"name": "Reinforced Fists", "type": "Bool", "value": 1}])]
    cov = name_corrections.apply(records, [_corr()])      # silent per-channel
    assert cov["affixes_renamed"] == 0 and cov["hit_names"] == []
    err = _raises(SystemExit, name_corrections.assert_all_reached, [_corr()], cov)
    assert "'Ki'" in str(err)
    assert "reached no record in any channel" in str(err)


def test_guard_fires_when_the_canonical_name_arrives_upstream_natively():
    records = [
        _rec("Icewalkers", [{"name": "Ki", "value": "1"}]),
        _rec("Some New Item", [{"name": "Enhanced Ki", "value": "3"}]),
    ]
    err = _raises(SystemExit, name_corrections.apply, records, [_corr()])
    assert "'Enhanced Ki'" in str(err)
    assert "already a native" in str(err)


def test_guard_refuses_to_inspect_zero_records():
    err = _raises(SystemExit, name_corrections.apply, [], [_corr()])
    assert "empty record set" in str(err)


def test_a_malformed_correction_fails_rather_than_being_skipped():
    records = [_rec("Icewalkers", [{"name": "Ki", "value": "1"}])]
    err = _raises(SystemExit, name_corrections.apply, records, [{"source_name": "Ki"}])
    assert "malformed" in str(err)


# ------------------------------------------------------------- shipping shard

def test_the_shipping_shard_renames_ki_and_cites_the_wiki():
    entries = name_corrections.load(SHARD)
    # #376 added a second entry on the AUGMENT channel (False Life (%) ->
    # Conditioning). Assert this one by name rather than by position, so a third
    # entry does not silently re-point the assertion at someone else.
    assert len(entries) == 2
    e = next(x for x in entries if x["source_name"] == "Ki")
    assert e["source_name"] == "Ki"
    assert e["canonical_name"] == "Enhanced Ki"
    assert e["wiki_url"].endswith("/Enhanced_Ki")
    assert e["evidence"]


def test_every_correction_has_a_matching_alias_so_the_upstream_name_still_resolves():
    # The rename makes the wiki name canonical; without the alias, a player typing
    # the gear-planner name they saw elsewhere would be told it is not a real affix.
    alias_map, _ = vocabulary.load_affix_aliases(ALIASES)
    for e in name_corrections.load(SHARD):
        assert alias_map.get(e["source_name"]) == e["canonical_name"], (
            f"{e['source_name']!r} is renamed but not aliased")


def test_the_shipping_shard_applies_cleanly_to_the_real_roster():
    records = vocabulary._load(vocabulary.ITEMS_PATH)
    cov = name_corrections.apply(records, name_corrections.load(SHARD))
    # Both shard entries are loaded; only `Ki` has carriers in the ITEM roster —
    # the other is augment-pool-only and correctly renames nothing here (#376).
    assert cov["names_corrected"] == 2
    assert cov["hit_names"] == ["Ki"]
    assert cov["affixes_renamed"] == 19
    assert not any(a.get("name") == "Ki"
                   for r in records for a in (r.get("affixes") or []))


# ---------------------------------------------------------------------------
# #376 — the augment channel. Both `Solar Gem of Enduring` stones live in the
# augment pool, not the item roster, so a correction can legitimately reach one
# channel and not the other. Per-channel misses became silent; `assert_all_reached`
# is what keeps the family from rotting.
# ---------------------------------------------------------------------------

def test_376_a_per_channel_miss_is_silent_not_fatal():
    """An augment-pool name is absent from the item roster BY DESIGN."""
    corr = [{"source_name": "False Life (%)", "canonical_name": "Legendary Conditioning"}]
    items_only = [{"affixes": [{"name": "Deadly", "type": "Enhancement", "value": 3}]}]
    cov = name_corrections.apply(items_only, corr)   # must not raise
    assert cov["affixes_renamed"] == 0
    assert cov["hit_names"] == []


def test_376_assert_all_reached_fails_when_no_channel_matched():
    corr = [{"source_name": "Nowhere At All", "canonical_name": "X"}]
    empty = {"hit_names": []}
    try:
        name_corrections.assert_all_reached(corr, empty, empty)
    except SystemExit as exc:
        assert "reached no record in any channel" in str(exc)
        assert "Nowhere At All" in str(exc)
    else:
        raise AssertionError("a correction matching no channel must fail the build")


def test_376_assert_all_reached_passes_when_one_channel_matched():
    corr = [{"source_name": "False Life (%)", "canonical_name": "Legendary Conditioning"}]
    name_corrections.assert_all_reached(
        corr, {"hit_names": []}, {"hit_names": ["False Life (%)"]})   # must not raise


def test_376_the_shipped_shard_folds_the_hp_percent_pair():
    """The wiki ruling, pinned: Conditioning and False Life (%) are one mechanic
    (both a Legendary-typed % bonus to Maximum Hit Points), so they must share a
    bucket. Flat False Life is a different enchantment and must NOT be folded."""
    shard = name_corrections.load(SHARD)
    pairs = {(c["source_name"], c["canonical_name"]) for c in shard}
    assert ("False Life (%)", "Legendary Conditioning") in pairs
    assert not any(c["source_name"] == "False Life" for c in shard), \
        "flat False Life is a different enchantment (no percentage variant) — never fold it"


def test_376_the_built_dataset_lands_both_gems_in_the_conditioning_bucket():
    """End-to-end: the correction is only worth anything if it survives the whole
    pipeline. Both Solar Gem of Enduring stones must arrive as Conditioning at type
    Legendary — the same bucket the 34 worn carriers land in — and the upstream
    name must be gone entirely, since a survivor would be an invisible second
    bucket that scores zero against a `Conditioning` priority.
    """
    path = os.path.join(ROOT, "web", "data", "items.json")
    if not os.path.exists(path):
        return
    with open(path) as fh:
        data = json.load(fh)
    survivors = [
        (it.get("variant_id"), a)
        for it in data["items"]
        for a in (it.get("affixes") or [])
        if a.get("name") == "False Life (%)"
    ]
    assert survivors == [], survivors
    gems = {
        it["source_item"]: [(a["name"], a.get("type")) for a in (it.get("affixes") or [])]
        for it in data["items"]
        if str(it.get("source_item", "")).startswith("Solar Gem of Enduring")
    }
    assert len(gems) == 2, gems
    for name, affixes in gems.items():
        assert ("Conditioning", "Legendary") in affixes, (name, affixes)
