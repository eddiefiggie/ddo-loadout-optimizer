# Elemental Resistance — a bundled compound, expanded per item (#191)

**Ruled:** 2026-08-13. **Method:** same-origin harvest per `harvest-method.md`;
invocation lines via `action=query` revisions, rendered tooltips via batched
`action=parse` (including per-item transclusion renders). **Shard:**
`data/seed/compendium/elemental_resistance.json`. **Module:**
`src/elemental_resistance_split.py`.

## The ruling

`{{Elemental Resistance|Elemental|N|...}}` is a bundled template. Its rendered
tooltip states a per-element grant at FULL magnitude:

> `Elemental Resistance +45: Passive: +45 Enhancement bonus to your Acid, Cold,
> Electricity, Fire, and Sonic Resistances.` (with `4=yes`)
>
> `Elemental Resistance +45: Passive: +45 Enhancement bonus to your Acid, Cold,
> Electricity, and Fire Resistances.` (without)
>
> `Competence Elemental Resistance - 15: This item provides a +15 Competence
> bonus to your Acid, Cold, Fire, and Electrical resistances.` (legacy dialect,
> Competence/Insight; never states Sonic)

The visible cell reads `Elemental Resistance +N` in every case. The optimizer
stored the compound as ONE untargeted stat, so a player ranking `Fire
Resistance` scored nothing from any of the 58 carriers — the same defect shape
as `Elemental Absorption` (#249, `compound-absorption.md`), one template over.

**Sonic is a per-item fact.** The template's named `4=` parameter
(`yes`/`y`/`1` observed in the wild) adds Sonic; absence is the template's own
no-Sonic branch, not silence. gear-planner stores nothing that distinguishes
the two renderings, so the flag is per-item wiki evidence in the shard.

**Element sets are per-affix, not per-item.** Epic Chain of Conviction and Epic
Death's Rampart each carry TWO `Elemental Resistance` affixes with different
element sets — Enhancement 30 *with* Sonic beside Insight 10 *without* — so the
shard keys its readings by bonus type, and the split module joins by
item + type.

**The legacy dialect's visible label lies about the type.** The
Competence/Insight rendering's visible text reads `Competence Elemental
Resistance - N` even when the tooltip states an Insight bonus (Barnacled
Buckler, the Jeweled Cloak epics, the two Epic U-items). The tooltip is the
authority, per `bundled-template-values-live-in-the-tooltip-not-the-cell.md`;
gear-planner's stored types already follow the tooltip.

**Single-element invocations are out of scope.** `{{Elemental
Resistance|Cold|51}}` (Sphere of Waves) renders `Cold Resistance +51` and
gear-planner already stores it under the per-element name. No `Elemental
Resistance` affix is produced for these, so the split module rejects the form
by construction.

## The census (all 58 carriers, 60 affix records, provenance `stated`)

Sonic included — 6 carriers, all Enhancement-typed:

| Item | Invocation |
|---|---|
| Dumathoin's Bracers | `{{Elemental Resistance\|elemental\|45\|4=yes}}` |
| Storm in a Bottle | `\|elemental\|45\|4=yes` |
| Aspect of the Wild Hunt | `\|Elemental\|45\|4=yes` |
| Flower Boots | `\|elemental\|45\|4=1` |
| Epic Chain of Conviction | `\|Elemental\|30\|4=y` |
| Epic Death's Rampart | `\|Elemental\|30\|4=1` |

Four elements — everything else: 6 Enhancement carriers (Perfected Ring of
Elemental Essence 45, Legendary Lightning Railworker's Boots 45, Lightning
Railworker's Boots 30, Draconic Soul Gem 30 — an AUGMENT, the one carrier
outside the item channel — Epic/Legendary Immaculate Globe 30/45), 6 Insight
records at 10, and 42 Competence records (the Downcast, Crownblade, and
Crownblade's Reflection armor families, Cloak of Moonlight, Emblem of Elemental
Evil, Control/Absorption Gauntlets, Terrorweb Chitin Breastplate, Implement of
the Deep Woods, the heroic Jeweled Cloaks, Resonation — heroic 5 / legendary
15).

Every record carries three witnesses: the invocation, the invocation-keyed
snapshot, and the item's own rendered tooltip (read via per-item transclusion
renders and verified byte-identical to the parametric dialect strings before
export). The build guard re-asserts all three against each other on every
build.

## What changed

Each compound affix expands into its per-element resistances at full magnitude,
preserving bonus type and stamping the compound as provenance. The compound
name leaves the picker and redirects to the union of five (`Acid / Cold / Fire /
Electric / Sonic Resistance` — the dataset's spellings; the tooltip's
"Electricity"/"Electrical" is not a stored stat name). Quarantine is removal,
mirroring absorption: an unharvested future carrier has its compound affix
removed and disclosed, never left unrankable. The expansion runs on BOTH the
item channel and the augment pool (#293's channel lesson — Draconic Soul Gem is
augment-only).
