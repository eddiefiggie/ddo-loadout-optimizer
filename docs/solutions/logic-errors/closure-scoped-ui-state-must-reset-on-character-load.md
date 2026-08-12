---
title: A per-character reset discipline keyed on state-object fields is blind to closure-scoped UI state
date: 2026-08-12
category: logic-errors
module: web
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - Ticking blocklist checkboxes for character A, then loading character B, leaves A's staged selection live on B's screen
  - "Clicking 'Block selected (N)' after a character switch commits the previous character's staged ids into the new character's blocklist"
  - A hand-edited backup with non-string blocklist entries produces unremovable ghost rows that every save re-persists
root_cause: missing_workflow_step
resolution_type: code_fix
severity: high
tags: [wizard, state-reset, closure, character-load, blocklist, load-boundary, code-review]
---

# A staged block-selection Set outlives the character it was staged for, so a tick made for character A can commit into character B's blocklist

## Problem

Issue #110 added a staged multi-select for the blocklist feature in `web/wizard.js`: the
player ticks checkboxes across successive searches, and one "Block selected (N)" action
commits the accumulated set into `state.blocklist`. The staging accumulator is
`const blockStage = new Set();` (`web/wizard.js:1268`), declared once in the wizard app's
closure — not a field on `state`.

The repo has a standing discipline for exactly this shape of bug: every per-character
`state.*` field must be reset unconditionally in `loadCharacter`, because `state` is a
single long-lived object that outlives any one character (`web/wizard.js:2053-2055`
documents the rule inline, citing it from the original U1/KTD7 work: *"the state object
outlives a character, so a field not reset on load stays live from the previous one"*).
That discipline is also pinned by tests — the WIZARD_SRC-slice pattern in
`tests/wizard.test.js` greps the source of `loadCharacter` to assert specific reset lines
are present.

`blockStage` fell through that discipline. It accumulates per-character UI intent (which
rows are ticked, pending commit) exactly like a `state.*` field does, and committing it
mutates character state exactly like a `state.*` field does — but it is a closure variable,
not a property of `state`, so neither the reset convention's "reset every `state.*` field"
framing nor the tests that grep for `state\.\w+ = ` on the load path had any reason to catch
it. Per the PR's review record, three independent review lenses (correctness, frontend-races,
adversarial) converged on it before merge — PR #271's body records it among the six
validated findings applied as review fixes.

## Symptoms

- Tick one or more rows in the block-search results for character A (`blockStage` now holds
  A's ids; the stage bar shows "Block selected (N)" per `renderBlockStage()`,
  `web/wizard.js:1271-1295`).
- Load character B via `loadCharacter` (`web/wizard.js:2021`) without clicking "Clear
  selection" first.
- The stage bar still reads "Block selected (N)" for B's screen, because `blockStage` was
  never touched by the load.
- Clicking "Block selected (N)" on B's screen calls the commit handler
  (`web/wizard.js:1282-1292`), which reads `[...blockStage]` — A's staged ids — and adds
  them into `state.blocklist` for character B, silently blocking gear for the wrong
  character.

## What Didn't Work

**Relying on the existing reset convention as written.** The convention (and its
WIZARD_SRC-slice test coverage) is phrased and enforced in terms of `state.*` fields: every
field on `state` gets an explicit reset line in `loadCharacter`, checked by asserting the
line's presence in a source slice. `blockStage` satisfies the *spirit* of the rule — it is
per-character UI intent whose commit mutates character state — but not its *letter*, because
it lives in the closure rather than on `state`. The feature's own load-path comment at
`web/wizard.js:2053-2058` cites the U1/KTD7 "always assign" rule while restoring
`state.blocklist` two lines above the very closure variable that violates the rule's intent.
Nothing in the original #110 implementation or its tests treated "is this a `state.*` field"
as the wrong question to ask.

**Assuming a `Set`-typed container was safe from stale data.** The accumulator's own comment
(`web/wizard.js:1268`: `// UI-transient; never persisted`) is true and irrelevant — the bug
is not that `blockStage` gets persisted, it's that it survives a character *swap* it was
never scoped to.

## Solution

Two fixes landed together in PR #271, both in `loadCharacter` (`web/wizard.js:2021`),
alongside the existing `state.blocklist` restore:

**1. Clear the staged selection on every load**, `web/wizard.js:2062-2065`:

```js
// review fix — the STAGED selection is per-character UI state too: ticks
// staged on the previous character must not commit into this one.
blockStage.clear();
state.blockRefusedMsg = null;
```

Placed immediately after the `state.blocklist` restore block (`web/wizard.js:2059-2061`),
so the staging accumulator and the pending-refusal message reset in the same place the
persisted list is restored, instead of being treated as a separate concern.

**2. Sanitize blocklist elements at the same load boundary**, `web/wizard.js:2059-2061`:

```js
state.blocklist = Array.isArray(i.blocklist)
  ? i.blocklist.filter((x) => typeof x === "string" && x)
  : [];
```

