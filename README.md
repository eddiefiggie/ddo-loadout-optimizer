# DDO Loadout Optimizer

**Category:** Personal

A public DDO gear optimizer: given a build's minimum-level cap, class/race, armor type, weapon setup, and a *ranked* list of target affixes, it returns the theoretically-optimal fully-upgraded gear set — items, tiers, and augments — computed against DDO's real bonus-type stacking rules, with every value traceable to the DDO Wiki. Built data-first (a verified, searchable item database ships first; the lexicographic solver layers on top), seeded from the existing `ddo-item-puller` dataset.

**Status:** Implementation-ready plan written (2026-07-24). Not yet built.

## Files
- `docs/plans/2026-07-24-001-feat-ddo-loadout-optimizer-plan.md` — the unified plan (Product Contract + Implementation Units U1–U8). Feed this to `/ce-work` to build.
- `data/` — input/data files (empty until the seed import + scrape begin).

## Build & run
```
python3 build_dataset.py          # reads data/seed/ddo_items.json -> writes data/items.json
python3 -m http.server 8000       # then open http://localhost:8000/web/
```
`data/items.json` is a generated artifact; edit the pipeline (`build_dataset.py` + `src/`), not the JSON. Run the Python tests with `pytest` (or `python3 -m pytest`).

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
- None. Scope settled; ready for `/ce-plan`.

## Resume prompt
> Resuming the **ddo-loadout-optimizer** garage project (`~/ClaudeGarage/personal/ddo-loadout-optimizer/`). It's a public DDO gear optimizer: input = ML cap + class/race + armor type + weapon setup + a *ranked* affix list; output = the theoretically-optimal fully-upgraded gear set (item + tier + augments per slot) under DDO's bonus-type stacking rules, every value wiki-sourced. Decisions: strict lexicographic priority; pure theoretical BiS (no inventory); comprehensive sources (named items, augments, essence crafting U81, filigrees, set bonuses, tiered items); query respects class/race + armor + weapon setup; strict exclude-until-verified data with per-result coverage disclosure; data-platform-first with an early searchable browse view. It's a NEW project **seeded from `../ddo-item-puller`** (schema + Claude-in-Chrome scraping method — plain fetch returns empty for ddowiki.com — + taxonomy + 169 entries); the new work is a structured `(effect, bonus-type, value, ML)` affix layer + the exact solver + a public web app. Architecture (planned): **client-side static app on GitHub Pages**, solver runs in-browser via **HiGHS-WebAssembly** (exact MILP, staged lexicographic solve — no server); a **Python generator** extends `../ddo-item-puller`'s `build_json.py` to parse free-text `enhancements[]` into structured `parsed_affixes[]`, expand tiered items into per-tier variants, and gate records `verified`|`quarantined`. Two milestones: (1) data platform + searchable browse, (2) solver + query UI (U1–U8). Read `docs/plans/2026-07-24-001-feat-ddo-loadout-optimizer-plan.md` for the full plan. Next step: `/ce-work` on that plan.
