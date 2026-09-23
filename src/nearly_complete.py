"""U1 — Update 81 "Nearly Complete" crafting parser (strict wiki provenance).

Nearly Complete lets an item gain one extra affix chosen from a **category**
menu (Ability Score, Insightful Ability Score, Quality Ability Score, Healing
Amplification, Skill, Spell Focus). Each category fixes the bonus type per option
and shares a per-tier magnitude (Heroic ML11 / Legendary ML35); the player picks
the stat. Structurally this is the augment/Dino choice-slot with a parametric,
category-shared option pool — so this parser mirrors `src/dino_parser.py`: it
turns a freshly-sourced seed (``data/seed/nearly_complete.json``) into structured
option records and QUARANTINES anything it cannot verify.

Strict wiki provenance (KTD2). An option record is solver-eligible only with a
canonical category, a canonical ``bonus_type`` (in ``affix_parser.BONUS_TYPES``),
a present ``stat`` (run through the item pipeline stat name to match the item
pipeline's vocabulary), an integer per-tier ``value``, and a non-empty
``wiki_url``. Anything else is quarantined with a reason, never inferred.
Choosing between two source spellings of a bonus type (e.g. the release notes'
"Competence Positive Amplification" vs the Nearly_Complete page's wording) is a
seed-authoring reconciliation, not parser logic — the parser only rejects a type
outside the canonical set. Sourced via Claude-in-Chrome (plain fetch returns
empty for ddowiki).
"""
from __future__ import annotations

from src.affix_parser import BONUS_TYPES
from src import crafting_catalog

# The six Nearly Complete categories (the wiki's names on the Nearly_Complete page).
CATEGORIES = {
    "Ability Score", "Insightful Ability Score", "Quality Ability Score",
    "Healing Amplification", "Skill", "Spell Focus",
}

# Native menu-pool key per category in gearplanner_crafting.json.
_NATIVE_NC_KEY = {c: f"Nearly Complete: {c}" for c in CATEGORIES}
# Per-item Nearly Complete pools — keyed by HOST NAME, not category. These are a
# DISTINCT mechanism from the category menu path (review F5: never conflated).
_NC_PER_ITEM_KEYS = ["Nearly Finished", "Almost There"]
# Nearly Complete tier boundary. The wiki documents exactly TWO recipe tiers,
# Heroic ML11 and Legendary ML35, and both the option pool and the host roster
# sit on those two values with nothing between them. `NC_LEGENDARY_ML` is the
# gate; `NC_HEROIC_ML` is the other pole, and the pair is what makes "nothing in
# between" a checkable claim rather than an assumption.
#
# THE SINGLE SOURCE OF TRUTH on the Python side. `web/model.js` carries the JS
# copy (`NC_LEGENDARY_ML` / `ncTier`) and `tests/test_nearly_complete.py` pins
# the two to the same number, because a boundary that drifts between the
# pipeline and the solver mis-tiers silently.
#
# Why this is guarded at all rather than left as a constant: the sibling
# Viktranium channel assumed this same ML35 boundary, and its real legendary
# hosts are ML34 — gating on ML>=35 mis-tiered every one of them heroic and made
# the entire legendary pool unreachable (`web/model.js::lamordiaTier`). The
# failure was silent, because a wrong magnitude is indistinguishable from a right
# one in a finished loadout. Nearly Complete's boundary happens to be correct;
# `assert_tier_boundary_is_real` is what keeps that a fact instead of a memory.
NC_HEROIC_ML = 11
NC_LEGENDARY_ML = 35

#: The name prefix that marks a host's Legendary version. Used ONLY as a second,
#: independent signal to check the ML-derived tier against — never to derive a
#: tier, which would make the guard agree with itself by construction.
_LEGENDARY_NAME_PREFIX = "Legendary "


def _nc_tier_from_ml(ml):
    return "legendary" if (ml or 0) >= NC_LEGENDARY_ML else "heroic"


