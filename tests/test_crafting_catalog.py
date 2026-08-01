"""U2 — native crafting-pool catalog reader (both shapes, loud errors, no gate)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src import crafting_catalog as CC  # noqa: E402


def _raises(exc, fn, *args, **kwargs):
    try:
        fn(*args, **kwargs)
    except exc:
        return True
    raise AssertionError(f"expected {exc.__name__} to be raised")


def test_catalog_loads_the_83_pools():
    cat = CC.load_catalog()
    assert isinstance(cat, dict)
    assert len(cat) == 83, "the native crafting catalog carries 83 pool keys"


def test_menu_pool_shape_parses():
    cat = CC.load_catalog()
    assert CC.is_menu("Sealed in Undeath", cat) is True
    opts = CC.menu_options("Sealed in Undeath", cat)
    assert len(opts) == 18, "Sealed in Undeath is an 18-option '*' menu pool"
    # native affix payload read verbatim ({name,type,value}) — the Insight type is
    # present natively (the legacy pipeline mistyped it Insightful; not our concern here)
    triples = {(a["name"], a["type"], str(a["value"]))
               for o in opts for a in CC.iter_affixes(o)}
    assert ("Charisma", "Insight", "7") in triples
    assert ("Strength", "Enhancement", "15") in triples


def test_per_item_pool_shape_parses():
    cat = CC.load_catalog()
    assert CC.is_menu("Nearly Finished", cat) is False
    hosts = CC.peritem_options("Nearly Finished", cat)
    assert isinstance(hosts, dict) and len(hosts) > 1
    assert "Black Satin Waist" in hosts, "Nearly Finished is keyed by host name"
    # options_for flattens a per-item pool
    flat = CC.options_for("Nearly Finished", cat)
    assert len(flat) == sum(len(v) for v in hosts.values())


def test_nc_category_pool_vs_per_item_not_conflated():
    # The 6 "Nearly Complete: <category>" pools are '*' MENU pools (category path);
    # "Nearly Finished" / "Almost There" are PER-ITEM pools (host-name path). They
    # are distinct mechanics and must dispatch differently (review F5).
    cat = CC.load_catalog()
    assert CC.is_menu("Nearly Complete: Ability Score", cat) is True
    assert CC.is_menu("Nearly Finished", cat) is False
    assert CC.is_menu("Almost There", cat) is False
    # calling the wrong accessor on either shape errors loudly, not silently empty
    _raises(CC.CraftingCatalogError, CC.peritem_options, "Nearly Complete: Ability Score", cat)
    _raises(CC.CraftingCatalogError, CC.menu_options, "Nearly Finished", cat)


def test_malformed_or_unknown_key_errors_loudly():
    cat = CC.load_catalog()
    # absent key -> loud error (never a silent empty pool)
    _raises(CC.CraftingCatalogError, CC.menu_options, "No Such Pool Zzz", cat)
    _raises(CC.CraftingCatalogError, CC.options_for, "No Such Pool Zzz", cat)
    # a non-dict pool payload is malformed
    _raises(CC.CraftingCatalogError, CC.menu_options, "bad", {"bad": ["not", "a", "dict"]})


def test_value_coercion_percent_and_flat():
    assert CC.coerce_value("15") == (15, "flat")
    assert CC.coerce_value("9%") == (9, "pct")
    assert CC.coerce_value("-10") == (-10, "flat")
    assert CC.coerce_value(3) == (3, "flat")
    assert CC.coerce_value(1) == (1, "flat")  # Bool value


def test_legacy_affix_projection_no_remap():
    # name->stat, type->bonus_type VERBATIM (no remap), value coerced.
    proj = CC.legacy_affix({"name": "Charisma", "type": "Insight", "value": "7"})
    assert proj == {"stat": "Charisma", "bonus_type": "Insight", "value": 7, "unit": "flat"}


def test_green_steel_records_resolve_natively():
    # A2: the Green Steel pools DO exist (T1/T2/T3 Equipment) — wired, not deleted.
    recs = CC.green_steel_records()
    assert len(recs) > 50, "Green Steel Equipment pools are populated natively"
    stats = {r["stat"] for r in recs}
    assert "Acid Resistance" in stats or "Acid Intensity" in stats


def test_thunder_forged_records_resolve_natively():
    recs = CC.thunder_forged_records()
    assert len(recs) > 20, "Thunder-Forged Weapon pools are populated natively"
    tiers = {r["tier"] for r in recs}
    assert tiers == {1, 2, 3}, "all three weapon tiers resolve"
