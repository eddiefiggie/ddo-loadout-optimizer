---
title: Alternative Loadouts (Trade-off Driven) - Plan
type: feat
date: 2026-07-27
topic: alternative-loadouts
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
---

# Alternative Loadouts (Trade-off Driven) - Plan

> **Requirements-only.** This Product Contract defines WHAT to build. Run `/ce-plan` on this file to enrich it into an implementation-ready plan before `/ce-work`.

## Goal Capsule

- **Objective:** Alongside the single provably-optimal loadout, surface a handful of *near-optimal* alternatives that each give up a small, quantified amount on a lower-ranked priority to gain something meaningful, so a player can see the trade space instead of just the one answer.
- **Product authority:** The user, via the brainstorm dialogue. The solver and data model remain the authority for values; this adds a new *capability* (produce alternatives) plus presentation.
- **Open blockers:** None. Several tunable parameters are recorded as Outstanding Questions, not blockers.

---

## Product Contract

### Summary

The optimizer currently returns exactly one loadout: the provably-optimal build for the player's ranked priorities. This feature adds **trade-off-driven alternatives** — a small set of near-optimal builds that each sacrifice a little on a lower-ranked priority to gain something worthwhile, with the cost and benefit stated explicitly. Alternatives appear in a new **"Alternatives"** results tab; selecting one loads it into the same paperdoll and analysis views used for the optimum. The optimum stays the headline; alternatives are clearly secondary.

### Problem Frame

The strict lexicographic solve answers "what is the single best build for these priorities, in this order?" That is correct but narrow. In DDO, players routinely accept a small loss on one stat to gain a set bonus, a big spike in an unranked stat, or a cheaper build — and the current tool hides that entire trade space behind its one answer. A player who sees only the optimum can't tell whether a nearly-as-good build would suit their character better, and has no way to weigh the give-and-take. Surfacing a few meaningfully-different near-optimal builds, each annotated with what it trades and what it gains, turns a single verdict into a decision the player can actually make.

### Key Decisions

- **KD1 — Alternatives are trade-off driven** (session-settled: user-directed — chosen over "best build per committed set" and "next-best distinct builds (top-K by score)"). An alternative earns its place by trading a small, quantified amount on a lower-ranked priority for a meaningful gain, not merely by scoring second.
- **KD2 — Four gain types count, each tagged** (session-settled: user-directed — all four selected): (a) **activating a set bonus**, (b) **boosting a stat the player did not rank**, (c) **rebalancing among the ranked priorities** (more of a lower one at a small cost to a higher one), (d) **needing fewer/cheaper crafting steps**. An alternative may hit more than one; each gain is labeled.
- **KD3 — The analysis states the variance explicitly** (session-settled: user-directed). Every alternative shows its cost and benefit in concrete terms ("costs 4 Constitution, gains the 5-piece Dread Isle's Curse set" / "-3 on #1 Constitution, +18 on #3 Physical Sheltering" / "3 fewer augments to craft").
- **KD4 — Presentation is a new "Alternatives" result tab with selectable cards** (session-settled: user-approved). It sits alongside Ranked Priorities / Set Bonuses / Loadout Deep Dive. Each alternative is a compact card (trade-off summary + gain tags); selecting one loads it into the paperdoll and the other result tabs so it can be inspected exactly like the optimum, with a clear way back to the optimum.
- **KD5 — The optimum is unchanged and remains primary** (session-settled: user-approved). Alternatives are additive and clearly secondary; the provably-optimal build stays the default headline and its correctness/provability is untouched.

### Requirements

**Generating alternatives**

- R1. Alongside the optimal loadout, the tool produces a small set of **near-optimal alternatives**, each trading a quantified amount on a lower-ranked priority for a meaningful gain.
- R2. Each alternative is **meaningfully distinct** from the optimum and from the other alternatives (not a trivial one-item swap).
- R3. Alternatives are produced **deterministically** — the same query yields the same alternatives — consistent with the tool's "provably optimal, not a guess" framing.
- R4. The solver **capability is presentation-independent**: generating alternatives is a solver/model concern; the optimum's solve is unchanged (mechanism deferred to planning).

**Trade-off analysis (the variance)**

- R5. Each alternative is **tagged by gain type(s)**: set activation, unranked-stat boost, priority rebalance, and/or cheaper crafting (KD2).
- R6. Each alternative states its **cost** explicitly: how much it gives up, and on which ranked priority.
- R7. Each alternative states its **gain** explicitly and quantified where possible: the set gained, the unranked stat(s) boosted and by how much, the rebalanced priority delta, or the reduction in crafting steps.
- R8. When an alternative hits **multiple** gain types, all are surfaced, not just one.

**Presentation**

- R9. A new **"Alternatives"** tab appears in the results, alongside Ranked Priorities / Set Bonuses / Loadout Deep Dive.
- R10. Each alternative renders as a **compact card**: its trade-off summary (cost + gains) and gain-type tags, scannable at a glance.
- R11. **Selecting an alternative loads it** into the paperdoll and the other result tabs (Ranked Priorities, Set Bonuses, Deep Dive), so it can be inspected exactly like the optimum.
- R12. There is a **clear, always-available way to return to the optimum** from any selected alternative.
- R13. The **optimum remains the default and headline**; alternatives read as clearly secondary.
- R14. When **no meaningful alternative exists** (the optimum dominates, or nothing clears the trade-off bar), the tab says so plainly rather than showing weak or empty cards.

