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

import json
import os
import re

from src.wiki_item_meta import _split_top

COMMENT_RE = re.compile(r"<!--.*?-->", re.S)


class Unmapped(ValueError):
    pass


class Declined(Unmapped):
    """A form the mapper deliberately does not read — a charge-based clicky, a
    legacy or authoring-slip spelling, a variant one catalog stat cannot express.
    Unlike a plain `Unmapped`, it does not keep the item whole: no affix is
    produced for it, so gear-planner's own affix for that call stands untouched."""


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
    # --- tier 2 (#907) ---
    "Skills": ("Competence", "[[{{{3|competence}}} bonus]]"),
    "Spelllore": ("Equipment", "{{lc:{{{3|equipment}}}}}"),
    "SpellPower": ("Equipment", "|equipment}}}}"),
    "Spell Focus": ("Equipment", "{{Insightful|{{{3|Equipment}}}|notful}} bonus"),
    "Elemental Resistance": ("Enhancement", "{{#switch: {{lc:{{{3|Enhancement}}}}}"),
    "HealingAmp": ("Enhancement", "{{{3|Enhancement}}}"),
    "Tactics": ("Enhancement", "{{Insightful|{{{3|Enhancement}}}}} bonus"),
    "Spellpen": ("Equipment", "{{ucfirst:{{lc:{{{2|Equipment}}}}}}} bonus"),
    # --- tier 3 (#907) ---
    "Absorption": ("Enhancement", "{{{5|Enhancement}}} Bonus"),
    "Deception": ("Enhancement", "enhancement bonus to Bluff checks"),
    "Diversion": ("Enhancement", "{{Insightful|{{{3|Enhancement}}}}} bonus"),
    "Spell Resistance": ("Enhancement", "{{Insightful|{{{2|Enhancement}}}}} bonus"),
    "Incite": ("Enhancement", "{{lc:{{{2|enhancement}}}}}"),
    "Armor-Piercing": ("Enhancement", "{{Insightful|{{{2|Enhancement}}}}} bonus"),
    "Speed": ("Enhancement", "[[enhancement bonus]]"),
}
#: Save's default differs by branch, each quoted from Template:Save (rev 560806).
SAVE = {"e": ("Enchantment Save", "Resistance"), "enchantment": ("Enchantment Save", "Resistance"),
        "i": ("Illusion Save", "Enhancement"), "illusion": ("Illusion Save", "Enhancement"),
        "s": ("Sleep Save", "Enhancement"), "sleep": ("Sleep Save", "Enhancement"),
        "spell": ("Spell Save", "Resistance"),
        "f": ("Fortitude Save", "Resistance"), "fort": ("Fortitude Save", "Resistance"),
        "fortitude": ("Fortitude Save", "Resistance"),
        "r": ("Reflex Save", "Resistance"), "ref": ("Reflex Save", "Resistance"), "reflex": ("Reflex Save", "Resistance"),
        "w": ("Will Save", "Resistance"), "will": ("Will Save", "Resistance"),
        "curse": ("Curse Resistance", "Enhancement")}
#: Skills' accepted spellings (Template:Skills usage + its switch) -> the catalog's skill name.
SKILL = {"bal": "Balance", "balance": "Balance", "bluff": "Bluff", "concentration": "Concentration",
         "diplo": "Diplomacy", "diplomacy": "Diplomacy", "dd": "Disable Device", "disable device": "Disable Device",
         "haggle": "Haggle", "heal": "Heal", "hide": "Hide", "intim": "Intimidate", "intimidate": "Intimidate",
         "jump": "Jump", "listen": "Listen", "ms": "Move Silently", "move silently": "Move Silently",
         "ol": "Open Lock", "open lock": "Open Lock", "perform": "Perform", "repair": "Repair", "search": "Search",
         "spellcraft": "Spellcraft", "spot": "Spot", "swim": "Swim", "tumble": "Tumble",
         "umd": "Use Magic Device", "use magic device": "Use Magic Device", "command": "Command",
         "sc": "Spellcraft", "disabledevice": "Disable Device", "movesilently": "Move Silently",
         "openlock": "Open Lock", "usemagicdevice": "Use Magic Device", "usemagicaldevice": "Use Magic Device"}
