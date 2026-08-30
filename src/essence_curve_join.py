"""#599 — join Essence Crafting effect names to their ML curve rows.

`essence_crafting.json` carries two vocabularies that do not match, and nothing
in it says how they relate:

* `placements` is keyed by **effect name** — 157 of them, from table 1b.
* `values_by_ml.effects` is keyed by **curve row** — 75 of them, from table 3b,
  a coarser FAMILY vocabulary. One row covers many effects: `Ability` covers all
  six ability scores, `Skill` covers twenty skills.

Only 22 of the 157 names match a row literally. Reading a magnitude with
`curves[effect_name]` therefore returns the wrong row or nothing, **silently** —
and unlike a missing bonus type, nothing about the result looks wrong. It has
already produced one: `Insightful Accuracy` read against the `Accuracy` row gives
23, the base competence magnitude, where `Ins. Accuracy` gives 11. That turned an
exact tie against named gear into an apparent +12 win.

So this module resolves the join explicitly, by rules that each trace to
something the wiki states, and **quarantines whatever the rules do not reach**
rather than picking a nearest match. Every resolution records which rule fired
and the evidence for it, so a reader can re-check any single answer.

The rules, strongest first:

``identity``
    The effect name IS a curve row label (case- and punctuation-insensitive).
    `Doublestrike` -> `Doublestrike`. `Armor-Piercing` -> `Armor-piercing`.

``enumeration``
    The row label spells its own members out, slash-separated:
    `Vertigo/Stunning/Shatter`, `Reflex/Fortitude/Will`, `Poison/Disease ward`,
    `Enchantment/Illusion resistance`, `Alacrity Ranged/Melee`. Membership is
    read off the label itself, which is the wiki stating it.

``group``
    For rows named after a CATEGORY rather than an effect — `Ability`, `Skill` —
    membership comes from table 2c's `Group` column, harvested into
    `essence_recipe_groups.json`. That column is the wiki stating which effects
    are abilities and which are skills.

``insightful``
    An `Insightful X` effect takes the `Ins. <row of X>` row when one exists.
    Table 3b abbreviates `Insightful` to `Ins.` throughout and the page's own
    Notes use both spellings for the same thing.

``non-scaling``
    Not a mapping but a resolution: table 2b lists the recipes that do not scale
    with ML. An effect there having no curve row is CORRECT, not a gap, and
    saying so is what stops a later sweep from hunting for a row that should not
    exist.

Nothing here is allowed to guess. `resolve_all()` returns the quarantine
alongside the mapping, and the quarantine is expected to be non-empty.
"""
from __future__ import annotations

import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CRAFTING_SHARD = os.path.join(ROOT, "data", "seed", "compendium", "essence_crafting.json")
GROUPS_SHARD = os.path.join(ROOT, "data", "seed", "compendium", "essence_recipe_groups.json")

INSIGHTFUL_PREFIX = "Insightful "
# Table 3b's abbreviation for the same word. Kept as a named constant because the
# whole `insightful` rule rests on the two being the same thing.
INS_ABBREV = "Ins. "

# Rows named after a CATEGORY, not an effect. These are the only rows whose
# membership cannot be read from the label, and the only ones the `group` rule is
# allowed to serve — so a future category row must be added here deliberately.
CATEGORY_ROWS = {
    "Ability": "Ability",   # table 2c group -> table 3b row
    "Skill": "Skill",
}

# Rows the page's own footnote says are applied automatically and cannot be
# crafted: "These bonuses do not require a separate shard or take up a slot
# (suffix/prefix/extra), nor is one possible to craft." They are therefore not
# expected to join to any craftable effect.
UNCRAFTABLE_ROWS = ("Enhance bonus*", "Weapon dice mult*", "Spellcasting implement*")


class JoinError(Exception):
    """The shards are shaped in a way the join cannot trust."""


