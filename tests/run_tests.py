#!/usr/bin/env python3
"""Zero-dependency test runner (this Mac's python is PEP-668 externally-managed,
so pytest can't be installed). Discovers `test_*.py` modules in this directory
and runs every top-level `test_*` function. `pytest tests/` also works where
pytest is available — the test files are plain-assert functions either way.

Usage:  python3 tests/run_tests.py            # run all
        python3 tests/run_tests.py test_affix # run modules matching a substring
"""
import importlib
import os
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
sys.path.insert(0, HERE)


def discover(filter_sub=None):
    for fn in sorted(os.listdir(HERE)):
        if fn.startswith("test_") and fn.endswith(".py"):
            mod = fn[:-3]
            if filter_sub and filter_sub not in mod:
                continue
            yield mod


def run(filter_sub=None):
    """Run every discovered test, isolating each one from the rest of the run.

    Both the import and the call catch `BaseException`, not `Exception`. This
    repo raises `SystemExit` from thirteen build guards, and an unexpected trip
    used to unwind straight out of this function: no totals line, no `FAIL`,
    every later test silently skipped. Scanning the output for `FAIL` showed
    nothing, so the crash read as a pass. `KeyboardInterrupt` is the one
    exception that still stops the run — but it reports totals on the way out.
    """
    passed = failed = 0
    failures = []
    interrupted = False

    def record_failure(label):
        nonlocal failed
        failed += 1
        failures.append((label, traceback.format_exc()))
        print(f"  FAIL {label}")

    try:
        for mod_name in discover(filter_sub):
            try:
                mod = importlib.import_module(mod_name)
            except KeyboardInterrupt:
                raise
            except BaseException:  # noqa: BLE001
                # One unimportable module is one failure, not the end of the run.
                record_failure(f"{mod_name} (import)")
                continue
            for name in sorted(dir(mod)):
                if not name.startswith("test_"):
                    continue
                fn = getattr(mod, name)
                if not callable(fn):
                    continue
                try:
                    fn()
                    passed += 1
                    print(f"  PASS {mod_name}.{name}")
                except KeyboardInterrupt:
                    raise
                except BaseException:  # noqa: BLE001
                    record_failure(f"{mod_name}.{name}")
    except KeyboardInterrupt:
        interrupted = True
        print("\n  INTERRUPTED — run stopped early, totals below are partial")
    finally:
        # In a `finally` so the totals survive any escape this function did not
        # anticipate. A run that ends without them is one a reader mistakes for
        # a clean one.
        print(f"\n{passed} passed, {failed} failed")
        for name, tb in failures:
            print(f"\n----- {name} -----\n{tb}")

    return 0 if (failed == 0 and not interrupted) else 1


if __name__ == "__main__":
    sub = sys.argv[1] if len(sys.argv) > 1 else None
    sys.exit(run(sub))
