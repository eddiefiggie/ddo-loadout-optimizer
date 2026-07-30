---
title: Crafting Terminology Refactor - Plan
type: refactor
date: 2026-07-30
topic: crafting-terminology-refactor
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Crafting Terminology Refactor - Plan

## Goal Capsule

- **Objective:** Replace the inaccurate "awaken/awakened/awakening" umbrella language with each DDO crafting system's correct player-facing terminology, driven by a centralized crafting-system metadata registry — **without changing any solver behavior, constraint, or optimization result**.
- **Product authority:** User (single-owner personal project).
- **Open blockers:** None. Source of truth for the terminology is `data/crafting-terminology-refactor-prompt.md`.
- **Cross-plan note:** The Results-view UX plan (`2026-07-30-003-feat-results-view-refinements`) adds new per-item augment/craft display. Whichever plan ships second should route the other's crafting labels through this registry so player-facing language stays consistent.
- **Product Contract preservation:** Requirements R1–R12 unchanged in intent. Research (repo scan + institutional learnings) clarified the *mechanism*, captured as KTDs, not scope changes: the internal identifiers are already neutral so no data key is renamed (KTD3); the Vecna/Dino label fork lives in the renderer, not the solver (KTD2); R9 back-compat is forward-looking because no current data uses `awaken*` keys (KTD4); the only live "Nearly Complete → Nearly Completed" change is Demogorgon display, with Sharn/Sun-Moon/Catalyst registry-only (KTD7).

---

## Product Contract

### Summary

The app currently calls several unrelated DDO crafting systems "awaken" — Dinosaur Bone augments, Viktranium augments, Sun/Moon augments, Nearly Finished/Completed choices. That is wrong DDO terminology; "Awaken Set Bonus" is official language **only** for Vecna Unleashed Lost Purpose (Cannith Repurposing Station). This refactor introduces a centralized crafting-system metadata registry that supplies each system's correct player-facing labels, keeps the solver's internal primitive terminology-neutral, and preserves every mathematical result.

### Problem Frame

"Awaken" leaked from one real system (Vecna Lost Purpose) into a generic label for every selectable-affix / augment-assignment / set-bonus mechanism in the app. Players see incorrect instructions ("Awaken Dino set", "Awaken Viktranium effect") that don't match the game's stations and recipes. The underlying solver primitive (chosen-set-membership) is fine; only its name and the labels derived from it are wrong. The fix is to separate the mathematical mechanism from the player-facing crafting language.

### Key Decisions

- **KD1. Centralized crafting-system metadata registry** (session-settled: user-directed — chosen over hardcoding labels across `results.js`/`solver.js`/`browse.js`/UI: one source of truth, renderer derives instructions from metadata). Each customization source provides `{ system_id, system_name, expansion, mechanism_kind, action_label, result_label, slot_type, station_name }`; mechanism kinds include `selectable_affix`, `selectable_set_membership`, `augment_assignment`, `set_bonus_augment_assignment`, `item_transformation`, `set_bonus_unlock`.
- **KD2. "Awaken" survives only for Vecna Unleashed Lost Purpose.** Every other modern system uses its own terminology; no non-Vecna system displays "awaken/awakened/awakening."
- **KD3. Internal primitive stays terminology-neutral.** The chosen-set-membership mechanism remains conceptually intact but is not called "awakening"; prefer neutral names (`selectable_set_membership`, `chosen_set_membership`, `augment_assignment`, etc.).
- **KD4. Solver behavior is invariant.** All constraints, selectable-set-membership logic, datasets, and optimization results are identical before and after. This is a rename + display refactor, not a math change.
- **KD5. `web/data/items.json` is generated — never edit it directly.** All schema/terminology changes happen in the source pipeline (`build_dataset.py` + `src/` + `data/seed/`) and the artifact is regenerated.
- **KD6. Back-compat via migration or normalization.** Old source keys (`awakenable_sets`, `awakened_set`, `awaken_set`, `awakening_station`) are migrated to neutral names or supported through a normalization layer; old seed shards, tests, and imported gear-planner data must not silently break.

