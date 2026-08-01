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
    return build_dataset.build(build_dataset.load_seed())


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
