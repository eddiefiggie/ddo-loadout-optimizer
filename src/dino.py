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
from src.planner_items import RAW_PATH as _PLANNER_ITEMS_PATH

# The four Dino bone types and the three gear categories whose native
# ``<Type> (<Category>)`` menu pools feed the insert option pool (U4b-ii).
#
# #283 — the ``(quarterstaff)`` sibling pools are now sourced too. gear-planner
# ships a quarterstaff variant of two Weapon pools (Fang, Scale) holding the
# versions a QUARTERSTAFF host receives; Claw and Horn have none, so a
# quarterstaff draws those two from the base pool — which is exactly what the
# native ``Dinosaur Bone Quarterstaff`` record's crafting list says. Merged by
# option name on the #282 model (see ``_native_insert_records``).
#
# The ``(artifact)`` variant pools remain out of scope, and that half of the old
# deferral still holds on its original grounds: no roster host references them.
_DINO_TYPES = ("Claw", "Fang", "Horn", "Scale")
_DINO_CATEGORIES = ("Accessory", "Armor", "Weapon")

# #283 — the quarterstaff variant vocabulary. ``_QS_HOST_NAME`` is the
# gear-planner record the synthetic blank shadows and replaces (its name is
# excluded from the reader by ``_host_pipeline_names``, the same mechanism the
# other blanks use); ``_QS_WEAPON_TYPE`` is the type gear-planner declares on it,
# and the value ``model.js dinoWeaponVariant`` keys the host variant on.
_QS_VARIANT = "quarterstaff"
_QS_POOL_TAIL = " (quarterstaff)"
_QS_HOST_NAME = "Dinosaur Bone Quarterstaff"
_QS_WEAPON_TYPE = "Quarterstaffs"


def _pool_keys(dino_type, category):
    """The catalog keys for one (type, category): the base pool, then the
    ``(quarterstaff)`` sibling where gear-planner ships one (Weapon only)."""
    base = f"{dino_type} ({category})"
    keys = [base]
    if category == "Weapon":
        keys.append(base + _QS_POOL_TAIL)
    return keys


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
    qs_pools_sourced, qs_options, qs_options_identical = [], 0, 0

    def _unit(dino_type, category, opt, affixes):
        unit = {
            "category": category,
            "dino_type": dino_type,
            "affixes": affixes,
            "wiki_url": "",
        }
        if opt.get("name"):
            unit["name"] = opt["name"]
        return unit

    for dino_type in _DINO_TYPES:
        for category in _DINO_CATEGORIES:
            keys = _pool_keys(dino_type, category)
            key = keys[0]
            qs_key = keys[1] if len(keys) > 1 else None
            if key not in catalog:
                continue  # not every (type, category) pool exists (e.g. Claw Armor)
            # #283 — the quarterstaff sibling pool, when gear-planner ships one.
            # Indexed by option name for the merge below.
            has_qs = bool(qs_key) and qs_key in catalog
            qs_by_name = {}
            if has_qs:
                qs_pools_sourced.append(qs_key)
                for opt in crafting_catalog.menu_options(qs_key, catalog):
                    source_options += 1
                    qs_options += 1
                    qs_by_name[(opt.get("name") or "").strip()] = opt
            for opt in crafting_catalog.menu_options(key, catalog):
                source_options += 1
                affixes = [crafting_catalog.legacy_affix(a)
                           for a in crafting_catalog.iter_affixes(opt)]
                if not affixes:
                    continue
                unit = _unit(dino_type, category, opt, affixes)
                if not has_qs:
                    records.append(unit)
                    continue
                # Merge on the #282 model: an option identical in BOTH pools stays
                # ONE unmarked record serving any Weapon host (the twin is
                # deduplicated, not lost); an option that differs is emitted per
                # variant, so a quarterstaff receives its richer version and every
                # other weapon receives the base one.
                twin = qs_by_name.pop((unit.get("name") or "").strip(), None)
                twin_affixes = ([crafting_catalog.legacy_affix(a)
                                 for a in crafting_catalog.iter_affixes(twin)]
                                if twin is not None else None)
                if twin_affixes == affixes:
                    qs_options_identical += 1
                    records.append(unit)
                elif twin is None:
                    unit[_QS_VARIANT] = False   # base-only: never on a quarterstaff
                    records.append(unit)
                else:
                    unit[_QS_VARIANT] = False
                    records.append(unit)
                    if twin_affixes:
                        twin_unit = _unit(dino_type, category, twin, twin_affixes)
                        twin_unit[_QS_VARIANT] = True
                        records.append(twin_unit)
            # Quarterstaff-only entries (no base twin).
            for _name, opt in sorted(qs_by_name.items()):
                affixes = [crafting_catalog.legacy_affix(a)
                           for a in crafting_catalog.iter_affixes(opt)]
                if not affixes:
                    continue
                unit = _unit(dino_type, category, opt, affixes)
                unit[_QS_VARIANT] = True
                records.append(unit)
    return records, source_options, {
        "quarterstaff_pools_sourced": sorted(qs_pools_sourced),
        "quarterstaff_options": qs_options,
        "quarterstaff_options_identical": qs_options_identical,
    }

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