#: Template:Skills' grouped bonuses, each `{{Insightful|{{{3|Exceptional}}}}} bonus` in its code.
SKILL_GROUP = {"alluring", "astute", "mighty", "nimble", "prudent"}
#: Template:Skills' Stat Skills branch (rev 703569): `<Stat> Skills - Exceptional Bonus
#: {{Int|{{{2|0}}}}}`, rendered "Passive +N [[Exceptional bonus]] to the <Stat> based
#: skills". The type is fixed: that branch never reads {{{3}}}.
STAT_SKILL = {"cha": "Charisma", "charisma": "Charisma", "con": "Constitution", "constitution": "Constitution",
              "dex": "Dexterity", "dexterity": "Dexterity", "int": "Intelligence", "intelligence": "Intelligence",
              "str": "Strength", "strength": "Strength", "wis": "Wisdom", "wisdom": "Wisdom"}
#: Template:Skills' Special Skills with no parameters (rev 703569): each renders one
#: fixed effect, so the call states a presence. Keys as the code matches them,
#: lowercased with spaces removed (`{{lc:{{#replace:{{{1}}}| |}}}}`).
SKILL_PRESENCE = {"persuasion": "Persuasion", "shadow": "Shadow", "silentmoves": "Silent Moves",
                  "songblade": "Songblade", "voiceofdeceit": "Voice of Deceit"}
#: Template:SpellPower's continuous types (its own switch) -> the catalog's stat. The
#: element a type powers is stated by the template's popup text; `potency`,
#: `reconstruction` keep their own names as the catalog does (umbrella / repair).
SPELLPOWER = {"combustion": "Fire Spell Power", "corrosion": "Acid Spell Power", "devotion": "Positive Spell Power",
              "glaciation": "Cold Spell Power", "magnetism": "Electric Spell Power",
              "nullification": "Negative Spell Power", "resonance": "Sonic Spell Power",
              "potency": "Potency", "reconstruction": "Reconstruction", "impulse": "Force Spell Power",
              "radiance": "Radiance", "universal": "Universal Spell Power"}
#: Template:Spelllore element words -> the catalog's lore name (the template's own
#: LoreType switch names the element; `ice` is Cold, `healing` keeps its name).
LORE = {"acid": "Acid Lore", "fire": "Fire Lore", "ice": "Cold Lore", "lightning": "Lightning Lore",
        "sonic": "Sonic Lore", "healing": "Healing Lore", "repair": "Repair Lore", "void": "Negative Lore",
        "radiance": "Radiance Lore", "kinetic": "Kinetic Lore", "laceration": "Laceration Lore",
        "spell": "Spell Lore", "universal spell": "Universal Spell Lore"}
SCHOOLS = ("Abjuration", "Conjuration", "Divination", "Enchantment", "Evocation", "Illusion", "Necromancy",
           "Transmutation")
ELEMENTS = ("Acid", "Cold", "Electric", "Fire", "Sonic", "Light", "Negative", "Poison")

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


#: Returned by `parse_call` for a call followed by qualifying text.
_QUALIFIED = ("<qualified>", [], {})


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
    if line[i:].strip():
        # Text after the call qualifies it — "(only from chest)", "(only from chain end
        # reward)": the effect is conditional, not the item's own. Never read as plain.
        # The template is named so a caller can tell a qualified STAT (which keeps the
        # item whole) from a qualified augment slot or set (which produces no affix).
        q = parts[0].strip().replace("_", " ")
        return (_QUALIFIED[0], [q[:1].upper() + q[1:]], {})
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


def m_doublestrike(pos, named):
    if (_arg(pos, 0) or "").strip().lower() == "calamitous blows":
        raise Declined("Calamitous Blows is a named effect, not a Doublestrike percentage")
    return _simple("Doublestrike", "Doublestrike", _percent)(pos, named)


