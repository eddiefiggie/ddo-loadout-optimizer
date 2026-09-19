---
title: "Key a vocabulary join on the host, not on the majority"
module: pipeline
date: 2026-09-18
problem_type: design_pattern
component: cannith_tiers
severity: high
tags:
  - vocabulary-join
  - affix-naming
  - slot-qualified
  - provenance
  - exclude-until-verified
applies_when: >
  Joining a name stated by one source onto a type or spelling held by another,
  where the second source qualifies the name along an axis (slot, family, level)
  that the first source does not state.
---

## The problem

A Cannith Challenge wiki row states `+2 Enhancement Bonus`. It never states a bonus
type, so the type is joined from gear-planner. The join had two keys — the item's
own family, then a catalog-wide name lookup — and the catalog-wide one is **slot-blind**.

gear-planner does not spell that affix one way. It spells it per slot:

| spelling | records |
| --- | --- |
| `Enhancement Bonus (Weapon)` | 3,325 |
| `Enhancement Bonus (Armor)` | 1,234 |
| `Enhancement Bonus` (bare) | 2, both Offhand |

Asked for a weapon's `Enhancement Bonus`, the slot-blind key answered with the
two-record Offhand spelling — naming a stat 3,325 weapons do not use. A player
ranking the real one scores nothing from the item, and the loadout looks correct.

## The wrong fix, and why it was wrong

The first response (#784) named the affix in a hand-maintained
`SLOT_QUALIFIED_NAMES` set and refused it outright: 85 admissions withdrawn across
80 weapons and 5 Mournlode Docents. The reasoning was sound as far as it went — a
3,325-to-2 majority is a **pattern**, and this repo does not rename on a pattern
(*never infer a value*).

But refusing on a hand-written list has two defects:

- It costs real data. Eighty-five affixes the wiki states plainly went unadmitted.
- It only knows the one name somebody noticed. A census found a second affix with
  the same shape — `Life Shield (Weapon)` — that nobody had looked at.

## The fix

Key the join on the **host's own slot** and state it once:

```python
def join_type(name, slot, fam, slotq, sib, uni):
    if slot:
        hit = slotq.get((name, slot))      # 1. the host's own slot
        if hit: return (hit[0], hit[1], f"{slot} slot-qualified spelling")
    hit = sib.get((name, fam))             # 2. the item's other tiers
    if hit: return (hit[0], hit[1], f"{fam} family sibling")
    hit = uni.get(name)                    # 3. catalog-wide, slot-blind
    if hit: return (hit[0], hit[1], "catalog-wide uniform type")
    return None
```

This is not the majority rule wearing a hat. The majority rule asks *which spelling
wins overall*; this asks *which spelling do items in THIS slot use*, and accepts the
answer only when that slot's records are unanimous on both spelling and type.
`SLOT_QUALIFIED_NAMES` is retired by it rather than extended by hand.

## Two things that made it checkable rather than inferred

**The `Penalty` skip.** `Enhancement Bonus (Weapon)` carries two types on that slot —
`Enhancement` on 3,322 records and `Penalty` on 3, the cursed `-1` weapons — and
unanimity would have failed over three curses. Skipping `Penalty` is only legitimate
while every Penalty affix really is a debuff, so that is asserted, not assumed:
`assert_penalty_is_negative` checks all 39 in the catalog and refuses to pass over
zero. A dated comment saying "measured, all negative" could not notice its own
staleness; this fails the build.

**The guard states the property, not the name.** `assert_no_bare_slot_qualified`
asserts that *no entry emits a bare name onto a host whose slot has a qualified
spelling* — so the next slot-qualified affix upstream is caught by the build rather
than by a player reading a loadout that scores nothing.

## What corroborated it

The anti-double-count guard, which skips an affix a record already carries natively,
went from 4 skips to 20. The extra 16 are `Enhancement Bonus (Weapon)` on the 16
level-4 weapons — **gear-planner independently spells it exactly as the join derived
it, on those very items**. The join agrees with the catalog wherever the catalog speaks.

The override census split the same way: `item` +5 (the Armor docents, restored as
`(Armor)`) and `weapon` +64, predicted by two different populations. Had the join
merely pattern-matched the 3,325-to-2 majority, the five armour entries would have
come back spelled `(Weapon)` and that split would not exist.

## Rule

When one source states a name and another qualifies it, join on the **most specific
axis the host actually has** — and when the specific key cannot decide, refuse and
say so. Do not pin the exception you happened to notice; a hand-maintained refusal
list is a census frozen at the moment someone last looked.