def _parse_dino_pool_key(raw):
    """A crafting-list key -> ``(dino_type, category, is_quarterstaff)``, or None.

    A host's crafting list also names augment-slot menus and other systems; only
    the Dino ``<Type> (<Category>)`` pools (and their ``(quarterstaff)`` siblings)
    resolve here. Read structurally off the key, never from free text.
    """
    key = (raw or "").strip()
    qs = key.endswith(_QS_POOL_TAIL)
    if qs:
        key = key[: -len(_QS_POOL_TAIL)].strip()
    if not (key.endswith(")") and " (" in key):
        return None
    dino_type, _, category = key[:-1].partition(" (")
    dino_type, category = dino_type.strip(), category.strip()
    if dino_type not in _DINO_TYPES or category not in _DINO_CATEGORIES:
        return None
    return dino_type, category, qs


def native_quarterstaff_hosts(planner_items=None, catalog=None):
    """``{host name: [slot key, ...]}`` for every gear-planner record whose own
    crafting list names a ``(quarterstaff)`` Dino pool.

    These are the hosts #283 is about, and the selection is DERIVED, never listed:
    a record qualifies by naming such a pool itself. Today that is exactly
    ``Attuned Bone Quarterstaff`` and ``Dinosaur Bone Quarterstaff``, and a third
    host gaining the reference upstream joins them without an edit here.

    They already ship — correctly typed ``Quarterstaffs``, carrying their own
    ``+15 Enhancement Bonus`` — and are missing exactly one thing: the Dino insert
    capacity their crafting list grants them. That is what gets stamped, so the
    record keeps everything else it earned through the ordinary native pipeline.
    Nothing is synthesized to stand in for them: the eight synthetic blanks exist
    because their native counterparts carry NO affixes, so replacing them loses
    nothing. Replacing one of these would delete a real affix — the #364 trap.

    The keys are PHYSICAL (``type||category``, ``(quarterstaff)`` tail stripped).
    Which pool VARIANT a host draws is a property of its weapon type, resolved at
    solve time by ``model.js dinoWeaponVariant`` — never baked into the slot, so
    one encoding serves hosts of both variants.

    The wider gap stays open and separate: 134 native records name a BASE Dino
    pool and none of them are stamped, because the untyped synthetic Weapon blank
    is how this model represents "craft a Dino weapon" today. Giving every native
    Dino host its own insert capacity is a different, larger question than the one
    #283 asks.

    Fails the build loudly rather than stamping a host that cannot honour it:

    * a ``(quarterstaff)`` pool a host NAMES but the crafting catalog does not
      define — the soft-read failure mode recorded on #283, where a dropped
      upstream key becomes a silently smaller pool instead of a red build;
    * a qualifying host that is not declared a ``Quarterstaffs``, whose slots
      would then draw the base versions its own crafting list contradicts.
    """
    items = _load_planner_items() if planner_items is None else planner_items
    cat = crafting_catalog.load_catalog() if catalog is None else catalog
    hosts = {}
    for it in items or ():
        crafting = it.get("crafting") or {}
        raw_keys = (list(crafting.keys()) if isinstance(crafting, dict)
                    else list(crafting or ()))
        parsed = [(raw, _parse_dino_pool_key(raw)) for raw in raw_keys]
        parsed = [(raw, p) for raw, p in parsed if p is not None]
        if not any(p[2] for _raw, p in parsed):
            continue                      # names no quarterstaff pool: not ours
        name = (it.get("name") or "").strip()
        declared = (it.get("type") or "").strip()
        if declared != _QS_WEAPON_TYPE:
            raise SystemExit(
                f"dino quarterstaff hosts: {name!r} draws from a "
                f"{_QS_VARIANT!r} pool but declares type {declared!r}, not "
                f"{_QS_WEAPON_TYPE!r}. The variant is keyed on that type, so its "
                "slots would silently draw the BASE versions its own crafting "
                "list contradicts (#283).")
        slots = []
        for raw, (dino_type, category, is_qs) in parsed:
            if is_qs and str(raw).strip() not in cat:
                raise SystemExit(
                    f"dino quarterstaff hosts: {name!r} draws from "
                    f"{str(raw).strip()!r}, which the crafting catalog does not "
                    "define. Upstream dropped the pool the host names, so the "
                    "quarterstaff versions would silently stop being offered "
                    "rather than fail (#283).")
            slots.append(f"{dino_type}||{category}")
        hosts[name] = slots
    if not hosts:
        raise SystemExit(
            "dino quarterstaff hosts: no gear-planner record names a "
            f"{_QS_VARIANT!r} Dino pool. The two Bone Quarterstaffs did when #283 "
            "was written, so this is upstream drift, not an empty case — the "
            "quarterstaff versions would stop being offered with nothing said.")
    return dict(sorted(hosts.items()))


