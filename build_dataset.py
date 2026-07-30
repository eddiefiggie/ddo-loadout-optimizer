#!/usr/bin/env python3
"""Dataset build pipeline for ddo-loadout-optimizer.

Reads the immutable seed (imported from ddo-item-puller) and produces
`data/items.json`, the static dataset the web app fetches.

Pipeline stages (filled in across implementation units):
  U1  load seed + write passthrough dataset      (this unit)
  U2  parse enhancements[] -> parsed_affixes[]    (src.affix_parser)
  U3  expand tier variants + normalize vocab      (src.variants, src.vocab)
  U4  per-affix verification gate + coverage       (src.verify)

Run:  python3 build_dataset.py
Output path is __file__-relative, so it works from any directory.
"""
from __future__ import annotations

import json
import os

from src.variants import expand_dataset
from src import affix_parser as affix_parser_mod
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
from src import compendium as compendium_mod
from src import band_frontier as band_mod
from src import set_catalog as set_catalog_mod
from src import umbrella as umbrella_mod
import re as _re

import glob

HERE = os.path.dirname(os.path.abspath(__file__))
SEED_PATH = os.path.join(HERE, "data", "seed", "ddo_items.json")
DINO_SEED_PATH = os.path.join(HERE, "data", "seed", "dino_crafting.json")
NC_SEED_PATH = os.path.join(HERE, "data", "seed", "nearly_complete.json")
VIK_SEED_PATH = os.path.join(HERE, "data", "seed", "viktranium.json")
SEAL_SEED_PATH = os.path.join(HERE, "data", "seed", "seal.json")
TF_SEED_PATH = os.path.join(HERE, "data", "seed", "thunder_forged.json")
GS_SEED_PATH = os.path.join(HERE, "data", "seed", "green_steel.json")
AUG_SEED_PATH = os.path.join(HERE, "data", "seed", "augments.json")
ALIGN_SEED_PATH = os.path.join(HERE, "data", "seed", "alignment_restrictions.json")
ARTIFACT_SEED_PATH = os.path.join(HERE, "data", "seed", "artifacts.json")
BOOLEAN_SEED_PATH = os.path.join(HERE, "data", "seed", "boolean_features.json")
JOKER_SEED_PATH = os.path.join(HERE, "data", "seed", "joker_sets.json")
COMPENDIUM_DIR = os.path.join(HERE, "data", "seed", "compendium")
# Output lands inside web/ so that directory is a self-contained, deployable
# site root (GitHub Pages serves web/ as the root; the app fetches data/ relatively).
OUT_PATH = os.path.join(HERE, "web", "data", "items.json")


def load_seed(path: str = SEED_PATH) -> dict:
    """Load the immutable seed dataset."""
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def load_dino_seed(path: str = DINO_SEED_PATH) -> dict:
    """Load the Dino-crafting seed (freshly sourced; separate from the base seed)."""
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def load_nc_seed(path: str = NC_SEED_PATH) -> dict:
    """Load the U81 Nearly-Complete seed (freshly sourced; separate from the base seed)."""
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def load_vik_seed(path: str = VIK_SEED_PATH) -> dict:
    """Load the U75 (Chill of Ravenloft) Viktranium ("Lamordia") seed (freshly sourced; separate from base)."""
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def load_augment_seed(path: str = AUG_SEED_PATH) -> dict:
    """Load the sourced legendary augment pool (gear-planner import; separate from base)."""
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def load_joker_seed(path: str = JOKER_SEED_PATH) -> dict:
    """Load the wildcard-set-piece pools (Gem of Many Facets family); {item_name: spec}."""
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh).get("items", {})


def load_seal_seed(path: str = SEAL_SEED_PATH) -> dict:
    """Load the seal-slot ("Sealed in X") pool seed (wiki-sourced; separate from base)."""
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def load_tf_seed(path: str = TF_SEED_PATH) -> dict:
    """Load the Legendary Thunder-Forged tier-pool seed (wiki-sourced)."""
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def load_gs_seed(path: str = GS_SEED_PATH) -> dict:
    """Load the Legendary Green Steel endgame-effect pool seed (wiki-sourced)."""
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def load_alignment_restrictions(path: str = ALIGN_SEED_PATH) -> dict:
    """Curated alignment equip-gates: base-item name -> allowed alignments.
    Keys beginning with '_' (README/example) are ignored. Missing file -> {}."""
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)
    return {k: v for k, v in raw.items()
            if not k.startswith("_") and isinstance(v, list) and v}


