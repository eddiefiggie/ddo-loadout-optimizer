#!/usr/bin/env python3
"""Dataset build pipeline for ddo-loadout-optimizer.

gear-planner is the sole item-data authority (the legacy base seed + wiki shards
were purged in U7). Reads the gear-planner raw mirror
(`data/seed/compendium/raw/gearplanner_{items,crafting,sets}.json`) and produces
`web/data/items.json`, the static dataset the web app fetches.

Pipeline: native gear-planner records (verbatim affix block) -> expand variants
(src.variants) -> per-affix verification gate + coverage (src.verify); crafting
families + augment pool sourced natively from the crafting catalog
(src.crafting_catalog).

Run:  python3 build_dataset.py
Output path is __file__-relative, so it works from any directory.
"""
from __future__ import annotations

import hashlib
import json
import os

from src.variants import expand_dataset
from src import verify as verify_mod
from src import colors as colors_mod
from src import set_parser as set_mod
from src import dino as dino_mod
from src import nearly_complete as nc_mod
from src import viktranium as vik_mod
from src import seal as seal_mod
from src import thunder_forged as tf_mod
from src import green_steel as gs_mod
from src import membership as membership_mod
from src import augment_sets as augment_sets_mod
from src import compendium as compendium_mod
from src import band_frontier as band_mod
from src import set_catalog as set_catalog_mod
from src import umbrella as umbrella_mod
from src import planner_items as planner_mod
from src import variants as variants_mod
from src import vocabulary as vocabulary_mod
from src import crafting_catalog as crafting_catalog_mod
from src import dino_native as dino_native_mod
import re as _re

import collections

HERE = os.path.dirname(os.path.abspath(__file__))
COMPENDIUM_DIR = os.path.join(HERE, "data", "seed", "compendium")
# Wildcard set-piece pools (Gem of Many Facets family) — a small wiki-sourced seed,
# since gear-planner carries 0 sets for the Gem (docs/wiki-evidence/gem-of-many-facets.md).
JOKER_SEED_PATH = os.path.join(HERE, "data", "seed", "joker_sets.json")
# Output lands inside web/ so that directory is a self-contained, deployable
# site root (GitHub Pages serves web/ as the root; the app fetches data/ relatively).
OUT_PATH = os.path.join(HERE, "web", "data", "items.json")

# Rankable-affix vocabulary constants (formerly src/vocab.py, purged in U7). The
# STAT_ALIASES canonicalization moved to the web picker (affix_aliases.json, U6.5);
# these two closed sets only gate which native affix NAMES surface as picker
# suggestions and are not a schema remap.
CORE_STATS = {
    "Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma",
    "Deadly", "Seeker", "Accuracy", "Dodge", "PRR", "MRR",
    "Physical Sheltering", "Magical Sheltering", "Fortification",
    "Melee Power", "Ranged Power", "Spell Power", "Doublestrike", "Doubleshot",
    "Sheltering", "Well Rounded", "False Life", "Healing Amplification",
    "Armor-Piercing", "Vitality", "Devotion", "Nullification", "Potency",
}
# Recognized-but-not-rankable bonus types: present on items but kept out of the
# picker vocabulary (a user never ranks a weapon-damage/penalty descriptor).
NON_RANKABLE_TYPES = {
    "Penalty", "Sneak Attack", "Bludgeoning", "Piercing", "Slashing",
    "Good", "Evil", "Lawful", "Chaotic",
}


GEARPLANNER_ITEMS_PATH = os.path.join(HERE, "data", "seed", "compendium", "raw", "gearplanner_items.json")
VOCAB_REGISTRIES_PATH = os.path.join(HERE, "data", "seed", "compendium", "vocab_registries.json")


def load_affix_vocabulary() -> tuple:
    """U5 — the affix-name registry + the variant->canonical alias table the web
    priority-picker consumes. The registry is the frozen checked-in affix-name
    vocabulary (``vocab_registries.json``); the alias map is the curated
    ``affix_aliases.json`` (``load_affix_aliases``). Emitting them to the dataset
    lets the picker canonicalize a typed/selected target to the ONE name gear,
    augments, and crafting all carry — so a single target matches every source.
    Deterministic (sorted list from a checked-in file; dict order from the file)."""
    registry = vocabulary_mod._load(VOCAB_REGISTRIES_PATH).get("affix_names", [])
    alias_map, _distinct = vocabulary_mod.load_affix_aliases()
    return registry, alias_map


