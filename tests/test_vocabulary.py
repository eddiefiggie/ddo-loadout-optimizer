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
    # a normal type is its own bucket, verbatim
    assert V.stacking_bucket("Insight", eq) == "Insight"
    assert V.stacking_bucket("Enhancement", eq) == "Enhancement"


def test_freshness_reads_and_detects_drift():
    recorded = V.assert_freshness()
    assert recorded == "ec3e595d0d879b29c13f3c34ffc155e71d0418c4"
    # a wrong expected commit surfaces drift
    _raises(V.FreshnessError, V.assert_freshness, expected_commit="deadbeef")
