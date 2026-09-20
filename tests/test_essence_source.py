"""#837 — the Essence Crafting source of truth, and the joins that make it safe.

The recipe table is `veteran-software/yourddo`'s, adopted by owner decision.
What these tests pin is not the table but the SEAMS between it and this catalog,
because every seam is a place a crafted affix can land in the wrong stacking
bucket — and a wrong bucket is a wrong loadout that looks right.

Three seams, each with a join and a guard:

  - STAT names   `essence_stat_join.json`   (`Hit Points` -> `False Life`)
  - BONUS TYPES  `BONUS_TYPE_JOIN`          (`Natural Armor` -> `Natural`)
  - UNITS        `catalog_units`            (`Fortification` is 146 flat, not pct)

The audit that produced the second and third found them by measurement: the
catalog carries 149 affixes typed `Natural` and none typed `Natural Armor`, so
the un-joined type would have stacked with all 149; and the float heuristic
labelled 20 stats `pct` that the catalog stores as flat numbers.
"""
import copy
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import essence_source  # noqa: E402

DATASET = os.path.join(ROOT, "web", "data", "items.json")


def _built():
    with open(DATASET, encoding="utf-8") as fh:
        d = json.load(fh)
    types, units, stats = set(), {}, set()
    for it in d["items"]:
        for a in it.get("affixes") or []:
            n, t, v = a.get("name"), a.get("type"), a.get("value")
            if not n:
                continue
            stats.add(n)
            if t and t not in ("Bool", "boolean"):
                types.add(t)
                units.setdefault(n, set()).add(
                    "pct" if str(v).strip().endswith("%") else "flat")
    pl = d["essence_placements"]
    return pl, types, units, stats


def _parts(groups):
    for menus in groups.values():
        for rows in menus.values():
            for r in rows:
                for p in (r.get("parts") or [r]):
                    yield r, p


# --- bonus types ---------------------------------------------------------------

def test_837_every_bonus_type_join_target_is_a_catalog_bucket():
    _, types, _, _ = _built()
    assert essence_source.BONUS_TYPE_JOIN, "an empty join passes every check below"
    for src, dst in essence_source.BONUS_TYPE_JOIN.items():
        assert dst in types, f"{src!r} -> {dst!r}, but the catalog has no {dst!r} bucket"


def test_837_natural_armor_mints_the_catalogs_natural():
    pl, types, _, _ = _built()
    hits = [p for _, p in _parts(pl["groups"]) if p.get("source_bonus_type") == "Natural Armor"]
    assert hits, "no part carries the source spelling — the fixture this guards is gone"
    for p in hits:
        assert p["bonus_type"] == "Natural", p
        assert p["type_sourced"] is True, p
    assert "Natural Armor" not in types, "the catalog grew a Natural Armor bucket; re-rule the join"


def test_837_a_type_with_no_bucket_is_left_unsourced_not_minted():
    pl, types, _, _ = _built()
    cov = pl["source_coverage"]
    assert cov["type_no_bucket"] == ["Unique"], cov["type_no_bucket"]
    assert cov["type_no_bucket_withheld"] >= 1
    honed = [p for r, p in _parts(pl["groups"]) if p.get("source_bonus_type") == "Unique"]
    assert honed, "Honed is gone from the table"
    for p in honed:
        assert p.get("bonus_type") is None and p.get("type_sourced") is False, p
        assert p.get("sourced") is False, "an unsourced type cannot be a fully sourced part"


def test_837_no_minted_type_lacks_a_bucket_on_the_real_build():
    pl, types, _, _ = _built()
    out = essence_source.assert_every_minted_type_has_a_bucket(pl["groups"], types)
    assert out == {"joined_types": len(essence_source.BONUS_TYPE_JOIN)}


def test_837_the_type_guard_fails_on_a_stray_minted_type():
    pl, types, _, _ = _built()
    bad = copy.deepcopy(pl["groups"])
    row = bad["Rings"]["Prefix"][0]
    (row.get("parts") or [row])[0].update({"bonus_type": "Sparkle", "type_sourced": True})
    try:
        essence_source.assert_every_minted_type_has_a_bucket(bad, types)
    except essence_source.EssenceSourceError as e:
        assert "Sparkle" in str(e) and "no catalog bucket" in str(e)
    else:
        raise AssertionError("a stray minted type must fail the build")


