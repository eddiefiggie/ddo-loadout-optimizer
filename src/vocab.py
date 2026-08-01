"""U3 — canonical vocabularies.

`BONUS_TYPES` (from the parser) is the canonical bonus-type set. `CORE_STATS`
is the set of optimizer-target-relevant stats — the affixes a user actually
ranks.

Scope note: `CORE_STATS` / `is_core_stat` are **solver-facing scaffolding** for
Milestone 2 (target-relevance is applied at query time). The U4 verification
gate (`verify.py`) does NOT consume them — it quarantines purely on whether an
item has any solver-eligible affix. `normalize_stat` IS used by U3 to
canonicalize affix stat names during variant expansion.
"""
from __future__ import annotations

from src.affix_parser import BONUS_TYPES  # re-exported canonical bonus types

# Ability scores plus the combat/defensive stats DDO builds commonly chase.
CORE_STATS = {
    "Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma",
    "Deadly", "Seeker", "Accuracy", "Dodge", "PRR", "MRR",
    "Physical Sheltering", "Magical Sheltering", "Fortification",
    "Melee Power", "Ranged Power", "Spell Power", "Doublestrike", "Doubleshot",
    "Sheltering", "Well Rounded", "False Life", "Healing Amplification",
    "Armor-Piercing", "Vitality", "Devotion", "Nullification", "Potency",
}

# Common shorthand -> canonical stat name. Unify names that mean the SAME stat
# but are spelled differently across sources (base seed, enrichment, set
# bonuses), so a target matches every affix regardless of spelling.
STAT_ALIASES = {
    "Str": "Strength", "Dex": "Dexterity", "Con": "Constitution",
    "Int": "Intelligence", "Wis": "Wisdom", "Cha": "Charisma",
    "All Abilities": "All Ability Scores",
    # PRR / MRR: the resistance-rating stats == their "Sheltering" affix wording.
    # Canonicalize to the affix name (the dominant spelling on real gear).
    "PRR": "Physical Sheltering",
    "MRR": "Magical Sheltering",
    "Physical Resistance Rating": "Physical Sheltering",
    "Magical Resistance Rating": "Magical Sheltering",
    # Fortification Bypass is the same stat as Armor-Piercing.
    "Fortification Bypass": "Armor-Piercing",
    "Fortification Bypass (Armor-Piercing)": "Armor-Piercing",
}


def normalize_stat(stat: str) -> str:
    return STAT_ALIASES.get((stat or "").strip(), stat)


def is_core_stat(stat: str) -> bool:
    return normalize_stat(stat) in CORE_STATS


def is_known_bonus_type(bt: str) -> bool:
    return bt in BONUS_TYPES


# --- U2: gear-planner structured-affix type reconciliation (KTD3 / KTD6) -----
#
# The gear-planner dump (data/seed/compendium/raw/gearplanner_items.json) already
# types every affix; the structured-affix path (variants._structured_parsed) uses
# these directly instead of re-inferring from free text. This map is built from
# the *actual* distinct `type` tokens present in that dump — not an assumed list —
# and is used ONLY on the structured path. It deliberately does NOT extend
# affix_parser.BONUS_TYPES: several tokens (Vitality, Luck, Armor, …) are also
# stat words in wiki free text, so adding them to the parser's set would regress
# wiki parsing. The solver buckets by bonus_type string, so a canonical string is
# all the structured path needs.

GEARPLANNER_TYPE_MAP = {
    # already-canonical project bonus types
    "Enhancement": "Enhancement", "Equipment": "Equipment", "Insight": "Insight",
    "Competence": "Competence", "Quality": "Quality", "Resistance": "Resistance",
    "Exceptional": "Exceptional", "Profane": "Profane", "Sacred": "Sacred",
    "Legendary": "Legendary",
    # legit DDO stacking types the project lacked (observed in the dump)
    "Armor": "Armor", "Implement": "Implement", "Shield": "Shield",
    "Deflection": "Deflection", "Vitality": "Vitality", "Natural": "Natural",
    "Orb": "Orb", "Luck": "Luck", "Determination": "Determination",
    "Maximum dexterity": "Maximum dexterity",
    # "<Type> Natural" (natural-armor AC bonus of a stacking type) -> the type
    "Primal Natural": "Primal", "Insight Natural": "Insight",
    # penalties keep their identity; the reader preserves the negative sign
    "Penalty": "Penalty",
    # weapon-damage / bane / alignment descriptors: emitted verbatim so nothing is
    # lost, but excluded from the rankable vocabulary (see NON_RANKABLE_TYPES / U4)
    "Sneak Attack": "Sneak Attack", "Bludgeoning": "Bludgeoning",
    "Piercing": "Piercing", "Slashing": "Slashing",
    "Good": "Good", "Evil": "Evil", "Lawful": "Lawful", "Chaotic": "Chaotic",
    # NOTE: "Bool" is routed to the boolean-presence mechanism, not this map.
    # Unmapped tokens ("-", "Adamantine", "Epic", anything new) -> quarantine.
}

# Recognized-but-not-rankable bonus types: emitted on items, but kept out of the
# priority-picker's curated vocabulary (U4) because a user never ranks them.
NON_RANKABLE_TYPES = {
    "Penalty", "Sneak Attack", "Bludgeoning", "Piercing", "Slashing",
    "Good", "Evil", "Lawful", "Chaotic",
}

# KTD6: null/absent gear-planner `type` -> quarantine by default (they are
# overwhelmingly weapon procs/banes, not rankable ability affixes, and quarantine
# vs. emit is solve-neutral since they never match a ranked target). This small
# allowlist promotes genuinely-real typeless stats to a live affix as verified.
NULL_TYPE_ALLOWLIST = {
    "Wizardry": "Enhancement",
    "Magical Efficiency": "Enhancement",
    "Maximum Charge Tier": "Enhancement",
}


def map_gearplanner_type(token, name=None):
    """Resolve a gear-planner affix `type` token for the structured path.

    Returns ``(disposition, bonus_type)``:
      * ``("emit", <canonical>)``  — emit as a magnitude affix of that bonus type
      * ``("boolean", "boolean")`` — route to the boolean-presence mechanism (Bool)
      * ``("quarantine", None)``   — flag + disclose, do not emit as a live affix

    Null/absent ``type`` quarantines (KTD6) unless ``name`` is on the verified
    allowlist. Any unmapped token quarantines (exclude-until-verified).
    """
    if token == "Bool":
        return ("boolean", "boolean")
    if token in GEARPLANNER_TYPE_MAP:
        return ("emit", GEARPLANNER_TYPE_MAP[token])
    if token in (None, ""):
        if name in NULL_TYPE_ALLOWLIST:
            return ("emit", NULL_TYPE_ALLOWLIST[name])
        return ("quarantine", None)
    return ("quarantine", None)
