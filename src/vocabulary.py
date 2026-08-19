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
AFFIX_SYNONYMS_PATH = os.path.join(RAW_DIR, "gearplanner_affix_synonyms.json")
AFFIX_SYNONYMS_REGISTRY_PATH = os.path.join(CURATED_DIR, "affix_synonyms_registry.json")

# The augment-stone pools share this key suffix (see crafting_catalog).
_AUGMENT_SLOT_SUFFIX = "Augment Slot"

# #374 / KTD1+KTD4 — the in-game enchantment names upstream flipped away from when
# it generalized its affix vocabulary (`Combustion` -> `Fire Spell Power`). We keep
# ours: the DDO wiki is this repo's source of truth and it uses the enchantment
# names, so an item tooltip and this app say the same words. These ten are the
# subset upstream also carries a FOLD for, which is what makes them protected
# rather than merely renamed — a fold applies itself, a rename does not. Nothing
# may fold one of these AWAY; see `_suppressed_upstream_folds`.
#
# The other three defended names (`Damage to helpless enemies`,
# `Legendary Conditioning`, `Enhanced Ki`) are rename-only: upstream carries no
# fold keyed on them, so they need no suppression. Keep this set to the folded
# subset — widening it to every corrected name would suppress folds that were
# never a threat.
PROTECTED_CANON = frozenset({
    "Combustion", "Devotion", "Nullification", "Glaciation", "Impulse",
    "Magnetism", "Resonance", "Corrosion", "Void Lore", "Ice Lore",
})


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


def load_live_affix_synonyms(path=None):
    """The VENDORED upstream affix-synonyms table (gear-planner
    ``site/src/assets/affix-synonyms.json``), refreshed on a re-import."""
    return _load(path or AFFIX_SYNONYMS_PATH)


def _synonym_folds(table):
    """Normalize either table shape into ``{synonym: canonical}``.

    Accepts the upstream list (``[{"name": …, "synonyms": [...]}, …]``) or the
    frozen registry dict wrapping the same list under ``affix_synonyms``. Keying
    by SYNONYM (not canonical) is what makes a re-point detectable: moving a
    synonym between canonicals leaves both the entry count and the mapping count
    unchanged, so a count-only check would pass while the mechanic quietly
    relocated under a different stat.
    """
    entries = table.get("affix_synonyms", []) if isinstance(table, dict) else (table or [])
    folds = {}
    for e in entries:
        canonical = e.get("name")
        for syn in e.get("synonyms") or []:
            folds[syn] = canonical
    return folds


def _local_synonym_folds(table):
    """``{synonym: canonical}`` from the registry's ``local_affix_synonyms``
    section — REPO-reviewed folds upstream does not carry (#305 added the
    helpless-damage family; evidence cited per entry in the registry file).

    Kept out of ``_synonym_folds`` deliberately: that normalizer feeds the U6
    live-vs-frozen gate, which diffs the UPSTREAM section only. Merging local
    entries there would make every repo addition read as a dropped-fold event.

    A local synonym that collides with an upstream fold key raises — two
    sections silently disagreeing on where a spelling folds is exactly the
    re-pointed-fold hazard the U6 gate exists to catch."""
    entries = table.get("local_affix_synonyms", []) if isinstance(table, dict) else []
    upstream = _synonym_folds(table)
    folds = {}
    for e in entries:
        canonical = e.get("name")
        for syn in e.get("synonyms") or []:
            if syn in upstream and upstream[syn] != canonical:
                raise IntegrityError(
                    f"local affix synonym {syn!r} -> {canonical!r} collides with the "
                    f"upstream fold {syn!r} -> {upstream[syn]!r} — one spelling may "
                    f"not fold two ways")
            folds[syn] = canonical
    return folds


