"""Isolation and empty-run guards for the test runner itself (isolation: #233).

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
An overall run with no tests must also fail without inventing a test result.
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


def _run_fixture_suite(modules, filter_sub=None):
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
        command = [sys.executable, os.path.join(tests_dir, "run_tests.py")]
        if filter_sub is not None:
            command.append(filter_sub)
        proc = subprocess.run(
            command,
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


def _assert_empty_run_failed(code, out):
    assert code == 1, f"an empty run must fail, got exit {code}:\n{out}"
    assert "FAIL no tests ran" in out, f"the empty run must be explained:\n{out}"
    assert "discovery" in out and "filter" in out, f"got:\n{out}"
    assert out.strip().endswith("0 passed, 0 failed"), (
        f"keep honest test totals instead of inventing a failed test:\n{out}"
    )
    assert "Traceback" not in out and "NoneType: None" not in out, f"got:\n{out}"


def test_an_unmatched_module_filter_fails_the_run():
    code, out = _run_fixture_suite({"test_selected": PASSES}, "selcted")
    _assert_empty_run_failed(code, out)
    assert "PASS test_selected" not in out, f"the unmatched module ran:\n{out}"


def test_a_genuinely_empty_suite_fails_the_run():
    _assert_empty_run_failed(*_run_fixture_suite({}))


def test_modules_without_callable_tests_fail_the_run():
    code, out = _run_fixture_suite({
        "test_helper": "print('HELPER IMPORTED')\ndef helper():\n    pass\n",
        "test_values": "test_number = 7\ntest_disabled = None\ntest_text = 'unused'\n",
    })
    _assert_empty_run_failed(code, out)
    assert "HELPER IMPORTED" in out, f"the fixture modules must be imported:\n{out}"


def test_class_methods_alone_do_not_make_the_run_successful():
    code, out = _run_fixture_suite({
        "test_class_only": (
            "class TestExample:\n"
            "    def test_nested(self):\n"
            "        assert False, 'class methods are not collected'\n"
        ),
    })
    _assert_empty_run_failed(code, out)


def test_selecting_only_empty_modules_fails_even_when_other_modules_have_tests():
    code, out = _run_fixture_suite({
        "test_aaa_helper": "test_value = 7\n",
        "test_bbb_real": PASSES,
    }, "helper")
    _assert_empty_run_failed(code, out)
    assert "PASS test_bbb_real" not in out, f"the filter must still apply:\n{out}"


def test_a_successful_substring_selection_still_passes():
    code, out = _run_fixture_suite({
        "test_aaa_other": ASSERTION_FAILURE,
        "test_bbb_selected": PASSES,
    }, "selected")
    assert code == 0 and "1 passed, 0 failed" in out, f"got:\n{out}"
    assert "PASS test_bbb_selected.test_that_passes" in out, f"got:\n{out}"
    assert "test_aaa_other" not in out and "no tests ran" not in out, f"got:\n{out}"


def test_empty_modules_beside_real_tests_do_not_fail_the_run():
    code, out = _run_fixture_suite({
        "test_aaa_helper": "test_value = 7\n",
        "test_bbb_real": PASSES,
        "test_ccc_empty": "",
    })
    assert code == 0 and "1 passed, 0 failed" in out, f"got:\n{out}"
    assert "FAIL" not in out, f"empty helpers are allowed beside real tests:\n{out}"


def test_an_empty_filter_still_runs_all_modules():
    code, out = _run_fixture_suite({
        "test_aaa_real": PASSES,
        "test_bbb_real": PASSES,
    }, "")
    assert code == 0 and "2 passed, 0 failed" in out, f"got:\n{out}"


def test_an_import_failure_without_any_test_calls_keeps_its_original_totals():
    code, out = _run_fixture_suite({"test_broken": "raise ImportError('broken fixture')\n"})
    assert code == 1 and "0 passed, 1 failed" in out, f"got:\n{out}"
    assert "FAIL test_broken (import)" in out and "ImportError: broken fixture" in out, f"got:\n{out}"
    assert "no tests ran" not in out, f"an existing failure needs no empty-run failure:\n{out}"


def test_an_assertion_failure_without_passes_keeps_its_original_totals():
    code, out = _run_fixture_suite({"test_broken": ASSERTION_FAILURE})
    assert code == 1 and "0 passed, 1 failed" in out, f"got:\n{out}"
    assert "FAIL test_broken.test_a_genuine_regression" in out, f"got:\n{out}"
    assert "no tests ran" not in out, f"a failed test is not an empty run:\n{out}"


def test_a_zero_exit_at_import_is_still_a_failure_and_later_tests_run():
    code, out = _run_fixture_suite({
        "test_aaa_exit": "raise SystemExit(0)\n",
        "test_bbb_later": PASSES,
    })
    assert code == 1 and "1 passed, 1 failed" in out, f"got:\n{out}"
    assert "FAIL test_aaa_exit (import)" in out, f"got:\n{out}"
    assert "PASS test_bbb_later.test_that_passes" in out, f"got:\n{out}"


def test_an_interrupt_at_import_keeps_partial_totals_without_empty_run_diagnostic():
    code, out = _run_fixture_suite({
        "test_aaa_interrupt": "raise KeyboardInterrupt\n",
        "test_bbb_later": PASSES,
    })
    assert code == 1 and "0 passed, 0 failed" in out, f"got:\n{out}"
    assert "INTERRUPTED" in out and "partial" in out, f"got:\n{out}"
    assert "test_bbb_later" not in out and "no tests ran" not in out, f"got:\n{out}"


def test_an_interrupt_during_a_test_stops_later_work_and_preserves_partial_totals():
    code, out = _run_fixture_suite({
        "test_aaa_first": PASSES,
        "test_bbb_interrupt": (
            "def test_aaa_interrupt():\n    raise KeyboardInterrupt\n"
            "def test_bbb_not_reached():\n    print('SHOULD NOT RUN')\n"
        ),
        "test_ccc_later": PASSES,
    })
    assert code == 1 and "1 passed, 0 failed" in out, f"got:\n{out}"
    assert "INTERRUPTED" in out and "partial" in out, f"got:\n{out}"
    assert "SHOULD NOT RUN" not in out and "test_ccc_later" not in out, f"got:\n{out}"
    assert "no tests ran" not in out, f"got:\n{out}"
