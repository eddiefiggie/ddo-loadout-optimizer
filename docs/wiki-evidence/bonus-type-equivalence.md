# Bonus-type stacking equivalence — rulings

**Established:** 2026-08-10 (issue #88)
**Governs:** `data/seed/compendium/type_stacking_equivalence.json`
**Consumed by:** `equivType()` in `web/model.js:35`, which keys every stacking bucket as `` `${stat}||${equivType(type)}` ``

gear-planner's native affix `type` **is** the stacking bucket, verbatim, except where two
native types name one in-game bonus type. This file records the evidence behind every
exception, and the checks that found nothing.

The map shipped on 2026-08-01 with two entries, both `verified: false`, and its own README
instructing that each be verified against the wiki. That verification is this pass.

---

## 1. The "X Natural" family — all three verified

Four dataset types carry `Armor Class` and nothing else: `Natural` (148 affixes),
`Primal Natural` (46), `Insight Natural` (2), `Profane Natural` (2).

The question was whether "X Natural Armor" is **(a)** an X-type bonus to AC — stacking with
plain natural armor, colliding with other X-type AC bonuses — or **(b)** a natural-armor
bonus of subtype X, colliding with plain natural armor.

**Answer: (a), stated outright.** `Natural armor bonus`:

> Most items and spells provide plain "natural armor" modifier to AC. Only the highest
> effect applies. However, there are also some stacking bonuses to natural armor with a
> different bonus type.

The same page then names each typed variant:

| Native type | Wiki evidence | Collapses to | Live? |
|---|---|---|---|
| `Insight Natural` | `Natural armor bonus` lists Knight's Loyalty PDK set as "+3 insight bonus to natural armor". `Item:Lion's Mane` carries `{{NaturalArmor 2 prefix Insightful}}`. | `Insight` | **Yes** — 165 `Insight` affixes on Armor Class share the bucket |
| `Primal Natural` | `Natural armor bonus` has a `Primal bonus` heading sourced to Rough Hide items. `Primal bonus`: "This bonus stacks with all other bonuses." | `Primal` | No — no plain `Primal` type exists in the dataset, so the collapse is inert |
| `Profane Natural` | `Natural armor bonus` lists "+2 profane bonus to natural armor" (Abishai Destroyer). `Profane bonus`: "Multiple profane bonuses ... do not stack. Only the highest profane bonus applies", and names Lunar Gems as a source — these two affixes are Lunar Gem of Natural Armor (Heroic/Legendary). | `Profane` | Latent — zero other `Profane` affixes on Armor Class today |

**`Insight Natural` was the load-bearing one.** It was already mapped, and correctly: without
it, Lion's Mane's natural armor would sum with any of 165 Insight AC bonuses instead of
taking the max. It was shipping unverified against real exposure.

**`Profane Natural` was the gap** — two of three family members mapped, the third missed. It
is added here. It changes no current solve (nothing else supplies a Profane AC bonus), and
the golden suite confirms zero drift. It prevents a wrong sum the moment such an item ships.

**Do not collapse any of these to `Natural`.** That is the reading the first quoted sentence
rules out, and it would wrongly suppress a bonus that genuinely stacks.

---

## 2. Checked and found correct — do not re-investigate

- **`Determination` is a real bonus type.** One affix, `Determined Reflex Save +2` on Epic
  Armbands of the Silenced Ones. `Item:Epic Armbands of the Silenced Ones` carries
  `{{Save Reflex 2 Determination}}` — the same `<template> <N> <Type>` shape as
  `{{Stat DEX 3 Insightful}}` and `{{Save Fort 1 Insight}}` on the same item. No concept page
  exists for it, but the item template states the type. Leave it in its own bucket.
- **`Morale` is a real bonus type this dataset does not yet produce — ruled 2026-08-28.**
  It is one of the 36 pages in the wiki's `Category:Bonus types`, and `Morale bonus`
  states the ordinary same-type rule ("Multiple morale bonuses ... do not stack. Only
  the highest morale bonus applies"). It therefore takes its **own bucket with no
  equivalence entry**, which is what `equivType()` already does with an unmapped type.
  Zero affixes carry it today, so it is deliberately absent from the coverage table
  below and from `bonus_type_dispositions.json`; the first `Morale` affix written must
  add its disposition in the same change. Full ruling: `morale-bonus-type.md` (#569).
  Note it is *already* shipped in `CREDIT_BONUS_TYPES`, on purpose — see that file §4.
- **`Insight` vs `Insightful` does not need an equivalence entry.** The built dataset carries
  **zero** affixes typed `Insightful`; gear-planner emits `Insight` only. `"Insightful Spell
  Focus Mastery"` appears solely in `affixes[].via`, the source-enchantment receipt from
  #205/#209. The distinct-bucket rule in `src/affix_parser.py` and its test at
  `tests/test_affix_parser.py:188` are **dormant against the live gear-planner path** — they
  guard a parser the shipping dataset does not flow through. Recorded because the rule reads
  as active protection and is not.
- **`Vitality` (all `False Life`), `Orb` (all `Orb Bonus`), `Festive`, `Penalty`** — all
  legitimate native types, no collapse warranted. Each names a distinct in-game bonus type,
  which is the actual collapse test: per the `Implement` entry below, *a stat appearing under
  two types is only a defect when the two name one in-game type*.

  **The justification this entry used to give was the wrong test, and was also false.** It
  read "None of their stats appear under a second type, so none can be splitting a bucket."
  Measured against the build of 2026-08-30 (#625): every one of `Penalty`'s twelve stats also
  appears under Artifact / Competence / Enhancement / Exceptional / Insight / Profane /
  Quality; so do all six of `Festive`'s, and `Vitality`'s single `False Life`. Only `Orb`
  still satisfies it. The conclusion survives — none of these collapses — but it never rested
  on that sentence, and by the `Implement` rule two bullets down, a shared stat was never
  evidence either way. Record kept rather than deleted so the check is not re-derived.

  Record counts are deliberately no longer quoted here: they drift with every upstream
  refresh, and the population is owned by `bonus_type_dispositions.json` and its guard.
- **`Legendary` (93) is a real bonus type, not a tier word.** Its stats arrived from
  gear-planner under prefixed display names (`Legendary Accuracy`, `Legendary Conditioning`,
  `Legendary Armor-Piercing`, `Legendary Spell Penetration`, `Legendary Deadly`), but the
  wiki models each as the BASE enchantment with `Legendary` as the type parameter —
  `{{Accuracy|2|Legendary}}`, tooltip "+2 Legendary bonus to attack rolls" (verified
  2026-08-13, #287). `src/legendary_fold.py` folds the five into base stat + `Legendary`
  type with the engraved name kept as the `via` receipt; the TYPE ruling here is unchanged
  (a Legendary bonus stacks with Competence/Insight/etc. and self-collapses to the
  highest). Distinguish from `Epic`, which has one
  affix and is a DR bypass (§3).
- **`Implement` (540) sharing `Universal Spell Power` with `Exceptional` is correct.**
  Implement and Exceptional are genuinely different DDO bonus types; spell power from both
  stacks. A stat appearing under two types is only a defect when the two name one in-game
  type.
- **The `None` vs `Untyped` split is a source convention, not an inconsistency.** Fourteen
  stats carry both — `Acidic`, `Flaming`, `Frost`, `Shock`, `Vampirism`, the Bane effects,
  `Efficient Metamagic - Maximize/Empower/Quicken`, `Linguistics`,
  `Arcane Casting Dexterity`, `Rage Charges`. Checked across every affix: **items carry the
  effect with no type, augments carry it as `Untyped`, with zero violations.** They land in
  different buckets and therefore sum, which is correct — a Ruby of Acid's dice and a
  weapon's own Acidic enchantment both apply, as do Efficient Metamagic and Rage Charges
  from separate sources. Do not "fix" this by collapsing the two; that would suppress real
  stacking.

---

## 3. Not a bonus type at all — see #223

Two native `type` values are not bonus types; they are other information occupying the field.
Both are the same root cause and are tracked on **#223**, not here, because no equivalence
entry can fix them.

- **DR bypass qualifiers.** Ten types (`-`, `Epic`, `Good`, `Adamantine`, `Lawful`, `Chaotic`,
  `Evil`, `Piercing`, `Slashing`, `Bludgeoning`) carry only the `DR` stat and are the DDO
  bypass material. Each becomes its own bucket, so DR sums: reproduced at 45 against real
  HiGHS where the honest number is 15.
- **`Maximum dexterity`.** One affix, on `Armor Mastery +2` (Boots of Blessed Travels). The
  wiki's `Armor Mastery` grants "a +N bonus to your armor's Max Dex Bonus", and
  `Item:Boots of Blessed Travels` carries a bare `{{Armor Mastery 2}}` with **no type
  argument** — so the value in the type field is the effect description, not a bonus type.
  Zero stacking impact (one affix, no partner), but the same defect class as DR.

---

---

## Coverage — the sweep, and why it is now guarded rather than dated

Every stacking bucket the built dataset produces was examined, not a sample. There are **40**:
39 named types plus the null type. Disposition:

| Group | Count | Outcome |
|---|---|---|
| The "X Natural" family | 3 | Verified and mapped (§1) |
| DR bypass qualifiers | 10 | Not bonus types → #223 (§3) |
| `Maximum dexterity` | 1 | Not a bonus type → #223 (§3) |
| `Determination` | 1 | Verified real (§2) |
| Null type (weapon enchantments) | 1 | Source convention, correct (§2) |
| Remaining named types | 24 | Legitimate; each names a distinct in-game bonus type |

The tell used to find §3's defects: a type carrying **exactly one stat** is a candidate for
"not a bonus type at all". Twenty-two types are single-stat, and most are legitimate
(`Armor`, `Shield`, `Natural` → Armor Class; `Implement` → Universal Spell Power), so the
test narrows the search rather than deciding it — each still needs the source read.

### Re-survey 2026-08-20 (#88): the completeness claim had gone stale

The table above said "every stacking bucket the built dataset produces was
examined". That was true when written. On **2026-08-18** the gear-planner canon
migration introduced a type the sweep had never seen, and nobody re-ran it — so
the claim quietly stopped being true, with nothing failing.

Re-surveyed against the current dataset: **30 distinct types** (down from 40 —
nine DR bypass qualifiers were fixed by #223, and `Maximum dexterity` retired
upstream). One is new:

**`Psionic` — QUARANTINED, not classified as a bonus type.**

Two augments, `Meridian Fragment` (Orange) and `Crystallized Drop of Tea`
(Yellow), store `Universal Spell Power | Psionic | 24`. Both item pages state
the same thing, verbatim:

> once every three seconds **when you take physical damage**, you get **+8
> Psionic Bonus** to Universal Spell Power. This **can stack up to three times**
> and each stack **lasts for 20 seconds**.

So 24 is `8 x 3` — the fully-stacked maximum of a buff that is **conditional**
(needs you to be hit), **ramping** (three stacks) and **temporary** (20s each).
gear-planner has no field for any of that, so it stored the maximum flat.

Credited flat, the optimizer granted +24 Universal Spell Power permanently. And
because Universal Spell Power **cross-adds** into all ten element spellpowers
(#290/#301), the over-credit did not stay local — it landed on every spellpower
a caster ranks. Six golden fixtures moved when it was removed: `Universal Spell
Power 128 -> 104`, with each element spellpower down the same 24.

**Dropped rather than re-valued**, per the never-infer rule: the wiki states no
sustained figure, so any number written here would be invented. Same disposition
`Deific Focus` received on the same shape. Shard:
`data/seed/compendium/conditional_affix_quarantine.json`; the general problem is
#214.

**The claim is now a guard.** `data/seed/compendium/bonus_type_dispositions.json`
records a disposition for every type the dataset produces, and
`tests/test_bonus_type_coverage.py` fails the build when a type appears with no
disposition. A dated completeness claim cannot notice its own staleness; this
one now does.

## Retired types

A type that leaves the dataset does not leave this document silently. Its ruling is kept
here, below this heading, so the reasoning survives while the prose above stays a
description of what actually ships. `tests/test_bonus_type_coverage.py` fails the build if a
name listed in `bonus_type_dispositions.json`'s `_retired` block is still discussed as live
above this line — which is exactly how this section came to exist.

- **`Sneak Attack` — retired 2026-08-30 by #608. It was never a bonus type.** It was the
  STAT being bonused, minted as a type because upstream falls back to the affix NAME when
  `Template:Sneak Attack Bonus` is called without its second (bonus type) parameter. All 20
  records were retyped from their own rendered tooltips (#613); the dataset now carries zero.

  Until #625 this document still listed it among the live "legitimate native types", citing
  36 records for a type that had none. That is the failure
  `docs/solutions/conventions/a-dated-coverage-claim-cannot-notice-its-own-staleness.md`
  names, in its second form: not a claim that went stale about a population, but a claim
  naming a member of that population which had since been removed. The seed had been
  updated correctly and the prose had not, because nothing checked the prose.

## Harvest record

Two paced POSTs to `/api.php` on 2026-08-10, well inside the throttle budget. Pages read:
`Natural armor bonus`, `Profane bonus`, `Primal bonus`, `Insight bonus`, `Armor Mastery`,
`Item:Lion's Mane`, `Item:Epic Armbands of the Silenced Ones`,
`Item:Boots of Blessed Travels`.

Titles that do not exist, recorded so they are not retried: `Bonus type`, `Stacking`,
`Determination`, `Item:Abishai Destroyer`. `Armor class` is a redirect to `Armor Class`.
Item pages require the `Item:` namespace prefix — without it the API reports them missing.

Every ruling above is `stated` provenance: the wiki says it outright. Nothing here is
inferred from a rendered default.
