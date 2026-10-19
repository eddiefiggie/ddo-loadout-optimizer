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
