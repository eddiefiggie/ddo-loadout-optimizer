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
    # #374 added the eleven canon-defence entries (ten spell-power/lore flips plus
    # the helpless-family consolidation), taking the shard to 13.
    assert len(entries) == 13
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
    # All 13 shard entries are loaded; only `Ki` has carriers in the ITEM roster.
    # `False Life (%)` is augment-pool-only (#376) and the eleven #374 canon-defence
    # entries are armed by an upstream snapshot this tree has not vendored yet, so
    # every one of them correctly renames nothing here.
    assert cov["names_corrected"] == 13
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


# ---------------------------------------------------------------------------
# #374 — defending our canon through every channel.
#
# Upstream generalized its affix vocabulary (`Combustion` -> `Fire Spell Power`)
# and we keep ours (KTD1). These tests run against a SYNTHETIC refreshed snapshot:
# the real raw files with our canon flipped to upstream's spelling, exactly the
# state U4 will vendor. The pre-refresh tree cannot exercise the renames any other
# way — every one of them is correctly inert against today's data.
# ---------------------------------------------------------------------------

from src import crafting_catalog  # noqa: E402
from src import set_catalog  # noqa: E402
from src.affix_parser import BONUS_TYPES, _split_type  # noqa: E402

# The flip upstream made, measured against its master on 2026-08-18.
FLIPPED = {
    "Combustion": "Fire Spell Power",
    "Devotion": "Positive Spell Power",
    "Nullification": "Negative Spell Power",
    "Glaciation": "Cold Spell Power",
    "Impulse": "Force Spell Power",
    "Magnetism": "Electric Spell Power",
    "Resonance": "Sonic Spell Power",
    "Corrosion": "Acid Spell Power",
    "Void Lore": "Negative Lore",
    "Ice Lore": "Cold Lore",
    "Damage to helpless enemies": "Damage vs. the Helpless",
}


def _flip(obj):
    """Rewrite every affix name in a raw structure to upstream's spelling."""
    for a in name_corrections._iter_affix_dicts(obj):
        nm = a.get("name")
        if nm in FLIPPED:
            a["name"] = FLIPPED[nm]
    return obj


def _names(obj):
    return [a.get("name") for a in name_corrections._iter_affix_dicts(obj)]


def _shard():
    return name_corrections.load(SHARD)


def test_374_the_shard_declares_thirteen_and_marks_the_canon_defence():
    entries = _shard()
    assert len(entries) == 13
    defence = [e for e in entries if e.get("canon_defense")]
    assert len(defence) == 11, [e["source_name"] for e in defence]
    # Every canon-defence entry is still pending: this tree has not vendored the
    # refreshed snapshot that arms it. U4 retires the markers.
    assert all(name_corrections.is_pending(e) for e in defence)
    assert all((e.get("pending_reason") or "").strip() for e in defence)
    # `Force Lore` must NOT be declared: it has zero occurrences in refreshed raw,
    # so a correction for it would be a rename nobody applies. `Kinetic Lore`
    # survives natively.
    assert "Force Lore" not in {e["source_name"] for e in entries}
    # The two pre-#374 entries are untouched and are NOT canon defence.
    plain = {e["source_name"] for e in entries if not e.get("canon_defense")}
    assert plain == {"Ki", "False Life (%)"}


def test_374_every_canonical_survives_split_type_with_a_stat_left():
    """`_split_type` peels a leading bonus-type word — a canonical whose first word
    is a bonus type and which is one word long would be peeled to `stat=""`, minting
    a nameless affix. Checked per canonical, never in aggregate."""
    canonicals = {e["canonical_name"] for e in _shard()}
    assert canonicals == set(FLIPPED) | {"Enhanced Ki", "Legendary Conditioning"}, \
        sorted(canonicals)
    for e in _shard():
        canonical = e["canonical_name"]
        btype, stat = _split_type(canonical)
        assert stat, f"{canonical!r} peels to an empty stat"
        if canonical == "Legendary Conditioning":
            # The one deliberate peel: legendary_fold owns this name and the
            # `Legendary` type is the point of it.
            assert (btype, stat) == ("Legendary", "Conditioning")
        else:
            assert stat == canonical, (canonical, btype, stat)
            assert canonical.split()[0] not in BONUS_TYPES


