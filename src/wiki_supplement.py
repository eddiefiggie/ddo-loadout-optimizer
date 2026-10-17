"""#874 — an interim supplement of wiki-harvested items, in gear-planner's own shape.

gear-planner is this catalog's single source of truth for item affixes, and it
stopped updating on 2026-10-14 (its Data Auto Updater crashes on a placeholder
minimum level; illusionistpm/ddo-gear-planner#223). Items the wiki gained after
its last good snapshot cannot reach the catalog through it.

`data/seed/compendium/wiki_supplement_items.json` carries the stat-bearing ones.
Each record is BUILT, not parsed: it copies the raw record of its nearest
existing sibling (same weapon family, a tier upstream already parses), then sets
the name, level and wiki url from the item's own page and the affixes in the
sibling's vocabulary, with the magnitude upstream stores taken from the page's
rendered tooltip. So the record has exactly the shape and vocabulary every
downstream stage already handles, and no free text is re-parsed.

#899 — an item with NO sibling (a new family) names an explicit `base` instead:
`{"slot", "type", "quests"?, "pack"?}`. Its slot/type pair must be one upstream
already uses, and in either form every affix `(name, type)` must already appear
somewhere upstream — the supplement borrows upstream's vocabulary, never adds to
it. Exactly one of `sibling` and `base`.

THE RETIREMENT GUARD IS THE POINT. The moment upstream carries a record of the
same name, `expand` fails the build: the supplement must be deleted, never left
to shadow or duplicate the real parse.
"""
from __future__ import annotations

import copy
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHARD_PATH = os.path.join(ROOT, "data", "seed", "compendium", "wiki_supplement_items.json")


def load(path: str = SHARD_PATH) -> dict:
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def expand(raw_items, shard: dict) -> dict:
    """Build the supplement's raw records. Returns `{"records", "problems", "coverage"}`;
    a non-empty `problems` means nothing here may ship."""
    items = (shard or {}).get("items") or {}
    by_name = {}
    for it in raw_items or []:
        by_name.setdefault(it.get("name"), it)
    pairs = {(it.get("slot"), it.get("type")) for it in raw_items or []}
    vocab = {(a.get("name"), a.get("type")) for it in raw_items or [] for a in it.get("affixes") or []}
    problems, records = [], []
    for name, e in sorted(items.items()):
        if name in by_name:
            problems.append(f"{name!r}: upstream now carries this item — delete its supplement "
                            "entry; the real parse supersedes it")
            continue
        if e.get("review"):
            problems.append(f"{name!r}: still carries the triage draft's `review` note — check each "
                            "magnitude against `evidence`, then delete the note")
            continue
        if ("sibling" in e) == ("base" in e):
            problems.append(f"{name!r}: name exactly one of `sibling` and `base`")
            continue
        if "base" in e:
            b = e["base"] or {}
            if (b.get("slot"), b.get("type")) not in pairs:
                problems.append(f"{name!r}: base slot/type {(b.get('slot'), b.get('type'))!r} is not "
                                "one upstream uses — the record would carry vocabulary nothing parses")
                continue
            sib = {"slot": b["slot"], "type": b["type"], "quests": list(b.get("quests") or [])}
            if b.get("pack"):
                sib["pack"] = b["pack"]
        else:
            sib = by_name.get(e.get("sibling"))
            if sib is None:
                problems.append(f"{name!r}: its sibling {e.get('sibling')!r} is no longer upstream — "
                                "the shape it was built from moved")
                continue
        unknown = [(n, t) for n, t, _ in e.get("affixes") or [] if (n, t) not in vocab]
        if unknown:
            problems.append(f"{name!r}: affixes {unknown!r} appear nowhere upstream — the supplement "
                            "borrows upstream's vocabulary, never adds to it")
            continue
        if not e.get("evidence") or not e.get("harvested"):
            problems.append(f"{name!r}: a supplement record needs its wiki evidence and harvest date")
            continue
        if not isinstance(e.get("ml"), int) or not str(e.get("url", "")).startswith("/page/Item:"):
            problems.append(f"{name!r}: needs an integer ml and an Item: url")
            continue
        rec = copy.deepcopy(sib)
        rec["name"] = name
        rec["ml"] = e["ml"]
        rec["url"] = e["url"]
        rec["affixes"] = [{"name": n, "type": t, "value": v} for n, t, v in e.get("affixes") or []]
        rec.pop("augmentUpgrades", None)
        records.append(rec)
    return {"records": records, "problems": problems,
            "coverage": {"entries": len(items), "records": len(records)}}