def _suppressed_upstream_folds(folds):
    """Drop every upstream fold whose KEY is one of our protected canon names.

    #374/KTD4 — upstream flipped its affix vocabulary to generic names, so its
    table now reads ``Combustion -> Fire Spell Power``: our canon on the SYNONYM
    side. ``registry_synonym_folds`` is applied single-pass by the Dino parse seam
    (``src/dino_parser.py``), so a Dino set stat literally named ``Combustion``
    would fold AWAY from the canon the rest of the pipeline mints, and
    ``check_set_records_spelling`` would then raise because the output is itself a
    fold key.

    Suppress rather than invert. A local INVERSE fold does not fix this and makes
    it worse: ``_local_synonym_folds``' collision guard compares synonym KEYS, and
    an inverse fold's key is upstream's canonical, so it does not collide — both
    directions then survive in the merged map as a 2-cycle, splitting one mechanic
    across two buckets by whichever spelling a record happened to carry. That is
    the same silent under-credit class as #376.

    Keyed on membership in ``PROTECTED_CANON`` rather than an explicit suppression
    list, so a future refresh cannot leave a flipped fold behind by omission.
    """
    return {syn: canon for syn, canon in folds.items()
            if syn not in PROTECTED_CANON}


def registry_synonym_folds(path=AFFIX_SYNONYMS_REGISTRY_PATH):
    """Public ``{synonym: canonical}`` fold map from the FROZEN checked-in
    affix-synonym registry (U4): the upstream ``affix_synonyms`` section merged
    with the repo-reviewed ``local_affix_synonyms`` section (#305). The private
    ``_synonym_folds`` normalizer feeds only the referential-integrity gate
    above (upstream section only, by design); pipeline channels that need to
    APPLY a fold to a parsed stat name (rather than diff two tables) read this.
    Reviewed mappings only — the registry is frozen, so a fold appearing here has
    already been confirmed as the same game mechanic (see ``check_affix_synonyms``).

    #374/KTD4 — upstream folds keyed on one of OUR canon names are suppressed
    here (``_suppressed_upstream_folds``). Deliberately NOT in ``_synonym_folds``:
    that normalizer feeds the live-vs-frozen gate, which must keep seeing
    upstream's table verbatim or a flip would stop being a reviewable event.
    """
    table = _load(path)
    folds = _suppressed_upstream_folds(_synonym_folds(table))
    folds.update(_local_synonym_folds(table))
    return folds


def check_local_synonym_staleness(table, exact_names, free_text):
    """Fail when a declared ``local_affix_synonyms`` synonym matches NOTHING.

    The ``assert_all_reached`` equivalent this section never had. A local fold is
    a repo-reviewed rewrite of a spelling the corpus actually carries; once the
    spelling leaves the corpus the fold is a silent no-op pinning a rewrite nobody
    is applying — the exact staleness ``name_corrections`` fails loudly on. #374
    makes that urgent: upstream's consolidation of the helpless family retires
    most of the #305 spellings in one refresh, with nothing to say so.

    Two match modes, because the fold reaches two shapes of channel:
      * ``exact_names`` — structured affix ``name`` / ``stat`` values. Exact
        equality, never substring: ``Damage vs. Helpless`` is a prefix of
        ``Damage vs. Helpless Opponents``, so substring matching here would let a
        longer sibling vouch for a retired spelling.
      * ``free_text`` — verbatim wiki tier text the Dino seam parses. Substring,
        because the spelling is embedded in a sentence there.

    An entry may declare ``unmatched_synonyms``: spellings knowingly absent from
    today's corpus, each of which must ALSO be listed in ``synonyms``. The
    allowlist is two-directional — an allowlisted spelling that starts matching
    again fails too, so it cannot rot into a permanent exemption.

    Refuses to vouch for an empty corpus. Returns the number of synonyms checked.
    """
    entries = table.get("local_affix_synonyms", []) if isinstance(table, dict) else []
    exact = set(exact_names or ())
    texts = [t for t in (free_text or ()) if isinstance(t, str)]
    if not exact and not texts:
        raise IntegrityError(
            "local affix-synonym staleness guard: empty corpus — zero names and "
            "zero free text is a guard failure, not a pass")

    def _matches(syn):
        return syn in exact or any(syn in t for t in texts)

    problems, checked = [], 0
    for e in entries:
        canonical = e.get("name")
        allowed = list(e.get("unmatched_synonyms") or [])
        declared = list(e.get("synonyms") or [])
        for syn in allowed:
            if syn not in declared:
                problems.append(
                    f"{syn!r} is listed under unmatched_synonyms for {canonical!r} "
                    "but is not a declared synonym — the allowlist may only "
                    "excuse spellings the fold actually carries")
        for syn in declared:
            checked += 1
            hit = _matches(syn)
            if hit and syn in allowed:
                problems.append(
                    f"{syn!r} -> {canonical!r} is allowlisted as unmatched but the "
                    "corpus carries it again — drop it from unmatched_synonyms")
            elif not hit and syn not in allowed:
                problems.append(
                    f"{syn!r} -> {canonical!r} matches nothing in the corpus — the "
                    "spelling left upstream, so this local fold is a silent no-op; "
                    "retire it or record it under unmatched_synonyms with evidence")
    if problems:
        raise IntegrityError(
            "local affix-synonym registry is stale:\n  " + "\n  ".join(problems))
    return checked


