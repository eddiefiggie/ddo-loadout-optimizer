"""Controlled-vocabulary foundation for the gear-planner-native overhaul (U10).

gear-planner is the single data authority. Its affix NAMES, bonus TYPES, crafting-slot
keys, and augment names are each a fixed, generated registry; every reference on an item /
crafting pool / set must resolve to exactly one registry entry (many-to-one) or the build
fails. Similar-but-distinct names (``Armor Class`` vs ``Armor Class (%)``, ``Insight`` vs
``Insight Natural``) are NEVER auto-merged: an ambiguity *lint* surfaces candidates and a
*curated* alias/distinct table (``affix_aliases.json``) resolves them. gear-planner's affix
``type`` is the stacking bucket, verbatim, except the curated stacking-equivalence pairs
(``type_stacking_equivalence.json``) that must share a bucket in-game.

This module is standalone: it reads the raw gear-planner files + the two curated tables and
exposes generation / linting / integrity / freshness helpers. It does not depend on the
legacy ``vocab`` remap layer (which the overhaul deletes).
"""
import difflib
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
RAW_DIR = os.path.join(HERE, "..", "data", "seed", "compendium", "raw")
CURATED_DIR = os.path.join(HERE, "..", "data", "seed", "compendium")

ITEMS_PATH = os.path.join(RAW_DIR, "gearplanner_items.json")
CRAFTING_PATH = os.path.join(RAW_DIR, "gearplanner_crafting.json")
SETS_PATH = os.path.join(RAW_DIR, "gearplanner_sets.json")
SOURCE_PATH = os.path.join(RAW_DIR, "SOURCE.json")
AFFIX_ALIASES_PATH = os.path.join(CURATED_DIR, "affix_aliases.json")
TYPE_STACKING_PATH = os.path.join(CURATED_DIR, "type_stacking_equivalence.json")
CRAFTING_SLOT_REGISTRY_PATH = os.path.join(CURATED_DIR, "crafting_slot_registry.json")
AUGMENT_REGISTRY_PATH = os.path.join(CURATED_DIR, "augment_registry.json")

# The augment-stone pools share this key suffix (see crafting_catalog).
_AUGMENT_SLOT_SUFFIX = "Augment Slot"


# --------------------------------------------------------------------------- raw walk

