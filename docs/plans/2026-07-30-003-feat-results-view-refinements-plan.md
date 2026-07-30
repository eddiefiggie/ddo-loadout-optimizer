---
title: Results-View Refinements - Plan
type: feat
date: 2026-07-30
topic: results-view-refinements
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Results-View Refinements - Plan

## Goal Capsule

- **Objective:** Refine the Results view so a returning user reaches a saved build with no wizard detour, sees each item's assigned augments and craft slots at a glance, always has Adjust & re-solve within reach, gets clear feedback while Alternatives compute, and shares a loadout from a dedicated tab that's clearly separate from personal build management.
- **Product authority:** User (single-owner personal project).
- **Open blockers:** None.
- **Cross-plan note:** The crafting-terminology refactor (`2026-07-30-002-refactor-crafting-terminology`) rewrites the labels used for augments/crafts. The new per-item display here (R3, R4) should render crafting labels through that plan's metadata registry once it exists; whichever plan ships second updates the other's labels for consistency.
- **Product Contract preservation:** Requirements R1–R11 unchanged in intent. Research clarified the *mechanism* (captured as KTDs): R1 is a hardening of existing load-to-Results behavior (KTD1); the applied-augment display threads the assignment maps into `equippedRow` and resolves affixes by `variant_id` with no solver-output change (KTD2); the Adjust move is the layout the prior restructure deferred, now a renderer-emitted slot re-wired by the wizard (KTD3); the Alternatives spinner is panel-local `.wz-ring`, not the wizard's full-screen overlay (KTD4).

---

## Product Contract

### Summary

Five focused refinements to the Results view: (1) loading a saved solved build goes straight to Results; (2) each equipment block shows its assigned augments with the affixes they add and declares each craft-upgrade slot with its assignment, at a uniform block size; (3) the Adjust & re-solve fold-up sits directly under the tab bar on every tab; (4) the Alternatives tab gains an explicit "Run analysis" button with the solve-style spinner; (5) a new far-right "Share" tab holds the loadout share-exports, moved out of the Character step — which keeps only personal master-records management.

### Problem Frame