def armed_canon_variants(items=None, crafting=None, sets=None, alias_map=None):
    """The alias entries upstream has ARMED against our canon, by direct predicate.

    KTD3 — an alias is armed when both halves of the Rule A test hold against the
    raw snapshot on disk:

      * the VARIANT is gate-visible (``iter_affixes`` sees it — name + type +
        value together, the same walk ``check_referential_integrity`` uses), and
      * the CANONICAL is absent from ``generate_registries()`` over that same raw.

    That pair is exactly "upstream now emits this spelling and no longer emits
    ours", which is the state in which a picker alias resolves to a name the
    frozen registry cannot contain and a solver priority scores zero. Derived from
    the data every time rather than hand-listed: a hand-list is right once and
    rots at the next refresh, silently.

    Returns ``{variant: canonical}``.
    """
    items, crafting, sets = _sources(items, crafting, sets)
    if alias_map is None:
        alias_map, _distinct = load_affix_aliases()
    names = set(generate_registries(items, crafting, sets)["affix_names"])
    visible = set()
    for src in (items, crafting, sets):
        for a in iter_affixes(src):
            if isinstance(a.get("name"), str):
                visible.add(a["name"])
    return {variant: canonical for variant, canonical in alias_map.items()
            if variant in visible and canonical not in names}


def check_affix_synonyms(live, frozen):
    """Referential-integrity gate for upstream's affix-synonym table (U6), against
    the FROZEN checked-in registry. Upstream folds several distinct game mechanics
    under one affix name; ``Speed`` <- ``Striding`` is the fold that produced #154
    (Striding grants movement only, the Speed enchantment also grants melee/ranged
    attack speed, and collapsing them dropped the attack-speed half silently).

    Any added, removed, or re-pointed fold raises ``IntegrityError`` naming both
    sides, so the reviewer's question is concrete: are these the same mechanic?
    Confirming one means re-freezing the registry in the same commit that handles
    the consequences. Non-mutating; returns the count of folds validated."""
    live_folds = _synonym_folds(live)
    frozen_folds = _synonym_folds(frozen)

    for syn in sorted(set(live_folds) - set(frozen_folds)):
        raise IntegrityError(
            f"upstream now folds {syn!r} into {live_folds[syn]!r}, a mapping absent from "
            f"the frozen affix-synonym registry (new-fold event). Confirm the two names "
            f"are the same game mechanic before re-freezing — a wrong fold silently "
            f"merges two stats, which is how #154 happened.")

    for syn in sorted(set(frozen_folds) - set(live_folds)):
        raise IntegrityError(
            f"upstream no longer folds {syn!r} into {frozen_folds[syn]!r} (dropped-fold "
            f"event). Items carrying {syn!r} may now parse under their own name.")

    for syn in sorted(set(live_folds) & set(frozen_folds)):
        if live_folds[syn] != frozen_folds[syn]:
            raise IntegrityError(
                f"upstream re-pointed {syn!r} from {frozen_folds[syn]!r} to "
                f"{live_folds[syn]!r} (re-pointed-fold event). The mapping count is "
                f"unchanged, so only a per-synonym diff catches this.")

    return len(live_folds)


