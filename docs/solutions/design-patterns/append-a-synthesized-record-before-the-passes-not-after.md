---
title: "Append a synthesized record BEFORE the enrichment passes — replicating them after is only as complete as memory"
date: 2026-08-26
category: design-patterns
module: dataset_pipeline
problem_type: design_gap
component: build_pipeline
severity: medium
symptoms:
  - "The eleven Dinosaur Bone blanks were appended to `variants` after every native tier pass, so `src/dino.py` re-called three of those passes by hand to keep a blank shaped like a native"
  - "The three passes it did NOT replicate (parrying / heightened-awareness / speed `expand_set_bonuses`) and two build-time guards (expanded-away orphan, helpless fold) never inspected a blank at all"
  - "`metadata.coverage.variant_count` read 9099 against 9110 emitted records — the coverage model could not see the records appended after it was computed"
root_cause: pipeline_ordering
resolution_type: refactor
tags: [synthesized-records, pipeline-ordering, dino, set-bonus, guards, coverage, one-owner]
related_components:
  - build_dataset.py
  - src/dino.py
  - src/verify.py
applies_when:
  - "Appending synthesized or seed-built records to a list that enrichment passes have already run over"
  - "A module re-calls pipeline entry points so its records 'look like' the native ones"
  - "Deciding where in a build pipeline a non-harvested record should enter"
---

# Append a synthesized record BEFORE the enrichment passes — replicating them after is only as complete as memory

## Problem

The Dinosaur Bone blank hosts are synthesized by `src/dino.py`, not harvested. They
were appended to `variants` at the very end of the pipeline, after
`verify_mod.apply` — so every enrichment pass had already run without them.

To keep a blank indistinguishable from a native set carrier, `_stamp_set_membership`
called three of those passes itself: `set_parser.annotate_variant`,
`umbrella.expand_variants`, `spell_focus.expand_variants`. Its docstring said so
plainly, and a pytest pin compared a blank's tier against a native carrier's.

The replication was correct for the three it named and absent for everything else.
Three more passes ran on the native channel only — the parrying,
heightened-awareness and speed `expand_set_bonuses` passes — as did two build-time
guards: the expanded-away-orphan check and the helpless-fold channel check. A
catalog refresh adding such a clause to a Dread Isle tier would have expanded on the
149 native carriers and survived **raw** on the 11 blanks. The tier==native pin
would have caught it, but only when the test suite ran — never on a bare build.

## Symptoms

- Two owners for one recipe, agreeing by hand and free to drift.
- Guards whose stated population ("every set-bonus tier") silently excluded 11 records.
- A coverage disclosure that did not count what the build shipped: `variant_count`
  9099 vs 9110 emitted, and the two slots the blanks alone occupy had no bucket.

## What Didn't Work

**Replicating more passes.** The obvious response to "three passes were missed" is
to add three more calls to `src/dino.py`. That widens the duplication rather than
removing it, and leaves the same failure mode armed for the next pass anybody adds —
which is exactly how these three came to be missed in the first place. The list of
passes to mirror is not written down anywhere; it lives in whoever last looked.

## Solution

Append the synthesized records **before** the passes, and delete the replication.

- `build_dataset.py` appends `dino_blanks` immediately after `expand_dataset`,
  ahead of every tier pass and guard.
- `src/dino.py` stamps `sets` and `set_bonus` (the deep-copied catalog def) and
  stops. `parsed_set_bonuses`, umbrella and spell-focus expansion are derived by
  the native pipeline — `build_dataset`'s `set_mod` **is** `set_parser`, so the
  removal is provably the same call, not an equivalent one.
- The gate the late append was avoiding gets a real clause. A blank ships an empty
  affix list by construction, so `src/verify.py` admits it on its open Dino insert
  slots — the same shape as the augment-slot host clause beside it, whose comment
  already described a blank by analogy.

## Why This Works

A record that enters the pipeline where the harvested ones do gets every pass by
construction, including passes that did not exist when it was written. The
correctness argument stops being "somebody kept two lists in sync" and becomes
"there is one list."

Verified as behaviour-preserving rather than assumed: rebuilding changed exactly the
11 blank records and nothing else. The seven intrinsic carriers' `parsed_set_bonuses`
came out **byte-identical** to the hand-replicated version — the proof that the
pipeline reproduces what `dino.py` was doing by hand. The remaining deltas are the
four non-carriers gaining an empty `parsed_set_bonuses`, all eleven gaining an empty
`augment_slots_norm`, and all eleven carrying the verify gate's own reason string
instead of a synthesis-time blank. `metadata.coverage.variant_count` now equals the
emitted item count.

## Prevention

- When a module calls pipeline entry points "so its records look like the native
  ones", treat that as a **placement bug**, not a pattern. Ask why the record is not
  simply in the list when those entry points run.
- A guard's population is a claim. `set_bonus_orphans(variants, ...)` reads as *every*
  set-bonus tier; it was every tier **in `variants` at that moment**, which excluded
  records appended later. Check what is in the collection at the line the guard runs,
  not what the collection is named.
- A coverage total that disagrees with the emitted record count is the cheapest
  available detector for this whole class — `variant_count` was off by exactly the 11
  late-appended records for as long as the late append existed. Assert the two agree.

## Related Issues

- #338 (this restructure), #334 and #541/#542 (the two earlier lessons from the same
  synthesis path).
- `docs/solutions/logic-errors/synthesized-records-need-the-full-set-field-chain.md` —
  the first lesson: a synthesized record needs every field the consumer reads. This is
  its sequel, and its better answer: do not stamp the fields, be in the list that
  derives them.
- `docs/solutions/design-patterns/derive-a-synthesized-record-from-the-record-it-shadows.md` —
  the sibling: derive *what* is stamped from the catalog. This one derives *how*.
- `docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md` — the four
  corruption proofs used to confirm the passes and guards now reach a blank.