def stamp_alignment_req(variants: list, restrictions: dict) -> int:
    """Stamp `alignment_req` onto each variant whose base item (source_item) has a
    curated alignment equip-gate. Additive + exclude-until-verified: an item not
    in the seed carries no field, so eligible() (JS) fails open for it. Returns
    the count of variants stamped."""
    n = 0
    for v in variants:
        req = restrictions.get(v.get("source_item"))
        if req:
            v["alignment_req"] = list(req)
            n += 1
    return n


def load_artifacts(path: str = ARTIFACT_SEED_PATH) -> set:
    """Curated Artifact-quality base-item names (source_item), as a flat JSON
    array. Membership only — no per-item value and (unlike the object-shaped
    alignment seed) no `_README` key, since a top-level array cannot carry one.
    Non-string or underscore-prefixed entries are ignored; a missing file yields
    an empty set. Exclude-until-verified: the shipping seed is empty until a wiki
    harvest populates it, so the JS solver treats every variant as non-Artifact."""
    if not os.path.exists(path):
        return set()
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)
    if not isinstance(raw, list):
        return set()
    return {s for s in raw if isinstance(s, str) and s and not s.startswith("_")}


def load_boolean_features(path: str = BOOLEAN_SEED_PATH) -> list:
    """Curated boolean-feature names (value-less presence toggles like Salt), as a
    flat JSON array. Non-string or underscore-prefixed entries are ignored; a
    missing file yields an empty list. Exclude-until-verified: the shipping seed
    carries no real entries until a wiki harvest populates it, so no value-less
    line becomes a boolean affix and parsing behavior is unchanged."""
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)
    if not isinstance(raw, list):
        return []
    return [s for s in raw if isinstance(s, str) and s and not s.startswith("_")]


def stamp_artifact(variants: list, names: set) -> int:
    """Stamp `artifact: True` onto each variant whose base item (source_item) is a
    curated Artifact. Additive + exclude-until-verified: a variant not in the seed
    carries no `artifact` field, so eligible()/the solver (JS) treat it as a
    non-Artifact. Returns the count of variants stamped."""
    n = 0
    for v in variants:
        if v.get("source_item") in names:
            v["artifact"] = True
            n += 1
    return n


def load_enriched_items(dirpath: str = COMPENDIUM_DIR) -> list:
    """Load stat-enriched compendium items (data/seed/compendium/enriched_*.json).

    These are base-seed-shape records produced by src.enrich from item wikitext;
    they merge into the item pipeline so their parsed affixes become solver-active.
    """
    items = []
    for path in sorted(glob.glob(os.path.join(dirpath, "enriched_*.json"))):
        with open(path, "r", encoding="utf-8") as fh:
            items.extend(json.load(fh).get("items", []))
    return items


