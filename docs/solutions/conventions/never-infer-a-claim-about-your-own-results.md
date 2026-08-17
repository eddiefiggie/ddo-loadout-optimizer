---
title: "Never infer a claim about your own results — a weaker true sentence beats a confident wrong one"
module: web-ui
date: 2026-08-09
last_updated: 2026-08-12
problem_type: convention
component: presentation
severity: high
tags:
  - ddo
  - disclosure
  - user-facing-claims
  - never-infer
  - counterfactual
  - projection
applies_when:
  - "Writing or editing a sentence, label, or export line a user reads that carries a number, comparison, or causal attribution about the tool's own output"
  - "Reviewing a diff that adds a notice, disclosure, tooltip, or export field"
  - "Adding a second surface for a fact that already has one (app notice plus share export plus print view)"
  - "Reusing an existing disclosure channel for a newly-droppable thing"
  - "Naming a computed field that will be interpolated into user-facing prose"
---

# A user-facing claim must be derivable from the data that produced it — weaken the sentence, never approximate the number

## Context

A player would have read this in the results panel:

> Your floor of 10 Combat Mastery was met with the declared 7 counted in — your gear alone reaches 5.

That sentence asserts the outcome of a **credit-free solve** — what the optimizer would have produced had the player not declared the bonus. No such solve is run. The code comment says assumption A3 forbids it, and the plan does rule the counterfactual out — though strictly A3 was written to narrow R10's displacement claim, and extending it to this floor sentence was itself part of the mistake. Either way the second full lexicographic pass was never run. So the "5" was assembled from the credit-enabled solve and presented as the credit-free one.

It was not merely imprecise. A credit-free solve is free to pick *different items* for the same floor lock, and does: in a reproduced model (targets Dodge + CM, floor CM 10, one Ring slot offering either a CM-5/Dodge-3 ring or a CM-12 ring) the credit-free solve reached **12** unaided while the notice claimed the player's gear reached **5**. The sentence was false, and false in the direction that flatters the feature — it made the declaration look load-bearing when it was not. `tests/solver.test.js:3055-3058` now pins that premise directly, asserting the credit-free solve exceeds the reported figure.

