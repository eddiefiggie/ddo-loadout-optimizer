"""Native crafting-pool catalog reader (U2).

`gearplanner_crafting.json` is the single authority for crafting option pools.
This module loads it and dispatches on the two native pool shapes (KTD6):

  * **menu pools** keyed ``"*"``      -> ``{"*": [option, ...]}``
    (e.g. ``Sealed in Undeath``, ``Blue Augment Slot``, ``T1 (Weapon)``)
  * **per-item pools** keyed by host  -> ``{"<host name>": [option, ...], ...}``
    (e.g. ``Nearly Finished``, ``Almost There``, ``One of the following…``)

Each option is ``{"affixes":[{name,type,value}], "ml"?, "name"?, "quests"?}``. The
affix payload is read **directly** — NO ``wiki_url`` gate, NO type remap, NO
quarantine. That gate was the document review's F1 finding; it is *removed*, not
reintroduced. A malformed or unknown key errors loudly (never a silent empty
pool), so a pool-shape mismatch surfaces at the family that introduced it.

The affix ``value`` is a native string ("15", "9%") or int; ``coerce_value``
mirrors the pipeline's percent/flat split for callers that need the legacy
``{stat, bonus_type, value, unit}`` shape while the solver is still schema-legacy
(Phase A). The native ``{name, type, value}`` is preserved verbatim in
``iter_affixes``.
"""
from __future__ import annotations

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
CRAFTING_PATH = os.path.join(HERE, "..", "data", "seed", "compendium", "raw",
                             "gearplanner_crafting.json")

# The augment-stone pools share this key suffix; the augment registry is drawn
# from their option `name` fields (R14).
AUGMENT_SLOT_SUFFIX = "Augment Slot"


class CraftingCatalogError(KeyError):
    """Raised on an unknown/malformed crafting-pool key — never a silent empty pool."""


def load_catalog(path: str = CRAFTING_PATH) -> dict:
    """Load the native crafting catalog (the 83-key dict).

    #631 — the augment tier-gap shard is merged HERE rather than at a call site,
    because there are two: the main build and the referential-integrity check that
    validates every augment name against the frozen registry. Applying it at one
    would have left the other inspecting a different catalog, which is the shape of
    bug that takes a day to find. One seam, so no consumer can see a partial view.
    """
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise CraftingCatalogError(
            f"crafting catalog at {path!r} is {type(data).__name__}, expected a dict of pools")
    from src import augment_tier_gap
    augment_tier_gap.apply(data, augment_tier_gap.load())
    return data


def _pool(key: str, catalog: dict):
    """Return the raw pool dict for ``key`` or raise loudly."""
    if key not in catalog:
        raise CraftingCatalogError(
            f"crafting pool key {key!r} is absent from the native catalog "
            f"(no silent empty pool)")
    pool = catalog[key]
    if not isinstance(pool, dict):
        raise CraftingCatalogError(
            f"crafting pool {key!r} is {type(pool).__name__}, expected a dict "
            f"({{'*': [...]}} menu or {{'<host>': [...]}} per-item)")
    return pool


def is_menu(key: str, catalog: dict) -> bool:
    """True if ``key`` is a ``"*"`` menu pool (vs a per-host pool)."""
    return "*" in _pool(key, catalog)


def menu_options(key: str, catalog: dict) -> list:
    """The option list of a ``"*"`` menu pool. Raises if ``key`` is per-item shaped
    (dispatch mistake) or absent (KTD6)."""
    pool = _pool(key, catalog)
    if "*" not in pool:
        raise CraftingCatalogError(
            f"crafting pool {key!r} is per-item shaped (hosts "
            f"{sorted(pool)[:3]}…); call peritem_options, not menu_options")
    opts = pool["*"]
    if not isinstance(opts, list):
        raise CraftingCatalogError(f"menu pool {key!r} '*' is {type(opts).__name__}, expected a list")
    return opts


def peritem_options(key: str, catalog: dict) -> dict:
    """The ``{host_name: [options]}`` map of a per-item pool. Raises if ``key`` is a
    ``"*"`` menu pool (dispatch mistake) or absent (KTD6)."""
    pool = _pool(key, catalog)
    if "*" in pool:
        raise CraftingCatalogError(
            f"crafting pool {key!r} is a '*' menu pool; call menu_options, not peritem_options")
    return pool


