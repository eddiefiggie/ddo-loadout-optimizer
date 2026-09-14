---
title: Priorities Row Grid Layout - Plan
type: feat
date: 2026-09-14
execution: code
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
---

# Priorities Row Grid Layout - Plan

**Issue:** #744, step 2. **Base:** `main` at `09122026.3`, clean and green.

---

## Goal Capsule

Show more of the priorities list at once, so reordering it is practical.

Two independent blockers, both named in #744 and both re-verified against the
tree: the list is hard-capped at one 34rem column, and every magnitude row spends
a second full-width line on a collapsed `Advanced` summary that is one word long.

No solve changes. No priority semantics change. This is layout.

---

## Problem Frame

A player with twelve priorities cannot see twelve priorities. They see about
six, because each magnitude row is two lines tall and the column is capped at
34rem no matter how wide the window is. Reordering — the entire job of this step,
and the thing that *is* the objective the solver optimizes — is done through a
viewport that shows half the list.

The reporter asked for "some way to see more of the list at once to make
reordering easier", and suggested multiple columns or moving the Advanced button
onto the effect-name line.

---

## Evidence: the obvious fix was already tried, and `display: contents` fails too

`web/styles.css:1135-1149` records the first attempt and why it was reverted:
`.wz-ranked li` is a flex container, so an auto-width `<details>` sizes to its
collapsed summary and renders the open panel as a ~5rem column of wrapped text.
`flex-basis: 100%` drops it to its own line; `order: 1` keeps it from pushing the
reorder buttons onto a *third* line. Deleting either regresses the row.

So the panel must be split: an inline summary on the row, and a panel body
positioned separately. The textbook way to do that without touching markup is
`display: contents` on the `<details>`, promoting its summary and body to grid
items of the row. **Probed in Chromium 1194 before committing to it. It does not
work, in two separate ways:**

| probe | result |
|---|---|
| `details { display: contents }`, closed | panel body computes `display: block` and renders — the UA's own closed-state hiding is lost with the element's box |
| add `details:not([open]) > .body { display: none }` | closed state fixed, toggle and marker survive |
| body given `grid-column: 1 / -1` | **still 99px wide in a 582px row** — it does not span |

The third is the disqualifying one. The computed style reports
`grid-column-start: 1 / grid-column-end: -1`, and the grid resolves to exactly
5 columns — yet the body's used width equals the *last* column. Chrome renders
`<details>` children through a UA shadow tree, and the body does not participate
in the parent grid's column spanning regardless of what is declared on it.

That is browser-internal behavior with no spec guarantee either way, which is
precisely the class of fragility the existing CSS comment exists to warn about.
**So the panel gets a real split**, as #744 predicted: an explicit disclosure
button on the row, and a sibling panel element that is a true grid item.

---

## Design

`.wz-ranked li` becomes a CSS grid:

```
grid-template-columns: auto auto 1fr auto auto;

row 1:  grip | rank | name .......... | Advanced ▸ | ⤒ ↑ ↓ ⤓ ✕
row 2:  panel body, spanning 1 / -1, present only when open
```

`<details class="wz-adv">` / `<summary>` become:

- `<button class="wz-adv-toggle" aria-expanded aria-controls>` — column 4, row 1
- `<div class="wz-adv-panel" hidden>` — `grid-column: 1 / -1`, row 2

The open set (`openPanels`, `openPanelToggle`, `openPanelSweep`,
`openPanelClear`) is **unchanged**. It keys on stat names, not on DOM type, so it
carries panel state across the `innerHTML` rebuild exactly as before. Only
`panelOpenAttr` changes shape, because it is the one function that emits the
literal ` open` attribute.

`.wz-ranked`'s `max-width` lifts from `34rem` to `min(100%, 60rem)` — wide
enough to show the list, still bounded so a maximized window does not stretch a
row of five controls across 2000px.

**Multi-column is deliberately not built.** #744 defers it past this step, and
the reasoning holds: reordering across columns is a worse drag target than a
taller single column, and reclaiming a line per row plus lifting the cap may be
enough on its own. Revisit with the reporter's next message, not speculatively.

---

## Units

**U1 — `panelOpenAttr` emits the button/panel pair's state.**
Returns the attributes for both halves rather than ` open`. Its test at
`tests/wizard.test.js:2127-2135` is re-ratified, not deleted: the invariant
(only the opened stat is open; the markup renders what the function returns) is
unchanged and still asserted.

**U2 — `advancedHTML` and the Utility container panel emit button + div.**
Both currently emit `<details>`. `advSummaryHTML` is untouched — it produces the
summary's inner HTML and that is still exactly what the toggle's label needs.

**U3 — rewire toggle, focus, badge refresh, and the reachability fill.**
- `d.ontoggle` → an explicit `onclick` on `.wz-adv-toggle` that flips `hidden`
  and `aria-expanded`, calls `openPanelToggle`, and calls `fillReachability` on
  open. Same two call sites, same order.
- `fillReachability`'s selector `details.wz-adv[open] .wz-adv-reach-slot` →
  the open-panel equivalent.
- `focusSummary` focuses the toggle button.
- `refreshBadge` patches the toggle's label.

**TRAP, and the reason U3 is its own unit:** `renderRankedList` binds
`ol.querySelectorAll("button").forEach((b) => b.onclick = ...)`, a generic
handler that calls `markDirty()` on every button in the list. Making the toggle a
`<button>` puts it inside that net — opening a panel to *read* a disclosure would
mark the build dirty and fall through the dispatch chain. The toggle must be
excluded explicitly, and a test must pin that, because nothing else would catch
it: the panel would still open.

**U4 — the drag guard.**
`li.ondragstart` refuses a drag that starts inside the panel via
`closest("details.wz-adv")`. That selector stops matching. KTD6 exists because a
click on the count badge (SPAN) or the relocated prose (P) would otherwise start
a row reorder, so this is load-bearing, not incidental.

**U5 — the grid CSS and the `max-width` lift.**
Including re-ratifying the `R1/R2` test at `tests/wizard.test.js:2228-2234`,
which pins `order: 1` and `flex-basis: 100%` — the two declarations this change
removes. It is replaced by a test pinning the grid placement, so the row's
line count stays asserted rather than becoming unguarded.

---

## Verification

Per `AGENTS.md`, a new test must be proven to fail against the pre-change tree,
and a browser check is required because a unit suite cannot see a layout.

- Full JS suite via `scripts/run_js_tests.sh`, full Python suite.
- New tests exported to a scratch copy of the base commit and run there; anything
  that still passes is covering nothing.
- Chromium: a magnitude row renders on **one** line closed and two open; the
  panel is hidden when closed; opening a panel does **not** mark the build dirty;
  the reachability slot fills on open and on a render that restores it open.

**Stamp.** Player-facing, so all three bump together: `?v=` in
`web/index.html`, `BUILD` in `web/app.js`, `**Current build:**` in `README.md`.
Resolve any conflict FORWARD.

---

## Scope Boundaries

- **Drag autoscroll** is #744 step 3 and is untouched here.
- **Multi-column** is deferred, per the issue.
- **#753** is independent: #743's disclosure lives inside the panel body and
  moves with it as a unit, needing no change.
