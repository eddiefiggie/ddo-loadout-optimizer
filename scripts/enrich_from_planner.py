#!/usr/bin/env python3
"""Enrich named gear from the community DDO gear-planner dataset (bulk, strict).

Source: illusionistpm/ddo-gear-planner `site/src/assets/items.json` (itself
ddowiki-parsed), committed at data/seed/compendium/raw/gearplanner_items.json.
Far more token-efficient than per-item wiki harvest: each item already carries
parsed affixes {name, type, value}. We convert those to affix STRINGS and run
them through THIS repo's strict `affix_parser` (via the normal variant pipeline),
so provenance and eligibility are still decided by our own parser — the planner
supplies the tuples, not the trusted values. Bool procs and base weapon/armor
enhancement bonuses are dropped (non-ranked). Crafting slots (Dino/Viktranium)
are NOT taken from here — those were sourced directly from the wiki.

Usage: python3 scripts/enrich_from_planner.py <expansion> where expansion is one
of the QUEST_MAP keys. Filters to endgame ML and excludes items already modeled
(Dinosaur Bone blanks) or already enriched from the wiki batches.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import seal  # noqa: E402  seal-slot host detection

SRC = os.path.join(ROOT, "data", "seed", "compendium", "raw", "gearplanner_items.json")

QUEST_MAP = {
    "iod": ["The Isle of Dread", "Dinosaur Crisis", "Isle of Dread (wilderness)"],
    "u81": ["Terror of Demogorgon", "The Underdark", "Underdark Arena: Ring of Fire"],
    "mythdrannor": ["Ruins of Myth Drannor", "Magic of Myth Drannor"],
    "lamordia": ["Land of Lamordia", "Viktranium Experiment crafting"],
    # "Threats Old and New" raid drops the Undying Age "Reflections" gear that
    # carries the Sealed-in-X enchantments; its items are absent from every wiki
    # batch, so without this key the seal hosts never enter the pipeline.
    "undyingage": ["Threats Old and New"],
}
MIN_ML = 1  # all levels (full-import; was 29 for endgame-only)
# planner slot vocabulary -> this repo's solver slot names (model.js WORN_SLOTS
# + Main Hand / Rune Arm). Any planner slot NOT normalized here that also isn't a
# WORN_SLOT would land an item outside every solver slot and silently drop it, so
# every divergent name must be mapped: the planner uses "Helm" (we use "Helmet")
# and "Offhand" (we use "Off Hand").
SLOT_FIX = {"Offhand": "Off Hand", "Helm": "Helmet"}
# Slots the solver actually places into (worn + weapon/rune-arm via category);
# used to fail loudly if the planner introduces an unmapped slot vocabulary.
SOLVER_SLOTS = {
    "Armor", "Helmet", "Goggles", "Necklace", "Trinket", "Cloak", "Belt", "Ring",
    "Gloves", "Boots", "Bracers", "Quiver", "Weapon", "Off Hand", "Rune Arm",
}
ARMOR_ML_TYPE = {"Cloth": "cloth", "Light": "light", "Medium": "medium", "Heavy": "heavy"}


def affix_to_string(a):
    """Convert a planner affix {name,type,value} to an affix string our parser
    reads, or None to drop it (proc/base-bonus)."""
    name = (a.get("name") or "").strip()
    t = a.get("type")
    v = a.get("value")
    if t == "Bool":
        return None  # a proc/flag (value 1), not a magnitude
    if name.startswith("Enhancement Bonus"):
        return None  # base weapon/armor bonus — not a ranked stat (as in wiki batches)
    try:
        int(str(v))
    except (TypeError, ValueError):
        return None  # non-numeric magnitude -> drop (strict)
    # "Insightful Constitution +7" shape: leading bonus-type word, then stat, then value.
    if t and t not in ("Enhancement", None):
        return f"{t} {name} +{v}"
    return f"{name} +{v}"


def build_record(it):
    slot = SLOT_FIX.get(it.get("slot"), it.get("slot"))
    enh = []
    for a in it.get("affixes", []):
        s = affix_to_string(a)
        if s:
            enh.append(s)
    aug = []
    for c in it.get("crafting", []) or []:
        if c.endswith("Augment Slot"):
            enh.append(c)
            aug.append(c.replace(" Augment Slot", ""))
    # Set membership: the gear-planner records it in a `sets` field. Emit the same
    # "X (set)" marker enrich.py uses so build_dataset can attach the set_bonus (U3).
    for s in it.get("sets", []) or []:
        enh.append(f"{s} (set)")
    # Seal-slot hosts. A "Sealed in X" enchantment is a single-pick choice-slot
    # (src/seal.py). The gear-planner encodes it in TWO places: Undeath/Mist/Gloom
    # as `crafting[]` entries, Fire/Amber as `affixes[]` {type:"Bool"} markers
    # (which affix_to_string drops). Detect both; the pool is keyed by seal_type.
    # Dedup by (seal_type, category): a seal redundantly encoded in BOTH the
    # affixes[] Bool marker and a crafting[] string must yield ONE slot, or the
    # solver's per-slot single-pick would let the item unseal the same seal twice
    # (an in-game-impossible loadout). Distinct seal types stay distinct slots.
    seal_slots, _seen_seals = [], set()

    def _add_seal(st):
        if st and (st, slot) not in _seen_seals:
            _seen_seals.add((st, slot))
            seal_slots.append({"seal_type": st, "category": slot})

    for a in it.get("affixes", []):
        if a.get("type") == "Bool":
            _add_seal(seal.normalize_seal_type(a.get("name")))
    for c in it.get("crafting", []) or []:
        _add_seal(seal.normalize_seal_type(c))
    rec = {
        "name": it["name"], "category": "item", "slot": slot,
        "enhancements": enh, "augment_slots": aug,
        "minimum_level": it.get("ml"),
        "wiki_url": "https://ddowiki.com" + (it.get("url") or ""),
        "_enriched": True, "_source": "gear-planner",
    }
    if seal_slots:
        rec["seal_slots"] = seal_slots
    # weapon / rune-arm solver routing (mirrors the wiki batches)
    ptype = (it.get("type") or "")
    if slot == "Weapon":
        rec["category"] = "weapon"
    elif slot == "Runearm" or ptype == "Runearms":
        rec["category"] = "runearm"
        rec["slot"] = "Rune Arm"
    return rec


def _solver_active_names():
    """Names already solver-active in the *built* dataset — the KTD6-safe skip set.
    Spans every pipeline (base seed, wiki batches, R4, and host blanks like Dino /
    Viktranium / Nearly Complete / seal that never appear in enriched_*.json), so a
    planner item that merely re-states one of them is skipped, never double-listed.
    Requires web/data/items.json built WITHOUT the bulk planner shard (remove
    enriched_planner_ml29.json and rebuild before regenerating)."""
    ds = os.path.join(ROOT, "web", "data", "items.json")
    names = set()
    if os.path.exists(ds):
        for it in json.load(open(ds, encoding="utf-8")).get("items", []):
            names.add(it.get("source_item") or it.get("variant_id") or it.get("name"))
    names.discard(None)
    return names


def main_all():
    """Import EVERY gear-planner item (all MLs; MIN_ML) (all slots), deduped against the built
    dataset, into one bulk shard. Weapons/rune-arms route to the solver; worn gear
    is solver-active; Off Hand items enter browse-only (no solver slot yet)."""
    data = json.load(open(SRC, encoding="utf-8"))
    skip = _solver_active_names()
    # Idempotent re-run: the built dataset may already include THIS import's prior
    # output. Subtract those names so we don't self-exclude (the whole point of a
    # re-import is to regenerate them). Only names unique to our shard are removed.
    outpath = os.path.join(ROOT, "data", "seed", "compendium", "enriched_planner_ml29.json")
    if os.path.exists(outpath):
        for it in json.load(open(outpath, encoding="utf-8")).get("items", []):
            if not it.get("_seal_carrier"):
                skip.discard(it.get("name"))
    picked, carriers, unmapped_slots, dropped_no_affix = [], [], set(), 0
    for it in data:
        if (it.get("ml") or 0) < MIN_ML:
            continue
        if it["name"].startswith("Dinosaur Bone"):
            continue  # modeled via the Dino crafting pipeline
        if it["name"] in skip:
            # Already solver-active from another pipeline. Skip its body, but if the
            # planner records a "Sealed in X" slot the active version may lack, emit a
            # seal-carrier stub so build_dataset can graft the seal onto the winner.
            rec = build_record(it)
            if rec.get("seal_slots"):
                carriers.append({"name": rec["name"], "slot": rec["slot"],
                                 "seal_slots": rec["seal_slots"], "_seal_carrier": True,
                                 "_source": "gear-planner"})
            continue
        rec = build_record(it)
        if rec["slot"] not in SOLVER_SLOTS and rec["category"] not in ("weapon", "runearm"):
            unmapped_slots.add(rec["slot"])
        if rec.get("seal_slots") or any(not e.endswith("Augment Slot") for e in rec["enhancements"]):
            picked.append(rec)
        else:
            dropped_no_affix += 1  # augment-slots-only after strict conversion
    # Dedup within the import (planner has ML-variant rows sharing a name).
    seen, deduped = set(), []
    for r in picked:
        if r["name"] in seen:
            continue
        seen.add(r["name"])
        deduped.append(r)
    picked = deduped

    out = {
        "metadata": {
            "layer": "enriched", "batch": "planner_ml29",
            "system": "all-levels named gear (gear-planner bulk import, strict re-parse)",
            "source": "illusionistpm/ddo-gear-planner items.json (ddowiki-derived)",
            "harvested": "2026-07-27", "count": len(picked), "seal_carriers": len(carriers),
        },
        "items": picked + carriers,
    }
    outpath = os.path.join(ROOT, "data", "seed", "compendium", "enriched_planner_ml29.json")
    json.dump(out, open(outpath, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    from collections import Counter
    by_slot = Counter(r["slot"] if r["category"] not in ("weapon", "runearm") else r["category"].title() for r in picked)
    seal_hosts = sum(1 for r in picked if r.get("seal_slots"))
    print(f"wrote {len(picked)} planner items (all MLs) ({seal_hosts} seal hosts, "
          f"{dropped_no_affix} dropped as augment/proc-only) -> {os.path.relpath(outpath, ROOT)}")
    print("  by slot:", dict(by_slot.most_common()))
    if unmapped_slots:
        print("  WARNING unmapped slots (won't reach solver):", unmapped_slots, file=sys.stderr)


def main(expansion):
    if expansion == "all":
        return main_all()
    quests = QUEST_MAP[expansion]
    data = json.load(open(SRC, encoding="utf-8"))
    # already enriched from wiki batches -> skip to avoid duplicate work
    # Skip-set = names already enriched from the WIKI batches only. Crucially it
    # must NOT include this importer's own planner outputs (batch14_*_planner) —
    # otherwise a re-run reads its previous output as "already done" and writes an
    # empty file (self-exclusion). Only the authoritative wiki batches gate here.
    already = set()
    cdir = os.path.join(ROOT, "data", "seed", "compendium")
    for f in os.listdir(cdir):
        if not (f.startswith("enriched_batch") and f.endswith(".json")):
            continue
        if "planner" in f:
            continue  # our own output — never self-exclude
        for it in json.load(open(os.path.join(cdir, f)))["items"]:
            already.add(it["name"])
    picked = []
    for it in data:
        if not (set(it.get("quests") or []) & set(quests)):
            continue
        if (it.get("ml") or 0) < MIN_ML:
            continue
        if it["name"].startswith("Dinosaur Bone"):
            continue  # modeled via the Dino crafting pipeline
        if it["name"] in already:
            continue  # already sourced from the wiki
        rec = build_record(it)
        # Fail loudly on an unmapped slot rather than silently dropping the item
        # from the solver (the WORN_SLOTS mismatch class — see SLOT_FIX).
        if rec["slot"] not in SOLVER_SLOTS and rec["category"] not in ("weapon", "runearm"):
            print(f"  WARNING unmapped slot {rec['slot']!r} for {rec['name']!r} — "
                  f"add it to SLOT_FIX or it will not reach the solver", file=sys.stderr)
        if rec.get("seal_slots") or any(not e.endswith("Augment Slot") for e in rec["enhancements"]):
            picked.append(rec)

    out = {
        "metadata": {
            "layer": "enriched", "batch": f"batch14_{expansion}_planner",
            "system": f"{expansion} named gear (gear-planner import, strict re-parse)",
            "source": "illusionistpm/ddo-gear-planner items.json (ddowiki-derived)",
            "harvested": "2026-07-26", "count": len(picked),
        },
        "items": picked,
    }
    outpath = os.path.join(cdir, f"enriched_batch14_{expansion}_planner.json")
    json.dump(out, open(outpath, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    seal_hosts = sum(1 for r in picked if r.get("seal_slots"))
    print(f"wrote {len(picked)} {expansion} named items ({seal_hosts} seal hosts) "
          f"-> {os.path.relpath(outpath, ROOT)}")
    for r in picked:
        print(f"  {r['name']} [{r['slot']}]: {[e for e in r['enhancements'] if not e.endswith('Augment Slot')]}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "iod")
