"""gear-planner raw-dump reader (native schema — the single source of truth).

Reads `data/seed/compendium/raw/gearplanner_items.json` (the gear-planner catalog)
and maps each item onto a pipeline record carrying the **native** affix block —
`{name, type, value}` taken straight from the dump's typed `affixes[]`, VERBATIM
(no free-text re-parse, no type remap, no quarantine). gear-planner is the sole
authority for item data; the legacy internal-schema remap was purged in U7.

Key mappings (the dump keeps these in *separate* keys):
  * `affixes[] {name,type,value}` -> native `affixes` (verbatim)
  * `crafting[]` markers -> the native host choice-slot markers:
      - `"<Color> Augment Slot"`              -> `augment_slots`
      - `"Sealed in X"`                        -> `seal_slots`      (gated)
      - `"<Dolorous|Melancholic|Miserable|Woeful> (<Category>)"` -> `lamordia_slots`
      - `"Nearly Complete: <category>"`        -> `nearly_complete`
      - `"Nearly Finished" / "Almost There"`   -> `nc_per_item_slots` (gated)
      - `"Lost Purpose" / "Legendary Lost Purpose"` -> `lost_purpose`
      - `"T<n> (Equipment)"` / `"T<n> (Weapon)"`   -> `green_steel_tiers` /
        `thunder_forged_tiers` (#194 — Legendary Green Steel altar tiers)
    Each host marker is surfaced NATIVELY (the plan's native host-marker
    surfacing) so the crafting families activate from the authority, not from the
    retired wiki-enriched shards.
  * `sets[]` -> `enhancements ["<Set> (set)"]` markers (resolved against
    gearplanner_sets.json by build_dataset)
  * `slot` / `ml` / `url` -> canonical slot / minimum_level / wiki_url

Roster membership: every dump item is emitted; the build's name-keyed dedup
collapses intra-dump same-name collisions (first wins), disclosed in coverage.
"""
from __future__ import annotations

import json
import os
import re

from src.seal import normalize_seal_type
from src import essence_pool

RAW_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "seed",
                        "compendium", "raw", "gearplanner_items.json")

# Raw-dump slot names -> canonical pipeline slot names (the retired shard applied
# the same normalization; the rest of the pipeline expects "Helmet" / "Off Hand").
_SLOT_MAP = {"Helm": "Helmet", "Offhand": "Off Hand"}

_WIKI_BASE = "https://ddowiki.com"

# Viktranium ("Lamordia", Chill of Ravenloft) typed slots and the crafting-marker
# grammar `"<Type> (<Category>)"` (an optional "(quarterstaff)" tail is ignored).
_LAMORDIA_RE = re.compile(r"^(Dolorous|Melancholic|Miserable|Woeful) \((Armor|Accessory|Weapon)\)")
_NEARLY_PREFIX = "Nearly Complete: "
# The per-item Nearly Complete pools (#371). A DISTINCT mechanism from the
# `Nearly Complete: <category>` menu above: these are keyed by HOST NAME, so the
# options one item can craft are its own, not a shared menu's.
_NC_PER_ITEM_POOLS = ("Nearly Finished", "Almost There")
# #194 — Legendary Green Steel altar tiers. A host declares `"T1 (Equipment)"`,
# `"T2 (Equipment)"`, `"T3 (Equipment)"` (the 8 accessory blanks) or the same
# three `(Weapon)` labels (the 40 weapon blanks). Each label is one Legendary
# Altar — Invasion / Subjugation / Devastation — and each altar takes ONE effect,
# so a host exposes one single-pick slot PER declared tier, never one in total.
# The label names the menu the option pool is keyed by (`crafting_catalog`
# GREEN_STEEL_KEYS / THUNDER_FORGED_KEYS), which is the same structural link
# `essence_slots` reads for the Gem of Many Facets: the item's own `crafting[]`
# says which menus it has, so nothing here is inferred from the item's name.
_LGS_TIER_RE = re.compile(r"^T([123]) \((Equipment|Weapon)\)$")


def _slot(raw_slot):
    return _SLOT_MAP.get(raw_slot, raw_slot)


def _category(slot):
    # The retired shard used "weapon" for weapons and "item" for everything else
    # (including Armor). Mirror that so downstream category logic is unchanged.
    return "weapon" if slot == "Weapon" else "item"


def _native_affixes(affixes):
    return [{"name": a.get("name"), "type": a.get("type"), "value": a.get("value")}
            for a in affixes or []]


