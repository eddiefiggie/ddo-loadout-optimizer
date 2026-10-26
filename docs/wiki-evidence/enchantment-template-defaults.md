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
  - Magi/Archmagi Wizardry, which gear-planner does not carry either. *(Superseded 2026-10-25: gear-planner does carry them, as presences, and they are now read as presences. See* Magi, Archmagi and the Pirate effects *below.)*
  - Deific Focus
  - legacy Construct Fortification

## Tier 3: typed effects (2026-10-19)

Thirteen more templates, each read from its code:

- **Bane:** `fey` is Feybane; a word tier prefixes the name (`{{Bane|Halfling|lesser}}` is Lesser Halfling Bane), a number does not. A presence.
- **Blast:** a numeric p2 is the scaled tier; a word is the old non-scaled prefix (`{{Blast|Flaming|Greater}}` is Greater Flaming Blast). A presence.
- **Absorption:** only the percentage branches that render `{{{5|Enhancement}}} Bonus to X Absorption` are read. Electric/Electrical/Electricity/Lightning are one branch, Electric Absorption. Elemental is always Enhancement and is read only without sonic (`src/absorption_split.py` expands it per item).
- **Deception:** a number is an enhancement bonus to Bluff; `bluff=improved` and `bluff=yes` are the named forms.
- **Diversion:** p2 is the kind (Distant, Mystic) and p3 the bonus type.
- **Speed:** an integer and a roman numeral are both the catalog's `Speed` N. The code's `{{Roman2Dec}}` test sends a numeral to the attack-speed branch, whose bonus is Roman2Dec(N)%.
- **Parrying:** always Insight. **ProtectionBonus:** a Deflection bonus to Armor Class.
- **Incite, Spell Resistance, Armor-Piercing:** Enhancement by default. **Concealment, Ghostly:** presences.

| Template | Lines | Exact | gear-planner lacks it | Declined |
|---|---:|---:|---:|---:|
| Bane | 842 | 842 | 0 | 0 |
| Blast | 465 | 465 | 0 | 0 |
| Absorption | 447 | 369 | 1 | 77 |
| Deception | 260 | 257 | 0 | 3 |
| Concealment | 171 | 171 | 0 | 0 |
| Diversion | 164 | 151 | 0 | 13 |
| Speed | 153 | 152 | 0 | 1 |
| Spell Resistance | 146 | 146 | 0 | 0 |
| Parrying | 140 | 140 | 0 | 0 |
| ProtectionBonus | 123 | 123 | 0 | 0 |
| Incite | 115 | 113 | 0 | 0 |
| Ghostly | 113 | 95 | 0 | 18 |
| Armor-Piercing | 108 | 108 | 0 | 0 |

**Zero value differences.** The only type differences are the two Cloaks of the Crownblade, where gear-planner carries Distant Incite with **no** type. The template renders an Enhancement bonus, so the harvest types them, and the `Distant Incite` parse-gap quarantine in `untyped_rankable.json` retired. Chulchannad's Claw's Cold Absorption is the one value gear-planner lacks.

### Declined forms

A **declined** call (`Declined` in `src/wiki_enchantments.py`) is a form deliberately not read. It yields no affix, so gear-planner's own affix for that call stands, and unlike an unreadable call it does not keep the item whole. The declined forms:

