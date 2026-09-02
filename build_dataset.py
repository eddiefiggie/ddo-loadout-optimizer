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
import re

from src.variants import expand_dataset
from src import verify as verify_mod
from src import colors as colors_mod
from src import set_parser as set_mod
from src import dino as dino_mod
from src import adventure_packs as packs_mod
from src import crafting_lineage as lineage_mod
from src import dino_parser as dino_parser_mod
from src import nearly_complete as nc_mod
from src import viktranium as vik_mod
from src import seal as seal_mod
from src import thunder_forged as tf_mod
from src import green_steel as gs_mod
from src import essence_pool as essence_mod
from src import membership as membership_mod
from src import augment_sets as augment_sets_mod
from src import compendium as compendium_mod
from src import band_frontier as band_mod
from src import set_catalog as set_catalog_mod
from src import harvest as harvest_mod
from src import material as material_mod
from src import speed_split as speed_split_mod
from src import parrying_split as parrying_split_mod
from src import riposte_split as riposte_split_mod
from src import heightened_awareness as heightened_awareness_mod
from src import absorption_split as absorption_split_mod
from src import elemental_resistance_split as er_split_mod
from src import enchantment_split as enchantment_split_mod
from src import umbrella as umbrella_mod
from src import spell_focus as spell_focus_mod
from src import cross_add as cross_add_mod
from src import provenance as provenance_mod
from src import value_corrections as value_corrections_mod
from src import name_corrections as name_corrections_mod
from src import helpless_fold as helpless_fold_mod
from src import untyped_rankable as untyped_rankable_mod
from src import utility_procs as utility_procs_mod
from src import dr_qualifiers as dr_qualifiers_mod
from src import type_corrections as type_corrections_mod
from src import augment_acquirability as acquirability_mod
from src import conditional_quarantine as cond_quarantine_mod
from src import legendary_fold as legendary_fold_mod
from src import ml36_augments as ml36_augments_mod
from src import viktranium_pool_corrections as vik_pool_mod
from src import no_drop_source as no_drop_source_mod
from src import planner_items as planner_mod
from src import variants as variants_mod
from src import vocabulary as vocabulary_mod
from src import crafting_catalog as crafting_catalog_mod
from src import dino_native as dino_native_mod
from src import container_registry as container_registry_mod
from src import crafting_coverage as crafting_coverage_mod
from src import crafted_twins as crafted_twins_mod
from src import ring_exclusivity as ring_exclusivity_mod
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
    "Melee Power", "Ranged Power", "Doublestrike", "Doubleshot",
    "Sheltering", "Well Rounded", "False Life", "Healing Amplification",
    "Armor-Piercing", "Devotion", "Nullification", "Potency",
    # NOT here, deliberately — both were offered in the picker and could never score:
    #
    #   "Spell Power" — no item carries a bare "Spell Power"; the catalog stores the
    #     CONCRETE spell powers, and the ones worth ranking (Devotion, Nullification,
    #     Potency) are listed above. Do NOT "fix" this by adding the name to
    #     src/umbrella.py's _UMBRELLA — that set drives _expand_affix, so it would
    #     rewrite every matching affix into the six ability scores.
    #   "Vitality" — a bonus TYPE, not a stat name. It appears ~149 times as
    #     affixes[].type (the Vitality-typed False Life family) and zero times as an
    #     affix NAME, so ranking it was guaranteed zero. This is the collision
    #     documented in docs/solutions/logic-errors/bonus-type-vocabulary-collides-
    #     with-bare-stat.md. It stays on the curated `distinct` list so it is still
    #     never merged into False Life — that ruling is unchanged; it simply is not
    #     a rankable target.
    # U5 (#140) — minted by boolean-composite decomposition. `Concealment` appears
    # on no item affix directly; it is written onto items carrying Blurry / Lesser
    # Displacement at the web/dataset.js normalize seam (see
    # docs/wiki-evidence/boolean-composites.md). Without it here the components
    # would be written and still be unrankable, so the player could not ask for it.
    "Concealment",
    # Augment-only magnitude stats. `rankable_affixes` counts WORN items only, so a
    # real stat that happens to ship exclusively on augments reads to the heuristic
    # like a one-off weapon proc and is filtered out. Eldritch Blast Dice is the
    # clearest case: it is the Warlock damage stat (wiki: "Each additional 'Blast
    # Die' improves your base Eldritch Blast damage by 1d8"), it carries real
    # magnitudes and bonus types (Profane 1/3 on the Lunar gems, Artifact 1/3 on the
    # Solar), and it appears on four augments and zero worn items. Without this the
    # solver scores those gems at nothing, leaves the Sun slot empty, and still
    # reports the loadout as optimal — because no priority the player can express
    # maps to what the gem grants.
    #
    # This is one instance of a class: 36 magnitude stats are currently invisible for
    # the same reason. The rest are deliberately NOT added here — widening the gate
    # to count augment sources is the general fix and wants its own review.
    "Eldritch Blast Dice",
    # The rest of the same class — each ships on a purpose-built named gem whose
    # entire identity is granting that stat ("Solar Gem of Strikethrough", "Solar
    # Gem of Sneak Attack Dice"), in Heroic/Epic/Legendary tiers. That is the
    # opposite of the one-off weapon proc the two-item filter exists to reject; the
    # filter misses them because it counts WORN items and these reach gear by
    # other routes -- mostly augments, though Sneak Attack Dice also ships on
    # worn armor via the Dolorous/Fang crafting families, so widening the gate
    # to count augment sources alone would not cover every entry here.
    "Imbue Dice",                    # Ranger/Inquisitive analogue of Blast Dice
    "Strikethrough",
    "Sneak Attack Dice",
    "Sneak Attack Damage",
    "Missile Deflection",
    "Rune Arm DCs",
    # #672 — the wiki's name for this enchantment. `Lunar_and_Solar_Gems` states the
    # Solar Gem grants a "Legendary Bonus to Spell Critical Damage" (+5/+10/+15), and
    # five set tiers already store that exact name at the same bonus type. gear-planner
    # engraves the gems' affix `Spell Intensity` instead, so name_corrections mints the
    # wiki name and both sides land in ONE bucket -- they are the same stat, and same-
    # typed effects take the max rather than summing. The Fire/Void/Kinetic Intensity
    # family stays separately rankable (#402 ruling, untouched).
    "Spell Critical Damage",
    "Damage to helpless enemies",
    "Dodge Cap",
    "Magical Sheltering Cap",
    "Max Dex Bonus",
    # DELIBERATELY EXCLUDED — `Armor Class (%)`, `False Life (%)`, and
    # `Maximum Spell Points (%)`. Each carries `unit: None`, so the solver would
    # score a percentage as a flat magnitude, and each shadows a flat sibling under
    # a different affix name — so a player ranking both `Armor Class` and
    # `Armor Class (%)` gets two independent buckets that never compose, and a
    # reported total whose meaning the model does not carry. `Maximum Spell
    # Points (%)` is worse: its flat base has zero sources and is not tracked at
    # all. Ranking them needs percentage-unit support first.
}
# Recognized-but-not-rankable bonus types: present on items but kept out of the
# picker vocabulary (a user never ranks a weapon-damage/penalty descriptor).
NON_RANKABLE_TYPES = {
    "Penalty", "Sneak Attack", "Bludgeoning", "Piercing", "Slashing",
    "Good", "Evil", "Lawful", "Chaotic",
}


GEARPLANNER_ITEMS_PATH = os.path.join(HERE, "data", "seed", "compendium", "raw", "gearplanner_items.json")
VOCAB_REGISTRIES_PATH = os.path.join(HERE, "data", "seed", "compendium", "vocab_registries.json")


# U2 (#136 batch) — upstream gear-planner passthrough noise: an affix NAME that
# carries no information (a wiki filler placeholder, or a bare enhancement "plus"
# the planner stored as its own name). Mirrors `isNoiseAffix` in web/dataset.js
# EXACTLY — that filter drops these from item affixes at load, and this one keeps
# them out of the EMITTED registry, which is the last surface still offering them
# to the picker's free-typed `known` set. Keep the two rules in sync: if they
# drift, a name the client strips can still be typed as a priority.
NOISE_AFFIX_NAMES = frozenset({"See the item description page for details."})
_BARE_NUMBER_NAME = re.compile(r"^[+-]?\d+%?$")


def is_noise_affix_name(name: str) -> bool:
    """True for an affix NAME that is passthrough noise rather than a stat."""
    n = (name or "").strip()
    return n in NOISE_AFFIX_NAMES or bool(_BARE_NUMBER_NAME.match(n))


def load_affix_vocabulary(path=None) -> tuple:
    """U5 — the affix-name registry + the variant->canonical alias table the web
    priority-picker consumes. The registry is the frozen checked-in affix-name
    vocabulary (``vocab_registries.json``); the alias map is the curated
    ``affix_aliases.json`` (``load_affix_aliases``). Emitting them to the dataset
    lets the picker canonicalize a typed/selected target to the ONE name gear,
    augments, and crafting all carry — so a single target matches every source.
    Deterministic (sorted list from a checked-in file; dict order from the file).

    #374/KTD5 — the frozen section is UNIONED with the curated
    ``local_affix_names`` section (``vocabulary.local_affix_names``, which
    validates each entry back to a rename or a local fold). This registry is the
    vocabulary ``cross_add_map`` bounds its targets to (``:1529``), and that
    family fails in two different ways when one of our canon names leaves raw:
    an absent ``spell_focus.SPELLPOWERS`` entry raises ``SystemExit``, while an
    absent ``LORE_ROSTER`` entry is dropped SILENTLY. The union is a no-op until
    upstream's refreshed vocabulary lands — every minted name is still in
    ``affix_names`` today."""
    table = vocabulary_mod._load(path or VOCAB_REGISTRIES_PATH)
    registry = sorted(set(table.get("affix_names", []))
                      | set(vocabulary_mod.local_affix_names(table)))
    # U2 — filter noise names HERE, at the emit site, not in generate_registries().
    # `check_referential_integrity()` validates every raw affix name against the
    # frozen checked-in registry as its baseline, so removing names at generation
    # would make that baseline reject data it must accept. Filtering on the way out
    # keeps the frozen file intact as the integrity baseline while keeping the
    # noise out of the picker's free-typed `known` set.
    registry = [n for n in registry if not is_noise_affix_name(n)]
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


def _raw_planner_items():
    """#364 — the raw gear-planner item dump, for carrying native item-quality
    fields onto synthetic bodies that replace a same-named record."""
    with open(GEARPLANNER_ITEMS_PATH, encoding="utf-8") as fh:
        raw = json.load(fh)
    return raw.get("items", raw) if isinstance(raw, dict) else raw


def assert_affix_synonyms() -> int:
    """Referential-integrity gate for upstream's affix-synonym table (U6), against
    the FROZEN checked-in registry. Upstream folds distinct game mechanics under one
    affix name — `Speed` <- `Striding` is the fold that produced #154 — so a changed
    fold is a data-semantics event that must not land silently. Any added, removed,
    or re-pointed mapping fails the build. Non-mutating; returns the count validated."""
    return vocabulary_mod.check_affix_synonyms(
        vocabulary_mod.load_live_affix_synonyms(),
        vocabulary_mod._load(vocabulary_mod.AFFIX_SYNONYMS_REGISTRY_PATH))


def _local_synonym_corpus():
    """`(exact_names, free_text)` — every place a `local_affix_synonyms` fold can bite.

    `exact_names` are structured affix `name` / `stat` values: the three raw
    gear-planner sources plus the curated augment-set seed. `free_text` is the
    verbatim wiki tier text the Dino seam parses, where a spelling is embedded in
    a sentence rather than stored as a name. Split because the two need different
    match modes — see `vocabulary.check_local_synonym_staleness`.
    """
    exact = set()
    for src in vocabulary_mod._sources():
        for a in name_corrections_mod._iter_affix_dicts(src):
            if isinstance(a.get("name"), str):
                exact.add(a["name"])
    _aug_sets = vocabulary_mod._load(membership_mod.AUGMENT_SETS_PATH).get("sets") or {}
    for spec in _aug_sets.values():
        if not isinstance(spec, dict):
            continue
        for a in spec.get("affixes") or []:
            if isinstance(a, dict) and isinstance(a.get("stat"), str):
                exact.add(a["stat"])
    free_text = [sa.get("tier_text") for sa
                 in dino_native_mod.native_dino_seed().get("set_augments") or []]
    return exact, [t for t in free_text if isinstance(t, str)]


