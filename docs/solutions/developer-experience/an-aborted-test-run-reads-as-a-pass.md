---
title: "An aborted test run reads as a pass — isolate every test and always print totals"
module: tests
date: 2026-08-10
problem_type: developer_experience
component: testing_framework
severity: high
tags:
  - ddo
  - testing
  - verification
  - false-green
  - ci
  - test-runner
  - exception-handling
applies_when:
  - "Writing or changing a test runner, harness, or any loop that reports an aggregate verdict"
  - "A test suite ended without printing its totals line and the output contained no failures"
  - "Working in a codebase where guards raise SystemExit or another BaseException deliberately"
  - "A suite total is lower than expected but nothing reported a failure"
  - "Catching exceptions around code that may call sys.exit or raise SystemExit"
---

# An aborted test run reads as a pass — isolate every test and always print totals

## Context

`tests/run_tests.py` is the zero-dependency runner this project uses locally and as the
sole Python gate in both CI workflows (`.github/workflows/ci.yml`,
`.github/workflows/deploy.yml`). It had exactly one guarded region:

```python
try:
    fn()
    passed += 1
    print(f"  PASS {mod_name}.{name}")
except Exception:          # <- does not catch BaseException
    failed += 1
    ...
```

`SystemExit` inherits from `BaseException`, not `Exception`, so it walked straight
through that handler and unwound out of `run()`. This repo raises it deliberately from
**thirteen** build guards across four files — `src/untyped_rankable.py` (3),
`src/value_corrections.py` (1), `src/name_corrections.py` (2), and `build_dataset.py`
(7). Tests that *expect* one wrap it in a `_raises` helper and were always fine. The
failure mode was an **unexpected** trip: a test tripping a guard it did not mean to
trip killed the run.

A second hole sat one line up. `importlib.import_module` was outside every handler, so
anything raised at import time did the same thing — and the everyday version of that is
not an exotic guard, it is **one typo'd import in one test file**.

In both cases the totals line never printed, no `FAIL` ever appeared, and every later
test was silently skipped. The natural check — scan the output for `FAIL` — showed
nothing, so the run read as clean.

The bug was found *by* the method in
[prove-a-test-fails-against-the-pre-change-tree](../conventions/prove-a-test-fails-against-the-pre-change-tree.md),
while deliberately reverting `_iter_affix_dicts` to confirm a new test would go red.
That doc already warns "a crash is not a failure … a crash reads as 'no failures'" about
a *missing generated-data file*. This is the same sentence one level up: the runner
itself could produce the crash. Fixed in PR #237 (issue #233).

## Guidance

**A runner must isolate each unit and must always report.** Three rules, each of which
was violated here:

**1. In a guard-heavy codebase, `except Exception` is not a catch-all.** Guards raise
`BaseException` subclasses on purpose — `SystemExit` is the idiomatic "stop the build"
signal. Catch `BaseException` at the isolation boundary, and re-raise the one case that
should still stop everything:

```python
try:
    fn()
except KeyboardInterrupt:
    raise                      # Ctrl-C still stops the run
except BaseException:          # noqa: BLE001
    record_failure(label)      # a guard trip is one failure, not the end
```

**2. Every unit the loop iterates needs the same isolation — including the import.**
An isolation boundary that covers the call but not the setup is not a boundary. One
unimportable module is one failure; the run continues to the next.

**3. The verdict must survive an abort.** Print totals from a `finally`, and return
non-zero when the run was *interrupted* as well as when something failed:

```python
finally:
    print(f"\n{passed} passed, {failed} failed")
return 0 if (failed == 0 and not interrupted) else 1
```

Without the `finally`, any escape converts into silence. Without the interrupted flag, a
`SystemExit(0)` — one bare `sys.exit()` away — exits **0** and takes CI green over a
suite that never finished. No guard in this repo raises a bare exit today; all thirteen
carry a message, so they exit 1. That is a property of the current guards, not of the
runner, which is exactly why it is worth pinning with a test.

**Test the runner from outside itself.** A test that raises `SystemExit` to prove the
runner survives it cannot live inside the run it is testing. Drive the real runner as a
subprocess over throwaway fixture modules in a `tempfile` dir, and assert what an
operator actually sees — the totals line, the counts, and that work *after* the
offending module still ran. See `tests/test_run_tests_runner.py`.

