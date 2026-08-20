"""U-umbrella — expand umbrella ability affixes into concrete ability affixes.

Some affixes buff *every* ability score at once — "All Ability Scores +15",
"Well Rounded +2" (any casing). The optimizer credits an affix only when its
stat exactly matches a ranked target, so an umbrella affix contributed NOTHING
to a single-ability build (a Constitution target ignored "All Ability Scores
+15"). Expanding each umbrella affix into the six concrete ability affixes —
same bonus type, value, and unit — fixes it at the data layer, so the objective,
the dominance pre-filter (variantBuckets), set thresholds, and browse all see the
real per-ability contribution with correct bonus-type stacking. Done once here;
no per-consumer umbrella logic needed downstream.
R12 — each expanded affix carries the ORIGINATING enchantment name under the
same key `src/spell_focus.py` writes (`PROVENANCE_KEY`), bonus-type-prefixed as
the wiki writes it: "Profane Well Rounded", not six bare ability lines. Umbrella
is a typed family (gear-planner carries Profane, Enhancement, Exceptional,
Quality and Artifact spellings), so the type is part of the engraved name — the
reported defect that produced this module was literally filed as
"Profane Well Rounded". A consumer can collapse the six back to that one line,
and can tell an expanded ability affix from a native one by the key's presence.
"""
from __future__ import annotations

from src.spell_focus import PROVENANCE_KEY, source_label

ABILITIES = ["Strength", "Dexterity", "Constitution",
             "Intelligence", "Wisdom", "Charisma"]
# lowercased stat names that mean "+X to all six abilities"
_UMBRELLA = {"all ability scores", "all ability score", "well rounded"}

# #367 — engraved names that mean the same thing but carry their OWN identity.
#
# `_UMBRELLA` holds generic words that a bonus type prefixes into the engraved
# name ("Well Rounded" + Profane -> "Profane Well Rounded"). These are already
# complete names as the item prints them, so their provenance label is the name
# VERBATIM: prefixing would print "Profane Litany of the Dead II - Ability
# Bonus", a name no item bears, on the very surface (the Sets tab's bundle card)
# whose job is to show the player the name engraved on their gear.
#
# Their label rule lives in `spell_focus.SELF_NAMED`, shared with the Combat
# arm's family (#396), so "which names take no type prefix" has one home.
#
# Membership requires the wiki stating the all-abilities grant outright, per
# affix, in the template invocation or its rendered tooltip — never inferred
# from a sibling variant's shape. Evidence: `docs/wiki-evidence/litany-of-the-dead.md`.
_NAMED_UMBRELLA = {
    "litany of the dead - ability bonus",
    "litany of the dead ii - ability bonus",
}


def is_umbrella(stat: str) -> bool:
    key = (stat or "").strip().lower()
    return key in _UMBRELLA or key in _NAMED_UMBRELLA


def umbrella_expansion() -> dict:
    """Public, read-only: ``{lowercased umbrella name: [the six ability names]}``.

    Emitted to the dataset so the picker can (a) stop offering a name this module
    expands away — no item can ever carry it, so ranking it scores nothing — and
    (b) redirect the player to the concrete stats it becomes.

    ``_UMBRELLA`` and ``_NAMED_UMBRELLA`` are the single source of truth and are
    deliberately NOT extended for picker purposes: they drive
    :func:`_expand_affix`, so adding a name to either rewrites every matching
    affix into the six ability scores at build time. Bare ``Sheltering`` is a
    different mechanism with a different expansion target (Physical + Magical
    Sheltering, expanded at the web/dataset.js seam) and must never be added.
    """
    return {name: list(ABILITIES) for name in sorted(_UMBRELLA | _NAMED_UMBRELLA)}


def _expand_affix(affix: dict) -> list:
    if is_umbrella(affix.get("stat", "")):
        # The engraved name, e.g. "Profane Well Rounded". Read from the same
        # renderer spell focus uses so the two families can never disagree about
        # how a bonus type is spelled ("Insightful", not "Insight") — and, since
        # #396, about which names are already complete and take no type prefix
        # (`SELF_NAMED`), so that rule has one home rather than one per family.
        label = source_label(affix.get("stat"), affix.get("bonus_type"))
        return [{**affix, "stat": ab, PROVENANCE_KEY: label} for ab in ABILITIES]
    return [affix]


def _expand_list(affixes):
    out = []
    for a in affixes or []:
        out.extend(_expand_affix(a))
    return out


def expand_affixes(affixes):
    """Public: expand umbrella affixes in a standalone affix list (e.g. a
    membership set-def tier), returning a new list. Same rule as expand_variants
    applies to worn/set affixes."""
    return _expand_list(affixes)


def expand_variants(variants):
    """In place: expand umbrella affixes in each variant's worn affixes and in its
    parsed set-bonus threshold affixes. Returns the same list."""
    for v in variants:
        if v.get("affixes"):
            v["affixes"] = _expand_list(v["affixes"])
        for tier in v.get("parsed_set_bonuses", []) or []:
            if tier.get("affixes"):
                tier["affixes"] = _expand_list(tier["affixes"])
    return variants
