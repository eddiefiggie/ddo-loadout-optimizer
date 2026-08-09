---
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
title: Priorities step — fold per-row options into one Advanced control, and extend the bundles
date: 2026-08-09
---

# Priorities step UI cleanup

## Problem

The Priorities step (`stepPriorities`, `web/wizard.js:820`) has accumulated four
separate affordances on and around each ranked row, and they compete for
attention with the one thing that step is actually for — the **order**.

A single row currently renders:

```
[⋮⋮] [3] [Constitution]  [min][max]  [↑][↓][✕]  [+ already have]
```

Two number inputs and a credit affordance sit at the same visual weight as the
reorder controls, on every row, whether or not the player will ever use them.
The explanation of what min and max *do* lives in a `<details>` element at the
bottom of the list (`web/wizard.js:851`) — detached from the inputs it
describes, so a player reads the controls first and the caveats last, if at all.

Two further gaps:

- **The default is invisible.** Empty min/max means "no floor, no cap — let the
  solver find the best it can fit at this priority." That is the right default
  and the one almost every player wants, but nothing on screen says so. An empty
  box reads as unfinished, which invites players to fill it in and over-constrain
  a solve they had no reason to constrain.
- **"Already have" under-explains itself.** Its tooltip names trances, past
  lives, filigrees, and ship buffs, but the visible label is three words. The
  feature exists precisely because a player's non-gear bonuses are invisible to
  the tool, and the label does not carry that.

Separately, the bundle rows have drifted from how players actually build:
bundle affix order does not lead with the affix most players want first, there
is no way to add the six ability scores in one click, and Warlock — a class
whose entire damage identity is pact dice and eldritch blast — has no bundle.

## Goals

- One optional control per row, holding everything advanced, so the default row
  is just rank, name, and reorder.
- Make "no min, no max" legible as a deliberate, recommended default.
- Keep the row grid uniform — every row the same shape, aligned columns.
- Bundles that lead with the affix a player of that archetype wants first.
- One-click ability scores, and a Warlock bundle.

## Non-goals

- No change to solver behavior, the bounds model, or the declared-credit model.
  This is presentation only: the same `state.targetCaps`, `state.targetFloors`,
  and `state.declaredCredits` are read and written, through the same handlers.
- No change to which stats are rankable, beyond the twelve augment-only stats
  already added to `CORE_STATS` in this branch.
- No new persisted state. The Advanced panel's open/closed state is ephemeral.

## Requirements

### Row: one Advanced control

- **R1** — Each ranked row collapses its min input, max input, and the
  "already have" block into a single optional per-row control, closed by
  default. The row's default state shows only grip, rank, name, and the
  reorder/remove buttons.
- **R2** — The control is uniform across rows: same label, same position, same
  column. Rows differ only in what the panel contains, never in the row's own
  shape or alignment.
- **R3** — The min/max explainer currently at the bottom of the list
  (`web/wizard.js:851`) moves inside the panel, adjacent to the inputs it
  describes. The standalone element at the bottom of the list is removed — the
  text is relocated, not duplicated.
- **R4** — The panel leads with the default, stated plainly: no minimum and no
  maximum are set, and the solver will get as much of this stat as it can fit
  without giving up anything ranked above it. A player who opens the panel and
  reads nothing else should come away knowing they do not need to fill it in.
- **R5** — A row with settings applied is distinguishable while collapsed. A
  floor, a cap, or a declared credit must not become invisible the moment the
  panel closes — a player who set a hard floor three rows down needs to see that
  from the collapsed list.
- **R6** — Presence (on/off) rows carry no Advanced control. They already
  suppress declared credits (`web/wizard.js:1062`), and a floor or cap on a
  binary stat is meaningless. The row keeps the same grid columns so the list
  stays aligned.
- **R7** — "Already have" gains visible context naming the sources it covers —
  character effects from trances, enhancements, epic destinies and the like —
  rather than carrying that only in a `title` tooltip.

### Bundles

- **R8** — `Basic` is reordered to lead: Constitution, Healing Amplification,
  Physical Sheltering, Magical Sheltering, Dodge, Fortification. Its remaining
  affixes (False Life, Resistance, Freedom of Movement, Blurry, Ghostly,
  Blindness Immunity) follow in their existing order. Reorder only — nothing is
  dropped.
- **R9** — `Ranged` is reordered to lead: Ranged Power, Doubleshot, Deadly,
  Armor-Piercing, followed by Ranged Alacrity and Accuracy. Reorder only.
- **R10** — A new `Attributes` bundle offers the six ability scores: Strength,
  Dexterity, Constitution, Intelligence, Wisdom, Charisma. It sits **above** the
  Tactics row in the bundle area.
- **R11** — A new `Warlock` bundle sits on the top packages row alongside
  Trapping, covering pact dice and eldritch blast plus all three blast damage
  families: Power in Pact, Eldritch Blast Dice, Charisma, Spell Focus Mastery,
  Spell Penetration, Potency, Universal Spell Power, Constitution,
  Nullification, Void Lore, Radiance, Radiance Lore, Impulse, Kinetic Lore.
  All fourteen are confirmed present in `metadata.rankable_affixes`.
- **R12** — Bundle affix lists remain subject to `resolveBundle`
  (`web/wizard.js:400`), which canonicalizes through the alias table and drops
  anything the dataset does not carry, so no bundle can inject a dead target.

## Scope boundaries

`Attributes` is a bundle, not a reveal — it does not gate behind another
package, and it reveals nothing. `Warlock` sits on the top row and, like
Trapping, reveals no sub-row; its spell-power affixes ship inside the bundle
rather than being layered through `BUNDLE_REVEALS`.

The in-results "Adjust & re-solve" panel (U3) reuses the ranked-list renderer.
Whether it inherits the Advanced control or keeps a reduced form is an
implementation decision — but the two must not silently diverge in what a player
can edit.

## Success criteria

- A player who wants a straightforward solve never opens a panel and never sees
  an empty input inviting them to constrain the solve.
- A player who sets a floor can see, from the collapsed list, which row has it.
- A Warlock player reaches a sensible priority list in one click.
- The relocated explainer appears exactly once in the step.

## Assumptions

- **A1** — Min/max and "already have" are genuinely advanced: most solves want
  neither. The current flat layout implies otherwise, and that is the defect.
- **A2** — Uniformity means every row is the same shape, not that every row
  offers the same controls. R6 trades a control for alignment on presence rows.

## Open questions

- **Q1** — R5's collapsed-state indicator: a count, a dot, or an inline summary
  of the settings. Deferred to implementation; the requirement is only that a
  setting stays visible when the panel closes.

## Related

- Declared credits: `docs/plans/2026-08-08-004-feat-declared-stat-credits-plan.md`
- Twelve augment-only stats added to `CORE_STATS` on this branch — including
  `Eldritch Blast Dice`, which R11 depends on. The `rankable_affixes` gate counts
  worn items only, so augment-only stats were invisible to it; the three
  percentage variants (`Armor Class (%)`, `False Life (%)`,
  `Maximum Spell Points (%)`) were deliberately excluded, since the solver would
  score a percentage as a flat magnitude.
