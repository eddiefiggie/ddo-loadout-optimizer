"""M4b — item stat enrichment from DDO wiki item wikitext.

Turns a named item's `{{Named item|...}}` wikitext `| enhancements =` field into a
base-seed-shape item record (free-text `enhancements[]` strings that the existing
`src.affix_parser` consumes), so enriched items flow through the normal
`expand_dataset -> affix_parser -> verify` pipeline and become solver-active.

STRICT PROVENANCE. Each wiki template maps to an affix string ONLY when the
mapping is unambiguous (the stat + magnitude + bonus type are explicit). Every
other template — clickies, immunities, guards, granted feats, crafting/upgrade
slots, nested composites — is SKIPPED and recorded in `unmapped`, never guessed.
An item enriches with whatever mapped cleanly; unmapped effects are disclosed,
not fabricated. Values render in the parser's value-last form: `[Type] Stat +N[%]`.

Template vocabulary + example args were surveyed from live wiki items (2026-07).
"""
from __future__ import annotations

import re

from src.affix_parser import BONUS_TYPES

# Ability-score arg tokens (any case) -> canonical stat name.
_ABIL = {
    "str": "Strength", "dex": "Dexterity", "con": "Constitution",
    "int": "Intelligence", "wis": "Wisdom", "cha": "Charisma",
    "strength": "Strength", "dexterity": "Dexterity", "constitution": "Constitution",
    "intelligence": "Intelligence", "wisdom": "Wisdom", "charisma": "Charisma",
}


def _abil(tok: str) -> str:
    return _ABIL.get(tok.strip().lower(), tok.strip())


def _num(tok: str) -> bool:
    return bool(re.fullmatch(r"[+-]?\d+", tok.strip()))


def _opt_type(a, i):
    """The optional trailing bonus-type arg at index `i`, or "" — the single
    shared idiom for every renderer: present, non-empty, and not a number."""
    return a[i].strip() if len(a) > i and a[i].strip() and not _num(a[i]) else ""


def _typed(prefix_type, stat, value, pct=False):
    """Render one affix string in value-last form. `prefix_type` is peeled by the
    parser only if it is a known bonus type; harmless otherwise."""
    t = f"{prefix_type} " if prefix_type else ""
    return f"{t}{stat} +{value}{'%' if pct else ''}"


# --- per-template renderers: args (list) -> list[str] (affix lines) -----------
# Only unambiguous, magnitude-bearing effects. Anything not here is unmapped.

def _r_stat(a):
    # {{Stat|CON|13}} | {{Stat|Well Rounded|2|Profane}} | {{Stat|con|6|Insightful}}
    if len(a) < 2 or not _num(a[1]):
        return []
    return [_typed(_opt_type(a, 2), _abil(a[0]), a[1])]


def _r_skills(a):
    # {{Skills|Jump|21}} | {{Skills|Jump|21|Competence}}
    if len(a) < 2 or not _num(a[1]):
        return []
    return [_typed(_opt_type(a, 2), a[0].strip(), a[1])]


def _r_spellpower(a):
    # {{SpellPower|Devotion|146}} -> "Devotion +146"
    # {{Spell Power|Universal|15|Exceptional}} -> "Exceptional Universal +15"
    if len(a) < 2 or not _num(a[1]) or _num(a[0]):
        return []
    return [_typed(_opt_type(a, 2), a[0].strip(), a[1])]


def _r_elem_res(a):
    # {{Elemental Resistance|Fire|56}} | {{Elemental Resistance|Elemental|15|Competence}}
    if len(a) < 2 or not _num(a[1]) or _num(a[0]):
        return []
    return [_typed(_opt_type(a, 2), f"{a[0].strip()} Resistance", a[1])]


def _r_absorption(a):
    # {{Absorption|Poison|39}} | {{Absorption|Fire|20|Insightful}}
    if len(a) < 2 or not _num(a[1]) or _num(a[0]):
        return []
    return [_typed(_opt_type(a, 2), f"{a[0].strip()} Absorption", a[1], pct=True)]


def _r_sheltering(a):
    # {{Sheltering|9|Quality|Physical}} | {{Sheltering|9}} (bare = Physical/PRR by
    # DDO convention). A non-phys/mag token is only treated as the bonus type when
    # it is a real DDO bonus type; junk tokens (e.g. "Guard") are dropped, not
    # folded into the stat name.
    nums = [x for x in a if _num(x)]
    if not nums:
        return []
    val = nums[0]
    rest = [x.strip() for x in a if not _num(x) and x.strip()]
    physmag = next((x for x in rest if x.lower() in ("physical", "magical")), "Physical")
    btype = next((x for x in rest if x in BONUS_TYPES), "")
    return [_typed(btype, f"{physmag} Sheltering", val)]


def _r_spellfocus(a):
    # {{Spell Focus|Abjuration|7}} -> "Abjuration Spell Focus +7"
    # {{Spell Focus|Abjuration|3|Insightful}} -> "Insightful Abjuration Spell Focus +3"
    # {{Spell Focus|5|Insightful}} (universal, value-first) -> "Insightful Spell Focus +5"
    if len(a) >= 2 and _num(a[0]) and not _num(a[1]):
        return [_typed(a[1].strip(), "Spell Focus", a[0])]  # universal, value-first
    if len(a) < 2 or not _num(a[1]):
        return []
    return [_typed(_opt_type(a, 2), f"{a[0].strip()} Spell Focus", a[1])]


