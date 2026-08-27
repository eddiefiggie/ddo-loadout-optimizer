# Riposte — version evidence

**Harvested 2026-08-27** from ddowiki, same-origin from a ddowiki tab (the only
transport that works — see `harvest-method.md`). Every number below is read out
of a rendered tooltip or out of an item page's own wikitext. Nothing here is
derived.

Shard: `data/seed/compendium/riposte_version.json` (35 records — 33 items and 2
augments). 100% `stated` — no `defaulted`, no `unsourced`.

This is the evidence behind `src/riposte_split.py` and the #546 fix. It exists
because a player reported that `Legendary Sapphire of Riposte` "does not split up
into its components the way it should", and validating that turned up a second,
larger defect they had not hit.

## The ruling

**`Riposte` is a bundled enchantment, not a stat, and its two halves are not the
same number.** `https://ddowiki.com/page/Riposte`, post-U19 section, verbatim:

```
Type: Suffix
Base price modifier: varies, +1 per X
Effect:

  When Missed in Melee: Deals X - 4*X damage to your attacker.
  Passive: +X/2 (round up) Insight bonus to Armor Class,
           +X/2 (round down) Insight bonus to Fortitude, Reflex, and Will Saving Throws.

Notes:

  Available mostly on weapons and shields.
  Same effect as Parrying, therefore bonuses does not stack.
```

Two things follow, and the second is the one that bites.

## 1. It ships in two dialects, and the stored number cannot tell them apart

Exactly the trap `parrying-versions.md` documents, one affix over. Upstream
stores the numeral, flattened:

| Stored value | Items | Actually |
|---|---|---|
| 1 | 1 | Arabic `+1` — grants 1 AC / 1 saves |
| 2 | 5 | all Arabic `+2` — grant 2 / 2 |
| 3 | 1 | Arabic `+3` — grants 3 / 3 |
| 4 | 5 | 3 are Roman `IV` (grant **2** / 2); 2 are Arabic `+4` (grant 4 / 4) |
| 5 | 1 | Roman `V` — grants **3** / **2** |
| 6 | 10 | 1 is Roman `VI` (grants **3** / 3); 9 are Arabic `+6` (grant 6 / 6) |
| 7 | 3 | 2 are Roman `VII` (grant **4** / **3**); 1 is Arabic `+7` (grants 7 / 7) |
| 8 | 3 | all Roman `VIII` — grant **4** / 4 |
| 9 | 2 | all Roman `IX` — grant **5** / **4** |
| 10 | 2 | all Roman `X` — grant **5** / 5 |
| 11 | 1 | Roman `XI` — grants **6** / **5** |
| 12 | 1 | Roman `XII` — grants **6** / 6 |

The sharpest case: **`Emerald Twilight` (Roman VII) and `Legendary Planar Lariat`
(Arabic +7) both store `7`.** The first grants +4 AC and +3 saves; the second
grants +7 and +7. No rule reading the stored magnitude can produce both answers,
which is why the version is harvested per item rather than inferred.

**16 of the 35 records are Roman** and were overstating their grant by roughly 2x
before this fix.

## 2. The AC half and the saves half differ

This is what separates Riposte from Parrying, and it is the trap a "make it work
like Parrying" fix falls into. Parrying grants the *same* magnitude to Armor
Class and to all three saves. Riposte rounds the AC **up** and the saves
**down**, so the two differ on every odd numeral:

