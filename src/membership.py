"""Chosen-set-membership set definitions (Vecna Unleashed / Cannith Repurposing
Station). Produces the runtime `membership_set_defs` map the JS solver self-seeds
its thresholds from:

    {set_name: {tiers: [{pieces_required, pieces_label, affixes, wiki_url}],
                tier, wiki_url}}

SINGLE SOURCE OF TRUTH: the 11 Vecna sets are already defined in the gear-planner
set catalog (data/seed/compendium/raw/gearplanner_sets.json) — the same catalog
that feeds intrinsic set members (e.g. the Fire Over Morgrave raid weapons that
carry Forbidden Knowledge). Deriving the membership set defs from that catalog, rather
than a parallel hand-harvested file, guarantees a set gives identical bonuses (and
the same canonical stat vocabulary) whether it is completed by intrinsic members
or purely by awakened Lost Purpose items.

Each set's catalog piece_bonuses free text runs through the SAME strict
src/set_parser.py path as intrinsic sets, then umbrella-expands 'all Ability
Scores' into the six abilities. Nothing is inferred; a tier with no numeric
threshold or no parseable affix is dropped, never guessed.
"""
from src.set_parser import parse_set_bonuses
from src import umbrella
from src import set_catalog

STATION = "Cannith Repurposing Station"
DINO_STATION = "Dinosaur Bone crafting"

# The 6 Isle of Dread "Dino Set-Bonus" sets. A Dinosaur Bone Armor/Helmet/Cloak host
# with a Set-Bonus slot can be crafted to count toward ONE of these (chosen membership,
# same primitive as Vecna Lost Purpose). All 6 are defined in the gear-planner catalog,
# so they share the single-source-of-truth path. Completion mixes these crafted slots
# with intrinsic Isle of Dread named/raid members.
_DINO_SETS = [
    "Dread Stalker",
    "Devotion of the Firemouth",
    "Defender of Tanaroa",
    "Deacon of the Auricular Sacrarium",
    "Echoes of the Walking Ancestors",
    "The Legendary Dread Isle's Curse",
]

# The 11 Vecna Unleashed sets, base (Heroic, ML18) names. Each also has a
# "Legendary <name>" (ML32) variant. Lost Purpose items awaken one of these at the
# Cannith Repurposing Station. Forbidden Knowledge also has intrinsic raid members;
# the other 10 are Lost-Purpose-only (not found natively on any item — wiki-confirmed).
_VECNA_BASE = [
    "Forbidden Knowledge",
    "Armaments of the Archons",
    "Delight of the Devourer",
    "Devils' Infernal Dance",
    "The Fury's Rage",
    "Heart of Blades",
    "The Keeper's Coffin",
    "Minion of the Mockery",
    "The Shadow's Emptiness",
    "The Traveler's Guidance",
    "Vol's Influence",
]


def _tier_of(name: str) -> str:
    return "legendary" if name.startswith("Legendary ") else "heroic"


def set_names_for_tier(tier: str) -> list:
    """The 11 Vecna set names of a tier ('heroic'|'legendary'). Deterministic."""
    return [(f"Legendary {n}" if tier == "legendary" else n) for n in _VECNA_BASE]


def all_set_names() -> list:
    """Every set the chosen-membership primitive can grant: the 22 Vecna (Heroic +
    Legendary) plus the 6 Isle of Dread Dino sets."""
    return set_names_for_tier("heroic") + set_names_for_tier("legendary") + list(_DINO_SETS)


def dino_pool(defs: dict = None) -> list:
    """The Dino sets a Set-Bonus host can join; restricted to resolved defs when given."""
    if defs is None:
        return list(_DINO_SETS)
    return [n for n in _DINO_SETS if n in defs]


def build_membership_set_defs(catalog: dict = None) -> dict:
    """Build the membership set defs from the gear-planner set catalog (single source of
    truth). Returns {set_name: {tiers, tier, wiki_url}} with umbrella-expanded
    affixes, only for Vecna sets the catalog actually defines."""
    catalog = catalog if catalog is not None else set_catalog.load_catalog()
    out = {}
    for name in all_set_names():
        entry = catalog.get(set_catalog.canonical(name))
        sb = entry["set_bonus"] if entry else None
        if not sb:
            continue  # catalog has no usable def (every affix flagged) -> membership buys nothing
        kept = []
        for tier in parse_set_bonuses([sb]):
            if tier["pieces_required"] is None or not tier["affixes"]:
                continue
            kept.append({
                "pieces_required": tier["pieces_required"],
                "pieces_label": tier["pieces_label"],
                "affixes": umbrella.expand_affixes(tier["affixes"]),
                "wiki_url": tier.get("wiki_url"),
            })
        if kept:
            out[name] = {"tiers": kept, "tier": _tier_of(name), "wiki_url": sb.get("wiki_url")}
    return out


def pool_for_tier(tier: str, defs: dict = None) -> list:
    """The set names a Lost Purpose item of the given tier can awaken. When `defs`
    is provided, restrict to sets that resolved to a real def (so the pool never
    lists a set the solver can't value); otherwise return all 11 tier names."""
    names = set_names_for_tier(tier)
    if defs is None:
        return names
    return [n for n in names if n in defs]


def membership_slot_for(tier: str, defs: dict = None) -> dict:
    return {"pool": pool_for_tier(tier, defs), "station": STATION}


def attach_lost_purpose_slots(variants, defs: dict = None) -> int:
    """In place: every variant carrying a `lost_purpose` tier marker gets its
    set_membership_slot (pool of same-tier Vecna sets). Returns the count attached."""
    n = 0
    for v in variants:
        tier = v.get("lost_purpose")
        if tier not in ("heroic", "legendary"):
            continue
        v["set_membership_slot"] = membership_slot_for(tier, defs)
        n += 1
    return n


def attach_dino_set_bonus_slots(variants, defs: dict = None) -> int:
    """In place: every Dinosaur Bone host with a Set-Bonus slot (`dino_set_bonus_slot`,
    Armor/Helmet/Cloak only) gets a set_membership_slot over the 6 Dino sets, crafted
    at the Dinosaur Bone crafting station. Same primitive as Lost Purpose, different
    pool + station. A host that already carries a Vecna slot is left as-is (a real item
    is not both a Lost Purpose item and a Dinosaur Bone blank)."""
    n = 0
    for v in variants:
        if not v.get("dino_set_bonus_slot") or v.get("set_membership_slot"):
            continue
        v["set_membership_slot"] = {"pool": dino_pool(defs), "station": DINO_STATION}
        n += 1
    return n


def coverage(defs: dict) -> dict:
    return {
        "sets": len(defs),
        "tiers": sum(len(d["tiers"]) for d in defs.values()),
        "affixes": sum(len(t["affixes"]) for d in defs.values() for t in d["tiers"]),
    }