# ------------------------------------------------------------------------- curated tables

def _distinct_pair(entry):
    """A ``distinct`` entry is either a bare 2-name list (``["A", "B"]``) or a
    reason-carrying object (``{"pair": ["A", "B"], "reason": "co-occurs on …"}``).
    Both yield the same ``frozenset`` key — the reason is documentation only."""
    if isinstance(entry, dict):
        return frozenset(entry.get("pair", []))
    return frozenset(entry)


def load_affix_aliases(path=AFFIX_ALIASES_PATH):
    """Return ``(alias_map, distinct_pairs)`` from the curated affix table.

    ``alias_map``: ``{variant_name: canonical_name}``.
    ``distinct_pairs``: set of frozenset pairs whitelisted as genuinely different.
    Distinct entries accept both the bare ``["A","B"]`` shape and the reason-carrying
    ``{"pair":["A","B"],"reason":…}`` shape (the co-occurrence detector emits the latter).
    """
    data = _load(path)
    alias_map = {e["variant"]: e["canonical"] for e in data.get("aliases", [])}
    distinct = {_distinct_pair(p) for p in data.get("distinct", [])}
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
    """Case + whitespace normalization ONLY. Punctuation — crucially the ``%`` / ``(%)``
    value-unit marker — is PRESERVED (U6.5 defense #3), so ``Armor Class`` and
    ``Armor Class (%)`` (flat vs percent) normalize DIFFERENTLY and never collide. The
    normalizer must never strip ``%``: a percent affix is a distinct stat, not a variant."""
    return re.sub(r"\s+", " ", s.strip()).lower()


# A value-unit marker: a trailing "(%)" or "%" that turns a flat stat into a percentage
# one (``False Life`` -> ``False Life (%)``). It is SIGNIFICANT — two names that differ
# only by this marker are DISTINCT stats, never merge candidates (U6.5 defense #3).
_UNIT_MARKER_RE = re.compile(r"\s*\(?%\)?\s*$")


def _strip_unit_marker(s):
    return _UNIT_MARKER_RE.sub("", s.strip())


def name_unit(name):
    """Classify a name's value unit: ``"pct"`` if it carries a ``%`` / ``(%)`` marker,
    else ``"flat"``. Used by the evidence bundle and the flat-vs-percent distinctness guard."""
    return "pct" if "%" in (name or "") else "flat"


def differ_only_by_unit_marker(a, b):
    """True when ``a`` and ``b`` are the same name except one carries a ``%``/``(%)`` unit
    marker (``Armor Class`` vs ``Armor Class (%)``). Such a pair is ALWAYS distinct."""
    if _norm_collision(a) == _norm_collision(b):
        return False  # identical after normalization — not a unit-marker difference
    return _norm_collision(_strip_unit_marker(a)) == _norm_collision(_strip_unit_marker(b))


def _a_prefix_of_b(a, b, allow_space=False):
    """``a`` (lowercased) is a leading prefix of ``b`` (lowercased), with ``a`` at least 4
    chars and strictly shorter. ``allow_space=False`` (the lint's tight-prefix rule) rejects
    a word-boundary prefix (``Freezing`` vs ``Freezing Ice``); ``allow_space=True`` (the
    co-occurrence detector) accepts it, because co-occurrence already proves distinctness."""
    al, bl = a.lower(), b.lower()
    if len(a) >= 4 and bl.startswith(al) and len(b) > len(a):
        return allow_space or not b[len(a):len(a) + 1].isspace()
    return False


def _edit_similar(a, b, threshold=0.90):
    """Edit-similarity ratio ``>=`` threshold (the lint's ``Blood Rage``/``Bloodrage`` rule)."""
    return difflib.SequenceMatcher(None, a.lower(), b.lower()).ratio() >= threshold