This is a sibling load-boundary bug, not the same bug: a hand-edited backup file can carry
non-string entries in `blocklist` (numbers, objects, empty strings). `removeBlock`
(`web/wizard.js:518-520`) removes by strict equality — `(blocklist || []).filter((x) => x
!== id)` — against an `id` that always originates as a DOM `dataset` attribute, which is
always a string. A non-string entry can never `===` a string `id`, so it becomes an
unremovable ghost row that every subsequent save re-persists. The `typeof x === "string" &&
x` filter (rejecting non-strings and the empty string) closes that off at the one place
untrusted data enters `state.blocklist`.

Both fixes are pinned in `tests/wizard.test.js:1762-1775` using the repo's WIZARD_SRC-slice
pattern — the tests grab the source text of `loadCharacter` from `WIZARD_SRC` and assert the
fix lines are present in it, the same technique used for the pre-existing `state.*` reset
checks:

```js
test("review/#110: the load path clears the staged block selection", () => {
  const start = WIZARD_SRC.indexOf("function loadCharacter(");
  const slice = WIZARD_SRC.slice(start, start + 4000);
  assert.ok(/blockStage\.clear\(\);/.test(slice), ...);
  assert.ok(/state\.blockRefusedMsg = null;/.test(slice), ...);
});

test("review/#110: the load path sanitizes blocklist elements to non-empty strings", () => {
  ...
  assert.ok(/i\.blocklist\.filter\(\(x\) => typeof x === "string" && x\)/.test(slice), ...);
});
```

## Why This Works

`blockStage.clear()` in the load path guarantees no ticked-but-uncommitted id from a
previous character can reach the commit handler for a newly loaded one, because the clear
runs unconditionally on every `loadCharacter` call — the same guarantee the existing
`state.*` resets give, applied to the one accumulator that lives outside `state`.
`state.blockRefusedMsg = null` resets alongside it because a stale refusal message is the
same class of leak: text describing character A's mutex conflict rendered under character
B's list (`web/wizard.js:1332-1334` reads and then clears it on next render, but only if a
load hadn't already left a stale value sitting there to be shown once).

The element-sanitization fix works because it moves validation to the boundary where
untrusted data (a hand-edited save file) enters the trusted invariant the rest of the
blocklist code assumes: every entry is a non-empty string comparable by `===` to a DOM
dataset value. Filtering at load time means every downstream consumer — `removeBlock`,
`addBlocks`, `blockStale`, `blockPinOverlap` — can keep assuming clean strings without
re-validating.

Pinning both with the WIZARD_SRC-slice pattern (rather than only the pure-function unit
tests already covering `addBlocks`/`removeBlock`/`blockStale`) matters because the bug lives
entirely in the DOM-bound load path, which the pure-function tests structurally cannot
reach — the slice-and-regex technique is the repo's established way to pin behavior inside
`<script>`-embedded browser code without a DOM harness.

## Prevention

**Any closure-scoped collection that accumulates per-character UI intent is per-character
state whenever committing it mutates character state — reset it in the load path, even
though it is not a `state.*` field.** The load-path reset convention is usually phrased as
"reset every `state.*` field," but that is a proxy for the real rule: *any storage the
character-load boundary must reset is storage a stale value could leak across characters
through.* A closure variable like a staging `Set`, a pending-message string, or an
in-progress form buffer qualifies exactly when it is one commit action away from writing
into `state` for whichever character happens to be loaded at the time. When adding a new
staged/pending accumulator to a wizard-style flow, ask "does committing this write into
character state?" rather than "is this a `state.*` field?" — and pin the reset with the same
WIZARD_SRC-slice test pattern already used for `state.*` resets, since that pattern works on
any source-level construct, not just `state` assignments.

**Sanitize collection *elements*, not just the container type, at any load boundary that
accepts hand-edited or externally-produced input.** `Array.isArray(i.blocklist)` alone was
already present before this fix and was not sufficient — a valid array can still carry
invalid elements. Whenever a downstream comparison depends on a specific element type (here,
strict `===` against a DOM dataset string), filter for that type at the boundary where the
data was last untrusted, not deeper in the pipeline where every consumer would otherwise need
its own defensive check.

## Related

- [The empty-seed convention masking consuming bugs](../conventions/exclude-until-verified-empty-seed-masks-consuming-bugs.md) — the same family of bug in a different runtime: state living outside the object a reset/restore convention explicitly walks (there a Python module-level global, here a JS closure Set) survives a boundary crossing, masked because only the default/inert path was tested.
- [Browser-verify against real data, not just unit tests](../developer-experience/browser-verify-against-real-data-not-just-unit-tests.md) — its "reset persisted client state before each run" guidance would NOT have caught this: the closure Set is neither in `state` nor in storage, so clearing storage before a manual pass surfaces nothing. Only a load-path reset pinned at the source level covers it.
- Issue #110 / PR #271 — the blocklist feature this landed in; the leak was caught by PR #271's multi-agent review pass, not by the existing test discipline — which is the evidence for this doc's central claim.
