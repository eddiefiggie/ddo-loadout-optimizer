---
title: Priorities Drag Autoscroll - Plan
type: feat
date: 2026-09-14
execution: code
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
---

# Priorities Drag Autoscroll - Plan

**Issue:** #744, step 3. **Base:** `main` at `09142026.2`, clean and green.

---

## Goal Capsule

Make a long priorities list draggable without fighting the window edge.

The reporter, verbatim: *"Dragging can be a bit finicky, as it needs to be at the
very edge of the window to scroll up/down, and mousewheel scroll doesn't work
while dragging."*

---

## Is it still warranted after step 2?

#744 says steps 1 and 2 "reduce how often anyone needs to drag at all", and both
have now shipped — so this was re-measured rather than assumed. Twelve
priorities, 1200x900 viewport, on `main` at `09142026.2`:

| | |
|---|---|
| rows | 13 (12 ranked + the pinned Utility tier) |
| row height | 52px (was 94px before step 2) |
| list height | 786px |
| first row top | y=486 |
| last row bottom | y=1272 |
| **off-screen** | **372px** |

So yes. Step 2 halved the row height and the list still runs off the bottom,
because the bundles grid above it pushes the list start to y=486. Dragging rank
12 to rank 4 still crosses a scroll boundary.

**But the remaining case is narrower than the issue's, and that is worth saying.**
Step 1 shipped ⤒/⤓, so "twelfth to the top" — the reporter's own example — is now
one click and needs no drag at all. What is left for dragging is *mid-range*
moves (rank 11 to rank 4), which the jump buttons do not cover and which ↑/↓
would take seven clicks.

## The one measurement that decides the implementation

**There is no scrollable ancestor.** Walking up from `#wz-ranked`, no element has
an overflowing `overflow-y` — `scrollAncestors: []`. The **document** scrolls
(`scrollHeight` 2219 vs `clientHeight` 900), with `html { overflow-y: visible }`
and `body { overflow-y: auto }`.

So autoscroll drives `window.scrollBy`, not some container's `scrollTop`. A
container-based implementation — the thing you would write by default — would
silently do nothing here.

---

## Design, and why NOT the pointer-events rewrite

#744 proposes replacing native HTML5 DnD with a pointer-events implementation,
calling it "the standard fix". That is a large change: a new drag model, plus
touch, plus keyboard, plus re-earning the drag guard (KTD6) and the shared
`movePriority` primitive, on the single most-used surface in the app.

**A far smaller change fixes the reported complaint.** Native DnD fires
`dragover` continuously during a drag, carrying `clientY`. Scrolling the window
from that handler gives a generous edge zone while the drag model, the guards,
the touch/keyboard fallback and every existing test stay exactly as they are.

What that does and does not buy, stated plainly:

- **Fixes** "needs to be at the very edge of the window": the zone becomes a
  configurable band (96px) instead of the browser's own few pixels, with speed
  proportional to depth into it.
- **Does NOT restore the mousewheel.** Wheel events remain swallowed by the
  browser during a native drag; that half of the report is inherent to the drag
  model and only the rewrite removes it. Working autoscroll largely subsumes the
  need, and if it does not, the rewrite stays available — this change does not
  block it.

**`dragover` alone is not enough, and this is the trap.** It fires while the
pointer *moves*; hold still inside the edge zone and it stops firing, so the
scrolling stops — which is precisely the gesture a player makes when waiting for
a long list to come round. So the handler sets a *velocity* and a
`requestAnimationFrame` loop does the scrolling, continuing while the pointer is
stationary and stopping on leave or drop.

---

## Units

**U1 — the autoscroll controller.** Created once in the wizard closure, not per
render: `renderRankedList` rebuilds on every reorder, and a controller built
inside it would leak a document listener per rebuild. `start()` attaches the
document `dragover` listener, `stop()` removes it and cancels the frame.

It does **not** `preventDefault` on the document listener. It only needs
`clientY`; calling preventDefault there would declare the whole document a valid
drop target and change drop semantics for a bug that is about scrolling.

**U2 — wire it to the existing drag.** `start()` on `dragstart` (after the
existing guard has decided this really is a row drag), `stop()` on `dragend`.

**TRAP:** `stop()` must be unconditional and idempotent. A drag that ends outside
the window, an escape-key cancel, or a rerender mid-drag must not leave the rAF
loop running — a loop that survives the drag scrolls the page under the player
with no drag in progress, which is worse than the bug being fixed.

---

## Verification

- Both suites; new tests proven to fail against the pre-change tree; each new
  guard corrupted and confirmed red.
- Browser: the velocity curve and the rAF loop are driven with synthetic
  `dragover` events at known `clientY` values and the window scroll offset is
  read back — this tests *our* handler, including the stationary-pointer case.

**Honest limit, to be stated in the PR rather than papered over:** synthesizing a
faithful *native* drag in headless Chromium needs CDP input injection, which this
harness does not do. That the browser fires `dragover` during a native drag is
relied on from the HTML spec, not observed here. The handler's own behaviour is
observed.

**Stamp.** Player-facing: all three, resolved FORWARD.

---

## Scope Boundaries

- **The pointer-events rewrite** is not done here, and the mousewheel half of the
  report stays open with it. #744 keeps both.
- **Multi-column** remains deferred, per the issue.
