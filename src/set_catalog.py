"""Set-definition catalog for enriched set-member gear.

Only the 67 hand-authored base-seed items carry a `set_bonus` field, so the
solver (which reads set membership from `set_bonus[].set`) ignores every enriched
set member. This module supplies the missing definitions from the gear-planner
`sets.json` catalog (ddowiki-derived, pre-structured `{set: [{affixes, threshold}]}`)
so `build_dataset` can attach `set_bonus` to enriched members.

Two hazards this module owns (both surfaced by plan doc-review):

  * **Name reconciliation (KTD4).** The same real set is spelled differently across
    sources: the gear-planner uses a `" Set"` infix (`Adherent of the Mists Set
    (Legendary)`) that the base seed omits (`Adherent of the Mists (Legendary)`).
    `canonical()` normalizes that one systematic divergence so base + enriched
    pieces count toward one threshold. Genuine tier variants (a heroic
    `Flamecleansed Fury` vs a legendary `Legendary Flamecleansed Fury`) keep
    distinct names and stay separate — canonicalization unifies spelling, never
    merges tiers. `reconciliation_audit()` fails loudly on any unhandled drift.

  * **Provenance gate (KTD5).** `affix_parser.parse_line` does NOT reject an
    unknown bonus type — it folds the type word into the stat and defaults to
    Enhancement, minting a junk stat. So this module validates each catalog affix's
    bonus type against `BONUS_TYPES` BEFORE synthesizing text; unknown-type or
    non-numeric affixes are flagged (quarantined, disclosed), never emitted.
"""
from __future__ import annotations

import json
import os
import re

from src.affix_parser import BONUS_TYPES

HERE = os.path.dirname(os.path.abspath(__file__))
CATALOG_PATH = os.path.join(HERE, "..", "data", "seed", "compendium", "raw", "gearplanner_sets.json")
WIKI_URL = "https://ddowiki.com/page/Named_item_sets"

_SET_INFIX = re.compile(r" Set( \([^)]+\))$")  # "X Set (Legendary)" -> "X (Legendary)"
_SET_SUFFIX = re.compile(r" Set$")             # "X Set" -> "X"


def canonical(name: str) -> str:
    """Canonical set-name key. Normalizes only the gear-planner `" Set"` infix/suffix
    (the one systematic base-vs-enriched divergence); tier prefixes stay intact so
    genuine tiers remain distinct."""
    name = (name or "").strip()
    name = _SET_INFIX.sub(r"\1", name)
    name = _SET_SUFFIX.sub("", name)
    return name


def _clause(affix: dict):
    """Render one catalog affix `{name,type,value}` to a value-first `piece_bonuses`
    clause, or return `(None, reason)` when it must be flagged (strict — never mint).
    Known bonus type (or untyped) + numeric value only."""
    name = (affix.get("name") or "").strip()
    ty = affix.get("type")
    val = affix.get("value")
    if ty == "Bool":
        return None, f"proc/flag, not a magnitude (Bool {name})"
    try:
        int(str(val))
    except (TypeError, ValueError):
        return None, f"non-numeric value ({ty} {name} = {val!r})"
    if not name:
        return None, "empty stat name"
    if ty in (None, "", "Enhancement"):
        return f"+{val} bonus to {name}", None          # untyped -> parser defaults to Enhancement
    if ty in BONUS_TYPES:
        return f"+{val} {ty} bonus to {name}", None
    return None, f"unknown bonus type {ty!r} (would fold into the stat)"


def _synthesize(tiers: list):
    """A set's tier list -> ({label: piece_bonuses text}, flagged[])."""
    piece_bonuses, flagged = {}, []
    for tier in tiers or []:
        threshold = tier.get("threshold")
        clauses = []
        for a in tier.get("affixes", []):
            text, reason = _clause(a)
            if text:
                clauses.append(text)
            else:
                flagged.append({"threshold": threshold, "affix": a, "reason": reason})
        if threshold and clauses:
            piece_bonuses[f"{threshold} Pieces"] = "; ".join(clauses)
    return piece_bonuses, flagged


