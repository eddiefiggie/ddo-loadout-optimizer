"""#907 — item enchantments read from our own wiki harvest (own item harvest, #911).

Each enchantment line on an item page is a template call — `{{Stat|INT|8}}`,
`{{Save|Fortitude|3|Insightful}}`. A MAPPER per template turns the call into the
`(name, bonus type, value)` affixes the catalog uses (gear-planner's vocabulary,
because every downstream stage and the stacking buckets already speak it).

THE BONUS TYPE IS THE STACKING RULE, so it is never guessed. Where the call does not
name a type, the mapper uses the default the template's OWN documentation states
(`Template:<name>`, "Enhancement (default)"); each default below cites it, and
`TEMPLATE_DEFAULTS` is checked against the harvested template docs so a changed
default fails a test instead of silently restacking every item that uses it.

A call a mapper cannot read — an unknown argument, a roman numeral where a number
is required, a template with no mapper yet — raises `Unmapped`. The caller
quarantines that one affix, never the item, and never fills it in.

Written from the wiki's templates directly; gear-planner carries no license, so
none of its parser is ported (plan constraint 1).
"""
from __future__ import annotations

import re

from src.wiki_item_meta import _split_top

COMMENT_RE = re.compile(r"<!--.*?-->", re.S)


class Unmapped(ValueError):
    pass


#: template -> (default bonus type, the template CODE that renders it). Read from
#: the code, not the usage notes: `Template:Resistance`'s notes say "Default=
#: Enhancement" while its code renders `{{Insightful|{{{2|Resistance}}}}} bonus`,
#: and the rendered text is what the game shows (rendered-value authority).
#: Verified against the committed evidence shard by tests/test_wiki_enchantments.py.
TEMPLATE_DEFAULTS = {
    "Stat": ("Enhancement", "{{Insightful|{{{3|Enhancement}}}}} bonus"),
    "Sheltering": ("Enhancement", "{{ucfirst:{{lc:{{{2|enhancement}}}}}}}}} bonus"),
    "Resistance": ("Resistance", "{{Insightful|{{{2|Resistance}}}}} bonus"),
    "Doublestrike": ("Enhancement", "{{{2|Enhancement}}}"),
    "Accuracy": ("Competence", "{{Insightful|{{{2|Competence}}}}} bonus"),
    "Deadly": ("Competence", "{{Insightful|{{{2|Competence}}}}} bonus"),
    "Dodge": ("Enhancement", "{{{2|Enhancement}}}"),
    "Seeker": ("Enhancement", "{{{2|enhancement}}}"),
}

ABILITY = {"str": "Strength", "strength": "Strength", "dex": "Dexterity", "dexterity": "Dexterity",
           "con": "Constitution", "constitution": "Constitution", "int": "Intelligence",
           "intelligence": "Intelligence", "wis": "Wisdom", "wisdom": "Wisdom", "cha": "Charisma",
           "charisma": "Charisma"}
#: Template-specific type switches, quoted from each template's code. Seeker:
#: `|exc|exceptional|ins|insightful = Insight`.
TYPE_SWITCH = {"Seeker": {"exc": "Insight", "exceptional": "Insight", "ins": "Insight", "insightful": "Insight"}}


def _insightful(v):
    """`Template:Insightful` (rev 678297): `ins|insight|insightful` -> Insight,
    anything else sentence-cased (`Scase`)."""
    v = v.strip()
    if v.lower() in ("ins", "insight", "insightful"):
        return "Insight"
    return v[:1].upper() + v[1:].lower()


def _roman(v):
    """`Template:Roman2Dec` (rev 639664): a number passes through, I/V/X/L/C/D/M convert."""
    v = (v or "").strip().lstrip("+")
    if re.fullmatch(r"-?\d+", v):
        return int(v)
    vals = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
    if not v or any(c not in vals for c in v.upper()):
        raise Unmapped(f"not a number or roman numeral: {v!r}")
    total, prev = 0, 0
    for c in reversed(v.upper()):
        n = vals[c]
        total, prev = (total - n, prev) if n < prev else (total + n, n)
    return total


def depth(line: str) -> int:
    """List depth of an enchantment line: `*` is 1, `**` is 2. A nested line is a
    sub-option (an upgrade tier, a choice, a set's grant) — not the item's own."""
    m = re.match(r"\s*([*#:]*)", line)
    return len(m.group(1)) if m else 0