# --- per-channel reach: never asserted in aggregate --------------------------

def test_374_the_items_channel_renames_every_flipped_name():
    items = _flip(vocabulary._load(vocabulary.ITEMS_PATH))
    before = set(_names(items)) & set(FLIPPED.values())
    assert before, "the synthetic refreshed items must carry upstream's spelling"
    name_corrections.apply(items, _shard())
    after = set(_names(items)) & set(FLIPPED.values())
    assert after == set(), sorted(after)
    restored = set(_names(items)) & set(FLIPPED)
    assert restored == {c for c, u in FLIPPED.items() if u in before}


def test_374_the_crafting_channel_renames_every_flipped_name():
    """KTD2 — the 244 protected-name occurrences in gearplanner_crafting.json are
    unreachable from the item-roster call; only the catalog load point covers them."""
    crafting = _flip(crafting_catalog.load_catalog())
    before = [n for n in _names(crafting) if n in set(FLIPPED.values())]
    assert len(before) >= 200, len(before)
    cov = name_corrections.apply(crafting, _shard())
    assert [n for n in _names(crafting) if n in set(FLIPPED.values())] == []
    assert cov["affixes_renamed"] >= 200


def test_374_the_augment_pool_inherits_the_crafting_rename():
    """One call at the catalog load point covers every pool derived from it — the
    augment pool is asserted on its own records, not on the catalog it came from."""
    crafting = _flip(crafting_catalog.load_catalog())
    name_corrections.apply(crafting, _shard())
    pool = crafting_catalog.augment_pool_records(crafting)
    survivors = [n for n in _names(pool) if n in set(FLIPPED.values())]
    assert survivors == [], sorted(set(survivors))
    assert any(n in FLIPPED for n in _names(pool)), "the augment pool must carry canon"


def test_374_the_dino_pool_inherits_the_crafting_rename():
    from src import dino as dino_mod
    from src import dino_native
    crafting = _flip(crafting_catalog.load_catalog())
    name_corrections.apply(crafting, _shard())
    blanks, inserts, sets_, cov = dino_mod.build_dino(
        dino_native.native_dino_seed(), crafting)
    for label, pool in (("inserts", inserts), ("dino_sets", sets_), ("blanks", blanks)):
        stats = [a.get("stat") for r in pool for a in (r.get("affixes") or [])]
        stats += [n for n in _names(pool)]
        assert not (set(stats) & set(FLIPPED.values())), (
            label, sorted(set(stats) & set(FLIPPED.values())))


def test_374_the_sets_channel_renames_every_flipped_name():
    """The 121 protected-name occurrences in gearplanner_sets.json. Applied to the
    RAW catalog — `load_catalog` returns synthesized TEXT, so a rename on its output
    would be a permanent no-op (the seam the first design missed)."""
    raw = _flip(set_catalog.load_raw())
    before = [n for n in _names(raw) if n in set(FLIPPED.values())]
    assert len(before) >= 100, len(before)
    name_corrections.apply(raw, _shard())
    assert [n for n in _names(raw) if n in set(FLIPPED.values())] == []
    # And the rename reaches the synthesized text every downstream consumer reads.
    catalog = set_catalog.catalog_from_raw(raw)
    text = " || ".join(
        t for entry in catalog.values() if entry.get("set_bonus")
        for t in entry["set_bonus"]["piece_bonuses"].values())
    assert "Combustion" in text
    for upstream in FLIPPED.values():
        assert upstream not in text, upstream


# --- the staleness / honesty guards ------------------------------------------