def _r_spelllore(a):
    # {{Spelllore|Healing|21}} -> "Healing Lore +21%"
    # {{Spell Lore|Universal Spell|5|Exceptional}} -> "Exceptional Universal Spell Lore +5%"
    if len(a) < 2 or not _num(a[1]):
        return []
    return [_typed(_opt_type(a, 2), f"{a[0].strip()} Lore", a[1], pct=True)]


def _r_save(a):
    # {{Save|Spell|11}} -> "Spell Save +11" | {{Save|Reflex|11|Resistance}} typed.
    # Normalize school case ("will" -> "Will") so saves aggregate; reject a
    # malformed school arg (wiki typos like {{Save|r|11}}) as unmapped rather
    # than emitting a junk "r Save" stat.
    if len(a) < 2 or not _num(a[1]):
        return []
    school = a[0].strip()
    if len(school) < 2 or _num(school):
        return []
    return [_typed(_opt_type(a, 2), f"{school.title()} Save", a[1])]


def _r_hp(a):
    # {{Hp|False Life|56}} | {{Hp|False Life|56|Insightful}} | {{Hp|Vitality|20}}
    nums = [i for i, x in enumerate(a) if _num(x)]
    if not nums:
        return []
    vi = nums[0]
    stat = " ".join(a[:vi]).strip() or "False Life"
    return [_typed(_opt_type(a, vi + 1), stat, a[vi])]


_HEALAMP_KIND = {
    "healing": "Positive", "p": "Positive", "positive": "Positive",
    "n": "Negative", "negative": "Negative",
    "repair": "Repair", "r": "Repair",
}


def _r_healamp(a):
    # {{HealingAmp|<val>|<kind>|<type>}} -> "<type> <Positive/Negative/Repair> Healing Amplification +val"
    if not a or not _num(a[0]):
        return []
    kind = _HEALAMP_KIND.get(a[1].strip().lower()) if len(a) >= 2 else "Positive"
    if not kind:
        return []
    suffix = "Amplification" if kind == "Repair" else "Healing Amplification"
    return [_typed(_opt_type(a, 2), f"{kind} {suffix}", a[0])]


def _r_tactics(a):
    # {{Tactics|Combat Mastery|<val>|<type?>}} -> "<type> Combat Mastery +val"
    if len(a) < 2 or not _num(a[1]):
        return []
    return [_typed(_opt_type(a, 2), a[0].strip(), a[1])]


def _named_value(stat, pct=False):
    """A template whose NAME is the stat and whose args are [value, type?]."""
    def render(a):
        if not a or not _num(a[0]):
            return []
        return [_typed(_opt_type(a, 1), stat, a[0], pct=pct)]
    return render


RENDERERS = {
    "stat": _r_stat,
    "skills": _r_skills,
    "spellpower": _r_spellpower,
    "spell power": _r_spellpower,        # armor uses the spaced form
    "elemental resistance": _r_elem_res,
    "absorption": _r_absorption,
    "sheltering": _r_sheltering,
    "spell focus": _r_spellfocus,
    "spelllore": _r_spelllore,
    "spell lore": _r_spelllore,          # armor uses the spaced form
    "save": _r_save,
    "hp": _r_hp,
    "healingamp": _r_healamp,
    "tactics": _r_tactics,
    # name-is-the-stat templates: {{Name|value|type?}}
    "fortification": _named_value("Fortification"),
    "seeker": _named_value("Seeker"),
    "deadly": _named_value("Deadly"),
    "accuracy": _named_value("Accuracy"),
    "resistance": _named_value("Resistance"),
    "wizardry": _named_value("Wizardry"),
    "diversion": _named_value("Diversion"),
    "parrying": _named_value("Parrying"),
    "naturalarmor": _named_value("Natural Armor"),
    "spell resistance": _named_value("Spell Resistance"),
    "spellpen": _named_value("Spell Penetration"),
    "deception": _named_value("Deception"),
    "good luck": _named_value("Good Luck"),
    "armor-piercing": _named_value("Armor-Piercing"),
    "incite": _named_value("Incite"),
    "dodge": _named_value("Dodge", pct=True),
    "doublestrike": _named_value("Doublestrike", pct=True),
    "doubleshot": _named_value("Doubleshot", pct=True),
}

# Templates deliberately NOT rendered as affixes (recorded as unmapped). Slots and
# set membership are handled separately; the rest are effects with no single
# magnitude-bearing target stat, so guessing one would violate strict provenance.
_SKIP_SILENT = {"augment", "named item sets"}  # handled specially, not "unmapped"

# U81 Nearly-Complete OPEN-slot categories (must match data/seed/nearly_complete.json).
# {{Nearly Complete|<category>|<count>}} marks an item that carries a craftable 4th
# affix from that category's pool — the host the solver's NC machinery attaches to.
# (Distinct from {{Nearly Finished|...}}, an already-made choice, left unmapped.)
NC_CATEGORIES = {
    "Ability Score", "Insightful Ability Score", "Quality Ability Score",
    "Healing Amplification", "Skill", "Spell Focus",
}