def m_sheltering(pos, named):
    kind = (_arg(pos, 2) or "").strip().lower()
    stat = {"magical": "Magical Sheltering", "physical": "Physical Sheltering", "": "Sheltering"}.get(kind)
    if stat is None:
        raise Unmapped(f"Sheltering kind {kind!r}")
    return [(stat, _type(_arg(pos, 1), "Sheltering"), _int(_arg(pos, 0)))]


def m_skills(pos, named):
    which = (_arg(pos, 0) or "").strip().lower()
    t = _arg(pos, 2)
    if t and t.strip().lower() == "enh":
        # `enh` is not a spelling the template normalizes (it would render "enh
        # bonus"); the same call's `prefix=Enhanced` states the type.
        if (named.get("prefix") or "").strip().lower() != "enhanced":
            raise Unmapped("`enh` without prefix=Enhanced")
        t = "Enhancement"
    if which in STAT_SKILL:
        return [_penalty(STAT_SKILL[which] + " Skills", "Exceptional", _int(_arg(pos, 1) or "0"))]
    if which == "linguistics":
        # `Linguistics {{{2|10}}}%`, a cooldown cut on social skills. The code names
        # no bonus type, so the catalog's Untyped.
        return [("Linguistics", "Untyped", _int(_arg(pos, 1) or "10"))]
    if which.replace(" ", "") in SKILL_PRESENCE:
        # No parameters: the code renders one fixed effect (Persuasion's +3 competence
        # to Charisma skills, Shadow's +5 to Hide, ...), so the call states a presence.
        return [(SKILL_PRESENCE[which.replace(" ", "")], "Bool", 1)]
    if which == "command":
        # `{{Int|{{{2|2}}}}} [[{{{3|competence}}} bonus]]`: a bare call is 2 Competence.
        return [_penalty("Command", _type(t, "Skills"), _int(_arg(pos, 1) or "2"))]
    if which in SKILL_GROUP:
        return [_penalty(which.title() + " Skills Bonus", _insightful(t) if t and t.strip() else "Exceptional",
                         _int(_arg(pos, 1)))]
    if which.replace(" ", "") not in SKILL and which not in SKILL:
        raise Unmapped(f"Skills {which!r} is not a single skill")
    return [_penalty(SKILL.get(which) or SKILL[which.replace(" ", "")], _type(t, "Skills"), _int(_arg(pos, 1)))]


def m_save(pos, named):
    which = (_arg(pos, 0) or "").strip().lower().replace(" ", "")
    if which not in SAVE:
        raise Unmapped(f"Save type {which!r}")
    stat, default = SAVE[which]
    t = _arg(pos, 2)
    if t and t.strip().lower() == "determination":
        # Template:Save's Prefix switch: `determination=Determined`, its own stat.
        return [_penalty("Determined " + stat, "Determination", _int(_arg(pos, 1)))]
    return [_penalty(stat, _insightful(t) if t and t.strip() else default, _int(_arg(pos, 1)))]


def m_spelllore(pos, named):
    which = (_arg(pos, 0) or "").strip().lower()
    stat = LORE.get(which)
    if stat is None:
        stat = (_arg(pos, 0).strip().title() + " Lore") if which and which.replace(" ", "").isalpha() else None
    if stat is None:
        raise Unmapped(f"Spelllore element {which!r}")
    raw = (_arg(pos, 1) or "").strip().lstrip("+")
    # Template:Spelllore's Magnitude: a number as-is; a roman numeral is Roman2Dec
    # PLUS 10 for every element lore and +0 for `spell` (the old universal tier).
    value = int(raw) if re.fullmatch(r"\d+", raw) else _roman(raw) + (0 if which == "spell" else 10)
    return [(stat, _type(_arg(pos, 2), "Spelllore"), value)]