**Quality / consistency**

- R15. Alternatives **reuse the existing result surfaces** (paperdoll, attribution, deep dive) rather than a parallel rendering, so a selected alternative looks and behaves like the optimum.
- R16. Generating and presenting alternatives keeps the experience **interactive**; if alternative generation is materially slower than the base solve, it is clearly asynchronous or on-demand rather than blocking the optimum's result.

### Acceptance Examples

- AE1. **Set-activation alternative.** *(Covers R1, R5, R7.)* Given an optimum that is 2/5 of a strong set, when alternatives render, then at least one alternative completes that set, tagged "set bonus", stating "costs N of [priority], gains the 5-piece [set] bonus".
- AE2. **Unranked-stat alternative.** *(Covers R5, R7.)* Given an alternative that boosts a stat the player did not rank, then it is tagged "unranked stat" and states the stat(s) gained and by how much.
- AE3. **Rebalance alternative.** *(Covers R5, R6, R7.)* Given an alternative that shifts value between ranked priorities, then it states the signed deltas ("-3 on #1 Constitution, +18 on #3 Physical Sheltering") and is tagged "rebalance".
- AE4. **Cheaper-crafting alternative.** *(Covers R5, R7.)* Given an alternative that needs fewer crafting steps than the optimum, then it is tagged "cheaper crafting" and states the reduction (e.g. "3 fewer augments, no raid item").
- AE5. **Select and inspect.** *(Covers R11, R12, R15.)* Given the Alternatives tab, when the player selects an alternative, then the paperdoll and the other tabs update to that build, and a control returns them to the optimum.
- AE6. **No meaningful alternative.** *(Covers R14.)* Given a query where the optimum dominates, when the Alternatives tab is opened, then it states that no worthwhile trade-off build was found, with no empty or misleading cards.

### Scope Boundaries

**Outside this work**
- The optimum's solve, correctness, and provability are unchanged; alternatives are strictly additive.
- Not a full side-by-side build-diff/comparison tool beyond each alternative's trade-off summary and the ability to load one into the shared views (a richer diff view is possible later).
- No new query inputs or target types; alternatives derive from the same query as the optimum.
- Item/data model changes only if a "cheaper crafting" cost signal turns out to be missing (see Dependencies).

### Dependencies / Assumptions

- Builds on the existing solver (`web/solver.js`, HiGHS-WASM MILP, staged lexicographic) and program; the solver gains an alternative-generation capability.
- Reuses the just-shipped tabbed results UI and the paperdoll / attribution (`attributionByTarget`, `whyThis`) / Loadout Deep Dive renderers in `web/results.js`.
- The set-activation, unranked-stat, and rebalance gains are computable from data the solver already has (chosen items, per-target values, set membership, and the per-bucket contribution state the attribution readers already expose).
- **The "cheaper crafting" gain needs a crafting-cost / attainability signal.** The dataset carries craft prescriptions (augments, seals, Dino inserts, Nearly-Complete, Viktranium, raid items) but not necessarily a cost or rarity metric to compare builds by. Whether a usable signal exists, or a simple proxy (count of crafting steps / raid-sourced pieces) suffices, is a planning/data question (see Outstanding Questions). This is an unverified assumption, flagged rather than asserted.

### Outstanding Questions

- **Tolerance:** how near "near-optimal" must be (e.g. within a small percentage of the optimum on the top priority, or giving up at most a bounded amount on any higher-ranked priority). Needs a default and possibly a user-visible knob.
- **Count:** how many alternatives to surface (a handful; exact number TBD), and how to rank/pick which trades are most worth showing when many qualify.
- **Trigger:** compute alternatives automatically on every solve, or on demand (a button / opening the tab), depending on cost (R16).
- **Crafting-cost metric:** what defines "cheaper" for the crafting gain (count of augments/seals/raid items, a rarity weight, or a simpler proxy), and whether the data supports it (Dependencies).
- **Multi-gain ranking:** when an alternative hits several gains, how it is ordered/emphasized relative to single-gain alternatives.

### Sources / Research

- Brainstorm dialogue (this session): trade-off-driven definition, the four gain types, the explicit cost/benefit analysis, and the Alternatives-tab presentation.
- Current solver output surface: `web/solver.js` `solveLexicographic` (single optimum; `perTarget`, `effective`, `chosen`, the `*Placed` craft lists, `breakdown`, `program`).
- Current result surfaces (reused): the tabbed results + paperdoll + attribution + Loadout Deep Dive in `web/results.js` (shipped this session on branch `fix/ui-controls-paperdoll-hero`).
- Motivating context: the strict lexicographic optimum hides the trade space players actually reason about (sets, unranked stats, attainability).

---

*Next step: run `/ce-plan docs/plans/2026-07-27-005-feat-alternative-loadouts-plan.md` to design the solver's alternative-generation mechanism and the UI, and resolve the Outstanding Questions.*
