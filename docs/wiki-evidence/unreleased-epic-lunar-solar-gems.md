# Unreleased Epic Lunar/Solar gems — a red link is not a gem (#901)

**Ruled 2026-10-17** from ddowiki `Lunar_and_Solar_Gems`, read live in the in-app Browser pane.

## The ruling

**An Epic (ML 20) Lunar or Solar gem exists only if its ML20 cell on `Lunar_and_Solar_Gems` is a live link.** The page says so directly above its tables: only some gems have released Epic versions, and an unreleased one shows as a red link in the ML20 column. A red link carrying a number is a planned value, not an item.

| ML20 cell, both tables | Count |
|---|---:|
| Live link (released) | 17 |
| Red link (unreleased) | 86 |

The 17 released:
- Lunar: Magical Protection, Spell Difficulty, Spellpower.
- Solar: Charisma, Constitution, Dexterity, Dodge, Doublestrike, Fortification Bypass, Imbuement, Intelligence, Reflex, Spell Critical Chance, Strength, Strikethrough, Tactical DCs, Wisdom.

Upstream gear-planner carries exactly these 17.

## What this reverses

#631 / #635 counted 103 Epic `Item:` links on the gem page, read upstream's 17 as a scraping gap, and added 81 gems through `augment_tier_gap.json`. #640 added `Solar Gem of Arcana (Epic)` the same way, bringing the total to 82. **All 82 were red links.** The solver recommended them, and a player reported it ("solar/lunar epic gems that dont exist yet").

The contradiction sat in the repo from 2026-09-27. `augment-locations.md` found that all 82 had no `Item:` page and recorded it as a hole in the wiki rather than as the answer.

## Guards

- `src/wiki_links.check` fails the build on any named augment whose locations entry has no page. A pageless named augment is unreleased.
- `tests/test_overhaul_invariants.py` pins 17 Epic Lunar/Solar gems.

## Do not re-raise

"Upstream carries only 17 of 103 Epic gems" is **not** a gap. Do not re-add the tier from the gem tables' numbers. When a red link turns live (the gem ships), upstream's crafting dump picks it up, or it is harvested from its own `Item:` page.
