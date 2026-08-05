---
title: Data Reconciliation and Set Visibility - Plan
type: fix
date: 2026-08-05
topic: data-reconciliation-set-visibility
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Data Reconciliation and Set Visibility - Plan

## Goal Capsule

- **Objective:** Fix the two reported data defects and make set-granted value visible where players look for it. Narrow, evidence-backed work with a small wiki cost.
- **Product authority:** eddiefiggie (project owner).
- **Open blockers:** None.
- **Reports addressed:** 2026-08-05 batch reports 1 (Topaz of Swiftness), 2 (set bonuses absent from the item view), and 6 (Gem of Many Facets).

---

## Product Contract

### Summary

Restore the missing Melee Alacrity value on `Topaz of Swiftness 15%` and sweep its sibling augment pools for the same defect class. Render set bonuses in the item browse view and make set-granted stats filterable. Reconcile the Gem of Many Facets set-pool data against the wiki evidence the project already holds, without touching the solver.

### Problem Frame

`Topaz of Swiftness 5%` carries `Melee Alacrity 5` and the 10% variant carries `Melee Alacrity 10`, but the 15% variant carries only `Speed 30`. The value is simply absent. These three are separate records in an augment pool distinguished by a numeric suffix, not tier variants of one item, so nothing in the existing tooling compares them to each other.

`Set Augment: Perfect Silence` reports zero eligible affixes because its value routes through a set definition rather than affixes, and the browse view renders no set content at all. The item reads as empty, and a player filtering browse for the stat the set grants finds nothing, because the filter's stat list is derived from item affixes.

Gem of Many Facets is the best-documented of the three and the least understood in the reports. `docs/wiki-evidence/gem-of-many-facets.md` confirms the mechanic — the Gem grants one set membership from each of two independent pools — and rules that the machinery is correct and the fix is data. It also warns that the Heroic pools may not carry to the endgame tiers. In the built dataset only the Legendary variant carries any joker wiring at all.

### Key Decisions

- **Reconcile data; do not touch the solver.** The two-pool mechanic is confirmed and the `joker_set_groups` model already expresses it. (user-approved — chosen over re-characterizing the Gem from scratch: the wiki evidence and the ruling already exist, and re-deriving them would re-spend a throttled budget on a settled question.)

- **Sibling differencing keys on the numeric suffix, not the tier label.** (user-approved — chosen over reusing variant-family grouping: a variant family here is item plus tier label, which groups none of the `Topaz of Swiftness 5%/10%/15%` records, so tier-based differencing would miss the reported case entirely.)

### Requirements

**Augment-pool data gaps**

- R1. `Topaz of Swiftness 15%` carries the Melee Alacrity value the wiki states, consistent with its 5% and 10% siblings.
- R2. Whether `Speed` feeds Melee or Ranged Alacrity is settled against the wiki, and the data reflects the answer rather than leaving the two unrelated by assumption.
- R3. Augment-pool records whose names differ only by a numeric suffix are differenced against one another, and any sibling missing an affix its peers carry is reported for wiki confirmation.

**Set-bonus visibility**

- R4. The item browse view shows the set bonuses an item carries or can grant, so an item whose value routes through a set definition no longer reads as empty.
- R5. A set-granted stat is visually distinguishable in the browse row from an affix the item carries by itself, naming the set and its piece requirement.
- R6. Set-granted stats participate in browse's stat filter and text search, including appearing in the filter's selectable option list.

**Gem of Many Facets**

- R7. The Gem's `joker_set_groups` data is reconciled against the wiki-documented pools for every tier the optimizer offers.
- R8. A tier with no joker wiring is either wired from wiki-sourced pools or excluded from the pool with a stated reason, rather than silently present and inert.
- R9. The solver's wildcard set-membership logic is changed only if the two-set behavior is still wrong after the data is correct.

### Acceptance Examples

- AE1. A sibling gap is caught and closed.
  - **Given:** `Topaz of Swiftness` records at 5%, 10%, and 15%, where only the 15% record lacks a Melee Alacrity affix.
  - **When:** the sibling differencing runs.
  - **Then:** the 15% record is reported as missing an affix its peers carry, and once wiki-confirmed the value is present in the dataset.
  - **Covers R1, R3.**

- AE2. A set-routed item is visible and findable.
  - **Given:** `Set Augment: Perfect Silence`, whose value routes through a set definition rather than affixes.
  - **When:** the player browses, then filters by the stat that set grants.
  - **Then:** the row shows the set bonus marked as set-granted with its piece requirement, and the item appears in the filtered results.
  - **Covers R4, R5, R6.**

- AE3. The Gem's tiers are honest about their wiring.
  - **Given:** Gem of Many Facets variants across the tiers the optimizer offers.
  - **When:** the dataset is rebuilt after reconciliation.
  - **Then:** every offered tier carries wiki-sourced pools for both groups, or is excluded with a stated reason.
  - **Covers R7, R8.**

### Scope Boundaries

- Reports 3, 5, and the naming half of 7 — covered by the affix vocabulary hygiene plan.
- Report 4 — covered by the off-hand dual-wield plan.
- Set over-fitting (#92). R4–R6 are display and discovery only; if R7's reconciliation shows the wildcard selection itself is wrong, that finding routes to #92 rather than expanding this batch.
- A general audit of every augment pool. R3 is scoped to numeric-suffix siblings, which is where the reported defect lives.

### Success Criteria

- Re-running the three reported cases no longer reproduces the reported behavior, or the report is answered with wiki evidence that current behavior is correct.
- No solver change ships for the Gem unless the reconciled data demonstrably still fails.
- Every value added or changed traces to a wiki citation.

### Outstanding Questions

**Deferred to planning**

- Where set content sits in a browse row, given the table restacks into cards at the phone breakpoint.
- Which set-carrying shapes R4 renders — intrinsic set membership, parsed threshold tiers, crafted-membership pools, and wildcard groups all route value through set definitions.
- Whether R3's differencing runs in the data pipeline, the test suite, or as a one-off report.

### Dependencies and Assumptions

- The DDO Wiki is the sole source of truth, per the standing exclude-until-verified rule, and throttles after roughly eight rapid calls.
- The wiki evidence already recorded for the Gem is current and does not need re-harvesting; only the endgame-tier pools need confirmation, as that document itself flags.
- The browse stat filter's option list derives from an item-affix-sourced vocabulary today, so R6 requires widening that list and not only the match predicate.

### Sources and Research

- `docs/wiki-evidence/gem-of-many-facets.md` — the confirmed two-pool mechanic, the ruling that the fix is data rather than solver, and the caveat that Heroic pools may not carry to endgame tiers.
- `data/seed/joker_sets.json` — the wildcard pools as currently seeded.
- `docs/plans/2026-07-27-003-feat-wildcard-set-piece-plan.md` — the decision that deferred the non-Legendary tiers.
- `web/browse.js` — the row renderer and the stat list and filter, which read item affixes and scaling only.
- `web/data/items.json` (generated) — confirms the `Topaz of Swiftness` sibling gap and `Set Augment: Perfect Silence` at zero eligible affixes.
- `data/bug_reports.txt` — the verbatim 2026-08-05 reports.
