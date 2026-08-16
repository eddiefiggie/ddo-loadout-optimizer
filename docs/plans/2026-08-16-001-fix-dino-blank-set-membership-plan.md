---
title: Dino Blank Set Membership - Plan
type: fix
date: 2026-08-16
topic: dino-blank-set-membership
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Dino Blank Set Membership - Plan

## Goal Capsule

- **Objective:** Close #334 — the eleven synthesized Dinosaur Bone blank hosts gain "The Legendary Dread Isle's Curse" set membership, matching the wiki.
- **Product authority:** Issue #334 (wiki evidence hard-confirmed 2026-08-16: https://ddowiki.com/page/Dinosaur_Bone_Items — every crafted item's enchantment list, including the Rune Arm's, ends with the set).
- **Stop conditions:** surface rather than guess if the set machinery treats a synthesized host differently from a native carrier in a way the stamp cannot express.

## Product Contract

### Summary

Stamp `The Legendary Dread Isle's Curse` on all eleven Dinosaur Bone blank hosts so the solver counts them as set pieces — dissolving the false trade where the set lived only on non-hosting native Attuned Bone items while the insert slots lived only on set-less blanks.

### Requirements

- R1. Every synthesized Dinosaur Bone blank host (Belt, Boots, Bracers, Gloves, Necklace, Ring, Helmet, Cloak, Weapon, Armor, Rune Arm) carries `The Legendary Dread Isle's Curse` and counts as a real piece toward it in solves.
- R2. Set definitions stay gear-planner-sourced — this is host membership only; no def re-harvest, no new set data.
- R3. Native Attuned Bone items are unchanged.
- R4. The change ships with the three-way build bump; goldens re-ratify deliberately if any solve shifts.

### Key Decisions

- **Stamp in the synthesis, not the seed data.** (session-settled: user-approved — the blank records are built by logic (`src/dino.py`) from the relocated layout (`src/dino_native.py`); membership is a property of every blank per the wiki, so it belongs in the record builder, one line-of-truth, not repeated per layout entry.)
- **Legendary tier only — verified, not assumed.** All eleven blanks are ML 31; no heroic blanks exist in the synthesis, so no heroic set variant question arises (verified against the built dataset during planning).

### Sources / Research

- Issue #334 — wiki evidence and dataset state.
- `src/dino_native.py` (host layout), `src/dino.py` (blank record builder — no `sets` key today), `build_dataset.py` ~457-465 and ~945-950 (blanks appended to variants; `membership_mod.attach_dino_set_bonus_slots(dino_blanks, membership_defs)` is the existing post-processing precedent).
- `web/data/items.json`: `membership_set_defs` already contains `The Legendary Dread Isle's Curse`; 149 native carriers show the expected `sets` list shape.

## Planning Contract

### Key Technical Decisions

- KTD1. **The stamp attaches the full native field chain, not a bare `sets` list.** The solver reads `variant.set_bonus` (intrinsic pieces) and `variant.parsed_set_bonuses` (tier registration) — a bare `sets` list is inert, and the pipeline stage that derives those fields for natives (planner set-markers → catalog `set_bonus` attach at `build_dataset.py` ~664-686 → `set_parser.annotate_variant` at ~777) runs **before** blanks are appended (~945). So the blank builder (or a post-build step beside it) sets all three: `sets`, `set_bonus` = a **deep copy** of the catalog definition (the never-share-mutable-defs rule), and `parsed_set_bonuses` via `set_parser.annotate_variant`. The def name must match `membership_set_defs` byte-exactly.
- KTD2. **Verification is solve-level, not just data-level:** a fixture proves a blank actually completes the 5-piece set with four native carriers — the test pins that the stamp reaches `setsActive`.
- KTD3. **An intrinsically-carried set leaves the blank's Set-Bonus membership pool.** The Armor/Helmet/Cloak blanks' `set_membership_slot` pool includes Dread Isle; once they carry it intrinsically, a membership pick could make one item count as two pieces (the single-identity constraint covers picks and hosted copies, not the intrinsic piece). Filter the intrinsic set out of each blank's pool, matching the one-set-identity-per-item precedent. If a future wiki ruling shows the in-game Set Bonus augment double-counts on an already-cursed item, revisit deliberately — modeling it conservatively today invents nothing.

