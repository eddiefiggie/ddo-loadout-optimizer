"""U3 — gear-planner raw-dump reader.

Reads `data/seed/compendium/raw/gearplanner_items.json` (the gear-planner catalog,
already the single source of truth for set bonuses) and maps each item onto a
pipeline record that carries **structured affixes** — `{stat, bonus_type, value,
unit}` taken straight from the dump's typed `affixes[]`. This is the whole point
of the refactor: gear-planner items skip the free-text `affix_parser` round-trip
(flatten → re-infer) that manufactured the garbage affix vocabulary.

Key mappings (the dump keeps these in *separate* keys, unlike the retired flattened
`enriched_planner_ml29.json` shard which crammed them into one string list):
  * `affixes[] {name,type,value}` -> `structured_affixes` (type via vocab.map_gearplanner_type)
  * `crafting[] "<Color> Augment Slot"` -> `augment_slots`
  * `sets[]` -> `enhancements ["<Set> (set)"]` markers (the existing catalog-backed
    set-attachment in build_dataset resolves them against gearplanner_sets.json)
  * `slot` / `ml` / `url` -> canonical slot / minimum_level / wiki_url

Roster membership (KTD5): every dump item is emitted; the build's name-keyed dedup
lets base-seed and existing wiki-enriched shards win collisions, so these records
are appended LAST and contribute net-new bodies. Unverified affixes land in
quarantine via verify, not the live pool.

Null-typed and unmapped affixes are quarantined (KTD6) into `structured_flagged`
(disclosed in coverage), never emitted as live magnitude affixes.
"""
from __future__ import annotations

import json
import os

from src import vocab
from src.seal import normalize_seal_type

RAW_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "seed",
                        "compendium", "raw", "gearplanner_items.json")

# Raw-dump slot names -> canonical pipeline slot names (the retired shard applied
# the same normalization; the rest of the pipeline expects "Helmet" / "Off Hand").
_SLOT_MAP = {"Helm": "Helmet", "Offhand": "Off Hand"}

_WIKI_BASE = "https://ddowiki.com"


def _slot(raw_slot):
    return _SLOT_MAP.get(raw_slot, raw_slot)


def _category(slot):
    # The retired shard used "weapon" for weapons and "item" for everything else
    # (including Armor). Mirror that so downstream category logic is unchanged.
    return "weapon" if slot == "Weapon" else "item"


def _augment_slots(crafting):
    """Extract augment-slot colors from the crafting[] list ("Yellow Augment Slot"
    -> "Yellow"). Non-augment crafting entries (seals, set-augment choices) are
    left for their own handlers / deferred; they are not coerced into slots."""
    out = []
    for c in crafting or []:
        if isinstance(c, str) and c.endswith(" Augment Slot"):
            out.append(c[: -len(" Augment Slot")].strip())
    return out


def _seal_slots(crafting, slot, verified_seal_types):
    """Recover "Sealed in X" seal-slot host markers from the crafting[] list.
    The retired shard baked these onto host bodies; the raw dump carries them in
    crafting. Gated on `verified_seal_types` (seal types with a non-empty pool) so
    Mist/Gloom — present in the dump but not yet wiki-sourced — stay excluded
    (exclude-until-verified), matching prior behavior."""
    out = []
    for c in crafting or []:
        if not (isinstance(c, str) and c.lower().startswith("sealed in ")):
            continue
        st = normalize_seal_type(c)
        if st and st in verified_seal_types:
            out.append({"seal_type": st, "category": slot})
    return out


def _value_unit(raw_value):
    """Split a gear-planner value into (value, unit). Values arrive as strings
    ("3", "10", "5%"); a trailing % is a pct unit. Non-numeric values pass through
    (variants._coerce_value / verify handle them)."""
    s = str(raw_value).strip() if raw_value is not None else ""
    unit = "pct" if s.endswith("%") else "flat"
    return raw_value, unit


# --- U1: native gear-planner passthrough (the canonical schema, at rest) -------
#
# The overhaul makes gear-planner's own record shape THE schema. `_native_affixes`
# copies the dump's typed affixes verbatim as `{name, type, value}` — no remap, no
# quarantine, no unit split (KTD1/KTD2). `value` stays the native string ("14",
# "9%"); the numeric coercion + unit derivation are the derived layer (U3), never a
# native rename. Phase A is additive: `_record` emits this native block ALONGSIDE
# the legacy `structured_affixes`/`enhancements`/`minimum_level` fields so the
# legacy solver path stays green; U3/U4 flip consumers to native, U7 deletes the
# legacy block + the remap.

def _native_affixes(affixes):
    return [{"name": a.get("name"), "type": a.get("type"), "value": a.get("value")}
            for a in affixes or []]