def _augment_slots(crafting):
    """Extract augment-slot colors from the crafting[] list ("Yellow Augment Slot"
    -> "Yellow"). Non-augment crafting entries are left for their own handlers."""
    out = []
    for c in crafting or []:
        if isinstance(c, str) and c.endswith(" Augment Slot"):
            out.append(c[: -len(" Augment Slot")].strip())
    return out


def _seal_slots(crafting, slot, verified_seal_types):
    """Recover "Sealed in X" seal-slot host markers from the crafting[] list.
    Gated on `verified_seal_types` (seal types with a non-empty pool) so
    Mist/Gloom — present in the dump but not yet sourced — stay excluded."""
    out = []
    for c in crafting or []:
        if not (isinstance(c, str) and c.lower().startswith("sealed in ")):
            continue
        st = normalize_seal_type(c)
        if st and st in verified_seal_types:
            out.append({"seal_type": st, "category": slot})
    return out


def _lamordia_slots(crafting):
    """Viktranium ("Lamordia") typed host slots from the crafting[] list. Each
    `"<Type> (<Category>)"` marker becomes `{type, category}`; deduped by
    (type, category) so the "(quarterstaff)" variant does not double a slot."""
    out, seen = [], set()
    for c in crafting or []:
        if not isinstance(c, str):
            continue
        m = _LAMORDIA_RE.match(c)
        if not m:
            continue
        key = (m.group(1), m.group(2))
        if key not in seen:
            seen.add(key)
            out.append({"type": m.group(1), "category": m.group(2)})
    return out


def _essence_slots(crafting):
    """Essence Crafting Trinket menus from the crafting[] list (#193/#599).

    Surfaced from the same labels the compendium shows, so the slots the solver
    fills are exactly the slots the item is documented to have. The
    verification gate is applied later, in build_dataset, where a record's
    verification is known.
    """
    return essence_pool.essence_slots(crafting)


def _nearly_complete(crafting):
    """U81 Nearly-Complete host category from `"Nearly Complete: <category>"`
    (the parametric single-affix choice slot). First marker wins; None if absent."""
    for c in crafting or []:
        if isinstance(c, str) and c.startswith(_NEARLY_PREFIX):
            return c[len(_NEARLY_PREFIX):].strip()
    return None


def _nc_per_item_slots(crafting, name, per_item_hosts):
    """Per-item Nearly Complete host markers (#371) from the crafting[] list.

    Gated on `per_item_hosts` (`{pool: {host name}}`, from
    `nearly_complete.per_item_hosts`) exactly as `_seal_slots` is gated on the
    verified seal types: a declared label whose pool has no entry for THIS item
    gets no marker, so the solver is never handed a slot it cannot fill. The 22
    such items are disclosed by name by the crafting-coverage gate rather than
    silently marked — see `src/crafting_coverage.py`.
    """
    out = []
    for c in crafting or []:
        if not (isinstance(c, str) and c in _NC_PER_ITEM_POOLS):
            continue
        if name in ((per_item_hosts or {}).get(c) or ()):
            out.append({"pool": c})
    return out


def _lgs_tiers(crafting, kind):
    """The Legendary Green Steel tier slots a host declares for `kind`
    (`"Equipment"` -> `green_steel_tiers`, `"Weapon"` -> `thunder_forged_tiers`),
    as `[{tier: 1}, {tier: 2}, ...]` in tier order, deduped. Only the tiers the
    item actually declares — a blank declaring two altars gets two slots."""
    tiers = set()
    for c in crafting or []:
        if not isinstance(c, str):
            continue
        m = _LGS_TIER_RE.match(c.strip())
        if m and m.group(2) == kind:
            tiers.add(int(m.group(1)))
    return [{"tier": t} for t in sorted(tiers)]


def _lost_purpose(crafting):
    """Vecna "Lost Purpose" tier marker: `"Legendary Lost Purpose"` -> 'legendary',
    `"Lost Purpose"` -> 'heroic'. None if absent."""
    for c in crafting or []:
        if c == "Legendary Lost Purpose":
            return "legendary"
    for c in crafting or []:
        if c == "Lost Purpose":
            return "heroic"
    return None