def _string_similar_kind(a, b, *, cooccur=False):
    """Shared similarity classifier reused by both the lint and the co-occurrence detector.

    Returns ``"collision"`` | ``"prefix"`` | ``"similar"`` | ``None``. A ``%``/``(%)`` unit
    difference is short-circuited to ``None`` (flat-vs-percent is DISTINCT, never a candidate).
    ``cooccur=False`` reproduces the report-only lint's shape (length-diff<=2 guard, tight
    prefix). ``cooccur=True`` relaxes both — it drops the length guard and accepts a
    word-boundary prefix — because same-item co-occurrence is itself proof of distinctness.
    """
    if differ_only_by_unit_marker(a, b):
        return None
    if _norm_collision(a) == _norm_collision(b):
        return "collision"
    if not cooccur and abs(len(a) - len(b)) > 2:
        return None
    if _a_prefix_of_b(a, b, allow_space=cooccur) or _a_prefix_of_b(b, a, allow_space=cooccur):
        return "prefix"
    if _edit_similar(a, b):
        return "similar"
    return None


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

    # prefix pairs + similarity (report only). A ``%``/``(%)`` unit difference is NEVER a
    # candidate (flat-vs-percent is distinct); ``_a_prefix_of_b``/``_edit_similar`` are the
    # same primitives the co-occurrence detector reuses.
    prefix_pairs, similar = [], []
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            if frozenset((a, b)) in distinct_pairs:
                continue
            if abs(len(a) - len(b)) > 2:
                continue
            if differ_only_by_unit_marker(a, b):
                continue
            if _a_prefix_of_b(a, b):
                prefix_pairs.append((a, b))
            elif _edit_similar(a, b):
                similar.append((a, b))
    return {"collisions": collisions, "prefix_pairs": prefix_pairs, "similar": similar}


# --------------------------------------------------- U6.5 co-occurrence distinctness detector

def _item_affix_names_by_item(items):
    """Yield ``(item_name, sorted_unique_affix_names)`` for each item. Affix names are read
    directly (any ``{"name": …}`` in ``affixes``), INCLUDING type-less names like
    ``Impactful`` that ``iter_affixes`` skips — the detector needs the full on-item name set."""
    item_list = items.get("items", items) if isinstance(items, dict) else items
    for it in item_list or []:
        if not isinstance(it, dict):
            continue
        names = {a["name"] for a in (it.get("affixes") or [])
                 if isinstance(a, dict) and isinstance(a.get("name"), str)}
        yield it.get("name"), sorted(names)


def detect_cooccurring_distinct(items=None, existing=None):
    """Auto-classify string-similar affix-name pairs that CO-OCCUR on the same item as
    DISTINCT (U6.5 defense #2). An item never lists one affix twice, so same-item
    co-occurrence is proof the two names are different stats — never a redundancy to merge.

    Reuses the lint similarity logic in its relaxed (``cooccur=True``) form: normalized-form
    collision, word-boundary prefix, or edit-similarity >= 0.90, with no length-diff guard.
    Verified real pairs it captures: ``Frost``/``Frostbite``, ``Freezing``/``Freezing Ice``,
    ``Impact``/``Impactful``, and ``Blood Rage``/``Bloodrage`` (both are separate ``Bool``
    affixes on "Legendary Dagger of the Liturgist" — proving they are NOT the redundancy the
    plan's example assumed).

    Returns a sorted list of ``{"pair": [a, b], "reason": "co-occurs on <item>"}`` records,
    deterministic and REPORT-ONLY (it never writes). Pass ``existing`` (a set of frozenset
    pairs already whitelisted) to omit already-adjudicated pairs. """
    items = _load(ITEMS_PATH) if items is None else items
    existing = existing or set()
    found = {}  # frozenset -> (a, b, first-item)
    for item_name, names in _item_affix_names_by_item(items):
        for i, a in enumerate(names):
            for b in names[i + 1:]:
                key = frozenset((a, b))
                if key in existing or key in found:
                    continue
                if _string_similar_kind(a, b, cooccur=True):
                    found[key] = (a, b, item_name)
    out = []
    for a, b, item_name in sorted(found.values()):
        out.append({"pair": [a, b], "reason": f"co-occurs on {item_name}"})
    return out


