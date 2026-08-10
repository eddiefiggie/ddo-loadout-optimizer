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
| `Deific Focus` | **QUARANTINED** | https://ddowiki.com/page/Deific_Focus does not exist ("We don't currently have an article called Deific Focus"). Three items carry it as a Sacred bonus (Epic Deific Diadem, Morion of the Undying, Staff of Irian). The name and typing suggest universal, but under the exclude-until-verified gate it is disclosed, not inferred. Ships only if a future lookup states the rule outright. |
| Spell **lore** | **NOT an umbrella** | `spell-lore.md` ruled universal and element-specific lore genuinely STACK — different stats. Expanding lore would collapse two real sources; it is a regression, not an extension. |

The typed variants render with a bonus-type prefix the player sees on the item —
`Sacred Spell Focus Mastery`, `Quality Spell Focus Mastery`, `Insightful Spell
Focus Mastery` (Insight renders as "Insightful"), with Equipment unprefixed. Those
strings are reproduced in the receipts so a player checking a tooltip finds the
same text.

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
Sacred | 3`. **The base value does not match** — the wiki says +8, gear-planner
says +5. Tracked separately as #207; this document does not resolve it.

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
