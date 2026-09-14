---
title: Priority Groups As Linked Rows - Plan
type: feat
date: 2026-09-14
execution: code
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
---

# Priority Groups As Linked Rows - Plan

**Issue:** #745. **Base:** `main` at `09142026.4`, clean and green.

---

## Goal Capsule

Let a player move a block of related priorities up and down as one unit, keeping
the block's internal order.

> I want fire, light, and positive spellpower/lore/intensity, I want them to be
> in this order as a block, and move that whole block up and down the list.

No solve changes. **A group is a reordering convenience over an order that stays
strictly ranked** — members keep distinct ranks, moving the block moves all of
them together, and nothing here lets members tie. That last sentence is the
weighted-sum non-goal in `AGENTS.md`, and it is the constraint this feature is
built around, not around the feature.

---

## Why not bundles, and why bundles anyway

The owner asked whether this is redundant with bundles. Checked against the code
rather than the issue: a bundle is already an ordered list of affix names, and
`addBundle` lands it in that order — but it appends each affix *individually*,
skips any already present, and **nothing in `state` remembers membership
afterward**. A bundle is a template; this issue wants a live handle on rows that
are already ranked. Not redundant.

But the two share a data shape, and building groups as a *second* named-ordered-
set concept is the confusion the #746 sweep warned about. So: **a preset bundle
keeps its identity after it lands.** The run it just added becomes a group, for
free, through the same mechanism a player uses by hand.

---

## Design: links, not group objects

The issue proposes a side-car `state.priorityGroups: [{name, members[]}]`. This
plan keeps the side-car and drops the object: **`state.priorityLinks: string[]`,
the stat names that are linked to the row above them.** A group is a maximal run
of linked rows. Contiguity is not a property to maintain — it is what "linked to
the row above" *means*, and the move rules below make it impossible to break
except by unlinking.

Why the simpler shape wins:

- **No name needed.** The bracket shows the block; a name is cosmetic, and
  naming is a second UI.
- **No coherence to police.** A `{members}` object can drift from the list
  (member removed, member moved out); a link flag on a name is meaningful iff
  the name and its predecessor are adjacent, and the rules guarantee that.
- **Creating a group needs no selection mode.** One toggle per row: *link to the
  row above*. The reporter's block is four clicks.

### The rules that keep it coherent

1. **Moving any member moves the whole run**, internal order intact. ⤒ ↑ ↓ ⤓ and
   drag all do this; a singleton is a run of one, so every existing behaviour is
   the degenerate case.
2. **A drop that would land inside a group snaps to its boundary** — before the
   group's head, or after its tail. Without this, dragging a stray row into the
   middle of a block would split it silently.
3. **Deleting a member**: the row that followed it stays linked iff the deleted
   row was itself linked (the block continues, one shorter); otherwise the
   follower becomes the new head. Deleting a head must not leave the next member
   "linked" to whatever is above.
4. **A whole-list replace clears links** (`applySavedBundle`). Pruning by name
   would let stale links survive by coincidence and manufacture a group the
   player never made.
5. **Load prunes links to names still ranked**, after the migration and the two
   heal steps, in the same place `utilityContainer` restores. A migration that
   expands a linked name lands the expansion unlinked; the migration notice
   already tells the player something moved.
6. **The Utility sentinel is never linked and never inside a run.** It is always
   last; `lastRankedIndex` already owns that, and a group's destination is
   clamped so the whole run fits above it.

### What the solver sees

Nothing. `buildQuery`, `persist`'s existing fields, and every saved-build
migration are untouched. The one addition to `persist.js` is an optional
`priorityLinks` array on the allowlist — additive, absent on every existing save,
read as `[]`. The issue sold the side-car as touching nothing; it touches this,
and saying so beats a group that vanishes on reload.

---

## Units

**U1 — pure model**, module-level, exported, tested without a DOM:
`groupsOf(priorities, links)` → spans; `movePriorityGroup(priorities, links,
from, to)` → the run containing `from` moved so its head lands at `to`, clamped
to fit; `snapDropToGroup`; `linksAfterDelete`; `linksAfterBundle` (the landed
diff, all but the first).

**U2 — wiring.** The five `movePriority(state.priorities, …)` call sites become
`movePriorityGroup(state.priorities, state.priorityLinks, …)`; `movePriority`
stays as the singleton primitive underneath. Delete prunes; preset apply links;
saved apply clears; load restores and prunes.

**U3 — the control and the bracket.** A sixth button in `.wz-ctl`, `aria-pressed`
when linked, disabled on the first ranked row. `.wz-linked` on members draws a
left rule joined to the row above; the run reads as one block.

**U4 — persistence.** Allowlist entry and reader branch beside `utilityContainer`.

**U5 — tests.** Re-ratify "five controls" (six) and "one reorder primitive"
(the five sites now name the group primitive, and *no* site bypasses it).

**TRAP:** moves never edit links. It is tempting to "fix up" links after every
reorder; that is the drift the rules above exist to make unnecessary, and a
fix-up that runs on a move is a second place the invariant lives.

---

## Verification

- Both suites; new tests proven to fail against the pre-change tree; each guard
  corrupted and confirmed red.
- Browser, real app: link two rows, press ↑ on the second — both move, order
  kept; drag a singleton onto the middle of a block — it lands at the boundary;
  delete a head — the follower becomes head with no dangling link; the preset
  *Basic* lands as one bracketed block.

**Stamp.** `09142026.4` → `.5`, resolved FORWARD.

---

## Scope Boundaries

- **Saved bundles do not become groups** on apply: they replace the whole list,
  and "everything is one group" says nothing.
- **Named groups, non-contiguous groups, and a selection mode** are not built;
  the issue's own analysis says nothing in the report needs them.
- **Partial overlap on preset apply** keeps today's behaviour: an already-ranked
  member stays where the player put it and is not pulled into the block. The
  landed run is what gets linked. Moving the existing member would change
  `addBundle` for every current user of bundles, and is a separate decision.
