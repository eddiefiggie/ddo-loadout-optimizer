---
title: "Prove a new test fails against the pre-change tree — a green suite can cover none of the diff"
module: tests
date: 2026-08-09
problem_type: convention
component: testing_framework
severity: high
tags:
  - ddo
  - testing
  - verification
  - negative-test
  - test-fidelity
  - coverage
  - workflow
applies_when:
  - "Writing or reviewing the tests for a new unit of work before opening a PR"
  - "A test hand-builds its input instead of driving the production entry point end to end"
  - "The string an assertion looks for also appears in the test's own fixture"
  - "A test asserts an absent field, an empty array, or that nothing changed"
  - "Adding golden or parity fixtures to pin behavior a new constraint is meant to protect"
  - "A green suite is being offered as evidence that a diff is covered"
---

# A green suite is not coverage — run new tests against the pre-change tree

## Context

A credit of 7 declared as `insight` sat beside an Insight-5 ring and the tool reported 12, with the ring still equipped. Another credit, declared with the numeric **string** `"7"` instead of the number `7`, formatted into perfectly valid LP text, went through the solver, and came back out of `readSolution`'s accumulator as the headline total `"07"`.

Both shipped through a suite that was entirely green — 140 JS solver tests at the time, per #179. Neither was found by a test going red. The first was found by a code reviewer reading the diff; the second by the same review tracing the sanitizer's inputs. Both are now written into the code as warnings at `web/model.js:754-760` and `web/solver.js:52-58`.

The reason they were invisible is that all of U1's credit tests hand-built `model.credits` — the shape the solver consumes — directly. No production caller emits that shape. The real chain is `query.declaredCredits` -> `buildModel` (`web/model.js:743`) -> `normalizeCredits` (`web/model.js:777`) -> `buildProgram` (`web/solver.js:135`), and `normalizeCredits` is exactly where both defects would have been rejected: `web/model.js:798` refuses a `bonus_type` outside the curated vocabulary at `web/model.js:761-766`, and `web/model.js:796-797` refuses a non-finite, non-integer, or out-of-range value. The string case is worth stating precisely, because it is *not* a rejection: `web/model.js:785` coerces through `Number(row.value)` before those bounds apply, so `"7"` becomes `7` and passes. The defect was neutralized by coercion, not refusal — which is still a gate the tests skipped, but a different one. Every test entered the pipeline downstream of the only stretch that mattered.