The Results view shipped in the character-persistence work (PRs #55/#57) but has rough edges: reaching a saved build feels like cycling through the wizard; the equipment blocks show augment-slot colors but not what's actually slotted or crafted; Adjust & re-solve is buried below the panels; Alternatives silently auto-computes with only a small text note; and loadout sharing is mixed into the Character step's data-management panel, blurring "share this build" with "manage my saved builds."

### Key Decisions

- **KD1. Loading stays in the Character step and lands directly on Results** (session-settled: user-directed — chosen over a Start-screen load shortcut: fewer moving parts; the fix is to guarantee load skips pool/priorities, not to add a new entry point). Load and master-records export both remain in the Character step.
- **KD2. Two separate plans** (session-settled: user-directed — the crafting-terminology refactor is its own plan; this plan is UI-only and picks up whatever crafting labels exist).
- **KD3. Sharing and personal management are distinct surfaces.** The new far-right "Share" tab exports a single loadout for others; the Character step's Export & Data Management manages the user's own saved builds (master records). Copy on each makes the distinction explicit.

### Requirements

**Load flow**

- R1. Loading a saved character whose stored build is solved takes the user **straight to Results**, skipping the pool and priorities steps. (Hardening: `loadCharacter` already sets the results step, results.js/wizard.js — this requirement guarantees it holds and never routes through the wizard.)
- R2. The saved-character picker and master-records export/import stay in the Character step; no new load entry point is added elsewhere.

**Loadout block display**

- R3. Each equipment block shows, per augment slot, the **augment assigned** to it and the **affixes that augment adds** (using the solver's per-item augment assignment, e.g. `augAssign.byIndex`), not just the slot color.
- R4. Each **craft-upgrade slot on an item that has an applied craft** is **declared** with **what is assigned** to it (the applied value), rather than only indicating a slot exists. (Scope: only crafts that were *assigned* are surfaced — the craft assignment maps carry applied crafts, not an empty-slot inventory. Unlike augment slots, whose colors are intrinsic item data and so render open-when-empty per R3/AE2, an unfilled craft slot is not separately enumerated.)
- R5. Equipment blocks stay **uniform in size** as R3/R4 content expands or contracts — a block with many augments/crafts is the same size as an empty one (fixed floor + consistent layout; the grid keeps paired blocks equal).

**Adjust & re-solve placement**

- R6. The **Adjust & re-solve** control (a fold-up, collapsed by default) sits **directly under the tab bar** and is available on **every tab**, not buried beneath the active panel. Switching tabs never moves or hides it.

**Alternatives**

- R7. The Alternatives tab shows an explicit **"Run analysis" button** instead of auto-computing on open. Clicking it triggers the computation.
- R8. While Alternatives compute, show the **same swirly "thinking" indicator used for the main solve** (the solve-wait overlay), so the user sees that work is happening; results replace the indicator when done. The spinner is **always** replaced by a terminal state — the alternative cards on success, a "no near-optimal alternatives found" message when the compute yields none, or an error-with-retry state if it throws — so it is never left spinning.

**Share tab split**

- R9. Add a new **far-right "Share" tab** to the Results tab group. It holds the single-loadout share exports (Markdown, CSV, print), moved out of the Character step's Export & Data Management panel.
- R10. The Character step's Export & Data Management keeps **only** master-records load/export (the versioned JSON backup + import of personal saved builds) — the share exports are removed from it.
- R11. Copy makes the split explicit: the Share tab states it is for **sharing a loadout with others**; the Character export states it is for **managing your own saved builds**.

### Acceptance Examples

- AE1. **Load → Results.** *Given* a saved character with a solved snapshot, *when* the user clicks Load, *then* Results renders directly with no pool/priorities steps in between. (R1)
- AE2. **Assigned augments shown.** *Given* an item with a slotted augment, *then* its block shows the augment and the affixes it adds; *given* an empty augment slot, *then* the block shows the open slot. (R3, R5)
- AE3. **Craft slot assignment shown.** *Given* an item with a craft-upgrade slot that has an assignment, *then* the block declares the slot and shows what's assigned; *given* an item whose craft slot has no assignment, *then* nothing extra is rendered for it (unfilled craft slots are not enumerated — R4 scope). (R4)
- AE4. **Uniform blocks.** *Given* two items where one has many augments/crafts and one has none, *then* their blocks render at the same size. (R5)
- AE5. **Adjust everywhere.** *Given* any of the five tabs is active, *then* Adjust & re-solve sits directly under the tab bar and is reachable. (R6)
- AE6. **Alternatives button + spinner.** *Given* the Alternatives tab, *when* the user clicks Run analysis, *then* the solve-style spinner shows while computing and is replaced by the alternatives when done; *if* the compute yields no alternatives or throws, *then* the spinner is replaced by a clear message (never left spinning). (R7, R8)
- AE7. **Share tab.** *Given* Results, *then* a far-right Share tab offers Markdown/CSV/print for a loadout; the Character step's export panel no longer offers share exports and states it manages personal builds. (R9–R11)
- AE8. **Load stays put.** *Given* the app, *then* the Load control and master-records export/import appear **only** in the Character step, and no load entry point exists elsewhere (e.g. the Start screen). (R2)

### Scope Boundaries

- No change to the solver, the optimization, or the crafting terminology itself (labels come from the current app or, once shipped, the crafting-terminology refactor's (`2026-07-30-002`) registry).
- No new load entry point on the Start screen (KD1) — load stays in the Character step.
- Not re-solving on load — the stored snapshot renders (existing behavior); Adjust & re-solve is the re-compute path.

### Dependencies / Assumptions

- Per-item augment assignment data already exists (`assignAugments` returns `byIndex`, results.js) — R3 uses it; no solver change needed.
- The solve-wait overlay used by the main solve is reused for R8 (the same "thinking" indicator).
- R6 (Adjust interleaved between the tab bar and the active panel) is the placement the prior Results-restructure PR deferred to avoid disturbing the priorities-editor wiring; planning owns re-wiring it cleanly.

### Sources / Research

- `web/wizard.js` — `loadCharacter` (sets results step; R1); the Character-step Export & Data Management panel `wz-data` with both master-records backup and the `wz-share-*` share exports (R9–R11 move the latter); the `wz-adjust` fold-up in `stepResults` (R6); the solve-wait `overlay(...)` indicator (R8).
- `web/results.js` — `renderResults` tab group + panels (R6, R7, R9); `equippedRow` / `equippedBody` (R3–R5 extend these); `assignAugments` `byIndex`/`freeByIndex` and `craftChips` (R3, R4 data sources); `ensureAlternatives` lazy-compute (R7, R8 replace with button + spinner).
- Repo research (this run): the solve spinner is `overlay(on,title,sub)` (wizard.js ~L323) rendering `.wz-ring`; `craftChips` (results.js ~L266) reads applied augments from `maps.augAssign.byIndex.get(idx)` (`{variant_id, color, slot_color}` — **no affixes on the placed meta**, so affixes resolve by `variant_id`); `equippedRow` does **not** currently receive `maps`; the `wz-adjust` `<details>` sits after `#wz-results` in `stepResults` (wizard.js ~L250) while the tab bar + panels live *inside* `#wz-results` (rendered by `renderResults`); the Character-step share controls are `wz-share-*` in `stepCharacter`'s `wz-data` panel (Phase 3, PR #58).

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Load-to-Results is a hardening, not a new build path.** `loadCharacter` already sets the results step and renders when the snapshot is optimal; U1 guarantees it never routes through pool/priorities and adds a guard/regression test. Load + master-records export stay in the Character step. (session-settled: user-directed — chosen over a Start-screen load shortcut: fewer moving parts.)
- KTD2. **Applied augments + their affixes render by threading the assignment maps into `equippedRow` and resolving affixes by `variant_id`** — the placed-augment meta carries `variant_id`/color but not affixes, so the renderer looks them up from the augment pool (no change to `augmentsPlaced`/solver output). `buildViews` already builds `maps`; pass it (or the needed sub-maps) into `equippedRow`.
- KTD3. **Adjust & re-solve becomes a persistent slot directly under the tab bar, re-wired via a `renderResults` post-render callback.** `renderResults` emits the Adjust container between `.result-tabs` and the panels, and — critically — invokes a **wizard-supplied callback at the end of every render**. All Adjust-panel (and Share-panel, KTD5) population + handler wiring live in that callback, because `renderResults` is called from **three** sites that each rebuild `#wz-results` and destroy the wizard-filled content and its **direct** handlers (drag/drop + per-button in the priorities editor, the pool toggle, re-solve): solve, load, **and every per-slot constraint change**. Delegation alone cannot restore the drag/direct handlers, so the callback is required; the panel stays collapsed by default and is outside the panels so a tab switch (which only toggles `hidden`, not a re-render) never disturbs it. (This is the R6 placement the prior restructure deferred.)
- KTD4. **The Alternatives spinner is panel-local**: render the same `.wz-ring` swirly markup inside `#rp-altspanel` while computing, not the wizard's full-screen `overlay()` (a wizard closure results.js can't call). A "Run analysis" button gates the compute (replacing auto-compute-on-open in `ensureAlternatives`).
- KTD5. **Share exports move to a new far-right "Share" results tab; the Character step keeps only master-records backup.** The `wz-share-*` controls (select + MD/CSV/print) move out of `stepCharacter`'s `wz-data` panel into the new tab's panel, reusing the global `LoadoutExport`. Copy on each surface states its purpose (sharing vs personal management). (instantiates KD3.)
- KTD6. **Cross-plan labels stay decoupled now.** U2's block display renders whatever crafting labels exist today; when the terminology refactor (`2026-07-30-002`) ships, its registry updates these labels. No coupling is built in this plan.
- KTD7. **Uniform block size is preserved** as R3/R4 add content — the min-height floor + flex layout + grid stretch from the prior restructure already enforce this; new content flows within the block.

### Assumptions

- Augment affixes resolve by `variant_id` from **`model.augments`** — each entry carries `variant_id` plus its full `affixes` array (`model.js` ~L326), and `buildViews(build, model, query)` already receives `model` (results.js ~L719), so `equippedRow` can look them up with no change to `augmentsPlaced`/solver output. On load, `model` is rebuilt via `buildModel` with the saved query, so placed augments resolve there too. (Confirmed feasible — the build-time threading fallback is not needed.)
- Reusing `.wz-ring` in the panel requires no JS from wizard — it's a CSS-only spinner.
- Tests run as the project does: `python3 tests/run_tests.py` and the full `node tests/*.test.js` loop; UI behavior is confirmed by a manual browser pass (cleared storage, live-DOM assertions), the project's real backstop.

### Sequencing

U1 (load guard) and U4 (alternatives) are independent. U3 (adjust slot) introduces the `renderResults` post-render callback that U5 (share tab) reuses, so U5 follows U3; U2 (block detail) and U3 both touch `renderResults`/`equippedRow`, so sequence U2 → U3 → U5. Do U1 → U2 → U3 → U5, with U4 any time. Bump the `?v=` cache-buster once, on the first UI unit landed.

---

## Implementation Units

### U1. Harden load-to-Results

- **Goal:** Loading a saved solved build always lands directly on Results, never stepping through pool/priorities.
- **Requirements:** R1, R2; KTD1; AE1, AE8.
- **Dependencies:** none.
- **Files:** `web/wizard.js` (`loadCharacter` load path), `tests/wizard.test.js`.
- **Approach:** Confirm `loadCharacter` sets `state.step = "results"` and renders the snapshot for an optimal build; add a guard so any snapshot with `status === "optimal"` renders results directly and a non-optimal/missing snapshot routes to priorities with a clear reason (existing fallback). No new load entry point.
- **Test scenarios:** Covers AE1. Loading a character with an optimal snapshot yields `state.step === "results"` with the build rendered (assert via the pure load helper / DOM); a character with an empty snapshot routes to priorities, not a blank results view.
- **Verification:** browser pass — load a saved build, confirm Results renders with no intermediate steps.

### U2. Applied augments + affixes and craft-slot assignments in loadout blocks

- **Goal:** Each equipment block shows, per augment slot, the assigned augment and the affixes it adds, and declares each craft-upgrade slot with its assignment — at uniform block size.
- **Requirements:** R3, R4, R5; KTD2, KTD7; AE2, AE3, AE4.
- **Dependencies:** U1 (none functional; ordering only).
- **Files:** `web/results.js` (`buildViews` → pass `maps` into the equipped-row builder; `equippedRow`/`equippedBody` render applied augments + resolved affixes + assigned craft slots), `web/styles.css` (block-detail styling within the existing uniform-block rules), `tests/results.test.js`.
- **Approach:** Thread `maps` (or `augAssign.byIndex` + the craft maps) into `equippedRow` (it currently gets only `label, pick, slotConstraints, satisfied`). For each occupied item: list its assigned augments with each augment's affixes (resolve affixes by `variant_id` from the augment pool — KTD2, no solver-output change), and declare each craft-upgrade slot (greensteel/seal/lamordia/etc.) with the applied value from the craft maps (the same data `craftChips` uses). Only assigned crafts are surfaced — the craft maps carry applied crafts, not empty-slot inventory, so an unfilled craft slot renders nothing extra (R4 scope); empty *augment* slots still show open per R3 because slot colors are intrinsic item data. Keep blocks uniform via the existing min-height/flex/grid-stretch rules (KTD7).
- **Patterns to follow:** `craftChips` (results.js ~L266) for the applied-craft data shape; the U9 `equippedBody` projection from the prior restructure for uniform layout.
- **Test scenarios:** Covers AE2 (an item with a slotted augment shows the augment + its affixes; an empty augment slot shows the open slot), AE3 (an item with an assigned craft slot declares it + shows the assignment), AE4 (a heavily-augmented item and a bare item render at the same block size). Edge: an item with an augment whose affixes can't be resolved renders the augment name without crashing.
- **Verification:** `node tests/results.test.js` passes; browser pass across a build with augments + crafts confirms uniform sizing.

### U3. Adjust & re-solve persistent under the tab bar

- **Goal:** The Adjust & re-solve fold-up sits directly under the tab bar on every tab.
- **Requirements:** R6; KTD3; AE5.
- **Dependencies:** U2 (both touch the results markup — sequence to avoid churn).
- **Files:** `web/results.js` (`renderResults` — emit an Adjust slot between `.result-tabs` and the panels), `web/wizard.js` (`stepResults` — remove the `wz-adjust` block from after `#wz-results`; render/wire its controls into the renderer-emitted slot **after** `renderResults` runs), `web/styles.css`.
- **Approach:** `renderResults` emits `<div class="wz-adjust-slot" id="wz-adjust-slot">` right under the tab group and calls a wizard-supplied post-render callback (KTD3). The wizard fills the slot with the Adjust `<details>` content and wires the priorities editor / pool toggle / re-solve **inside that callback**, so it re-wires on all three `renderResults` call sites. The panel stays collapsed by default and is outside the panels (a tab switch only toggles `hidden`, not a re-render).
- **Execution note:** the real risk is re-wire timing — `renderResults` fires on solve (wizard.js ~L370), load (~L462), **and every per-slot constraint change (~L740)**; verify the Adjust controls (including drag/drop reorder and re-solve) still work after each, especially after a pin/lock/free constraint edit. Do not rely on delegation for the drag/direct handlers.
- **Test scenarios:** Covers AE5. On every tab present, the Adjust control renders directly under the tab bar and its re-solve works; after a per-slot constraint change (which re-renders results) the Adjust controls are still live (not blanked); a re-solve from Adjust updates the loadout. (The Share tab is the fifth tab, added in U5; U3's per-tab check runs against the tabs present at U3 time, with full five-tab coverage confirmed at the Definition of Done after U5.)
- **Verification:** browser pass — cycle all tabs, expand Adjust on each, run a re-solve; no console error.

### U4. Alternatives: Run-analysis button + panel-local spinner

- **Goal:** The Alternatives tab shows a Run-analysis button and the solve-style swirly while computing.
- **Requirements:** R7, R8; KTD4; AE6.
- **Dependencies:** none.
- **Files:** `web/results.js` (`ensureAlternatives` / the alternatives panel render), `web/styles.css` (reuse `.wz-ring` if any panel-scoped tweak is needed), `tests/alternatives.test.js` (guard the generation logic still works; the button/spinner are DOM).
- **Approach:** Replace auto-compute-on-open with an explicit "Run analysis" button in `#rp-altspanel`. On click, render the `.wz-ring` swirly (same markup as the solve overlay) with a short "Computing alternatives…" line, run `generateAlternatives`, then replace the spinner with the results. Cover all terminal states so the spinner never hangs: (a) success with cards; (b) success with zero alternatives → a "No near-optimal alternatives found" line with a way to re-run; (c) `generateAlternatives` throws → an error state with retry (wrap the call). Keep the existing graceful "unavailable" path when the solver/highs isn't present (distinct from (b)/(c) — that path is solver-absent, not ran-and-returned-nothing).
- **Test scenarios:** Covers AE6. The tab opens showing the button (no auto-compute); clicking it shows the `.wz-ring` spinner, then the alternative cards; a second visit does not recompute (cached). The zero-result and thrown-error terminal states each replace the spinner with their message rather than leaving it spinning (browser pass; the states are DOM). The generation logic is unchanged (existing alternatives tests stay green).
- **Verification:** browser pass — open Alternatives, click Run analysis, see the swirly then the results; `node tests/alternatives.test.js` passes.

### U5. Share tab (move share exports out of the Character step)

- **Goal:** A new far-right "Share" results tab holds the loadout share-exports; the Character step keeps only personal master-records management, with copy that makes the split explicit.
- **Requirements:** R9, R10, R11; KTD5; AE7.
- **Dependencies:** U3 (reuses the `renderResults` post-render callback — the Share panel lives inside `#wz-results` and is rebuilt on every render).
- **Files:** `web/results.js` (add the "Share" tab button + panel in `renderResults`), `web/wizard.js` (`stepCharacter` — remove the `wz-share-*` controls from the `wz-data` panel, keep master-records export/import; render/wire the share picker + MD/CSV/print handlers in the post-render callback), `web/styles.css`.
- **Approach:** Add a far-right "Share" tab + panel with the loadout select + Markdown/CSV/Print controls (reuse the global `LoadoutExport` and the existing `downloadFile`/`printLoadout`/empty-guard logic from Phase 3). Because the panel is inside `#wz-results`, populate the picker (`renderSharePicker`) and wire the export handlers **in the KTD3 post-render callback**, so they survive every `renderResults` rebuild (solve, load, constraint change) — not once in `wire()`. Remove those controls from the Character step's `wz-data` panel, which keeps only "Export all (.json)" / "Import a backup (.json)". Copy: the Share tab states "share a loadout with others"; the Character export states "manage your own saved builds." `wireResultTabs` enumerates tabs generically, so the new tab needs a button + panel + its wiring, no switch-logic change.
- **Test scenarios:** Covers AE7. The Share tab appears far-right and offers MD/CSV/Print for the selected loadout; the Character step's export panel no longer shows share controls and reads as personal-build management; exporting from the Share tab produces correctly-headed files (existing exporter tests already cover content). Edge: the Share tab with no saved characters shows the empty-guard message.
- **Verification:** `node tests/exporters.test.js` still green; browser pass — export from the Share tab, confirm the Character step is backup-only, and the copy distinguishes the two.

---

## Verification Contract

| Gate | Command / action | Applies to |
|---|---|---|
| JS suites (full loop) | `for t in tests/*.test.js; do node "$t"; done` | U1, U2, U4, U5 |
| Python suite | `python3 tests/run_tests.py` | regression |
| Manual browser pass | `python3 -m http.server 8000` → `http://localhost:8000/web/`; **clear `localStorage`+`sessionStorage` between runs**; assert live DOM | U1–U5 (the real backstop; unit tests miss browser-only + layout behavior) |
| Console clean | on every load and after each interaction, the browser console has no `SyntaxError`/exception (single-global-scope guard) | all |

Bump the shared `?v=` cache-buster in `web/index.html` once on the first UI unit so the browser-smoke gate loads fresh JS.

## Definition of Done

- Loading a saved solved build lands on Results with no wizard steps in between (AE1); load + master-records export remain in the Character step.
- Each equipment block shows its assigned augments with the affixes they add and declares each craft-upgrade slot with its assignment, at uniform block size (AE2–AE4), with no change to `augmentsPlaced`/solver output.
- Adjust & re-solve sits directly under the tab bar on all five tabs and its re-solve works from each (AE5).
- The Alternatives tab shows a Run-analysis button and the solve-style `.wz-ring` spinner while computing, then the alternatives — or a "no alternatives found" / error-with-retry message; the spinner is never left spinning (AE6).
- A far-right Share tab offers Markdown/CSV/print; the Character step's export panel is master-records-only; copy distinguishes sharing from personal management (AE7).
- `python3 tests/run_tests.py` and the full `node tests/*.test.js` loop pass; the browser pass is clean (no console errors) across all five refinements.