def test_837_the_type_guard_fails_on_a_dead_join_target():
    pl, types, _, _ = _built()
    saved = essence_source.BONUS_TYPE_JOIN
    essence_source.BONUS_TYPE_JOIN = dict(saved, **{"Whatever": "Nonexistent"})
    try:
        essence_source.assert_every_minted_type_has_a_bucket(pl["groups"], types)
    except essence_source.EssenceSourceError as e:
        assert "no longer carries" in str(e)
    else:
        raise AssertionError("a join onto a missing bucket must fail the build")
    finally:
        essence_source.BONUS_TYPE_JOIN = saved


def test_837_the_type_guard_refuses_to_inspect_nothing():
    pl, types, _, _ = _built()
    for groups, ts in (({}, types), (pl["groups"], set())):
        try:
            essence_source.assert_every_minted_type_has_a_bucket(groups, ts)
        except essence_source.EssenceSourceError as e:
            assert "vacuously" in str(e) or "no catalog types" in str(e)
        else:
            raise AssertionError("empty input must not read as success")


def test_837_the_type_rule_holds_through_the_real_builder_not_a_copy():
    """Proved through `build_catalog` itself. The #834 guard was proved against
    a synthetic list in a shape the call site never passed; this one hands the
    real builder a catalog that lacks `Enhancement` and expects it to refuse to
    mint a single Enhancement part — which it can only do if the parameter is
    actually threaded through."""
    _, types, units, stats = _built()
    out = essence_source.build_catalog(catalog_stats=stats, catalog_units=units,
                                       catalog_types=types - {"Enhancement"})
    minted = {p.get("bonus_type") for _, p in _parts(out["groups"]) if p.get("type_sourced")}
    assert "Enhancement" not in minted, "the builder minted a type the catalog it was given lacks"
    assert "Enhancement" in out["coverage"]["type_no_bucket"]
    assert out["coverage"]["type_no_bucket_withheld"] > 100, out["coverage"]


# --- units ---------------------------------------------------------------------

def test_837_crafted_units_agree_with_the_catalog():
    """The float heuristic alone labelled 20 stats `pct` that the catalog stores
    as flat numbers. Recomputed here against the built dataset, refusing to pass
    over zero comparisons."""
    pl, _, units, _ = _built()
    compared = mismatched = 0
    for r, p in _parts(pl["groups"]):
        s, u = p.get("stat"), p.get("unit")
        if not s or not u or u == "dice" or s not in units or len(units[s]) != 1:
            continue
        compared += 1
        if u not in units[s]:
            mismatched += 1
    assert compared > 500, f"only {compared} comparable parts — the join or the read broke"
    assert mismatched == 0, f"{mismatched} crafted part(s) wear a unit the catalog does not"


def test_837_an_ambiguous_catalog_unit_withholds_the_magnitude():
    """A stat the catalog spells both ways is left unvalued, exactly as the wiki
    builder did — a percentage and a flat number in one bucket compare directly."""
    _, types, units, stats = _built()
    units2 = {k: set(v) for k, v in units.items()}
    units2["False Life"] = {"flat", "pct"}
    out = essence_source.build_catalog(catalog_stats=stats, catalog_units=units2,
                                       catalog_types=types)
    fl = [p for r, p in _parts(out["groups"]) if p.get("source_stat") == "Hit Points"]
    assert fl, "False Life vanished"
    assert all(not p.get("magnitude_sourced") for p in fl), "an ambiguous unit still got a magnitude"
    # The counter counts recipe-ENCHANTMENTS, before the slot fan-out; `fl`
    # counts published PLACEMENTS, after it. Two populations — the expected
    # number is read off the raw table rather than pinned or conflated.
    expected = sum(1 for r in essence_source.load()
                   for e in (r.get("enchantments") or []) if e.get("name") == "Hit Points")
    assert expected >= 1
    assert out["coverage"]["unit_ambiguous_withheld"] == expected, (
        out["coverage"]["unit_ambiguous_withheld"], expected)
