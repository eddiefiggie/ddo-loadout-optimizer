---
module: web
component: wizard priorities list
problem_type: layout
tags: [css-grid, details-summary, display-contents, shadow-dom, disclosure, selector-specificity]
applies_when: >
  Placing a <details> disclosure inside a CSS grid row and wanting the summary
  inline on one line with the panel body spanning a line beneath it; or changing
  a `display` on a list-row selector that other, nested rows also match.
---

# A `<details>` body cannot join its parent's grid, and `display: contents` will not fix it

## The problem

A priorities row wants two things at once: the `Advanced` disclosure summary
**inline** on the control line, and its panel body **spanning the full row**
beneath. That is a two-row grid, and a `<details>` holds both halves in one
element, so the obvious move is `display: contents` on the `<details>` to promote
its summary and body into the parent grid.

Do not. Measured in Chromium 1194, it fails twice:

| step | result |
|---|---|
| `details { display: contents }`, panel closed | body computes `display: block` and **renders** — the UA's closed-state hiding goes away with the element's box |
| add `details:not([open]) > .body { display: none }` | closed state restored; toggle, marker and re-close all work |
| body given `grid-column: 1 / -1` | **still one column wide** — 99px in a 582px row |

The third is the disqualifying one, and it is quiet: `getComputedStyle` reports
`grid-column-start: 1`, `grid-column-end: -1`, and the grid resolves to exactly
the 5 declared columns. Everything reads correct and the layout is still wrong.
Chrome renders `<details>` children through a UA shadow tree, so the body is not
the grid item its own declarations describe.

## The fix

Split the disclosure in the markup. An explicit `<button>` with `aria-expanded`
and `aria-controls`, plus a sibling panel `<div hidden>` — both real children of
the row, both placeable.

What `<details>` gave for free and must now be written by hand:

- **`aria-expanded` on the control.** `<details>` reported its own state. A
  button does not, and nothing else in a unit suite notices a stale one — the
  panel opens correctly while a screen-reader user is told it is shut. Flip the
  panel and set the attribute in the same handler, and emit both from one
  function at render time so a row cannot render an expanded control over a
  hidden panel.
- **The disclosure triangle.** It is the only open/closed signal on a collapsed
  row, so it is an affordance, not decoration. Draw it with `::before` and rotate
  it on `[aria-expanded="true"]`.
- **The open-set write point.** Anything keyed on `ontoggle` moves to the click
  handler.

## Two traps the split introduces

**A generic button handler will swallow the new toggle.** If the row's controls
are wired with something like `querySelectorAll("button").forEach(b => b.onclick = ...)`,
the toggle is now a `<button>` and matches it. Worse than double-handling: if
that binding runs *after* the toggle wiring it **replaces** the handler, and the
dispatch chain matches none of the toggle's data attributes, so the control goes
inert. Scope the generic selector with `:not(.your-toggle)` and assert the
binding order, because the panel still opens without the fix and nothing else
will catch it.

**A descendant selector on the row will restyle nested rows.** `.list li` also
matches every `<li>` nested inside the row's own panel, and it **outranks** a
single-class rule like `.nested-item { display: flex }`. That is harmless while
both declare the same `display` and breaks the moment one becomes a grid: the
nested rows silently inherit the parent's column template and their controls
strand against an empty `1fr` track. Use the child combinator (`.list > li`) and
pin it with a guard.

## What caught each

The `display: contents` failure was caught by **probing Chromium before writing
any of it**, not by review — every declaration involved computes correctly. The
nested-row breakage was caught by **driving the real app** and dumping the
computed `display` of every rendered row; the unit suite was fully green at the
time, because a unit suite cannot see a layout.

Both are the standing rule in a new place: prove it, do not infer it.
