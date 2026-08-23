#!/usr/bin/env bash
#
# Run the JS suite the way CI runs it. Use this instead of a bare `for` loop.
#
# Closes two hazards, both of which have already cost a real defect:
#
#   1. `node a.js b.js` executes ONLY the first file and silently skips the
#      rest -- that hid the golden solver check once. Hence one file per
#      invocation, and `set -e` so the sweep STOPS on the first red file
#      instead of scrolling it past a wall of PASS lines.
#
#   2. `web/data/items.json` is generated and gitignored. dataset.test.js and
#      browse.test.js read it at module top level, so a missing dataset makes
#      them throw on require. A bare loop discards that exit code, so the
#      crash reads as a pass. This builds the dataset when it is absent --
#      the same thing ci.yml does before either suite -- and says so.
#
set -euo pipefail

cd "$(dirname "$0")/.."

DATASET="web/data/items.json"

if [ ! -f "$DATASET" ]; then
  echo "== $DATASET absent -- building it first (generated + gitignored) =="
  python3 build_dataset.py
  echo
fi

for t in tests/*.test.js; do
  echo "== $t =="
  node "$t"
done

echo
echo "== all JS test files passed =="
