---
title: "A guard outside the CI glob is not a guard — and a snapshot you are allowed to regenerate cannot be the guard of record"
module: tests
date: 2026-08-17
problem_type: convention
component: testing_framework
severity: high
root_cause: incomplete_setup
resolution_type: test_fix
applies_when:
  - "Adding the acceptance assertions that pin a reported behavior by name, and choosing the filename they live under"
  - "A verification script is about to be justified as 'evidence, not a per-commit guard'"
  - "Arguing that golden or snapshot fixtures already own drift detection for a new mechanic"
  - "Reviewing a change that re-ratifies (re-captures) golden fixtures as part of its own diff"
  - "CI selects tests by a filename glob rather than an explicit per-file manifest"
symptoms:
  - "A deliberately re-introduced regression leaves 829/829 Python and 22 of 23 JS tests green"
  - "The single red is a snapshot fixture reporting opaque drift that names none of the affected behavior"
  - "Running the documented remedy for that red — re-capturing the golden — turns the whole gate green with the bug live"
  - "The only assertions naming the reported behavior sit outside the glob CI iterates"
  - "The snapshot's recorded fields structurally cannot express the defect (no count, no effect names)"
related_components:
  - development_workflow
  - tooling
tags:
  - ddo
  - testing
  - ci
  - test-fidelity
  - coverage
  - golden-fixtures
  - guard-placement
  - regression-guard
---

# A guard outside the CI glob is not a guard — and a snapshot you are allowed to regenerate cannot be the guard of record

## Context

Issue #343 reported that the optimizer's Utility priority never secured worn defensive toggles — Ghostly, True Seeing, Blurry, Freedom of Movement were never sought. The repo already contained assertions that named that exact behavior. They were the only assertions that the tier **secures** those toggles in a real solve — in-glob *membership* assertions naming the same six do exist (`tests/dataset.test.js:1643-1645`, `tests/test_utility_procs.py:110-112`), but they check the counting set, so a solver-cap regression leaves both green. The solve-behavior assertions lived in `tests/ae_utility_runs.js` — a path that no longer exists, because renaming it is the fix this doc documents. Every mention of it here is **historical**; the file is `tests/utility_runs.test.js` today.

That filename put them outside the glob CI runs. Both workflows enumerate the same pattern, one file per invocation:

- `.github/workflows/ci.yml:53` — `for t in tests/*.test.js; do echo "== $t =="; node "$t"; done`
- `.github/workflows/deploy.yml:39` — the identical loop
- `.github/workflows/ci.yml:42` and `deploy.yml:32` — `python3 tests/run_tests.py`

`ae_utility_runs.js` matches neither. The naming was deliberate and had a written rationale: the file was "evidence for the acceptance examples," to be re-run when the dataset or solver changed, with drift detection delegated to the golden guard. That rationale sounded reasonable and was wrong, and the way it was shown to be wrong is the transferable part.

## Guidance

**Treat "which tests actually run in CI" as a separate, independently verifiable question from "which tests exist in the repo."** A filename that a CI glob does not match is not documentation — it is a configuration flag with no error message. Nothing fails, nothing warns; the assertions simply never execute. Before you rely on a test as the guard for a named behavior, read the CI command that would run it and confirm the path matches.

**Do not delegate a named behavior to a snapshot fixture.** A golden/approval/snapshot test is a *change detector*, not a behavior specification. It answers "did anything move?" — never "is the reported behavior still correct?" Its accepted remedy for a red is *regenerating it*, which means a snapshot is structurally incapable of being the last line of defense: the standard response to its objection is to overwrite the objection. This repo makes the regeneration path explicit policy (`CLAUDE.md:77`): "A golden or parity diff after a data change is sometimes expected rather than a regression — re-ratify it deliberately, never blanket-accept." Deliberate re-ratification is the right policy *and* it is exactly the hole, because a fixture whose red names no behavior gives the re-ratifier nothing to weigh.

The concrete limit is visible in the writer. `tests/parity/capture_golden.js:118-123` snapshots four fields per fixture:

```js
solves[fx.name] = {
  status: r.status,
  perTarget: r.perTarget || null,
  effective: r.effective || null,
  chosen: chosenSorted(r),
};
```