# --------------------------------------------------------------- U6.5 evidence bundle (report)

def evidence_bundle(items=None, names=None, distinct_pairs=None):
    """Evidence for adjudicating each lint candidate — REPORT ONLY, never mutates data
    (U6.5 defense #4). For each near-duplicate pair the lint surfaces, attach the facts a
    human (or a future run) needs to rule same-vs-distinct without guesswork:

      * ``cooccurs`` / ``cooccur_item`` — do the two names appear on the SAME item? (proof
        of distinctness if yes)
      * ``units`` — ``pct``/``flat`` for each name (a flat-vs-percent split is distinct)
      * ``bonus_types`` — the set of stacking ``type`` tokens each name is observed with
      * ``counts`` — how many affix occurrences carry each name

    Returns ``{"candidates": [ … ]}`` sorted deterministically. """
    items = _load(ITEMS_PATH) if items is None else items
    if names is None:
        names = generate_registries(items=items)["affix_names"]
    distinct_pairs = distinct_pairs or set()

    # occurrence counts + observed bonus-type set per name (from the full on-item affix walk)
    counts, types_seen = {}, {}
    item_list = items.get("items", items) if isinstance(items, dict) else items
    cooccur = {}  # frozenset -> item name
    for it in item_list or []:
        if not isinstance(it, dict):
            continue
        on_item = set()
        for a in it.get("affixes") or []:
            if not isinstance(a, dict) or not isinstance(a.get("name"), str):
                continue
            nm = a["name"]
            counts[nm] = counts.get(nm, 0) + 1
            ty = a.get("type")
            if isinstance(ty, str):
                types_seen.setdefault(nm, set()).add(ty)
            on_item.add(nm)
        on_sorted = sorted(on_item)
        for i, x in enumerate(on_sorted):
            for y in on_sorted[i + 1:]:
                cooccur.setdefault(frozenset((x, y)), it.get("name"))

    # Surface ALL near-duplicate candidates (empty whitelist) so already-adjudicated pairs
    # still carry their evidence; ``adjudicated_distinct`` records the current ruling.
    lint = lint_affix_names(names, set())
    pairs = list(lint["prefix_pairs"]) + list(lint["similar"])
    for grp in lint["collisions"].values():
        for i, a in enumerate(grp):
            for b in grp[i + 1:]:
                pairs.append((a, b))

    candidates = []
    for a, b in sorted(set(map(lambda p: tuple(sorted(p)), pairs))):
        item = cooccur.get(frozenset((a, b)))
        candidates.append({
            "pair": [a, b],
            "cooccurs": item is not None,
            "cooccur_item": item,
            "units": {a: name_unit(a), b: name_unit(b)},
            "bonus_types": {a: sorted(types_seen.get(a, set())),
                            b: sorted(types_seen.get(b, set()))},
            "counts": {a: counts.get(a, 0), b: counts.get(b, 0)},
            "adjudicated_distinct": frozenset((a, b)) in distinct_pairs,
        })
    return {"candidates": candidates}


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


# --- U2 (plan 2026-08-05-002, #134) — sibling differencing for numeric-suffix pools ---
#
# Crafting-pool options often come in tiers distinguished ONLY by a numeric suffix
# ("Topaz of Swiftness 5% / 10% / 15%"). Those are separate records, not tier variants
# of one item, so the variant-family machinery (source_item + tier_label) groups none
# of them and a sibling missing an affix its peers carry goes unnoticed.
#
# REPORT ONLY. A finding is a candidate for wiki confirmation, never an automatic
# correction — a sibling legitimately gaining an affix at a higher tier is normal, and
# the #134 investigation proved the point: the wiki did NOT corroborate the reported
# Topaz gap, so an auto-correcting version of this would have written a bad value.
# Deliberately not wired into build_dataset.py: a finding never fails the build.

