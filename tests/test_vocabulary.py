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
    # #229 — the baseline is the CHECKED-IN registry, not a fresh generate over the
    # same raw file. `check_referential_integrity`'s own docstring says so —
    # "regenerating from the same raw would be tautological" — but this test passed
    # it a regenerated baseline, which is exactly the tautology the docstring warns
    # about: every name in the raw is in a baseline built from that raw, so the gate
    # could never report drift. Its "fails on unknown" half still worked, because
    # those cases inject into a fresh list; the half that matters on a real refresh
    # did not. Reading the frozen file is what gives the gate teeth.
    baseline = V._load(V.VOCAB_REGISTRIES_PATH)
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
    # the known case/whitespace collisions surface as blocking candidates.
    # #374/U4 — re-ratified off the `Greater Dragonmark charges`/`Greater Dragonmark
    # Charges` pair: upstream normalized that capitalization in the refresh (the old
    # spellings survive as alias VARIANTS, so resolution is unaffected — see
    # docs/reports/2026-08-18-gear-planner-canon-migration.md §4). Re-anchored on the
    # `Item becomes a Spellcasting Implement` pair, which the pre-refresh registry
    # also carried, so this pins a long-standing collision rather than a fresh one.
    flat = {n for grp in out["collisions"].values() for n in grp}
    assert "item becomes a Spellcasting Implement" in flat and \
        "Item becomes a Spellcasting Implement" in flat
    # the lint keys on a case-folded form, so both spellings land in ONE group
    assert set(out["collisions"]["item becomes a spellcasting implement"]) == {
        "Item becomes a Spellcasting Implement", "item becomes a Spellcasting Implement"}
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
    # #374/U4 — re-ratified from `ec3e595…` (2026-08-01) to the vendored refresh.
    # The raw mirror was re-fetched pinned to this SHA; SOURCE.json records the
    # exact four-file curl. The stamp moves ONLY when a vendoring happens.
    assert recorded == "767a7f747d0e7d211a702b8c456348e1c36ba699"
    # a wrong expected commit surfaces drift
    _raises(V.FreshnessError, V.assert_freshness, expected_commit="deadbeef")


# --- U2/R14: crafting-slot + augment registries + integrity gate --------------

def test_crafting_slot_registry_generates_and_matches_frozen():
    gen = V.generate_crafting_slot_registry()
    # deterministic + sorted
    assert gen == V.generate_crafting_slot_registry()
    assert gen == sorted(gen)
    # pool keys (83) ∪ item markers (adds the 12 pool-less crafting slots) = 95
    assert len(gen) == 95, "crafting-slot registry = 83 pool keys ∪ item crafting[] markers"
    assert "Sealed in Undeath" in gen and "T1 (Weapon)" in gen
    # #374/U5 — the 12 pool-less markers are unchanged in COUNT and identity; only
    # their prefix moved, 1:1, `Cannith: *` -> `Essence Crafting: *`. Update 79
    # renamed the system in game (wiki ruling recorded in src/crafting_coverage.py),
    # so this is upstream tracking DDO, not upstream inventing a spelling — the one
    # class of rename KTD1 says to ADOPT. Both directions are pinned: the new label
    # must be present and the retired one absent, so a half-applied rename fails.
    assert "Essence Crafting: Rune Arm - Extra" in gen, \
        "pool-less item markers are still in the registry"
    assert not [s for s in gen if s.startswith("Cannith:")], \
        "the retired `Cannith:` prefix must not survive anywhere in the registry"
    assert len([s for s in gen if s.startswith("Essence Crafting:")]) == 12, \
        "all 12 pool-less markers carry the renamed prefix"
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


# --- #211: the umbrella-affix detector -----------------------------------------

def _adj(name, disposition="atomic", evidence="tooltip quote", harvested="2026-08-13"):
    e = {"disposition": disposition, "harvested": harvested}
    if evidence is not None:
        e["evidence"] = evidence
    return {"harvested": {name: e}}


def test_detector_flags_a_family_head_word_outsider():
    cands = V.umbrella_candidates(
        ["Spell Focus Mastery", "Necromancy Focus"],
        ["Necromancy Focus", "Evocation Focus"], [])
    assert [c["name"] for c in cands] == ["Spell Focus Mastery"]
    assert cands[0]["signal"] == "head-word"


def test_detector_flags_the_name_shapes():
    cands = V.umbrella_candidates(
        ["All Ability Scores", "Universal Widget", "Armor Mastery", "Dodge"],
        ["Necromancy Focus"], [])
    assert sorted(c["name"] for c in cands) == \
        ["All Ability Scores", "Armor Mastery", "Universal Widget"]
    assert all(c["signal"] == "name-shape" for c in cands)


