"""Isolation guard for the test runner itself (#233).

`tests/run_tests.py` is the sole Python gate in both CI workflows, and it was
the one component in the tree with no coverage — every other test module is run
*by* it. That gap hid a runner that could stop early and read as clean:

  * `except Exception` does not catch `BaseException`, and this repo raises
    `SystemExit` from thirteen build guards. An unexpected trip escaped the
    handler and unwound out of `run()`.
  * `importlib.import_module` sat outside every handler, so one typo'd import
    in one test file took the whole remaining suite with it.

In both cases the totals line never printed, no `FAIL` appeared, and every
later test was silently skipped — so the natural check (scan the output for
`FAIL`) showed nothing and the crash read as a pass. That is the exact failure
mode `docs/solutions/conventions/prove-a-test-fails-against-the-pre-change-tree.md`
warns about, and it fired while proving a test against the pre-change tree.

These tests drive the real runner as a subprocess over throwaway fixture
modules, so they assert what an operator actually sees: the totals line, the
counts, and that work *after* the offending module still ran.
"""
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
RUNNER = os.path.join(HERE, "run_tests.py")

PASSES = "def test_that_passes():\n    assert True\n"
ASSERTION_FAILURE = (
    "def test_a_genuine_regression():\n"
    "    assert 1 == 2, 'a real failure the run must still report'\n"
)


def _run_fixture_suite(modules):
    """Run the real runner over `modules` ({name: source}) in a temp tree.

    Returns `(returncode, combined_output)`. The runner discovers relative to
    its own location, so copying it into the fixture directory is what scopes
    the child run to these modules and nothing else.
    """
    with tempfile.TemporaryDirectory() as tmp:
        tests_dir = os.path.join(tmp, "tests")
        os.makedirs(tests_dir)
        shutil.copy(RUNNER, tests_dir)
        for name, source in modules.items():
            with open(os.path.join(tests_dir, name + ".py"), "w", encoding="utf-8") as fh:
                fh.write(source)
        proc = subprocess.run(
            [sys.executable, os.path.join(tests_dir, "run_tests.py")],
            capture_output=True, text=True, timeout=120,
        )
        return proc.returncode, proc.stdout + proc.stderr


def test_an_unexpected_systemexit_is_reported_not_allowed_to_abort_the_run():
    code, out = _run_fixture_suite({
        "test_aaa_ok": PASSES,
        "test_bbb_guard": (
            "def test_trips_a_build_guard_it_did_not_mean_to():\n"
            "    raise SystemExit('value_corrections: recorded source value moved')\n"
        ),
        "test_ccc_later": ASSERTION_FAILURE,
    })
    assert "1 passed, 2 failed" in out, (
        "the run must survive an unexpected SystemExit and report it as a "
        f"failure; got:\n{out}"
    )
    assert "FAIL test_ccc_later.test_a_genuine_regression" in out, (
        "a genuine failure in a module ordered after the SystemExit must still "
        f"run and be reported; got:\n{out}"
    )
    assert code != 0, "a run with failures must exit non-zero"


def test_a_module_that_fails_to_import_does_not_take_the_suite_with_it():
    code, out = _run_fixture_suite({
        "test_aaa_ok": PASSES,
        "test_bbb_broken": "import a_module_that_does_not_exist\n" + PASSES,
        "test_ccc_later": PASSES,
    })
    assert "2 passed, 1 failed" in out, (
        "a module that cannot be imported is one failure, not the end of the "
        f"run; got:\n{out}"
    )
    assert "PASS test_ccc_later.test_that_passes" in out, (
        f"modules after an unimportable one must still run; got:\n{out}"
    )
    assert code != 0, "an unimportable test module must fail the run"


def test_a_zero_exit_inside_a_test_cannot_make_the_run_report_success():
    """The CI-green hole: `SystemExit(0)` used to unwind with returncode 0.

    No guard raises a bare exit today (all thirteen carry a message, so they
    exit 1), which is exactly why this is worth pinning — it is one bare
    `sys.exit()` away from a green CI run over a suite that never finished.
    """
    code, out = _run_fixture_suite({
        "test_aaa_ok": PASSES,
        "test_bbb_exits_zero": "def test_exits_zero():\n    raise SystemExit(0)\n",
        "test_ccc_later": PASSES,
    })
    assert code != 0, (
        f"a test raising SystemExit(0) must not make the run succeed; got:\n{out}"
    )
    assert "2 passed, 1 failed" in out, f"got:\n{out}"


def test_the_totals_line_is_printed_for_an_ordinary_clean_run():
    code, out = _run_fixture_suite({"test_aaa_ok": PASSES})
    assert "1 passed, 0 failed" in out, f"got:\n{out}"
    assert code == 0, "a clean run must exit zero"
