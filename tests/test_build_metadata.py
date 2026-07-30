"""U1 — catalog build identifier in dataset metadata.

The dataset build stamps a stable `build_id` (content hash of the roster) and a
`schema_version` into `metadata`, so a persisted loadout snapshot can detect a
stale catalog (plan R2/R6, KTD5). `build_id` must be deterministic for unchanged
input — the same seed rebuilds to the same id — so staleness is real drift, not
build-run noise.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import build_dataset  # noqa: E402


def _build():
    return build_dataset.build(build_dataset.load_seed())


def test_metadata_carries_build_id_and_schema_version():
    meta = _build()["metadata"]
    assert meta.get("schema_version") == 1, meta.get("schema_version")
    build_id = meta.get("build_id")
    assert isinstance(build_id, str) and len(build_id) >= 16, build_id
    # hex digest
    int(build_id, 16)


def test_build_id_is_stable_for_unchanged_seed():
    a = _build()["metadata"]["build_id"]
    b = _build()["metadata"]["build_id"]
    assert a == b, (a, b)
