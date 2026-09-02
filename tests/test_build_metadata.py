"""U1 — catalog build identifier in dataset metadata.

The dataset build stamps a stable `build_id` (content hash of the roster) and a
`schema_version` into `metadata`, so a persisted loadout snapshot can detect a
stale catalog (plan R2/R6, KTD5). `build_id` must be deterministic for unchanged
input — the same seed rebuilds to the same id — so staleness is real drift, not
build-run noise.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import build_dataset  # noqa: E402


def _build():
    return build_dataset.build()


def test_metadata_carries_build_id_and_schema_version():
    meta = _build()["metadata"]
    assert meta.get("schema_version") == 1, meta.get("schema_version")
    build_id = meta.get("build_id")
    assert isinstance(build_id, str) and len(build_id) >= 16, build_id
    # hex digest
    int(build_id, 16)


def test_build_id_is_stable_for_unchanged_seed():
    a = _build()["metadata"]["build_id"]
    b = _build()["metadata"]["build_id"]
    assert a == b, (a, b)


# --- U4: curated rankable-affix vocabulary ---------------------------------

def test_rankable_affixes_is_clean_and_covers_core_stats():
    ra = _build()["metadata"]["rankable_affixes"]
    assert isinstance(ra, list) and ra == sorted(ra), "must be a sorted list"
    assert ra == sorted(set(ra)), "must be de-duplicated"
    # core stats a user actually ranks are present
    for s in ("Physical Sheltering", "Magical Sheltering", "Doublestrike",
              "Strength", "Constitution", "Dodge", "Universal Spell Power"):
        assert s in ra, f"expected {s!r} in rankable vocab"
    # build-time parser garbage from wiki-only shards must NOT leak in
    for junk in ("Bal", "INT", "OL", "DD", "Craftable"):
        assert junk not in ra, f"garbage {junk!r} leaked into rankable vocab"
    assert not any("Class Required" in s or "Bug:" in s or s.startswith("Penalty")
                   for s in ra)


def test_rankable_excludes_boolean_and_descriptor_types():
    # A weapon-damage/proc descriptor (Holy) and a boolean-presence name must not
    # appear as a rankable magnitude stat.
    ra = set(_build()["metadata"]["rankable_affixes"])
    assert "Holy" not in ra and "Vampirism" not in ra


def test_rankable_excludes_malformed_and_single_item_names():
    # Leaked partial effect text (unbalanced parens) and per-item named procs must
    # not reach the picker. A malformed name and a single-item proc both fail the
    # well-formed + >=2-item filters.
    ra = set(_build()["metadata"]["rankable_affixes"])
    assert not any(s.count("(") != s.count(")") for s in ra), "unbalanced-paren name leaked"
    assert "Invisibility (Protection" not in ra


def test_rankable_derivation_is_a_subset_signal_not_input_restriction():
    # The curated list is far smaller than "every stat in the dataset" — proving it
    # actually gates suggestions rather than mirroring the polluted full set.
    ds = _build()
    ra = ds["metadata"]["rankable_affixes"]
    all_stats = {a["stat"] for it in ds["items"] for a in it.get("affixes") or []}
    assert len(ra) < len(all_stats), (len(ra), len(all_stats))


# ---------------------------------------------------------------------------
# U1/U2 (plan 2026-08-05-001) — picker-vocabulary hygiene at the generator.
# ---------------------------------------------------------------------------

def test_umbrella_names_are_not_rankable_and_the_abilities_are():
    """U1 (#136) — umbrella.py expands these away at build time, so no item can
    carry one; offering the name gives the player a priority that scores zero."""
    ds = _build()
    ra = set(ds["metadata"]["rankable_affixes"])
    assert "Well Rounded" not in ra
    assert "All Ability Scores" not in ra
    for ability in ["Strength", "Dexterity", "Constitution",
                    "Intelligence", "Wisdom", "Charisma"]:
        assert ability in ra, f"{ability} must stay rankable — it is the redirect target"


def test_expanded_away_names_are_emitted_with_their_replacements():
    """U1 — the picker reads this to drop the name AND redirect the player."""
    meta = _build()["metadata"]
    away = meta.get("expanded_away_names")
    assert away, "expanded_away_names must be emitted"
    assert "well rounded" in away, "keyed lowercase for case-insensitive matching"
    assert away["well rounded"] == ["Strength", "Dexterity", "Constitution",
                                    "Intelligence", "Wisdom", "Charisma"]
    assert "sheltering" not in away, (
        "Sheltering expands to Physical/Magical Sheltering, NOT the six abilities -- "
        "routing it here would zero out PRR/MRR on every Sheltering item"
    )


def test_noise_names_are_absent_from_the_emitted_affix_registry():
    """U2 — the emitted registry feeds the picker's free-typed `known` set."""
    import build_dataset as B
    reg = _build()["metadata"]["affix_registry"]
    assert "See the item description page for details." not in reg
    assert not [n for n in reg if B._BARE_NUMBER_NAME.match(n or "")], "bare-number names leaked"


def test_noise_filter_is_at_the_emit_site_leaving_the_frozen_baseline_intact():
    """U2 — filtering inside generate_registries() would make the referential-
    integrity gate reject data it must accept, since that gate validates against
    the frozen checked-in registry as its baseline."""
    import json
    import build_dataset as B
    from src import vocabulary as V
    frozen = json.load(open(B.VOCAB_REGISTRIES_PATH))["affix_names"]
    # #374/U4 — the fixture noise name is gone from the frozen baseline, and so is
    # every other one: upstream fixed its parser in the 2026-08-18 refresh and
    # retired all 28 scrape artifacts (11 bare numerals, 17 tooltip-bleed blobs),
    # so the re-frozen registry legitimately carries none. See
    # docs/reports/2026-08-18-gear-planner-canon-migration.md §4.
    assert not [n for n in frozen if B.is_noise_affix_name(n)], \
        "no noise name survives upstream's parser cleanup"
    # The claim itself is unchanged and is asserted where it is still falsifiable:
    # `generate_registries` must NOT filter, so a noise name present in raw reaches
    # the baseline the integrity gate validates against. Filtering there would make
    # the gate reject data it has to accept.
    noise = "See the item description page for details."
    assert B.is_noise_affix_name(noise)
    injected = {"items": [{"name": "Noisy Item", "affixes": [
        {"name": noise, "type": "Enhancement", "value": "1"}]}]}
    baseline = V.generate_registries(injected, {}, {})
    assert noise in baseline["affix_names"], (
        "the raw-derived baseline must still carry the noise name -- it is what "
        "the integrity gate validates raw data against"
    )
    # ...and the emit site is what drops it.
    assert noise not in _build()["metadata"]["affix_registry"]


# --- #374/KTD5: the locally minted registry names ---------------------------

def test_374_minted_local_names_reach_the_emitted_picker_vocabulary():
    """`load_affix_vocabulary` unions the curated `local_affix_names` section into
    the emitted registry — the same list `cross_add_map` bounds its targets to.
    Without it, our canon leaves the picker vocabulary the moment the refreshed
    snapshot lands, because the frozen baseline is generated from RAW."""
    from src import vocabulary as V
    reg = set(_build()["metadata"]["affix_registry"])
    minted = V.local_affix_names()
    assert minted, "the curated section must not be empty"
    for name in minted:
        assert name in reg, f"{name!r} was minted but never reached the registry"


def test_374_the_minted_union_moves_exactly_the_minted_names_and_nothing_else():
    """Was `…_moves_nothing_before_the_refresh` — the nothing-changed guard U3 wrote
    while every minted name was still in the frozen (raw-derived) section, making
    the union a no-op.

    U4 vendored the refresh, so upstream's re-frozen registry no longer carries any
    of them and the union is now the only thing putting them in the picker
    vocabulary. The guard keeps its shape — an exact equality against a derived
    expectation, never a length or a subset — so the union still cannot smuggle in
    a fourteenth name.
    """
    import json
    import build_dataset as B
    from src import vocabulary as V
    frozen = json.load(open(B.VOCAB_REGISTRIES_PATH))["affix_names"]
    minted = V.local_affix_names()
    assert not (set(minted) & set(frozen)), \
        "a minted name reappeared in the frozen section — the union would be a no-op"
    expected = sorted({n for n in frozen if not B.is_noise_affix_name(n)} | set(minted))
    assert _build()["metadata"]["affix_registry"] == expected


def test_675_a_stat_two_sets_grant_is_rankable_even_with_no_item_carrier():
    """#675 — the set-bonus half of `rankable_affixes`, which the vocabulary has
    always claimed to carry.

    `web/dataset.js` calls this list the "curated item/scaling/set-bonus
    vocabulary", but only item affix blocks were counted. A stat carried by named
    sets alone reached the picker's `known` (via `_itemAffixTriples`) and never its
    `suggestions`, so a player had to already know the name to rank it — 16 of
    them, `Melee Diversion` at ten sets and `Sneak Attack` at five among them.

    Asserted as the property rather than against those names, so the guard still
    means something after the next catalog refresh moves the population. Counting
    is by DISTINCT SET: a set grants its bonus on every piece, so per-item counting
    would let one set clear the two-source bar on its own pieces alone.
    """
    import collections
    ds = _build()
    ra = set(ds["metadata"]["rankable_affixes"])
    sets_by_stat = collections.defaultdict(set)
    for v in ds["items"]:
        for tier in v.get("parsed_set_bonuses") or []:
            set_name = tier.get("set")
            if not set_name:
                continue
            for a in tier.get("affixes") or []:
                bt = a.get("bonus_type")
                if bt in (None, "", "Untyped", "boolean", "Bool") or bt in build_dataset.NON_RANKABLE_TYPES:
                    continue
                if not build_dataset._is_numeric(a.get("value")):
                    continue
                stat = a.get("stat")
                if stat and build_dataset._well_formed_stat(stat):
                    sets_by_stat[stat].add(set_name)

    multi = {s: n for s, n in sets_by_stat.items() if len(n) >= 2}
    # Refuse to inspect nothing: a set-bonus channel that stopped parsing would
    # empty this map and leave the assertion below passing over zero stats.
    assert len(multi) > 30, \
        f"only {len(multi)} stats are granted by two or more sets — the scan is broken, not the data"
    missing = sorted(s for s in multi if s not in ra)
    assert missing == [], (
        "a stat two or more distinct sets grant is not rankable, so the picker will "
        f"never suggest it: {missing}")
