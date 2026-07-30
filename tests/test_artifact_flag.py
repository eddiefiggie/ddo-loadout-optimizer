"""U1 — Artifact item-quality flag stamping.

The build stamps a boolean `artifact` field onto variants whose base item
(source_item) is a curated Artifact (exclude-until-verified). These tests
exercise the pure loader + stamp helpers with synthetic data — the shipping
seed is intentionally empty until a wiki harvest, so nothing real is stamped
yet and the JS opt-in treats every variant as non-Artifact."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import build_dataset as bd  # noqa: E402


def test_stamp_marks_only_seeded_items():
    variants = [
        {"source_item": "The Legendary Family Blade"},
        {"source_item": "Cloak of Night"},
    ]
    n = bd.stamp_artifact(variants, {"The Legendary Family Blade"})
    assert n == 1
    assert variants[0]["artifact"] is True
    assert "artifact" not in variants[1]  # unseeded -> no field (non-Artifact)


def test_stamp_covers_all_tiers_of_a_seeded_base_item():
    # The seed keys on source_item, which every tier variant shares, so all
    # tiers of one Artifact base item get flagged.
    variants = [
        {"source_item": "Foo", "variant_id": "Foo"},
        {"source_item": "Foo", "variant_id": "Foo (Legendary)"},
    ]
    n = bd.stamp_artifact(variants, {"Foo"})
    assert n == 2
    assert all(v["artifact"] is True for v in variants)


def test_stamp_handles_missing_source_item():
    variants = [{"variant_id": "no-source"}]  # no source_item key
    n = bd.stamp_artifact(variants, {"Foo"})
    assert n == 0
    assert "artifact" not in variants[0]


def test_loader_reads_array_ignoring_noise():
    # A future-populated seed is a flat array of names; non-string and
    # underscore-prefixed entries are dropped.
    import json
    import tempfile

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump(["Artifact A", "Artifact B", "_note", "", 42], fh)
        path = fh.name
    try:
        names = bd.load_artifacts(path)
        assert names == {"Artifact A", "Artifact B"}
    finally:
        os.unlink(path)


def test_loader_missing_file_is_empty_set():
    assert bd.load_artifacts("/nonexistent/artifacts.json") == set()


def test_shipping_seed_is_empty_until_verified():
    # Guards the exclude-until-verified contract: no unverified Artifacts shipped,
    # so the feature is wired but inert until the seed is populated (KTD1).
    assert bd.load_artifacts() == set()