def assert_option_mls_are_the_two_recipe_tiers(catalog: dict) -> int:
    """Every Nearly Complete OPTION sits on one of the two recipe MLs.

    `_nc_tier_from_ml` folds an option's ML to a tier with `>=`, so an option at
    any ML above the boundary reads legendary and any below reads heroic. That is
    only safe while the pool is the documented two-point population. An option
    arriving at ML20 would be silently filed heroic and handed the heroic
    magnitude, with nothing anywhere saying so.

    Refuses to pass over an empty pool: a guard that inspects zero records
    reports success for a build that produced nothing.
    """
    seen = {}
    for category in sorted(CATEGORIES):
        key = _NATIVE_NC_KEY[category]
        if key not in catalog:
            continue
        for opt in crafting_catalog.menu_options(key, catalog):
            seen.setdefault(opt.get("ml"), []).append(category)
    if not seen:
        raise SystemExit(
            "Nearly Complete tier gate: no options walked — this guard would "
            "pass vacuously on a pool that failed to load")
    stray = {ml: sorted(set(cs)) for ml, cs in seen.items()
             if ml not in (NC_HEROIC_ML, NC_LEGENDARY_ML)}
    if stray:
        raise SystemExit(
            "Nearly Complete tier gate: option(s) at an ML that is neither "
            f"recipe tier (Heroic {NC_HEROIC_ML} / Legendary {NC_LEGENDARY_ML}): "
            f"{stray}. `_nc_tier_from_ml` would fold each to a tier by >= and "
            "hand it that tier's magnitude with nothing disclosing the guess. "
            "Source the new tier rather than letting the boundary absorb it.")
    return sum(len(v) for v in seen.values())


def assert_tier_boundary_is_real(items) -> dict:
    """The HOST roster splits at the boundary, and two independent signals agree.

    Three separate claims, each of which has a distinct failure:

    * **the roster is the two-point population the boundary assumes** — a host
      stranded between the poles is tiered by `>=` alone, which is exactly how
      the Viktranium legendary pool became unreachable one channel over;
    * **the ML-derived tier agrees with the host's own name** — `Legendary X` at
      a heroic ML, or a heroic-named host at ML35, means one of the two signals
      is wrong and the build should stop rather than pick one;
    * **`nc_tier` is still unpopulated** — the solver reads
      `nc_tier || <derive from ML>`, and the explicit field is null on every
      host today, so the derivation is the ONLY live path. If upstream starts
      populating it, that branch wakes up and somebody has to decide whether it
      overrides the derivation or must agree with it. Failing here forces that
      decision instead of letting a dead branch silently become load-bearing.

    Refuses to pass over zero hosts.
    """
    hosts = [it for it in items if it.get("nearly_complete")]
    if not hosts:
        raise SystemExit(
            "Nearly Complete tier gate: no hosts declare a category — this "
            "guard would pass vacuously")

    problems = []
    stranded = sorted({it.get("ml") for it in hosts
                       if it.get("ml") not in (NC_HEROIC_ML, NC_LEGENDARY_ML)})
    if stranded:
        named = sorted({it["variant_id"] for it in hosts
                        if it.get("ml") in stranded})[:8]
        problems.append(
            f"host(s) at an ML that is neither recipe tier (Heroic "
            f"{NC_HEROIC_ML} / Legendary {NC_LEGENDARY_ML}): {stranded}; "
            f"e.g. {named}")

    # 397c673 — the name is checked only when it ASSERTS a tier. A `Legendary X`
    # host at a heroic ML is still a contradiction and still stops the build. The
    # reverse direction was retired: it read the ABSENCE of the prefix as a claim
    # of "heroic", which held only while every legendary host happened to be
    # prefixed. The Terror of the Demon Lords raid breaks that convention — eight
    # of its ML35 end-chest hosts are plainly named (`The Prince of Demons`,
    # `The Butcher's Mind`, ...) and upstream files them under three new per-item
    # pools (`Nearly Complete: Ability Score` / `Insightful Ability Score` /
    # `Spell Focus`). Their ML35 is stated on each item's own wiki page
    # (`minlevel = 35`) and the raid is Legendary CR 37, so the ML is right and the
    # naming convention is simply not universal. Treating a plain name as a heroic
    # claim would have failed the build on eight correctly-tiered hosts.
    disagree = [(it.get("ml"), it["variant_id"]) for it in hosts
                if it["variant_id"].startswith(_LEGENDARY_NAME_PREFIX)
                and _nc_tier_from_ml(it.get("ml")) != "legendary"]
    if disagree:
        problems.append(
            "host(s) whose name and ML-derived tier disagree: "
            f"{sorted(disagree)[:8]} — one of the two signals is wrong, and the "
            "solver would ship whichever magnitude the ML happens to give")

    explicit = sorted(it["variant_id"] for it in hosts
                      if it.get("nc_tier") is not None)
    if explicit:
        problems.append(
            f"{len(explicit)} host(s) now carry an explicit `nc_tier` "
            f"(e.g. {explicit[:4]}). That field was null on every host when this "
            "guard was written, so `nc_tier || <ML derivation>` in web/solver.js "
            "and web/model.js has a dead left branch. Decide deliberately whether "
            "it overrides the derivation or must agree with it, then teach this "
            "guard the answer.")

    if problems:
        raise SystemExit("Nearly Complete tier gate failed:\n  "
                         + "\n  ".join(problems))

    return {
        "hosts": len(hosts),
        "heroic": sum(1 for it in hosts if it.get("ml") == NC_HEROIC_ML),
        "legendary": sum(1 for it in hosts if it.get("ml") == NC_LEGENDARY_ML),
        "boundary_ml": NC_LEGENDARY_ML,
        "explicit_nc_tier": 0,
    }