#: Named SpellPower effects the tier-2 ruling does not read (Spell Turmoil, the augment
#: powers, set and artifact powers). Listed, not inferred from "not a known type", so a
#: misspelt element type still fails loudly instead of being declined.
SPELLPOWER_NAMED = {"ardor", "efficacy", "erosion", "freeze", "inferno", "nihil", "spark", "spell turmoil",
                    "spell resonance", "elemental resonance", "elemental manipulation",
                    "path of the fire dragon", "power of creeping dust",
                    "insightful power of the frozen storm", "quality power of the frozen storm"}


def m_spellpower(pos, named):
    which = (_arg(pos, 0) or "").strip()
    stat = SPELLPOWER.get(which.lower())
    if stat is None:
        if which.lower().startswith("power of the ") or which.lower() == "universal spell power":
            stat = which  # a named power the catalog carries under its own name
        elif which.lower() in SPELLPOWER_NAMED:
            raise Declined(f"named SpellPower effect {which!r}")
        else:
            raise Unmapped(f"SpellPower type {which!r}")
    return [(stat, _type(_arg(pos, 2), "SpellPower"), _int(_arg(pos, 1)))]


def m_spellfocus(pos, named):
    which = (_arg(pos, 0) or "spell focus mastery").strip().lower()
    if which in ("mastery", "spell focus mastery"):
        stat = "Spell Focus Mastery"
    elif which == "spell":
        stat = "Spell Focus"
    elif which in ("deific focus", "deific"):
        raise Declined("Deific Focus is a stacking on-cast effect, not a flat DC bonus")
    else:
        # The template's #default branch: "{{{1}}} Focus" — schools, Rune Arm, Breath Weapon.
        stat = _arg(pos, 0).strip().title() + " Focus"
    return [(stat, _type(_arg(pos, 2), "Spell Focus"), _roman(_arg(pos, 1) or "1"))]


def m_fortification(pos, named):
    amount = (_arg(pos, 0) or "100").strip()
    if amount.lower() in ("0", "exceptional"):
        # Ruled #862: Exceptional Fortification "is considered an Insight bonus".
        return [("Fortification", "Insight", _int(_arg(pos, 1) or "10"))]
    legacy = {"1": 25, "light": 25, "2": 75, "moderate": 75, "3": 100, "heavy": 100}
    if amount.lower() in legacy:
        return [("Fortification", "Enhancement", legacy[amount.lower()])]
    v = _int(amount)
    if 0 < v <= 4:
        raise Declined("legacy Construct Fortification")
    t = _arg(pos, 1)
    return [_penalty("Fortification", _insightful(t) if t and t.strip() else "Enhancement", v)]


def m_elemental_resistance(pos, named):
    which = (_arg(pos, 0) or "").strip().lower()
    if which == "elemental":
        stat = "Elemental Resistance"
    elif which.title() in ELEMENTS:
        stat = which.title() + " Resistance"
    else:
        raise Unmapped(f"Elemental Resistance type {which!r}")
    return [_penalty(stat, _type(_arg(pos, 2), "Elemental Resistance"), _int(_arg(pos, 1)))]


def m_healingamp(pos, named):
    kind = (_arg(pos, 1) or "healing").strip().lower()
    # Template:HealingAmp's Type switch: h/r/n, and `#default = Healing`.
    stat = {"r": "Repair Amplification", "repair": "Repair Amplification", "n": "Negative Amplification",
            "negative": "Negative Amplification"}.get(kind, "Healing Amplification")
    t = _arg(pos, 2)
    t = "Equipment" if t and t.strip().lower() == "equipped" else t
    return [_penalty(stat, _type(t, "HealingAmp"), _int(_arg(pos, 0)))]


def m_tactics(pos, named):
    which = (_arg(pos, 0) or "combat mastery").strip().lower()
    if which in ("combat mastery", "shatter"):
        return [(which.title(), _type(_arg(pos, 2), "Tactics"), _int(_arg(pos, 1) or "1"))]
    if which == "tendon slice":
        raise Declined("Tendon Slice is a named effect, not a plain DC bonus")
    raise Unmapped(f"Tactics {which!r} is not a plain DC bonus")


