"""#765 — randomly-rolled effect groups, sourced from the catalog's per-item pools.

The load-bearing test here is `test_a_multi_affix_option_is_refused_not_split`. The
first builder split a multi-affix roll option into separately-selectable ones, which
would have let a solve take `Negative Energy Absorption +12` off a Shield of Morning
roll WITHOUT the `Deathblock` the same roll grants — the fan-out defect
`container_registry` exists to catch, and the container gate is what caught it.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src import roll_groups as RG  # noqa: E402
from src import crafting_catalog  # noqa: E402

ITEMS = os.path.join(os.path.dirname(__file__), "..", "web", "data", "items.json")


def _dataset():
    with open(ITEMS, encoding="utf-8") as fh:
        return json.load(fh)


def _catalog(**pools):
    return dict(pools)


def _opt(*affixes):
    return {"affixes": list(affixes)}


def _aff(name, type_, value):
    return {"name": name, "type": type_, "value": value}


# --- the shape the issue got wrong -------------------------------------------------

def test_the_pools_are_per_item_and_populated_not_empty_menus():
    """#765 says every one of these pools is `{"*": []}` and the options are not in
    the catalog, so the work is wiki-gated. Both halves are false, and this pins it:
    they are PER-ITEM pools keyed by host, and they carry typed options."""
    catalog = crafting_catalog.load_catalog()
    present = [k for k in RG.ROLL_POOL_KEYS if k in catalog]
    assert present, "no roll pools in the catalog at all"
    for label in present:
        pool = catalog[label]
        assert "*" not in pool, f"{label} is a menu pool, not per-item"
        assert pool, f"{label} is an empty dict — the issue's claim, if it were true"


# --- the fan-out refusal ------------------------------------------------------------

def test_a_multi_affix_option_is_refused_not_split():
    """THE defect. One roll grants every affix in its option, so splitting one into
    two selectable options offers half a roll — and counts one roll as two competing
    choices. Refused and counted instead."""
    catalog = _catalog(**{"Random effect": {"Host": [
        _opt(_aff("Doublestrike", "Enhancement", "3")),
        _opt(_aff("Negative Energy Absorption", "Enhancement", "12"),
             _aff("Deathblock", "Bool", 1)),
    ]}})
    out = RG.build(catalog)
    opts = out["by_host"]["Host"][0]["options"]
    assert [o["stat"] for o in opts] == ["Doublestrike"], opts
    assert out["coverage"]["options_refused_compound"] == 1
    assert not any(o["stat"] == "Deathblock" for o in opts), (
        "the compound option was split — half a roll is on offer")


def test_an_untyped_option_is_dropped_and_counted():
    """No bonus type means no bucket. Guessing one is the inference the data gate
    refuses, and a silently shorter group would hide it."""
    catalog = _catalog(**{"Random effect": {"Host": [
        _opt(_aff("Doublestrike", "Enhancement", "3")),
        _opt({"name": "Deception", "value": "6"}),
    ]}})
    out = RG.build(catalog)
    assert [o["stat"] for o in out["by_host"]["Host"][0]["options"]] == ["Doublestrike"]
    assert out["coverage"]["options_dropped_unreadable"] == 1


def test_an_umbrella_stat_option_is_refused():
    """`Resistance` is the all-saves umbrella, expanded into its components
    everywhere else, so leaving it here names a stat nobody can rank. Expanding it
    is not the fix either: one roll grants every component, and a flat
    one-stat-per-option pool would turn that into competing choices, making the item
    read WEAKER than it is.

    The real population is `Resistance` (31 options), `Combat Mastery` (16) and
    `Good Luck` (1) — named here because the obvious guess, `Universal Spell Power`,
    is NOT one: `spell_focus.is_universal` returns False for it, and a fixture built
    on that guess passes while testing nothing."""
    catalog = _catalog(**{"Random effect": {"Host": [
        _opt(_aff("Doublestrike", "Enhancement", "3")),
        _opt(_aff("Resistance", "Enhancement", "8")),
    ]}})
    out = RG.build(catalog)
    assert [o["stat"] for o in out["by_host"]["Host"][0]["options"]] == ["Doublestrike"]
    assert out["coverage"]["options_refused_universal"] == 1


def test_a_group_with_no_readable_option_is_not_emitted():
    """An empty choice slot is worse than an absent one: the solver would gate a host
    on a group that can never fire."""
    catalog = _catalog(**{"Random effect": {"Host": [_opt({"name": "Deception", "value": "6"})]}})
    try:
        RG.build(catalog)
    except RG.RollGroupError as e:
        assert "no readable option" in str(e) or "empty roll-group pool" in str(e)
        return
    raise AssertionError("a group with nothing readable was emitted")


# --- the guards, each proven to fire -------------------------------------------------

def test_the_builder_refuses_an_absent_pool_set():
    try:
        RG.build({})
    except RG.RollGroupError as e:
        assert "every key in ROLL_POOL_KEYS is absent" in str(e)
        return
    raise AssertionError("an empty catalog produced a pool")


def test_a_menu_shaped_roll_pool_is_refused_rather_than_auto_served():
    """A `*` menu under a roll label means the catalog reclassified it. Serving it
    per-host would attach one item's options to every host."""
    catalog = _catalog(**{"Random effect": {"*": [_opt(_aff("Doublestrike", "Enhancement", "3"))]}})
    try:
        RG.build(catalog)
    except RG.RollGroupError as e:
        assert "MENU pool" in str(e)
        return
    raise AssertionError("a menu-shaped roll pool was served per-host")


# --- the built dataset ----------------------------------------------------------------

def test_the_built_dataset_carries_the_groups_and_the_census_and_they_agree():
    """The two audited paths must say the same thing: `roll_groups` on items is what
    the solver reads, `roll_groups_per_item` is what the builder produced. A
    disagreement is a broken attach step, which is why both are declared containers."""
    data = _dataset()
    per_item = data.get("roll_groups_per_item") or {}
    assert per_item, "refuse to pass over an empty census"

    on_items = 0
    hosts = 0
    for it in data["items"]:
        groups = it.get("roll_groups") or []
        if not groups:
            continue
        hosts += 1
        for g in groups:
            assert g.get("source") == "roll", f"{it['variant_id']}: a roll group must say it is rolled"
            assert g.get("raw"), f"{it['variant_id']}: a group with no label"
            on_items += len(g.get("options") or [])
    census = sum(len(v or []) for v in per_item.values())
    assert on_items == census, (
        f"{on_items} options on items vs {census} in the census — the attach step "
        "dropped or duplicated")
    assert hosts == len(per_item), f"{hosts} hosts on items vs {len(per_item)} in the census"


def test_every_emitted_option_carries_exactly_one_stat():
    """FLAT's contract, enforced at the source rather than hoped for: the container
    gate requires one record per affix, and the solver's roll loop is
    one-stat-per-option."""
    data = _dataset()
    for host, opts in (data.get("roll_groups_per_item") or {}).items():
        for o in opts:
            assert o.get("stat") and o.get("bonus_type"), f"{host}: {o}"
            assert o.get("value") is not None, f"{host}: {o}"