- **Absorption:**
  - charge forms (`0` percent; clickies such as Spell or Curse Absorption)
  - named branches (Devil's Bones, Block Elements)
  - **negative energy**: its percentage branch reads "absorbs N% of all negative damage" and states no bonus type, so its type is not inferred
  - Elemental with sonic
- **Ghostly:** the Enhanced form.
- **Diversion:**
  - legacy `old`
  - a bonus type written as the kind. `{{Diversion|4|Insightful}}` renders an "Insightful Diversion" enhancement bonus, an authoring slip.
- **Deception:** the tiered roman on-hit forms.
- **Speed:** with a kind (melee, ranged, movement), which one `Speed` stat cannot express.
- **The tier-2 ruling's named forms (2026-10-25).** These are listed explicitly in `src/wiki_enchantments.py`, not inferred from "not a known type", so a misspelt real type still fails loudly:
  - **Tactics:** Tendon Slice (30 items).
  - **Doublestrike:** Calamitous Blows (3).
  - **Spell Focus:** Deific Focus (3).
  - **Fortification:** legacy Construct `4` (11).
  - ~~**Wizardry:** Magi, Archmagi and Pirate Cleverness. **Hp:** Pirate Vitality.~~ Declined on 2026-10-25, then read as presences the same day. See below.
  - **SpellPower:** the named powers. These are Spell Turmoil, Spell Resonance, Elemental Resonance, Elemental Manipulation, Path of the Fire Dragon, Power of Creeping Dust, the two Frozen Storm powers, and the augment powers Ardor, Efficacy, Erosion, Freeze, Inferno, Nihil and Spark.

  80 items stop being kept whole (126 → 46; 134 → 54 variants). The built `items.json` is affix-identical on all 9,173 variants: `replaced` and `added` did not move, and `unchanged` rose by 168, so every freed item's own reads agree with gear-planner. 10 items stay whole under the same-template exception below: Belt of Whirling Blades, Chaos in a Bottle, Robe of Dissonance, and others.

**Ruled "deliberate", but three forms were not (#941, resolved 2026-10-25).** The tier-2 table counts every unread Wizardry and Hp call as deliberate. The inventory found three forms among them that looked readable. Each was then read from its template's code, fetched fresh:

| Form | Code | Read as | gear-planner |
|---|---|---|---|
| Wizardry `+19` / `+195` (7) | `Template:Wizardry` rev 700755: `#default = {{Ifnumber\|{{{1}}}\|{{{1}}}\|N}}`, so a number is the spell points as written | `(Wizardry, Enhancement, 19 / 195)` | identical |
| Wizardry `IV` / `VIII` (5) | the same template's Power switch: `\|IV\|M\|MAGI = MAGI`, `\|VIII\|AM\|ARCHMAGI = ARCHMAGI`. These are **not** missing numerals. | Magi / Archmagi (now presences, below) | `(Magi \| Archmagi, Bool, 1)` |
| Hp `Profane Life Force\|N` (3) | `Template:Hp` rev 538996 switches on `{{lc:{{#replace:{{{1}}}\| \|}}}}`, so this is the `profanelifeforce` branch: `[[Profane bonus]] to Hit Points` | `(False Life, Profane, N)` | identical |

14 items stop being kept whole (46 → 32; 54 → 40 variants). The built `items.json` is affix-identical on all 9,173 variants, and `unchanged` rose by 39.

**Magi, Archmagi and the Pirate effects are presences (2026-10-25, ruling revised).** The tier-2 bullet declined Magi/Archmagi as something "gear-planner does not carry either". That premise was false. gear-planner carries all four as presences, and each template branch renders one fixed named effect with no amount:

| Call | Code | Read as | gear-planner |
|---|---|---|---|
| `{{Wizardry\|M\|Magi\|IV}}` (4) | `Template:Wizardry` rev 700755, `\|IV\|M\|MAGI = MAGI`: "+100 maximum spell points" | `(Magi, Bool, 1)` | identical |
| `{{Wizardry\|AM\|Archmagi\|VIII}}` (11) | `\|VIII\|AM\|ARCHMAGI = ARCHMAGI`: "+200 maximum spell points" | `(Archmagi, Bool, 1)` | identical |
| `{{Wizardry\|Pirate Cleverness}}` (3) | `\|PIRATE CLEVERNESS`: "+50 bonus to your maximum spell points" | `(Pirate Cleverness, Bool, 1)` | identical |
| `{{Hp\|Pirate Vitality}}` (3) | `Template:Hp` rev 538996, `\|piratevitality\|pv`: "+10 bonus to your maximum hit points" | `(Pirate Vitality, Bool, 1)` | identical |

This is the same rule #940 applied to the parameterless Special Skills: a call that reads no amount and renders one fixed effect states a presence. Wizardry parity is now 315 of 316 exact and Hp 450 of 451, with neither carrying an unread call. 21 shard records gain the presence. Kept-whole is unchanged at 32, because the decline had already freed these items. The built `items.json` is affix-identical on all 9,173 variants, and `unchanged` rose by 21, because each presence now confirms gear-planner's instead of leaving it to stand.

The exception: beside a **read** call of the same template on the same item, a declined call keeps the item whole after all, because the merge could pair gear-planner's affix for the declined call with ours. 3 items.

## Skills: Stat Skills, Linguistics and Persuasion (2026-10-25)

`Template:Skills` was re-read fresh from ddowiki on 2026-10-25. It is still **rev 703569** (2026-08-05), the revision in the 2026-10-19 template harvest, so the evidence shard's quote stands. Three branches of its code that the tier-2 mapper refused (`"is not a single skill"`) are now read:

| Branch | Code | Read as | gear-planner |
|---|---|---|---|
| Stat Skills (`cha`, `con`, `dex`, `int`, `str`, `wis` and the full names) | `<Stat> Skills - Exceptional Bonus {{Int\|{{{2\|0}}}}}`, rendered as a `[[Exceptional bonus]]` (or `penalty` when negative) to the stat's skills. The branch never reads `{{{3}}}`. | `(<Stat> Skills, Exceptional, N)`. A negative amount is `Penalty` (#614). | Same, on every record |
| Linguistics | `[[Linguistics]] {{{2\|10}}}%`, a cooldown cut on social skills. No bonus type is named. | `(Linguistics, Untyped, N)`, default 10 | `(Linguistics, Untyped, 10 or 15)` |
| Persuasion | No parameters. One fixed effect, +3 competence to all Charisma based skills. | `(Persuasion, Bool, 1)`, a presence | `(Persuasion, Bool, 1)` |

**Parity on `items-20261018`:** Skills exact rose from 1,092 to **1,156**. That is 33 Linguistics, 27 Stat Skills and 4 Persuasion calls, with **zero** type or value differences. Unread calls fell from 78 to 14.

**Effect on the shard:** 57 items stop being kept whole (196 → 139; 204 → 147 variants), so every mapped affix on them is now read from their own page. The built `items.json` has the same affixes on all 9,173 variants as before. Every one of those reads agrees with gear-planner, so no solve changes. `planner_coverage.harvest_affixes.unchanged` rises by 200.

**Command and the parameterless Special Skills (2026-10-25, second pass).** The template is now read in full:
- `Command` renders `{{Int|{{{2|2}}}}} [[{{{3|competence}}} bonus]]`, so a bare `{{Skills|Command}}` is `(Command, Competence, 2)`. That covers 9 calls, and gear-planner agrees on all 9.
- Shadow, Silent Moves, Songblade and Voice of Deceit take no parameters. Each branch renders one fixed effect, so the call states a presence, `(<Name>, Bool, 1)`, as with Persuasion and as gear-planner records them. Silent Moves states no number, but a presence needs none.
- Names are matched the way the code matches them: lowercased, spaces removed.

Skills exact is now **1,170 of 1,171**, with none unread. The one `absent` is Glorious Obscenity's Enhanced Spot, which gear-planner never parsed. 13 more items stop being kept whole (139 → 126; 147 → 134 variants). The built `items.json` is again affix-identical on all 9,173 variants.
