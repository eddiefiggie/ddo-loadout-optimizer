---
title: An empty off hand under Two Weapon Fighting is the solver declining a no-value pick, not a lost constraint
module: solver
date: 2026-09-03
problem_type: design_pattern
component: model
severity: medium
related_components:
  - web/model.js
  - web/solver.js
  - web/projection.js
tags:
  - solver
  - two-weapon-fighting
  - off-hand
  - combat-style
  - bucket-semantics
  - max-not-sum
  - empty-slot
  - disclosure
  - no-code-change
  - investigated-and-correct
applies_when:
  - "A player or report says Two Weapon Fighting was declared and only one weapon was equipped"
  - "Auditing whether the TWF off-hand weapon feed reaches the solver at all"
  - "Tempted to force a second weapon into the off hand when TWF is declared"
---

## Context

Raised 2026-09-03 while investigating #689: with `style: "one-hand"` and
`twoWeaponFighting: true`, several solves placed a Main Hand weapon and left the
Off Hand empty. That looks like the declaration being ignored — the same shape as
the #689 defect sitting right beside it — so it was investigated as a suspected
bug.

**It is correct behaviour. No code change.** Recorded here so the next reader does
not re-derive it, and so nobody "fixes" it by forcing a second weapon.

## What was measured

Build `09032026.1`, through the parity harness (`tests/parity/capture_golden.js`'s
own `solveEnv`/`solveFixture`), ML 34, heavy armor, `style: "one-hand"`,
`twoWeaponFighting: true`.

**The feed reaches the solver.** Inspecting `buildModel`'s worn pools directly:

| query | Main Hand pool | Off Hand pool |
|---|---|---|
| one-hand + TWF | 47 | **47, all weapons** (shields/orbs/rune arms correctly excluded) |
| one-hand, no TWF | 47 | 77, **0 weapons** (shields/orbs/rune arms) |

So `allowedOffHandWeaponTypes` -> `offHandWeaponOk` -> the `offHandPool.concat(...)`
weapon feed in `web/model.js` all work. The candidates are there and the solver
simply does not take them.

**It fills the off hand when a second weapon actually earns the slot.** A nine-query
sweep found the boundary:

```
Melee Power                                              OH=--
Doublestrike                                             OH=--
Melee Power+Accuracy+Doublestrike+Sneak Attack           OH=--
Melee Power+Deadly+Seeker+Accuracy+Doublestrike+Strength OH=YES  Legendary Calamitous Bastard Sword
```

The last one equips **two different weapons** (Main Hand `Legendary
Ship-Chaplain's Sidearm`, Off Hand `Legendary Calamitous Bastard Sword`) — not the
same item twice, which was checked because it would have been a real defect.

## Why an empty off hand is right

Bucket keys are `stat||equivType(type)` and a bucket takes the **max, not the sum**.
A second weapon whose ranked affixes land in buckets the first weapon already fills
contributes **literally nothing** to any ranked stat. Equipping it would be pure
noise in the report — a farm instruction that buys zero.

The off hand fills exactly when the ranked set is wide enough that a second weapon
reaches a bucket nothing else does. That is the same reason a single-stat query
often takes **no weapon at all**: other slots supply the stat more efficiently.

## The player is already told

`emptySlotNoticeLines` names it, verified on the real solve rather than a fixture:

```
9 slots are empty (Goggles, Trinket, Belt, Gloves, Boots, Bracers, Quiver, Main Hand, Off Hand)
  — nothing available for them improves these priorities.
```

That sentence is exactly the explanation, and it already reaches every export
surface through the #668 roster. Nothing further is owed.

## Declaring TWF did not make any build worse

Worth checking, because `offHandItemsExcluded` **removes shields, orbs and rune arms
from candidacy** when TWF is declared — so in principle a player could give up a
contributing shield and get an empty slot in exchange.

Measured across nine priority sets, comparing `twoWeaponFighting: true` against
`false` with everything else identical: **no ranked stat regressed in any of them.**
In the one case where the off hand was worth filling at all, TWF-off chose a
`Legendary Cataclysmic Buckler` and TWF-on chose the Bastard Sword, with every
`perTarget` value equal or better. Whenever the shield mattered, a weapon at least
as good existed.

## Guidance

- **Do not force a second weapon into the off hand when TWF is declared.** It would
  prescribe gear that adds nothing, and the "why" would be unanswerable on the
  results page.
- A report of "I asked for two weapon fighting and only got one weapon" is
  **not** this. Check #689 first: a missing combat style used to mean
  *unconstrained*, which produced a genuinely wrong loadout (a tower shield). This
  note covers the case where the style IS `one-hand` and the off hand is simply
  empty.
- `twfDeclaredButInert` (#508) covers a third, different case: the declaration made
  while the STYLE cannot honour it. It does not fire here, correctly — the style
  does honour it, and the feed did run.
