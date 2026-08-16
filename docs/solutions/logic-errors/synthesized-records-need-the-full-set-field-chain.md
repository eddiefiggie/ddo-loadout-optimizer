---
title: "A synthesized item record needs the full set field chain — a bare sets list is inert to the solver"
date: 2026-08-16
category: logic-errors
module: dataset_pipeline
problem_type: logic_error
component: testing_framework
severity: high
symptoms:
  - "All eleven Dinosaur Bone blank hosts missing 'The Legendary Dread Isle's Curse' membership despite the wiki listing it on every crafted dino item (#334)"
  - "The set lived only on non-hosting native Attuned Bone items while the insert-hosting blanks were set-less, creating a false trade in solves"
root_cause: missing_workflow_step
resolution_type: code_fix
tags: [set-bonus, synthesized-records, dino, pipeline-ordering, deep-copy, membership-pool]
related_components:
  - src/dino.py
  - src/membership.py
---

# A synthesized item record needs the full set field chain — a bare sets list is inert to the solver

## Problem

The eleven Dinosaur Bone blank hosts are synthesized by logic (`src/dino.py`) rather than harvested, and shipped without set membership — so the solver saw "The Legendary Dread Isle's Curse" only on native carriers and never on the insert-hosting blanks, a false trade the wiki contradicts. Fixed on the PR #336 branch (`fix/334-dino-blank-sets`, closing #334), unmerged as of this writing.

## Symptoms

- A blank host never counted as a set piece, even though every crafted dino item's in-game enchantment list ends with the set.
- Completing the set required avoiding the blanks — the opposite of how the crafting works in game.

## What Didn't Work

**Stamping a bare `sets` list.** The obvious fix — append the set name to a `sets` array on each blank — is inert: the solver reads `variant.set_bonus` (intrinsic pieces) and `variant.parsed_set_bonuses` (tier registration), and the pipeline stages that derive those fields for native items run **before** the synthesized blanks are appended to the variant list. A blank stamped with only `sets` looks like a member in the data and contributes nothing in a solve. (Caught at plan review as a P0 — the plan was rewritten before implementation.)

## Solution

Stamp the **full native field chain** in (or immediately after) the blank-record builder, so the records enter the variant list already shaped like native carriers:

- `sets` — the membership list;
- `set_bonus` — a **deep copy** of the catalog definition (never share the mutable def object across records);
- `parsed_set_bonuses` — via the same parser natives go through (`set_parser.annotate_variant`), with the def name matching `membership_set_defs` byte-exactly.

And close the double-count hole the stamp opens: a blank whose Set-Bonus membership pool includes its now-intrinsic set could count one item as two pieces — filter the intrinsic set out of that blank's `set_membership_slot` pool (`src/membership.py`), per the one-set-identity-per-item precedent.

## Why This Works

Synthesized records bypass every enrichment stage that runs during the normal pipeline pass; anything a native record gets derived, a synthesized record must be given explicitly. Stamping the same three fields the solver actually reads — shaped identically to a native carrier and verified at solve level (a fixture proving the blank completes the set with four native pieces) — makes the synthesized host indistinguishable from a harvested one.

## Prevention

- When synthesizing records appended after pipeline enrichment, enumerate the fields the *consumer* reads (not the fields the seed data carries) and populate all of them; a data-level assertion ("the field is present") is not the test — a solve-level assertion ("the set activates") is.
- Deep-copy any catalog definition attached to multiple records; a shared mutable def is a cross-record aliasing bug waiting for the first mutation.
- When a record gains an intrinsic identity that also appears in one of its pick-pools, remove it from the pool in the same change.

## Related Issues

- #334 (the defect), PR #336 (the fix branch).
- `docs/solutions/design-patterns/gate-the-value-source-not-just-the-eligibility-filter.md` — the sibling lesson that the consumer's read path, not the visible data field, is what must be covered.
