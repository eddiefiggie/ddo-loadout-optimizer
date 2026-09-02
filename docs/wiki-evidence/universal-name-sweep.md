# Wiki evidence — universal-name sweep dispositions (#292)

**Harvest:** Claude-in-Chrome, same-origin reads of ddowiki (rendered text), 2026-08-13.
**Enumeration procedure (committed, auditable):** dataset vocabulary names matching the
spellpower / lore / intensity / "universal" / "potency" family patterns, unioned with the
stat rosters printed on the wiki `Spell_power`, `Spell_Lore`, and `Intensity` pages. Every
candidate below carries a disposition; a name absent from this table was not swept — the
closure evidence for #292 is this list, not "what was found."

Classification key:
- **expand** — wiki states a same-type universal umbrella (the Potency shape) → `_UNIVERSAL` table.
- **cross-add** — wiki states fully-stacking / flat-adds (the USP shape) → `cross_add` map.
- **record-only** — no outright wiki statement, or the name is not what it appears to be.
  No table entry; the stat stays independently rankable where it exists.

| Candidate | Disposition | Evidence |
|---|---|---|
| `Potency` | expand (SHIPPED, PR #294) | `Spell_power` affected-types row "Potency → All Spells"; see `spellpower-universal.md` §1–2 |
| `Universal Spell Power` | **cross-add** (#291) | `Spell_power` §Universal Spell Power: "Fully stacking. It flat adds to all of your other Spell Powers"; see `spellpower-universal.md` §3 |
| `Spell Lore` (universal) | **cross-add** (#290) | `Spell_Lore` "Spell Lore - all spell types" + `Universal_Spell_Lore` "separate and stacking source ... will stack with another item with a Spell Lore or Acid Lore Equipment bonus"; see `spell-lore.md` §#290 |
| `Universal Spell Lore` | **cross-add** (#290) | same USL quote, stated outright for this name; see `spell-lore.md` §#290 |
| `Spell Critical Damage` (was `Spell Intensity`) | **record-only** | `Intensity` page's affected-damage-types table lists ONLY the ten element intensities — no universal → All Spells row (contrast Potency). The three dataset carriers (Solar Gem of Spell Critical Damage, Heroic/Epic/Legendary) are "**Legendary** Bonus to Spell Critical Damage" (`Lunar_and_Solar_Gems` table) — a distinct bonus type from the Enhancement/Insight/Quality element-intensity channels, so by the type rule it stacks with them regardless; but no page states the universal-name-to-element crediting rule, so no map entry. Stays rankable as its own stat. | **Re-verified 2026-08-20 on a player report (#402) — ruling UPHELD and upgraded from an evidence gap to a positive finding; see the section below. RENAMED 2026-09-02 (#672) — see §Rename below; the crediting ruling is unchanged.**
| Element Intensities (Fire/Acid/Healing/Ice/Kinetic/Lightning/Void/Radiance/Repair/Sonic) | targets only | The `Intensity` roster; potential future cross-add targets if a universal crit-damage statement ever lands. |
| `Elemental Spell Power` | **record-only** (misnomer) | Its page: "gives you a +50 bonus to your **maximum spell points**. This stacks with all bonuses except Elemental Spell Power." Not spellpower at all — a self-excepting spell-points bonus. |
| `Greater Elemental Spell Power` | **record-only** (misnomer) | Same page: "+100 bonus to your maximum spell points. This stacks with all bonuses except Greater Elemental Spell Power." |
| Alchemical imbue column (Inferno/Erosion/.../Efficacy) | record-only (standing) | Weapon imbues, not worn-gear enchantments; recorded in `spellpower-universal.md` §3, not re-litigated. |
| Combined/flavored lores (`Blighted Lore`, `Purifying Flame Lore`, `Moonlit Haunt Lore`, `Firestorm Lore`, ...) | excluded targets | `Spell_Lore` "Combined Spell Lore" section defines them as separate multi-element enchantments; not in the ten-name roster, so they receive no universal credit — see the exclusion note in `spell-lore.md` §#290. |
| Flavored spellpowers (`Power of the Flames of Purity`, `Power of the Moonlit Haunt`, ...) | excluded targets | Same reasoning on the spellpower side: not in the `Spell_power` ten-name roster; no wiki statement ties a universal name to them. |
| `Laceration Lore` | excluded (removed) | `Spell_Lore`: removed from the game pre-U19. |

**Residual disclosure:** `Spell Critical Damage` remains the known case where a
universal-looking name gives an element-ranked priority no credit. That is the wiki's
shape today, not a solver gap; the map gains an entry the day a page states the rule
outright.

## Rename 2026-09-02 (#672): `Spell Intensity` -> `Spell Critical Damage`

**The crediting ruling above is untouched.** That ruling is about the universal-name-to-
element axis and stays closed. This section records a different question, asked and
answered separately: whether the name we stored on the Solar Gems was the right name.

It was not. Two stored names were one stat:

| stored name | carriers before the fold | bonus type |
|---|---|---|
| `Spell Intensity` | 3 Solar Gems (Heroic/Epic/Legendary, 5/10/15) | Legendary |
| `Spell Critical Damage` | 8 distinct sets, 0 item affixes | Legendary |

The eight sets span BOTH containers, which is why they are easy to miscount:
`membership_set_defs` holds Delight of the Devourer, Vol's Influence, their Legendary
variants and Deacon of the Auricular Sacrarium; the per-item `parsed_set_bonuses` copy
holds Deacon again plus the whole Elder's Knowledge chain (Elder's / Epic / Legendary,
5/10/15). Reading one container and calling it the population produced a wrong count
three separate times on #672 — twice in the issue's own comments and once in the
write-up of this fix. A `parsed_set_bonuses` entry is a TIER whose `affixes[]` carry
`stat`; looking for `name` on the tier itself returns nothing and reads as zero.

`Lunar_and_Solar_Gems` states the gem's effect as a "Legendary Bonus to Spell Critical
Damage" at +5/+10/+15 for ML1/ML20/ML30. gear-planner attaches `Spell Intensity` to items
titled exactly `Solar Gem of Spell Critical Damage`. Both sources describe the same three
named objects at the same bonus type and the same magnitudes, so the names are two
spellings of one stat. The population closes: `Spell Intensity` had exactly three
carriers and all three were those gems, so no occurrence meant anything else.

Same bonus type on both sides made the split a live defect rather than a cosmetic one.
Bucket keys are `stat||type`, so two names meant two buckets and the contributions would
SUM — against the same page's rule that same-typed effects do not stack. The gems were
also invisible to a player who ranked the set name: measured at ML5, where the Heroic
gem is the only reachable source, the pre-fold solve credited 0.

`affix_name_corrections.json` mints the wiki name; `affix_aliases.json` keeps
`Spell Intensity` resolving for builds saved before the fold, where it was the rankable
canonical. The `COMPANION_STATS` hint in `web/dataset.js` moved to the new name.

**Note on the read that settled it.** #672 specified enumerating
`Category:Legendary Spell Critical Damage +15% items` and checking membership. That
category is empty and no per-variant gem item page exists — the gems are documented only
as rows on `Lunar_and_Solar_Gems`, so the specified read could never have returned
anything. Worth remembering when a category page is proposed as evidence.

**And the sentence was already here.** The row above has quoted the decisive gem
phrasing since the 2026-08-20 harvest. #672 was filed asking for a fresh wiki read whose
answer was already in this file. Check the evidence store before scheduling a harvest.

## Vocabulary-side enumeration result (2026-08-13, run against the built registry)

The committed procedure was executed: 1,430 registry names filtered by the
lore / intensity / spellpower / universal / potency / elemental patterns, then
diffed against the wiki-page rosters above. Three names surfaced that the
page-side pass had not, each now dispositioned:

| Candidate | Disposition | Evidence |
|---|---|---|
| `Arcane Lore` | **record-only** (legacy presence-only) | The `Spell_Lore` page: "The universal Spell Lore (formerly Arcane Lore)". In the dataset it is NOT rankable and its 5 carriers store it as `Bool 1` (magnitude-less legacy parse), so adding it as a cross-add source would inject a bogus +1. If those items are ever re-parsed with magnitudes, it becomes a wiki-backed `cross_add` source candidate under the same USL quote. |
| `Universal Spell Critical Damage` | **record-only** | Not rankable, zero worn-affix carriers; 20 occurrences all live in `parsed_set_bonuses` tiers. Same evidence gap as `Spell Critical Damage` (renamed from `Spell Intensity`, #672): no wiki page states a universal-to-element crit-damage crediting rule (the `Intensity` table has no universal row), so no map entry. |
| `Spell Power` (bare) | **record-only** (noise) | Registry-only: zero carriers anywhere in the built data. |

Combined/flavored lores surfaced by the same filter (`Frozen Depths/Storm/
Thunderstorm Lore`, `Ground Lore`, `Silver Flame Lore`, `Creeping Dust Lore`,
`Dark Restoration Lore`, `Thunderstorm Lore`, plus the four named in the table
above) are covered by the standing combined-lore exclusion in
`spell-lore.md` §#290. Everything else the filter matched is either an
already-dispositioned name or non-lore vocabulary noise (sentence-shaped
registry entries). **The sweep is closed: 20 cross-add entries, zero new
expansion entries, every candidate carries a recorded disposition.**

---

## 2026-08-20 re-verification: `Spell Intensity` (#402)

> **Naming note.** This section is the 2026-08-20 record and uses the name as it
> stood then. The stat was renamed to `Spell Critical Damage` on 2026-09-02 (#672,
> §Rename above); read every `Spell Intensity` below as that name. The ruling this
> section upholds is unaffected — it is about element crediting, not spelling.

A player reported the consequence of this ruling as a bug:

> I put void Intensity higher in my priorities than nullification to check if it
> would put the critical damage gem in rather than spellpower, and it did not.

Re-harvested rather than defended, per the #366 precedent. The ruling **stands**,
and the basis is no longer "no statement found" — it is three independent reads
that each say the same thing.

**1. The `Intensity` page's affected-damage-types table lists ten element rows
and no universal row.** Its lead says only "Spell Intensity items offer a bonus
to your Spell Critical Damage" — what it grants, never which spells it covers.

**2. The control makes that absence meaningful.** `Spell power` carries the
structurally identical table, and it *does* have the universal row:

```
Potency    Efficacy    All Spells (tends to be a smaller value at similar levels)
```

plus prose throughout ("the highest all-type Potency bonus is +100", "all-type
Insight Potency bonus is +50"). So the Intensity table is not merely incomplete —
the same wiki, in the same shape, states the universal case when there is one.

**3. `Spell critical` has a `Universal` subsection for critical CHANCE and none
for critical DAMAGE.** Every crit-damage source it lists enumerates its elements
("+2% Fire, Cold, Electric, Acid, and Poison Spell Critical Damage"; "+5% Spell
Critical Damage with Fire, Cold, Acid, Electric, and Force Spells"). If a
universal crit-damage source existed, that section is where the wiki would name
it.

**Consequence, measured at ML32.** The two stats are separate and both reachable:

```
ranks "Void Intensity"   -> Void Intensity 35   crit-damage gem placed: (none)
ranks "Spell Intensity"  -> Spell Intensity 15  crit-damage gem placed: Solar Gem of
                                                Spell Critical Damage (Legendary)
```

Nothing is broken. The gem is credited the moment the stat it actually carries is
ranked.

**What this leaves open is a disclosure problem, not a data one** (filed
separately): a player ranking `Void Intensity` is never told that `Spell
Intensity` exists as a second, separately-rankable source of the same in-game
number. Ranking the element name and silently getting nothing from an augment
labelled "Spell Critical Damage" is a dead end the tool can and should close.

**Do not re-open the crediting question without a new wiki statement.** This is
now the second time it has been asked. A third pass should read this section and
stop, unless the `Intensity` page has gained a universal row.
