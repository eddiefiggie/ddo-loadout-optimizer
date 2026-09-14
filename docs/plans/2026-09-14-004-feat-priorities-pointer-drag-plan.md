---
title: Priorities Pointer Drag - Plan
type: feat
date: 2026-09-14
execution: code
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
---

# Priorities Pointer Drag - Plan

**Issue:** #744, the remaining half. **Base:** #759's branch at `09142026.3`;
re-based onto `main` before first push once #759 squash-merges.

---

## Goal Capsule

Close #744: make the mousewheel work while dragging a priority row, and make
dragging work on touch.

Both are the same change. Step 3 (#759) fixed edge-hunting inside the native
HTML5 drag model; the mousewheel half cannot be fixed inside it, because a native
drag session is the browser's own input loop and it does not deliver wheel
events to the page. The only path is to stop using a native drag session, which
is what #744 itself proposed and what the earlier plan deferred until autoscroll
had been tried first. It has; this is the other half.

---

## Problem Frame

> mousewheel scroll doesn't work while dragging.

Verified as inherent rather than as a bug in this code: the HTML DnD model
suspends ordinary pointer and wheel dispatch for the life of the drag. #759's
autoscroll subsumes most of the need, but a player who reaches for the wheel gets
nothing, with no signal why — and on touch, `draggable="true"` gives no drag at
all. The help text already tells touch and keyboard users to use the ⤒ ↑ ↓ ⤓
buttons, which is the fallback, not the fix.

---

## Design

Pointer events replace the native drag. `pointerdown` on the **grip only**,
`setPointerCapture`, `pointermove` tracks, `pointerup` drops. Mouse, touch and
pen arrive through one API, and because there is no drag session the wheel
keeps working and so does everything else on the page.

### Grip-only, by construction — and this is the load-bearing choice

The native drag made the whole `<li>` the drag source, which is why the KTD6
guard exists: a click on the badge, the panel prose, the toggle, an input or a
select would otherwise start a reorder, and each of those was a real defect.
With a pointer drag the source is the `.wz-grip` and nothing else, so **that
whole class of bug is impossible rather than guarded against.** The tests that
pinned the guard are re-ratified to pin the construction instead.

It is also what makes touch sane: `touch-action: none` on the grip alone means a
finger on the grip drags, and a finger anywhere else on the row scrolls the page
as it always did. Putting it on the row would kill page scrolling over the list.

The pinned Utility row's grip (`.wz-grip-pinned`) is excluded; it was never
draggable and #348 says why.

### The drop target

`document.elementFromPoint(x, y)` → closest `li[data-i]` inside this list. The
dragged row sits under the pointer, so `.dragging` gets `pointer-events: none`;
capture delivers its events to the captured grip regardless of hit-testing, so
the dragged row keeps receiving `pointermove` while hit-testing sees the row
beneath. Then `movePriority(from, to)` on drop — the **same primitive** the
buttons and the old drop handler call, so the "one rule" invariant from step 1
survives untouched, including the clamp above the Utility row.

A native drag drew a ghost image; a pointer drag draws nothing, so the target row
gets a **drop indicator** (`.wz-drop-before` / `.wz-drop-after`, a 2px accent
line on the top or bottom edge, by whether the pointer is in the row's upper or
lower half). Without it the gesture has no visible destination.

### Threshold, cancel, and the three ways a drag ends

- A 4px movement **threshold** before the drag arms, so a tap on the grip is a
  tap, not a zero-distance reorder.
- **Escape cancels** — parity with the native drag. The browse overlay also
  listens for Escape on the document; it does not stop propagation and cannot be
  open mid-drag, so the two coexist.
- Ends: `pointerup` (drop), `pointercancel` (the browser took the pointer — a
  touch that became a system gesture), and **`lostpointercapture`**, which fires
  when the captured grip is removed from the DOM. That third one is the
  `rerender()`-mid-drag case that made #759 need two stops, handled at the
  source this time: the list rebuild releases capture, capture-loss ends the
  drag. One `endDrag()` on every path, idempotent.

### Autoscroll keeps its loop, loses its listener

`dragAutoScroll` becomes `start()` / `update(clientY)` / `stop()`. The document
`dragover` listener goes with the native drag; `pointermove` feeds `update`. The
velocity-plus-frame-loop shape from #759 is kept and matters even more here:
`pointermove` also stops firing for a stationary pointer.

**Wheel during a drag changes what is under the pointer without a `pointermove`.**
The drop indicator must follow, so a `scroll` listener (window, passive) re-runs
the target computation from the last pointer position for the life of the drag.

---

## Units

**U1 — `dragAutoScroll` API.** `update(clientY)` replaces the listener.
**U2 — the pointer drag** in `renderRankedList`, replacing the four native handlers.
**U3 — CSS.** `touch-action: none` and `cursor: grab/grabbing` on the grip,
`pointer-events: none` on `.dragging`, the two indicator classes.
**U4 — markup.** `draggable="true"` off the row; the grip gets
`aria-hidden="true"`, matching the pinned grip. It is a pointer affordance and
nothing else — a `role="button"` with no keyboard path would be a lie to
assistive tech. Keyboard reordering stays on the ⤒ ↑ ↓ ⤓ buttons, which the help
text already names as the touch-and-keyboard path.
**U5 — tests.** Five existing tests pin `li.ondragstart` / `dragover` and are
re-ratified, not deleted — each invariant restated against the new construction.

**TRAP:** `setPointerCapture` throws `InvalidStateError` for a pointer that is not
active, which includes every synthetic `PointerEvent` a test dispatches and some
real edge cases (a pointer released between `pointerdown` and the call). Wrap it;
a drag that cannot capture still works for a mouse (moves arrive by bubbling
while the pointer stays over the list), and it must never throw into the
priorities step.

---

## Verification

- Both suites; new and re-ratified tests proven to fail against the pre-change
  tree; each guard corrupted and confirmed red.
- Browser, real app: synthetic `PointerEvent`s are faithful here in a way
  `DragEvent`s were not — dispatch `pointerdown` on a grip, `pointermove` past
  the threshold, over another row, `pointerup`; assert the reorder happened via
  `movePriority`'s result, the indicator appeared on the right edge, a tap below
  the threshold did NOT reorder, Escape cancelled, and a `wheel`-driven scroll
  mid-drag moved the indicator. Autoscroll loop under the rAF shim, as in #759.

**Stamp.** `09142026.3` → `.4`, resolved FORWARD.

---

## Scope Boundaries

- **Keyboard drag** is not added; the ⤒ ↑ ↓ ⤓ buttons are the keyboard path and
  are unchanged.
- **Multi-column** stays deferred per the issue.
- **#745 (priority groups)** is next and touches this same renderer; it waits for
  this to land rather than racing it.