def _record(it, verified_seal_types, nc_per_item_hosts=None):
    slot = _slot(it.get("slot"))
    quests = it.get("quests") or []
    rec = {
        "name": it.get("name"),
        # --- native gear-planner block (canonical schema at rest) --------------
        "type": it.get("type"),
        "ml": it.get("ml"),
        "url": it.get("url"),
        "quests": list(quests),
        "affixes": _native_affixes(it.get("affixes")),
        "crafting": list(it.get("crafting") or []),
        "sets": list(it.get("sets") or []),
        "artifact": bool(it.get("artifact")),
        # --- derived-from-native fields the rest of the pipeline reads ---------
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
        "_source": "gear-planner",
        "_enriched": True,
    }
    seals = _seal_slots(it.get("crafting"), slot, verified_seal_types)
    if seals:
        rec["seal_slots"] = seals
    lam = _lamordia_slots(it.get("crafting"))
    if lam:
        rec["lamordia_slots"] = lam
    ess = _essence_slots(it.get("crafting"))
    if ess:
        rec["essence_slots"] = ess
    nc = _nearly_complete(it.get("crafting"))
    if nc:
        rec["nearly_complete"] = nc
    ncp = _nc_per_item_slots(it.get("crafting"), it.get("name"), nc_per_item_hosts)
    if ncp:
        rec["nc_per_item_slots"] = ncp
    lp = _lost_purpose(it.get("crafting"))
    if lp:
        rec["lost_purpose"] = lp
    # #194 — the two Legendary Green Steel pools, keyed by the host's item class.
    # `thunder_forged_tiers` is the WEAPON half's marker: the pool under that name
    # is Legendary Green Steel weapon recipes (#653), and the registry asserts its
    # station. Real Thunder-Forged items declare no `T<n> (Weapon)` label, so they
    # cannot pick this up.
    gs = _lgs_tiers(it.get("crafting"), "Equipment")
    if gs:
        rec["green_steel_tiers"] = gs
    tf = _lgs_tiers(it.get("crafting"), "Weapon")
    if tf:
        rec["thunder_forged_tiers"] = tf
    return rec


def load_planner_items(path: str = RAW_PATH, verified_seal_types=None,
                       exclude_names=None, nc_per_item_hosts=None):
    """Load and map the gear-planner raw dump into native pipeline records.
    `verified_seal_types` (seal types with a non-empty pool) gates which "Sealed
    in X" crafting entries become seal-slot hosts; default empty -> none.

    `exclude_names` are names owned by a host-pipeline seed that generates its own
    synthetic bodies *after* the build's name-keyed dedup (the Dinosaur Bone
    hosts). Such records are dropped here — the host seed owns the body.

    Returns `(records, stats)` where `stats` reports intra-dump name collisions
    collapsed (name-keyed, first wins) and native host-marker counts, for coverage
    disclosure."""
    seal_types = set(verified_seal_types or ())
    excluded = set(exclude_names or ())
    nc_hosts = nc_per_item_hosts or {}
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)

    records, seen = [], set()
    collapsed = host_owned = 0
    seal_hosts = lamordia_hosts = nearly_hosts = lost_purpose_hosts = 0
    green_steel_hosts = lgs_weapon_hosts = 0
    nc_per_item_hosts_marked = 0
    for it in raw:
        name = it.get("name")
        if name in excluded:
            host_owned += 1
            continue
        if name in seen:
            collapsed += 1
            continue
        seen.add(name)
        rec = _record(it, seal_types, nc_hosts)
        if rec.get("seal_slots"):
            seal_hosts += 1
        if rec.get("lamordia_slots"):
            lamordia_hosts += 1
        if rec.get("nearly_complete"):
            nearly_hosts += 1
        if rec.get("nc_per_item_slots"):
            nc_per_item_hosts_marked += 1
        if rec.get("lost_purpose"):
            lost_purpose_hosts += 1
        if rec.get("green_steel_tiers"):
            green_steel_hosts += 1
        if rec.get("thunder_forged_tiers"):
            lgs_weapon_hosts += 1
        records.append(rec)

    stats = {
        "planner_records": len(records),
        "planner_name_collisions_collapsed": collapsed,
        "planner_host_pipeline_names_excluded": host_owned,
        "planner_seal_hosts": seal_hosts,
        "planner_lamordia_hosts": lamordia_hosts,
        "planner_nearly_complete_hosts": nearly_hosts,
        "planner_nc_per_item_hosts": nc_per_item_hosts_marked,
        "planner_lost_purpose_hosts": lost_purpose_hosts,
        # #194 — Legendary Green Steel blanks, by pool: the accessory half and
        # the weapon half (the latter under the pool's legacy `thunder_forged` name).
        "planner_green_steel_hosts": green_steel_hosts,
        "planner_lgs_weapon_hosts": lgs_weapon_hosts,
    }
    return records, stats
