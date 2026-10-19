# Enchantment template defaults: read the code, not the usage notes (#907)

**Ruled 2026-10-19** from a harvest of all 601 `Template:` pages that item enchantments use. The harvest was `templates-20261019`, read same-origin through the in-app Browser pane.

## The ruling

When an item page writes an enchantment without a bonus type, for example `{{Resistance|5}}`, the type is the default that the **template's code renders**. It is not the default written in the template's usage notes. The two disagree, and the rendered tooltip is what the game shows:

| Template | Usage notes say | Code renders | Gear-planner (199 items) |
|---|---|---|---|
| `Resistance` | "Default=Enhancement" | `{{Insightful\|{{{2\|Resistance}}}}} bonus` | Resistance |

Several defaults are not Enhancement at all:
- `Accuracy` and `Deadly`: **Competence**.
- `Spellpen` and `Spell Focus`: **Equipment**.
- `Save`: **Resistance**, except enchantment, illusion and spell saves, which are Enhancement.
- `Skills`: **Competence**.

Because bonus type is the stacking key, each mapper's default is pinned. `src/wiki_enchantments.py` `TEMPLATE_DEFAULTS` quotes the exact code. `data/seed/compendium/enchantment_template_evidence.json` records that code and its revision. `tests/test_wiki_enchantments.py` fails if they part.

## Spellings follow the template's own switches

- `Template:Insightful` (rev 678297) maps `ins`, `insight` and `insightful` to **Insight**. Anything else is sentence-cased.
- A template can override that. `Template:Seeker` maps `exc`, `exceptional`, `ins` and `insightful` to **Insight**. So `{{Seeker|5|exc}}` renders "Exceptional Seeker +5: … a +5 Insight bonus".
- This independently reproduces the 2026-09-04 re-ruling in `seeker-bonus-type.md` (#697), which got there from tooltips and a player's combat log.
- `Template:Roman2Dec` (rev 639664) passes numbers through and converts roman numerals. Templates upper-case first, so `{{Deadly|x}}` is a stated +10.

## Catalog conventions kept

- A negative magnitude is a `Penalty`, because penalties always stack (#614). Gear-planner already writes it this way.
- Only top-level enchantment lines (`*`) are the item's own. Nested lines (`**`) are upgrade tiers, choices or set grants.

## First parity (8 templates, 3,613 lines)

`python3 scripts/diff_harvest_affixes.py items-20261018`:

| Template | Lines | Exact | Already corrected by us | Gear-planner lacks it | Unreadable |
|---|---:|---:|---:|---:|---:|
| Stat | 1,452 | 1,451 | 0 | 1 | 0 |
| Sheltering | 929 | 928 | 0 | 1 | 0 |
| Resistance | 237 | 237 | 0 | 0 | 0 |
| Dodge | 224 | 223 | 0 | 1 | 0 |
| Deadly | 200 | 200 | 0 | 0 | 0 |
| Seeker | 197 | 178 | 18 | 1 | 0 |
| Doublestrike | 189 | 186 | 0 | 0 | 3 |
| Accuracy | 185 | 185 | 0 | 0 | 0 |

There are **zero unexplained bonus-type differences.**
- The 4 affixes gear-planner lacks are all on rune arms.
- The 3 unreadable lines are `{{Doublestrike|Calamitous Blows}}`, a named effect rather than a number.


## Tier 2 (2026-10-19): 23 templates, 15,807 lines

These templates were added in tier 2: Skills, Save, Spelllore, SpellPower / Spell Power, Spell Focus, Fortification, Elemental Resistance, HealingAmp, Tactics, NaturalArmor, Spellpen, Enhancement bonus, Hp and Wizardry. Every default and spelling rule is read from the template's code:

- **Save:** defaults by branch. Fortitude, Reflex, Will, enchantment and spell saves are Resistance; illusion and sleep saves are Enhancement. `determination` is its own stat, `Determined <Save>`.
- **Skills:** Competence. The five grouped bonuses (Alluring, Astute, Mighty, Nimble, Prudent) are Exceptional. `enh` is accepted only where `prefix=Enhanced` on the same call states the type.
- **Spelllore:** Equipment. A roman magnitude is Roman2Dec + 10 for every element lore and +0 for `spell`, which is the #887 rule, here read straight from code.
- **HealingAmp:** an unknown kind falls to the template's `#default = Healing`.
- **Fortification:** legacy `0` is Exceptional Fortification, ruled an Insight bonus (#862). `1`, `2` and `3` are 25, 75 and 100%. `4` (Construct) is not read.

| Template | Lines | Exact | Already corrected | gear-planner lacks it | Not read |
|---|---:|---:|---:|---:|---:|
| Enhancement bonus | 4,616 | 4,009 | 0 | 1 | 606 |
| SpellPower | 1,538 | 1,503 | 0 | 7 | 28 |
| Stat | 1,452 | 1,451 | 0 | 1 | 0 |
| Skills | 1,171 | 1,092 | 0 | 1 | 78 |
| Sheltering | 929 | 928 | 0 | 1 | 0 |
| Spelllore | 852 | 748 | 102 | 2 | 0 |
| Spell Focus | 818 | 815 | 0 | 0 | 3 |
| Fortification | 547 | 533 | 0 | 3 | 11 |
| Save | 497 | 490 | 0 | 6 | 1 |
| Hp | 452 | 444 | 0 | 2 | 6 |
| Elemental Resistance | 402 | 389 | 6 | 7 | 0 |
| Wizardry | 316 | 290 | 0 | 1 | 25 |
| HealingAmp | 279 | 278 | 0 | 1 | 0 |
| Resistance | 237 | 237 | 0 | 0 | 0 |
| Dodge | 224 | 223 | 0 | 1 | 0 |
| Spellpen | 210 | 210 | 0 | 0 | 0 |
| Deadly | 200 | 200 | 0 | 0 | 0 |
| Seeker | 197 | 178 | 18 | 1 | 0 |
| Doublestrike | 189 | 186 | 0 | 0 | 3 |
| Accuracy | 185 | 185 | 0 | 0 | 0 |
| Tactics | 180 | 150 | 0 | 0 | 30 |
| Spell Power | 174 | 174 | 0 | 0 | 0 |
| NaturalArmor | 142 | 142 | 0 | 0 | 0 |

**Zero bonus-type differences and zero value differences** across all 23.
- "Already corrected" covers Seeker `exc` (#697), Elemental Resistance `insight` (#379) and the roman element lores (#887). The lore case is matched across the build's renames: gear-planner's `Negative Lore` and `Cold Lore` are the catalog's `Void Lore` and `Ice Lore`.
- "gear-planner lacks it" is almost entirely rune arms.
- "Not read" is deliberate:
  - named effects (`Calamitous Blows`, `Tendon Slice`)
  - implement and orb kinds of `Enhancement bonus`
  - Magi/Archmagi Wizardry, which gear-planner does not carry either
  - Deific Focus
  - legacy Construct Fortification
