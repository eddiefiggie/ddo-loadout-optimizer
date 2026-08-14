---
title: A read-time canonicalization guard must trial-reassign and check identity, not tally free capacity
module: solver
date: 2026-08-14
problem_type: design_pattern
component: tooling
severity: high
root_cause: logic_error
resolution_type: code_fix
symptoms:
  - A ledger-based guard runs before ordinary-item assignment and only sees other copies' reservations, so it can steal a slot ordinary demand needs
  - Accepting a candidate change on equal unplaced COUNT can still swap WHICH item ends up unplaced on drifted or restored snapshots
applies_when:
  - A display or projection layer re-decides something the solver/assignment algorithm already decided (e.g. recoloring, relabeling, or re-attributing a consumed resource for presentation)
  - Writing a feasibility guard for a read-time recomputation that must not disturb the downstream consumer's actual allocation
  - Reviewing a PR that adds a ledger-style free-capacity check ahead of the real assignment pass it is meant to protect
related_components:
  - web/projection.js
  - web/solver.js
tags:
  - solver
  - projection
  - guard-design
  - trial-assignment
  - set-augments
  - canonicalization
  - identity-not-count
---

## Context

PR #318 (merged 2026-08-14) added `canonicalSetAugments` to `web/projection.js`. The solver's Colorless-first stage lands every genuinely-free set-augment copy in a Colorless slot on the tie-broken primary solve, but every alternatives re-solve skips that stage — so a restored or alternative build can persist a copy as (say) Yellow when a Colorless slot on the same host was free. The display layer therefore re-decides, at read time, whether each copy's `slot_color` can be canonically re-reported as Colorless.

That re-decision needs a safety guard: recoloring a copy to Colorless consumes a Colorless slot that something else may need. Review with executed repros caught two guard defects in the drafts before the final shape shipped:

1. **Ledger blindness.** A draft guard (specified in the plan and caught in review before any ledger version was committed — the first committed implementation already ships the corrected shape) ran before ordinary-augment assignment and tracked only set-augment reservations, so "unreserved Colorless capacity" ignored ordinary demand. Repro: host with slots [Colorless, Yellow]; an ordinary Colorless augment is placed; the copy solved into Yellow. The copy-only ledger says Colorless is free → recolor → the ordinary augment is displaced into `unplaced` while stat totals still count it.
2. **Count vs identity.** A draft accepted a recolor whenever the unplaced *count* did not grow. With a drifted restored snapshot that starts at `unplaced > 0`, an equal count can *swap which augment* lost its seat — the display then shows a different eviction than the saved build actually had.

The shipped guard fixes both by reproducing the real consumer's algorithm and measuring harm on identities. In `web/projection.js` (post-#318 tree):

- **Trial-assignment check** — the guard re-runs the full `assignAugments` reconstruction (set-augment reservations *plus* ordinary greedy placement) with the candidate recolor, and compares sorted unplaced identity sets:
  - `web/projection.js:212-214` — `unplacedIdsOf = (l) => assignAugments(chosen, build.augmentsPlaced, l).unplaced.map((a) => a.variant_id).sort()`, with `base = unplacedIdsOf(list)`.
  - `web/projection.js:223-225` — acceptance: `const u = unplacedIdsOf(trial); const sameSet = u.length === base.length && u.every((id, x) => id === base[x]); if (u.length < base.length || sameSet) { list[k] = trial[k]; base = u; }` — strict improvement OR identical identity set only.
- **Host-bounded candidates** — a copy is never recolored to a color its own host lacks: `web/projection.js:219-220` reads the host's `augment_slots_norm.colors` and `continue`s unless it `includes("Colorless")` (comment: `// host-bounded (R2)`).
- **Physical feasibility** — `reservationsFit` (`web/projection.js:196-206`) rebuilds per-item slot counts via the shared `slotCountsByItem` and walks every copy's reservation against its own host, refusing any list where a copy has no real slot of its color; it gates both the baseline (`:207`) and each trial (`:222`).
- **No mutation, memoized** — the function returns a NEW list built by spreading each entry (`web/projection.js:186-187`), never touching the persisted `setAugmentsPlaced` snapshot, and memoizes per build object via a `WeakMap` (`_canonSetAug`, `web/projection.js:181`, get at `:184`, set at `:228`).
- **Unconditional + idempotent** — projection has no solve-path flag, so the pass runs on every read; on a tie-broken primary solve it is a no-op because the Colorless-first stage already landed every free copy Colorless (doc comment `web/projection.js:168-170`).
- **Legacy default** — placements saved before `slot_color` existed can only have consumed Colorless, so both the canonicalization input (`web/projection.js:187`) and `assignAugments`' own reservation (`web/projection.js:135`) default missing `slot_color` to `"Colorless"` — an undefined color lookup would silently no-op the reservation and re-offer an occupied slot.

## Guidance

When a display/read layer re-decides something the solver (or any upstream writer) already decided — a color, a slot, an assignment, an ordering — guard the re-decision like this:

