# Maximum spell points — `Wizardry` is the flat stat, `Maximum Spell Points (%)` is the percent stat, and they are not one name (#693)

**Ruled:** 2026-09-04, closing #693 as already-correct after #695. **Method:**
in-app Browser pane reads of `Wizardry`, `Lunar_and_Solar_Gems` (via #695) and
`Named_item_sets`, per `harvest-method.md`; measurements on build `09042026.3`.
**Shard:** none — no data change was required. **Guards:**
`src/set_tier_folds.py` (`check_channel`, both set channels) and
`tests/test_vocabulary.py::unit_marker_is_significant_flat_vs_percent_distinct`.

## The question #693 asked

The Eminence of Autumn 4-piece reached the dataset as a third spelling,
`Maximum Spellpoints` (`+10 Legendary bonus to Maximum Spellpoints`, 20 member
records), which no player could rank. #693 asked whether that name is the same
stat as `Wizardry` — the only spell-point name the picker suggests — and warned
against folding on resemblance alone.

## The wiki answers it: two stats, split by unit

1. [Wizardry](https://ddowiki.com/page/Wizardry): "Wizardry +X items: +X
   (Enhancement bonus / Insightful bonus / Quality bonus) to spell points." A
   **flat** count of spell points, every tier of it.
2. [Named item sets](https://ddowiki.com/page/Named_item_sets), Eminence of
   Autumn (Legendary), 4 Pieces Equipped: "+10**%** Legendary bonus to Maximum
   Spellpoints". A **percent** of the pool.
3. [Lunar and Solar Gems](https://ddowiki.com/page/Lunar_and_Solar_Gems), read
   for #695: Arcane Endurance is "Legendary Bonus to Maximum Spell Points +3%
   +6% +10%" — the same bonus type, magnitude and unit as the set tier, and the
   catalog already stores it as `Maximum Spell Points (%)`, Legendary 10.

So the tier is not `Wizardry`. It is the percent stat, whose canonical
`Maximum Spell Points (%)` already existed on the Solar Gems of Arcane
Endurance. #639 had split the pool on exactly this axis (flat → `Wizardry`,
percent → `Maximum Spell Points (%)`), and this repo keeps flat and percent
distinct on purpose: a percent and a flat number are not the same quantity, and
`tests/test_vocabulary.py` pins the `(%)` marker as significant.

## What #695 already did about it

The fold landed at the set-tier parse seam (`src/set_tier_folds.py`,
`SET_TIER_CANONICALS`), not through `affix_name_corrections.json` — see
`docs/solutions/conventions/a-percent-suffixed-canonical-cannot-survive-the-sets-channel.md`
for why the other route fails for a `(%)` canonical. Tier `raw` stays verbatim.
The stray third bucket is gone: all 27 occurrences (20 set records, 3 gems, 4
penalties) share one stat, and `check_channel` fails the build if the spelling
returns in either set channel.

## Measured on `09042026.3`

| query (ML 34) | Maximum Spell Points (%) | source placed |
|---|---|---|
| ranked alone | 10 | Solar Gem of Arcane Endurance (Legendary) |
| ranked alone, augments excluded (`printed-only` rung) | **10** | four Eminence of Autumn pieces (Legendary Darkmoss, Faedark Faerielights, Celestial Insignia, Bottled Rainstorm) |
| ranked with `Wizardry` | 10 / 841 | gem + flat Wizardry gear, both credited |

The second row is the proof #693 asked for: the 20 set-tier sources now score
against the canonical, with no gem in the pool to mask it.

## Why it is typeable but not suggested — and that is a standing ruling, not a gap

`Maximum Spell Points (%)` is in the picker's `known` set (a player who types
it gets it, and it scores as above) but not in `metadata.rankable_affixes` or
the suggestion list. That is **#189's ruling (closed 2026-08-30)**: a percent
affix is a percent *of a base the tool deliberately does not collect* (class,
level, casting stat — `AGENTS.md` lists character-sheet integration as a
non-goal), so the app will not offer it as a headline priority and pretend to
know what 10% is worth. The same ruling covers `Armor Class (%)`. Do not
re-open that half under this issue's name.

## What would change this ruling

Only a wiki statement that `Wizardry` itself is a percent, or that the Eminence
tier is a flat count. Neither page says so; the Wizardry page enumerates flat
magnitudes from +1 to +332 and nothing else.
