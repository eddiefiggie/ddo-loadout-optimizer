---
title: "Close a defect at the narrow control, not by widening a shared rule"
module: solver
date: 2026-08-10
problem_type: convention
component: tooling
severity: high
tags:
  - ddo
  - solver
  - bucket
  - stacking
  - blast-radius
  - reachability
  - declared-credits
  - code-review
applies_when:
  - "A defect appears at one caller of a shared invariant — a bucket key, an equivalence map, a normalizer, a comparison rule"
  - "The obvious fix edits the shared rule so the offending caller stops misbehaving"
  - "The same change that fixes the defect also makes a previously unreachable code path reachable"
  - "A change touches a seam an open PR is auditing"
---

# Close a defect at the narrow control, not by widening a shared rule

## Context

Making `Enhanced Ki` rankable (#227) exposed a real double-count. A player's declared "I already have this" credit carries a bonus type chosen from a dropdown; gear carries whatever type the source records. The solver buckets a contribution as `` `${stat}||${equivType(type)}` `` and caps each bucket at one contributor, so same-bucket sources take the max and different-bucket sources add.

Untyped gear keyed `stat||null`. A declared `Untyped` credit keyed `stat||Untyped`. Different buckets, so the two **added** — declaring a bonus you already had inflated the total instead of competing with your gear.

The fix in PR #234 was one line at the shared seam: fold an absent bonus type into `Untyped` inside `equivType` (`web/model.js`). The two keys converge, the double-count disappears, and the entire suite stays green — Python, JS, and the golden solver check.

It was wrong, and PR #235 reverted it.

## Guidance

**Fix the defect where it is specific, not where it is shared.** `equivType` is read by the solver's bucket construction and by the model's dominance guard — every stat, every contribution. The defect was in one control: a credit picker offering a *bonus type* for a stat that has none. Editing the shared rule to fix the narrow control changed behavior for everything else that rule governs.

Two independent sources in this repo already said the widening was wrong:

- `CONCEPTS.md`, the **Feature** entry: *"Deliberately not `untyped`: real untyped bonuses stack, boolean features must not."*
- The bonus-type equivalence audit (PR #224) had independently ruled that items carry an effect untyped while augments carry it as `Untyped`, that the two sum, and that *"collapsing them would break real stacking"* — recorded explicitly as do-not-fix.

**30 stats** carry both an absent type and an explicit `Untyped` — an item's own effect beside an augment's. Folding the two turns a legitimate sum into a max on every one of them.

The corrected fix refuses the *control*: a stat with a real magnitude and no bonus type anywhere is not offered a declared credit, because the control asks for a bonus type it does not have. `Untyped` keys a bucket the gear cannot join; any other type names a bucket nothing in the game supplies. Floors and caps still work — a bound is valid on any bucket. See `canDeclareCredit` and `isUntypedOnly` in `web/wizard.js`, backed by the `untypedOnly` set in `web/dataset.js`.

**When a change makes a path reachable, the tests that pass are the ones that do not cover it.** Solver buckets are built only for target stats. None of the 30 affected stats is in `rankable_affixes`, so no bucket was ever built for any of them and the widening was inert on shipping data. The golden solver check could not move, because the fixtures rank stats the change does not touch. A green suite meant "not currently reachable," not "correct."

That distinction matters because the same PR was *adding* reachability. Four of the 30 — `Efficient Metamagic - Empower`, `- Maximize`, `- Quicken`, and `Arcane Casting Dexterity` — sit in the untyped-affix backlog (#230). Admitting any of them under the widened rule would have silently converted a sum into a max, with no test to notice.

**Before changing a shared seam, check what is already ruled on it.** The contradiction was discoverable before merge and was found after, by reading an open PR's description while preparing to merge it. Two cheap checks would have caught it:

- Grep `CONCEPTS.md` for the concept the seam implements. The Bucket and Feature entries both describe stacking semantics.
- Check open PRs touching the same data or module. `type_stacking_equivalence.json` and `equivType` are the same subject; #224 was open the whole time.

## Why This Matters

A wrong number is this project's worst output — it is indistinguishable from a right one inside a finished loadout. A shared-rule edit distributes that risk across every stat the rule governs, while the defect it fixes lives at one control. The blast radius and the defect are not the same size, and matching them is what keeps a local fix local.

The reachability point generalizes past this codebase. Any change that both (a) edits shared behavior and (b) widens what code paths execute has a window where the edit is untestable by construction: the affected paths are not live yet, so no fixture exercises them, so the suite cannot dissent. The green result is real and means nothing about correctness. The only checks available in that window are the recorded rulings and the reviewer's reading — which is why the two cheap checks above are not optional ceremony.

## When to Apply

- The fix edits a function or table that many callers read, to correct behavior at one of them.
- The change makes previously dead code reachable — a new allowlist entry, a new enabled feature, a widened filter.
- A test suite goes green on a change whose affected inputs you cannot name.
- The change touches a file or concept an open PR is auditing.

## Examples

The widening (PR #234) and the revert (PR #235), at `web/model.js`:

```js
// WRONG — every caller of the shared seam changes so one control stops misbehaving
function equivType(type) {
  if (type == null || type === "") return "Untyped";   // collapses 30 stats' buckets
  return (_STACK_EQUIV[type] != null) ? _STACK_EQUIV[type] : type;
}

// RIGHT — the shared rule is untouched
function equivType(type) {
  return (type != null && _STACK_EQUIV[type] != null) ? _STACK_EQUIV[type] : type;
}
```

The defect closed at its own control instead (`web/wizard.js`):

```js
// A stat with a magnitude but no bonus type anywhere gets no credit control:
// the control asks for a bonus type, and every answer is wrong.
function canDeclareCredit(stat, vocab) {
  return !isPresenceOnly(stat, vocab) && !isUntypedOnly(stat, vocab);
}
```

The regression test that pins the shared rule, so the next attempt to widen it fails loudly rather than passing green:

```js
test("an untyped affix and an explicit Untyped one keep separate buckets, so they sum", () => {
  const item = { /* ... */ affixes: [
    { name: "Acidic", type: null, value: 6, unit: "flat" },       // the item's own effect
    { name: "Acidic", type: "Untyped", value: 4, unit: "flat" },  // an augment's
  ] };
  const keys = [...M.variantBuckets(item, new Set(["Acidic"]), 34).keys()];
  assert.strictEqual(keys.length, 2, "two buckets, so the two values add");
});
```

Note what this test does that the golden check could not: it names a stat the widening would have broken and asserts the bucket count directly, rather than waiting for a solve whose fixtures happen to rank that stat.

## Related

- `prove-a-test-fails-against-the-pre-change-tree.md` — the sibling discipline. A green suite proves nothing about a diff it does not cover; this entry is the case where the diff itself creates the coverage gap.
- `docs/wiki-evidence/bonus-type-equivalence.md` (PR #224) — the None-vs-Untyped ruling this violated, including the do-not-fix note.
- `CONCEPTS.md` — the **Bucket** and **Feature** entries, which state the stacking rule the widening contradicted.
