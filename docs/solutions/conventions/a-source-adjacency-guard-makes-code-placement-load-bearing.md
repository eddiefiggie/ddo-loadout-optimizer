---
title: "A guard that slices source text makes the PLACEMENT of unrelated code load-bearing"
module: tests
date: 2026-08-18
problem_type: convention
component: tooling
severity: medium
tags:
  - testing
  - guards
  - wizard
  - source-inspection
  - maintenance
applies_when:
  - Adding code to a function that an existing test inspects as TEXT rather than by behavior
  - A test failure names something with no apparent relationship to the change you made
  - Writing a new guard that asserts two things appear near each other in a source file
  - Working anywhere in web/wizard.js's renderRankedList wiring block
related_components:
  - tests/wizard.test.js
  - web/wizard.js
---

## Context

Some behavior in this repo cannot be asserted by running it — DOM wiring, ordering of
side effects inside a closure, "this call happens AFTER that rebuild". Several guards
therefore read `web/wizard.js` as a string and assert that two markers appear in the
right relationship. `D1: adding or removing a credit restores focus after the rebuild`
is one:

```js
const wire = WIZARD_SRC.slice(WIZARD_SRC.indexOf("function renderRankedList"));
const crem = wire.slice(wire.indexOf("b.dataset.crem != null"), wire.indexOf("rerender();"));
assert.ok(/after = \(\) => focusSummary\(stat\)/.test(crem), "remove goes up a level");
```

Adding the Utility container's panel wiring (#348 U6) above that block introduced a
new `rerender()` earlier in the same function. `wire.indexOf("rerender();")` searches
from position 0, so it now found the *new* one — which sits **before** the `crem`
marker. The slice bounds inverted, `crem` came back empty, and the regex failed.

The failure named focus restoration on credit rows. The change was a container
panel. Nothing in the message pointed at the actual cause, and the two features share
no behavior at all.

## Guidance

**When a test failure names something unrelated to your change, check whether it reads
source text before assuming you broke its behavior.** Grep the failing test for
`indexOf`, `slice`, `readFileSync`, or `_SRC` — those are the tell. A behavioral test
tells you what broke; a source-adjacency test tells you that *the shape of the file*
changed, which is a different question and usually has a different fix.

**Prefer moving your code over loosening the guard.** These guards exist because the
property they protect is real and otherwise untestable. In the #348 case the fix was
to place the new wiring *after* the generic button sweep instead of before it, which
left the first `rerender()` where the guard expects it. That placement is now
load-bearing, so it carries a comment saying why — otherwise the next reader
reasonably "tidies" it back and fails a guard about focus.

**When writing a new source-adjacency guard, anchor both ends.** Slicing from a
specific marker to the *first* occurrence of a common token is fragile by
construction: the token is common, so anything inserted earlier captures the bound.
Prefer a distinctive closing marker, or search for the closing token starting from the
opening marker's index rather than from 0.

## Why This Matters

The cost is not the fix — the fix is a two-line move. The cost is the diagnosis. The
failing test named a feature with no connection to the change, which invites exactly
the wrong response: reverting your own work to "isolate" it. That is what happened
here, and reverting an uncommitted file to isolate the failure destroyed a unit's
worth of work that then had to be rewritten.

A guard that reads source is a guard against a *file shape*. It is worth having, and
it is worth knowing that is what it is.

## When to Apply

Reading: any time a test fails that has no behavioral relationship to your diff.

Writing: any time you reach for `indexOf` on source text inside an assertion. Anchor
both bounds, and prefer distinctive markers to common ones.

## Examples

Fragile — the closing bound is the first `rerender();` **in the whole slice**, so any
earlier insertion captures it:

```js
const crem = wire.slice(wire.indexOf("b.dataset.crem != null"), wire.indexOf("rerender();"));
```

Robust — search for the closing token from the opening marker forward, so only code
*between* the markers can affect the slice:

```js
const start = wire.indexOf("b.dataset.crem != null");
const crem = wire.slice(start, wire.indexOf("rerender();", start));
```

And in the source, when placement is what satisfies a guard, say so where the reader
will be standing:

```js
// Placement is load-bearing: `containerApply` contains a `rerender()`, and the D1
// focus guard slices from the credit-remove marker to the FIRST `rerender();` it
// finds. Defining this above the sweep inverts that slice and fails a guard about
// focus that has nothing to do with the container.
```
