#!/usr/bin/env python3
"""#899 — triage the wiki delta: what changed on the wiki that the catalog lacks?

Reads the dump `scripts/browser/harvest_wiki_delta.js` produces (every Item: page
created or edited since our upstream pin) and sorts each page into one bucket:

  * ``in_upstream``  — upstream already carries a record of this name. An edit to
                       it reaches us on the next re-vendor; nothing to do here.
  * ``cosmetic``     — a cosmetic slot the optimizer does not model.
  * ``missing``      — the page could not be read; re-run the harvest.
  * ``sibling``      — a tier of a family upstream already parses (`X (level N)`).
                       A DRAFT `wiki_supplement_items.json` entry is proposed: the
                       nearest sibling's shape and affixes, with the page's level,
                       url and tooltips as evidence. A draft is never applied
                       automatically — a person checks every magnitude upstream
                       stores against the evidence, copies it into the shard, and
                       deletes its `review` note — `expand` refuses an entry that
                       still carries one.
  * ``manual``       — everything else: read the page and decide.

This module decides nothing about values. `src/wiki_supplement.py` is the only
path into the catalog, with its own evidence and retirement guards.

Usage:
  python3 scripts/triage_wiki_delta.py DUMP.json [--drafts OUT.json]
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

LEVEL_RE = re.compile(r"^(?P<base>.+) \(level (?P<lvl>\d+)\)$")
NOISE = re.compile(r"^(Platinum Piece|Copper Piece|None:|Leather|Cloth|Wood|Steel|Iron|Mithral|Adamantine|"
                   r"Silver|Gold|Darkwood|Byeshk|Crystal|Ethereal|Gem:|Force:)")
# `{{Enhancement bonus|w|15}}` (or `~` when the dump came back through the Browser
# pane's privacy guard): the one magnitude upstream stores as a number on every
# weapon family this loop has met. Anything else is copied from the sibling and
# flagged for review.
WEAPON_ENH_RE = re.compile(r"\{\{\s*Enhancement[ _]bonus\s*[|~]\s*w\s*[|~]\s*(\d+)\s*\}\}", re.I)


def _int(s):
    try:
        return int(str(s).strip())
    except (TypeError, ValueError):
        return None


def _nearest_sibling(base, lvl, names):
    tiers = []
    for n in names:
        m = LEVEL_RE.match(n)
        if m and m.group("base") == base:
            tiers.append((int(m.group("lvl")), n))
    if not tiers:
        return None
    lower = [t for t in tiers if t[0] < lvl]
    return (max(lower) if lower else min(tiers))[1]


def triage(dump: dict, raw_items: list, today: str) -> dict:
    by_name = {r.get("name"): r for r in raw_items or []}
    out = {"in_upstream": [], "cosmetic": [], "missing": [], "sibling": [], "manual": []}
    for title, page in sorted((dump.get("items") or {}).items()):
        if title in by_name:
            out["in_upstream"].append(title)
            continue
        if page.get("missing"):
            out["missing"].append(title)
            continue
        kind = f"{page.get('type') or ''} {page.get('slot') or ''}"
        if "cosmetic" in kind.lower():
            out["cosmetic"].append(title)
            continue
        m = LEVEL_RE.match(title)
        ml = _int(page.get("ml"))
        sib = _nearest_sibling(m.group("base"), int(m.group("lvl")), by_name) if m else None
        if sib and ml is not None:
            affixes = [[a.get("name"), a.get("type"), a.get("value")] for a in by_name[sib].get("affixes") or []]
            enh = next((WEAPON_ENH_RE.search(e) for e in page.get("enchantments") or []
                        if WEAPON_ENH_RE.search(e)), None)
            review = ["every magnitude below is the SIBLING's — check each against `evidence`"]
            if enh:
                for a in affixes:
                    if a[0] == "Enhancement Bonus (Weapon)":
                        a[2] = f"+{enh.group(1)}"
                review = ["Enhancement Bonus (Weapon) taken from the page's own template; "
                          "every other magnitude is the SIBLING's — check each against `evidence`"]
            out["sibling"].append({"name": title, "entry": {
                "sibling": sib, "ml": ml, "url": "/page/Item:" + title.replace(" ", "_"),
                "affixes": affixes,
                "evidence": [t for t in page.get("tooltips") or [] if not NOISE.match(t)],
                "harvested": today, "review": review}})
            continue
        out["manual"].append(title)
    return out


def report(result: dict, since: str) -> str:
    lines = [f"# Wiki delta since {since}", ""]
    for key, label in (("sibling", "Sibling-buildable (draft supplement entries)"),
                       ("manual", "Needs a manual read"), ("missing", "Could not be read"),
                       ("cosmetic", "Cosmetic (not modelled)"),
                       ("in_upstream", "Already upstream (edits arrive with the next re-vendor)")):
        rows = result[key]
        lines.append(f"## {label}: {len(rows)}")
        for r in rows:
            lines.append(f"- {r['name'] + ' (from ' + r['entry']['sibling'] + ')' if isinstance(r, dict) else r}")
        lines.append("")
    return "\n".join(lines)


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    with open(argv[0], encoding="utf-8") as fh:
        dump = json.load(fh)
    from src import planner_items
    with open(planner_items.RAW_PATH, encoding="utf-8") as fh:
        raw = json.load(fh)
    result = triage(dump, raw, dt.date.today().isoformat())
    print(report(result, dump.get("since", "?")))
    if "--drafts" in argv:
        path = argv[argv.index("--drafts") + 1]
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({d["name"]: d["entry"] for d in result["sibling"]}, fh, indent=2, ensure_ascii=False)
        print(f"drafts written to {path} — review each against its evidence before copying into the shard")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