def load_catalog(path: str = CATALOG_PATH) -> dict:
    """Return `{canonical_set_name: {"set_bonus": <entry>, "flagged": [...]}}`.

    `set_bonus` is a base-seed-shaped entry ready to attach to a member's
    `set_bonus` list; a set whose every affix flagged yields `set_bonus=None`
    (membership-only, disclosed).
    """
    with open(path, "r", encoding="utf-8") as fh:
        raw = json.load(fh)
    out = {}
    for name, tiers in raw.items():
        ckey = canonical(name)
        piece_bonuses, flagged = _synthesize(tiers)
        entry = None
        if piece_bonuses:
            entry = {
                "set": ckey,
                "type": "set",
                "source": "gear-planner sets.json (ddowiki-derived)",
                "piece_bonuses": piece_bonuses,
                "wiki_url": WIKI_URL,
            }
        # A duplicate canonical key (rare) keeps the first non-empty definition.
        if ckey not in out or (out[ckey]["set_bonus"] is None and entry is not None):
            out[ckey] = {"set_bonus": entry, "flagged": flagged}
    return out


def base_defs_from_seed(seed_items) -> dict:
    """`{canonical_set_name: base_set_bonus_entry}` from the hand-authored base seed.
    Base entries are authoritative and used verbatim (KTD3)."""
    defs = {}
    for it in seed_items:
        for s in it.get("set_bonus") or []:
            name = s.get("set")
            if name:
                defs.setdefault(canonical(name), s)
    return defs


def definition_for(name: str, base_defs: dict, catalog: dict):
    """The authoritative `set_bonus` entry for a set name: base-seed def wins, else
    the catalog def, else `None` (undefined set — membership only). Matching is on
    the canonical key so cross-source spelling drift resolves."""
    ckey = canonical(name)
    if ckey in base_defs:
        return base_defs[ckey]
    entry = catalog.get(ckey)
    return entry["set_bonus"] if entry else None


def reconciliation_audit(base_defs: dict, catalog: dict, enriched_names, known_undefined=()) -> list:
    """Fail-loud guard against silent name drift (KTD4). Every enriched set member's
    set must resolve to a definition — a base-seed def OR a catalog def OR the
    explicitly-known undefined novelty set(s). An enriched set name that resolves to
    NONE of those is the drift signature: a set we cannot define, which would let its
    members count toward a phantom threshold with no bonus (or split from a base set
    spelled differently). Returns a list of problems; empty means clean."""
    known = {canonical(n) for n in known_undefined}
    seen, problems = set(), []
    for n in enriched_names:
        ckey = canonical(n)
        if ckey in seen:
            continue
        seen.add(ckey)
        if ckey in base_defs or ckey in catalog:
            continue  # resolvable: base def, catalog def, or a known catalog set whose
                      # bonus is all-flagged (non-rankable procs) -> membership-only, disclosed
        if ckey in known:
            continue
        problems.append({
            "enriched_set": n,
            "canonical": ckey,
            "reason": "not in the base seed, the catalog, or the known-undefined list — "
                      "possible spelling drift or a missing catalog entry",
        })
    return problems


def parse_rate(catalog: dict, canonical_names) -> dict:
    """Applied-vs-flagged affix counts across the given canonical set names, for the
    coverage disclosure (so we report tiers with real bonuses vs membership-only)."""
    sets_total = sets_applied = affixes_applied = affixes_flagged = 0
    membership_only = []
    for ckey in set(canonical_names):
        entry = catalog.get(ckey)
        if entry is None:
            continue
        sets_total += 1
        applied = sum(len(v.split(";")) for v in (entry["set_bonus"] or {}).get("piece_bonuses", {}).values())
        affixes_applied += applied
        affixes_flagged += len(entry["flagged"])
        if entry["set_bonus"]:
            sets_applied += 1
        else:
            membership_only.append(ckey)
    return {
        "sets_total": sets_total,
        "sets_with_applied_affixes": sets_applied,
        "affixes_applied": affixes_applied,
        "affixes_flagged": affixes_flagged,
        "membership_only_sets": sorted(membership_only),
    }
