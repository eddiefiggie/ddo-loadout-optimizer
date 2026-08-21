---
title: "Wizard Structure and Save Progress - Plan"
type: feat
date: 2026-08-21
topic: wizard-structure-and-save-progress
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
planning_source: ce-plan
planned: 2026-08-21
execution: code
amends: ["docs/plans/2026-08-09-005-feat-loadout-library-compare-manual-build-plan.md"]
related: ["#357"]
---

# Wizard Structure and Save Progress - Plan

## Goal Capsule

**Objective.** Give the wizard's first two steps a legible structure, give saving a single home and a single name, and stop the UI from quoting the dataset at the player.

**Product authority.** This document. Requirements and Key Decisions here are settled unless a later plan supersedes them in place.

**Open blockers.** None. Every product decision is settled; the remaining questions are implementation shape and are marked deferred to planning.

**Amends an existing plan.** KD1 supersedes a Key Decision in the loadout-library plan (`docs/plans/2026-08-09-005-feat-loadout-library-compare-manual-build-plan.md`, #357), which is implementation-ready and next in the queue. The edit it needs is one sentence, spelled out in KTD7 below rather than left to be noticed.

**Planning status (2026-08-21).** Enriched to implementation-ready. Three requirements turned out to need groundwork the Product Contract did not anticipate — R16 has no field to restore from, R11 collides with an existing mechanism, and R19 has no state to read — and each is resolved in a Key Technical Decision below.

**Product Contract preservation.** Unchanged. No R/AE ID or Key Decision was altered by planning; every question planning answered was already deferred to planning or surfaced by grounding the requirements against the code.

---

## Product Contract

### Summary

The character step becomes three labelled containers with required fields marked, beside a rail that reflects the build back and owns Save progress and Load. Saving becomes explicit and named, replacing the two separate name inputs the flow carries today, and it persists the whole in-progress query so a named build reopens at any step. The footer promotes the build stamp to a labelled first position, and dataset-derived counts come off the UI.

### Problem Frame

Three separate frictions, all in the first half of the flow.

The character step is nine controls in one flat card with no grouping and no required marking. `canAdvance` blocks on race and ML cap, but nothing on screen says so — a player who leaves race blank gets a dead Continue button and no explanation. Optional fields carry a small `· optional` suffix that reads as decoration rather than structure.

Saving is spread across two steps under two names. An optional "Character name" field sits on the gear-pool step with help text explaining that naming is how you save; a second `Name this character…` input appears on the results step beside a "Save character" button. One concept, two inputs, neither reachable from the step a player is actually on. Beside the first sits an "Export & Data Management" disclosure whose vocabulary — backups, master records, data versions — belongs to a different job than the one that step is doing.

The footer runs four sentences of attribution together with the item count and the build stamp on one line, build last and smallest. The build stamp is the only version signal a player has, and it is the least visible thing in the footer. The item count also opens the intro paragraph, where it reads as a boast about the repository rather than anything a player can use.

### Key Decisions

**KD1. Save progress is designed here, and the loadout library's save model is amended to match.** *(session-settled: user-directed — chosen over deferring save into #357, and over shipping a thin throwaway.)* The loadout-library plan holds that one record is written only at the end of a solve. That cannot serve a player who wants to fill in a character and come back to it. This plan owns the save model; #357 builds its loadout record on top of it rather than defining a second one. #357 is implementation-ready with 42 traced requirements, so the amendment is a real edit to a real plan, not a note.

**KD2. Cross-device backup leaves the wizard but keeps existing.** *(session-settled: user-directed — chosen over folding backup into the save panel, and over dropping it.)* Export-all and import are the only way to move builds between machines, and losing them would make clearing browser data unrecoverable. They move to a **Your data** block on the results Share tab, below the loadout export formats, so the wizard's panel is save, load and delete for the current build and nothing else. Putting both kinds of export on one tab lets the distinction be stated once — share one loadout with someone else, versus back up every build you own. *(session-settled: user-directed — chosen over a footer link and over the intro step.)* Known cost: the Share tab follows a solve, so a player holding saves but no current solve has no path to their backups. Planning must resolve that reachability gap.

**KD3. Grouped containers plus a persistent rail, with weapon setup collapsed.** *(session-settled: user-directed — chosen over keeping every group open, and over collapsing all optional groups.)* Required fields and restrictions sit in labelled containers, both open. Weapon setup collapses behind a disclosure that states whether anything is set, so the step stays short for the majority who do not constrain weapons without hiding the fact that the group exists. A rail beside the form shows the build so far and holds Save progress and Load.

**KD4. Invalid required fields get outline, scroll and focus — no motion.** *(session-settled: user-directed — chosen over the repeating flash originally specified, and over a single shake.)* Repeated flashing is bounded by WCAG 2.3.1 and is a documented trigger for photosensitive and vestibular conditions. The attention job is done by scrolling the first missing field into view, focusing it, outlining every missing field, and naming them all in one message.

**KD5. Explicit save only, guarded on exit.** *(session-settled: user-directed — chosen over an auto-saved draft with a resume prompt, and over silent restore.)* Nothing persists unless the player saves. Because that leaves unsaved work losable — the exact frustration this feature targets — leaving a step with unsaved changes raises a guard rather than discarding silently.

**KD6. Armor type joins the required set.** *(session-settled: user-directed — chosen over leaving it optional, and over requiring it with a pre-filled default.)* Armor drives the dodge cap and filters what is equippable, so a solve run without it can return a loadout the player cannot wear. `canAdvance` enforces only race and ML cap today, so this is a behavior change rather than a labelling fix: a player who currently advances without setting armor will be stopped. It ships under a structure pass and must be called out as such in the release note. No default is pre-filled — choosing on the player's behalf would shape their results silently, which the tool's never-infer-a-value principle rules out.

### Actors

**Player, first-time.** Meets the character step with no build saved. Needs to know which fields are required before pressing Continue, not after.

**Player, returning.** Has one or more saved builds. Wants to reopen one and continue from whatever step they stopped at.

**Player, multi-character.** Keeps several builds — a character name or a build name distinguishes them. Needs to know which one is loaded while editing it.

### Requirements

**Character step structure**

- R1. The character step's fields are grouped into labelled containers by what each group does, not by the order they were added.
- R2. Every required field is marked as required at the field, and its container states that it holds required fields.
- R2a. The required set is race, ML cap, and armor type.
- R3. Optional fields are distinguishable from required ones without reading help text.
- R4. Field order runs required-first, then restrictions, then weapon setup.
- R5. Controls share a common left edge and a common right edge within a column, so their outlines form a grid rather than a ragged stack.
- R5a. Control width is set by the column, not by the control's type or its content. A number input, a text input and a select in the same column are the same width.
- R5b. Labels share a common left edge with the control they label.
- R6. Required fields and restrictions are visible without interaction; weapon setup may collapse.
- R6a. A collapsed group states whether it holds any set values, so an unopened group is never mistaken for an empty one.

**Required-field validation**

- R7. Attempting to advance with a required field unanswered does not advance the step.
- R8. Each unanswered required field is visually distinguished as needing an answer, and the distinction persists until it is answered.
- R9. Advancing with required fields unanswered scrolls the first one into view and focuses it.
- R10. One message names every unanswered required field.
- R11. The invalid treatment uses no repeating motion.
- R12. A required field already satisfied by loaded or imported data is not marked as needing an answer.

**Save progress**

- R13. A build is saved under a name the player supplies, which may be a character name or a build name.
- R14. Save and Load are reachable from every step of the flow, not from one step only.
- R15. Saving captures the in-progress state of every step completed so far, not only a solved result.
- R16. Loading a saved build restores that state and returns the player to where they stopped.
- R17. The flow carries exactly one input for the build's name.
- R18. Nothing is persisted unless the player saves.
- R19. Leaving a step with unsaved changes raises a guard naming what would be lost.
- R20. The currently loaded build's name is visible while editing it.
- R21. A saved build can be deleted.

**Backup relocation**

- R22. Export-all and import remain available in the app.
- R23. Neither appears in the wizard's step flow.
- R24. The wizard's save surface offers save, load and delete only.

**Repository references in the UI**

- R25. No UI surface states a count derived from the dataset or the repository.
- R26. The intro's opening language describes what the tool does without quoting its size.
- R27. Per-result coverage disclosure is unaffected — it describes the solve, not the catalog.

**Footer**

- R28. The build stamp is the most prominent element in the footer, carries a "Build" label above the value, and renders in a monospaced face so successive builds line up when compared.
- R29. The build stamp holds a fixed position so a returning player can find it in the same place.
- R30. Attribution retains both community credits and both links.
- R31. The footer reads as distinct elements rather than one run-on line.

### Key Flows

**Filling in a character and continuing.** The player meets three labelled containers, required fields marked. They fill the required ones, optionally set restrictions or weapons, and continue. If they press Continue with a required field blank, the step holds, the first blank field takes focus, every blank required field is outlined, and one message names them.

**Saving mid-flow and returning.** At any step, the player opens the save surface, names the build, and saves. Later they load that name and land at the step they left, with every earlier step's input restored.

**Leaving with unsaved changes.** The player edits a loaded build, or fills a fresh one, and navigates away without saving. A guard names what is unsaved and offers to save, discard, or stay.

### Acceptance Examples

- AE1. Race is blank; the player presses Continue. The step does not advance, race is outlined and focused, and a message names race as required.
- AE2. Race, ML cap and armor are set; the player presses Continue. The step advances with no warning, regardless of which optional fields are blank.
- AE2a. Race and ML cap are set but armor is blank; the player presses Continue. The step does not advance — the gate armor newly joins is enforced, not merely displayed.
- AE3. A player loads a saved build that already carries race, ML cap and armor, then visits the character step. No field is marked as needing an answer.
- AE3a. A player loads a build saved before armor became required, and it carries no armor. The character step marks armor as needing an answer rather than silently blocking a re-solve elsewhere.
- AE4. The player fills the character step, saves as "Sook — Reaper", closes the tab, reopens the app, and loads that name. The character step's values are as they left them.
- AE5. The player fills the character step, then closes the tab without saving. On return, nothing is restored and the flow starts clean.
- AE6. The player edits a loaded build and navigates away without saving. A guard names the unsaved change before the navigation completes.
- AE7. Two builds are saved under different names. Loading the second and editing it shows the second name while editing.
- AE8. Anywhere in the flow, no visible text states how many items the dataset holds.
- AE9. A solved result still discloses its own coverage — how much of the relevant gear was verified for that solve.
- AE10. The footer names the build stamp with a label, and it is the footer's most prominent element.
- AE11. The wizard's save surface offers no export or import control.
- AE12. Export-all and import remain reachable somewhere in the app.

### Scope Boundaries

- The results Share tab's five export formats are a separate feature and are untouched. They share the word "export" with backup and are not the same thing.
- Compare and manual building stay in #357's scope.
- The priorities step is not restructured here.
- No visual design system, palette, or type scale is decided here; this is structure and behavior.
- Backup is relocated, not removed. A plan that deletes it has misread KD2.

### Dependencies / Assumptions

- The required set becomes race, ML cap and armor (KD6). `canAdvance` enforces only the first two today, so planning must treat this as a gate change with a migration case: builds saved before it carry no armor value.
- Assumes "import has already accommodated the requirement" (R12) means a loaded save or an imported backup, not the Trove owned-inventory CSV, which supplies gear ownership and no character parameters.
- Assumes the existing per-character save store is the right foundation for save-progress rather than a new one, since it already persists the full input allowlist.
- Assumes the rail collapses or relocates below the form at narrow widths; the exact breakpoint is a planning decision.

### Outstanding Questions

**Deferred to planning**

- How a player reaches backup when they hold saves but have not solved anything this session, given the Share tab sits after a solve (KD2's known cost).
- Whether the rail is a fixed sidebar, a sticky header strip, or a collapsible panel at narrow widths.
- How the unsaved-changes guard is triggered — step navigation only, or also tab close.
- Whether loading a build mid-flow warns when it would discard the current unsaved one.

### Sources / Research

- `web/wizard.js` — `canAdvance` enforces race and a positive ML cap for the character step and nothing else; `stepCharacter` renders nine controls in one flat card; the "Character name" field and the "Export & Data Management" disclosure both sit in `stepPool`; a second name input and "Save character" sit in the results step.
- `web/wizard.js` — `stepIntro` interpolates the item count into the opening paragraph.
- `web/index.html` — the footer holds `#dataset-info`, four sentences of attribution, and `#build-info`, in that order.
- `docs/plans/2026-08-09-005-feat-loadout-library-compare-manual-build-plan.md` — the loadout-library plan whose save model KD1 supersedes. Implementation-ready, 42 requirements traced, ungated as of 2026-08-21.
- `docs/plans/2026-07-30-001-feat-character-persistence-and-results-restructure-plan.md` — the plan that built the existing save/load/backup, and the source of today's two-name-input shape.
- WCAG 2.3.1 (Three Flashes or Below Threshold) — the basis for KD4.

---

## Planning Contract

### Key Technical Decisions

**KTD1. `step` joins `INPUT_KEYS`.** R16 asks the flow to return a player where they stopped, and nothing records that today — `stepAfterLoad` is binary, sending a solved snapshot to results and everything else to priorities. The step becomes a saved input rather than a new top-level record field, so it rides the allowlist `web/backup.js` already sources from `web/persist.js` and the export/import round-trip inherits it with no second edit. This is the precedent `overrides` set in #421. A record written before this feature carries no `step`; its absence means pre-feature, and the load path falls back to `stepAfterLoad` unchanged.

**KTD2. Field-level validation replaces `flashBlock` on the character step only.** `flashBlock` nudges the Continue button and fires from the generic handler for every step. R11's treatment — scroll, focus, outline, one message — is what the character step gets; the pool and priorities steps keep the nudge, because replacing feedback on steps this plan does not restructure is a change nobody asked for. The generic handler becomes step-aware rather than being rewritten.

**KTD3. One `inputsDirty` flag, set by the same writes that already mark `constraintsDirty`.** R19's guard has no state to read: `constraintsDirty` covers slot constraints only. Rather than diffing state against the last save on every navigation, a single flag is raised by input mutation and cleared by save or load. Cheap, and it cannot drift from what the player actually changed the way a diff over a large state object can.

**KTD4. The rail renders in `render()`, outside each step's body.** R14 puts Save and Load on every step, so the rail cannot live inside `stepCharacter`. It renders beside the step body from the shared render path, the way `migrationBanner()` already does. This is the widest blast radius in the plan — every step's layout changes — and it is why U3 lands before the character step's own restructure.

**KTD5. A pre-KD6 build with a solved snapshot keeps its result and is flagged.** AE3a covers the character step marking armor as needing an answer. The harder case is a build saved before KD6 that also carries a solved loadout: loading it lands on results, so the player sees a complete build while an unanswered required field sits behind them. The result stands — it was validly solved under the old gate — and the stale banner names armor as newly required, using the mechanism `staleNote` already provides. Blocking the result would retroactively invalidate builds that were correct when saved.

**KTD6. Backup relocates to a `Your data` block rendered by the Share panel.** `fillSharePanel` already re-populates and re-wires on every results render, so the block inherits that lifecycle rather than needing its own. `web/backup.js` is unchanged — this is a move of the calling surface, not of the mechanism.

**KTD7. #357's Key Decision is superseded with this sentence.** In `docs/plans/2026-08-09-005-feat-loadout-library-compare-manual-build-plan.md`, the decision reading *"One saved-build record that is both the character and the loadout, written only at the end of a solve"* becomes *"One saved-build record that is both the character and the loadout. It may be written at any step; a record written after a solve additionally carries the loadout."* U7 makes that edit in the same PR as the code, so the two cannot disagree.

### System-Wide Impact

The rail (KTD4) changes every step's layout, so every step is a regression surface even though only the character step is restructured. `INPUT_KEYS` gains a key, which the backup round-trip inherits automatically and which `tests/backup.test.js` should assert rather than assume. The armor gate (KD6) changes `canAdvance`, which is called from six sites — five for the priorities step and one generic — so the gate change reaches the generic handler only.

Player-facing throughout: the deploy bumps the `?v=` cache-busts in `web/index.html`, `BUILD` in `web/app.js`, and the `**Current build:**` line in `README.md` together.

---

## Implementation Units

### U1. Take repo-derived counts off the UI

**Goal:** No UI surface quotes the dataset's size.
**Requirements:** R25, R26, R27.
**Dependencies:** none.
**Files:** `web/wizard.js` (`stepIntro`), `web/index.html` (the footer's `#dataset-info`), `tests/wizard.test.js`.
**Approach:** `stepIntro` interpolates the item count into its opening paragraph; the footer renders it into `#dataset-info`. Both go. Rewrite the opening line to describe what the tool does rather than how much it holds. Per-result coverage disclosure is a different surface and is not touched — it describes the solve, not the catalog.
**Test scenarios:**
- `Covers AE8.` The intro copy contains no digit-grouped count.
- A guard asserts no wizard step template interpolates `dataset.items.length` or an equivalent count.
- `Covers AE9.` A solved result still renders its coverage disclosure.
**Verification:** the phrase a player reads first says what the tool does, and nothing on screen states a catalog size.

### U2. Footer restructure

**Goal:** The build stamp is the footer's most prominent, fixed-position element.
**Requirements:** R28, R29, R30, R31.
**Dependencies:** U1 (which empties `#dataset-info`).
**Files:** `web/index.html`, `web/styles.css`, `tests/wizard.test.js`.
**Approach:** Build first with a `Build` label above the value, monospaced so successive stamps align when compared. Attribution compresses to one line keeping both credits and both links. The run-on single line becomes distinct elements.
**Test scenarios:**
- `Covers AE10.` The footer markup places the build element before attribution and labels it.
- Both community links survive the compression.
**Test expectation:** structure only — the stamp's *value* is already guarded by `tests/test_build_stamp.py`.
**Verification:** the build stamp is findable in the same place at a glance, and both credits remain.

### U3. The save rail

**Goal:** Save, Load and the build's name are reachable from every step.
**Requirements:** R13, R14, R17, R20, R21.
**Dependencies:** none.
**Files:** `web/wizard.js` (`render`, and the two existing name inputs), `web/persist.js`, `web/styles.css`, `tests/wizard.test.js`, `tests/persist.test.js`.
**Approach:** The rail renders from `render()` beside the step body (KTD4), holding the build name, Save, Load and Delete. Both existing name inputs are removed — the optional `Character name` field in `stepPool` and the `Name this character…` input beside the results step's Save button — leaving exactly one (R17). The existing per-character store is the foundation; this unit changes where naming and saving are reached from, not how they persist.
**Execution note:** the rail is the widest change here. Land it before the character step's restructure so a layout regression is attributable to one unit rather than two.
**Test scenarios:**
- The rail's model is exposed as a pure helper and returns the loaded build's name, or an empty state when nothing is loaded.
- `Covers AE7.` With two builds saved, loading the second shows the second name.
- Deleting the loaded build returns the rail to its empty state.
- A guard asserts exactly one name input exists across the wizard's step templates.
**Verification:** every step shows the same save surface, and the flow carries one name input.

### U4. Persist the step, and resume to it

**Goal:** A saved build reopens where the player stopped.
**Requirements:** R15, R16, R18.
**Dependencies:** U3.
**Files:** `web/persist.js`, `web/wizard.js` (the load path), `tests/persist.test.js`, `tests/backup.test.js`, `tests/wizard.test.js`.
**Approach:** `step` joins `INPUT_KEYS` (KTD1). Saving captures the in-progress state of every step completed so far, not only a solved result. On load, a record carrying a `step` resumes there; a record without one falls back to `stepAfterLoad`, which is what every pre-feature save gets. Nothing persists unless the player saves (R18) — this unit adds no autosave.
**Test scenarios:**
- `Covers AE4.` Save at the character step, reload, load by name: the character step's values return and the flow lands on the character step.
- `Covers AE5.` Fill the character step, do not save, reload: nothing is restored.
- A pre-feature record with no `step` lands where `stepAfterLoad` sends it, unchanged.
- The backup round-trip carries `step` with no second allowlist edit — proven by removing the key and watching an imported record lose it.
- Saving before any solve produces a record with no snapshot and still reloads.
**Verification:** a build saved mid-flow reopens mid-flow; a build saved before this feature behaves exactly as it does today.

### U5. The unsaved-changes guard

**Goal:** Leaving a step with unsaved work says so.
**Requirements:** R19.
**Dependencies:** U3, U4.
**Files:** `web/wizard.js`, `tests/wizard.test.js`.
**Approach:** One `inputsDirty` flag (KTD3), raised by the input mutations that already raise `constraintsDirty` and cleared by save and by load. Leaving a step while dirty raises a guard naming what would be lost, offering save, discard, or stay.
**Execution note:** the guard's message is built from state, so build it as a pure helper and test the message rather than the dialog.
**Test scenarios:**
- `Covers AE6.` Edit a loaded build, navigate away: the guard fires and names the unsaved change.
- Saving clears the flag; navigating afterwards raises nothing.
- Loading a build clears the flag — a freshly loaded build is not unsaved work.
- A step left untouched raises no guard.
**Verification:** unsaved work cannot leave the flow silently, and a clean state never nags.

### U6. Character-step structure and required-field validation

**Goal:** The character step reads as grouped, required-marked, and aligned; unanswered required fields stop Continue and say why.
**Requirements:** R1, R2, R2a, R3, R4, R5, R5a, R5b, R6, R6a, R7, R8, R9, R10, R11, R12.
**Dependencies:** U3 (the rail occupies the space beside the form).
**Files:** `web/wizard.js` (`stepCharacter`, `canAdvance`, the generic Continue handler), `web/styles.css`, `tests/wizard.test.js`.
**Approach:** Three labelled containers — Required, Restrictions, Weapons — in that order, the first two open and the third collapsible with a summary of whether anything is set (R6a). Controls take their width from the column, not their type (R5a). `canAdvance("character")` gains armor (KD6). The generic Continue handler becomes step-aware (KTD2): the character step scrolls to and focuses the first unanswered required field, outlines every unanswered one, and renders one message naming them; other steps keep `flashBlock`.
**Execution note:** the validation is behavior, not styling — write the invalid-state test before the treatment, and prove the armor gate fails against the pre-change tree.
**Test scenarios:**
- `Covers AE1.` Race blank, Continue pressed: the step holds, race is named in the message.
- `Covers AE2.` Race, ML cap and armor set: the step advances regardless of optional fields.
- `Covers AE2a.` Armor blank with race and ML cap set: the step does not advance.
- `Covers AE3.` A loaded build carrying all three marks nothing as needing an answer.
- The message names every unanswered field, not only the first.
- A collapsed weapon group states whether it holds set values.
- The invalid treatment adds no repeating animation class.
- The pool and priorities steps still nudge the Continue button when blocked.
**Verification:** every lifecycle of the step — empty, partly filled, fully filled, loaded — produces the right gate and the right message.

### U7. Backup relocation, and #357's amendment

**Goal:** Backup leaves the wizard without leaving the app, and the plan it contradicts is corrected.
**Requirements:** R22, R23, R24.
**Dependencies:** U3.
**Files:** `web/wizard.js` (`stepPool`'s `Export & Data Management` disclosure, `sharePanelHTML`), `tests/wizard.test.js`, `docs/plans/2026-08-09-005-feat-loadout-library-compare-manual-build-plan.md`.
**Approach:** The disclosure is removed from `stepPool` and its controls render as a `Your data` block in the Share panel, which already re-populates and re-wires on every results render (KTD6). `web/backup.js` is untouched. The same unit makes KTD7's one-sentence edit to #357's plan, so the code and the correction land together.
**Test scenarios:**
- `Covers AE11.` No wizard step template contains an export or import control.
- `Covers AE12.` Export-all and import are reachable from the Share panel.
- The wizard's save surface offers save, load and delete only.
- #357's plan no longer states that a record is written only at the end of a solve.
**Verification:** backup works exactly as before from its new home, and #357 no longer contradicts this plan.

---

## Verification Contract

Run all three, in this order:

1. `python3 tests/run_tests.py` — the Python suite, including the build-stamp guard.
2. `for t in tests/*.test.js; do node "$t"; done` — the JS suite, one file per invocation. `node a.js b.js` runs only the first and has silently skipped the golden check before.
3. Browser pass on a real flow: fill the character step and confirm the gate and message; save mid-flow, reload, and load by name; leave a step dirty and confirm the guard; confirm backup works from the Share panel; confirm the footer and intro carry no count.

The browser pass is not optional. Most of this plan is DOM behavior, and a helper exported on `module.exports` but not on the browser global is green in CI and dead in the app — that failure has shipped in this repo before.

Before merging: bump the `?v=` cache-busts in `web/index.html`, `BUILD` in `web/app.js`, and the `**Current build:**` line in `README.md` together.

---

## Definition of Done

- All 35 requirements implemented, each traceable to a unit above.
- All 14 acceptance examples exercised by a named test.
- Python and JS suites green, run per the Verification Contract.
- New tests proven to fail against the pre-change tree; the `INPUT_KEYS` inheritance guard proven red by removing the key.
- Browser pass completed on a real flow.
- Build stamp bumped in all three places.
- KD6's gate change called out in the release note as a behavior change, not a labelling fix.
- #357's superseded decision edited in place (KTD7), in the same PR as the code.
