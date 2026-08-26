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

import json

from src import dino_parser
from src import crafting_catalog
from src import set_catalog
from src import set_parser
from src import spell_focus
from src import umbrella
from src.planner_items import RAW_PATH as _PLANNER_ITEMS_PATH

# The four Dino bone types and the three gear categories whose native
# ``<Type> (<Category>)`` menu pools feed the insert option pool (U4b-ii). The
# ``(quarterstaff)`` / ``(artifact)`` variant pools stay out of scope here, but
# NOT because nothing references them — the real gear-planner quarterstaff hosts
# (Attuned/Dinosaur Bone Quarterstaff) reference the Fang/Scale quarterstaff
# pools directly. Those hosts collapse into the ONE untyped synthetic Weapon
# blank below, which has no declared weapon type for a variant to key on, so
# modelling the quarterstaff insert versions needs a type choice on the blank
# first (tracked as #283; the Lamordia channel's typed hosts got the variant
# treatment in #282).
_DINO_TYPES = ("Claw", "Fang", "Horn", "Scale")
_DINO_CATEGORIES = ("Accessory", "Armor", "Weapon")


def _native_insert_records(catalog):
    """Source the Dino insert UNITS from ``gearplanner_crafting.json`` via
    ``crafting_catalog`` (the ``<Type> (<Category>)`` menu pools). Each native
    option becomes ONE placeable unit carrying its affix list (multi-affix kept
    all-or-nothing — KTD4). The strict parser gate is REMOVED, not swapped (F1):
    native affixes flow through verbatim via ``legacy_affix``. Blank host BODIES
    are NOT touched here — they stay generated from the seed (dino_parser).

    Returns ``(records, source_options)``: the fan-out gate judges this ATOMIC pool
    by option -> record cardinality, and shape alone cannot prove one option stayed
    one record (src/container_registry.py). Affix-less options are dropped, so
    records <= source options."""
    records = []
    source_options = 0
    for dino_type in _DINO_TYPES:
        for category in _DINO_CATEGORIES:
            key = f"{dino_type} ({category})"
            if key not in catalog:
                continue  # not every (type, category) pool exists (e.g. Claw Armor)
            for opt in crafting_catalog.menu_options(key, catalog):
                source_options += 1
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
    return records, source_options

# Dinosaur Bone accessory blanks map onto these worn slots (model.js WORN_SLOTS).
_ACCESSORY_WORN = {"Belt", "Boots", "Bracers", "Gloves", "Necklace", "Ring",
                   "Helmet", "Cloak"}
_ARMOR_NAMES = {"Robe", "Outfit", "Docent", "Light Armor", "Medium Armor", "Heavy Armor"}
_RUNEARM_NAMES = {"Runearm", "Rune Arm"}
_DINO_ML = 31  # Dino crafting is a Legendary (ML31) system.

# #334 — a crafted Dinosaur Bone item is intrinsically a piece of this set, but
# NOT every one of them: the wiki gives it to the blanks that have no
# `Isle of Dread: Set Bonus Slot`, and withholds it from the three that do
# (Armor / Helmet / Cloak) and from the weapons. Those three get exactly ONE
# set, chosen from six — and this set is one of the six choices, so stamping it
# intrinsically both invented a free piece and deleted a real option. Full
# ruling and verbatim wiki text: docs/wiki-evidence/dino-set-bonus-hosts.md.
# Membership is a property of the record, so it is stamped here in the record
# builder — one line of truth — never repeated per layout entry. The name must
# match the gear-planner catalog / membership_set_defs byte-exactly.
#
# #541 — this constant no longer DRIVES the stamp (`native_set_membership` derives
# the names from the catalog, so a set gear-planner adds to the family arrives on
# its own). It stays as the byte-exact spelling this family is expected to yield,
# for the error messages and the tests to anchor on.
INTRINSIC_SET = "The Legendary Dread Isle's Curse"