def test_detector_flags_a_bundle_named_for_the_bundle():
    """#719 — the signal the other two cannot carry.

    Both original signals assume an umbrella shares a word with its members: the
    sibling axis matches a component's head-word, the shape matches a quantifier
    prefix. `Good Luck` shares nothing with `Reflex Save`, and
    `Alluring Skills Bonus` ends in the CATEGORY word `Skills`, which is never a
    component's last word. Both sat rankable and unexpanded for the detector's
    whole life and were found by a player instead (#717/#718).
    """
    # The six names that motivated the widening, none of them modeled here so the
    # detector has to see them on shape alone.
    bundles = ["Good Luck", "Alluring Skills Bonus", "Nimble Skills Bonus",
               "Astute Skills Bonus", "Prudent Skills Bonus", "Mighty Skills Bonus"]
    cands = V.umbrella_candidates(bundles, ["Necromancy Focus", "Reflex Save"], [])
    assert sorted(c["name"] for c in cands) == sorted(bundles), (
        "every bundle-named umbrella must reach the queue")
    assert all(c["signal"] == "bundle-name" for c in cands), \
        [c["signal"] for c in cands]


def test_the_original_signals_could_not_have_caught_them():
    """The guard's own guard — proves the widening is load-bearing, not decorative.

    If this ever passes with the bundle signal disabled, one of the other two has
    started covering these names and this one can be reconsidered.
    """
    bundles = ["Good Luck", "Alluring Skills Bonus"]
    components = ["Necromancy Focus", "Reflex Save", "Bluff", "Intimidate"]
    heads = {V._head_word(c) for c in components}
    for name in bundles:
        by_head = any(w in heads for w in name.split())
        by_shape = bool(V._UMBRELLA_SHAPE_RE.search(name))
        assert not by_head and not by_shape, (
            f"{name} is now caught by an original signal; re-measure before "
            "assuming the bundle signal is still needed")


def test_the_widening_does_not_flag_ordinary_names():
    """Measured cost: against the real build inputs it added ZERO candidates.

    These are the near-misses that must NOT be swept in — a stat whose name
    merely contains a bundle word, or ends in one that is a genuine component.
    """
    cands = V.umbrella_candidates(
        ["Reflex Save", "Skill Focus", "Lucky Charm", "Dodge"],
        ["Reflex Save"], [])
    # `Reflex Save` is a component; the other three match no signal at all.
    assert [c["name"] for c in cands] == [], [c["name"] for c in cands]


def test_detector_skips_family_members_and_modeled_names():
    cands = V.umbrella_candidates(
        ["Necromancy Focus", "Universal Spell Power", "Rune Arm Focus"],
        ["Necromancy Focus"], ["universal spell power"])
    assert [c["name"] for c in cands] == ["Rune Arm Focus"]


def test_an_unadjudicated_candidate_fails_the_build():
    cands = V.umbrella_candidates(
        ["Rune Arm Focus"], ["Necromancy Focus"], [])
    try:
        V.check_umbrella_adjudications(cands, {"harvested": {}},
                                                ["Rune Arm Focus"])
    except SystemExit as exc:
        assert "unadjudicated" in str(exc) and "Rune Arm Focus" in str(exc)
        return
    raise AssertionError("an unadjudicated candidate must fail the build")


def test_an_unknown_disposition_fails_the_build():
    cands = V.umbrella_candidates(
        ["Rune Arm Focus"], ["Necromancy Focus"], [])
    try:
        V.check_umbrella_adjudications(
            cands, _adj("Rune Arm Focus", disposition="modeled"),
            ["Rune Arm Focus"])
    except SystemExit as exc:
        assert "closed" in str(exc)
        return
    raise AssertionError("the disposition vocabulary is closed at ['atomic']")


def test_a_ruling_without_evidence_fails_the_build():
    cands = V.umbrella_candidates(
        ["Rune Arm Focus"], ["Necromancy Focus"], [])
    try:
        V.check_umbrella_adjudications(
            cands, _adj("Rune Arm Focus", evidence=None), ["Rune Arm Focus"])
    except SystemExit as exc:
        assert "evidence" in str(exc)
        return
    raise AssertionError("an atomic ruling must carry its evidence")


def test_a_stale_ruling_fails_the_build():
    # The ruled name left the vocabulary (a mechanism now models it, or the
    # roster moved): the entry must be retired deliberately, never linger.
    try:
        V.check_umbrella_adjudications(
            [], _adj("Rune Arm Focus"), [])
    except SystemExit as exc:
        assert "stale" in str(exc)
        return
    raise AssertionError("a stale ruling must fail the build")


def test_the_detector_refuses_to_flag_nothing():
    try:
        V.check_umbrella_adjudications([], {"harvested": {}}, ["Dodge"])
    except ValueError:
        return
    raise AssertionError("zero flagged candidates must refuse to pass")


