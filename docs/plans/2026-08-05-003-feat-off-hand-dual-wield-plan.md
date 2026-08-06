---
title: Off-Hand Dual Wield Declaration - Plan
type: feat
date: 2026-08-05
topic: off-hand-dual-wield
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Off-Hand Dual Wield Declaration - Plan

## Goal Capsule

- **Objective:** Let a player who dual-wields say so, and have the off hand follow. Replace an undiscoverable gear-control side effect with an explicit character-level declaration.
- **Product authority:** eddiefiggie (project owner).
- **Open blockers:** None.
- **Reports addressed:** 2026-08-05 batch report 4 (a longsword cannot be pinned to the off hand; shields and rune arms keep filling the slot).

---

## Product Contract

### Summary

Add a Two Weapon Fighting declaration to the character step, alongside race, armor, and weapon setup. Off-hand weapon candidacy follows the declaration rather than switching on when a player happens to add a weapon type to the off-hand control. Give the pin flow a hand target so a one-handed weapon can be pinned to either hand.

### Problem Frame

Dual-wield is implemented but unreachable by default. It activates only when a player adds a second weapon type to the off-hand control, which nothing signposts, so the off hand fills with shields, orbs, and rune arms and the player concludes the tool does not support dual-wielding.

Pinning does not rescue it. Every weapon pin is routed to the main hand regardless of intent, so a longsword pinned as an off-hand pick silently lands in the main hand instead. The reported behavior therefore has two independent causes, and fixing only the gate would leave the pin path still wrong.

The gate exists for a real reason: DDO penalizes off-hand attacks without the Two Weapon Fighting feat chain, and the optimizer does not model feats. Making dual-wield automatic for one-handed styles would hand players builds they cannot execute. A declaration states the feat honestly instead of hiding a feat requirement inside a gear control.

### Key Decisions

- **Dual-wield is a character-level feat declaration.** (session-settled: user-directed — chosen over keeping the opt-in and making it discoverable, over auto-enabling for one-handed styles, and over honoring a pin alone: the optimizer does not model feats, so an automatic rule would produce unexecutable builds, and a declaration models the requirement rather than concealing it.)

- **The declaration is character state, not gear state.** Changing combat style never clears it. (user-approved — chosen over folding it into the existing style reset that clears weapon and off-hand selections: silently un-declaring a feat the character has would contradict its persistence and surprise the player.)

- **A declared build excludes shields, orbs, and rune arms from the off hand.** Declaring Two Weapon Fighting means the off hand holds a weapon, not that weapons merely compete for it. (session-settled: user-directed — chosen over letting one-handed weapons compete on merit: the solver has no weapon-versus-shield value model, and a shield usually carries more ranked stats than a longsword, so "compete" would return a shield and the reported behavior would survive the fix. The player keeps an escape hatch — pinning a shield overrides the exclusion, flagged inline per R8 — and R10 discloses that the comparison was narrowed.)

- **Per-style off-hand rules are preserved.** The declaration governs styles that permit a second weapon; every other style keeps its existing allow-list. (user-approved — chosen over a single global off-hand rule: shipped styles already restrict the off hand to shields, to rune arms, or to nothing, and a global rule would regress those constraints.)

### Requirements

**The declaration**

- R1. Two Weapon Fighting is declared on the character step alongside race, armor, and weapon setup, rather than switching on as a side effect of the off-hand control.
- R2. The declaration is a character property: changing combat style never clears it.
- R3. Under a style that permits a second weapon, a declared build fills the off hand with a one-handed weapon: shields, orbs, and rune arms leave off-hand candidacy unless the player pins one.
- R4. Under a style that forbids a second weapon, the control stays set but renders inert with a stated reason.
- R5. Every other style keeps its existing off-hand type allow-list unchanged.

**Pinning**

- R6. A one-handed weapon can be pinned to either hand, with the pin flow offering a hand target rather than routing every weapon to the main hand.
- R7. An off-hand weapon pin made without the declaration is accepted, flagged inline with a stated reason, and suppressed from the solve, matching the existing warn-don't-block pin convention.
- R8. A pin that overrides the declaration's off-hand rule is flagged inline with its reason, so the player is never left to wonder why the off hand holds what it holds.

