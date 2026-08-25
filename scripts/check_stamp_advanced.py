#!/usr/bin/env python3
"""#467 — the build stamp must move FORWARD, not merely agree with itself.

`tests/test_build_stamp.py` pins the three stamp locations against EACH OTHER. It
pins none of them against the previously deployed value, and it cannot: that needs
history, and a unit test that reads git is a unit test that breaks in a shallow
clone. So this lives outside the suite and `.github/workflows/ci.yml` invokes it BY
PATH — the same split, and the same reasoning, as the Utility perf gate (#443).

WHAT IT CATCHES, and why "agreement" was never enough:

  1. A REVERTED stamp. `08232026.3` -> `08222026.3` across all three files is
     internally consistent, green, and deploys a footer reporting an older build
     than what is serving. One careless "take ours" on a merge conflict does it,
     and all three locations are conflict sites in exactly the merges most likely
     to hit this.

  2. A stamp that did not move AT ALL — the variant that actually fired, on
     2026-08-24, and the dangerous one because there is no conflict to resolve.
     Three branches each took `main` at `.7` and each bumped to `.8`, correctly,
     from the same base. The first merged. Merging `main` into the second produced
     NO CONFLICT on any stamp file: both sides held `.8`, git saw agreement and
     said nothing. A second player-facing change was one merge from shipping on an
     unmoved stamp with every assertion green. Nothing would have asked anyone to
     look.

WHEN A BUMP IS OWED: only when the diff touches player-facing paths
(`src/build_stamp.py` owns that list). A tests-only or docs-only PR owes nothing —
#506 and #510 were exactly that. But NO diff may move the stamp backwards, so the
directional check runs either way.

Usage:  python3 scripts/check_stamp_advanced.py <base-ref>
Exit:   0 pass, 1 the stamp did not advance (or regressed), 2 could not compare.
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src.build_stamp import parse_stamp, requires_stamp_bump, stamp_is_after  # noqa: E402
from tests.test_build_stamp import BUILD_RE  # noqa: E402


def _git(*args):
    return subprocess.run(["git", "-C", ROOT, *args], capture_output=True, text=True)


def _stamp_at(ref):
    """`const BUILD` as of `ref`, or None when the file or the value is unreadable."""
    res = _git("show", f"{ref}:web/app.js")
    if res.returncode != 0:
        return None
    m = BUILD_RE.search(res.stdout)
    return m.group(1) if m else None


def _current_stamp():
    with open(os.path.join(ROOT, "web", "app.js"), encoding="utf-8") as fh:
        m = BUILD_RE.search(fh.read())
    return m.group(1) if m else None


def main(argv):
    if len(argv) != 2:
        print(__doc__.strip().splitlines()[-3], file=sys.stderr)
        return 2
    base = argv[1]

    current = _current_stamp()
    if parse_stamp(current) is None:
        print(f"FAIL: web/app.js ships an unparseable stamp: {current!r}", file=sys.stderr)
        return 1

    previous = _stamp_at(base)
    if previous is None:
        # Refuse to inspect nothing. A base we cannot read is not a pass — it is a
        # broken check reporting success, which is how a guard becomes decorative.
        print(f"FAIL: could not read web/app.js at base ref {base!r}. This check needs"
              " real history; make sure the checkout is not shallow"
              " (actions/checkout with fetch-depth: 0).", file=sys.stderr)
        return 2

    diff = _git("diff", "--name-only", f"{base}...HEAD")
    if diff.returncode != 0:
        print(f"FAIL: could not diff {base}...HEAD:\n{diff.stderr}", file=sys.stderr)
        return 2
    changed = [ln for ln in diff.stdout.splitlines() if ln.strip()]
    owed = requires_stamp_bump(changed)

    print(f"base {base[:12]} stamp {previous} -> tree stamp {current}")
    print(f"{len(changed)} changed path(s), {len(owed)} player-facing")

    if current == previous:
        if not owed:
            print("PASS: nothing player-facing changed, so the stamp owes no bump.")
            return 0
        print(f"FAIL: the stamp is unchanged at {current}, but this branch changes"
              f" player-facing files:\n  " + "\n  ".join(sorted(owed)[:10])
              + ("\n  ..." if len(owed) > 10 else "")
              + "\n\nBump web/app.js BUILD, every ?v= in web/index.html, and README's"
                " **Current build:** line together. If you took this value from a base"
                " that has since shipped it, resolve FORWARD — not to either side.",
              file=sys.stderr)
        return 1

    if not stamp_is_after(current, previous):
        print(f"FAIL: the stamp went BACKWARDS: {previous} -> {current}."
              "\nA consistently-reverted stamp passes every tree-only assertion and"
              " deploys a footer reporting an older build than what is serving."
              "\nNote the ordering is numeric, not lexicographic: .10 follows .9.",
              file=sys.stderr)
        return 1

    print("PASS: the stamp advanced.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
