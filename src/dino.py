"""U3 — Isle of Dread Dino-crafting integration into the dataset.

Turns the parsed ``dino_crafting`` seed (src/dino_parser.py) into two things the
solver consumes, mirroring how augments enter the model:

* **Blank host variants** — the customizable Dinosaur Bone accessory blanks
  (Belt/Boots/Bracers/Gloves/Necklace/Ring/Helmet/Cloak). Each is an equippable
  worn variant carrying typed Dino slots (``dino_slots_norm``) but no base
  affixes; its value comes entirely from the inserts placed in it. Blanks are
  pre-verified hosts (an empty affix list must NOT quarantine them the way
  src/verify.py would), so they are appended to the dataset after verification.
* **A Dino insert pool** — the parsed ``(dino_type, stat, bonus_type, value)``
  records the solver places into open typed slots, exactly like the augment pool.

Within this Accessory slice the plain Scale/Fang/Claw/Horn type is unambiguous
(one variant), so the variant-namespaced ``(variant, type)`` typing the wiki uses
for weapons/armors is deferred follow-up (see the seed's sourcing_status).
"""
from __future__ import annotations

from src import dino_parser

# Dinosaur Bone accessory blanks map onto these worn slots (model.js WORN_SLOTS).
_ACCESSORY_WORN = {"Belt", "Boots", "Bracers", "Gloves", "Necklace", "Ring",
                   "Helmet", "Cloak"}
_DINO_ML = 31  # Dino crafting is a Legendary (ML31) system.


def _worn_slot(item_name):
    """Map a blank's item name to its worn slot, or None if it isn't one."""
    last = (item_name or "").split()[-1] if item_name else ""
    return last if last in _ACCESSORY_WORN else None


def _blank_variant(layout):
    """A pre-verified worn host variant for one Dinosaur Bone blank, or None."""
    slot = _worn_slot(layout["item"])
    if slot is None:
        return None
    return {
        "name": layout["item"],
        "item": layout["item"],
        "variant_id": layout["item"],   # results.js renders v.variant_id
        "source_item": layout["item"],
        "slot": slot,
        "category": "item",
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
        "minimum_level": _DINO_ML,
        "wiki_url": layout["wiki_url"],
        "source": "dino_crafting_blank",
    }


def build_dino(seed):
    """Parse a dino_crafting seed into (blank_variants, insert_records, coverage).

    ``coverage`` carries the parser's per-type counts plus the quarantine list
    and the count of blank hosts materialized, for the results-view disclosure.
    """
    parsed = dino_parser.parse_dino_crafting(seed or {})
    blanks = [b for b in (_blank_variant(l) for l in parsed["slot_layouts"]) if b]
    coverage = dict(parsed["coverage"])
    coverage["blank_hosts"] = len(blanks)
    coverage["quarantined"] = parsed["quarantined"]
    coverage["system"] = (seed or {}).get("metadata", {}).get("system", "Isle of Dread — Dino crafting")
    coverage["sourcing_status"] = (seed or {}).get("metadata", {}).get("sourcing_status", "")
    return blanks, parsed["insert_records"], coverage
