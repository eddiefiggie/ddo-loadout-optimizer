---
title: "A state-derived predicate cannot rank a DOM its handlers mutate"
module: web-ui
date: 2026-08-21
problem_type: convention
component: tooling
severity: medium
related_components:
  - testing_framework
tags:
  - ddo
  - wizard
  - two-sources-of-truth
  - state-dom-divergence
  - verification-topology
  - false-green
  - imperative-mutation
  - multi-clause-predicate
applies_when:
  - "a predicate derived from application state decides how an element already in the DOM should render"
  - "handlers show or hide that element in place, without a re-render"
  - "the predicate behind an element has more than one clause and a handler clears only some of them"
  - "the same question is answered at render time and again later, from two different sources"
  - "a pure-function test and a live end-to-end test both pass and the behavior is still wrong"
---

## Context

`web/wizard.js:99` defines `resolveBannerPrimary(state)`: which of the results
step's three re-solve banners holds the single `btn primary`. It answers from
state — `staleNote(s)`, `s.twfMigrated`, `s.constraintsDirty` — and the step
template calls it while building its markup, which is correct: at render time no
DOM exists yet to ask.

The same question then has to be re-answered later, because banner visibility is
mutated **imperatively**. Four handlers add or remove `wz-hidden` on a live
element with no re-render, so a class assigned during templating would never
flip. `refreshResultsEmphasis` (`web/wizard.js:3691`) is called at each of those
sites to re-apply the classes.

It originally re-answered by calling `resolveBannerPrimary(state)` again. That is
the bug: the two answers agree at render time and part company the moment a
handler edits the DOM without bringing every piece of state with it.

## Guidance

**Re-rank from the source of truth your handlers actually mutate.** If a handler
hides an element by touching the element, then the later pass must decide from
the element:

```js
// WRONG — re-derives from state, which the handler may not have fully cleared
const claimant = resolveBannerPrimary(state);
for (const [barId, btnId] of BANNERS) {
  b.classList.toggle("primary", barId === claimant);
}

// RIGHT — reads what is actually on screen
let claimed = false;
for (const [barId, btnId] of BANNERS) {
  const bar = document.getElementById(barId);
  const showing = !!bar && !bar.classList.contains("wz-hidden");
  const primary = showing && !claimed;
  b.classList.toggle("primary", primary);
  if (showing) claimed = true;
}
```

Keep the state-derived function for the moment it is right — render time — and
say so in its doc rather than deleting it. Two answers to one question is fine
when each names the moment it owns; it is only a defect when one is used outside
that moment.

**The trigger to look for is a multi-clause predicate with a single-clause
handler.** `staleNote` (`web/wizard.js:1079`) accumulates three independent
causes — an override-set mismatch, `loadedStale`, and missing armor — and its own
comment says the causes accumulate rather than short-circuit. The stale banner's
dismiss handler (`web/wizard.js:4356`) clears only `state.loadedStale` before
hiding the element. Any of the other two keeps the predicate truthy while the
element is gone.

## Why This Matters

The failure is not that a banner looked wrong. Ranking from stale state awarded
`primary` to a button that had just been hidden, and — because the claim was
taken — ghosted every control that was actually visible, including the save
button. The step rendered with **no primary at all**: the player is looking at a
screen where nothing is the suggested action.

It also hides well. A later `solve()` re-renders and papers over it, so the
damage only persists on the paths where that call returns early — a solve already
running, or priorities empty. A bug that self-heals on the common path and
survives on the uncommon one is the kind that ships.

## When to Apply

Whenever the same question is answered twice from two different sources. In this
codebase that is concentrated wherever a handler calls `classList.add/remove` or
`classList.toggle` on an element the step template also styles from state.

The general shape: **render-time answers come from state, post-render answers come
from the DOM**, and a function that serves one must not be reused for the other
without checking that every handler in between keeps the two in sync.

## Examples

**The verification lesson is the transferable half.** This defect survived two
verification methods that both passed:

- **Eight pure-function unit tests** over `resolveBannerPrimary`, covering every
  combination of the three flags including all three co-showing pairs. They cannot
  see this bug by construction — inside a pure function, state and DOM cannot
  disagree.
- **A live DOM co-show test** in the browser: two banners raised, the earlier one
  primary, the later ghost, then the claimant dismissed and the next promoted. It
  passed — because the banner chosen for the test was `wz-cbar`, whose single flag
  (`state.constraintsDirty`) the handler clears completely.

Neither method was wrong. The bug lived in the gap **between** them, and the case
that exposes it is the one where the two sources are *allowed* to disagree.

Reaching it took a deliberately constructed fixture: save a build, strip its
armor so `staleNote` stays truthy through the **armor** clause rather than
`loadedStale`, load it, raise a second banner with a pin, then dismiss the stale
one and read the classes synchronously before the async re-solve re-renders over
the evidence.

```
before dismiss   wz-stale: showing, primary   wz-cbar: showing, ghost   save: ghost
after dismiss    wz-stale: hidden,  ghost     wz-cbar: showing, PRIMARY save: ghost
```

Under the state-derived ranking the second row read `wz-stale: hidden, primary`
and `wz-cbar: showing, ghost` — zero visible primaries.

The rule this yields: **when a value has two sources of truth, the test worth
writing is the one where they are permitted to diverge.** A test built on the
case where they necessarily agree returns green and proves nothing about the
mechanism it appears to cover.

The guard added alongside the fix pins the mechanism rather than the outcome, and
was proven red against the state-derived version before being trusted (see
[prove a guard fails before trusting it](prove-a-guard-fails-before-trusting-it.md)):

```js
const loop = f.slice(f.indexOf("for ("), f.indexOf("wz-save"));
assert.ok(/wz-hidden/.test(loop));
assert.ok(!/resolveBannerPrimary/.test(loop));
```

Shipped in PR #435 (issue #432).

## Related

- [Verify at the production entry point](../developer-experience/browser-verify-against-real-data-not-just-unit-tests.md)
  — the neighbouring verification-topology rule. That one is about a unit test
  masking a browser-only bug; this one is the harder case where the browser test
  ran and still passed, because it exercised the agreeing half of the state/DOM
  split.
- [Closure-scoped UI state must reset on character load](../logic-errors/closure-scoped-ui-state-must-reset-on-character-load.md)
  — same family: per-entity state whose reset is present but incomplete across
  branches.
- [A removed refusal takes its unstated guards with it](a-removed-refusal-takes-its-unstated-guards-with-it.md)
  — the other "a change left a stale artifact behind" instance from the same
  build.
