---
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
title: All Verified Sources in the Objective - Plan
date: 2026-07-25
---

# All Verified Sources in the Objective - Plan

## Goal Capsule

**Objective.** Extend the exact worn-item solver so that *every* structured, verified stat source enters the lexicographic objective with correct DDO bonus-type stacking — not only base worn-item affixes (which Milestone 2 already optimizes). Three new source families join the objective: named-item **set bonuses**, **augments** (colored + Lunar/Solar), and **expansion crafting / gear upgrade paths** (beyond core essence/Cannith crafting).

**Product authority.** This document (requirements only). Implementation design — exact MILP encodings, schema field names, solve-time benchmarking — is deferred to `/ce-plan`.

**Open blockers.** None. Scope settled this session; ready for `/ce-plan`.

**Why now.** Milestones 1 & 2 are live, but the solver optimizes only worn-item base affixes. Set bonuses, augments, and crafting-upgrade stats are displayed but never reach the objective — so the tool can under-count available stats *and*, because it models bonus-type stacking, select a genuinely wrong "optimal" set (it can't see that a needed bonus type could be routed through an augment or upgrade slot, freeing a gear slot). Closing this is the single biggest capability gap.

---

## Product Contract

### Primary actor & outcome
A DDO player theorycrafting a build submits a query (ML cap, class/race, armor type, weapon setup, ranked affix list) and receives the **theoretically-optimal fully-upgraded loadout** whose effective totals now include set, augment, and crafting-upgrade contributions — every value traceable to the DDO Wiki.

### In scope

**Data / parsing (pipeline extensions)**
- Parse named-item **set bonuses**: `set_bonus[].piece_bonuses` free text → structured `(stat, bonus_type, value, pieces_required)` entries.
- Parse **augment** effects (colored + Lunar/Solar) → structured affixes with bonus types and slot-color compatibility.
- Parse **expansion crafting / gear upgrade paths** → structured add-on affixes attached to the upgradeable item, organized by upgrade *track*.
- All new data flows through the **existing Claude-in-Chrome wiki scrape + `verified | quarantined` gate**. Plain fetch returns empty for ddowiki.com, so scraping stays browser-driven.

**Solver (the unified "gated contribution" primitive — Approach A)**
- Generalize the existing `z` select-one bucket primitive so *every* stat source — worn affix (existing), augment, crafting upgrade, set bonus — is a **gated contribution**: a `(stat, bonus_type, value)` that enters the max-per-bonus-type bucket only when its enabling binaries hold.
  - **Augment** → available iff the augment is chosen AND it occupies an open slot of a matching color on an equipped item (per-color capacity constraint). Lunar/Solar are additional colors.
  - **Crafting upgrade** → available iff its item is equipped AND that track is chosen. Mutually exclusive *within* a track, independent *across* tracks. Modeled as **optional add-on affix variables, NOT a combinatorial explosion of enumerated variants.**
  - **Set bonus** → available iff a `set_active` threshold indicator is 1, where `set_active` is 1 only when ≥ `pieces_required` pieces of that set are equipped.
- All gated contributions feed the **same** bonus-type stacking logic that already produces correct results (highest value per named type; different types sum). Set completion therefore "just works" under the existing staged lexicographic solve — a set bonus is pursued only when it advances a ranked target, without special-case logic.

**Results (full build sheet + near-miss hints)**
- Per slot, prescribe: item + tier + **which augment fills each colored/Lunar/Solar slot** + **which crafting upgrade track was chosen**.
- Surface **near-miss set hints**: "1 piece from set X → +Y to a target" (display-only, low carrying cost).
- **Per-family coverage disclosure**: which sets / augments / crafting systems are covered vs. pending, so partial coverage is honest.

### Out of scope / boundaries
- **Ship on a verified subset, disclose gaps.** Do NOT block ship on total wiki completeness. Land the machinery, source a meaningful verified slice, iterate sourcing as follow-ups.
- No new solve paradigm — still HiGHS-WASM, staged lexicographic, deterministic tie-break.
- No per-user inventory — pure theoretical best-in-slot, unchanged.
- Pre-expanding combinations into variants (Approach B) and greedy augment/set post-passes (Approach C) are **rejected**: B cannot represent set thresholds (a whole-loadout property) and explodes combinatorially; C gives up provable optimality because augment fills and set completion interact with which base items are chosen.

### Key Decisions
- **[session-settled] Data sourced from the DDO Wiki without exception — never inferred.** Every `(stat, bonus_type, value, ML)`, every set-piece threshold, every augment effect, and every crafting-upgrade stat must come from an explicit ddowiki.com statement carrying its `wiki_url`. The parser converts only what the wiki states explicitly; it never infers a bonus type, fills a missing value, or guesses a threshold. Anything ambiguous is **quarantined**, not defaulted. This is the existing exclude-until-verified gate applied to the new free-text sources without exception.
- **[session-settled] One combined milestone** covering all three source families (not sequenced separately).
- **[session-settled] Approach A — unified gated-contribution primitive** for the MILP.
- **[session-settled] Full build sheet + near-miss set hints** as the result shape.
- **[session-settled] Verified-subset ship with per-family coverage disclosure.**
- Crafting upgrades are **optional add-on affix variables**, not enumerated variant combinations.

### Success criteria / acceptance signals
- A query returns an optimal loadout whose effective totals include set, augment, and crafting-upgrade contributions, each traceable to a `wiki_url`, with correct bonus-type stacking.
- Solve stays fast enough to preserve the interactive feel; solve time is benchmarked as the MILP grows, and augment pool size per color is capped if needed.
- Existing 59 tests stay green; new known-answer fixtures cover at minimum: a **set threshold** (bonus applies only at ≥N pieces), an **augment color-capacity limit** (an augment can't be placed without a matching open slot), and a **crafting add-on affix** (gated on item equipped + track chosen).
- Ambiguous / unsourced effects are quarantined and reflected honestly in coverage disclosure, never invented.

### Assumptions
- The authoritative list of expansion crafting systems is **to be sourced from ddowiki.com during planning/work**, not settled here. Candidates named this session — Sharn upgrade path, Isle of Dread, Vecna Unleashed, Myth Drannor, Chill of Ravenloft/Viktranium, Slave Lords, Thunder-Forged, Green Steel — are leads to verify, not a confirmed roster.
- The existing per-slot dominance pre-filter continues to prune candidate sets hard enough to keep the enlarged MILP tractable (to be validated by benchmark).

### Outstanding Questions (for `/ce-plan`)
- Exact MILP encoding of the `set_active` threshold indicator and the augment per-color capacity constraints.
- Dataset schema additions: structured fields for set-piece thresholds, augment slot-color compatibility, and crafting upgrade tracks; plus per-family coverage metadata.
- Solve-time benchmark methodology and the pool-cap fallback if the interactive feel regresses.
- How near-miss set hints are computed and rendered (post-solve display pass).