def test_the_real_seed_resolves_the_real_vocabulary():
    """Integration: the shipped adjudication seed + registered mechanisms cover
    every candidate the detector flags over the built dataset, and every seed
    entry is still live. Mirrors the check build_dataset.py runs."""
    import json as _json
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "..", "web", "data", "items.json"),
              encoding="utf-8") as fh:
        data = _json.load(fh)
    rankable = data["metadata"]["rankable_affixes"]
    ea = data["metadata"]["expanded_away_names"]
    components = {c for comps in ea.values() for c in comps}
    from src import cross_add as _ca
    modeled = set(ea) | set(_ca.SPELLPOWER_SOURCES) | set(_ca.LORE_SOURCES)
    # The build's universe: worn rankable names PLUS every crafting pool's
    # affix names PLUS the set-def channels — through the SAME shared helper
    # the build calls (`vocabulary.pool_affix_names`), so this test cannot
    # drift from the build by hand-mirroring the walk. `Constitution Skills`
    # lives only in the NC Skill menu; `all Saving Throws` only on set tiers.
    pool_names = V.pool_affix_names(
        [data.get(k) or [] for k in ("nearly_complete", "viktranium",
         "seal", "legendary_green_steel", "dino_inserts")]
        + list((data.get("nearly_complete_per_item") or {}).values()),
        set_defs=[data.get("membership_set_defs") or {},
                  data.get("augment_set_defs") or {}])
    universe = sorted(set(rankable) | pool_names)
    cands = V.umbrella_candidates(universe, components, modeled)
    seed = V._load(V.UMBRELLA_ADJUDICATIONS_PATH)
    report = V.check_umbrella_adjudications(cands, seed, universe)
    # Re-pinned across the sweep's iterations (20 -> 25 -> 29 -> 30 -> 38): each
    # widening of the universe (skills components, pool names, set-def
    # channels) flagged more names, and each got its ruling. The count pins
    # the converged state.
    #
    # 30 -> 38 at #366, and the arithmetic is the point: admitting base
    # `Spell Lore` to the expansion family made "Lore" a family head-word, which
    # (a) retired TWO entries — `Radiance Lore` and `Repair Lore` became
    # expansion COMPONENTS, so the detector stops asking about them and their
    # rulings went stale — and (b) newly flagged the TEN Combined Spell Lores
    # (Blighted, Creeping Dust, ...), each now ruled `atomic` on its own row of
    # the Spell_Lore "Combined Spell Lore" table. 30 - 2 + 10 = 38.
    #
    # 38 -> 37 at #702: `Magical Resistance Rating Cap` left the rankable set
    # because it was an alias VARIANT of `Magical Sheltering Cap` all along (the
    # hand-curated augment_sets.json seed was its only carrier), so the detector
    # stopped asking about it and its ruling was retired (recorded under the
    # seed's `_meta.retired`). The canonical carries no head-word and needs no
    # ruling of its own. 38 - 1 = 37.
    #
    # 37 -> 36 at #214: `Deific Focus` left the rankable set because its three
    # carriers are quarantined (a conditional, ramping effect stored as its stack
    # ceiling — conditional_affix_quarantine.json), so the detector stopped asking
    # about it and its atomic ruling was retired (`_meta.retired`). 37 - 1 = 36.
    assert report["candidates"] == 36
    assert report["atomic"] == 36
    # The detector's first sweep found three live umbrellas; they must stay
    # MODELED (expanded away), never re-enter the rankable vocabulary silently.
    for name in ("Resistance", "Elemental Resonance", "Combat Mastery",
                 "Charisma Skills", "Dexterity Skills", "Intelligence Skills"):
        assert name not in rankable, f"{name} must stay expanded away"


def test_374_every_upstream_flip_of_our_canon_is_aliased_back():
    """#374 — upstream flipped ten stat names we store under the in-game
    enchantment name. We keep our canon and absorb the divergence in
    affix_aliases.json, so a refreshed import lands on our names.

    This guard is the maintenance contract: if a future snapshot folds ANOTHER
    of our stored names away, that is a silent vocabulary change, and it fails
    here instead of quietly renaming a stat in the built catalog.
    """
    import json
    import os

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    built_path = os.path.join(root, "web", "data", "items.json")
    if not os.path.exists(built_path):
        return  # dataset not built; the JS suite covers the built-artifact side

    with open(built_path, encoding="utf-8") as fh:
        built = json.load(fh)
    stored = {a.get("name") for it in built.get("items", [])
              for a in (it.get("affixes") or []) if a.get("name")}

    live = V.load_live_affix_synonyms()
    entries = live.get("affix_synonyms", live) if isinstance(live, dict) else live
    upstream_folds = {syn: e["name"] for e in entries for syn in (e.get("synonyms") or [])}

    alias_map, _distinct = V.load_affix_aliases()

    unabsorbed = []
    for name in sorted(stored):
        target = upstream_folds.get(name)
        if not target or target == name:
            continue                      # upstream agrees with us, or is silent
        # Upstream folds OUR stored name onto a different canonical. The import
        # must map their name back to ours, or the next refresh renames the stat.
        if alias_map.get(target) != name:
            unabsorbed.append(f"{name!r} (upstream folds it to {target!r}, "
                              f"no alias {target!r} -> {name!r})")

    assert not unabsorbed, (
        "upstream folds these stored names away with no inverse alias — a refresh "
        "would silently rename them in the built catalog:\n  "
        + "\n  ".join(unabsorbed)
        + "\nAdd the inverse to data/seed/compendium/affix_aliases.json after "
          "confirming no item carries both names (the co-occurrence rule).")


