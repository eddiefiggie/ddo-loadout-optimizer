---
title: "Autosave on Continue - Plan"
type: feat
date: 2026-08-22
topic: autosave-on-continue
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Autosave on Continue - Plan

## Goal Capsule

**Objective.** Make `Continue →` save the build, and delete the unsaved-changes
guard rather than improve it.

**Tracked as** #452.

**Product authority.** This document, from a maintainer brainstorm on
2026-08-22. Requirements and Key Decisions here are settled unless a later plan
supersedes them in place.

**Open blockers.** None. What remains is implementation shape, under Outstanding
Questions.

**Amends an existing plan.** This reverses **KD1** of
`docs/plans/2026-08-21-002-feat-character-step-naming-and-save-placement-plan.md`,
which chose *"saving stays optional — nothing persists unless the player saves"*
and explicitly rejected *"folding saving into the forward path"*. That decision
is superseded here: saving now rides the forward path. The reversal is possible
only because that plan's **KD2** (the name is required to leave the character
step) shipped — a guaranteed name is what makes an unprompted save well-defined.
KD2, and that plan's R1-R9, are unchanged and are load-bearing for this one.

**Execution profile.** Browser-only. No pipeline, dataset, or seed change.

**Stop conditions.** Stop and surface rather than guessing if autosave cannot be
made to preserve a prior record's solved snapshot (the #429 review #1 hazard), or
if a storage failure cannot be reported without reintroducing a modal on the
forward path.

**Tail ownership.** This plan does not own the commit, PR, or deploy. `main`
deploys on push. Player-facing behavior changes, so the three build markers move
together per `AGENTS.md`.

---

## Product Contract

### Summary

`Continue →` saves the build under its stated name, with no prompt. The
unsaved-changes guard is removed from both the forward path and the load path.
The one case that can still destroy data — a name that collides with a
*different* saved build — asks once per build and is silent thereafter. `Save
progress` remains for saving without advancing.

### Problem Frame

The unsaved-changes guard fires on `Continue →` and asks a question the player
has already answered.

Its message is *"This build has never been saved."* It is not about naming — the
naming path was deleted by #431, which made the build name a fourth required
field that `canAdvance` blocks on. A player physically cannot reach the guard
with an unnamed build going forward. The guard therefore interrupts a flow where
every input it needs is already present, to ask permission for an action that
cannot fail.

Reproduced 2026-08-22 in a headless browser pass: character step filled (name,
ML cap, race, armor), `Continue →` pressed, `#wz-unsaved` intercepts pointer
events and blocks the step change until dismissed.

The guard's cost is not only the click. It trains the player to dismiss a dialog
on the forward path, which is the same reflex that makes a genuinely destructive
prompt ineffective later. And it makes the app's central promise — *"Everything
stays in your browser"* — conditional on the player having pressed the right
button, when the storage is already local, already free, and already keyed by a
name the player was required to supply.

### Key Decisions

- KD1. **Continue saves.** Pressing `Continue →` on any step writes the build
  under its stated name, without a prompt. *(session-settled: user-directed —
  chosen over de-conflicting the guard's wording and over showing it only on the
  first Continue: both keep an interruption on the forward path, which is what
  the report is about.)*

- KD2. **The guard is deleted, not narrowed.** Both the forward path and the
  load path lose it. Loading another build is non-destructive once the current
  one is already saved, so the `isLoad` branch has no remaining hazard to
  guard. *(session-settled: derived from KD1 — a guard whose precondition can no
  longer occur is dead code, and dead UI code is worse than dead logic because
  it can still be reached by a state nobody predicted.)*

- KD3. **A name collision warns once per build, then never again.**
  `CharacterStore.saveCharacter` replaces by name. Where the typed name matches a
  *different* existing record, the first Continue asks; the player's answer is
  remembered for that build and subsequent Continues are silent. *(session-settled:
  user-directed — chosen over silent overwrite, auto-suffixing, and a
  required-field-style block at the name input. Silent overwrite destroys a build
  with no undo; auto-suffixing accumulates near-duplicates the player never
  agreed to; blocking at the field re-adds a gate to the step #431 just
  finished gating.)*