| Invocation | Rendered tooltip | AC | Saves |
|---|---|---|---|
| `{{Riposte\|1}}` | Riposte +1: … granting a +1 Insight bonus to AC and to Saves. | 1 | 1 |
| `{{Riposte\|2}}` | … +2 Insight bonus to AC and to Saves. | 2 | 2 |
| `{{Riposte\|3}}` | … +3 … | 3 | 3 |
| `{{Riposte\|4}}` | … +4 … | 4 | 4 |
| `{{Riposte\|5}}` | … +5 … | 5 | 5 |
| `{{Riposte\|6}}` | … +6 … | 6 | 6 |
| `{{Riposte\|7}}` | … +7 … | 7 | 7 |
| `{{Riposte\|II}}` | Riposte II: When Missed by an attack: Deals 2 to 8 damage to your attacker. Passive: +1 Insight bonus to Armor Class, +1 Insight bonus to Fortitude, Reflex, and Will Saving Throws. | 1 | 1 |
| `{{Riposte\|III}}` | … Deals 3 to 12 … +2 AC, **+1** saves | 2 | **1** |
| `{{Riposte\|IV}}` | … Deals 4 to 16 … +2 AC, +2 saves | 2 | 2 |
| `{{Riposte\|V}}` | … Deals 5 to 20 … +3 AC, **+2** saves | 3 | **2** |
| `{{Riposte\|VI}}` | … Deals 6 to 24 … +3 AC, +3 saves | 3 | 3 |
| `{{Riposte\|VII}}` | … Deals 7 to 28 … +4 AC, **+3** saves | 4 | **3** |
| `{{Riposte\|VIII}}` | … Deals 8 to 32 … +4 AC, +4 saves | 4 | 4 |
| `{{Riposte\|IX}}` | … Deals 9 to 36 … +5 AC, **+4** saves | 5 | **4** |
| `{{Riposte\|X}}` | … Deals 10 to 40 … +5 AC, +5 saves | 5 | 5 |
| `{{Riposte\|XI}}` | … Deals 11 to 44 … +6 AC, **+5** saves | 6 | **5** |
| `{{Riposte\|XII}}` | … Deals 12 to 48 … +6 AC, +6 saves | 6 | 6 |

All eighteen rendered individually via one `action=parse` POST each. Verbatim
tooltips live in the shard's `snapshots` block and are asserted on every build.

### The Roman mapping is a lookup, not a formula

Every one of the eleven Roman points fits `X/2`. It is stored as a lookup anyway,
for the reason Parrying's is: a numeral **nobody has rendered** must be
quarantined rather than computed. `src/riposte_split.ROMAN_MAGNITUDE` holds
exactly the eleven confirmed entries and the build guard fails on any numeral
outside them.

**There is deliberately no `I` entry.** The wiki lists no `Riposte I` — the
Arabic `+1` items are a different dialect. Adding `I -> 1` because the pattern
allows it would be inventing a value, and Parrying is the cautionary case in the
other direction: there, `I` renders 1, which breaks every ratio that fits its
`IV` and `VIII`.

### The Arabic "Saves" shorthand covers all three saves

The Arabic tooltip says "to AC and to Saves"; the Roman one enumerates
"Fortitude, Reflex, and Will Saving Throws". These are the same grant written two
ways, and DDO has exactly those three saving throws. This is the one interpretive
step in this document, recorded here rather than buried in code so it can be
challenged. It is the same step `parrying-versions.md` takes, for the same
template family.

## Per-item versions

Read from each page's own wikitext (`action=query&prop=revisions`), which is the
stronger read because it is the source the affix page's grouping renders from.
All 35 agree with the `Found on:` grouping on `Riposte`, with zero unmatched in
either direction.