def assert_local_affix_synonyms() -> int:
    """#374 — the staleness guard `local_affix_synonyms` never had.

    `assert_affix_synonyms` above diffs the UPSTREAM section against the frozen
    registry, so it says nothing about the repo-reviewed local section. A local
    fold whose spelling has left the corpus is a silent no-op, and upstream's
    consolidation of the helpless family retires most of the #305 spellings in one
    refresh. Non-mutating; returns the count of declared synonyms validated."""
    exact, free_text = _local_synonym_corpus()
    return vocabulary_mod.check_local_synonym_staleness(
        vocabulary_mod._load(vocabulary_mod.AFFIX_SYNONYMS_REGISTRY_PATH),
        exact, free_text)


GAP_CORRECTIONS_PATH = os.path.join(HERE, "data", "seed", "gap_corrections.json")
CANNITH_TIERS_PATH = os.path.join(
    HERE, "data", "seed", "compendium", "cannith_challenge_tiers.json")
VALUE_CORRECTIONS_PATH = os.path.join(
    HERE, "data", "seed", "compendium", "item_value_corrections.json")
NAME_CORRECTIONS_PATH = os.path.join(
    HERE, "data", "seed", "compendium", "affix_name_corrections.json")
TYPE_CORRECTIONS_PATH = os.path.join(
    HERE, "data", "seed", "compendium", "affix_type_corrections.json")
ACQUIRABILITY_PATH = os.path.join(
    HERE, "data", "seed", "compendium", "augment_acquirability.json")
COND_QUARANTINE_PATH = os.path.join(
    HERE, "data", "seed", "compendium", "conditional_affix_quarantine.json")
ML36_AUGMENTS_PATH = os.path.join(
    HERE, "data", "seed", "compendium", "ml36_augments.json")
# #365 — curated wiki-sourced Viktranium pool relocations (misfiled options).
VIK_POOL_CORRECTIONS_PATH = os.path.join(
    HERE, "data", "seed", "compendium", "viktranium_pool_corrections.json")
# #262 — per-item wiki verdicts for the "no known live drop source" disclosure.
NO_DROP_SOURCE_PATH = os.path.join(
    HERE, "data", "seed", "compendium", "no_drop_source.json")
UNTYPED_RANKABLE_PATH = os.path.join(
    HERE, "data", "seed", "compendium", "untyped_rankable.json")
# #91 (Utility tier) — adjudication of untyped weapon/off-hand proc names, the
# population untyped_rankable's worn-slot rule deliberately excludes.
UTILITY_PROCS_PATH = os.path.join(
    HERE, "data", "seed", "compendium", "utility_procs.json")
SPEED_SHARD_PATH = os.path.join(HERE, "data", "seed", "compendium", "speed_enchantment.json")
PARRYING_SHARD_PATH = os.path.join(HERE, "data", "seed", "compendium", "parrying_version.json")
RIPOSTE_SHARD_PATH = os.path.join(HERE, "data", "seed", "compendium", "riposte_version.json")
RING_EXCLUSIVITY_SHARD_PATH = os.path.join(
    HERE, "data", "seed", "compendium", "ring_exclusivity.json")
#: #442's retired allowlist, read ONLY as corroboration for the blocklist that
#: replaced it — never to decide duplicability. See src/ring_exclusivity.check.
DUPLICABLE_RINGS_CORROBORATION_PATH = os.path.join(
    HERE, "data", "seed", "compendium", "duplicable_rings.json")
HEIGHTENED_AWARENESS_SHARD_PATH = os.path.join(
    HERE, "data", "seed", "compendium", "heightened_awareness.json")
SPEED_AUGMENT_SHARD_PATH = os.path.join(HERE, "data", "seed", "compendium", "speed_augment.json")
# #199 — wiki-sourced intrinsic in-game stat ceilings (Doublestrike 100). Emitted
# to metadata so the solver can merge them into cappedStats as a third source
# beside the armor dodge cap and the player's own caps, tighter-of-the-three.
# The shard also records the stats whose ceiling the wiki REFUSES to state, which
# is most of them; see docs/wiki-evidence/intrinsic-stat-caps.md for why that half
# matters as much as the confirmed one.
INTRINSIC_STAT_CAPS_PATH = os.path.join(
    HERE, "data", "seed", "compendium", "intrinsic_stat_caps.json")
# #249 — per-item Sonic flag for `Elemental Absorption`, which names four elements
# on some carriers and five on others behind an identical visible cell.
ABSORPTION_SHARD_PATH = os.path.join(
    HERE, "data", "seed", "compendium", "elemental_absorption.json")
# #191 — per-affix element sets for `Elemental Resistance`, the resistance twin
# of the absorption compound: four elements on most carriers, five behind the
# template's `4=` switch, and per-TYPE readings because two carriers bear both.
ER_SHARD_PATH = os.path.join(
    HERE, "data", "seed", "compendium", "elemental_resistance.json")
MATERIAL_SHARD_PATH = os.path.join(HERE, "data", "seed", "compendium", "item_material.json")
MATERIAL_CLASS_PATH = os.path.join(HERE, "data", "seed", "compendium", "material_classification.json")
# The slots the material gate covers (#162). Docents are the Forged body slot and
# the oath is moot for Forged, so they stay out.
SHIELD_TYPES = {"Bucklers", "Small shields", "Large shields", "Tower shields"}
BODY_ARMOR_TYPES = {"Cloth armor", "Light armor", "Medium armor", "Heavy armor"}


def load_cannith_tiers(path: str = CANNITH_TIERS_PATH) -> dict:
    """#313 — the Cannith Challenge upgrade-tier overlay.

    gear-planner emits NO enchantments for a Vaults of the Artificers item whose wiki
    page uses the `Upgradeable - Tier N` layout — only a marker affix (`VotAU` on worn
    gear, `Upgradeable - Tier` on weapons). 97 of the 140 Vaults variants reach the
    solver carrying nothing scorable; this overlay covers the 33 WORN ones.

    This is the SECOND sanctioned additive overlay, and it is a different case from
    `gap_corrections`: that one restores affixes gear-planner under-parsed on items it
    otherwise read, this one supplies affixes for items it read as empty. Neither ever
    overwrites a native affix.

    Returns `{item_name: [{name,type,value}, …]}`. Missing file -> {}."""
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)
    out = {}
    for name, entry in (raw.get("items") or {}).items():
        rows = [{"name": a["name"], "type": a["type"], "value": str(a["value"])}
                for a in entry.get("final") or []]
        if rows:
            out[name] = rows
    return out


def apply_cannith_tiers(records: list, overlay: dict) -> dict:
    """Apply the #313 overlay ADDITIVELY, with the same anti-double-count guard.

    An overlay affix is SKIPPED when the record already carries that `(name, type)`,
    so a future upstream refresh that starts parsing these tiers cannot produce a
    doubled value — the overlay simply goes quiet, item by item, and the coverage
    numbers in `metadata` say so."""
    by_name = {}
    for r in records:
        by_name.setdefault(r.get("name"), r)
    items_filled = affixes_added = affixes_skipped = 0
    for name in sorted(overlay):
        rec = by_name.get(name)
        if rec is None:
            continue
        existing = {(a.get("name"), a.get("type")) for a in rec.get("affixes") or []}
        added = 0
        for aff in overlay[name]:
            key = (aff["name"], aff["type"])
            if key in existing:
                affixes_skipped += 1
                continue
            rec.setdefault("affixes", []).append(dict(aff))
            existing.add(key)
            added += 1
        if added:
            items_filled += 1
            affixes_added += added
    return {
        "items_filled": items_filled,
        "affixes_added": affixes_added,
        "affixes_skipped_already_present": affixes_skipped,
        "overlay_items": sorted(overlay),
        "missing_from_roster": sorted(n for n in overlay if by_name.get(n) is None),
    }


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


