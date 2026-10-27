"""#908 — set definitions read from our own wiki harvest (own item harvest, #911).

Two wiki sources state set bonuses (docs/wiki-evidence/named-item-sets-structure.md):

  * `Template:Named item sets` — a `#switch` of one entry per set, already split
    by tier, each a `<br />`-joined run of `N Pieces Equipped:` headers and
    bonus lines, closed by `{{#vardefine:set|<display name>}}`.
  * `Named item sets` — wikitable rows of set name, items and bonus cell. A row
    can bundle Heroic / Epic / Legendary values in `{{HELstats}}`, and its anchor
    names at most one of the tiers it describes.

This module turns both into the same shape — per set, per piece threshold, the
bonus lines as plain text — and stops there. Reading a line into a typed affix is
`read_clause`, a closed grammar: a line it does not recognise is quarantined with
a reason, never defaulted. Gear-planner's set catalog stays the build's source
until the parity diff (`scripts/diff_harvest_sets.py`) shows ours-wrong = 0.

NEVER INFER. Two specific temptations this module refuses:
  * A row with no `N Pieces Equipped:` header has no stated threshold, even
    when its item list has N entries. `threshold` is None and the diff reports it.
  * A `HELstats` row's Legendary half has no anchor of its own. Its name is not
    invented (`Legendary <anchor>` is the obvious guess, and it is a guess); the
    row is keyed by its anchor plus the tier the template code assigns.
"""
from __future__ import annotations

import re

COMMENT_RE = re.compile(r"<!--.*?-->", re.S)

# Template:HELstats rev 673386 (2026-02-01), the whole <onlyinclude> body, per tier:
#   {{#if: {{{1|}}} | <Heroic {{{1}}}> | {{#if: {{{H|}}} | <Heroic {{{H}}}> | }}}}
#   {{#if: {{{2|}}} | <Epic {{{2}}}>   | {{#if: {{{E|}}} | <Epic {{{E}}}>   | }}}}
#   {{#if: {{{3|}}} | <Legendary {{{3}}}> | {{#if: {{{L|}}} | <Legendary {{{L}}}> | }}}}
# A positional argument wins over its named one; an empty tier renders nothing.
HELSTATS_TIERS = (("Heroic", "1", "H"), ("Epic", "2", "E"), ("Legendary", "3", "L"))
HELSTATS_REVID = 673386
_HELSTATS_RE = re.compile(r"\{\{\s*HELstats\s*\|([^{}]*)\}\}")

# "3 Pieces Equipped:" alone on a line, or heading the line's first clause
# ("2 Pieces Equipped: +2 Artifact Bonus to Strength", "5 Pieces Equipped - {{…}}").
_PIECES_RE = re.compile(r"^\s*(\d+)\s+Pieces?\s+Equipped\s*[:\-]\s*(.*)$", re.I)
_ANCHOR_RE = re.compile(r"\{\{\s*Anchor\s*\|([^{}|]*)\}\}")
_VARDEFINE_RE = re.compile(r"\{\{\s*#vardefine\s*:\s*set\s*\|([^{}]*)\}\}")
_LINK_RE = re.compile(r"\[\[(?:[^\]|]*\|)?([^\]|]*)\]\]")

# Template:Artifact rev 674392 (2026-02-07) is cell styling and nothing else:
#   class="bg-color-1" style="background-color:#ebe0a4;" |
# It opens 122 bonus cells on the page and states no bonus, so it is removed
# before the cell is read rather than left as a line with no threshold.
CELL_STYLE_TEMPLATES = ("Artifact",)
_CELL_STYLE_RE = re.compile(r"\{\{\s*(?:%s)\s*\}\}" % "|".join(CELL_STYLE_TEMPLATES))


def _args(argtext: str) -> tuple[list, dict]:
    pos, named = [], {}
    for a in argtext.split("|"):
        if "=" in a:
            k, _, v = a.partition("=")
            named[k.strip()] = v.strip()
        else:
            pos.append(a.strip())
    return pos, named


