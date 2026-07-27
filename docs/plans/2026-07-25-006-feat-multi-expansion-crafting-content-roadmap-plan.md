---
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
date: 2026-07-25
title: Multi-Expansion Crafting-First Content Roadmap - Plan
---

# Multi-Expansion Crafting-First Content Roadmap - Plan

## Goal Capsule

**Objective.** A prioritized, batched roadmap that fills in the DDO optimizer's expansion content — Update 81, Isle of Dread, and Myth Drannor — **crafting systems first** (reusing the proven gated choice-slot / typed-insert primitive), then exhaustive named + raid gear. Every value wiki-traceable via Claude-in-Chrome under strict provenance.

**Product authority.** The Product Contract below is the source of truth for WHAT; `/ce-plan` adds HOW per milestone.

---

## Status Update — 2026-07-27 (crafting-reuse program closed)

**The crafting-reuse program is complete.** The two data-confirmed reuse-shape systems shipped, plus two more that fit the same primitive:
- **M1 — Viktranium/Lamordia** ✅ shipped (PR #17): 43 hosts solver-active + 65 enriched items (Cataclysmic weapons/shields + Lamordian clothing).
- **M2 — IoD Dino** ✅ shipped (PR #18): weapon/armor/set-bonus/raid pools with typed multi-affix inserts.
- Also shipped on the same primitive: **Seal-slot crafting** (PR #19) and **U81 Nearly-Complete / Nearly-Finished** (#4/#9/#10).

**M3 — Essence Crafting: DEFERRED to its own brainstorm (resolves Open Question 3).** A fail-fast Claude-in-Chrome data check (`https://ddowiki.com/page/Essence_Crafting`, 2026-07-27) confirms the system is **fully documented** but is an **item-fabrication** mechanic, *not* the choice-slot / typed-insert shape this program reuses:
- You disjunct a random-loot item into a **blank** (all effects stripped), craft a Minimum-Level shard (sets ML + auto enhancement bonus), then craft **one prefix effect + one suffix effect** (+ an optional 3rd slot via Mark of House Cannith at ML 10+) chosen from large scaling/non-scaling pools; scaling effects grow with ML, and prefix/suffix placement exclusivity applies.
- Named items are **not** generally essence-craftable — only a tiny exception list is (craftable +5 items, craftable rune arms, Gem of Many Facets / Epic / Legendary, Mysterious Ring, Trinket).
- The "Combined prefixes" recipes are **deactivated since Update 80** (not currently craftable).

**Why deferred, not folded into R4 like Catalyst:** Catalyst produces a *fixed roster of named items* → sourced as named gear. Essence produces **arbitrary custom items** (any prefix + any suffix, ML-scaled) — there is no fixed roster to source, and modeling it means a **new per-slot "wildcard crafted item" solver primitive** (a filler that can supply missing effects up to cap value). Per **R5** and the out-of-scope boundary ("a genuinely new mechanic is a separate brainstorm"), this is out of the reuse program and gets its own `/ce-brainstorm`.

**Next phase:** **R4 — exhaustive named + raid gear** per expansion (U81, IoD, Myth Drannor), the roadmap's own successor to the crafting milestones. The Essence "wildcard item" primitive is a parallel future brainstorm, independent of R4.

---

**Why crafting-first.** The crafting systems are the highest solver-value-per-effort: they reuse machinery already built and battle-tested (augments → Dino inserts → Nearly-Complete → roll-groups), and one of them (Viktranium/Lamordia) has **127 host slots already sitting unused in the enriched data**. Sourcing an option pool + host-slot detection + reusing the primitive is a small, repeatable unit — no new solver mechanics.

**Grounding — data-availability sweep run this session (Claude-in-Chrome; server-side access blocked).** The user chose "block until fully documented," so the roadmap commits only confirmed-sourceable systems:
- **Viktranium Experiment crafting** (`https://ddowiki.com/page/Viktranium_Experiment_crafting`) — richly documented (44K chars, 15 tables): "Lamordia Augments" effect pool, "Items with Lamordia augment slots" (hosts), recipes, and Weapon/Accessory/Armor sections, plus a "Legendary Cataclysmic Weapons and Shields" section. **This IS the "Lamordia crafting" the 127 in-data slots belong to** — the harvest mislabeled the `{{Lamordia Slot|...}}` template; the real system is Viktranium. Confirmed sourceable.
- **Dinosaur Bone crafting** (`https://ddowiki.com/page/Dinosaur_Bone_crafting`) — has **Weapons / Armors / Set Bonus** sections (the Accessory-insert pool already shipped in PR #2). Confirmed sourceable.
- **Essence Crafting** (`https://ddowiki.com/page/Essence_Crafting`) — documented existing system (detailed steps + tables). Confirmed sourceable; the "split-prefix" framing is to be reconciled to the documented mechanic during M3 sourcing.
- **Catalyst Crafting** (`https://ddowiki.com/page/Catalyst_Crafting`) — **exists and is documented** (an earlier data-sweep search missed it; corrected here). But it is a fundamentally different *kind* of system: it combines rare Catalysts (from Terror of Demogorgon quests) with *older* named items to **create entirely new named items** (ML11 Heroic / ML35 Legendary, Drow/Demon-themed) at the Strange Catalyst Forge. It does **not** add an affix slot to an item — so it is **not** a choice-slot/insert to model in the solver. Its output is a roster of **named items** → covered under R4 (named-gear sourcing), not a crafting-primitive milestone.
- **Myth Drannor crafting** — Myth Drannor exists as content (named-item packs/sagas) but has **no distinct crafting system**. Dropped from the crafting program; Myth Drannor contributes named + raid gear only.

**Framing correction — two kinds of "crafting."** The confirmed systems split by what they do to the optimizer's data:
- **Affix-adding (choice-slot / typed-insert)** — Nearly Complete ✅, Nearly Finished ✅ (roll-group), **Viktranium (M1)**, IoD Dino (M2). These attach a craftable affix to an *existing* item → modeled by reusing the gated-contribution primitive.
- **Item-creating** — **Catalyst Crafting** produces *new* named items. These are just gear to source → R4, no solver work.
- **Essence Crafting (M3)** is TBD which kind — reconciled during sourcing (Open Question 3); if it creates/modifies whole items rather than offering a choice-slot, it moves to R4 like Catalyst.

---

## Product Contract

### Primary actor & outcome
A DDO player theorycrafting an endgame build gets optimizer results that account for **every expansion crafting system** their gear can use (Viktranium/Lamordia slots, IoD Dino weapon/armor/set crafting, Essence crafting) — the solver crafts the best option per host for the ranked targets — and, progressively, over the **exhaustive** named + raid gear pool of U81, IoD, and Myth Drannor. Every crafted value and item stat is wiki-traceable.

### In scope (requirements)

- **R1 — Crafting systems first, three confirmed.** Model, in order, the three data-confirmed crafting systems, each reusing the existing gated-contribution primitive (no new solver mechanics):
  - **M1 — Viktranium Experiment crafting** (U81; a.k.a. the "Lamordia" slots): source the Lamordia-augment option pool + the Cataclysmic weapon/shield crafting on the same page; detect the host slots (already 127 in-data); the solver crafts the best insert per typed slot.
  - **M2 — IoD Dino Weapon / Armor / Set-Bonus pools**: extend the shipped Accessory-insert work with the three deferred pools + variant-aware slot typing.
  - **M3 — Essence Crafting**: ~~model the documented Essence crafting mechanic (reconciling "split-prefix" to the wiki's actual system).~~ **DEFERRED 2026-07-27** — the data check found it is item-fabrication (a new solver primitive), not the reuse shape; moved to its own brainstorm. See the Status Update above.
- **R2 — "Done" per crafting system** (the Nearly-Complete precedent): option pool sourced under strict provenance → `enrich.py` detects the host-slot marker → the **existing** choice-slot / typed-insert solver primitive attaches it → verified end-to-end by a real solve → honest per-system coverage disclosure (N hosts active). Host *population* rides along with named-item enrichment (R4), exactly as U81 Nearly-Complete hosts activated.
- **R3 — Strict provenance, block-until-documented.** Only wiki-documented pools are committed; each milestone opens with a fail-fast Claude-in-Chrome data check and does not ship a system whose pool is not fully documented. Explicit values only; ambiguous → quarantined, never inferred; every value carries a `wiki_url`.
- **R4 — Exhaustive named + raid gear, per expansion (M4+).** After the crafting systems, source **every viable named item per slot** (per the exhaustive-per-slot standard) for U81, IoD, and Myth Drannor — **including raid named gear AND the Catalyst-crafted item roster** (item-creation output, not a solver primitive) — via the established harvest → `enrich.py` → verify pipeline. Raid gear and Catalyst-crafted gear are named gear; no separate path.
- **R5 — Reuse over rebuild.** Every crafting system folds into the built primitive (augments/Dino/NC/roll-groups) and its data-layer conventions (strict `enrich.py` rendering, dominance guards, umbrella/alias normalization). New solver mechanics are out of scope unless a system provably cannot be expressed as a gated choice-slot / typed-insert.

### Out of scope (boundaries)

- **Catalyst Crafting as a solver primitive** — it creates whole named items rather than adding a choice-slot, so it is sourced as named gear (R4), NOT modeled as a crafting milestone. (The Viktranium "Cataclysmic Weapons and Shields" arm is separate — that stays in M1.)
- **Myth Drannor crafting** — no distinct system exists; Myth Drannor is named/raid gear only.
- **Raid-specific *crafting*** — only if a raid documents a *distinct* crafting mechanic (none confirmed in the sweep); otherwise raid content is named gear (R4). A raid crafting system, if found, is deferred to its own milestone under R2's "done" bar.
- **New solver/model primitives** — the whole thesis is reuse; a genuinely new mechanic is a separate brainstorm.
- **Heroic / mid-level gear** — the named-gear sweep (R4) is endgame-band, consistent with the existing compendium scope.

### Key decisions (session-settled)

- **KD1 — Crafting-first (horizontal) batching** *(user-directed — chosen over expansion-first and value-tiered: front-loads the reusable-primitive wins and unblocks the 127 in-data Lamordia slots).*
- **KD2 — Block until fully documented** *(user-directed — chosen over best-effort/fail-fast-carry: only wiki-confirmed pools enter the roadmap; the sweep already dropped Catalyst and Myth-Drannor-crafting).*
- **KD3 — Exhaustive per slot for named + raid gear** *(user-directed — chosen over curated-BiS: truest to "provably optimal over all real gear"; accepted larger sourcing effort).*
- **KD4 — Reuse the gated-contribution primitive** *(agent-recommended, user-affirmed — the crafting systems are the same choice-slot/typed-insert shape already shipped).*

### Success criteria

- Each committed crafting milestone: the solver crafts the best option per host for a matching query, verified by a real HiGHS solve; coverage honestly reports hosts active vs. pending; every value wiki-traceable.
- After M1–M3, the three confirmed crafting systems contribute to loadouts wherever the player's gear carries their slots.
- The named/raid sweep (R4) makes the optimizer's per-slot optimum genuinely optimal over all real endgame gear for the covered expansions.
- No fabricated data: undocumented systems are excluded, ambiguous effects quarantined.

---

## Open Questions (for `/ce-plan`, per milestone)

1. **Viktranium slot typing** — are the Lamordia-augment slots *typed* (like Dino Scale/Fang/Claw/Horn) or a single select-one per slot? Determines whether M1 reuses the typed-insert model (Dino) or the category choice-slot model (Nearly-Complete). Source from the Viktranium page's slot/recipe tables.
2. **Cataclysmic within Viktranium** — is "Legendary Cataclysmic Weapons and Shields" a separate pool or the weapon/shield arm of the same system? Confirms whether "Catalyst" fully folds into M1.
3. **Essence "split-prefix"** — ~~reconcile the user's framing to the documented Essence Crafting mechanic; confirm it's a choice-slot/gated shape and not a stat-transform that needs new modeling (if the latter, it may move out of scope per R5).~~ **RESOLVED 2026-07-27:** it is item-fabrication (build a custom item from a blank with any prefix + any suffix, ML-scaled) → a new solver primitive, out of scope per R5, deferred to its own brainstorm. See the Status Update above.
4. **IoD Dino variant-aware typing** — the deferred Weapon/Armor pools may type slots differently than Accessory; confirm from the Dino page's Weapons/Armors sections.
5. **Raid crafting existence** — during R4 raid-gear sourcing, watch for any raid-*specific* crafting mechanic; if found, spin a milestone under R2 rather than forcing it into named gear.
6. **Named-gear frontier per expansion** — which wiki pages enumerate each expansion's exhaustive named + raid item set (for the R4 "done = exhaustive per slot" claim).

---

## Provenance

- Source workflow: `ce-brainstorm` (Deep — feature). Grounding: a live Claude-in-Chrome data-availability sweep this session (confirmed Viktranium/Dino/Essence as choice-slot systems; Catalyst Crafting re-homed to named-gear sourcing as an item-creation mechanic per a user correction; Myth-Drannor-crafting dropped as non-existent).
- Builds on the shipped gated-contribution primitive and its data-layer conventions (PRs #1–#4, #9, #12–#14) and the compendium enrichment pipeline (PRs #5–#8).
- Next step: `/ce-plan docs/plans/2026-07-25-006-feat-multi-expansion-crafting-content-roadmap-plan.md` to enrich M1 (Viktranium) to implementation-ready first.
