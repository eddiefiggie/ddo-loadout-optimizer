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

from src.affix_parser import parse_enhancements
from src import vocab

_TIER_PREFIX = re.compile(r"^(ML\d+[^:]*):\s*(.*)$")
_ML_LIST = re.compile(r"ML\s*([\d/]+)")


def _parse_tier_ml_list(upgradeable: str):
    m = _ML_LIST.search(upgradeable or "")
    if not m or "/" not in m.group(1):
        return None
    return [int(x) for x in m.group(1).split("/") if x.isdigit()]


def _normalize_affixes(affixes):
    # Return fresh dicts: this both canonicalizes the stat and de-aliases the
    # affix objects so a base affix shared across tier variants is never mutated
    # in place by a later stage (e.g. verify's per-affix eligibility flag).
    return [{**a, "stat": vocab.normalize_stat(a["stat"])} for a in affixes]


def _make_variant(item, ml, tier_label, parsed):
    slot = item["slot"]
    return {
        "source_item": item["name"],
        "variant_id": item["name"] + (f" [{tier_label}]" if tier_label else ""),
        "tier_label": tier_label,
        "category": item["category"],
        "slot": slot,
        "minimum_level": ml,
        "binding": item.get("binding"),
        "location_quest": item.get("location_quest"),
        "wiki_url": item.get("wiki_url"),
        "augment_slots": item.get("augment_slots", []),
        "set_bonus": item.get("set_bonus", []),
        "affixes": _normalize_affixes(parsed["affixes"]),
        "scaling": parsed["scaling"],
        "roll_groups": parsed["rolls"],
        "flagged": parsed["flagged"],
        "restrictions": "unknown",             # sourced later (R18); fail-open
        "armor_type": "unknown" if slot == "Armor" else None,  # R11 dodge cap
        "tier_values_incomplete": False,
        "tier_ml_list": None,
        # U81 Nearly-Complete host marker (category) — propagated so the solver's
        # NC machinery can attach a craftable 4th affix to this item.
        "nearly_complete": item.get("nearly_complete"),
        "nc_tier": item.get("nc_tier"),
    }


def _combine(base, extra):
    return {
        "affixes": list(base["affixes"]) + list(extra["affixes"]),
        "scaling": list(base["scaling"]) + list(extra["scaling"]),
        "rolls": list(base["rolls"]) + list(extra["rolls"]),
        "flagged": list(base["flagged"]) + list(extra["flagged"]),
    }


def expand_item(item) -> list:
    lines = item.get("enhancements", [])
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
        return variants

    var = _make_variant(item, ml=item.get("minimum_level"), tier_label=None,
                        parsed=base_parsed)
    ml_list = _parse_tier_ml_list(item.get("upgradeable", ""))
    if ml_list and len(ml_list) > 1:
        var["tier_values_incomplete"] = True
        var["tier_ml_list"] = ml_list
    return [var]


def expand_dataset(items) -> list:
    variants = []
    for item in items:
        try:
            variants.extend(expand_item(item))
        except (KeyError, TypeError, AttributeError) as exc:
            name = item.get("name", "<unnamed>") if isinstance(item, dict) else "<non-dict>"
            raise ValueError(f"failed to expand seed item {name!r}: {exc!r}") from exc
    return variants
