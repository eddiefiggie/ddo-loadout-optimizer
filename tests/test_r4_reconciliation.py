"""U5 — the R4 completeness gate (KTD4 + KTD6).

Every ML30-36 band item in the three target sets must reach exactly one terminal
state: solver-active in the built dataset (enriched or already-enriched via another
pipeline) OR quarantined with a reason. A silently-missing band item is a defect.
Reconciles against the FULL built dataset, never just the R4 shards.
"""
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import build_dataset as B
from src import band_frontier as bf


def _active_names_from_build():
    ds = B.build(B.load_seed())
    names = {(it.get("source_item") or it.get("variant_id") or it.get("name"))
             for it in ds["items"]}
    names.discard(None)
    return names, ds


def test_every_band_item_is_terminal():
    active, _ = _active_names_from_build()
    cov = bf.band_coverage(active)
    t = cov["totals"]
    # KTD4: nothing silently missing.
    assert t["pending"] == 0, f"{t['pending']} band items neither enriched nor quarantined"
    # Terminal partition reconciles with the band total.
    assert t["enriched"] + t["quarantined"] == t["band_total"]
    # Per (expansion, slot) also reconciles.
    for key, c in cov["by_slot"].items():
        assert c["enriched"] + c["quarantined"] + c["pending"] == c["band_total"], key


def test_gate_has_teeth():
    # Drop one band item from the active set: reconciliation must report it pending.
    active, _ = _active_names_from_build()
    worklist, _ = bf.build_worklist()
    victim = next(w["name"] for w in worklist)
    broken = bf.band_coverage(active - {victim})
    assert broken["totals"]["pending"] >= 1, "removing an active band item should surface as pending"


def test_no_r4_name_double_lists_in_the_built_dataset():
    # KTD6: each R4-enriched name appears exactly once among source_item keys.
    import glob, json
    from collections import Counter
    _, ds = _active_names_from_build()
    c = Counter((it.get("source_item") or it.get("variant_id") or it.get("name")) for it in ds["items"])
    for f in glob.glob(os.path.join(ROOT, "data", "seed", "compendium", "enriched_r4_*.json")):
        for it in json.load(open(f, encoding="utf-8"))["items"]:
            assert c[it["name"]] == 1, f"{it['name']} appears {c[it['name']]}x (double-listed)"


def test_build_time_within_interactive_bar():
    # Coarse dataset-build benchmark (proxy for the interactive rebuild cost with the
    # band populated). Not the in-browser HiGHS solve; recorded for regression watch.
    t0 = time.perf_counter()
    B.build(B.load_seed())
    dt = time.perf_counter() - t0
    print(f"[benchmark] dataset build with R4 band populated: {dt*1000:.0f} ms")
    assert dt < 30.0, f"dataset build unexpectedly slow: {dt:.1f}s"