def m_naturalarmor(pos, named):
    prefix = (named.get("prefix") or "").strip().lower()
    if prefix == "insightful":
        # Its own branch: "Insightful Natural Armor Bonus"; the catalog's `Insight Natural`.
        return [("Armor Class", "Insight Natural", _int(_arg(pos, 0)))]
    if prefix:
        raise Unmapped(f"Natural Armor prefix {prefix!r}")
    return [_penalty("Armor Class", "Natural", _int(_arg(pos, 0)))]


def m_spellpen(pos, named):
    return [(("Spell Penetration"), _type(_arg(pos, 1), "Spellpen"), _roman(_arg(pos, 0) or "I"))]


def m_enhancement_bonus(pos, named):
    """Template:Enhancement bonus (rev 548191), two switches on the kind:
    `i|ii|io|oi|si` grant an Implement bonus to Universal Spell Power of `{{{3}}}`,
    else 3 x `{{{2}}}`; then `w|i|ii` the weapon's enhancement, `a` the armor's,
    `s|si` the shield's (the catalog's Armor stat), `o|oi` an Orb Bonus. `io` is
    implement-only."""
    kind = (_arg(pos, 0) or "").strip().lower()
    known = ("w", "a", "s", "i", "ii", "io", "oi", "si", "o")
    if kind not in known:
        raise Unmapped(f"Enhancement bonus kind {kind!r}")
    v = _int(_arg(pos, 1) or "0")
    out = []
    if kind in ("i", "ii", "io", "oi", "si"):
        impl = _arg(pos, 2)
        out.append(("Universal Spell Power", "Implement", _int(impl) if impl and impl.strip() else 3 * v))
    stat = {"w": "Enhancement Bonus (Weapon)", "i": "Enhancement Bonus (Weapon)", "ii": "Enhancement Bonus (Weapon)",
            "a": "Enhancement Bonus (Armor)", "s": "Enhancement Bonus (Armor)", "si": "Enhancement Bonus (Armor)",
            "o": "Orb Bonus", "oi": "Orb Bonus"}.get(kind)
    if stat:
        if v == 0 and kind in ("w", "a", "s"):
            raise Unmapped("Masterwork (enhancement 0)")
        out.append(_penalty(stat, "Orb" if stat == "Orb Bonus" else "Enhancement", v))
    return out


#: Template:Wizardry's named Power branches -> the presence the catalog carries.
WIZARDRY_PRESENCE = {"m": "Magi", "magi": "Magi", "iv": "Magi", "am": "Archmagi", "archmagi": "Archmagi",
                     "viii": "Archmagi", "pirate cleverness": "Pirate Cleverness"}


def m_wizardry(pos, named):
    raw = (_arg(pos, 0) or "").strip()
    t = _arg(pos, 1)
    if re.fullmatch(r"\+?\d+", raw):
        # Template:Wizardry rev 700755, `#default = {{Ifnumber|{{{1}}}|{{{1}}}|N}}`: a
        # number, signed or not, is the spell points as written (`+195` is 195).
        return [("Wizardry", _insightful(t) if t and t.strip() else "Enhancement", int(raw.lstrip("+")))]
    if raw.upper() in ("I", "II", "III", "V", "VI", "VII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI",
                       "XVII", "XVIII", "XIX", "XX"):
        return [("Wizardry", _insightful(t) if t and t.strip() else "Enhancement", _roman(raw))]
    named = WIZARDRY_PRESENCE.get(raw.lower())
    if named:
        # Template:Wizardry rev 700755's Power switch: `|IV|M|MAGI = MAGI`,
        # `|VIII|AM|ARCHMAGI = ARCHMAGI`, `|PIRATE CLEVERNESS`. Each renders one fixed
        # named effect (+100 / +200 / +50 spell points) and reads no amount, so the
        # call states a presence, as gear-planner records it. `IV` and `VIII` are
        # why neither numeral is in the list above.
        return [(named, "Bool", 1)]
    raise Unmapped(f"Wizardry {raw!r} (Magi/Archmagi/named)")