def test_374_the_ten_known_flips_resolve_to_our_canon():
    """The explicit list, so a deletion from affix_aliases.json is caught even if
    the vendored upstream table has not been refreshed yet."""
    alias_map, _ = V.load_affix_aliases()
    expected = {
        "Fire Spell Power": "Combustion", "Acid Spell Power": "Corrosion",
        "Positive Spell Power": "Devotion", "Cold Spell Power": "Glaciation",
        "Force Spell Power": "Impulse", "Electric Spell Power": "Magnetism",
        "Negative Spell Power": "Nullification", "Sonic Spell Power": "Resonance",
        "Cold Lore": "Ice Lore", "Negative Lore": "Void Lore",
        # #368 — discoverability, not a flip: ours is the wiki wording.
        "Force Lore": "Kinetic Lore",
    }
    for variant, canonical in expected.items():
        assert alias_map.get(variant) == canonical, (
            f"{variant!r} must alias to {canonical!r}, got {alias_map.get(variant)!r}")


# ---------------------------------------------------------------------------
# #374 — defending our canon against upstream's flipped vocabulary.
# ---------------------------------------------------------------------------

def _raises_msg(exc, fn, *args, **kwargs):
    """`_raises` above returns True, not the exception. These tests assert on the
    message, because a red proves *a* gate fired, not that yours did."""
    try:
        fn(*args, **kwargs)
    except exc as e:
        return str(e)
    raise AssertionError(f"expected {exc.__name__} to be raised")


_FLIPPED_TABLE = {
    "affix_synonyms": [
        # What upstream's table looks like AFTER the flip: our canon on the
        # SYNONYM side, its generic name as the canonical.
        {"name": "Fire Spell Power", "synonyms": ["Combustion", "Fire Spellpower"]},
        {"name": "Positive Spell Power", "synonyms": ["Devotion"]},
        {"name": "Negative Lore", "synonyms": ["Void Lore"]},
        # An unrelated fold, which must survive untouched.
        {"name": "Speed", "synonyms": ["Striding"]},
    ],
    "local_affix_synonyms": [
        {"name": "Damage to helpless enemies", "synonyms": ["Helplessness Damage"]},
    ],
}


def test_374_registry_synonym_folds_drops_a_fold_keyed_on_our_canon():
    folds = V._suppressed_upstream_folds(V._synonym_folds(_FLIPPED_TABLE))
    for canon in ("Combustion", "Devotion", "Void Lore"):
        assert canon not in folds, f"{canon!r} must not fold away"
    # Suppression is by KEY membership, so a non-canon synonym of the same entry
    # and an unrelated fold both survive.
    assert folds["Fire Spellpower"] == "Fire Spell Power"
    assert folds["Striding"] == "Speed"


def test_374_suppression_never_inverts_so_no_two_cycle_can_form():
    """KTD4 — an inverse LOCAL fold would slip past `_local_synonym_folds`'
    collision guard (it compares synonym keys) and leave both directions live,
    splitting one mechanic across two buckets. Suppression cannot: the merged map
    holds at most one direction because the upstream key is simply gone."""
    merged = dict(V._suppressed_upstream_folds(V._synonym_folds(_FLIPPED_TABLE)))
    merged.update(V._local_synonym_folds(_FLIPPED_TABLE))
    for syn, canon in merged.items():
        assert merged.get(canon) != syn, f"2-cycle {syn!r} <-> {canon!r}"


def test_374_the_shipped_fold_map_has_no_protected_canon_name_as_a_key():
    folds = V.registry_synonym_folds()
    assert folds, "the shipped fold map must not be empty"
    leaked = sorted(set(folds) & V.PROTECTED_CANON)
    assert leaked == [], leaked


def test_374_suppression_does_not_reach_the_live_vs_frozen_gate():
    """The gate must keep seeing upstream's table verbatim, or a flip stops being
    a reviewable event. `_synonym_folds` is unfiltered by design."""
    raw = V._synonym_folds(_FLIPPED_TABLE)
    assert raw["Combustion"] == "Fire Spell Power"
    frozen = {"affix_synonyms": [{"name": "Combustion", "synonyms": ["Fire Spell Power"]}]}
    _raises(V.IntegrityError, V.check_affix_synonyms, _FLIPPED_TABLE, frozen)


# --- the `local_affix_synonyms` staleness guard -------------------------------

def _local(synonyms, unmatched=None):
    e = {"name": "Damage to helpless enemies", "synonyms": list(synonyms)}
    if unmatched is not None:
        e["unmatched_synonyms"] = list(unmatched)
    return {"local_affix_synonyms": [e]}