def assert_crafting_vocab() -> int:
    """Referential-integrity gate for the crafting-slot + augment vocabularies
    (U2/R14/R12), against the FROZEN checked-in registries. Every gear-planner
    item `crafting[]` marker must resolve to the crafting-slot registry, and every
    augment stone in the `<Color> Augment Slot` pools to the augment registry — an
    unknown reference fails the build (new-slot/new-augment event). Non-mutating;
    returns the count of references validated."""
    with open(GEARPLANNER_ITEMS_PATH, encoding="utf-8") as fh:
        items = json.load(fh)
    crafting = crafting_catalog_mod.load_catalog()
    slot_reg = vocabulary_mod._load(vocabulary_mod.CRAFTING_SLOT_REGISTRY_PATH)
    aug_reg = vocabulary_mod._load(vocabulary_mod.AUGMENT_REGISTRY_PATH)
    return vocabulary_mod.check_crafting_integrity(items, crafting, slot_reg, aug_reg)


GAP_CORRECTIONS_PATH = os.path.join(HERE, "data", "seed", "gap_corrections.json")


def load_gap_corrections(path: str = GAP_CORRECTIONS_PATH) -> dict:
    """U7.5 — the sanctioned minimal exception to gear-planner sole-authority (U7).

    gear-planner's parser UNDER-parses a small number of collision items — it
    genuinely LACKS affixes those items really have (spot-validated against the
    live DDO wiki, e.g. Ophael's Cincture's all-ability-scores block). This overlay
    restores ONLY those genuinely-missing affixes, sourced from the retired
    hand-verified base seed. It does NOT restore affixes gear-planner already
    carries under a different type/synonym name — those "downgrades" were the
    correct removal of Insightful/Insight-class double-counts (U4b) and must stay.

    Returns `{item_name: [{name,type,value}, …]}` (the `_*` meta keys stripped).
    Missing file -> {} (the overlay is optional; the build stays deterministic)."""
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)
    return {k: v for k, v in raw.items() if not k.startswith("_")}


def apply_gap_corrections(records: list, corrections: dict) -> dict:
    """Apply the U7.5 gap-correction overlay ADDITIVELY and DETERMINISTICALLY.

    For each native record whose name is a correction key, APPEND the gap affixes
    to that record's native `affixes` — never overwrite an existing gear-planner
    affix. Anti-double-count guard: an overlay affix is SKIPPED when the record
    already carries that exact `(name, type)` (guards against re-introducing the
    double-counts U4b/U7 removed). Mutates `records` in place; returns a coverage
    dict (items corrected, affixes added, per-ML distribution, skipped count)."""
    by_name = {}
    for r in records:
        by_name.setdefault(r.get("name"), r)  # first wins (matches loader dedup)
    items_corrected = affixes_added = affixes_skipped = 0
    ml_distribution = collections.Counter()
    # Deterministic iteration: sorted by item name.
    for name in sorted(corrections):
        rec = by_name.get(name)
        if rec is None:
            continue  # correction targets an item not in the roster — no-op
        existing = {(a.get("name"), a.get("type"))
                    for a in rec.get("affixes") or []}
        added_here = 0
        for aff in corrections[name]:
            key = (aff.get("name"), aff.get("type"))
            if key in existing:
                affixes_skipped += 1  # anti-double-count: gear-planner already has it
                continue
            rec.setdefault("affixes", []).append(
                {"name": aff.get("name"), "type": aff.get("type"), "value": aff.get("value")})
            existing.add(key)
            added_here += 1
        if added_here:
            items_corrected += 1
            affixes_added += added_here
            ml_distribution[rec.get("ml")] += added_here
    return {
        "items_corrected": items_corrected,
        "affixes_added": affixes_added,
        "affixes_skipped_already_present": affixes_skipped,
        "ml_distribution": {str(k): v for k, v in sorted(
            ml_distribution.items(), key=lambda kv: (kv[0] is None, kv[0]))},
        "corrected_items": sorted(
            n for n in corrections if by_name.get(n) is not None),
    }


