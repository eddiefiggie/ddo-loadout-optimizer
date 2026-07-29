"""Legendary Thunder-Forged crafting parser (strict provenance).

Legendary Thunder-Forged items are upgraded across **three tiers**, each tier a
single-pick from that tier's option menu. The solver picks the per-tier config
that best serves the ranked targets, so Thunder-Forged is modeled as a
**multi-tier choice-slot** — the same shape as Viktranium (``src/viktranium.py``),
whose per-slot list is iterated with an independent select-one per entry. Here
the pool is keyed by ``tier`` (1/2/3); a host exposes one slot per tier.

Strict wiki provenance: an option is solver-eligible only with a canonical
``bonus_type`` (in ``affix_parser.BONUS_TYPES``), a present ``stat`` (normalized
via ``vocab.normalize_stat``), an integer ``value``, and a non-empty ``wiki_url``.
Anything else — a proc, a set/on-hit effect, a non-magnitude line — is quarantined
with a reason, never inferred. Pools are empty until harvested; the machinery is
complete. The tier count/boundary is confirmed from the wiki during harvest.
"""
from __future__ import annotations

from src.affix_parser import BONUS_TYPES
from src import vocab


def parse_pools(pools):
    """Parse the seed's per-tier pool list into ``(records, quarantined)``. Each
    eligible record is ``{tier, name, stat, bonus_type, value, unit, wiki_url}``."""
    records, quarantined = [], []
    for p in pools or []:
        tier = p.get("tier")
        wiki_url = (p.get("wiki_url") or "").strip()
        if tier not in (1, 2, 3):
            quarantined.append({"raw": p.get("tier"), "reason": "tier must be 1, 2, or 3"})
            continue
        if not wiki_url:
            quarantined.append({"raw": f"tier {tier}", "reason": "missing wiki_url"})
            continue
        for opt in p.get("options") or []:
            name = (opt.get("name") or "").strip()
            stat = (opt.get("stat") or "").strip()
            bonus_type = (opt.get("bonus_type") or "").strip()
            unit = (opt.get("unit") or "flat").strip()
            value = opt.get("value")
            if not stat or not bonus_type:
                quarantined.append({"raw": f"tier {tier}: {opt}", "reason": "missing stat or bonus_type"})
                continue
            if bonus_type not in BONUS_TYPES:
                quarantined.append({"raw": f"tier {tier}: {stat} ({bonus_type})",
                                    "reason": "unrecognized bonus type"})
                continue
            if not isinstance(value, int):
                quarantined.append({"raw": f"tier {tier}/{name}", "reason": "missing magnitude"})
                continue
            records.append({
                "tier": tier, "name": name, "stat": vocab.normalize_stat(stat),
                "bonus_type": bonus_type, "value": value, "unit": unit, "wiki_url": wiki_url,
            })
    return records, quarantined


def parse_thunder_forged(seed):
    """Parse a ``thunder_forged`` seed dict into structured records + coverage."""
    seed = seed or {}
    records, quarantined = parse_pools(seed.get("pools"))
    by_tier = {}
    for r in records:
        by_tier[r["tier"]] = by_tier.get(r["tier"], 0) + 1
    seeded_tiers = {p.get("tier") for p in seed.get("pools") or [] if p.get("tier") in (1, 2, 3)}
    pending = sorted(t for t in seeded_tiers if by_tier.get(t, 0) == 0)
    coverage = {
        "tiers_sourced": sorted(by_tier),
        "tiers_pending": pending,
        "options_eligible": len(records),
        "options_quarantined": len(quarantined),
        "quarantined": quarantined,
        "by_tier": by_tier,
        "note": "multi-tier choice-slot: one option per tier (1/2/3), independent "
                "per-tier picks. Pools pending wiki harvest.",
    }
    return {"records": records, "quarantined": quarantined, "coverage": coverage}
