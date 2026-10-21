#!/usr/bin/env python3
"""#907 — write the committed enchantment shard from a wiki harvest.

For every gear-planner record: the affixes the template mappers read from the item's
own page (top-level lines only), and the names of MAPPED templates whose calls the
mapper could not read. A record with any such call is kept whole by the overlay; a
call the mapper deliberately DECLINED (E.Declined) is not one — it yields no affix,
so gear-planner's own affix for it stands while the item's other values are read.

Usage: python3 scripts/build_harvest_affix_shard.py [HARVEST_ID]
"""
from __future__ import annotations

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from src import harvest_affixes as HA  # noqa: E402
from src import wiki_enchantments as E  # noqa: E402
from src import wiki_item_meta as W  # noqa: E402
import load_harvest as LH  # noqa: E402
from diff_harvest_meta import _title  # noqa: E402


def build(raw_items, pages_by_title):
    records = {}
    for r in raw_items:
        if r["name"] in records:
            continue
        page = pages_by_title.get(_title(r.get("url")))
        box = W.infobox((page or {}).get("wikitext") or "")
        if not box:
            continue
        mapped, unmapped = E.affixes(box[1].get("enhancements") or "")
        rec = {"affixes": [list(a) for a in mapped], "revid": page.get("revid")}
        unread = sorted({t for t, why in unmapped
                         if (t in E.MAPPERS or t == E._QUALIFIED[0]) and not why.startswith(E.DECLINED)})
        if unread:
            rec["unread"] = unread
        records[r["name"]] = rec
    return records


def main(argv):
    hid = argv[0] if argv else sorted(os.listdir(LH.OUT))[-1]
    with open(LH.SEED, encoding="utf-8") as fh:
        raw = json.load(fh)
    loaded = LH.load_pages(hid)
    if not LH.coverage(loaded, len(LH.seed_titles(raw)))["complete"]:
        print(f"refusing: harvest {hid} is incomplete")
        return 1
    records = build(raw, {p["title"]: p for p in loaded.values()})
    shard = {"_meta": {
        "why": "#907 — item enchantments read by THIS project from each item's wiki page by the template "
               "mappers in src/wiki_enchantments.py (defaults from template code, "
               "docs/wiki-evidence/enchantment-template-defaults.md). src/harvest_affixes.py overlays them "
               "on the switched families; a record listing `unread` keeps gear-planner's affixes whole.",
        "harvest": hid, "mappers": sorted(E.MAPPERS),
        "regenerate": "python3 scripts/build_harvest_affix_shard.py <harvest id>", "records": len(records)},
        "records": records}
    with open(HA.SHARD_PATH, "w", encoding="utf-8") as fh:
        json.dump(shard, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")
    print(f"wrote {len(records)} records")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
