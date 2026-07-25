"""U3 — canonical vocabularies.

`BONUS_TYPES` (from the parser) is the canonical bonus-type set. `CORE_STATS`
is the set of optimizer-target-relevant stats — the affixes a user actually
ranks. A stat outside CORE_STATS is not fatal; it simply is not
"target-relevant", which is what U4 uses to decide whether an item must be
quarantined vs. merely have a line flagged.
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

# Common shorthand -> canonical stat name.
STAT_ALIASES = {
    "Str": "Strength", "Dex": "Dexterity", "Con": "Constitution",
    "Int": "Intelligence", "Wis": "Wisdom", "Cha": "Charisma",
    "All Abilities": "All Ability Scores",
}


def normalize_stat(stat: str) -> str:
    return STAT_ALIASES.get(stat, stat)


def is_core_stat(stat: str) -> bool:
    return normalize_stat(stat) in CORE_STATS


def is_known_bonus_type(bt: str) -> bool:
    return bt in BONUS_TYPES
