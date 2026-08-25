---
title: "Measure the counterfactual before crediting your fix — a causal claim about your own change is a hypothesis, and a harness that can only measure what shipped cannot test it"
module: tests
date: 2026-08-16
problem_type: convention
component: testing_framework
severity: high
related_components:
  - development_workflow
  - solver
  - tooling
root_cause: missing_tooling
resolution_type: tooling_addition
applies_when:
  - "A plan or PR says removing, replacing, or trimming X caused an observed improvement"
  - "A fix changes two things at once and only one of them is needed to close the reported bug"
  - "A perf or budget figure is quoted from another session, another tree, or a reviewer's run"
  - "A measurement harness can only measure the configuration that shipped"
  - "A single sample is being compared against a single sample and the delta is near run-to-run noise"
symptoms:
  - "The plan's causal story survives to the PR body because no run could contradict it"
  - "A product trade is presented as a free consequence of the bug fix"
  - "Three unreproducible perf figures accumulate in one plan before any A/B is run"
tags:
  - ddo
  - counterfactual
  - performance
  - measurement
  - ab-comparison
  - planning
  - verification
  - never-infer
---

# A causal claim about your own fix needs the counterfactual measured, not inferred

## Context

Bug #343 reported that the DDO optimizer's Utility tier never reached for worn defensive toggles: a player who wanted Ghostly and True Seeing found them in the catalog, individually targetable, but nothing sought them on the player's behalf.

The tier scores a loadout by counting distinct "presence" effects it secures. Which names count is deliberately curated, not derived from the catalog: `UTILITY_TIER1_PRESENCE` is a hand-reviewed list mirrored in two places — `src/utility_procs.py:79` (a Python `frozenset` consumed by the build to stamp `metadata.utility_counting_set`) and `web/dataset.js:493` (the JS literal the app reads) — with a parity test in `tests/dataset.test.js:1657` failing the suite on drift between the copies. Before the fix, `counting_set` in `src/utility_procs.py:125` unioned that curated list with a second population: 24 allow-dispositioned untyped weapon procs (the Bane family, Holy, Vampirism) stamped as `metadata.utility_untyped_admitted`. Fourteen curated names plus twenty-four procs was the 38-name roster the tier shipped with.

