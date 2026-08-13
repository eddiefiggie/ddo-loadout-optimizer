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
| `Spell Intensity` | **record-only** | `Intensity` page's affected-damage-types table lists ONLY the ten element intensities — no "Spell Intensity → All Spells" row (contrast Potency). The two dataset carriers (Solar Gem of Spell Critical Damage) are "**Legendary** Bonus to Spell Critical Damage" (`Lunar_and_Solar_Gems` table) — a distinct bonus type from the Enhancement/Insight/Quality element-intensity channels, so by the type rule it stacks with them regardless; but no page states the universal-name-to-element crediting rule, so no map entry. Stays rankable as its own stat. |
| Element Intensities (Fire/Acid/Healing/Ice/Kinetic/Lightning/Void/Radiance/Repair/Sonic) | targets only | The `Intensity` roster; potential future cross-add targets if a universal crit-damage statement ever lands. |
| `Elemental Spell Power` | **record-only** (misnomer) | Its page: "gives you a +50 bonus to your **maximum spell points**. This stacks with all bonuses except Elemental Spell Power." Not spellpower at all — a self-excepting spell-points bonus. |
| `Greater Elemental Spell Power` | **record-only** (misnomer) | Same page: "+100 bonus to your maximum spell points. This stacks with all bonuses except Greater Elemental Spell Power." |
| Alchemical imbue column (Inferno/Erosion/.../Efficacy) | record-only (standing) | Weapon imbues, not worn-gear enchantments; recorded in `spellpower-universal.md` §3, not re-litigated. |
| Combined/flavored lores (`Blighted Lore`, `Purifying Flame Lore`, `Moonlit Haunt Lore`, `Firestorm Lore`, ...) | excluded targets | `Spell_Lore` "Combined Spell Lore" section defines them as separate multi-element enchantments; not in the ten-name roster, so they receive no universal credit — see the exclusion note in `spell-lore.md` §#290. |
| Flavored spellpowers (`Power of the Flames of Purity`, `Power of the Moonlit Haunt`, ...) | excluded targets | Same reasoning on the spellpower side: not in the `Spell_power` ten-name roster; no wiki statement ties a universal name to them. |
| `Laceration Lore` | excluded (removed) | `Spell_Lore`: removed from the game pre-U19. |

**Residual disclosure:** `Spell Intensity` remains the known case where a universal-looking
name gives an element-ranked priority no credit. That is the wiki's shape today, not a
solver gap; the map gains an entry the day a page states the rule outright.

## Vocabulary-side enumeration result (2026-08-13, run against the built registry)

The committed procedure was executed: 1,430 registry names filtered by the
lore / intensity / spellpower / universal / potency / elemental patterns, then
diffed against the wiki-page rosters above. Three names surfaced that the
page-side pass had not, each now dispositioned:

| Candidate | Disposition | Evidence |
|---|---|---|
| `Arcane Lore` | **record-only** (legacy presence-only) | The `Spell_Lore` page: "The universal Spell Lore (formerly Arcane Lore)". In the dataset it is NOT rankable and its 5 carriers store it as `Bool 1` (magnitude-less legacy parse), so adding it as a cross-add source would inject a bogus +1. If those items are ever re-parsed with magnitudes, it becomes a wiki-backed `cross_add` source candidate under the same USL quote. |
| `Universal Spell Critical Damage` | **record-only** | Not rankable, zero worn-affix carriers; 20 occurrences all live in `parsed_set_bonuses` tiers. Same evidence gap as `Spell Intensity`: no wiki page states a universal-to-element crit-damage crediting rule (the `Intensity` table has no universal row), so no map entry. |
| `Spell Power` (bare) | **record-only** (noise) | Registry-only: zero carriers anywhere in the built data. |

Combined/flavored lores surfaced by the same filter (`Frozen Depths/Storm/
Thunderstorm Lore`, `Ground Lore`, `Silver Flame Lore`, `Creeping Dust Lore`,
`Dark Restoration Lore`, `Thunderstorm Lore`, plus the four named in the table
above) are covered by the standing combined-lore exclusion in
`spell-lore.md` §#290. Everything else the filter matched is either an
already-dispositioned name or non-lore vocabulary noise (sentence-shaped
registry entries). **The sweep is closed: 20 cross-add entries, zero new
expansion entries, every candidate carries a recorded disposition.**