| Item | Invocation | AC | Saves |
|---|---|---|---|
| Aegis of the Deep | IV | 2 | 2 |
| Azure Guard | +6 | 6 | 6 |
| Barnacled Buckler | VIII | 4 | 4 |
| Blackfeather Boots | +4 | 4 | 4 |
| Blockade | IV | 2 | 2 |
| Breaker of Bodies | +2 | 2 | 2 |
| Commodore Alaina's Cutlass | +2 | 2 | 2 |
| Emerald Twilight | VII | 4 | 3 |
| Epic Ethereal Bracers | IX | 5 | 4 |
| Epic Ship Kickers | X | 5 | 5 |
| Epic Smash 'n Grabber | +4 | 4 | 4 |
| Fortified Fiddle | IV | 2 | 2 |
| Guardian's Bracers (level 15) | VIII | 4 | 4 |
| Guardian's Bracers (level 26) | IX | 5 | 4 |
| Legendary Breaker of Bodies | +6 | 6 | 6 |
| Legendary Commodore Alaina's Cutlass | +6 | 6 | 6 |
| Legendary Omniscience | +6 | 6 | 6 |
| Legendary Pearl of Uncanny Prediction | +6 | 6 | 6 |
| Legendary Planar Lariat | +7 | 7 | 7 |
| **Legendary Sapphire of Riposte** (augment) | +6 | 6 | 6 |
| Legendary Smash 'n Grabber | +6 | 6 | 6 |
| Legendary Warsword Shield | +6 | 6 | 6 |
| Master's Riposte (level 17) | VI | 3 | 3 |
| Master's Riposte (level 18) | VII | 4 | 3 |
| Master's Riposte (level 19) | VIII | 4 | 4 |
| Master's Riposte (level 26) | X | 5 | 5 |
| Master's Riposte (level 27) | XI | 6 | 5 |
| Master's Riposte (level 28) | XII | 6 | 6 |
| Planar Lariat | +3 | 3 | 3 |
| **Sapphire of Riposte** (augment) | +2 | 2 | 2 |
| Ship Kickers | V | 3 | 2 |
| Spare Hand (level 3) | +1 | 1 | 1 |
| Van Richten's Cane | +2 | 2 | 2 |
| Van Richten's Legendary Cane | +6 | 6 | 6 |
| Warsword Shield | +2 | 2 | 2 |

The two **augments** are why the split runs on two channels. They live in the
`<Color> Augment Slot` crafting pools, not the planner item roster, so the
item-side apply never reaches them — and `Legendary Sapphire of Riposte` is the
item #546 was reported about. Coverage of one channel is not coverage of the
other (#293's lesson).

## The cross-affix non-stacking rule

The page states it verbatim: *"Same effect as Parrying, therefore bonuses does
not stack."*

**No special case implements it.** Riposte, Parrying and Heightened Awareness all
emit `Armor Class` (and, for the first two, the three saves) typed `Insight`, and
the solver's bucket-max core caps every `(stat, bonus_type)` bucket at one
contributor, so the rule enforces itself. It holds only for as long as all three
keep emitting the same stats under the same bonus type — **retyping any one of
them would silently restore double-counting**, with no test failing unless one
pins it.

`tests/solver.test.js` pins it against shipped data: Epic Ethereal Bracers
(Riposte IX) and Admiral's Cummerbund (Parrying +2) worn together solve to 5 Armor
Class and 4 Fortitude Save, not 7 and 6. The saves half matters — Parrying and
Heightened Awareness are an AC-only pair, so before this no test covered an
Insight *save* bucket at all.

Note the direction of the pre-#546 error: because `Riposte` was its own stat name,
it never double-counted with Parrying. It simply scored nothing. Splitting it
closes a hole rather than opening one.

## What is not modelled

The proc half — *"When Missed in Melee: Deals X - 4\*X damage to your attacker"* —
is unmodelled and stays that way. That is #331 (proc magnitude, rate and uptime
valuation), not this split.

There is also **no set-bonus expansion path**, unlike Parrying. No set tier in the
catalog grants `Riposte`. Adding one would be a dormant guard protecting a path
the shipping dataset never uses, which is what #225 is open about.
`tests/test_riposte_split.py` asserts the absence against the built dataset, so
the day a set does grant it, the build says so instead of silently dropping it.

## Related

- `docs/wiki-evidence/parrying-versions.md` — the sibling enchantment, the same
  two-dialect trap, and the KTD6 anti-shadow rule this split reuses verbatim.
- `docs/solutions/conventions/bundled-template-values-live-in-the-tooltip-not-the-cell.md`
  — the class of defect this belongs to, found first on `Speed`.
- `docs/solutions/conventions/exclude-until-verified-data-gates.md` — why an
  unharvested numeral is quarantined rather than read from gear-planner.
- `docs/wiki-evidence/harvest-method.md` — the transport, pacing, and
  privacy-guard constraints every call here inherited.
