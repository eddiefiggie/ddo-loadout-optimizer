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
    passed = failed = 0
    failures = []
    for mod_name in discover(filter_sub):
        mod = importlib.import_module(mod_name)
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
            except Exception:  # noqa: BLE001
                failed += 1
                failures.append((f"{mod_name}.{name}", traceback.format_exc()))
                print(f"  FAIL {mod_name}.{name}")
    print(f"\n{passed} passed, {failed} failed")
    for name, tb in failures:
        print(f"\n----- {name} -----\n{tb}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sub = sys.argv[1] if len(sys.argv) > 1 else None
    sys.exit(run(sub))
