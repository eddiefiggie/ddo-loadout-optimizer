---
title: Parsing DDO Wiki free-text affix lines into structured tuples
module: data-pipeline
date: 2026-07-25
problem_type: design_pattern
component: tooling
severity: medium
tags:
  - ddo
  - parsing
  - game-data
  - free-text
  - affix
  - data-pipeline
applies_when:
  - "Turning inconsistent free-text stat lines (wiki / game data) into structured (stat, type, value) tuples"
  - "Deciding item-level vs per-field eligibility for a downstream solver or filter"
  - "Building a build-time dataset generator from scraped or hand-transcribed text"
---

# Parsing DDO Wiki free-text affix lines into structured tuples

## Context

The DDO Loadout Optimizer builds a gear dataset from `ddo-item-puller`'s seed, whose `enhancements[]` field is **free text written by many wiki editors** — there is no structured `(stat, bonus_type, value)` anywhere. A best-in-slot solver needs those tuples, and a single mis-parse (wrong bonus type, wrong sign, a phantom value) silently corrupts the optimizer's output. A survey of the seed found ~460 distinct line shapes across a handful of families; the parser (`src/affix_parser.py`, U2) commits to the value-bearing families and flags the rest.

## Guidance

**1. Survey the real data before writing the regex.** Bucket every distinct line into shape families first. The families that actually occur:

- value-last `[Type] Stat +N` — the common case; leading word is a bonus type only if it's a *known* type, else it's part of the stat (`Physical Sheltering +24` → stat `Physical Sheltering`, not type `Physical`).
- trailing-parenthetical type/effect — `Disable Device +19 (Competence)`, `Damage +8 (Deadly)`, multi-stat `Defense (Sheltering) +24 (PRR/MRR)`.
- value-first base — `+5 Enhancement Bonus`, `+15% attack speed`.
- percent, no-`+` (`Seeker 9`), ML-scaling (`+1% ML1 up to +14% ML32`), and `Rolls one of: A / B / C`.
- noise (augment-slot / set tokens) and value-less named effects (`Blindness Immunity`).

**2. Recognize a bonus type only from a known set; default untyped to Enhancement.** Treat an unknown leading/parenthetical word as part of the stat, never as a type.

**3. Gate eligibility per-affix, not per-item.** An item that carries one incidental value-less line (a proc, a Mythic Boost) must still contribute its clean affixes. Route unparseable lines to a `flagged` bucket; quarantine the whole item only when it has *no* solver-eligible affix. See the plan's KTD5 in `docs/plans/2026-07-24-001-feat-ddo-loadout-optimizer-plan.md`.

**4. Do not fabricate data the source lacks.** Tiered items that encode real per-tier magnitudes (`ML3: ...`, `ML20 T2: ...`) expand into one variant per tier. Items whose tiers are described only in prose (`upgradeable: "Tiered item (ML 5/10/.../30 versions)"`) carry a single tier's stats — flag `tier_values_incomplete`, record the tier ML list, and do **not** invent per-tier values.

## Why This Matters

Two parser traps were caught in code review, both silent value corruption a solver would consume as fact:

- **Unsigned value regex flips penalties to bonuses.** `^(.*?)\s*\+?\s*(\d+)(%?)$` matched only an optional `+`, so `Concentration -50` parsed as `+50` (stat `Concentration -`). Capture the sign: `^(.*?)\s*([+-]?)\s*(\d+)(%?)$` and apply it to the value. (`src/affix_parser.py`, `_VALUE_LAST`.)
- **Greedy value-matching mints phantom affixes.** Any trailing integer became a magnitude, so `Crit 18-20/x3` → 3, `Burning Ammunition 1d8` → 8, `Randomly rolls ... Pool 2` → 2 — 11 corrupt affixes shipped in the dataset. Guard dice/crit/proc/descriptive lines and route them to `flagged` before the value-last branch runs. (`src/affix_parser.py`, `_NON_MAGNITUDE`.)

The per-affix eligibility choice is the load-bearing one: strict per-item quarantine dropped ~63% of endgame items (most carry at least one incidental value-less line); per-affix eligibility keeps ~80% of items contributing their clean affixes while still never feeding an unverified value to the solver.

## When to Apply

Any time you turn human-written stat text into machine tuples for a downstream computation: survey shape families first, whitelist the type vocabulary, gate eligibility at the finest grain the consumer needs, and never synthesize magnitudes the source didn't provide.

## Examples

Value-corruption regressions, now covered by tests (`tests/test_affix_parser.py`):

```
"Intelligence +13"        -> (Intelligence, Enhancement, 13, flat)   # untyped default
"Quality Intelligence +3" -> (Intelligence, Quality, 3, flat)        # typed leading word
"Concentration -50"       -> (Concentration, Enhancement, -50, flat) # sign preserved
"Crit 18-20/x3"           -> flagged, kind=unparsed                  # not a magnitude
"Damage +8 (Deadly)"      -> (Deadly, Enhancement, 8, flat)          # parenthetical effect
```

Per-affix eligibility (`src/verify.py`): an item with clean affixes **and** a flagged line stays `verified` and contributes its clean affixes; only an item with zero eligible affixes is `quarantined`. Result on the seed: 135 verified / 39 quarantined variants, 0 phantom affixes.

**Environment note (separate, smaller learning):** this Mac's Python is PEP-668 externally-managed, so `pip install pytest` is blocked. The project ships a stdlib-only test runner (`tests/run_tests.py`) that discovers `test_*` functions; `pytest` still works where available. Worth its own `ce-compound` run if it recurs across projects.
