---
title: "A paint yield awaited on requestAnimationFrame never resolves in a hidden tab"
module: wizard
date: 2026-08-29
problem_type: design_pattern
component: ui
severity: high
tags:
  - requestAnimationFrame
  - async
  - hidden-tab
  - overlay
  - solve-path
  - liveness
applies_when:
  - An `await` sits on a promise that only a requestAnimationFrame callback resolves
  - A spinner, overlay, or busy state is raised before an await and cleared in the `finally` after it
  - Deferring work "until the browser has painted" so a blocking computation does not hide its own spinner
  - Diagnosing a hang where the UI is stuck but the main thread is idle and responsive
  - Reviewing any rAF use whose callback does something other than draw a frame
related_components:
  - web/wizard.js
  - web/results.js
---

# A paint yield awaited on `requestAnimationFrame` never resolves in a hidden tab

## The rule

**A frame is a preference, never a precondition.** Any `await` whose only path to
resolution runs through `requestAnimationFrame` must also have a path that does
not — a `visibilityState` short-circuit, a fallback timer, or both. Browsers stop
delivering rAF to a hidden, minimized, or occluded tab, and a promise that only a
frame can settle simply never settles there.

## What it cost

`yieldToPaint()` was added under #218 for a good reason: HiGHS runs synchronously
on the main thread, so a solve that starts before the next frame blocks straight
through it and the "Solving your loadout…" overlay never renders. Nested frames
are the real guarantee that a paint has happened, and a bare `setTimeout(0)` is
not — `tests/wizard-yield.test.js` exists specifically to fail if someone
substitutes a microtask.

All of that is correct, and it was awaited unconditionally:

```js
if (typeof requestAnimationFrame === "function") {
  requestAnimationFrame(() => requestAnimationFrame(resolve));   // #578: may never fire
}
```

`solve()` raises the overlay, then awaits this. `overlay(false)` lives in the
`finally` on the far side. In a backgrounded tab the await never returns, so the
player gets an unbounded spinner with **no cancel control and no explanation** —
and the only exit is a page reload.

## The signature that misleads

This hang does not look like a hang. It looks like a slow solver:

- the overlay is up, so the app is visibly "working";
- the main thread is **idle, not busy** — console JS evaluates normally, which
  reads as "the solver is off in its worker" when in fact nothing is running;
- HiGHS is never instantiated at all, so no profiler or solver log shows anything;
- it is perfectly reproducible while the tab stays hidden, and perfectly
  unreproducible the moment anyone brings the tab forward to watch it.

That last property is what makes it expensive. #578 was filed as a **solver**
defect specific to ranking a stat with no reachable source, with a careful A/B:
`Melee Power` alone solved, `Sneak Attack Bonus` alone did not. The A/B was real
and the conclusion was wrong. `Melee Power` alone hangs identically in a hidden
tab, and the ranking that "never returns" completes in ~1.1 s once frames are
delivered. The stat was a coincidence of which run happened to be backgrounded;
four other causes were ruled out on the way, each correctly, and none of them was
it.

**When a UI is stuck, measure whether the main thread is busy before assuming the
work is slow.** An idle thread behind a live spinner means nothing is running —
which points at liveness, not at cost.

## The knowledge already existed one file away

`animateCounters` in `web/results.js` carries this exact warning, and a safety
net for it:

> rAF pauses entirely in a backgrounded/throttled tab and can fire once then
> stall, freezing the counter at a wrong intermediate value. setTimeout still
> fires there, so force the final value shortly after the animation window.

It guards a **cosmetic count-up**. The solve gate, where the cost is the entire
result rather than an animation, had no equivalent. The lesson had been learned
and written down in the low-stakes place and not applied in the high-stakes one.
When a hazard note is written for one rAF call site, sweep the others.

## The shape of the fix

Skip the frames outright when the tab already reports itself hidden — there is no
paint to wait for, so waiting is pure loss — and otherwise race the frames against
a generous timer so a stall degrades to "proceed without the paint guarantee"
instead of "never proceed". Latch the resolution so whichever arrives first wins
exactly once.

The fallback window is deliberately far larger than a frame (2 s against ~33 ms at
60 Hz), because it must never pre-empt a genuinely slow paint on the ordinary
path. It only ever fires when frames stop arriving to a tab that still calls
itself visible.

## Testing it

The defect's signature is *never resolves*, so a test that simply awaits the
promise **hangs the suite instead of failing it** — and a hung suite reads as a
stuck machine, not as a red test. Race every scenario against a deadline and
assert on the winner.

Read the fallback constant through a literal default (`PAINT_STALL_FALLBACK_MS ||
2000`) so the file still runs against a tree that predates it. Without that, the
new scenarios fail on an undefined deadline rather than on the behaviour, and the
"still prefers real frames" guard — which must pass on **both** trees, because it
pins #218 rather than the fix — would fail on the old one and prove nothing.
