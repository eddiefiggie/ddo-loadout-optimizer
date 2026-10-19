---
title: Harvest our own items from the wiki — retire gear-planner as the item source, slice by slice
type: feat
date: 2026-10-18
execution: code
artifact_contract: ce-unified-plan/v1
artifact_readiness: approved
product_contract_source: owner-decision
---

# Harvest our own items from the wiki

**Roll-up:** #911.

**Decision (owner, 2026-10-18):** going forward, the item catalog is harvested by this project from ddowiki rather than vendored from illusionistpm/ddo-gear-planner. This reverses the standing rule "gear-planner is the single source of truth for item affixes". The rule changes in `AGENTS.md` at the moment the first slice switches, not before, so no reader sees a rule that the code does not yet follow.

**Why now:** upstream went stale twice in one week. On 2026-10-14..17 its updater crashed (#223/#224). Then its 2026-10-18 snapshot (b167d77) caught a wiki template migration halfway through and broke about 370 records. That re-vendor was held. Each time, a gap opened that we then had to patch from the wiki by hand. Those manual patches are the work this plan makes systematic.

Deliberately carries no build status. Progress lives in git and the issues.

---

## Constraints this plan is built around

1. **No code from upstream.** gear-planner carries no license file, so it is all rights reserved by default. Its data is facts and can be compared against. Its parser, about 120 KB of Python, cannot be ported or paraphrased. Ours is written from the wiki's templates directly.
2. **The wiki is reachable only from a browser tab.** Cloudflare blocks server-side access, so CI can never run a harvest. Every refresh is a session someone starts. The browser pane blocks requests to localhost (`ERR_BLOCKED_BY_CLIENT`, tested 2026-10-18). The working transport is a large tool result, which the harness saves to a file. That was tested at 562 KB and 4,000 rows, decoded intact. Throttling is real: bursts get empty responses for minutes, so harvests pace at about 1.5–1.8 s per request and resume from where they stopped.
3. **The wiki is mid-migration.** Since 2026-10-16 an editor has been moving item pages to new template parameters and a new categorization plan. Field names have changed (`armor class` became `shield bonus`, `quest` became a `turn in` recipe), pages have been renamed, and `Category:Named items` is down to 114 pages. Our parser must read the **new** parameters and tolerate the old ones while both exist.
4. **Never infer a value.** It applies to our parser exactly as it does to the corrections today. A template we do not understand is quarantined and disclosed, never guessed. A parse that yields a number the rendered tooltip contradicts is quarantined.

## Shape of the answer

**Our harvester emits records in gear-planner's own raw shape.** That shape is `{name, ml, slot, type, url, quests, pack, affixes: [{name, type, value}], sets, rare, artifact, crafting}`. So everything downstream of `src/planner_items.py` keeps working unchanged: the ~50 correction and evidence shards, every guard, the solver and the goldens. The switch is a change of input file, not a rewrite.

**Population comes from what we know, not from categories.** The seed list is every `url` in the pinned c36b45e raw items (8,222 records, about 8,200 pages). Pages new since then come from the #899 wiki-delta loop. Category membership is unusable while the migration runs (constraint 3).

**Acceptance is parity, measured per field.** For each slice, our records are diffed against the pinned gear-planner records. Every difference is classified:
- **ours-wrong:** fix the parser.
- **upstream-wrong:** a correction shard already says so, or the wiki says so. This is a win.
- **wiki-changed:** the page moved since c36b45e. Record it with the revision.

A slice switches only when "ours-wrong" is zero.

## Phases (each is an issue; each lands as its own PR)

**Phase 0 — Harvest tooling. (#905)**
- A resumable browser snippet in `scripts/browser/harvest_items.js`.
- Input: a title list. It reads wikitext and rendered tooltips per page, 20 titles per request, paced, and keeps progress in `window`.
- Output: the dump, returned in chunks of about 500 KB through the saved-tool-result channel.
- A loader script reassembles the chunks into `data/harvest/` (gitignored), checks completeness against the title list by digest, and stamps the harvest date and the revision id per page.
- Done when: a full harvest of the 8,200 seed pages completes, resumes after a forced interruption, and reports 0 missing.

**Phase 1 — Item metadata. (#906)**
- Parse the infobox fields: name, minimum level, slot, type, binding, quest / location / turn-in, pack, artifact, rare.
- Old and new parameter names are both read, which covers the migration.
- Diff against gear-planner.
- This phase alone fixes the class of defect that blocked b167d77 (levels reset to 1, lost quests, lost shield AC).
- Switch: metadata comes from our harvest; gear-planner's affixes are still used.

**Phase 2 — Enchantments, one item family at a time. (#907)**
1. Build the template inventory: every distinct enchantment template across the harvest, with counts. This sizes the real work.
2. Map each template to our existing affix vocabulary, `(name, bonus type, value)`, with the rendered tooltip as the value authority. That is the rule from `bundled-template-values-live-in-the-tooltip-not-the-cell.md`.
3. Quarantine unknown templates per affix, never per item.
- Order of families: weapons, then armor and shields, then jewelry and clothing.
- A family switches when its parity is "ours-wrong = 0".

**Phase 3 — Sets. (#908)** Set definitions from the wiki's set pages, parity against `gearplanner_sets.json`.

**Phase 4 — Crafting systems. (#909)** Each crafting system is its own issue and stays on gear-planner's crafting dump until its own parity passes:
- augment menus
- Green Steel / Legendary Green Steel
- Nearly Finished
- Viktranium
- Lamordia
- Slavers
- Dino
- Seals
- Lost Purpose

Some may stay on gear-planner indefinitely. That is acceptable, and each gets recorded as a deliberate choice.

**Phase 5 — Retire. (#910)**
- Remove `gearplanner_items.json` and `gearplanner_sets.json` from the build.
- Update `AGENTS.md`, `CONCEPTS.md`, `SOURCE.json` and the freshness alarm. The alarm's meaning changes from "upstream is stale" to "our harvest is older than N days".
- The correction shards that existed only to fix upstream parse errors are reviewed one by one. Most fold into the parser as rules. Each is deleted only once its guard proves the parser produces the corrected value.

## What does not change

- The correction shards and their guards remain, through to Phase 5. A correction keyed to an upstream mistake simply stops being needed when our parse is right. Its stale guard then fires, and it is deleted with evidence, exactly as the Spectral supplement retired.
- The solver, the UI and the exports do not change.
- `docs/wiki-evidence/` rulings still bind. The harvester has to reproduce every ruled value, and the parity diff checks it.

## Risks

- **Template breadth.** The enchantment template inventory is the unknown that sizes Phase 2, and it is measured first. If it runs to many hundreds of templates with free-text parameters, Phase 2 is many PRs long.
- **The migration keeps moving.** A parser written against this week's parameters may need updating. Parity diffs classify wiki changes separately, so churn is visible rather than silent.
- **Refresh is manual.** No daily automatic update, as gear-planner had. The delta loop plus an "our harvest is old" alarm replace it.
- **Throttling.** A full harvest is about 400+ paced requests (20 titles each), plus a rendered-tooltip pass. Expect a session of an hour or more, resumable.

## Outstanding questions

- (#912) Should rendered tooltips be harvested for every page (a heavier second pass), or only for pages whose templates are not already understood?
- (#913) Cadence: how often a full re-harvest runs versus delta-only refreshes.