def m_hp(pos, named):
    which = (_arg(pos, 0) or "").strip().lower()
    v = _arg(pos, 1)
    if which == "vitality" and v:
        return [("False Life", "Vitality", _int(v))]
    if which.replace(" ", "") == "profanelifeforce" and v:
        # Template:Hp matches `{{lc:{{#replace:{{{1}}}| |}}}}`, so `Profane Life Force`
        # is this branch: "{{Int|{{{2|0}}}}} [[Profane bonus]] to Hit Points".
        return [("False Life", "Profane", _int(v))]
    if which in ("hp", "hitpoints", "hit points") and v:
        # "Enhancement Bonus to Hit Points" — the catalog's False Life.
        return [("False Life", "Enhancement", _int(v))]
    if which.replace(" ", "") in ("elementalenergy", "improvedelementalenergy", "greaterelementalenergy",
                                  "legendaryelementalenergy"):
        return [(_arg(pos, 0).strip().title(), "Bool", 1)]
    if which == "false life" and v:
        t = _arg(pos, 2)
        return [("False Life", _insightful(t) if t and t.strip() else "Enhancement", _int(v))]
    if which.replace(" ", "") in ("piratevitality", "pv"):
        # Template:Hp rev 538996, `|piratevitality|pv`: one fixed effect (+10 hit
        # points, "stacks with all bonuses except itself"), no amount: a presence.
        return [("Pirate Vitality", "Bool", 1)]
    raise Unmapped(f"Hp {which!r}")


def _words(v):
    """`Scase2`-style casing the effect templates use for names: each word capitalised."""
    return " ".join(w[:1].upper() + w[1:].lower() for w in (v or "").strip().split())


def m_bane(pos, named):
    """Template:Bane: `fey` is Feybane, else `<Creature> Bane`; a word tier
    (lesser, greater, ...) prefixes the name, a number does not. A presence."""
    who = (_arg(pos, 0) or "").strip()
    if not who:
        raise Unmapped("Bane with no creature")
    name = "Feybane" if who.lower() == "fey" else _words(who) + " Bane"
    tier = (_arg(pos, 1) or "").strip()
    if tier and not re.fullmatch(r"\d+", tier):
        name = _words(tier) + " " + name
    return [(name, "Bool", 1)]


BLAST = {"acid", "anarchic", "axiomatic", "evil", "unholy", "flaming", "force", "good", "holy", "icy",
         "negative", "poison", "radiant", "shocking", "sonic"}


def m_blast(pos, named):
    which = (_arg(pos, 0) or "").strip().lower()
    if which not in BLAST:
        raise Unmapped(f"Blast type {which!r}")
    # A numeric p2 is the scaled tier (`Flaming Blast 6`); a word is the old
    # non-scaled name prefix (`{{Blast|Flaming|Greater}}` -> Greater Flaming Blast).
    tier = (_arg(pos, 1) or "").strip()
    prefix = "" if not tier or re.fullmatch(r"\d+", tier) else _words(tier) + " "
    return [(prefix + _words(which) + " Blast", "Bool", 1)]


#: Template:Absorption's percentage branches that name a bonus type (`{{{5|Enhancement}}}
#: Bonus to X Absorption`), keyed as the template keys them: lower case, spaces
#: removed. `negative`/`negativeenergy` is NOT here — its percentage branch renders
#: "absorbs N% of all negative damage" and states no bonus type, so it is not read.
ABSORB = {k: k.title() for k in ("acid", "cold", "evil", "fire", "force", "good", "light", "poison", "sonic",
                                 "law", "chaos", "alignment")}
ABSORB.update({"electric": "Electric", "electrical": "Electric", "electricity": "Electric",
               "lightning": "Electric", "electricityandacid": "Electricity and Acid",
               "fireandcold": "Fire and Cold"})


