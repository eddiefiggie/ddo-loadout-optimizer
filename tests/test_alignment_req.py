"""U3 — alignment equip-gate stamping.

The build stamps a structured `alignment_req` field onto variants whose base
item has a curated alignment equip-gate (exclude-until-verified). These tests
exercise the pure loader + stamp helpers with synthetic data — the shipping
seed is intentionally empty until wiki-verified curation, so nothing real is
stamped yet and the JS gate fails open."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import build_dataset as bd  # noqa: E402


def test_stamp_marks_only_seeded_items():
    variants = [
        {"source_item": "Litany of the Dead"},
        {"source_item": "Cloak of Night"},
    ]
    n = bd.stamp_alignment_req(
        variants, {"Litany of the Dead": ["Lawful Good", "Lawful Neutral"]})
    assert n == 1
    assert variants[0]["alignment_req"] == ["Lawful Good", "Lawful Neutral"]
    assert "alignment_req" not in variants[1]  # unseeded -> no field (fail-open)


def test_stamp_covers_all_variants_of_a_seeded_base_item():
    variants = [
        {"source_item": "Foo", "variant_id": "Foo"},
        {"source_item": "Foo", "variant_id": "Foo (Legendary)"},
    ]
    n = bd.stamp_alignment_req(variants, {"Foo": ["Chaotic Good"]})
    assert n == 2
    assert all(v["alignment_req"] == ["Chaotic Good"] for v in variants)


def test_loader_ignores_underscore_keys_and_empty_lists():
    restr = bd.load_alignment_restrictions()  # the real shipping seed
    # shipping seed is curated-empty: no README/example keys leak through, and
    # every value is a non-empty list of alignments.
    assert all(not k.startswith("_") for k in restr)
    assert all(isinstance(v, list) and v for v in restr.values())


def test_shipping_seed_is_empty_until_verified():
    # Guards the exclude-until-verified contract: no unverified gates shipped.
    assert bd.load_alignment_restrictions() == {}
