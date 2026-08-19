"""U3 — tier-variant expansion + vocab normalization.

Two tiered shapes exist in the seed:
  * ML-line items (e.g. Ring of the Stalker) encode real per-tier magnitudes in
    `ML<n>: ...` lines — expanded into one variant per tier, each with its own
    ML and its own affixes. This resolves the min-level != listed-stats trap.
  * prose-only tiered items (e.g. The Diplomancer) describe their tier ladder in
    the `upgradeable` string but carry only one tier's stats — we record the
    tier ML list and flag `tier_values_incomplete` rather than fabricate
    magnitudes the data does not contain.
Separate-entry ladders (Heroic / Epic / Legendary rows) are already distinct
seed items and simply become distinct variants.
"""
from __future__ import annotations

import re

from src.absorption_split import QUARANTINE_FIELD
from src.affix_parser import parse_enhancements
from src.spell_focus import PROVENANCE_KEY
from src.viktranium import parse_base_lamordia, is_base_lamordia_line

_TIER_PREFIX = re.compile(r"^(ML\d+[^:]*):\s*(.*)$")
_ML_LIST = re.compile(r"ML\s*([\d/]+)")


def _parse_tier_ml_list(upgradeable: str):
    m = _ML_LIST.search(upgradeable or "")
    if not m or "/" not in m.group(1):
        return None
    return [int(x) for x in m.group(1).split("/") if x.isdigit()]


def _fresh_affixes(affixes):
    # Return fresh dicts so an affix shared across tier variants is never mutated
    # in place by a later stage (e.g. verify's per-affix eligibility flag).
    return [dict(a) for a in affixes]


def _coerce_value(v):
    """Gear-planner values arrive as strings ('3', '10'); coerce to signed int.
    A non-numeric value is left as-is (the affix's `unit`/reader decides)."""
    if isinstance(v, str):
        s = v.strip().rstrip("%")
        try:
            return int(s)
        except ValueError:
            return v
    return v


def _native_parsed(item):
    """Build the variant's affixes from the record's NATIVE gear-planner
    affix block `affixes: [{name, type, value(string)}]`, VERBATIM.

    Each native affix maps to the downstream variant shape:
      * `stat`       = native `name`
      * `bonus_type` = native `type` VERBATIM — NO vocab remap, NO quarantine
        (e.g. "Primal Natural", "Bool", "Armor", "Bludgeoning" all pass through
        as-is). Stacking-equivalence collapse (Insight Natural -> Insight) is a
        BUCKET-KEY concern applied in the solver, never a rename here.
      * `value`      = `_coerce_value(value)` (native strings "3"/"9%"/"1d6")
      * `unit`       = "pct" if the native value string ends with "%" else "flat"

    ALL native affixes are emitted — including `Bool` (value 1 -> presence) and
    weapon/alignment descriptors — so the ~11k affixes the old remap quarantined
    become live. `src.verify` still runs and stamps per-affix `eligible`. There are
    no roll-groups on this path; `structured_scaling`/`structured_flagged` (if any)
    carry through unchanged.

    R12: the rebuild is a WHITELIST, so any key not named here is destroyed. The
    shard splits (Parrying / Speed / Heightened Awareness) stamp their expansion
    provenance onto the PLANNER RECORDS, which reach this rebuild before anything
    is serialized — so `via` is carried through explicitly, the same way
    `build_dataset._native_affix` carries `eligible` and `via` at the
    serialization seam. Miss this one and every shard-split stamp dies here,
    silently, long before the serializer ever sees it. Spell focus escaped only
    because it expands AFTER this rebuild."""
    affixes = []
    for a in item.get("affixes") or []:
        raw_val = a.get("value")
        unit = "pct" if isinstance(raw_val, str) and raw_val.strip().endswith("%") else "flat"
        name = a.get("name")
        atype = a.get("type")
        out = {
            "stat": name,
            "bonus_type": atype,
            "value": _coerce_value(raw_val),
            "unit": unit,
            "raw": f'{atype or ""} {name or ""} {"" if raw_val is None else raw_val}'.strip(),
        }
        if PROVENANCE_KEY in a:
            out[PROVENANCE_KEY] = a[PROVENANCE_KEY]
        affixes.append(out)
    return {"affixes": affixes,
            "scaling": item.get("structured_scaling") or [],
            "rolls": [],
            "flagged": item.get("structured_flagged") or []}


