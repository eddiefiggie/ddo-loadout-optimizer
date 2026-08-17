---
title: Utility Nice-to-Have Container - Plan
type: feat
date: 2026-08-16
topic: utility-nice-to-have-container
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Utility Nice-to-Have Container - Plan

**Tracked as #348.**

## Goal Capsule

- **Objective:** Turn the Utility tier into a pinned, player-curated container of nice-to-have effects, pursued in the player's own order — so a player who wants Ghostly ahead of Feather Falling can say so, and one who never opens the panel still gets a sensible default.
- **Product authority:** User-directed through brainstorm dialogue on 2026-08-16.
- **Open blockers:** None for scope. One verification gates implementation — see Dependencies.
- **Depends on:** `docs/plans/2026-08-16-004-fix-utility-default-roster-plan.md`, which closes #343 on its own. This plan assumes that roster has shipped and is the container's starting contents. It must not be treated as the fix for the reported bug.

---

## Product Contract

### Summary

The Utility row becomes a pinned, visually distinct container at the bottom of the priority list, with a panel where the player reorders, adds, and removes the effects inside it. Effects are pursued in the player's order rather than counted flat. Saved characters heal to the new shape with a notice.

### Problem Frame

The roster change that closes #343 fixes *which* effects the optimizer reaches for. It does not let a player say which ones matter to them.

The tier values effects as a flat count of distinct presences: every effect is worth exactly 1. Ghostly — 10% incorporeal miss chance — scores the same as Feather Falling. A player who drags the tier up to buy more effects cannot say which effects; they get whatever combination is cheapest for the solver, which may be three trivial ones over one they wanted. The count is value-blind by construction, and position in the priority list is the only trade mechanism the tier offers.

That is tolerable while the tier is a scavenger filling leftover slots. It stops being tolerable once players start curating what it holds, because curation without ordering is only half a control.

### Key Decisions

- **The Utility row is a pinned container, not a rankable priority.** (session-settled: user-directed — chosen over leaving it draggable: a flat count dragged up buys effects as a bundle, which is not what a must-have needs.) It always sits at the bottom and cannot be moved. Must-haves already have a mechanism — rank the stat normally, or set a `min 1` floor — so the container is explicitly for leftovers. *Overrides R2 of the #91 plan; moots R11's dragged-up cases and part of its AE2.*

- **The row gains a curation panel.** (session-settled: user-directed.) It lists the effects the container will apply, in order, and the player can reorder, add, and remove them. *Overrides R15 of the #91 plan, which suppressed the Advanced panel for this row.* It is a list manager, not the numeric-field panel other rows use, and shares only the name.

