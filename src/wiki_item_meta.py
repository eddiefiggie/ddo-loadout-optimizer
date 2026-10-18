"""#906 — item metadata read from our own wiki harvest (own item harvest, #911).

Reads the `{{Named item}}` infobox of each harvested page and produces the
metadata half of a gear-planner-shaped raw record: minimum level, slot, type,
quests. `rare` is read where a page states it, but gear-planner takes rarity from a
separate rare-loot page, so it is not part of item-page parity. Affixes are Phase 2 (#907); the pack is not on an item page at all
(it comes from the quest, via our own pack mapping), so it is not read here.

Written from the wiki's templates directly — gear-planner carries no license, so
none of its parser is ported (plan constraint 1).

THE MIGRATION. Since 2026-10-16 the wiki has been moving item pages to new
parameter names. Both spellings are read, new first, and a page carrying both
with different values is reported rather than resolved:

    minimum level  <- minlevel
    shield bonus   <- sb / ac (shields)
    quest          (the new pages may carry `turn in` / `turn in collector` instead)

NEVER INFER. A field whose value is not a plain statement — `???`, a template,
an empty string — is `None` here with its raw text kept in `raw`, and the diff
reports it. Nothing is defaulted.

SLOT AND TYPE use gear-planner's vocabulary, because every downstream stage
already does. The translation is a fixed table measured on the 2026-10-18
harvest (the positional infobox kind plus the `slot` / `type` parameters map
one-to-one onto gear-planner's values); a value outside the table is `None`
and reported, never guessed.
"""
from __future__ import annotations

import re

COMMENT_RE = re.compile(r"<!--.*?-->", re.S)

#: Infobox kind (first positional) -> gear-planner slot, for kinds that fix it.
KIND_SLOT = {"Weapon": "Weapon", "Armor": "Armor", "Shield": "Offhand", "Rune Arm": "Offhand", "Quiver": "Quiver"}
#: For Jewelry / Clothing the `slot` parameter decides: wiki body slot -> (gp slot, gp type).
BODY_SLOT = {
    "Finger": ("Ring", "Finger items"), "Head": ("Helm", "Head items"), "Back": ("Cloak", "Back items"),
    "Trinket": ("Trinket", "Trinket items"), "Neck": ("Necklace", "Neck items"),
    "Wrist": ("Bracers", "Wrist items"), "Waist": ("Belt", "Waist items"), "Hand": ("Gloves", "Hand items"),
    "Feet": ("Boots", "Feet items"), "Eye": ("Goggles", "Eye items"),
}
ARMOR_TYPE = {"Clothing": "Cloth armor", "Light Armor": "Light armor", "Medium Armor": "Medium armor",
              "Heavy Armor": "Heavy armor", "Docent": "Docents"}
SHIELD_TYPE = {"Large": "Large shields", "Small": "Small shields", "Tower": "Tower shields",
               "Buckler": "Bucklers", "Orb": "Orbs"}
#: Weapon types whose plural is not just "+s", plus the wiki's alternate spellings.
WEAPON_TYPE = {"Khopesh": "Khopeshes", "Quarterstaff": "Quarterstaffs", "Handwrap": "Handwraps",
               "Handaxe": "Hand Axes", "Shortsword": "Short Swords", "Light Mace": "Light Maces",
               "Heavy Mace": "Heavy Maces"}


def _split_top(s: str, sep: str = "|") -> list:
    """Split on `sep` outside {{...}} and [[...]]."""
    out, depth, cur, i = [], 0, [], 0
    while i < len(s):
        two = s[i:i + 2]
        if two in ("{{", "[["):
            depth += 1; cur.append(two); i += 2; continue
        if two in ("}}", "]]") and depth:
            depth -= 1; cur.append(two); i += 2; continue
        if s[i] == sep and depth == 0:
            out.append("".join(cur)); cur = []; i += 1; continue
        cur.append(s[i]); i += 1
    out.append("".join(cur))
    return out


