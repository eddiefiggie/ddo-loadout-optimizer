"""U3 — Isle of Dread Dino-crafting integration into the dataset.

Turns the parsed ``dino_crafting`` seed (src/dino_parser.py) into the pieces the
solver consumes, mirroring how augments enter the model:

* **Blank host variants** — the customizable Dinosaur Bone hosts (accessories,
  armor, weapon, rune arm). Each is an equippable worn variant carrying typed
  Dino slots (``dino_slots_norm`` as ``type||category`` keys — KTD1) but no base
  affixes; its value comes entirely from the inserts placed in it. Blanks are
  pre-verified hosts (an empty affix list must NOT quarantine them the way
  src/verify.py would), so they are appended to the dataset after verification.
* **A Dino insert pool** — the parsed insert **units** (KTD4: one unit may carry
  several affixes) the solver places into matching ``(dino_type, category)``
  slots, exactly like the augment pool.
* **Dino Set-Bonus records** — the crafted-set definitions (activation deferred;
  see the coverage disclosure).

Host-slot routing (KTD3). Accessory blanks map to their worn slot; an armor
blank competes in **Armor**; a weapon blank in **Main Hand** (category
``weapon``); a rune-arm blank in **Rune Arm**. Shields/orbs have no Off Hand slot
in the solver model, so their blanks are disclosed-deferred rather than dropped.
"""
from __future__ import annotations

from src import dino_parser
from src import crafting_catalog

# The four Dino bone types and the three gear categories whose native
# ``<Type> (<Category>)`` menu pools feed the insert option pool (U4b-ii). The
# specialized ``(quarterstaff)`` / ``(artifact)`` variant pools are out of scope
# (no blank host slot references them).
_DINO_TYPES = ("Claw", "Fang", "Horn", "Scale")
_DINO_CATEGORIES = ("Accessory", "Armor", "Weapon")


def _native_insert_records(catalog):
    """Source the Dino insert UNITS from ``gearplanner_crafting.json`` via
    ``crafting_catalog`` (the ``<Type> (<Category>)`` menu pools). Each native
    option becomes ONE placeable unit carrying its affix list (multi-affix kept
    all-or-nothing — KTD4). The strict parser gate is REMOVED, not swapped (F1):
    native affixes flow through verbatim via ``legacy_affix``. Blank host BODIES
    are NOT touched here — they stay generated from the seed (dino_parser)."""
    records = []
    for dino_type in _DINO_TYPES:
        for category in _DINO_CATEGORIES:
            key = f"{dino_type} ({category})"
            if key not in catalog:
                continue  # not every (type, category) pool exists (e.g. Claw Armor)
            for opt in crafting_catalog.menu_options(key, catalog):
                affixes = [crafting_catalog.legacy_affix(a)
                           for a in crafting_catalog.iter_affixes(opt)]
                if not affixes:
                    continue
                unit = {
                    "category": category,
                    "dino_type": dino_type,
                    "affixes": affixes,
                    "wiki_url": "",
                }
                if opt.get("name"):
                    unit["name"] = opt["name"]
                records.append(unit)
    return records

# Dinosaur Bone accessory blanks map onto these worn slots (model.js WORN_SLOTS).
_ACCESSORY_WORN = {"Belt", "Boots", "Bracers", "Gloves", "Necklace", "Ring",
                   "Helmet", "Cloak"}
_ARMOR_NAMES = {"Robe", "Outfit", "Docent", "Light Armor", "Medium Armor", "Heavy Armor"}
_RUNEARM_NAMES = {"Runearm", "Rune Arm"}
_DINO_ML = 31  # Dino crafting is a Legendary (ML31) system.


def _resolve_host(item_name):
    """Map a blank host's item name to ``(worn_slot, category)`` or ``(None, None)``.

    ``category`` is the solver routing category: ``"item"`` for worn slots,
    ``"weapon"`` for Main Hand, ``"runearm"`` for Rune Arm. Shields/orbs return
    ``(None, None)`` — the solver has no Off Hand slot, so they are deferred.
    """
    name = (item_name or "").strip()
    if not name:
        return None, None
    last = name.split()[-1]
    if last in _ACCESSORY_WORN:
        return last, "item"
    if name in _ARMOR_NAMES or last in {"Armor", "Robe", "Outfit", "Docent"}:
        return "Armor", "item"
    if name in _RUNEARM_NAMES or last == "Runearm":
        return "Rune Arm", "runearm"
    if name == "Weapons" or last in {"Weapon", "Weapons"}:
        return "Main Hand", "weapon"
    return None, None


def _blank_name(worn_slot):
    """A clean, unique blank-host display name for a worn slot."""
    label = "Weapon" if worn_slot == "Main Hand" else worn_slot
    return f"Dinosaur Bone {label}"


