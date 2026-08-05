---
title: Affix Vocabulary Hygiene - Plan
type: fix
date: 2026-08-05
topic: affix-vocabulary-hygiene
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Affix Vocabulary Hygiene - Plan

## Goal Capsule

- **Objective:** Make the priority picker offer names that can actually score, and offer the names players actually use. Close the gap between what the dataset stores and what a player types.
- **Product authority:** eddiefiggie (project owner).
- **Open blockers:** None.
- **Reports addressed:** 2026-08-05 batch reports 3 (Profane Well Rounded), 5 (solar spell crit naming), and the naming half of 7 (Parry/Riposte/Good Luck). Also the standing §3-C recommendation from `docs/reports/2026-08-01-bug-report-audit.md`.

---

## Product Contract

### Summary

Correct the picker vocabulary in three directions: stop offering names the pipeline expands away, start offering the build-around boolean effects players ask for, and write the magnitude the wiki states for boolean affixes that actually carry one. Alias work stays strictly limited to spelling and abbreviation variants, because the project has already ruled that merging distinct affixes is a bug.

### Problem Frame

Three of the 2026-08-05 reports are the same complaint from different angles: a player types the name of a real in-game effect and gets nothing.

The causes are not what they look like. `Well Rounded` is not missing — `src/umbrella.py` deliberately expands it into the six ability scores at build time, which is correct DDO behavior, and the 2026-08-01 audit already ruled it so. The defect is that the picker still offers the name, so the player ranks something the pipeline guarantees will never appear on an item. `Force Spell Crit Chance` matches nothing for the same class of reason: the effect exists under DDO's real names. The solar gems are not untyped either — `docs/wiki-evidence/spell-lore.md` documents `Solar Gem of Spell Critical Chance` as a legitimate Artifact lore channel.

Report 7 splits. `Crown of Summer` (×7) and `Greater Heroism` (×16) are stored as `Bool`, carrying presence but no magnitude, so the numeric effect the wiki states never scores — and the same is true of `Blurry` (×71) and `Lesser Displacement` (×69), which nobody reported. But `Parrying` (Insight, ×139), `Riposte` (Insight, ×35), and `Good Luck` (Luck, ×68) already score magnitude under their own names; the complaint there is only that the name a player types is not the stat the affix grants.

The standing audit calls the boolean-suggestion exclusion "the single most-repeated complaint" and recommends a curated build-around allowlist. That recommendation is unimplemented.

### Key Decisions

- **Aliases resolve spelling, never meaning.** An alias maps a variant spelling or abbreviation to a canonical name and nothing more. (user-approved — chosen over seeding aliases from reported player synonyms: the 2026-08-01 audit declined `Vitality → False Life` as a false merge citing the Blood Rage/Bloodrage lesson, and `affix_aliases.json` carries the rule that same-item co-occurrence implies distinct. A report-seeded alias table would re-introduce exactly the merge the project already rejected.)

- **A name the pipeline expands away is not offered.** Umbrella names are removed from suggestions rather than made scorable. (user-approved — chosen over parsing umbrella records back into the data: `umbrella.py` expanding them is correct DDO behavior, so the data is right and only the offer is wrong.)

- **Boolean decomposition is additive.** Writing a wiki-stated magnitude onto an item leaves the boolean affix in place. (user-approved — chosen over following the bare-`Sheltering` precedent, which replaces the affix and drops it from suggestions: a player who wants the effect merely present must keep being able to target it.)

### Requirements

**Offer only names that can score**

- R1. A name the build pipeline expands away — umbrella names such as `Well Rounded` and `All Ability Scores` — is not offered as a rankable priority, and the picker points the player at the concrete stats it expands into.
- R2. Strings that are not affixes are excluded from the generated affix registry at generation time, so they never reach the free-typed known set.
- R3. A priority the player ranks that no source in the active pool can contribute to is surfaced with a stated reason rather than scoring zero without explanation.

**Offer the effects players ask for**

- R4. A curated allowlist of build-around boolean affixes — those appearing on a small number of named items — is offered in picker suggestions, while one-off proc and flavor descriptions stay excluded.
- R5. The allowlist is curated and exclude-until-verified: entries are added deliberately, never by relaxing the presence filter wholesale.

**Score the magnitude a boolean hides**

