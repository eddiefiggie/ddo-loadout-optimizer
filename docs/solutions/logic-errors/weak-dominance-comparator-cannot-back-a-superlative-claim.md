---
title: A weak-tie-keeping comparator cannot back a strict superlative claim
date: 2026-08-12
category: logic-errors
module: solver
problem_type: logic_error
component: solver
symptoms:
  - "Blocking one of two identical variants printed 'out-valued every remaining candidate' while the identical twin survived and the solve was unchanged"
  - "bestAvailable used pool.every(dominates(...)), which under weak tie-keeping semantics reads as >= not >"
  - The false superlative reached the app banner and all four prose exports through the shared notice source
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [solver, dominance, comparator, superlative, never-infer, blocklist, boundary-case]
---

# A weak-tie-keeping comparator cannot back a strict superlative claim

## Problem

The #110 blocklist attribution feature (`docs/plans/2026-08-11-002-feat-blocklist-plan.md` U7) needed to tell a player, per blocked variant, whether it had been the best available candidate in its pool before exclusion. `web/projection.js:322-324` (`blockNoticeLines`) prints the superlative sentence:

```js
if (e.bestAvailable) {
  lines.push(`${e.name} out-valued every remaining ${e.pool} candidate under your `
    + "priorities before it was excluded.");
}
```

That sentence appears in the app's block-notice banner and, per `blockNoticeLines`'s own docstring at `web/projection.js:304-306`, is "ONE source for the app notice and every export" — so it also reached all four prose exports.

`e.bestAvailable` was computed with `web/model.js`'s `dominates(A, B, targetSet, mlCap)` (`web/model.js:365`) — the project's single value comparator, built for the dominance pre-filter (`dominanceFilter`). Its deliberately weak tie behavior is documented at `web/model.js:439`: `dominates` returns true when A is "strictly better somewhere, OR keep A as the canonical of an equal pair." That weakness is a soundness requirement for pruning: when two variants are exactly equal, one must survive as the canonical, and the pruning code (`web/model.js:567`, "B dominates A, and to break exact ties keep the lower index") relies on `dominates` returning true for an equal pair so one twin can be kept and the other dropped without either being wrongly discarded.

The original `bestAvailable` computation (before the review fix) was:

```js
bestAvailable: pool.length > 0 && pool.every((s) => dominates(b, s, targetSet, mlCap)),
```

`pool.every(dominates(blocked, survivor))` under weak semantics reads as "blocked >= every survivor," not "blocked > every survivor." So a blocked variant that merely *tied* every survivor in its pool — rather than beating all of them — satisfied `every()` and printed the superlative "out-valued every remaining candidate," even though at least one identical twin was sitting in the surviving pool, unaffected by the block, and the solve was byte-identical to the unblocked case. The claim was false: the blocked item did not out-value anything, it matched an item that was never removed.

## Symptoms

- Blocking one of two identical Int+10 rings produced the sentence "[Blocked ring name] out-valued every remaining Ring candidate under your priorities before it was excluded" in the app's block-notice banner.
- The same false sentence appeared in all four prose exports, because `blockNoticeLines` is the single source both surfaces read (`web/projection.js:304-306`).
- The underlying solve was unaffected — the identical twin survived and was selected exactly as it would have been without the block — so the loadout itself was correct and only the attribution prose was wrong, the same "perfect loadout, lying prose" failure shape the repo's `never-infer` convention exists to catch.
- Caught pre-merge by the PR's adversarial review lens, not by the original test suite — U7's own test scenarios (`docs/plans/2026-08-11-002-feat-blocklist-plan.md:337-338`) covered "dominates every survivor -> true" and "does not dominate every survivor -> false" but never probed the exact-tie boundary.

## What Didn't Work

Reusing `dominates()` as-is for `bestAvailable` — precisely *because* having one comparator is a repo rule. `web/model.js:812-818`'s comment calls it "the project's one value comparator," and the plan text itself invokes that framing to justify reuse: "`dominates(blocked, survivor, targetSet, mlCap)` — already exported from `web/model.js`, this project's only value comparator" (`docs/plans/2026-08-11-002-feat-blocklist-plan.md:332`). The rule "don't invent a second comparator" is sound; the failure was assuming the pruning-safe tie behavior of that one comparator transfers unchanged to a claim-safe reading. It doesn't — pruning needs "at least as good" so a canonical survives; a superlative sentence needs "strictly better" or it isn't a superlative.

This wasn't just an implementation slip — the plan prescribed the weak predicate verbatim. U7's Approach section states: "'Best available' is asserted only when `dominates(blocked, survivor, targetSet, mlCap)` ... holds against **every** surviving candidate in the same pool" (`docs/plans/2026-08-11-002-feat-blocklist-plan.md:332`), and the corresponding test scenario says the same thing (`docs/plans/2026-08-11-002-feat-blocklist-plan.md:337`: "asserted only where `dominates` holds against every survivor in the pool"). Implementing the plan exactly as written reproduced the overclaim, because the plan named the right comparator but the wrong predicate over it — `pool.every(dominates(b, s))` alone, with no strictness clause. The plan even flags the general risk one paragraph away ("this repo has hit the comparator failure class three times," `docs/plans/2026-08-11-002-feat-blocklist-plan.md:246`) without applying that caution to its own U7 predicate.

