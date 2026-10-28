# Named item sets: page and template structure (#949)

**Read 2026-10-27** from harvest `pages-20261027`, taken same-origin through the in-app Browser pane with `parse: true`. The title list is `data/harvest_titles/named-item-sets.json` at `5816d22`.

| Page | pageid | revid | html_revid | Last edit |
|---|---:|---:|---:|---|
| `Named item sets` | 9371 | 720202 | 720202 | 2026-10-11 |
| `Template:Named item sets` | 15874 | 723530 | 723530 | 2026-10-22 |

For both pages, `revid` and `html_revid` match, so the wikitext and the rendering come from the same edit.

This file records structure only. No set value is ruled on here. The reader and the parity diff (#908) come next.

## Two sources, not one

The page is not the only place set bonuses live. **`Template:Named item sets` is a second source**, a `#switch` with 296 entries (293 real sets, plus `#default`, `this template!` and the usage example `some off the wall set`). Item pages call it as `{{Named item sets|<set>}}`, and it renders the set's bonus in a popup.

The page itself defers to the template for 9 sets. For these, the bonus cell is just `{{Named item sets|<set>}}`:
- The Desert's Biting Sands
- The Desert's Burning Sun
- The Desert's Starless Nights
- The Desert's Writhing Storm
- Amaunator's Blessing
- Woodsman's Guile
- Knight's Loyalty
- Way of the Sun Soul
- Battle Arcanist

**Per-set pages: none exist.** `allpages` with prefix `Named item sets/` returns nothing in either the main or the Template namespace. The second source is the template, and it is now in the title list.

## The page: `Named item sets`

- **37 `==` sections**, one per content source (for example "Korthos Island sets" and "Slave Lords Crafting sets"), holding **39 `wikitable`s** and **209 row separators**.
- **283 `{{Anchor|…}}` calls, 282 distinct.** `Wrath of Sora Kell` is anchored twice.
- **Each row has three cells:** the set name (`{{Anchor|X}}'''X'''`, sometimes with `[ML:a/b]` appended), the items, and the bonus.
  - **Items** are `* {{Item|…}} - Slot` bullets. Some rows instead use `{{HELitem|<heroic>|E=…|L=<legendary name>}}`, where `E=0` means there is no Epic version. Long lists sit inside `mw-collapsible` divs.
  - **Bonus** opens with a piece-count header such as `3 Pieces Equipped:`, then bullets. Counts seen: 2 (64), 3 (72), 4 (9), 5 (14), 6 (10), 7 (5), 8 (1).
- **One row can be several sets.** Rows that cover Heroic, Epic and Legendary versions carry one anchor and `{{HELstats|…}}` values. Examples:
  - Slave Lords Crafting: `Slave Lord's Sorcery [ML:8/28]` has one anchor, but gear-planner records it as two sets, `Slave Lord's Sorcery` and `Legendary Slave Lord's Sorcery`.
  - Ravenloft: the anchor names only `Adherent of the Mists Set (Heroic)`, and the Legendary set lives in the same row.
  - So **row count is not set count**, and an anchor is not a set name.
- **Some cells are prose, not statements of value.** Arcane Mind's cell reads "(Despite the description in-game, the set does not give any bonus to Universal Spell Power)". Battle Arcanist grants a spell-point cost discount. A reader must recognize text it cannot map and quarantine it.

### `HELstats`: the numbers are in the wikitext, the tier names are in the tooltip

This is the bundled-template case (`docs/solutions/conventions/bundled-template-values-live-in-the-tooltip-not-the-cell.md`). `{{HELstats|+2|L=+4}}` renders one glyph-prefixed value per tier. The tier name appears only in the popup:

```
◆+2  (tooltip: Heroic)   ★+4  (tooltip: Legendary)
```

Rendered across the page, the glyphs and tooltips correspond one to one: `&#9830;` ◆ is Heroic (230), `&#9679;` ● is Epic (72), and `&#9733;` ★ is Legendary (247).

There are 253 calls, in six argument shapes:

| Shape | Calls |
|---|---:|
| `pos, L=` | 166 |
| `pos, pos, pos` | 55 |
| `L=` only | 12 |
| `E=, L=` | 11 |
| `pos, pos` | 6 |
| `H=, L=` | 3 |

**Map the shapes to tiers from the rendered HTML, never by position alone.** The page's own editing note says `{{HELstats|Heroic|Epic|Legendary}}`. But the 6 two-positional calls are exactly where reading by position would be a guess, and the harvest stored each cell's rendering for this reason.

## The template: `Template:Named item sets`

- **Each entry is one set**, already split by tier, for example `adherent of the mists set (heroic)` and `… (legendary)`. Keys are lower-cased by `{{lc:}}`.
- **The value is prose joined by `<br />`.** It has piece-count headers (`Pieces Equipped`, 215 occurrences), `[[bonus type]]` links, and a trailing `{{#vardefine:set|<display name>}}`. That `#vardefine` holds the set's case-preserved name.
- **No `HELstats` appears in it:** each tier is its own entry.
- **The Slave Lords Crafting sets are absent.** They exist only on the page, in `HELstats` rows.

## Counts against `gearplanner_sets.json` (282 sets)

All names are compared lower-cased.

| Set of names | Count |
|---|---:|
| gear-planner | 282 |
| Template entries (real sets) | 293 |
| Page anchors (distinct) | 282 |
| gear-planner ∩ template | 273 |
| gear-planner ∩ page anchors | 267 |
| gear-planner ∩ (template ∪ page) | **277** |

**5 gear-planner names match neither source by exact name:**
- `Slice 'n Dice` and `Epic Slice 'n Dice`. The wiki spells them `Slice 'n Dice Set` and `Epic Slice 'n Dice Set`.
- `Legendary Slave Lord's Might`, `Legendary Slave Lord's Sorcery` and `Legendary Slave's Endurance`. These are the `L=` halves of `HELstats` rows, which carry no anchor of their own.

**27 wiki names are not in gear-planner.** They have not been investigated, and none of them is ruled to be a missing set:
- **5 that the page defers to the template:** Amaunator's Blessing, Battle Arcanist, Knight's Loyalty, Way of the Sun Soul, and Woodsman's Guile. The other 4 deferred sets, the Desert sets, are in gear-planner under the same names.
- **12 found only in the template:** nine `Greater …` sets (Greater Divine Blessing, Greater Elder's Knowledge, Greater Marshwalker, Greater Might of the Abishai, Greater Raven's Eye, Greater Shaman's Fury, Greater Siren's Ward, Greater Vulkoor's Cunning and Greater Vulkoor's Might), plus Angel of Vengeance, Beacon of Hope and Divine Avenger.
- **8 that differ only by spelling or suffix.** gear-planner holds all of these sets under another spelling:
  - The page has `Minion of the Mochery` and `Legendary Minion of the Mochery`. The template and gear-planner spell it `Mockery`.
  - The page has `Crypt Raider`, `Legendary Crypt Raider`, `Knight of the Shadows` and `Legendary Knight of the Shadows Set`. The template and gear-planner use `… Set (Heroic)` / `… Set (Legendary)`.
  - Both wiki sources have `Slice 'n Dice Set` and `Epic Slice 'n Dice Set`. gear-planner drops the `Set`.
- **2 more:** `Inevitable Balance` (page only) and `Planar Conflux` (page and template).

## What the reader needs (#908)

1. **Use both sources, keyed by set name.** The template supplies tier-split entries. The page supplies the Slave Lords crafting sets, the item lists, and the `HELstats` rows. Where both describe a set, record any disagreement. Do not pick a winner silently.
2. **Expand each `HELstats` row into one set per tier**, using the rendered tooltip labels for the mapping.
3. **Spelling drift is a recorded alias**, each one citing the wiki text on both sides. A name is never fuzzy-matched.
4. **Prose a reader cannot map is quarantined and disclosed**, as for item affixes.

## First parity measurement (#908, 2026-10-27)

`scripts/diff_harvest_sets.py pages-20261027`, reading through `src/wiki_sets.py`. Two template rulings were read before any code was written:

- **`Template:HELstats` rev 673386:**
  - Heroic is `{{{1}}}`, else `{{{H}}}`. Epic is `{{{2}}}`, else `{{{E}}}`. Legendary is `{{{3}}}`, else `{{{L}}}`.
  - A positional argument wins over its named one, and a tier with no value renders nothing.
  - So the 6 two-positional calls are **Heroic and Epic**.
- **`Template:Artifact` rev 674392** is cell styling only (`class="bg-color-1" style="background-color:#ebe0a4;" |`). It opens 122 bonus cells and is not a bonus line.

The clause reader is closed. It reads `+N <Type> bonus to <stat>` only when the type is a known bonus type and the stat is **exactly** a name gear-planner's set catalog uses. Everything else is quarantined with a reason.

| Class | Template | Page |
|---|---:|---:|
| exact | 12 | 10 |
| partial (every line read agrees; the rest quarantined) | 170 | 49 |
| threshold-unstated | 90 | 51 |
| no-wiki-name | 9 | 172 |
| **ours-differs** | **1** | 0 |

- **Page `no-wiki-name` is mostly by design.** 173 page records come from `HELstats` rows, and those are never matched by name: their anchor names at most one tier.
- **The template quarantined 451 lines**, across 120 distinct reasons:
  - **424 are a stat phrase in other words**, for example:
    - `Melee and Ranged Power` (48)
    - `Physical Resistance Rating` (25)
    - `all Ability Scores` (18)
    - `Spell DCs` (17)
    - `Doublestrike and Doubleshot` (15)
  - **25 are not the typed shape** (prose, `To-Hit Bonus +2 (untyped …)`).
  - **2 are unexpanded templates.**
- **Threshold-unstated:** the piece count appears only in prose ("When both items are equipped", "While wearing two pieces"). It is not read as a number.
- **The one `ours-differs` is a vocabulary question, not a value error.**
  - Legendary Vulkoor's Might's template entry states both `+3 Artifact bonus to Sneak Attack` and `+3 Artifact bonus to Sneak Attack Damage`.
  - gear-planner carries a single `Deception` +3 in their place.
  - Whether these are the same stat needs a ruling. Do not resolve it by renaming.
- **Sources disagree (both fully read): 0 today.** Arcane Mind's disagreement (the template says Universal Spell Power; the page says Potency and that the set gives no Universal Spell Power) is not counted yet, because neither side's line is readable. It surfaces once those phrases are mapped.

## Coordinated lists (#951, 2026-10-27)

`read_clause` now expands a coordinated list of stats ("Melee and Ranged Power", "Intelligence, Wisdom, and Charisma", "Fire and Cold Spell Power") into its members.

**This is a reading of the sentence, not a translation:**
- Every member must be exactly a catalog name.
- Exactly one shared-head length may do that. Two readings mean the text is ambiguous, and the line stays quarantined.
- A reading that turns two members into the same name is rejected. "Sneak Attack and Sneak Attack Damage" (Legendary Raven's Eye) is two stats. Its first member is not a catalog name, so the line stays quarantined.

**Measured on `pages-20261027`:**
- **The template reads 78 more lines (166 affixes)**, including all 49 `Melee and Ranged Power` lines. Quarantined lines fall from 451 to 384.
- **Every expanded affix under a stated threshold matches gear-planner's** for that set and threshold.
- **Exact sets rise from 12 to 18 (template) and from 10 to 12 (page).**
- **`ours-differs` stays at 1** (Legendary Vulkoor's Might's Sneak Attack Damage, #951's open ruling).

Lists whose members are in other words stay quarantined: `Doublestrike and Doubleshot`, `PRR and MRR`, `… Spellcrit Chance`, `… Spellpower`, `… Amp`. Each is its own family.

## Resistance ratings: PRR, MRR and the MRR cap (#951, 2026-10-27)

`STAT_PHRASES` in `src/wiki_sets.py` is the reviewed phrase table. Its first family:

| Wiki phrase | Catalog name | Evidence |
|---|---|---|
| `Physical Resistance Rating`, `PRR` | Physical Sheltering | ddowiki `Physical Resistance Rating` rev 673201 ("abbreviated PRR"; `PRR` redirects there). `sheltering.md` names it Physical Sheltering |
| `Magical Resistance Rating`, `MRR` | Magical Sheltering | `Magical Resistance Rating` rev 708082 ("abbreviated MRR"; `MRR` redirects there). `sheltering.md` |
| `Magical Resistance Rating Cap`, `MRR Cap` | Magical Sheltering Cap | the same page's "MRR cap" section. `intrinsic-stat-caps.md` ("the wiki's MRR Cap") |

- A phrase maps only when the catalog carries its target.
- List members resolve through the same table, so `PRR and MRR` and `Physical and Magical Resistance Rating` each read as both ratings.
- On the gear-planner side, the diff compares its `Sheltering` affix as Physical + Magical Sheltering. `sheltering.md` quotes the wiki: Sheltering is "a +X bonus to both".

**Measured on `pages-20261027`:**
- Exact sets rise from 18 to 29 (template) and from 12 to 17 (page).
- Template quarantined lines fall from 384 to 319.
- `ours-differs` stays at 1.

### The wiki contradicts itself on three PRR values

| Set | Template (rev 723530) | Page (rev 720202, same tier) | gear-planner |
|---|---:|---:|---:|
| Legendary Dreadkeeper | +40 | +20 | 20 |
| The Desert's Burning Sun | +5 | +10 | 10 |
| The Legendary Desert's Burning Sun | +15 | +30 | 30 |

**The template's history does not settle it:**
- All three template values arrived in Cru121's bulk rewrite of 2021-09-02 (rev 499661, "code replaced + added a bunch of new sets").
- Legendary Dreadkeeper read +20 before that rewrite (rev 438208, 2020-03-19), when it was first added.

Under *never infer a value*, neither side is adopted. The three are recorded in `scripts/diff_harvest_sets.py` `WIKI_DISAGREEMENTS` and classed `wiki-disagrees`, not `ours-differs`. The diff reports any record that no longer reproduces. This was proven by corrupting one record's value: it reported stale, and the line fell back to `ours-differs`.

Resolving them needs an in-game reading or a wiki edit with a source, not a parser change.

## Spell DCs (#951, 2026-10-27)

| Wiki phrase | Catalog name | Evidence |
|---|---|---|
| `Spell DCs`, `all Spell DCs` | Spell Focus Mastery | ddowiki `Spell Focus Mastery` rev 612763: "adds ... to the DC of all your spells". `Spell DC` redirects to `Increasing spell DCs` rev 719694, whose Items section lists "Set effects: artifact bonus, profane bonus" for it (`spell-focus-universal.md`) |

**Bare `DCs` is not mapped.** It does not say "spell", and tactical DCs are DCs too.

**Measured on `pages-20261027`:**
- All 28 template lines now read. All 21 of them under a stated threshold match gear-planner's Spell Focus Mastery.
- **Exact sets:** 29 to 32 (template), 17 to 18 (page).
- **Quarantined:** 319 to 298.
- **`ours-differs`:** stays at 1.

## Doublestrike and Doubleshot (#951, 2026-10-28)

The catalog names these two stats without ` (%)`. It writes ` (%)` only where a stat also has a flat form (`Armor Class (%)`, `False Life (%)`). So a `+N%` line to them was quarantined as `Doublestrike (%)`, a name the catalog never uses.

`PERCENT_STATS` in `src/wiki_sets.py` lists the stats that are themselves a percentage. A `+N%` line to one of them reads as a bonus of N to the bare name.

| Stat | Evidence |
|---|---|
| Doublestrike, Doubleshot | ddowiki `Doublestrike` and `Doubleshot` (revisions of 2026-10-07) state both in percent: "a Doublestrike value of 230% ... would only provide 215% chance" (`intrinsic-stat-caps.md`, #888). `Template:Doublestrike` takes "String value (1% - 100%)", and the item mapper already reads it as Doublestrike N |

- **The rule is per stat, not general.** A `+N%` line to any other bare catalog name stays quarantined. `+5%` Melee Power is not `+5` Melee Power.
- A stat in `PERCENT_STATS` still has to be a catalog name. Nothing is minted.
- The coordinated-list reader resolves members the same way, so `Doublestrike and Doubleshot` reads as both.

**Measured on `pages-20261027`:**
- **Exact sets:** 32 to 38 (template), 18 to 21 (page).
- **Quarantined:** 298 to 280 (template), 77 to 70 (page).
- **`ours-differs`:** stays at 1 (Legendary Vulkoor's Might).

### A fourth wiki contradiction: Eminence of Spring

Reading these lines surfaced one more case of the two wiki sources disagreeing, in the same shape as the three PRR values above.

| Set, tier | Template (rev 723530) | Page (rev 720202) | gear-planner |
|---|---:|---:|---:|
| Eminence of Spring, 6 pieces | +10% Doublestrike and Doubleshot | +15% | 15 |

Eminence of Summer's template entry states +15% for the same tier. The template's history for this entry has not been read. Both affixes are recorded in `WIKI_DISAGREEMENTS` and tracked on #956. Corrupting one record's value made it report stale and sent the set back to `ours-differs`.

## All ability scores (#951, 2026-10-28)

| Wiki phrase | Catalog name | Evidence |
|---|---|---|
| `all Ability Scores`, `all ability scores`, `all of your Ability Scores` | Well Rounded | ddowiki `Template:Stat` rev 678248: its `well rounded` case renders "... bonus to all abilities". The local synonym registry already folds `all Ability Scores` into Well Rounded (`affix_synonyms_registry.json`, #374) |

- gear-planner carries every one of these set lines as `Well Rounded`, at the same type and value.
- **The summon lines are not mapped.** "Your Summons, Charmed Monsters, and Hirelings gain +4 to all Ability Scores" (Deadly Diabolist, three tiers) buffs someone else. It is not a typed clause, so it stays quarantined, and a test pins that.

**Measured on `pages-20261027`:**
- All 25 wearer lines now read, and every one matches gear-planner.
- **Exact sets:** 38 to 41 (template). The page stays at 21.
- **Quarantined:** 280 to 258 (template), 70 to 67 (page).
- **`ours-differs`:** stays at 1. No new wiki disagreement.