def native_dino_hosts(planner_items=None, catalog=None, blank_source_items=None):
    """``{host name: [slot key, ...]}`` for every gear-planner record whose own
    crafting list names a BASE ``<Type> (<Category>)`` Dino pool.

    These are the hosts #545 is about: the wider case #283 deliberately left
    alone once it had fixed the two that name a ``(quarterstaff)`` pool. They ship
    already — real, farmable, named items carrying their own affixes — and are
    missing exactly one thing: the Dino insert capacity their crafting list
    grants them. That is what gets stamped, so each record keeps everything else
    it earned through the ordinary native pipeline. Nothing is synthesized over
    them; all of them carry affixes, so replacing one would delete real value
    (the #364 trap).

    Selection is DERIVED, never listed, exactly as ``native_quarterstaff_hosts``
    does it: a record qualifies by naming such a pool itself, so a host gaining
    or losing the reference upstream joins or leaves without an edit here.

    Two populations are held out, and they are held out for different reasons:

    * a record naming a ``(quarterstaff)`` pool belongs to #283, which stamps it
      at the same seam — stamping it here as well is the double-stamp;
    * a ``blank_source_items`` name is a record a synthetic blank SHADOWS and
      replaces. It never reaches the planner reader at all, so it can never be
      stamped; leaving it in the population would make the count assertion in
      build_dataset fail over a host that was never eligible. Today that is
      ``Dinosaur Bone Helmet`` and ``Dinosaur Bone Cloak``.

    The keys are PHYSICAL (``type||category``), sorted. Which pool VARIANT a host
    draws is a property of its weapon type, resolved at solve time by
    ``model.js dinoWeaponVariant`` — never baked into the slot (KTD5 of the #545
    plan, and #283's single-authority rule). Sorting keeps the encoding
    independent of gear-planner's key order; the list is a multiset for capacity
    purposes, so order carries no meaning.

    Fails the build loudly rather than stamping a host that cannot honour it:

    * a base pool a host NAMES but the crafting catalog does not define — the
      same soft-read failure mode #283 recorded, which would otherwise leave the
      host carrying a slot key nothing can ever fill;
    * an empty population, which is upstream drift rather than an empty answer.
    """
    items = _load_planner_items() if planner_items is None else planner_items
    cat = crafting_catalog.load_catalog() if catalog is None else catalog
    held_out = set(blank_source_items or ())
    hosts = {}
    for it in items or ():
        name = (it.get("name") or "").strip()
        if name in held_out:
            continue
        crafting = it.get("crafting") or {}
        raw_keys = (list(crafting.keys()) if isinstance(crafting, dict)
                    else list(crafting or ()))
        parsed = [(raw, _parse_dino_pool_key(raw)) for raw in raw_keys]
        parsed = [(raw, p) for raw, p in parsed if p is not None]
        if not parsed:
            continue                      # names no Dino pool: not ours
        if any(p[2] for _raw, p in parsed):
            continue                      # names a quarterstaff pool: #283's
        slots = []
        for raw, (dino_type, category, _qs) in parsed:
            if str(raw).strip() not in cat:
                raise SystemExit(
                    f"dino native hosts: {name!r} draws from {str(raw).strip()!r}, "
                    "which the crafting catalog does not define. Upstream dropped "
                    "the pool the host names, so the host would carry a slot key "
                    "nothing can fill rather than fail (#545).")
            slots.append(f"{dino_type}||{category}")
        # Sorted, NOT deduplicated. The list is a capacity MULTISET — the solver
        # counts how many of a key a host exposes — so collapsing a repeated key
        # would silently delete a slot. `native_quarterstaff_hosts` keeps
        # duplicates for the same reason, and the two must not diverge. Sorting
        # only removes the dependence on gear-planner's key order.
        hosts[name] = sorted(slots)
    if not hosts:
        raise SystemExit(
            "dino native hosts: no gear-planner record names a base Dino pool. "
            "122 records did when #545 was written, so this is upstream drift, "
            "not an empty case — every native host would silently go back to "
            "zero insert capacity, which is the whole defect #545 fixes.")
    return dict(sorted(hosts.items()))