## Solution

Strict domination: require the block to dominate every survivor **and** no survivor to dominate the block back — an exact tie dominates both ways, so the second clause demotes it.

```js
// review fix — STRICT domination: dominates() keeps A as the canonical
// of an equal pair, so a tie satisfies the weak predicate and would
// print "out-valued" for a mere match (the never-infer overclaim). The
// second clause demotes exact equals to the no-superlative sentence.
bestAvailable: pool.length > 0 && pool.every((s) =>
  dominates(b, s, targetSet, mlCap) && !dominates(s, b, targetSet, mlCap)),
```

`web/model.js:833-838`. `web/model.js:816-819`'s surrounding comment was updated in the same fix to state the constraint explicitly: "'best available' may only be asserted on the STRONGER claim ... When domination does not hold against all survivors, `bestAvailable` is false and the sentence carries no superlative."

Pinned by a new test, `tests/model.test.js:1630-1636`:

```js
test("review/#110: bestAvailable is NOT asserted on an exact tie", () => {
  const A = v("Blocked Twin", "Ring", [["Intelligence", "Enhancement", 10]]);
  const B = v("Surviving Twin", "Ring", [["Intelligence", "Enhancement", 10]]);
  const m = M.buildModel([A, B], { mlCap: 34, targets: ["Intelligence"], blocklist: ["Blocked Twin"] });
  assert.strictEqual(m.blockReport[0].bestAvailable, false,
    "a tie is a match, not an out-valuing — the superlative must not print");
});
```

This sits alongside the pre-existing U7 scenarios (`tests/model.test.js:1581-1603`, blocked-strictly-better -> true and blocked-strictly-worse -> false) that the weak predicate already passed — the twin test is the boundary case those two didn't reach. Landed via PR #271's fix(review) commit.

## Why This Works

`dominates(A, B)` is true iff A is at least as good as B on every measured dimension (buckets, sets, augment colors, choice-slot pools, etc. — `web/model.js:365-440`). Two variants tie iff `dominates(A, B) && dominates(B, A)` both hold. Adding `&& !dominates(s, b, ...)` to the `every()` predicate excludes exactly that case: it keeps "b beats s on some dimension without being beaten back," which is strict domination, and drops "b matches s in both directions," which is a tie. This changes nothing about `dominates()` itself or about `dominanceFilter`'s pruning behavior — the pre-filter still needs the weak reading to keep one canonical of an equal pair. The strictness check is applied only at the call site that turns the comparator's output into a player-facing claim, so the fix is additive to the existing comparator rather than a second competing one, honoring the "one comparator" rule while giving the claim-consuming code the stronger predicate it actually needs.

## Prevention

A comparator whose tie behavior is calibrated for pruning cannot back a user-facing superlative without an explicit strictness check. `pool.every(weakDominates(x, y))` reads as "x >= every y," which is a `>=` predicate, not a `>` one — and English superlatives ("out-valued," "best," "beat") assert `>`, not `>=`. When the same primitive is asked to serve both an optimizer decision (where a tie is fine to resolve either way) and a player-facing sentence (where a tie must never read as a win), the two call sites need to ask independently which way the comparator's edge cases round, rather than assuming the decision-safe behavior is also claim-safe.

Concretely: whenever a comparator function is reused across a decision boundary and a prose/claim boundary, write a test for the exact-tie / boundary case at the *claim* site specifically — not just at the decision site, where the existing tests (`tests/model.test.js:1581-1603`) already had "beats" and "doesn't beat" coverage and still missed this. The tie case is often already covered for the decision (`dominanceFilter`'s canonical-survivor behavior is exercised elsewhere), which is precisely why it's easy to assume the coverage extends to the claim and skip testing it there again.

This is a direct instance of the repo's `docs/solutions/conventions/never-infer-a-claim-about-your-own-results.md` convention (confirmed present in the tree): a user-facing sentence must be derivable from the data that produced it, and an unqualified superlative that the comparator's semantics don't actually support is the same shape of overclaim that doc catalogs — a well-formed string produced by working code, invisible to the test suite until someone reads the prose against its source predicate. Also note: a plan prescribing a predicate in prose is not verified just because it names the right primitive (`docs/plans/2026-08-11-002-feat-blocklist-plan.md:332` named `dominates` correctly but under-specified the predicate) — plan text is an unverified claim like any other, and following it verbatim reproduced the bug it was trying to prevent.

## Related

- [Never infer a claim about your own results](../conventions/never-infer-a-claim-about-your-own-results.md) — the governing convention; this doc is an instance with a new mechanism (comparator tie-semantics rather than counterfactual or wrong-layer sourcing).
- [MILP encoding for gear optimization](../design-patterns/milp-encoding-for-gear-optimization.md) — the same `dominates()`/`dominanceFilter` code, documenting a *different* failure class (a new value dimension missing from the comparator breaks pruning soundness). Its new-source-family checklist audits the decision side only; this doc covers the claim side.
- Issue #110 / PR #271 — the blocklist feature this landed in; caught pre-merge by the PR's adversarial review lens (probe-confirmed with two identical rings), never shipped.