## Why This Matters

**The component that decides whether coverage passed was the one component with no
coverage.** Every other test module in this repo is run *by* `run_tests.py`, so the
runner sits outside the thing it certifies. That is a structural blind spot, not an
oversight: no amount of adding tests closes it, because adding tests adds subjects, not
observers. Any project with a hand-rolled runner has this hole by default.

**A silent abort is strictly worse than a failure**, for the same reason recorded in
[python-tests-must-be-top-level-functions](./python-tests-must-be-top-level-functions.md):
a failure is information, and silence is indistinguishable from success. This project's
worst output is a wrong number, because a wrong number looks exactly like a right one
inside a finished loadout — and a green gate over an unrun suite is the mechanism that
lets one ship.

**These three now form a family**, all reducing to *do not accept a suite's summary as
evidence that your tests ran*:

| Doc | Mechanism | What was lost |
|---|---|---|
| [python-tests-must-be-top-level-functions](./python-tests-must-be-top-level-functions.md) | Discovery skipped `TestCase` classes | Tests never collected |
| [verify-js-tests-with-full-loop-not-tail](./verify-js-tests-with-full-loop-not-tail.md) | `\| tail -1` discarded the `FAIL` lines | Failures collected but not read |
| This doc | The run aborted mid-suite | Tests never reached, verdict never printed |

The first two are answered by checking the total moved. This one defeats that check too —
there is no total to read. The only durable answer is a runner that cannot end quietly.

## When to Apply

- Writing or modifying any runner, harness, or batch loop that aggregates a pass/fail
  verdict across units.
- Wrapping code that may call `sys.exit()` or raise `SystemExit` — build guards,
  argument parsers, migration scripts — in what is meant to be a catch-all.
- A suite ends with no totals line. Treat that as a failed run, never as a clean one;
  the absence of `FAIL` proves nothing.
- A suite total drops and nothing reports a failure. Something aborted or was never
  collected.
- Reviewing a `except Exception` in a codebase whose conventions include deliberate
  `SystemExit`.

## Examples

Observed against an isolated copy of the real runner, with three fixture modules —
one passing, one offending, one containing a genuine `AssertionError` ordered after it:

| Fixture raises | Before | After |
|---|---|---|
| `SystemExit("msg")` | aborts; downstream `AssertionError` never runs; no totals; exit 1 | `1 passed, 2 failed`; both reported; exit 1 |
| `SystemExit(0)` | aborts; no totals; **exit 0** | `2 passed, 1 failed`; exit 1 |
| `import a_module_that_does_not_exist` | aborts the whole remaining suite; no totals | `2 passed, 1 failed`; later modules still run; exit 1 |
| `KeyboardInterrupt` | aborts; no totals | `INTERRUPTED`, partial totals, exit 1 |

The `KeyboardInterrupt` row is deliberately not covered by a test — a test that raises it
would stop the suite proving it. It was verified by hand against a scratch copy.

**Proving the regression tests were real**, per the standing convention: they were
written and run while `run_tests.py` was still unmodified.

```
FAIL test_a_module_that_fails_to_import_does_not_take_the_suite_with_it
FAIL test_a_zero_exit_inside_a_test_cannot_make_the_run_report_success
FAIL test_an_unexpected_systemexit_is_reported_not_allowed_to_abort_the_run
PASS test_the_totals_line_is_printed_for_an_ordinary_clean_run
1 passed, 3 failed
```

The fourth is a deliberate happy-path control and passes on both sides — the exception
the convention allows for "nothing changed" guards.

## Related

- [prove-a-test-fails-against-the-pre-change-tree](../conventions/prove-a-test-fails-against-the-pre-change-tree.md) — the method that surfaced this bug; its "a crash reads as a pass" warning names this exact mechanism at the data-fixture level.
- [python-tests-must-be-top-level-functions](./python-tests-must-be-top-level-functions.md) — the authoring-side sibling; same runner, same false-green outcome, different mechanism.
- [verify-js-tests-with-full-loop-not-tail](./verify-js-tests-with-full-loop-not-tail.md) — the reading-side sibling on the JS suite.
- [golden-solve-guard-missing-from-local-test-sweep](../workflow-issues/golden-solve-guard-missing-from-local-test-sweep.md) — the invocation-side version: `node a.js b.js` runs only the first file.
