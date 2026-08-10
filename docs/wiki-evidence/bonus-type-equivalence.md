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
- **`Insight` vs `Insightful` does not need an equivalence entry.** The built dataset carries
  **zero** affixes typed `Insightful`; gear-planner emits `Insight` only. `"Insightful Spell
  Focus Mastery"` appears solely in `affixes[].via`, the source-enchantment receipt from
  #205/#209. The distinct-bucket rule in `src/affix_parser.py` and its test at
  `tests/test_affix_parser.py:188` are **dormant against the live gear-planner path** — they
  guard a parser the shipping dataset does not flow through. Recorded because the rule reads
  as active protection and is not.
- **`Vitality` (149, all `False Life`), `Orb` (110, all `Orb Bonus`), `Festive` (6),
  `Penalty` (33), `Sneak Attack` (36, all `Sneak Attack Bonus`)** — all legitimate native
  types, no collapse warranted. None of their stats appear under a second type, so none can
  be splitting a bucket.
- **`Legendary` (93) is a real bonus type, not a tier word.** Its stats are the endgame
  enchantments `Legendary Accuracy`, `Legendary Conditioning`, `Legendary Armor-Piercing`,
  `Legendary Spell Penetration`, `Legendary Deadly`. Distinguish from `Epic`, which has one
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

## Coverage — the sweep is complete

Every stacking bucket the built dataset produces was examined, not a sample. There are **40**:
39 named types plus the null type. Disposition:

| Group | Count | Outcome |
|---|---|---|
| The "X Natural" family | 3 | Verified and mapped (§1) |
| DR bypass qualifiers | 10 | Not bonus types → #223 (§3) |
| `Maximum dexterity` | 1 | Not a bonus type → #223 (§3) |
| `Determination` | 1 | Verified real (§2) |
| Null type (weapon enchantments) | 1 | Source convention, correct (§2) |
| Remaining named types | 24 | Legitimate; no stat splits a bucket across two names |

The tell used to find §3's defects: a type carrying **exactly one stat** is a candidate for
"not a bonus type at all". Twenty-two types are single-stat, and most are legitimate
(`Armor`, `Shield`, `Natural` → Armor Class; `Implement` → Universal Spell Power), so the
test narrows the search rather than deciding it — each still needs the source read.

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
