#!/usr/bin/env python3
"""#907 — record, per mapped enchantment template, the template code that renders its
default bonus type, from a `Template:` harvest (gitignored).

The committed shard lets a test pin each mapper's default to the code it was read
from, and lets a later template harvest detect drift: if a template's code no longer
contains the quoted default, the mapper must be re-read before the next switch.

Usage: python3 scripts/build_template_evidence.py data/harvest/templates-YYYYMMDD/templates.json.gz
"""
from __future__ import annotations

import gzip
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from src import wiki_enchantments as E  # noqa: E402

OUT = os.path.join(ROOT, "data", "seed", "compendium", "enchantment_template_evidence.json")


def code(wt):
    m = re.search(r"<onlyinclude>([\s\S]*?)</onlyinclude>", wt) or re.search(r"<includeonly>([\s\S]*?)</includeonly>", wt)
    return m.group(1) if m else re.sub(r"<noinclude>[\s\S]*?</noinclude>", "", wt)


def build(pages):
    by = {p["title"]: p for p in pages}
    out, problems = {}, []
    for t, (default, quote) in sorted(E.TEMPLATE_DEFAULTS.items()):
        p = by.get("Template:" + t)
        if not p or not p.get("wikitext"):
            problems.append(f"Template:{t} is not in the harvest")
            continue
        c = code(p["wikitext"])
        i = c.find(quote)
        if i < 0:
            problems.append(f"Template:{t}: its code no longer contains {quote!r} — re-read the default")
            continue
        out[t] = {"default": default, "quote": quote, "revid": p["revid"], "ts": p["ts"],
                  "excerpt": c[max(0, i - 120): i + len(quote) + 60]}
    return out, problems


def main(argv):
    with gzip.open(argv[0], "rt", encoding="utf-8") as fh:
        pages = json.load(fh)
    ev, problems = build(pages)
    if problems:
        print("\n".join(problems))
        return 1
    shard = {"_meta": {"why": "#907 — each mapped enchantment template's default bonus type, with the "
                              "template CODE that renders it (not its usage notes) and the revision read.",
                       "helpers": {"Template:Insightful": 678297, "Template:Roman2Dec": 639664},
                       "regenerate": "python3 scripts/build_template_evidence.py <templates harvest>"},
             "templates": ev}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(shard, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    print(f"wrote {len(ev)} templates")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
