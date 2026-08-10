"""U10 — controlled-vocabulary foundation (registries, integrity, lint, freshness)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src import vocabulary as V  # noqa: E402


def _raises(exc, fn, *args, **kwargs):
    """Zero-dependency replacement for pytest.raises (this repo runs plain-assert tests)."""
    try:
        fn(*args, **kwargs)
    except exc:
        return True
    raise AssertionError(f"expected {exc.__name__} to be raised")


def test_registries_generate_nonempty_and_deterministic():
    r1 = V.generate_registries()
    r2 = V.generate_registries()
    assert r1 == r2, "registry generation must be deterministic"
    assert len(r1["affix_names"]) > 1000, "expected the full affix-name vocabulary"
    assert len(r1["bonus_types"]) > 30, "expected the bonus-type vocabulary"
    assert len(r1["crafting_slots"]) == 83, "expected the 83 crafting-slot keys"
    # sorted (deterministic) order
    assert r1["affix_names"] == sorted(r1["affix_names"])


def test_bonus_types_include_distinct_compounds():
    # The compound types are DISTINCT stacking buckets, not to be merged.
    types = set(V.generate_registries()["bonus_types"])
    assert "Insight" in types and "Insight Natural" in types
    assert "Insightful" not in types, "Insightful is a legacy wiki-parser artifact, not native"


def test_alias_resolution_and_distinct_whitelist():
    alias_map, distinct = V.load_affix_aliases()
    names = set(V.generate_registries()["affix_names"])
    # a curated variant resolves to its canonical entry
    assert V.resolve_affix_name("Greater Dragonmark charges", names, alias_map) == \
        "Greater Dragonmark Charges"
    # a canonical entry resolves to itself
    assert V.resolve_affix_name("Greater Dragonmark Charges", names, alias_map) == \
        "Greater Dragonmark Charges"
    # anti-false-merge: the punctuation-differing pair is two distinct entries
    assert frozenset(("Armor Class", "Armor Class (%)")) in distinct
    assert "Armor Class" in names and "Armor Class (%)" in names


def test_integrity_gate_passes_on_real_data_and_fails_on_unknown():
    items, crafting, sets = V._load(V.ITEMS_PATH), V._load(V.CRAFTING_PATH), V._load(V.SETS_PATH)
    baseline = V.generate_registries(items, crafting, sets)
    alias_map, _ = V.load_affix_aliases()
    # the frozen baseline resolves all current references (aliases cover the collisions)
    n = V.check_referential_integrity(items, crafting, sets, baseline, alias_map)
    assert n > 10000
    # a reference absent from the frozen baseline is a build-blocking new-name event
    injected = [{"name": "Totally Not A Real Affix Zzz", "type": "Enhancement", "value": "1"}]
    _raises(V.IntegrityError, V.check_referential_integrity, injected, {}, {}, baseline, alias_map)
    # an unknown TYPE also fails
    bad_type = [{"name": baseline["affix_names"][0], "type": "MadeUpType", "value": "1"}]
    _raises(V.IntegrityError, V.check_referential_integrity, bad_type, {}, {}, baseline, alias_map)


def test_lint_surfaces_collisions_without_mutating():
    names = V.generate_registries()["affix_names"]
    _, distinct = V.load_affix_aliases()
    before = list(names)
    out = V.lint_affix_names(names, distinct)
    assert names == before, "lint must never mutate the input"
    # the known case/whitespace collisions surface as blocking candidates
    flat = {n for grp in out["collisions"].values() for n in grp}
    assert "Greater Dragonmark charges" in flat and "Greater Dragonmark Charges" in flat
    # a whitelisted distinct pair is not re-flagged as similar
    for a, b in out["similar"]:
        assert frozenset((a, b)) not in distinct


def test_anti_false_merge_similar_names_stay_distinct():
    # Acid vs Acidic are genuinely different affixes — the lint may flag them, but they
    # remain two separate registry entries (never collapsed).
    names = set(V.generate_registries()["affix_names"])
    assert "Acid" in names and "Acidic" in names
    assert "Armor Class" in names and "Armor Class (%)" in names
    assert "False Life" in names and "False Life (%)" in names


def test_stacking_equivalence_groups_the_curated_pairs():
    eq = V.load_stacking_equivalence()
    assert V.stacking_bucket("Insight Natural", eq) == "Insight"
    assert V.stacking_bucket("Primal Natural", eq) == "Primal"
    # Profane Natural completes the "X Natural" family (issue #88, wiki-verified
    # 2026-08-10). The two Lunar Gems of Natural Armor grant a PROFANE bonus to
    # natural armor, so they share the Profane bucket rather than standing alone.
    # Latent when added — nothing else supplies a Profane bonus to Armor Class —
    # which is exactly why it needs pinning: a silent regression here would not
    # move the golden suite. See docs/wiki-evidence/bonus-type-equivalence.md.
    assert V.stacking_bucket("Profane Natural", eq) == "Profane"
    # a normal type is its own bucket, verbatim
    assert V.stacking_bucket("Insight", eq) == "Insight"
    assert V.stacking_bucket("Enhancement", eq) == "Enhancement"


def test_every_stacking_equivalence_entry_carries_wiki_evidence():
    """An unverified collapse is a guess, and this map shipped with two of them.

    Each entry must be marked verified and cite the page it came from, so a new
    pair cannot be added on a hunch the way the original two were.
    """
    import json as _json
    path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "data", "seed", "compendium", "type_stacking_equivalence.json",
    )
    with open(path) as fh:
        doc = _json.load(fh)
    entries = doc["equivalences"]
    assert entries, "equivalence map is empty"
    for e in entries:
        native = e.get("native_type")
        assert e.get("verified") is True, f"{native}: unverified collapse"
        assert (e.get("evidence") or "").strip(), f"{native}: no evidence recorded"
        assert (e.get("source") or "").strip(), f"{native}: no wiki source cited"


def test_freshness_reads_and_detects_drift():
    recorded = V.assert_freshness()
    assert recorded == "ec3e595d0d879b29c13f3c34ffc155e71d0418c4"
    # a wrong expected commit surfaces drift
    _raises(V.FreshnessError, V.assert_freshness, expected_commit="deadbeef")


# --- U2/R14: crafting-slot + augment registries + integrity gate --------------

def test_crafting_slot_registry_generates_and_matches_frozen():
    gen = V.generate_crafting_slot_registry()
    # deterministic + sorted
    assert gen == V.generate_crafting_slot_registry()
    assert gen == sorted(gen)
    # pool keys (83) ∪ item markers (adds the 12 pool-less Cannith slots) = 95
    assert len(gen) == 95, "crafting-slot registry = 83 pool keys ∪ item crafting[] markers"
    assert "Sealed in Undeath" in gen and "T1 (Weapon)" in gen
    assert "Cannith: Rune Arm - Extra" in gen, "pool-less item markers are still in the registry"
    frozen = V._load(V.CRAFTING_SLOT_REGISTRY_PATH)["crafting_slots"]
    assert frozen == gen, "checked-in frozen registry matches the generator"


def test_augment_registry_generates_and_matches_frozen():
    gen = V.generate_augment_registry()
    assert gen == sorted(gen) and len(gen) > 500, "augment-stone registry from the <Color> Augment Slot pools"
    frozen = V._load(V.AUGMENT_REGISTRY_PATH)["augments"]
    assert frozen == gen, "checked-in frozen augment registry matches the generator"


def test_crafting_integrity_gate_passes_and_fails_loudly():
    items = V._load(V.ITEMS_PATH)
    crafting = V._load(V.CRAFTING_PATH)
    slot_reg = V._load(V.CRAFTING_SLOT_REGISTRY_PATH)
    aug_reg = V._load(V.AUGMENT_REGISTRY_PATH)
    # the frozen registries resolve every real crafting[] marker + augment stone
    n = V.check_crafting_integrity(items, crafting, slot_reg, aug_reg)
    assert n > 10000
    # an item marker absent from the frozen slot registry fails the build
    bad_item = [{"name": "Fake Item", "crafting": ["No Such Slot Zzz"]}]
    _raises(V.IntegrityError, V.check_crafting_integrity, bad_item, {}, slot_reg, aug_reg)
    # an augment stone absent from the frozen augment registry fails the build
    bad_aug = {"Blue Augment Slot": {"*": [{"name": "Totally Fake Augment Zzz", "affixes": []}]}}
    _raises(V.IntegrityError, V.check_crafting_integrity, [], bad_aug, slot_reg, aug_reg)


# --- U6.5: vocabulary hardening (ported synonyms, co-occurrence, unit signature) ----

# The 12 semantic synonyms ported from the legacy vocab.STAT_ALIASES into the curated
# alias table (the string-similarity lint cannot discover these — zero shared characters).
# "All Abilities" -> "All Ability Scores" is deliberately NOT ported: that canonical does
# not exist as a native registry affix.
_PORTED_SYNONYMS = {
    "Str": "Strength", "Dex": "Dexterity", "Con": "Constitution",
    "Int": "Intelligence", "Wis": "Wisdom", "Cha": "Charisma",
    "PRR": "Physical Sheltering", "MRR": "Magical Sheltering",
    "Physical Resistance Rating": "Physical Sheltering",
    "Magical Resistance Rating": "Magical Sheltering",
    "Fortification Bypass": "Armor-Piercing",
    "Fortification Bypass (Armor-Piercing)": "Armor-Piercing",
}

# Every string-similar pair that co-occurs on the SAME item is DISTINCT (an item never
# lists one affix twice). These four are the named regression anchors; Blood Rage/Bloodrage
# in particular CONTRADICTS the plan's redundancy example — both are separate Bool affixes.
_COOCCUR_DISTINCT = [
    ("Frost", "Frostbite"),
    ("Freezing", "Freezing Ice"),
    ("Impact", "Impactful"),
    ("Blood Rage", "Bloodrage"),
]


def test_ported_synonyms_resolve_to_valid_registry_canonicals():
    alias_map, _ = V.load_affix_aliases()
    names = set(V.generate_registries()["affix_names"])
    for variant, canonical in _PORTED_SYNONYMS.items():
        # the alias is present and points at the expected canonical
        assert alias_map.get(variant) == canonical, f"{variant!r} should alias to {canonical!r}"
        # the canonical is a real native registry entry (no invented affixes)
        assert canonical in names, f"canonical {canonical!r} must exist natively"
        # resolve_affix_name round-trips the variant to the valid canonical
        assert V.resolve_affix_name(variant, names, alias_map) == canonical


def test_prr_canonicalizes_to_physical_sheltering():
    alias_map, _ = V.load_affix_aliases()
    names = set(V.generate_registries()["affix_names"])
    assert V.resolve_affix_name("PRR", names, alias_map) == "Physical Sheltering"
    assert V.resolve_affix_name("MRR", names, alias_map) == "Magical Sheltering"


def test_all_abilities_synonym_not_ported_canonical_absent():
    # Guard the "don't invent a canonical" decision: All Ability Scores is not native,
    # so no alias may point at it.
    alias_map, _ = V.load_affix_aliases()
    names = set(V.generate_registries()["affix_names"])
    assert "All Ability Scores" not in names
    assert "All Abilities" not in alias_map


def test_cooccurring_pairs_are_classified_distinct():
    _, distinct = V.load_affix_aliases()
    for a, b in _COOCCUR_DISTINCT:
        assert frozenset((a, b)) in distinct, f"{a!r}/{b!r} must be whitelisted distinct"


def test_cooccurring_pairs_never_share_a_canonical():
    # A co-occurring pair must NEVER resolve to one shared canonical (that would be a merge).
    alias_map, _ = V.load_affix_aliases()
    names = set(V.generate_registries()["affix_names"])
    for a, b in _COOCCUR_DISTINCT:
        ra = V.resolve_affix_name(a, names, alias_map)
        rb = V.resolve_affix_name(b, names, alias_map)
        # each resolves to itself (present natively) or None (type-less, e.g. Impactful) —
        # but the two never collapse onto the same name.
        assert not (ra is not None and ra == rb), f"{a!r}/{b!r} must not merge"


def test_detector_finds_cooccurring_pairs_and_is_deterministic():
    det1 = V.detect_cooccurring_distinct()
    det2 = V.detect_cooccurring_distinct()
    assert det1 == det2, "detector must be deterministic"
    keys = {frozenset(e["pair"]) for e in det1}
    for a, b in _COOCCUR_DISTINCT:
        assert frozenset((a, b)) in keys, f"detector must surface {a!r}/{b!r}"
        # each record carries its co-occurrence evidence
    for e in det1:
        assert e["reason"].startswith("co-occurs on ")
    # every detected pair actually co-occurs on the named item (evidence is real)
    items = V._load(V.ITEMS_PATH)
    by_item = {it.get("name"): {a["name"] for a in it.get("affixes") or []
                                if isinstance(a, dict) and isinstance(a.get("name"), str)}
               for it in items}
    for e in det1:
        item = e["reason"][len("co-occurs on "):]
        a, b = e["pair"]
        assert a in by_item.get(item, set()) and b in by_item.get(item, set())


def test_unit_marker_is_significant_flat_vs_percent_distinct():
    # The normalizer must NOT strip % — flat vs percent are different stats.
    assert V._norm_collision("Armor Class") != V._norm_collision("Armor Class (%)")
    assert V.differ_only_by_unit_marker("Armor Class", "Armor Class (%)")
    assert V.differ_only_by_unit_marker("False Life", "False Life (%)")
    assert V.name_unit("Armor Class (%)") == "pct" and V.name_unit("Armor Class") == "flat"
    # a flat-vs-percent pair is never a lint merge candidate
    out = V.lint_affix_names(["Armor Class", "Armor Class (%)"])
    flagged = set(out["prefix_pairs"]) | set(out["similar"])
    assert ("Armor Class", "Armor Class (%)") not in flagged


def test_anti_false_merge_insight_natural_and_ac_percent_hold():
    reg = V.generate_registries()
    names, types = set(reg["affix_names"]), set(reg["bonus_types"])
    # Insight vs Insight Natural are distinct stacking BUCKETS (types), never merged.
    assert "Insight" in types and "Insight Natural" in types
    # Armor Class (flat) vs Armor Class (%) are distinct affix NAMES, never collapsed.
    assert "Armor Class" in names and "Armor Class (%)" in names


def test_evidence_bundle_reports_without_mutating():
    names = V.generate_registries()["affix_names"]
    _, distinct = V.load_affix_aliases()
    before = list(names)
    bundle = V.evidence_bundle(names=names, distinct_pairs=distinct)
    assert names == before, "evidence bundle must never mutate its input"
    assert "candidates" in bundle and isinstance(bundle["candidates"], list)
    for c in bundle["candidates"]:
        assert set(c) >= {"pair", "cooccurs", "cooccur_item", "units", "bonus_types", "counts"}
    # a report-only structure: it surfaces co-occurrence + unit + bonus-type evidence
    # for at least one real candidate
    assert any(c["cooccurs"] for c in bundle["candidates"])


# ---------------------------------------------------------------------------
# U6 (plan 2026-08-05-001) — anti-false-merge guard for the two standing rulings.
# Both were adjudicated outside this file (2026-08-01 bug-report audit;
# 2026-08-04 spell-lore wiki evidence) and are now recorded in the curated
# `distinct` list so the generic no-merge rule below actually covers them.
# ---------------------------------------------------------------------------

def test_standing_rulings_are_recorded_as_distinct():
    _, pairs = V.load_affix_aliases()  # already a set of frozenset pairs
    assert frozenset(["Vitality", "False Life"]) in pairs, (
        "Vitality/False Life must stay recorded distinct -- Vitality is a bonus TYPE on "
        "False Life, not a synonym; aliasing is a false merge (2026-08-01 audit)"
    )
    assert frozenset(["Spell Lore", "Universal Spell Lore"]) in pairs, (
        "Spell Lore/Universal Spell Lore must stay recorded distinct -- they are separate "
        "bonus-type channels that legitimately stack (2026-08-04 wiki evidence)"
    )


def test_no_alias_maps_between_a_recorded_distinct_pair():
    """The generic rule: a curated alias must never merge a pair ruled distinct."""
    aliases, pairs = V.load_affix_aliases()
    for variant, canonical in aliases.items():
        assert frozenset([variant, canonical]) not in pairs, (
            f"alias {variant!r} -> {canonical!r} merges a pair recorded as distinct"
        )


# ---------------------------------------------------------------------------
# U1 (plan 2026-08-05-001, #136) — names the build expands away must not be
# offered as rankable priorities: umbrella.py rewrites them into the six
# abilities, so no item can ever carry one.
# ---------------------------------------------------------------------------

def test_umbrella_expansion_maps_every_umbrella_name_to_the_six_abilities():
    from src import umbrella as U
    exp = U.umbrella_expansion()
    assert exp, "the expansion map is non-empty"
    for name, replacements in exp.items():
        assert U.is_umbrella(name), f"{name!r} must be an umbrella name"
        assert replacements == U.ABILITIES, f"{name!r} expands to the six abilities"


def test_sheltering_is_not_an_umbrella_name():
    """Guard: adding Sheltering to _UMBRELLA would make _expand_affix rewrite every
    Sheltering affix into the six ability scores, zeroing PRR/MRR on all gear.
    Sheltering expands to Physical/Magical Sheltering at the web/dataset.js seam."""
    from src import umbrella as U
    assert not U.is_umbrella("Sheltering")
    assert "sheltering" not in U.umbrella_expansion()


# ---------------------------------------------------------------------------
# U2 (plan 2026-08-05-002, #134) — sibling differencing for numeric-suffix pools.
# Fixture-based on purpose: the assertions must hold regardless of whether any
# correction has landed against the live catalog.
# ---------------------------------------------------------------------------

_TOPAZ_GAP = [
    {"name": "Topaz of Swiftness 5%", "affixes": [{"name": "Speed"}, {"name": "Melee Alacrity"}]},
    {"name": "Topaz of Swiftness 10%", "affixes": [{"name": "Speed"}, {"name": "Melee Alacrity"}]},
    {"name": "Topaz of Swiftness 15%", "affixes": [{"name": "Speed"}]},
]


def test_sibling_differencing_reports_the_topaz_shaped_gap():
    """The reported shape: one sibling lacks an affix its peers carry."""
    out = V.sibling_affix_gaps(_TOPAZ_GAP)
    assert len(out) == 1, out
    f = out[0]
    assert f["family"] == "Topaz of Swiftness"
    assert f["option"] == "Topaz of Swiftness 15%"
    assert f["missing"] == "Melee Alacrity"
    assert f["siblings_with_it"] == ["Topaz of Swiftness 10%", "Topaz of Swiftness 5%"]


def test_sibling_differencing_is_silent_once_the_affix_is_present():
    filled = [dict(o) for o in _TOPAZ_GAP]
    filled[2] = {"name": "Topaz of Swiftness 15%",
                 "affixes": [{"name": "Speed"}, {"name": "Melee Alacrity"}]}
    assert V.sibling_affix_gaps(filled) == []


def test_sibling_differencing_ignores_a_family_of_one():
    """No peer to differ from — a lone suffixed option is not a finding."""
    assert V.sibling_affix_gaps([{"name": "Lone Gem 10%", "affixes": [{"name": "Speed"}]}]) == []


def test_sibling_differencing_does_not_group_non_suffix_digits():
    """`Litany of the Dead II` and `Docent of Quickening` are not tier siblings of
    anything — grouping them would invent findings across unrelated options."""
    opts = [
        {"name": "Litany of the Dead II", "affixes": [{"name": "Strength"}]},
        {"name": "Docent of Quickening", "affixes": [{"name": "Melee Alacrity"}]},
    ]
    assert V.sibling_affix_gaps(opts) == []


def test_sibling_differencing_never_mutates_its_input():
    """Report-only (KTD10): a finding is a candidate for wiki confirmation, never a
    correction. The #134 investigation proved why — the wiki did NOT corroborate the
    reported Topaz gap, so an auto-correcting version would have written a bad value."""
    import copy
    before = copy.deepcopy(_TOPAZ_GAP)
    V.sibling_affix_gaps(_TOPAZ_GAP)
    assert _TOPAZ_GAP == before
