"""U6 — wildcard set pieces (Gem of Many Facets): the build attaches the two
wiki-sourced set pools to the Legendary Gem variants and clears its stale set_bonus.
Restores the mechanic dropped as an accepted loss in the #70 gear-planner overhaul.
Evidence: docs/wiki-evidence/gem-of-many-facets.md."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

HERE = os.path.dirname(__file__)
ITEMS_PATH = os.path.join(HERE, "..", "web", "data", "items.json")
SEED_PATH = os.path.join(HERE, "..", "data", "seed", "joker_sets.json")


def _all_items(o, acc=None):
    acc = [] if acc is None else acc
    if isinstance(o, dict):
        if isinstance(o.get("affixes"), list) or o.get("joker_set_groups"):
            acc.append(o)
        for v in o.values():
            _all_items(v, acc)
    elif isinstance(o, list):
        for v in o:
            _all_items(v, acc)
    return acc


def test_joker_seed_has_two_pools_for_the_legendary_gem():
    seed = json.load(open(SEED_PATH, encoding="utf-8"))["items"]
    assert "Legendary Gem of Many Facets" in seed
    groups = seed["Legendary Gem of Many Facets"]["groups"]
    assert len(groups) == 2, "two independent pools (Random set 1 / Random set 2)"
    assert len(groups[0]) == 13 and len(groups[1]) == 9, "13 + 9 sets per the wiki item page"


def test_build_attaches_joker_groups_and_clears_set_bonus():
    d = json.load(open(ITEMS_PATH, encoding="utf-8"))
    gems = [it for it in _all_items(d) if "Legendary Gem of Many Facets" in str(it.get("variant_id") or "")]
    assert gems, "the Legendary Gem variants exist in the built dataset"
    for it in gems:
        jsg = it.get("joker_set_groups")
        assert jsg and len(jsg) == 2 and all(jsg), f"{it.get('variant_id')} carries two non-empty joker pools"
        assert not it.get("set_bonus"), f"{it.get('variant_id')} has its stale fixed set_bonus cleared"


def test_non_legendary_gem_tiers_are_not_attached():
    """KTD4 — Legendary only this pass; Epic/Heroic remain unattached (no source)."""
    d = json.load(open(ITEMS_PATH, encoding="utf-8"))
    others = [it for it in _all_items(d)
              if "Gem of Many Facets" in str(it.get("variant_id") or "")
              and "Legendary" not in str(it.get("variant_id") or "")]
    for it in others:
        assert not it.get("joker_set_groups"), f"{it.get('variant_id')} is not attached (deferred tier)"
