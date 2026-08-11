# Damage Reduction stacking — the standing ruling

**Source:** `https://ddowiki.com/page/Damage_Reduction` (harvested 2026-08-10, same-origin)
**Settles:** #223. Read this before re-investigating how `DR` should be modelled.

## The rule

DR does **not** stack. The wiki states it twice, in two sections:

> Multiple DR entries may be listed on your sheet; only the highest one which is not bypassed
> by a particular attack's properties (like Adamantine) applies.

> These passive DR sources do not stack with each other; only the highest DR not overcome by
> an attack is taken into account.

The optimizer currently **sums** DR across bypass qualifiers, reproduced at 45 against real
HiGHS where no configuration produces 45.

## The part that makes a simple `max` wrong too

The rule is not "the highest DR." It is "the highest DR **that the attack does not bypass**."
A qualifier is the condition under which the number is worth zero:

- `DR 15/-` — nothing bypasses it. Unconditionally worth 15.
- `DR 15/Adamantine` — worth 15, except against adamantine, where it is worth **0**.
- `DR 10/Good` — worth 10, except against a good-aligned attacker.

So DR is not a scalar. It is a function of the incoming attack, and two DR values with
different qualifiers are not comparable by magnitude. Collapsing the ten qualifiers into one
bucket and taking the max would replace an over-count with a different over-claim: it would
report `DR 15/Epic` as a flat 15 to a player fighting the epic raid bosses that bypass it.

Worked example from the wiki, which is precisely the non-comparability:

> Example 1 - A character with an equipped Invulnerability item (DR 5/Magic) also has the
> temporary Ironskin Chant song (DR 6/-) from a Bard. They are hit by a Mephit, creatures
> which bypass DR Magic. However, since they have DR6/- from Ironskin Chant, the attack
> damage will still be reduced by 6.

The larger DR was the one that applied only because the smaller one was bypassed.

## Which qualifiers bypass what

- **Damage types** (Bludgeoning, Piercing, Slashing) — monsters generally deal one physical
  type, which bypasses the matching DR. Commonly bypassed.
- **Alignments** (Good, Evil, Lawful, Chaotic) — bypassed by the *opposite* alignment. "Most
  Devils have DR Good, and so will bypass DR Evil."
- **Epic** — "Epic raid bosses will bypass DR Epic with their attacks."
- **Materials** (Adamantine and the rest) — "There are currently no known monsters that can
  bypass material type DR." Effectively unconditional in practice, though not by rule.
- **`-`** — nothing bypasses it, by definition.

## Two exceptions, both out of scope for a gear optimizer

- **Warforged Adamantine DR stacks.** "The Warforged Feats and Enhancements that improve DR
  are special cases... They stack with your single strongest other source of Adamantine DR."
  Racial and enhancement sources, not gear.
- **Active (blocking) DR stacks with passive DR.** "Active DR stacks with any Passive DR
  (from the single, highest applicable source)." Not an item property.

Neither licenses summing gear DR.

## Caveat, recorded rather than hidden

The page carries a staleness banner: *"The information on this page might be inaccurate due to
Update 32... Reason: Cannith Crafting and re-introduction of DR breakers and neg levels."* The
banner names Cannith Crafting and DR breakers, not the stacking rule, and the
does-not-stack rule is stated independently in two sections and matches the 3.5 lineage the
page describes. Treated as reliable for the stacking question; a claim about *Cannith-crafted*
DR specifically would need its own check.

Also noted: the wiki lists material types this dataset does not carry (Byeshk, Cold Iron,
Crystal, Mithral, Silver) and a `Magic` qualifier absent from our ten. Not a defect — just
coverage that does not arise from the current roster.

## What this does not decide

The modelling choice is a product decision, not a wiki fact. The wiki rules out summing and
rules out a naive single-bucket max. It does not choose between ranking only unconditional
`DR/-`, de-ranking DR as a magnitude, or ranking per-qualifier with disclosure. That belongs
in #223.
