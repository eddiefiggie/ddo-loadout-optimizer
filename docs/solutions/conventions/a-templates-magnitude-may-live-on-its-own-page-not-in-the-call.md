---
title: "An enchantment's magnitude may live on its own page, not in the item's call — a structural read gets a name and no number"
module: data-pipeline
date: 2026-08-30
problem_type: convention
component: tooling
severity: high
related_components:
  - solver
  - build-pipeline
  - vocabulary
applies_when:
  - "An affix arrives as a presence flag (`Bool | 1`) but its name reads like a magnitude effect"
  - "An affix carries a bonus type that is really the effect's own name"
  - "Deciding whether a Bool affix is a genuine on/off effect or an unread number"
  - "Harvesting a value for an enchantment the item merely links rather than spells out"
tags:
  - ddo
  - wiki-harvest
  - gear-planner
  - structural-read
  - presence-vs-magnitude
  - bool-flattening
  - data-discipline
---

# An enchantment's magnitude may live on its own page, not in the item's call

## Context

Four separate defects, found over three weeks, turned out to be one shape. Each
was investigated as a one-off; the fourth is what made the pattern visible.

| Issue | Enchantment | What the item's page renders | What shipped | Records |
|---|---|---|---|---:|
| #613 | `{{Sneak Attack Bonus\|3}}` | a value, no bonus type | a phantom TYPE named `Sneak Attack` | 20 |
| #619 | `{{Power Store}}` | a bare name | `Magical Efficiency \| Bool \| 1` | 8 |
| #632 | `Weighty Asset`, `Holding On` | a bare name | `Bool \| 1` | 3 |
| #615 | `Curse of Foolishness` et al. | a bare name | `Bool \| 1`, on a name that is not a stat | 26 |

**gear-planner is the single source of truth for which affixes an item has, read
structurally — and that is exactly why this happens.** A structural read takes
what the item's markup provides. When the wiki states a magnitude **once, on the
enchantment's own page**, and every item merely links it, the item's markup
contains a name and nothing else. There is no number to read, so none is emitted.

That is not an upstream bug. The wiki is not repeating "+100 Enhancement bonus to
unconsciousness range" on all three carriers; it says it once on `Weighty Asset`
and links it. A human reading the item follows the link. A scraper does not.

## The three symptoms, and what decides which one you get

They differ only by what the template does with the parameters it did not receive.

1. **Magnitude erased → presence.** `{{Power Store}}` takes no parameters at all;
   its "-10% spell point cost" is written into the template body. The affix
   arrives `Bool | 1`. Now unrankable: `NON_RANKABLE_TYPES` and the picker both
   exclude presence, so the effect is not wrong, it is *absent*. Hardest to
   notice, because nothing displays a wrong number.

2. **Phantom type.** `Template:Sneak Attack Bonus` has a second parameter for the
   bonus type, and its documentation says an empty value defaults to Enhancement.
   Upstream instead falls back to the affix NAME, minting `Sneak Attack` as a
   bonus type the game does not have — a bucket of its own that stacks with
   everything. This is the dangerous one: an over-credit, not a gap.

3. **Wrong stat identity.** `Curse of Foolishness` is a `-1 Penalty to Wisdom`,
   but "Curse of Foolishness" is not a stat. Bucket keys are
   `stat||equivType(type)`, so even after recovering the magnitude the affix lands
   in a bucket no ranked priority reads — modelled-looking and scoring nothing.

## Guidance

**Treat a `Bool | 1` whose name reads like a magnitude as unread, not as an on/off
effect.** The question to ask is not "is this a presence effect?" but "does this
enchantment have its own wiki page, and does that page state a number?" Four times
out of four the answer was yes.

**Read the enchantment's page, not only the item's.** The item page will not have
the number — that is the whole failure. `Power Store`, `Cursed`, and `Unconscious`
each stated the value for every carrier at once, so one page resolved 8, 26 and 3
records respectively. These harvests are cheap; it is finding them that is dear.

**Recover identity before magnitude.** Where the enchantment name is not a stat
(symptom 3), typing it in place is worse than leaving it flattened: it builds a
bucket nothing reads, and if a sibling name grants the same stat the two buckets
then SUM. `Weighty Asset` (+100) beside `Undying` (+315) would have credited 415
for a game value of 315. Merge the vocabulary first, then recover the number.
`affix_name_corrections`'s `merge_into_existing` seam exists for that, and is
evidence-bound: a merge citing no page fails the build.

**Keep the engraved name.** A merge changes which bucket an affix scores in, never
what the item says it has. Stamp `via` (#205) so the card still reads
`Curse of Foolishness` while the solver scores Wisdom.

## Finding the next one before a player does

The population is enumerable. Every affix that is `Bool`-typed and whose name is
not in the curated build-around presence vocabulary is a candidate, and each
candidate is one wiki page away from a ruling. Two guards already assert a slice
of this — `tests/test_magical_efficiency.py` fails if `Magical Efficiency` is ever
presence-typed again, and `tests/test_cursed_items.py` does the same for the curse
family — but neither sweeps the remainder.

Known unadjudicated at the time of writing: `Cursed Level Drain`, `Mind Drain`,
`Power Drain`, `Metal Fatigue`, `Critical Weakening`. They sit in `PRESENCE_DENY`
so they are not offered as goals, which is a stopgap and not a ruling.

**A denied name is a placeholder for a drawback we cannot score; scoring it is the
cure.** When a curse was finally ruled, its deny entry had to go with it — a deny
entry for a name that no longer exists is a guard that can never fail.

## Related

- `bundled-template-values-live-in-the-tooltip-not-the-cell.md` — the sibling, one
  level shallower. There the number is in the tooltip behind the cell; here it is
  not on the item page at all. Both fail a reader who trusts the visible layer.
- `exclude-until-verified-data-gates.md` — why a flattened affix is quarantined
  rather than guessed at.
- #140 is the general Bool-flattened-magnitude precedent; #614 is what made
  recovering a penalty worth doing, since the solver now subtracts it.
