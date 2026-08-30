# Essence Crafting bonus types — the harvest that partly broke the blocker

**Established:** 2026-08-29 (issue #193)
**Shard:** `data/seed/compendium/essence_bonus_type.json`
**Supersedes, in part:** `essence-crafting.md` — which said no reachable source
records a crafted effect's bonus type.

---

## What changed

The 2026-08-27 ruling closed #193 on the finding that **nothing records the bonus
type** of a crafted effect. That finding was too strong, and the reason it was
wrong is the useful part.

The earlier sampling looked for a bonus-type word **near** the Essence Crafting
mention on an effect's page. But several effect pages do not write the type near
the source — they **group their sources under `=== <Type> bonus ===` section
headings**, so the type sits in the heading *above* the crafting line. A
proximity search cannot see it. `Doublestrike` is the clean case:

```
=== Sources of Doublestrike ===
==== Enhancement bonus ====
* [[Cannith_Crafting/table_1b|Cannith Crafting (shard costs: ...)]]
```

Nothing on that line names a type. The heading does.

A **section-aware** read of all 157 craftable effect pages found **22 stated
types**, where the earlier hand-sample of four found none it could use.

**The other half of the original ruling holds.** The main `Essence Crafting` page
is 44 KB and states zero bonus types; the four crafting tables state zero; and
gear-planner still ships no Essence Crafting pool. The type is recorded on the
*effect* pages, unevenly, or nowhere.

## Coverage

**22 of 157** craftable effects carry a wiki-stated bonus type.

| Provenance | Count | Solver-eligible |
|---|---:|---|
| `stated` | 22 | **yes** |
| `unsourced` | 76 | no |
| no readable page | 59 | no — still work to do |

The 76 `unsourced` split into 20 that name Essence Crafting without typing it and
56 whose page was read in full and never mentions the system. Both are recorded
so a later sweep can tell *"harvested, the wiki is silent"* from *"not yet
harvested"* — the distinction the provenance model exists for.

The 59 with no readable page are 52 `missing` (mostly `Insightful X`, which the
wiki documents on the base effect's page rather than separately) and 11 that
resolve to a disambiguation page. They are **absent** from the shard rather than
recorded as silent, so coverage keeps counting them.

### What is typed

| Effect | Type | Join |
|---|---|---|
| Strength, Dexterity, Constitution, Intelligence, Wisdom, Charisma | Enhancement | same-line |
| Insightful <each of those six> | Insight | same-line |
| Haggle | Competence | same-line |
| Insightful Haggle, Insightful Accuracy, Insightful Spell Resistance | Insight | same-line |
| Spell Resistance, Repair Amplification | Enhancement | same-line |
| Doublestrike | Enhancement | section-heading |
| Healing Amplification | Competence | section-heading |
| Seeker | Enhancement | named-variant |
| Natural Armor | Natural | page-subject |

`join` records **how** the type was tied to the crafted entry, and it is the
reviewable part. `same-line` is strongest. `page-subject` and `named-variant` are
each used exactly once and are the two a sceptic should re-read first.

## The rule this harvest turns on

**No effect is typed by its own name.** 38 of the 157 roster entries are
`Insightful X`, and calling them all Insight would have typed a quarter of the
system for free. That is inferring 38 game values.

`Insightful Seeker` is why it is forbidden. The `Seeker` page says:

> Regular Seeker grants Enhancement bonus, then there's Insightful Seeker and
> much rarer Quality Seeker. The former Exceptional Seeker grants Insight bonus.

That sentence types **Seeker** outright, names **Insightful Seeker**, and then
assigns Insight to a *different, former* variant — `Exceptional Seeker`. Read
quickly it looks like it types Insightful Seeker. It does not. So `Seeker` is
`stated` and `Insightful Seeker` is `unsourced`, on the same page, from the same
sentence. `test_no_effect_is_typed_by_its_own_name` pins both.

The six `Insightful <ability>` records are `stated` **not** because of their
names but because each ability's own page carries the line:

> [[Essence Crafting]] items may come with a +1 - +7 Insight bonus.

## Corroboration (not used as a source)

Two independent signals agree with the ability results. Neither is treated as
evidence for an effect the wiki does not state, because both are patterns rather
than statements:

1. **The wiki redirects** `Insightful Strength`, `Insightful Constitution`,
   `Insightful Dexterity`, `Insightful Intelligence`, `Insightful Wisdom` and
   `Insightful Charisma` to `Insight bonus`.
2. **The magnitudes fit the stated halving rule.** The `Insight bonus` page says
   an Insight enchantment is generally worth half its Enhancement equivalent,
   rounding down. The already-harvested ML curves match exactly: abilities 15/7,
   Accuracy 23/11, Haggle 20/10.

The second is a genuine cross-check between two independently harvested shards,
and it is why the ability numbers can be trusted rather than merely accepted.

## What this does and does not unblock

**Does:** a partial capability. All six ability scores are typed in both
Enhancement (Prefix and Suffix menus) and Insight (Extra menu), which is the
shape that matters most on a trinket. For the **Gem of Many Facets** — three
Essence Crafting menus on one Trinket — the typed coverage is:

| Menu | Typed | Total |
|---|---:|---:|
| Trinket Prefix | 10 | 63 |
| Trinket Suffix | 9 | 54 |
| Trinket Extra | 9 | 53 |

**Does not:** the system as a whole. 135 of 157 effects still have no sourced
type and must stay out of the solver. A wired capability has to disclose that
it is offering a typed subset, not the menu the game offers.

**Still would supersede all of this:** an in-game tooltip dump, or gear-planner
shipping Essence Crafting pools with typed affixes.

## What the types settle about value

`essence-crafting.md` measured magnitude at ML 34 and found crafted effects tie
or lose against named best-in-slot, never exceeding by more than +2. It then said
outright that magnitude is only half the answer:

> Whether a crafted effect **adds** to named gear (a different bonus type) or
> **competes** with it (the same bucket) is decided by the bonus type — the exact
> dimension nothing records.

For the 22 typed effects, that dimension now exists, and the answer is
**competes**. Using only the magnitudes stated in the same sentences that state
the types, against the best named value at ML <= 34 in the same bucket:

| Crafted effect | Type | Crafted | Best named, same bucket | Result |
|---|---|---:|---:|---|
| every ability score | Enhancement | +15 | 15 | exact tie |
| Insightful <ability> | Insight | +7 | 7 | exact tie |
| Insightful Accuracy | Insight | 11 | 11 | exact tie |
| Seeker | Enhancement | +15 | 15 | exact tie |
| Haggle | Competence | +20 | 21 | loses by 1 |
| Doublestrike | Enhancement | 17 | 16 | beats by +1 |
| Insightful Haggle | Insight | +10 | none | **adds** |
| Natural Armor | Natural | +15 | none | **adds** |

The ties are exact, in the same bucket, which means crafting **substitutes for**
named gear rather than stacking with it. That confirms the value rationale the
nine deferrals rested on rather than overturning it: crafting is a way to
**reach** named best-in-slot on a slot you could not otherwise fill.

Two entries genuinely add, because no named item occupies their bucket at all,
and `Doublestrike` beats its bucket by +1. Those three are the whole upside found
so far, and none is large.

## The second join, which is NOT solved

There is a second name-mapping problem behind the first, and it is easy to walk
into. **The ML curve table uses its own vocabulary, not the effect names.** Its
75 rows are keyed by value FAMILY — `Ability` and `Ins. Ability` cover all twelve
ability entries, and others read `Ins. Accuracy`, `Combat mastery`,
`Armor-piercing`. Only **22 of the 157 effect names match a curve row literally**;
135 do not.

So `curves[effect_name]` silently returns the wrong row or nothing. Drafting the
table above, `Insightful Accuracy` was first joined to the `Accuracy` row and
read 23 — the BASE competence magnitude, not the Insight one. The correct row is
`Ins. Accuracy`, and the correct value is 11, which ties rather than beating by
+12. The table above therefore uses the ranges stated in the type sentences
themselves, never a curve lookup by effect name.

Anyone wiring this must solve the effect-name -> curve-row join deliberately. It
is a separate piece of work from the type harvest, and it is the same hazard the
earlier value measurement hit from the other side, where 73 of 157 effects had no
confident mapping onto CATALOG names.

## Reproducing

```
python3 scripts/merge_harvest.py --field essence_bonus_type --missing-only --slot Trinkets
python3 scripts/merge_harvest.py --field essence_bonus_type --coverage
```

The roster is the whole 157-effect system by default; `--slot` scopes a work
order without moving the denominator. Browser loop and its traps:
`harvest-method.md`. The section-aware extractor is the part worth keeping — a
line-proximity extractor re-derives the original wrong answer.

## Related

- `essence-crafting.md` — the placement and ML-curve harvest, and the ML 34
  value measurement (crafted never beats named best-in-slot by more than +2).
- `tests/test_essence_bonus_type_shard.py` — the guards on every claim above.
- `docs/solutions/conventions/exclude-until-verified-data-gates.md` — the rule
  the 135 unsourced effects rest on.
