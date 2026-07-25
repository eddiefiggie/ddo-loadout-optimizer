"""U2 — affix parser.

Turns a free-text DDO `enhancements[]` line into structured affix tuples
`{stat, bonus_type, value, unit}`. The seed's lines are inconsistent (see the
build-time survey), so the parser commits to the value-bearing shapes the
optimizer needs and *flags* the rest (per-affix eligibility, KTD5) rather than
letting a value-less line disqualify its whole item.

Bonus-type rule: a leading or trailing-parenthetical word is a bonus type only
when it is one of DDO's known types; otherwise it belongs to the stat name.
Untyped lines default to Enhancement.
"""
from __future__ import annotations

import re
from typing import Optional

# DDO ability/effect bonus types (the ones that appear as adjectives on stats).
BONUS_TYPES = {
    "Enhancement", "Insightful", "Quality", "Exceptional", "Profane", "Sacred",
    "Competence", "Artifact", "Primal", "Festive", "Alchemical", "Deific",
    "Fatesinger", "Legendary",
    # Isle of Dread Dino-crafting pool uses these (distinct stacking types); they
    # are legitimate DDO bonus types that also appear on other gear. "Insight" is
    # a distinct type from "Insightful" (both occur in-game), preserved verbatim.
    "Equipment", "Resistance", "Insight",
}
# Tokens inside a trailing "(A/B)" that we expand to multiple stats.
MULTI_STAT_TOKENS = {"PRR", "MRR"}

_NOISE = re.compile(
    r"(Augment Slot$|\(set\)$|\(Legendary set\)$|\(Heroic set\)$|^Set:|"
    r"weapon slots|slots:| Boost \+)",
)
_TRAILING_PAREN = re.compile(r"^(.*?)\s*\(([^)]+)\)\s*$")
# sign is captured so penalties keep their negative value (e.g. "Concentration -50")
_VALUE_LAST = re.compile(r"^(.*?)\s*([+-]?)\s*(\d+)(%?)$")
_VALUE_FIRST = re.compile(r"^([+-])(\d+)(%?)\s+(.*)$")
_SCALING = re.compile(r"\+?(\d+)(%?)\s*ML(\d+)\D+?(\d+)(%?)\s*ML(\d+)")
# integers that are NOT magnitudes: weapon dice, crit ranges/multipliers, procs.
_NON_MAGNITUDE = re.compile(r"(\d+d\d+|/x\d|\d+-\d+/|Randomly rolls|slotted:|charges|/day)", re.I)


def _split_type(stat_part: str) -> tuple[str, str]:
    """Peel a leading bonus-type word off a stat string. Default Enhancement."""
    words = stat_part.split()
    if words and words[0] in BONUS_TYPES:
        return words[0], " ".join(words[1:]).strip()
    return "Enhancement", stat_part.strip()


def _norm_type(token: str) -> Optional[str]:
    """Return the canonical bonus type if `token` (paren content) names one."""
    first = token.split()[0] if token.split() else ""
    return first if first in BONUS_TYPES else None


def _affix(stat, bonus_type, value, unit, raw):
    return {"stat": stat, "bonus_type": bonus_type, "value": value,
            "unit": unit, "raw": raw}


def _parse_value_bearing(text: str, raw: str, forced_type: Optional[str] = None):
    """Parse a single value-bearing token into a list of affixes, or []."""
    text = text.strip()

    # value-first: "+5 Enhancement Bonus", "+15% attack speed"
    m = _VALUE_FIRST.match(text)
    if m:
        sign, digits, pct, remainder = m.group(1), m.group(2), m.group(3), m.group(4).strip()
        value = int(sign + digits)
        unit = "pct" if pct else "flat"
        btype, rest = _split_type(remainder)
        rest = re.sub(r"^(bonus to|bonus|to)\s+", "", rest, flags=re.I).strip()
        rest = re.sub(r"\s+bonus$", "", rest, flags=re.I).strip()
        stat = rest or remainder
        return [_affix(stat or "Enhancement Bonus", forced_type or btype, value, unit, raw)]

    # trailing paren: "Disable Device +19 (Competence)", "... (PRR/MRR)", "Damage +8 (Deadly)"
    m = _TRAILING_PAREN.match(text)
    if m and forced_type is None:
        outer, inner = m.group(1).strip(), m.group(2).strip()
        ntype = _norm_type(inner)
        if ntype:
            return _parse_value_bearing(outer, raw, forced_type=ntype)
        if "/" in inner and all(t.strip() in MULTI_STAT_TOKENS for t in inner.split("/")):
            base = _parse_value_bearing(outer, raw)
            if base:
                v, u = base[0]["value"], base[0]["unit"]
                bt = base[0]["bonus_type"]
                return [_affix(t.strip(), bt, v, u, raw) for t in inner.split("/")]
            return []
        # "Damage +N (Effect)" — the parenthetical names the effect (e.g. Deadly)
        outer_m = _VALUE_LAST.match(outer)
        if outer_m and outer_m.group(1).strip().lower() in {"damage", "hit and damage"} \
                and " " not in inner:
            unit = "pct" if outer_m.group(4) else "flat"
            return [_affix(inner, "Enhancement", int(outer_m.group(2) + outer_m.group(3)), unit, raw)]
        # otherwise ignore the paren qualifier and parse the outer part
        return _parse_value_bearing(outer, raw)

    # value-last: "Quality Intelligence +3", "Accuracy +12", "Armor-Piercing 12%", "Bleeding 4"
    m = _VALUE_LAST.match(text)
    if m and m.group(1).strip():
        stat_part = m.group(1).strip()
        value = int(m.group(2) + m.group(3))  # signed
        pct = m.group(4)
        unit = "pct" if pct else "flat"
        if forced_type:
            btype, stat = forced_type, stat_part
        else:
            btype, stat = _split_type(stat_part)
        return [_affix(stat, btype, value, unit, raw)]

    return []