1. **Reproduce the real consumer's full algorithm in the guard.** Do not build a parallel "free capacity" ledger from the subset of demand you happen to be iterating. Run the actual downstream reconstruction (`assignAugments` here) with the candidate change applied, and judge the candidate by that reconstruction's real output. A shared helper (`slotCountsByItem`) between the guard and the consumer keeps the two from drifting.
2. **Measure harm on identities, not counts.** "No worse" means: strictly fewer displaced items, OR the *exact same set* of displaced items (compare sorted stable ids). An equal count with different membership is a changed outcome and must be rejected.
3. **Bound candidates by physical reality first.** Only propose values the target can actually hold (host-bounded colors), and verify per-target feasibility of the whole candidate list (`reservationsFit`) before running the expensive trial.
4. **Never mutate the persisted snapshot.** Return a new list; the saved build must round-trip byte-identical. Memoize per input object (WeakMap) so the unconditional pass stays cheap.
5. **Prefer unconditional + idempotent over a mode flag.** If the read layer cannot know which path produced the data, design the pass so that running it on already-canonical data changes nothing.
6. **Default legacy fields to the only value history permits** — and apply that default in every reader, not just the new one, because a missing-key lookup often fails *open* (silently skipping a reservation) rather than loudly.

### Wrong vs right, compactly

Ledger vs trial-assignment:

```
WRONG (copy-only ledger, runs before ordinary assignment):
  free[host][Colorless] = slots - setCopyReservations     // ordinary demand invisible
  if free[host][Colorless] > 0: recolor                   // steals the ordinary augment's slot

RIGHT (trial assignment):
  base  = assignAugments(chosen, ordinary, list).unplaced
  trial = assignAugments(chosen, ordinary, listWithRecolor).unplaced
  accept only if trial is no worse than base               // full consumer re-run
```

Count vs identity:

```
WRONG:  accept if trial.unplaced.length <= base.unplaced.length
        // equal length can swap WHICH augment is evicted → display lies

RIGHT:  ids = (u) => u.map(a => a.variant_id).sort()
        accept if trial.length < base.length
               || arraysEqual(ids(trial), ids(base))       // strict win OR identical eviction set
```

## Why This Matters

- A guard built on partial demand is worse than no guard: it *actively authorizes* the harmful change ("Colorless is free!") while the totals keep counting the item it displaced — a silent correctness lie the user cannot detect from the UI.
- Count-based acceptance passes every "did anything break?" smoke test while still changing *which* thing broke. Displays that disagree with the saved build about which item was evicted destroy trust in the whole proof panel, and the bug is only reachable from drifted snapshots — exactly the inputs tests rarely cover.
- Re-running the real algorithm makes the guard automatically track future changes to that algorithm; a parallel ledger silently rots the first time the consumer's placement rules change.
- The frame conditions (host-bounded, feasibility-checked, non-mutating, idempotent) are what make an *unconditional* read-time pass safe in a layer that has no way to know how its input was produced.

## When to Apply

- Any read-time / display-layer pass that re-derives or "canonicalizes" a decision an upstream solver, migration, or earlier code version made — especially when multiple production paths (primary solve vs re-solve vs restored snapshot) produce differently-shaped but equally-valid data.
- Any guard answering "is this resource free?" where more than one class of consumer draws from the same pool — the guard must see *all* demand, which in practice means running the real allocator, not a summary of it.
- Any "no regression" acceptance test over a collection outcome — compare identities (sorted stable ids), not sizes, whenever the baseline can legitimately be non-empty.
- Adding a new field to a persisted schema — pick the legacy default from what old writers could actually have produced, and apply it in every reader.

## Examples

- `web/projection.js:182-230` — `canonicalSetAugments`: the shipped pass (PR #318).
- `web/projection.js:212-214, 223-225` — `unplacedIdsOf` + strict-improvement-or-identical-identity acceptance.
- `web/projection.js:219-220` — host-bounded candidate colors (R2).
- `web/projection.js:196-206` — `reservationsFit` per-host physical feasibility over `slotCountsByItem` (`:115-121`, shared with `assignAugments` "so the two can never drift").
- `web/projection.js:181, 184, 186-187, 228` — WeakMap memo + new-list construction; persisted snapshot never mutated.
- `web/projection.js:135, 187` — legacy `slot_color` → `"Colorless"` default in both the reservation and the canonicalization input.
- Executed repro that killed the ledger draft: host `[Colorless, Yellow]`, one ordinary Colorless augment placed, copy solved into Yellow — copy-only ledger recolors the copy and evicts the ordinary augment while totals still count it.
- Related prior work: PR #317 (one set-bonus identity per item), issue #316-lineage `slot_color` crediting — the fields this pass canonicalizes.
- The other two review-confirmed defects from the same PR, at different layers: `add-a-solver-preference-as-a-pinned-post-stage.md` (solver post-stage pin granularity) and `every-solver-family-report-needs-a-load-bearing-guard.md` (report-layer float guards). Three layers, one PR, three standing rules.
