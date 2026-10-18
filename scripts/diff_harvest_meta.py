#!/usr/bin/env python3
"""#906 — parity of our harvested item metadata against pinned gear-planner.

For every gear-planner raw record, read the metadata of the page its `url` points
at (src/wiki_item_meta.py) and compare ml, slot, type, quests, rare. Every
difference is classified (plan #911, "Acceptance is parity"):

  * wiki-changed    — the page was edited after our gear-planner pin, so the two
                      read different revisions; not a parser question.
  * upstream-known  — an existing correction shard already overrides upstream's
                      value for this record; upstream was wrong and we knew it.
  * ours-unread     — our parser returned None (a value it refused to read).
  * review          — everything else; a slice switches only when this is zero
                      after each has been ruled ours-wrong (fixed) or upstream-wrong.

Usage: python3 scripts/diff_harvest_meta.py [HARVEST_ID] [--json OUT]
"""
from __future__ import annotations

import collections
import json
import os
import sys
from urllib.parse import unquote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from src import wiki_item_meta as W  # noqa: E402
import load_harvest as LH  # noqa: E402

FIELDS = ("ml", "slot", "type", "quests")
#: `rare` is not compared: gear-planner reads rarity from the wiki's rare-loot page,
#: not the item page, so item-page parity cannot speak to it (#916).


def _title(url):
    return unquote(str(url).split("/page/", 1)[1]).replace("_", " ") if "/page/" in str(url or "") else None


def corrected_names():
    """Records an existing shard already corrects, per field."""
    out = collections.defaultdict(set)
    p = os.path.join(ROOT, "data", "seed", "compendium", "item_ml_corrections.json")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as fh:
            d = json.load(fh)
        for name, e in d.items():
            if name.startswith("_") or not isinstance(e, dict):
                continue
            out["ml"].add(name)
            if "quests" in e:
                out["quests"].add(name)
    return out


def rulings():
    p = os.path.join(ROOT, "data", "seed", "compendium", "harvest_meta_rulings.json")
    with open(p, encoding="utf-8") as fh:
        return {(r["name"], r["field"]): r["ruling"] for r in json.load(fh)["rulings"]}


def diff(raw_items, pages_by_title, pin_date, corrected, ruled=None):
    ruled = ruled or {}
    rows, counts = [], collections.Counter()
    for r in raw_items:
        t = _title(r.get("url"))
        page = pages_by_title.get(t)
        if not page or page.get("missing"):
            counts["page-missing"] += 1
            rows.append({"name": r["name"], "field": "*", "class": "page-missing"})
            continue
        m = W.meta(page)
        for f in FIELDS:
            gp = r.get(f)
            ours = m.get(f)
            if gp == ours:
                counts[f + ":equal"] += 1
                continue
            if (r["name"], f) in ruled:
                cls = "ruled-" + ruled[(r["name"], f)]
            elif ours is None:
                cls = "ours-unread"
            elif (page.get("ts") or "") > pin_date:
                cls = "wiki-changed"
            elif r["name"] in corrected.get(f, ()):
                cls = "upstream-known"
            else:
                cls = "review"
            counts[f + ":" + cls] += 1
            rows.append({"name": r["name"], "field": f, "class": cls, "gp": gp, "ours": ours,
                         "raw": m.get("raw", {}).get(f if f != "quests" else "quest"), "ts": page.get("ts")})
    return rows, counts


def main(argv):
    hid = next((a for a in argv if not a.startswith("--")), None) or sorted(os.listdir(LH.OUT))[-1]
    with open(LH.SEED, encoding="utf-8") as fh:
        raw = json.load(fh)
    with open(os.path.join(ROOT, "data", "seed", "compendium", "raw", "SOURCE.json"), encoding="utf-8") as fh:
        pin_date = json.load(fh)["upstream_commit_date"] + "T23:59:59Z"
    pages = {p["title"]: p for p in LH.load_pages(hid).values()}
    rows, counts = diff(raw, pages, pin_date, corrected_names(), rulings())
    for f in FIELDS:
        line = {k.split(":")[1]: v for k, v in counts.items() if k.startswith(f + ":")}
        print(f"{f:7} {json.dumps(line, sort_keys=True)}")
    if counts.get("page-missing"):
        print("page-missing", counts["page-missing"])
    if "--json" in argv:
        with open(argv[argv.index("--json") + 1], "w", encoding="utf-8") as fh:
            json.dump(rows, fh, indent=1, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
