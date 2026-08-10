---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
title: Solve Overlay Repaint on Re-solve - Plan
type: fix
date: 2026-08-09
---

# Solve Overlay Repaint on Re-solve - Plan

## Goal Capsule

**Objective.** Make the "Solving your loadout…" overlay actually appear when the
player re-solves. Today it appears only on the first solve; every re-solve runs
with no visible feedback, so the app looks frozen and the player thinks nothing
happened.

**Product authority.** User report, this session. Root cause diagnosed against the
tree before planning; see Problem Frame.

**Stop conditions.** Stop and surface rather than guessing if: the overlay still
does not paint after the yield (the diagnosis would be wrong, not the fix); or
making it paint requires touching anything beyond the single solve entry point.

**Tail.** Standard repo flow — branch, PR, squash-merge. `main` deploys on push,
so a red build blocks the site.

## Product Contract

### Summary

Yield to the browser once, after showing the overlay and before the synchronous
solve, at the one function every re-solve path already funnels through.

### Problem Frame

`web/wizard.js` `solve()` already sets the overlay on every path, including a
distinct `"re-solving…"` subtitle. The overlay is never the problem — the paint
is.

`solve()` turns the overlay on, then does `await getHighs()`:

- **First solve:** loading the HiGHS WASM module is genuinely async, so the browser
  gets a turn and paints the overlay. It appears.
- **Every re-solve:** `getHighs()` returns the cached module (`if (highs) return
  highs;`), so the `await` resolves as a **microtask**. Microtasks drain before the
  browser paints, and the synchronous MILP then blocks the main thread. The overlay
  sits in the DOM with its `on` class set and is never rendered.

All four re-solve entry points call the same `solve(false)`, so one change covers
every path the player can reach.

The repo already solved this once: `web/results.js` defers the alternatives-panel
spinner with a `setTimeout` and says so in a comment — *"Defer so the spinner
paints before the synchronous re-solves run."* The main solve path never got the
same treatment.

### Requirements

R1. The overlay is visible on every re-solve, not only the first solve.

R2. The yield is a **macrotask**, not a microtask. A microtask yield
(`await Promise.resolve()`, `queueMicrotask`) looks like a fix and changes nothing,
because microtasks drain before paint — this is the exact trap that produced the
bug.

R3. The overlay shows immediately on every re-solve, with no delay threshold and no
minimum display time.

R4. The yield point is exported and testable in Node, so a regression is caught
without a browser.

R5. Solve results, timing, and error handling are unchanged — this adds a yield,
not a behavior change.

### Scope Boundaries

**In:** the wizard's `solve()` and a small exported yield helper.

**Out:**
- The alternatives panel (`web/results.js`) — already defers correctly.
- The first-run overlay — already paints, and must keep its distinct subtitle.
- Any change to solver logic, query building, or results rendering.

### Success Criteria

1. Running a solve, going back, changing a priority, and solving again shows the
   overlay with the `"re-solving…"` subtitle.
2. The first-run overlay still shows its item-count subtitle.
3. A Node test fails if the yield is replaced with a microtask.
4. Both suites stay green; no golden diff.

## Planning Contract

### Key Technical Decisions

**KTD1 — Always show the overlay on re-solve; no delay threshold, no minimum
display time.** (session-settled: user-directed — chosen over a delayed show and
over a minimum-display floor: guaranteed feedback was the stated requirement, and a
threshold turns a fast re-solve into a blink, which reads worse than either
extreme.)

**KTD2 — Yield with a macrotask.** `setTimeout` (or an equivalent macrotask) is the
mechanism; a promise/microtask yield is not, and R2 exists to pin that. This
mirrors `web/results.js`, which uses the same technique for the same reason.

**KTD3 — Extract the yield as an exported helper rather than inlining it.**
(session-settled: user-directed — chosen over browser-only verification: it buys a
regression guard that catches the microtask mistake, at the cost of one small
exported function.) `solve()` lives inside the browser-only block and is not
exportable; the helper goes to module scope alongside the other pure helpers, where
the existing Node export list already lives.

**KTD4 — Fix at `solve()`, not at the four call sites.** Every re-solve path
already funnels through it, so one yield covers all of them and no call site needs
to know about paint timing.

### Assumptions

- A single macrotask turn is enough for the browser to paint the overlay. This is
  what `web/results.js` relies on today and it works there. If the browser pass
  shows it is not sufficient, that is a stop condition, not a tuning exercise.