def helstats_value(argtext: str, tier: str):
    """The value one `{{HELstats|…}}` call renders at `tier`, or None (renders nothing)."""
    pos, named = _args(argtext)
    for name, p, n in HELSTATS_TIERS:
        if name == tier:
            i = int(p) - 1
            v = pos[i] if i < len(pos) and pos[i] else named.get(n, "")
            return v or None
    raise ValueError(f"unknown HELstats tier {tier!r}")


def helstats_tiers(text: str) -> list:
    """The tiers any `HELstats` call in `text` renders, in Heroic/Epic/Legendary order."""
    calls = [m.group(1) for m in _HELSTATS_RE.finditer(text)]
    return [t for t, _, _ in HELSTATS_TIERS if any(helstats_value(c, t) for c in calls)]


def expand_helstats(line: str, tier: str):
    """`line` with every HELstats call replaced by its `tier` value, or None when a
    call in it states no value at that tier (the clause does not exist there)."""
    missing = []

    def sub(m):
        v = helstats_value(m.group(1), tier)
        if v is None:
            missing.append(m.group(0))
            return ""
        return v

    out = _HELSTATS_RE.sub(sub, line)
    return None if missing else out


def plain(line: str) -> str:
    """Wiki markup -> the text a reader sees: links to their label, bold/italic
    quotes and HTML tags dropped. Templates are left in place — expanding one is
    reading it, and that is `read_clause`'s job, not a cleanup."""
    s = COMMENT_RE.sub("", line)
    s = _LINK_RE.sub(lambda m: m.group(1), s)
    s = s.replace("'''", "").replace("''", "")
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"^\s*\*+\s*", "", s)
    return re.sub(r"\s+", " ", s).strip()


def _tiers_from_lines(lines) -> dict:
    """Bonus lines -> {threshold: [line, ...]}; lines before any header go under None."""
    tiers, cur = {}, None
    for raw in lines:
        m = _PIECES_RE.match(plain(raw))
        if m:
            cur = int(m.group(1))
            tiers.setdefault(cur, [])
            # The header is matched on the plain text; keep the remainder as markup
            # (it may hold a template) by cutting the raw line after its separator.
            rest = re.split(r"Equipped\s*(?:'''|'')?\s*[:\-]", raw, maxsplit=1, flags=re.I)
            if m.group(2) and len(rest) == 2 and plain(rest[1]):
                tiers[cur].append(rest[1].strip())
            continue
        if plain(raw):
            tiers.setdefault(cur, []).append(raw.strip())
    return tiers


def template_sets(wikitext: str) -> dict:
    """`Template:Named item sets` -> {lower-cased key: {name, tiers, raw}}."""
    code = wikitext[wikitext.index("<onlyinclude>"):wikitext.index("</onlyinclude>")]
    body = code[code.index("#switch"):]
    out = {}
    for entry in re.split(r"\n\s*\|\s*(?=[^=\n|]+?\s*=)", body)[1:]:
        key, _, value = entry.partition("=")
        key = key.strip().lower()
        if key.startswith("#") or key in ("this template!", "some off the wall set"):
            continue
        m = _VARDEFINE_RE.search(value)
        name = m.group(1).strip() if m else None
        value = _VARDEFINE_RE.sub("", value).strip()
        lines = re.split(r"<br\s*/?>|</?li[^>]*>|\n", value)
        out[key] = {"name": name, "tiers": _tiers_from_lines(lines), "raw": value}
    return out


def _row_cells(row: str) -> list:
    """A wikitable row's cells, in order. A cell starts at a line beginning `|`
    (or after `||` on one line) and runs until the next."""
    cells, cur = [], None
    for line in row.split("\n"):
        if line.startswith("|") and not line.startswith(("|-", "|}")):
            for part in line[1:].split("||"):
                if cur is not None:
                    cells.append(cur)
                cur = [part]
        elif cur is not None:
            cur.append(line)
    if cur is not None:
        cells.append(cur)
    return ["\n".join(c) for c in cells]


# One typed clause: "+30 Profane bonus to Physical Sheltering", "+6% Artifact bonus to X".
_CLAUSE_RE = re.compile(r"^([+-]?\d+)(%?) ([A-Za-z]+) [Bb]onus to (?:your )?(.+?)\.?$")