def test_374_local_synonym_staleness_fires_on_a_synonym_that_matches_nothing():
    err = _raises_msg(
        V.IntegrityError, V.check_local_synonym_staleness,
        _local(["Helplessness Damage", "Gone Upstream"]),
        {"Helplessness Damage"}, [])
    assert "'Gone Upstream'" in err
    assert "silent no-op" in err


def test_374_local_synonym_staleness_matches_free_text_by_substring():
    """The Dino seam parses verbatim wiki sentences, so the spelling is embedded
    rather than stored as a name."""
    V.check_local_synonym_staleness(
        _local(["damage vs. the helpless"]), set(),
        ["+15% Artifact bonus to damage vs. the helpless"])


def test_374_local_synonym_staleness_matches_names_exactly_not_by_prefix():
    """A longer sibling must never vouch for a retired spelling."""
    _raises(V.IntegrityError, V.check_local_synonym_staleness,
            _local(["Damage vs. Helpless"]),
            {"Damage vs. Helpless Opponents"}, [])


def test_374_local_synonym_staleness_allowlist_is_two_directional():
    # Allowlisted and absent -> passes.
    V.check_local_synonym_staleness(
        _local(["Helplessness Damage", "Damage vs. Helpless"],
               unmatched=["Damage vs. Helpless"]),
        {"Helplessness Damage"}, [])
    # Allowlisted and PRESENT again -> fails, so the exemption cannot rot.
    err = _raises_msg(
        V.IntegrityError, V.check_local_synonym_staleness,
        _local(["Helplessness Damage", "Damage vs. Helpless"],
               unmatched=["Damage vs. Helpless"]),
        {"Helplessness Damage", "Damage vs. Helpless"}, [])
    assert "carries it again" in err


def test_374_local_synonym_staleness_rejects_an_allowlist_entry_that_is_not_declared():
    err = _raises_msg(V.IntegrityError, V.check_local_synonym_staleness,
                      _local(["Helplessness Damage"], unmatched=["Never Declared"]),
                      {"Helplessness Damage"}, [])
    assert "is not a declared synonym" in err


def test_374_local_synonym_staleness_refuses_an_empty_corpus():
    err = _raises_msg(V.IntegrityError, V.check_local_synonym_staleness,
                      _local(["Helplessness Damage"]), set(), [])
    assert "empty corpus" in err


def test_374_the_shipped_local_registry_is_not_stale():
    import build_dataset
    # #374/U4 — re-ratified 11 -> 12 synonyms. The helpless family still declares
    # its eleven; the twelfth is `all Ability Scores` -> `Well Rounded`, re-adopted
    # locally because upstream RETIRED its own copy of that fold in this refresh.
    # The retirement was cleared on structured-affix occurrence counts (0/0/0), but
    # `registry_synonym_folds` also folds the Dino channel's verbatim wiki tier
    # text, where the spelling is live — without it the two dino sets stamped
    # `via: "Artifact all Ability Scores"` while `membership_set_defs`, the live
    # defs the SAME set scores through, stamped `via: "Artifact Well Rounded"`.
    # Display provenance only: both spellings already expand to the same six
    # abilities at the same bonus type, so no value, bucket or solve moves.
    n = build_dataset.assert_local_affix_synonyms()
    # #695 — 13: the Maximum Spellpoints family joined the reviewed local section.
    assert n == 13, n
    table = V._load(V.AFFIX_SYNONYMS_REGISTRY_PATH)
    assert {e["name"] for e in table["local_affix_synonyms"]} == {
        "Damage to helpless enemies", "Well Rounded", "Maximum Spell Points (%)"}
    assert n == sum(len(e["synonyms"]) for e in table["local_affix_synonyms"]) \
        == table["local_count"], "the declared local_count must match the section"


# --- KTD3: the armed set is derived, never hand-listed ------------------------

def _raw_pair(name, value="10"):
    return {"name": name, "type": "Artifact", "value": value}


def test_374_armed_canon_variants_arms_a_flip_and_only_a_flip():
    items = {"items": [{"name": "Some Item", "affixes": [
        _raw_pair("Fire Spell Power"),      # flipped: variant present, canon gone
        _raw_pair("Positive Spell Power"),  # both spellings present -> NOT armed
        _raw_pair("Devotion"),
    ]}]}
    empty = {}
    armed = V.armed_canon_variants(items, empty, empty,
                                   alias_map={"Fire Spell Power": "Combustion",
                                              "Positive Spell Power": "Devotion",
                                              "Cold Spell Power": "Glaciation"})
    # `Cold Spell Power` is absent from raw entirely, so it is not armed either.
    assert armed == {"Fire Spell Power": "Combustion"}, armed


