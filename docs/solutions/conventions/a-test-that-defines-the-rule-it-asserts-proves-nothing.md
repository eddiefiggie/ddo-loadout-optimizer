---
title: "A test that supplies both the input and the rule proves nothing about production"
date: 2026-08-18
category: conventions
module: tests
problem_type: convention
component: testing_framework
severity: medium
applies_when:
  - "Writing a guard for a rule that is easier to restate in the test than to reach through production code"
  - "Asserting a property of a data shape rather than of the code that produces or consumes it"
  - "A new test passes on the first run and was never seen red"
  - "Reviewing a test whose assertions reference no imported symbol"
tags:
  - testing
  - vacuity
  - tautology
  - prove-red
  - guards
related_components:
  - tests/solver.test.js
  - tests/wizard.test.js
---

## Context

Two tests written during #348 asserted nothing about the code they claimed to guard.

The first was meant to prove KTD2 — that a floated indicator with no backing
contribution is never treated as present. It built a synthetic primal, then applied
the z-backed predicate **inline in the test** and asserted the result:

```js
const guarded = meta.zNames.some((z) => (Columns[z] ? Columns[z].Primal : 0) > 0.5);
assert.strictEqual(guarded, false, "the z-backed read reports the effect absent");
```

That passes whether or not production applies the same rule. It tests the expression
on the line above it. (The real guard already existed — `#91 U5/KTD6` injects the same
synthetic primals through `readSolution`, which is the production reader. The new test
was redundant on top of tautological.)

The second was meant to prove that `null` and `[]` survive persistence as distinct
values:

```js
assert.notDeepStrictEqual(null, []);
```

That is a fact about JavaScript. The round-trip it claimed to cover was never
exercised.

Both were caught by re-reading them, not by any failure — that is the point. A
tautology is green by construction, so nothing in the suite objects.

## Guidance

**Route every assertion through an imported symbol.** If a test's assertions
reference no function from the module under test, it is asserting something about
itself. The mechanical check: read the assertion lines and ask which imported name
appears. If the answer is "none", the test is measuring the test.

For the two cases above, the corrections were direct:

- Inline predicate → call `readSolution` with the injected primal and assert on its
  `utilityReport`, which is what production actually computes.
- Literal comparison → drive `serializeCharacter` → `saveCharacter` → JSON →
  `loadCharacter`, and assert the distinction survives *that*.

**Prove-red catches this for free.** A tautological test passes against the
pre-change tree, because it never depended on the change. This repo already requires
new tests to be shown failing against the pre-change tree
(`prove-a-test-fails-against-the-pre-change-tree.md`); a test that stays green there
is either covering nothing or covering something that already worked. Both are worth
knowing before the test is trusted.

**Redundancy is the adjacent smell.** Before writing a guard for a rule, search for
one. The first case here duplicated an existing test that was strictly better —
written against the production reader, and falsified in both directions. Padding the
suite with a weaker copy of an existing guard looks like coverage and is not.

## Why This Matters

A vacuous test is worse than a missing one. A missing guard is a known gap; a green
tautology is a false claim of protection, and it accrues authority with age — the next
reader sees a passing assertion named after the rule and reasonably concludes the rule
is guarded.

This is the same family as
`assert-non-vacuity-for-every-surface-in-a-loop-test.md`, by a different mechanism:
there the fixture never materializes the surface, here the test never reaches
production at all.

## When to Apply

When a rule is easier to restate than to reach — that difficulty is the signal. If
getting production to demonstrate the property is awkward, that awkwardness is
information about the seam, and the fix is usually to export the reader (this repo
exports `readSolution` for exactly that reason, per #319) rather than to reimplement
its logic in the test.

## Examples

Tautological — asserts the line above it:

```js
const guarded = meta.zNames.some((z) => prim(z) > 0.5);
assert.strictEqual(guarded, false);
```

Real — asserts what production computes from the same input:

```js
const floated = S.readSolution(primalOf([x, u]), program);
assert.strictEqual(floated.utilityReport.count, 0, "floated indicator: not counted");
assert.deepStrictEqual(floated.utilityReport.effects, []);
```

Tautological — a fact about the language:

```js
assert.notDeepStrictEqual(null, []);
```

Real — the round-trip the claim was about:

```js
saveCharacter(serializeCharacter("Untouched", { ...state, utilityContainer: null }, lastRun, "idc"), st);
saveCharacter(serializeCharacter("Emptied", { ...state, utilityContainer: [] }, lastRun, "idc"), st);
assert.strictEqual(JSON.parse(JSON.stringify(loadCharacter("Untouched", st))).inputs.utilityContainer, null);
assert.deepStrictEqual(JSON.parse(JSON.stringify(loadCharacter("Emptied", st))).inputs.utilityContainer, []);
```
