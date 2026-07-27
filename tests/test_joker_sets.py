"""U1 — wildcard set-piece pools attach to the Gem variant (Gem of Many Facets)."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import build_dataset as B
from src import set_catalog as SC

GEM = "Legendary Gem of Many Facets"


def _build():
    return B.build(B.load_seed())


def _gem(ds):
    return next(it for it in ds["items"]
               if (it.get("source_item") or it.get("variant_id")) == GEM)


def test_gem_carries_two_pools_and_no_fixed_set_bonus():
    gem = _gem(_build())
    groups = gem.get("joker_set_groups")
    assert groups and [len(g) for g in groups] == [13, 9]
    # R5: the stale fixed membership is gone; parsed_set_bonuses empty.
    assert gem.get("set_bonus") == []
    assert not gem.get("parsed_set_bonuses")


def test_gem_still_solver_active():
    # It has augment slots, so verify keeps it even with no base affix / set_bonus.
    assert _gem(_build()).get("verification") == "verified"


def test_pool_names_are_canonical_and_resolve_to_definitions():
    ds = _build()
    gem = _gem(ds)
    base = SC.base_defs_from_seed(B.load_seed()["items"])
    cat = SC.load_catalog()
    for group in gem["joker_set_groups"]:
        for name in group:
            assert name == SC.canonical(name), f"pool name not canonical: {name}"
    # Vulkoor's Might (the old fixed membership) is present only as a group-1 option.
    assert "Legendary Vulkoor's Might" in gem["joker_set_groups"][0]
    # Most pool sets have a real definition (base or catalog) so the joker can complete them.
    defined = sum(1 for g in gem["joker_set_groups"] for n in g
                  if SC.canonical(n) in base or SC.canonical(n) in cat)
    assert defined >= 18, f"expected most pool sets defined, got {defined}/22"


def test_pools_are_disjoint():
    gem = _gem(_build())
    g1, g2 = gem["joker_set_groups"]
    assert not (set(g1) & set(g2)), "joker pools must be disjoint (no set reachable from both groups)"


def test_no_other_item_gains_joker_groups():
    ds = _build()
    with_joker = [it for it in ds["items"] if it.get("joker_set_groups")]
    names = {(it.get("source_item") or it.get("variant_id")) for it in with_joker}
    assert names == {GEM}, f"only the Gem should carry joker pools, got {names}"