SOURCE_PROVENANCE_PATH = os.path.join(HERE, "data", "seed", "compendium", "raw", "SOURCE.json")


def load_source_provenance(path: str = SOURCE_PROVENANCE_PATH) -> dict:
    """Provenance of the gear-planner raw seeds: upstream repo + commit/date, import
    date, and the DDO official update the snapshot reflects. Surfaced into
    `metadata.provenance` so the dataset declares its freshness and game-version
    (a static snapshot goes stale ~1 day/day until re-imported). Missing -> {}."""
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)
    return {k: v for k, v in raw.items() if not k.startswith("_")}


def _is_numeric(v) -> bool:
    if isinstance(v, (int, float)):
        return True
    if isinstance(v, str):
        try:
            float(v.strip().rstrip("%"))
            return True
        except ValueError:
            return False
    return False


def _well_formed_stat(name: str) -> bool:
    """Reject names that are obviously leaked partial effect text rather than a
    stat: unbalanced parentheses/brackets (e.g. "Invisibility (Protection")."""
    return name.count("(") == name.count(")") and name.count("[") == name.count("]")


def rankable_affixes(planner_records) -> list:
    """Rankable-affix vocabulary: the affix names a user meaningfully ranks as a
    priority, read from the NATIVE gear-planner affix block. Filters: a magnitude
    bonus type (not Bool/boolean presence, not a non-rankable weapon/penalty
    descriptor), a numeric value, a well-formed name, and presence on at least two
    distinct items (a real stat is shared across gear; a one-off named proc is not).
    CORE_STATS are always included regardless of item count."""
    counts = collections.Counter()
    for r in planner_records or []:
        seen = set()
        for a in r.get("affixes") or []:
            bt = a.get("type")
            # Skip presence (Bool), non-rankable descriptors, and NULL/empty-typed
            # affixes — the latter are overwhelmingly weapon procs/banes (Holy,
            # Vampirism, ...), not rankable magnitude stats, so they stay out of the
            # picker suggestions (a user never ranks a proc).
            if bt in (None, "", "boolean", "Bool") or bt in NON_RANKABLE_TYPES:
                continue
            if not _is_numeric(a.get("value")):
                continue
            stat = a.get("name")
            if stat and _well_formed_stat(stat):
                seen.add(stat)
        counts.update(seen)
    names = {s for s, c in counts.items() if c >= 2}
    names |= set(CORE_STATS)
    return sorted(names)