def _split_top_level(inner: str):
    """Split template inner text on top-level '|', ignoring '|' inside nested
    braces. Returns raw parts (no strip, no filtering); parts[0] is the template
    name, the rest are its args."""
    parts, depth, cur = [], 0, ""
    for ch in inner:
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth = max(0, depth - 1)
        if ch == "|" and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    return parts


def parse_enhancement_field(field: str) -> dict:
    """Parse a wikitext `| enhancements =` field into a strict enrichment result.

    Returns {enhancements: [affix strings], augment_slots: [colors],
    sets: [set names], unmapped: [template names]}.
    """
    enh, augs, sets, unmapped = [], [], [], []
    nearly_complete = None
    for raw in (field or "").split("\n"):
        line = raw.strip()
        if not line.startswith("*"):
            continue
        line = line.lstrip("*").strip()
        if not line.startswith("{{"):
            continue  # descriptive bullet, not a template
        tm = re.match(r"\{\{(.*)\}\}\s*$", line, re.S)
        if not tm:
            # a template-ish line we can't cleanly parse (trailing text / malformed)
            mm = re.match(r"\{\{\s*([^|}\n]+)", line)
            unmapped.append(mm.group(1).strip() if mm else "?")
            continue
        # Name and args come from the top-level split — never a length-based slice,
        # so idiomatic wiki spacing ("{{ Stat | CON | 13 }}") parses correctly.
        parts = _split_top_level(tm.group(1))
        name = parts[0].strip()
        if not name:
            continue
        key = name.lower()
        rest = parts[1:]
        if key == "nearly finished":
            # inline choice-slot: {{Nearly Finished|{{Stat|str|13}}|{{Stat|dex|13}}|...}}
            # -> a "Rolls one of" group; the solver picks the best option for the
            # build's targets (reuses the affix_parser roll-group machinery).
            opts = []
            for sub in rest:
                sm = re.match(r"\{\{\s*([^|}\n]+?)\s*\|(.+)\}\}\s*$", sub.strip(), re.S)
                if not sm:
                    continue
                subargs = [x.strip() for x in _split_top_level(sm.group(2)) if "=" not in x]
                r = RENDERERS.get(sm.group(1).strip().lower())
                if r:
                    opts.extend(r(subargs))
            if len(opts) >= 2:
                enh.append("Rolls one of: " + " / ".join(opts))
            else:
                unmapped.append(name)
            continue
        # nested composite (a sub-template as an arg): record, never harvest inner
        if any("{{" in p for p in rest):
            unmapped.append(name)
            continue
        # drop key=value named args (e.g. label=Rage, prefix=Insightful)
        args = [p.strip() for p in rest if "=" not in p]
        if key == "augment":
            if args:
                augs.append(args[0].strip().title())
            continue
        if key == "named item sets":
            if args:
                sets.append(args[0].strip())
            continue
        if key == "nearly complete":
            # open NC 4th-affix slot: capture the category (validated) as the host
            # marker; the solver's NC machinery crafts the best option from its pool.
            if args and args[0] in NC_CATEGORIES:
                nearly_complete = args[0]
            else:
                unmapped.append(name)
            continue
        renderer = RENDERERS.get(key)
        if renderer:
            lines = renderer(args)
            if lines:
                enh.extend(lines)
            else:
                unmapped.append(name)
        else:
            unmapped.append(name)
    return {"enhancements": enh, "augment_slots": augs, "sets": sets,
            "unmapped": unmapped, "nearly_complete": nearly_complete}


def build_item_record(name, slot, field, wiki_url, minimum_level=None,
                      armor_type=None):
    """Assemble a base-seed-shape item record from a parsed enhancement field.

    The record's `enhancements[]` are strict affix strings; `augment_slots` and a
    `(set)` marker per set are appended so browse/augment/set logic see them. The
    record flows through the normal pipeline. `_enrich_unmapped` is carried for
    honest coverage disclosure (not consumed by the solver).
    """
    parsed = parse_enhancement_field(field)
    enhancements = list(parsed["enhancements"])
    for col in parsed["augment_slots"]:
        enhancements.append(f"{col} Augment Slot")
    for s in parsed["sets"]:
        enhancements.append(f"{s} (set)")
    rec = {
        "name": name,
        "category": "item",
        "slot": slot,
        "enhancements": enhancements,
        "wiki_url": wiki_url,
        "augment_slots": [c for c in parsed["augment_slots"]],
        "_enrich_unmapped": parsed["unmapped"],
        "_enriched": True,
    }
    if minimum_level is not None:
        rec["minimum_level"] = minimum_level
    if armor_type:
        rec["armor_type"] = armor_type
    if parsed["nearly_complete"]:
        # activates the item as a U81 Nearly-Complete host; the solver crafts the
        # best option from this category's pool (tier derived from ML at solve time)
        rec["nearly_complete"] = parsed["nearly_complete"]
    return rec
