---
title: A loop test over N parallel surfaces is vacuous for every surface the fixture never materializes
date: 2026-08-14
category: conventions
module: tests
problem_type: convention
component: testing_framework
severity: high
resolution_type: test_fix
applies_when:
  - "Writing or reviewing a test that loops over N parallel families, channels, or variants asserting the same absence-shape (empty array, zero count) for each"
  - "A fixture only materializes some of the surfaces a loop-based assertion set is meant to cover"
  - "Prove-red was run against a multi-surface loop test — the red run proves only the first assertion reached"
  - "Adding guards for multiple structurally similar families in a single change"
  - "Reviewing whether an absence assertion is proven reachable rather than true by construction"
symptoms:
  - "A loop test iterating over N parallel surfaces asserting each is empty passes fully green"
  - "The fixture populates only a subset of the surfaces the loop checks, so the untouched surfaces mint zero structures by construction"
  - "Prove-red on the combined loop demonstrates only the first surface — the first failing assertion aborts the loop"
  - "Mutation checks stay green on a surface the fixture never mints (nothing exists to redden)"
  - "The vacuity is caught only by instrumenting the code under test against the fixture, not by any standing gate"
tags:
  - testing
  - vacuity
  - loop-assertions
  - fixtures
  - prove-red
  - non-vacuity
  - solver
  - mutation-testing
related_components:
  - tests/solver.test.js
  - web/solver.js
---

# A loop test over N parallel surfaces is vacuous for every surface the fixture never materializes

**Learning:** A test that loops over N parallel surfaces asserting an absence-shape (empty array, zero count) proves nothing for any surface the fixture never materializes — and neither the prove-red base-tree run nor a mutation check catches this, because both are blind to assertions that never execute against a structure that never exists. The guard is an in-test **non-vacuity assertion** over the very structures the loop checks: positive evidence, per structure, that the fixture minted it.

## Context

PR #323 (merged to main 2026-08-14, closes #319) added load-bearing report guards to all eight solver `*Placed` craft families: a placement variable can float to 1 on any solve path that does not minimize it, and the reader must report a placement only when a contribution it gates actually fired (the comment block at `tests/solver.test.js:3951-3957`).

The integration test "#319 guards hold on a real tieBreak:false solve; fewer-crafts counting sees no floats" (`tests/solver.test.js:4055`) closes the loop on a real solve: it builds one craft-host fixture, solves with `tieBreak: false`, and loops over all eight `*Placed` arrays asserting each is empty (`tests/solver.test.js:4091-4093`):

```js
for (const k of ["augmentsPlaced", "dinoPlaced", "ncPlaced", "rollPlaced", "vikPlaced", "sealPlaced", "tfPlaced", "gsPlaced"]) {
  assert.strictEqual((r[k] || []).length, 0, `${k}: no phantom placement on the tieBreak:false path`);
}
```

As first written, the fixture materialized only four of the eight families (dino_slots_norm, seal_slots, green_steel_slot, augments). It never set `nearly_complete`, `roll_groups`, `lamordia_slots`, or `thunder_forged_tiers` — and `buildProgram` mints a family's placement variables only when the host field exists:

- `nearly_complete` — `if (!category) continue;` (`web/solver.js:633-634`)
- `roll_groups` — the loop iterates `xv.variant.roll_groups || []`, zero iterations when absent (`web/solver.js:684`)
- `lamordia_slots` — `if (!slots.length) continue;` (`web/solver.js:720-721`)
- `thunder_forged_tiers` — `if (!tiers.length) continue;` (`web/solver.js:811-812`)

A second gate compounds the first: even a present host field mints nothing unless a pool option is on-target — the `targetSet.has(...)` filters at `web/solver.js:648`, `687`, `738`, `817`, `842`. So a fixture must supply the host field AND a ranked pool entry, or the family's meta map is empty.

Result: `ncMeta`, `rollMeta`, `vikMeta`, and `tfMeta` had size 0, no placement variable existed to float, and four of the eight "empty" assertions passed **by construction** — the test claimed to pin all eight guards on the real solve path while proving four.

Three subtleties, each worth stating exactly:

