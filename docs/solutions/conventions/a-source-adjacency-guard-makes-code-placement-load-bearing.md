---
title: "A guard that slices source text makes the PLACEMENT of unrelated code load-bearing"
module: tests
date: 2026-08-18
last_updated: 2026-08-22
problem_type: convention
component: tooling
severity: medium
tags:
  - testing
  - guards
  - wizard
  - source-inspection
  - maintenance
  - vacuity
applies_when:
  - Adding code to a function that an existing test inspects as TEXT rather than by behavior
  - A test failure names something with no apparent relationship to the change you made
  - Writing a new guard that asserts two things appear near each other in a source file
  - Working anywhere in web/wizard.js's renderRankedList wiring block
  - "Reviewing a source-slicing guard whose assertion is a loop or a negative rather than a positive regex"
  - "A source-derived enumeration reports success without saying how much it examined"
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

**The same construction also fails silently, and that half is not a diagnosis problem
at all.** The case above inverted a slice and the regex over it went red — loud, confusing,
but visible. Swap the assertion for a **loop or a negative** and the identical inversion
produces no failure: `String.prototype.slice` saturates rather than throwing on inverted
bounds, so it returns `""`, a `for` loop over nothing runs green, and a `!/x/.test("")`
passes. The guard reports success on a file it has stopped reading.

This happened here on 2026-08-22, four days after the case above. A completeness guard
enumerated the notice-entry ids `web/projection.js` can mint by slicing from
`indexOf("function artifactNoticeEntries")` to `indexOf("constraintPairs")` — and
`constraintPairs` is also defined roughly seven hundred lines *earlier* (`web/projection.js:1336`,
against the entry functions at `:2029`). End before start, empty slice, zero iterations,
green. Neither the pre-change-tree run nor a mutation check can see it: a mutation on a
curated entry cannot redden a loop that never reaches it.

**So the countermeasure is not only anchoring — it is asserting how much the slice yielded.**
Anchoring prevents the inversion; a floor on the yield detects it when anchoring is
forgotten. The 2026-08-22 case was caught by exactly one line, written for an unrelated
purpose:

```js
const from = src.indexOf("function artifactNoticeEntries");
const region = src.slice(from, src.indexOf("constraintPairs,", from));   // anchored
const ids = [...new Set([...region.matchAll(/\{\s*id:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]))];
assert.ok(ids.length >= 11, `expected the eleven split branches, saw ${ids.length}`);  // and floored
```

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

**How much of this suite is exposed.** Measured 2026-08-22: **23** slices whose closing
`indexOf` searches from position 0 — 17 in `tests/wizard.test.js`, 6 in
`tests/results.test.js` — against **3** that pass a `fromIndex`, one of which is the fix
above. The advice below is not hypothetical hygiene; it describes the minority case in
this repo today.

Each of those 23 is one earlier insertion away from inverting, and which half of the
failure it lands in depends entirely on whether anything **positive** is asserted over
the slice. Hand-checked, **four** assert only negatives and would therefore pass on an
empty slice — `tests/wizard.test.js` lines 624, 1122, 1445 and 3074. The rest carry at
least one positive regex, presence check, or length assertion that an inverted slice
would redden, which is the loud half the case above describes. Tracked as #450.

## Why This Matters

The cost is not the fix — the fix is a two-line move. The cost is the diagnosis. The
failing test named a feature with no connection to the change, which invites exactly
the wrong response: reverting your own work to "isolate" it. That is what happened
here, and reverting an uncommitted file to isolate the failure destroyed a unit's
worth of work that then had to be rewritten.

A guard that reads source is a guard against a *file shape*. It is worth having, and
it is worth knowing that is what it is.

## When to Apply

Reading: any time a test fails that has no behavioral relationship to your diff — **and
also when nothing fails at all.** The silent half has no trigger of its own, which is why
it needs a standing one: when you insert code into a function any guard slices, check the
guards over that function rather than waiting to be told.

Writing: any time you reach for `indexOf` on source text inside an assertion. Anchor both
bounds, prefer distinctive markers to common ones, and **assert a floor on what the slice
yielded** whenever the assertion over it is a loop or a negative — those cannot fail on an
empty slice, so nothing else will tell you.

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

## Related

- `docs/solutions/conventions/a-vacuous-guard-is-recognizable-before-you-run-it.md` — the
  silent half above is its shape 4, alongside three other guard shapes that are green by
  construction. Where this doc is a *diagnosis* aid (a test failed; why does it name
  something unrelated?), that one is a *write-time* recognizer: the shapes are visible in
  the assertion's own text before any run. Its reading of this doc's tell is the one to
  carry forward — grep the failing test for `indexOf`, and grep the passing ones too.
