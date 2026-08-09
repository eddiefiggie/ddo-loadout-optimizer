---
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
title: Bundle Scope Correction and Wildcard Set Attribution - Plan
date: 2026-08-09
---

# Bundle Scope Correction and Wildcard Set Attribution - Plan

## Goal Capsule

**Objective.** Two independent corrections to the Priorities and Results surfaces.
First, pull the affix bundles back to what was actually asked for: PR #185 padded
the Warlock package, batched the ability scores, and hid three bundle rows that
had always been on screen. Second, make a wildcard set piece — the Gem of Many
Facets and its family — visible as a set contributor everywhere the app already
attributes sets, because the solver counts it and no display does.

**Product authority.** This document. Group A supersedes R8–R12 of
`docs/plans/2026-08-09-001-feat-priorities-ui-cleanup-plan.md` where they conflict.

**Open blockers.** None.

---

## Product Contract

### Problem

**Group A — the bundles overshot.** Three separate overreaches shipped in #185:

- **Warlock carries fourteen affixes** when the request was the warlock mechanics
  themselves. Only two warlock-mechanic stats are rankable in the catalog —
  `Power in Pact` and `Eldritch Blast Dice`. The other twelve are generic caster
  stats (Charisma, Spell Focus Mastery, Potency…) plus three elemental damage
  families. The original brief asked to "find others"; the honest answer was that
  there are none, and the bundle was padded instead of reporting that.
- **Ability scores ship as one batch button.** Clicking `Attributes` adds all six.
  The intent was a typing shortcut for a stat a player always wants — not a way to
  rank all six at once, which almost nobody wants.
- **Three bundle rows disappeared.** Tactics, Spell power, and Spell schools were
  visible at all times for the life of the feature, because
  `.wz-bundle-row { display: flex }` overrode the `hidden` attribute. #185 made the
  intended progressive disclosure work for the first time, which removed three rows
  of buttons the player had been using.

**Group B — a wildcard set piece is invisible as a set contributor.** The solver is
correct: a chosen-membership pick self-seeds the set threshold
(`web/solver.js:362`), so a Gem of Many Facets genuinely completes a set. Every
display disagrees, because all three attribution paths read only an item's
**static** `set_bonus` field:

| Surface | Reader | Result |
|---|---|---|
| Set frame / glow | `slotSetNames` reads `v.set_bonus` (`web/projection.js:207`) | Gem has no static set, so no `.is-set` frame |
| Ranked Priorities source | `activeSetDetail` builds `yields` from `c.variant.set_bonus` (`web/projection.js:216-221`) | The gem's slot never enters the source list — the player sees "the ring" alone |
| Set Bonuses tab | `satisfiedSetDetail` builds `members` from `c.variant.set_bonus` (`web/projection.js:243-247`) | A gem-completed set falls through to the fallback with `members: []`, so the card shows a tier number and names nothing |

The runtime picks already exist — `membershipPlaced` entries are `{host, set, station}`
and `jokerPlaced` entries carry a host and set; `buildCraftMaps`
(`web/projection.js:271-290`) already groups both by host. Nothing needs
re-deriving. Three readers ask the wrong field.

This is the same failure shape as the declared-credit disclosures: the math is
right and the claim about the math is wrong.

### Goals

- Bundles that match what was asked: a warlock shortcut, an ability-score shortcut,
  and the rows that were always there.
- A wildcard set piece reads as part of its set, in the same visual language as any
  other piece, wherever sets are attributed.
- A set bonus always names the pieces producing it, each tied to its slot.

### Non-goals

- No change to solver behavior. The solve already counts wildcard pieces correctly;
  this is attribution only.
- No change to which stats are rankable, and no re-harvest of set definitions.
- No new set mechanics. Group B surfaces existing picks, it does not add any.

### Requirements

#### Group A — bundle scope

