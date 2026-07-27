"""Tests for the bulk ML>=29 gear-planner item import (enriched_planner_ml29.json)."""
import glob
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

COMP = os.path.join(ROOT, "data", "seed", "compendium")
SHARD = os.path.join(COMP, "enriched_planner_ml29.json")


def _shard():
    return json.load(open(SHARD, encoding="utf-8"))


def test_bulk_shard_exists_and_spans_all_levels():
    # Full-import (all levels): the bulk shard now covers every ML, not just endgame.
    d = _shard()
    real = [x for x in d["items"] if not x.get("_seal_carrier")]
    assert len(real) > 4000, f"expected the full all-levels import, got {len(real)}"
    mls = [it.get("minimum_level", 0) for it in real]
    assert min(mls) < 29 and max(mls) >= 29, "the shard should span sub-endgame and endgame MLs"


def test_no_planner_name_collides_with_prior_shards():
    # A bulk-import name must not duplicate a prior (non-planner) enriched shard —
    # build_dataset's name-dedup would silently drop one and it would double-list.
    prior = set()
    for f in glob.glob(os.path.join(COMP, "enriched_*.json")):
        if os.path.basename(f) == "enriched_planner_ml29.json":
            continue
        for it in json.load(open(f, encoding="utf-8")).get("items", []):
            if it.get("name"):
                prior.add(it["name"])
    seen = set()
    for it in _shard()["items"]:
        if it.get("_seal_carrier"):
            continue
        n = it["name"]
        assert n not in prior, f"planner name {n!r} collides with a prior shard"
        assert n not in seen, f"planner name {n!r} duplicated within the bulk shard"
        seen.add(n)


def test_real_records_carry_a_rankable_affix_or_seal():
    for it in _shard()["items"]:
        if it.get("_seal_carrier"):
            continue
        real = [e for e in it.get("enhancements", []) if not e.endswith("Augment Slot")]
        assert real or it.get("seal_slots"), f"{it['name']} has neither a rankable affix nor a seal"


def test_set_members_carry_a_set_marker():
    # U2: a gear-planner set member gets the same "X (set)" marker enrich.py emits, so
    # build_dataset can attach its set_bonus; a non-member gets none.
    items = [x for x in _shard()["items"] if not x.get("_seal_carrier")]
    def markers(it):
        return [e for e in it.get("enhancements", []) if str(e).endswith("(set)")]
    with_marker = [it for it in items if markers(it)]
    assert len(with_marker) > 100, "expected many gear-planner set members to carry a (set) marker"
    adam = next((it for it in items if it["name"] == "Adamantine Bracers"), None)
    assert adam and "Eminence of Winter (set)" in adam["enhancements"]
    memento = next((it for it in items if it["name"] == "A Memento of Mori"), None)
    if memento:
        assert not markers(memento), "a non-set item should carry no (set) marker"


def test_seal_carriers_are_seal_only_stubs():
    for it in _shard()["items"]:
        if it.get("_seal_carrier"):
            assert it.get("seal_slots"), "a seal carrier must carry a seal slot"
            assert not it.get("enhancements"), "a seal carrier must not carry affixes (body stub only)"


def test_bulk_items_reach_the_built_dataset_without_double_listing():
    ds_path = os.path.join(ROOT, "web", "data", "items.json")
    if not os.path.exists(ds_path):
        return
    from collections import Counter
    its = json.load(open(ds_path, encoding="utf-8")).get("items", [])
    c = Counter((it.get("source_item") or it.get("variant_id") or it.get("name")) for it in its)
    # no seal-carrier stub leaks in as a solver item
    assert not any(it.get("_seal_carrier") for it in its)
    real = [x for x in _shard()["items"] if not x.get("_seal_carrier")]
    present = sum(1 for x in real if c[x["name"]] >= 1)
    assert present == len(real), f"{len(real) - present} bulk items missing from the dataset"
    assert all(c[x["name"]] == 1 for x in real), "a bulk item is double-listed"
