---
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
date: 2026-07-25
title: U81 Nearly Complete Crafting - Plan
---

# U81 Nearly Complete Crafting - Plan

## Goal Capsule

**Objective.** Model Update 81's **Nearly Complete** crafting — the "choose a 4th affix from a category menu" upgrade from *Terror of Demogorgon* — as a new gated-contribution source, so the optimizer picks the best craftable affix for a build's ranked targets. Source the full effect pool now (via Claude-in-Chrome); attach it to item hosts as U81 named items get documented.

**Product authority.** The Product Contract below. This is a `ce-brainstorm` requirements-only plan (WHAT); `/ce-plan` adds the HOW.

**Open blockers.** None for the effect-pool machinery. The item→slot host mapping is blocked on ddowiki publishing U81 named-item pages (revisit trigger) — disclosed, not a blocker to this milestone.

**Why now.** U81 (*Terror of Demogorgon*, released 2026-07-22, level cap → 36) is the new endgame. Its Nearly-Complete effect system is fully documented with explicit Legendary values (+15 ability, +62 heal-amp, +13 spell focus, …) — significant best-in-slot-relevant contributions the optimizer currently can't see — and it is a clean fit for the existing gated-contribution choice-slot primitive.

**Grounding — verified this session via Claude-in-Chrome (plain fetch returns empty for ddowiki).**
- U81 = *Terror of Demogorgon*, released 2026-07-22, level cap → 36. Source: `https://ddowiki.com/page/Update_81_Release_Notes`.
- **Nearly Complete**: an upgrade mechanic that adds one extra enchantment chosen from a category menu, applied at the Duergar Completion Forge in Gravenhollow for 25 Abyssal Gems (Legendary Abyssal Gems for Legendary items); the choice is **irreversible** once selected. The full effect tables — 6 categories, their option sets, and both Heroic (ML11) and Legendary (ML35) magnitudes — are documented. Source: `https://ddowiki.com/page/Nearly_Complete`.
- The `Update 81 named items` page **does not exist yet** → which items carry which Nearly-Complete slot is not yet sourceable; that mapping is deferred.

---

## Product Contract

### Primary actor & outcome
A DDO player theorycrafting an ML35/36 build gets the optimizer to choose the best Nearly-Complete 4th affix — the single option from the slot's category menu that most advances their ranked targets — factored into the optimal loadout, with the chosen craft shown. Every value is traceable to ddowiki.

### In scope (requirements)
- **R1 — Source the Nearly-Complete effect pool** (via Claude-in-Chrome): the 6 categories, each with its bonus type, option set, and Heroic + Legendary magnitude — **Ability Score** (Enhancement, 6 abilities, +6/+15); **Insightful Ability** (Insight, +2/+7); **Quality Ability** (Quality, +1/+3); **Healing Amplification** (Positive=Competence / Repair=Enhancement / Negative=Profane, +24/+62); **Skill** (Exceptional, 6 ability-keyed skill groups, +6/+11); **Spell Focus** (Equipment, spell schools, +4/+13). Explicit values only; ambiguous → quarantined.
- **R2 — Model a Nearly-Complete slot as a parametric choice-slot.** An item carries a slot of one category; the solver selects **at most one** option from that category's pool (the best for the ranked targets), gated by the item being equipped — reusing the gated-contribution primitive (select-one feeding the bonus-type buckets), the same shape as augments and Dino inserts.
- **R3 — Correct stacking.** The chosen option's affix obeys bonus-type stacking against every other source: max per `(stat, bonus_type)`, sum across types.
- **R4 — Results & disclosure.** The build sheet shows the chosen Nearly-Complete craft per item; coverage discloses **"Nearly Complete effect system: sourced · U81 item hosts: pending wiki."**
- **R5 — Strict provenance.** Every effect-pool record carries a `wiki_url`; the unpublished item→slot mappings are pending, never inferred.
- **R6 — Sourcing mechanism.** All U81 (and ddowiki) data is sourced via the **Claude-in-Chrome MCP** — plain `fetch` returns empty for ddowiki. *(session-settled.)*

### Out of scope / boundaries
- **Item→slot host mapping** (which specific U81 items have which Nearly-Complete category) — **deferred**, blocked on ddowiki named-item pages; revisit when documented. The effect pool + machinery ship now, proven with test fixtures.
- **U81's other crafting systems** — **Catalyst Crafting** (legacy Named Item + catalyst → upgraded item) and **Essence Crafting Split-Prefix** (configurator, 100+ recipes) — deferred.
- **General U81 named-loot sourcing** — deferred (blocked on wiki).
- **No engine change** beyond the new choice-slot gated-contribution shape.
- **The legible-priority milestone** — separately scoped this session, parked on the backlog (needs no external data; ready to plan anytime).

### Key Decisions (session-settled)
- **[session-settled] Target U81 Nearly Complete specifically** — the well-specified, fully-documented choice-slot — over Catalyst Crafting and Essence Split-Prefix.
- **[session-settled] Model as a parametric select-one choice-slot** reusing the gated-contribution primitive (like augments / Dino inserts), not a new solve paradigm.
- **[session-settled] Build machinery + source the effect pool now; defer the item→slot host mapping** to when ddowiki publishes U81 items.
- **[session-settled] Source all ddowiki data via Claude-in-Chrome MCP** (plain fetch blocked).
- **[session-settled] Wiki-sourced, never inferred** — ambiguous records are quarantined.

### Acceptance Examples
- **AE1** A fixture item with a *Nearly Complete: Ability Score* slot lets the solver add **+15 Enhancement** to whichever ability best advances the ranked targets; changing the target ranking changes which ability it picks.
- **AE2** The solver selects **at most one** option per Nearly-Complete slot (options within a slot are mutually exclusive — the in-game choice is irreversible/single).
- **AE3** A Nearly-Complete Enhancement bonus to a stat does not stack with a worn Enhancement bonus to the same stat (max), but stacks with an Insightful or Quality Nearly-Complete bonus (sum).
- **AE4** An effect whose wiki text is ambiguous (e.g. a Healing-Amp bonus type that doesn't reconcile with the release notes) is quarantined and surfaced in coverage — never inferred.
- **AE5** Coverage discloses the effect system as **sourced** and the item hosts as **pending**.

### Outstanding Questions (resolve during sourcing/planning)
- **Q1** Reconcile **"Spell Focus"** (the `Nearly_Complete` page) vs **"Spell School"** (the release notes); confirm the school list (the page lists **7**, omitting **Divination**) and that the bonus type is **Equipment**.
- **Q2** Confirm the **Healing-Amp bonus types** — release notes say Positive=Competence, Repair=Enhancement, Negative=Profane; verify against the effect-table wording.
- **Q3** **Skill** category — is "Strength Skills" a target the solver ranks directly, or a group that must expand to individual skills? Define the modeling.
- **Q4** Confirm the optimizer handles **ML 36** queries (new cap); the pool's Legendary tier is ML35.
- **Q5** **Item-host attachment shape** — do U81 items simply carry a `nearly_complete: <category>` field, mirroring how Dinosaur Bone items carry their typed Dino slots? (Carry to planning.)
