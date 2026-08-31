"""#359 — wiki-sourced augment acquirability, and the guard on its join."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import augment_acquirability as aa  # noqa: E402

SEED = os.path.join(ROOT, "data", "seed", "compendium", "augment_acquirability.json")
DATASET = os.path.join(ROOT, "web", "data", "items.json")


def _aug(name, **kw):
    return dict({"variant_id": name, "category": "augment"}, **kw)


def test_seed_loads_and_is_a_real_population():
    acq = aa.load(SEED)
    assert len(acq) == 675, len(acq)
    # Spot-check both classes the taxonomy separates.
    assert "Diamond of Constitution +12" in acq          # Common: vendor / Remnant
    assert "Ruby Eye of the Inferno" in acq              # Uncommon
    assert "Meteoric Star Ruby" in acq                   # Rare
    assert "Essence of the Epic Litany of the Dead" not in acq   # Named: must be owned


def test_missing_file_is_an_empty_overlay_not_a_crash():
    assert aa.load(os.path.join(ROOT, "does-not-exist.json")) == set()


def test_apply_stamps_only_seeded_augments_and_leaves_others_unmarked():
    """Absence is the signal — an unseeded augment carries NO field.

    Writing `acquirable: False` across the pool would make "we have not
    classified this" and "we classified this as drop-only" indistinguishable.
    """
    recs = [_aug("Diamond of Constitution +12"), _aug("Essence of The Masque"),
            {"variant_id": "Some Ring", "category": "item"}]
    cov = aa.apply(recs, {"Diamond of Constitution +12"})
    assert recs[0]["acquirable"] is True
    assert "acquirable" not in recs[1]
    assert "acquirable" not in recs[2], "a non-augment is never stamped"
    assert cov == {"augments": 2, "stamped": 1, "seed_size": 1}


def test_assert_join_passes_when_every_seeded_name_lands():
    aa.assert_join({"augments": 2, "stamped": 1, "seed_size": 1}, SEED)


def test_assert_join_fails_when_a_seeded_name_reaches_nothing():
    """The drift this guard exists for: an upstream rename silently moves an
    augment from 'acquirable' to 'must own', shrinking owned mode's pool."""
    try:
        aa.assert_join({"augments": 900, "stamped": 674, "seed_size": 675}, SEED)
    except SystemExit as e:
        assert "reached no augment record" in str(e)
        assert "re-harvest" in str(e), "the message says what to do, not just that it broke"
    else:
        raise AssertionError("a short join must fail the build")


def test_assert_join_refuses_to_inspect_an_empty_catalog():
    try:
        aa.assert_join({"augments": 0, "stamped": 0, "seed_size": 675}, SEED)
    except SystemExit as e:
        assert "no augment records at all" in str(e)
    else:
        raise AssertionError("a zero-augment catalog must not read as a clean join")


def test_no_overlay_shipped_is_not_an_error():
    aa.assert_join({"augments": 900, "stamped": 0, "seed_size": 0}, SEED)


def test_shipped_dataset_join_is_complete():
    """Against the built catalog: every seeded name reaches a real augment.

    This was exact at harvest (675/675). It is asserted rather than sampled
    because a partial join is precisely the silent shrinkage the feature must
    not have.
    """
    if not os.path.exists(DATASET):
        return
    with open(DATASET, encoding="utf-8") as fh:
        d = json.load(fh)
    acq = aa.load(SEED)
    augs = [v for v in d["items"] if v.get("category") == "augment"]
    stamped = [v for v in augs if v.get("acquirable")]
    ids = {v.get("variant_id") for v in augs}
    assert acq, "the guard inspects a real seed"
    assert len(stamped) == len(acq) == 675
    assert not (acq - ids), f"seeded names missing from the catalog: {sorted(acq - ids)[:5]}"
    # And the complement is real: most augments are drop-specific.
    # #631 — re-ratified 388 -> 469. PLUS 81, the Epic (ML 20) Lunar/Solar gems the
    # tier-gap shard adds. They are unstamped because NO Lunar/Solar gem is stamped:
    # all 304 of them sit outside the 675-name acquirability seed, the 223 that
    # predate the shard included. So this delta is the complement growing with the
    # catalog, not the join shrinking — `stamped` is asserted unchanged at 675 two
    # lines above, which is what tells the two apart.
    assert len(augs) - len(stamped) == 469, len(augs) - len(stamped)
    assert d["metadata"]["augment_acquirable_count"] == 675
    assert d["metadata"]["augment_total_count"] == len(augs)
