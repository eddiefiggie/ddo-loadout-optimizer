---
title: "Variant-restricted picks in an AGGREGATE capacity pool need Hall's condition, not one constraint per key"
date: 2026-08-26
category: design-patterns
module: solver
problem_type: design_gap
component: milp_encoding
severity: high
symptoms:
  - "The Dino insert pool bounds placements by summed open slots across equipped items, so a per-host `continue` filter (the Viktranium pattern) has nowhere to run"
  - "Adding a quarterstaff-only insert alongside an unmarked one let both fill the SAME single physical slot, each fully credited"
root_cause: encoding_gap
resolution_type: code_fix
tags: [solver, milp, capacity, dino, quarterstaff, halls-condition, bipartite]
related_components:
  - web/solver.js
  - web/model.js
  - src/dino.py
applies_when:
  - "Adding a restricted subset of picks to a pool bounded by AGGREGATE capacity rather than per-host choice variables"
  - "Copying the Viktranium/Lamordia variant-marker pattern into a channel that has no per-host loop"
  - "Any 'these options only fit some of these slots' constraint in the MILP"
---

# Variant-restricted picks in an AGGREGATE capacity pool need Hall's condition, not one constraint per key

## Problem

#282 taught the codebase a variant-marker pattern: a crafted option identical in
the base and `(quarterstaff)` pools stays one unmarked record; an option that
differs is emitted twice with `quarterstaff: true` / `false`, and the solver
offers each only to a matching host. On the Viktranium channel that is three
lines, because its encoding **loops per host** — each host gets its own choice
variables, so the filter is a `continue` inside that loop.

The Dino insert channel looks similar and is encoded completely differently. It
has ONE placement variable per insert unit for the whole solve, bounded by an
**aggregate** capacity constraint per `type||category`:

    sum(q of key) - sum(open_slots_of_key(item) * x_item) <= 0

There is no per-host loop, so there is no place to put a per-host `continue`.

## What Didn't Work

**One capacity constraint per (key, variant).** The obvious transfer: give the
quarterstaff-only placements their own key and their own constraint. Each
constraint is then individually satisfiable while the physical slot is consumed
twice — a quarterstaff host with ONE open Fang slot would take a
quarterstaff-only insert AND an unmarked one, crediting both.

This is a *supply-sharing* problem, not a labelling problem: two kinds of supply
(quarterstaff hosts, everything else) serve three kinds of demand
(quarterstaff-only, base-only, either). Separate constraints per demand cannot
see that two of them draw on the same supply.

## Solution

Encode Hall's condition for that bipartite structure — three constraint families
per key:

    all placements       <= slots on ALL hosts
    quarterstaff-only    <= slots on QUARTERSTAFF hosts
    base-only            <= slots on NON-quarterstaff hosts

With supplies `S_qs, S_base` and demands `D_true, D_false, D_any`, feasibility of
an actual assignment is exactly `D_true <= S_qs`, `D_false <= S_base`, and
`D_true + D_false + D_any <= S_qs + S_base`. The three families are that
condition verbatim, so they are **sufficient as well as necessary** — anything
satisfying them can be realised as a real placement, and the LP relaxation stays
integral.

The host's variant is read from one authority (`model.js dinoWeaponVariant`,
mirroring `lamordiaWeaponVariant`), which the dominance slot keys read too, so
which pool a host draws and how hosts compare cannot drift apart.

## Why This Works

The physical constraint is kept and the restricted ones are added *beside* it
rather than *instead of* it. Every placement, whatever its marker, is still
counted against the total number of real openings; the extra families only
prevent a restricted pick from drawing on supply it is not allowed to use.

## Prevention

- Before copying a "filter the options per host" pattern, check whether the
  target channel HAS a per-host loop. Aggregate-capacity pools and per-host
  choice pools look alike in the data and are not alike in the encoding.
- **A capacity guard needs a test where over-placement is rewarded.** The first
  version of the over-count test used two same-stat, same-bonus-type inserts;
  they collapse into one max bucket, so a second placement won the solver nothing
  and it declined to make one. The test passed against a deliberately naive
  encoding. Only distinct ranked targets make the extra placement strictly
  profitable, and only then does the test discriminate — confirmed by dropping
  the aggregate constraint and watching that one test, alone of five, go red.

## Related Issues

- #283 (this change), #282 (the per-host variant marker it adapts).
- `docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md` — the
  ritual that caught the weak capacity test.