def m_absorption(pos, named):
    key = (_arg(pos, 0) or "").strip().lower().replace(" ", "")
    v = _int(_arg(pos, 1) or "0")
    if key == "elemental":
        # Always "Enhancement Bonus"; whether sonic is covered is per item (p3) and
        # src/absorption_split.py expands it, so the call is read only without sonic.
        if (_arg(pos, 2) or "no").strip().lower() not in ("no", "n", "0", "false"):
            raise Declined("Elemental Absorption including sonic")
        if v <= 0:
            raise Unmapped("Elemental Absorption with no percentage")
        return [("Elemental Absorption", "Enhancement", v)]
    if key not in ABSORB:
        raise Declined(f"Absorption kind {key!r} (charge, named or untyped form)")
    if v == 0:
        raise Declined("Absorption +0% (charge form)")
    return [(ABSORB[key] + " Absorption", _type(_arg(pos, 4), "Absorption"), v)]


def m_deception(pos, named):
    bluff = (named.get("bluff") or "").strip().lower()
    if bluff == "improved":
        n = _arg(pos, 0)
        return [("Improved Deception", "Enhancement", _int(n) if n and n.strip() else 5)]
    if bluff == "yes":
        return [("Deception", "Bool", 1)]
    if bluff:
        raise Unmapped(f"Deception bluff={bluff!r}")
    raw = (_arg(pos, 0) or "").strip()
    if not re.fullmatch(r"\d+", raw):
        raise Declined(f"Deception {raw!r} (tiered on-hit form)")
    return [("Deception", _type(_arg(pos, 1), "Deception"), int(raw))]


def m_concealment(pos, named):
    which = (_arg(pos, 0) or "").strip()
    if not which:
        raise Unmapped("Concealment with no kind")
    return [(_words(which), "Bool", 1)]


def m_diversion(pos, named):
    if (_arg(pos, 2) or "").strip().lower() == "old":
        raise Declined("legacy Diversion (old)")
    kind = (_arg(pos, 1) or "").strip()
    if kind.lower() not in ("", "distant", "mystic"):
        # p2 is the KIND; a bonus type written there (`{{Diversion|4|Insightful}}`)
        # renders an "Insightful Diversion" enhancement bonus — an authoring slip,
        # not read either way.
        raise Declined(f"Diversion kind {kind!r}")
    return [((_words(kind) + " Diversion").strip(), _type(_arg(pos, 2), "Diversion"), _int(_arg(pos, 0) or "20"))]


def m_incite(pos, named):
    kind = (_arg(pos, 2) or "").strip().lower()
    if kind not in ("", "distant", "mystic"):
        raise Unmapped(f"Incite kind {kind!r}")
    return [((kind.title() + " Incite").strip(), _type(_arg(pos, 1), "Incite"), _int(_arg(pos, 0)))]


def m_speed(pos, named):
    """Template:Speed: an integer is an N% enhancement bonus to movement; a roman
    numeral (the code's `{{Roman2Dec}}` test) is an N% enhancement bonus to attack
    speed. Both are the catalog's `Speed` N. A kind (melee, ranged, movement) narrows
    what the bonus applies to, which one `Speed` stat cannot say — not read."""
    if (_arg(pos, 1) or "").strip():
        raise Declined("Speed with a kind")
    raw = (_arg(pos, 0) or "15").strip()
    if re.fullmatch(r"-?\d+", raw):
        return [_penalty("Speed", "Enhancement", int(raw))]
    return [("Speed", "Enhancement", _roman(raw))]


def m_parrying(pos, named):
    # Template:Parrying: always an Insight bonus; I..XX or a number.
    return [("Parrying", "Insight", _roman(_arg(pos, 0) or "I"))]


def m_ghostly(pos, named):
    if (_arg(pos, 0) or "").strip():
        raise Declined("Enhanced Ghostly")
    return [("Ghostly", "Bool", 1)]


