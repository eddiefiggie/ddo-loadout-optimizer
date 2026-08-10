---
title: A busy indicator must wait for a rendered frame, not a timer — showing it is not painting it
module: web-ui
date: 2026-08-09
problem_type: ui_bug
component: presentation
severity: medium
symptoms:
  - "No waiting indicator appears on a re-solve; the app looks frozen"
  - "The overlay element exists in the DOM with its visible class set, but nothing is drawn"
  - "The indicator appears on the first run and never again"
root_cause: async_timing
resolution_type: code_fix
tags:
  - ddo
  - async
  - microtask
  - requestAnimationFrame
  - repaint
  - user-feedback
  - verification
---

# A busy indicator must wait for a rendered frame, not a timer

## Problem

The solve overlay appeared on the first solve and never on a re-solve, so every
adjust-and-solve-again looked frozen. The overlay was never missing — it was set
on every path, with its own `"re-solving…"` subtitle. It was never *painted*.

## Symptoms

- A player adjusts a priority, hits solve, and sees nothing happen for seconds.
- The overlay element is present in the DOM with its `on` class applied.
- The first solve of a session shows the overlay correctly; every subsequent one
  does not.

## What Didn't Work

**Looking for a missing indicator.** The natural first read is "the re-solve path
forgot to show the spinner." It didn't. `solve()` set the overlay identically on
both paths, and the re-solve path even had its own subtitle. Time spent hunting
for the missing call is time lost — the tell is that the element *is* in the DOM
with the right class while nothing is on screen.

**A `setTimeout(0)` yield — probably fine, but unproven.** The repo already used
that technique for the alternatives-panel spinner, so it was the obvious first
fix. It yields the task queue but promises nothing about *rendering*: the browser
paints on its own schedule, so work that starts before the next frame can block
straight through it. Whether it happened to suffice here was never established —
see the measurement note below.

**Instrumenting the paint from the main thread.** Two in-page probes were built —
a nested-`requestAnimationFrame` check and a frame counter — to observe whether a
frame rendered while the overlay was up. Both reported **zero frames**, before and
after the fix, *including on a run where a screenshot proves the overlay was
visibly on screen*. The probes were starved by the very main-thread block they
were measuring: their callbacks could not run until the synchronous work finished,
by which time the overlay was already down. **A main-thread probe cannot measure a
main-thread block.** The screenshot was the only trustworthy evidence.

That mattered beyond the probe: a code comment had been written claiming the
timer approach was "measured" as insufficient. It hadn't been — the measurement
could not distinguish the two designs at all. The comment was corrected to state
the mechanism rather than a result the evidence did not support.

## Solution

Yield for a *rendered frame* before starting the blocking work, and extract that
yield so it can be tested.

```js
function yieldToPaint() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    } else {
      setTimeout(resolve, 0);   // Node has no frames
    }
  });
}
```

Then, in the solve path, after the overlay is shown and before anything blocking:

```js
overlay(true, "Solving your loadout…", firstRun ? "…" : "re-solving…");
try {
  await yieldToPaint();
  const h = await getHighs();
  // … synchronous MILP
} finally {
  overlay(false); solving = false;
}
```

Two details that are easy to get wrong:

- **The `await` goes inside the `try`.** Outside it, a rejection would skip the
  `finally` and leave the re-entrancy guard stuck on, wedging the UI permanently.
- **One yield at the choke point, not one per caller.** All four re-solve entry
  points already funneled through the same function.

## Why This Works

The bug is a microtask/paint ordering problem, not a missing call.

`solve()` showed the overlay and then awaited the solver module. On the **first**
run that module is loaded asynchronously, so the browser gets a turn and paints.
On **every re-solve** the module is cached, so the `await` resolves as a
**microtask** — and microtasks drain *before* the browser paints — after which the
synchronous solve blocks the main thread. The class was applied; no frame was ever
rendered with it.

That is why the plausible fixes fail in different ways:

| Yield | Resolves on | Guarantees a paint? |
|---|---|---|
| `await Promise.resolve()` / `queueMicrotask` | microtask | **No** — same drain that already runs before paint |
| `setTimeout(fn, 0)` | macrotask | **No** — yields the queue, but the browser paints when it chooses |
| nested `requestAnimationFrame` | after a rendered frame | **Yes** — the second callback runs only once that frame is drawn |

The microtask row is the trap worth remembering: it looks like a fix, reads like a
fix in review, and changes nothing, because it is the same mechanism that caused
the bug.

## Prevention

**Pin the contract in a test, not the implementation.** The yield is exported for
exactly one reason — so a test can fail when it is swapped for a microtask:

```js
let resolved = false;
const p = yieldToPaint().then(() => { resolved = true; });
for (let i = 0; i < 10; i++) await Promise.resolve();   // drain the microtask queue
assert.strictEqual(resolved, false,
  "resolved on the microtask queue — microtasks drain BEFORE paint");
await p;
```

Ten microtask turns flush any promise-based implementation many times over; a
frame-based yield survives them all. Verify the guard discriminates by temporarily
swapping in `queueMicrotask` and confirming *only* that scenario fails — if the
others fail too, the test is brittle rather than precise.

**Put async contract tests in a file with an awaiting harness.** `tests/wizard.test.js`
calls each test synchronously and prints its pass count at module top level, so an
async test there runs its assertions after the summary and has its failures
swallowed. See
[python-tests-must-be-top-level-functions](../developer-experience/python-tests-must-be-top-level-functions.md)
for the same silent-zero shape on the Python side.

**Verify a paint with a screenshot, not with page instrumentation.** Anything you
schedule on the main thread is subject to the block you are trying to observe. The
repo's standing practice of checking real behavior in a browser
([browser-verify-against-real-data-not-just-unit-tests](../developer-experience/browser-verify-against-real-data-not-just-unit-tests.md))
is the reliable path here; a unit test can pin the yield contract but can never
show that anything was drawn.

**Suspect this shape whenever a spinner is inconsistent between the first run and
later ones.** That asymmetry usually means the first run had an incidental async
gap — a lazy load, a fetch, a module init — that later runs no longer have.