def _load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def iter_affixes(obj):
    """Yield every ``{name, type, value}`` affix dict found anywhere in a raw structure
    (items, crafting pools of either the ``"*"`` or per-item shape, and set defs)."""
    if isinstance(obj, dict):
        if "name" in obj and "type" in obj and "value" in obj:
            yield obj
        else:
            for v in obj.values():
                yield from iter_affixes(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from iter_affixes(v)


def _sources(items=None, crafting=None, sets=None):
    items = _load(ITEMS_PATH) if items is None else items
    crafting = _load(CRAFTING_PATH) if crafting is None else crafting
    sets = _load(SETS_PATH) if sets is None else sets
    return items, crafting, sets


# --------------------------------------------------------------------- registry generate

def generate_registries(items=None, crafting=None, sets=None):
    """Generate the four controlled vocabularies from the gear-planner raw files.

    Returns a dict with sorted lists: ``affix_names``, ``bonus_types``,
    ``crafting_slots``, ``augments``. Deterministic (sorted) so a re-import diff is
    reviewable.
    """
    items, crafting, sets = _sources(items, crafting, sets)
    names, types = set(), set()
    for src in (items, crafting, sets):
        for a in iter_affixes(src):
            if isinstance(a.get("name"), str):
                names.add(a["name"])
            if isinstance(a.get("type"), str):
                types.add(a["type"])
    crafting_slots = sorted(crafting.keys()) if isinstance(crafting, dict) else []
    # Augment names live in the "<Color> Augment Slot" crafting pools.
    augments = set()
    if isinstance(crafting, dict):
        for key, pool in crafting.items():
            if key.endswith("Augment Slot"):
                for a in iter_affixes(pool):
                    host = a
                    if isinstance(host.get("name"), str):
                        augments.add(host["name"])
                # augment *stone* names are the option "name" fields, not affix names
                for opt in (pool.get("*", []) if isinstance(pool, dict) else []):
                    if isinstance(opt, dict) and isinstance(opt.get("name"), str):
                        augments.add(opt["name"])
    return {
        "affix_names": sorted(names),
        "bonus_types": sorted(types),
        "crafting_slots": crafting_slots,
        "augments": sorted(augments),
    }


# ------------------------------------------------- crafting-slot + augment registries (R14)

def generate_crafting_slot_registry(crafting=None, items=None):
    """The crafting-slot registry: the closed set of every crafting-slot identifier
    that must resolve (R12/R14) = the ``gearplanner_crafting.json`` pool keys (the
    83 pool-bearing slots) UNIONED with every item ``crafting[]`` marker. The union
    is required because some item markers name pool-less slots (the 12 Cannith
    player-crafting slots — Melee/Ring/Rune Arm/Trinket Prefix/Suffix/Extra — carry
    no fixed option pool), yet a referential-integrity gate must still resolve them.
    Sorted, deterministic. A closed structural set — integrity-gated, no alias/lint."""
    crafting = _load(CRAFTING_PATH) if crafting is None else crafting
    if not isinstance(crafting, dict):
        raise ValueError("crafting catalog must be a dict of pools")
    slots = set(crafting.keys())
    if items is None:
        items = _load(ITEMS_PATH)
    item_list = items.get("items", items) if isinstance(items, dict) else items
    for it in item_list or []:
        for c in it.get("crafting") or []:
            key = c if isinstance(c, str) else (c.get("name") if isinstance(c, dict) else None)
            if isinstance(key, str) and key:
                slots.add(key)
    return sorted(slots)


def generate_augment_registry(crafting=None):
    """The augment registry: the augment-stone ``name`` fields drawn from the
    ``<Color> Augment Slot`` menu pools, sorted. Closed structural set (R14)."""
    crafting = _load(CRAFTING_PATH) if crafting is None else crafting
    augs = set()
    for key, pool in (crafting or {}).items():
        if key.endswith(_AUGMENT_SLOT_SUFFIX) and isinstance(pool, dict):
            for opt in pool.get("*", []) or []:
                nm = opt.get("name") if isinstance(opt, dict) else None
                if isinstance(nm, str) and nm:
                    augs.add(nm)
    return sorted(augs)


def _registry_list(obj, key):
    """Accept either a raw list or a ``{key: [...]}`` frozen-registry dict."""
    if isinstance(obj, dict):
        return obj.get(key, [])
    return obj or []


def check_crafting_integrity(items, crafting, slot_registry, augment_registry):
    """Referential-integrity gate for crafting slots + augments (R12/R14), against
    the FROZEN checked-in registries. Every item ``crafting[]`` marker must resolve
    to a crafting-slot registry entry, and every augment-stone ``name`` in the
    ``<Color> Augment Slot`` pools must resolve to an augment registry entry. The
    first unresolved reference raises ``IntegrityError``; returns the count checked.

    ``slot_registry``/``augment_registry`` may be a raw list or a frozen-registry
    dict (``{"crafting_slots": [...]}`` / ``{"augments": [...]}``)."""
    slots = set(_registry_list(slot_registry, "crafting_slots"))
    augs = set(_registry_list(augment_registry, "augments"))
    item_list = items.get("items", items) if isinstance(items, dict) else items
    checked = 0
    for it in item_list or []:
        for c in it.get("crafting") or []:
            key = c if isinstance(c, str) else (c.get("name") if isinstance(c, dict) else None)
            if key is None:
                continue
            if key not in slots:
                raise IntegrityError(
                    f"unknown crafting slot {key!r} on item {it.get('name')!r} "
                    f"not in the frozen crafting-slot registry (new-slot event)")
            checked += 1
    for key, pool in (crafting or {}).items():
        if key.endswith(_AUGMENT_SLOT_SUFFIX) and isinstance(pool, dict):
            for opt in pool.get("*", []) or []:
                nm = opt.get("name") if isinstance(opt, dict) else None
                if isinstance(nm, str) and nm and nm not in augs:
                    raise IntegrityError(
                        f"unknown augment {nm!r} in pool {key!r} not in the frozen "
                        f"augment registry (new-augment event)")
                checked += 1
    return checked


# ------------------------------------------------------------------------- curated tables

def load_affix_aliases(path=AFFIX_ALIASES_PATH):
    """Return ``(alias_map, distinct_pairs)`` from the curated affix table.

    ``alias_map``: ``{variant_name: canonical_name}``.
    ``distinct_pairs``: set of frozenset pairs whitelisted as genuinely different.
    """
    data = _load(path)
    alias_map = {e["variant"]: e["canonical"] for e in data.get("aliases", [])}
    distinct = {frozenset(p) for p in data.get("distinct", [])}
    return alias_map, distinct


def load_stacking_equivalence(path=TYPE_STACKING_PATH):
    """Return ``{native_type: stacks_as_bucket}`` from the curated type table."""
    data = _load(path)
    return {e["native_type"]: e["stacks_as"] for e in data.get("equivalences", [])}


def stacking_bucket(affix_type, equivalence=None):
    """Resolve an affix's native ``type`` to its stacking bucket. Verbatim, except the
    curated equivalences (e.g. ``Insight Natural`` -> ``Insight``)."""
    if equivalence is None:
        equivalence = load_stacking_equivalence()
    return equivalence.get(affix_type, affix_type)


# ----------------------------------------------------------------------- name resolution

def resolve_affix_name(name, registry_names, alias_map):
    """Resolve a raw affix name to its canonical registry entry (many-to-one).

    Returns the canonical name, or ``None`` if it resolves to nothing in the frozen
    registry (an unknown -> the integrity gate raises).
    """
    if name in alias_map:  # curated rewrite wins
        name = alias_map[name]
    return name if name in registry_names else None


# --------------------------------------------------------------------- integrity gate

class IntegrityError(ValueError):
    """Raised when a reference does not resolve to the frozen registry baseline."""


def check_referential_integrity(items, crafting, sets, baseline, alias_map):
    """Fail (raise ``IntegrityError``) on any affix name/type absent from the FROZEN
    baseline registry (KTD9). Regenerating from the same raw would be tautological, so
    the gate validates against ``baseline`` — the checked-in prior registry — which is
    what gives "fails on unknown" teeth on re-import.

    ``baseline`` is a registries dict (as generated + checked in). Returns the number of
    references validated. The first unresolved reference raises with the offending
    affix + a locator.
    """
    names = set(baseline["affix_names"])
    types = set(baseline["bonus_types"])
    checked = 0
    for label, src in (("items", items), ("crafting", crafting), ("sets", sets)):
        for a in iter_affixes(src):
            nm, ty = a.get("name"), a.get("type")
            if isinstance(nm, str):
                if resolve_affix_name(nm, names, alias_map) is None:
                    raise IntegrityError(
                        f"unknown affix name {nm!r} in {label} not in the frozen registry "
                        f"(new-name event — regenerate + adjudicate)"
                    )
            if isinstance(ty, str) and ty not in types:
                raise IntegrityError(
                    f"unknown bonus type {ty!r} in {label} not in the frozen registry"
                )
            checked += 1
    return checked


# ------------------------------------------------------------------------- ambiguity lint

def _norm_collision(s):
    """Case + whitespace normalization ONLY (punctuation preserved, so ``Armor Class``
    and ``Armor Class (%)`` stay distinct)."""
    return re.sub(r"\s+", " ", s.strip()).lower()


def lint_affix_names(names, distinct_pairs=None):
    """Surface near-duplicate affix-name candidates. NEVER mutates data (KTD10).

    Returns a dict with:
      - ``collisions``: groups sharing a case/whitespace-normalized form (the BLOCKING
        class — genuine redundancy needing an alias decision).
      - ``prefix_pairs``: tight prefix pairs (the Insight/Insightful shape) — report only.
      - ``similar``: edit-similarity >= 0.90 pairs — report only, auto-seeded distinct.

    ``distinct_pairs`` (whitelisted) are excluded from ``prefix_pairs``/``similar`` so an
    adjudicated pair stops re-flagging.
    """
    distinct_pairs = distinct_pairs or set()
    names = sorted(set(names))

    # collisions (blocking)
    by_norm = {}
    for n in names:
        by_norm.setdefault(_norm_collision(n), []).append(n)
    collisions = {k: sorted(v) for k, v in by_norm.items() if len(v) > 1}

    # prefix pairs + similarity (report only)
    prefix_pairs, similar = [], []
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            if frozenset((a, b)) in distinct_pairs:
                continue
            if abs(len(a) - len(b)) > 2:
                continue
            al, bl = a.lower(), b.lower()
            if len(a) >= 4 and bl.startswith(al) and len(b) > len(a) and not b[len(a):len(a) + 1].isspace():
                prefix_pairs.append((a, b))
            elif difflib.SequenceMatcher(None, al, bl).ratio() >= 0.90:
                similar.append((a, b))
    return {"collisions": collisions, "prefix_pairs": prefix_pairs, "similar": similar}


# ------------------------------------------------------------------------------ freshness

class FreshnessError(ValueError):
    """Raised when the vendored raw mirror does not match the recorded upstream commit."""


def assert_freshness(expected_commit=None, source_path=SOURCE_PATH):
    """Assert the raw mirror's identity matches ``SOURCE.json``'s ``upstream_commit``.

    With no ``expected_commit`` this is a self-consistency read (returns the recorded
    commit). A caller that knows the intended commit passes it to detect drift.
    """
    src = _load(source_path)
    recorded = src.get("upstream_commit")
    if not recorded:
        raise FreshnessError("SOURCE.json has no upstream_commit")
    if expected_commit is not None and recorded != expected_commit:
        raise FreshnessError(
            f"raw mirror commit {recorded!r} != expected {expected_commit!r} — re-import"
        )
    return recorded
