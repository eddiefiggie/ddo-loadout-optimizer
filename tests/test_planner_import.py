"""Integration tests for the gear-planner bulk import.

The flattened `enriched_planner_ml29.json` shard was retired (U3); the gear-planner
catalog (`raw/gearplanner_items.json`) is now read directly with structured affixes
via `src.planner_items`. These tests cover the reader-to-built-dataset integration;
`test_planner_items.py` covers the reader's mapping in detail.
"""
import json
import os
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import planner_items as P  # noqa: E402

BOOL_SEED = os.path.join(ROOT, "data", "seed", "boolean_features.json")


def _allow():
    raw = json.load(open(BOOL_SEED, encoding="utf-8"))
    return [s for s in raw if isinstance(s, str) and not s.startswith("_")]


def _reader():
    return P.load_planner_items(boolean_allowlist=_allow())


def test_import_spans_all_levels():
    recs, _ = _reader()
    assert len(recs) > 4000, f"expected the full all-levels catalog, got {len(recs)}"
    mls = [r.get("minimum_level") or 0 for r in recs]
    assert min(mls) < 29 and max(mls) >= 29, "should span sub-endgame and endgame MLs"


def test_reader_emits_no_duplicate_names():
    recs, _ = _reader()
    names = [r["name"] for r in recs]
    assert len(names) == len(set(names)), "reader must not emit duplicate names"


def test_set_members_carry_a_set_marker():
    recs, _ = _reader()
    by_name = {r["name"]: r for r in recs}
    with_marker = [r for r in recs if any(str(e).endswith("(set)") for e in r["enhancements"])]
    assert len(with_marker) > 100, "expected many gear-planner set members to carry a (set) marker"
    adam = by_name.get("Adamantine Bracers")
    assert adam and "Eminence of Winter (set)" in adam["enhancements"]


def test_records_carry_solver_value_apart_from_a_tiny_empty_tail():
    # Nearly every record must contribute something: a structured affix, a seal/set
    # marker, an augment slot (verify.py treats an augment-slot-only host as valid —
    # "value is its open slots"), or a disclosed quarantined affix. A handful of raw
    # catalog placeholders ("Trinket [Crafted]") are genuinely empty and get
    # quarantined downstream; guard that the empty tail stays tiny (a reader bug
    # would blank out thousands).
    recs, _ = _reader()
    empty = [r["name"] for r in recs
             if not (r["structured_affixes"] or r.get("seal_slots") or r["enhancements"]
                     or r["augment_slots"] or r["structured_flagged"])]
    assert len(empty) < 10, f"{len(empty)} empty records — reader likely dropped content: {empty[:10]}"


def test_reader_names_reach_the_built_dataset_exactly_once():
    ds_path = os.path.join(ROOT, "web", "data", "items.json")
    if not os.path.exists(ds_path):
        return  # dataset not built in this environment
    its = json.load(open(ds_path, encoding="utf-8")).get("items", [])
    # no seal-carrier stub leaks in as a solver item
    assert not any(it.get("_seal_carrier") for it in its)
    counts = Counter(it.get("source_item") or it.get("variant_id") or it.get("name")
                     for it in its)
    recs, _ = _reader()
    # every gear-planner name is present (won by gear-planner or an existing shard)
    # and never double-listed (name-keyed dedup keeps exactly one body per name)
    missing = [r["name"] for r in recs if counts[r["name"]] < 1]
    assert not missing, f"{len(missing)} gear-planner names missing from the dataset"
    doubled = [r["name"] for r in recs
               if len({it.get("tier_label") for it in its
                       if (it.get("source_item") == r["name"])}) == 0 and counts[r["name"]] > 1]
    # (tiered items legitimately expand to >1 variant; only untiered double-listing is a bug)
    assert not doubled, f"a gear-planner item is double-listed: {doubled[:5]}"
