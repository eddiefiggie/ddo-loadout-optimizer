#!/usr/bin/env python3
"""#907 — parity of our template mappers against gear-planner's affixes.

For every gear-planner record, map its page's enchantment lines
(src/wiki_enchantments.py) and compare each mapped `(name, type, value)` with the
record's own affixes:

  exact        — gear-planner carries the same name, type and value
  type-differs — same name and value, different bonus type   <- stacking-critical
  value-differs— same name, different value
  absent       — gear-planner carries no affix of that name

Reported per template, with examples, so a mapper is fixed or a ruling recorded
before its family switches.

Usage: python3 scripts/diff_harvest_affixes.py [HARVEST_ID] [--examples N]
"""
from __future__ import annotations

import collections
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from src import wiki_enchantments as E  # noqa: E402
from src import wiki_item_meta as W  # noqa: E402
import load_harvest as LH  # noqa: E402
from diff_harvest_meta import _title  # noqa: E402


def _num(v):
    try:
        return int(str(v).strip().lstrip("+"))
    except (TypeError, ValueError):
        return v


def known_type_corrections():
    """`(item, affix, to_type)` the build already applies via affix_type_corrections.json:
    a type-differs that matches one is upstream-known, not a parser question."""
    p = os.path.join(ROOT, "data", "seed", "compendium", "affix_type_corrections.json")
    with open(p, encoding="utf-8") as fh:
        d = json.load(fh)
    known = {(item, e["name"], e["to"]) for item, es in d.items() if not item.startswith("_") and isinstance(es, list)
             for e in es}
    # #887 — roman-numeral element lores: upstream reads I..X raw, the template adds 10.
    p = os.path.join(ROOT, "data", "seed", "compendium", "roman_element_lore.json")
    with open(p, encoding="utf-8") as fh:
        lore = json.load(fh)
    for item, es in (lore.get("items") or {}).items():
        for e in es if isinstance(es, list) else [es]:
            if isinstance(e, dict) and e.get("stat"):
                known.add((item, "LORE", e["stat"]))
                # The shard names the catalog's stat after the build's renames;
                # gear-planner's raw records still carry the pre-rename names.
                raw_name = {"Void Lore": "Negative Lore", "Ice Lore": "Cold Lore"}.get(e["stat"])
                if raw_name:
                    known.add((item, "LORE", raw_name))
    return known


def compare(raw_items, pages_by_title, known=frozenset()):
    by_tpl = collections.defaultdict(collections.Counter)
    examples = collections.defaultdict(list)
    seen = set()
    for r in raw_items:
        if r["name"] in seen:
            continue
        seen.add(r["name"])
        page = pages_by_title.get(_title(r.get("url")))
        box = W.infobox((page or {}).get("wikitext") or "")
        if not box:
            continue
        gp = [(a.get("name"), a.get("type"), _num(a.get("value"))) for a in r.get("affixes") or []]
        gp_names = {g[0] for g in gp}
        for line in (box[1].get("enhancements") or "").split("\n"):
            if E.depth(line) > 1:
                continue
            call = E.parse_call(line)
            if not call or call is E._QUALIFIED or call[0] not in E.MAPPERS:
                continue
            try:
                ours = E.MAPPERS[call[0]](call[1], call[2])
            except E.Unmapped as e:
                by_tpl[call[0]]["unmapped"] += 1
                examples[(call[0], "unmapped")].append((r["name"], line.strip()[:80], str(e)))
                continue
            for o in ours:
                if o in gp:
                    cls = "exact"
                elif o[0] not in gp_names:
                    cls = "absent"
                elif any(g[0] == o[0] and g[2] == o[2] for g in gp):
                    cls = "upstream-known" if (r["name"], o[0], o[1]) in known else "type-differs"
                elif call[0] == "Spelllore" and (r["name"], "LORE", o[0]) in known:
                    cls = "upstream-known"
                else:
                    cls = "value-differs"
                by_tpl[call[0]][cls] += 1
                if cls != "exact":
                    examples[(call[0], cls)].append(
                        (r["name"], line.strip()[:80], o, [g for g in gp if g[0] == o[0]] or sorted(gp_names)[:6]))
    return by_tpl, examples


def main(argv):
    hid = next((a for a in argv if not a.startswith("--") and not a.isdigit()), None) or "items-20261018"
    n = int(argv[argv.index("--examples") + 1]) if "--examples" in argv else 3
    with open(LH.SEED, encoding="utf-8") as fh:
        raw = json.load(fh)
    pages = {p["title"]: p for p in LH.load_pages(hid).values()}
    by_tpl, ex = compare(raw, pages, known_type_corrections())
    for t, c in sorted(by_tpl.items(), key=lambda kv: -sum(kv[1].values())):
        tot = sum(c.values())
        print(f"{t:14} {tot:5}  exact {c['exact'] / tot:6.1%}  {dict(c)}")
        for cls in ("type-differs", "value-differs", "absent", "unmapped"):
            for e in ex.get((t, cls), [])[:n]:
                print(f"      {cls}: {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
