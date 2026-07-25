"""U1 — Isle of Dread "Dino crafting" parser (strict wiki provenance).

Dino crafting fills typed slots (Scale / Fang / Claw / Horn) on Dinosaur Bone
items with crafted inserts. Structurally it is the augment mechanic with a
different slot vocabulary, so this parser mirrors `set_parser` / `colors`: it
turns a dedicated, freshly-sourced seed (``data/seed/dino_crafting.json``) into
structured records and QUARANTINES anything it cannot verify.

Strict wiki provenance (KTD2). A record is solver-eligible only when it carries
  * a canonical Dino slot type (Scale/Fang/Claw/Horn),
  * a non-empty ``wiki_url``, and
  * an ``effect`` string that ``affix_parser.parse_line`` resolves to a clean
    ``(stat, bonus_type, value)``.
Insert effects are stored VERBATIM from the wiki and parsed here — values are
never hand-structured in the seed, so nothing is inferred. Ambiguous or
provenance-incomplete records are quarantined with a reason, never guessed.
"""
from __future__ import annotations

import re

from src.affix_parser import parse_line

# An insert carrying two or more magnitudes is a single augment granting multiple
# affixes (e.g. "Fang: Deception" = +11 Sneak Attacks AND +17 Sneak Attack
# Damage). The per-record placement model can't represent "both apply together
# from one slot", so such inserts are quarantined rather than modeled as
# independently placeable halves. Supporting them is deferred follow-up work.
_VALUE_TOKEN = re.compile(r"[+-]\s?\d+")


def _is_multi_affix(raw):
    """True when an effect string carries two or more distinct affix magnitudes.

    Two detectors, because the second magnitude may be value-first (signed) or
    value-last (unsigned): (1) more than one signed token; (2) comma-separated
    clauses that each contain a number. A compound single stat with one value
    ("+14 ... Critical Confirmation and Critical Damage") has no comma and one
    magnitude, so it is not caught.
    """
    text = raw or ""
    if len(_VALUE_TOKEN.findall(text)) > 1:
        return True
    numbered_clauses = [p for p in text.split(",") if re.search(r"\d", p)]
    return len(numbered_clauses) > 1

# The four Isle of Dread Dino slot types. A slot accepts only an insert of its
# own type (a Scale slot takes a Scale insert), exactly like a colored augment
# slot — see src/colors.py for the augment-color analogue.
DINO_TYPES = {"Scale", "Fang", "Claw", "Horn"}


def _canonical_type(raw):
    """Map a raw slot/insert type to a canonical Dino type, or None."""
    text = (raw or "").strip().capitalize()
    return text if text in DINO_TYPES else None


def parse_inserts(inserts):
    """Parse the insert pool into ``(records, quarantined)``.

    Each eligible record is ``{dino_type, stat, bonus_type, value, wiki_url,
    raw}``. Provenance is a first-class quarantine reason alongside an
    unparseable effect (KTD2).
    """
    records, quarantined = [], []
    for ins in inserts or []:
        raw = ins.get("effect")
        dino_type = _canonical_type(ins.get("type"))
        wiki_url = (ins.get("wiki_url") or "").strip()
        if dino_type is None:
            quarantined.append({"raw": ins.get("type"), "reason": "unrecognized dino type"})
            continue
        if not wiki_url:
            quarantined.append({"raw": raw, "reason": "missing wiki_url"})
            continue
        if _is_multi_affix(raw):
            quarantined.append({"raw": raw, "reason": "multi-affix insert (unsupported)"})
            continue
        r = parse_line(raw or "")
        if r["kind"] != "affix":
            quarantined.append({"raw": raw, "reason": r.get("reason") or f"non-affix ({r['kind']})"})
            continue
        for a in r["affixes"]:
            records.append({
                "dino_type": dino_type,
                "stat": a["stat"],
                "bonus_type": a["bonus_type"],
                "value": a["value"],
                "unit": a.get("unit", "flat"),
                "wiki_url": wiki_url,
                "raw": raw,
            })
    return records, quarantined


def parse_slot_layouts(items):
    """Parse per-item Dino slot layouts into ``(layouts, quarantined)``.

    Each layout is ``{item, slot, dino_slots: [type, ...], wiki_url}`` where
    ``dino_slots`` lists the typed open slots the item exposes (with
    multiplicity — an item offering two Scale slots lists ``Scale`` twice, so
    per-type capacity falls out of the data, not an assumption — KTD3). An item
    with no ``wiki_url`` is quarantined whole; a non-canonical slot type is
    dropped and quarantined.
    """
    layouts, quarantined = [], []
    for it in items or []:
        name = it.get("item")
        wiki_url = (it.get("wiki_url") or "").strip()
        if not wiki_url:
            quarantined.append({"raw": name, "reason": "missing wiki_url"})
            continue
        types = []
        for slot in it.get("dino_slots") or []:
            raw_type = slot.get("type") if isinstance(slot, dict) else slot
            t = _canonical_type(raw_type)
            if t is None:
                quarantined.append({"raw": name, "reason": f"unrecognized dino slot type: {raw_type!r}"})
            else:
                types.append(t)
        layouts.append({
            "item": name,
            "slot": it.get("slot"),
            "dino_slots": types,
            "wiki_url": wiki_url,
        })
    return layouts, quarantined


def parse_dino_crafting(seed):
    """Parse a ``dino_crafting`` seed dict into structured records + coverage.

    ``seed`` is ``{items: [...], inserts: [...]}``. Returns
    ``{slot_layouts, insert_records, quarantined: {inserts, items}, coverage}``.
    """
    seed = seed or {}
    layouts, item_q = parse_slot_layouts(seed.get("items"))
    records, insert_q = parse_inserts(seed.get("inserts"))
    coverage = {
        "items_sourced": len(layouts),
        "inserts_eligible": len(records),
        "inserts_quarantined": len(insert_q),
        "items_quarantined": len(item_q),
        "by_type": {t: sum(1 for r in records if r["dino_type"] == t) for t in sorted(DINO_TYPES)},
    }
    return {
        "slot_layouts": layouts,
        "insert_records": records,
        "quarantined": {"inserts": insert_q, "items": item_q},
        "coverage": coverage,
    }
