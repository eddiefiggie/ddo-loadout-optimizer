---
title: "Prove a guard fails before trusting it, and make it refuse to inspect nothing"
module: build-pipeline
date: 2026-08-07
last_updated: 2026-08-08
problem_type: convention
component: tooling
severity: high
tags:
  - ddo
  - build-gate
  - integrity-gate
  - verification
  - negative-test
  - exclude-until-verified
  - data-pipeline
applies_when:
  - "Adding a build gate, integrity check, or any assertion that scans records and raises"
  - "A guard's predicate reads a field in a different representation than the records carry — a different spelling, a different casing, or a different structural shape"
  - "Adding a second data source that a guard is expected to cover"
  - "Reviewing a guard that has never been observed to fail"
---

# Prove a guard fails before trusting it, and make it refuse to inspect nothing

## Context

The material coverage gate for #162 (`assert_coverage` in `src/material.py`) exists to
fail the build when a shield or body armor arrives with no material entry — otherwise a
newly-imported item silently passes the druidic-oath restriction. It was written, wired
into `build_dataset.py`, and the build went green.

Then it was tested by deliberately deleting one item from the shard and rebuilding. **The
build stayed green.** The gate matched nothing, counted nothing, and passed
unconditionally — on a corrupted input it was specifically written to reject.

The cause was a one-word vocabulary mismatch. Planner records carry the slot
`"Off Hand"` (normalized by `planner_items._slot`), while the raw gear-planner dump
carries `"Offhand"`. The gate was written against the raw spelling because
`scripts/merge_harvest.py` builds its roster from the raw dump and legitimately matches
that way. Two representations of the same field, one letter and a space apart:

```python
# The gate ran over planner RECORDS but matched the RAW dump's spelling.
if not ((slot == "Offhand" and typ in gated_types)      # never true here
        or (slot == "Armor" and typ in gated_slots)):
    continue
```

Nothing in the build was wrong. Tests passed. The gate was simply inert, and would have
stayed inert indefinitely — a guard that never fires is indistinguishable from a guard
that has nothing to catch.

## Guidance

**1. A guard is not verified until you have watched it fail.** Passing on good input
proves nothing; a `return True` passes on good input too. Before trusting any gate,
corrupt the input it exists to reject and confirm it raises with a readable message:

```bash
# temporarily remove one entry the gate must catch
python3 -c "import json; p='data/seed/compendium/item_material.json'; \
  d=json.load(open(p)); del d['harvested']['Item:Adherence']; json.dump(d,open(p,'w'))"
python3 build_dataset.py    # MUST fail, naming Adherence
git checkout -- data/seed/compendium/item_material.json
python3 build_dataset.py    # and MUST pass again
```

Both directions matter. A gate that fails on everything is as useless as one that fails
on nothing, and only the restore step distinguishes them.

**2. Make the guard refuse to inspect nothing.** The failure above is silent by
construction — a predicate that matches zero records produces zero findings, which is
byte-identical to a clean run. Assert the scan happened at all:

```python
if not checked:
    raise MaterialCoverageError(
        "material coverage gate inspected 0 items — the slot/type vocabulary has "
        "drifted and the gate is inert. Expected records with slot 'Off Hand' or "
        "'Armor' matching the gated type sets.")
```

This is the durable half. The negative test proves the gate works *today*; the
zero-inspection guard is what catches the vocabulary drifting *later*, when nobody is
looking and no test was written for the drift.

**3. When a field has two representations, say so at both sites.** The mismatch was not a
typo — both spellings are correct in their own context. Leave a comment naming the other
one so the next reader does not "fix" one into the other:

```python
# NOTE the slot vocabulary: planner RECORDS carry "Off Hand" (normalized by
# planner_items._slot), while the RAW gear-planner dump carries "Offhand".
# scripts/merge_harvest.py builds its roster from the raw dump and so matches on the
# raw spelling. Using the raw spelling here made this gate silently inert.
```

**Representation means more than spelling** — see the second case study below. The same
trap has now appeared in three shapes in this repo:

| Shape | Instance |
|---|---|
| Lexical | `"Offhand"` (raw dump) vs `"Off Hand"` (planner records) |
| Casing | `"stated"` vs a retyped `"Stated"` falling through every provenance branch |
| Structural | tooltips at a top-level `snapshots` block vs inline at `harvested[name].tooltip` |

Naming a value in one place rather than spelling it at each branch removes the casing
class outright. `src/speed_split.py` now declares `STATED` / `DEFAULTED` / `UNSOURCED`
as constants for exactly this reason.

**4. A guard that refuses to inspect nothing still has to be invoked.** Rule 2 protects a
guard from silently matching zero records *within a source it runs over*. It does nothing
about a source the guard was never pointed at. When you add a second shard, table, or
pool that an existing guard is supposed to cover, wire it and assert a non-zero inspected
count for that source specifically — coverage of source A is not evidence of coverage of
source B.

## Why This Matters

