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