def parse_line(line: str) -> dict:
    """Classify and parse one enhancement line.

    Returns {kind, affixes, raw, ...} where kind is one of:
      affix    — one or more clean {stat,bonus_type,value,unit} in `affixes`
      scaling  — ML-scaling magnitude in `scaling` (resolved at query time)
      rolls    — mutually-exclusive option group in `options`
      noise    — augment-slot / set / weapon-slot marker; no affixes
      unparsed — recognized but no usable magnitude; `reason` set
    """
    raw = line
    text = (line or "").strip()
    base = {"kind": "unparsed", "affixes": [], "raw": raw}

    if not text:
        return {**base, "kind": "noise"}

    if text.lower().startswith("rolls one of"):
        body = text.split(":", 1)[1] if ":" in text else ""
        options = []
        for opt in body.split(" / "):
            options.extend(_parse_value_bearing(opt.strip(), opt.strip()))
        return {**base, "kind": "rolls", "options": options}

    ms = _SCALING.search(text)
    if ms and ("up to" in text.lower() or "scaling" in text.lower()):
        stat = re.split(r"\s*[\(%]", text)[0].strip()
        paren = _TRAILING_PAREN.match(text)
        btype = _norm_type(paren.group(2)) if paren else None
        unit = "pct" if ("%" in text) else "flat"
        scaling = {
            "stat": stat, "bonus_type": btype or "Enhancement", "unit": unit,
            "val_lo": int(ms.group(1)), "ml_lo": int(ms.group(3)),
            "val_hi": int(ms.group(4)), "ml_hi": int(ms.group(6)), "raw": raw,
        }
        return {**base, "kind": "scaling", "scaling": scaling}

    if _NOISE.search(text):
        return {**base, "kind": "noise"}

    # A trailing integer inside a dice/crit/proc line is not a magnitude — flag it
    # so the greedy value-last branch below never mints a false affix.
    if _NON_MAGNITUDE.search(text):
        return {**base, "kind": "unparsed", "reason": "non-magnitude (dice/crit/proc/descriptive)"}

    affixes = _parse_value_bearing(text, raw)
    if affixes:
        return {**base, "kind": "affix", "affixes": affixes}

    # recognized text but no magnitude (named proc, immunity, weapon dice, ...)
    return {**base, "kind": "unparsed", "reason": "no parseable magnitude"}


def parse_enhancements(lines) -> dict:
    """Parse an item's whole `enhancements[]`, bucketed for the verification gate.

    Tier-unaware: `ML<n>: ...` tier lines and their comma-separated affixes are
    handled by `variants.expand_item`, which strips/splits them before calling
    this. Do not call this directly on a raw tiered seed item.
    """
    out = {"affixes": [], "flagged": [], "scaling": [], "rolls": []}
    for line in lines or []:
        r = parse_line(line)
        if r["kind"] == "affix":
            out["affixes"].extend(r["affixes"])
        elif r["kind"] == "scaling":
            out["scaling"].append(r["scaling"])
        elif r["kind"] == "rolls":
            out["rolls"].append({"raw": r["raw"], "options": r["options"]})
        elif r["kind"] == "unparsed":
            out["flagged"].append({"raw": r["raw"], "reason": r.get("reason", "")})
        # noise: dropped
    return out