The consequence was not a broken build — it was the opposite. The gate would have shipped
green forever while enforcing nothing, and the failure it existed to prevent (a shield with
no sourced material silently passing the druid restriction) would have surfaced as a wrong
gear recommendation months later, with no signal pointing back here.

This is the same shape as this project's other silent-verification traps, and it is worth
knowing precisely how it differs from the closest one:

`exclude-until-verified-empty-seed-masks-consuming-bugs.md` says to **test the populated
path, not just the inert default** — a feature behind an empty seed is never exercised, so
its bugs stay dormant. That guidance would **not** have caught this bug. The seed here was
fully populated (959 entries) and the consuming code did run. The seed was fine; the
*predicate* was wrong. Same silent-inertness outcome, different cause, and the two need
different countermeasures: that one wants a populated-path test, this one wants a negative
test plus a zero-inspection assertion.

`data-at-rest-can-look-inert-while-runtime-normalizes-it.md` is the mirror image: there the
data *looked* dead and was actually live, so the lesson was to trace the runtime path before
concluding a consumer is inert. Here the gate looked live and was actually dead. Both reduce
to: **do not infer that a check is working from the absence of complaints.**

## When to Apply

- Adding any build gate, integrity check, referential-integrity assertion, or lint that
  scans a collection and raises.
- Reviewing a guard nobody has seen fail — including one that has been in the tree a long
  time. Age is not evidence; an inert gate accumulates the same green history as a working
  one.
- Any predicate matching on a field whose representation differs between a raw source and a
  normalized one — lexically, by casing, or structurally. This project has produced all
  three (`Offhand`/`Off Hand`, `stated`/`Stated`, top-level block vs inline field) and the
  affix layer has more.
- Adding a second data source an existing guard should cover. Wire it and confirm a
  non-zero inspected count for that source; do not infer coverage from the first one.

The cost is a minute per gate. The alternative is a guard that reports success for the
lifetime of the repository.

## Second case study, 2026-08-08 — the structural shape (#168)

This recurred a day later, in a shape the original write-up did not anticipate, and the
narrow framing is why it was not anticipated. "Two spellings of a field" reads as *watch
for vocabulary typos*. The actual rule is broader: **the guard's predicate must read the
field in the representation the records actually carry**, and representation includes
structure.

`speed_split.check_against_snapshots()` verifies each derived alacrity value against a
rendered wiki tooltip. It reads snapshots from a **top-level `snapshots` block**, keyed by
case-normalized template invocation. A new augment shard added in the same PR stored its
tooltips **inline**, at `harvested[<augment name>].tooltip`. Same field, two structural
representations. Running the guard against that shard returned:

```
{'checked': 0, 'problems': [7 x 'no tooltip snapshot for ...']}
```

Zero verified. The record it was meant to protect — `Topaz of Swiftness 15%` — is the exact
augment the PR existed to fix.

Three things are worth taking from it:

- **Rule 2 was present and did not help.** The guard *does* refuse to inspect nothing, and
  that refusal fired correctly on the item shard. Nobody had pointed it at the augment
  shard at all, so there was no scan to refuse. That gap is now rule 4.
- **Quoting the learning is not applying it.** This document was cited by name in the
  docstring of the very module carrying the bug, written in the same sitting. A learning
  can be in front of you and still not fire, because recognizing the *shape* of a trap in
  the abstract is a different act from checking whether today's code has it.
- **An independent reviewer caught it, not the author.** The mechanical check that would
  have caught it is small: run the guard against the thing it guards and assert the
  inspected count is non-zero. Author-side, that check is easy to skip precisely because
  you already believe the coverage is there.

The related migration also produced a modelling error worth noting: the inline field held
the visible **cell** text, not the invocation's rendered tooltip — three augments share
`{{Striding|30}}` while their cells differ. Unifying on the `snapshots` shape surfaced the
conflict immediately, because one invocation cannot hold two different renders.

## Examples

The same discipline applied to this project's other new gate that session. The affix-synonym
gate (`assert_affix_synonyms`) was verified by removing the `Striding` fold from the vendored
upstream table and confirming the build refused:

```
src.vocabulary.IntegrityError: upstream no longer folds 'Striding' into 'Speed'
(dropped-fold event). Items carrying 'Striding' may now parse under their own name.
```

then restoring it and confirming a clean build. That gate happened to be correct on the
first cut — but the same check that confirmed it is what exposed the coverage gate as inert,
and neither was trustworthy until it had been run.

## Related

- `docs/solutions/conventions/exclude-until-verified-empty-seed-masks-consuming-bugs.md` —
  adjacent, different cause: empty seed vs. wrong predicate.
- `docs/solutions/conventions/data-at-rest-can-look-inert-while-runtime-normalizes-it.md` —
  the mirror case: data that looks inert but is live.
- `docs/solutions/logic-errors/impossible-values-mean-a-unit-change-not-corruption.md` —
  the other #154/#162 learning, including why the synonym gate exists at all.
- `docs/solutions/conventions/bundled-template-values-live-in-the-tooltip-not-the-cell.md` —
  the adjacent lesson from #168: where the value lives, as opposed to whether the check
  that reads it actually runs.