def parse_call(line: str):
    """`(template, positional, named)` for one enchantment line, or None when the
    line is not a template call. `3=Physical` is positional argument 3."""
    line = COMMENT_RE.sub("", line).strip().lstrip("*#:").strip()
    if not line.startswith("{{"):
        return None
    depth, i = 0, 0
    while i < len(line):
        two = line[i:i + 2]
        if two in ("{{", "[["):
            depth += 1; i += 2; continue
        if two in ("}}", "]]"):
            depth -= 1; i += 2
            if depth == 0:
                break
            continue
        i += 1
    parts = _split_top(line[2:i - 2])
    name = parts[0].strip().replace("_", " ")
    name = name[:1].upper() + name[1:]
    positional, named = [], {}
    for p in parts[1:]:
        kv = _split_top(p, "=")
        if len(kv) > 1 and kv[0].strip().isdigit():
            idx = int(kv[0].strip()) - 1
            positional.extend([""] * (idx + 1 - len(positional)))
            positional[idx] = "=".join(kv[1:]).strip()
        elif len(kv) > 1:
            named[kv[0].strip().lower()] = "=".join(kv[1:]).strip()
        else:
            positional.append(p.strip())
    return name, positional, named


def _int(v):
    v = (v or "").strip().lstrip("+")
    if re.fullmatch(r"-?\d+", v):
        return int(v)
    raise Unmapped(f"not an integer amount: {v!r}")


def _type(v, template):
    if v is None or not v.strip():
        return TEMPLATE_DEFAULTS[template][0]
    sw = TYPE_SWITCH.get(template, {})
    return sw.get(v.strip().lower()) or _insightful(v)


def _penalty(stat, t, value):
    """A negative magnitude is a penalty, and penalties always stack (#614) — the
    catalog's `Penalty` type, whatever bonus type the template would have named."""
    return (stat, "Penalty", value) if value < 0 else (stat, t, value)


def _arg(pos, i):
    return pos[i] if len(pos) > i else None


def m_stat(pos, named):
    which = (_arg(pos, 0) or "").strip().lower()
    if which == "well rounded":
        # Template:Stat's own switch: `|well rounded = Well Rounded` — one affix that
        # the catalog expands into all six abilities (web/dataset.js).
        return [_penalty("Well Rounded", _type(_arg(pos, 2), "Stat"), _int(_arg(pos, 1)))]
    if which not in ABILITY:
        raise Unmapped(f"Stat ability {which!r} is not a single ability")
    return [_penalty(ABILITY[which], _type(_arg(pos, 2), "Stat"), _int(_arg(pos, 1)))]


def _simple(stat, template, amount=None):
    amount = amount or _int

    def m(pos, named):
        return [_penalty(stat, _type(_arg(pos, 1), template), amount(_arg(pos, 0)))]
    return m


def _percent(v):
    """`Template:Doublestrike` takes "String value (1% - 100%)" or a number."""
    return _int((v or "").strip().rstrip("%"))


def m_sheltering(pos, named):
    kind = (_arg(pos, 2) or "").strip().lower()
    stat = {"magical": "Magical Sheltering", "physical": "Physical Sheltering", "": "Sheltering"}.get(kind)
    if stat is None:
        raise Unmapped(f"Sheltering kind {kind!r}")
    return [(stat, _type(_arg(pos, 1), "Sheltering"), _int(_arg(pos, 0)))]


MAPPERS = {
    "Stat": m_stat,
    "Sheltering": m_sheltering,
    "Resistance": _simple("Resistance", "Resistance"),
    "Doublestrike": _simple("Doublestrike", "Doublestrike", _percent),
    "Accuracy": _simple("Accuracy", "Accuracy", _roman),
    "Deadly": _simple("Deadly", "Deadly", _roman),
    "Dodge": _simple("Dodge", "Dodge"),
    "Seeker": _simple("Seeker", "Seeker", _roman),
}


def affixes(enhancements: str):
    """`(mapped, unmapped)` for an item's OWN enchantments (top-level lines; nested
    lines are sub-options): mapped affixes as `(name, type, value)`, and the calls no
    mapper could read, as `(template, reason)`."""
    mapped, unmapped = [], []
    for line in (enhancements or "").split("\n"):
        if depth(line) > 1:
            continue
        call = parse_call(line)
        if call is None:
            continue
        name, pos, named = call
        fn = MAPPERS.get(name)
        if fn is None:
            unmapped.append((name, "no mapper"))
            continue
        try:
            mapped.extend(fn(pos, named))
        except Unmapped as e:
            unmapped.append((name, str(e)))
    return mapped, unmapped