_SUFFIX_RE = re.compile(r"^(?P<base>.*?)[\s\-]*(?P<num>[+-]?\d+(?:\.\d+)?)\s*%?$")


def sibling_family_key(name: str):
    """The family a numeric-suffix option belongs to, or None if it has no suffix.

    "Topaz of Swiftness 15%" -> "Topaz of Swiftness". A name whose digits are not a
    trailing suffix ("Docent of Quickening", "Litany of the Dead II") returns None, so
    it can never be grouped with an unrelated option.
    """
    n = (name or "").strip()
    if not n:
        return None
    m = _SUFFIX_RE.match(n)
    if not m:
        return None
    base = m.group("base").strip().rstrip("-").strip()
    return base or None


def sibling_affix_gaps(pool_options):
    """Report options missing an affix name their numeric-suffix siblings carry.

    ``pool_options`` is an iterable of ``{"name": str, "affixes": [{"name": ...}]}``
    (the native crafting-pool shape). Returns a list of findings sorted for
    determinism, each ``{family, option, missing, siblings_with_it}``.

    Families of one produce nothing — there is no peer to differ from.
    """
    families = {}
    for opt in pool_options or []:
        fam = sibling_family_key((opt or {}).get("name"))
        if not fam:
            continue
        affixes = {(a or {}).get("name") for a in (opt.get("affixes") or [])}
        families.setdefault(fam, []).append((opt.get("name"), {a for a in affixes if a}))

    findings = []
    for fam, members in sorted(families.items()):
        if len(members) < 2:
            continue
        union = set()
        for _, affixes in members:
            union |= affixes
        for opt_name, affixes in sorted(members):
            missing = union - affixes
            for affix in sorted(missing):
                holders = sorted(n for n, a in members if affix in a)
                findings.append({
                    "family": fam,
                    "option": opt_name,
                    "missing": affix,
                    "siblings_with_it": holders,
                })
    return findings


# --- #211: the umbrella-affix detector -----------------------------------------
#
# `web/model.js` credits an affix only when its NAME matches a ranked target, so
# an affix granting exactly what the player asked for under a different name
# contributes zero, silently. Eight families were discovered that way, each
# after a player report (#205's post-mortem is the ruling). This is the
# sibling-family idea on the name axis: when a registered expansion family's
# components share a head-word (`... Focus`, `... Absorption`, `... Save`), any
# OTHER rankable name ending in that head-word is a candidate umbrella — plus a
# name-shape complement for the `All `/`Universal `/`Elemental `/` Mastery`
# spellings that have no sibling family yet.
#
# A candidate is a REVIEW QUEUE entry, never an auto-expansion: `Universal
# Spell Lore` genuinely stacks with element lores (docs/wiki-evidence/
# spell-lore.md), so collapsing on name shape would be a regression. Every
# candidate must resolve to either a registered mechanism (expansion family,
# cross-add source — recognized automatically) or a curated `atomic` ruling
# with the rendered-tooltip evidence (data/seed/compendium/
# umbrella_adjudications.json). An unresolved candidate FAILS THE BUILD, the
# way `_KNOWN_SET_BONUS_ORPHANS` stays empty by design.

UMBRELLA_ADJUDICATIONS_PATH = os.path.join(
    CURATED_DIR, "umbrella_adjudications.json")

# The name-shape complement. Strictly weaker than the sibling axis (catches
# `Spell Focus Mastery`, misses bare `Spell Focus`) but the only signal for a
# family-less umbrella. Case-sensitive against canonical names.
_UMBRELLA_SHAPE_RE = re.compile(r"^(All |Universal |Elemental )|( Mastery$)", re.I)


