---
title: "A vacuous guard is recognizable before you run it — four shapes, and the assertion that keeps each one honest"
date: 2026-08-22
category: conventions
module: tests
problem_type: convention
component: testing_framework
severity: high
resolution_type: test_fix
applies_when:
  - "Writing a guard that spies on or monkey-patches a module export the consumer captured into a module-scope binding at load time"
  - "Comparing two `indexOf` results to prove ordering, where an absent marker yields -1 and satisfies the comparison"
  - "Asserting that a feature renders nothing, on a tree where the feature does not exist yet"
  - "Slicing source text between a start marker and an end marker that also occurs earlier in the same file"
  - "Reviewing a new test that passed on its first run and was never observed red"
  - "Writing guards for a change that is mostly removal or suppression, where every assertion is naturally an absence"
symptoms:
  - "A newly written guard passes against the pre-change tree — green in exactly the state it exists to rule out"
  - "A spy asserts zero calls because the patched export was never the reference the consumer holds"
  - "An ordering assertion passes when the element being ordered is absent entirely (-1 < any index)"
  - "A negative assertion is trivially true because no positive case exists anywhere in the tree"
  - "A completeness loop iterates zero times over an empty source slice and reports success"
tags:
  - ddo
  - testing
  - vacuity
  - prove-red
  - guards
  - source-assertion
  - positive-control
related_components:
  - tests/results.test.js
  - tests/projection.test.js
  - web/results.js
  - web/projection.js
---

# A vacuous guard is recognizable before you run it — four shapes, and the assertion that keeps each one honest

## Context

