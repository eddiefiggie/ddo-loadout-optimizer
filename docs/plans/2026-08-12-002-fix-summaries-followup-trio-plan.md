---
title: Summaries Follow-Up Trio - Plan
type: fix
date: 2026-08-12
topic: close out the gear-box summaries feature — issues 276, 277, 278
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Summaries Follow-Up Trio - Plan

## Goal Capsule

- Objective: close the three follow-ups the gear-box summaries release created or surfaced — touch-reachable ceiling explanations (#277), the degenerate-save blank screen (#278), and at-ceiling coloring on the Ranked Priorities receipts (#276) — in one small PR.
- Product authority: the maintainer ("run the batch", 2026-08-12); the fix shapes come from the filed issues.
- Open blockers: none.
- Execution profile: browser-only (`web/results.js`, `web/styles.css` + ship stamps). No projection wording change, no export change, no solver change.
- Stop conditions: stop if #278's guard cannot keep exports safe without touching `projection.project` (it is already guarded there — verify, don't assume), or if the disclosure element breaks the existing notice layout.
- Tail ownership: this plan does not own the commit, PR, or deploy.

---

## Product Contract

### Summary

The ceiling explanations become reachable without a pointer: the compact "N priorities at ceiling" line turns into a tap/keyboard-openable disclosure that reveals the full shared sentences as visible text (hover `title=` stays as the fast path). A saved character whose snapshot predates the current format renders a plain notice instead of a blank screen. The Ranked Priorities receipt cards mark an at-ceiling stat with the same green fact the gear boxes carry.

### Requirements

- R1 (#277). The compact ceiling notice is a disclosure the player can open by tap or keyboard; opening it shows the full "reaches you as … all filled" sentences as visible text, one per stat. The collapsed line keeps today's compact wording and its tooltip.
- R2 (#278). Rendering a result whose snapshot lacks `effective` (and friends) does not throw; the results area renders what it can plus a factual notice that the save predates the current format and a re-solve restores the analysis. Exports stay safe (already guarded in `projection.project` — verified, not changed).
- R3 (#276). A ranked-priority receipt card whose stat is at its ceiling shows a green "at ceiling" marker carrying the full shared sentence as its tooltip, derived from the same `saturatedStats`/`saturationLineFor` helpers.
- R4. No wording change to `saturationNoticeLines`; exporters and their tests untouched.

### Scope Boundaries

- Per-span `<details>` on individual gear-box contributions is out — the notice disclosure carries the full sentences for non-pointer users; spans keep `title=`.
- No migration or repair of degenerate saves; #278 is render-soft-fail only.
- No solver or dataset change; golden must not move.

---

## Planning Contract

### Key Technical Decisions

- KTD1 — #277 uses the codebase's own answer: the solve-banner's `<details>`/`<summary>` pattern (results.js `.solve-explain`), applied to the saturation notice. Sentences render inside the open state from `saturationNoticeLines` — same source, now visible text, satisfying touch/keyboard without a second wording.
- KTD2 — #278 guards at the read sites in `buildViews`/`renderResults` (`build.effective || {}`), plus a `staleSnapshotNotice` in the notice family shown when an optimal result lacks `effective`. Facts only: what is unavailable and that a re-solve restores it — no claim about why the save is degenerate.
- KTD3 — #276 marks the receipt card via a small chip in the `.stat-cap` idiom (`at ceiling`, green, sentence on `title`), from `saturatedStats`/`saturationLineFor`. Extract the chip as a pure exported helper so it is testable without DOM.

## Implementation Units

### U1. Degenerate-save soft fail (#278)

**Files:** `web/results.js`, `tests/results.test.js`.
**Approach:** per KTD2. Test scenarios: buildViews-with-missing-`effective` fixture does not throw and renders zeroed cards; the notice appears exactly when `status==="optimal"` and `effective` is absent; a normal result renders no notice. Execution note: red-first.
**Verification:** loading the stale "Sook" save on localhost renders the notice, not a blank screen.

### U2. Ceiling disclosure (#277)

**Files:** `web/results.js` (`saturationNotice`), `web/styles.css`, `tests/results.test.js`.
**Approach:** per KTD1. Test scenarios: collapsed summary keeps the compact wording + no-cause assertion; the details body contains the full sentences as visible text; empty report renders nothing. Execution note: red-first; browser-verify tap-open.

### U3. Receipt-card ceiling marker (#276)

**Files:** `web/results.js` (`buildViews` cards + new helper), `web/styles.css`, `tests/results.test.js`.
**Approach:** per KTD3. Test scenarios: helper returns the chip with green class + sentence title for a saturated stat, empty string otherwise; chip absent when no report. Execution note: red-first.

### U4. Ship gate

**Files:** `web/index.html` (`?v=116`), `web/app.js` (`BUILD 08122026.6`), `README.md`.
**Approach:** stamps together; full Python + per-file JS sweep (golden and exporter tests unchanged); browser pass covering all three fixes; code review; PR body carries `Closes #276`, `Closes #277`, `Closes #278`.

## Verification Contract

- `python3 tests/run_tests.py`; `for t in tests/*.test.js; do node "$t"; done` — every file separately; `solver_golden` and `exporters` tests unchanged.
- New tests observed red before implementation.
- Browser pass: disclosure opens by click/keyboard; stale save renders the notice; receipt chip shows green with tooltip.

## Definition of Done

- R1–R4 hold; all gates green; stamps bumped together; PR closes #276/#277/#278 with keywords; no dead code.
