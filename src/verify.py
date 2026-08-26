"""U4 — per-affix verification gate + coverage model.

Eligibility is per-affix (KTD5): any affix the parser resolved to a clean
`{stat, bonus_type, value}` (or a scaling record) is solver-eligible, and an
incidental value-less line does not disqualify the item. An item is
`quarantined` only when it contributes no solver-eligible affix at all; those
records stay in the dataset (for browse) but never feed the solver.
"""
from __future__ import annotations

from collections import defaultdict


def verify_variant(v: dict) -> dict:
    """Annotate a variant with per-affix eligibility and an item-level status."""
    for a in v["affixes"]:
        a["eligible"] = True
    eligible_count = len(v["affixes"]) + len(v["scaling"])
    v["eligible_affix_count"] = eligible_count
    # An item whose only worth is its open augment slots (e.g. the Legendary
    # Cataclysmic weapons: just Orange + Purple slots, no base affix) must not be
    # quarantined — its value is a non-affix dimension the solver fills, exactly
    # like a Dinosaur Bone blank. Admit it so its slots reach the augment MILP.
    aug_slots = (v.get("augment_slots_norm") or {}).get("colors") or []
    set_member = bool(v.get("parsed_set_bonuses"))
    # #338 — the Dinosaur Bone blanks now enter the pipeline BEFORE this gate
    # rather than being appended pre-verified after it, so the clause the
    # augment-slot comment above already named by analogy has to exist for real.
    # A blank ships an empty affix list by construction: its whole value is the
    # four typed Dino insert slots the solver fills. Seven of the eleven would
    # scrape through on `set_member` alone; the four that carry no intrinsic set
    # (Armor, Helmet, Cloak — the Set-Bonus hosts — and the Weapon blank) would
    # quarantine and leave the solve entirely.
    dino_slots = v.get("dino_slots_norm") or []
    if eligible_count > 0:
        v["verification"] = "verified"
        v["verification_reasons"] = []
    elif aug_slots:
        v["verification"] = "verified"
        v["verification_reasons"] = ["augment-slot host (no base affixes) — value is its open slots"]
    elif dino_slots:
        v["verification"] = "verified"
        v["verification_reasons"] = ["Dino crafting blank (no base affixes) — value is its open insert slots"]
    elif set_member:
        v["verification"] = "verified"
        v["verification_reasons"] = ["set-bonus piece (no base affixes) — value is its set-threshold contribution"]
    else:
        v["verification"] = "quarantined"
        v["verification_reasons"] = (
            [f.get("reason", "no parseable magnitude") for f in v["flagged"]]
            or ["no solver-eligible affixes"]
        )
    return v


def coverage(variants) -> dict:
    """Per-slot counts of verified vs quarantined variants, plus totals."""
    by_slot = defaultdict(lambda: {"verified": 0, "quarantined": 0})
    totals = {"verified": 0, "quarantined": 0}
    for v in variants:
        bucket = by_slot[v["slot"]]
        bucket[v["verification"]] += 1
        totals[v["verification"]] += 1
    return {"by_slot": dict(by_slot), "totals": totals,
            "variant_count": len(variants)}


def apply(variants) -> tuple:
    """Verify every variant and compute coverage. Returns (variants, coverage)."""
    verified = [verify_variant(v) for v in variants]
    return verified, coverage(verified)
