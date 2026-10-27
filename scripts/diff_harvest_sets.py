#!/usr/bin/env python3
"""#908 — parity of the wiki's set definitions against gear-planner's set catalog.

Reads a set-page harvest (`load_harvest.py --titles data/harvest_titles/
named-item-sets.json`) through src/wiki_sets.py and compares every gear-planner
set with what the wiki states for it, per source:

  template — `Template:Named item sets`, matched by switch key (lower-cased name)
  page     — `Named item sets`, matched by anchor; a HELstats row is NOT matched by
             name (its anchor names at most one of its tiers) and is counted apart

Each (set, source) lands in one class:

  no-wiki-name       — the source has no entry under this exact name
  threshold-unstated — the source states bonus lines under no `N Pieces Equipped:`
  threshold-differs  — the stated thresholds are not gear-planner's
  exact              — every line read, and the affixes equal gear-planner's
  partial            — some lines quarantined; every line read agrees with gear-planner
  ours-differs       — a line read to an affix gear-planner does not carry   <- review

`ours-differs` is the switch gate: Phase 3 switches once it is 0 and every
remaining difference is classified. Sets where the two wiki sources disagree are
listed separately — that is a wiki question, not a parser one.

Usage: python3 scripts/diff_harvest_sets.py [HARVEST_ID] [--examples N] [--json]
"""
from __future__ import annotations

import collections
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from src import wiki_sets as S  # noqa: E402
from src.affix_parser import BONUS_TYPES  # noqa: E402
import load_harvest as LH  # noqa: E402

TITLES = os.path.join(ROOT, "data", "harvest_titles", "named-item-sets.json")
GP_SETS = os.path.join(ROOT, "data", "seed", "compendium", "raw", "gearplanner_sets.json")
PAGE, TEMPLATE = "Named item sets", "Template:Named item sets"


def _num(v):
    try:
        return int(str(v).strip().lstrip("+"))
    except (TypeError, ValueError):
        return v


def gp_tiers(tiers) -> dict:
    """gear-planner's `[{threshold, affixes}]` -> {threshold: Counter((name, type, value))}."""
    out = {}
    for t in tiers or []:
        c = out.setdefault(t.get("threshold"), collections.Counter())
        for a in t.get("affixes") or []:
            c[(a.get("name"), a.get("type"), _num(a.get("value")))] += 1
    return out


def classify(wiki_tiers: dict, gp: dict, stat_names) -> tuple[str, dict]:
    """One source's {threshold: [lines]} against gear-planner's tiers -> (class, detail)."""
    if None in wiki_tiers:
        return "threshold-unstated", {"lines": [S.plain(x) for x in wiki_tiers[None]]}
    if set(wiki_tiers) != set(gp):
        return "threshold-differs", {"wiki": sorted(wiki_tiers), "gear-planner": sorted(k for k in gp if k is not None)}
    quarantined, extra = [], []
    for th, lines in wiki_tiers.items():
        read = collections.Counter()
        for line in lines:
            r = S.read_clause(line, BONUS_TYPES, stat_names)
            if "affixes" in r:
                for a in r["affixes"]:
                    read[(a["name"], a["type"], a["value"])] += 1
            else:
                quarantined.append({"threshold": th, "line": S.plain(line), "reason": r["quarantine"]})
        extra += [{"threshold": th, "affix": list(k)} for k in (read - gp.get(th, collections.Counter()))]
    if extra:
        return "ours-differs", {"extra": extra, "quarantined": quarantined}
    return ("partial", {"quarantined": quarantined}) if quarantined else ("exact", {})