- **In-container order is strict lexicographic sub-ranking.** (session-settled: user-directed — chosen over count-then-tiebreak: the player's #1 effect should be genuinely guaranteed, not surrendered to breadth.) This does not recreate must-have semantics, because the container is pinned last: nothing inside it can ever cost a ranked stat a point.

- **Strict order is realized in one solve stage, not one per effect.** Measured: twenty sequential sub-rank stages cost 3.94× median and 6.93× worst against a 2.0× budget, with one endgame fixture projecting 88 seconds — cost is entirely per-stage solves, so the roster's variant reduction cannot absorb a 20× stage multiplier. A single-stage weighted objective reproduced the sequential selection exactly at 6–27× lower cost. The settled ordering decision stands; only the realization changes.

- **Saved characters heal to the new shape with a notice.** (session-settled: user-directed — chosen over silent migration: a player who deliberately dragged the tier mid-list would otherwise find it moved with no explanation.)

### Requirements

**The container**

- R1. The Utility row is pinned to the bottom of the priority list and cannot be dragged. It remains removable and re-addable through the existing affordance.
- R2. The row is styled distinctly from ranked priorities, and its copy states that it holds effects worth having only if there is room — and that anything the player needs belongs in the priority list instead.
- R3. The row's collapsed state shows what the container holds, so a player who never opens the panel still sees its contents.
- R4. A curation panel lists the effects the container will apply, in the order it will pursue them, and lets the player reorder, remove, and add them. The addable population is every targetable presence effect.
- R5. The container holds at most N effects. The panel refuses adds beyond N and says why. N is set by the measured encoding gate, not chosen for UI reasons.

**Solve behavior**

- R6. Effects are pursued in the container's order: the first is secured, then the second without surrendering the first, and so on.
- R7. The container's order is realized without one solve stage per effect, and the realization is proven equivalent to the sequential reference on the golden fixture set.
- R8. No effect in the container can cost a ranked stat a single point, at any container position.
- R9. The container ships with the roster from the default-roster plan, in a stated default order, with the six worn defensive toggles ahead of the fourteen inherited names. Order is a product decision recorded here, never an artifact of sort order in the underlying set.
- R10. Solves stay deterministic: the same query and container return the same loadout.

**Persistence and disclosure**

- R11. The container's contents and their order are part of the player's saved state: they persist with a character, survive backup and restore, and flow through the projection layer into every export including the portable `ddo-loadout/v1` envelope.
- R12. A saved character written before this change is distinguishable from one written after, so the heal fires exactly once on the right population.
- R13. On heal, a mid-list Utility tier moves to the bottom and the container seeds to the default; the player is told both facts. R14 of the #91 plan still holds — nothing re-solves until the player re-solves.
- R14. Results name which container effects the loadout carries **and which it could not secure**, so a player who curated learns their top choice was missed rather than inferring it from absence.

### Acceptance Examples

- AE1. **Order is honored, not breadth.** Covers R6, R7. Given a container whose first effect conflicts with two lower ones: the first is secured and the two are given up, rather than the reverse — and the result is identical to a sequential sub-ranked reference solve.
- AE2. **The container never taxes a ranked stat.** Covers R8. Given a query with contested ranked stats: every ranked value is identical with the container present and absent.
- AE3. **A curated top choice that was missed is named.** Covers R14. Given a container whose first effect no equippable item can supply under the current query: the results say that effect was not secured, rather than silently listing the others.
- AE4. **Curation sticks.** Covers R4, R11. Given a player who removes two defaults, adds Undead Bane, and reorders: saving, reloading, exporting, and re-importing preserves that exact list and order.
- AE5. **The cap is enforced and explained.** Covers R5. Given a container already holding N effects: adding another is refused with a stated reason, and no solve is run in a state above N.
- AE6. **A pre-container character heals once, visibly.** Covers R12, R13. Given a character saved before this change with the tier at position 3: it loads with the tier pinned, the container seeded, and a notice naming both changes. Loading it a second time does not re-heal or re-notify. Its stored loadout is unchanged until re-solved.

### Scope Boundaries

- Closing #343. The default-roster plan does that; this plan assumes it shipped.
- Value-weighting or exchange rates between effects (#331). The player's ordering does that job, and weighted-sum modes remain a standing non-goal.
- Widening the default roster further (#349). Still governed by the #91 measured-batch rule.

### Dependencies / Assumptions

- **Gating verification:** the single-stage encoding must be proven equivalent to sequential sub-ranking across the full golden fixture set, with the solver's gap tolerance pinned, before any UI or persistence work commits. The equivalence was verified on four fixtures at twenty effects; the encoding's weights grow exponentially with container size, so the tolerance and the cap in R5 are the same question. If equivalence cannot be established, the fallback is count-then-tiebreak within the container, which surrenders R6 and must be brought back to the user rather than chosen during implementation.
- Assumes the container's ordering supersedes the count that the shipped "more utility effects" Alternatives family and the generic families' count lock are built on. Their fate under an ordered container is unresolved — see Outstanding Questions.
- Assumes the default roster from the prior plan is stable enough to seed from. If the wiki review changes that roster after characters have saved containers, those saved containers do not follow.

### Outstanding Questions

**Resolve before planning**

- What happens to the shipped "more utility effects" Alternatives family under an ordered container — retained and redefined against the order, or retired? Its count lock can currently shed a higher-ordered effect to gain two lower ones, which contradicts R6.

**Deferred to planning**

- Whether removing every effect from the container is equivalent to removing the row, or a distinct state worth its own copy.
- Whether the panel offers the full addable population as a searchable list or a curated menu with search as a fallback.
- Whether a post-ship roster revision re-seeds untouched containers or leaves all saved containers frozen.

### Sources / Research

- Issue #343 carries the report that motivated the roster change and the six settled rulings behind this container.
- `docs/plans/2026-08-16-004-fix-utility-default-roster-plan.md` — the prerequisite that closes #343 and supplies this container's starting contents.
- `docs/plans/2026-08-15-002-feat-utility-tier-holistic-value-plan.md` — the #91 plan this supersedes in part: R2 (draggable), R15 (no Advanced panel), R11 (the Alternatives family).
- `CONCEPTS.md` — its [[Utility tier]] entry describes the tier as draggable with position as the only trade mechanism, and no Advanced panel. That entry goes stale when this plan ships and must be updated with it.
- Stage-cost figures were measured against the golden fixture set on 2026-08-16: twenty sequential sub-rank stages at 3.94× median and 6.93× worst versus a 2.0× budget; a single-stage weighted objective reproducing the same selection at 6–27× lower cost.
