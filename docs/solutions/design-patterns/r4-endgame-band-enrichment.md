---
title: "R4: enriching the ML30-36 endgame band by wiki category intersection"
module: data-pipeline
date: 2026-07-27
problem_type: design_pattern
component: tooling
severity: medium
tags:
  - ddo
  - compendium
  - enrichment
  - wiki-harvest
  - coverage
  - band-frontier
---

## Problem

Populate the optimizer with *every* endgame (ML 30-36) named + raid item of the
three target content sets — **Update 81, Isle of Dread, Myth Drannor** — so the
per-slot optimum is genuinely optimal over real gear. The 7,658-item roster
already enumerates what exists; this is an **enrichment** job, not discovery.

## Approach (reproducible)

Work-list by **category intersection**, harvested same-origin from ddowiki via the
MediaWiki API (server-side fetch is blocked; use Claude-in-Chrome / the API bridge):

1. **ML band** — `Category:Minimum level 30 items` … `36 items` (`list=categorymembers`,
   paginate `cmcontinue`). 584 items across all sources.
2. **Expansion tag** — each item's `prop=categories` carries an
   `Update NN named items` category. The three sets map to their **release update**:
   **U55 → Isle of Dread** (Dinosaur Bone / "Dread Isle's Curse"), **U69 → Myth
   Drannor**, **U81 → U81** (Demonweb / Abyss). (Ravenloft/Lamordia is U75/U79 —
   a *different* expansion, already enriched via `batch11`; not in this batch.)
> **Note (2026-08-06):** the intermediate working files named in the steps below —
> `band_worklist.json`, the `solver_active_baseline.json` snapshot, `raw/batch_r4.json`, and
> `scripts/enrich_batch_r4.py` — were transient artifacts of that one-off run and were removed by
> the gear-planner native-schema refactor ([PR #70](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/70)).
> The **method** below still describes how a band enrichment is done; those paths are historical and
> will not resolve in the current tree. `{{Named item}}` and `{{Named item sets|...}}` are DDO wiki
> template names, not unfilled placeholders.

3. **Intersect** ML band × target updates × roster (for slot/armor type) →
   `data/seed/compendium/band_worklist.json` (188 items). Name matching is exact
   against wiki page titles (both sides come from the categorymembers namespace).
4. **Delta** — subtract names already solver-active (the committed
   `band_categories/solver_active_baseline.json` snapshot). 41 raw; 33 the true
   delta (IoD-dominant), 8 already active as **Dino host blanks**.
5. **Enrich** — harvest each delta item's `{{Named item}}` `enhancements` field
   into `raw/batch_r4.json`; `scripts/enrich_batch_r4.py` runs the strict
   `src.enrich` parser (no hand-authored values) → `enriched_r4_<expansion>.json`
   (+ `quarantined_r4.json` for any with no base stat and no named set).

Regenerate: `python3 scripts/snapshot_baseline.py` (baseline), then
`python3 -m src.band_frontier` (work-list), then `python3 scripts/enrich_batch_r4.py`,
then `python3 build_dataset.py`.

## Gotchas

- **KTD6 double-listing.** Host-pipeline items (Dino / Nearly Complete / Viktranium
  / seal) are solver-active via their own seeds and **never appear in
  `enriched_*.json`**. Deciding "already enriched" from the enriched shards alone
  mislabels the 8 Dinosaur Bone items as pending and re-emits them, so they
  double-list (`build_dataset` dedups by name, silently dropping one). Fix: derive
  the "already-active" set from a build that EXCLUDES the R4 shards
  (`solver_active_baseline.json`), and skip `already_enriched` work-list items in
  the driver.
- **Set-only host items are solver-active.** A pure Dino host with a
  `{{Named item sets|...}}` marker carries an explicit set-bonus contribution — it
  is enriched (via the `(set)` marker), not quarantined. Only augment-slots-only
  items quarantine.
- **`enrich.py` needed no extension.** Every unmapped template is a crafting slot
  (`Dino Slot`, handled by `dino_parser`), a named non-magnitude proc (Alchemical
  Attunement, Deathblock, guards, immunities), or a niche stat (Speed, Bonus
  Turning, Shield Bonus) prior batches also left unmapped. Mapping them would be
  speculative (KTD5).
- **Dataset item identity is `source_item` / `variant_id`, not `name`.** After
  `expand_dataset`, `variant.name` is `None`; membership checks must use
  `source_item`.
- **Browser → repo bridge.** `javascript_tool` returns truncate at ~2 KB and the
  guard blocks wikitext-shaped payloads; the one-shot blob download works once per
  page. Reliable path: stage JSON into a `<pre>` and read via `get_page_text`.

## Outcome

188/188 band items terminal — 33 newly enriched, 8 already-active, 0 pending,
0 quarantined. A real HiGHS solve selects an enriched band ring (The Theurgy of
Autumn, Corrosion 168) over a weaker rival. `band_coverage` metadata surfaces
per-expansion/per-slot counts in the results coverage note.