That is not a one-off. Across the five plan units of the declared-stat-credits feature (#179 U1, #180 U2+U3, #181 U5, #182 U4), **five** distinct instances of "green test, zero coverage" occurred in a single day, in four different shapes:

| Shape | What the test did | Why it was green |
|---|---|---|
| Synthetic input | Built `model.credits` by hand | Skipped the normalizer where the two defects lived |
| Echo | Built a snapshot already containing `"declared, not from gear"`, asserted the export contained that literal | Proved only that the exporter echoes its input |
| Wrong surface | Four golden fixtures added to pin credited solves against the real catalog, bringing the set to ten | The fixtures exercise the optimum path; the constraint they existed to protect only binds on `tieBreak:false` |
| Unfalsifiable | `assert.deepStrictEqual(r.creditReport \|\| [], [], ...)`; "absent field stays absent"; an ordering assertion already true before its own diff | Satisfied by the pre-change behavior |

Every one was caught by an independent code review or by deliberately corrupting the code. None was caught by the suite going red.

## Guidance

**A test that claims to cover new behavior must fail against the tree as it was before the change. Run it there and confirm.**

`git archive` the base commit into a temp directory, copy the current test file in, and run it:

```bash
# Base = the commit before your change (e.g. `main`, or the merge-base of your branch).
D=$(mktemp -d -t basecmp-XXXXXX)
git archive <base-ref> | tar -x -C "$D"

# REQUIRED: web/data/ is generated and gitignored (.gitignore line 6), so
# `git archive` omits it entirely. Without this copy the suite CRASHES on a
# missing file instead of running — and a crash is not a failure. If you only
# grep the output for "FAIL", a crash reads as "no failures", i.e. as the test
# passing. That exact misread happened once during this feature.
cp -R web/data "$D/web/"

# web/vendor/ (highs.js, highs.wasm) IS tracked today, so `git archive` includes
# it; keep this line as insurance if that ever changes.
cp -R web/vendor "$D/web/"

cp tests/<changed>.test.js "$D/tests/"
cd "$D" && node tests/<changed>.test.js
echo "node exit=$?"   # read node's own status, NOT a pipeline's
```

Any test that **passes** there covers nothing of your diff.

Two details that are easy to get wrong:

1. **Check node's exit status, not a grep.** The command above pipes nothing; if you do pipe to `grep`/`tail`, `$?` is the pipeline's status, not node's. Combined with a missing-data crash, "no FAIL lines" is the single most misleading signal in this workflow.

2. **The rule is narrower than "all new tests must fail against base."** A deliberate "nothing changed when nothing is declared" regression guard *should* pass on both branches — that is its entire job. `tests/exporters.test.js:611-615` and `tests/solver.test.js:2810-2818` are exactly this: they assert an undeclared build is untouched. Telling a real coverage test apart from a legitimate no-op guard is the judgement this practice requires, and **mislabeling a no-op guard as coverage is itself one of the five failures above** — the U4 case at `tests/solver.test.js:2817` was written as a guard's assertion but presented as coverage of the new report.

When a test does pass against base and it is *not* a deliberate guard, the fix is usually one of:

- **Enter through the production entry point**, not the internal shape. A test that hand-builds the normalized structure has, by construction, opted out of normalization.
- **Import the constant from the module under test** rather than restating it in the fixture. `tests/exporters.test.js:573` now does `const { DECLARED_LABEL } = require("../web/solver.js")`, which converts two echo tests into a real cross-module contract against `web/solver.js:1025`.
- **Make absence distinguishable from emptiness.** `assert.ok(Array.isArray(r.creditReport))` before `deepStrictEqual(r.creditReport, [])` (`tests/solver.test.js:2816-2817`) is what removed the `|| []` escape hatch; `buildCreditReport` returns `[]` rather than nothing at `web/solver.js:1267`, so the field's presence is now itself the assertion.
- **Corrupt the production code** when the surface is a golden/parity fixture set rather than a unit test — see the scope limit below.

## Why This Matters

The optimizer's headline claim to a player is that a loadout is *provably optimal*. The `insight` near-miss violated two requirements in one solve and reported a number no equipment configuration could produce; a green suite asserted nothing about it either way. When the output is a number the user cannot independently check, a test suite that covers nothing is worse than no suite, because it converts "unverified" into "verified" in the author's head.

The five instances also share a property that makes them resistant to review-by-reading: each test *looks* correct in isolation. An assertion that an exporter emits `"declared, not from gear"` is exactly what you would write; it is wrong only because the fixture supplied that string. You cannot see the gap in the test file. You can only see it by running the test somewhere the behavior does not exist.

**This is a different failure from the guard learnings already documented here, and the difference is not "guards versus tests" — that cut does not survive contact with those docs.** `prove-a-guard-fails-before-trusting-it.md`'s rule 1 recipe *is* a negative test, and `corrupt-the-value-and-its-reference-together.md`'s fix is pinned by real unit tests. Both already live partly in the test layer.

The durable distinction is **what you perturb**:

| | Perturb | Why |
|---|---|---|
| `prove-a-guard-fails-before-trusting-it.md`, `corrupt-the-value-and-its-reference-together.md` | the **input** — delete a shard entry, reword a tooltip, mis-file a snapshot | the guard reads data you control from outside it |
| This learning | the **subject** — revert the code, leave the test untouched | a unit test authors its own input, so corrupting the input just edits the test |

Reverting to base is not an arbitrary choice of technique; it is the only available way to perturb the subject when the test constructs everything it consumes. That is the whole mechanism.

**One caveat, because the "no external input" claim is tempting and too strong.** It holds for the synthetic-input, echo, and unfalsifiable shapes. It does *not* hold for golden fixtures: `tests/parity/golden.json` is external, committed, and is exactly the captured reference `corrupt-the-value` governs. But instance 3 was not a corruption failure at all — the fixtures were *correct*, and the defect was that the constraint under test is inert on the path they exercise. That instance belongs to `prove-a-guard`'s rule 4 lineage (the check was never pointed at the surface where the mechanism binds), not to the corruption family.

**Most of the four shapes have ancestors in this corpus. Only one is new.**

| Shape | Prior art |
|---|---|
| Synthetic input | `docs/solutions/developer-experience/browser-verify-against-real-data-not-just-unit-tests.md` — the same failure with a worked example |
| Echo | `corrupt-the-value-and-its-reference-together.md` — "internal consistency, not correctness", one layer down |
| Wrong surface | `prove-a-guard-fails-before-trusting-it.md` rule 4 — coverage of source A is not evidence of coverage of source B |
| Unfalsifiable | none — no ancestor anywhere in `docs/solutions/` |

What is genuinely new here is the unfalsifiable shape, the base-tree procedure with its caveats, and the frame that unifies all four under a single mechanical check. Claiming more than that would invite the fair objection that this is `prove-a-guard` restated.

One case in this feature sat on the boundary and needed corruption rather than a base run, which is worth knowing as the exception. Four golden parity fixtures were added specifically to pin credited solves against the real 9045-item catalog — two credited, each with an uncredited twin — bringing the set to ten. Deleting the constraint they existed to protect — the per-bucket lower bound at `web/solver.js:900-904`, `sum(value_i * z_i) >= creditValue` — left all ten green. The fixtures solve the OPTIMUM path, where each stage maximizes its stat and the objective pulls the credit's binary to 1 unaided; the constraint only binds on `tieBreak:false` paths, which every Alternatives generator uses and the golden set never exercises (`web/solver.js:875-899`). This is recorded in the test file itself at `tests/solver_golden.test.js:73-79`, flagged as a SCOPE LIMIT verified by corruption. A base run would not have found it — the fixtures genuinely are new and genuinely do fail against base; they simply fail for a weaker reason than advertised. For a fixture set, ask *which line would I delete to make this go red*, and delete it.

## When to Apply

- **Any new or modified test claiming to cover a diff.** This is the default, not an escalation. Every one of the five instances came from ordinary, well-intentioned test writing.
- **Especially when a test constructs its own fixture** rather than driving the production entry point — the synthetic-input and echo shapes both start there.
- **Especially when the assertion is a string literal** that also appears in the fixture. Import the constant instead.
- **Especially for negative assertions** ("field absent", "nothing added", "no label") — these are true on the pre-change tree by definition unless you first assert the field exists.
- **Substitute deliberate corruption when the surface is a golden or parity fixture set**, where "does it fail against base?" answers a weaker question than "does it fail when I delete the constraint it protects?"
- **Not required for a no-op regression guard** whose stated purpose is that a path is unchanged. Label it as such so it is not counted as coverage.

This composes with two rules already in the project's instructions: run the JS tests **file by file** (`node a.js b.js` executes only the first, which has silently skipped the golden solver check before), and re-ratify a golden or parity diff deliberately rather than blanket-accepting it.

## Examples

### The recipe, verified

Running the current `tests/exporters.test.js` against `27821f8` (the parent of #179's merge — the last commit before any of this feature landed) produces exactly the split the practice predicts:

```
FAIL U3: every text export labels a declared credit as declared
FAIL U3: a declared credit is not attributed to a slot in exports
PASS U3: an undeclared build's exports carry no declared label
FAIL U4: every export that claims an optimal loadout carries the qualifier
PASS U4: an undeclared build's exports carry no qualifier
node exit=1
```

(Filtered to the credit tests — this file also holds unrelated tests from an earlier plan that share the `U3:` prefix, which is its own reason to read the names rather than count the lines.)

The three FAILs are the coverage tests, now genuinely bound to the diff. The two PASSes are the deliberate "nothing changed when nothing is declared" guards, correctly passing on both trees. That is what a healthy result looks like — not "everything fails."

Confirming the caveat above the hard way: the command that produced that listing piped `node` into `grep`, and `$?` came back **0** despite three real failures, because a pipeline reports its last stage. Run `node` unpiped, or capture its status before filtering.

### Shape 1 — synthetic input (U1)

Before, in spirit: every credit test constructed `model.credits` directly and called `buildProgram`. Production never does. Two defects lived entirely in the skipped segment, and both are now documented at the code:

- `web/model.js:754-760` — "A near-miss string is wrong-HIGH and silent: `insight` forms its own bucket key, so the credit stops competing with Insight gear and ADDS to it." Case-folding is explicitly *not* the fix, because an unrecognized type stacking additively is correct for a real type no gear carries (`Morale`); only membership in the curated list at `web/model.js:761-766` separates the legitimate case from the typo.
- `web/solver.js:52-58` — an inline `c.stat && c.value > 0` check "admitted a missing `bonus_type` ... and a numeric STRING (which formats into valid LP, then concatenates in `readSolution`'s accumulator and turns the headline total into `"07"`)."

The structural fix was to make the solver resolve the *same* sanitizer `buildModel` uses (`web/solver.js:59-62`) so the two layers cannot disagree, and to point tests at the production entry point.

### Shape 2 — echo (U3)

Two export tests hand-built a snapshot whose `breakdown` already contained `source: "declared, not from gear"`, then asserted the rendered export contained that literal. A reviewer confirmed they proved nothing by `git archive`-ing the pre-U3 tree and running them there: both passed. (A third test in the same block asserts the *absence* of the label on an undeclared build — that one is a deliberate no-op guard, not an echo test, and it correctly passes on both trees.)

The fix is recorded in the test file at `tests/exporters.test.js:569-573`:

> The label is imported from the SOLVER, not restated here. Restating it made these tests pass against the pre-U3 tree: the fixture supplied the string and the assertion looked for it, so they only proved the exporter echoes its input. Importing the constant turns them into a real cross-module contract.

The fixture at `tests/exporters.test.js:588` now interpolates `DECLARED_LABEL` imported from `web/solver.js:1025`, so renaming the label in the solver breaks the export tests, which is the contract that was supposed to exist all along.

### Shape 3 — wrong surface (U1 golden fixtures)

Covered above. The countermeasure that worked was corrupting the solver, not reasoning about coverage — and the finding is now pinned in the fixture file itself (`tests/solver_golden.test.js:73-79`), together with a meta-guard at `tests/solver_golden.test.js:46-66` asserting that the credited fixtures still *declare* credits, so a dropped declaration cannot silently turn the credited fixtures into ordinary ones.

### Shape 4 — unfalsifiable assertions (U5, U4)

- Two U5 tests asserted an absent field stays absent — true on every branch.
- The U4 test read `assert.deepStrictEqual(r.creditReport || [], [], "R3 — nothing added when nothing is declared")`. The `|| []` is satisfied by the field being **absent**, which is precisely the pre-change behavior; the test could not fail if the feature were deleted. It now reads:

  ```js
  assert.ok(Array.isArray(r.creditReport), "the field is always present, so its absence cannot pass for empty");
  assert.deepStrictEqual(r.creditReport, [], "R3 — nothing added when nothing is declared");
  ```

  (`tests/solver.test.js:2816-2817`.) Note that even fixed, this remains a no-op guard that passes against base — the first line is what makes it *honest* about being one.
- A U5 restore-ordering test asserted a source-order property that was already true before its own diff: the line it checked had landed in an earlier unit's review fix.

## Related

- `docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md` — the vacuity case for build guards; verified by corrupting input data.
- `docs/solutions/conventions/corrupt-the-value-and-its-reference-together.md` — the binding case for build guards; verified by corrupting the value and its reference together. Its core insight IS this doc's echo shape, one layer down.
- `docs/solutions/developer-experience/browser-verify-against-real-data-not-just-unit-tests.md` — the synthetic-input shape with a worked example predating this feature.
- `docs/solutions/workflow-issues/golden-solve-guard-missing-from-local-test-sweep.md` — the complement: it covers forgetting to RUN the golden guard; instance 3 here is the worse case of running it, seeing green, and having deleted the constraint it protected. That doc now carries the scope limit and points back here.
- PRs #179 (U1), #180 (U2+U3), #181 (U5), #182 (U4) — the feature these five instances came from.
- The project's testing instructions: run the JS tests file by file; re-ratify golden/parity diffs deliberately.
