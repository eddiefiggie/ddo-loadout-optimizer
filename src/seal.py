"""Seal-slot crafting parser (strict provenance).

DDO's "Sealed in X" unique enchantments (``Sealed in Fire / Undeath / Gloom /
Mist``) let an item have its power *unsealed* at a crafting table, gaining
**one** effect chosen from a pool keyed to the item's gear category — the wiki:
"adding one effect. Attempting to add another will remove the original." So a
seal slot is the same gated **select-one choice-slot** as a Nearly Complete slot
or a Viktranium typed slot; this module mirrors ``src/viktranium.py``, only
simpler: the pool is keyed by ``seal_type`` alone (each seal type is one flat
pool over its category domain) and there is a single magnitude tier, not the
Heroic/Legendary split.

Strict wiki provenance. An option is solver-eligible only with a canonical
``bonus_type`` (in ``affix_parser.BONUS_TYPES``), a present ``stat`` (run through
``vocab.normalize_stat`` to match the item pipeline's vocabulary), an integer
``value``, and a non-empty ``wiki_url``. Anything else is quarantined with a
reason, never inferred.

Only the Sealed in Undeath pool (Ritual Table clothing/jewelry) is enumerated
today; Fire/Gloom/Mist carry empty pools until harvested, but the same machinery
covers them. Sourced via Claude-in-Chrome (plain fetch returns empty for ddowiki).
"""
from __future__ import annotations

from src.affix_parser import BONUS_TYPES
from src import vocab

# The seal-enchantment types (the wiki's "Sealed in X" Unique_enchantment names).
# "Amber" is intentionally absent: it is Ravenloft "The Vampire Hunters" quest
# content, not a stat-choice seal in this family.
SEAL_TYPES = {"Undeath", "Fire", "Gloom", "Mist"}


def normalize_seal_type(name):
    """Fold a "Sealed in X" name (or a bare "X") to its canonical seal type.
    Returns None if unrecognized."""
    s = (name or "").strip()
    if s.lower().startswith("sealed in "):
        s = s[len("sealed in "):].strip()
    s = s.title()
    return s if s in SEAL_TYPES else None


def parse_pools(pools):
    """Parse the seed's pool list into ``(records, quarantined)``.

    Each eligible record is ``{seal_type, domain, name, stat, bonus_type, value,
    unit, wiki_url}``. Unlike Viktranium there is a single magnitude tier, so one
    option yields one record.
    """
    records, quarantined = [], []
    for p in pools or []:
        seal_type = normalize_seal_type(p.get("seal_type"))
        domain = (p.get("domain") or "").strip()
        wiki_url = (p.get("wiki_url") or "").strip()
        if seal_type is None:
            quarantined.append({"raw": p.get("seal_type"), "reason": "unrecognized seal type"})
            continue
        if not wiki_url:
            quarantined.append({"raw": seal_type, "reason": "missing wiki_url"})
            continue
        for opt in p.get("options") or []:
            name = (opt.get("name") or "").strip()
            stat = (opt.get("stat") or "").strip()
            bonus_type = (opt.get("bonus_type") or "").strip()
            unit = (opt.get("unit") or "flat").strip()
            value = opt.get("value")
            if not stat or not bonus_type:
                quarantined.append({"raw": f"{seal_type}: {opt}",
                                    "reason": "missing stat or bonus_type"})
                continue
            if bonus_type not in BONUS_TYPES:
                quarantined.append({"raw": f"{seal_type}: {stat} ({bonus_type})",
                                    "reason": "unrecognized bonus type"})
                continue
            if not isinstance(value, int):
                quarantined.append({"raw": f"{seal_type}/{name}",
                                    "reason": "missing magnitude"})
                continue
            records.append({
                "seal_type": seal_type, "domain": domain, "name": name,
                "stat": vocab.normalize_stat(stat), "bonus_type": bonus_type,
                "value": value, "unit": unit, "wiki_url": wiki_url,
            })
    return records, quarantined


def parse_seal(seed):
    """Parse a ``seal`` seed dict into structured records + coverage."""
    seed = seed or {}
    records, quarantined = parse_pools(seed.get("pools"))
    by_seal = {}
    for r in records:
        by_seal[r["seal_type"]] = by_seal.get(r["seal_type"], 0) + 1
    # Seal types present in the seed but with zero eligible options — pending harvest.
    seeded_types = {normalize_seal_type(p.get("seal_type")) for p in seed.get("pools") or []}
    seeded_types.discard(None)
    pending = sorted(t for t in seeded_types if by_seal.get(t, 0) == 0)
    coverage = {
        "seal_types_sourced": sorted(by_seal),
        "seal_types_pending": pending,
        "options_eligible": len(records),
        "options_quarantined": len(quarantined),
        "quarantined": quarantined,
        "by_seal": by_seal,
        "item_hosts": "resolved from a Sealed-in-X marker on gear-planner items "
                      "(crafting[] for Undeath/Mist/Gloom, affixes[] Bool for Fire)",
        "note": "single-pick choice-slot: one option per seal slot, mutually "
                "exclusive (adding another replaces the original). Undeath pool "
                "sourced from the Ritual Table; Fire/Gloom/Mist pending harvest.",
    }
    return {"records": records, "quarantined": quarantined, "coverage": coverage}
