# Compound spellpower and lore attribution (#928)

Reviewed locally on 2026-11-04 against main
`96614a5f53e111c1fa5a7b4e1d6d04e48f52f8f6`. This fixes the fully representable
subset below; it does not resolve all of #928.

The initiating reports were [peng, September 30](https://forums.ddo.com/index.php?threads/ddo-loadout-optimizer-your-best-in-slot-gear-proven-by-math.29709/post-443342)
and [galvarian, November 2](https://forums.ddo.com/index.php?threads/ddo-loadout-optimizer-your-best-in-slot-gear-proven-by-math.29709/post-457897).
They identify the attribution problem; the game mechanics below come from the
retained Wiki evidence, not from inference about those reports.

## Source and limits

The actual rendered definitions are committed in
[`affix_tooltip.json`](../../data/seed/compendium/affix_tooltip.json), keyed by
exact enchantment name. Its capture method is a paced same-origin read of the
carrier page's rendered `span.tooltip`; each record includes its carrier URL,
label, full tooltip, provenance, and capture date. Most definitions below were
captured on **2026-09-04**; Frozen Thunderstorm Power was captured on
**2026-09-22**. Those records carry neither Wiki revision ID nor time of day.
They are retained evidence, not newly verified November definitions.

Supplemental lookup on November 4 encountered a non-retryable robots.txt denial.
No alternate transport was used. Unretained newer wording is not substituted for
these captures. In particular, a reported broader Flames of Purity power
definition does not prove its lore's coverage.

For Epic Storm, the retained tooltips explicitly state:

- `Power of the Thunderstorm +111: Passive: +111 Equipment bonus to Sonic and Electric Spell Power.`
- `Thunderstorm Lore +16: Passive: Your Sonic and Lightning spells gain a +16% Equipment bonus to their chance to critical hit.`

## Admitted components

Each row grants the **full magnitude** to every listed component, at the
**source's own bonus type**. The order is the tooltip's order and is also the
order used by the existing saved-priority substitution. Power and lore were
verified independently; one never supplies evidence for the other.

| Spellpower enchantment | Complete existing stat buckets | Retained Wiki carrier |
|---|---|---|
| Power of Creeping Dust | Glaciation, Corrosion | [Creeping Dust Conduit](https://ddowiki.com/page/Item:Creeping_Dust_Conduit) |
| Power of the Dark Restoration | Nullification, Devotion | [Alaric's Grim Gauntlets](https://ddowiki.com/page/Item:Alaric%27s_Grim_Gauntlets) |
| Power of the Firestorm | Combustion, Magnetism | [Cloak of the Artblade](https://ddowiki.com/page/Item:Cloak_of_the_Artblade) |
| Power of the Frozen Depths | Nullification, Glaciation | [Black Pearl Ring](https://ddowiki.com/page/Item:Black_Pearl_Ring) |
| Power of the Frozen Storm | Glaciation, Magnetism | [Bottled Rainstorm](https://ddowiki.com/page/Item:Bottled_Rainstorm) |
| Power of the Frozen Thunderstorm | Glaciation, Resonance, Magnetism | [The Volley's Aria](https://ddowiki.com/page/Item:The_Volley%27s_Aria) |
| Power of the Silver Flame | Devotion, Radiance | [Epic Pillar of Light](https://ddowiki.com/page/Item:Epic_Pillar_of_Light) |
| Power of the Thunderstorm | Resonance, Magnetism | [Epic Storm](https://ddowiki.com/page/Item:Epic_Storm) |

The Frozen Storm exemplar is **Insight +74**, not Equipment. Bottled Rainstorm
also carries Quality +36 in the built data. Expansion preserves both types;
there is no default-to-Equipment rewrite.

| Lore enchantment | Complete existing stat buckets | Retained Wiki carrier |
|---|---|---|
| Creeping Dust Lore | Ice Lore, Acid Lore | [Creeping Dust Conduit](https://ddowiki.com/page/Item:Creeping_Dust_Conduit) |
| Dark Restoration Lore | Void Lore, Healing Lore | [Alaric's Grim Gauntlets](https://ddowiki.com/page/Item:Alaric%27s_Grim_Gauntlets) |
| Firestorm Lore | Fire Lore, Lightning Lore | [Firestorm Conduit](https://ddowiki.com/page/Item:Firestorm_Conduit) |
| Frozen Depths Lore | Void Lore, Ice Lore | [Black Pearl Ring](https://ddowiki.com/page/Item:Black_Pearl_Ring) |
| Frozen Storm Lore | Ice Lore, Lightning Lore | [Echo of Wave](https://ddowiki.com/page/Item:Echo_of_Wave) |
| Silver Flame Lore | Healing Lore, Radiance Lore | [Epic Pillar of Light](https://ddowiki.com/page/Item:Epic_Pillar_of_Light) |
| Thunderstorm Lore | Sonic Lore, Lightning Lore | [Epic Storm](https://ddowiki.com/page/Item:Epic_Storm) |

## Deliberately unchanged compounds

No partial expansion is made. Removing a compound after crediting only its
representable portion would lose the remainder and change the meaning of a saved
compound priority. These gaps remain within #928.

| Names | Reason the entire compound remains unchanged |
|---|---|
| Power of the Blight; Blighted Lore | Acid, Negative, Poison **and Evil only**. Corrosion/Acid Lore and Nullification/Void Lore fit, but Evil cannot fill Radiance/Radiance Lore, which also cover Light and other alignments. Even the safe portions remain unexpanded to preserve the original whole name. |
| Power of the Moonlit Haunt; Moonlit Haunt Lore | Negative, Poison **and Force only**. Nullification/Void Lore fit, but Impulse and Kinetic Lore additionally cover Physical and Untyped; no such credit is justified. |
| Power of the Flames of Purity; Purifying Flame Lore | Retained definitions say Fire **and Light only**. Combustion/Fire Lore fit, but Radiance/Radiance Lore additionally cover Alignment. |
| Power of the Flames of Darkness; Power of the Sacred Ground | No direct retained component definition. |
| Frozen Thunderstorm Lore; Sacred Ground Lore | No direct retained lore definition; the power names do not establish one. |

The elementary bucket definitions themselves are retained in the same tooltip
file. Nullification and Void Lore cover Negative and Poison together. Radiance
and Radiance Lore cover Light and Alignment together. Impulse covers Force,
Untyped, Slashing, Piercing, and Bludgeoning; Kinetic Lore covers Force, Physical,
and Untyped. These boundaries are why spelling resemblance cannot license a map.

## Mechanism and compatibility

`src/spell_focus.py` supplies the existing same-type expansion used by Potency,
Spell Lore and Elemental Resonance. Components compete with native and other
expanded sources in the existing maximum-per-stat/type buckets. Different types
add. Universal Spell Power and Universal Spell Lore remain separate cross-add
sources; no new stacking exception or optimization objective is introduced.

The older `umbrella_adjudications.json` rulings incorrectly treated seven fully
representable lore compounds as indivisible merely because they were not
universal. Their own recorded fixed element lists are sufficient for expansion;
no rule making a Universal source add to a compound name is necessary. Those
rulings are retired with the earlier evidence preserved. The three boundary
compound rulings now state the actual representational limitation.

Each component retains `via` for the engraved display name and `origin_stat` for
the exact source identity. The latter lets a saved compound/type exclusion keep
excluding **that source only**. It does not exclude native component bonuses.
A shared temporary scoring view applies source exclusions before dominance and
per-carrier maximum selection, then restores the original records for item
receipts. Caller data is unchanged. Crafting metadata likewise restores the full
physical option's affixes for display. The LP and stacking mathematics are
unchanged.

Saved priorities use the existing ordered substitution and deduplication, with
an on-load disclosure. A compound now consumes one strict lexicographic rank per
component, preserving the order of other priorities. Historical compound bounds
are removed and disclosed by the existing policy; they are not guessed into
component constraints. Full-value declared credits split at full magnitude and
same type before orphan cleanup, keeping the highest of overlapping same-type
credits. Original compound exclusions remain saved under their original name,
and each relevant component's Advanced panel shows the source-specific exclusion
with an explicit removal control, including on subsequent reloads.

## Regression evidence

`tests/test_compound_spell_attribution.py` exercises exact independently stated
scopes, all source fields, types, set and atomic-option expansion, exclusions,
and real built records. `tests/compound-spells.test.js` uses the rebuilt dataset,
the actual model and HiGHS, plus rendered result/export functions. It covers
same-type competition, different types, universal cross-adds, priority/credit
migration, preserved source exclusions, lower native fallback on the same host,
dominance, and source controls after reload.

The independent base rebuild gives Epic Storm **20 Magnetism, 20 Resonance,
0 Lightning Lore and 0 Sonic Lore**; the 111 Power and 16 Lore sit under standalone
compound names. The rebuilt branch gives **131, 131, 16 and 16**, respectively,
and the proof display names the original enchantments. This controlled real-item
solve isolates attribution from unrelated equipment choices.

Pre-change checks use actual archived main and a separately rebuilt base dataset,
not reconstructed files. Compatibility guards intentionally preserve unchanged
behavior; a second old-code/current-data run distinguishes the newly required
source-exclusion logic from the pre-expansion baseline.

The build guard in `src/compound_spell_evidence.py` checks the actual source
names before expansion and all emitted affix channels after assembly. It rejects
unreviewed Power/combined Lore names, altered component mappings, missing source
provenance, changed exact retained tooltip text, and an empty inspection. Per-name
digests detect definition drift without coupling this ruling to unrelated tooltip
edits. The stamped `metadata.compound_spell_evidence` reports the inspected
population rather than presenting a dated claim as future completeness. Corruption
tests deliberately exercise those failures.