def per_item_hosts(catalog: dict = None) -> dict:
    """`{pool label: {host name, ...}}` — the hosts each per-item pool actually
    serves (#371).

    This is the per-item analogue of the seal family's `verified_seal_types` gate:
    `src/planner_items.py` marks a `Nearly Finished` / `Almost There` host only
    when THIS pool has options for it, so an item upstream never sourced never
    grows a slot the solver cannot fill. A host whose option list carries no
    affix is not covered — an empty option list would mark a slot and then offer
    nothing, which is the inert slot the marker exists to prevent.

    Read from the same `crafting_catalog` per-item pools `build_nearly_complete`
    reads, so the gate cannot drift away from the pool it gates on.
    """
    catalog = crafting_catalog.load_catalog() if catalog is None else catalog
    out = {}
    for key in _NC_PER_ITEM_KEYS:
        hosts = set()
        if key in catalog:
            for host, opts in crafting_catalog.peritem_options(key, catalog).items():
                if any(list(crafting_catalog.iter_affixes(o)) for o in opts or []):
                    hosts.add(host)
        out[key] = hosts
    return out


def parse_categories(cats):
    """Parse the seed's category list into ``(records, quarantined)``.

    Each eligible record is ``{category, stat, bonus_type, value, unit, tier,
    wiki_url}``. Both tiers (heroic, legendary) expand to separate records.
    """
    records, quarantined = [], []
    for c in cats or []:
        category = (c.get("category") or "").strip()
        wiki_url = (c.get("wiki_url") or "").strip()
        if category not in CATEGORIES:
            quarantined.append({"raw": category, "reason": "unrecognized category"})
            continue
        if not wiki_url:
            quarantined.append({"raw": category, "reason": "missing wiki_url"})
            continue
        tier_values = {"heroic": c.get("heroic_value"), "legendary": c.get("legendary_value")}
        for opt in c.get("options") or []:
            stat = (opt.get("stat") or "").strip()
            bonus_type = (opt.get("bonus_type") or "").strip()
            if not stat or not bonus_type:
                quarantined.append({"raw": f"{category}: {opt}", "reason": "missing stat or bonus_type"})
                continue
            if bonus_type not in BONUS_TYPES:
                quarantined.append({"raw": f"{category}: {stat} ({bonus_type})", "reason": "unrecognized bonus type"})
                continue
            for tier, val in tier_values.items():
                if not isinstance(val, int):
                    quarantined.append({"raw": f"{category}/{stat}/{tier}", "reason": "missing magnitude"})
                    continue
                records.append({
                    "category": category, "stat": stat, "bonus_type": bonus_type,
                    "value": val, "unit": "flat", "tier": tier, "wiki_url": wiki_url,
                })
    return records, quarantined


def parse_nearly_complete(seed):
    """Parse a ``nearly_complete`` seed dict into structured records + coverage."""
    seed = seed or {}
    records, quarantined = parse_categories(seed.get("categories"))
    by_category = {}
    for r in records:
        by_category[r["category"]] = by_category.get(r["category"], 0) + 1
    coverage = {
        "categories_sourced": sorted({r["category"] for r in records}),
        "options_eligible": len(records),
        "options_quarantined": len(quarantined),
        "quarantined": quarantined,  # surface the reasons (mirrors dino coverage)
        "by_category": by_category,
        "item_hosts": "pending — U81 named-item pages not yet published",
    }
    return {"records": records, "quarantined": quarantined, "coverage": coverage}