def _norm(text: str) -> str:
    """Fold the differences that are spelling, not meaning.

    Table 2c writes `Armor-piercing` where placements writes `Armor-Piercing`.
    Case and punctuation are noise; the WORDS are the claim. Whitespace goes too,
    so table 3b's `Spellpower` reaches placements' `Spell Power` — one word or
    two is spelling, not a different effect.
    """
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def _strip_gloss(row: str) -> str:
    """Drop a row label's parenthetical gloss: `Spell Resistance (SR)` -> `Spell
    Resistance`, `Lore (one type)` -> `Lore`.

    The gloss distinguishes rows from each other, so stripping it can make two
    rows collide — `Lore (all)` and `Lore (one type)` both become `Lore`. That
    collision is DETECTED and refused rather than resolved, in `build_index`.
    """
    return re.sub(r"\s*\([^)]*\)", "", row).strip()


def _abbrev_matches(short: str, full: str) -> bool:
    """Is `short` the same label as `full`, abbreviated word by word?

    Table 3b shortens its `Ins.` rows: `Ins. Ench/Ill resistance` is the
    Insightful twin of `Enchantment/Illusion resistance`, and `Ins. Poi/Dis ward`
    of `Poison/Disease ward`. The rule is positional and mechanical — same number
    of words, each a prefix of its counterpart — never a fuzzy score.
    """
    a = [w for w in re.split(r"[^a-z0-9]+", short.lower()) if w]
    b = [w for w in re.split(r"[^a-z0-9]+", full.lower()) if w]
    return len(a) == len(b) and all(x and y.startswith(x) for x, y in zip(a, b))