- KD4. **Autosave must not silently destroy a solved snapshot.** #429 review #1
  established that saving an in-progress build over a solved record's name
  destroyed that record's loadout, query and build stamp, and the existing code
  preserves the prior snapshot when the live run does not belong to the name
  being written. Autosave runs that path far more often than a manual save did,
  so the preservation becomes load-bearing rather than incidental.

- KD5. **The storage disclosure must stop implying an opt-in.** The rail
  currently reads *"Saved in this browser only — no account, and cleared if you
  clear browser data."* That sentence is true under autosave, but it sits beside
  a `Save progress` button and reads as describing what that button does. Under
  KD1 every build persists whether or not the player pressed anything, and the
  copy has to say so.

### Requirements

**Saving**

- R1. Pressing `Continue →` on any wizard step saves the build under its stated
  name. No dialog appears on the forward path.
- R2. `Save progress` remains available on every step, for saving without
  advancing.
- R3. A save triggered by Continue is indistinguishable in the stored record from
  one triggered by `Save progress`. There is no "autosaved" flavor of record.
- R4. Autosave preserves a prior record's solved snapshot, query and build stamp
  where the live run does not belong to the name being written (KD4).

**Collision**

- R5. Where the stated name matches an existing record that is not this build,
  the first `Continue →` asks the player to overwrite or rename, and states which
  of the two records carries a solved loadout.
- R6. The player's answer is remembered for the duration of that build. A second
  Continue on a reconciled name does not re-ask.
- R7. R6 survives a step change and a re-solve. It does not need to survive a
  page reload — a reload re-establishes the same facts and asking once more is
  correct rather than annoying.

**Removal**

- R8. The unsaved-changes guard is removed from the forward path.
- R9. The unsaved-changes guard is removed from the load path.
- R10. No path remains that can render `#wz-unsaved`. The element and its
  handlers are deleted rather than left unreachable.

**Failure**

- R11. A save that fails — storage quota, a disabled store, a serialization
  error — is reported to the player and does not block the step change. The
  build advances; the player is told it is unsaved and why.
- R12. R11's report is not a modal. Reintroducing a blocking dialog on the
  forward path would restore the defect this plan removes, in a rarer case.

**Disclosure**

- R13. The rail's storage sentence states that builds save automatically, so no
  player believes their work is unsaved when it is, or saved when it is not.

### Acceptance Examples

1. **The reported case.** Fill the character step, press `Continue →`. The step
   advances immediately. The rail shows the build under `Saved builds`.
2. **Collision, first time.** A saved build named `Barbarian` exists and carries a
   loadout. Start a new build, name it `Barbarian`, press `Continue →`. The app
   asks, naming which record holds a solved loadout.
3. **Collision, second time.** Answer "overwrite" in (2), advance, step back,
   press `Continue →` again. Nothing is asked.
4. **Load is safe.** With unsaved edits on build A, load build B from the rail. No
   guard appears, and A is intact when reloaded.
5. **Storage failure.** With storage unavailable, press `Continue →`. The step
   advances and a non-blocking notice says the build could not be saved.

---

## Outstanding Questions

Deferred to planning; these are `/ce-plan` input, not backlog, and are not filed
as issues.

1. **Where does R11's non-modal report render?** The results phase has a notices
   panel; the earlier steps have no equivalent surface.
2. **Does R6's "remembered for this build" belong in `state` or in the record?**
   State is simpler and satisfies R7 exactly; a record field would survive reload,
   which R7 says is not required.
3. **Does autosave fire on `Back` as well as `Continue`?** The report names
   Continue. Back is the same forward-path reflex in reverse and probably wants
   the same treatment, but it was not asked for.
4. **Does the `Save progress` button need a changed label** once it no longer
   describes the only way a build persists?