# U2 — native gear-planner `type` -> lowercase armor class, matching
# web/dataset.js ARMOR_TYPE_MAP and the wizard's query.armorTypes. Stamped at
# build so items.json is honest at rest (the runtime normalizer re-derives the
# same value; this is the single source of truth, not a parallel vocabulary).
# Docents and any unmapped/absent type stay "unknown" — docents are handled by
# the race gate, and "unknown" keeps the armor-type filter fail-open.
_ARMOR_TYPE_MAP = {
    "Cloth armor": "cloth",
    "Light armor": "light",
    "Medium armor": "medium",
    "Heavy armor": "heavy",
}


def _armor_type_for(slot, typ):
    if slot != "Armor":
        return None
    return _ARMOR_TYPE_MAP.get(typ, "unknown")


def _make_variant(item, ml, tier_label, parsed):
    slot = item["slot"]
    return {
        "source_item": item["name"],
        "variant_id": item["name"] + (f" [{tier_label}]" if tier_label else ""),
        "tier_label": tier_label,
        "category": item["category"],
        "slot": slot,
        "minimum_level": ml,
        # --- native gear-planner item fields (U3) -----------------------------
        # Carried onto every variant so the load-time normalizer can read them
        # (armor_type is derived from native `type`) and so items.json is
        # near-native at rest. Absent on legacy base-seed items -> None.
        "ml": ml,
        "type": item.get("type"),
        "crafting": item.get("crafting"),
        "sets": item.get("sets"),
        "artifact": item.get("artifact"),
        "binding": item.get("binding"),
        "location_quest": item.get("location_quest"),
        "wiki_url": item.get("wiki_url"),
        "augment_slots": item.get("augment_slots", []),
        "set_bonus": item.get("set_bonus", []),
        "affixes": _fresh_affixes(parsed["affixes"]),
        "scaling": parsed["scaling"],
        "roll_groups": parsed["rolls"],
        "flagged": parsed["flagged"],
        "restrictions": "unknown",             # sourced later (R18); fail-open
        "armor_type": _armor_type_for(slot, item.get("type")),  # U2 SSOT: from native `type`
        # #162 — wiki-sourced item material (shields + body armor), the field
        # gear-planner has no equivalent for. Stamped at build so the artifact is
        # honest at rest; absent/None means unsourced and every consumer fails open.
        "material": item.get("material"),
        # #249 (U6) — compound-absorption carriers the wiki shard does not confirm.
        # Stamped here for the same reason `material` directly above is: quarantine
        # is decided in Python against the seed shard, and neither `web/solver.js`
        # nor `web/model.js` receives dataset metadata — so the exclusion has to
        # ride on the variant the solver already holds.
        #
        # Emitted ONLY when something was excluded, unlike `material` above, which
        # is a real per-item property worth recording as unsourced. This is an
        # exception marker: absent means nothing was excluded, which is the state
        # of every item today. `web/solver.js` reads it as `(v && v.field) || []`,
        # so absent and null are already indistinguishable to every consumer — and
        # stamping the null anyway cost 353KB across 9,034 variants in an artifact
        # every visitor downloads.
        **({QUARANTINE_FIELD: item[QUARANTINE_FIELD]} if item.get(QUARANTINE_FIELD) else {}),
        "tier_values_incomplete": False,
        "tier_ml_list": None,
        # U81 Nearly-Complete host marker (category) — propagated so the solver's
        # NC machinery can attach a craftable 4th affix to this item.
        "nearly_complete": item.get("nearly_complete"),
        "nc_tier": item.get("nc_tier"),
        # #371 — per-item Nearly Complete host markers [{pool}] ("Nearly Finished"
        # / "Almost There"). Emitted ONLY when the item's own pool covers it, so a
        # present marker means the solver has options to offer; propagated so the
        # solver crafts one option from THIS item's pool per slot.
        **({"nc_per_item_slots": item["nc_per_item_slots"]}
           if item.get("nc_per_item_slots") else {}),
        # U81 Viktranium ("Lamordia") typed-slot host markers [{type, category}] —
        # propagated so the solver crafts the best option per slot from its pool.
        "lamordia_slots": item.get("lamordia_slots"),
        # Seal-slot host markers [{seal_type, category}] — propagated so the solver
        # unseals the best option from the seal_type's pool (single-pick).
        "seal_slots": item.get("seal_slots"),
        # Vecna "Lost Purpose" tier marker ('heroic'|'legendary') — propagated so the
        # build attaches the chosen-set-membership slot (pool = same-tier Vecna sets).
        "lost_purpose": item.get("lost_purpose"),
        # Legendary Thunder-Forged multi-tier choice-slot marker: a list of tier slots
        # [{tier:1},{tier:2},{tier:3}] the solver crafts one option per (mirrors lamordia_slots).
        "thunder_forged_tiers": item.get("thunder_forged_tiers"),
        # Legendary Green Steel single-pick choice-slot marker (truthy = host).
        "green_steel_slot": item.get("green_steel_slot"),
    }