No utility count, no effect names. `chosenSorted` (`capture_golden.js:30-34`) reduces each pick to `{slot, variant}`. So no golden diff can ever print "Ghostly is missing" — the vocabulary to say it is not in the fixture. The baseline guard (`tests/solver_golden.test.js:366-377`) compares `status` (strict), `perTarget`, and `chosen` (deep) — and notably **not** `effective`, which is snapshotted and never asserted, so one of the four recorded fields is not even a tripwire. The strongest signal *the golden comparison* can emit is therefore opaque item churn. (The same file also holds named behavioral guards that do emit named messages; those are hand-written and not regenerated by `capture_golden.js`. The limitation belongs to the golden comparison, not to the file.)

The sharpest proof is a fixture built for this very mechanic. `utility-ab-kinetic-ml34` ranks `["Kinetic Lore", "Utility effects"]`, yet its recorded `perTarget` and `effective` carry **only** `Kinetic Lore`. The utility sentinel contributes no recorded field at all, so a utility-count regression provably cannot produce a stat tell — only `chosen` churn.

**The strongest way to evaluate a safety net is to re-introduce the bug and watch the gate.** Not read the test list, not reason about coverage — put the regression back and run exactly what CI runs.

**Prefer conventional test names over expressive ones when a convention is load-bearing.** If a file must sit outside the suite (a benchmark, a harness, a generator), keep the load-bearing assertions inside a conventionally named file and let the excluded file hold only the excluded concern.

## Why This Matters

The demonstration for #343 was concrete. A reviewer inserted a plausible regression — a solver cap that stops the tier from securing the alphabetically-late toggles, re-opening the reported bug — and ran the real per-commit gate:

