---
title: "A source-inspecting guard must pin the property it protects, not the syntax that happens to sit beside it"
module: tests
date: 2026-08-21
problem_type: convention
component: testing_framework
tags:
  - testing
  - guards
  - source-inspection
  - over-specification
  - wiring
applies_when:
  - A guard asserts a call site by matching its source text rather than its behavior
  - An existing guard fails on a change that preserves everything the guard exists to protect
  - Adding an argument, option, or wrapper to a call some test matches as a string
  - Deciding whether a red guard means the code is wrong or the assertion is too tight
related_components:
  - tests/wizard.test.js
  - web/wizard.js
  - web/browse.js
---

# A source-inspecting guard must pin the property it protects, not the syntax that happens to sit beside it

## Context

Some wiring in this repo cannot be asserted by running it, so guards read a source
file as text and assert a call site looks right. `#332` added one after a defect
where `initBrowse` was called without a vocabulary: Browse then rendered every
chip with no markers at all — a total, silent feature loss no unit test could
see.

The guard it left behind:

```js
assert.ok(/ItemBrowser\.initBrowse\(\s*dataset\s*,\s*pickerVocabulary\(dataset\)\s*\)/.test(src),
  "initBrowse must be passed pickerVocabulary(dataset), not dataset alone");
```

Read what that pattern actually requires. The vocabulary must be the second
argument — which is the point — **and the call must end there**, because `\)`
demands a closing paren immediately after. The second condition was never part of
the concern. It came along because that is what the call looked like on the day
the guard was written.

Months later `#88 U10` gave Browse a third argument, a `hooks` object carrying the
override-creation callback. The vocabulary was still in position two. Nothing the
guard existed to protect had changed. The guard went red anyway, and its message
said `initBrowse must be passed pickerVocabulary(dataset), not dataset alone` —
about a call that passes exactly that.

## Guidance

**Ask which half of the failure is wrong.** A red guard has two possible causes,
and they have opposite fixes: the change violated the property, or the assertion
was tighter than the property. Reading the guard's own stated purpose — usually
right there in its message and comment — is what tells them apart. Here the
message named the vocabulary; the vocabulary was present; the assertion was the
thing in error.

**Fix the assertion to end where the property ends.** One character:

```js
// The claim is about the VOCABULARY ARGUMENT, not about the arity: a guard that
// pins the closing paren fails on every future argument while proving nothing
// more about the one it exists to protect.
assert.ok(/ItemBrowser\.initBrowse\(\s*dataset\s*,\s*pickerVocabulary\(dataset\)\s*[,)]/.test(src), …);
```

`[,)]` keeps the position assertion — second argument, after `dataset` — and drops
the accidental one. The companion assertion that the pre-`#332` single-argument
form must not return stays exactly as it was; it was never over-tight.

**Do not loosen past the property.** The lazy repair is deleting the guard, or
weakening it to `/initBrowse\(/`. Both make the next silent regression invisible,
which is the failure `#332` was written about. Loosening is only correct up to the
boundary of what the guard protects.

**When you widen a call, guard the thing you widened it for.** The `hooks` object
was added because Browse renders its creation control *only* when a host supplies
`onOverride` — so dropping the hook at the call site removes a whole creation
surface with no error and no failing unit test. That is the same shape of silent
loss `#332` existed to prevent, so it earned its own guard in the same commit:

```js
assert.ok(/initBrowse\([\s\S]{0,200}?onOverride\s*:/.test(src),
  "the initBrowse call must pass an onOverride hook");
assert.ok(/hooks\s*&&\s*hooks\.onOverride/.test(browse),
  "…and browse.js must gate its control on that hook rather than assuming it");
```

Note what that second assertion buys: it pins the *gating*, not just the passing.
A hook that is passed but ignored, or a control rendered unconditionally, both
break the contract in ways the first assertion alone would miss.

## Why This Matters

An over-tight guard is not merely noisy. It teaches the wrong lesson at exactly
the moment someone is deciding what to do about it — a red test whose message
describes a property the code plainly satisfies invites one of two bad repairs:
contorting the code back into the shape the regex wants, or deleting the guard as
broken. The first is the tail wagging the dog; the second silently retires
protection against a real, previously-shipped defect.

It also degrades over time in one direction only. Every future argument, wrapper,
or formatting change breaks it again, and each break spends the same
"is-this-real?" judgment. Guards that cry wolf get deleted eventually, and the
deletion usually happens in a hurry, by someone who did not write them.

The cost of getting it right is one character. The cost of getting it wrong is
paid every time the call site legitimately changes.

## When to Apply

- Writing any guard that matches a call site as source text. Match the arguments
  you care about and stop; do not anchor on the closing paren, the trailing
  semicolon, or the line break.
- Triaging a red guard on a change that feels unrelated to it. Read the guard's
  message and comment before touching either side — they usually state the
  property, and the property is the arbiter.
- Adding an argument or option to a call that any test matches by string.
- Reviewing a guard-loosening diff: check the loosening stops at the property's
  edge rather than continuing past it.
- Widening a call site so a feature becomes conditional on the new argument — the
  new conditionality wants its own guard, and gating it is a separate assertion
  from passing it.

## Examples

Before — the assertion outlives its own purpose the moment the call grows:

```js
/ItemBrowser\.initBrowse\(\s*dataset\s*,\s*pickerVocabulary\(dataset\)\s*\)/
//                                                                    ^^ arity, not the property
```

After — the same claim, ending where the claim ends:

```js
/ItemBrowser\.initBrowse\(\s*dataset\s*,\s*pickerVocabulary\(dataset\)\s*[,)]/
```

Related: `a-source-adjacency-guard-makes-code-placement-load-bearing.md` is the
sibling failure in the same family — there a guard's *slice bounds* were
positional, so unrelated code moving nearby inverted them. Hold the two together:
a source-inspecting guard can accidentally constrain the *placement* of code
around it or the *shape* of the call it matches, and neither was ever the thing it
set out to protect. `prove-a-guard-fails-before-trusting-it.md` covers the other
direction — a guard that never goes red at all.

Found and fixed in
[#424](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/424), the third
of three PRs for
[#88](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/88).
