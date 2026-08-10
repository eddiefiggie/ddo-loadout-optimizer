# Wiki evidence — universal spell-DC focus (#205)

**Verified:** 2026-08-09 (Chrome-MCP, same-origin from a ddowiki tab)
**Sources:** https://ddowiki.com/page/Increasing_spell_DCs ·
https://ddowiki.com/page/Spell_Focus_Mastery ·
https://ddowiki.com/page/Item:Legendary_Argonnessen_Eye_Band

## The two rules — CONFIRMED

From [Increasing spell DCs](https://ddowiki.com/page/Increasing_spell_DCs), Items:

> Items with Spell Focus Mastery apply to all spells. School-specific effects,
> such as C:Evocation Focus items, apply only to a single school of spells, but
> they scale faster.
>
> The effects come in several bonus types. **Effects with the same bonus type
> don't stack, only the highest applies.**
>
> The most common bonus types include equipment bonus, insight bonus, and quality
> bonus. Rare effects include sacred bonus, profane bonus, exceptional bonus,
> enhancement bonus (originally on Gianthold augments, streamlined in U80).
> Set effects: artifact bonus, profane bonus.

From [Spell Focus Mastery](https://ddowiki.com/page/Spell_Focus_Mastery):

> Spell Focus Mastery adds Equipment bonus to the DC of **all your spells**. Does
> not stack with other Spell Focus item enchantments, stacks with Spell Focus
> feats.

So:

1. A universal source applies to **every** school.
2. Within one bonus type, universal and school-specific do **not** stack — only
   the highest applies. Across bonus types, they stack.

**Consequence for the solver:** expanding a universal affix into the seven school
affixes at the same value and bonus type reproduces both rules through the
existing max-per-(stat, stacking type) bucketing. No new stacking primitive is
required, and a change to that bucketing would mean the expansion is wrong.

## What expands — the allowlist

| Name | Verdict | Evidence |
|---|---|---|
| `Spell Focus Mastery` | **Universal** | Stated outright above. 232 item affixes; also 516 set-bonus tiers (Profane and Artifact, matching "Set effects" above). |
| `Spell Focus` (bare) | **Universal** | The same page's worked example credits `Stormreaver's Napkin` — stored `Spell Focus \| Equipment \| 1` — as "+1 to her DCs", plural. 19 item affixes. |
| `Rune Arm Focus` | **NOT universal** | Same page: "Rune Arms have a similar but different type of Focus that isn't directly tied to a Spell School but to the Rune Arm itself." |
| `Deific Focus` | **NOT universal — RESOLVED 2026-08-09, do not re-raise** | It is a conditional ramping buff, not a static bonus. See the ruling below. |
| Spell **lore** | **NOT an umbrella** | `spell-lore.md` ruled universal and element-specific lore genuinely STACK — different stats. Expanding lore would collapse two real sources; it is a regression, not an extension. |

The typed variants render with a bonus-type prefix the player sees on the item —
`Sacred Spell Focus Mastery`, `Quality Spell Focus Mastery`, `Insightful Spell
Focus Mastery` (Insight renders as "Insightful"), with Equipment unprefixed. Those
strings are reproduced in the receipts so a player checking a tooltip finds the
same text.

## `Deific Focus` — NOT universal, resolved 2026-08-09

**Recorded so a later audit does not re-raise it.** The name, the Sacred typing,
and the absence of a wiki article all invite the guess that this is another
universal DC bonus. It is not.

https://ddowiki.com/page/Deific_Focus does not exist, but the items that carry it
do, and their rendered tooltips state the mechanic outright.
[I:Morion of the Undying](https://ddowiki.com/page/Item:Morion_of_the_Undying):

> Deific Focus III: On Spell Cast: +1 Sacred bonus to DC of that school for five
> seconds. Stacks up to III times. Casting a spell from another school clears all
> stacks of this effect.

So the +3 Sacred ceiling is real, but it is:

- **conditional** — nothing until you cast;
- **ramping** — +1 per cast, three casts to reach the cap;
- **single-school** — "that school", not all seven;
- **self-clearing** — casting from another school wipes every stack;
- **temporary** — five seconds.

Expanding it the way `Spell Focus Mastery` is expanded would credit +3 Sacred to
all seven schools, permanently and simultaneously, on all three carriers (Epic
Deific Diadem, Morion of the Undying, Staff of Irian). That is not a smaller
error than leaving it out — it is a larger one, and it would be invisible in a
finished loadout.

A player report of "+3 Sacred to all spell DCs" is an accurate reading of the
**cap** and the reason this is worth writing down: the summary a player carries in
their head is the sustained value for their own playstyle, while the solver models
static gear. Both are right about different things.

**Consequence, deliberately not fixed here.** The dataset stores it as a static
`Deific Focus | Sacred | 3`, which is a conditional effect modelled as a constant.
It contributes to nothing today — no school target includes that stat name — so it
is inert rather than inflating. The general question of conditional and ramping
effects stored as flat numbers is out of scope for #205.

## Item confirmation

[I:Legendary Argonnessen Eye Band](https://ddowiki.com/page/Item:Legendary_Argonnessen_Eye_Band),
the item from the report:

```
Spell Focus Mastery +8
Insightful Wizardry +155
Insightful Spell Penetration +5
Sacred Spell Focus Mastery +3
```

The `Sacred Spell Focus Mastery +3` matches our stored `Spell Focus Mastery |
Sacred | 3`.

### The base value — RESOLVED 2026-08-09 (#207)

The wiki said +8; gear-planner said +5. Re-verified against the **rendered
tooltip**, not just the visible cell, per the standing rule:

> Spell Focus Mastery +8: +8 Equipment bonus to the DC of all your spells.

Tooltip and cell agree, so this is not the bundled-template trap. The item has a
single Spell Focus Mastery enchantment with no tier variants, and its other three
enchantments match gear-planner exactly. The heroic **Argonnessen Eye Band**
matches on all four (`+3 / +56 / +2 / Sacred +1`), so this was one stale row, not
systematic drift.

Corrected to 8 via `data/seed/compendium/item_value_corrections.json`. That
mechanism exists because `gap_corrections.json` is additive-only and skips any
`(name, type)` already present — a guard protecting removed double-counts, which
must not be widened to overwrite. Each correction records the value gear-planner
carries today and **fails the build when that no longer matches**, so it cannot
go stale unnoticed the way the value it corrects did.

**No solved loadout changed.** In the `endgame-necro-dc-ml34` fixture the ring's
Equipment channel was already dominated by `Legendary Death's Anchor` at +12, so
the ring earns its slot on Sacred +3, not Equipment. Same bonus type, only the
highest applies — the correction is right regardless, and will matter in builds
where nothing better occupies that channel.

## Measured effect

The golden fixture `endgame-necro-dc-ml34` (ML 34; Necromancy, Enchantment,
Illusion, Conjuration) against the pre-change tree and this change:

| Target | Before | After |
|---|---|---|
| Necromancy Focus | 26 | 31 |
| Enchantment Focus | 26 | 31 |
| Illusion Focus | 25 | 31 |
| Conjuration Focus | 15 | 31 |

The Legendary Argonnessen Eye Band enters the loadout, which is what the report
said was missing.

**The golden guard had no DC coverage before this.** Both existing "caster"
fixtures rank Intelligence, Spell Power, Potency, Wisdom, and Charisma — no spell
school — so every one of them was unchanged by a fix that alters every
school-ranked solve. That gap is why the fixture above was added rather than an
existing one re-ratified.
