---
title: "A symbol added to only one export surface is dead on the other — and the tests exercise the surface that still works"
module: web
date: 2026-08-20
problem_type: convention
component: frontend_stimulus
related_components:
  - testing_framework
tags:
  - dual-runtime
  - node-tests-blind-spot
  - silent-pass
  - export-drift
  - browser-only-bug
applies_when:
  - "Adding a function or constant to a web/*.js file that ends in both `module.exports` and a `window.*` assignment"
  - "A new feature's unit tests all pass on the first run and the feature is player-facing"
  - "Reviewing a diff that exports something new from a dual-exported module"
---

## Context

Every `web/*.js` file ends with two export surfaces:

```js
if (typeof window !== "undefined") {
  window.DatasetNormalizer = { normalizeDataset, buildPickerVocabulary, /* … */ };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { normalizeDataset, buildPickerVocabulary, /* … */ };
}
```

The node suite reaches the second. Players reach the first. Nothing keeps the
two lists in step.

Adding `companionHintFor` for #404, it went into `module.exports` and not into
`window.DatasetNormalizer`. Every unit test passed — nine of them, including
tests that called the function directly and got the right sentence back. The
picker's own bridge is written defensively:

```js
const companionHint = (DN && DN.companionHintFor) ? DN.companionHintFor(v, next) : null;
```

so in the browser `DN.companionHintFor` was simply `undefined`, the guard took
the null branch, and the hint never rendered. No error, no console warning, no
failing test. **Green CI, dead feature.**

## Guidance

**Assert both surfaces, by reading the source.** A test cannot *call* the browser
export — the `window` branch does not execute under node — so the only available
check is textual:

```js
const src = fs.readFileSync(path.join(__dirname, "..", "web", "dataset.js"), "utf-8");
const win = src.match(/window\.DatasetNormalizer = \{([^}]*)\}/);
assert.ok(win, "the window global assignment is still recognisable");
assert.ok(/\bcompanionHintFor\b/.test(win[1]),
  "companionHintFor is missing from window.DatasetNormalizer — the app would never show the hint");
assert.strictEqual(typeof companionHintFor, "function", "and present on module.exports");
```

Note the first assertion. A source-reading test fails *open* if the regex stops
matching after a refactor, so it has to check that it found the thing at all —
otherwise it degrades into a test that passes because it looked at nothing.

**Suspect a defensive bridge.** `(DN && DN.fn) ? DN.fn(…) : null` is correct for
a module that legitimately might not be loaded, and it is also exactly what turns
this mistake into silence. Where a symbol is *required*, the absence of it is a
bug worth surfacing, not a branch worth taking quietly.

**Treat "all my new tests passed first try" on a player-facing feature as a
prompt to open the browser.** That is what caught this one. The unit tests were
not wrong — they were complete and green about the half of the system players do
not use.

## Why This Matters

This fails in the worst available direction. A missing symbol that throws is
found in seconds; a missing symbol behind a defensive guard produces a feature
that exists in the codebase, is documented in the PR, has passing tests, and does
nothing at all for the player it was written for. It would have shipped, and the
next signal would have been a third report of the same dead end #404 exists to
close — with the fix already "in" for weeks.

It is the sibling of
`docs/solutions/conventions/shared-classic-script-globals-use-var-not-const.md`,
and the pair is worth holding together because the **failure signatures are
opposite**:

| | Symptom | Found by |
| --- | --- | --- |
| `const` in shared classic-script scope | **loud** — redeclaration, blank app | the next browser load |
| a symbol on one export surface only | **silent** — feature simply never fires | nothing, until a player reports it again |

Same root (the node suite is blind to the browser surface), opposite visibility.
The loud one teaches you to check the browser; the quiet one is the reason that
lesson has to become a guard rather than a habit.

## When to Apply

- Any diff that adds a name to a dual-exported `web/*.js` module. Check the
  `window.*` list in the same edit, not afterwards.
- Any player-facing feature whose tests are all green on the first run.
- Reviewing a `(X && X.fn) ? … : …` bridge: ask whether `X.fn` being absent is a
  legitimate state or a bug being swallowed.

## Examples

The commit that introduced the guard added the symbol to both lists:

```js
window.DatasetNormalizer = { companionHintFor, COMPANION_STATS, normalizeDataset, /* … */ };
…
module.exports = { COMPANION_STATS, companionHintFor, /* … */ };
```

Disarmed and confirmed red before being trusted (per
`prove-a-guard-fails-before-trusting-it.md`): removing the name from the
`window` list alone turns the suite red with the message above, while every
other test stays green — which is the whole point.

Found and fixed in [#406](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/406),
closing [#404](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/404).
