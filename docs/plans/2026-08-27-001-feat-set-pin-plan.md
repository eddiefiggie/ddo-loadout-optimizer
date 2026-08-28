# Set pin — force a named set into the solve (#539)

**Decision record.** Progress lives in git, not here.

## The ask

> "I want the Cruel Cut, Subtle Blade and the Double Strike/Shot and Melee/Range
> Power Set bonus augments to be in gear."

Answered correctly by a second player: you cannot force it. Ranking the stats a
set grants does not bind — the solver takes those stats from wherever they are
cheapest, which is usually a Sun/Moon augment.

## Why this is not the weighted-sum non-goal

`AGENTS.md` declines weighted-sum and Pareto modes because they trade a ranked
priority away **without asking**. A pin is the opposite: the player names the
constraint, the cost is theirs to see, and lexicographic priority still holds
underneath it. The pin is visible and chosen; a weight is invisible and inferred.

This is the same contract the slot pin already has.

## What a pin means

**The set is ACTIVE at its lowest tier.** For `Cruel Cut` that is 3 pieces; for a
2/4/6-piece gear set it is 2. Higher tiers still activate on their own if the
solver wants them — a pin is a floor, not a ceiling.

Rejected: letting the player pin a *specific* tier. It doubles the control's
surface to serve a case nobody has reported, and "I want this set" is what was
asked for. The lowest tier is the threshold at which the set exists at all.

## The encoding

Set tiers are already binaries: `N·s_active − Σ(equipped pieces) <= 0`. A pin adds
`s_active = 1` for the lowest tier, which forces `Σ pieces >= N`.

**One thing has to change to make that reachable.** Today a tier is only encoded
when it advances a ranked target:

```js
if (!best.size) continue; // this tier advances no target
```

A pinned set must be encoded regardless — otherwise pinning a set whose stats you
have not ranked would silently do nothing, which is the exact failure the issue is
about. The tier still contributes no `z` when it advances no target; it just
exists so the constraint has something to bind.

## Reachability is decided before the solve, not by it

A pin naming a set no candidate can carry is unsatisfiable. Left to the solver
that surfaces as a bare `INFEASIBLE`, which tells the player nothing about which
of their inputs caused it.

So the model classifies each pin **before** building the program:

| Verdict | Meaning | Behaviour |
|---|---|---|
| `pinned` | the set has a tier and enough reachable pieces | constrained |
| `unreachable` | fewer pieces exist in the eligible pool than the tier needs | suppressed, reported |
| `unknown` | no such set in this dataset | suppressed, reported |
| `not-owned` | a Set Augment the player has not ticked as owned | suppressed, reported |

Every suppressed pin is **reported, never erased**
(`suppress-dont-erase-user-constraints-on-transient-invalidity.md`): a set that is
unreachable under an ML 30 cap becomes reachable at 34, and a pin the player set
must survive that round trip. Reconciliation happens on a copy; persistent state
is untouched.

`not-owned` is a suppression rather than an implicit widening on purpose. Widening
would silently assume the player owns an augment they said nothing about, and the
whole point of the ownership picker is that the tool does not assume that.

## Joint infeasibility

Individually-reachable pins can still be jointly impossible — four 3-piece set
augments need twelve colour slots. `auto-legality-constraints-need-a-pin-conflict-
escape-hatch.md` is the shape: an auto-added hard constraint plus user pins needs
a way out that is not a bare infeasible.

On `INFEASIBLE` with set pins present, the solve is retried once with the set pins
dropped. If that succeeds, the pins are named as the cause. If it still fails, the
infeasibility was already there and the pins are not blamed for it. One extra solve,
on the failure path only.

Deliberately NOT done: computing the minimal conflicting subset. It costs a solve
per pin and the player already knows which pins they set.

## Scope boundaries

- No tier selection (above).
- No "at most this set" / exclusion — that is the blocklist's job, at item level.
- The pin does not widen ownership, and does not imply a slot pin.
- Alternatives and the concession probe inherit the pins as constraints; they are
  not re-litigated per generator.

## Deferred, filed before this merges

- Surfacing what a pin COST, priced the way the concession probe prices a
  priority — a player who pins four sets should be able to see what it cost them.
  Filed as #554, and **shipped**: the notice carries a "What did these sets cost?"
  control that re-solves without the pins on request and reports every ranked stat
  that moved. Measured on shipped data, the two answers it separates are stark —
  pinning `The Dread Isle's Curse` costs 80 Magical Sheltering and 2 Intelligence,
  while four pinned Set Augments on a melee query cost nothing at all.

## The perf posture, decided from a measurement

Pinning is slow, and the cost is opt-in. Measured against the shipped catalog at
ML 34:

| Query | Solve |
|---|---|
| no pins | 6.5 s |
| one pinned GEAR set | 6.5 s |
| four pinned SET AUGMENTS | ~41 s |

Unpinned solves are byte-identical — all 24 golden fixtures unchanged — so a
player who pins nothing pays nothing.

The cost is inherent to the encoding: each pinned Set Augment mints a placement
binary per compatible host, and the pin then forces three of them on. Diagnosed
rather than guessed — one tie-break minimize call was 46.5 s of a 62 s solve,
because minimizing over pinned copies asks which of ~500 hosts should carry them,
a question with no meaningful answer when the set is delivered either way.
Excluding the copies of a pinned set that grants nothing ranked took it to ~41 s.

**Two other attempts were measured and did NOT help, recorded so they are not
retried blindly:** a symmetry cap on copies beyond the threshold (no change), and
widening the tie-break exclusion to pinned sets that DO advance a target (45 s,
worse — there the minimization is still doing useful work).

Shipped with the cost **disclosed before the player pays it**: the control warns
from two pinned Set Augments upward, naming the count and saying the solve has not
stalled. The warning is keyed on augment sets specifically, because a pinned gear
set is free and warning about it would be crying wolf.