# The set names ddowiki has actually been harvested and ruled on for this family
# — docs/wiki-evidence/dino-set-bonus-hosts.md, harvested 2026-08-26, checked two
# ways: the rendered per-category enchantment lists, and per-item wikitext
# (`{{Named item sets|...}}` present on Belt / Large Shield / Runearm, absent from
# Helmet / Cloak / Robe / Longsword).
#
# #541 — the derivation below reads gear-planner, which mirrors ddowiki. A mirror
# can move ahead of the ruling, and a set name nobody has checked against the wiki
# is an INFERRED value the moment it is stamped — the one thing this repo never
# does. So the derivation is PINNED to what has been ruled on: a name outside this
# set stops the build until somebody harvests it. Compared on the canonical key so
# a cosmetic `" Set"` suffix is not a false alarm, but a different set is.
#
# Widening this is a wiki task — harvest the page, record the ruling, then add the
# name. It is never the edit that makes a red build green.
RATIFIED_SET_NAMES = frozenset({INTRINSIC_SET})


def carries_intrinsic_set(blank) -> bool:
    """The WIKI RULE for whether a blank host is intrinsically a set piece.

    Two exclusions, both wiki-stated (docs/wiki-evidence/dino-set-bonus-hosts.md):

    * a **Set-Bonus host** (Armor / Helmet / Cloak) has no intrinsic set — its
      one set comes from the Set Bonus augment it is crafted with;
    * a **Dinosaur Bone weapon** has no set at all. The raid-tier *Attuned* Bone
      weapon does, and is a separate native catalog record.

    Everything else — the six Minor Artifact accessories and the Rune Arm (plus
    the shields/orb, which have no solver Off Hand blank) — carries it.

    #541 — this no longer DECIDES the stamp; ``native_set_membership`` does, from
    the gear-planner records the blank shadows. It survives as the independent
    second opinion `_stamp_set_membership` cross-checks that derivation against,
    and the two sources really are independent: this reads
    ``dino_set_bonus_slot``, which comes from the hand-written host layout in
    ``src/dino_native.py``, while the derivation reads the catalog. When they
    disagree the build stops and someone re-reads the ruling — which is exactly
    what #334 needed and did not get.
    """
    return not blank.get("dino_set_bonus_slot") and blank.get("category") != "weapon"


# --- The gear-planner join (#541) -------------------------------------------
#
# The eleven blanks are SYNTHESIZED, so no gate compared them against the native
# records they stand in for. That is how #334's stamp contradicted gear-planner
# for four blanks, for ten days, with every gate green and a player finding it.
#
# The join key is the WORN SLOT, because that is precisely what `_blank_variant`
# collapses on: one `Dinosaur Bone Armor` blank stands in for Robe / Outfit /
# Mail / Docent, one `Dinosaur Bone Weapon` blank for forty weapon records. The
# collapsed natives must agree with each other (a split is itself worth failing
# on), and what they agree on IS the blank's membership — derived, not asserted
# alongside, so the two cannot drift apart again.
_NATIVE_NAME_PREFIX = "Dinosaur Bone "
_NATIVE_SLOT_TO_BLANK = {
    "Belt": "Belt", "Boots": "Boots", "Bracers": "Bracers", "Gloves": "Gloves",
    "Necklace": "Necklace", "Ring": "Ring", "Cloak": "Cloak",
    "Helm": "Helmet",          # gear-planner spells the head slot "Helm"
    "Armor": "Armor",
    "Weapon": "Main Hand",
}
# gear-planner files the Rune Arm under `Offhand` alongside the shields and the
# orb, so the slot alone does not identify it — the item TYPE does. The Rune Arm
# is the only one of the six with a solver slot; the rest are the
# disclosed-deferred blanks (`coverage["blanks_deferred"]`) and join nothing.
_NATIVE_OFFHAND_TYPE_TO_BLANK = {"Rune Arms": "Rune Arm"}

_PLANNER_ITEMS_CACHE = None


def _load_planner_items():
    """The raw gear-planner dump, parsed once per process (it is ~8 MB)."""
    global _PLANNER_ITEMS_CACHE
    if _PLANNER_ITEMS_CACHE is None:
        with open(_PLANNER_ITEMS_PATH, encoding="utf-8") as fh:
            raw = json.load(fh)
        _PLANNER_ITEMS_CACHE = raw.get("items", raw) if isinstance(raw, dict) else raw
    return _PLANNER_ITEMS_CACHE


