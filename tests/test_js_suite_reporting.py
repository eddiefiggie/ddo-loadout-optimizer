"""#782 — every JS test file must report its FAILURES, not only its passes.

A file that prints `353 passed` on a run containing a `FAIL` is not lying to CI —
`process.exitCode` was always correct — it is lying to a human reading the output.
That is a real failure mode: on 2026-09-18 a red `solver.test.js` printed
`353 passed` as its last line, was read as green, and only CI caught it. The same
session hit it again on `vocabulary_migration.test.js` (`35 passed`, exit 1).

`scripts/run_js_tests.sh` is the backstop and it works, but it is defeated by any
reader who pipes the output — `| tail`, `| head`, a CI log viewer showing the last
lines — and what they see is a number that reads like a clean result.

WHY THIS IS A GUARD AND NOT A DATE. "Every JS test file reports its failures" is a
claim about a population that is fully readable at build time, so it is asserted
rather than announced (AGENTS.md: *a completeness claim needs a guard, not a
date*). The next test file added is then a review event instead of a discovery
during an incident.

Stdlib-only and text-level on purpose: this suite has no JS runtime, and reading
the source is exactly the check — the claim is about what every file CONTAINS.
"""
import glob
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS_TESTS = sorted(glob.glob(os.path.join(ROOT, "tests", "*.test.js")))

_COUNTER = re.compile(r"\blet\s+passed\s*=\s*0\s*,\s*failed\s*=\s*0\s*;")
_INCREMENT = re.compile(r"\bfailed\+\+")
_EXIT = re.compile(r"process\.exitCode\s*=\s*1")
_SUMMARY = re.compile(r"console\.log\(`[^`]*\$\{failed\}[^`]*`\)")


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def test_there_are_js_test_files_to_inspect():
    """Refuse to inspect zero records: an empty glob would make every assertion
    below pass vacuously, which is the shape of guard this repo does not keep."""
    assert len(JS_TESTS) >= 30, f"expected the JS suite, found {len(JS_TESTS)} files"


def test_every_js_test_file_declares_a_failure_counter():
    missing = [os.path.basename(p) for p in JS_TESTS if not _COUNTER.search(_read(p))]
    assert not missing, (
        "these JS test files count passes but not failures: " + ", ".join(missing)
        + " — follow tests/saved-bundles.test.js: `let passed = 0, failed = 0;`")


def test_every_js_test_file_names_its_failures_in_its_summary():
    """The defect itself: a summary that reports only `${passed} passed`."""
    missing = [os.path.basename(p) for p in JS_TESTS if not _SUMMARY.search(_read(p))]
    assert not missing, (
        "these JS test files print a summary that cannot report a failure: "
        + ", ".join(missing)
        + " — a run containing a FAIL would end on a line that reads clean")


def test_every_failure_path_increments_the_counter():
    """A counter that is declared and never incremented reports 0 failed forever,
    which is worse than not reporting at all: it states a falsehood rather than
    omitting a fact.

    Keyed off `process.exitCode = 1`, which is this suite's one marker of a failure
    path. `augment-pin.test.js` has three — two harnesses and a setup abort that
    returns early, and the abort is the one that matters most, because it prints the
    summary on its way out."""
    problems = []
    for path in JS_TESTS:
        src = _read(path)
        incs = len(_INCREMENT.findall(src))
        exits = len(_EXIT.findall(src))
        if incs < max(exits, 1):
            problems.append(
                f"{os.path.basename(path)}: {exits} failure path(s) but only "
                f"{incs} increment(s)")
    assert not problems, (
        "a failure path that does not increment the counter: " + "; ".join(problems))


def test_the_exit_code_contract_is_untouched():
    """#782 is a REPORTING fix. Every file must still mark the process failed, and
    this pins that the reporting change did not become a behaviour change.

    `saved-bundles.test.js` is the exception and was already correct before #782: it
    calls `process.exit(1)` outright rather than setting `exitCode`."""
    missing = []
    for path in JS_TESTS:
        src = _read(path)
        if _EXIT.search(src) or "process.exit(1)" in src:
            continue
        missing.append(os.path.basename(path))
    assert not missing, (
        "these JS test files no longer fail the process on a failed test: "
        + ", ".join(missing))
