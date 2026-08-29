---
title: "A cancel control over a synchronous compute loop is inert until the loop yields"
module: solver
date: 2026-08-29
problem_type: design_pattern
component: ui
severity: medium
tags:
  - cancellation
  - async
  - event-loop
  - solver
  - overlay
  - opt-in-seams
applies_when:
  - Adding a Stop, Cancel, or Abort control to work that runs on the main thread
  - An `async` function is assumed interruptible because of its keyword rather than its awaits
  - Threading a new option through a hot function that a golden or perf guard pins
  - Deciding what a cancelled run should return, and what status it should carry
related_components:
  - web/solver.js
  - web/wizard.js
---

# A cancel control over a synchronous compute loop is inert until the loop yields

## The rule

**A button cannot be clicked by a thread that is busy.** Before adding a cancel
control, check whether the work it interrupts ever returns to the event loop. If
it does not, the control is the second half of the job; cooperative yield points
are the first, and without them the button renders, looks live, and does nothing.

## What `async` does not tell you

`solveLexicographic` has been declared `async` since it was written, and contains
zero `await`s. Every `highs.solve` in it is synchronous. So the entire staged
solve — set-pin probe, floors machinery, one pass per ranked priority, tie-break,
assembly — is one uninterrupted block on the main thread.

The `async` keyword made it *look* interruptible in every reading of the call site.
It only means the function returns a promise. **Read the awaits, not the keyword**:
a function with no awaits yields nothing, whatever it is declared as.

This also explains a symptom worth recognizing: while such a solve runs, nothing
in the UI can respond — and once it finishes, every queued click lands at once.

## Cancellation is cooperative, and the wording must admit it

A HiGHS call already in flight cannot be preempted from the main thread. So the
honest promise is **"stops after the current pass"**, never "stops now", and the
control says so when pressed ("stopping after the current pass…"). Bounding the
wait is a design choice: one boundary per ranked stage means the worst case a
player waits is the remainder of the pass already running.

Placing the boundaries is the actual design work. They belong where meaningful
work has completed and none is about to be thrown away — here, after the pre-stage
probes, before each ranked pass, and once more before the assembly tail, because
stopping *inside* the tail would discard a solve that is already paid for.

## Make the seam opt-in, and prove the opt-out is free

The natural instinct is to add the yields unconditionally. Don't, when the
function is load-bearing: `solveLexicographic` is pinned by a golden guard, a
wall-clock perf gate, and several other callers (alternatives, the concession
probe). Gating the whole seam on the predicate being supplied means every caller
that does not ask for cancellation runs the identical synchronous program, with
identical timing, and cannot be affected by the change at all.

That shape earns a specific test, and it is the one most worth writing: **omitting
the option leaves the result identical**. It passes on the pre-change tree too —
correctly, because it asserts what must *not* change. That is the deliberate
"nothing changed" guard the repo's prove-it-fails rule exempts, and it should be
labelled as such so a later reader does not mistake it for a test that proves
nothing.

## A cancelled run is its own fact

Do not fold it into an existing failure status. #532 established that collapsing
every non-optimal HiGHS status into `infeasible` told players to go loosen
constraints over failures the constraints never caused. "You stopped this" implies
nothing whatsoever about the build, so it gets its own `status: "abandoned"` and
carries no loadout, no `perTarget`, and no partial report.

And an abandoned run must leave **nothing** behind: no `lastRun`, no auto-snapshot,
no step change, and — easy to miss — no pin invalidation, because that pass reads
`result.chosen` and would read every pin as stale against a result that does not
exist. Clear the latch at the *start* of each run rather than the end, so a stop
can never leak into the next one.