def _blank_slot_for_native(item):
    """The blank worn slot a native Dinosaur Bone record collapses into, or None."""
    slot = (item.get("slot") or "").strip()
    if slot == "Offhand":
        return _NATIVE_OFFHAND_TYPE_TO_BLANK.get((item.get("type") or "").strip())
    return _NATIVE_SLOT_TO_BLANK.get(slot)


def native_set_membership(planner_items=None):
    """Worn slot -> ``{"sets": tuple, "natives": [name, ...]}`` as gear-planner
    declares it for the Dinosaur Bone records collapsing into that blank.

    Read STRUCTURALLY (`slot` / `type` / `sets`), never re-parsed from free text.
    ``planner_items=None`` loads the dump; an explicit empty list is a caller
    handing over nothing, which is a failure, not an empty answer.

    Fails the build loudly on either shape of nonsense:

    * **zero records** — the dump lost its Dinosaur Bone family, or the name
      prefix drifted. A guard that inspects nothing reports success forever;
    * **a split slot** — two natives collapsing into one blank disagree on their
      set list, so there is no single membership the blank could honestly claim.
    """
    items = _load_planner_items() if planner_items is None else planner_items
    by_slot = {}
    for it in items or ():
        name = (it.get("name") or "").strip()
        if not name.startswith(_NATIVE_NAME_PREFIX):
            continue
        slot = _blank_slot_for_native(it)
        if slot is None:
            continue          # shields/orb: deferred, no blank to shadow
        entry = by_slot.setdefault(slot, {"seen": {}, "natives": []})
        entry["natives"].append(name)
        entry["seen"][tuple(sorted(it.get("sets") or ()))] = name

    if not by_slot:
        raise SystemExit(
            "dino blank set stamp: the gear-planner catalog yielded no "
            f"{_NATIVE_NAME_PREFIX.strip()!r} records to derive blank set membership "
            "from. Refusing to stamp against an empty population (#541).")

    out = {}
    for slot, entry in sorted(by_slot.items()):
        if len(entry["seen"]) > 1:
            detail = "; ".join(
                f"{example} -> {list(sets) or 'no sets'}"
                for sets, example in sorted(entry["seen"].items()))
            raise SystemExit(
                f"dino blank set stamp: the gear-planner records behind the {slot!r} "
                f"blank disagree on set membership ({detail}). One blank collapses "
                "them all, so it cannot claim a membership they do not share (#541).")
        sets = next(iter(entry["seen"]))
        ratified = {set_catalog.canonical(n) for n in RATIFIED_SET_NAMES}
        unratified = [n for n in sets if set_catalog.canonical(n) not in ratified]
        if unratified:
            raise SystemExit(
                f"dino blank set stamp: gear-planner puts the {slot!r} blank in "
                f"{unratified}, which docs/wiki-evidence/dino-set-bonus-hosts.md has "
                f"never ruled on (from {', '.join(sorted(entry['natives']))}). "
                "Stamping it would ship a game value no ddowiki source states. "
                "Harvest the page, record the ruling, then add the name to "
                "RATIFIED_SET_NAMES — in that order (#541).")
        out[slot] = {"sets": sets, "natives": sorted(entry["natives"])}
    return out


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