def options_for(key: str, catalog: dict) -> list:
    """All options in ``key`` regardless of shape (menu list, or per-item flattened).
    Convenience for callers that only need the option payloads."""
    pool = _pool(key, catalog)
    if "*" in pool:
        return list(pool["*"])
    flat = []
    for opts in pool.values():
        if isinstance(opts, list):
            flat.extend(opts)
    return flat


def iter_affixes(option: dict):
    """Yield an option's native ``{name, type, value}`` affix dicts, verbatim."""
    for a in (option or {}).get("affixes", []) or []:
        yield a


def coerce_value(value):
    """Coerce a native affix ``value`` (string "15"/"9%" or int) to ``(number, unit)``.

    Mirrors the pipeline's percent/flat split so a native pool option can be
    expressed in the legacy ``{value:int, unit}`` shape the solver still reads in
    Phase A. A non-numeric value is returned unchanged with a flat unit.
    """
    if isinstance(value, bool):
        return int(value), "flat"
    if isinstance(value, (int, float)):
        return int(value), "flat"
    s = str(value).strip()
    unit = "pct" if s.endswith("%") else "flat"
    s = s.rstrip("%").strip()
    try:
        return int(s), unit
    except ValueError:
        try:
            return int(float(s)), unit
        except ValueError:
            return value, unit


def legacy_affix(affix: dict) -> dict:
    """Map one native affix ``{name, type, value}`` to the legacy solver-facing
    shape ``{stat, bonus_type, value, unit}`` — value coerced, type/name verbatim
    (NO remap, NO gate). The native record is unchanged; this is a projection for
    the still-legacy solver contract (Phase A)."""
    val, unit = coerce_value(affix.get("value"))
    return {
        "stat": affix.get("name"),
        "bonus_type": affix.get("type"),
        "value": val,
        "unit": unit,
    }


def source_stations(opt: dict) -> list:
    """The crafting station(s) a catalog option is offered at, from its own record.

    #653 — the ONE field in the gear-planner dump that says which crafting SYSTEM a
    menu belongs to. The menu keys do not: they are generic (`T1 (Weapon)`,
    `T2 (Equipment)`), so every mapping from a menu key to a named system is an
    inference by whoever wrote the constant. One of those inferences was wrong for
    months — `THUNDER_FORGED_KEYS` claimed the `T*(Weapon)` menus, which every one
    of their options records as coming from a **Legendary Altar**, i.e. Legendary
    Green Steel. Thunder-Forged is crafted at the Magma Forge in Thunderholme and
    has no menu in this catalog at all.

    Carried onto every record built from these menus so the provenance travels with
    the data instead of living in a constant's name, and asserted by
    `container_registry`.
    """
    return [q for q in (opt.get("quests") or []) if isinstance(q, str) and q.strip()]


# --------------------------------------------------------------------- families

# #687 — ONE Legendary Green Steel family. The `T*(Equipment)` menus are the
# accessory recipes and the `T*(Weapon)` menus are the weapon recipes; both are
# crafted at the Legendary Altars of Invasion / Subjugation / Devastation (#653),
# and a blank takes one effect at each altar it declares. They used to be two
# containers (`green_steel` and `thunder_forged`) with two builders, two host
# markers and two solver loops of identical shape — the second under a name that
# described a system with no menu in this catalog at all. One table, keyed by the
# option's (item class, tier), replaces both.
LEGENDARY_GREEN_STEEL_CLASSES = ("accessory", "weapon")
LEGENDARY_GREEN_STEEL_KEYS = {
    ("accessory", 1): "T1 (Equipment)", ("accessory", 2): "T2 (Equipment)",
    ("accessory", 3): "T3 (Equipment)",
    ("weapon", 1): "T1 (Weapon)", ("weapon", 2): "T2 (Weapon)", ("weapon", 3): "T3 (Weapon)",
}


def count_menu_options(keys, catalog: dict = None) -> int:
    """How many SOURCE options the given ``"*"`` menu pools offer, in total.

    The single-pick fan-out gate (``src/container_registry.py``) judges a pool by
    option -> record cardinality, so every builder over these pools must be able to
    say what it read, not only what it emitted. Absent keys are skipped exactly as
    the builders skip them, so the count matches what was actually iterated.
    """
    catalog = load_catalog() if catalog is None else catalog
    return sum(len(menu_options(k, catalog)) for k in keys if k in catalog)