def m_protection(pos, named):
    # Template:ProtectionBonus: "[[Deflection bonus]] to [[Armor Class]]".
    return [("Armor Class", "Deflection", _int(_arg(pos, 0)))]


MAPPERS = {
    "Stat": m_stat,
    "Sheltering": m_sheltering,
    "Resistance": _simple("Resistance", "Resistance"),
    "Doublestrike": lambda pos, named: m_doublestrike(pos, named),
    "Accuracy": _simple("Accuracy", "Accuracy", _roman),
    "Deadly": _simple("Deadly", "Deadly", _roman),
    "Dodge": _simple("Dodge", "Dodge"),
    "Seeker": _simple("Seeker", "Seeker", _roman),
    "Skills": m_skills, "Save": m_save, "Spelllore": m_spelllore, "SpellPower": m_spellpower,
    "Spell Power": m_spellpower, "Spell Focus": m_spellfocus, "Fortification": m_fortification,
    "Elemental Resistance": m_elemental_resistance, "HealingAmp": m_healingamp, "Tactics": m_tactics,
    "NaturalArmor": m_naturalarmor, "Spellpen": m_spellpen, "Enhancement bonus": m_enhancement_bonus,
    "Wizardry": m_wizardry, "Hp": m_hp,
    "Bane": m_bane, "Blast": m_blast, "Absorption": m_absorption, "Deception": m_deception,
    "Concealment": m_concealment, "Diversion": m_diversion, "Incite": m_incite, "Speed": m_speed,
    "Spell Resistance": _simple("Spell Resistance", "Spell Resistance"),
    "Armor-Piercing": _simple("Armor-Piercing", "Armor-Piercing", _percent),
    "Parrying": m_parrying, "Ghostly": m_ghostly, "ProtectionBonus": m_protection,
}


PRESENCE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "seed", "compendium",
                             "presence_templates.json")


def _load_presence():
    with open(PRESENCE_PATH, encoding="utf-8") as fh:
        return set(json.load(fh)["templates"])


#: Named-effect templates with no bonus type (presence_templates.json): the call
#: states the effect is present, which is the catalog's (name, Bool, 1). Its
#: parameters (dice tiers, procs) are not a stacking magnitude and are not read.
PRESENCE = _load_presence()


def m_presence(name):
    def m(pos, named):
        return [(name, "Bool", 1)]
    return m


for _t in PRESENCE:
    MAPPERS.setdefault(_t, m_presence(_t))


#: Reason prefix of a `Declined` call that does not keep its item whole.
DECLINED = "declined: "


def affixes(enhancements: str):
    """`(mapped, unmapped)` for an item's OWN enchantments (top-level lines; nested
    lines are sub-options): mapped affixes as `(name, type, value)`, and the calls no
    mapper could read, as `(template, reason)` — a reason starting `DECLINED` is a
    form deliberately not read that leaves the item's other values readable."""
    mapped, unmapped, declined, read = [], [], [], set()
    for line in (enhancements or "").split("\n"):
        if depth(line) > 1:
            continue
        call = parse_call(line)
        if call is None:
            continue
        if call[0] == _QUALIFIED[0]:
            if call[1][0] in MAPPERS:
                unmapped.append((call[0], "a call followed by qualifying text (conditional)"))
            continue
        name, pos, named = call
        fn = MAPPERS.get(name)
        if fn is None:
            unmapped.append((name, "no mapper"))
            continue
        try:
            for a in fn(pos, named):
                # A presence is a flag: two calls of one effect (Bewildering and its
                # critical variant) still state ONE presence, never two.
                if a[1] == "Bool" and a in mapped:
                    continue
                mapped.append(a)
            read.add(name)
        except Declined as e:
            declined.append((name, str(e)))
        except Unmapped as e:
            unmapped.append((name, str(e)))
    for name, why in declined:
        # Beside a READ call of the same template the merge could pair gear-planner's
        # affix for the declined call with ours — so that item is kept whole after all.
        unmapped.append((name, why if name in read else DECLINED + why))
    return mapped, unmapped
