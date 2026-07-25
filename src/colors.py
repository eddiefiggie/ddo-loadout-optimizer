"""U2 — augment-slot color normalization.

Augment placement (U3) gates each augment's stat on there being an OPEN slot of a
matching color on an equipped item. That is only exact if slot colors are a clean,
canonical vocabulary. The raw seed carries clean colors ("Blue"), expansion colors
("Moon"/"Sun" = Lunar/Solar), namespaced Ravenloft colors ("Lamordia: Woeful"),
and unparseable free text ("ideally Green + Blue"). This module maps each raw
color to a canonical color or QUARANTINES it (no phantom capacity, KTD6) — never
guessing a color the wiki text does not state (KTD5).
"""
from __future__ import annotations

import re

# The base colored augment slots plus the Lunar/Solar expansion colors.
CANONICAL = {
    "Blue", "Red", "Yellow", "Green", "Orange", "Purple", "Colorless",
    "Moon", "Sun",
}

# Ravenloft "Lamordia" augments fill type-specific slots; the type is meaningful
# (a Woeful augment needs a Woeful slot), so preserve it as a namespaced color.
_LAMORDIA = re.compile(r"^Lamordia:\s*([A-Za-z]+)$", re.I)

_CASEMAP = {c.lower(): c for c in CANONICAL}


def normalize_color(raw):
    """Map one raw color to {color, raw, reason}. color is None when quarantined."""
    text = (raw or "").strip()
    if not text:
        return {"color": None, "raw": raw, "reason": "empty color"}
    # canonical (case-insensitive on the base set)
    if text.lower() in _CASEMAP:
        return {"color": _CASEMAP[text.lower()], "raw": raw, "reason": None}
    # namespaced Ravenloft color, preserved as "Lamordia: <Type>"
    m = _LAMORDIA.match(text)
    if m:
        return {"color": f"Lamordia: {m.group(1).capitalize()}", "raw": raw, "reason": None}
    # anything with a conjunction / qualifier is an ambiguous multi-color hint
    if re.search(r"\bor\b|\band\b|\+|/|ideally|,", text, re.I):
        return {"color": None, "raw": raw, "reason": "ambiguous multi-color slot"}
    return {"color": None, "raw": raw, "reason": "unrecognized color"}


def normalize_slots(raws):
    """Normalize a list of raw slot colors into {colors, quarantined}."""
    colors, quarantined = [], []
    for raw in raws or []:
        n = normalize_color(raw)
        if n["color"] is not None:
            colors.append(n["color"])
        else:
            quarantined.append({"raw": n["raw"], "reason": n["reason"]})
    return {"colors": colors, "quarantined": quarantined}


def annotate_variant(v):
    """Attach normalized augment-color fields to a variant, in place.

    Every variant gets `augment_slots_norm` (open slots it offers for hosting
    augments). An augment record (category 'augment') additionally gets
    `aug_color` — the canonical color of the slot it must occupy.
    """
    v["augment_slots_norm"] = normalize_slots(v.get("augment_slots", []))
    if v.get("category") == "augment":
        v["aug_color"] = normalize_color(v.get("slot"))
    return v


def color_coverage(variants):
    """Counts of normalized vs quarantined colors across all variants."""
    canon = quarantined = 0
    aug_placeable = aug_quarantined = 0
    for v in variants:
        norm = v.get("augment_slots_norm") or {"colors": [], "quarantined": []}
        canon += len(norm["colors"])
        quarantined += len(norm["quarantined"])
        if v.get("category") == "augment":
            if (v.get("aug_color") or {}).get("color"):
                aug_placeable += 1
            else:
                aug_quarantined += 1
    return {
        "host_slot_colors_normalized": canon,
        "host_slot_colors_quarantined": quarantined,
        "augments_placeable": aug_placeable,
        "augments_color_quarantined": aug_quarantined,
    }
