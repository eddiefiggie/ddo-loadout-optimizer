"""U4 — verification gate + coverage tests."""
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.variants import expand_dataset  # noqa: E402
from src import verify as V  # noqa: E402
from src import planner_items as P  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")


def _variants():
    # gear-planner is the sole roster (U7); the base seed was purged.
    recs, _ = P.load_planner_items(verified_seal_types=set())
    return expand_dataset(recs)


def test_native_affix_item_is_verified_and_eligible():
    # A gear-planner item with a real magnitude affix must verify and mark its
    # eligible affixes.
    v = next(x for x in _variants()
             if any(a.get("bonus_type") not in (None, "Bool", "boolean")
                    and isinstance(a.get("value"), int) for a in x["affixes"]))
    V.verify_variant(v)
    assert v["verification"] == "verified"
    assert v["eligible_affix_count"] >= 1


def test_item_with_no_magnitude_is_quarantined_with_reason():
    variants = _variants()
    verified, _ = V.apply(variants)
    quarantined = [v for v in verified if v["verification"] == "quarantined"]
    assert quarantined, "expected some quarantined (value-less) records"
    assert all(v["eligible_affix_count"] == 0 for v in quarantined)
    assert all(v["verification_reasons"] for v in quarantined)


def test_boolean_only_item_verifies_via_its_presence_affix():
    # U2: an item whose only eligible content is a boolean presence affix must
    # verify (not quarantine) — the affix counts toward eligibility by list length,
    # bonus_type-agnostic.
    v = {"affixes": [{"stat": "Salt", "bonus_type": "boolean", "value": 1, "unit": "flat"}],
         "scaling": [], "flagged": []}
    V.verify_variant(v)
    assert v["verification"] == "verified"
    assert v["eligible_affix_count"] == 1
    assert v["affixes"][0]["eligible"] is True


def test_dino_blank_verifies_on_its_insert_slots_alone():
    # #338 — the Dinosaur Bone blanks now pass THROUGH this gate (they used to be
    # appended already-verified after it), so the gate has to admit them. A blank
    # ships an empty affix list by construction: no affixes, no scaling, no augment
    # colors, and — for the Set-Bonus hosts and the Weapon blank — no intrinsic set
    # either. Its whole value is the four typed insert slots the solver fills.
    #
    # Non-vacuous by construction: this record hits none of the other three admit
    # clauses, so without the Dino-slot clause it quarantines and leaves the solve.
    v = {"affixes": [], "scaling": [], "flagged": [],
         "dino_slots_norm": ["Scale||Accessory", "Fang||Accessory"]}
    V.verify_variant(v)
    assert v["verification"] == "verified"
    assert v["eligible_affix_count"] == 0
    assert any("insert slots" in r for r in v["verification_reasons"]), \
        "the reason names the dimension that carried it, never a bare pass"


def test_a_slotless_affixless_record_still_quarantines():
    # The companion half: the Dino clause admits on OPEN SLOTS, not on emptiness.
    # A record with nothing at all must still quarantine, or the clause above is a
    # hole that verifies every value-less record in the catalog.
    v = {"affixes": [], "scaling": [], "flagged": [], "dino_slots_norm": []}
    V.verify_variant(v)
    assert v["verification"] == "quarantined"


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