- R6. A boolean-typed affix the wiki states grants a numeric effect has that effect written onto the carrying item's record as a typed affix, so it scores.
- R7. Each written component carries the bonus type the wiki states; a component whose bonus type the wiki does not state is excluded under the standing exclude-until-verified rule rather than written untyped.
- R8. Writing a component leaves the boolean affix on the item and in the presence set, so the effect remains targetable as presence.
- R9. A magnitude-carrying affix whose name differs from the stat it grants keeps its existing scorable bucket unchanged; only the vocabulary is corrected so players can find it.

**Alias discipline**

- R10. Alias entries resolve spelling and abbreviation variants only, and never merge two names.
- R11. A reported synonym is checked against the curated distinct records before any alias is added; the `Vitality`/`False Life` and `Spell Lore`/`Universal Spell Lore` rulings stand unless new wiki evidence overturns them.

### Acceptance Examples

- AE1. An expanded-away name stops being a dead end.
  - **Given:** `Well Rounded`, which the build pipeline expands into the six ability scores.
  - **When:** the player looks for it in the priority picker.
  - **Then:** it is not offered as a rankable priority, and the player is pointed at the ability scores it becomes.
  - **Covers R1.**

- AE2. A build-around boolean becomes reachable.
  - **Given:** a boolean effect carried by a small number of named items and present on the curated allowlist.
  - **When:** the player types its opening characters in the picker.
  - **Then:** it appears as a suggestion, while one-off proc descriptions do not.
  - **Covers R4, R5.**

- AE3. A hidden magnitude scores without losing presence.
  - **Given:** a boolean affix the wiki states grants a numeric effect.
  - **When:** the dataset is rebuilt and a player ranks that effect's stat.
  - **Then:** the carrying item contributes the wiki-stated value at its wiki-stated bonus type, and the affix is still targetable as presence.
  - **Covers R6, R7, R8.**

- AE4. A reported synonym is refused when the project has ruled it distinct.
  - **Given:** a player-reported synonym naming two affixes the curated records mark distinct.
  - **When:** the alias table is updated.
  - **Then:** no alias is added and the existing ruling stands.
  - **Covers R10, R11.**

### Scope Boundaries

- Reports 1, 2, 4, and 6 — covered by the sibling plans for data reconciliation and off-hand dual-wield.
- A general silent-zero audit across the whole vocabulary. R3 covers the player-facing case; a repeatable census is a later idea, not this batch.
- Changing how the solver buckets stats. R9 explicitly leaves working buckets alone.
- Relaxing the boolean suggestion filter wholesale, which is what R5's curation exists to prevent.

### Success Criteria

- A player who ranks `Well Rounded`, or types a build-around boolean the allowlist covers, gets either a usable priority or a stated reason — never an accepted priority that silently scores zero.
- No alias added by this batch merges two affixes the project has recorded as distinct.
- Every written magnitude traces to a wiki citation; none is inferred.

### Outstanding Questions

**Deferred to planning**

- Which surface carries R3's stated reason, given the existing coverage note is a dataset-level function with no render call site and the per-loadout notices take the query and result.
- Whether the allowlist lives beside the existing boolean-features seed or as its own curated file.
- How many boolean affixes the wiki confirms carry magnitude, which sets the real size of R6.

### Dependencies and Assumptions

- The DDO Wiki is the sole source of truth for every value, per the standing exclude-until-verified rule, and throttles after roughly eight rapid calls.
- `src/umbrella.py` expanding umbrella names is correct behavior and is not changed by this batch.
- The rulings in `docs/wiki-evidence/spell-lore.md` and §2 of the 2026-08-01 audit stand as recorded.

### Sources and Research

- `docs/reports/2026-08-01-bug-report-audit.md` — §2 rules `Well Rounded` and `False Life`/`Vitality` already-correct; §3-C recommends the build-around allowlist; §3-E records that the reported spell-crit terms match nothing.
- `docs/wiki-evidence/spell-lore.md` — the lore channel model, the Solar Gem as an Artifact lore channel, and the ruling that `Spell Lore` and `Universal Spell Lore` are correctly distinct.
- `src/umbrella.py` — the build-time umbrella expansion that is why no `Well Rounded` record exists.
- `web/dataset.js` — the picker vocabulary builder, its suggestion and known sets, the presence filter, and the noise-affix filter.
- `src/vocabulary.py` — affix registry generation and the curated alias/distinct records.
- `data/bug_reports.txt` — the verbatim 2026-08-05 reports.