def _blank_variant(layout):
    """A pre-verified worn host variant for one Dinosaur Bone blank, or None."""
    worn_slot, category = _resolve_host(layout["item"])
    if worn_slot is None:
        return None
    name = _blank_name(worn_slot)
    return {
        "name": name,
        "item": name,
        "variant_id": name,   # results.js renders v.variant_id
        "source_item": name,
        "slot": worn_slot,
        "category": category,
        # Pre-verified: a blank hosts Dino slots, so it is solver-eligible even
        # with zero base affixes (verify.py would otherwise quarantine it).
        "verification": "verified",
        "eligible_affix_count": 0,
        "verification_reasons": [],
        "affixes": [],
        "scaling": [],
        "flagged": [],
        "set_bonus": [],
        "augment_slots": [],
        "dino_slots_norm": list(layout["dino_slots"]),
        "dino_set_bonus_slot": bool(layout.get("set_bonus_slot")),
        "minimum_level": _DINO_ML,
        "wiki_url": layout["wiki_url"],
        "source": "dino_crafting_blank",
    }


def build_dino(seed, catalog=None):
    """Parse a dino_crafting seed into (blank_variants, insert_records, set_records, coverage).

    U4b-ii — SPLIT SOURCING:
      * Blank host BODIES and Dino Set-Bonus records still come from the SEED
        (dino_parser): the 8 synthetic Dinosaur-Bone blank bodies are generated
        post-expansion and excluded via ``exclude_names`` in build_dataset — that
        pattern is PRESERVED; the blank identity derives from which items carry
        the Claw/Fang/Horn/Scale markers, not a crafting.json pool.
      * The insert OPTION POOL is now sourced NATIVELY from
        ``gearplanner_crafting.json`` (the ``<Type> (<Category>)`` menu pools),
        replacing the legacy seed's hand-parsed inserts.

    Blank hosts are deduped by worn slot (many named host items collapse to one
    equippable slot — six armor types -> one Armor blank), keeping the richest
    slot layout. ``coverage`` carries the blank/set counts plus the native insert
    counts and the Dino Set-Bonus disclosure.
    """
    catalog = crafting_catalog.load_catalog() if catalog is None else catalog
    parsed = dino_parser.parse_dino_crafting(seed or {})
    by_slot = {}          # worn_slot -> best blank variant
    deferred = {}         # worn-slot-less hosts, deduped by reason
    for layout in parsed["slot_layouts"]:
        b = _blank_variant(layout)
        if b is None:
            deferred[layout["item"]] = {
                "raw": layout["item"],
                "reason": "no solver slot (shield/orb Off Hand not modeled)",
            }
            continue
        prev = by_slot.get(b["slot"])
        # Prefer the richer layout (more typed Dino slots); a set-bonus slot wins ties.
        if (prev is None
                or len(b["dino_slots_norm"]) > len(prev["dino_slots_norm"])
                or (len(b["dino_slots_norm"]) == len(prev["dino_slots_norm"])
                    and b["dino_set_bonus_slot"] and not prev["dino_set_bonus_slot"])):
            by_slot[b["slot"]] = b
    blanks = list(by_slot.values())

    # Insert option pool: NATIVE (gearplanner_crafting.json), not the seed's inserts.
    insert_records = _native_insert_records(catalog)

    coverage = dict(parsed["coverage"])
    # Override the seed-derived insert counts with the native pool's reality.
    coverage["inserts_eligible"] = len(insert_records)
    coverage["inserts_quarantined"] = 0
    coverage["insert_source"] = "gearplanner_crafting.json: <Type> (<Category>) menus"
    coverage["by_type"] = {t: sum(1 for r in insert_records if r["dino_type"] == t)
                           for t in _DINO_TYPES}
    _by_key = {}
    for r in insert_records:
        k = f"{r['dino_type']}||{r['category']}"
        _by_key[k] = _by_key.get(k, 0) + 1
    coverage["by_key"] = dict(sorted(_by_key.items()))
    coverage["blank_hosts"] = len(blanks)
    coverage["blank_hosts_by_slot"] = {b["slot"]: len(b["dino_slots_norm"]) for b in blanks}
    coverage["set_bonus_hosts"] = sorted(b["slot"] for b in blanks if b["dino_set_bonus_slot"])
    coverage["blanks_deferred"] = list(deferred.values())
    coverage["quarantined"] = parsed["quarantined"]
    coverage["set_records"] = parsed["set_records"]
    coverage["set_bonus_status"] = (
        "sourced + browsable; solver activation DEFERRED — Dino Set-Bonus is a "
        "crafted set-membership choice-slot (only Armor/Helmet/Cloak carry a "
        "set-bonus slot), so completion needs intrinsic named/raid set pieces "
        "(IoD named-gear sweep). Not yet fed to the set-threshold solver."
    )
    meta = (seed or {}).get("metadata", {})
    coverage["system"] = meta.get("system", "Isle of Dread — Dino crafting")
    coverage["sourcing_status"] = meta.get("sourcing_status", "")
    return blanks, insert_records, parsed["set_records"], coverage