_LIST_SPLIT_RE = re.compile(r",\s*(?:and\s+)?|\s+and\s+")


def expand_list(stat: str, suffix: str, stat_names):
    """#951 — a coordinated list of stats -> its members, or None.

    "Melee and Ranged Power", "Intelligence, Wisdom, and Charisma",
    "Fire and Cold Spell Power". The last member carries a shared head ("Power",
    "Spell Power", or none); every earlier member takes that head. A reading is
    accepted only when EVERY member is exactly a name in `stat_names`, and only when
    exactly one head length does that — two readings means the text is ambiguous,
    and it stays quarantined. Nothing is translated: a member in other words
    ("Spellcrit Chance", "PRR", "Amp") makes the whole line unreadable.
    """
    parts = [p.strip() for p in _LIST_SPLIT_RE.split(stat) if p.strip()]
    if len(parts) < 2:
        return None
    words = parts[-1].split()
    readings = set()
    for k in range(len(words)):
        head = " ".join(words[len(words) - k:]) if k else ""
        members = [f"{p} {head}".strip() for p in parts[:-1]] + [parts[-1]]
        members = [m + suffix for m in members]
        # A head that turns two members into one name is not a shared head: "Sneak
        # Attack and Sneak Attack Damage" is two stats, never Sneak Attack Damage twice.
        if len(set(members)) == len(members) and all(m in stat_names for m in members):
            readings.add(tuple(members))
    return list(readings.pop()) if len(readings) == 1 else None


def read_clause(line: str, bonus_types, stat_names) -> dict:
    """One bonus line -> {"affixes": [{name, type, value}, ...]} or {"quarantine": reason}.

    A closed grammar. The bonus type must be one the build knows, and the stat must
    be EXACTLY a name in `stat_names` (the set catalog's vocabulary), or a
    coordinated list whose every member is (`expand_list`). A wiki phrase for the
    same stat in other words ("Physical Resistance Rating") is quarantined here,
    not translated: each such phrase is a reviewed mapping with its own evidence,
    added family by family.
    """
    text = plain(line)
    if "{{" in text:
        return {"quarantine": "unexpanded template"}
    m = _CLAUSE_RE.match(text)
    if not m:
        return {"quarantine": "not a typed '+N <Type> bonus to <stat>' clause"}
    value, pct, ty, stat = int(m.group(1)), m.group(2), m.group(3).capitalize(), m.group(4).strip()
    if ty not in bonus_types:
        return {"quarantine": f"unknown bonus type {m.group(3)!r}"}
    suffix = " (%)" if pct else ""
    names = [stat + suffix] if stat + suffix in stat_names else expand_list(stat, suffix, stat_names)
    if not names:
        return {"quarantine": f"stat phrase not in the vocabulary: {stat + suffix!r}"}
    return {"affixes": [{"name": n, "type": ty, "value": value} for n in names]}


def page_sets(wikitext: str) -> list:
    """`Named item sets` -> one record per (row, tier).

    Each record: {anchors, section, tier, tiers, raw}. `tier` is None for a row with
    no HELstats; otherwise each tier the row's HELstats render gets its own record,
    its lines expanded by the template code above. A line whose HELstats state no
    value at that tier is dropped from that tier — the page renders nothing there.
    """
    out, section = [], None
    text = COMMENT_RE.sub("", wikitext)
    for block in re.split(r"(?m)^(==[^=].*?==)\s*$", text):
        if block.startswith("=="):
            section = plain(block.strip("= "))
            continue
        for row in re.split(r"\n\|-[^\n]*", block)[1:]:
            row = row.split("\n|}")[0]
            anchors = [a.strip() for a in _ANCHOR_RE.findall(row)]
            if not anchors:
                continue
            cells = _row_cells(row)
            bonus = _CELL_STYLE_RE.sub("", cells[-1] if cells else "")
            lines = bonus.split("\n")
            tiers = helstats_tiers(bonus)
            for tier in tiers or [None]:
                kept = lines if tier is None else [x for x in (expand_helstats(l, tier) for l in lines) if x is not None]
                out.append({"anchors": anchors, "section": section, "tier": tier,
                            "tiers": _tiers_from_lines(kept), "raw": bonus})
    return out