def test_374_a_pending_entry_is_exempt_from_the_reached_guard():
    """A canon-defence entry is written one unit before the data that arms it, so
    it reaches nothing by construction. Without the exemption the build dies on a
    correction that is right and simply early."""
    pending = {"source_name": "Fire Spell Power", "canonical_name": "Combustion",
               "pending_upstream": True, "pending_reason": "armed by the U4 refresh"}
    name_corrections.assert_all_reached([pending], {"hit_names": []})  # must not raise
    live = dict(pending)
    live.pop("pending_upstream")
    try:
        name_corrections.assert_all_reached([live], {"hit_names": []})
    except SystemExit as e:
        assert "reached no record in any channel" in str(e)
    else:
        raise AssertionError("a non-pending entry reaching nothing must fail")


def test_374_a_pending_entry_without_a_reason_fails():
    bare = {"source_name": "Fire Spell Power", "canonical_name": "Combustion",
            "pending_upstream": True}
    try:
        name_corrections.assert_all_reached([bare], {"hit_names": ["Fire Spell Power"]})
    except SystemExit as e:
        assert "without a pending_reason" in str(e)
    else:
        raise AssertionError("an unexplained exemption must fail")


def test_374_assert_canon_defense_fails_when_an_armed_variant_has_no_live_rename():
    """The `a fourteenth arrived upstream` event a hand-list would miss."""
    try:
        name_corrections.assert_canon_defense(
            _shard(), {"Vitality": "False Life"})
    except SystemExit as e:
        assert "'Vitality' is ARMED upstream" in str(e)
        assert "score zero" in str(e)
    else:
        raise AssertionError("an armed variant with no live rename must fail")


def test_374_assert_canon_defense_fails_when_a_live_defence_is_not_armed():
    live = [{"source_name": "Fire Spell Power", "canonical_name": "Combustion",
             "canon_defense": True}]
    try:
        name_corrections.assert_canon_defense(live, {})
    except SystemExit as e:
        assert "declares a live canon_defense but the raw data does not arm it" in str(e)
    else:
        raise AssertionError("an inert live defence must fail")


def test_374_assert_canon_defense_fires_when_a_landed_entry_keeps_its_marker():
    """The exemption is self-retiring: once the refresh arms an entry, the marker
    must go in the same commit or the build is red."""
    still_pending = [e for e in _shard() if e["source_name"] == "Fire Spell Power"]
    assert still_pending and name_corrections.is_pending(still_pending[0])
    try:
        name_corrections.assert_canon_defense(
            _shard(), {"Fire Spell Power": "Combustion"})
    except SystemExit as e:
        assert "'Fire Spell Power' is ARMED upstream" in str(e)
    else:
        raise AssertionError("a landed pending entry must fail until retired")


def test_374_assert_canon_defense_passes_on_the_pre_refresh_tree():
    """Both sides are empty today: nothing is armed and no defence claims to be
    live. The assertion is not vacuous — the four tests above show it firing."""
    armed = vocabulary.armed_canon_variants()
    assert armed == {}, armed
    name_corrections.assert_canon_defense(_shard(), armed)


def test_374_the_real_shard_applies_cleanly_to_a_synthetic_refreshed_snapshot():
    """End-to-end honesty: with the refresh vendored, every one of the eleven
    canon-defence entries reaches a channel, so `assert_all_reached` would pass on
    its own merits rather than on the pending exemption."""
    shard = _shard()
    items = _flip(vocabulary._load(vocabulary.ITEMS_PATH))
    crafting = _flip(crafting_catalog.load_catalog())
    sets_raw = _flip(set_catalog.load_raw())
    covs = [name_corrections.apply(o, shard) for o in (items, crafting, sets_raw)]
    reached = set()
    for c in covs:
        reached.update(c["hit_names"])
    missing = set(FLIPPED.values()) - reached
    assert missing == set(), sorted(missing)
    retired = [dict(e, pending_upstream=False) for e in shard]
    # `Ki` and `False Life (%)` live in the item roster / augment pool, which the
    # three catalogs above do not fully cover, so feed their real coverage in.
    name_corrections.assert_all_reached(
        retired, *covs, {"hit_names": ["Ki", "False Life (%)"]})