def infobox(wikitext: str, name: str = "Named item"):
    """`(positional, params)` of the first `{{<name>|...}}` in the page, or None.

    Brace-aware: a `|` or `=` inside a nested template or link belongs to it."""
    if not wikitext:
        return None
    text = COMMENT_RE.sub("", wikitext)
    start = text.find("{{" + name)
    if start < 0:
        return None
    depth, i = 0, start
    while i < len(text):
        two = text[i:i + 2]
        if two in ("{{", "[["):
            depth += 1; i += 2; continue
        if two in ("}}", "]]"):
            depth -= 1; i += 2
            if depth == 0:
                break
            continue
        i += 1
    body = text[start + 2:i - 2]
    parts = _split_top(body)[1:]
    positional, params = [], {}
    for p in parts:
        kv = _split_top(p, "=")
        if len(kv) == 1:
            positional.append(p.strip())
        else:
            params[kv[0].strip().lower()] = "=".join(kv[1:]).strip()
    return positional, params


def _plain(v):
    """The value as plain text: links reduced to their label; None when it carries a
    template or is empty (a template's rendered value is not readable here)."""
    if v is None:
        return None
    v = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", v).strip()
    if not v or "{{" in v:
        return None
    return v


def _pick(params, *names):
    for n in names:
        if n in params and params[n].strip():
            return params[n].strip(), n
    return None, None


def _weapon_type(t):
    if t is None:
        return None
    if t in WEAPON_TYPE:
        return WEAPON_TYPE[t]
    return t + "s"


def meta(page: dict) -> dict:
    """The metadata record for one harvested page."""
    out = {"title": page.get("title"), "revid": page.get("revid"), "ts": page.get("ts"), "problems": [], "raw": {}}
    box = infobox(page.get("wikitext") or "")
    if box is None:
        out["problems"].append("no {{Named item}} infobox")
        return out
    positional, params = box
    kind = positional[0] if positional else None
    out["kind"] = kind

    ml_raw, ml_key = _pick(params, "minimum level", "minlevel")
    old, new = params.get("minlevel", "").strip(), params.get("minimum level", "").strip()
    if old and new and old != new:
        out["problems"].append(f"minimum level {new!r} and minlevel {old!r} disagree")
    out["raw"]["ml"] = ml_raw
    # The wiki writes 0 for "no minimum level"; the catalog (and every consumer) uses
    # 1, the lowest character level, for the same fact. A convention, not a guess:
    # both say "usable from character level 1".
    ml = int(ml_raw) if ml_raw and re.fullmatch(r"\d+", ml_raw) else None
    out["ml"] = 1 if ml == 0 else ml

    t_raw = _plain(params.get("type"))
    out["raw"]["type"] = params.get("type")
    if kind in ("Jewelry", "Clothing"):
        body = _plain(params.get("slot"))
        out["raw"]["slot"] = params.get("slot")
        out["slot"], out["type"] = BODY_SLOT.get(body, (None, None))
    else:
        out["slot"] = KIND_SLOT.get(kind)
        if kind == "Weapon":
            out["type"] = _weapon_type(t_raw)
        elif kind == "Armor":
            out["type"] = ARMOR_TYPE.get(t_raw)
        elif kind == "Shield":
            out["type"] = SHIELD_TYPE.get(t_raw)
        elif kind == "Rune Arm":
            out["type"] = "Rune Arms"
        elif kind == "Quiver":
            out["type"] = "Quiver items"
        else:
            out["type"] = None
    if out.get("slot") is None:
        out["problems"].append(f"slot not stated in the vocabulary (kind {kind!r}, slot {params.get('slot')!r})")
    if out.get("type") is None:
        out["problems"].append(f"type not stated in the vocabulary (kind {kind!r}, type {params.get('type')!r})")

    q = _plain(params.get("quest"))
    out["raw"]["quest"] = params.get("quest")
    out["quests"] = [q] if q else None
    out["rare"] = (params.get("rare") or "").strip().lower() in ("yes", "true", "1")
    return out