### Requirements

**Metadata registry**

- R1. A centralized crafting-system metadata registry provides, per customization source, the fields in KD1; the renderer derives all player-facing crafting instructions from this metadata rather than hardcoded strings.

**Player-facing terminology (per system)**

- R2. **Masterminds of Sharn / Nearly Finished (Cannith Reforging Station):** "Apply Nearly Finished option: {effect}", "Finish item with: {effect}", "Selected Nearly Finished option". Never "Awaken/Awakened affix/Awakened item". Use "Unlock Set Bonus" only for a recipe that explicitly unlocks a set bonus, not for ordinary selectable-stat upgrades.
- R3. **Vecna Unleashed / Lost Purpose (Cannith Repurposing Station):** "Awaken Set Bonus: {set_name}", "Awakened Set Bonus", "Change Awakened Set Bonus". This is the only system where "awaken" remains.
- R4. **Isle of Dread / Dinosaur Bone Crafting:** "Craft Dinosaur Bone augment", "Slot {slot_type} augment: {effect}", "Slot Set Bonus augment: {set_name}", "Dinosaur Bone Set Bonus augment" (slots: Scale, Fang, Claw, Horn, Set Bonus). Never "Awaken Dino set" / "Dino awakening" — a Dino host receives a crafted Set Bonus augment in its Set Bonus slot.
- R5. **Chill of Ravenloft / Lamordia / Viktranium Experiment Crafting:** "Craft Viktranium augment", "Slot {Melancholic|Dolorous|Miserable|Woeful} augment: {effect}", "Viktranium crafting option". Never "awaken".
- R6. **Magic of Myth Drannor / Sun and Moon Augments:** "Slot Sun Augment: {effect}", "Slot Moon Augment: {effect}", "Replace Sun/Moon augment". These are augments, not awakened sets, even when they grant Artifact/Profane bonuses.
- R7. **Terror of Demogorgon:** use "Nearly Completed" (not "Nearly Complete") — "Apply Nearly Completed option: {effect}", "Select fourth affix: {effect}", "Completed with: {effect}". Catalyst: "Catalyst Crafting", "Create Catalyst version: {result_item}", "Required Catalyst: {catalyst_name}". Never "awaken".

**Internal model**

- R8. The solver's internal primitive is renamed to a terminology-neutral name (KD3); Vecna and Isle-of-Dread set-bonus mechanisms may share solver constraints but render **different** display actions (Vecna: "Awaken Set Bonus: …"; Isle of Dread: "Slot Set Bonus augment: …").

**Backward compatibility**

- R9. Old source keys (`awakenable_sets`, `awakened_set`, `awaken_set`, `awakening_station`) are migrated to neutral names or normalized; no old seed shard, test, or imported gear-planner record breaks.

**Documentation / copy**

- R10. README and coverage-disclosure copy are updated: replace "Dino Set-Bonus: awaken 1 of 6 sets" with "Dino Set-Bonus: craft and slot 1 of 6 Set Bonus augments", and the awaken-on-Dino-host phrasing with "…or which Dinosaur Bone Set Bonus augment to craft and slot on an Isle of Dread host." Update Loadout Deep Dive instructions, paperdoll badges, Alternatives descriptions, and Item Browser filters/labels accordingly.

**Audit surface**

- R11. Audit the whole repo for `awaken`, `awakened`, `awakening`, `awakenable`, `chosen-set`, `set-crafting`, and `Nearly Complete` across `web/solver.js`, `web/model.js`, `web/results.js`, `web/alternatives.js`, `web/browse.js`, `src/`, `build_dataset.py`, `data/seed/`, tests, README/docs, coverage disclosures, Deep Dive instructions, paperdoll badges, Alternatives descriptions, and Item Browser labels.
- R12. Update `CONCEPTS.md` as part of this refactor: its **"Dino Set-Bonus"** entry currently defines the concept via the "awaken/awakened" umbrella (KD2 forbids for non-Vecna) — restate it as a crafted **Set Bonus augment** slotted on an Isle of Dread host, keeping the shared-solver-primitive note; and reconcile the **"Nearly Complete slot"** entry with the Sharn ("Nearly Finished") vs Demogorgon ("Nearly Completed") split (R2, R7). The glossary migrates with the code so the two never disagree.

