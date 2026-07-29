---
title: "Verify the JS test suite with the full per-file loop, not `... | tail -1`"
module: tests
date: 2026-07-28
problem_type: developer_experience
component: tooling
severity: medium
tags:
  - testing
  - verification
  - ci
  - github-pages
  - false-green
  - ddo
applies_when:
  - "Sanity-checking JS tests locally before pushing (e.g. after a feature or refactor)"
  - "A local test run looked green but the CI 'Run JS tests' step failed on the same commit"
  - "Piping a test file's output through `tail -1` / `tail -n` to read just the pass count"
---

# Verify the JS test suite with the full per-file loop, not `... | tail -1`

## Context

The JS test files here use a hand-rolled harness: on a failing assertion it prints a
`FAIL ...` line and sets `process.exitCode = 1`, but it **keeps running** and still
prints a `N passed` summary at the end (counting only the passes). So a file with 3
failures and 26 passes prints its FAIL lines *and then* `26 passed` as its last line.

While shipping the Thunder-Forged / Green Steel scaffolding, local checks were run per
file as `node tests/results.test.js 2>&1 | tail -1`. `tail -1` shows only the final
`26 passed` line — it **discards the FAIL lines above it** — so the run read as green.
It wasn't: a `craftChips` edit called `maps.tfByItem.get(...)` on a `maps` object the
standalone unit tests don't populate, throwing and failing three tests. CI caught it
(its deploy failed on the merge, so the live site never updated); the local shortcut
had hidden it. See [[github-pages-deploy-static-site-with-build]] for how the deploy
gates on this same test step.

## Guidance

Verify the JS suite the way CI does — iterate every file and honor exit codes — not by
eyeballing a tail-piped pass count:

```bash
# What CI runs (.github/workflows — the deploy gate):
set -e
for t in tests/*.test.js; do echo "== $t =="; node "$t"; done
```

For a quick local pass/fail read that surfaces failures instead of hiding them:

```bash
for t in tests/*.test.js; do
  out=$(node "$t" 2>&1); code=$?
  if [ "$code" -ne 0 ] || echo "$out" | grep -q 'FAIL'; then
    echo "FAIL: $t"; echo "$out" | grep 'FAIL'
  else
    echo "ok: $t ($(echo "$out" | tail -1))"
  fi
done
```

Two independent signals here — the process **exit code** and a `grep -q 'FAIL'` — because
the harness's exit code alone is the authoritative one, and `grep` gives a human-readable
reason. Never reduce a suite's verdict to its last printed line.

## Why This Matters

`tail -1` on this harness is a **false-green generator**: the passing summary is *always*
the last line whether or not tests failed, so the one line you keep is the one line that
can't tell you the run failed. A green local check that's actually red gets pushed,
breaks the CI deploy, and the live site silently stays on the old build — the failure
surfaces later and further from its cause. Checking the full output (or better, exit
codes) keeps "looks green locally" and "is green in CI" the same fact.

Also note the loop covers **every** `tests/*.test.js`. The ad-hoc local checks that day
named only four files (solver, model, browse, results) and missed `alternatives`,
`attribution`, `breakdown`, and `tabs`. Globbing like CI removes the "which files do I
run?" guesswork entirely.

## When to Apply

- Any local verification of the JS suite before committing or pushing.
- Whenever a run "passed" locally but CI's `Run JS tests` step failed on the same commit —
  suspect a masked failure first.
- Any time you're tempted to pipe test output through `tail`, `head`, or a summary grep
  to shorten it: shorten by filtering *for* failure signals, never by keeping only the
  trailing summary.

## Examples

```bash
# ❌ Hides FAIL lines — the pass summary is always last, so this reads green even when red
node tests/results.test.js 2>&1 | tail -1
# → "26 passed"   (three FAILs printed above were discarded)

# ✅ Full output — FAIL lines are visible, exit code is honored
node tests/results.test.js; echo "exit=$?"
# → prints each "FAIL ..." line, then "26 passed", then "exit=1"
```

The fix that day was a one-liner (guard `maps.tfByItem`/`maps.gsByItem` like the existing
`jokerByHost`/`membershipByHost` lines), but it should have been caught locally. The
verification method, not the code, was the gap.
