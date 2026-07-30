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


def test_shipping_seed_is_populated_from_verified_wiki_roster():
    # The seed is harvested from the DDO wiki Minor Artifact categories. Every
    # entry is a verified base-item name; the _README doc line is filtered out.
    names = bd.load_artifacts()
    assert len(names) >= 90, "expected the harvested Minor Artifact roster"
    assert "Baphomet's Reign" in names, "a known Minor Artifact is present"
    assert not any(n.startswith("_") for n in names), "the _README doc line is filtered"


def test_a_real_artifact_item_is_flagged_in_the_built_dataset():
    # End-to-end: a known Minor Artifact present in our dataset gets artifact:true.
    out = bd.build(bd.load_seed())
    flagged = {v["source_item"] for v in out["items"] if v.get("artifact")}
    assert len(flagged) >= 50, "the harvested roster flags real items"
    assert "Baphomet's Reign" in flagged
