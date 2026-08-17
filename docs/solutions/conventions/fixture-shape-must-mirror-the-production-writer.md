---
title: "A test fixture must mirror the shape the production writer actually produces"
date: 2026-08-16
category: conventions
module: tests
problem_type: convention
component: testing_framework
severity: high
symptoms:
  - "A new disclosure line rendered nowhere — live results, restored characters, or any export — while all four of its dedicated tests passed"
  - "The tests had been proven red against the pre-change tree per the standing prove-red rule, and still guarded nothing"
  - "Each test hand-built its fixture with query nested inside the snapshot — a shape no production writer produces"
  - "A constraint key passed by a test is read nowhere in production — the solve runs unconstrained and every assertion still passes"
applies_when:
  - "Writing a test for a function that reads a snapshot, record, or serialized structure assembled elsewhere in the app"
  - "A test hand-builds its fixture instead of driving the real serializer or worker that produces the record in production"
  - "A reader function consumes a field at a nesting level that differs from where the real writer places it"
  - "The prove-red pre-change-tree check passed and is being treated as sufficient proof the test covers the diff"
  - "A test hand-builds a query, config, or options object that a production builder normally assembles"
tags: [fixture-shape-fidelity, testing, prove-red, serialization, snapshot, integration-test]
related_components:
  - web/projection.js
  - web/persist.js
  - tests
---

# A test fixture must mirror the shape the production writer actually produces

## Context

The #339 augment-ceiling disclosure ("Augments were restricted to ML N and below for this solve…") never rendered on any real surface — not the live results panel, not a restored character, not any export — while all four of its dedicated tests passed. The tests had even been proven red against the pre-change tree per the standing prove-red rule, and still guarded nothing: each test hand-built its fixture with `query` nested *inside* the `snapshot` object, a shape no production writer produces. The (buggy) reader read exactly that shape, so reader and fixture agreed with each other while both disagreed with reality. Fixed on the PR #341 branch (commit `fix(review): apply findings #1-#3`, this defect its P1 top finding); caught only by the pre-PR code-review pass tracing the shape from the real writer to the real reader, confirmed by a live node repro.

The two real production shapes, confirmed in source:

- The live worker result (`web/solver.js`, the solve's `const out = { chosen, effective, augmentsPlaced, … }` return) carries **no query field at all** — the results render must forward the in-scope solved query separately.
- The persisted record (`serializeCharacter`, `web/persist.js`) stores `query` as a **top-level sibling** of `snapshot`; the `RESULT_KEEP` allowlist never admits a `query` key into the snapshot, so the nested shape cannot exist on a real saved character.

## Guidance

**Build the fixture through the real writer whenever possible.** The strongest fixture is produced by the serializer, worker, or builder that produces the record in production — not a hand-assembled approximation of its output. The #339 fix added exactly this test (`tests/exporters.test.js`, `"#339: a record built by the REAL serializeCharacter carries the notice into MD"`):

```js
// Integration leg: no hand-shaped record — the persistence layer itself decides
// where the solved query lives, and the export must find it there.
const { serializeCharacter } = require("../web/persist.js");
const md = toMarkdown(serializeCharacter("Ceiled", state, lastRun, "bid"));
assert.ok(/ML 32 and below/.test(md), "the disclosure survives the real persistence shape");
```

Nothing in that test decides where `query` lives — `serializeCharacter` alone does, exactly as for a real saved character — so any future reader/writer drift breaks it directly.

**When hand-construction is unavoidable** (isolating one function's behavior), first Read the writer function and copy its actual output shape into the fixture. Do not infer the shape from what the reader under test happens to consume: both sides of a reader/fixture pair are under the test author's control and can drift together undetected.

**Prove-red is necessary but not sufficient here.** Running new tests against the pre-change tree (`docs/solutions/conventions/prove-a-test-fails-against-the-pre-change-tree.md`) catches a test that never exercises the changed code. It cannot catch a wrong-shape fixture: red-then-green on a fabricated shape proves the code reads *that shape*, not that production ever feeds it. Prove-red diffs test outcomes across a code change; it has no way to check the fixture against a production writer.

## Why This Matters

A green suite plus a passing prove-red gate reads as strong evidence a feature works. In this instance it coexisted with a feature that was completely dead on every production path — the most expensive kind of false confidence, caught only because independent reviewers traced the shape from the actual writer to the actual reader. A single build-through-the-writer integration test converts that one-time human trace into a standing guard.

## Addendum — the same defect on the input side, and why it is quieter (2026-08-16, #343)

The #339 case was an **output** shape: a reader consuming a nesting no writer
produces. The mirror case is an **input** shape, and it fails more quietly.

Two tests hand-built a solver query with `weaponStyle: "Two Handed"` — a key nothing
in `web/` reads. The live gate is `query.style` (`web/model.js:210`) taking a style id
from `web/weapon-taxonomy.js` (`"thf"`; `"Two Handed Fighting"` is only the display
label). A query object has no schema and no unknown-key rejection, so the constraint
was silently discarded and both tests solved **completely unconstrained** for their
entire lives while their names and failure messages claimed a two-handed build.

Nothing goes red, because dropping a constraint makes the feasible set *larger*: every
assertion that held under the constraint still holds without it, and some that would
have failed now pass. That is what happened — correcting the key immediately falsified
two invariants one of those tests asserted, both of which were false about the product
and had survived only because the query was unconstrained (see
[lexicographic-descent-bounds-the-vector-not-each-stat.md](../design-patterns/lexicographic-descent-bounds-the-vector-not-each-stat.md)).

`buildQuery` (`web/wizard.js`) is the sole production writer of that shape, and its own
comment already recorded that the coarse `weaponSetup` key had been replaced by
`style`/`weaponTypes`/`offHand`. Reading the writer was the whole fix.

**Rule:** when a test hand-builds a query, config, or options object that a production
builder normally assembles, grep for every key you pass. **A key with zero reads in
production is a constraint you did not apply.** Prefer driving the production builder.

## When to Apply

- Any test whose subject reads a record another layer produces (persistence, worker results, projection views, export inputs).
- Reviewing tests for a new field on a shared serialized shape — check the fixture's nesting against the writer, not the reader.
- Whenever a disclosure/report/export feature "works in tests" but no surface shows it: suspect fixture-shape agreement between test and reader.

## Related

- `docs/solutions/conventions/prove-a-test-fails-against-the-pre-change-tree.md` — the parent prove-red discipline this lesson bounds: this instance cleared prove-red cleanly and still proved nothing, because the defect was the fixture's input shape, not the test's falsifiability.
- `docs/solutions/developer-experience/browser-verify-against-real-data-not-just-unit-tests.md` — the same failure family (synthetic shape diverging from the real pipeline); this doc sharpens its one-time verify-against-real-data remedy into a permanent build-through-the-writer test.
- `docs/solutions/conventions/stamp-shared-fixtures-for-new-required-fields.md` — orthogonal fixture lesson: that one is fixtures going stale after a schema change; this one is a fixture that was never shaped correctly to begin with.
- Issues #339 (the feature), PR #341 (the fix, review finding #1); #343 (the input-side addendum).
