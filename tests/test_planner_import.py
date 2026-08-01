"""Integration tests for the gear-planner bulk import (the sole item roster).

The gear-planner catalog (`raw/gearplanner_items.json`) is read directly with
native affixes via `src.planner_items`. These tests cover reader-to-built-dataset
integration; `test_planner_items.py` covers the reader's mapping in detail. The
legacy base-seed merge + wiki-shard union were purged in U7 (gear-planner is the
single authority)."""
import os
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import planner_items as P  # noqa: E402


def _reader():
    return P.load_planner_items()


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


def test_records_carry_value_apart_from_a_tiny_empty_tail():
    # Nearly every record must contribute something: a native affix, a seal/set
    # marker, an augment slot, or a host choice-slot marker. A handful of raw
    # catalog placeholders are genuinely empty; guard the empty tail stays tiny.
    recs, _ = _reader()
    empty = [r["name"] for r in recs
             if not (r["affixes"] or r.get("seal_slots") or r["enhancements"]
                     or r["augment_slots"] or r.get("lamordia_slots")
                     or r.get("nearly_complete") or r.get("lost_purpose"))]
    assert len(empty) < 20, f"{len(empty)} empty records — reader likely dropped content: {empty[:10]}"


def _built_items():
    import build_dataset
    return build_dataset.build()["items"]


def test_no_variant_id_is_double_listed_in_the_built_dataset():
    # The Dinosaur Bone hosts (synthetic dino_blanks generated post-dedup) are the
    # known KTD8 trap — a same-name reader record would collide with an identical
    # variant_id. Guard the end state: every variant_id is unique.
    its = _built_items()
    dupes = [v for v, c in Counter(it["variant_id"] for it in its).items() if c > 1]
    assert not dupes, f"{len(dupes)} double-listed variant_ids: {dupes[:8]}"


def test_reader_names_reach_the_built_dataset():
    # Every gear-planner name is present in the built roster (won by the reader or
    # owned by its host-pipeline seed) — no dropped names.
    its = _built_items()
    present = {it.get("source_item") or it.get("variant_id") or it.get("name") for it in its}
    recs, _ = _reader()
    # names excluded because a synthetic host-pipeline body owns the slot
    _, stats = P.load_planner_items(exclude_names=set())
    missing = [r["name"] for r in recs if r["name"] not in present]
    # only the Dinosaur Bone host names (owned by the synthetic dino blanks) may be absent
    assert all("Dino" in m or "Bone" in m for m in missing), \
        f"unexpected gear-planner names missing from the dataset: {missing[:8]}"


def test_native_affixes_carry_no_parser_garbage():
    # gear-planner affixes are structured + clean at the source; the free-text
    # parser garbage vocabulary (Bal/INT/OL/DD/UMD) the retired wiki shards leaked
    # must never appear on a native item.
    its = _built_items()
    stats = {a.get("name") or a.get("stat") for it in its for a in it.get("affixes") or []}
    for junk in ("Bal", "INT", "OL", "DD", "UMD"):
        assert junk not in stats, f"native affixes carry garbage stat {junk!r}"
