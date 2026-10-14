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
    # #878 — an upgrade slot whose color the player CHOOSES ("Yellow or Blue")
    # is one slot of its own kind, not a slot of every listed color.
    choice = _choice_color(text)
    if choice:
        return {"color": choice, "raw": raw, "reason": None}
    # anything else with a conjunction / qualifier is an ambiguous multi-color hint
    if re.search(r"\bor\b|\band\b|\+|/|ideally|,", text, re.I):
        return {"color": None, "raw": raw, "reason": "ambiguous multi-color slot"}
    return {"color": None, "raw": raw, "reason": "unrecognized color"}


# --- U2: augment color-compatibility (the DDO wiki matrix) --------------------
# Which augment colors a slot of a given color accepts. Sourced from the DDO wiki
# `Augment Slot` page: a secondary slot accepts its two component primaries + its
# own color + Colorless; a primary slot accepts its own color + Colorless; a
# Colorless slot accepts Colorless only; Moon/Sun accept only their own (they do
# not cross-fit with colored augments). Colorless augments fit every COLORED slot
# (not Moon/Sun). This is the single source of truth; the build bakes its inverse
# (`fits_slots`) onto each augment so the JS solver only does set-membership.
SLOT_ACCEPTS = {
    "Colorless": {"Colorless"},
    "Red": {"Red", "Colorless"},
    "Blue": {"Blue", "Colorless"},
    "Yellow": {"Yellow", "Colorless"},
    "Purple": {"Red", "Blue", "Purple", "Colorless"},
    "Orange": {"Red", "Yellow", "Orange", "Colorless"},
    "Green": {"Blue", "Yellow", "Green", "Colorless"},
    "Moon": {"Moon"},
    "Sun": {"Sun"},
}


# #878 — a COLOR-CHOICE slot: an Epic item's upgrade slot is ONE slot whose color the
# player picks from a stated list (wiki: "Upgradeable - Primary Augment (Yellow
# Augment Slot or Blue Augment Slot)"). It is its own slot kind, keyed by the
# members joined with CHOICE_SEP in the order the source lists them, and it
# accepts an augment that fits ANY member — the player picks that member. Only
# the standard colors may be members: Moon/Sun do not cross-fit, and nothing
# states a choice involving them. Web code splits on the same separator
# (`choiceMembers` in solver.js / projection.js); tests pin the agreement.
CHOICE_SEP = " or "
_CHOICE_MEMBERS = {c for c in SLOT_ACCEPTS if c not in ("Moon", "Sun")}


def _choice_color(text):
    parts = [p.strip() for p in text.split(CHOICE_SEP)] if CHOICE_SEP in text else []
    canon = [_CASEMAP.get(p.lower()) for p in parts]
    if len(canon) < 2 or not all(c in _CHOICE_MEMBERS for c in canon):
        return None
    if len(set(canon)) != len(canon):
        return None
    return CHOICE_SEP.join(canon)


def choice_members(slot_color):
    """The member colors of a choice slot, or None for an ordinary slot."""
    if not isinstance(slot_color, str) or CHOICE_SEP not in slot_color:
        return None
    return slot_color.split(CHOICE_SEP)


def accepts(slot_color):
    """The set of augment colors a slot of this color accepts (empty if unknown).
    A choice slot accepts the union of its members."""
    members = choice_members(slot_color)
    if members:
        return set().union(*(SLOT_ACCEPTS.get(m, set()) for m in members))
    return set(SLOT_ACCEPTS.get(slot_color, set()))


def fits(augment_color, slot_color):
    """True if an augment of `augment_color` can be slotted into `slot_color`."""
    return augment_color in accepts(slot_color)


def fits_slots(augment_color, choice_slots=()):
    """The set of slot colors an augment of this color can fill (the inverse of
    the matrix). Baked onto each augment record at build time so the JS solver
    does plain set-membership per slot. `choice_slots` names the choice slots the
    dataset's hosts declare (#878); the open set of choices cannot be enumerated
    from the matrix alone, so the build passes the ones present."""
    out = {slot for slot, ok in SLOT_ACCEPTS.items() if augment_color in ok}
    out |= {c for c in choice_slots if fits(augment_color, c)}
    return out


def choice_slots_present(variants):
    """Every choice slot any variant's normalized slots declare, sorted."""
    return sorted({c for v in variants
                   for c in ((v.get("augment_slots_norm") or {}).get("colors") or [])
                   if choice_members(c)})


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
