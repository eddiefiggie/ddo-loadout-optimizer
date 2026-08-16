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
import json
import os

from src.set_parser import parse_set_bonuses
from src.affix_parser import BONUS_TYPES
from src import umbrella
from src import set_catalog
from src import crafting_catalog

HERE = os.path.dirname(os.path.abspath(__file__))
STATION = "Cannith Repurposing Station"
DINO_STATION = "Dinosaur Bone crafting"

# --- Augment Sets (21 "Set Augment: X" Colorless augments) -----------------
# A DISTINCT system from Vecna/Dino chosen-membership: slotting 3 COPIES of the
# same Set Augment across 3 items fires its single 3-piece Set Bonus (one tier
# only, always 3 Pieces Equipped). The defs are seeded from wiki evidence in
# data/seed/compendium/augment_sets.json with the bonus PRE-TYPED as
# {stat, bonus_type, value} affixes (the wiki text is already parsed there), so
# they build into the SAME def shape build_membership_set_defs emits and share
# the same bonus-type vocabulary (affix_parser.BONUS_TYPES) and umbrella
# expansion the intrinsic/membership sets use. This unit is data + defs only;
# the solver wiring (bounded 0..3 duplicate placement, host-set suppression) is
# a later unit.
AUGMENT_SETS_PATH = os.path.join(HERE, "..", "data", "seed", "compendium", "augment_sets.json")
# The catalog's explicit "no special bonus type" markers (mirrors set_catalog._clause):
# an affix carrying one of these is untyped, not invalid.
_UNTYPED_MARKERS = {None, "", "Untyped", "Enhancement"}

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

# The Vecna Unleashed "Lost Purpose" set-membership pool is now sourced NATIVELY
# (U4b-ii) from the gear-planner crafting catalog: the ``Lost Purpose`` (Heroic)
# and ``Legendary Lost Purpose`` menu pools list the set names an awakened Lost
# Purpose item can join. Each option's native ``set`` field IS the set name; the
# set DEFINITIONS still come from the gear-planner set catalog (single source of
# truth). Lost Purpose items awaken one of these at the Cannith Repurposing
# Station. Forbidden Knowledge also has intrinsic raid members; the others are
# Lost-Purpose-only (wiki-confirmed).
_LOST_PURPOSE_KEY = {"heroic": "Lost Purpose", "legendary": "Legendary Lost Purpose"}
_VECNA_NAME_CACHE = {}  # tier -> [set names], memoized off the native catalog


def _tier_of(name: str) -> str:
    return "legendary" if name.startswith("Legendary ") else "heroic"


def set_names_for_tier(tier: str, catalog: dict = None) -> list:
    """The Vecna set names of a tier ('heroic'|'legendary'), sourced from the
    native ``(Legendary )Lost Purpose`` crafting menu pool. Deterministic
    (native pool order). Memoized when reading the default catalog."""
    if catalog is None and tier in _VECNA_NAME_CACHE:
        return list(_VECNA_NAME_CACHE[tier])
    cat = catalog if catalog is not None else crafting_catalog.load_catalog()
    names = [o.get("set") for o in crafting_catalog.menu_options(_LOST_PURPOSE_KEY[tier], cat)
             if o.get("set")]
    if catalog is None:
        _VECNA_NAME_CACHE[tier] = list(names)
    return names


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


def _augment_affix(a: dict):
    """Validate ONE pre-typed augment-set affix `{stat, bonus_type, value, unit}`.

    Strict (exclude-until-verified, KTD5): a real magnitude only — non-empty stat,
    an integer value, and a bonus type that is either a known DDO type
    (affix_parser.BONUS_TYPES) or one of the explicit untyped markers. Anything
    else returns None (the affix is dropped, never minted/defaulted). An untyped
    marker canonicalizes to "Untyped" so the affix carries a valid stacking type.
    """
    stat = (a.get("stat") or "").strip()
    bt = a.get("bonus_type")
    val = a.get("value")
    if not stat:
        return None
    if isinstance(val, bool) or not isinstance(val, int):
        return None
    if bt in _UNTYPED_MARKERS:
        bt = "Untyped"
    elif bt not in BONUS_TYPES:
        return None
    return {"stat": stat, "bonus_type": bt, "value": val, "unit": a.get("unit") or "flat"}


def build_augment_set_defs(path: str = None, raw: dict = None) -> dict:
    """Build the 21 Augment-Set defs into the SAME shape build_membership_set_defs
    emits: {set_name: {tiers: [{pieces_required, pieces_label, affixes, wiki_url}],
    tier, wiki_url}} with umbrella-expanded affixes.

    Each seeded set is single-tier (pieces_required 3). A set whose affixes ALL
    fail validation (no real typed magnitude survives) is EXCLUDED entirely —
    never emitted as an empty/defaulted def — so it can't credit a phantom bonus.
    `raw`/`path` allow injecting a doc for testing; default reads the seed file.
    """
    if raw is None:
        p = path or AUGMENT_SETS_PATH
        with open(p, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
    sets = raw.get("sets", raw)
    default_url = (raw.get("_meta") or {}).get("wiki_url")
    out = {}
    for name, spec in sets.items():
        if name.startswith("_") or not isinstance(spec, dict):
            continue
        pr = spec.get("pieces_required")
        if not isinstance(pr, int) or isinstance(pr, bool) or pr < 1:
            continue
        affixes = [va for va in (_augment_affix(a) for a in spec.get("affixes") or []) if va]
        affixes = umbrella.expand_affixes(affixes)
        if not affixes:
            continue  # no verifiable typed bonus -> exclude, don't default
        wiki = spec.get("wiki_url") or default_url
        out[name] = {
            "tiers": [{
                "pieces_required": pr,
                "pieces_label": f"{pr} Pieces Equipped",
                "affixes": affixes,
                "wiki_url": wiki,
            }],
            "tier": "augment",
            "wiki_url": wiki,
        }
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
    is not both a Lost Purpose item and a Dinosaur Bone blank).

    KTD3 (#334): a set the host already carries INTRINSICALLY (its `set_bonus` /
    `sets` — every Dinosaur Bone blank carries The Legendary Dread Isle's Curse)
    is filtered out of the pool. The solver's single-identity constraint covers
    membership picks and hosted set-augment copies, not the intrinsic piece, so
    leaving the intrinsic set in the pool would let one equipped item count as
    two pieces of the same set. If a wiki ruling ever shows the in-game Set
    Bonus augment double-counts on an already-cursed item, revisit deliberately."""
    n = 0
    for v in variants:
        if not v.get("dino_set_bonus_slot") or v.get("set_membership_slot"):
            continue
        intrinsic = {s.get("set") for s in v.get("set_bonus") or []}
        intrinsic.update(v.get("sets") or [])
        pool = [name for name in dino_pool(defs) if name not in intrinsic]
        v["set_membership_slot"] = {"pool": pool, "station": DINO_STATION}
        n += 1
    return n


def coverage(defs: dict) -> dict:
    return {
        "sets": len(defs),
        "tiers": sum(len(d["tiers"]) for d in defs.values()),
        "affixes": sum(len(t["affixes"]) for d in defs.values() for t in d["tiers"]),
    }
