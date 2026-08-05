# Wiki evidence — boolean composites carrying hidden magnitude (U4)

**Verified:** 2026-08-05 (Chrome-MCP, interactive session)
**Plan:** `docs/plans/2026-08-05-001-fix-affix-vocabulary-hygiene-plan.md` (U4, feeding U5)
**Reports:** #140 (composite affixes not considered)

## Why this file exists

Four affixes are stored in the dataset as `Bool` — presence with no magnitude — even though the game grants a concrete number. The optimizer therefore knows an item *has* the effect but cannot weigh it against anything. U5 writes the verified components onto the carrying item's record, **additively** (the boolean stays, so the effect remains targetable as presence).

Per KTD5, a component whose bonus type the wiki does not state is **excluded**, not written untyped: an untyped component would land in its own bucket and stack on top of a same-stat affix already on the item, turning an under-counting bug into an over-counting one.

**Outcome: 3 of 4 confirmed, 1 quarantined.**

| Composite | Records | Verdict |
|---|---|---|
| Blurry | 71 | CONFIRMED — 1 component |
| Lesser Displacement | 69 | CONFIRMED — 1 component |
| Crown of Summer | 7 | CONFIRMED — 3 components |
| Greater Heroism | 16 | **QUARANTINED** — magnitude not stated for the item enchantment |

---

## 1. Blurry — CONFIRMED

**Source:** https://ddowiki.com/page/Blurry · https://ddowiki.com/page/Concealment

> Effect: Items with this property make the wearer's outline become blurred. Enemies have a 20% Concealment miss chance.

The item-effect page states the magnitude but not the bonus type. The Concealment page supplies it:

> 20% enhancement bonus to concealment — Item effects: Blurry, Smoke Screen

| Stat | Bonus type | Value |
|---|---|---|
| Concealment | Enhancement | 20 |

**Status:** CONFIRMED — write in U5.

---

## 2. Lesser Displacement — CONFIRMED

**Source:** https://ddowiki.com/page/Concealment

> 25% enhancement bonus to concealment — Item effect: Lesser Displacement

| Stat | Bonus type | Value |
|---|---|---|
| Concealment | Enhancement | 25 |

**Status:** CONFIRMED — write in U5.

---

## 3. Crown of Summer — CONFIRMED

**Source:** https://ddowiki.com/page/Crown_of_Summer

> Crown of Summer: You gain:
> +15 to positive Healing Amplification (enhancement bonus)
> +10 Melee Power (enhancement bonus)
> +5 Ranged Power (enhancement bonus)

All three components carry an explicitly stated bonus type.

| Stat | Bonus type | Value |
|---|---|---|
| Healing Amplification | Enhancement | 15 |
| Melee Power | Enhancement | 10 |
| Ranged Power | Enhancement | 5 |

**Name mapping:** the wiki says "positive Healing Amplification"; the dataset's canonical name for that stat is `Healing Amplification` (the negative and repair variants carry their own distinct names). `Melee Power` and `Ranged Power` map directly. All three are already in `metadata.rankable_affixes`, so no new stat is minted for this composite.

**Status:** CONFIRMED — write in U5.

---

## 4. Greater Heroism — QUARANTINED

**Sources:** https://ddowiki.com/page/Greater_Heroism · https://ddowiki.com/page/Heroism · https://ddowiki.com/page/Item:Legendary_Cloak_of_Victory

The **spell** page states a magnitude:

> The target gains a +4 morale bonus on attack rolls, saves, and skill checks. The target also receives temporary hit points equal to the caster level and immunity to fear.

But the **item enchantment** does not. Carrier items list it as a bare name with no numbers — Legendary Cloak of Victory's enchantment block reads simply `Greater Heroism`, alongside separately-numbered lines like `Charisma +14` and `Combat Mastery +11`. There is no item-effect page for it; both `Greater Heroism` and `Heroism` resolve to spell pages.

**Counter-evidence against assuming the spell's values.** That same cloak lists `Immunity to Fear` as its own separate enchantment. If the item form of Greater Heroism included the spell's fear immunity, listing it separately would be redundant — which is a real signal the item enchantment is not simply "the spell, permanently."

Two further mismatches make the spell values a poor fit for an equipped affix: the spell's temporary hit points scale with **caster level**, which an item has no equivalent of; and the spell is a timed buff, whereas an equipped affix is modeled as always-on.

Applying the spell's `+4 morale` to the item enchantment would be **inference, not sourcing** — precisely what the standing exclude-until-verified rule and KTD5 forbid. The dataset already separates `Greater Heroism` (16 records) from `Greater Heroism clicky` (4 records), so the parser is not conflating the use-activated form; the gap is that neither form has a wiki-stated equipped magnitude.

**Status:** QUARANTINED — do **not** write components in U5. `Greater Heroism` keeps its current `Bool` presence behavior, which remains targetable and correct as far as it goes. Resolving this needs either an item-effect page stating the equipped values, or in-game verification — neither is available from the wiki today.

---

## Concealment stacking — the rule that makes entries 1 and 2 safe

**Source:** https://ddowiki.com/page/Concealment

> Generally, multiple concealment bonuses of the same type do not stack, whether beneficial or offensive in nature, only the greatest concealment number applies. Currently almost all of them use the same bonus type - enhancement.

This maps exactly onto the optimizer's existing bucket semantics: same `name || equivType(type)` keeps the **max**, never the sum. Writing both Blurry and Lesser Displacement as `Concealment | Enhancement` therefore reproduces in-game behavior — an item with each does not yield 45% concealment, it yields 25%.

**Two documented exceptions, both out of scope for U5** (neither is an item affix this batch touches):

- Shadowdancer Tier 3 *Depths of Darkness* (+25%) stacks with the highest enhancement bonus to concealment.
- The *Twilight's Cloak* sentient filigree set grants an extra 5% at 5+ filigrees.

Filigrees are already outside the optimizer's modeled scope, and the Shadowdancer enhancement is a destiny ability rather than gear. Recorded here so a later pass does not re-derive them.

---

## Consequence for U5

- **Write three composites**, five component affixes total.
- **`Concealment` must be minted into the picker vocabulary** (KTD4b — union into `CORE_STATS` in `build_dataset.py`). It appears in neither `metadata.rankable_affixes` nor `metadata.affix_registry` today, so without that step the components would be written and still be unrankable.
- `Healing Amplification`, `Melee Power`, and `Ranged Power` already exist and need no minting.
- **Greater Heroism is dropped from U5** per the quarantine above. The plan's per-composite drop-out case covers this; U5 is not empty, so no unit is cancelled.
