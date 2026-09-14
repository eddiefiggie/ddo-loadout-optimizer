---
module: tests
component: source-slice guards
problem_type: false-verdict
tags: [source-assertions, srcBetween, ordering-guard, comments, test-quality]
applies_when: >
  Writing a test that asserts one thing appears BEFORE another in source
  (indexOf < indexOf), or that a construct is absent from a slice — especially in
  a codebase whose convention is to explain load-bearing code in a comment above it.
---

# A positional source assertion must strip comments, or your own prose defeats it

## The problem

This repo pins many invariants by slicing source and asserting against it. Two of
those assertions are quietly unsound as usually written:

- **ordering** — `slice.indexOf("A") < slice.indexOf("B")`
- **absence** — `assert.ok(!/B/.test(slice))`

Both read comments as if they were code. And the convention here is to write a
comment above exactly the line that matters, naming the thing that matters — so
the prose reliably contains the very token the assertion searches for.

Two live examples, both caught by the assertions failing on correct code:

```js
// #744 step 3 — stop FIRST, before the early return and before the
// rerender below. `rerender()` replaces `ol.innerHTML`, destroying the ...
dragAutoScroll.stop();
```

`indexOf("rerender()")` found the mention **in the comment**, at index 159, while
the real call sits at 528 — so "stop comes before rerender" evaluated false
against code where it is true.

```js
// No preventDefault: this only needs clientY, and declaring the whole
// document a valid drop target would change drop semantics ...
```

`!/preventDefault/.test(slice)` failed against a handler that does not call it,
because the comment explaining *why not* says the word.

## Why it is worse than a flaky test

The failure direction here happened to be safe — a red test on correct code, which
gets investigated. **The dangerous direction is the same bug with the operands the
other way round.** An ordering assertion written `indexOf("B") > indexOf("A")`
where A is only mentioned in a comment ABOVE B passes for the wrong reason, and
keeps passing after someone moves the real call. The guard then protects nothing
and nobody looks at it again, which is the failure mode
`prove-a-guard-fails-before-trusting-it.md` exists to catch.

## The fix

Strip comments before any positional or absence assertion:

```js
function codeOnly(src) {
  return String(src).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}
```

Then `codeOnly(srcBetween(...))` for those two shapes. Plain "this call exists"
assertions do not need it — a comment mentioning a call it does not make is
harmless there, and stripping adds nothing.

It is a regex, not a parser: it does not understand a `//` inside a string
literal. Good enough for slices of this codebase, and the assertion is about our
own source rather than arbitrary input.

## The check that catches it

Corrupt the code the guard exists to reject and confirm the guard goes red. Both
cases above were found that way — one by the assertion failing on correct code,
the other by the deliberate corruption pass. The sibling lesson from the same
change: a degenerate-input guard survived its corruption test entirely, because
`edge <= 0` and NaN comparison semantics already returned 0 for every input the
test tried. The guard was load-bearing for exactly one value (`Infinity`), and
until that value was in the test, the test was guarding nothing.