def _stamp_set_membership(blanks, sets_catalog=None, planner_items=None):
    """Stamp each blank's intrinsic set membership, in place, with the FULL native
    field chain (a bare `sets` list is solver-inert): `sets`, `set_bonus` = a deep
    copy of the gear-planner catalog definition (set_catalog.copy_def — never
    share a mutable def across records; same helper as the native attach in
    build_dataset), and `parsed_set_bonuses` via set_parser.annotate_variant.
    Blanks join `variants` AFTER the native tier passes have run, so the SAME
    expansion entry points the native channel uses (umbrella.expand_variants,
    then spell_focus.expand_variants — one owner for the recipe) are applied here
    — the built-dataset test pins channel equality against a native carrier so a
    future pass cannot drift the two silently.

    #541 — WHAT gets stamped is now DERIVED from the gear-planner records the
    blank shadows (`native_set_membership`), not asserted next to them. #334
    stamped the set on all eleven blanks from a hand-written rule; gear-planner
    said otherwise for four of them and nothing compared the two, so a
    Set-Bonus host counted as a Dread Isle's Curse piece AND spent its Set Bonus
    slot on a second set for ten days. Deriving deletes that failure mode instead
    of detecting it: the stamp cannot contradict the catalog because it IS the
    catalog.

    The wiki ruling survives as a cross-check, not as the source. Three ways to
    fail the build, all loud:

    * a blank no native record shadows — the join drifted, and an unshadowed
      blank is exactly the unchecked thing #541 exists to forbid;
    * a derivation that contradicts `carries_intrinsic_set` — gear-planner and
      docs/wiki-evidence/dino-set-bonus-hosts.md disagree, which is a data
      -semantics event a human has to rule on, never a silent re-stamp;
    * a derived set name the set catalog cannot define — the same strictness
      #334's stamp already had, now applied per derived name.

    Returns the derived map so `build_dino` can disclose it in coverage.
    """
    derived = native_set_membership(planner_items)
    if not blanks:
        return derived
    cat = set_catalog.load_catalog() if sets_catalog is None else sets_catalog
    carriers = []
    for b in blanks:
        slot = b["slot"]
        if slot not in derived:
            raise SystemExit(
                f"dino blank set stamp: no gear-planner Dinosaur Bone record shadows "
                f"the {slot!r} blank, so its set membership cannot be derived from "
                "the catalog it stands in for (#541).")
        names = derived[slot]["sets"]
        if bool(names) != carries_intrinsic_set(b):
            raise SystemExit(
                f"dino blank set stamp: the {slot!r} blank's set membership is "
                f"disputed. gear-planner says {list(names) or 'no sets'} (from "
                f"{', '.join(derived[slot]['natives'])}); the wiki ruling in "
                "docs/wiki-evidence/dino-set-bonus-hosts.md says "
                f"{'a set piece' if carries_intrinsic_set(b) else 'no set'} "
                f"(set_bonus_slot={bool(b.get('dino_set_bonus_slot'))}, "
                f"category={b.get('category')!r}). Re-read the ruling before "
                "changing either side (#541).")
        if not names:
            continue
        defs = []
        for n in names:
            if set_catalog.canonical(n) not in cat:
                # Strict: a catalog that does not KNOW the set must never ship
                # set-less blanks silently.
                raise SystemExit(
                    f"dino blank set stamp: no catalog definition for {n!r}")
            d = set_catalog.definition_for(n, {}, cat)
            if d is None:
                # Known set, membership-only (every catalog affix flagged ->
                # set_bonus=None): membership still counts toward the threshold,
                # but there is no def to attach — the same skip-the-attach
                # posture as the native channel in build_dataset, disclosed via
                # parse_rate's membership_only_sets.
                continue
            defs.append(set_catalog.copy_def(d))
        b["sets"] = list(names)
        carriers.append(b)
        if defs:
            b["set_bonus"] = defs
            set_parser.annotate_variant(b)
    umbrella.expand_variants(carriers)
    spell_focus.expand_variants(carriers)
    return derived


def build_dino(seed, catalog=None, sets_catalog=None, planner_items=None):
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
    # #334/#541 — intrinsic set membership, DERIVED from the gear-planner records
    # each blank shadows and cross-checked against the wiki ruling.
    _derived_sets = _stamp_set_membership(blanks, sets_catalog, planner_items)

    # Insert option pool: NATIVE (gearplanner_crafting.json), not the seed's inserts.
    insert_records, insert_source_options = _native_insert_records(catalog)

    coverage = dict(parsed["coverage"])
    # Override the seed-derived insert counts with the native pool's reality.
    coverage["inserts_eligible"] = len(insert_records)
    # What the native pools OFFERED, for the fan-out gate's cardinality rule.
    coverage["insert_source_options"] = insert_source_options
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
    # #541 — the derivation, disclosed: what gear-planner declares for each blank
    # slot and how many native records that verdict was collapsed from. A reader
    # asking "how many blanks carry the set, and on whose authority" reads it
    # here instead of counting records against a rule in their head.
    coverage["blank_intrinsic_sets"] = {
        b["slot"]: list(_derived_sets[b["slot"]]["sets"]) for b in blanks}
    coverage["blank_set_shadow_counts"] = {
        b["slot"]: len(_derived_sets[b["slot"]]["natives"]) for b in blanks}
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
