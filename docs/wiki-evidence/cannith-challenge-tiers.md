# Cannith Challenge upgrade tiers — the Vaults of the Artificers stat gap

**Harvested:** 2026-08-29 · **Issue:** #313 · **Shard:** `data/seed/compendium/cannith_challenge_tiers.json`

## The gap, measured

gear-planner emits **no enchantments at all** for a Vaults of the Artificers item whose
wiki page uses the `Upgradeable - Tier N` layout. It emits only a marker affix, and the
marker differs by item kind:

| Marker | Variants | What they are |
|---|---|---|
| `VotAU` | 33 | worn gear — this shard |
| `Upgradeable - Tier` | 64 | weapons — deferred, see below |
| **total stat-less** | **97 of 140** | |

The items that DO parse are the ones whose wiki page has a flat enchantment list and no
tier headers — `Cloak of Flames (level 3)` and its siblings. That is the whole pattern:
the tiered layout defeats the upstream parser, the flat one does not.

## Correcting the count in the issue

#313 filed this as **94 variants** carrying `See the item description page for details.`
A 2026-08-29 comment on that issue narrowed it to **33**, on the grounds that the
placeholder had changed shape to `VotAU`. **That narrowing was wrong**, and the original
94 was close to right.

The error was reading one marker and calling it the population. `VotAU` is the worn-gear
marker; weapons carry `Upgradeable - Tier` instead, and a variant carrying three
`Upgradeable - Tier` affixes reads as "has 3 affixes" to any count that does not name
the markers. The true stat-less population is **97**, and 33 is only its worn half.

This is the `a count is a claim about a population` rule failing in exactly the documented
way — a correction that read only the first clause. Recorded here so the next reader gets
the population, not the marker.

## What the wiki carries, and the tier arithmetic

Each page states a base tier and two upgrade tiers, the upgrades written as transitions:

```
Upgradeable - Tier 1 / Combustion +110 / Fire Lore +16% / Fire Absorption +27% / ...
Upgradeable - Tier 2 / Combustion +110 -> Combustion +116 / Adds Colorless Augment Slot
Upgradeable - Tier 3 / Combustion +116 -> Combustion +122 / Adds Green Augment Slot
```

`A -> B` REPLACES; `Adds X` appends. The shard records **the fully-upgraded state**,
matching the founding position that theoretical best-in-slot assumes access to everything.
Every tier's verbatim text is kept in the shard's `raw`, so a different tier choice never
needs a re-harvest.

`src/cannith_tiers.py` derives `final` from `raw`, and `tests/test_cannith_tiers.py`
re-derives all 33 and fails on any disagreement — a hand-edited `final` cannot ship.

## Where the bonus type comes from — the hard half

**The wiki states magnitudes and never bonus types.** It writes `Combustion +122`, not
`Combustion +122 Equipment`. A type cannot be guessed: it decides the stacking bucket, so
a wrong one double-counts against a real source or silently overwrites it, and neither is
visible in a finished loadout.

It also cannot be defaulted to one value, because gear-planner assigns several *within
this family*. Two sources are used, in order, and both are upstream's own answer:

1. **The family's parsed sibling** — the lower tier gear-planner did read. On the level-3
   siblings: spell powers and lores are `Equipment`, `Wizardry`/`Deception`/`Seeker` are
   `Enhancement`, `Disable Device`/`Open Lock` are `Competence`.
2. **A catalog-wide unanimous type** — used only where every record carrying the name
   agrees.

Anything else is quarantined. That split is the evidence the rule is safe rather than
merely cautious: the presence flags are unanimous (`Manslayer`, `Ghostly`, `Ethereal`,
`Staggering Blow`, `Anthem`, the guards — all `Bool`), while every numeric stat it would
otherwise reach for carries three competing types:

| Stat | Types in the catalog | Verdict |
|---|---|---|
| `Dodge` | Enhancement / Insight / Quality | quarantined |
| `Fire Absorption` | Enhancement / Insight / Quality | quarantined |
| `Doublestrike` | Enhancement / Insight / Quality | quarantined |
| `Use Magic Device` | Competence / Insight / Quality | quarantined |

So Epic Spare Hand's `Doublestrike 12%` stays out — quarantined *because* it is valuable
enough that a wrong bucket would matter.

### The two vocabularies

The wiki writes the display name; gear-planner writes its own. `Combustion` is
`Fire Spell Power` upstream, `Resonance` is `Sonic Spell Power`, `Magnetism` is
`Electric Spell Power`, `Corrosion` is `Acid Spell Power`. The sibling map is keyed on the
CANONICAL name and stores the RAW one, and the shard emits raw — so an overlay affix
travels the identical normalization path a natively-parsed one does. Keying on the raw
name alone silently matched nothing for every elemental spell power on every one of these
items, which is most of the value here.

## Bundled enchantments are refused

`Heightened Awareness`, `Parrying`, `Riposte` and `Speed` are bundled: the visible cell
names the effect and the **tooltip** carries the numbers, and this pipeline splits each
from a per-item tooltip shard. Admitting one folded inserts an instance the splitter has
no evidence for. The build guards refused it on the first attempt, correctly. These need
their own paced tooltip harvest before these items can carry them.

## Outcome

| | |
|---|---|
| Variants covered | 33 of 33 worn |
| Affixes admitted | 108 |
| Quarantined | 40 augment slots, 19 unknown names, 17 unsourced types, 8 bundled, 4 clickies, 1 ambiguous |
| Golden solves changed | **none** — an ML32+ solve does not want ML7–20 gear |

The reported case is fixed: `Epic Cloak of Flames` now carries `Combustion Equipment 122`
and `Fire Lore Equipment 18` — the exact values #313's body names as the hand-declared
workaround.

## Deferred: the 64 weapons

Harvested and measured in the same pass, not admitted. Their tier enchantments are almost
entirely bane and proc effects — `Dragon Bane`, `Tidal Burst`, `Crushing Wave`,
`Incandescence`, `Screaming` — which this optimizer does not value numerically. **#331**
(proc magnitude, rate and uptime valuation) is the prerequisite for them being worth
anything, so admitting them now would add records that score nothing.

Harvest method: `docs/wiki-evidence/harvest-method.md`. All 33 blocks were verified
byte-faithful against the live pages by per-item hash before transcription was trusted.