| ID | Requirement |
|----|-------------|
| R1 | *(session-settled: user-directed — chosen over the fourteen-affix bundle shipped in #185.)* The `Warlock` bundle contains exactly `Power in Pact` and `Eldritch Blast Dice`. It stays on the top packages row beside Trapping. |
| R2 | *(session-settled: user-directed — chosen over a single batch button that adds all six.)* The six ability scores are offered as six individual buttons, each adding only itself: Strength, Dexterity, Constitution, Intelligence, Wisdom, Charisma. The batch `Attributes` bundle is removed. |
| R3 | *(session-settled: user-directed — chosen over the progressive disclosure the code intends.)* Every bundle row is visible at all times. Tactics, Spell power, and Spell schools no longer wait on a package click. |
| R4 | `Basic` and `Ranged` keep the order established in #185, with membership unchanged. Nothing in this change touches their contents. |
| R5 | The code comment describing Melee-reveals-Tactics and Caster-reveals-schools is rewritten to record that flat visibility is the deliberate choice, so the disclosure is not "restored" by a later reader. |

#### Group B — wildcard set attribution

| ID | Requirement |
|----|-------------|
| R6 | One shared resolver answers "which sets is this equipped item contributing to?" from three inputs together: the item's static `set_bonus`, the runtime membership picks, and the runtime wildcard/joker picks. Every attribution surface reads it; none re-derives the answer. |
| R7 | A wildcard piece contributing to a completed set receives the same set-colored frame as any other contributing piece, and names the set it is feeding. |
| R8 | *(session-settled: user-approved — chosen over identical treatment.)* The existing `Wildcard set: X` chip is retained alongside the frame. A wildcard slot and an intrinsic member are both set contributors, but they are not interchangeable, and the display should not imply they are. |
| R9 | Ranked Priorities lists the wildcard piece among the sources of a set bonus, alongside the intrinsic pieces. |
| R10 | The Set Bonuses tab names every contributing piece for each active set, and associates each piece with the slot it occupies. A set never presents a bare count with no members. |
| R11 | The same attribution reaches every share export. A shared build must not omit a piece the solve counted. |
| R12 | The fix covers the whole wildcard family, not one item: chosen-membership hosts (Vecna Lost Purpose, Cannith Repurposing Station, Dino Set-Bonus) and wildcard/joker hosts (the Gem of Many Facets family) are attributed by the same resolver. |

### Key decisions

- **Warlock stays on the packages row despite being a two-affix shortcut**
  *(session-settled: user-directed)*. It is a different shape from the role
  archetypes beside it — `Basic` carries twelve — but that is where it was asked
  for. If the row later reads as mixed, the ability-score row is the natural home
  for shortcuts.
- **Flat bundle visibility overrides the code's stated design.** The progressive
  disclosure never functioned, the flat layout is what has been in use, and it is
  the chosen behavior. R5 exists so this reads as a decision rather than a
  regression.
- **Keep the CSS rule, drop the markers.** `.wz-bundle-row[hidden]` is correct CSS
  hygiene and stays; these rows simply stop being marked hidden. A row marked
  hidden in future will then actually hide.
- **Attribution is a read-side fix.** Group B adds no solver concept. The
  temptation to give the gem a synthetic static `set_bonus` is rejected: that would
  put a runtime decision into item data and make the catalog lie.

### Scope boundaries

Group A and Group B are independent and touch different files. They are batched
because they are one round of feedback, not because either depends on the other.

The tab's "N pieces" label is the **tier threshold**, not a count of equipped
items. R10 adds the member list; it does not redefine that number.

### Success criteria

- Clicking `Warlock` adds two priorities. Clicking `Constitution` adds one.
- All bundle rows are on screen before any package is clicked.
- With a Gem of Many Facets completing a set, the gem's slot carries the set frame,
  Ranked Priorities names it among that set's sources, and the Set Bonuses tab lists
  every contributing piece with its slot.
- A shared export of that build names the same pieces the app does.

### Assumptions

| ID | Assumption |
|----|-----------|
| A1 | The solver's wildcard accounting is correct and needs no change; only the readers are wrong. Grounded in `web/solver.js:362` and the existing `membershipPlaced` / `jokerPlaced` outputs, but worth re-confirming during planning before building on it. |
| A2 | `membershipPlaced` and `jokerPlaced` identify their host precisely enough to map a pick to an equipped slot. `buildCraftMaps` already groups both by host, which suggests yes. |

### Outstanding questions

- **Q1** — When a wildcard piece contributes to a set the player could have completed
  without it, should the display distinguish "load-bearing" from "redundant"? Out of
  scope here; noted because the frame alone will not answer it.
