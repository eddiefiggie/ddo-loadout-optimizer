"""U6 — the R4 endgame-band reconciliation gate (native-roster edition).

The ML30-36 band is now derived from the built NATIVE roster (single source of
truth). Under single-source completeness every band item is solver-active, so the
reconciliation is: the band coverage must partition entirely into `enriched`
(no `pending`, no `quarantined`), and it must equal an independent recount of the
native ML30-36 (+ Dino) roster. Reconciles against the FULL built dataset —
native roster vs. band, never a wiki shard vs. the band.
"""
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import build_dataset as B
from src import band_frontier as bf


def _build():
    return B.build(B.load_seed())


def _native_band_names(items):
    """Independent recount of the band straight off the native roster (dedup by
    source_item): ML30-36 OR a Dinosaur Bone (Isle of Dread) host."""
    seen = {}
    for it in items:
        si = it.get("source_item")
        if si and si not in seen:
            seen[si] = it
    names = set()
    for si, it in seen.items():
        ml = it.get("ml")
        in_ml = isinstance(ml, (int, float)) and 30 <= ml <= 36
        if in_ml or "Dinosaur_Bone" in (it.get("wiki_url") or ""):
            names.add(si)
    return names


def test_every_band_item_is_enriched():
    ds = _build()
    cov = bf.band_coverage(ds["items"])
    t = cov["totals"]
    # Single-source completeness: nothing pending, nothing quarantined.
    assert t["pending"] == 0, f"{t['pending']} band items unexpectedly pending"
    assert t["quarantined"] == 0, f"{t['quarantined']} band items unexpectedly quarantined"
    # The band partitions entirely into enriched.
    assert t["enriched"] == t["band_total"]
    # Per (expansion, slot) also reconciles.
    for key, c in cov["by_slot"].items():
        assert c["enriched"] + c["quarantined"] + c["pending"] == c["band_total"], key
        assert c["pending"] == 0 and c["quarantined"] == 0, key


def test_band_reconciles_with_native_roster():
    # native roster vs band: the coverage total equals an independent recount off
    # the native roster, and Isle of Dread is the only attributed expansion.
    ds = _build()
    cov = bf.band_coverage(ds["items"])
    expected = _native_band_names(ds["items"])
    assert cov["totals"]["band_total"] == len(expected)
    assert cov["attributed"] + cov["unattributed"] == cov["totals"]["band_total"]
    assert cov["expansions_attributed"] == ["isle_of_dread"]


def test_gate_has_teeth():
    # Drop one band item from the native roster: the band total must fall by one.
    ds = _build()
    full = bf.band_coverage(ds["items"])
    victim = next(iter(_native_band_names(ds["items"])))
    fewer = bf.band_coverage([it for it in ds["items"] if it.get("source_item") != victim])
    assert fewer["totals"]["band_total"] == full["totals"]["band_total"] - 1


def test_no_r4_name_double_lists_in_the_built_dataset():
    # KTD6: each R4-enriched name appears exactly once among source_item keys.
    import glob, json
    from collections import Counter
    ds = _build()
    c = Counter((it.get("source_item") or it.get("variant_id") or it.get("name")) for it in ds["items"])
    for f in glob.glob(os.path.join(ROOT, "data", "seed", "compendium", "enriched_r4_*.json")):
        for it in json.load(open(f, encoding="utf-8"))["items"]:
            assert c[it["name"]] == 1, f"{it['name']} appears {c[it['name']]}x (double-listed)"


def test_build_time_within_interactive_bar():
    # Coarse dataset-build benchmark (proxy for the interactive rebuild cost).
    t0 = time.perf_counter()
    _build()
    dt = time.perf_counter() - t0
    print(f"[benchmark] dataset build (native band): {dt*1000:.0f} ms")
    assert dt < 30.0, f"dataset build unexpectedly slow: {dt:.1f}s"
