---
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
date: 2026-07-28
title: Legendary Thunder-Forged + Green Steel — Endgame Crafting Choice-Slots - Plan
---

# Legendary Thunder-Forged + Green Steel — Endgame Crafting Choice-Slots - Plan

## Goal Capsule

**Objective.** Extend crafting coverage to the two older Legendary crafting systems that still win slots at ML30+ — **Legendary Thunder-Forged** and **Legendary Green Steel** — by modeling each as a **configurable choice-slot** on its host items, so the optimizer picks the craftable configuration that best serves a build's ranked targets. No new solver mechanism: both reuse the shipped gated-contribution choice-slot primitive.

**Why now.** The endgame band (ML30-36 named/raid gear) and the expansion crafts (Dino, Viktranium, Nearly Complete, Vecna) are solver-active, but Thunder-Forged and Green Steel — both endgame-relevant for their unique effects — are only browse-indexed (37 and 85 roster entries respectively, no craftable options modeled). A build that would slot a Legendary Thunder-Forged weapon or a Legendary Green Steel item currently gets a result that silently omits those options, undercutting the "provably optimal over all sources" promise for those builds.

**Priority driver (session-settled).** Endgame BiS competitiveness — model only what wins ML30+ slots. This scope covers the two systems that do; heroic/weak systems (Slave Lords, Essence/Cannith) are out.

**Product authority.** This document is the source of truth for WHAT. `/ce-plan` owns HOW.

**Open blockers.** None. Both fit an existing primitive; the craftable option menus are wiki-sourced in planning/implementation.

---

## Product Contract

### Primary actor & outcome
A DDO player theorycrafting an ML30+ build gets an optimizer result that accounts for the **craftable configurations** of Legendary Thunder-Forged and Legendary Green Steel gear — the solver picks the tier/option config that best advances the ranked targets and prescribes it — so results for builds that use these systems are genuinely optimal, every value wiki-traceable.

### In scope
- **Legendary Thunder-Forged** — modeled as a **multi-tier affix choice-slot**: each host item exposes its Tier 1 / Tier 2 / Tier 3 picks; each tier is a single-pick over that tier's option menu; the solver chooses the config that best serves the ranked targets. Attach to the ~37 already-indexed Thunder-Forged items; source the tier option menus from the wiki.
- **Legendary Green Steel** — modeled as a **choice-slot over an endgame-relevant option pool**: the SP/HP/Insightful/Quality/proc craftable effects that appear in real ML30+ builds, wiki-sourced, attached to the relevant Green Steel host items (~85 indexed). The solver picks the best craftable config per build.
- Both reuse the shipped **gated-contribution choice-slot primitive** (same shape as Nearly Complete / Viktranium / seal): a per-option binary gated by the host being equipped, single-pick per tier/slot, feeding the same `(stat, bonus_type)` buckets so stacking stays correct.

### Out of scope (deferred)
- **Slave Lords crafting** — heroic/mid, not endgame BiS. Its set bonuses already exist in the catalog; items stay browse-only.
- **Essence / Cannith crafting** — universal; generic Enhancement affixes rarely beat named BiS (de-scoped in `docs/gear-and-crafting-assessment.md`).
- **Full/exhaustive Green Steel combinatorial space** — only the endgame-relevant subset is modeled; niche configs are disclosed as out-of-scope per result, not silently dropped.
- **Thunder-Forged / Green Steel *set bonuses*** (equip-multiple) — if these systems carry set bonuses, those flow through the existing `set_active` machinery + set catalog, separate from this choice-slot work (see Outstanding Questions).

### Success criteria
- The ~37 Thunder-Forged and the relevant Green Steel host items are solver-active with their craftable choice-slots; a query whose targets favor a TF/GS config equips the host and the result prescribes the exact tier/option picks.
- Each craftable option is wiki-traceable; any option with no explicit magnitude is quarantined with a reason + `wiki_url`, never inferred.
- Bonus-type stacking holds across the crafted options and the rest of the loadout (crafted config feeds the same buckets).
- Deterministic under the staged lexicographic solve; results disclose Green Steel's endgame-relevant cutline so coverage is honest.
- No new solver primitive — the diff is data + choice-slot attachment + tests, mirroring the seal/Nearly-Complete pattern.

### Key decisions
- **Endgame-BiS driver** *(session-settled: user-directed — chosen over completeness and tractability-first: model only what wins ML30+ slots).*
- **Both systems in scope** *(session-settled: user-directed — both LTF and LGS still slot at ML30+ for their unique effects, per the user; Slave Lords + Essence out).*
- **Choice-slot fit, no new mechanism** *(session-settled: user-approved — both modeled with the existing gated-contribution choice-slot primitive; recommended and accepted).*
- **Green Steel = endgame-relevant subset** *(session-settled: user-directed — chosen over full craftable menu and slot-class-first: a bounded, wiki-grounded pool of the effects that win ML30+ slots, niche configs disclosed).*

### Assumptions (flag if wrong)
1. Thunder-Forged's per-tier menus are naturally bounded (small enough to model in full); Green Steel's are not (hence the endgame-relevant cut).
2. Both systems' Legendary items are ~ML29 — usable at ML30+; the solver already handles lower-ML in-band items.
3. The host items already exist in the roster (37 TF + 85 GS indexed); this is an enrichment + choice-slot-attach effort, not item discovery.

## Outstanding Questions (for /ce-plan)
- **Set bonuses.** Do Legendary Thunder-Forged / Green Steel carry equip-multiple set bonuses? If so, source them through the existing set catalog + `set_active` machinery (like the Vecna/Dino work), as a related item — not part of the choice-slot scope. No Thunder/Green-Steel set currently resolves in `gearplanner_sets.json`; verify against the wiki.
- **Green Steel cutline.** The exact "endgame-relevant" option set is a wiki-grounded selection made during sourcing — which effects (Concordant Opposition, specific Insightful/Quality/Profane lines, top SP/HP/proc options) clear the bar. Record the cut + its rationale so the disclosure is honest.
- **Multi-tier interaction.** Whether Green Steel's tier-3 "dual-shard" effects behave as independent choice-slot options or as a combined pick that constrains earlier tiers — resolve against the wiki mechanics during planning.