def pool_affix_names(pools, set_defs=()):
    """Every affix name a crafting pool or set-definition channel carries.

    The detector's universe must be the PICKER's, and the picker unions worn
    names with every pool AND the set-def channels — `all Saving Throws` lives
    only on set tiers and escaped the first sweep because this walk stopped at
    the pools. Atomic records carry `affixes`; flat records carry `stat`.
    """
    out = set()
    for pool in pools or ():
        for rec in pool or []:
            affs = rec.get("affixes") or ([rec] if rec.get("stat") else [])
            for a in affs:
                n = a.get("stat") or a.get("name")
                if n:
                    out.add(n)
    for defs in set_defs or ():
        for entry in (defs or {}).values():
            for tier in entry.get("tiers") or []:
                for a in tier.get("affixes") or []:
                    n = a.get("stat") or a.get("name")
                    if n:
                        out.add(n)
    return out


def _head_word(name: str):
    parts = (name or "").split()
    return parts[-1] if parts else ""


def umbrella_candidates(rankable, family_components, modeled):
    """The names the detector flags for adjudication, sorted.

    `rankable` — the picker's rankable affix names (post-expansion, so a name a
    family already expands away never appears). `family_components` — every
    component stat a registered expansion family emits; their head-words define
    the sibling axes. `modeled` — lowercased names already resolved by a
    registered mechanism (expanded-away keys, cross-add sources): recognized as
    handled without an adjudication entry.
    """
    components = set(family_components or ())
    heads = {_head_word(c) for c in components if _head_word(c)}
    modeled_lower = {(m or "").strip().lower() for m in (modeled or ())}
    out = []
    for name in sorted(set(rankable or ())):
        if name in components:
            continue
        if (name or "").strip().lower() in modeled_lower:
            continue
        # ANY word, not just the last: `Spell Focus Mastery` must be caught by
        # the Focus family's axis even though its final word is `Mastery` —
        # last-word matching would have missed exactly the #205 name this
        # detector exists to catch.
        by_head = any(w in heads for w in (name or "").split())
        by_shape = bool(_UMBRELLA_SHAPE_RE.search(name or ""))
        if by_head or by_shape:
            out.append({"name": name,
                        "signal": "head-word" if by_head else "name-shape"})
    return out


def check_umbrella_adjudications(candidates, adjudications, rankable):
    """Resolve the queue against the curated rulings; report, raising on drift.

    Raises SystemExit when a candidate has no ruling (the latent-bug state this
    detector exists to close), when a ruling's disposition is outside the closed
    vocabulary, when an `atomic` ruling is missing its evidence, or when a
    ruling names a name that is no longer flagged (stale — the roster moved or
    a mechanism now covers it; retire the entry deliberately, never silently).
    """
    entries = (adjudications or {}).get("harvested") or {}
    flagged = {c["name"] for c in (candidates or [])}
    rankable_set = set(rankable or ())
    problems = []
    for name, entry in sorted(entries.items()):
        entry = entry or {}
        if entry.get("disposition") != "atomic":
            problems.append(
                f"{name}: unknown disposition {entry.get('disposition')!r} — the "
                "vocabulary is closed at ['atomic']; a name a mechanism models "
                "must NOT carry a seed entry (the registration resolves it)")
            continue
        if not entry.get("evidence") or not entry.get("harvested"):
            problems.append(
                f"{name}: atomic ruling is missing its evidence or harvested "
                "date — a ruling without the reading that proves it cannot be "
                "vouched for")
            continue
        if name not in flagged:
            where = ("no longer rankable" if name not in rankable_set
                     else "no longer flagged by any signal")
            problems.append(
                f"{name}: adjudication is stale ({where}) — retire or "
                "re-record the entry deliberately, never leave it asserting a "
                "ruling about a name the detector no longer asks about")
            continue
    unresolved = sorted(flagged - set(entries))
    if unresolved:
        problems.append(
            "unadjudicated umbrella candidates (each is a latent #205 until "
            "ruled): " + ", ".join(unresolved))
    if problems:
        raise SystemExit("umbrella detector failed:\n  " + "\n  ".join(problems))
    if not flagged:
        raise ValueError(
            "umbrella detector flagged zero candidates over a non-empty "
            "vocabulary — the signal set is broken, not clean")
    return {"candidates": len(flagged), "atomic": len(entries),
            "by_signal": {s: sum(1 for c in candidates if c["signal"] == s)
                          for s in ("head-word", "name-shape")}}
