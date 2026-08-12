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
from src import harvest as harvest_mod
from src import material as material_mod
from src import speed_split as speed_split_mod
from src import parrying_split as parrying_split_mod
from src import heightened_awareness as heightened_awareness_mod
from src import absorption_split as absorption_split_mod
from src import enchantment_split as enchantment_split_mod
from src import umbrella as umbrella_mod
from src import spell_focus as spell_focus_mod
from src import provenance as provenance_mod
from src import value_corrections as value_corrections_mod
from src import name_corrections as name_corrections_mod
from src import untyped_rankable as untyped_rankable_mod
from src import dr_qualifiers as dr_qualifiers_mod
from src import type_corrections as type_corrections_mod
from src import planner_items as planner_mod
from src import variants as variants_mod
from src import vocabulary as vocabulary_mod
from src import crafting_catalog as crafting_catalog_mod
from src import dino_native as dino_native_mod
from src import container_registry as container_registry_mod
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
    "Spell Intensity",               # universal spell crit damage; the Fire/Void/Kinetic
                                     # Intensity family is already rankable
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


def load_affix_vocabulary() -> tuple:
    """U5 — the affix-name registry + the variant->canonical alias table the web
    priority-picker consumes. The registry is the frozen checked-in affix-name
    vocabulary (``vocab_registries.json``); the alias map is the curated
    ``affix_aliases.json`` (``load_affix_aliases``). Emitting them to the dataset
    lets the picker canonicalize a typed/selected target to the ONE name gear,
    augments, and crafting all carry — so a single target matches every source.
    Deterministic (sorted list from a checked-in file; dict order from the file)."""
    registry = vocabulary_mod._load(VOCAB_REGISTRIES_PATH).get("affix_names", [])
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


def assert_affix_synonyms() -> int:
    """Referential-integrity gate for upstream's affix-synonym table (U6), against
    the FROZEN checked-in registry. Upstream folds distinct game mechanics under one
    affix name — `Speed` <- `Striding` is the fold that produced #154 — so a changed
    fold is a data-semantics event that must not land silently. Any added, removed,
    or re-pointed mapping fails the build. Non-mutating; returns the count validated."""
    return vocabulary_mod.check_affix_synonyms(
        vocabulary_mod.load_live_affix_synonyms(),
        vocabulary_mod._load(vocabulary_mod.AFFIX_SYNONYMS_REGISTRY_PATH))


GAP_CORRECTIONS_PATH = os.path.join(HERE, "data", "seed", "gap_corrections.json")
VALUE_CORRECTIONS_PATH = os.path.join(
    HERE, "data", "seed", "compendium", "item_value_corrections.json")
NAME_CORRECTIONS_PATH = os.path.join(
    HERE, "data", "seed", "compendium", "affix_name_corrections.json")
TYPE_CORRECTIONS_PATH = os.path.join(
    HERE, "data", "seed", "compendium", "affix_type_corrections.json")
UNTYPED_RANKABLE_PATH = os.path.join(
    HERE, "data", "seed", "compendium", "untyped_rankable.json")
SPEED_SHARD_PATH = os.path.join(HERE, "data", "seed", "compendium", "speed_enchantment.json")
PARRYING_SHARD_PATH = os.path.join(HERE, "data", "seed", "compendium", "parrying_version.json")
HEIGHTENED_AWARENESS_SHARD_PATH = os.path.join(
    HERE, "data", "seed", "compendium", "heightened_awareness.json")
SPEED_AUGMENT_SHARD_PATH = os.path.join(HERE, "data", "seed", "compendium", "speed_augment.json")
# #249 — per-item Sonic flag for `Elemental Absorption`, which names four elements
# on some carriers and five on others behind an identical visible cell.
ABSORPTION_SHARD_PATH = os.path.join(
    HERE, "data", "seed", "compendium", "elemental_absorption.json")
MATERIAL_SHARD_PATH = os.path.join(HERE, "data", "seed", "compendium", "item_material.json")
MATERIAL_CLASS_PATH = os.path.join(HERE, "data", "seed", "compendium", "material_classification.json")
# The slots the material gate covers (#162). Docents are the Forged body slot and
# the oath is moot for Forged, so they stay out.
SHIELD_TYPES = {"Bucklers", "Small shields", "Large shields", "Tower shields"}
BODY_ARMOR_TYPES = {"Cloth armor", "Light armor", "Medium armor", "Heavy armor"}


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


