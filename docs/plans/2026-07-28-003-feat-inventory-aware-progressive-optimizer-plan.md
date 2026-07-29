---
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
date: 2026-07-28
title: Inventory-Aware Progressive Optimizer — Own It, Work It, Remember It - Plan
---

# Inventory-Aware Progressive Optimizer — Own It, Work It, Remember It - Plan

> **Superseded (2026-07-29)** by `docs/plans/2026-07-29-001-feat-guided-workflow-ui-reengineering-plan.md`, which absorbs the progressive-flow, pool-toggle, and inventory-import intent into one umbrella. Two decisions changed there: the flow shape is a linear wizard (not a progressive one-page), and inventory mode constrains base items only (augments come from the full catalog). The personalization layer (presets, notes, history) is deferred to a later slice. Kept for history; not the current source of truth.

## Goal Capsule

**Objective.** Evolve the optimizer from a tabbed, theoretical-best-in-slot tool into a **single progressive, inventory-aware, personalized workflow**: the same exact math, reshaped around one continuous flow, grounded in the gear a player actually owns, and remembering what they set and learn. Three connected capabilities — a progressive flow that replaces the tabs, inventory-aware optimization over an imported owned-item set, and a client-side personalization layer.

**Why now.** The engine is mature (exact MILP, full crafting coverage, wiki-sourced data), but it answers only "what is theoretically best." A real player's next question is "best given what I *own*," and the current tabbed UI (Solver / Item Browser as separate levels) fights the natural progression from *the ideal* → *the compromises* → *what I can actually build*. The optimizer already accepts an arbitrary candidate item set, so inventory-mode is a filter over that set — the highest-value capability at the lowest engine risk.

**Product authority.** This document is the source of truth for WHAT across all three capabilities. They are **separable** and intended to be sliced into per-capability `ce-plan` → `ce-work` passes (suggested order below); this doc is the north star each slice traces back to.

**Open blockers.** None blocking the vision. The treasure-trove file's exact shape is an input needed before planning the inventory slice's HOW, not before capturing the vision.

---

## Product Contract

### Primary actor & outcome
A DDO player using the optimizer **as a personal tool** enters their ranked affix priorities and works one continuous flow: they see the theoretically optimal loadout, explore its trade-offs, flip to "what I can build from what I own" (recomputed by the same engine over their imported inventory), and have their presets, notes, standing rules, and history remembered across sessions — all in their browser, no account.

### In scope — three capabilities

**Capability 1 — Progressive workflow (replaces the tabs).**
- One continuous surface: **Priorities → The Best → Compromises**, revealed progressively (set what you want, see the optimum, then navigate its near-optimal alternatives).
- A **candidate-pool toggle** — "All gear" ↔ "What I own" — that recomputes the same optimum + alternatives over the selected pool, comparable stage by stage.
- The Solver and Item Browser tabs dissolve into this flow (browsing/annotating gets a home within it — see Open Questions).

**Capability 2 — Inventory-aware optimization.**
- Import a **DDO treasure-trove file** (client-side upload/paste) describing the items the player owns.
- Match owned items to the existing wiki-sourced dataset **by name**; the "What I own" lens constrains the same solver + alternatives to that owned subset.
- Reuses the entire existing engine (solver, alternatives, results rendering); inventory-mode is a candidate-pool filter, not new math.

**Capability 3 — Personalization layer (client-side).** Persist, across sessions, all four:
- **Named priority/query presets** — save a full query (ranked affixes + ML + class/race/armor/weapon) under a name and reload it.
- **Personal item notes** — annotate items/sets with the player's own notes that persist and surface in results/browse.
- **Standing exclusions / must-haves** — items or affixes always excluded or always pinned; these also feed the solver as constraints (a solver-input feature, not just storage).
- **History / suggestions** — keep past solves and surface them (recall a prior build; suggest previously used priorities).

### Out of scope
- User accounts, server-side storage, multi-device sync — the app is a static client-side GitHub Pages site; persistence is browser-local (localStorage) and/or exportable files.
- Changes to the underlying optimization math — this reshapes *access* to the engine (pool, flow, memory), not the solver.
- Live game integration / auto-sync of inventory — import is a manual file the player provides.

### Success criteria
- A player imports a treasure-trove file and, with the "What I own" lens, gets a provably-optimal loadout **built only from items they own**, with the same trade-off/alternatives exploration as the theoretical view.
- The primary experience is a single progressive flow with no top-level tabs; the pool toggle recomputes the view in place.
- Presets, notes, standing exclusions/must-haves, and history all persist across a browser reload and survive without a server.
- Standing must-haves/exclusions correctly constrain solves in both pool modes (with defined behavior when an unowned item is pinned — see Open Questions).
- Match rate is disclosed: the player can see how many owned items matched the dataset vs. went unrecognized, so inventory-mode is honest about coverage.

### Key decisions (session-settled)
- **Progressive flow with a candidate-pool toggle** *(session-settled: user-directed — chosen over a downstream "walk-it-twice" stage and a gap/delta comparison view).*
- **Inventory matched by name to the existing dataset** *(session-settled: user-approved — conservative and sufficient; per-copy crafting precision deferred to the sample).*
- **Persistence covers all four types, stored client-side** *(session-settled: user-directed — presets, notes, exclusions/must-haves, history; no accounts, honoring the static-site architecture).*
- **Capabilities are separable and sliced** *(session-settled: user-directed — write the full-vision doc now, then ce-plan/ce-work per slice; recommended first slice = inventory pool-toggle).*

### Assumptions (flag if wrong)
1. The treasure-trove file gives at least item names (likely + ML/slot), enough to match by name to the dataset.
2. Client-side storage (localStorage + file export/import) is an acceptable persistence model for a personal tool; the player accepts per-browser scope.
3. Inventory-mode reuses the existing solver by filtering its candidate pool — no engine change required for the core case.

## Outstanding Questions (for slicing / ce-plan)
- **Treasure-trove file shape.** Does it carry only names, or also per-copy crafting/augment choices (which would let the optimizer honor exactly how the player's specific copy is rolled)? Resolve against a real sample; refines matching precision, not product shape.
- **Must-haves × pool toggle.** When a pinned must-have isn't owned, does the "What I own" view ignore it, mark that slot infeasible, or should pins be pool-aware? Defines a real edge behavior.
- **Item Browser fate.** Where do browsing, annotating, and marking exclusions live in a no-tabs flow — a section/drawer within the progressive page, or a secondary panel? Structural to the flow.
- **Unmatched owned items.** How to surface items in the file that don't match the dataset (skip + disclose count, or a manual-match affordance).
- **Suggested slice order.** (1) Inventory pool-toggle over the existing UI (headline value, engine reuse), (2) progressive-flow redesign (the container), (3) personalization layer. Order is a planning recommendation, not fixed.
