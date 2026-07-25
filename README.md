# DDO Loadout Optimizer

**Category:** Personal

**Live:** https://eddiefiggie.github.io/ddo-loadout-optimizer/ · **Repo:** https://github.com/eddiefiggie/ddo-loadout-optimizer

A public DDO gear optimizer: given a build's minimum-level cap, class/race, armor type, weapon setup, and a *ranked* list of target affixes, it returns the theoretically-optimal fully-upgraded gear set — items, tiers, and augments — computed against DDO's real bonus-type stacking rules, with every value traceable to the DDO Wiki. Built data-first (a verified, searchable item database ships first; the lexicographic solver layers on top), seeded from the existing `ddo-item-puller` dataset.

**Status:** Milestones 1 & 2 **live on GitHub Pages** (2026-07-25). Milestone 3 (augments + set bonuses in the objective) is **on PR [#1](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/1)** (branch `feat/all-verified-sources-in-objective`); auto-deploys on merge.

- **Milestone 1:** pipeline parses free-text `enhancements[]` → structured `parsed_affixes[]`, per-tier variants, per-affix verification gate; searchable browse view.
- **Milestone 2:** per-slot dominance pre-filter + exact worn-item MILP via HiGHS-WASM (bonus-type stacking, dodge-cap clamp, staged lexicographic, deterministic tie-break) + a query/results UI. ML-34 queries solve in <100ms. Correctness fixes from its code review: weapon-slot exclusivity and capped-target-with-no-source reporting 0.
- **Milestone 3 (on PR):** every verified source now enters the objective via a unified **gated-contribution primitive** — augments (colored + Lunar/Solar, per-color slot capacity) and named-item **set bonuses** (free-text `piece_bonuses` parsed to `(stat, bonus_type, value, pieces_required)`; `set_active` threshold in the MILP). Results are a full build sheet: augment-in-slot prescription, near-miss set hints, per-family coverage disclosure. **93 tests** (57 Python + 36 JS); browser pass clean; all two-model review findings fixed (incl. a P1 dominance-vs-set-threshold bug).
- **Deferred to follow-up:** expansion **crafting / gear upgrade paths** (U6/U7 in the M3 plan) — Sharn, Isle of Dread, Vecna, Myth Drannor, Ravenloft/Viktranium, etc. — need live wiki sourcing; the solver + UI already disclose them as pending. Plus broader compound stat-name canonicalization, and 4 lower-priority M2 findings (see `docs/plans/2026-07-25-001-fix-solver-correctness-plan.md`).

## Files
- `docs/plans/2026-07-24-001-feat-ddo-loadout-optimizer-plan.md` — the original M1/M2 unified plan (Product Contract + Implementation Units).
- `docs/plans/2026-07-25-002-feat-all-verified-sources-in-objective-plan.md` — the Milestone 3 plan (augments + sets + crafting). U6/U7 (crafting) are its Deferred-to-Follow-Up starting point.
- `docs/plans/2026-07-25-001-fix-solver-correctness-plan.md` — deferred M2 solver-review findings.
- `data/` — input/data files.

## Build & run
```
python3 build_dataset.py          # reads data/seed/ddo_items.json -> writes web/data/items.json
python3 -m http.server 8000       # then open http://localhost:8000/web/
python3 tests/run_tests.py        # Python suite (stdlib-only runner; pytest also works)
node tests/browse.test.js         # JS filter suite
```
`web/data/items.json` is a generated artifact (gitignored) — edit the pipeline (`build_dataset.py` + `src/`), not the JSON.

**Live site:** `web/` is a self-contained static site deployed to GitHub Pages by `.github/workflows/deploy.yml` (builds the dataset + runs tests, then deploys on every push to `main`).

## Architecture (from the plan)
- **Client-side static app on GitHub Pages** — zero server, matching the other DDO tools. Solver runs in-browser via **HiGHS-WebAssembly** (exact MILP, provably optimal); staged sequential lexicographic solve.
- **Static generated dataset** — Python generator (extends `ddo-item-puller`'s `build_json.py`) parses free-text `enhancements[]` into structured `parsed_affixes[]`, expands tiered items into per-tier variants, and gates records `verified` | `quarantined`.
- **Two milestones:** (1) data platform + searchable browse (shippable on its own), (2) the solver + query UI.

## Key decisions (from the brainstorm)
- **New standalone project seeded from `ddo-item-puller`** — reuse its schema, Claude-in-Chrome scraping method, taxonomy, and 169 verified entries; extend toward full coverage + a structured affix layer + the solver. The old project stays intact for its leveling-tool consumers.
- **Strict priority order (lexicographic)** tradeoff resolution — deterministic.
- **Pure theoretical best-in-slot** — assume everything obtainable and fully upgraded; no per-user inventory.
- **Comprehensive sources** — named items, augments, essence crafting (U81), filigrees, set bonuses, tiered items.
- **Query respects class/race, armor type, weapon setup** (armor type is needed to value capped stats like dodge).
- **Strict "exclude until verified" data trust** — ambiguous wiki data is quarantined; results disclose their own coverage completeness.
- **Manual, patch-triggered data refresh** — re-run ingestion when a DDO update ships; no schedule.

## Open blocker
- None. Milestones 1 & 2 live; Milestone 3 (augments + sets) on PR #1; crafting (U6/U7) is the next scoped work.

## Resume prompt
> Resuming the **ddo-loadout-optimizer** garage project (`~/ClaudeGarage/personal/ddo-loadout-optimizer/`). Public DDO gear optimizer: input = ML cap + class/race + armor type + weapon setup + a *ranked* affix list; output = the theoretically-optimal fully-upgraded gear set (item + tier + augment-in-slot + chosen set bonuses) under DDO's bonus-type stacking rules, every value wiki-sourced (Claude-in-Chrome scrape; plain fetch returns empty for ddowiki.com). **Client-side static app on GitHub Pages**; exact MILP in-browser via **HiGHS-WASM**, staged lexicographic solve, deterministic tie-break; Python generator builds `web/data/items.json` from the seed. Core decisions: strict lexicographic priority; pure theoretical BiS (no inventory); strict exclude-until-verified data with per-result coverage disclosure; **never infer a value** (ambiguous → quarantined). **State:** Milestones 1 (data + browse) and 2 (worn-item solver) are **live**. **Milestone 3** folds every verified source into the objective via a unified **gated-contribution primitive** (`web/solver.js`): worn affixes + **augments** (per-color slot capacity) + **set bonuses** (`set_active` piece-count threshold) all feed the same `(stat,bonus_type)` max-buckets; results are a full build sheet (augment-in-slot, near-miss set hints, coverage disclosure). M3 is **on PR #1** (branch `feat/all-verified-sources-in-objective`, 93 tests, review-clean). **Next work — the deferred U6/U7:** source + optimize **expansion crafting / gear upgrade paths** (Sharn, Isle of Dread, Vecna, Myth Drannor, Ravenloft/Viktranium, Slave Lords, Thunder-Forged, Green Steel — authoritative list from the wiki) as gated add-on-affix contributions (KTD4: optional add-on vars, not enumerated variants). Read `docs/plans/2026-07-25-002-feat-all-verified-sources-in-objective-plan.md` (esp. U6/U7 + Deferred-to-Follow-Up) to continue.
