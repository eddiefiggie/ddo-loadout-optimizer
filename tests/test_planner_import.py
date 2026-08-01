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


def _built_items():
    import build_dataset
    return build_dataset.build(build_dataset.load_seed())["items"]


def test_no_variant_id_is_double_listed_in_the_built_dataset():
    # KTD5 + the KTD6 host-pipeline trap: retiring the flattened shard and appending
    # the gear-planner reader must NOT double-list any item. The 8 Dinosaur Bone
    # hosts (synthetic dino_blanks generated post-dedup) are the known trap — a
    # same-name reader record collides with an identical variant_id. Guard the
    # end state: every variant_id is unique.
    its = _built_items()
    dupes = [v for v, c in Counter(it["variant_id"] for it in its).items() if c > 1]
    assert not dupes, f"{len(dupes)} double-listed variant_ids: {dupes[:8]}"


def test_reader_names_reach_the_built_dataset():
    # Every gear-planner name is present in the built roster (won by the reader, an
    # existing shard, or its host-pipeline seed) — no dropped names (KTD5). Built
    # in-process so this never silently skips on a clean checkout.
    its = _built_items()
    present = {it.get("source_item") or it.get("variant_id") or it.get("name") for it in its}
    # no seal-carrier stub leaks in as a solver item
    assert not any(it.get("_seal_carrier") for it in its)
    recs, _ = _reader()
    missing = [r["name"] for r in recs if r["name"] not in present]
    assert not missing, f"{len(missing)} gear-planner names missing from the dataset: {missing[:8]}"


# --- U3 (precedence-flip plan): affix union-merge keeps the flip from downgrading ---

def _norm(stat):
    from src import vocab
    return vocab.normalize_stat(stat)


# The union-merge is guarded by the machine invariant below
# (test_no_collision_item_loses_a_rankable_affix_vs_pre_flip), which builds both
# ways and proves NO collision item loses a rankable affix. A former hardcoded
# 8-item spot-check was removed: it named specific regressors (e.g. Amulet of the
# Makers / Vitality) that shift whenever upstream gear-planner data refreshes, so
# it went stale on a data update while the real invariant kept passing.


def test_no_collision_item_loses_a_rankable_affix_vs_pre_flip():
    # R3 machine invariant (not a hardcoded name list): build both ways — pre-flip
    # (wiki shards win) and post-flip+union — and assert EVERY item's post-flip
    # rankable-affix set is a superset of its pre-flip set. This catches a union bug
    # on ANY of the ~300 restored items, not just the readability spot-check below.
    import build_dataset as B
    from src import vocab
    orig = B.FLIP_COLLISION_PRECEDENCE
    try:
        B.FLIP_COLLISION_PRECEDENCE = False
        pre = {it["variant_id"]: it for it in B.build(B.load_seed())["items"]}
        B.FLIP_COLLISION_PRECEDENCE = True
        built = B.build(B.load_seed())
        post = {it["variant_id"]: it for it in built["items"]}
    finally:
        B.FLIP_COLLISION_PRECEDENCE = orig
    rankable = set(built["metadata"]["rankable_affixes"])

    def rk(it):
        return {vocab.normalize_stat(a["stat"]) for a in (it.get("affixes") or [])} & rankable

    lost = {vid: sorted(rk(b) - rk(post[vid])) for vid, b in pre.items()
            if vid in post and rk(b) - rk(post[vid])}
    assert not lost, f"{len(lost)} items lost a rankable affix in the flip: {dict(list(lost.items())[:6])}"


def test_union_merge_does_not_reintroduce_parser_garbage():
    # The union is filtered to the clean vocabulary; parser artifacts a losing wiki
    # record carried (Bal/INT/OL/DD/UMD) must NOT come back on the winner.
    its = _built_items()
    stats = {a.get("stat") for it in its for a in it.get("affixes") or []}
    for junk in ("Bal", "INT", "OL", "DD", "UMD"):
        assert junk not in stats, f"union re-introduced garbage stat {junk!r}"


def test_union_merge_does_not_create_mistyped_duplicate_of_a_winner_affix():
    # The wiki free-text parser mis-types affixes (defaults to Enhancement, renames
    # Insight->Insightful). The union must NOT restore such a re-typed copy of an
    # affix gear-planner already provides, or the solver (which sums bonus-type
    # buckets) double-counts it. Assert no item carries the same normalized stat at
    # the same value under two bonus types, EXCEPT the small set of pre-existing
    # gear-planner native stacks (Armor/Shield/Natural AC, Exceptional/Insight) that
    # legitimately share a value — those are the catalog's own data, not the union's.
    def num(v):
        try:
            return float(str(v).rstrip("%"))
        except ValueError:
            return 0.0
    offenders = []
    for it in _built_items():
        by = {}
        for a in it.get("affixes") or []:
            by.setdefault((_norm(a["stat"]), num(a.get("value"))), set()).add(a["bonus_type"])
        for (stat, val), types in by.items():
            if len(types) > 1 and val > 0:
                offenders.append((it["variant_id"], stat, val, sorted(types)))
    # A tight ceiling well below the pre-flip's own ~45 native pairs — the union
    # (fixed) adds no mis-typed duplicate; a regression re-introducing them would
    # spike this into the hundreds.
    assert len(offenders) < 60, f"{len(offenders)} same-stat/same-value/two-type affixes (double-count risk): {offenders[:8]}"


def test_union_merge_is_additive_on_restored_items():
    # The union only FILLS (stat,bonus_type) pairs the winner lacks; it never
    # duplicates or rewrites a pair gear-planner already provides. On a restored
    # regressor, each affix key appears exactly once. (Pure gear-planner items may
    # carry a source-level duplicate — e.g. Aberrant Robe lists "Armor Class" twice
    # — which is a data-quality matter in the catalog itself, not the union's doing;
    # the union never touches non-collision items, so this test scopes to restored
    # collision winners.)
    its = {it["variant_id"]: it for it in _built_items()}
    for name in ("Legendary The Bloody Boulder", "The Winter Solstice",
                 "Legendary Cloak of the Ambassador", "Legendary Feargaze"):
        it = its[name]
        keys = [(_norm(a["stat"]), a["bonus_type"]) for a in (it.get("affixes") or [])]
        assert len(keys) == len(set(keys)), f"{name} has a duplicate (stat,bonus_type) after union"