def test_374_armed_canon_variants_NOW_SEES_an_untyped_variant():
    """#229 inverted this, and the inversion is the fix.

    It used to assert that `armed_canon_variants` could NOT see an untyped affix,
    because the walk required name+type+value and gear-planner omits `type`
    entirely for one. That was a recorded blindness, not a desired property: an
    upstream spelling that arrived untyped would arm no canon defence, so a
    correction guarding our canonical name would sit `pending_upstream` forever
    while upstream was already emitting the variant.

    The walk now needs only name+value, so the `Ki` boundary case arms.
    """
    items = {"items": [{"name": "Icewalkers", "affixes": [{"name": "Ki", "value": "3"}]}]}
    armed = V.armed_canon_variants(items, {}, {}, alias_map={"Ki": "Enhanced Ki"})
    assert armed == {"Ki": "Enhanced Ki"}, armed


def test_374_armed_canon_variants_is_exactly_the_canon_defence_after_the_refresh():
    """Was `…_is_empty_before_the_refresh_is_vendored` — the deliberate pre-refresh
    pin U2/U3 wrote knowing U4 would invert it. It guarded ONE direction of a
    two-directional property: on the pre-refresh snapshot nothing was armed, so
    every canon-defence correction had to be `pending_upstream`.

    The refresh arms all thirteen, so the same property now reads from the other
    side: the armed set, derived from the raw snapshot, must equal the live
    canon-defence set, derived from the shard. Still never hand-listed — a shard
    edit and a data change each move one side and this fails.
    """
    armed = V.armed_canon_variants()
    declared = {c["source_name"]: c["canonical_name"]
                for c in V._load(V.AFFIX_NAME_CORRECTIONS_PATH)["corrections"]
                if c.get("canon_defense")}
    assert armed, "the refresh is vendored — an empty armed set would mean it is not"
    assert armed == declared, {"armed_only": set(armed) - set(declared),
                               "declared_only": set(declared) - set(armed)}


# --- KTD5: minting our canon into the frozen registry -------------------------
#
# `generate_registries` reads RAW only, before any rename runs, so once upstream
# stops emitting one of our canon names no pipeline change can put it back. The
# curated `local_affix_names` section is the way back in, and it is unioned into
# BOTH consumers (the gate here; `build_dataset.load_affix_vocabulary` for
# `cross_add`, covered in tests/test_cross_add.py).

def _canon_flips():
    """`{upstream generic name: our canon}` — derived from the shipped canon-defence
    corrections, never hand-listed, so a shard edit moves this fixture with it."""
    shard = V._load(V.AFFIX_NAME_CORRECTIONS_PATH)["corrections"]
    return {c["source_name"]: c["canonical_name"]
            for c in shard if c.get("canon_defense")}


def _refreshed_baseline():
    """The baseline U4's re-freeze will produce: today's raw-derived registry with
    our canon names REMOVED and upstream's generic spellings added. This is what
    `generate_registries()` returns over refreshed raw, and the shape the gate's
    only caller passes in."""
    base = V.generate_registries()
    flips = _canon_flips()
    names = set(base["affix_names"]) - set(flips.values()) | set(flips)
    return {"affix_names": sorted(names), "bonus_types": base["bonus_types"]}


def _registry_file(mutate):
    """Write the shipped vocab_registries.json to a temp file after `mutate(dict)`,
    and return the path — the gate and the picker vocabulary both load this file
    directly, so a scenario is expressed by editing the FILE, not a passed dict."""
    import json
    import tempfile
    table = V._load(V.VOCAB_REGISTRIES_PATH)
    mutate(table)
    fh = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
    json.dump(table, fh)
    fh.close()
    return fh.name


def test_374_local_affix_names_are_minted_by_a_rename_or_a_local_fold():
    """The legitimacy join, asserted mechanically against the two files that mint
    names. NOT "minted by a reviewed local fold" — that arm alone would reject
    every spell-power and lore name here, which renames mint."""
    renames, folds = V._minting_sources()
    minted = V.local_affix_names()
    assert minted, "the section must not be empty"
    for name in minted:
        assert name in renames or name in folds, (
            f"{name!r} is backed by neither a correction canonical nor a local synonym")
    # both arms are actually exercised by the shipped section
    assert [n for n in minted if n in renames], "no entry is backed by a rename"
    assert [n for n in minted if n in folds], "no entry is backed by a local fold"
    # the explicit set, so a deletion is caught even before the refresh arms it.
    # #374/U4 — re-ratified 11 -> 13. U3 declined both additions on measurements
    # that were true of the PRE-refresh snapshot and are false of this one:
    #   `Legendary Conditioning` — "native upstream, minting it is a permanent
    #     no-op". Gate-visible occurrences went 34 -> 0; upstream now folds the
    #     family into `False Life (%)` (2 -> 40, all `type: "Legendary"`).
    #   `Enhanced Ki` — "untyped and invisible to the gate's walk". Upstream
    #     re-encoded the type field, so `Ki` went 0 -> 20 gate-visible occurrences.
    # Both are additions to the SAME two-arm legitimacy join asserted above, not a
    # widening of it. See docs/reports/2026-08-18-gear-planner-canon-migration.md §6.1.
    assert set(minted) == {
        "Combustion", "Corrosion", "Devotion", "Glaciation", "Impulse",
        "Magnetism", "Nullification", "Resonance", "Ice Lore", "Void Lore",
        "Damage to helpless enemies", "Legendary Conditioning", "Enhanced Ki"}, minted
    # the folded names are exactly PROTECTED_CANON (11 after the refresh added
    # `Legendary Conditioning -> False Life (%)` upstream); the rest are rename-only
    assert set(V.PROTECTED_CANON) < set(minted)


