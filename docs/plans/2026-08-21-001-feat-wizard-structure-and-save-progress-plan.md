---
title: "Wizard Structure and Save Progress - Plan"
type: feat
date: 2026-08-21
topic: wizard-structure-and-save-progress
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
amends: ["docs/plans/2026-08-09-005-feat-loadout-library-compare-manual-build-plan.md"]
related: ["#357"]
---

# Wizard Structure and Save Progress - Plan

## Goal Capsule

**Objective.** Give the wizard's first two steps a legible structure, give saving a single home and a single name, and stop the UI from quoting the dataset at the player.

**Product authority.** This document. Requirements and Key Decisions here are settled unless a later plan supersedes them in place.

**Open blockers.** None. Every product decision is settled; the remaining questions are implementation shape and are marked deferred to planning.

**Amends an existing plan.** KD1 supersedes a Key Decision in the loadout-library plan (`docs/plans/2026-08-09-005-…`, #357), which is implementation-ready and next in the queue. That plan must be re-read before it runs.

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
