"""Chosen-set-membership set definitions (Vecna Unleashed / Cannith Repurposing
Station). Loads data/seed/vecna_sets.json and produces the runtime
`membership_set_defs` map the JS solver self-seeds its thresholds from:

    {set_name: {tiers: [{pieces_required, pieces_label, affixes, wiki_url}],
                ml, tier, wiki_url}}

Unlike an intrinsic set (baked onto member items), an awaken-only set has no
equipped member to register its threshold, so the solver reads the tier
definition from this exported table instead (plan KTD4). Each set's piece_bonuses
free text runs through the SAME strict src/set_parser.py path as intrinsic sets,
then umbrella-expands 'all Ability Scores' into the six abilities so single-ability
targets are credited. Nothing is inferred; a tier with no numeric threshold or no
parseable affix is dropped, never guessed.
"""
import json
import os

from src.set_parser import parse_set_bonuses
from src import umbrella

SEED_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "seed", "vecna_sets.json")


def load_seed(path: str = SEED_PATH) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def build_membership_set_defs(seed: dict) -> dict:
    """seed -> {set_name: {tiers, ml, tier, wiki_url}} with umbrella-expanded affixes."""
    out = {}
    for name, spec in (seed.get("sets") or {}).items():
        set_bonus_list = [{
            "set": name,
            "piece_bonuses": spec.get("piece_bonuses", {}),
            "wiki_url": spec.get("wiki_url"),
        }]
        kept = []
        for tier in parse_set_bonuses(set_bonus_list):
            if tier["pieces_required"] is None or not tier["affixes"]:
                continue  # strict: no threshold or no parseable value -> drop, never guess
            kept.append({
                "pieces_required": tier["pieces_required"],
                "pieces_label": tier["pieces_label"],
                "affixes": umbrella.expand_affixes(tier["affixes"]),
                "wiki_url": tier.get("wiki_url"),
            })
        if kept:
            out[name] = {
                "tiers": kept,
                "ml": spec.get("ml"),
                "tier": spec.get("tier"),
                "wiki_url": spec.get("wiki_url"),
            }
    return out


def coverage(defs: dict) -> dict:
    return {
        "sets": len(defs),
        "tiers": sum(len(d["tiers"]) for d in defs.values()),
        "affixes": sum(len(t["affixes"]) for d in defs.values() for t in d["tiers"]),
    }