def rankable_affixes(planner_records, untyped_allow=frozenset(), variants=None) -> list:
    """Rankable-affix vocabulary: the affix names a user meaningfully ranks as a
    priority, read from the NATIVE gear-planner affix block. Filters: a magnitude
    bonus type (not Bool/boolean presence, not a non-rankable weapon/penalty
    descriptor), a numeric value, a well-formed name, and presence on at least two
    distinct items (a real stat is shared across gear; a one-off named proc is not).
    CORE_STATS are always included regardless of item count.

    `untyped_allow` (#227) is the adjudicated exception to the untyped skip below —
    names verified against the wiki as real worn-gear magnitudes. They still have to
    clear every other filter; the allow-list only buys them past the type check.

    `variants` (#675) adds the SET-BONUS half this list has always claimed to carry.
    The docstring at `web/dataset.js` calls this the "curated item/scaling/set-bonus
    vocabulary", but only item affix blocks were ever counted, so a stat carried by
    named sets alone reached `known` (via `_itemAffixTriples`) and never
    `suggestions` — 16 of them, including `Melee Diversion` at ten sets and
    `Sneak Attack` at five. A player had to already know the name to rank it.

    Set occurrences are counted by DISTINCT SET, never per item. A set grants its
    bonus on every piece, so per-item counting would let a single set clear the
    two-source bar three times over on its own pieces and re-admit exactly the
    one-off names the bar exists to keep out."""
    counts = collections.Counter()
    for r in planner_records or []:
        seen = set()
        for a in r.get("affixes") or []:
            bt = a.get("type")
            # Skip presence (Bool), non-rankable descriptors, and NULL/empty-typed
            # affixes — the latter are overwhelmingly weapon procs/banes (Holy,
            # Vampirism, ...), not rankable magnitude stats, so they stay out of the
            # picker suggestions (a user never ranks a proc).
            #
            # #227 — the premise holds in aggregate but has exceptions: `Enhanced Ki`
            # is a genuine worn magnitude on 19 variants that no player could rank
            # because it happens to arrive untyped. An adjudicated, wiki-verified name
            # is admitted; everything else untyped still goes. Membership is checked
            # against the affix NAME, so the exception cannot widen to a whole type.
            # #374 — the 2026-08-18 refresh re-encoded the type field: upstream used
            # to OMIT `type` for an untyped affix and now emits the literal string
            # "Untyped" (key-less affixes 5709 -> 90, "Untyped" 148 -> 886). Both
            # spellings mean the same thing, so both must read as untyped here —
            # otherwise 886 affix occurrences stop being filtered and arrive as
            # rankable stats typed "Untyped", turning procs and flags into stackable
            # bonuses. src/set_catalog.py and src/membership.py already treat the
            # literal marker this way; these two sites simply predate the change.
            untyped = bt in (None, "", "Untyped")
            if untyped and a.get("name") in untyped_allow:
                pass
            elif untyped or bt in ("boolean", "Bool") or bt in NON_RANKABLE_TYPES:
                continue
            if not _is_numeric(a.get("value")):
                continue
            stat = a.get("name")
            if stat and _well_formed_stat(stat):
                seen.add(stat)
        counts.update(seen)
    # #675 — the set-bonus half, counted by distinct SET name so a set's own pieces
    # cannot vote more than once. Same filters as the item pass above: these tiers
    # are legacy-shaped ({stat, bonus_type}), so read that shape rather than the
    # native one. Deliberately no untyped_allow branch here: that exception was
    # adjudicated against worn-gear affix blocks, and widening it to a channel it
    # was never reviewed for is exactly the silent scope creep it guards against.
    sets_by_stat = collections.defaultdict(set)
    for v in variants or []:
        for tier in v.get("parsed_set_bonuses") or []:
            set_name = tier.get("set")
            if not set_name:
                continue
            for a in tier.get("affixes") or []:
                bt = a.get("bonus_type")
                if bt in (None, "", "Untyped") or bt in ("boolean", "Bool") or bt in NON_RANKABLE_TYPES:
                    continue
                if not _is_numeric(a.get("value")):
                    continue
                stat = a.get("stat")
                if stat and _well_formed_stat(stat):
                    sets_by_stat[stat].add(set_name)
    for stat, set_names in sets_by_stat.items():
        counts[stat] += len(set_names)
    names = {s for s, c in counts.items() if c >= 2}
    names |= set(CORE_STATS)
    # U1 (#136) — drop umbrella names. `src/umbrella.py` expands them into the six
    # concrete abilities at build time, so NO item can ever carry one; offering the
    # name gives the player a priority guaranteed to score zero. The picker
    # redirects to the abilities instead (metadata.expanded_away_names).
    names = {s for s in names if not umbrella_mod.is_umbrella(s)}
    # #205 — same rule for the universal spell-DC names, expanded into the seven
    # schools by src/spell_focus.py.
    names = {s for s in names if not spell_focus_mod.is_universal(s)}
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
    # U6 — affix-synonym collision gate. Upstream folds distinct game mechanics under
    # one affix name; a CHANGED fold silently merges or splits two stats, which is
    # exactly how #154 (Speed <- Striding) went unnoticed. Diff the vendored upstream
    # table against the frozen registry before anything reads an affix. Non-mutating.
    _affix_synonyms_checked = assert_affix_synonyms()
    # #374 — the LOCAL half of the same gate. `assert_affix_synonyms` diffs only
    # upstream's section, so a repo-reviewed fold whose spelling has left the
    # corpus is invisible. Non-mutating; runs beside its upstream sibling.
    _local_synonyms_checked = assert_local_affix_synonyms()
    # #227/#374 — wiki-sourced NAME corrections, loaded ONCE and applied at each
    # catalog's single load point (KTD2): crafting here, sets below, the item
    # roster further down, the augment pool last. gear-planner remains the sole
    # authority for WHICH affixes an item has; the wiki is the authority for what
    # the enchantment is CALLED, and upstream's vocabulary generalization
    # (`Combustion` -> `Fire Spell Power`) does not move our canon.
    _name_corrections = name_corrections_mod.load(NAME_CORRECTIONS_PATH)
    # KTD3 — what the raw snapshot has ARMED must equal what the shard declares
    # live, derived by the direct Rule A predicate rather than hand-listed. Runs
    # against the raw files, so it is deliberately upstream of every rename.
    name_corrections_mod.assert_canon_defense(
        _name_corrections, vocabulary_mod.armed_canon_variants())
    # The active crafting families source their option pools NATIVELY from
    # gearplanner_crafting.json (the gear-planner crafting catalog). Load once and
    # thread it into each family builder.
    crafting = crafting_catalog_mod.load_catalog()
    # #374/KTD2 — the crafting channel of the name corrections. ONE call at the
    # catalog's single load point covers every pool derived from it: augment,
    # seal, dino, viktranium, nearly-complete, green-steel, thunder-forged. The
    # 244 protected-name occurrences in gearplanner_crafting.json are unreachable
    # from the item-roster call further down.
    #
    # KTD8 — this MUST stay above `ml36_augments.check` below. Our own ML36 shard
    # carries protected canon names anchored to their gear-planner siblings, and
    # `check` raises SystemExit when an entry's affix vocabulary no longer matches
    # its sibling's. Renaming first makes that comparison our canon against our
    # canon; renaming after it would kill the build before any of this runs.
    _name_coverage_crafting = name_corrections_mod.apply(crafting, _name_corrections)
    # #260 — inject the wiki-sourced ML36 augment tier into the color pools.
    # gear-planner stops at ML32; the wiki holds the 63 top-tier sale augments,
    # each anchored to its gear-planner sibling's affix vocabulary and guarded
    # against staleness (upstream adding the tier), a broken sibling anchor, and
    # a tooltip that no longer states the value. check() runs on the PRISTINE
    # catalog — that is what the staleness guard means — then inject() appends
    # in the pools' native shape so every consumer below treats them as natives.
    #
    # #374/KTD8 — "pristine" now means pristine with respect to TIER CONTENT (the
    # staleness guard's actual subject: upstream adding an ML36 tier), NOT with
    # respect to affix spelling. The name corrections above have already run, by
    # design: the shard's own affix names are our canon, so comparing them to a
    # not-yet-renamed sibling would fail the build on a spelling difference this
    # pipeline exists to erase. Chosen over re-anchoring the shard entries, which
    # would need redoing on every future upstream rename.
    _ml36_entries = ml36_augments_mod.load(ML36_AUGMENTS_PATH)
    _ml36_checked = ml36_augments_mod.check(_ml36_entries, crafting)
    _ml36_coverage = ml36_augments_mod.inject(_ml36_entries, crafting)
    # Seal types with a non-empty verified pool gate which "Sealed in X" hosts the
    # reader recovers from the raw dump (Undeath sourced; Mist/Gloom pending).
    _verified_seal_types = {r["seal_type"]
                            for r in seal_mod.build_seal(crafting)["records"]}
    # #371 — the same pool-backed gate for the per-item Nearly Complete pools
    # ("Nearly Finished" / "Almost There"): only a host the pool actually covers
    # becomes a host, so a declared label upstream never sourced grows no slot the
    # solver cannot fill. The uncovered declarers are disclosed BY NAME by
    # src/crafting_coverage.py rather than hidden behind a slot-level allowlist.
    _nc_per_item_hosts = nc_mod.per_item_hosts(crafting)
    # Dinosaur Bone hosts are synthetic bodies generated post-verify (dino_blanks
    # below); they never pass through the name dedup, so a same-name gear-planner
    # record would double-list with an identical variant_id (KTD8 trap). Build the
    # blanks now (from the native Dino host layout — src.dino_native, KTD8) and
    # exclude their names from the reader so the synthetic body is the sole host.
    dino_seed = dino_native_mod.native_dino_seed()
    # The set catalog is loaded ONCE here (gearplanner_sets.json parsed a single
    # time) and threaded to BOTH consumers: the blanks' intrinsic-set stamp inside
    # build_dino and the native set-bonus attach further down, so the two read the
    # same catalog state.
    #
    # #374/KTD2 — the sets channel of the name corrections. Applied to the RAW
    # catalog, before `catalog_from_raw` synthesizes it: `load_catalog` returns
    # `piece_bonuses` TEXT, so a rename applied to its output would find no
    # `affixes` list and be a permanent silent no-op. The 121 protected-name
    # occurrences in gearplanner_sets.json are reachable only here.
    _sets_raw = set_catalog_mod.load_raw()
    _name_coverage_sets = name_corrections_mod.apply(_sets_raw, _name_corrections)
    # #287/#376 — the sets channel of the Legendary fold, and it has to run HERE,
    # right after the rename and before `catalog_from_raw` synthesizes the tier
    # text. The correction above rewrites upstream's `False Life (%)` to the
    # ENGRAVED name `Legendary Conditioning`; the item and augment channels then
    # fold that into `Conditioning` + bonus type `Legendary` (the wiki's model:
    # `{{Conditioning|15|Legendary}}`). Without the same fold here, four set tiers
    # credit a stat name no item affix carries — a bucket disjoint from the 36
    # worn carriers, which is the two-names-one-mechanic split #376 exists to
    # close — and the engraved name becomes NATIVE, which deletes its provenance
    # label and leaves a player who ranks what the item prints scoring nothing.
    _legendary_fold_cov_sets = legendary_fold_mod.apply(
        [t for tiers in _sets_raw.values() for t in tiers])
    _set_catalog = set_catalog_mod.catalog_from_raw(_sets_raw)
    # #541 — the raw dump is read ONCE here and threaded to both consumers below:
    # build_dino derives each blank's intrinsic set membership from the native
    # records it shadows, and the artifact carry-over reads the same list.
    _raw_items = _raw_planner_items()
    dino_blanks, dino_inserts, dino_sets, dino_cov = dino_mod.build_dino(
        dino_seed, crafting, sets_catalog=_set_catalog, planner_items=_raw_items)
    _host_pipeline_names = {b.get("source_item") for b in dino_blanks}
    # #364 — the blank REPLACES the same-named gear-planner record (its name is
    # excluded from the reader just below), so it must inherit that record's
    # item-quality fields or they are silently lost. `artifact` was: the six
    # native Dinosaur Bone accessory blanks are flagged `artifact: true` upstream,
    # our synthetic bodies were not, and the built catalog shipped 95 Artifacts
    # where the dump has 101. An unflagged Artifact is invisible to the one-
    # Artifact constraint, so the solver could equip it alongside a real one —
    # which is exactly what a player reported.
    #
    # Carried, never inferred. The wiki draws the same line the dump does
    # (Dinosaur_Bone_crafting: "Minor Artifact accessory blanks are available
    # from the raid ..." while "armors and shields are only available as loot"),
    # so the Armor/Helmet/Cloak bodies stay unflagged rather than being extended
    # to on a family resemblance. Same field-chain rule `_stamp_set_membership`
    # already enforces for `sets` — a synthesized record needs the full chain.
    _native_artifact_names = {
        it.get("name") for it in _raw_items
        if it.get("artifact") and it.get("name") in _host_pipeline_names
    }
    for _b in dino_blanks:
        if _b.get("source_item") in _native_artifact_names:
            _b["artifact"] = True
    # Native gear-planner records — the sole item roster. The loader already
    # dedups intra-dump same-name collisions (first wins) and surfaces every host
    # choice-slot marker (augment/seal/lamordia/nearly-complete/lost-purpose)
    # NATIVELY from crafting[], so no cross-source graft is needed.
    planner_records, planner_stats = planner_mod.load_planner_items(
        verified_seal_types=_verified_seal_types,
        exclude_names=_host_pipeline_names,
        nc_per_item_hosts=_nc_per_item_hosts)
    # #262 — the "no known live drop source" evidence shard. check() runs HERE,
    # against the planner records pre-variant-expansion, because the staleness
    # guard keys off the raw `quests` array (KTD8: the list, not the derived
    # location_quest string) — which lives only on these records. An entry whose
    # item's quests filled in upstream fails the build for review; an empty or
    # absent shard is the labeled inert no-op (fail-safe-absent disclosure).
    # Stamping happens once the variants are final, just before assembly below.
    _no_drop_entries = no_drop_source_mod.load(NO_DROP_SOURCE_PATH)
    _no_drop_checked = no_drop_source_mod.check(_no_drop_entries, planner_records)
    # U7.5 — apply the wiki-validated gap-corrections overlay ADDITIVELY, in place,
    # BEFORE variant expansion so the restored affixes flow through verify/coverage
    # like any native affix. Sole sanctioned exception to gear-planner sole-authority
    # (restores only affixes gear-planner genuinely LACKS; anti-double-count guarded).
    _gap_corrections = load_gap_corrections()
    _gap_coverage = apply_gap_corrections(planner_records, _gap_corrections)
    # #313 — applied AFTER the gap overlay so its anti-double-count guard sees any
    # affix that one restored, and before every downstream normalization stage so a
    # tier affix travels the identical path a natively-parsed one does.
    _cannith_coverage = apply_cannith_tiers(planner_records, load_cannith_tiers())
    # #207 — wiki-sourced VALUE corrections. Separate from the additive overlay
    # above, which cannot overwrite by design. Runs after it so a corrected value
    # applies to the final affix block, and fails the build when its recorded
    # `from` no longer matches upstream rather than pinning a stale number.
    _value_corrections = value_corrections_mod.load(VALUE_CORRECTIONS_PATH)
    _value_coverage = value_corrections_mod.apply(planner_records, _value_corrections)
    # #227 — wiki-sourced NAME corrections. gear-planner stores some enchantments
    # under a shortened name (`Ki` for the wiki's `Enhanced Ki`). Rename here, before
    # variant expansion and before rankable_affixes, so the corrected name reaches the
    # picker vocabulary, the solver, browse, and the exports from ONE place. An alias
    # alone cannot do this: the solver matches item affixes by name, so a canonical
    # name no item carries is a priority that scores zero. `_name_corrections` was
    # loaded once above, with the crafting and sets channels; this is the item one.
    _name_coverage = name_corrections_mod.apply(planner_records, _name_corrections)
    # #259 — wiki-sourced BONUS TYPE corrections, the fourth corrections
    # mechanism (gap=additive, value, name, type — each changes one field and
    # nothing else does). A wrong type is a stacking defect, not a magnitude
    # one: `Moment to Moment` stores its Action Boost Charges Untyped while the
    # wiki tooltip states an Enhancement bonus, so it stacked with every worn
    # Enhancement source of the stat. Applied here to the item channel and again
    # to the augment pool below; `assert_all_reached` after both closes the
    # renamed-record silent-no-op gap.
    _type_corrections = type_corrections_mod.load(TYPE_CORRECTIONS_PATH)
    _type_coverage_items = type_corrections_mod.apply(planner_records, _type_corrections)
    # #287 — fold the five 'Legendary <stat>' display names into base stat +
    # Legendary bonus type (wiki: {{Accuracy|2|Legendary}} et al.), stamping the
    # engraved name as the provenance receipt. Runs at the correction stage so
    # one folded affix block flows into vocabulary, verification, the picker,
    # the solver, and exports from one place. The augment pool carries none of
    # the five names today, so the item apply does all of today's folding; the
    # augment-pool apply below exists so the unknown-instance guard watches that
    # channel too.
    _legendary_fold_cov = legendary_fold_mod.apply(planner_records)
    # #227 — adjudicate the untyped affixes that look like real worn-gear magnitude
    # stats. Runs AFTER the rename so the adjudication is keyed on the canonical
    # name, and before rankable_affixes so the allow-list is available to it. A
    # candidate on neither list fails the build: an untyped worn stat no player can
    # rank is exactly the defect #227 reported, and it should surface here rather
    # than in a bug report.
    _untyped_allow, _untyped_quarantined = untyped_rankable_mod.load(UNTYPED_RANKABLE_PATH)
    _untyped_checked = untyped_rankable_mod.assert_adjudicated(
        planner_records, _untyped_allow, _untyped_quarantined)

    # #91 (U1) — adjudicate the OTHER untyped population: weapon/off-hand-only
    # proc names (Holy, Vampirism, the Banes...), which the worn-slot rule above
    # deliberately excludes. Same seam and same reasons: after the rename so the
    # adjudication is keyed on the canonical name. An un-dispositioned candidate
    # fails the build, so a new untyped weapon proc is a reviewed event instead
    # of a silent zero in the utility count. Allowed names feed
    # metadata.utility_untyped_admitted below (the picker's presence path) —
    # never rankable_affixes (the declared-credit defect web/dataset.js
    # documents), and since #343 no longer metadata.utility_counting_set
    # either: the procs stayed rankable but stopped being counted.
    _uproc_allow, _uproc_quarantined = utility_procs_mod.load(UTILITY_PROCS_PATH)
    _uproc_checked = utility_procs_mod.assert_adjudicated(
        planner_records, _uproc_allow, _uproc_quarantined)

    # #223 — a DR bypass qualifier is not a bonus type. Retype the unconditional
    # qualifiers (`-` + materials; wiki: no monster bypasses material DR) into one
    # bucket so the solver takes the max the wiki describes, and demote the
    # conditional ones (alignments, damage types, Epic) to presence affixes named
    # for the engraved enchantment — their magnitude is not comparable without
    # naming the attacker. An unclassified qualifier fails the build. Same seam
    # and same reasons as the splits below: before variant expansion and before
    # rankable_affixes, so one corrected affix block flows everywhere downstream.
    # Ruling: docs/wiki-evidence/damage-reduction-stacking.md.
    _dr_coverage = dr_qualifiers_mod.apply(planner_records)

    # U3 (#154) — split the folded `Speed` affix back into the two mechanics
    # upstream merged. BEFORE variant expansion and before rankable_affixes, so the
    # corrected affix block flows into verify/coverage, the picker vocabulary, the
    # solver, browse, and the exports from ONE place. A `Speed` item whose alacrity
    # magnitude the wiki only defaults keeps its movement bonus and gains nothing.
    _speed_shard = harvest_mod.load_shard(SPEED_SHARD_PATH, "speed")
    # An `unsourced` entry claims the page has no Speed/Striding template. That is
    # a harvest suspect, not a settled reading — Belt of the Ram carried one while
    # its page rendered `Speed +15%`. Surfaced in coverage so the next miss is seen.
    _speed_audit = speed_split_mod.audit_shard(_speed_shard)
    _speed_snapshots = speed_split_mod.audit_snapshots(_speed_shard)
    # Assert every derived value against the wiki's own rendered tooltip. Offline
    # — the snapshots are on disk. A mismatch is a transcription defect in our
    # switch table, not a guard defect, so it fails the build rather than warning.
    _speed_guard = speed_split_mod.check_against_snapshots(_speed_shard)
    if _speed_guard["problems"]:
        raise SystemExit("speed snapshot guard failed:\n  " +
                         "\n  ".join(_speed_guard["problems"]))
    _speed_coverage = speed_split_mod.apply(planner_records, _speed_shard)

    # U7 (#169) — expand the folded `Parrying` affix into the Insight Armor Class
    # and three Insight saves it actually grants. Same seam and same reasons as the
    # Speed split above: before variant expansion and before rankable_affixes, so
    # one corrected affix block flows everywhere downstream.
    #
    # The magnitude is a property of the enchantment VERSION, not of the number
    # upstream stored — nineteen items store 4 and one of them is Roman IV, which
    # grants 2. The version is per-item wiki evidence; this build never derives it.
    _parrying_shard = harvest_mod.load_shard(PARRYING_SHARD_PATH, "parrying_version")
    _parrying_audit = parrying_split_mod.audit_shard(_parrying_shard)
    _parrying_snapshots = parrying_split_mod.audit_snapshots(_parrying_shard)
    _parrying_guard = parrying_split_mod.check_against_snapshots(_parrying_shard)
    if _parrying_guard["problems"]:
        raise SystemExit("parrying snapshot guard failed:\n  " +
                         "\n  ".join(_parrying_guard["problems"]))
    _parrying_coverage = parrying_split_mod.apply(planner_records, _parrying_shard)

    # #546 — Parrying's sibling. `Riposte` folds the same four stats under one
    # name, reported by a player who had to rank the literal name to score
    # anything from the 35 records carrying it. Same seam and same reasons as the
    # Parrying split above.
    #
    # The one structural difference: Riposte's two halves are NOT equal. The wiki
    # grants X/2 rounded UP to Armor Class and X/2 rounded DOWN to the saves, so
    # every odd Roman numeral splits asymmetrically (IX is +5 AC and +4 saves).
    # The shard carries both numbers per item; nothing here derives either.
    #
    # The augment channel runs separately, down with the other augment-pool
    # applies — two augments carry this affix and neither is a planner item.
    _riposte_shard = harvest_mod.load_shard(RIPOSTE_SHARD_PATH, "riposte_version")
    _riposte_audit = riposte_split_mod.audit_shard(_riposte_shard)
    _riposte_snapshots = riposte_split_mod.audit_snapshots(_riposte_shard)
    _riposte_guard = riposte_split_mod.check_against_snapshots(_riposte_shard)
    if _riposte_guard["problems"]:
        raise SystemExit("riposte snapshot guard failed:\n  " +
                         "\n  ".join(_riposte_guard["problems"]))
    _riposte_coverage = riposte_split_mod.apply(planner_records, _riposte_shard)

    # U3 (#169) — the other half of the same defect. `Heightened Awareness` grants
    # one thing, an Insight bonus to AC, and stored as an enchantment name it
    # scored nothing. No version branch: the wiki lists Arabic ranks only, and the
    # guard asserts each derived value against its own rendered tooltip so a Roman
    # variant appearing later fails rather than being read as Arabic.
    _ha_shard = harvest_mod.load_shard(HEIGHTENED_AWARENESS_SHARD_PATH,
                                       "heightened_awareness")
    _ha_audit = heightened_awareness_mod.audit_shard(_ha_shard)
    _ha_snapshots = heightened_awareness_mod.audit_snapshots(_ha_shard)
    _ha_guard = heightened_awareness_mod.check_against_snapshots(_ha_shard)
    if _ha_guard["problems"]:
        raise SystemExit("heightened awareness snapshot guard failed:\n  " +
                         "\n  ".join(_ha_guard["problems"]))
    _ha_coverage = heightened_awareness_mod.apply(planner_records, _ha_shard)

    # U5/U6 (#249) — the compound absorption names. Three stat names cover several
    # elements at once, so a player ranking `Fire Absorption` scored nothing from
    # the seventeen affix records carrying one. The two paired names expand
    # unconditionally at the compound's FULL magnitude (the template emits both
    # `+N%` category memberships from one invocation); `Elemental Absorption`
    # expands per item, reading the Sonic flag from the shard, because the visible
    # cell reads the same for a four-element and a five-element carrier.
    #
    # Runs at the PLANNER-RECORD seam, before variants are built, so the emitted
    # affixes and the quarantine marker both pass through `src/variants.py`'s
    # whitelist rebuild — which carries them explicitly.
    _absorption_shard = harvest_mod.load_shard(ABSORPTION_SHARD_PATH,
                                               "elemental_absorption")
    _absorption_audit = absorption_split_mod.audit_shard(_absorption_shard)
    _absorption_snapshots = absorption_split_mod.audit_snapshots(_absorption_shard)
    _absorption_guard = absorption_split_mod.check_against_snapshots(_absorption_shard)
    if _absorption_guard["problems"]:
        raise SystemExit("elemental absorption snapshot guard failed:\n  " +
                         "\n  ".join(_absorption_guard["problems"]))
    _absorption_coverage = absorption_split_mod.apply(planner_records, _absorption_shard)

    # #191 — expand `Elemental Resistance` into per-element resistances, at the
    # same planner-record seam and under the same rules as the absorption
    # compound above: full magnitude per element, per-item (and per-TYPE) Sonic
    # evidence from the shard, quarantine-as-removal for anything unconfirmed.
    _er_shard = harvest_mod.load_shard(ER_SHARD_PATH, "elemental_resistance")
    _er_audit = er_split_mod.audit_shard(_er_shard)
    _er_snapshots = er_split_mod.audit_snapshots(_er_shard)
    _er_guard = er_split_mod.check_against_snapshots(_er_shard)
    if _er_guard["problems"]:
        raise SystemExit("elemental resistance snapshot guard failed:\n  " +
                         "\n  ".join(_er_guard["problems"]))
    _er_coverage = er_split_mod.apply(planner_records, _er_shard)

    # U5 (#162) — stamp wiki-sourced material onto shields + body armor. The
    # gear-planner snapshot has no such field (its full item-field union is
    # affixes/ml/name/quests/slot/type/url/crafting/sets/artifact), so this is the
    # only route. Unsourced items keep no material and every gate fails open.
    _material_shard = harvest_mod.load_shard(MATERIAL_SHARD_PATH, "material")
    _material_class = vocabulary_mod._load(MATERIAL_CLASS_PATH)
    _material_stamp = material_mod.apply(planner_records, _material_shard)
    _material_coverage = material_mod.coverage(planner_records, _material_class)
    # U7/R10 — material coverage gate. Every shield and body armor must resolve in
    # the shard (a value, or a reviewed `unsourced` entry). A NEW item from a
    # re-import fails the build listed by name rather than silently passing the
    # druidic-oath gate. Delta-only: already-harvested items resolve.
    _material_checked = material_mod.assert_coverage(
        planner_records, _material_shard,
        SHIELD_TYPES, BODY_ARMOR_TYPES)

    enriched_items = planner_records

    # Set bonuses (native): attach the authoritative gear-planner catalog def to
    # each record carrying an "X (set)" marker (from its `sets[]`), matched on the
    # canonical name so cross-source spelling drift (the " Set" infix) resolves.
    _set_base_defs = {}  # no base seed anymore; all defs come from the catalog
    # _set_catalog was loaded once above (before build_dino) and is reused here.
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
            # (mirrors the seal-slot graft copy). set_catalog.copy_def is a true deep
            # copy — the same helper the Dino blank stamp uses (one owner).
            it["set_bonus"] = [set_catalog_mod.copy_def(d) for d in defs]
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
    # #259 — the augment channel of the type corrections loaded above. The two
    # shipping entries live here (the Moment to Moment pair); the item apply was
    # their silent no-op. Runs before the speed classifier and expand_dataset so
    # the corrected type flows into variants, the solver, and browse from one
    # place.
    _type_coverage_augments = type_corrections_mod.apply(aug_pool, _type_corrections)
    type_corrections_mod.assert_all_reached(
        _type_corrections, _type_coverage_items, _type_coverage_augments)
    # #88 — drop affixes the wiki states are conditional / ramping / temporary but
    # gear-planner stores as a flat maximum. Runs on BOTH channels, right after the
    # type corrections and before any expansion, so a quarantined affix never
    # reaches the cross-add or umbrella families downstream.
    _cond_q = cond_quarantine_mod.load(COND_QUARANTINE_PATH)
    _condq_items = cond_quarantine_mod.apply(planner_records, _cond_q)
    _condq_augs = cond_quarantine_mod.apply(aug_pool, _cond_q)
    cond_quarantine_mod.assert_all_reached(_cond_q, _condq_items, _condq_augs)
    # #359 — wiki-sourced ACQUIRABILITY, stamped on the augment pool. Owned-augment
    # mode offers `owned UNION acquirable`; this is the acquirable half. Stamped
    # here, after the type corrections and before variant expansion, so the flag
    # rides every derived pool from one place. The guard fails the build when the
    # exact-name join stops being complete — a silently smaller acquirable set
    # would make owned mode forget augments the player can simply buy.
    _acquirable = acquirability_mod.load(ACQUIRABILITY_PATH)
    # #287 — the augment channel of the legendary fold above. No augment carries
    # one of the five names today (folded: 0), but the unknown-instance guard
    # must watch this pool too, or a future 'Legendary <stat>' augment would
    # ship split from its worn siblings without a sound.
    # #376 — the augment channel of the name corrections loaded above. The
    # `False Life (%)` -> `Legendary Conditioning` fold lives ONLY here: both Solar
    # Gem of Enduring stones are augment-pool records, absent from the item roster,
    # so the item-channel apply is a correct no-op for it (and the `Ki` entry is the
    # mirror case). `assert_all_reached` below is what keeps that no-op honest.
    #
    # Runs BEFORE legendary_fold deliberately: renaming to the RAW `Legendary
    # Conditioning` puts the gem into the same fold chain the 34 worn carriers use,
    # so both arrive as `Conditioning` + type Legendary from one owner rather than
    # two. It also keeps the alias pointing at a name the frozen raw registry knows.
    _name_coverage_augments = name_corrections_mod.apply(aug_pool, _name_corrections)
    # #374/KTD2 — one honesty guard across ALL FOUR channels. A per-channel miss is
    # a correct silent no-op; reaching nothing anywhere is staleness. The crafting
    # and sets coverage dicts must be threaded here or the two new channels vouch
    # for nothing and an entry they alone reach reads as dead.
    name_corrections_mod.assert_all_reached(
        _name_corrections, _name_coverage, _name_coverage_augments,
        _name_coverage_crafting, _name_coverage_sets)
    _legendary_fold_cov_augments = legendary_fold_mod.apply(aug_pool)
    # U3 (#134) — the same classifier on the augment pool, against its own shard.
    # Augments join by NAME: they have no item page and share one `Augment Slot`
    # url, so the item shard's title join cannot reach them. `Topaz of Swiftness
    # 15%` is the one augment using {{Speed}} rather than {{Striding}}, and the
    # wiki states 15% attack speed for it — melee and ranged both.
    _speed_aug_shard = harvest_mod.load_shard(SPEED_AUGMENT_SHARD_PATH, "speed_augment")
    _speed_aug_audit = speed_split_mod.audit_shard(_speed_aug_shard)
    _speed_aug_snapshots = speed_split_mod.audit_snapshots(_speed_aug_shard)
    # The augment shard runs the same guard as the item shard. Leaving it out
    # would exempt the one record this whole fix exists to correct.
    _speed_aug_guard = speed_split_mod.check_against_snapshots(_speed_aug_shard)
    if _speed_aug_guard["problems"]:
        raise SystemExit("speed augment snapshot guard failed:\n  " +
                         "\n  ".join(_speed_aug_guard["problems"]))
    _speed_aug_coverage = speed_split_mod.apply_to_augments(aug_pool, _speed_aug_shard)
    # Every augment the shard names must have been REWRITTEN, not merely inspected.
    # `uncovered` counts records the shard misses; it cannot see a record the shard
    # covers and the matcher passed over, which is how three Topaz of Swiftness
    # augments credited nothing while the coverage numbers read as complete.
    speed_split_mod.check_augment_coverage(aug_pool, _speed_aug_shard, _speed_aug_coverage)
    # #191 — the augment channel of the Elemental Resistance expansion. One
    # augment carries the compound today (Draconic Soul Gem), and coverage of
    # the item channel is not coverage of this one (#293's lesson): an augment
    # carrier left unexpanded would ship an affix no player can rank, because
    # the compound's picker removal above is global by name.
    _er_aug_coverage = er_split_mod.apply(aug_pool, _er_shard)
    # #546 — the augment channel of the Riposte split. `Sapphire of Riposte` and
    # `Legendary Sapphire of Riposte` carry the folded affix and live in the
    # `<Color> Augment Slot` pools, NOT the planner item roster, so the item-side
    # apply above never reaches them. The Legendary one is the item the reporter
    # actually named, so leaving this out would ship a "fix" that misses the
    # motivating case — coverage of the item channel is not coverage of this one
    # (#293's lesson again). Same shard: both are Arabic and share its snapshots.
    _riposte_aug_coverage = riposte_split_mod.apply_to_augments(aug_pool, _riposte_shard)
    variants = expand_dataset(enriched_items + aug_pool)  # native path (verbatim affixes)

    # #338 — the Dinosaur Bone blanks join the variant list HERE, ahead of every
    # native tier pass, so ONE pipeline covers natives and blanks alike. They used
    # to be appended after `verify_mod.apply` below, which forced `src/dino.py` to
    # hand-replicate three stages (set-tier parse, umbrella, spell-focus) just to
    # keep a blank shaped like a native — and silently skipped the ones it did not
    # replicate: the parrying / heightened-awareness / speed `expand_set_bonuses`
    # passes and the expanded-away-orphan and helpless-fold guards further down. A
    # catalog refresh adding such a clause to a Dread Isle tier would have expanded
    # on the native carriers and survived RAW on the blanks, caught only when the
    # pytest tier==native pin ran, never on a bare build. Appending here deletes the
    # duplication rather than widening it: `src/dino.py` now stamps `sets` +
    # `set_bonus` and nothing else, and every derivation below is the native one.
    #
    # The comment that used to defend the late append ("added AFTER verify so their
    # empty affix list does not quarantine them") was stale twice over: verify.py
    # already admitted a set-member variant, and #338 adds the Dino-slot clause that
    # admits all eleven — including the four carrying no intrinsic set, whose value
    # is entirely the typed insert slots the solver fills.
    variants = variants + dino_blanks

    # #495 — join the free-text `location_quest` to the curated, wiki-sourced pack
    # mapping and stamp `location_pack` / `location_kind` on every variant. Stamped
    # HERE, on the final variant list, so a synthesized record (a Dino blank, a
    # crafted twin) is classified by the same rule a native one is rather than
    # silently missing the fields. Coverage is measured against this same list, so
    # the number in `metadata` describes what shipped, not what the seed hoped for.
    _pack_mapping = packs_mod.load()
    packs_mod.apply_to(variants, _pack_mapping)
    _pack_coverage = packs_mod.check(variants, _pack_mapping)

    # #285 — the crafted predecessors. Applied AFTER the pack stage so it can see the
    # `location_kind` that stage set, and can leave it alone for a variant that already
    # records a real source: the lineage is extra information about such an item, not a
    # replacement for what it already told the player.
    _lineage_mapping = lineage_mod.load()
    _lineage_coverage = lineage_mod.check(variants, _lineage_mapping)

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

    # #283 / #545 — Dino insert capacity for the NATIVE hosts. They ship already,
    # correctly typed and carrying their own affixes, and were missing only the
    # insert slots their own crafting list grants them. So nothing is synthesized
    # to stand in for them: the eleven synthetic blanks exist because their native
    # counterparts carry NO affixes, and replacing one of THESE would delete a
    # real affix (the #364 trap, one channel over).
    #
    # Two derived populations, one seam. #283 covers the two hosts naming a
    # `(quarterstaff)` pool; #545 covers the 122 naming a base pool. Both qualify
    # by naming a pool themselves — never by appearing on a list — and both are
    # stamped through `stamp_dino_capacity`, so they cannot drift into stamping
    # the same record twice or disagreeing about what a host is.
    #
    # Stamped HERE, after expand_dataset, for the same reason the joker groups
    # above are: variants rebuild from a fixed field list, so a field stamped on
    # the base record would be dropped.
    _qs_hosts = dino_mod.native_quarterstaff_hosts(_raw_items, crafting)
    _native_hosts = dino_mod.native_dino_hosts(
        _raw_items, crafting, blank_source_items=_host_pipeline_names)
    _overlap = set(_qs_hosts) & set(_native_hosts)
    if _overlap:
        raise SystemExit(
            f"dino capacity stamp: {sorted(_overlap)} qualify as BOTH a #283 "
            "quarterstaff host and a #545 base host. The two populations are "
            "meant to partition the hosts, so an overlap means one of the two "
            "selection rules has drifted.")
    _dino_hosts_stamped = dino_mod.stamp_dino_capacity(
        variants, {**_qs_hosts, **_native_hosts})
    # #545 — the population, disclosed. "How many natives carry insert capacity,
    # and which ones" is read off the artifact rather than recounted by hand: the
    # count on the issue was wrong three times over because it lived in prose.
    dino_cov["quarterstaff_hosts_stamped"] = len(_qs_hosts)
    dino_cov["native_hosts_stamped"] = len(_native_hosts)
    dino_cov["native_host_names"] = sorted(_native_hosts)
    dino_cov["native_host_slot_counts"] = {
        n: len(k) for n, k in sorted(_native_hosts.items())}
    dino_cov["capacity_carriers_total"] = _dino_hosts_stamped + dino_cov["blank_hosts"]

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
    # #359 — stamp acquirability on the emitted variants (an augment's variant_id
    # is its name). Here rather than on the upstream pool record, for the same
    # reason `aug_color` is annotated here: the variant is what every consumer
    # reads, and a pool-record field does not survive expansion.
    _acq_coverage = acquirability_mod.apply(variants, _acquirable)
    acquirability_mod.assert_join(_acq_coverage, ACQUIRABILITY_PATH)
    # #205 — the same treatment for universal spell-DC affixes. `Spell Focus
    # Mastery` raises the DC of every school, but a school-ranked target credited
    # only exact name matches, so no sacred/quality/insightful focus could ever be
    # picked. Expanding into the seven schools at the same bonus type lets the
    # existing max-per-(stat, stacking type) bucketing reproduce both wiki rules:
    # same type collapses to the highest, different types stack. Covers BOTH the
    # item and set-bonus channels (516 set tiers grant it).
    _spell_focus_counts = spell_focus_mod.expand_variants(variants)
    # The crafting/choice pools are a THIRD channel the variant pass cannot reach:
    # their options live in their own top-level arrays, not on a variant. Because
    # the universal names leave the picker, an unexpanded option here would target a
    # stat no player can rank — reachable before this change, unreachable after.
    # That is a silent loss, and the set-bonus orphan guard does not cover these
    # pools. Same `{stat, bonus_type, ...}` shape, so the same expander applies.
    # Each pool is expanded where it is built; this one already exists here. A dino
    # insert is a multi-affix record, so the expansion goes one level in.
    for _insert in dino_inserts:
        if _insert.get("affixes"):
            _insert["affixes"] = spell_focus_mod.expand_affixes(_insert["affixes"])
    # #289 — the Dino SET defs are a separate flat-affix structure (no tiers) and
    # carry their own universal spell-DC wording: The Legendary Dread Isle's
    # Curse grants `Spell DCs | Profane | 2`, which scored zero against every
    # school priority until `spell dcs` joined the universal allowlist. Same
    # one-level-in expansion as the inserts above.
    # #293 — the same channel also carries its own umbrella wording: Echoes of
    # the Walking Ancestors and The Legendary Dread Isle's Curse grant `Well
    # Rounded`, which the variant pass (umbrella_mod.expand_variants above)
    # cannot reach because these defs are a top-level array, not a variant.
    # Same one-level-in expansion as spell_focus below, umbrella first to
    # mirror the variant-pass order (the families are disjoint, so order only
    # affects readability).
    for _dset in dino_sets:
        if _dset.get("affixes"):
            _dset["affixes"] = umbrella_mod.expand_affixes(_dset["affixes"])
            _dset["affixes"] = spell_focus_mod.expand_affixes(_dset["affixes"])
    # U4 — per-channel spelling guard: no dino_sets stat may be a fold-away
    # synonym from the frozen registry ("Universal Spellpower" hid here because
    # this hand-carried wiki channel never passed through a synonym fold). Runs
    # AFTER the expansion above so it inspects the channel exactly as emitted;
    # raises on zero records — an empty channel is a failure, never a pass.
    dino_parser_mod.check_set_records_spelling(dino_sets)
    # #293 — per-channel expansion guard: after the expansions above, no
    # dino_sets stat may be an expanded-away umbrella/universal name or an
    # unsplit compound from the parse-time split table. Same refuses-zero
    # semantics as the spelling guard.
    dino_parser_mod.check_set_records_expanded(dino_sets)
    # #169 — the same treatment for the version-bearing affixes inside SET BONUS
    # tiers. The item split above cannot reach this channel: a tier affix is
    # `{"stat": ..., "bonus_type": ...}` while an item affix is
    # `{"name": ..., "type": ...}`, so a name-keyed predicate runs over it and
    # matches nothing. Protector's Heart granted `Parrying` — a name the picker
    # no longer offers — until this ran.
    _parrying_sets = parrying_split_mod.expand_set_bonuses(variants, _parrying_shard)
    _ha_sets = heightened_awareness_mod.expand_set_bonuses(variants, _ha_shard)
    # #171 — Speed's set-bonus channel. Note it expands to MOVEMENT ONLY, not to
    # the three stats the item channel produces: the wiki writes the Marshwalker
    # bonus as prose ("+30% Enhancement bonus to movement speed"), not as a
    # `{{Speed|30}}` invocation, so the attack-speed half the enchantment carries
    # is not stated here. gear-planner's affix name is a collision, not the same
    # mechanic. Takes no shard for the same reason — there is no tooltip to read.
    _speed_sets = speed_split_mod.expand_set_bonuses(variants)

    # A quarantined tier affix is DROPPED, so the set silently loses that bonus
    # rather than granting a guessed one. Quarantining is the right call — it is
    # exclude-until-verified — but a silent one defeats the point: the rule is
    # that a visible gap beats a confident wrong number, and a dropped affix is
    # not visible. Nothing asserted this before, and #171 adds a value-keyed
    # quarantine path for Speed that would have been the first to go quiet.
    _set_quarantined = {"parrying": _parrying_sets["quarantined"],
                        "heightened_awareness": _ha_sets["quarantined"],
                        "speed": _speed_sets["quarantined"]}
    if any(_set_quarantined.values()):
        raise SystemExit(
            "set-bonus affixes were quarantined — the wiki has not stated those "
            "magnitudes, so those sets silently lost a bonus. Harvest them or "
            "record the reading:\n  " +
            "\n  ".join(f"{name}: {n}" for name, n in _set_quarantined.items() if n))

    # A set-bonus tier still naming an expanded-away stat grants something no
    # player can rank. The allowlist is empty: `speed` was the last entry and is
    # expanded above as of #171, so any NEW orphan fails the build rather than
    # going quiet.
    _KNOWN_SET_BONUS_ORPHANS = ()
    _expanded_away_map = {
        **umbrella_mod.umbrella_expansion(),
        **spell_focus_mod.expanded_away(),
        **speed_split_mod.EXPANDED_AWAY,
        **parrying_split_mod.EXPANDED_AWAY,
        **riposte_split_mod.EXPANDED_AWAY,
        **heightened_awareness_mod.EXPANDED_AWAY,
        # #249 — no set-bonus tier names a compound absorption stat today, so
        # this registration is a standing gate rather than a live expansion: a
        # set bonus carries no per-item shard key to read a Sonic flag from, so
        # a future one must fail the build loudly rather than be guessed.
        **absorption_split_mod.EXPANDED_AWAY,
        # #191 — same standing gate for the resistance compound.
        **er_split_mod.EXPANDED_AWAY}
    _set_orphans = enchantment_split_mod.set_bonus_orphans(
        variants, _expanded_away_map, allow=_KNOWN_SET_BONUS_ORPHANS)
    if _set_orphans:
        raise SystemExit(
            "set-bonus affixes name an expanded-away stat no player can rank:\n  " +
            "\n  ".join(f"{s} — {stat} {val}" for s, stat, val in _set_orphans))

    _rankable_list = rankable_affixes(planner_records, _untyped_allow, variants)
    # #381 — the fold entries no channel fired this build. Upstream ADOPTED four
    # of the five `Legendary <stat>` folds in the 2026-08-18 refresh: they now
    # arrive already folded, so nothing is left to fold, no affix carries the
    # provenance receipt, and the engraved names left the picker vocabulary — a
    # character saved before the refresh ranks a name nothing carries and nothing
    # redirects. Derived, never hand-listed: the next adoption does this again,
    # silently.
    #
    # UNIONED across all three channels the fold runs on: a label folded in the
    # augment pool alone (`Legendary Conditioning`, which name_corrections mints
    # from `False Life (%)` upstream of the fold) is live, not retired. That is
    # also why the condition is "did not fire" rather than "has zero
    # occurrences" — all five have zero RAW occurrences today.
    _retired_legendary = legendary_fold_mod.retired_labels(
        _legendary_fold_cov_sets, _legendary_fold_cov, _legendary_fold_cov_augments)
    # And the guard that keeps the migration honest: substituting a saved
    # priority onto a stat the picker no longer ships would repair the save into
    # a different silent zero. Checked against the SAME curated list the picker
    # suggests from.
    legendary_fold_mod.assert_targets_rankable(_retired_legendary, _rankable_list)
    # #91 (U1) — the Utility tier's counting vocabulary: Bool presence names
    # passing presence-minus-magnitude (the subtraction drops the four
    # dual-nature names), RESTRICTED to the curated tier-1 list. #343 removed
    # the allow-dispositioned untyped procs from this union — they stayed
    # rankable in the picker but stopped being counted. Computed
    # AFTER every correction/split above so demoted-to-presence affixes are
    # seen, and against the SAME records rankable_affixes read, so the
    # subtraction is exact. Stamped as metadata below; the app consumes the
    # stamp rather than re-deriving it.
    _utility_counting = utility_procs_mod.counting_set(
        planner_records, _rankable_list)
    # #91 (U3, KTD10) — the FULL presence-minus-magnitude population size, kept
    # beside the tier-1 restriction for the coverage disclosure: it states how
    # much of the derivable population v1 deliberately does not count yet.
    _utility_presence_full = len(
        utility_procs_mod.presence_counting_names(planner_records)
        - set(_rankable_list))
    # #305 — per-channel helpless-spelling guard, item-attached channel: no
    # parsed_set_bonuses tier may still carry a fold-away helpless-damage
    # spelling (the set_parser parse seam folds them to `Damage to helpless
    # enemies`). Same refuses-zero semantics as the dino_sets spelling guard;
    # the def channels get their own calls below (per-channel, never vouched
    # for by a sibling). Runs AFTER the expansions above so it inspects the
    # channel exactly as emitted. docs/wiki-evidence/helpless-damage.md.
    helpless_fold_mod.check_channel(
        "parsed_set_bonuses",
        (a.get("stat")
         for v in variants for t in v.get("parsed_set_bonuses") or []
         for a in t.get("affixes") or []))
    # Vecna Lost Purpose: the membership set defs come from the SAME set catalog that feeds
    # intrinsic set members (single source of truth), so an awakened Lost Purpose set gives the
    # identical bonus + stat vocabulary as an intrinsically-completed one. Attach the
    # chosen-set-membership slot (pool = same-tier Vecna sets that resolve to a def)
    # to every item carrying a `lost_purpose` tier marker.
    membership_defs = membership_mod.build_membership_set_defs(_set_catalog)  # reuse the catalog loaded above
    for _mdef in membership_defs.values():                     # #205, third channel
        for _tier in _mdef.get("tiers") or []:
            if _tier.get("affixes"):
                _tier["affixes"] = spell_focus_mod.expand_affixes(_tier["affixes"])
    # #305 — the same guard on the membership-def channel (built from the same
    # set catalog through the same parse seam, but a separate emitted structure
    # a sibling guard cannot vouch for).
    helpless_fold_mod.check_channel(
        "membership_set_defs",
        (a.get("stat")
         for _d in membership_defs.values() for _t in _d.get("tiers") or []
         for a in _t.get("affixes") or []))
    membership_mod.attach_lost_purpose_slots(variants, membership_defs)
    variants, cov = verify_mod.apply(variants)          # per-affix verification gate

    # U4 — Dino Set-Bonus: activate the chosen-set-membership slot on the Dinosaur
    # Bone Armor/Helmet/Cloak Set-Bonus hosts. Same primitive as Vecna Lost Purpose;
    # the 6 Dino sets are self-seeded from the same catalog, crafted at the Dinosaur
    # Bone station. Mutates the blank dicts in place — they are already IN `variants`
    # as of #338, so this reaches the emitted records without a re-append.
    membership_mod.attach_dino_set_bonus_slots(dino_blanks, membership_defs)

    # U2 — Augment Sets: stamp the 21 "Set Augment: X" Colorless augment variants
    # with their set linkage (canonical `set` name, `pieces_required`, and the
    # `set_augment` source-family marker) and flip them verified so they enter the
    # solve. Run AFTER verify (like the Dino blanks): a Set Augment ships an empty
    # affix list, so passing back through verify quarantines it; stamping verified
    # here makes the flip stick. The defs come from the SAME augment_sets seed that
    # the top-level `augment_set_defs` key (emitted below) exposes to the solver.
    augment_set_defs = membership_mod.build_augment_set_defs()
    # #289 — the FOURTH universal spell-DC channel, and the one Esoterica shipped
    # broken in: these defs are built from their own seed and never pass through
    # the variant expansion, so a universal stat here (`Spell DCs`) granted a
    # bonus no player could rank and the solver never pursued the set. Same
    # one-level-in shape as the membership defs above.
    for _adef in augment_set_defs.values():
        for _tier in _adef.get("tiers") or []:
            if _tier.get("affixes"):
                _tier["affixes"] = spell_focus_mod.expand_affixes(_tier["affixes"])
    # #289 — and the guard that makes the gap impossible to reopen quietly: the
    # def channels get the same expanded-away orphan check the variant set-bonus
    # channel has had since #171. Empty allowlist by design.
    _def_orphans = enchantment_split_mod.set_def_orphans(
        {"membership": membership_defs, "augment": augment_set_defs},
        _expanded_away_map, allow=())
    if _def_orphans:
        raise SystemExit(
            "set-def tier affixes name an expanded-away stat no player can rank:"
            "\n  " +
            "\n  ".join(f"{s} — {stat} {val}" for s, stat, val in _def_orphans))
    # #305 — the same guard on the augment-set-def channel. Its fold lives in
    # the reviewed seed itself (augment_sets.json canonicalized `Damage vs.
    # Helpless`, the channel's established precedent — see the seed's
    # `stat_note`), so this guard is what keeps the spelling from returning.
    helpless_fold_mod.check_channel(
        "augment_set_defs",
        (a.get("stat")
         for _d in augment_set_defs.values() for _t in _d.get("tiers") or []
         for a in _t.get("affixes") or []))
    augment_sets_mod.attach_augment_set_slots(variants, augment_set_defs)
    # #316 — the attach above also forwards each variant's baked `fits_slots`
    # (stamped at the variant loop from src.colors) onto its def; this guard
    # fails the build if any def was left matrix-less by join drift.
    augment_sets_mod.assert_def_matrix_join(augment_set_defs, variants)

    # U81 Nearly Complete: expose the parametric choice-slot effect pool. Items
    # carrying a `nearly_complete: <category>` field draw one option from it (host
    # items pending wiki; the pool + machinery ship now).
    nc = nc_mod.build_nearly_complete(crafting)
    # #211 — the category NC pool is ATOMIC (one record per option): the
    # expansion goes one level IN, inside the option's own affix list, exactly
    # as the Viktranium channel below. The Skill-category menus offer the
    # ability-skills umbrellas ("Charisma Skills +6"), and one craft grants
    # every component skill together.
    for _opt in nc["records"]:
        if _opt.get("affixes"):
            _opt["affixes"] = spell_focus_mod.expand_affixes(_opt["affixes"])

    # U75 (Chill of Ravenloft) Viktranium ("Lamordia") crafting: expose the typed choice-slot pool
    # keyed by (slot_type, item-category). Items carrying `lamordia_slots` draw
    # one option per slot from the matching pool (tier from host ML at solve time).
    # #365 — the curated wiki-sourced pool relocation, applied to the loaded
    # catalog immediately BELOW the loader and ABOVE the builder, so
    # `build_viktranium` reads pools that match the wiki's table assignment and
    # no second code path exists. gear-planner owns the affix vocabulary; the
    # wiki owns which (slot_type, category) pool an option belongs to, and it
    # files `Woeful Quality Spell Focus Mastery` in the Accessories Wicked
    # table while gear-planner carries it under `Woeful (Weapon)`. That left
    # the Woeful accessory pool offering DCs as Profane and Sacred only, so a
    # caster slotting a Woeful accessory could never reach the +2 Quality DC
    # the game grants. `check` runs on the catalog as loaded — that is what the
    # staleness guard means: it fails the build if upstream fixed the
    # misfiling (retire the shard), if the destination already offers the
    # option (a no-op correction), or if the option's vocabulary/ml moved.
    _vik_pool_relocations = vik_pool_mod.load(VIK_POOL_CORRECTIONS_PATH)
    _vik_pool_checked = vik_pool_mod.check(_vik_pool_relocations, crafting)
    _vik_pool_coverage = vik_pool_mod.apply(_vik_pool_relocations, crafting)
    vik = vik_mod.build_viktranium(crafting)
    # #283 — the `(quarterstaff)` sibling pools are read softly (not every pool
    # HAS a sibling), so a dropped upstream key would silently under-credit every
    # quarterstaff host rather than fail. Pin the ones known to ship.
    _vik_qs_checked = vik_mod.assert_quarterstaff_pools(vik["coverage"])
    # #205, third channel. A Viktranium option is a multi-affix record like a dino
    # insert, so the expansion goes one level IN — inside the option's own affix
    # list, never across the record list. Expanding across records turned one
    # universal spell-DC option into seven competing options for the same slot,
    # so a player ranking two schools had to spend two Viktranium slots to get
    # what one option grants in game.
    for _opt in vik["records"]:
        if _opt.get("affixes"):
            _opt["affixes"] = spell_focus_mod.expand_affixes(_opt["affixes"])

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
    # #374/KTD2 — thread the ALREADY-RENAMED `crafting` catalog, do not let these
    # two builders re-load it from disk. Their `catalog=None` default calls
    # `crafting_catalog.load_catalog()` a second time, which re-reads the raw file
    # and so bypasses the canon rename applied at the catalog's single load point
    # above. That is not hypothetical: the Thunder-Forged Weapon pools shipped 18
    # records under upstream's generic spellings (`Fire Spell Power`, ...) while
    # every other pool carried our canon, splitting one mechanic across two
    # buckets. The comment on that rename claimed it already covered green-steel
    # and thunder-forged; it did not, because of these two argument-less calls.
    tf = tf_mod.build_thunder_forged(crafting)
    gs = gs_mod.build_green_steel(crafting)

    # Essence Crafting — the Gem of Many Facets' three Trinket menus (#193/#599).
    # An option is offered only when its PLACEMENT, BONUS TYPE and ML CURVE are all
    # sourced; `catalog_stats` is passed so an option naming a stat nothing else
    # uses cannot slip through and get a private bucket that stacks with every real
    # item. That is the double-count the bonus-type harvest exists to prevent, and
    # it would arrive through the front door.
    _catalog_stats, _catalog_units = set(), {}
    for _v in variants:
        for _a in _v.get("affixes") or []:
            _st = _a.get("stat")
            if not _st:
                continue
            _catalog_stats.add(_st)
            _catalog_units.setdefault(_st, set()).add(_a.get("unit") or "flat")
    essence = essence_mod.build_trinket_pool(catalog_stats=_catalog_stats,
                                             catalog_units=_catalog_units)

    # Only `verified` hosts keep live menus. `Trinket [Crafted]` declares the same
    # three and is quarantined with a placeholder ML 1 — crafting real numbers onto
    # a record we do not trust is how an unverified item becomes a recommendation.
    essence_active, essence_pending = {}, {}
    for v in variants:
        if not v.get("essence_slots"):
            continue
        if v.get("verification") == essence_mod.REQUIRED_VERIFICATION:
            essence_active[v["source_item"]] = len(v["essence_slots"])
        else:
            essence_pending[v["source_item"]] = len(v["essence_slots"])
            v["essence_slots"] = None
    essence["coverage"]["hosts_active"] = len(essence_active)
    essence["coverage"]["slots_active"] = sum(essence_active.values())
    essence["coverage"]["hosts_pending"] = sorted(essence_pending)
    if not essence_active:
        raise SystemExit(
            "Essence Crafting: the pool has options but NO verified host carries a menu. "
            "The pool would be inert while the coverage gate reports the labels served — "
            "exactly the overstatement this gate exists to prevent.")

    # #211 — the umbrella-affix detector. Every rankable-or-craftable name
    # sharing a registered family's component head-word (`... Focus`,
    # `... Absorption`, `... Save`, ...) or matching the umbrella name shapes
    # must resolve: either a mechanism models it (an expansion family, a
    # cross-add source) or a curated `atomic` ruling carries the
    # rendered-tooltip evidence. An unresolved candidate fails the build — it
    # is a latent #205 (232 affix instances credited nothing to any school
    # priority for the life of the feature; this detector's first sweep found
    # `Resistance` at 245 instances and the six ability-skills umbrellas).
    #
    # The universe is the PICKER's: worn rankable names PLUS every crafting
    # pool's affix names — `Constitution Skills` lives only in the
    # Nearly-Complete Skill menu and was invisible to a worn-only sweep. Runs
    # AFTER every pool is built for exactly that reason.
    _pool_names = vocabulary_mod.pool_affix_names(
        [nc["records"], vik["records"], sl["records"], tf["records"],
         gs["records"], dino_inserts,
         *[v for v in (nc.get("per_item") or {}).values()]],
        set_defs=[membership_defs, augment_set_defs])
    _family_components = {c for comps in _expanded_away_map.values()
                          for c in comps}
    _modeled_names = set(_expanded_away_map) | set(
        cross_add_mod.SPELLPOWER_SOURCES) | set(cross_add_mod.LORE_SOURCES)
    _umbrella_universe = sorted(set(_rankable_list) | _pool_names)
    _umbrella_queue = vocabulary_mod.umbrella_candidates(
        _umbrella_universe, _family_components, _modeled_names)
    _umbrella_report = vocabulary_mod.check_umbrella_adjudications(
        _umbrella_queue,
        vocabulary_mod._load(vocabulary_mod.UMBRELLA_ADJUDICATIONS_PATH),
        _umbrella_universe)

    # U3 (#205) — the fan-out gate. Every single-pick choice-slot container is
    # declared in src/container_registry.py, and a container that turns ONE source
    # option into more than one record fails the build. That is the reported defect:
    # a choice slot takes exactly one record, so a split option delivers a fraction
    # of what the craft grants in game — a Viktranium craft granting seven spell
    # schools delivered one.
    #
    # The gate runs AFTER the dataset is assembled (see below, just before build_id),
    # not here, so it discovers its own containers by walking the built structure
    # instead of judging a hand-typed list of pools at this call site. That list was
    # its own hole: `nearly_complete_per_item` shipped 43 hosts and 147 records
    # without ever appearing in it, so nothing — including the pinned container
    # count — could see it. What IS collected here is each builder's SOURCE option
    # count, because only the builder knows how many options it read.
    _container_source_options = {
        "viktranium": vik["source_options"],
        "dino_inserts": dino_cov["insert_source_options"],
        "nearly_complete": nc["source_options"],
        "nearly_complete_per_item": nc["per_item_source_options"],
        "seal": sl["source_options"],
        "green_steel": gs["source_options"],
        "thunder_forged": tf["source_options"],
        # One record per (menu, effect) by construction — the pool has no
        # multi-affix option to split, so source options and records are the
        # same population and the gate's equality check is exact.
        "essence_crafting": len(essence["records"]),
    }

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

    # #262 — stamp `no_drop_source: True` onto the confirmed variants,
    # ONLY-WHEN-SET (the QUARANTINE_FIELD precedent in src/variants.py — never
    # False/null; its 353KB null-stamping lesson). Gated on shard entries so an
    # empty seed is FULLY inert: no per-variant flags AND no coverage metadata
    # block, keeping the built dataset byte-identical to baseline (AE2). The
    # solver never reads the field — flagged items remain candidates (R6).
    _no_drop_meta = {}
    if _no_drop_entries:
        no_drop_source_mod.stamp(variants, _no_drop_entries)
        _no_drop_meta = {"no_drop_source_coverage":
                         no_drop_source_mod.coverage(variants, _no_drop_entries)}

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
            "essence_crafting_coverage": essence["coverage"],
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
            # U3 (#205) — the single-pick choice-slot fan-out gate. Filled in below,
            # once the dataset is assembled and the gate has walked it. `compared`
            # counts records whose shape was actually inspected; `checked` counts
            # containers reached a verdict on, which alone would overstate coverage
            # because a container declared unreachable contributes zero records.
            "container_registry_coverage": None,
            # #154 / #162 — wiki-harvest coverage, disclosed so a result can say what
            # was and wasn't considered. `unclassified` on the material side is the
            # honest measure of how complete the druidic-oath restriction actually is:
            # those items pass the gate because their metalness is unsourced.
            "speed_split_coverage": {**_speed_coverage, "shard_audit": _speed_audit,
                                     "tooltip_snapshots": _speed_snapshots,
                                     "tooltip_guard_checked": _speed_guard["checked"]},
            # The augment half of the same split, disclosed separately because it
            # reads a different shard on a different join key.
            "speed_augment_coverage": {**_speed_aug_coverage,
                                       "shard_audit": _speed_aug_audit,
                                       "tooltip_snapshots": _speed_aug_snapshots,
                                       "tooltip_guard_checked": _speed_aug_guard["checked"]},
            # The Parrying half (#169). Joins by item NAME, because the wiki page
            # groups its items by version and the name is the key that grouping
            # publishes. `armor_class_corrected` counts the items whose stored
            # magnitude was a flattened Roman rank.
            "parrying_set_bonus_coverage": _parrying_sets,
            "heightened_awareness_set_bonus_coverage": _ha_sets,
            "speed_set_bonus_coverage": _speed_sets,
            "parrying_split_coverage": {**_parrying_coverage,
                                        "shard_audit": _parrying_audit,
                                        "tooltip_snapshots": _parrying_snapshots,
                                        "tooltip_guard_checked": _parrying_guard["checked"],
                                        "tooltip_guard_compared": _parrying_guard["compared"]},
            # #546 — Parrying's sibling, reported separately per channel. The
            # augment counters are their own entry rather than summed into the
            # item ones: two augments carry this affix and a regression that
            # silently stopped covering them would be invisible in a total.
            "riposte_split_coverage": {**_riposte_coverage,
                                       "augment_channel": _riposte_aug_coverage,
                                       "shard_audit": _riposte_audit,
                                       "tooltip_snapshots": _riposte_snapshots,
                                       "tooltip_guard_checked": _riposte_guard["checked"],
                                       "tooltip_guard_compared": _riposte_guard["compared"]},
            # The Heightened Awareness half (#169). One output stat, no version
            # branch. `compared` counts values actually matched against a parsed
            # tooltip, which `checked` alone would overstate.
            "heightened_awareness_coverage": {
                **_ha_coverage, "shard_audit": _ha_audit,
                "tooltip_snapshots": _ha_snapshots,
                "tooltip_guard_checked": _ha_guard["checked"],
                "tooltip_guard_compared": _ha_guard["compared"]},
            # The compound-absorption family (#249). `expanded` counts compound
            # affixes turned into components; `components` counts the affixes
            # emitted. `excluded` NAMES every quarantined carrier and why — the
            # dataset-level half of R7's disclosure, whose per-result half rides
            # on each variant's own quarantine marker. There is no `uncovered`
            # counter by design: an uncovered carrier is a quarantined one.
            "compound_absorption_coverage": {
                **_absorption_coverage,
                "shard_audit": _absorption_audit,
                "tooltip_snapshots": _absorption_snapshots,
                "tooltip_guard_checked": _absorption_guard["checked"],
                "tooltip_guard_compared": _absorption_guard["compared"]},
            # #191 — the resistance twin, same counter vocabulary and the same
            # no-`uncovered`-counter rule: an uncovered carrier is a quarantined
            # one, named in `excluded`.
            "elemental_resistance_coverage": {
                **_er_coverage,
                "augments": _er_aug_coverage,
                "shard_audit": _er_audit,
                "tooltip_snapshots": _er_snapshots,
                "tooltip_guard_checked": _er_guard["checked"],
                "tooltip_guard_compared": _er_guard["compared"]},
            "material_coverage": {**_material_stamp, **_material_coverage},
            # The curated metal/non-metal map the druidic-oath gate reads. A
            # material absent from this map is UNKNOWN, and the gate fails open.
            "material_classification": material_mod.classification(_material_class),
            # U7.5 — wiki-validated gap-corrections overlay coverage (sanctioned
            # minimal exception to gear-planner sole-authority).
            "gap_corrections_coverage": _gap_coverage,
            "cannith_tier_coverage": _cannith_coverage,
            # #495 — what the curated location_quest -> pack mapping actually covers,
            # measured against the live population rather than claimed by a date.
            "adventure_pack_coverage": _pack_coverage,
            # #285 — what the crafted-predecessor backfill reached.
            "crafting_lineage_coverage": _lineage_coverage,
            "value_corrections_coverage": _value_coverage,
            "name_corrections_coverage": _name_coverage,
            # #259 — bonus-type corrections, disclosed per channel: the same
            # entry set is offered to items and augments, and an entry is only
            # an error when NO channel carries it.
            "type_corrections_coverage": {
                "items": _type_coverage_items,
                "augments": _type_coverage_augments,
            },
            # #260 — the wiki-sourced ML36 augment tier: what the guard vouched
            # for per color, and what was injected into the pools.
            "ml36_augment_coverage": {**_ml36_coverage, "checked": _ml36_checked},
            # #365 — the wiki-sourced Viktranium pool relocations: which
            # misfiled options were moved, and into which pools.
            "viktranium_pool_corrections": {**_vik_pool_coverage,
                                            "checked": _vik_pool_checked},
            # #262 — wiki-confirmed no-drop-source coverage. Present ONLY when
            # the shard has entries; the empty seed emits no block at all (AE2).
            **_no_drop_meta,
            "untyped_rankable_coverage": {
                "candidates": _untyped_checked,
                "allowed": len(_untyped_allow),
                "quarantined": len(_untyped_quarantined),
            },
            # #91 (U1) — the Utility tier's counting vocabulary and its
            # untyped-proc adjudication disclosure. `utility_counting_set` is
            # the authoritative name set a distinct-effect count may count;
            # `utility_untyped_admitted` is its allow-dispositioned untyped
            # half, which the picker adds as PRESENCE targets (suggest +
            # on/off badge) — deliberately NOT rankable_affixes: a
            # declared-credit control on Holy/Vampirism is the documented
            # defect web/dataset.js warns against.
            # #359 — owned-augment mode's disclosure reads these, so the sentence
            # it shows the player is a build-time fact rather than a recount in the
            # view layer (the stamped-universe convention: see [[Triage universe]]).
            "augment_acquirable_count": _acq_coverage["stamped"],
            "augment_total_count": _acq_coverage["augments"],
            "utility_counting_set": _utility_counting,
            "utility_untyped_admitted": sorted(_uproc_allow),
            # #380 — the counted/not-counted split, restated against the
            # population that carries these effects since the 2026-08-18
            # re-encoding typed every weapon proc `Bool`. Derived, never
            # curated; disjoint from utility_counting_set by construction. The
            # app unions it with the untyped allow half above, which stays
            # armed for its own (now 25-name, fully quarantined) population.
            "utility_presence_not_counted": utility_procs_mod.presence_not_counted(
                planner_records, _utility_counting, _rankable_list),
            "utility_procs_coverage": {
                "candidates": _uproc_checked,
                "allowed": len(_uproc_allow),
                "quarantined": len(_uproc_quarantined),
                # #91 (U3, KTD10) — the counting set's Bool half is restricted
                # to the curated tier-1 list; the names outside it are
                # derivable, not quarantined, so the restriction is disclosed
                # here rather than filed per name.
                "tier1_size": len(utility_procs_mod.UTILITY_TIER1_PRESENCE),
                "full_presence_population": _utility_presence_full,
                "note": ("v1 counts the curated tier-1 presence subset; "
                         "widening happens in measured batches per KTD10 "
                         "(plan 2026-08-15-002)"),
            },
            # #223 — DR qualifier split. `kept_numeric` counts magnitudes now
            # sharing the single unconditional bucket (max, never sum);
            # `demoted_names` lists the conditional enchantments now tracked as
            # presence, disclosed because a player who ranked DR for one of them
            # should be able to see where the number went.
            "dr_qualifier_coverage": _dr_coverage,
            "rankable_affixes": _rankable_list,
            # #211 — the umbrella detector's disclosure: how many names it
            # flagged and how each resolved. The queue itself lives in the
            # adjudication seed; an unresolved candidate never reaches here
            # because the check raises during build.
            "umbrella_detector": _umbrella_report,
            # U1 (#136) — names this build EXPANDS AWAY, mapped to what they become.
            # The picker drops them from suggestions and redirects the player to the
            # replacements, instead of offering a priority no item can satisfy.
            "expanded_away_names": {**umbrella_mod.umbrella_expansion(),
                                    **spell_focus_mod.expanded_away(),
                                    **speed_split_mod.EXPANDED_AWAY,
                                    **parrying_split_mod.EXPANDED_AWAY,
                                    **riposte_split_mod.EXPANDED_AWAY,
                                    **heightened_awareness_mod.EXPANDED_AWAY,
                                    **absorption_split_mod.EXPANDED_AWAY,
                                    **er_split_mod.EXPANDED_AWAY},
            # #381 — names this build RETIRED, mapped to what they became. Same
            # `{name: [stats]}` shape as `expanded_away_names` so the client's
            # substitution logic is familiar, but a DELIBERATELY SEPARATE map:
            # these were never shorthand for anything. Upstream adopted our fold,
            # so the enchantment is unchanged and still scores — it simply arrives
            # under its base-stat name now. The saved-character load path
            # substitutes them; they never re-enter the picker vocabulary, because
            # there is nothing left for a player to newly pick.
            "retired_labels": _retired_legendary,
            # U10 (R13) — the ORIGINATING enchantment name every expansion stamps on
            # the affixes it emits ("Sacred Spell Focus Mastery"), mapped to the stats
            # it becomes. The item surfaces DISPLAY these names, so the picker must be
            # able to rank them; without this the app prints a name its own picker
            # refuses. Distinct from `expanded_away_names` above, which carries only the
            # BARE keys a family declares — the displayed names are bonus-type prefixed.
            #
            # SCANNED from the built variants, never assembled from a family list: a
            # scan includes the next expansion family the moment it stamps its first
            # affix, whereas a list has a registration step somebody will forget. See
            # src/provenance.py.
            "provenance_labels": provenance_mod.label_expansions(variants),
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
            # U1 (#290/#291) — cross-add map {target_stat: [source_stats]}: stats
            # whose bucket totals flat-ADD into the target's total ACROSS buckets
            # (wiki fully-stacking universal sources — USP and the two universal
            # lores). The OPPOSITE contract from spell_focus's expansion table
            # (same-type max-bucketing reproduces don't-stack); src/cross_add.py
            # guards that no name is ever in both. Lore targets are bounded to
            # the built vocabulary. Emission plumbing only — solver crediting
            # reads this in a later unit (dataset.js installs it via setCrossAdd).
            "cross_add": cross_add_mod.cross_add_map(_affix_registry),
            "pipeline_stage": "M4-compendium-roster",
        },
        "items": variants,
        "dino_inserts": dino_inserts,
        "dino_sets": dino_sets,
        "nearly_complete": nc["records"],
        # Per-item Nearly Complete pools (Nearly Finished / Almost There), keyed by
        # host name — a DISTINCT mechanism from the category path above (never
        # conflated). SOLVER-WIRED since #371: a host carrying `nc_per_item_slots`
        # crafts one option from ITS OWN entry here, per declared pool.
        "nearly_complete_per_item": nc.get("per_item", {}),
        "viktranium": vik["records"],
        "seal": sl["records"],
        "thunder_forged": tf["records"],
        "essence_crafting": essence["records"],
        "green_steel": gs["records"],
        "membership_set_defs": membership_defs,
        # U2 — the 21 Augment-Set defs (3-piece Set Bonuses), same shape as
        # membership_set_defs. A later solver unit reads these together with each
        # verified "Set Augment: X" variant's `set` marker.
        "augment_set_defs": augment_set_defs,
        "compendium": comp_records,
    }

    # U3 (#205) — the fan-out gate, run over the ASSEMBLED dataset so it discovers
    # its own containers. Every top-level key must be either a declared single-pick
    # container or a declared non-container carrying the reason it is not one, so a
    # pool added without an audit fails rather than shipping unjudged. Runs after
    # every expansion pass, so a record-level provenance key is direct evidence an
    # expander crossed an option boundary, and a container declaring a pass that
    # left no stamp at all is evidence the pass was reverted to a no-op.
    out["metadata"]["container_registry_coverage"] = container_registry_mod.check(
        out, _container_source_options)

    # U1 — the unserved-crafting-slot gate. Runs over the ASSEMBLED dataset for
    # the same reason the fan-out gate above does, plus one of its own: it reads
    # each pool's DERIVED keying (`fits_slots`, `dino_type`, `seal_type`,
    # `category`), none of which exists in gearplanner_crafting.json. A declared
    # slot label no pool can fill is an inert slot — visible in the compendium,
    # uncraftable by the solver — and 35 such labels are allowlisted as known
    # gaps. A NEW one fails the build, and so does an allowlist entry the data no
    # longer justifies. Stamped as metadata (`labels_validated` is the validated
    # universe, not the walked one) so nobody hand-recounts a different predicate.
    out["metadata"]["crafting_slot_coverage"] = crafting_coverage_mod.check(out)

    # #547 — the `[Crafted]` twin identity. One game item the catalog carries as
    # two records (as it drops, and after its Essence Crafting slots are used),
    # which let a block on one silently deliver the other. Derived and ASSERTED
    # here rather than matched on the name suffix in the solver: a bare string
    # test would keep passing after the relationship it assumes stops holding.
    #
    # Runs AFTER `crafting_slot_coverage` because it reads that module's
    # definition of an unserved label — the folding is only correct while the
    # crafted state's extra slots are inert. Nothing is suppressed; only the
    # identity a player means when they block one of these is published.
    _twins = crafted_twins_mod.derive(out["items"], crafting_coverage_mod.UNSERVED_ALLOWLIST)
    if _twins["problems"]:
        raise SystemExit(
            "crafted-twin identity failed (#547) — a pair stopped being one item:\n  "
            + "\n  ".join(_twins["problems"]))
    # #566 — which rings may be worn twice, stamped per item. A ring is
    # duplicable unless the wiki records it as Exclusive or a Minor Artifact;
    # both are maintained categories, so this is a read, not an inference.
    # Replaces #442's allowlist, which asked whether any page STATED that two
    # copies work and found only two that did — the absence was structural, not
    # a gap. See docs/wiki-evidence/ring-exclusivity.md.
    #
    # Fail-closed survives the flip: a ring absent from the shard is refused.
    # Coverage is total today, so that refusal fires on nothing — and `check`
    # fails the build if it ever stops being total, rather than letting a new
    # ring inherit a default.
    #
    # Runs on `out["items"]`, after every pass that could change a ring's slot or
    # set membership, so the validation below judges the records that actually
    # ship rather than an earlier draft of them.
    _ring_excl_shard = ring_exclusivity_mod.load(RING_EXCLUSIVITY_SHARD_PATH)
    # #442's two rings were confirmed from unrelated evidence (verbatim wiki
    # `tips`), so requiring the blocklist to reproduce them turns the harvest's
    # predictive test into a standing build assertion.
    _ring_excl_corrob = ring_exclusivity_mod.load_corroboration(
        DUPLICABLE_RINGS_CORROBORATION_PATH)
    _ring_excl_check = ring_exclusivity_mod.check(
        _ring_excl_shard, out["items"], corroboration=_ring_excl_corrob,
        identity=_twins["identity"])
    if _ring_excl_check["problems"]:
        raise SystemExit(
            "ring-exclusivity shard failed (#566) — the harvest no longer describes "
            "the catalog:\n  " + "\n  ".join(_ring_excl_check["problems"]))
    _ring_excl_cov = ring_exclusivity_mod.apply(
        out["items"], _ring_excl_shard, identity=_twins["identity"])
    out["metadata"]["duplicable_ring_coverage"] = {**_ring_excl_cov, **_ring_excl_check}

    # #199 — intrinsic caps, emitted as {stat: cap}. Exclude-until-verified: only
    # the `caps` list ships; a stat in `refused` deliberately gets NO cap, so a
    # missing key means "the wiki states no ceiling", never "nobody looked".
    _caps_shard = json.load(open(INTRINSIC_STAT_CAPS_PATH, encoding="utf-8"))
    _intrinsic_caps = {}
    for _entry in _caps_shard.get("caps") or []:
        _stat, _cap = _entry.get("stat"), _entry.get("cap")
        if not _stat or not isinstance(_cap, (int, float)):
            raise ValueError(
                f"intrinsic_stat_caps.json: entry {_entry!r} has no usable stat/cap. "
                "Every entry must carry both, plus the verbatim wiki quote that states it.")
        if not _entry.get("quote") or not _entry.get("wiki_url"):
            raise ValueError(
                f"intrinsic_stat_caps.json: {_stat} carries no quote/wiki_url. A cap that "
                "traces to nothing silently truncates a real stat — see the evidence_rule.")
        _intrinsic_caps[_stat] = _cap
    out["metadata"]["intrinsic_stat_caps"] = _intrinsic_caps
    out["metadata"]["intrinsic_stat_caps_refused"] = sorted(
        r["stat"] for r in (_caps_shard.get("refused") or []) if r.get("stat"))

    out["metadata"]["crafted_twin_identity"] = _twins["identity"]
    out["metadata"]["crafted_twin_coverage"] = {
        "inspected": _twins["inspected"], "pairs": len(_twins["pairs"]),
        "capacity_divergent": len(_twins["capacity_divergent"])}
    # Pairs that are ONE ITEM for blocking but TWO CANDIDATES for solving, because
    # the crafted state's Essence menus are now served (#193). Surfaced rather than
    # absorbed: this is the property #547 originally asserted could not happen, and
    # a reader deserves to see which pairs it stopped holding for.
    out["metadata"]["crafted_twin_identity_divergent"] = _twins["capacity_divergent"]

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
    # R12 — an EXPANDED affix carries the enchantment name the player actually
    # sees on the item ("Sacred Spell Focus Mastery", "Profane Well Rounded",
    # "Parrying"). Carried at rest because the proof panel and every share export
    # must display it; without this the field dies here and the receipts name a
    # stat no item bears. This is the LATER of two carry points — the earlier one
    # is `src/variants.py:_native_parsed`, which the shard splits reach first.
    # The key check is generic on purpose: every expansion family stamps it.
    if spell_focus_mod.PROVENANCE_KEY in a:
        out[spell_focus_mod.PROVENANCE_KEY] = a[spell_focus_mod.PROVENANCE_KEY]
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
