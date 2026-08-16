---
title: "Rebuild web/data/items.json from the current tree before any golden capture"
date: 2026-08-16
category: workflow-issues
module: tests
problem_type: workflow_issue
component: testing_framework
severity: high
symptoms:
  - "A golden capture drifted a pre-existing fixture entry (endgame-caster-ml32) with no solver or data change in the diff"
  - "node tests/solver_golden.test.js failed on two fixtures even at the base commit"
  - "The working tree's gitignored web/data/items.json had been built from a different branch earlier the same day"
applies_when:
  - "Running tests/parity/capture_golden.js to add or re-ratify a golden fixture"
  - "Diagnosing a solver_golden failure or an unexpected golden diff"
  - "Working in a checkout where another branch's session may have rebuilt the dataset"
tags: [golden, parity, dataset, items-json, provenance, capture]
related_components:
  - tests/parity/capture_golden.js
  - build_dataset.py
---

# Rebuild web/data/items.json from the current tree before any golden capture

## Context

While adding a golden fixture on the `feat/339-340-augment-ceiling-and-bundles` branch (PR #341), the first capture drifted the pre-existing `endgame-caster-ml32` entry even though the diff touched no solver or data code. The gitignored `web/data/items.json` in the working tree had been built hours earlier from a *different* branch (`fix/334-dino-blank-sets`, whose pipeline stamps set membership onto Dinosaur Bone blanks) — so the "current" dataset silently answered for a tree it didn't belong to. Two independent workers confirmed the same signature: `tests/solver_golden.test.js` failed identically on the pristine base-commit export, proving the drift predated the diff.

## Guidance

Before any golden capture or ratification — `node tests/parity/capture_golden.js`, or trusting a `solver_golden` verdict — rebuild the dataset from the tree you are on:

```bash
python3 build_dataset.py
```

`web/data/items.json` is generated and gitignored, so git gives no signal that it belongs to another branch. Treat it as branch-scoped build output, not durable state.

Diagnostic rule: **a golden diff that reproduces on the pre-change tree is dataset provenance, not your change.** Export the base commit to scratch, copy the suspect `items.json` in, and run the golden test there — identical failures mean the dataset, not the diff, moved the solves.

## Why This Matters

Golden ratification is deliberate, per-fixture, and trusted downstream — a capture run against a foreign dataset either produces a false drift you might wrongly ratify, or masks a real one. The byte-identical invariant for pre-existing entries (the conditional-widening pattern) is only meaningful when the dataset is the current tree's own build.

## When to Apply

- Every capture run, unconditionally — the rebuild is cheap relative to a mis-ratified golden.
- Any session that switches between branches whose pipelines produce different datasets.
- Triaging CI-vs-local golden disagreements (CI always builds its own dataset; local trees may not have).

## Related

- `docs/solutions/workflow-issues/golden-solve-guard-missing-from-local-test-sweep.md` — running the golden guard at all; this doc is about feeding it the right dataset.
- `docs/solutions/conventions/prove-a-test-fails-against-the-pre-change-tree.md` — the scratch-export technique reused here for the provenance A/B check (copy the gitignored dataset in first, or the crash reads as a pass).
- PR #341 (where the trap fired and was diagnosed); PR #336 (the branch whose dataset had leaked into the tree).