The results-phase UI clarity work (plan `docs/plans/2026-08-22-001-feat-results-phase-ui-clarity-plan.md`; no tracking issue — the plan's filed deferrals are #447 and #448) removed a per-item marker, contained eleven flat solve notices in one classified panel, and gave that panel a summary pill. Across three commits — `c614bfb` (U4), `51e37e7` (U5), `b6f3f86` (U6), all on the unmerged `feat/results-phase-ui-clarity` branch as of this writing, with no PR opened yet, so these SHAs are pre-merge and will be rewritten if the branch is squashed — locate them by their subject lines, quoted under **Examples** — **four newly-written guards passed when run against the pre-change tree**. Each was asserting nothing, and each was asserting nothing in exactly the state it existed to rule out.

None was caught by review, by a failing run, or by reading the assertion. All four were caught by the same standing ritual: this repo requires each new test to be run against the pre-change tree and observed red (`docs/solutions/conventions/prove-a-test-fails-against-the-pre-change-tree.md`). The gate did its job four times in three commits. Each commit message records the catch in its own words.

What that gate does not leave behind is a reason. It says "this test passed where it should have failed"; it does not say *why*, and the why turned out to be four recognizable shapes — none of them exotic, all of them re-writable by anyone in a hurry:

1. **A spy on a binding the code captured before the spy existed.** U4 removed `whyThisLine`'s call to `saturatedStats`. The guard monkey-patched `Proj.saturatedStats` after `require("../web/projection.js")`, called `R.whyThisLine(...)`, and asserted the call count was 0. But `web/results.js` binds the reference at module load — `var saturatedStats = Proj.saturatedStats;` (`web/results.js:42`, inside the shared-primitive binding block at `web/results.js:31-48`). Patching the module object afterwards never reaches the captured reference. The counter reads 0 whether the call was removed or not.

2. **An `indexOf` ordering comparison in which −1 is a passing value.** U5 needed the notices panel to precede, and remain a sibling of, the live "Return to optimum" bar rather than being folded inside it. The guard sliced the `renderResults` template and asserted `panelAt < barAt`. `indexOf` returns −1 when the marker is absent, and −1 is less than every real index — so on a tree with no panel at all the assertion passed.

3. **A negative assertion with no positive control.** U6's "zero actionable notices render no pill element" asserted `!/notes-pill/.test(html)`. On a tree that had no pill feature, no markup anywhere could match, and the assertion was true for a reason that had nothing to do with the descriptor set it was fed.

4. **A source slice whose end marker matched earlier in the file.** U6's completeness loop reads `web/projection.js` as text and enumerates every notice-entry `id:` the three entry functions can mint — `artifactNoticeEntries` (`web/projection.js:2029`), `zeroSourceNoticeEntries` (`:2050`), `boundNoticeEntries` (`:2094`) — asserting each has a curated subject in `NOTICE_ENTRY_SUBJECTS` (`web/results.js:1018`). It sliced from `indexOf("function artifactNoticeEntries")` to `indexOf("constraintPairs")`. But `constraintPairs` is defined roughly seven hundred lines earlier, at `web/projection.js:1336`, with call sites at `:1375` and `:1545`; the export-list occurrence the guard wanted is at `:2181`. The end index landed before the start index, `String.prototype.slice` returned `""` rather than throwing, and the loop iterated zero ids.

Shape 4 has a second lesson attached, and it is the reason this doc exists at all. It was **not** caught by the pre-change run in the ordinary way — a loop over nothing is silent. It was caught because the same test also asserted `ids.length >= 11`: a count assertion on the slice's own yield. Without that line the empty slice would have been indistinguishable from a fully-satisfied curation, and the guard would have gone on reporting complete coverage of a file it had stopped reading.

## Guidance

**Every sibling rule in this corpus prescribes a *run* — archive the base tree, mutate the
implementation, corrupt the input, read the CI glob. This one is about what you can see
without running anything.** All four shapes below are recognizable from the assertion's own
text, and all four were written by an author who then did run the base-tree gate and did read
the result. The gate is what caught them; their shape is what would have prevented them.

**The pre-change run tells you a guard is vacuous. Fix it by adding the countermeasure to the test, not by re-running the gate until it goes red.** The gate is a one-time ritual at authoring time; the countermeasure stays in the file and keeps working after the feature ships, when nobody will run the pre-change comparison again. Each of the four shapes has a specific one.

### 1. A spy cannot measure a call through a captured binding — assert the source instead

`web/results.js` captures every shared primitive from projection at load (`web/results.js:31-48`). Patching the module export after the fact leaves the captured reference untouched, so a call-count spy on `Proj.saturatedStats` reads zero on every tree.

Reconstructed from `c614bfb`'s message — the vacuous form was fixed in-branch and never landed, so this is the shape, not the exact committed text:

```js
// BEFORE (never committed): passes on the pre-change tree.
const Proj = require("../web/projection.js");
let calls = 0;
const real = Proj.saturatedStats;
Proj.saturatedStats = (...a) => { calls++; return real(...a); };
R.whyThisLine(res, { slot: "Ring", variant_id: "R" });
assert.strictEqual(calls, 0, "the lookup went with the marker");
```

The shipped form (`tests/results.test.js:2463-2475`) reads the function's own text, in the idiom `tests/wizard.test.js` already uses for wiring it cannot execute (that file states outright that DOM behaviour is asserted against source text — see `tests/wizard.test.js:1769-1771`):

```js
const src = R.whyThisLine.toString();
const body = src.slice(0, src.indexOf("pd-prio"));
assert.ok(!/saturatedStats\s*\(/.test(body), "the lookup went with the marker, not just its output");
assert.ok(!/saturationLineFor\s*\(/.test(body), "and so did the per-item sentence it fed");
assert.ok(typeof R.saturatedStats === "function",
  "but the binding stays on the re-export surface projection.test.js pins");
```

The third assertion is doing separate work worth naming: the binding survives deliberately, because it is on the re-export surface at `web/results.js:2000` that `tests/projection.test.js` pins against projection's own. Deleting it turns the parity test red rather than the renderer, so the guard pins the *removal of the call* and the *retention of the binding* as two facts.

**The general rule: before writing a spy, find where the code under test acquires the thing you are patching.** If it captured a reference at load, at construction, or into a closure, the spy measures your patch and nothing else. Patch at the acquisition point, inject the dependency, or drop to a source assertion.

### 2. Assert both indices are present before comparing them

```js
// BEFORE: -1 < anything, so this passes when the panel does not exist.
assert.ok(tpl.indexOf("noticePanel(notices)") < tpl.indexOf("active-build-bar"), "...");
```

```js
// AFTER — tests/results.test.js:2632-2640
const panelAt = tpl.indexOf("noticePanel(notices");
const barAt = tpl.indexOf("active-build-bar");
// Both indices are asserted PRESENT before they are compared. Written as a bare
// `panelAt < barAt` this passes when the panel is absent entirely (-1 is less
// than anything), which is exactly the state it exists to rule out.
assert.ok(panelAt >= 0, "the panel is in the template");
assert.ok(barAt >= 0, "and so is the active-build bar");
assert.ok(panelAt < barAt,
  "the live Return-to-optimum control is a sibling of the panel, never folded inside it");
```

This one paid for itself one commit later, inside the same branch. `b6f3f86` gave `noticePanel` a second argument — the call site now reads `${noticePanel(notices, { latched: !!notesSeen })}` (`web/results.js:1498`) — which invalidated the guard's marker. The diff shows the marker being loosened from `"noticePanel(notices)"` to `"noticePanel(notices"` in the same commit. With the `>= 0` assertion in place a stale marker fails at the presence check; without it, `panelAt` silently returns to −1 and the ordering comparison starts passing again for the original bad reason.

**Any comparison that consumes a sentinel — `indexOf`, `findIndex`, `search`, a `.get()` returning `undefined`, a null-yielding regex `exec` — needs the sentinel excluded before the comparison, not after.** A sentinel that sorts below every real value is a passing value in a `<` test.

### 3. Pair every absence assertion with a positive control in the same test

```js
// AFTER — tests/results.test.js:2700-2708
const none = R.noticePanel(_marks(["qualifying", "informational"]));
assert.ok(!/notes-pill/.test(none), "nothing to act on, nothing to pulse");
// The positive control is what makes the line above mean anything: without it
// the assertion also passes on a tree that has no pill at all, which is the
// state it exists to distinguish from.
const some = R.noticePanel(_marks(["qualifying", "informational", "actionable"]));
assert.ok(/notes-pill/.test(some), "and adding one actionable card does produce a pill");
```

The control must be **the same call with one input changed** — here the same descriptor helper (`_marks`, `tests/results.test.js:2674-2677`) with one `"actionable"` added. That is what makes the pair a statement about the input rather than about the tree: the feature exists, this renderer can produce the element, and *these* descriptors are why it did not.

**A test asserting that something does not appear proves nothing until the same test has made it appear.**

### 4. A source-derived enumeration needs a count assertion on its own yield

```js
// BEFORE: `constraintPairs` first matches at web/projection.js:1336, ~700 lines
// before the start marker. end < start, so slice returns "" and the loop is empty.
const region = src.slice(src.indexOf("function artifactNoticeEntries"), src.indexOf("constraintPairs"));
```

```js
// AFTER — tests/results.test.js:2736-2742
const from = src.indexOf("function artifactNoticeEntries");
const region = src.slice(from, src.indexOf("constraintPairs,", from));
const ids = [...new Set([...region.matchAll(/\{\s*id:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]))];
assert.ok(ids.length >= 11, `expected the eleven split branches, saw ${ids.length}`);
for (const id of ids) {
  assert.ok(R.NOTICE_ENTRY_SUBJECTS[id], `${id} can be minted but has no U6 subject`);
}
```

Two halves, both required. **Pass a `fromIndex` to every end-marker search** so the end can only be found after the start — a marker unique in your head is rarely unique in a 2,200-line file. **And assert a floor on what the enumeration yielded**, because `slice` saturates rather than throwing on inverted bounds, exactly as `slice` saturates on an over-long end index elsewhere in this repo's guards.

The count assertion is the load-bearing half: it is the only reason this shape was visible at all. A `for` loop over zero items runs green on every tree, so the pre-change run cannot see it, and nor can a mutation check — deleting a curated subject cannot redden a loop that never reaches it.

## Why This Matters

The repo already mandates the two checks that catch most vacuity: run each new test against the pre-change tree, and mutate the line it claims to cover. Both work. Neither, on its own, leaves anything behind in the file.

That matters because the pre-change tree stops existing. Once this branch merges, nobody will `git archive` the merge-base to re-validate these four guards, and if a later refactor re-introduces the vacuity — a marker goes stale, the panel call site changes shape, a slice inverts — the guard goes back to reporting success at exactly the wrong moment. Three of the four countermeasures above (`>= 0`, the positive control, `ids.length >= 11`) are permanent, in-file versions of the same question the gate asked once. That is the upgrade this doc argues for: when the gate catches a guard, do not just make it red — make it unable to be silently green again.

There is a second reason, specific to this branch's density. Four vacuous guards in three commits is not carelessness; it is what happens when a feature is mostly *removal* and *containment*. U4 removed a call, U5 moved a panel out of a bar, U6 suppressed a pill — and a guard for a removal is naturally written as an absence assertion, which is the family with no natural failure mode. Features that are shaped like deletions produce guards that are shaped like tautologies. Expect the ratio, and budget for it.

Finally, the count assertion in shape 4 is worth its own line in a checklist. It was written for a different purpose — to pin that the eleven split notice branches all carry subjects — and it caught a defect it was never aimed at. A cheap assertion about *how much a test examined* is the only thing standing between a source-reading guard and an empty string.

## When to Apply

- **When a new test passes against the pre-change tree.** Match it against these four shapes before rewriting: a spy on something the code captured, a comparison a sentinel satisfies, a negative with no positive, an empty enumeration. The shape tells you which in-file countermeasure to add, and the countermeasure is the actual deliverable — a red run is only the receipt.
- **Before writing any spy or monkey-patch in this repo.** `web/results.js` is not unusual: the shared classic-script modules bind their imports at load (`web/results.js:31-48`). A spy on the module object is inert against every one of those bindings. Check the acquisition point first.
- **Whenever a comparison, sort, or bound consumes a sentinel** — `indexOf`, `findIndex`, `search`, `lastIndexOf`, a map lookup that can return `undefined`. Assert presence, then order.
- **Whenever a guard asserts an element, class, field, or entry is absent.** Add the positive arm in the same test, from the same call, differing by one input.
- **Whenever a test slices source text** — the established idiom here for DOM wiring and code placement. Pass `fromIndex` to the end-marker search, and assert a floor on what the slice produced. Any test containing `readFileSync`, `_SRC`, `.toString()`, or a bare `indexOf` pair deserves this pass.
- **Whenever a guard's assertions are shaped like a deletion.** Removal work generates absence assertions, and absence assertions default to vacuous.

## Examples

- `tests/results.test.js:2463-2475` — shape 1, shipped: the source-text form of the U4 guard, with the in-test comment explaining why a spy cannot measure a captured binding, plus the re-export retention assertion.
- `tests/results.test.js:2629-2641` — shape 2, shipped: both `>= 0` presence assertions ahead of the `panelAt < barAt` ordering comparison.
- `tests/results.test.js:2700-2708` — shape 3, shipped: the absence assertion and its one-input-apart positive control.
- `tests/results.test.js:2727-2748` — shape 4, shipped: the `fromIndex` end-marker search, the `ids.length >= 11` floor, and the per-id subject loop.
- `web/results.js:42` (with the explanatory block at `:37-41`) — `var saturatedStats = Proj.saturatedStats;`, the load-time capture that makes a post-`require` spy inert; `web/results.js:2000` — the re-export surface `tests/projection.test.js` pins, which is why the binding stays.
- `web/results.js:1498` — `${noticePanel(notices, { latched: !!notesSeen })}`, the call site whose new second argument stale-dated the U5 marker one commit after the guard was written.
- `web/projection.js:1336` (`function constraintPairs(rec)`) versus `web/projection.js:2181` (`constraintPairs, constraintLines,` in the export list) — the two occurrences whose collision emptied the U6 slice; the enumerated entry functions live at `:2029`, `:2050`, `:2094`.
- Commits `c614bfb` (`feat(results): remove the per-item ceiling marker`), `51e37e7` (`feat(results): contain and classify the eleven solve notices`) and `b6f3f86` (`feat(results): the attention pill and the qualifying marker`) on `feat/results-phase-ui-clarity` (unmerged, no PR as of this writing; branch head `d562015`, `chore(build): stamp 08222026.3`). **The SHAs are pre-merge and volatile** — a squash rewrites them, so the subject lines above are the durable handles. Each message names its own catch — `c614bfb`: "One new guard was written as a call-count spy and PASSED on the pre-change tree, which made it inert"; `51e37e7`: "written as `panelAt < barAt` and PASSED on the pre-change tree"; `b6f3f86`: "two more guards were caught passing on the pre-change tree."
- `tests/results.test.js` runs green in full at the current tree (`node tests/results.test.js`, exit 0), so every citation above is to a live, passing guard.

## Related

- `docs/solutions/conventions/prove-a-test-fails-against-the-pre-change-tree.md` — owns the gate that caught all four of these, plus the mutation-check addendum for source-regex tests. **New here:** the taxonomy of *why* a guard passes on the base tree, and a per-shape countermeasure that lives in the test file after the gate has been run once. That doc's remedies are re-authoring moves (enter through the production entry point, import the constant); these are assertions you add beside the one you already wrote.
- `docs/solutions/conventions/assert-non-vacuity-for-every-surface-in-a-loop-test.md` — **already covers the countermeasure for shape 4**: prove the structures a loop iterates actually exist. Do not re-derive it here. What is new is the cause and the specific defense: there the fixture never minted the structures; here the enumeration's *source* was an empty string because a marker search matched the wrong occurrence, and the fix is a `fromIndex` on the end-marker search plus a floor on the yield. Its closing reviewer technique — read what the builder actually minted, do not reason from intent — is the same instinct applied to a slice.
- `docs/solutions/conventions/a-source-adjacency-guard-makes-code-placement-load-bearing.md` — **already documents the marker-collision mechanism itself** (a second `rerender();` inverting slice bounds in `tests/wizard.test.js`), framed as a diagnosis aid: a test fails naming something unrelated to your change. **New here:** the same collision with the opposite symptom. When the emptied slice feeds a `for` loop or a negative assertion instead of a positive regex, it does not fail — it passes, permanently and quietly. Its "grep the failing test for `indexOf`" tell needs a companion: grep the *passing* ones too.
- `docs/solutions/conventions/a-guard-that-copies-its-parameter-measures-the-copy.md` — a harness holding its own copy of a production constant, and `slice` saturating rather than raising. Shape 1 is the mirror image: production holds the copy (`web/results.js:42`) and the test patches the original. Same root — two references you assumed were one — pointed the other way. Its "make an out-of-range parameter throw, not truncate" rule is the reason shape 4 needs an explicit floor: JavaScript will not raise on inverted `slice` bounds, so the test must.
- `docs/solutions/conventions/a-source-guard-must-pin-the-property-not-the-syntax-beside-it.md` — **the counterweight, and this doc should not pretend otherwise.** Shape 1's remedy replaces a runtime spy with a source assertion, and that doc's whole warning is that source assertions over-specify: they pin the shape of the code and go red on a refactor that preserved everything the guard protects. This branch demonstrated both halves within three commits. Shape 1's source assertion is the right call because no runtime observation of a load-time capture is available at all — its rule's own "reach for the regex only where extraction genuinely is not available" clause. Shape 2's marker is the cautionary half: `"noticePanel(notices)"` went red for exactly the reason that doc names — a second argument was added and protected nothing changed — and was loosened to `"noticePanel(notices"`. Prefer the narrowest marker that still names the property, and pair it with a presence assertion so that loosening it cannot quietly re-introduce vacuity.
- `docs/solutions/conventions/a-test-that-defines-the-rule-it-asserts-proves-nothing.md` — routes every assertion through an imported symbol. All four guards here **did** route through imported symbols (`R.whyThisLine`, `R.noticePanel`, `R.NOTICE_ENTRY_SUBJECTS`) and still proved nothing, which places that rule as necessary and not sufficient — and consistent with its own note that prove-red catches this class for free.