Four instances were caught in review in one day, across the declared-stat-credits sequence — PRs [#179](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/179) (U1), [#180](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/180) (U2+U3), [#181](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/181) (U5), [#182](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/182) (U4), [#183](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/183) (U6+U7). All four were text shown to a player of a tool whose headline claim is that a loadout is provably optimal. **All four were caught by code review. None by a test** — every one of them produced a well-formed string from live code paths that were green.

Every fix was a **rewording toward what the data supports**. Not one was a better estimate.

## Guidance

**When a user-facing claim is not derivable from the data that produced it, weaken the claim. Do not approximate the number.** The tempting move — keep the sentence, compute the closest available figure — converts an honest gap into a confident wrong number, which is exactly what this repo already refuses to do with input data.

Two of the four fall into recurring shapes; the other two are the arithmetic and naming failures that make a wrong claim *look* derivable.

**(a) A claim about a state that was never computed — the counterfactual.** "Your gear alone reaches N", "without this you would get N", "this saved you N" all describe a solve that did not run. Naming a hypothetical requires computing it. If you are not computing it, describe the build you *are* showing. `web/solver.js:1546-1555` computes `gearInLoadout` — the selected non-credit contribution summed across the stat's buckets, a real sum over one feasible solution — and the comment above it at `web/solver.js:1538-1545` records why the counterfactual reading was rejected rather than approximated. Same discipline at `web/solver.js:1557-1561`: a floor is **attributed** to a credit when the credit is counted in a floored stat's total, never inferred to have been *necessary*, because necessity needs the forbidden second solve.

**(b) A claim sourced from a different layer than the one that produced the outcome.** Raw input versus normalized input; one disclosure channel standing in for another. Two surfaces that describe the same fact must read the same field, or they will eventually disagree — and the disagreement will be invisible until a player hits it.

Three corollaries, earned by instances 2 and 3:

1. **A sum must be a sum over one feasible solution.** Mixing "best value *present*" with "best value *selected*" invents a build the player cannot wear. Before the fix, one Ring slot holding an Insight 6 and an Enhancement 5 reported 11 for a player who owns one ring slot.
2. **Name the field for its scope.** `gearOnly` invited the counterfactual reading; `gearInLoadout` states what it is. The rename is part of the fix, not cosmetics — the old name is what made the wrong sentence feel derivable.
3. **A disclosure channel is itself a claim.** Reporting a dropped credit through the dropped-bounds channel makes that channel say something false. Give the new thing its own sentence (`web/dataset.js:876-881`), and let both appear when both drop.

**This is not one feature's bad week, though all four instances came from one.** Both shapes have precedent in this repo outside the credits work. Shape (a) is issue #102: pick-list help text read *"none = any"*, describing a literal dropdown option that does not exist — product prose asserting a state the system never had. Shape (b) is `docs/solutions/conventions/bundled-template-values-live-in-the-tooltip-not-the-cell.md`: the visible cell and the rendered tooltip are two layers of the same fact, and reading the wrong one silently drops the numbers. The credits sequence produced four in a day because it added an unusual number of new user-facing sentences at once, not because the class is new. The blocklist feature later confirmed it: its attribution printed "out-valued" from a tie-keeping comparator — a fifth instance, again caught by review and not by tests, with its own mechanism (`../logic-errors/weak-dominance-comparator-cannot-back-a-superlative-claim.md`).

**The check that would have caught all four, cheaply.** For each user-facing sentence, name the field it is derived from and ask whether that field *establishes* the sentence.

- If the sentence contains **"would"**, **"alone"**, or **"without"**, it is a counterfactual and needs a second computation you probably are not doing.
- If the sentence and its neighbouring qualifier read **different sources**, they will eventually disagree.
- If the sentence contains a **superlative** — "best", "out-valued", "beats every" — the predicate behind it must be *strict*. A comparator that keeps ties for pruning soundness makes `every(dominates)` establish `>=`, not `>`, and a `>=` fact printed as a superlative is false on the tie (the fifth instance, from a different feature: `../logic-errors/weak-dominance-comparator-cannot-back-a-superlative-claim.md`).

## Why This Matters

The tool's headline claim is that the loadout is provably optimal. A supporting sentence that is confidently wrong does more damage than a missing one, because the player has no way to distinguish it from the sentences that *are* proved — the same reason a wrong game value is worse than a visible gap. Instance 1 is the sharp case: the loadout it described was correct. Only the story about it was false, and false in the flattering direction.

That failure mode is also harder to detect than its input-side cousin. A corrupt input value eventually shows up as a wrong loadout. A wrong claim leaves the loadout perfect and only the prose lying, so nothing downstream ever contradicts it.

**Relationship to the existing input-side rule.** The repo's standing rule lives in the project instructions, not in a solution doc: *"Never infer a value. Every game value traces to the DDO Wiki. If the wiki does not state it outright, it is quarantined and disclosed rather than guessed — a visible gap beats a confident wrong number, because a wrong number is indistinguishable from a right one in a finished loadout."* It cites `docs/solutions/conventions/exclude-until-verified-data-gates.md` as its worked example — but that doc is a narrower thing (a shipping pattern for gating a feature behind an empty curated seed) and never states the principle itself. The principle is the parent; the seed doc is its input-side child.

This learning is the child that was missing. As written, the parent rule is input-only — it governs what the tool ingests and says nothing about what it asserts.

This learning is the **output-side counterpart**, and the core trade is genuinely the same one: *a weaker true sentence beats a confident wrong one* is *a visible gap beats a confident wrong number*, applied to claims the tool makes about its own results rather than to values it ingests. In both, the failure is indistinguishability — a fabricated number and a sourced one look identical in a finished loadout, and a fabricated claim and a proved one look identical in a results panel.

Two differences are real and worth keeping straight rather than forcing the parallel:

- **The safe move differs.** On the input side the safe default is *omission* — the seed ships empty, the field goes unstamped, absence itself is the disclosure. On the output side omission is usually unavailable: the notice exists because the player needs an explanation, and deleting it loses true information. So the move is not "drop it" but "narrow it to a claim the data supports". All four fixes are rewrites, not deletions.
- **The enforcement differs.** The input-side rule has a mechanical guard — an empty seed, a stamp-only-what-is-seeded pipeline, and tests asserting the empty-seed path is byte-for-byte the pre-feature behavior. The output-side rule has no equivalent fail-safe default, because a false sentence is a well-formed string produced by working code. Every one of the four was caught by a human reading prose against its source field. Regression tests were added *after* each was named (`tests/solver.test.js:3021-3058`, `tests/exporters.test.js:737`, `tests/results.test.js:928-932`, `tests/persist.test.js:240-249`, `tests/wizard.test.js:787-799`), and they pin the specific claims — they do not generalize to the next sentence someone writes. The guard here has to be a **review question**, not a default.

## When to Apply

- Writing or editing any sentence, label, or export line a user reads that contains a number, a comparison, or a causal attribution about the tool's own output.
- Reviewing a diff that adds a notice, disclosure, tooltip, or export field — the trip-words are "would", "alone", "without", "saved", "instead of", "your X reaches".
- Adding a second surface for a fact that already has one (app notice plus share export plus print view). Point both at the same field; if you find yourself reading raw state on one and the solver's report on the other, stop.
- Reusing an existing disclosure channel for a newly-droppable thing. If the channel's sentence does not literally describe the new thing, it needs its own sentence.
- Naming a computed field that will be interpolated into prose. The name is what the next reader will believe it means.

Not applicable to purely internal diagnostics, or to numbers whose derivation the same screen already shows in full.

## Examples

**Instance 1 — a claim about a state that was never computed** (U4, [#182](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/182)).

```
before:  Your floor of 10 Combat Mastery was met with the declared 7 counted in —
         your gear alone reaches 5.

after:   Your floor of 10 Combat Mastery counts the declared 7 Insight —
         the gear in this loadout supplies 5.
```

Live at `web/projection.js:1044-1045`. The claim moved from *necessity* (what a credit-free solve would produce) to *attribution* (what the shown build contains) — the only one of the two the solve establishes. `web/solver.js:1557-1561` enforces the same narrowing on the field that feeds it.

**Instance 2 — the same number mixed a hypothetical with an actual** (U4, [#182](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/182)). `gearOnly` read the credit's own bucket as *best value present* and every other bucket as *best value selected*, then summed. A single Ring slot (cardinality 1) holding an Insight 6 and an Enhancement 5 reported **11**, for a player who can field at most one of them. Fix: every bucket now reads the selected contribution (`web/solver.js:1546-1555`), so the figure is a real sum over one feasible solution; and the field was renamed `gearOnly` -> `gearInLoadout` so its name states its own scope. Pinned by `tests/solver.test.js:3021` ("gearInLoadout never sums picks that compete for one slot").

**Instance 3 — a claim sourced from the wrong channel** (U5, [#181](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/181)). A priority-migration sweep deletes a declared credit whose stat was substituted away (`web/wizard.js:1841-1851`), and originally reported it through `droppedBounds`, whose sentence says only:

```
before:  The min/max you had set on "Parrying" was removed rather than copied onto
         the replacement stats — set it again if you still want that limit.
```

A player who had declared a credit but never set a cap or floor was told a limit they never set had been removed, and was never told about the bonus that actually disappeared. Fix: a separate `droppedCredits` channel with its own sentence (`web/dataset.js:876-881`), both appearing when both drop:

```
after:   The "already have" bonus you declared on "Parrying" was removed rather than
         copied onto the replacement stats — declare it again on the new stats if
         you still have it.
```

**Instance 4 — a claim sourced from a different layer than the outcome** (U6, [#183](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/183)). The share export's "Already have" line read `rec.inputs.declaredCredits` — the raw wizard state map, saved verbatim (`web/persist.js:63`) — while the solve reads `cleanCreditMap` (`web/wizard.js:143`) -> `normalizeCredits` (`web/model.js:903`), which refuses blank, zero, non-integer, out-of-vocabulary, and presence-stat credits. Anything the query seam dropped still printed in all five text formats, and printed **without** the "we did not verify this number" qualifier, because that qualifier reads the solver's own report (`web/projection.js:1004`).

Reproducible with no hostile input: click "+ already have", never type a number, solve, share. The wizard deliberately keeps a half-typed row in state so it does not vanish under the cursor (`web/wizard.js:1753-1758`), and `${stat} +${value} ${bonus_type}` with an empty value rendered the literal:

```
before:  Already have: Combat Mastery + Insight
after:   Already have: Combat Mastery +7 Insight     (only when the solve accepted it)
```

Fix: both surfaces now read `creditReport`, the solver's output — `web/projection.js:751` for the export header, `web/projection.js:1004` for the notice — so the claim and its qualifier cannot disagree. The rationale is recorded inline at `web/projection.js:708-721`.

## Related

- The project instructions' standing **"Never infer a value"** rule — the parent principle. This doc is its output-side half; that clause is written input-only.
- `docs/solutions/conventions/exclude-until-verified-data-gates.md` — the input-side child: a shipping pattern for gating a feature behind an empty curated seed. Narrower than the principle it is cited under.
- `docs/solutions/conventions/bundled-template-values-live-in-the-tooltip-not-the-cell.md` — shape (b) on the ingestion side: two layers of one fact, and reading the wrong one.
- `docs/solutions/workflow-issues/plan-text-and-review-findings-are-unverified-claims.md` — the mirror image, and worth keeping distinct. That doc governs claims you **consume** (a plan sentence, a review finding) and its remedy is *check it*. This one governs claims you **emit**, and its remedy is *reword it* — because instance 1's claim was unverifiable by design, so "check it" had no answer to give.
- `docs/solutions/conventions/measure-the-counterfactual-before-crediting-your-fix.md` — the **third cell** of that same axis (added 2026-08-16). This doc's remedy is *reword it* because its counterfactual is barred by assumption A3. When the counterfactual is **not** barred — an engineering justification in a plan or PR body about your own diff — the remedy inverts to *run it*, because there the second run costs one command and decides whether half the diff ships. **Venue matters:** the guidance below to describe the build you are showing rather than compute a hypothetical is correct for player-facing prose under a forbidding assumption, and must not be read as a general licence to skip a cheap, decisive counterfactual.
- `docs/solutions/logic-errors/weak-dominance-comparator-cannot-back-a-superlative-claim.md` — the fifth instance, from the blocklist feature: a superlative built on a tie-keeping comparator. Adds the strictness trip-word above.
- `docs/solutions/conventions/prove-a-test-fails-against-the-pre-change-tree.md` — why none of these four was caught by the suite.
- `CONCEPTS.md`'s `Verified` / `Quarantined` entries.
- PRs #179-#183 — the feature sequence these four came from.
