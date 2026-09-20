"""#270 — the crafted-option identity handle, guarded on the BUILT dataset.

The blocklist names an item by `variant_id`. A crafted option has none, so
"never craft this one" was inexpressible while the options themselves were
reachable. These pin the two properties the gate depends on: every option row
carries a key, and no two rows share one.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import craft_identity as ci  # noqa: E402

DATASET = os.path.join(ROOT, "web", "data", "items.json")


def _dataset():
    with open(DATASET, encoding="utf-8") as fh:
        return json.load(fh)


def _all_rows(ds):
    """`(pool, host, row)` for every craftable option row the dataset ships."""
    for pool in ci.FLAT_POOLS:
        for rec in ds.get(pool) or []:
            yield pool, None, rec
    for host, rows in (ds.get(ci.PER_ITEM_POOL) or {}).items():
        for rec in rows or []:
            yield ci.PER_ITEM_POOL, host, rec


def test_every_option_row_carries_a_key():
    ds = _dataset()
    rows = list(_all_rows(ds))
    assert rows, "no option rows found — nothing was inspected"
    missing = [(p, h, r.get("name")) for p, h, r in rows if not r.get(ci.KEY_FIELD)]
    assert not missing, f"option rows with no {ci.KEY_FIELD}: {missing[:5]}"


def test_no_two_options_share_a_key():
    """A shared key means blocking one option silently blocks another.

    This is not hypothetical: the design recorded on #270 named six
    discriminators, and measured against the built dataset they produced twelve
    duplicates — every one a quarterstaff variant carrying EXTRA affixes under
    the same name. `POOL_KEY` includes the flag for exactly that reason.
    """
    ds = _dataset()
    seen = {}
    for pool, host, rec in _all_rows(ds):
        k = rec[ci.KEY_FIELD]
        if k in seen:
            raise AssertionError(
                f"duplicate key {k!r}\n  first: {seen[k]}\n  second: {(pool, host, rec.get('name'))}\n"
                "Widen the discriminator in src/craft_identity.py POOL_KEY.")
        seen[k] = (pool, host, rec.get("name"))
    # 812 before #766; the eight Slaver's pools add 184 options.
    # #764 — 1007 not 996: +11, the Essence options the three newly-served families
    # add (Rune Arm 2, Ring 7, Melee 2). The same change made this test's subject
    # matter real: the pool's discriminator was `menu` alone, which was unique only
    # while one family shipped, and the build refused 1007 rows over 997 keys until
    # it became (family, menu).
    # #817 — 1009 not 1007: +2, the two `Dodge` Essence options (Trinket Prefix
    # and Suffix) that became offerable once `Dodge bonus` supplied the type the
    # effect page never carried.
    # #844 — 1406 not 1327: +79, the compound Essence shards now served whole (one
    # record each: Sheltering, Combat Mastery, …); nothing else moved.
    # #843 — 1327 not 1009: +318, the Essence pool read from the yourddo catalog
    # instead of the wiki shards (356 options over 38; every one of the 38 kept).
    assert len(seen) == 1406, f"option population is {len(seen)}, expected 1406"


def test_the_quarterstaff_flag_is_load_bearing():
    """Drop it and the collisions come back — the guard's own guard.

    Proves the discriminator earns its place rather than merely being present,
    per `prove-a-guard-fails-before-trusting-it.md`.
    """
    ds = _dataset()
    naive = []
    for pool in ("viktranium", "dino_inserts"):
        for rec in ds[pool]:
            opt = ci._option(rec)
            if pool == "viktranium":
                pk = f"{rec.get('slot_type')}|{rec.get('category')}"
            else:
                pk = f"{rec.get('dino_type')}|{rec.get('category')}"
            naive.append(f"craft:{pool}:{pk}:{opt}")
    assert len(naive) - len(set(naive)) == 12, (
        "the quarterstaff-blind key no longer collides. If upstream stopped "
        "shipping paired quarterstaff rows the flag may be droppable, but "
        "confirm that before simplifying POOL_KEY.")


def test_the_build_publishes_its_own_coverage():
    cov = _dataset()["metadata"]["craft_identity_coverage"]
    # #764 — 1007, per the population note above. stamped == distinct is the
    # property that matters and is what the widened discriminator restores.
    # #817 — +2 `Dodge` Essence options; see test_no_two_options_share_a_key.
    # #843 — +318 Essence options; see test_no_two_options_share_a_key.
    assert cov["stamped"] == cov["distinct"] == 1406
    assert cov["by_pool"]["slavers"] == 184   # #766
    assert cov["by_pool"][ci.PER_ITEM_POOL] == 147, (
        "the per-item Nearly Complete pools are in scope — a handle that cannot "
        "name them is a gap, not a scope line")


def test_key_shape_is_prefixed_and_parseable():
    ds = _dataset()
    for pool, host, rec in _all_rows(ds):
        k = rec[ci.KEY_FIELD]
        assert k.startswith(ci.PREFIX), k
        assert k.split(":", 2)[1] == pool, k