1. **Prove-red gave false comfort.** The test WAS proven red against the pre-change tree, per the standing rule. But the loop aborts at its first failing assertion (dino), so the red run demonstrated only the first materialized family. The four vacuous assertions never executed in the red run either — a combined loop's red proof is a proof of the first assertion reached, not of the loop's population.
2. **Mutation checks were equally blind.** The mutation recipe disables a guard and watches a test go red — but a mutation on a family the fixture never mints cannot turn anything red, because no variable, no float, no report, no assertion ever touches that guard.
3. **What actually caught it:** a code-review testing reviewer instrumented `buildProgram` directly against the fixture model and **read the minted meta-map sizes** — ncMeta = rollMeta = vikMeta = tfMeta = 0 — instead of trusting green. Validated independently, then fixed in-branch before merge (the review commit "fix(review): U3 fixture mints all eight families; non-vacuity assertion added", squashed into PR #323).

## Guidance

**When a test enumerates N parallel structures and asserts absence per structure, each structure needs positive evidence it EXISTS in the fixture — a count/size assertion, or a positive-arm assertion. Without it, the absence assertion is unfalsifiable for that structure.**

The shipped fix has two halves, and both are required:

1. **Complete the fixture** — add the four missing host fields plus matching pool entries (`tests/solver.test.js:4062-4082`). Each added craft option is *ranked but outvalued* by a larger same-bucket worn source, so the placement variable exists (the target gate admits it) while its gated contribution loses the bucket and stays 0 — the float opportunity is real, not decorative.
2. **Assert non-vacuity in the test itself**, so the fixture cannot silently regress (`tests/solver.test.js:4085-4087`):

```js
const program = S.buildProgram(model);
for (const mk of ["augMeta", "dinoMeta", "ncMeta", "rollMeta", "vikMeta", "sealMeta", "tfMeta", "gsMeta"]) {
  assert.ok(program[mk] && program[mk].size >= 1, `${mk} minted at least one var (fixture is non-vacuous)`);
}
```

The non-vacuity loop mirrors the absence loop one-for-one — eight meta maps guarding eight `*Placed` arrays. If a later edit (or a new minting gate in `buildProgram`, like the `targetSet.has` filters) empties any family, the test goes red at the existence check instead of passing at the absence check.

**The reviewer technique that catches this class:** run the fixture through the production builder and read the minted-structure counts (`node -e` with `buildProgram(fixtureModel)`, print each meta map's `.size`). Do not reason from the test's green result, and do not reason from the fixture's *intent* — read what the builder actually minted. This is what found the defect after both standing checks passed.

## Why This Matters

The eight guards exist because a phantom placement misleads the player (a craft they never needed) and corrupts fewer-crafts alternative counting (`tests/solver.test.js:4094-4095`). Before the fix, a regression in any of the four unminted families' guards would have shipped behind a green integration test that named all eight — the worst version of vacuous green, because the test's own text asserts the coverage it lacks.

More generally, this closes a hole between two documented checks. The prove-red rule validates that a test is new and binds *something*; the mutation check validates that a specific line is load-bearing. Neither is per-structure: a loop that is genuinely red for structure 1 and genuinely load-bearing for structures 1-4 clears both while asserting nothing about structures 5-8. Vacuity here is not a property of the test — it is a property of each (assertion, structure) pair, and only an existence assertion per structure makes every pair falsifiable.

## When to Apply

- **Any test that loops over N parallel structures asserting absence or emptiness per structure** — solver families, export formats, channels, shards, locales, feature flags. Each iteration needs a paired existence check (size/count >= 1, or a positive arm exercising that structure).
- **When the production builder mints structures conditionally** on fixture fields (host-field-present gates, on-target filters, fail-closed gates). The fixture must satisfy every minting condition per structure, and the test must prove it did.
- **When reviewing a combined loop test that was "proven red"** — ask which assertion the red run actually reached. A loop's red proof covers exactly one iteration.
- **When a mutation check comes back green on a structure-specific guard** — before concluding the guard is untested, check whether the fixture mints that structure at all; a mutation on unminted code is unkillable, not covered.
- **As a reviewer:** instrument the fixture through the production builder and read the minted counts. Green plus intent is not evidence; the builder's output is.

## Examples

- `tests/solver.test.js:4055-4096` — the fixed integration test: the eight-family craft host (`4062-4071`), ranked-but-outvalued pools (`4075-4082`), the non-vacuity loop (`4085-4087`), the absence loop (`4091-4093`).
- `web/solver.js` — the minting gates that made the original fixture vacuous: `nearly_complete` (`633-634`), `roll_groups` (`684`), `lamordia_slots` (`720-721`), `thunder_forged_tiers` (`811-812`), plus the on-target `targetSet.has(...)` filters (`648`, `687`, `738`, `817`, `842`).
- PR #323 (merged 2026-08-14) — the #319 guard work; the fixture fix landed in-branch via the review commit "fix(review): U3 fixture mints all eight families; non-vacuity assertion added".

## Related

Position in the repo's vacuity family — this doc adds what no sibling covers:

- `docs/solutions/conventions/prove-a-test-fails-against-the-pre-change-tree.md` — whole-test vacuity against the pre-change tree, plus the mutation-check addendum. **New here:** a test can honestly pass the prove-red gate AND the mutation check and still be vacuous per-structure, because a combined loop's red run proves only the first assertion reached and a mutation on an unminted structure is unkillable. That doc's gates are per-test; this defect lives per-(assertion, structure).
- `docs/solutions/conventions/stamp-shared-fixtures-for-new-required-fields.md` — the presence-shaped vs absence-shaped assertion taxonomy this doc reuses; there a fail-closed gate turned un-stamped shared-helper fixtures into excluded data, making a whole family inert. **New here:** the structures were never materialized in the first place (fixture fields absent by omission, not stripped by a schema change), the vacuity is partial (four of eight inside one loop), and the durable countermeasure is an in-test non-vacuity assertion over the checked structures — plus the reviewer technique of reading minted counts from the production builder — rather than stamping a helper.
- `docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md` — its per-source vacuity rule ("an aggregate zero-inspection assertion over N channels stays green when one channel quietly empties") is the same mechanism at the production-guard layer; this doc relocates that rule to a test's own assertions.
- `docs/solutions/design-patterns/every-solver-family-report-needs-a-load-bearing-guard.md` — the production-side rule the #319 work extended to all eight families; this doc is its test-side complement.
