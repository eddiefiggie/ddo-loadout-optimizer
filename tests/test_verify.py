"""U4 — verification gate + coverage tests."""
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.variants import expand_dataset  # noqa: E402
from src import verify as V  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
SEED = os.path.join(ROOT, "data", "seed", "ddo_items.json")


def _variants():
    d = json.load(open(SEED, encoding="utf-8"))
    return expand_dataset(d["items"])


def test_item_with_incidental_bad_line_stays_eligible():
    # Silver Pocketwatch has clean stat lines plus noise; must be verified and
    # contribute its clean affixes.
    v = [x for x in _variants() if x["source_item"] == "Silver Pocketwatch"][0]
    V.verify_variant(v)
    assert v["verification"] == "verified"
    assert v["eligible_affix_count"] >= 1
    assert all(a.get("eligible") for a in v["affixes"])


def test_item_with_no_magnitude_is_quarantined_with_reason():
    variants = expand_dataset(json.load(open(SEED, encoding="utf-8"))["items"])
    verified, _ = V.apply(variants)
    quarantined = [v for v in verified if v["verification"] == "quarantined"]
    assert quarantined, "expected some quarantined (value-less) records"
    assert all(v["eligible_affix_count"] == 0 for v in quarantined)
    assert all(v["verification_reasons"] for v in quarantined)


def test_coverage_counts_sum_to_variant_count():
    verified, cov = V.apply(_variants())
    assert cov["totals"]["verified"] + cov["totals"]["quarantined"] == len(verified)
    slot_sum = sum(b["verified"] + b["quarantined"] for b in cov["by_slot"].values())
    assert slot_sum == len(verified)


def test_quarantined_records_remain_in_dataset():
    verified, cov = V.apply(_variants())
    # quarantined records are present (for browse), not dropped
    assert cov["totals"]["quarantined"] > 0
    assert any(v["verification"] == "quarantined" for v in verified)


def test_build_dataset_end_to_end_produces_verified_and_coverage():
    # Run the full pipeline and inspect the artifact.
    subprocess.run([sys.executable, "build_dataset.py"], cwd=ROOT, check=True,
                   capture_output=True)
    out = json.load(open(os.path.join(ROOT, "web", "data", "items.json"), encoding="utf-8"))
    assert out["metadata"]["pipeline_stage"]  # a non-empty stage label
    assert "coverage" in out["metadata"]
    assert "color_coverage" in out["metadata"]  # U2 augment-color normalization
    assert all("verification" in v for v in out["items"])
    assert all("affixes" in v for v in out["items"])
    # more variants than seed items (tier expansion)
    assert out["metadata"]["variant_count"] >= out["metadata"]["seed_count"]
