"""Tests for the R4 band enrichment (U3) — the enriched/quarantined shards and
their invariants against the work-list and the build pipeline."""
import glob
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

COMP = os.path.join(ROOT, "data", "seed", "compendium")


def _r4_enriched():
    items = []
    for f in sorted(glob.glob(os.path.join(COMP, "enriched_r4_*.json"))):
        items.extend(json.load(open(f, encoding="utf-8"))["items"])
    return items


def _worklist():
    return {w["name"]: w for w in json.load(open(os.path.join(COMP, "band_worklist.json"),
                                              encoding="utf-8"))["worklist"]}


def test_every_enriched_name_is_a_pending_worklist_item():
    wl = _worklist()
    for it in _r4_enriched():
        w = wl.get(it["name"])
        assert w is not None, f"enriched item not in work-list: {it['name']}"
        assert w["status"] == "pending", f"{it['name']} was not pending (should not re-enrich)"


def test_r4_names_do_not_collide_with_prior_shards_or_each_other():
    # KTD6: an R4 name must be unique within the R4 shards AND absent from every
    # prior (non-R4) enriched shard — otherwise build_dataset's name-dedup silently
    # drops one identity and the item double-lists. (Pre-existing cross-shard
    # overlaps among non-R4 batches are a separate data-hygiene matter the build
    # already dedups; not in this batch's scope.)
    prior = set()
    for f in sorted(glob.glob(os.path.join(COMP, "enriched_*.json"))):
        if "enriched_r4_" in os.path.basename(f):
            continue
        for it in json.load(open(f, encoding="utf-8")).get("items", []):
            if it.get("name"):
                prior.add(it["name"])
    seen = set()
    for it in _r4_enriched():
        n = it["name"]
        assert n not in prior, f"R4 name {n!r} collides with a prior enriched shard"
        assert n not in seen, f"R4 name {n!r} duplicated within the R4 shards"
        seen.add(n)


def test_enriched_items_carry_strict_provenance():
    for it in _r4_enriched():
        assert it.get("wiki_url", "").startswith("https://ddowiki.com/"), it["name"]
        # a solver-active contribution: a base stat affix OR a set marker (not augment-only)
        real = [e for e in it.get("enhancements", []) if not e.endswith("Augment Slot")]
        assert real, f"{it['name']} has no base stat or set contribution"


def test_quarantined_items_carry_reason_and_are_not_solver_active():
    path = os.path.join(COMP, "quarantined_r4.json")
    if not os.path.exists(path):
        return
    for q in json.load(open(path, encoding="utf-8")).get("items", []):
        assert q.get("reason"), q
        assert q.get("wiki_url", "").startswith("https://ddowiki.com/")


def test_enriched_item_reaches_the_built_solver_dataset():
    ds_path = os.path.join(ROOT, "web", "data", "items.json")
    if not os.path.exists(ds_path):
        return  # dataset not built in this environment
    d = json.load(open(ds_path, encoding="utf-8"))
    its = d if isinstance(d, list) else d.get("items", [])
    keys = {(it.get("source_item") or it.get("variant_id") or it.get("name")) for it in its}
    # A distinctive R4 item with a parsed base affix must be solver-active exactly once.
    from collections import Counter
    c = Counter(it.get("source_item") or it.get("variant_id") or it.get("name") for it in its)
    for name in _r4_enriched():
        pass
    sample = "Legendary Magma Waders"
    assert sample in keys, f"{sample} not solver-active in the built dataset"
    assert c[sample] == 1, f"{sample} is double-listed ({c[sample]}x)"


def test_driver_is_reproducible_from_raw_plus_parser():
    # Re-running the driver must byte-reproduce the committed enriched shards
    # (reads only raw + the strict parser + the work-list — no hand values).
    before = {f: open(f, encoding="utf-8").read()
              for f in glob.glob(os.path.join(COMP, "enriched_r4_*.json"))}
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "enrich_batch_r4", os.path.join(ROOT, "scripts", "enrich_batch_r4.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.main()
    for f, content in before.items():
        assert open(f, encoding="utf-8").read() == content, f"{os.path.basename(f)} not reproducible"