### Acceptance Examples

- AE1. Vecna Lost Purpose results render "Awaken Set Bonus". (R3)
- AE2. Isle of Dread results render "Slot Set Bonus augment". (R4)
- AE3. Lamordia results render "Slot {…} Viktranium augment". (R5)
- AE4. Myth Drannor results render "Slot Sun Augment" or "Slot Moon Augment". (R6)
- AE5. Sharn results render "Apply Nearly Finished option". (R2)
- AE6. Terror of Demogorgon results use "Nearly Completed". (R7)
- AE7. Catalyst items render as Catalyst Crafting transformations. (R7)
- AE8. No non-Vecna modern system displays "awaken", "awakened", or "awakening". (R2, R4–R7)
- AE9. Solver selections and objective values are identical before and after the refactor. (KD4)
- AE10. The complete Python and JavaScript test suites pass. (all)

### Scope Boundaries

- No change to solver behavior, constraints, selectable-set-membership logic, datasets, or optimization results — display + internal-naming only.
- `web/data/items.json` is not hand-edited; changes go through the source pipeline and regeneration.
- Set-membership *mechanics* (which sets can be chosen, the math) are unchanged; only the mechanism's name and derived labels change.

### Definition of Done (from the prompt)

Deliver, after implementation: a list of renamed fields and compatibility aliases; a summary of every player-facing label changed; test results; and confirmation that optimization behavior did not change (AE9).

### Sources / Research

- `data/crafting-terminology-refactor-prompt.md` — the complete terminology spec this plan transcribes (canonical labels per expansion, internal-model guidance, audit list, back-compat, README changes, acceptance criteria).
- Audit targets: `web/solver.js`, `web/model.js`, `web/results.js`, `web/alternatives.js`, `web/browse.js`, `src/`, `build_dataset.py`, `data/seed/`.
- Repo research: each crafting system carried by a **distinct per-variant field** (`lost_purpose`, `dino_set_bonus_slot`, `lamordia_slots`, `nearly_complete`, `seal_slots`, `dino_slots_norm`) — only Vecna + Dino Set-Bonus use "awaken" prose; the shared solver primitive is `src/membership.py` `build_membership_set_defs` → `web/solver.js` (`memberVars`/`membershipPlaced`, constraint at solver.js `~542–616`); the single live "awaken" label is the craft chip in `web/results.js` `craftChips` (`~L284`), discriminated only by `m.station`.
- Institutional learnings: `docs/solutions/logic-errors/bonus-type-vocabulary-collides-with-bare-stat.md` (pin vocabulary with tests; a neutral name must not collide with an existing token); `src/vocab.py` `STAT_ALIASES`/`normalize_stat` (the back-compat alias pattern — one map, one funnel, at the data layer); `docs/solutions/design-patterns/single-source-of-truth-for-set-definitions.md` (membership set defs come only from the gear-planner catalog); the "generated `items.json` is never hand-edited — rebuild the pipeline" convention (also the AE9 proof surface).

---

## Planning Contract

### Key Technical Decisions

