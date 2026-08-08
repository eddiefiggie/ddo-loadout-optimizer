#!/usr/bin/env python3
"""Merge a browser-side wiki harvest dump into a seed shard, or list what is left.

The harvest itself runs in the browser (same-origin MediaWiki API from a ddowiki
tab) — see `docs/wiki-evidence/harvest-method.md`. This is the repo-side half:
it validates the dump, merges it idempotently, and reports coverage. All the
logic lives in `src/harvest.py`; this is a thin CLI over it.

Usage:

    # What still needs harvesting (the work order — delta-only by construction)
    python3 scripts/merge_harvest.py --field speed --missing-only
    python3 scripts/merge_harvest.py --field material --missing-only

    # Merge a dump the browser loop produced
    python3 scripts/merge_harvest.py --field speed --dump /path/to/dump.json

    # Coverage of what is harvested so far
    python3 scripts/merge_harvest.py --field material --coverage

The dump is a JSON object keyed by wiki title:

    {
      "Item:Ash Boots":  {"value": {"movement": 30}, "provenance": "stated",
                          "raw": "{{Striding|30}}"},
      "Item:Brazenband": {"value": {"movement": 30, "alacrity": 7},
                          "provenance": "stated", "raw": "{{Speed|VII}}"},
      "Item:Cape of the Roc": {"value": null, "provenance": "defaulted",
                               "raw": "{{Speed|21}}"}
    }

`provenance` is required on every record and is the whole point: only `stated`
values are solver-eligible. `defaulted` records a value the wiki template filled
in rather than recorded (Template:Speed silently renders 5% for any magnitude
nobody entered), and `unsourced` records a page that simply does not say.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from src import harvest  # noqa: E402
from src import speed_split  # noqa: E402

RAW_ITEMS = os.path.join(ROOT, "data", "seed", "compendium", "raw", "gearplanner_items.json")
SHARD_DIR = os.path.join(ROOT, "data", "seed", "compendium")

SHIELD_TYPES = {"Bucklers", "Small shields", "Large shields", "Tower shields"}
# Docents are the Forged body slot; the oath gate already treats Forged as moot,
# so they stay out of the material roster.
BODY_ARMOR_TYPES = {"Cloth armor", "Light armor", "Medium armor", "Heavy armor"}

FIELDS = {
    "speed": {
        "shard": os.path.join(SHARD_DIR, "speed_enchantment.json"),
        "help": "items carrying a gear-planner `Speed` affix (#154)",
    },
    "material": {
        "shard": os.path.join(SHARD_DIR, "item_material.json"),
        "help": "shields and body armor (#162)",
    },
    # Keyed by augment NAME, not wiki title — augments have no item page and
    # share one `Augment Slot` url, so `roster()`'s title join cannot reach
    # them. Separate shard keeps the two join keys from mixing in one file.
    "speed_augment": {
        "shard": os.path.join(SHARD_DIR, "speed_augment.json"),
        "help": "augments carrying a gear-planner `Speed` affix (#134)",
        "key": "name",
    },
}


def _title(url: str) -> str:
    """`/page/Item:Ash_Boots` -> `Item:Ash Boots` (the MediaWiki API title)."""
    return urllib.parse.unquote(url.replace("/page/", "")).replace("_", " ")


def roster(field: str) -> set:
    """The set of wiki titles this field must cover, from the pinned raw snapshot."""
    with open(RAW_ITEMS, encoding="utf-8") as fh:
        items = json.load(fh)

    if field == "speed":
        return {_title(i["url"]) for i in items
                if any(a.get("name") == "Speed" for a in i.get("affixes") or [])}
    if field == "material":
        return {_title(i["url"]) for i in items
                if (i.get("slot") == "Offhand" and i.get("type") in SHIELD_TYPES)
                or (i.get("slot") == "Armor" and i.get("type") in BODY_ARMOR_TYPES)}
    raise SystemExit(f"unknown field {field!r}; expected one of {sorted(FIELDS)}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--field", required=True, choices=sorted(FIELDS),
                    help="which harvest to operate on")
    ap.add_argument("--dump", help="path to a raw harvest dump to merge")
    ap.add_argument("--missing-only", action="store_true",
                    help="print the roster titles not yet harvested, one per line")
    ap.add_argument("--coverage", action="store_true",
                    help="print per-provenance coverage counts")
    ap.add_argument("--limit", type=int, default=0,
                    help="with --missing-only, print at most N titles (0 = all)")
    ap.add_argument("--compare-tooltips", metavar="DUMP",
                    help="report drift between stored tooltip snapshots and a "
                         "browser-rendered dump; never writes")
    ap.add_argument("--tooltip-worklist", action="store_true",
                    help="print the invocations the refresher should re-render "
                         "(the hand-maintained Arabic switch rows only)")
    args = ap.parse_args()

    shard_path = FIELDS[args.field]["shard"]
    shard = harvest.load_shard(shard_path, args.field)
    targets = roster(args.field)

    if args.missing_only:
        missing = harvest.missing_titles(shard, targets)
        for t in (missing[: args.limit] if args.limit else missing):
            print(t)
        print(f"# {len(missing)} of {len(targets)} still unharvested", file=sys.stderr)
        return 0

    if args.coverage:
        print(json.dumps(harvest.coverage(shard, targets), indent=2))
        return 0

    if args.tooltip_worklist:
        # Roman ranks derive from a documented stable formula
        # (movement = min(5 x rank, 30), attack speed = rank%); only the Arabic
        # switch is hand-maintained on the wiki and can change under us. Refresh
        # scope is therefore the Arabic rows, which roughly halves the recurring
        # cost against a source that throttles after about eight rapid calls.
        arabic = sorted({e["raw"] for e in (shard.get("harvested") or {}).values()
                         if e.get("raw") and speed_split.arabic_magnitude(e["raw"]) is not None},
                        key=lambda r: speed_split.arabic_magnitude(r))
        for raw in arabic:
            print(raw)
        print(f"# {len(arabic)} Arabic invocations to re-render "
              f"(Roman ranks derive from a stable formula and are skipped)",
              file=sys.stderr)
        return 0

    if args.compare_tooltips:
        with open(args.compare_tooltips, encoding="utf-8") as fh:
            rendered = json.load(fh)

        stored = shard.get("snapshots") or {}
        drift, unknown, matched = [], [], 0
        for raw, tooltip in sorted(rendered.items()):
            key = speed_split.snapshot_key(raw)
            if key not in stored:
                unknown.append(raw)
                continue
            was = " ".join((stored[key].get("tooltip") or "").split())
            now = " ".join(str(tooltip).split())
            if was == now:
                matched += 1
            else:
                drift.append({"invocation": raw, "stored": was, "rendered": now})

        report = {"compared": len(rendered), "matched": matched,
                  "drifted": len(drift), "unknown": unknown, "drift": drift}
        print(json.dumps(report, indent=2))
        if drift:
            print("\nDrift is a review event, not an automatic update. The wiki may "
                  "have recorded a magnitude that was previously defaulted — re-harvest "
                  "deliberately and re-ratify the derived values; this command never "
                  "writes.", file=sys.stderr)
            return 1
        return 0

    if not args.dump:
        ap.error("one of --dump, --missing-only, or --coverage is required")

    with open(args.dump, encoding="utf-8") as fh:
        dump = json.load(fh)

    today = datetime.date.today().isoformat()
    try:
        stats = harvest.merge(shard, dump, targets, today=today)
    except harvest.HarvestError as exc:
        print(f"harvest merge refused: {exc}", file=sys.stderr)
        return 1

    harvest.save_shard(shard_path, shard)
    cov = harvest.coverage(shard, targets)
    print(f"merged into {os.path.relpath(shard_path, ROOT)}: "
          f"+{stats['added']} added, {stats['unchanged']} unchanged, "
          f"{stats['off_roster']} off-roster ignored")
    print(f"coverage: {cov['stated']} stated, {cov['defaulted']} defaulted, "
          f"{cov['unsourced']} unsourced, {cov['missing']} still missing "
          f"(roster {cov['roster']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