def _load(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def effect_roster(placements: dict) -> list:
    return sorted({e for menus in placements.values()
                   for effects in menus.values() for e in effects})


def _enumeration_members(row: str) -> list:
    """Members a row label spells out, or [] if it names only one thing.

    `Vertigo/Stunning/Shatter` -> three members. `Poison/Disease ward` -> two,
    because the trailing word is shared: `Poison ward` and `Disease ward`.
    `Alacrity Ranged/Melee` -> `Ranged Alacrity`, `Melee Alacrity` — the shared
    word LEADS here instead, and the members read in the other order.
    """
    if "/" not in row:
        return []
    head, _, tail = row.partition("/")
    words = head.split()
    rest = tail.split("/")
    # Shared trailing word: "Poison/Disease ward" -> the last word of the final
    # alternative applies to all of them.
    last = rest[-1].split()
    if len(last) > 1 and len(words) == 1:
        shared = " ".join(last[1:])
        return [f"{words[0]} {shared}"] + [f"{r.split()[0]} {shared}" for r in rest]
    # Shared leading word: "Alacrity Ranged/Melee" -> "Ranged Alacrity", etc.
    if len(words) > 1:
        lead = words[0]
        alts = [words[-1]] + rest
        return [f"{a} {lead}" for a in alts]
    return [words[0]] + rest


def build_index(curve_rows) -> tuple:
    """Every way a curve row can be reached, plus the keys that are ambiguous.

    Returns `(index, ambiguous)`. A key two different rows both answer to is put
    in `ambiguous` and removed from `index` — an effect reaching it is
    quarantined, never silently given whichever row was seen first.
    """
    index, ambiguous = {}, {}

    def offer(key, row, rule):
        if not key:
            return
        prior = index.get(key)
        if prior is None:
            index[key] = (row, rule)
        elif prior[0] != row:
            ambiguous.setdefault(key, {prior[0]}).add(row)

    for row in curve_rows:
        if row.startswith(INS_ABBREV):
            continue  # reached via the `insightful` rule, not directly
        offer(_norm(row), row, "identity")
        gloss = _strip_gloss(row)
        if gloss != row:
            offer(_norm(gloss), row, "gloss")
        for member in _enumeration_members(row):
            offer(_norm(member), row, "enumeration")

    for key in ambiguous:
        index.pop(key, None)
    return index, {k: sorted(v) for k, v in ambiguous.items()}


def _insightful_row(base_row: str, row_set) -> list:
    """The `Ins.` twin(s) of a base row, matched by the abbreviation rule."""
    return [c for c in row_set
            if c.startswith(INS_ABBREV)
            and _abbrev_matches(_strip_gloss(c[len(INS_ABBREV):]), _strip_gloss(base_row))]


def resolve_all() -> dict:
    """Resolve every craftable effect to a curve row, or quarantine it.

    Returns `{"mapping": ..., "quarantine": ..., "stats": ...}`. The quarantine
    is expected to be non-empty — an effect the rules cannot reach, or that two
    rows both answer to, is recorded with the reason rather than guessed at.
    """
    crafting = _load(CRAFTING_SHARD)
    groups = _load(GROUPS_SHARD)

    curve_rows = list(crafting["values_by_ml"]["effects"])
    roster = effect_roster(crafting["placements"])
    if not roster or not curve_rows:
        raise JoinError("refusing to resolve nothing: the shards produced an empty roster or row set")

    index, ambiguous_keys = build_index(curve_rows)
    row_set = set(curve_rows)

    name_to_group = {_norm(n): grp
                     for grp, names in groups["scaling_groups"].items()
                     for n in names}
    non_scaling = {_norm(n) for n in groups["non_scaling"]}
    for stem in groups["efficient_metamagic"]:
        non_scaling.add(_norm("Efficient Metamagic " + stem))
    non_scaling.add(_norm("Efficient Metamagic"))

    mapping, quarantine = {}, {}
    for effect in roster:
        insightful = effect.startswith(INSIGHTFUL_PREFIX)
        base = effect[len(INSIGHTFUL_PREFIX):] if insightful else effect
        key = _norm(base)

        if key in ambiguous_keys:
            quarantine[effect] = {
                "reason": "ambiguous",
                "detail": (f"Two curve rows answer to this name: {ambiguous_keys[key]}. "
                           "Choosing one would be a coin flip recorded as a game value."),
            }
            continue

        hit = index.get(key)
        group = name_to_group.get(key)
        row_name = CATEGORY_ROWS.get(group or "")

        if hit is not None:
            row, rule = hit
            evidence = f"curve row {row!r} reached by {rule}"
        elif row_name and row_name in row_set:
            row, rule = row_name, "group"
            evidence = f"table 2c lists {base!r} in group {group!r}; row {row_name!r}"
        else:
            if key in non_scaling:
                quarantine[effect] = {
                    "reason": "non-scaling",
                    "detail": ("table 2b lists this recipe as non-scaling, so it has no ML curve. "
                               "Having no row is correct here, not a gap."),
                }
            else:
                quarantine[effect] = {
                    "reason": "unmapped",
                    "detail": ("No rule reaches a curve row: the name is not a row label, no row "
                               "label enumerates it, and table 2c gives it no category group."),
                }
            continue

        if insightful:
            twins = _insightful_row(row, row_set)
            if len(twins) == 1:
                mapping[effect] = {"row": twins[0], "rule": "insightful",
                                   "evidence": f"{evidence}; its Ins. twin is {twins[0]!r}"}
            elif not twins:
                quarantine[effect] = {
                    "reason": "no-insightful-row",
                    "detail": (f"The base effect resolves to {row!r}, but table 3b publishes no "
                               f"Ins. twin for it. The Insightful magnitude is unsourced."),
                }
            else:
                quarantine[effect] = {
                    "reason": "ambiguous",
                    "detail": f"{row!r} has more than one Ins. twin: {sorted(twins)}",
                }
            continue

        mapping[effect] = {"row": row, "rule": rule, "evidence": evidence}

    used = {m["row"] for m in mapping.values()}
    by_reason = {}
    for q in quarantine.values():
        by_reason[q["reason"]] = by_reason.get(q["reason"], 0) + 1
    return {
        "mapping": mapping,
        "quarantine": quarantine,
        "ambiguous_keys": ambiguous_keys,
        "stats": {
            "roster": len(roster),
            "mapped": len(mapping),
            "quarantined": len(quarantine),
            "by_reason": by_reason,
            "curve_rows": len(curve_rows),
            "rows_used": len(used),
            "rows_unused": sorted(row_set - used),
        },
    }


def curve_for(effect: str):
    """The ML curve for one effect, or None when it is quarantined.

    The ONLY supported way to read a magnitude for a craftable effect. Indexing
    `values_by_ml.effects` by an effect name is the bug this module exists for.
    """
    resolved = resolve_all()
    entry = resolved["mapping"].get(effect)
    if entry is None:
        return None
    return _load(CRAFTING_SHARD)["values_by_ml"]["effects"][entry["row"]]