def rankable_affixes(planner_records, untyped_allow=frozenset()) -> list:
    """Rankable-affix vocabulary: the affix names a user meaningfully ranks as a
    priority, read from the NATIVE gear-planner affix block. Filters: a magnitude
    bonus type (not Bool/boolean presence, not a non-rankable weapon/penalty
    descriptor), a numeric value, a well-formed name, and presence on at least two
    distinct items (a real stat is shared across gear; a one-off named proc is not).
    CORE_STATS are always included regardless of item count.

    `untyped_allow` (#227) is the adjudicated exception to the untyped skip below —
    names verified against the wiki as real worn-gear magnitudes. They still have to
    clear every other filter; the allow-list only buys them past the type check."""
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
            untyped = bt in (None, "")
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
    # name no item carries is a priority that scores zero.
    _name_corrections = name_corrections_mod.load(NAME_CORRECTIONS_PATH)
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
    # #227 — adjudicate the untyped affixes that look like real worn-gear magnitude
    # stats. Runs AFTER the rename so the adjudication is keyed on the canonical
    # name, and before rankable_affixes so the allow-list is available to it. A
    # candidate on neither list fails the build: an untyped worn stat no player can
    # rank is exactly the defect #227 reported, and it should surface here rather
    # than in a bug report.
    _untyped_allow, _untyped_quarantined = untyped_rankable_mod.load(UNTYPED_RANKABLE_PATH)
    _untyped_checked = untyped_rankable_mod.assert_adjudicated(
        planner_records, _untyped_allow, _untyped_quarantined)

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
    # #259 — the augment channel of the type corrections loaded above. The two
    # shipping entries live here (the Moment to Moment pair); the item apply was
    # their silent no-op. Runs before the speed classifier and expand_dataset so
    # the corrected type flows into variants, the solver, and browse from one
    # place.
    _type_coverage_augments = type_corrections_mod.apply(aug_pool, _type_corrections)
    type_corrections_mod.assert_all_reached(
        _type_corrections, _type_coverage_items, _type_coverage_augments)
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
    _set_orphans = enchantment_split_mod.set_bonus_orphans(
        variants,
        {**umbrella_mod.umbrella_expansion(),
         **spell_focus_mod.expanded_away(),
         **speed_split_mod.EXPANDED_AWAY,
         **parrying_split_mod.EXPANDED_AWAY,
         **heightened_awareness_mod.EXPANDED_AWAY,
         # #249 — no set-bonus tier names a compound absorption stat today, so
         # this registration is a standing gate rather than a live expansion: a
         # set bonus carries no per-item shard key to read a Sonic flag from, so
         # a future one must fail the build loudly rather than be guessed.
         **absorption_split_mod.EXPANDED_AWAY},
        allow=_KNOWN_SET_BONUS_ORPHANS)
    if _set_orphans:
        raise SystemExit(
            "set-bonus affixes name an expanded-away stat no player can rank:\n  " +
            "\n  ".join(f"{s} — {stat} {val}" for s, stat, val in _set_orphans))
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
    tf = tf_mod.build_thunder_forged()
    gs = gs_mod.build_green_steel()

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
            "material_coverage": {**_material_stamp, **_material_coverage},
            # The curated metal/non-metal map the druidic-oath gate reads. A
            # material absent from this map is UNKNOWN, and the gate fails open.
            "material_classification": material_mod.classification(_material_class),
            # U7.5 — wiki-validated gap-corrections overlay coverage (sanctioned
            # minimal exception to gear-planner sole-authority).
            "gap_corrections_coverage": _gap_coverage,
            "value_corrections_coverage": _value_coverage,
            "name_corrections_coverage": _name_coverage,
            # #259 — bonus-type corrections, disclosed per channel: the same
            # entry set is offered to items and augments, and an entry is only
            # an error when NO channel carries it.
            "type_corrections_coverage": {
                "items": _type_coverage_items,
                "augments": _type_coverage_augments,
            },
            "untyped_rankable_coverage": {
                "candidates": _untyped_checked,
                "allowed": len(_untyped_allow),
                "quarantined": len(_untyped_quarantined),
            },
            # #223 — DR qualifier split. `kept_numeric` counts magnitudes now
            # sharing the single unconditional bucket (max, never sum);
            # `demoted_names` lists the conditional enchantments now tracked as
            # presence, disclosed because a player who ranked DR for one of them
            # should be able to see where the number went.
            "dr_qualifier_coverage": _dr_coverage,
            "rankable_affixes": rankable_affixes(planner_records, _untyped_allow),
            # U1 (#136) — names this build EXPANDS AWAY, mapped to what they become.
            # The picker drops them from suggestions and redirects the player to the
            # replacements, instead of offering a priority no item can satisfy.
            "expanded_away_names": {**umbrella_mod.umbrella_expansion(),
                                    **spell_focus_mod.expanded_away(),
                                    **speed_split_mod.EXPANDED_AWAY,
                                    **parrying_split_mod.EXPANDED_AWAY,
                                    **heightened_awareness_mod.EXPANDED_AWAY,
                                    **absorption_split_mod.EXPANDED_AWAY},
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

    # U3 (#205) — the fan-out gate, run over the ASSEMBLED dataset so it discovers
    # its own containers. Every top-level key must be either a declared single-pick
    # container or a declared non-container carrying the reason it is not one, so a
    # pool added without an audit fails rather than shipping unjudged. Runs after
    # every expansion pass, so a record-level provenance key is direct evidence an
    # expander crossed an option boundary, and a container declaring a pass that
    # left no stamp at all is evidence the pass was reverted to a no-op.
    out["metadata"]["container_registry_coverage"] = container_registry_mod.check(
        out, _container_source_options)

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
