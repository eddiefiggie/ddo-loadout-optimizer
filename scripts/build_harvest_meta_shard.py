#!/usr/bin/env python3
"""#906 — write the committed item-metadata shard from a wiki harvest.

The harvest itself (data/harvest/, ~1.5 MB of compressed wikitext) is gitignored,
so CI cannot read it. This script reduces it to what the build needs: for every
gear-planner record, the metadata its wiki page STATES (src/wiki_item_meta.py),
plus the page revision it was read from. A field the page does not state is
simply absent; the build then keeps gear-planner's value and says so.

Usage: python3 scripts/build_harvest_meta_shard.py [HARVEST_ID]
"""
from __future__ import annotations

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from src import harvest_meta as HM  # noqa: E402
from src import wiki_item_meta as W  # noqa: E402
import load_harvest as LH  # noqa: E402
from diff_harvest_meta import _title  # noqa: E402

#: Pages whose record the build drops anyway: not an item.
NOT_ITEMS = {"Leaves of the Forest": "a family index page (a DPL listing); build_dataset drops the record"}


def build(raw_items, pages_by_title, hid, harvested):
    records, excluded = {}, {}
    for r in raw_items:
        name = r["name"]
        if name in NOT_ITEMS:
            excluded[name] = NOT_ITEMS[name]
            continue
        page = pages_by_title.get(_title(r.get("url")))
        if not page or page.get("missing"):
            continue
        m = W.meta(page)
        rec = {f: m[f] for f in HM.FIELDS if m.get(f) is not None}
        rec["revid"] = page.get("revid")
        records[name] = rec
    return {"_meta": {
        "why": "#906 — item metadata read by THIS project from the DDO wiki (own item harvest, #911), "
               "overlaid on the vendored gear-planner records by src/harvest_meta.py. A field the page "
               "does not state is absent here and the build keeps gear-planner's value for it.",
        "harvest": hid, "harvested": harvested, "parser": "src/wiki_item_meta.py",
        "regenerate": "python3 scripts/build_harvest_meta_shard.py <harvest id>",
        "fields": list(HM.FIELDS), "records": len(records)},
        "excluded": excluded, "records": records}


def main(argv):
    hid = argv[0] if argv else sorted(os.listdir(LH.OUT))[-1]
    with open(LH.SEED, encoding="utf-8") as fh:
        raw = json.load(fh)
    loaded = LH.load_pages(hid)
    cov = LH.coverage(loaded, len(LH.seed_titles(raw)))
    if not cov["complete"]:
        print(f"refusing: harvest {hid} is incomplete ({cov})")
        return 1
    pages = {p["title"]: p for p in loaded.values()}
    harvested = max(p["ts"] for p in loaded.values() if p.get("ts"))[:10]
    shard = build(raw, pages, hid, harvested)
    with open(HM.SHARD_PATH, "w", encoding="utf-8") as fh:
        json.dump(shard, fh, indent=1, ensure_ascii=False, sort_keys=False)
        fh.write("\n")
    print(f"wrote {os.path.relpath(HM.SHARD_PATH, ROOT)}: {len(shard['records'])} records")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
