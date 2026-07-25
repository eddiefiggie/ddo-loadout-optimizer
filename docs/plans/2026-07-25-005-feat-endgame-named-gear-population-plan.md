---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
date: 2026-07-25
planned: 2026-07-25
title: Named-Item Compendium — Complete Roster + Progressive Stat Enrichment - Plan
---

# Named-Item Compendium — Complete Roster + Progressive Stat Enrichment - Plan

## Goal Capsule

**Objective.** Build a **complete compendium** — an inventory of every named item in DDO. Deliver it in two honest layers: a **complete roster** (name + slot + wiki link for every named item, achievable now) and **progressive stat enrichment** (parsing each item's affixes into solver-usable records, a large sustained effort prioritized endgame/BiS-first).

**Scope pivot (recorded).** This milestone began as "exhaustive endgame named gear, slot by slot." Mid-planning the user reset the goal via `/goal` to *"complete an inventory of all the items named in the game — a complete compendium."* The endgame slice is now the **first enrichment priority**, not the whole scope. The Product Contract below reflects the compendium goal.

**Product authority.** The Product Contract is the source of truth for WHAT; the Planning Contract adds HOW. Product Contract changed from the requirements-only version — scope broadened from endgame-band to full-catalog (session-directed) — see the KTDs.

**Why two layers.** The optimizer's promise is *provably optimal over the gear it can see*. A complete **roster** makes the full named-item universe visible and browsable (the "inventory"); **enrichment** is what the solver consumes, and it is gated by a narrow data pipe (below), so it must proceed in prioritized batches with coverage disclosed honestly rather than pretending completeness.

**Grounding — established this session (all via Claude-in-Chrome; server-side access is blocked).**
- **Access constraint (hard):** ddowiki.com returns empty to server-side `curl` and WebFetch. The **only working path is the browser** (Claude-in-Chrome). Within it, the **MediaWiki API works same-origin** (`/api.php?...list=categorymembers`), enumerating whole categories in one call.
- **Export constraint (hard):** browser tool-results truncate at ~4KB, and the privacy guard blocks base64/query/cookie-shaped payloads. Bulk export from browser → repo uses an approved **download bridge** (browser saves JSON to `~/Downloads`, the agent reads it from disk). ~2 calls per batch.
- **Scale (measured):** the named-item universe is **~8,000 items** — worn/accessory **4,350** (Ring 435, Helm 387, Trinket 373, Cloak 373, Neck 344, Bracers 263, Gloves 256, Belt 255, armor 855, Docents 211, Goggles 220, Boots 232, Quiver 16, Rune Arm 130) + weapons **~3,000** across 38 types + shields/orbs/wands beyond. Each item has its own stats page.
- **Rate limit (observed):** rapid API bursts trigger a persistent `202`-empty throttle (Cloudflare-style). Harvest must pace and retry with backoff across sessions.
- **Catalog structure:** named items are enumerated by `Category:<slot> items` (jewelry uses body-location names — Eye/Finger/Neck/Wrist; clothing uses Back/Feet/Hand/Head/Waist), plus master cross-cuts `Category:Named items by update` and "Named quest rewards".

**Status (shipped this session).** **Complete roster across all gear slots: 7,658 named items indexed** — worn (`roster_worn.json`, 4,341) + weapons & shields (`roster_weapons.json`, 3,631) — committed, wired through `build_dataset.py` → browse + coverage with a new `indexed` status, cross-referenced against enriched items. **Enrichment layer proven and scaled:** `src/enrich.py` (strict template→affix renderer) + **4 batches, 88 endgame items enriched across every gear-slot category** (worn accessories, armor by type, weapons) — solver-verified end-to-end. **113 Python + 66 node tests pass**, on branch `feat/named-item-compendium` (6 commits). Remaining: keep scaling enrichment batches (the sustained effort; ~88/7,658 so far), a few more `enrich.py` templates (HealingAmp, Incite), and minor un-indexed categories (wands, ammunition, cosmetics).

---

## Product Contract

### Primary actor & outcome
A DDO player theorycrafting a build can (a) **browse the complete named-item inventory** — every named item in the game, by slot, with a wiki link — and (b) get optimizer results that are optimal over the **enriched** subset, with coverage that honestly states how much of the catalog is stat-sourced and solver-active. Every enriched value is wiki-traceable.

### In scope (requirements)

- **R1 — Complete roster (the inventory).** Harvest, via the in-browser MediaWiki API, every named item's **name + slot (+ armor/weapon/offhand type) + wiki link**, across all worn/accessory slots, all weapon types, and shields/orbs. Store as in-repo roster shards. This layer is *completable* and is the literal "inventory of all named items." *(Worn slots shipped; weapons/shields pending API cooldown.)*
- **R2 — Roster is browse-only, never solver-fed.** Roster entries carry status **`indexed`** (name/slot/link, no parsed stats). They are browsable and counted but excluded from the solver until enriched. Enriched items are cross-referenced so the two layers never double-count.
- **R3 — Progressive stat enrichment.** Enrich rostered items into full solver-usable records (parsed affixes) in **prioritized batches** — endgame/BiS first — pulling item wikitext via the API and parsing through the **existing** `expand_dataset → affix_parser → verify` pipeline (no new parser). Strict provenance: explicit wiki-stated values with a `wiki_url` only; ambiguous → **quarantined**, never inferred.
- **R4 — Honest coverage disclosure.** The results coverage note reports the compendium honestly: *N named items indexed across the game; M enriched and solver-active*. Never imply completeness the enriched layer doesn't have.
- **R5 — Repeatable, paced batch process.** Both harvest and enrichment are repeatable batch units that accumulate monotonically across sessions, pacing against the API throttle (backoff + retry), using the approved download bridge for export. The compendium grows batch by batch; no silent truncation — dropped/blocked batches are logged.

### Out of scope (boundaries)

- **Not full stat enrichment of all ~8,000 items in one effort.** That is a long-horizon, multi-session undertaking through the narrow browser pipe; the plan structures it as prioritized batches, not a single deliverable.
- **U81 Nearly-Complete item hosts.** Still blocked (no wiki data, re-confirmed 2026-07-25); deferred with a revisit trigger.
- **Cosmetics / non-gear named items** (festival hats, glamers) — the 64-page `Category:Named items` cosmetic set — excluded from the solver-relevant compendium (may be indexed later, low priority).
- **No new solver/model mechanics.** Enriched gear are ordinary worn/weapon variants feeding the existing objective. No `dominates()` change — new worn/weapon variants carry no new value-carrying dimension (verified against `web/model.js`).
- **No server-side sourcing.** Ruled out — ddowiki blocks it. Browser-only.

### Success criteria

- A user can browse and filter the **complete named-item inventory** (every named item, by slot, with wiki links) — the roster is complete across all gear slots.
- Coverage honestly distinguishes indexed vs. enriched counts; no slot silently implies enrichment it lacks.
- Each enrichment batch lands solver-usable, strictly-sourced items (wiki-traceable; ambiguous quarantined), verified by an end-to-end build + a real solve.
- The process is repeatable and paced: a documented batch unit that accumulates without re-deciding structure, and survives the API throttle.

---

## Key Technical Decisions

- **KTD1 — Full catalog over endgame slice** *(session-settled: user-directed via `/goal` — chosen over the endgame-band scope: user reset the goal to "a complete compendium of all named items").* The endgame slice becomes R3's first enrichment priority.
- **KTD2 — Two layers: complete roster + progressive enrichment** *(session-settled: agent-designed under the access/scale reality, user-affirmed).* A literally-complete stat compendium is infeasible through the browser-only pipe near-term; splitting into a completable index + prioritized depth is the honest, deliverable shape.
- **KTD3 — In-repo compendium seed** *(session-settled: user-directed — chosen over extending upstream `ddo-item-puller`: keeps a tight self-contained loop; mirrors the dino/nc sibling-seed pattern).* Roster shards live in `data/seed/compendium/`.
- **KTD4 — Download bridge for export** *(session-settled: user-approved — chosen over ~25× slower plain-text chunking).* Browser saves JSON to `~/Downloads`; agent reads from disk. Approved for self-generated wiki data.
- **KTD5 — Reuse the existing item pipeline, no new parser** *(from the requirements Product Contract).* Enriched items enter as base-item-shape records through `expand_dataset → affix_parser → verify`.
- **KTD6 — `indexed` as a third status** alongside `verified`/`quarantined`: known-to-exist but stats-not-sourced; browse-only, solver-excluded.

---

## Implementation Units

### U1. Compendium roster module + pipeline wiring — SHIPPED

**Goal.** Load harvested roster shards, build the index records + coverage, cross-reference enriched items, expose through the dataset.
**Requirements.** R1, R2, R4, R6/KTD6.
**Files.** `src/compendium.py` (new), `build_dataset.py` (load + expose `compendium` + `compendium_coverage`), `tests/test_compendium.py` (new).
**Status.** Done. `build_compendium(enriched_names)` returns records + coverage; de-dupes `(name, slot)`; marks `enriched` vs `indexed`; derives `wiki_url`. Wired into `build_dataset.py` metadata + `compendium` block. 7 tests.

### U2. Browse + coverage surfacing of the index — SHIPPED

**Goal.** Make the roster browsable and the compendium honestly disclosed.
**Requirements.** R2, R4.
**Files.** `web/browse.js` (`compendiumRow`, indexed-only in `browsableItems`, filter option), `web/results.js` (`coverageNote` compendium line), `web/styles.css` (`.badge.indexed`), `tests/browse.test.js`.
**Status.** Done. Indexed-only entries render as browse rows (enriched not double-listed); status+slot filter works; coverage note reports indexed vs enriched. 3 browse tests added.

### U3. Worn-slot roster harvest — SHIPPED

**Goal.** Harvest the complete worn/accessory roster (17 categories) via the API; export via download bridge; commit.
**Requirements.** R1, R5.
**Files.** `data/seed/compendium/roster_worn.json` (4,350 items).
**Status.** Done. Mapping: Eye→Goggles, Finger→Ring, Neck→Necklace, Wrist→Bracers, Back→Cloak, Feet→Boots, Hand→Gloves, Head→Helmet, Waist→Belt, {Cloth,Light,Medium,Heavy} armor + Docents→Armor (with `armor_type`), Quiver, Rune Arm.

### U4. Weapon + shield roster harvest — SHIPPED

**Goal.** Harvest all weapon-type categories + shields/orbs/bucklers via the API; export; commit as `roster_weapons.json`. Completes the roster (R1).
**Requirements.** R1, R5.
**Files.** `data/seed/compendium/roster_weapons.json` (3,631 items). No code change — `src/compendium.py` globs `roster_*.json` and maps `slot: "Weapon"`/`"Off Hand"` already.
**Status.** Done. 45 categories (38 weapon types + Bucklers/Small/Large/Tower shields/Orbs), 3,631 items (2,898 Weapon + 733 Off Hand). Total compendium now **7,658 indexed** across 15 slots. Harvest paced with backoff/resume to survive the `202` throttle (a real page-nav refreshes Cloudflare clearance).
**Export bridge (key learning).** The `~/Downloads` download bridge is **one-shot per origin per session** — Chrome blocks repeat automatic (JS-initiated, no-gesture) downloads from a site, and a CDP-trusted click does not override the site's `Automatic downloads: block` permission. The reliable large-export path that worked: render the JSON into the page DOM in ≤49KB windows (marker-wrapped, padded past ~50KB), call `get_page_text` (which persists >50KB outputs to `tool-results/*.json`), then reassemble the windows server-side. `javascript_tool` results truncate at ~2KB, so that path can't carry bulk data.

### U5. Enrichment parser + first batch (endgame/BiS) — SHIPPED

**Goal.** Enrich a prioritized first batch (endgame Legendary items) into solver-usable records via item wikitext, strictly.
**Requirements.** R3, R4, R5, KTD5.
**Files.** `src/enrich.py` (new — strict template→affix renderer), `tests/test_enrich.py` (new, 13 tests), `data/seed/compendium/enriched_batch1.json` (16 items), `build_dataset.py` (`load_enriched_items` merged into `expand_dataset` input; `enriched_items` in coverage).
**Status.** Done. Surveyed the live template vocabulary (57 distinct across 45 items); `src/enrich.py` maps the unambiguous, magnitude-bearing templates (`Stat`, `Skills`, `SpellPower`, `Elemental Resistance`, `Absorption`, `Sheltering`→PRR/MRR, `Spell Focus`, `Fortification`, `Deadly`, `Accuracy`, `Dodge`, `Augment`, `Named item sets`, …) to the parser's value-last strings; **every other template is skipped and recorded in `_enrich_unmapped`, never guessed** (nested composites like `{{Nearly Finished|…}}`, clickies, guards, immunities, crafting slots). First batch: 16 endgame items across Ring/Necklace/Trinket/Cloak → 54 strict affixes; dataset 182→198 variants; roster enriched 93→109.
**Verified end-to-end.** Full suite green (110 Python + 65 node). A real HiGHS solve targeting Wizardry + Spell Penetration (stats only enriched items carry) selects `Legendary Adversion` + `Legendary Argonnessen Eye Band` — proving enriched items are solver-active and pass the dominance filter (the recurring lesson: cover with end-to-end solves, not just model tests). `tests/test_enrich.py` round-trips every rendered string through the real `affix_parser`, and a pipeline-integration test verifies the shipped batch parses→verifies.

### U6. Update plan + docs to compendium scope — SHIPPED (this document)

**Goal.** Reframe the plan from endgame-slice to compendium; record the access/scale/bridge constraints and the two-layer decision.
**Status.** Done (this file). `CONCEPTS.md` gap-fill for "Compendium roster / indexed status" is a follow-up.

---

## Deferred to Follow-Up Work

- Full enrichment of the remaining ~7,900 items (sustained, prioritized batches after U5 proves the unit).
- `Category:Named items by update` cross-cut to prioritize newest-content enrichment.
- Upstream reconciliation of the in-repo compendium into `ddo-item-puller` (single-source-of-truth), once the shape is proven.
- Cosmetic/non-gear named items indexing (low priority).
- `CONCEPTS.md` entry for "Compendium / roster / indexed".

---

## Verification Contract

- `python3 tests/run_tests.py` green (Python), all `tests/*.test.js` green (node).
- `python3 build_dataset.py` rebuilds `web/data/items.json` with `metadata.compendium_coverage` (indexed vs enriched) and a `compendium` block.
- Browse surfaces indexed items, filterable by the `indexed` status and by slot; enriched items are not double-listed.
- Results coverage note states indexed vs enriched counts.
- Each enrichment batch: hand-verify one item against its wiki page; confirm ambiguous lines quarantine.

## Definition of Done (this milestone)

Roster is **complete across all gear slots** (U3 + U4), browsable and honestly disclosed; U5 lands the first strictly-sourced enrichment batch and proves the repeatable enrichment unit. Full-catalog enrichment continues as deferred batch work.

---

## Provenance

- Source workflow: `ce-brainstorm` → `ce-plan` (this enrichment), scope reset mid-flight by user `/goal`.
- Predecessors: `2026-07-25-003` (Dino crafting), `2026-07-25-004` (U81 Nearly-Complete) — source-pool + coverage-disclosure patterns this extends.
- Access/scale/bridge facts: established this session via Claude-in-Chrome + measured API category counts.