- KTD1. **A centralized crafting-system registry** (new `web/crafting-systems.js`, dual-exported, namespaced global) maps `system_id` → `{ system_id, system_name, expansion, mechanism_kind, action_label, result_label, slot_type, station_name }`, plus a `station → system_id` map for the render-time fork. The renderer derives player-facing crafting instructions from it (instantiates KD1, R1).
- KTD2. **The Vecna-vs-Dino label fork lives in the renderer, keyed on `m.station`** (`"Cannith Repurposing Station"` → Vecna "Awaken Set Bonus"; `"Dinosaur Bone crafting"` → Isle-of-Dread "Slot Set Bonus augment") — **not** by adding `system_id` to the solver's `memberMeta`. Adding a field to solver output would change `membershipPlaced` shape and break the invariance tests. (session-settled: user-directed — chosen over threading system_id through the solver: keeps solver output byte-identical, protecting AE9.)
- KTD3. **No data key or runtime identifier is renamed.** `set_membership_slot`, `lost_purpose`, `dino_set_bonus_slot`, `membershipPlaced`, `membershipSetDefs` are already terminology-neutral; the KD3 "primitive rename" is **comments/docstrings only**. (session-settled: user-directed — chosen over renaming keys + a full alias layer: zero data migration, `items.json` unchanged, AE9 trivial.)
- KTD4. **Back-compat (R9/KD6) is forward-looking.** No seed or code key uses `awaken*` today (only the Vecna seed's prose `note`). U5 verifies whether the gear-planner import path carries any `awaken*` field; if it does, add a normalization funnel modeled on `src/vocab.py` `STAT_ALIASES`; if not, R9 is satisfied trivially and a thin guard + fixture test documents it.
- KTD5. **Player-facing label edits live only in display-only functions** (`web/results.js` `craftChips`/coverage-note, `web/browse.js` row builders) — provably zero solver-math impact. `web/solver.js` / `web/model.js` / `src/membership.py` changes are comments/docstrings only.
- KTD6. **AE9 proof = rebuild-and-diff + solve snapshot.** Rebuild `web/data/items.json` and confirm it is unchanged (no data key moved); additionally snapshot a full solve's `{chosen, effective, membershipPlaced, setsActive}` before/after and `deepStrictEqual`. Keep every `m.station` string as-is (`tests/solver.test.js`, `tests/test_membership.py` assert them).
- KTD7. **"Nearly Completed" is the only live NC change** (Demogorgon display: `craftChips`/coverage "Nearly Complete" → "Nearly Completed"; the `nearly_complete` data key stays). Sharn "Nearly Finished" is a registry definition for currently-unmodeled gear (no solver-active data); Sun/Moon (Myth Drannor) and Catalyst are registry/copy-only (not modeled as choice-slots).
- KTD8. **A chosen neutral name must not collide** with any existing marker/`BONUS_TYPES` token (per the vocabulary-collision learning). Since KTD3 renames no identifiers, this applies only if U5 introduces a neutral alias key — grep the seed/effect strings for it first.

### Assumptions

- The gear-planner import JSON does not currently carry `awaken*` keys (U5 verifies; the alias funnel is insurance, not migration).
- Because no exported symbol is renamed (KTD3), `tests/*.test.js` `require(...)` destructures and Python re-exports need no churn.
- Tests are run as the project does: `python3 tests/run_tests.py` and the **full** JS loop `for t in tests/*.test.js; do node "$t"; done` (never `| tail`, per the JS-test learning).

### Sequencing

U1 → U2 → U3 (label surfaces depend on the registry). U4 (comment de-awaken) and U5 (back-compat verify) are independent of each other and can follow U1. U6 (docs/copy) follows U1–U3 so its copy matches the shipped labels. U7 (invariance proof) takes its baseline snapshot **before** any change and re-checks after all units land.

---

## Implementation Units

### U1. Crafting-system metadata registry

- **Goal:** A single source for each crafting system's player-facing labels, plus a station→system_id map for the render-time Vecna/Dino fork.
- **Requirements:** R1, R8; KTD1, KTD2.
- **Dependencies:** none.
- **Files:** `web/crafting-systems.js` (new, dual-exported, namespaced global e.g. `CraftingSystems`), `web/index.html` (add the script tag before `results.js`; **bump the shared `?v=30` cache-buster to `?v=31` across all script/link tags** so the browser-smoke gate and the shipped app load fresh JS — U2/U3 edits ride the same bump), `tests/crafting-systems.test.js` (new).
- **Approach:** Enumerate every system (Sharn/Nearly Finished, Vecna/Lost Purpose, Isle of Dread/Dino Set-Bonus + Dino inserts, Ravenloft/Viktranium, Myth Drannor/Sun & Moon, Demogorgon/Nearly Completed + Catalyst) with the KD1 metadata fields and canonical labels from R2–R7. Provide `systemForStation(station)` mapping the two membership stations to `vecna-lost-purpose` and `isle-of-dread-set-bonus`. Pure data + small accessors; no solver contact.
- **Patterns to follow:** dual-export shape of `web/persist.js`/`web/import.js`; single-source-of-truth discipline (`docs/solutions/design-patterns/single-source-of-truth-for-set-definitions.md`).
- **Test scenarios:** every `system_id` resolves the correct `action_label`/`result_label`/`station_name`; `systemForStation("Cannith Repurposing Station")` → Vecna, `systemForStation("Dinosaur Bone crafting")` → Isle of Dread; an unknown station returns a safe default; no label string contains "awaken" except the Vecna entry.
- **Verification:** `node tests/crafting-systems.test.js` passes; the module loads with no console error.

### U2. Wire the results craft chips to the registry (Vecna/Dino fork + per-system labels)

- **Goal:** Every crafting chip in the loadout/Deep Dive renders the correct player-facing label from the registry, with Vecna and Dino Set-Bonus forked by station.
- **Requirements:** R2–R8; AE1–AE8; KTD2, KTD5.
- **Dependencies:** U1.
- **Files:** `web/results.js` (`craftChips` ~L266–286, incl. the membership chip ~L284), `tests/results.test.js` (update the Vecna label assertion + add per-system assertions).
- **Approach:** Replace the hardcoded chip templates with registry-derived labels. The membership chip forks on `m.station` via `systemForStation`: Vecna → "Awaken Set Bonus: {set}", Isle of Dread → "Slot Set Bonus augment: {set}". Nearly-Complete chip → "Nearly Completed …" (KTD7). Lamordia chip → "Slot {Melancholic|Dolorous|Miserable|Woeful} Viktranium augment: {effect}". Do **not** touch `m.station` values or any solver field.
- **Execution note:** `tests/results.test.js:122–137` asserts the old `Awaken: …` label — update it to the new Vecna label; add a Dino "Slot Set Bonus augment" case. Every other "awaken" test assertion is a value/behavior check and must stay green (evidence the change is display-only).
- **Test scenarios:** Covers AE1 (Vecna → "Awaken Set Bonus"), AE2 (Dino → "Slot Set Bonus augment"), AE3 (Lamordia → "Slot … Viktranium augment"), AE6 (Demogorgon → "Nearly Completed"), AE8 (no non-Vecna chip contains "awaken"); a build with both a Vecna and a Dino Set-Bonus host renders both distinct labels.
- **Verification:** `node tests/results.test.js` passes with the updated + added assertions.

### U3. Coverage note, Deep Dive instructions, and Item Browser labels

- **Goal:** The remaining player-facing surfaces (coverage disclosure, Deep Dive text, Item Browser rows) use correct terminology.
- **Requirements:** R4–R7, R10; AE4, AE5, AE7.
- **Dependencies:** U1.
- **Files:** `web/results.js` (coverage-note builder ~L200–214; paperdoll/Deep-Dive set-glow surfaces), `web/browse.js` (row labels ~L86–88, ~L103–105), `web/alternatives.js` (audit-and-confirm — see Approach), `tests/results.test.js`, `tests/browse.test.js`.
- **Approach:** Registry-drive the coverage disclosure ("U81 Nearly Complete crafting" → "Nearly Completed", "Viktranium / Lamordia" → "Viktranium", "Dino Set-Bonus pool" → "craft and slot 1 of N Set Bonus augments" per R10). Item Browser row labels: "Nearly Complete" → "Nearly Completed", "Lamordia {type}" → "Viktranium {type}". Display-only (browse rows are view projections — never merge into the canonical pool, per `browse-visibility-for-separate-source-pools.md`). **Audit-and-confirm the remaining R10/R11 surfaces:** research found `web/alternatives.js` carries only aggregate "crafting" wording (no per-system awaken/Nearly-Complete labels) and paperdoll badges use set names, not "awaken" — confirm each is clean (the U7 grep gate is the backstop) so every named audit surface is traceable to an owning unit.
- **Test scenarios:** Covers AE4/AE5 where those systems surface in labels; coverage note renders the corrected copy; a browse row for a Viktranium/Nearly-Completed host shows the new label; no browse label contains "awaken".
- **Verification:** `node tests/results.test.js` and `node tests/browse.test.js` pass.

### U4. Remove the "awaken" umbrella from comments and docstrings

- **Goal:** Source comments/docstrings stop calling the generic primitive "awaken"; the word survives only where it means Vecna's Awaken Set Bonus.
- **Requirements:** R8, R11; KTD3, KTD4 (naming), KTD5.
- **Dependencies:** none (independent of U1).
- **Files:** `src/membership.py` (docstrings ~L11–110), `web/solver.js` (comments ~L544–851), `web/model.js` (comments ~L172–177), `build_dataset.py` (comments ~L258–368), `tests/solver.test.js` (Dino-context descriptions ~L1203–1222).
- **Approach:** Comment/docstring/test-description edits only — no identifier, data key, assertion value, or logic change. Use a neutral term (e.g. "chosen-set-membership") for the primitive; keep "Awaken Set Bonus" phrasing only for Vecna Lost Purpose. **Reword the non-Vecna "awaken" language in `tests/solver.test.js`** (e.g. "awakens a Dino set" / "Dino awakens reported" ~L1203–1222) into neutral set-membership vocabulary — these are test *descriptions/comments*, not assertion values, so behavior is unchanged and the U7 grep gate can pass deterministically.
- **Test scenarios:** `Test expectation: none — comments/docstrings/test-descriptions only, no behavioral change` (the U7 invariance proof + the full suite guard against accidental logic edits; the reworded solver tests must still assert identical `membershipPlaced`/station values).
- **Verification:** `git diff` shows only comment lines changed in these files; full suites still pass (U7).

### U5. Verify and guard gear-planner import back-compat

- **Goal:** Confirm no data source carries `awaken*` keys, and add a forward-looking normalization guard so a future import can't reintroduce the umbrella term as a live key.
- **Requirements:** R9; KTD4, KTD8.
- **Dependencies:** none.
- **Files:** the gear-planner import path (`scripts/enrich_from_planner.py` and/or the reader it feeds), a normalization funcion modeled on `src/vocab.py` `normalize_stat`, `tests/test_planner_import.py` (or a new `tests/test_crafting_aliases.py`).
- **Approach:** Grep the planner JSON + all seeds for `awaken*` / `awakenable_sets` / `awakened_set` / `awakening_station` keys. If present, funnel them to the neutral keys at the data layer (one alias map, one funnel — the `STAT_ALIASES` shape). If absent (expected), add a thin guard that maps those hypothetical keys if ever seen, and document R9 as satisfied. Grep for any chosen neutral alias token to avoid a vocabulary collision (KTD8).
- **Execution note:** Test the **old-key path against a fixture**, not the empty/default seed — an empty-seed test is a false green (`exclude-until-verified-empty-seed-masks-consuming-bugs.md`).
- **Test scenarios:** a fixture record carrying an old `awaken*` key normalizes to the neutral key and still resolves its set/membership; a record with no such key is unchanged; the chosen alias token does not collide with an existing marker/`BONUS_TYPES` value.
- **Verification:** `python3 tests/run_tests.py <new test>` passes; a repo grep confirms no live `awaken*` data key remains.

### U6. README and CONCEPTS.md copy

- **Goal:** Documentation uses correct DDO terminology.
- **Requirements:** R10, R12.
- **Dependencies:** U1–U3 (so doc copy matches the shipped labels).
- **Files:** `README.md` (~7 sites), `CONCEPTS.md` (the "Dino Set-Bonus" and "Nearly Complete slot" entries).
- **Approach:** Apply the R10 README replacements verbatim. In `CONCEPTS.md`, restate "Dino Set-Bonus" as a crafted **Set Bonus augment** slotted on an Isle of Dread host (drop the awaken-umbrella phrasing, keep the shared-primitive note and `[[wiki-links]]`), and reconcile "Nearly Complete slot" with the Sharn ("Nearly Finished") vs Demogorgon ("Nearly Completed") split. Preserve the `[[wiki-link]]` cross-reference syntax.
- **Test scenarios:** `Test expectation: none — documentation copy` (grep check in U7: no non-Vecna "awaken" remains in README/CONCEPTS).
- **Verification:** README/CONCEPTS read correctly; the U7 grep gate passes.

### U7. Solver-invariance proof and acceptance gate

- **Goal:** Prove optimization behavior is unchanged (AE9) and the suites pass (AE10).
- **Requirements:** AE9, AE10; KTD6.
- **Dependencies:** all other units (baseline taken first).
- **Files:** `tests/solver.test.js` (a before/after solve-snapshot `deepStrictEqual`), `scripts/snapshot_baseline.py` (existing baseline helper), the rebuilt `web/data/items.json` (generated — not committed/hand-edited).
- **Approach:** Before any change, capture a baseline: rebuild `items.json` and snapshot a representative solve's `{chosen, effective, membershipPlaced, setsActive}`. After all units, rebuild and diff `items.json` (expect no change — no data key moved) and re-run the solve snapshot with `deepStrictEqual`. Add a final grep gate over source + tests + docs: any remaining "awaken/awakened/awakening" must be on a Vecna / Lost Purpose line only (U4 having reworded the Dino-context test language), and no "Nearly Complete" (non-Completed) appears in a display string.
- **Test scenarios:** Covers AE9 (rebuilt `items.json` identical; solve snapshot `deepStrictEqual` before/after; `membershipPlaced` counts + station strings unchanged), AE10 (`python3 tests/run_tests.py` and the full `node tests/*.test.js` loop both green); grep gate finds no stray umbrella "awaken" or "Nearly Complete" display string.
- **Verification:** both suites green; `items.json` rebuild is byte-identical to baseline; grep gate clean.

---

## Verification Contract

| Gate | Command / action | Applies to |
|---|---|---|
| Python suite | `python3 tests/run_tests.py` | U5, U7 (and regression across the refactor) |
| JS suites (full loop, never `\| tail`) | `for t in tests/*.test.js; do node "$t"; done` | U1, U2, U3, U7 |
| Solver invariance | rebuild `web/data/items.json` + diff vs baseline; solve-snapshot `deepStrictEqual` before/after | U7 (AE9) |
| Terminology grep gate | repo grep: no non-Vecna `awaken*`; no `Nearly Complete` (non-Completed) display string | U7 |
| Browser smoke | `python3 -m http.server 8000` → `http://localhost:8000/web/`; solve a build with Vecna + Dino + Viktranium + Nearly-Completed hosts; confirm the chips/coverage read correctly and the console is clean | U2, U3 |

## Definition of Done

- Every player-facing crafting label is registry-driven and correct per R2–R7; Vecna renders "Awaken Set Bonus", Isle-of-Dread Set Bonus renders "Slot Set Bonus augment", and no non-Vecna system displays "awaken/awakened/awakening" (AE1–AE8).
- `web/data/items.json` rebuilds byte-identical to the pre-refactor baseline, and a representative solve's `{chosen, effective, membershipPlaced, setsActive}` is `deepStrictEqual` before/after (AE9); `m.station` strings unchanged.
- README and `CONCEPTS.md` use correct terminology; the "Dino Set-Bonus" and "Nearly Complete slot" glossary entries are reconciled (R10, R12).
- No live data source carries an `awaken*` key; the forward-looking normalization guard has a fixture test proving the old-key path resolves (R9).
- `python3 tests/run_tests.py` and the full `node tests/*.test.js` loop both pass (AE10).
- Deliverables from the prompt produced: renamed-fields/alias list (expected: none renamed; guard-only), the list of every changed player-facing label, test results, and the AE9 invariance confirmation.
