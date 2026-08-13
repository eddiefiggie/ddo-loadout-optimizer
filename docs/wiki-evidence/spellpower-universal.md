# Universal spellpower — Potency expands; Universal Spell Power does not

**Established:** 2026-08-13 (#290, U3 of the 2026-08-13 user-report batch)
**Harvest:** Claude-in-Chrome, same-origin reads of ddowiki (rendered text + raw templates)

A player ranking `Nullification`/`Void Lore` expected the Solar Gems of
Spellpower/Spell Critical Chance to be recommended and they never were. The
spellpower half is this ruling; the lore half stays open on #290 (see the
quarantine note at the bottom).

## 1. Potency is an all-spells spellpower — expand it

`https://ddowiki.com/page/Spell_power`, section **Affected damage types**, table
(verbatim rows, Continuous-effect column → Affects):

> Combustion → Fire Spells; Corrosion → Acid Spells; Devotion → Positive
> (Healing) Spells; Glaciation → Cold Spells; Impulse → Force, Physical
> (Piercing, Slashing, Bludgeoning), and Untyped Spells; Magnetism → Electric
> Spells; Nullification → Negative Energy Spells and Poison Spells; **Potency →
> All Spells** (tends to be a smaller value at similar levels); Radiance → Light
> and Alignment (Chaotic, Evil, Good, Lawful) Spells; Reconstruction → Repair
> Spells and Rust Spells; Resonance → Sonic Spells

`https://ddowiki.com/page/Potency` (enchantment page):

> Passive: +N [[Equipment bonus]] to [[Spell Power]].

## 2. Potency competes in the same bonus-type bucket as the element names

`https://ddowiki.com/page/Equipment_bonus` names Potency and an element
spellpower as the same kind of bonus and states the rule outright:

> Some magic items grant an equipment bonus to Spell Power … e.g. +2
> [[Combustion]] Scepter or +6 [[Potency]] Kama. … **Multiple sources of
> equipment bonus do not stack, only the highest bonus applies.**

`Spell_power`, section **Standard magic items**, confirms the same shape per
type: "Equipment bonus from items with enchantments like Potency or Combustion.
The item enchantment name corresponds to the type of spells the spell power
applies to. … the highest possible single-type Equipment bonus is +146, the
highest all-type Potency bonus is +100" — with Insight ("all-type Insight
Potency bonus") and Quality ("all-type Quality Potency bonus") variants listed
the same way.

**Consequence:** expanding a `Potency` affix into the ten element spellpower
stats at the SAME bonus type reproduces both rules through the existing
per-(stat, stacking-type) max bucket — a Potency Equipment 100 beside a
Nullification Equipment 114 collapses to 114 for negative spells (highest of
the type), while an Insight Potency stacks with an Equipment Nullification
(different types add). Identical mechanics to the #205 spell-DC expansion; if
the expansion ever seems to need a bucketing change, the expansion is wrong.

The ten expansion targets, in the table's order, all present in the dataset:
`Combustion, Corrosion, Devotion, Glaciation, Impulse, Magnetism,
Nullification, Radiance, Reconstruction, Resonance`.

## 3. Universal Spell Power is a DIFFERENT mechanic — do NOT expand it

`Spell_power`, section **Universal Spell Power** (verbatim):

> **Fully stacking. It flat adds to all of your other Spell Powers**; in the
> summary screen popup … the Spell Powers you see for specific elements are the
> final value after your Universal Spell Power has been added to all of your
> other enhancements to that power type.

Expanding `Universal Spell Power` into the elements at its own bonus type would
put it in max-competition with same-type element sources — but the wiki says it
ADDS to them unconditionally. The stat stays its own bucket (Implement 540,
Exceptional 50 affixes in the dataset), which credits a player who ranks it
directly; crediting element priorities from USP sources needs a cross-add
mechanism the solver does not have. Deliberately out of scope for #290-U3 —
filed as #291, not silently folded into this expansion.

The temporary Alchemical column of the table (Inferno/Erosion/…/Efficacy) names
weapon-imbue effects, not worn-gear enchantments; no dataset stat carries those
names, so they are recorded here and not expanded.

## 4. The Spell Lore half of #290 stays open — quarantined

The analogous lore question is NOT symmetric and must not be closed by copying
this expansion: `docs/wiki-evidence/spell-lore.md` rules that universal and
element-specific lore are **different stats that both apply** ("The universal
Spell Lore … is 10% lower than the corresponding … single damage type"), so a
same-type expansion of `Spell Lore` would collapse two legitimately stacking
sources. Crediting an element-lore priority from universal-lore buckets without
merging them is a solver-model design question, and the precise
solar-vs-artifact stacking claim remains **QUARANTINED** in `spell-lore.md`
§U5. #290 stays open for that half.
