---
title: "Edit the stale comment — a new block stacked above it leaves the wrong text standing"
module: web-ui
date: 2026-08-21
problem_type: convention
component: tooling
severity: medium
related_components:
  - documentation
tags:
  - ddo
  - stale-comment
  - jsdoc
  - review-followup
  - task-reads-as-done
  - guard-candidate
applies_when:
  - "a plan, review finding, or commit message says to CORRECT an existing comment"
  - "a change invalidates a claim made in a comment above the function it changed"
  - "documenting new behavior on a function that already carries a doc block"
  - "a comment cites an issue number, a defect, or a location that the current change resolves"
---

## Context

Twice in one build, a doc comment whose claim had just been invalidated was left
in place and a **new** block was written directly beneath it. Both times the
instruction had been explicit — the plan's U4 said to *correct* the comment, and
the review finding named the stale sentence — and both times the response was an
addition rather than an edit. The work then read as done: a new, accurate block
existed, so the checklist item was satisfied while the wrong text still stood
above it.

Both were caught by review, not by tests, and both are visible in the tree as
removals: `46a7235` (PR #434) and `bb69ab4` (PR #435).

## Guidance

**When a change invalidates a comment, edit that comment. Do not write a second
one below it.**

If the old block still holds reasoning worth keeping, fold that reasoning into
the replacement rather than preserving the block for it. A function carrying two
adjacent doc blocks is the signature of this mistake — there is no case in this
codebase where a function legitimately needs two.

The tell that an addition is being substituted for an edit: the new block is
written to be *true*, and no one re-reads the old one to check whether it is still
true. Correcting means opening the old text.

## Why This Matters

A stale comment is worse than no comment, because a reader trusts it in
proportion to how specific it is. The second instance is the sharp version:

```js
/** … Ranking the three against EACH OTHER is a separate, pre-existing defect: they
 *  raise independently and can co-show with up to three primaries. See #432. */
/** #432 — WHICH re-solve banner holds primacy, or null when none is showing. … */
function resolveBannerPrimary(state) {
```

The first block tells the reader that ranking the banners is an open defect
tracked in an issue — sitting directly on top of the function that *is* that
ranking, in the change that closed that issue. A developer establishing whether
co-showing banners were handled would conclude they were not, and either re-file
the issue or build a second ranking mechanism beside the one already there.

The first instance was quieter but the same shape: `saveErrorText`'s original
block asserted that the name field "lives in the rail, which is on screen from
every step" — describing precisely the arrangement that change removed — so the
error text it documents reads as safe from every surface when it no longer is.

## When to Apply

Whenever a change touches code that has a comment above it, and especially when:

- a plan or review finding uses the words *correct*, *update*, or *fix* about a comment
- the comment names a defect, an issue number, or a "this is handled elsewhere" pointer
- the comment describes where something lives, and the change moves it

The last one is the highest-risk category in this repo, because a comment that
locates something ("the field is in the rail") is invalidated by exactly the kind
of change that is otherwise well-tested.

## Examples

**Wrong** — the addition that leaves the old claim standing:

```js
/** The refusal, worded once. The name field lives in the rail, which is on
 *  screen from every step, so "name it first" needs no per-surface variant. */
/** #431 U4 — "no-name" is reachable from the character step's own save
 *  button, where the field it names is on screen beside it. … */
function saveErrorText(error) {
```

**Right** — one block, the surviving reasoning folded in:

```js
/** #431 U4 — "no-name" is reachable from the character step's own save
 *  button, where the field it names is on screen beside it. The guard no
 *  longer produces this error at all: it omits Save instead. */
function saveErrorText(error) {
```

**A guard would have caught both.** Neither instance was detectable by the test
suite, because both were comments — the code was correct. The mechanical
signature is trivial to assert, and this repo already tests source text directly
(see [prove a guard fails before trusting it](prove-a-guard-fails-before-trusting-it.md)
for the discipline that guard would need):

```js
// no function carries two adjacent doc blocks
assert.ok(!/\*\/\s*\n\s*\/\*\*/.test(WIZARD_SRC),
  "a second doc block stacked above a function means an edit was skipped");
```

That guard is not yet written — recorded here as the obvious next step rather
than claimed as done.

## Related

- [A removed refusal takes its unstated guards with it](a-removed-refusal-takes-its-unstated-guards-with-it.md)
  — the same family from the same build: a change that leaves a stale artifact
  behind. That one is about a removed *guard*; this one about a stale *claim*.
- [A dated coverage claim cannot notice its own staleness](a-dated-coverage-claim-cannot-notice-its-own-staleness.md)
  — the argument for asserting a documentation claim mechanically instead of
  trusting that someone will re-read it.