def test_374_pending_corrections_count_as_a_minting_source():
    """Deliberate: a `pending_upstream` correction still mints its canonical.

    U3 wrote this against the shipped shard, where all eleven canon-defence
    corrections carried the marker by construction. U4 vendored the data that arms
    them, so `assert_canon_defense` required every marker to be stripped and the
    shard now has none — reading the property off the shipped file is no longer
    possible without re-introducing the exact staleness that guard exists to catch.

    The property itself is unchanged and still load-bearing: it is what makes the
    section survivable ACROSS refreshes, since the next upstream flip re-introduces
    pending markers for names already minted here. So it is asserted against
    `_minting_sources` directly, with the marker injected — the same claim, sourced
    from the function that implements it rather than from a transient file state.
    """
    shard = V._load(V.AFFIX_NAME_CORRECTIONS_PATH)["corrections"]
    assert not [c for c in shard if c.get("pending_upstream")], (
        "post-refresh the shard must carry no pending markers — "
        "assert_canon_defense fails when one outlives its data")

    # take a real shipped correction whose canonical this section mints, and mark
    # it pending: the canonical must still be a legitimate minting source.
    minted = set(V.local_affix_names())
    victim = next(c for c in shard if c.get("canonical_name") in minted)
    marked = [dict(c, pending_upstream=True) if c is victim else c for c in shard]
    renames, _folds = V._minting_sources({"corrections": marked})
    assert victim["canonical_name"] in renames, (
        "a pending correction stopped minting — every canon-defence entry is "
        "pending by construction between an upstream flip and the vendoring that "
        "arms it, so this section would be rejected wholesale in that window")
    # and the marker is not what makes it legitimate: unmarked mints identically
    unmarked, _ = V._minting_sources({"corrections": shard})
    assert renames == unmarked


def test_374_minted_canon_passes_the_gate_against_a_refreshed_baseline():
    """The whole point: after the refresh the alias map rewrites upstream's generic
    name to our canon, which the regenerated baseline no longer contains."""
    baseline = _refreshed_baseline()
    alias_map, _ = V.load_affix_aliases()
    flips = _canon_flips()
    for canonical in flips.values():
        assert canonical not in set(baseline["affix_names"]), canonical
    injected = {"items": [{"name": "Refreshed Item",
                           "affixes": [_raw_pair(v) for v in flips]}]}
    n = V.check_referential_integrity(injected, {}, {}, baseline, alias_map)
    assert n == len(flips), (n, len(flips))
    names = set(baseline["affix_names"]) | set(V.local_affix_names())
    for variant, canonical in flips.items():
        assert V.resolve_affix_name(variant, names, alias_map) == canonical


def test_374_without_minting_the_refresh_turns_the_gate_red():
    """The predicted failure, reproduced deliberately — this is what the tree does
    TODAY if U4 lands without this unit."""
    path = _registry_file(lambda t: t.pop("local_affix_names"))
    alias_map, _ = V.load_affix_aliases()
    injected = {"items": [{"name": "Refreshed Item",
                           "affixes": [_raw_pair("Fire Spell Power")]}]}
    err = _raises_msg(V.IntegrityError, V.check_referential_integrity,
                      injected, {}, {}, _refreshed_baseline(), alias_map,
                      registry_path=path)
    assert "'Fire Spell Power'" in err and "frozen registry" in err, err


def test_374_the_gate_is_not_widened_into_an_escape_hatch():
    """A genuinely new upstream name still raises with the section minted."""
    alias_map, _ = V.load_affix_aliases()
    injected = {"items": [{"name": "Refreshed Item",
                           "affixes": [_raw_pair("Totally Not A Real Affix Zzz")]}]}
    err = _raises_msg(V.IntegrityError, V.check_referential_integrity,
                      injected, {}, {}, _refreshed_baseline(), alias_map)
    assert "Totally Not A Real Affix Zzz" in err, err


def test_374_a_minted_name_backed_by_neither_arm_is_rejected():
    def _invent(t):
        t["local_affix_names"].append(
            {"name": "Totally Invented Affix Zzz", "evidence": "none, deliberately"})
    err = _raises_msg(V.IntegrityError, V.local_affix_names,
                      path=_registry_file(_invent))
    assert "Totally Invented Affix Zzz" in err, err
    assert "not minted by anything this repo owns" in err, err


def test_374_a_minted_name_without_evidence_is_rejected():
    def _strip(t):
        t["local_affix_names"][0].pop("evidence")
    err = _raises_msg(V.IntegrityError, V.local_affix_names,
                      path=_registry_file(_strip))
    assert "carries no evidence" in err, err