def stamp_dino_capacity(variants, hosts):
    """Write each host's Dino slot keys onto the variant it shipped as, in place.
    Returns how many variants were stamped.

    ONE seam serves both derived host populations (#283's quarterstaff hosts and
    #545's natives), so the two can never drift into stamping the same record
    twice or disagreeing about what a host is. The join is by ``source_item``.

    Refuses rather than softens, and the refusal names the CAUSE, because a
    derived host can go unstamped two different ways:

    * it **never reached a variant** — an unrelated gate (a blocklist, a
      quarantine, an upstream rename) dropped the record before this seam. Not
      this stamp's defect, and reporting it as one sends the next reader to the
      wrong code. #283's guard could conflate the two because it covered two
      hosts; across 122 the distinction is load-bearing.
    * it **shipped already carrying capacity** — two sources claim the same
      craft, and the second silently wins. That is the double-stamp, and it is
      this stamp's defect.
    """
    if not hosts:
        raise SystemExit(
            "dino capacity stamp: no hosts to stamp. Both derived populations "
            "were non-empty when #545 shipped, so an empty map is a caller "
            "handing over nothing — every native host would go back to zero "
            "insert capacity with nothing said.")
    stamped, already, reached = 0, [], set()
    for v in variants:
        slots = hosts.get(v.get("source_item") or "")
        if not slots:
            continue
        reached.add(v["source_item"])
        if v.get("dino_slots_norm"):
            already.append(v["source_item"])
            continue
        v["dino_slots_norm"] = list(slots)
        stamped += 1
    if already:
        raise SystemExit(
            f"dino capacity stamp: {sorted(set(already))} already carried insert "
            "capacity when the stamp ran. Two sources claim the same craft and "
            "the second wins silently, which is the double-stamp #545 forbids.")
    missing = sorted(set(hosts) - reached)
    if missing:
        raise SystemExit(
            f"dino capacity stamp: {missing} never reached a variant. The join is "
            "by `source_item` and was complete when #545 shipped, so these hosts "
            "were dropped upstream of this seam — look at the gate that dropped "
            "them, not at the stamp.")
    return stamped


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
        # A blank hosts Dino slots, so it is solver-eligible even with zero base
        # affixes. #338 moved that decision to the real gate — the blanks now
        # enter `variants` before `verify_mod.apply`, which admits them on
        # `dino_slots_norm` and overwrites both fields below with its own verdict.
        # They stay as the shape a blank leaves this builder in.
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
    """Stamp each blank's intrinsic set membership, in place, with the two fields
    the NATIVE attach in build_dataset stamps (a bare `sets` list is solver-inert):
    `sets`, and `set_bonus` = a deep copy of the gear-planner catalog definition
    (set_catalog.copy_def — never share a mutable def across records; the same
    helper the native attach uses).

    #338 — it stamps those two fields and STOPS. `parsed_set_bonuses` and the
    umbrella / spell-focus tier expansions used to be replicated here, because the
    blanks joined `variants` after the native tier passes had already run. That
    replication was only ever as complete as somebody remembered to keep it: the
    parrying, heightened-awareness and speed `expand_set_bonuses` passes and the
    expanded-away-orphan and helpless-fold guards were never mirrored, so a tier
    clause needing them would have expanded on the native carriers and survived raw
    on the blanks. build_dataset now appends the blanks BEFORE those passes, so the
    native derivations reach them directly and there is one owner for the recipe
    instead of two that agree by hand.

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
        if defs:
            b["set_bonus"] = defs
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
    # each blank shadows and cross-checked against the wiki ruling. Runs FIRST:
    # it carries the population gate (an empty or drifted Dinosaur Bone family
    # refuses to stamp anything), so it is the guard that should speak when the
    # dump is unusable — before anything downstream derives from the same records.
    _derived_sets = _stamp_set_membership(blanks, sets_catalog, planner_items)

    # Insert option pool: NATIVE (gearplanner_crafting.json), not the seed's inserts.
    insert_records, insert_source_options, _qs_pool_cov = _native_insert_records(catalog)

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
    # #283 — the quarterstaff channel, disclosed so "which pools were merged, how
    # many options actually differed" is read off the artifact rather than
    # recounted by hand. `quarterstaff_options_identical` is the dedup count: an
    # option identical in both pools stays ONE unmarked record.
    coverage["quarterstaff"] = dict(_qs_pool_cov)
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