def build() -> dict:
    """Transform the gear-planner authority into the optimizer dataset.

    gear-planner is the sole item-data source (legacy purged in U7). Pipeline:
    native gear-planner records -> expand variants (native affix block, verbatim)
    -> per-affix verification gate + coverage. The output `items` are variant
    records; each carries `affixes`, `verification`, and flags.
    `metadata.coverage` records per-slot verified/quarantined counts.
    """
    # U2/R14/R12 — crafting-slot + augment referential-integrity gate. Validate the
    # native item crafting[] markers + augment pools against the FROZEN checked-in
    # registries BEFORE assembling the dataset; an unknown slot/augment fails the
    # build (new-slot/new-augment event forcing a reviewed regenerate). Non-mutating.
    _crafting_vocab_checked = assert_crafting_vocab()
    # The active crafting families source their option pools NATIVELY from
    # gearplanner_crafting.json (the gear-planner crafting catalog). Load once and
    # thread it into each family builder.
    crafting = crafting_catalog_mod.load_catalog()
    # Seal types with a non-empty verified pool gate which "Sealed in X" hosts the
    # reader recovers from the raw dump (Undeath sourced; Mist/Gloom pending).
    _verified_seal_types = {r["seal_type"]
                            for r in seal_mod.build_seal(crafting)["records"]}
    # Dinosaur Bone hosts are synthetic bodies generated post-verify (dino_blanks
    # below); they never pass through the name dedup, so a same-name gear-planner
    # record would double-list with an identical variant_id (KTD8 trap). Build the
    # blanks now (from the native Dino host layout — src.dino_native, KTD8) and
    # exclude their names from the reader so the synthetic body is the sole host.
    dino_seed = dino_native_mod.native_dino_seed()
    dino_blanks, dino_inserts, dino_sets, dino_cov = dino_mod.build_dino(dino_seed, crafting)
    _host_pipeline_names = {b.get("source_item") for b in dino_blanks}
    # Native gear-planner records — the sole item roster. The loader already
    # dedups intra-dump same-name collisions (first wins) and surfaces every host
    # choice-slot marker (augment/seal/lamordia/nearly-complete/lost-purpose)
    # NATIVELY from crafting[], so no cross-source graft is needed.
    planner_records, planner_stats = planner_mod.load_planner_items(
        verified_seal_types=_verified_seal_types,
        exclude_names=_host_pipeline_names)
    # U7.5 — apply the wiki-validated gap-corrections overlay ADDITIVELY, in place,
    # BEFORE variant expansion so the restored affixes flow through verify/coverage
    # like any native affix. Sole sanctioned exception to gear-planner sole-authority
    # (restores only affixes gear-planner genuinely LACKS; anti-double-count guarded).
    _gap_corrections = load_gap_corrections()
    _gap_coverage = apply_gap_corrections(planner_records, _gap_corrections)
    enriched_items = planner_records

    # Set bonuses (native): attach the authoritative gear-planner catalog def to
    # each record carrying an "X (set)" marker (from its `sets[]`), matched on the
    # canonical name so cross-source spelling drift (the " Set" infix) resolves.
    _set_base_defs = {}  # no base seed anymore; all defs come from the catalog
    _set_catalog = set_catalog_mod.load_catalog()
    _KNOWN_UNDEFINED_SETS = ["Legendary Cooking By the Book"]  # novelty set, no catalog def
    _enriched_set_names = set()
    for it in enriched_items:
        if it.get("set_bonus"):
            continue  # already defined (shouldn't happen for enriched, but never override)
        seen_sets, defs = set(), []
        for e in it.get("enhancements", []):
            m = _re.match(r"^(.*) \(set\)$", str(e))
            if not m:
                continue
            name = m.group(1)
            _enriched_set_names.add(name)
            ckey = set_catalog_mod.canonical(name)
            if ckey in seen_sets:
                continue
            seen_sets.add(ckey)
            d = set_catalog_mod.definition_for(name, _set_base_defs, _set_catalog)
            if d is not None:
                defs.append(d)
        if defs:
            # Copy: definition_for may return the base-seed def by reference; never
            # share a mutable dict across the base item, co-members, and tier variants
            # (mirrors the seal-slot graft copy). Deep-copy piece_bonuses too.
            it["set_bonus"] = [{**d, "piece_bonuses": dict(d.get("piece_bonuses") or {})}
                               for d in defs]
    # Fail loudly on unresolved name drift (KTD4) rather than silently splitting a set.
    _set_problems = set_catalog_mod.reconciliation_audit(
        _set_base_defs, _set_catalog, _enriched_set_names, known_undefined=_KNOWN_UNDEFINED_SETS)
    if _set_problems:
        raise SystemExit("set-name reconciliation failed (unresolved drift): "
                         + "; ".join(p["canonical"] for p in _set_problems))
    _distinct_enriched_sets = {set_catalog_mod.canonical(s["set"])
                               for it in enriched_items for s in it.get("set_bonus") or []}
    _set_enrichment_coverage = {
        "enriched_members_with_set_bonus": sum(1 for it in enriched_items if it.get("set_bonus")),
        "distinct_enriched_sets": len(_distinct_enriched_sets),
        **set_catalog_mod.parse_rate(
            _set_catalog, [set_catalog_mod.canonical(n) for n in _enriched_set_names]),
        "known_undefined_sets": _KNOWN_UNDEFINED_SETS,
    }

    # Legendary augment pool — sourced NATIVELY from the `<Color> Augment Slot`
    # menu pools in gearplanner_crafting.json (one stone per option, native affix
    # block, color from the slot key). Replaces the retired augments.json seed.
    aug_pool = crafting_catalog_mod.augment_pool_records(crafting)
    variants = expand_dataset(enriched_items + aug_pool)  # native path (verbatim affixes)

    # Wildcard set pieces (Gem of Many Facets, U6): the item rolls ONE set from each of
    # two pools (rerollable; theoretical-BiS picks the best per group). The pools aren't
    # in gear-planner (0 sets for the Gem), so they come from the wiki-sourced joker seed.
    # Attach AFTER expand_dataset (variants rebuild from a fixed field list, so a base-seed
    # field would be dropped) and clear the item's stale fixed set_bonus BEFORE set
    # annotation runs below, so the joker is the item's only set contribution. Restores the
    # mechanic dropped as an accepted loss in #70 (per the user report; wiki-cited).
    _joker = {}
    if os.path.exists(JOKER_SEED_PATH):
        with open(JOKER_SEED_PATH, "r", encoding="utf-8") as _jfh:
            _joker = json.load(_jfh).get("items", {})
    for v in variants:
        si = v.get("source_item") or ""
        # A crafted-tier variant carries a " [Crafted]" suffix but is the same wildcard.
        spec = _joker.get(si) or _joker.get(si.replace(" [Crafted]", ""))
        if spec is None:
            continue
        v["joker_set_groups"] = [[set_catalog_mod.canonical(s) for s in group]
                                 for group in spec.get("groups", [])]
        v["set_bonus"] = []

    # Artifact item-quality flag: sourced NATIVELY — each gear-planner variant
    # already carries `artifact` (bool) from the dump, read through _make_variant.
    # No curated seed / stamp remains (verified: the retired artifacts.json seed
    # was exactly the native artifact set). The JS opt-in reads `artifact`.
    #
    # Alignment equip-gates: the curated seed held 0 real gates and model.js
    # eligible() is fail-open, so no gate is stamped (accepted no-op loss); the
    # eligible() branch stays live-but-inert (gear-planner carries no restriction
    # field). Wiki-confirmed override + the wildcard-set (Gem of Many Facets)
    # mechanic are removed (KTD4 / accepted loss, see the migration report).

    for v in variants:                                  # augment-color normalization
        colors_mod.annotate_variant(v)
        set_mod.annotate_variant(v)                     # U4 set-bonus threshold parsing
        # Bake each augment's compatible slot colors (the wiki matrix, applied once
        # here) so the JS solver does plain set-membership per slot — the matrix
        # never crosses into JS (U3). Colored augments fit multiple slot colors;
        # Colorless fits every colored slot; Moon/Sun fit only their own.
        if v.get("category") == "augment":
            ac = (v.get("aug_color") or {}).get("color")
            v["fits_slots"] = sorted(colors_mod.fits_slots(ac)) if ac else []
    # Expand umbrella ability affixes ("All Ability Scores +15", "Well Rounded")
    # into the six concrete abilities so single-ability targets get credited.
    umbrella_mod.expand_variants(variants)
    # Vecna Lost Purpose: the membership set defs come from the SAME set catalog that feeds
    # intrinsic set members (single source of truth), so an awakened Lost Purpose set gives the
    # identical bonus + stat vocabulary as an intrinsically-completed one. Attach the
    # chosen-set-membership slot (pool = same-tier Vecna sets that resolve to a def)
    # to every item carrying a `lost_purpose` tier marker.
    membership_defs = membership_mod.build_membership_set_defs(_set_catalog)  # reuse the catalog loaded above
    membership_mod.attach_lost_purpose_slots(variants, membership_defs)
    variants, cov = verify_mod.apply(variants)          # per-affix verification gate

    # U3 — Isle of Dread Dino crafting: append pre-verified blank host variants
    # (they carry typed Dino slots, no base affixes) and expose the insert pool
    # the solver places into those slots. Blanks are added AFTER verify so their
    # empty affix list does not quarantine them. (Built earlier so their host names
    # can be excluded from the gear-planner reader — see the merge above.)
    variants = variants + dino_blanks
    # U4 — Dino Set-Bonus: activate the chosen-set-membership slot on the Dinosaur
    # Bone Armor/Helmet/Cloak Set-Bonus hosts (added here, after verify, since the
    # blanks carry no base affixes). Same primitive as Vecna Lost Purpose; the 6 Dino
    # sets are self-seeded from the same catalog, crafted at the Dinosaur Bone station.
    membership_mod.attach_dino_set_bonus_slots(dino_blanks, membership_defs)

    # U2 — Augment Sets: stamp the 21 "Set Augment: X" Colorless augment variants
    # with their set linkage (canonical `set` name, `pieces_required`, and the
    # `set_augment` source-family marker) and flip them verified so they enter the
    # solve. Run AFTER verify (like the Dino blanks): a Set Augment ships an empty
    # affix list, so passing back through verify quarantines it; stamping verified
    # here makes the flip stick. The defs come from the SAME augment_sets seed that
    # the top-level `augment_set_defs` key (emitted below) exposes to the solver.
    augment_set_defs = membership_mod.build_augment_set_defs()
    augment_sets_mod.attach_augment_set_slots(variants, augment_set_defs)

    # U81 Nearly Complete: expose the parametric choice-slot effect pool. Items
    # carrying a `nearly_complete: <category>` field draw one option from it (host
    # items pending wiki; the pool + machinery ship now).
    nc = nc_mod.build_nearly_complete(crafting)

    # U75 (Chill of Ravenloft) Viktranium ("Lamordia") crafting: expose the typed choice-slot pool
    # keyed by (slot_type, item-category). Items carrying `lamordia_slots` draw
    # one option per slot from the matching pool (tier from host ML at solve time).
    vik = vik_mod.build_viktranium(crafting)

    # Seal-slot crafting ("Sealed in X"): expose the single-pick choice-slot pool
    # keyed by seal_type. Items carrying `seal_slots` unseal one option from the
    # matching pool. Undeath sourced (Ritual Table); Fire/Gloom/Mist pending.
    sl = seal_mod.build_seal(crafting)

    # Legendary Thunder-Forged (multi-tier choice-slot) + Green Steel (single-pick
    # choice-slot): expose the craftable option pools. Hosts carry the marker
    # (thunder_forged_tiers / green_steel_slot); the solver crafts the best option.
    # U2 (R6/A2): these pools DO exist in gearplanner_crafting.json (the earlier
    # "no pool / pending harvest" claim was wrong) — source them NATIVELY from the
    # crafting catalog (T*(Weapon) / T*(Equipment)). No wiki_url gate, no type
    # remap, no quarantine (F1). Host-marker surfacing (which items carry the slot)
    # lands with the native reader in U3; until then the pools are populated but
    # inert (no host references them), so the solver behavior is unchanged.
    tf = tf_mod.build_thunder_forged()
    gs = gs_mod.build_green_steel()

    # Compendium browse index (U6): derived from the NATIVE roster (the built
    # variants' own source_item + slot + wiki_url), not the legacy roster_*.json
    # wiki-harvest shards. Under single-source completeness every native item is
    # solver-active, so every indexed item is "enriched" — the old indexed-only
    # layer has collapsed (see src.compendium). Does not feed the solver.
    comp_records, comp_cov = compendium_mod.build_compendium(variants)
    comp_cov["enriched_items"] = len(enriched_items)
    # Surface the strict-provenance disclosure: how many wiki effects were recorded
    # as unmapped (never guessed) across the enriched batches.
    comp_cov["enriched_unmapped_effects"] = sum(
        len(it.get("_enrich_unmapped", [])) for it in enriched_items)
    # R4 ML30-36 endgame-band coverage (U6): per (expansion, slot) counts derived
    # from the NATIVE roster (items carry ml + slot + wiki_url). Under single-source
    # completeness every band item is solver-active ("enriched"); Isle of Dread is
    # attributed via the native Dino signal, the rest reported per-slot as
    # "unattributed" (the coarser attribution — see src.band_frontier).
    band_cov = band_mod.band_coverage(variants)
    # U81 Nearly-Complete hosts activated via enrichment (items carrying an open
    # NC 4th-affix slot the solver crafts into).
    nc["coverage"]["hosts_activated"] = sum(
        1 for it in enriched_items if it.get("nearly_complete"))
    # U75 (Chill of Ravenloft) Viktranium hosts activated across the whole item pipeline — enriched
    # items (via the {{Lamordia Slot}} template) AND base-seed items (via their
    # human-readable Lamordia strings). Counted from the final variants, deduped
    # by source item so tier variants of one host count once. Honest disclosure.
    vik_host_slots = {}
    for v in variants:
        if v.get("lamordia_slots"):
            vik_host_slots[v["source_item"]] = len(v["lamordia_slots"])
    vik["coverage"]["hosts_active"] = len(vik_host_slots)
    vik["coverage"]["slots_active"] = sum(vik_host_slots.values())

    # Seal-slot hosts, deduped by source item so tier variants count once. Honest
    # disclosure: a host is solver-ACTIVE only when it survives the verification
    # gate (a seal-only host with no base affixes is quarantined by the solver's
    # eligible() before the seal MILP runs) AND its seal_type has a sourced
    # (non-empty) pool. Everything else — an unsourced pool (Fire/Gloom/Mist
    # pending) or a quarantined seal-only host — is disclosed as PENDING, not
    # counted active, so the coverage note never overstates what the solver can craft.
    sourced_seals = set(sl["coverage"]["seal_types_sourced"])
    seal_active, seal_pending = {}, {}
    for v in variants:
        slots = v.get("seal_slots")
        if not slots:
            continue
        active_slots = [s for s in slots if s.get("seal_type") in sourced_seals]
        if active_slots and v.get("verification") == "verified":
            seal_active[v["source_item"]] = len(active_slots)
        else:
            seal_pending[v["source_item"]] = len(slots)
    sl["coverage"]["hosts_active"] = len(seal_active)
    sl["coverage"]["slots_active"] = sum(seal_active.values())
    sl["coverage"]["hosts_pending"] = len(seal_pending)

    # Augment pool coverage: legendary augments by intrinsic color (incl. Lunar/Solar).
    # The R5 wiki cross-check (augments the wiki has that the gear-planner lacks) is a
    # deferred harvest; disclosed as an empty delta with a note until it runs.
    aug_by_color = {}
    for a in aug_pool:
        c = colors_mod.normalize_color(a.get("slot")).get("color")
        if c:
            aug_by_color[c] = aug_by_color.get(c, 0) + 1
    augment_coverage = {
        "legendary_sourced": len(aug_pool),
        "by_color": dict(sorted(aug_by_color.items())),
        "source": "gear-planner crafting.json (intrinsic color); compatibility baked per-augment via the wiki matrix",
        "wiki_crosscheck_delta": [],
        "wiki_crosscheck_note": "wiki completeness cross-check (R5) is a deferred harvest",
    }

    # Catalog schema version (U1 / KTD5). build_id is computed below over the
    # full assembled dataset so a persisted loadout snapshot can detect a stale
    # catalog. Deterministic for unchanged input — same data rebuilds to the same
    # id — so staleness reflects real drift, not build-run noise.
    schema_version = 1

    # U5 — affix-name registry + alias table for the web priority-picker vocabulary.
    _affix_registry, _affix_aliases = load_affix_vocabulary()
    _provenance = load_source_provenance()

    out = {
        "metadata": {
            "title": "DDO Loadout Optimizer — dataset",
            "schema_version": schema_version,
            "source": _provenance.get("source_url") or _provenance.get("source", ""),
            "seed_generated": _provenance.get("imported", ""),
            "seed_count": len(planner_records),
            "variant_count": len(variants),
            "item_count": len(variants),
            "coverage": cov,
            "color_coverage": colors_mod.color_coverage(variants),
            "set_coverage": set_mod.set_coverage(variants),
            "set_enrichment_coverage": _set_enrichment_coverage,
            "dino_coverage": dino_cov,
            "nc_coverage": nc["coverage"],
            "viktranium_coverage": vik["coverage"],
            "seal_coverage": sl["coverage"],
            "thunder_forged_coverage": tf["coverage"],
            "green_steel_coverage": gs["coverage"],
            "membership_coverage": membership_mod.coverage(membership_defs),
            "augment_set_coverage": membership_mod.coverage(augment_set_defs),
            "augment_coverage": augment_coverage,
            "compendium_coverage": comp_cov,
            "band_coverage": band_cov,
            "provenance": _provenance,
            "crafting_vocab_coverage": {
                "crafting_slot_registry": len(vocabulary_mod._load(
                    vocabulary_mod.CRAFTING_SLOT_REGISTRY_PATH).get("crafting_slots", [])),
                "augment_registry": len(vocabulary_mod._load(
                    vocabulary_mod.AUGMENT_REGISTRY_PATH).get("augments", [])),
                "references_validated": _crafting_vocab_checked,
            },
            "planner_coverage": planner_stats,
            # U7.5 — wiki-validated gap-corrections overlay coverage (sanctioned
            # minimal exception to gear-planner sole-authority).
            "gap_corrections_coverage": _gap_coverage,
            "rankable_affixes": rankable_affixes(planner_records),
            # U5 — the shared affix-name registry + variant->canonical alias table.
            # The web picker unions every affix source (gear, augments, set bonuses,
            # ALL crafting pools) and canonicalizes each through the alias table, so a
            # selected target matches gear, augments, AND crafting by one canonical name.
            "affix_registry": _affix_registry,
            "affix_aliases": _affix_aliases,
            # U4b-i — stacking-equivalence map {native_type: stacks_as_bucket}.
            # gear-planner's native affix `type` IS the stacking bucket verbatim,
            # EXCEPT these curated pairs (e.g. "Insight Natural" -> "Insight") that do
            # not stack independently in-game and must share ONE bucket. The web layer
            # (dataset.js -> model.js/solver.js) canonicalizes the bucket KEY through
            # this map; the affix keeps its native type for display.
            "stacking_equivalence": vocabulary_mod.load_stacking_equivalence(),
            "pipeline_stage": "M4-compendium-roster",
        },
        "items": variants,
        "dino_inserts": dino_inserts,
        "dino_sets": dino_sets,
        "nearly_complete": nc["records"],
        # Per-item Nearly Complete pools (Nearly Finished / Almost There), keyed by
        # host name — a DISTINCT mechanism from the category path above (never
        # conflated). Browse/inventory visibility; not solver-wired.
        "nearly_complete_per_item": nc.get("per_item", {}),
        "viktranium": vik["records"],
        "seal": sl["records"],
        "thunder_forged": tf["records"],
        "green_steel": gs["records"],
        "membership_set_defs": membership_defs,
        # U2 — the 21 Augment-Set defs (3-piece Set Bonuses), same shape as
        # membership_set_defs. A later solver unit reads these together with each
        # verified "Set Augment: X" variant's `set` marker.
        "augment_set_defs": augment_set_defs,
        "compendium": comp_records,
    }

    # build_id hashes the full assembled dataset (everything except metadata) so
    # drift in sets, augments, or crafting inputs — not just base variants —
    # marks a saved snapshot stale.
    out["metadata"]["build_id"] = hashlib.sha256(
        json.dumps({k: v for k, v in out.items() if k != "metadata"},
                   sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()[:16]
    return out


def _native_affix(a: dict) -> dict:
    """Emit one variant affix in gear-planner's NATIVE shape (U3).

    The in-memory pipeline carries legacy `{stat, bonus_type, value:int, unit,
    raw, eligible}`; at rest each affix becomes `{name, type, value}` where
    `value` is the native STRING ("10", "9%", "-5") — a trailing "%" when the
    unit is pct. NO numeric value / unit / raw is persisted; the load-time
    normalizer (web/dataset.js) re-derives those by parsing the string. The
    per-affix `eligible` flag is carried through verbatim so eligibility
    semantics (verify) are unchanged."""
    val = a.get("value")
    native_value = f"{val}%" if a.get("unit") == "pct" else str(val)
    out = {"name": a.get("stat"), "type": a.get("bonus_type"), "value": native_value}
    if "eligible" in a:
        out["eligible"] = a["eligible"]
    return out


def _serialize_item(it: dict) -> dict:
    """A shallow copy of a variant with its `affixes` converted to native shape.
    Only `items[]` variant affixes go native (uniform across all sources); the
    other pools (dino_inserts, membership set defs, green_steel, …) keep their
    legacy structured shape and their own consumers, so they are untouched."""
    return {**it, "affixes": [_native_affix(a) for a in (it.get("affixes") or [])]}


def write(dataset: dict, path: str = OUT_PATH) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    # Serialize items with native affixes WITHOUT mutating the in-memory build
    # output (python tests inspect build()'s legacy-shaped dict directly).
    serialized = {**dataset,
                  "items": [_serialize_item(it) for it in dataset["items"]]}
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(serialized, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def main() -> None:
    dataset = build()
    write(dataset)
    print(
        f"Wrote {OUT_PATH}: {dataset['metadata']['item_count']} items "
        f"(gear-planner roster {dataset['metadata']['seed_count']})."
    )


if __name__ == "__main__":
    main()