- `python3 tests/run_tests.py` — 829/829 green (historical: PR #350 itself removed two Python tests, so the same command reads 827 today)
- 22 of the then-23 `tests/*.test.js` files — green
- the single red: `tests/solver_golden.test.js`, reporting only `chosen`-item drift that named no utility effect
- then `node tests/parity/capture_golden.js`, the documented and legitimate remedy — and the entire per-commit gate went green **with the bug live**

The re-capture was not a cheat. PR #350 itself performed exactly that operation on 18 of 23 golden fixtures as a deliberate re-ratification (its own record: "Goldens: 18/23 loadouts moved, zero `perTarget`/`effective` value changes"). The repo's normal, correct, policy-sanctioned workflow was sufficient to clear the only red the bug produced.

Two properties combined into a hole shaped exactly like the bug:

1. The load-bearing assertions sat outside the glob CI runs, silently.
2. The only in-glob test that reddened was a snapshot whose accepted remedy is regeneration, and whose schema cannot name the broken behavior.

Either property alone is survivable. A snapshot that reddens opaquely is tolerable when a named test also fails and tells you what broke. A test outside CI is tolerable when the in-CI suite covers the same behavior. Together they produce a gate that is fully green on a shipped, user-reported regression — the worst possible failure mode, because it is indistinguishable from correctness.

The generalization: **the amount of protection a test provides is the product of whether it runs and whether its failure message names the behavior.** A snapshot scores near zero on the second factor. A file outside the glob scores zero on the first.

## When to Apply

- Any time you add a test file whose name deviates from the project's test convention — check the CI command, not your intent.
- Any time a review or plan argues that a specific test is "evidence, not a guard," or that "the golden covers drift." Both are claims about CI behavior and can be checked in one command.
- Any time a snapshot/golden/approval fixture is the only thing that fails for a behavior you care about. Ask what its schema can express; if the behavior's name is not a field, it is not covered.
- Any time you accept a golden re-capture. If the diff cannot tell you *which behavior* moved, the re-ratification is unverifiable by construction — go find or write a test that names it.
- When auditing a suite: enumerate what CI executes and diff it against what exists on disk. In this repo, `ls tests/*.test.js` yields 24 files today; before PR #350 it yielded 23, with the #343 assertions in the 24th, unrun.

## Examples

**The fix.** PR #350 (merged) renamed the file so the glob matches it:

```
git mv tests/ae_utility_runs.js tests/utility_runs.test.js
```

The PR diff records it as `rename from tests/ae_utility_runs.js` / `rename to tests/utility_runs.test.js`, similarity 91%. In the current tree `tests/ae_utility_runs.js` does not exist and `tests/utility_runs.test.js` does (203 lines). Cost of running it in CI: about 10 seconds. Issue #343 is closed.

**The file now records why its own original rationale was wrong** (`tests/utility_runs.test.js:1-15`), including the naming theory, the demonstration that disproved it, and the reason the golden could not substitute. That header is the durable artifact — the next person who wants to move assertions out of the glob reads the counter-argument first.

**What the restored test can say that the golden cannot.** `tests/utility_runs.test.js:134` names the effects directly:

```js
const TOGGLES = ["Ghostly", "True Seeing", "Blurry", "Freedom of Movement", ...];
```

and asserts against secured effects by name plus `utilityCount` deltas (lines 108-109, 193-199). Its failure output prints effect names. The golden's failure output prints variant ids.

**Adjacent hazard: skip-when-absent guards.** `web/data/items.json` is a generated artifact and gitignored (`.gitignore:6` — `web/data/`), so a fresh clone runs the JS suite without it. This repo carries a standing warning that a missing dataset can make a crash read as a pass, and the pattern that would cause it is real and present: `tests/dataset.test.js:188-189` returns `null` when the file is absent (`// generated artifact; skip when absent`) and sixteen call sites then print `(skipped — web/data/items.json not built)` and pass.

One honest correction to how this was first framed in-session: the silent-skip risk does *not* currently apply to the #343 test, and in `dataset.test.js` the skip guard is shadowed. Both files read the dataset unguarded before any skip logic can help — `tests/dataset.test.js:8-9` at module load, and `tests/utility_runs.test.js:50` inside an async IIFE whose terminal handler is `.catch((e) => { console.error(e); process.exit(1); })` (line 203). A missing dataset therefore throws `ENOENT` and exits non-zero in both. That makes the current behavior loud, and it makes `dataset.test.js`'s null-vocabulary skip effectively unreachable. The lesson stands as a design warning rather than an active defect here: **a "skip when the input is absent" guard converts a missing precondition into a pass, and its blast radius is per-file** — whether the suite is loud depends on some *other* file crashing first, which is not a property you want to depend on.

**Limits of the evidence.** The demonstration used one plausible regression, chosen because it reproduced the reported symptom. It was not an exhaustive mutation sweep. It proves the hole exists and that the normal workflow walks through it; it does not measure how many other behaviors sit behind the same hole. A mutation pass over the solver would be the way to bound that, and has not been run.

## Related

- Issue #343 (closed) — Utility tier counts no worn defensive toggles
- PR #350 (merged) — the #343 fix plus the `tests/*.test.js` rename
- Issues #349 and #348 (open) — the widening lever and the pinned nice-to-have container, both downstream of the same tier work
- `CLAUDE.md:75` — the companion trap: `node a.js b.js` runs only the first file, which has hidden the golden solver check before. Same family of failure — a test that exists and does not run.
- `docs/solutions/workflow-issues/golden-solve-guard-missing-from-local-test-sweep.md` — refreshed alongside this doc. Its re-ratification safety check ("the diff is contained to the fixtures you expected to change" and "no priority target regressed") is **the check that passed while this bug was live**: the drift was `chosen`-only, so neither clause had a stat tell to catch it.
- `docs/solutions/conventions/prove-a-test-fails-against-the-pre-change-tree.md` — refreshed alongside this doc as the sixth instance in its running catalog, and the first whose mechanism sits outside the test layer entirely. Its gates ask whether a test is new and binding; this one was both, and still never ran.
- `docs/solutions/conventions/assert-non-vacuity-for-every-surface-in-a-loop-test.md` — the adjacent axis: an assertion that executes but binds nothing. Here the assertion bound correctly and was never executed.
- `docs/solutions/conventions/measure-the-counterfactual-before-crediting-your-fix.md` — the other convention banked from this arc. Both were found the same way: by running the configuration nobody had run.