def build(seed: dict) -> dict:
    """Transform the seed into the optimizer dataset.

    Pipeline: parse enhancements[] (U2) -> expand tier variants + normalize
    vocab (U3) -> per-affix verification gate + coverage (U4). The output
    `items` are variant records; each carries `affixes`, `verification`, and
    flags. `metadata.coverage` records per-slot verified/quarantined counts.
    """
    # Merge stat-enriched compendium items into the base seed before expansion so
    # they flow through the identical parse (affix_parser) + verify pipeline and
    # become solver-active. Enriched records are strict (src.enrich); unmapped
    # effects are recorded, never fabricated.
    # Dedupe: skip enriched records whose name already exists (base seed wins — it
    # is the hand-verified source; a same-name enriched copy would double-list in
    # browse and put two identities of one item into the solver). Also drops any
    # cross-batch name collision.
    all_enriched = load_enriched_items()
    base_by_name = {it.get("name"): it for it in seed["items"]}
    # Pass 1 — pick the winning record per name (base seed, else first enriched shard
    # to claim it). `_seal_carrier` records are seal-only stubs (an already-active
    # item's gear-planner seal slot); they never win a body and are excluded here.
    kept_by_name = dict(base_by_name)
    seen_names = set(base_by_name)
    deduped = []
    for it in all_enriched:
        if it.get("_seal_carrier") or it.get("_lost_purpose_carrier"):
            continue  # marker-only stubs: they graft a slot/marker in Pass 2, never claim a body
        name = it.get("name")
        if name in seen_names:
            continue
        seen_names.add(name)
        kept_by_name[name] = it
        deduped.append(it)
    # Pass 2 — graft any "Sealed in X" slot onto the winner that lacks it, from ANY
    # loaded record (real or seal-carrier), independent of shard order. The gear-planner
    # marks seals the hand-verified base seed and older wiki batches predate, so a sealed
    # item would otherwise be stranded whichever source won its body.
    for it in all_enriched:
        name = it.get("name")
        winner = kept_by_name.get(name)
        if winner is not None and it.get("seal_slots") and not winner.get("seal_slots"):
            winner["seal_slots"] = [dict(s) for s in it["seal_slots"]]  # copy: no shared ref across base + tier variants
        # Same graft for the Vecna "Lost Purpose" marker: many University items are
        # already solver-active via the gear-planner shard (which sorts before the
        # vecna shard and wins the body), so the lost_purpose marker must graft onto
        # the winner from ANY loaded record (KTD6), or the awaken slot would be lost.
        if winner is not None and it.get("lost_purpose") and not winner.get("lost_purpose"):
            winner["lost_purpose"] = it["lost_purpose"]
    enriched_items = deduped

    # Set bonuses for enriched members (U3). Only the 67 base-seed items carry a
    # set_bonus field, so the solver (which reads membership from set_bonus[].set)
    # ignores every enriched set member. Attach the authoritative definition — base
    # def wins, else the gear-planner catalog — to each enriched record carrying an
    # "X (set)" marker, matched on the canonical name so cross-source spelling drift
    # (the " Set" infix) resolves. Base-seed items are never touched (they already
    # have set_bonus and never enter enriched_items).
    _set_base_defs = set_catalog_mod.base_defs_from_seed(seed["items"])
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

    # Legendary augment pool (gear-planner import). Sourced augments SUPERSEDE a
    # same-name base-seed augment (richer source wins — opposite of the base-wins
    # rule for enriched gear), so the incidental base augments don't double-list.
    aug_pool = (load_augment_seed() or {}).get("items", [])
    aug_names = {a.get("name") for a in aug_pool}
    base_items = [it for it in seed["items"]
                  if not (it.get("category") == "augment" and it.get("name") in aug_names)]
    # Boolean-feature allowlist (U2): install before parsing so a value-less line on
    # the curated list becomes a presence affix instead of being dropped. Scoped to
    # this build — restored before returning so an in-process build() never leaks the
    # allowlist into the shared affix_parser module (contaminating later callers/tests).
    _prev_bool_features = affix_parser_mod.get_boolean_features()
    affix_parser_mod.set_boolean_features(load_boolean_features())
    variants = expand_dataset(base_items + enriched_items + aug_pool)  # parse enhancements + expand tiers

    # Wildcard set pieces (U1) — the Gem of Many Facets rolls one set from each of two
    # pools (rerollable; theoretical-BiS picks the best per group). Attach the pools to
    # the item's variants here, AFTER expand_dataset: src.variants._make_variant rebuilds
    # each variant from a fixed field list, so a joker_set_groups field on the base seed
    # item would be dropped. Clear the item's stale fixed set_bonus (the base seed
    # mis-modeled it as one fixed set) BEFORE set_mod.annotate_variant runs below, so no
    # lingering parsed_set_bonuses remains — the joker is the item's only set contribution.
    _joker = load_joker_seed()
    for v in variants:
        spec = _joker.get(v.get("source_item"))
        if spec is None:
            continue
        v["joker_set_groups"] = [[set_catalog_mod.canonical(s) for s in group]
                                 for group in spec.get("groups", [])]
        v["set_bonus"] = []

    # Alignment equip-gates (U3): stamp alignment_req from the curated seed so the
    # JS character gate (eligible) can exclude items the character's alignment
    # can't equip. Empty seed today -> no-op; fail-open until wiki-verified.
    stamp_alignment_req(variants, load_alignment_restrictions())

    # Artifact item-quality flag (U1): stamp `artifact` from the curated seed so
    # the JS opt-in (eligible/solver) can exclude Artifacts or require exactly one.
    # Empty seed today -> no-op; exclude-until-verified until a wiki harvest lands.
    stamp_artifact(variants, load_artifacts())

    for v in variants:                                  # U2 augment-color normalization
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
    # Vecna "Lost Purpose": the awaken defs come from the SAME set catalog that feeds
    # intrinsic set members (single source of truth), so an awakened set gives the
    # identical bonus + stat vocabulary as an intrinsically-completed one. Attach the
    # chosen-set-membership slot (pool = same-tier Vecna sets that resolve to a def)
    # to every item carrying a `lost_purpose` tier marker.
    membership_defs = membership_mod.build_membership_set_defs(_set_catalog)  # reuse the catalog loaded above
    membership_mod.attach_lost_purpose_slots(variants, membership_defs)
    variants, cov = verify_mod.apply(variants)          # per-affix verification gate

    # U3 — Isle of Dread Dino crafting: append pre-verified blank host variants
    # (they carry typed Dino slots, no base affixes) and expose the insert pool
    # the solver places into those slots. Blanks are added AFTER verify so their
    # empty affix list does not quarantine them.
    dino_seed = load_dino_seed()
    dino_blanks, dino_inserts, dino_sets, dino_cov = dino_mod.build_dino(dino_seed)
    variants = variants + dino_blanks
    # U4 — Dino Set-Bonus: activate the chosen-set-membership slot on the Dinosaur
    # Bone Armor/Helmet/Cloak Set-Bonus hosts (added here, after verify, since the
    # blanks carry no base affixes). Same primitive as Vecna Lost Purpose; the 6 Dino
    # sets are self-seeded from the same catalog, crafted at the Dinosaur Bone station.
    membership_mod.attach_dino_set_bonus_slots(dino_blanks, membership_defs)

    # U81 Nearly Complete: expose the parametric choice-slot effect pool. Items
    # carrying a `nearly_complete: <category>` field draw one option from it (host
    # items pending wiki; the pool + machinery ship now).
    nc = nc_mod.parse_nearly_complete(load_nc_seed())

    # U75 (Chill of Ravenloft) Viktranium ("Lamordia") crafting: expose the typed choice-slot pool
    # keyed by (slot_type, item-category). Items carrying `lamordia_slots` draw
    # one option per slot from the matching pool (tier from host ML at solve time).
    vik = vik_mod.parse_viktranium(load_vik_seed())

    # Seal-slot crafting ("Sealed in X"): expose the single-pick choice-slot pool
    # keyed by seal_type. Items carrying `seal_slots` unseal one option from the
    # matching pool. Undeath sourced (Ritual Table); Fire/Gloom/Mist pending.
    sl = seal_mod.parse_seal(load_seal_seed())

    # Legendary Thunder-Forged (multi-tier choice-slot) + Green Steel (single-pick
    # choice-slot): expose the craftable option pools. Hosts carry the marker
    # (thunder_forged_tiers / green_steel_slot); the solver crafts the best option.
    # Pools pending wiki harvest — machinery complete, empty until sourced.
    tf = tf_mod.parse_thunder_forged(load_tf_seed())
    gs = gs_mod.parse_green_steel(load_gs_seed())

    # Compendium roster: the complete named-item INDEX (name + slot + wiki link
    # for every named item on the wiki, harvested by category). Roster entries
    # are browse-only ("indexed") until their stats are enriched into real item
    # records; those already solver-active are cross-referenced as "enriched" so
    # the two layers do not double-count. Does not feed the solver.
    enriched_names = {v.get("source_item") for v in variants if v.get("source_item")}
    comp_records, comp_cov = compendium_mod.build_compendium(enriched_names)
    comp_cov["enriched_items"] = len(enriched_items)
    # Surface the strict-provenance disclosure: how many wiki effects were recorded
    # as unmapped (never guessed) across the enriched batches.
    comp_cov["enriched_unmapped_effects"] = sum(
        len(it.get("_enrich_unmapped", [])) for it in enriched_items)
    # R4 ML30-36 endgame-band coverage (U4): per (expansion, slot) enriched /
    # quarantined / pending across U81, Isle of Dread, Myth Drannor — honest
    # disclosure driven by the solver-active names in this very build.
    band_active = {(v.get("source_item") or v.get("variant_id") or v.get("name")) for v in variants}
    band_active.discard(None)
    band_cov = band_mod.band_coverage(band_active)
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

    out = {
        "metadata": {
            "title": "DDO Loadout Optimizer — dataset",
            "source": seed["metadata"].get("source", ""),
            "seed_generated": seed["metadata"].get("generated", ""),
            "seed_count": len(seed["items"]),
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
            "augment_coverage": augment_coverage,
            "compendium_coverage": comp_cov,
            "band_coverage": band_cov,
            "pipeline_stage": "M4-compendium-roster",
        },
        "items": variants,
        "dino_inserts": dino_inserts,
        "dino_sets": dino_sets,
        "nearly_complete": nc["records"],
        "viktranium": vik["records"],
        "seal": sl["records"],
        "thunder_forged": tf["records"],
        "green_steel": gs["records"],
        "membership_set_defs": membership_defs,
        "compendium": comp_records,
    }
    affix_parser_mod.set_boolean_features(_prev_bool_features)   # restore; don't leak the scoped allowlist
    return out


def write(dataset: dict, path: str = OUT_PATH) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(dataset, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def main() -> None:
    seed = load_seed()
    dataset = build(seed)
    write(dataset)
    print(
        f"Wrote {OUT_PATH}: {dataset['metadata']['item_count']} items "
        f"(seed {dataset['metadata']['seed_count']})."
    )


if __name__ == "__main__":
    main()
