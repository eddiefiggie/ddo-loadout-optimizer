---
title: Python tests must be top-level functions — TestCase classes silently run zero
module: tests
date: 2026-08-09
problem_type: developer_experience
component: testing_framework
severity: high
tags:
  - testing
  - verification
  - false-green
  - unittest
  - ci
  - ddo
applies_when:
  - Adding a new Python test file to tests/
  - A new test file was added and the suite total did not move
  - Porting tests in from another project or another agent's output
---

# Python tests must be top-level functions — TestCase classes silently run zero

## Context

While adding coverage for #205, a new `tests/test_spell_focus.py` was written using
`unittest.TestCase` classes — the shape most Python projects use, and the shape a
model reaches for by default. It ran clean:

```
$ python3 -m unittest tests.test_spell_focus
Ran 26 tests in 0.000s
OK
```

Then the project suite was run, and the total was **432 passed** — exactly what it
had been *before* the file existed. Twenty-six tests had been written, they passed
under `unittest`, and the project runner executed **none of them**.

Nothing failed. No import error, no warning, no skipped-test notice. The file was
discovered, imported successfully, and contributed zero.

## Guidance

**Write Python tests here as module-level `test_*` functions using plain `assert`.
Do not use `unittest.TestCase` classes.**

`tests/run_tests.py` is a zero-dependency runner (this Mac's python is
PEP-668 externally-managed, so pytest cannot be installed). Its discovery is:

```python
for mod_name in discover(filter_sub):
    mod = importlib.import_module(mod_name)
    for name in sorted(dir(mod)):
        if not name.startswith("test_"):
            continue
        fn = getattr(mod, name)
        if not callable(fn):
            continue
        fn()
```

It walks **module-level names** and calls each `test_*` with no arguments. A class
named `TestUniversalDetection` does not start with `test_`, so it never matches;
its methods are never reached. The module imports fine, the loop finds nothing,
and the run is green.

```python
# ❌ Silently contributes zero
class TestUniversalDetection(unittest.TestCase):
    def test_both_names_are_recognized(self):
        self.assertTrue(spell_focus.is_universal("Spell Focus Mastery"))

# ✅ Runs
def test_both_names_are_recognized():
    assert spell_focus.is_universal("Spell Focus Mastery")
```

**Verify by the count, not by the exit code.** After adding a test file, check that
the suite total moved by the number of tests you wrote:

```bash
python3 tests/run_tests.py | tail -1          # 469 passed, 0 failed
python3 tests/run_tests.py spell_focus | tail -1   # 27 passed, 0 failed
```

The substring filter is the fast confirmation that a specific new file is being
picked up.

## Why This Matters

**This failure mode is worse than a failing test, because a failing test is
information.** Zero-collected reads identically to all-passing: same exit code,
same "0 failed", no diagnostic anywhere. The only visible signal was a total that
did not move, and a total is exactly the number nobody checks when it is green.

**It reaches CI.** The deploy workflow's gate is `python3 tests/run_tests.py` —
the same runner — so `TestCase` tests do not run there either. A change could ship
with its entire test file inert while both local and CI checks report green. Note
the runner's docstring says pytest also works; pytest *would* collect TestCase
classes, which makes this trap worse rather than better — a contributor who
verifies with pytest sees the tests run, and the gate that decides deploys does
not.

**It is the exact shape a model or a porting contributor produces by default.**
`unittest.TestCase` is the standard-library idiom. Writing it here is not
carelessness; it is the reasonable default silently disagreeing with a local
convention. That makes it recurring rather than one-off.

This is the authoring-side companion to
[verify-js-tests-with-full-loop-not-tail](./verify-js-tests-with-full-loop-not-tail.md),
which covers the reading side of the same class: a suite verdict that looks green
because the signal that would have said otherwise was discarded. Both reduce to
the same rule — **do not accept a test suite's summary as evidence that your tests
ran.**

## When to Apply

- Any time a Python test file is added to `tests/`. Check the total moved.
- When tests are ported in from another project, another repo's conventions, or
  generated output — the incoming shape is unlikely to match this runner.
- When a change "has tests" but the suite total is unchanged since before it.
- When a test passes under `python3 -m unittest` but you have not confirmed it
  under `python3 tests/run_tests.py`. The first proves the assertions hold; only
  the second proves the project will ever run them.

## Examples

**The observed sequence, in full:**

| Step | Suite total |
|---|---|
| Before the new file existed | 432 passed |
| After adding 26 `TestCase`-based tests | **432 passed** — unchanged |
| After converting them to top-level functions | 458 passed |

**Demonstrating the discovery gap directly** — what the runner sees when handed a
module containing only a `TestCase`:

```python
matched = [n for n in sorted(dir(mod))
           if n.startswith("test_") and callable(getattr(mod, n))]
# -> []   (0 tests run, no error raised)
```

The existing suite follows the correct shape; `tests/test_umbrella.py` is the
nearest model to copy when starting a new file.