def test_374_the_upstream_synonym_section_is_not_a_minting_source():
    """Only `local_affix_synonyms` mints. Upstream's own `affix_synonyms` section is
    upstream's vocabulary — treating it as a minting source would let any upstream
    fold silently widen what the gate accepts (KTD5's rejected alternative)."""
    renames, folds = V._minting_sources()
    upstream = {e["name"] for e in
                V._load(V.AFFIX_SYNONYMS_REGISTRY_PATH)["affix_synonyms"]}
    assert "Speed" in upstream, "fixture assumes the upstream section is populated"
    assert "Speed" not in folds and "Speed" not in renames


def test_374_the_local_names_union_is_now_load_bearing_not_a_no_op():
    """Was `…_is_a_no_op_before_the_refresh` — the nothing-changed guard U3 wrote to
    prove it moved no live behavior, stated as `local_affix_names ⊆ raw`.

    U4 vendored the data that arms it, so the sequencing the old name described has
    completed and the subset relation inverts: upstream no longer emits ANY of these
    spellings, so every minted name is absent from the raw-derived registry and the
    union is the only thing putting it back. Asserted as a partition (both halves),
    not a bare `not <=`, so a partially-armed refresh cannot pass either.
    """
    raw = set(V.generate_registries()["affix_names"])
    minted = set(V.local_affix_names())
    assert minted, "the section must not be empty"
    assert not (minted & raw), sorted(minted & raw)


# --- #229: no affix in the raw data is invisible to the registry gate ---------

def test_229_no_affix_shape_is_invisible_to_the_registry_walk():
    """The completeness claim, asserted rather than dated.

    `iter_affixes` used to require name+type+value, and gear-planner omits `type`
    entirely for an untyped affix. 90 affix dicts across 23 distinct names were
    therefore invisible to `generate_registries` AND to
    `check_referential_integrity` — so an untyped affix could arrive on a re-import
    with no new-name event, which is the one thing that gate exists to prevent. A
    gate blind to a whole SHAPE of record does not report a gap; it reports success.

    This compares the gate's walk against a deliberately looser one over the same
    raw sources. Any name the loose walk finds and the gate's does not is a shape
    the registry cannot see, and the answer must be zero — not "zero as of a date".
    """
    items, crafting, sets = V._load(V.ITEMS_PATH), V._load(V.CRAFTING_PATH), V._load(V.SETS_PATH)

    def loose(obj):
        if isinstance(obj, dict):
            if "name" in obj and "value" in obj:
                yield obj
            else:
                for v in obj.values():
                    yield from loose(v)
        elif isinstance(obj, list):
            for v in obj:
                yield from loose(v)

    gate, everything = set(), set()
    for src in (items, crafting, sets):
        gate.update(a["name"] for a in V.iter_affixes(src) if isinstance(a.get("name"), str))
        everything.update(a["name"] for a in loose(src) if isinstance(a.get("name"), str))

    assert len(everything) > 1000, "premise: the walk inspects a real population"
    missing = sorted(everything - gate)
    assert not missing, (
        f"{len(missing)} affix name(s) are invisible to the registry gate: {missing[:8]}. "
        "An affix shape the gate cannot walk is one it cannot validate, so a new name "
        "in that shape arrives with no new-name event.")


def test_229_the_untyped_names_are_actually_in_the_frozen_registry():
    """The other half: seeing them is worthless if they were never written down.

    Spot-checked against real untyped enchantments rather than the whole set, so
    this states a fact about the data instead of restating the regenerate.
    """
    frozen = set(V._load(V.VOCAB_REGISTRIES_PATH)["affix_names"])
    for name in ("Sunburst", "Draining", "Stumbling", "Eldritch", "Radiant Glory"):
        assert name in frozen, f"{name!r} is an untyped affix still missing from the registry"


def test_229_the_integrity_gate_reads_the_FROZEN_registry_not_a_fresh_generate():
    """A baseline regenerated from the raw it is about to validate cannot fail.

    `check_referential_integrity`'s own docstring says so — "regenerating from the
    same raw would be tautological" — yet the test that exercised it on real data
    passed exactly that. This asserts the property directly: a name present in the
    raw but ABSENT from the frozen registry must raise, which is impossible to
    detect with a self-derived baseline.
    """
    frozen = V._load(V.VOCAB_REGISTRIES_PATH)
    alias_map, _ = V.load_affix_aliases()
    shrunk = dict(frozen)
    shrunk["affix_names"] = [n for n in frozen["affix_names"] if n != "Sunburst"]
    items = {"items": [{"name": "Some Item", "affixes": [{"name": "Sunburst", "value": "1"}]}]}
    _raises(V.IntegrityError, V.check_referential_integrity,
            items, {}, {}, shrunk, alias_map)
    # and with the real frozen registry it resolves, so the failure above is about
    # the missing entry rather than about untyped affixes being rejected wholesale.
    assert V.check_referential_integrity(items, {}, {}, frozen, alias_map) == 1