def _combine(base, extra):
    return {
        "affixes": list(base["affixes"]) + list(extra["affixes"]),
        "scaling": list(base["scaling"]) + list(extra["scaling"]),
        "rolls": list(base["rolls"]) + list(extra["rolls"]),
        "flagged": list(base["flagged"]) + list(extra["flagged"]),
    }


def expand_item(item) -> list:
    # Native path: a gear-planner record carries a native `affixes` block
    # [{name, type, value}]; build the variant's affixes from it VERBATIM (no
    # remap, no quarantine) and skip the free-text `parse_enhancements` round-trip.
    # gear-planner records are per-ML separate entries (no `ML<n>:` tier lines), so
    # this emits a single variant. Marker fields (augment_slots, set_bonus,
    # seal_slots, lamordia_slots, …) come from the record's own keys via
    # _make_variant. Native augment-stone pool records take this path too.
    if isinstance(item.get("affixes"), list):
        parsed = _native_parsed(item)
        var = _make_variant(item, ml=item.get("minimum_level"), tier_label=None,
                            parsed=parsed)
        var["lamordia_slots"] = item.get("lamordia_slots")
        return [var]

    lines = item.get("enhancements", [])
    # Base-seed Lamordia host markers are human-readable enhancement strings (the
    # enriched path uses the {{Lamordia Slot}} template instead). Recover them into
    # lamordia_slots and drop them from the affix lines so they neither pollute
    # `flagged` nor get silently lost. An explicit `lamordia_slots` field (from the
    # enriched pipeline) always wins over string parsing.
    lamordia_slots = item.get("lamordia_slots") or parse_base_lamordia(lines) or None
    lines = [l for l in lines if not is_base_lamordia_line(l)]
    tier_lines = [l for l in lines if _TIER_PREFIX.match(l)]
    base_lines = [l for l in lines if not _TIER_PREFIX.match(l)]
    base_parsed = parse_enhancements(base_lines)

    if tier_lines:
        variants = []
        for tl in tier_lines:
            m = _TIER_PREFIX.match(tl)
            prefix, rest = m.group(1).strip(), m.group(2)
            ml = int(re.search(r"ML(\d+)", prefix).group(1))
            tier_parsed = parse_enhancements([s.strip() for s in rest.split(",")])
            variants.append(_make_variant(
                item, ml=ml, tier_label=prefix,
                parsed=_combine(base_parsed, tier_parsed)))
    else:
        var = _make_variant(item, ml=item.get("minimum_level"), tier_label=None,
                            parsed=base_parsed)
        ml_list = _parse_tier_ml_list(item.get("upgradeable", ""))
        if ml_list and len(ml_list) > 1:
            var["tier_values_incomplete"] = True
            var["tier_ml_list"] = ml_list
        variants = [var]

    for v in variants:
        v["lamordia_slots"] = lamordia_slots
    return variants


def expand_dataset(items) -> list:
    variants = []
    for item in items:
        try:
            variants.extend(expand_item(item))
        except (KeyError, TypeError, AttributeError) as exc:
            name = item.get("name", "<unnamed>") if isinstance(item, dict) else "<non-dict>"
            raise ValueError(f"failed to expand seed item {name!r}: {exc!r}") from exc
    return variants
