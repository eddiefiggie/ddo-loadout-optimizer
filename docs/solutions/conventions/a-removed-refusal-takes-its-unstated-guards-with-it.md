---
title: "A removed refusal takes its unstated guards with it"
module: wizard
date: 2026-08-21
category: conventions
problem_type: convention
component: tooling
severity: critical
related_components:
  - character_persistence
  - solver_run_state
tags:
  - precondition-removal
  - guard-removal
  - save-overwrite
  - data-loss
  - stale-state
  - character-persistence
  - wizard
  - code-review
applies_when:
  - A precondition guard is relaxed or removed to unlock a new, otherwise-desirable product behavior
  - "The guard's stated purpose is narrower than everything it happened to prevent"
  - A long-lived state object outlives the specific entity currently loaded into it
  - "A save or update operation replaces a keyed record wholesale rather than merging onto the prior record"
  - A freshness or staleness flag is derived from a field the relaxed guard used to keep unreachable
---

# A removed refusal takes its unstated guards with it

## Context

`web/wizard.js`'s `saveCurrentCharacter` (`web/wizard.js:3266`) used to open with a
refusal. At the pre-change tree — this branch's merge base, so `git show
c378852:web/wizard.js` still resolves it (lines 3056-3058 there):

```js
if (!state.lastRun || !state.lastRun.result || state.lastRun.result.status !== "optimal") {
  return { ok: false, error: "no-build" };
}
```

Its stated reason was the one the UI gave back: *"Solve a build first."* The Save
control lived only in the results step, so the refusal read as a belt-and-braces
restatement of where the button already was.

Plan #428 removed it deliberately, and the product call was right: a player should
be able to save an in-progress build from any step. The Save control moved out of
the results step into a rail that `render()` emits beside every step body
(`web/wizard.js:3852` — `+ '</div>' + railHTML() + '</div>'`, with the inline
comment saying the rail is emitted there rather than by any step template
precisely so Save and Load are reachable from every step). The refusal was
replaced with a comment saying a save is no longer gated on a solved run
(`web/wizard.js:3269-3272`).

The refusal had been doing two other jobs. Neither was written down, so neither
was re-examined when it was lifted.

**It was a data-loss guard.** `CharacterStore.saveCharacter` replaces a record by
name — `all[record.name] = record;` (`web/persist.js:283-287`), a whole-object
assignment with no merge. And `serializeCharacter` writes `query: run.query ||
null` and `snapshot: stripResult(run.result)` from `const run = lastRun || {}`
(`web/persist.js:234-244`), so a save with no run produces a record whose loadout
fields are empty. Before, that combination was unreachable: the only way to reach
`saveCharacter` was through a solved run. After, typing an existing solved build's
name into the rail in a fresh session and pressing Save wrote the empty snapshot
over it, destroying that record's loadout, query, priorities and build stamp with
no undo — behind a confirm that said only ``Update saved build "${nm}"?`` — the
wording the rail shipped with, replaced by the review fix below.

**It was a staleness guard on a long-lived object.** `state` is one closure object
that outlives any character, and `state.lastRun` is the heaviest thing on it. It
is assigned on solve with `fresh: true` (`web/wizard.js:3219`) and in
`loadCharacter`'s results branch with `fresh: false` plus the record's original
stamp (`web/wizard.js:3517`). The other branch never assigned it. The refusal had
made a stale `lastRun` unreachable as a side effect — Save existed only where a
fresh run necessarily existed. Once Save was on every step, loading build A and
then saving under a new name B wrote A's snapshot, A's query and A's build stamp
into B; and because `run.fresh === false` carried A's `stampedBuildId` forward, B
was born stale and never raised the staleness banner either.

The tests were green throughout — Python and JS both. Every test asserted the
*stated* contract: that an unnamed build cannot be saved, and (after #428) that a
save no longer requires a solved run. Nothing asserted the two unstated ones,
because nobody knew they existed. Both defects were found by an adversarial
multi-agent review of the branch that attacked *sequences* of UI actions rather
than single statements, and both were closed on
[PR #429](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/429), which is
open and unmerged as of this writing.

## Guidance

**A refusal you remove takes with it whatever guard it was silently performing.**
When you relax a precondition, the question is not "is the stated reason still
true?" It is *"what else was unreachable while this held?"* A refusal placed for
one reason often becomes load-bearing for a second, and the second one is never
in the error string — which is exactly why removing the first re-examines only
the first.

The mechanical version of the question, for a precondition of the form *"refuse
unless P"*:

1. **What did P guarantee about the state downstream?** Here P guaranteed
   `state.lastRun` was a solved, current-session run. Every line after the
   refusal was written against that guarantee, including lines that never mention
   `lastRun` — `serializeCharacter`'s `run.query || null`, the stamp selection,
   the replace-by-name write.
2. **What writes or destroys data downstream?** Trace to the actual store call.
   `saveCharacter` replaces; it does not merge. A precondition that gated a
   destructive write *was* the confirmation dialog, whether or not anyone called
   it that.
3. **What long-lived state was unreachable-when-stale only because P was rare?**
   A precondition that fires at one point in a flow can be the only thing keeping
   a stale field from being read at another. Removing it widens the *call sites*
   of everything below it, not just its own branch.

**Replace an implicit guarantee with an explicit predicate, not with nothing.**
The fix for the staleness half is `runBelongsTo(run, name, loadedName)`
(`web/wizard.js:140-145`), a pure predicate that attributes a live run to the save
being written:

```js
function runBelongsTo(run, name, loadedName) {
  if (!run) return false;
  if (run.fresh === true) return true;
  const nm = String(name || "").trim();
  return !!nm && nm === String(loadedName || "").trim();
}
```

`saveCurrentCharacter` now attributes before it writes (`web/wizard.js:3281`), and
`stamp` reads from the attributed `run` rather than from `state.lastRun` directly
(`web/wizard.js:3282-3283`). The second clause is the non-obvious one: a run
loaded from record A is still legitimately A's when A is re-saved without
re-solving, so `fresh` alone would have thrown away the preserved stamp that
keeps a stale build declaring itself stale.

**Prefer preserve-don't-replace over re-adding the refusal.** The data-loss half
was not fixed by restoring the gate — that would have undone the product decision.
`saveCurrentCharacter` reads the prior record first (`web/wizard.js:3285`) and, when
the incoming save has no attributable run, carries the stored loadout forward
(`web/wizard.js:3295-3299`):

```js
if (!run && prev) {
  rec.snapshot = prev.snapshot;
  rec.query = prev.query;
  rec.stampedBuildId = prev.stampedBuildId || null;
}
```

This is the behavior a loaded-then-re-saved build already had; the fix generalizes
it to every runless save rather than inventing a new rule.

**Make the confirm name what is at stake.** ``Update saved build "${nm}"?`` was
true of both outcomes and informative about neither.
`overwriteConfirmText(name, prevHasLoadout, savingSolved)` (`web/wizard.js:154-160`)
takes the two facts as arguments rather than looking them up, so the sentence the
player reads and the write that follows cannot disagree; `trySave` computes
`savingSolved` from the same `runBelongsTo` the write uses
(`web/wizard.js:3603-3605`).

**Close the reset half at the load boundary.** `loadCharacter`'s non-results
branch now clears the field it never sets (`web/wizard.js:3534`), beside its
sibling per-character resets. That is the class already documented in
[a per-character reset discipline keyed on state-object fields](../logic-errors/closure-scoped-ui-state-must-reset-on-character-load.md);
what is new here is *why the gap was invisible* — the reset was genuinely
unnecessary while the refusal stood, so it was not an omission at the time it was
written. It became one the moment the precondition came out.

## Why This Matters

The failure mode of a removed refusal is not a broken build or a red test. It is
a green suite over a widened blast radius. `saveCurrentCharacter` looked *safer*
after #428 — fewer branches, fewer refusals, a friendlier flow — and it had just
acquired the ability to silently destroy a player's solved loadout on a keystroke
collision. The whole point of this project's persistence layer is that a player's
builds survive; a save that eats one is the worst thing the app can do, and
localStorage has no undo.

It also matters that the tests could not have caught it. Both unstated jobs were
properties of *sequences* — save-in-fresh-session-under-existing-name,
load-A-then-save-as-B — and the suite asserts statements. That is not a suite
defect to be fixed by writing more of the same tests; it is the reason a
precondition removal needs a written inventory of what the precondition was
holding, before it comes out. The specific tests that now pin these are
source-slice guards over `saveCurrentCharacter` and `loadCharacter` in
`tests/wizard.test.js:3499-3526`, plus pure-function coverage of `runBelongsTo`
and `overwriteConfirmText` at `tests/wizard.test.js:3457-3497` — all written
*after* review found the defects, which is the honest record.

## When to Apply

- Removing or relaxing any early-return refusal, `assert`, feasibility check, or
  enabled/disabled condition — especially one being removed because a product
  decision made its stated reason obsolete.
- Moving a control from a narrow surface to a broad one (one step to every step,
  one page to a global rail, an admin screen to a general one). The move is the
  precondition removal, even when no `if` is deleted: the reachable call sites
  are what actually widened.
- Reviewing a diff whose net effect is *fewer* guards but *more* entry points.
- Any change that makes a write reachable from a state it previously could not be
  reached from, where the store's write is replace-by-key rather than merge.
- Writing the refusal in the first place: if it happens to protect something its
  error message does not name, say so in a comment at the refusal. That comment
  is the only artifact that will survive to the person who deletes it.

## Examples

The unstated data-loss job, as a sequence — every step legal, the outcome
destructive, on the tree between this branch's merge base and the PR #429 review fix:

1. Solve and save a build as `Sook`. The record carries an optimal `snapshot`,
   its `query`, and the build stamp.
2. Reload the page. `state.lastRun` is `null`; nothing is loaded.
3. Configure a character, do not solve, type `Sook` into the rail's name field,
   press Save.
4. `saveCurrentCharacter` builds a record with `snapshot` empty and `query: null`
   (`web/persist.js:240-241` over an absent run), `saveCharacter` assigns it at
   `all["Sook"]` (`web/persist.js:285`), and the solved loadout is gone.

The unstated staleness job, likewise:

1. Load build `A`. `loadCharacter`'s results branch sets `state.lastRun` with
   `fresh: false` and `stampedBuildId: rec.stampedBuildId` (`web/wizard.js:3517`)
   and sets `state.loadedName = rec.name` (`web/wizard.js:3319`).
2. Step back, rename to `B`, save. Pre-fix, the stamp selection read
   `state.lastRun.fresh === false && state.lastRun.stampedBuildId`, so `B` was
   written with `A`'s snapshot, `A`'s query and `A`'s stamp — and being stamped
   with `A`'s old build id, `B` never raised the staleness banner that would have
   made the substitution visible.
3. Post-fix, `runBelongsTo(state.lastRun, "B", "A")` is `false`
   (`tests/wizard.test.js:3488` asserts exactly this), the run is dropped, and
   the preserve branch or a current stamp applies instead.

Related: [a per-character reset discipline keyed on state-object fields is blind
to closure-scoped UI state](../logic-errors/closure-scoped-ui-state-must-reset-on-character-load.md)
— the same long-lived `state` object, and the mechanism behind this doc's second
defect. That doc answers *which storage must reset on load*; this one answers
*why a reset that was correctly absent yesterday is required today*. Also
[widening eligibility must re-derive derived constraints](../design-patterns/widening-eligibility-must-re-derive-derived-constraints.md)
— the solver-side sibling of the same shape: a relaxation that leaves a
downstream assumption standing on a premise that no longer holds.

Shipped in [#429](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/429),
which is open and unmerged as of this writing; it implements the plan merged as
[#428](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/428)
(`docs/plans/2026-08-21-001-feat-wizard-structure-and-save-progress-plan.md`).