def legendary_green_steel_records(catalog: dict = None) -> list:
    """ATOMIC Legendary Green Steel option records (#194, unified by #687), sourced
    natively from the six ``T<n> (Equipment|Weapon)`` menu pools: ONE record per
    craftable option, tagged with its ``item_class`` (``accessory`` / ``weapon``)
    and integer ``tier`` (1/2/3), carrying its own ``affixes`` list. No gate —
    Bool/Untyped options pass through.

    Emitting one record per AFFIX used to split each multi-affix option into
    mutually exclusive siblings; the solver constrains this pool ``Sigma <= 1`` per
    host tier, so a player crafting an effect that grants three things would have
    been offered exactly one of them — the reported Viktranium symptom verbatim
    (`src/container_registry.py` opens with it). 24 of the 81 accessory options and
    1 of the 35 weapon options are genuinely multi-affix.

    Shape mirrors `viktranium._record`, the container this repo already models
    atomically, so `model.js` and `solver.js` read it through the same
    `affixes`-or-legacy branch they already run for Viktranium. Deterministic:
    classes in `LEGENDARY_GREEN_STEEL_CLASSES` order, tiers ascending.
    """
    catalog = load_catalog() if catalog is None else catalog
    out = []
    for item_class in LEGENDARY_GREEN_STEEL_CLASSES:
        for tier in (1, 2, 3):
            tier_key = LEGENDARY_GREEN_STEEL_KEYS[(item_class, tier)]
            for opt in menu_options(tier_key, catalog):
                affixes = [legacy_affix(aff) for aff in iter_affixes(opt)]
                if not affixes:
                    continue   # an option may be DROPPED (nothing to craft), never split
                out.append({
                    "name": opt.get("name") or affixes[0].get("stat") or "",
                    # The altar this option is crafted at, and which blank class
                    # takes it: the solver keys the pool by BOTH, and a host's
                    # `legendary_green_steel_tiers` names both per declared slot.
                    "item_class": item_class,
                    "tier": tier,
                    "tier_key": tier_key,
                    "ml": opt.get("ml"),
                    "affixes": affixes,
                    # #653 — provenance from the option itself, not from the menu key.
                    "source_stations": source_stations(opt),
                })
    return out


_AUGMENT_WIKI_URL = "https://ddowiki.com/page/Augment_Slot"


def _augment_affix(a: dict) -> dict:
    """One augment affix, carrying the provenance receipt if the source has one.

    Kept as a named function rather than an inline dict so the `via` carry has
    somewhere to be explained and cannot be dropped in a reformat.
    """
    out = {"name": a.get("name"), "type": a.get("type"), "value": a.get("value")}
    if a.get("via") is not None:
        out["via"] = a["via"]
    return out


def augment_pool_records(catalog: dict = None) -> list:
    """The native legendary augment pool, sourced from the `<Color> Augment Slot`
    menu pools (replacing the retired `augments.json` seed). Each stone option
    becomes a base-item-shaped record carrying its NATIVE affix block so it flows
    through the item pipeline's native path (category "augment"); the slot COLOR is
    taken from the pool key ("Blue Augment Slot" -> "Blue"). One record per stone
    name (first occurrence wins; the gear-planner pools carry no multi-color
    duplicates). Deterministic: colors iterated in sorted key order."""
    catalog = load_catalog() if catalog is None else catalog
    records, seen = [], set()
    for key in sorted(k for k in catalog if k.endswith(AUGMENT_SLOT_SUFFIX)):
        color = key[: -len(AUGMENT_SLOT_SUFFIX)].strip()
        for opt in menu_options(key, catalog):
            name = opt.get("name")
            if not name or name in seen:
                continue
            seen.add(name)
            records.append({
                "name": name,
                "category": "augment",
                "slot": color,
                # #649 — `via` rides along, and this is a WHITELIST, so leaving it
                # out destroys the receipt silently. The crafting records reach
                # here already name-corrected (build_dataset applies the crafting
                # channel first), so a merge that stamped the engraved name has
                # ALREADY stamped it by this point; rebuilding without `via` drops
                # it, and the augment channel that runs later cannot restore it —
                # the name it would match on has already changed. That is how two
                # `Undying Sapphire` augments came out reading `Unconsciousness
                # Range` with nothing saying what the augment is engraved with.
                # Same hazard `variants._native_parsed` documents for its rebuild.
                "affixes": [_augment_affix(a) for a in iter_affixes(opt)],
                "minimum_level": opt.get("ml"),
                "ml": opt.get("ml"),
                "quests": list(opt.get("quests") or []),
                "wiki_url": _AUGMENT_WIKI_URL,
                "_source": "gear-planner-crafting",
            })
    return records


