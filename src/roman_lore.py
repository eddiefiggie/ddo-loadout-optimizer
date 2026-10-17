"""#887 — roman-numeral ELEMENT lores carry +10 that upstream does not read.

`Template:Spelllore` takes a magnitude as a decimal ("new lores", used as is) or
a roman numeral ("old lores"). For a roman numeral it computes
`Roman2Dec(numeral) + 10` on an element lore and `+ 0` on universal Spell Lore,
and the wiki says so three independent ways (the template's coding, the Spell
Lore article's I-XII table, and the rendered tooltips — see the shard's `_meta`
and docs/wiki-evidence/spell-lore.md). gear-planner reads every roman element
lore as the bare numeral, so Void Lore VI arrives as 6 where the game grants 16.

`data/seed/compendium/roman_element_lore.json` is the harvest: every member of
the `Category:<Element> Lore <roman> items` categories the template files, as
(record, canonical stat, numeral, from, to). This module raises each by 10.

THE STALE GUARD IS THE POINT, as in `value_corrections`: an entry is applied
only when the record still holds exactly `from`. If the record already holds
`to`, upstream fixed its parser and the entry must be DELETED, not re-applied
(a second +10 would over-credit by ten). Anything else means the data moved and
the entry needs a re-read. Each failure stops the build.

Runs after the item channel's name corrections, so `stat` is our canon
(`Void Lore`, not upstream's `Negative Lore`), and reaches the `[Upgraded]`
twins (#879), which copy their base's affixes.
"""
from __future__ import annotations

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHARD_PATH = os.path.join(ROOT, "data", "seed", "compendium", "roman_element_lore.json")
UPGRADED_SUFFIX = " [Upgraded]"

_ROMAN = {"I": 1, "V": 5, "X": 10}


def roman_to_int(s: str) -> int:
    """`VI` -> 6, `IX` -> 9, `XII` -> 12. Raises on anything not I/V/X."""
    s = str(s or "").strip().upper()
    if not s or any(c not in _ROMAN for c in s):
        raise ValueError(f"not a roman numeral: {s!r}")
    total = 0
    for i, c in enumerate(s):
        v = _ROMAN[c]
        nxt = _ROMAN[s[i + 1]] if i + 1 < len(s) else 0
        total += -v if v < nxt else v
    return total


def load(path: str = SHARD_PATH) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def check_shard(shard: dict) -> list:
    """Each entry's numbers must follow from its numeral by the template rule."""
    problems = []
    for item, entries in sorted(((shard or {}).get("items") or {}).items()):
        for e in entries:
            n = roman_to_int(e.get("numeral"))
            if str(e.get("from")) != str(n) or str(e.get("to")) != str(n + 10):
                problems.append(f"{item}: {e.get('stat')} {e.get('numeral')} must read from {n} to "
                                f"{n + 10}, the template's rule, not {e.get('from')} -> {e.get('to')}")
    return problems


def apply(records: list, shard: dict) -> dict:
    """Raise each harvested roman element lore by 10, in place. Returns coverage;
    raises SystemExit on any stale or unreachable entry."""
    items = (shard or {}).get("items") or {}
    problems = check_shard(shard)
    hit = set()
    values_changed = 0
    for rec in records or []:
        name = rec.get("name")
        base = name[: -len(UPGRADED_SUFFIX)] if name and name.endswith(UPGRADED_SUFFIX) else name
        entries = items.get(base)
        if not entries:
            continue
        hit.add(base)
        for e in entries:
            stat, frm, to = e.get("stat"), str(e.get("from")), str(e.get("to"))
            same = [a for a in rec.get("affixes") or [] if a.get("name") == stat]
            matches = [a for a in same if str(a.get("value")) == frm]
            if matches:
                for a in matches:
                    a["value"] = to
                    values_changed += 1
            elif any(str(a.get("value")) == to for a in same):
                problems.append(f"{name}: {stat} already reads {to} — upstream now applies the "
                                f"template's +10 itself; delete this entry rather than apply it twice")
            else:
                problems.append(f"{name}: no {stat} at {frm} to correct (it carries "
                                f"{sorted(str(a.get('value')) for a in same)}) — the data moved; "
                                "re-read the item's wiki page")
    for item in sorted(set(items) - hit):
        problems.append(f"{item}: the entry reached no catalog record — renamed or dropped upstream")
    if problems:
        raise SystemExit("roman-numeral element lore corrections are stale (#887):\n  "
                         + "\n  ".join(problems))
    return {"items": len(hit), "values_changed": values_changed,
            "entries": sum(len(v) for v in items.values())}