## Implementation Units

### U1. Exported yield-to-paint helper

**Goal.** A small module-scope helper that resolves on a macrotask, so a caller can
`await` it to let the browser paint.

**Requirements.** R2, R4, KTD2, KTD3.

**Dependencies.** None.

**Files.**
- `web/wizard.js` (add at module scope; add to the Node export list)
- `tests/wizard.test.js`

**Approach.** Place it with the other pure helpers above the export block, not
inside the browser flow — that block is guarded on `window` and is unreachable from
Node. Return a promise that resolves on a macrotask. Keep it dependency-free and
free of DOM access so it stays testable.

**Execution note.** Write the microtask-rejection test first and watch it fail
against a microtask implementation. That test is the entire point of the seam; if
it cannot distinguish the two, the seam is not worth having.

**Patterns to follow.** The existing module-scope helper + export-list convention in
`web/wizard.js`; the deferral rationale comment in `web/results.js`.

**Test scenarios.**
- The callback/promise does **not** resolve synchronously — code after the call
  runs first.
- It has **not** resolved after a microtask tick (`await Promise.resolve()`), which
  is what fails if someone swaps in `queueMicrotask`. Covers R2.
- It **has** resolved after a macrotask turn.
- Resolving is not contingent on any DOM or browser global, so the helper works
  under Node.

**Verification.** `node tests/wizard.test.js` passes, and swapping the
implementation to a microtask makes the second scenario fail.

### U2. Yield before the synchronous solve

**Goal.** `solve()` lets the browser paint the overlay before doing any heavy work.

**Requirements.** R1, R3, R5, KTD1, KTD4.

**Dependencies.** U1.

**Files.**
- `web/wizard.js`

**Approach.** After the overlay is turned on and before the first blocking work,
await the U1 helper. Leave the overlay call, the first-run vs re-solve subtitles,
the `solving` re-entrancy guard, and the `finally` teardown exactly as they are —
this inserts a yield, it does not restructure the function.

**Patterns to follow.** `web/results.js` — same placement relative to the spinner
and the synchronous work.

**Test scenarios.** This unit is feature-bearing but has no direct unit seam:
`solve()` is closure-scoped and its effect is a browser paint. Its proof is split —
U1 pins the macrotask contract in Node, U3 confirms the paint in a browser. Do not
read the absence of scenarios here as "no test needed"; both halves are required.

**Verification.** The existing suites stay green, and the `solving` guard still
prevents a double solve.

### U3. Browser verification and build stamp

**Goal.** Confirm the overlay actually paints on a real re-solve, and ship the
change under the repo's cache-busting convention.

**Requirements.** R1, R3, and success criteria 1-2.

**Dependencies.** U2.

**Files.**
- `web/index.html` (`?v=` bump)
- `web/app.js` (`BUILD` stamp)

**Approach.** Serve locally, run a solve, go back and change a priority, solve
again, and confirm the overlay appears with the `"re-solving…"` subtitle. Confirm
the first-run overlay still shows its item-count subtitle. Bump `?v=` and `BUILD`
together — required whenever `web/` ships.

**Execution note.** This is the only proof that the fix works; U1 proves the yield
is a macrotask, not that the browser paints. Do not mark the work done on the unit
tests alone.

**Test scenarios.** `Test expectation: none — verification is a browser observation
plus a cache-bust bump; neither is unit-testable.`

**Verification.** The overlay is visible on a re-solve in the browser, and the
footer build stamp matches the bumped value.

## Verification Contract

```
python3 tests/run_tests.py                     # Python suite
for t in tests/*.test.js; do node "$t"; done   # JS suite — one file per invocation
python3 -m http.server 8000                    # then open http://localhost:8000/web/
```

Run the JS tests **file by file**. `node a.js b.js` executes only the first, which
has silently skipped the golden solver check before.

Gates:
- Both suites green; no golden diff (this changes no solver output).
- The microtask-rejection scenario in `tests/wizard.test.js` passes.
- Browser: overlay visible on a re-solve; first-run overlay unchanged.

## Definition of Done

- All four success criteria hold.
- Both suites green, run per the Verification Contract.
- The overlay was observed painting on a real re-solve, not inferred from the tests.
- `?v=` and the footer `BUILD` are bumped, since `web/` ships.
- No dead-end or experimental code from approaches that did not pan out remains in
  the diff.