def build_nearly_complete(catalog: dict = None) -> dict:
    """Native path (U4b-ii): source the Nearly Complete pools from
    ``gearplanner_crafting.json`` via ``crafting_catalog`` instead of the legacy
    ``nearly_complete.json`` seed. The strict parser gate is REMOVED, not swapped
    (F1) — native affixes flow through verbatim via ``legacy_affix``.

    TWO distinct pools (never conflated — review F5):
      * the 6 ``Nearly Complete: <category>`` MENU pools -> category ``records``
        (tier from the option's native ``ml``), the solver-consumed category path;
      * the ``Nearly Finished`` / ``Almost There`` PER-ITEM pools keyed by host
        name -> ``per_item`` ``{host: [{stat, bonus_type, value, unit, name?,
        pool}]}``, a separate per-host mechanism.

    Returns ``{records, per_item, quarantined, coverage}`` (superset of
    ``parse_nearly_complete``'s shape)."""
    catalog = crafting_catalog.load_catalog() if catalog is None else catalog
    # The option pool sits on the two recipe MLs before anything folds one to a
    # tier by `>=`. Checked HERE, where the pool is still in its source shape:
    # `records` keeps only the folded `tier`, so an ML that never belonged is
    # unrecoverable one line later.
    assert_option_mls_are_the_two_recipe_tiers(catalog)

    # -- category menu path --------------------------------------------------
    # ATOMIC since #211: one record per craftable OPTION, carrying its own
    # `affixes` list — the same UNIT shape as a Viktranium option or a Dino
    # insert. The pool was FLAT (one record per affix) while every option
    # carried exactly one affix; the ability-skills umbrellas broke that
    # invariant, because their single stored affix expands into four-to-six
    # skills that one craft grants TOGETHER. A flat pool under the solver's
    # Sigma <= 1 would tell the player they get one skill of the six — the
    # exact Viktranium defect (src/container_registry.py) one channel over.
    records = []
    source_options = 0
    for category in sorted(CATEGORIES):
        key = _NATIVE_NC_KEY[category]
        if key not in catalog:
            continue
        for opt in crafting_catalog.menu_options(key, catalog):
            source_options += 1
            tier = _nc_tier_from_ml(opt.get("ml"))
            affixes = [crafting_catalog.legacy_affix(aff)
                       for aff in crafting_catalog.iter_affixes(opt)]
            if not affixes:
                continue
            name = (opt.get("name") or "").strip()
            records.append({"category": category, "tier": tier, "wiki_url": "",
                            **({"name": name} if name else {}),
                            "affixes": affixes})

    # -- per-item path (kept SEPARATE from the category path) ----------------
    per_item = {}
    per_item_source_options = 0
    for key in _NC_PER_ITEM_KEYS:
        if key not in catalog:
            continue
        for host, opts in crafting_catalog.peritem_options(key, catalog).items():
            bucket = per_item.setdefault(host, [])
            for opt in opts or []:
                per_item_source_options += 1
                name = (opt.get("name") or "").strip()
                for aff in crafting_catalog.iter_affixes(opt):
                    rec = crafting_catalog.legacy_affix(aff)
                    rec["pool"] = key
                    if name:
                        rec["name"] = name
                    bucket.append(rec)

    by_category = {}
    for r in records:
        by_category[r["category"]] = by_category.get(r["category"], 0) + 1
    coverage = {
        "source_options": source_options,
        "per_item_source_options": per_item_source_options,
        "categories_sourced": sorted({r["category"] for r in records}),
        "options_eligible": len(records),
        "options_quarantined": 0,
        "quarantined": [],
        "by_category": by_category,
        "source": "gearplanner_crafting.json: Nearly Complete: <category> menus "
                  "(category path) + Nearly Finished / Almost There (per-item path)",
        # Category-path host disclosure is still pending the U81 named-item pages;
        # the per-item path DOES carry real hosts (counted separately, not conflated).
        "item_hosts": "pending — U81 named-item pages not yet published (category path)",
        "per_item_hosts": len(per_item),
        "per_item_options": sum(len(v) for v in per_item.values()),
        "per_item_pools": list(_NC_PER_ITEM_KEYS),
    }
    return {"records": records, "per_item": per_item, "quarantined": [],
            "coverage": coverage, "source_options": source_options,
            "per_item_source_options": per_item_source_options}
