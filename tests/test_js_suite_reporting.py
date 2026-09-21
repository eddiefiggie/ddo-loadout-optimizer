"""#782, then #853 — the JS suite reports its FAILURES, and does so from ONE runner.

A file that prints `353 passed` on a run containing a `FAIL` is not lying to CI —
`process.exitCode` was always correct — it is lying to a human reading the output.
That is a real failure mode: on 2026-09-18 a red `solver.test.js` printed
`353 passed` as its last line, was read as green, and only CI caught it.

#782 fixed that in every file by hand and this guard pinned each file's counter,
summary and exit-code line. #853 replaced the forty-three copies of the runner
with `tests/_harness.js`, so the claim moves: every JS test file uses the
harness and carries NO counter, summary or exit of its own, and the harness —
the one place a reporting defect can now live — declares the failure counter,
increments it on every failure path, names both counts in its summary, and
marks the process failed. The next test file added is still a review event
rather than a discovery during an incident, and the next reporting fix is one
edit instead of forty-three.

WHY THIS IS A GUARD AND NOT A DATE. "Every JS test file reports its failures" is a
claim about a population that is fully readable at build time, so it is asserted
rather than announced (AGENTS.md: *a completeness claim needs a guard, not a
date*). Stdlib-only and text-level on purpose: this suite has no JS runtime, and
reading the source is exactly the check.
"""
import glob
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS_TESTS = sorted(glob.glob(os.path.join(ROOT, "tests", "*.test.js")))
HARNESS = os.path.join(ROOT, "tests", "_harness.js")

_REQUIRE = re.compile(r'require\("\./_harness"\)')
_LOCAL_COUNTER = re.compile(r"\blet\s+passed\s*=\s*0|\bfailed\+\+|\bpassed\+\+|\bpassed\s*\+=\s*1")
_LOCAL_RUNNER = re.compile(r"^(?:async\s+)?function\s+\w+\s*\(\s*name\s*,\s*fn\s*\)|^const\s+\w+\s*=\s*(?:async\s+)?\(\s*name\s*,\s*fn\s*\)\s*=>", re.M)
_LOCAL_EXIT = re.compile(r"process\.exitCode\s*=|process\.exit\(")
_LOCAL_SUMMARY = re.compile(r'process\.on\("exit"|\$\{passed\}\s+passed')

_H_COUNTER = re.compile(r"\bcounts\.failed\+\+")
_H_EXIT = re.compile(r"process\.exitCode\s*=\s*1")
_H_SUMMARY = re.compile(r"console\.log\(`[^`]*\$\{counts\.passed\}\s+passed,\s+\$\{counts\.failed\}\s+failed[^`]*`\)")
_H_HANDLER = re.compile(r'process\.on\("exit",')


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _code_only(src):
    """Source with comments removed, so a guard's own prose cannot trip it (the
    first draft of the JS twin of this file matched its assertion message)."""
    src = re.sub(r"/\*[\s\S]*?\*/", "", src)
    return re.sub(r"//[^\n]*", "", src)


def test_there_are_js_test_files_to_inspect():
    """Refuse to inspect zero records: an empty glob would make every assertion
    below pass vacuously, which is the shape of guard this repo does not keep."""
    assert len(JS_TESTS) >= 30, f"expected the JS suite, found {len(JS_TESTS)} files"
    assert os.path.exists(HARNESS), "tests/_harness.js is the runner every file requires"


def test_every_js_test_file_uses_the_one_harness():
    missing = [os.path.basename(p) for p in JS_TESTS if not _REQUIRE.search(_read(p))]
    assert not missing, (
        "these JS test files do not require ./_harness: " + ", ".join(missing)
        + ' — `const { test } = require("./_harness");`')


def test_no_js_test_file_carries_its_own_counter_runner_summary_or_exit():
    """The inverse of the #782 pin: a local copy is where the next reporting defect
    would live, out of sight of the one place this file checks."""
    problems = []
    for path in JS_TESTS:
        name = os.path.basename(path)
        if name == "suite-reporting.test.js":
            # The JS twin of this file: its regex literals QUOTE the forbidden
            # shapes in order to forbid them. It still has to require the harness
            # (the test above), which is the half of the rule that applies to it.
            continue
        src = _code_only(_read(path))
        if _LOCAL_COUNTER.search(src):
            problems.append(f"{name}: a local pass/fail counter")
        if _LOCAL_RUNNER.search(src):
            problems.append(f"{name}: a local test runner")
        if _LOCAL_EXIT.search(src):
            problems.append(f"{name}: sets the exit code or exits the process itself (use fail())")
        if _LOCAL_SUMMARY.search(src):
            problems.append(f"{name}: prints its own summary or registers an exit handler")
    assert not problems, "; ".join(problems)


def test_the_harness_declares_and_increments_the_failure_counter():
    src = _code_only(_read(HARNESS))
    assert _H_COUNTER.search(src), "the harness must count failures"
    # Every failure path marks the process failed, and every such path counts.
    exits = len(_H_EXIT.findall(src))
    incs = len(_H_COUNTER.findall(src))
    assert exits >= 1, "the harness must set process.exitCode = 1 on a failure"
    assert incs >= exits, f"{exits} failure path(s) but only {incs} increment(s)"


def test_the_harness_names_both_counts_in_an_exit_handler_summary():
    """The defect itself, #782 (`N passed` on a red run) and #826 (a summary at a
    fixed position): both counts, from an exit handler, once."""
    src = _code_only(_read(HARNESS))
    assert _H_HANDLER.search(src), "the summary must print from process.on('exit')"
    assert _H_SUMMARY.search(src), "the summary must name both `passed` and `failed`"


def test_the_exit_code_contract_is_untouched():
    """#782 is a REPORTING fix and #853 a relocation. A failed test must still mark
    the process failed — through the harness — so scripts/run_js_tests.sh stops."""
    src = _code_only(_read(HARNESS))
    assert _H_EXIT.search(src)
    # And the runner script still stops on the first red file, which is what
    # turns that exit code into a stopped sweep.
    sh = _read(os.path.join(ROOT, "scripts", "run_js_tests.sh"))
    assert "set -e" in sh or "set -euo" in sh, "run_js_tests.sh must stop on a non-zero exit"