def _structured_affixes(affixes, boolean_allowlist):
    """Map the dump's typed affixes into (emitted, quarantined) lists.

    * mapped magnitude type  -> emitted {stat,bonus_type,value,unit}
    * Bool + name on the curated allowlist -> emitted boolean presence affix
    * Bool not on the allowlist, null type, or unmapped type -> quarantined
      (exclude-until-verified; disclosed, never a live affix)
    """
    emitted, flagged = [], []
    for a in affixes or []:
        name = (a.get("name") or "").strip()
        token = a.get("type")
        disp, bonus_type = vocab.map_gearplanner_type(token, name)
        if disp == "boolean":
            if name in boolean_allowlist:
                emitted.append({"stat": name, "bonus_type": "boolean",
                                "value": 1, "unit": "flat"})
            else:
                flagged.append({"raw": f"{name} (Bool)",
                                "reason": "boolean not on verified allowlist"})
        elif disp == "emit":
            value, unit = _value_unit(a.get("value"))
            emitted.append({"stat": name, "bonus_type": bonus_type,
                            "value": value, "unit": unit})
        else:  # quarantine
            reason = ("null/absent type (exclude-until-verified)"
                      if token in (None, "") else f"unmapped type {token!r}")
            flagged.append({"raw": f"{name} ({token})", "reason": reason})
    return emitted, flagged


def _record(it, boolean_allowlist, verified_seal_types):
    slot = _slot(it.get("slot"))
    emitted, flagged = _structured_affixes(it.get("affixes"), boolean_allowlist)
    quests = it.get("quests") or []
    rec = {
        "name": it.get("name"),
        # --- native gear-planner block (U1, canonical schema at rest) ---------
        # Verbatim from the dump: raw `slot`/`type`, `ml`, `url`, `quests`,
        # native `affixes` {name,type,value}, `crafting`, `sets`, `artifact`.
        "type": it.get("type"),
        "ml": it.get("ml"),
        "url": it.get("url"),
        "quests": list(quests),
        "affixes": _native_affixes(it.get("affixes")),
        "crafting": list(it.get("crafting") or []),
        "sets": list(it.get("sets") or []),
        "artifact": bool(it.get("artifact")),
        # --- legacy remapped block (removed in U7; kept so Phase A stays green) -
        "category": _category(slot),
        "slot": slot,
        "minimum_level": it.get("ml"),
        "binding": None,
        "location_quest": "; ".join(q for q in quests if isinstance(q, str)),
        "wiki_url": _WIKI_BASE + it.get("url", "") if it.get("url") else "",
        "augment_slots": _augment_slots(it.get("crafting")),
        # set membership -> "(set)" markers; the build resolves them against the
        # gear-planner set catalog (single source of truth).
        "enhancements": [f"{s} (set)" for s in (it.get("sets") or [])],
        "structured_affixes": emitted,
        "structured_flagged": flagged,
        "_source": "gear-planner",
        "_enriched": True,
    }
    seals = _seal_slots(it.get("crafting"), slot, verified_seal_types)
    if seals:
        rec["seal_slots"] = seals
    return rec


def load_planner_items(path: str = RAW_PATH, boolean_allowlist=None,
                       verified_seal_types=None, exclude_names=None):
    """Load and map the gear-planner raw dump into pipeline records with structured
    affixes. `boolean_allowlist` (curated presence-feature names) gates which Bool
    affixes emit; default empty -> all Bool quarantined (exclude-until-verified).
    `verified_seal_types` (seal types with a non-empty pool) gates which "Sealed in
    X" crafting entries become seal-slot hosts; default empty -> none.

    `exclude_names` are names owned by a **host-pipeline seed** that generates its
    own synthetic bodies *after* the build's name-keyed dedup (the Dinosaur Bone
    hosts, added as `dino_blanks` post-verify). Those bodies never pass through the
    Pass-1 dedup, so a same-name gear-planner record would double-list with an
    identical variant_id (the documented KTD6 trap). Such records are dropped here
    — the host seed owns the authoritative body.

    Returns `(records, stats)` where `stats` reports intra-dump name collisions
    collapsed (name-keyed, first wins — mirrors the build's own dedup) and affix
    quarantine counts, for coverage disclosure. Genuinely-distinct same-name items
    (e.g. a Belt and a Necklace both named "Chains") collapse to one here; this is
    a known, disclosed limitation of the name-keyed pipeline, not a silent drop."""
    allow = set(boolean_allowlist or ())
    seal_types = set(verified_seal_types or ())
    excluded = set(exclude_names or ())
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)

    records, seen = [], set()
    collapsed = host_owned = 0
    emitted_total = flagged_total = seal_hosts = 0
    for it in raw:
        name = it.get("name")
        if name in excluded:
            host_owned += 1
            continue
        if name in seen:
            collapsed += 1
            continue
        seen.add(name)
        rec = _record(it, allow, seal_types)
        emitted_total += len(rec["structured_affixes"])
        flagged_total += len(rec["structured_flagged"])
        if rec.get("seal_slots"):
            seal_hosts += 1
        records.append(rec)

    stats = {
        "planner_records": len(records),
        "planner_name_collisions_collapsed": collapsed,
        "planner_host_pipeline_names_excluded": host_owned,
        "planner_affixes_emitted": emitted_total,
        "planner_affixes_quarantined": flagged_total,
        "planner_seal_hosts": seal_hosts,
    }
    return records, stats
