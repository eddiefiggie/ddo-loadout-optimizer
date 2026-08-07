"""U1 — wiki-harvest merge + provenance model (issues #154, #162).

The gear-planner snapshot carries only what changes a number on the character
sheet. Fields that answer "can this character equip this?" — material,
proficiency, race/alignment locks — are absent by construction, and the one
enchantment name that folds two mechanics (`Speed` <- `Striding`) lost half its
meaning on the way in. Both gaps are closed by harvesting the DDO wiki directly.

This module is the repo-side half of that harvest. The browser-side half (the
same-origin MediaWiki API loop) is documented in
`docs/wiki-evidence/harvest-method.md`; it produces a raw dump keyed by wiki
title, and everything here validates, merges, and reports on that dump.

Two properties carry the weight:

**Provenance.** Every value records whether the wiki STATED it, whether it came
from a template DEFAULT, or whether the page is silent (UNSOURCED). This is not
bookkeeping: `Template:Speed` says outright that its attack-speed numbers are
hand-maintained and that any unrecorded magnitude silently renders 5%. A value
indistinguishable from that default is not a sourced value, and under the
standing exclude-until-verified rule it must never reach the solver. Only
`stated` is solver-eligible.

**Idempotent, delta-aware merge.** Re-running a harvest must be free, and a
re-import must surface only genuinely new items. A title already present with an
identical payload is left untouched (no harvest-date churn); a title present
with a DIFFERENT payload raises rather than overwriting — two harvests
disagreeing about the same item is a review event, not a merge.
"""
from __future__ import annotations

import json
import os


class HarvestError(Exception):
    """A dump record failed validation, or contradicted what is already harvested."""


# `stated` is the only solver-eligible provenance. The other two are the
# exclude-until-verified outcomes: recorded so coverage can disclose them and so
# the coverage gate can tell "not yet harvested" from "harvested, wiki is silent",
# but never fed to the solver.
PROVENANCE = ("stated", "defaulted", "unsourced")
_SOLVER_ELIGIBLE = "stated"


def new_shard(field: str) -> dict:
    """An empty shard for one harvested field (e.g. "speed_enchantment", "material")."""
    return {
        "_meta": {
            "field": field,
            "note": "Wiki-harvested seed shard. Values are verbatim from the DDO wiki; "
                    "`provenance` records whether the wiki stated the value, fell back to "
                    "a template default, or is silent. Only `stated` is solver-eligible.",
        },
        "harvested": {},
    }


def load_shard(path: str, field: str = "") -> dict:
    """Load a shard, or return a fresh empty one when the file does not exist yet."""
    if not os.path.exists(path):
        return new_shard(field)
    with open(path, encoding="utf-8") as fh:
        shard = json.load(fh)
    shard.setdefault("harvested", {})
    return shard


def save_shard(path: str, shard: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(shard, fh, indent=2, ensure_ascii=False, sort_keys=False)
        fh.write("\n")


def validate_record(title: str, rec: dict) -> None:
    """Reject a dump record that cannot be trusted, before it can reach a shard."""
    if not isinstance(rec, dict):
        raise HarvestError(f"{title!r}: record must be an object, saw {type(rec).__name__}")

    prov = rec.get("provenance")
    if prov is None:
        raise HarvestError(
            f"{title!r}: missing `provenance`. Every harvested value must record whether "
            f"the wiki stated it, defaulted it, or is silent — an unlabelled value cannot "
            f"be distinguished from a template default.")
    if prov not in PROVENANCE:
        raise HarvestError(
            f"{title!r}: unknown provenance {prov!r}; expected one of {list(PROVENANCE)}")

    if prov == _SOLVER_ELIGIBLE and rec.get("value") in (None, {}, [], ""):
        raise HarvestError(
            f"{title!r}: provenance is 'stated' but no value was captured. 'stated' asserts "
            f"the wiki said it; an empty value contradicts that claim.")


def _payload(rec: dict) -> tuple:
    """The comparable part of a record — everything except when it was harvested."""
    return (json.dumps(rec.get("value"), sort_keys=True),
            rec.get("provenance"),
            rec.get("raw"))


def merge(shard: dict, dump: dict, roster, today: str) -> dict:
    """Merge a raw harvest dump into `shard` in place. Returns coverage stats.

    Records whose title is not in `roster` are ignored rather than merged — a
    harvest loop may sweep a category wider than our own item set, and a shard
    entry for an item we do not carry would show up forever as unexplained.

    Raises `HarvestError` on the first invalid or contradicting record, leaving
    the shard as it was for every record already applied. Validation runs over
    the whole dump BEFORE anything is written, so a bad record cannot leave a
    half-merged shard behind.
    """
    roster = set(roster)
    harvested = shard.setdefault("harvested", {})

    on_roster = {t: r for t, r in dump.items() if t in roster}
    off_roster = len(dump) - len(on_roster)

    for title, rec in sorted(on_roster.items()):
        validate_record(title, rec)

    added = unchanged = 0
    for title, rec in sorted(on_roster.items()):
        existing = harvested.get(title)
        if existing is None:
            harvested[title] = {
                "value": rec.get("value"),
                "provenance": rec["provenance"],
                "raw": rec.get("raw"),
                "harvested": today,
            }
            added += 1
            continue
        if _payload(existing) == _payload(rec):
            unchanged += 1  # idempotent: no rewrite, no harvest-date churn
            continue
        raise HarvestError(
            f"{title!r}: already harvested as {existing.get('value')!r} "
            f"(provenance {existing.get('provenance')!r}, raw {existing.get('raw')!r}) but "
            f"this dump says {rec.get('value')!r} (provenance {rec.get('provenance')!r}, "
            f"raw {rec.get('raw')!r}). Two harvests disagreeing about one item is a review "
            f"event — reconcile against the wiki rather than overwriting.")

    return {"added": added, "unchanged": unchanged, "off_roster": off_roster}


def solver_eligible(rec: dict) -> bool:
    """Only a `stated` value may feed the solver (exclude-until-verified)."""
    return bool(rec) and rec.get("provenance") == _SOLVER_ELIGIBLE


def missing_titles(shard: dict, roster) -> list:
    """Roster titles with no shard entry — the harvest work order.

    This is what makes a re-import cheap: previously harvested items already
    resolve, so a refreshed upstream snapshot surfaces only its genuinely new
    items rather than re-running the whole sweep.
    """
    return sorted(set(roster) - set(shard.get("harvested") or {}))


def coverage(shard: dict, roster) -> dict:
    """Per-provenance counts plus the unharvested remainder, for `metadata`."""
    roster = set(roster)
    harvested = shard.get("harvested") or {}
    counts = {p: 0 for p in PROVENANCE}
    for title, rec in harvested.items():
        if title in roster and rec.get("provenance") in counts:
            counts[rec["provenance"]] += 1
    counts["missing"] = len(missing_titles(shard, roster))
    counts["roster"] = len(roster)
    return counts