**Persistence and disclosure**

- R9. The declaration persists with the saved character and travels with a shared or exported loadout.
- R10. Results disclose both limits of a declared build: shields, orbs, and rune arms were excluded from the off hand (and a pin restores them), and the optimizer does not score the Two Weapon Fighting penalty itself.
- R11. The declaration control and the pin flow's hand target are keyboard-operable, focus-managed, and announced.

### Acceptance Examples

- AE1. The off hand follows the declaration.
  - **Given:** a style that permits a second weapon, with Two Weapon Fighting undeclared.
  - **When:** the player pins a longsword to the off hand.
  - **Then:** the pin is accepted, flagged with a stated reason, and suppressed from the solve; after declaring Two Weapon Fighting, the same pin is honored.
  - **Covers R3, R6, R7.**

- AE2. The declaration survives a style change.
  - **Given:** a character with Two Weapon Fighting declared.
  - **When:** the player switches to a style that forbids a second weapon, then back.
  - **Then:** the declaration is still set throughout, rendering inert with a stated reason while the forbidding style is active.
  - **Covers R2, R4.**

- AE3. Other styles are unaffected.
  - **Given:** a style whose off hand is restricted to shields, and another restricted to rune arms.
  - **When:** the player declares Two Weapon Fighting.
  - **Then:** each style keeps its existing off-hand allow-list.
  - **Covers R5.**

- AE4. The declaration travels.
  - **Given:** a saved character with Two Weapon Fighting declared.
  - **When:** the player reloads it and exports the loadout.
  - **Then:** the declaration is present on load and appears in the exported loadout.
  - **Covers R9.**

### Scope Boundaries

- Feats other than Two Weapon Fighting. This plan declares one feat because a report demanded it; a general feat model is its own scope.
- Modeling the Two Weapon Fighting penalty numerically. R10 discloses the limit rather than closing it.
- Reports 1, 2, 3, 5, 6, and 7 — covered by the sibling vocabulary-hygiene and data-reconciliation plans.
- Sword-and-board combat style (#111), which remains a separate enhancement.

### Success Criteria

- A player who dual-wields can express it without discovering an undocumented control, and the off hand holds what they asked for.
- No existing combat style's off-hand behavior changes for a player who never declares Two Weapon Fighting.
- A player never sees an off-hand item without an available account of why it is there.

### Outstanding Questions

**Resolved during planning**

- Whether a declared build excludes shields or merely lets weapons compete — **excluded** (see Key Decisions). Noted honestly: DDO does permit an off-hand shield with the feat chain trained, so this models the character more narrowly than the game does. The pin escape hatch and R10's disclosure are what keep that honest rather than hidden.

**Deferred to planning**

- Whether the declaration replaces the existing off-hand weapon-type control or sits above it, and what a saved character already carrying off-hand weapon types resolves to on load.
- What shape the pin flow's hand target takes, and what the default is for a one-handed weapon.
- Whether the declaration renders in the results paperdoll as a character attribute alongside race and armor.

### Dependencies and Assumptions

- The optimizer does not model feat effects; the declaration gates candidacy only, which is why R10 discloses the limit.
- The shipped per-style off-hand allow-lists are correct and are preserved rather than re-derived.
- The existing pin convention is warn-don't-block, with illegal pins flagged and suppressed for the current solve rather than refused outright.

### Sources and Research

- `data/bug_reports.txt` — report 4 verbatim, including that the current logic keeps putting a shield or rune arm in the off hand.
- `web/model.js` and the weapon taxonomy — the off-hand gate, the opt-in condition that makes dual-wield unreachable, and the per-style allow-lists.
- `web/wizard.js` — the combat-style selector and its reset of adjacent gear state, the pin search and its routing of every weapon to the main hand, and the pin-legality reconcile path that drops conflicting pins.
- `docs/plans/2026-08-01-002-feat-weapon-armor-offhand-constraints-plan.md` — the shipped weapon and off-hand constraint work this plan extends.
