---
title: "A guard that keeps its own copy of a production constant silently measures the copy"
module: tests
date: 2026-08-20
problem_type: convention
component: testing_framework
tags:
  - guards
  - silent-pass
  - duplication
  - encoding-gate
  - utility-tier
applies_when:
  - A verification harness declares its own copy of a constant that production also declares
  - The copy is justified as temporary because the harness was written before the real constant existed
  - A harness takes a size, count, or index parameter and slices, clamps, or truncates it
  - A gate reports the parameter it was ASKED for rather than the one it actually measured
---

## Context

`tests/encoding_equivalence.js` is the correctness gate for the Utility
container: it proves the weighted single-stage encoding selects the same ordered
effect set as a sequential reference, at container size *k*. The container cap
exists because of what this gate has proven — nothing else justifies the number.

The gate declared its own copy of the container's default order, with an honest
comment explaining why:

```js
// U3 moves this constant to web/dataset.js beside the roster, under the existing
// JS/Python mirror guard; it lives here only so U1 can run before U3 exists.
const DEFAULT_ORDER = [ /* 20 names */ ];
```

U3 duly moved the constant to `web/dataset.js`. Nobody deleted the copy.

Months later, widening the roster for #349, the gate ran at the new size:

```
$ SIZES=26 node tests/encoding_equivalence.js
  26 |    17 |        0
  largest clean size : 26
```

Seventeen agreements, zero disagreements, at size 26. Except the harness selects
its container with `DEFAULT_ORDER.slice(0, k)`, and `DEFAULT_ORDER` still held
twenty names. **`slice` does not raise on an out-of-range end** — it saturates.
The gate compared 20-effect vectors and labelled them 26.

The tell was visible in the output the whole time: the printed effect vectors
were twenty characters wide. Nothing in the harness compared the width it
printed against the size it claimed.

## Guidance

**A guard must read the constant production reads.** Not a copy, however
faithful at the time of writing. The copy cannot fail loudly when the original
moves, because nothing connects them — that is the entire failure.

```js
const { UTILITY_CONTAINER_DEFAULT_ORDER: DEFAULT_ORDER } = require("../web/dataset.js");
```

**Make an out-of-range parameter throw, not truncate.** Any saturating operation
— `slice`, `Math.min`, a clamp, a `LIMIT` in a query — converts "you asked for
something I cannot do" into "here is a smaller answer, unlabelled."

```js
if (k > DEFAULT_ORDER.length) {
  throw new Error(`SIZES asked for k=${k} but the declared order holds only `
    + `${DEFAULT_ORDER.length} names — widen it first, or this run would `
    + "silently measure the shorter list.");
}
```

**Print the measured parameter, not the requested one.** The header now states
the declared order's length, so a mismatch is visible in the first line of
output rather than inferable from the width of a bit vector.

**A duplication justified as temporary needs a removal trigger.** "It lives here
only until X exists" is a promise with no enforcement. Either land the removal in
the same change that creates X, or leave a guard that fails once X exists — a
test asserting the two lists are equal would have caught this the day U3 landed,
and would have cost one line.

## Why This Matters

This is worse than a test that never runs, and worse than one that asserts
nothing. Both of those are *visibly* empty once you look. This gate ran on
demand, printed a detailed table, and returned a specific, quotable, **false**
number — and that number is what a reviewer would have used to justify raising
`UTILITY_CONTAINER_CAP`.

The property it guards is not cosmetic. Above some roster size the weighted
objective's span (`2^0..2^(k-1)`) exceeds what the solver can separate, and the
failure is silent: the solve returns a plausible loadout that is simply wrong
about which effects the player secured. A stale gate would have signed off on
exactly the size where that begins.

Note the sequence: the gate was fixed, re-run honestly, and *then* reported
`17/17 agree` at a genuine k=25 — the conclusion survived. That is luck, not
vindication. The same staleness with a real disagreement above 20 would have
shipped a correctness bug with a green gate attached to it.

## When to Apply

- Writing any harness that must mirror a production constant — a roster, an
  order, a schema, a limit.
- Reviewing a comment that says a duplication is temporary. Ask what fails when
  the temporary period ends.
- Any gate that takes a size/count parameter: check that asking for more than it
  can do is an error rather than a quieter answer.
- Reading a gate's output: confirm the shape of what it compared matches the
  parameter it claims. Here, one glance at the vector width would have done it.

## Examples

Before — the harness's own list, and a silent truncation:

```js
const DEFAULT_ORDER = [ /* a 20-name copy */ ];
...
const container = DEFAULT_ORDER.slice(0, k);   // k=26 -> 20 names, no error
```

After — the shipped constant, a loud failure, and a self-describing header:

```js
const { UTILITY_CONTAINER_DEFAULT_ORDER: DEFAULT_ORDER } = require("../web/dataset.js");
...
console.log(`declared order: ${DEFAULT_ORDER.length} names (the shipped constant)`);
...
if (k > DEFAULT_ORDER.length) throw new Error(/* … */);
const container = DEFAULT_ORDER.slice(0, k);
```

Related: `a-guard-outside-the-ci-glob-is-not-a-guard.md` (a guard that never
runs), `a-test-that-defines-the-rule-it-asserts-proves-nothing.md` (a guard that
supplies its own input), and `prove-a-guard-fails-before-trusting-it.md` (a guard
never seen red). This one completes the set: a guard that runs, is not circular,
and has been seen red — but measures the wrong input.

Found and fixed in [#400](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/400),
closing [#349](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/349).
