"""Green Steel crafting parser (strict provenance).

Legendary Green Steel items are configurable: the player crafts effects into a
blank host. Under theoretical-BiS the solver picks the endgame-relevant config
that best serves the ranked targets, so Green Steel is modeled as a single-pick
**choice-slot** over a curated pool — the same gated select-one shape as a Seal
slot (``src/seal.py``), a flat pool with one magnitude per option (no tier split).

Scope is the **endgame-relevant subset** (the SP/HP/Insightful/Quality/proc
effects that win ML30+ slots), not the full combinatorial space; the cutline and
its rationale live in the seed metadata and are disclosed per result.

Strict wiki provenance: an option is solver-eligible only with a canonical
``bonus_type`` (in ``affix_parser.BONUS_TYPES``), a present ``stat`` (normalized
via ``vocab.normalize_stat``), an integer ``value``, and a non-empty ``wiki_url``.
Anything else is quarantined with a reason, never inferred. The pool is empty
until harvested; the machinery is complete.
"""
from __future__ import annotations

from src.affix_parser import BONUS_TYPES
from src import vocab


def parse_options(options, wiki_url):
    """Parse a flat option list into ``(records, quarantined)``. Each eligible
    record is ``{name, stat, bonus_type, value, unit, wiki_url}``."""
    records, quarantined = [], []
    for opt in options or []:
        name = (opt.get("name") or "").strip()
        stat = (opt.get("stat") or "").strip()
        bonus_type = (opt.get("bonus_type") or "").strip()
        unit = (opt.get("unit") or "flat").strip()
        value = opt.get("value")
        opt_url = (opt.get("wiki_url") or wiki_url or "").strip()
        if not stat or not bonus_type:
            quarantined.append({"raw": str(opt), "reason": "missing stat or bonus_type"})
            continue
        if bonus_type not in BONUS_TYPES:
            quarantined.append({"raw": f"{stat} ({bonus_type})", "reason": "unrecognized bonus type"})
            continue
        if not isinstance(value, int):
            quarantined.append({"raw": name or stat, "reason": "missing magnitude"})
            continue
        if not opt_url:
            quarantined.append({"raw": name or stat, "reason": "missing wiki_url"})
            continue
        records.append({
            "name": name, "stat": vocab.normalize_stat(stat), "bonus_type": bonus_type,
            "value": value, "unit": unit, "wiki_url": opt_url,
        })
    return records, quarantined


def parse_green_steel(seed):
    """Parse a ``green_steel`` seed dict into structured records + coverage."""
    seed = seed or {}
    wiki_url = (seed.get("metadata") or {}).get("wiki_url", "")
    records, quarantined = parse_options(seed.get("options"), wiki_url)
    coverage = {
        "options_eligible": len(records),
        "options_quarantined": len(quarantined),
        "quarantined": quarantined,
        "pending": len(records) == 0,
        "cutline": (seed.get("metadata") or {}).get("cutline"),
        "note": "single-pick choice-slot over the endgame-relevant Green Steel "
                "effect pool; the solver crafts the best option per host. Pool "
                "pending wiki harvest.",
    }
    return {"records": records, "quarantined": quarantined, "coverage": coverage}