def diff(pages: dict, gp_sets: dict) -> dict:
    page, template = pages[PAGE], pages[TEMPLATE]
    T = S.template_sets(template["wikitext"])
    rows = S.page_sets(page["wikitext"])
    by_anchor = {}
    for r in rows:
        if r["tier"] is None:
            for a in r["anchors"]:
                by_anchor.setdefault(a.lower(), r)
    stat_names = {a.get("name") for t in gp_sets.values() for tier in t for a in tier.get("affixes") or []}

    per_set, counts = {}, {"template": collections.Counter(), "page": collections.Counter()}
    for name, tiers in gp_sets.items():
        gp = gp_tiers(tiers)
        rec = {}
        for src, entry in (("template", T.get(name.lower())), ("page", by_anchor.get(name.lower()))):
            cls, detail = ("no-wiki-name", {}) if entry is None else classify(entry["tiers"], gp, stat_names)
            counts[src][cls] += 1
            rec[src] = {"class": cls, **detail}
        per_set[name] = rec

    def readable(entry):
        if entry is None or None in entry["tiers"]:
            return None
        out = {}
        for th, lines in entry["tiers"].items():
            rs = [S.read_clause(x, BONUS_TYPES, stat_names) for x in lines]
            if any("quarantine" in r for r in rs):
                return None
            out[th] = sorted((a["name"], a["type"], a["value"]) for r in rs for a in r["affixes"])
        return out

    disagree = []
    for key, entry in T.items():
        a, b = readable(entry), readable(by_anchor.get(key))
        if a is not None and b is not None and a != b:
            disagree.append({"set": entry["name"] or key, "template": a, "page": b})

    return {
        "harvest_revids": {PAGE: page["revid"], TEMPLATE: template["revid"]},
        "gear_planner_sets": len(gp_sets),
        "template_entries": len(T),
        "page_rows": {"named": sum(1 for r in rows if r["tier"] is None),
                      "helstats_tier_records": sum(1 for r in rows if r["tier"] is not None)},
        "counts": {k: dict(v) for k, v in counts.items()},
        "sources_disagree": disagree,
        "sets": per_set,
    }


def main(argv) -> int:
    hid = next((a for a in argv if not a.startswith("--") and not a.isdigit()), None)
    n_ex = int(argv[argv.index("--examples") + 1]) if "--examples" in argv else 3
    titles = LH.explicit_titles(json.load(open(TITLES, encoding="utf-8")))
    hid = hid or LH.latest_id(prefix="pages-") if hasattr(LH, "latest_id") else hid
    if not hid:
        print("usage: diff_harvest_sets.py HARVEST_ID", file=sys.stderr)
        return 2
    loaded = LH.load_pages(hid)
    loaded = loaded.values() if isinstance(loaded, dict) else loaded
    pages = {p["title"]: p for p in loaded}
    missing = [t for t in titles if t not in pages]
    if missing:
        print(f"harvest {hid} lacks {missing} — re-run the set-page harvest", file=sys.stderr)
        return 2
    with open(GP_SETS, encoding="utf-8") as fh:
        gp_sets = json.load(fh)
    report = diff(pages, gp_sets)
    if "--json" in argv:
        print(json.dumps(report, indent=1, ensure_ascii=False))
        return 0
    print(f"harvest {hid}: revids {report['harvest_revids']}")
    print(f"gear-planner sets {report['gear_planner_sets']}, template entries {report['template_entries']}, "
          f"page rows {report['page_rows']}")
    for src in ("template", "page"):
        print(f"\n{src}:")
        for cls, n in sorted(report["counts"][src].items(), key=lambda kv: -kv[1]):
            print(f"  {cls:20} {n}")
            ex = [k for k, v in report["sets"].items() if v[src]["class"] == cls][:n_ex]
            for k in ex:
                d = {x: y for x, y in report["sets"][k][src].items() if x != "class"}
                print(f"      {k}: {json.dumps(d, ensure_ascii=False)[:220]}")
    print(f"\nsources disagree (both fully read): {len(report['sources_disagree'])}")
    for d in report["sources_disagree"][:n_ex]:
        print(f"  {json.dumps(d, ensure_ascii=False)[:300]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