### Assumptions

- The set machinery treats a stamped blank exactly like a native carrier (`realPieces` counts equipped variants whose `sets` include the def). If a synthesized-host special case surfaces, stop per the Goal Capsule.

## Implementation Units

### U1. Stamp membership on the blanks

**Goal:** All eleven blanks carry the set and count toward it.

**Requirements:** R1, R2, R3. Implements KTD1, KTD2.

**Dependencies:** none.

**Files:** `src/dino.py`, `src/membership.py` (pool filter), `build_dataset.py` (if the stamp lands as a post-build step beside the append), `tests/test_dino.py`, `tests/solver.test.js`.

**Approach:** Stamp the full field chain per KTD1 (deep-copied catalog `set_bonus`, `parsed_set_bonuses` via `set_parser.annotate_variant`, plus `sets`), in or immediately after the blank-record builder — populated before the blanks are appended to variants. Filter the intrinsic set out of the Armor/Helmet/Cloak blanks' `set_membership_slot` pool (KTD3, in `attach_dino_set_bonus_slots` or at pool construction). Rebuild; confirm all eleven blanks carry the three fields shaped like native carriers and `membership_set_defs` is unchanged. JS fixture: Dinosaur Bone Rune Arm + four native carriers in distinct worn slots at ML31 (5 pieces total — the def's threshold) with the set's granted stat ranked → the set activates and the blank is a counted piece.

**Execution note:** Prove the new tests red against the pre-change tree (copy the gitignored `web/data/items.json` into the scratch export first).

**Test scenarios:**
- Happy (Python): every blank record carries exactly `["The Legendary Dread Isle's Curse"]`; native Attuned Bone records unchanged.
- Happy (JS, Covers R1): the Rune Arm blank + four native carriers (5 pieces, the def's `pieces_required`) activate the set in a solve; the set's stat credits.
- Edge: the def name in the stamp matches `membership_set_defs` byte-exactly (a typo means silent no-membership — pin with an assertion against the built defs).
- Edge: blanks' other synthesis fields (dino slots, augment slots) unchanged; the Armor/Helmet/Cloak `set_membership_slot` pools no longer contain the intrinsic set (Covers KTD3).
- Integration: one equipped blank never counts as two Dread Isle pieces (solve-level assertion — intrinsic piece + membership pick cannot both fire from one item).
- Edge: a blank's `set_bonus` def is a deep copy — mutating one blank's copy does not leak into the catalog or sibling records.

**Verification:** `python3 tests/run_tests.py` green; changed JS test files green individually; fresh dataset inspected.

### U2. Ship

**Goal:** Verified end to end and deployed.

**Requirements:** R4.

**Dependencies:** U1.

**Files:** `web/index.html`, `web/app.js`, `README.md`, `tests/parity/golden.json` (only if re-ratification is needed).

**Approach:** Full suites (JS file-by-file). Golden diff: solves may legitimately shift where the set now completes via a blank — re-ratify per fixture, never blanket; ranked-stat values must never decrease. Three-way build bump. PR closes #334 with a one-line player-facing note (the dino Rune Arm now counts toward the Dread Isle set).

**Test scenarios:** Test expectation: none — ship mechanics; U1 carries the behavior tests and `tests/test_build_stamp.py` enforces the bump.

**Verification:** All suites green; live footer shows the new build after merge.

## Verification Contract

| Gate | Command | Applies to |
|---|---|---|
| Python suite | `python3 tests/run_tests.py` | U1 |
| JS suite (file-by-file) | `for t in tests/*.test.js; do node "$t"; done` | U1, U2 |
| Prove-red | base-commit scratch export + `web/data/items.json` copied in | U1 |
| Golden re-ratify (if shifted) | `node tests/parity/capture_golden.js`, per-fixture review | U2 |
| Build stamp | `tests/test_build_stamp.py` | U2 |

## Definition of Done

- Both units landed; CI green on `main`; #334 closed with the wiki evidence cited.
- All eleven blanks carry the set in a fresh dataset; the Rune Arm solve fixture passes.
- Golden changes (if any) re-ratified per fixture; three-way bump shipped and live-verified.