The fix that landed (PR #350, merged; issue #343 closed) did **two** things:

1. added six worn defensive toggle names — Ghostly, True Seeing, Blurry, Freedom of Movement, Blindness Immunity, Deathblock — to the curated list, in both mirrors;
2. stopped unioning the 24 procs into the count, so the curated list now bounds the whole counting set. Today `counting_set` returns `presence_counting_names(records) & UTILITY_TIER1_PRESENCE` minus the rankable names (`src/utility_procs.py:147`) — the procs no longer appear, though they remain in `utility_untyped_admitted` for the picker, so a player can still rank Undead Bane as an ordinary priority.

The plan for that fix asserted a causal link between the two halves: the cheap procs "filled the count and never reached for the toggles." Read plainly, that says the procs crowded the toggles out — which makes removing them part of the bug fix rather than a product decision. It also justified the removal on performance, by comparing a 1.96x figure recorded in an earlier session against a 1.56x sample taken in this one, and observing that the procs were 86% of the carrying-variant footprint.

Adversarial review rejected both arguments on the same ground: **neither had a counterfactual.** Nobody had run "do (1) but not (2)."

## Guidance

**When your fix does two things, the counterfactual is "do only one." Run it before you claim the second thing was necessary.**

A fix that bundles a behavioral change with a scope reduction, a cleanup, a removal, or an optimization is really two changes wearing one commit message. The tempting narrative — "A caused the bug, so removing A is part of fixing it" — is a hypothesis about your own system, and it is exactly as testable as any other hypothesis. Test it by shipping half the fix into a scratch measurement and observing whether the bug closes.

Here, the half-fix closed the bug completely. Measured at ML34 ranking Constitution, three rosters on the same dataset (recorded in `docs/plans/2026-08-16-004-fix-utility-default-roster-plan.md`):

| roster | counted effects | toggles secured |
|---|---|---|
| pre-fix, 38 names | 14 | 0 / 6 |
| six toggles added, procs KEPT (44 names) | 20 | 6 / 6 |
| shipped, 20 names | 14 | 6 / 6 |

The causal story was false. Procs live on weapon slots and toggles on worn slots, so they were never competing for the same slot — when both count, the solver takes both. **Adding six names was the entire fix.** Removing the procs was a separate product decision, presented as a free consequence, that costs the player counted effects.

**And the corollary for the measurement half: if your harness can only measure the configuration you shipped, every comparative claim you make about it is untested by construction.**

`tests/perf_utility.js` measures the Utility tier's cold-solve cost as a ratio against a pre-feature baseline. At the time of this work the budget was `median(b) <= 2 x median(a)`, medians taken across fixtures; #466 retired that statistic on 2026-08-24 (it was unpaired, cross-fixture, and blind to a regression concentrated in one fixture) in favour of a cost-weighted total plus a worst-per-fixture ceiling. **Every ratio quoted in this entry is on the retired statistic and is not comparable to a figure the gate prints today.** Before this work it could only ever measure the *shipped* counting set — `vocab.utilityCounting`, threaded from the build stamp straight into `buildModel` as its eleventh argument (`web/query.js:160`, consumed at `web/model.js:804`). There was no way to swap in an alternative roster. So the claim "this roster is cheaper than that one" had never been tested, not because anyone declined to test it, but because the tool could not express the question. What filled the gap instead was cross-session arithmetic: a 1.96x number from a different session measuring a different tree, against a single 1.56x sample from this one. Earlier in the same session a 0.76x figure had been carried in from a reviewer's measurement during an unrelated review without running the gate at all; it did not reproduce.

The fix was to make the harness able to ask the question. `tests/perf_utility.js:181` now reads `ROSTER` from the environment (`shipped` by default) and builds the alternates at `tests/perf_utility.js:187-191`:

- `pre343` — the shipped set minus the six named toggles, plus the admitted procs;
- `hybrid` — the shipped set plus the admitted procs (the counterfactual).

Both alternates are **derived from the build stamp**, not hardcoded: the procs come from `metadata.utility_untyped_admitted` read out of the dataset (`tests/perf_utility.js:184-185`) and the toggles from a named six-element list, so the alternates stay correct as the curated roster widens under #349. An unknown `ROSTER` value exits 2 with the valid names. Crucially, only `shipped` is asserted against the budget — an alternate prints its ratio, labels itself informational, and returns before the pass/fail line (`tests/perf_utility.js:293-298`), so an A/B measurement can never look like a regression in CI or in a reviewer's terminal.

With that in place, the real A/B on identical fixtures and machine conditions:

| roster | names | measured | 2.0x budget |
|---|---|---|---|
| `pre343` | 38 | 2.09x | over |
| `hybrid` | 44 | 2.09x, 2.23x, 2.24x, 2.26x | over, every sample |
| `shipped` | 20 | 1.50x–1.75x across many runs | pass, with room |

This **inverted the conclusion in a useful direction.** The roster that was live before the fix was already over its own budget on today's dataset. The hybrid that closes the bug is over it too, in every sample. The shipped roster is the only one of the three that fits. So the removal *is* justified — by the budget, not by the bug — and it is a trade the player pays for (24 fewer countable effects) rather than a free win. That argument is stronger than the one it replaced, and it was only available once the harness could A/B.

Two habits fall out of this:

- **Record a range, not a point.** The gate is a wall-clock median on a loaded developer machine. Single-roster run-to-run noise measured 1.50x–1.75x on the shipped roster alone — as large as the saving the point estimate was claiming. Note this doc deliberately quotes no exact run count for it: the count is not something a later reader could reproduce, and a doc about unreproducible figures must not carry one. A range plus a same-session A/B survives a second reviewer running the gate; a point estimate gets contradicted by one.
- **Never carry a number across sessions or across trees as if it were an A/B.** Both bad figures here (0.76x, and the 1.96x-vs-1.56x comparison) came from treating a remembered measurement as commensurable with a fresh one.

## Why This Matters

The plan was not wrong about *what to ship* — the shipped roster is the right one. It was wrong about *why*, and that is not a cosmetic error:

- **A false causal story hides a product decision.** "The procs crowded out the toggles" makes their removal a bug fix, which no reviewer needs to weigh. "The procs cost more than the budget allows" makes it a trade, which a reviewer can accept, reject, or scope differently. The same diff, two completely different review conversations.
- **Unfalsified causes become load-bearing folklore.** Once "procs crowd out toggles" is in a plan, the next engineer widening the roster (#349) reasons from it, and reaches wrong conclusions about which names are safe to add — the slots simply do not compete the way the story implies.
- **The inverted finding was actionable and would otherwise have been missed.** Discovering that the pre-fix roster was *already over budget* changes the priority of #349 (widening) and reframes #348 (the pinned player-curated container) as the escape valve for effects the budget will not let the default roster count. That finding was invisible until the harness could measure a roster it had not shipped.
- **Tooling gaps masquerade as diligence gaps.** It looked like nobody had bothered to A/B. In fact the harness made the A/B impossible, and the missing capability quietly redirected the argument toward whatever numbers happened to be lying around. Extending the harness cost a few dozen lines and permanently removed that failure mode.

A sibling correction in the same session (PR #351, merged) is the same defect one step upstream: a plan's Problem Frame labelled a measurement "(ML15, two-handed, melee preset, no crafting)" when the query had passed `weaponStyle: "Two Handed"` — a key nothing in `web/` reads, silently discarded because query objects have no schema validation, so the table was an unconstrained solve. The conclusion survived re-measurement, but the numbers did not transfer, and anyone citing them for a two-handed build would have cited the wrong figures. **A measurement's label is a claim too, and it needs verifying against the code that consumed it.**

## What this adds over its two siblings

Two existing docs are adjacent, and each explicitly defines itself against the other — which is what leaves this learning's cell empty. The axis is **whose claim it is** and **what settles it**:

| | claim you **consume** | claim you **emit** |
|---|---|---|
| **counterfactual is checkable** | [`docs/solutions/workflow-issues/plan-text-and-review-findings-are-unverified-claims.md`](../workflow-issues/plan-text-and-review-findings-are-unverified-claims.md) — plan text, review findings, carried-forward notes. Remedy: **grep it.** | **this doc** — a causal claim about your own diff, in a plan or PR body. Remedy: **run it.** |
| **counterfactual is barred by assumption** | — | [`docs/solutions/conventions/never-infer-a-claim-about-your-own-results.md`](never-infer-a-claim-about-your-own-results.md) — player-facing prose, where the plan rules the counterfactual out (nominally under A3). Remedy: **weaken the sentence.** |

The third cell is the one this session fell into. "Removing the procs is what let the toggles through" is a claim I emitted, about my own change, whose counterfactual was neither forbidden nor grep-able — it cost one command once the harness could express it. Neither sibling's remedy applies: grepping has nothing to read, and rewording would have preserved the false story in gentler language. **The answer was to run the configuration where I did not remove them.**

Two scope notes the pair needs, or it reads as inconsistent:

- That doc's *"if you are not computing it, describe the build you are showing"* is correct **in its venue** (player prose, where the counterfactual is ruled out). Read as a general licence it would excuse declining a counterfactual that is cheap and decisive — exactly the move this learning reverses.
- The consume-side doc's *"the check is usually one command"* is true of its dominant class but not of this one: here the check required **adding an A/B axis to the instrument before it could be run at all.** That is a distinct expensive-check sub-class, not a contradiction.

The shared root across all three is worth naming: **asserting the outcome of an experiment nobody ran.** They differ only in what the missing experiment was — a file read, a second solve, or an alternate configuration.

## When to Apply

- Any fix whose diff does two separable things — add plus remove, fix plus optimize, widen plus trim, behavioral change plus cleanup. Split it in a measurement even if you intend to ship it as one commit.
- Any time a plan or PR body contains "so", "which is why", "because of this" linking one half of your change to the other. That connective is the claim; look for the run that supports it.
- Before justifying a scope reduction on performance grounds. Compare the alternatives on one machine, one session, one fixture set, or don't compare them.
- When you are about to cite a number you did not produce in this session, against a tree that has moved since.
- When your only measurement tool reads the shipped configuration out of production plumbing (a build stamp, an env-derived config, a live dataset). That is the signature of a harness that cannot A/B — parameterize it before you argue with it.
- Whenever a measurement is described with build/query attributes that came from a hand-written label rather than from the code path that consumed them.

## Examples

**A harness that can only measure what shipped.** The pre-#343 gate threaded exactly one set:

```js
// buildModel's 11th argument, always the shipped stamp
build(q2, vocab.utilityCounting)
```

No alternate roster was expressible, so no comparative claim about the roster was testable. The parameterized version derives its alternates from the stamp rather than hardcoding them, so they track the curated roster as it widens (`tests/perf_utility.js:181-196`):

```js
const ROSTER_KEY = process.env.ROSTER || "shipped";
const TOGGLES_343 = ["Ghostly", "True Seeing", "Blurry", "Freedom of Movement",
  "Blindness Immunity", "Deathblock"];
const admitted = JSON.parse(fs.readFileSync(DATASET, "utf8"))
  .metadata.utility_untyped_admitted || [];
const shipped = vocab.utilityCounting;
const ROSTERS = {
  shipped,
  pre343: new Set([...[...shipped].filter((n) => !TOGGLES_343.includes(n)), ...admitted]),
  hybrid: new Set([...shipped, ...admitted]),
};
```

and refuses to fail the build on an informational run (`tests/perf_utility.js:293-298`):

```js
if (ROSTER_KEY !== "shipped") {
  console.log(`(informational — ROSTER=${ROSTER_KEY}; the budget is asserted only on the shipped roster)`);
  return;
}
```

Usage: `node tests/perf_utility.js` for the gate, `ROSTER=hybrid node tests/perf_utility.js` for the counterfactual.

**Correction (2026-08-24, #505) — deriving from the stamp did not make the alternates rot-proof.** This entry originally claimed the alternates "cannot rot as the roster grows". That guarded the wrong axis. They did not rot by the roster growing; they rotted because the population they draw from **emptied**: `metadata.utility_untyped_admitted` is now `[]`, so `hybrid` is name-for-name `shipped` and `pre343` is `shipped` minus the six toggles. Running `ROSTER=hybrid` today reports the same 16 counted names and the same figure as `shipped`, while labelling itself `ALTERNATE` — the harness had silently lost the ability to express the comparative question again, which is the precise failure this entry exists to prevent.

The lesson generalizes: **a derived alternate is only as expressive as the population it derives from, so assert that it still differs.** Deriving instead of hardcoding removes one rot path and leaves another wide open. `tests/perf_utility.js` now compares each alternate against `shipped` name-for-name and refuses to let an identical one read as a measurement:

```
!! VACUOUS A/B: 'hybrid' is name-for-name identical to 'shipped'
   (metadata.utility_untyped_admitted is empty, so the alternates
    have nothing to add). Any difference below is run-to-run noise,
    not a roster effect. Do NOT record it as an A/B.
```

That is disclosure, not repair — whether the empty stamp is intentional or a pipeline regression is open in #505.

**Before / after, in the argument rather than the code.**

> *Before (inferred):* "The cheap procs filled the count and never reached for the toggles; they're 86% of the carrying-variant footprint, the old roster measured 1.96x and this one measures 1.56x, so swapping them buys back budget." — one causal claim with no counterfactual, resting on a cross-session comparison and a single sample.

> *After (measured):* "Adding six toggle names closes the bug on its own; the procs never competed with them. Removing the procs is a separate trade: the pre-fix 38-name roster measures 2.09x and the 44-name hybrid that also closes the bug measures 2.09x–2.26x, both over the 2.0x budget, while the shipped 20-name roster measures 1.50x–1.75x. The player gives up 24 countable effects to stay inside the solve-time budget." — two claims, each with its own run.

**Reconstruction limits, stated rather than smoothed over.** The behavioral table is one dataset and a small number of queries at ML34; it establishes that the toggles are secured either way, not a general law about slot competition across every build. The perf figures are wall-clock medians from `tests/perf_utility.js` on a loaded developer machine — which is precisely why the shipped roster is quoted as a range across many runs and the alternates as multiple samples. A point estimate from this gate is not reproducible enough to carry an argument; a same-session A/B is. Disclosing that also kept a real regression visible: the count can *fall* for some builds under the shipped roster (a sword-and-board case measured 15 → 14), which the plan records rather than asserting away.

## Related

- PR #350 (merged) — the roster fix and the `ROSTER=` harness parameterization; closed issue #343.
- PR #351 (merged) — the mislabelled-measurement correction in the #346 plan (`weaponStyle` vs `query.style`).
- Issue #349 — widening the counted roster beyond the tier-1 twenty (the KTD10 measured-batch lever); the derived alternates in the harness are built to survive it.
- Issue #348 — the pinned, player-curated nice-to-have container, the escape valve for effects the default roster's budget cannot afford to count.
- `docs/plans/2026-08-16-004-fix-utility-default-roster-plan.md` — the plan, including the corrected Problem Frame, the three-roster A/B table, and the recorded range.
- [`docs/solutions/conventions/prove-a-test-fails-against-the-pre-change-tree.md`](prove-a-test-fails-against-the-pre-change-tree.md) — the methodological ancestor: prove-red *is* a counterfactual protocol, applied to tests instead of arguments.
- [`docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md`](prove-a-guard-fails-before-trusting-it.md) — an instrument never observed to discriminate. The perf gate was that instrument in its comparator role.
- [`docs/solutions/conventions/assert-non-vacuity-for-every-surface-in-a-loop-test.md`](assert-non-vacuity-for-every-surface-in-a-loop-test.md) — the vacuity axis: the gate was not vacuous as a budget check, but it was vacuous as a comparator.
- [`docs/solutions/design-patterns/lexicographic-descent-bounds-the-vector-not-each-stat.md`](../design-patterns/lexicographic-descent-bounds-the-vector-not-each-stat.md) — the other learning banked from PR #350.
- [`docs/solutions/conventions/fixture-shape-must-mirror-the-production-writer.md`](fixture-shape-must-mirror-the-production-writer.md) — its input-side addendum is the mechanism that let the #346 measurement go untested (`weaponStyle` read nowhere).
- `tests/perf_utility.js` — the instrument itself: the `ROSTER=` contract, and its header as the compliant form for recording a figure (ranges, sample counts, and an instruction to re-measure rather than cite).
