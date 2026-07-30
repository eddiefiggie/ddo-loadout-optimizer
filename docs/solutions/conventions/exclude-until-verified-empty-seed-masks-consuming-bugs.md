---
title: An exclude-until-verified empty seed masks bugs in the code that consumes it
module: data-pipeline
date: 2026-07-30
problem_type: convention
component: build-pipeline
severity: medium
tags:
  - exclude-until-verified
  - seed-gate
  - test-coverage
  - module-global
  - statefulness
  - build-dataset
applies_when: "shipping a feature wired behind an empty exclude-until-verified seed, or reviewing tests that only exercise the empty-seed default"
---

# An exclude-until-verified empty seed masks bugs in the code that consumes it

## Context

The optimizer ships several features "wired but inert until a seed is populated" — artifacts, alignment restrictions, and (this session) the boolean-feature allowlist all follow the exclude-until-verified convention: the shipping seed is empty (`[]`), so the consuming code is a no-op until a wiki harvest lands. This keeps unverified data out of the app.

The trap: while the seed is empty, the code path that consumes it is **never exercised**. Its unit tests pass against the empty default, the build is green, review approves — and a latent bug sits dormant until the day real data arrives. The empty seed is a *false green*.

This bit the boolean-feature allowlist (PR #53). `build_dataset.build()` installs the allowlist onto a module-level global in `src/affix_parser.py` (`set_boolean_features`). With an empty seed, `build()` set it to an empty set — a no-op — so it never mattered that `build()` did not restore the global afterward. Several tests call `build()` in-process (`test_dino`, `test_nearly_complete`, `test_augments`, `test_joker_sets`, …), and `src/set_parser.py` and `src/dino_parser.py` both route their clause text through `affix_parser.parse_line`. The moment the seed was populated with 24 real toggles, an in-process `build()` left the populated allowlist in shared parser state, and later tests that expected a value-less clause (e.g. `"Ghostly"`, `"Immunity to Fear"`) to quarantine instead saw it parse as a boolean affix — **order-dependent** failures that passed in isolation. A code reviewer had predicted the statefulness hazard; the empty seed had masked it from every test run.

## Guidance

1. **Test the populated path, not just the inert default.** When a feature is gated behind an exclude-until-verified seed, add at least one test that runs the consuming code with a small fixture seed (or a directly-installed value). The empty-seed test proves the gate is closed; it proves nothing about the behavior the feature exists to deliver.

2. **Scope any global a build installs — install then restore.** `build()` is called in-process by the test suite and shares module state with everything else in the process. A module-level global it mutates must be snapshotted and restored, never left set:

   ```python
   # build_dataset.build()
   _prev = affix_parser_mod.get_boolean_features()      # snapshot
   affix_parser_mod.set_boolean_features(load_boolean_features())
   # ... expand_dataset + set/dino annotation (all call parse_line) ...
   affix_parser_mod.set_boolean_features(_prev)          # restore before return; don't leak
   ```

3. **Add a leak regression test.** Run `build()` in-process and assert the shared global returns to its prior state and the default behavior is intact:

   ```python
   before = get_boolean_features()
   build_dataset.build({"metadata": {}, "items": []})
   assert get_boolean_features() == before          # build() did not leak its scoped allowlist
   assert parse_line("Ghostly")["kind"] == "unparsed"   # empty-default behavior restored
   ```

## Why This Matters

Both failure modes here are silent under an empty seed: the leak (no data to leak) and any soundness/format bug in how the consuming code handles real entries. "Wired but inert" is a deployment state, not a tested state. Treating a green empty-seed suite as verification of the feature is how a latent bug ships to `main` and only surfaces weeks later when the harvest lands — far from the change that introduced it. A fixture-seed test moves that discovery back to the PR that wrote the code.

The module-global variant is especially sharp because `build()` doubles as a test helper: any process-global it leaves mutated becomes cross-test contamination whose symptom (which test fails) depends on run order, making it look flaky rather than deterministic.

## When to Apply

- Shipping or reviewing any feature behind an empty exclude-until-verified seed (`artifacts.json`, `alignment_restrictions.json`, `boolean_features.json`, and future seeds).
- Any time `build()` — or another routine the test suite calls in-process — installs state onto a module-level global consumed elsewhere.
- Reviewing a PR whose new behavior is only covered by tests that run against the empty/default seed.

## Examples

**Masked (false green):** `boolean_features.json` shipped as `[]`; the parser emit, solver flow, and rendering all had tests, but every test ran with the allowlist empty. The build-scope leak was invisible and review-approved. Populating the seed later broke two unrelated parser tests order-dependently.

**Verified:** the fix scoped the global (install/restore, per Guidance 2), added the leak regression test (Guidance 3), and the boolean parser tests install a fixture allowlist in `try/finally` so they exercise the *populated* path (`set_boolean_features(["Salt"])` → assert presence affix) rather than only the empty default.

See also `data/seed/boolean_features.json` and `data/seed/artifacts.json` (both exclude-until-verified seeds), and the harvest that populated them in PR #53.
