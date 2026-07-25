---
title: Solver Correctness Fixes - Plan
type: fix
date: 2026-07-25
topic: solver-correctness-fixes
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Solver Correctness Fixes - Plan

## Goal Capsule

- **Objective:** Fix the two correctness bugs the Milestone 2 code review found in the loadout solver so it never returns an invalid or wrongly-valued best-in-slot set.
- **Product authority:** User (owner).
- **Open blockers:** None.

---

## Product Contract

### Summary

Two bounded fixes to the exact worn-item solver: (1) weapon slots must be mutually exclusive so the solver can't equip several weapons at once, and (2) a capped target stat (dodge) with no contributing item must report 0, not the cap value. Both are in the already-built `web/model.js` / `web/solver.js`; the loadout still solves optimally afterward.

### Requirements

- R1. The solver never selects more than one main-hand weapon in a single loadout (crossbow types are mutually exclusive); a rune-arm may occupy its own off-hand slot.
- R2. A capped target stat with zero eligible contributing sources reports an effective value of 0 (not the cap), and no phantom item is implied.
- R3. Existing solver behavior is otherwise unchanged — stacking, dodge-cap clamp, lexicographic priority, dominance pruning, and determinism all still hold (regression-guarded by the existing suites).

---

## Planning Contract

**Product Contract preservation:** N/A — new bootstrap plan; scope is the two code-review correctness findings.

### Key Technical Decisions

- KTD1. **Merge weapon-category variants into one main-hand slot.** In `web/model.js` `buildModel`, replace the per-weapon-type slot groups with a single main-hand group (cardinality 1) holding all `category === "weapon"` variants, and keep `category === "runearm"` as its own separate off-hand slot. This makes the crossbow types mutually exclusive (the bug was one independent `<= 1` slot per weapon type) while leaving the rune-arm slot legitimate. Dominance pruning then runs over the merged main-hand candidate set.
- KTD2. **Constrain a capped stat to 0 when it has no sources.** In `web/solver.js` `encodeStage`, when `rawExpr(stat)` is empty, still emit a constraint pinning `d_<stat> <= 0` instead of skipping it — otherwise the continuous cap var floats up to the cap under the maximizing objective. Keep the existing `d <= raw` path unchanged when sources exist.

---

## Implementation Units

### U1. Weapon-slot exclusivity

- **Goal:** One main-hand weapon per loadout; rune-arm separate.
- **Requirements:** R1, R3
- **Dependencies:** none
- **Files:** `web/model.js`, `tests/model.test.js`
- **Approach:** In `buildModel`, stop creating one slot per distinct weapon `slot` value. Instead build a single group `{ slot: "Main Hand", cardinality: 1, variants: <all category==="weapon" eligible+dominance-pruned> }`, and a separate `{ slot: "Rune Arm", cardinality: 1, variants: <category==="runearm">}`. Dominance pruning applies to the merged main-hand set (its variants now compete in one slot). Leave worn-item and augment handling untouched.
- **Execution note:** Add the failing exclusivity test first, then make the model change.
- **Patterns to follow:** the existing worn-slot group construction and `dominanceFilter` call in `buildModel`.
- **Test scenarios:** Given three weapon variants of different crossbow types that each carry a distinct target affix, the built model exposes them in ONE main-hand group with cardinality 1 (not three independent slots). After a solve (in the U1 model-level test or an added solver fixture), at most one weapon variant is selected. A rune-arm variant remains selectable in its own slot alongside the chosen main-hand weapon. The best single weapon for the ranked targets is still chosen (no regression in weapon value).
- **Verification:** the model never yields >1 main-hand weapon; existing `tests/model.test.js` still green.

### U2. Capped stat with no source reports 0

- **Goal:** A capped target with no contributing item reports 0, not the cap.
- **Requirements:** R2, R3
- **Dependencies:** none
- **Files:** `web/solver.js`, `tests/solver.test.js`
- **Approach:** In `encodeStage`, the capped-stat loop currently guards the `d_<stat> <= raw` constraint behind `if (raw.length)`. When `raw` is empty, emit `d_<stat> <= 0` instead of skipping, so the continuous cap variable cannot float up to its bound under the maximizing objective. The clamp path (`d <= raw` and `d <= cap`) stays exactly as-is when sources exist.
- **Execution note:** Add the failing no-source test first (assert effective Dodge is 0), then make the encoder change.
- **Patterns to follow:** the existing `d_<stat>` clamp encoding and Bounds emission in `encodeStage`.
- **Test scenarios:** Given a query targeting Dodge with an armor type set (so a cap applies) but no eligible item providing Dodge, the solve returns effective Dodge = 0 (not the cap). The existing dodge-cap clamp test (item present, effective = cap) still passes. Lexicographic behavior with a zero-valued capped priority still locks it at 0 and optimizes lower priorities normally.
- **Verification:** the no-source capped stat reports 0; all existing `tests/solver.test.js` fixtures still green.

---

## Verification Contract

| Gate | How | Applies to |
|---|---|---|
| Weapon exclusivity | `tests/model.test.js`: merged main-hand group cardinality 1; solve selects <= 1 weapon; rune-arm still separate | U1 |
| Capped no-source | `tests/solver.test.js`: Dodge target + armor + no dodge item -> effective 0; existing clamp test still passes | U2 |
| No regression | Full suite: `python3 tests/run_tests.py` and `node tests/{browse,model,solver}.test.js` all green | U1, U2 |
| End-to-end | The ML-34 flagship query still solves optimally in the browser after both fixes | U1, U2 |

---

## Definition of Done

- The solver never returns more than one main-hand weapon; rune-arm remains a separate slot.
- A capped target with no eligible source reports 0.
- New tests for both bugs pass; every existing Python + JS suite stays green; the flagship query still solves.

---

## Scope Boundaries

### Deferred to Follow-Up Work

- Code-review finding #3 (results "Contributes" column overstates affixes superseded under stacking — highest-value UX fix), #4 (null `minimum_level` bypasses the ML cap), #5 (`scaleAt` / `scaledValue` scaling-formula duplication), #6 (`d_<stat>` LP name breaks on a space-containing capped stat — latent).
- Set-bonus and augment optimization (the standing Milestone 2 v1 boundary).
