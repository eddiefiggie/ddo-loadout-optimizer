# "Terror of the Demon Lords" raid loot — preview harvest, and its promotion

**Preview harvested:** 2026-09-05 (Lamannia)
**Promoted:** 2026-09-22 (live)
**Status:** PROMOTED. All 20 items ship in the dataset, sourced through the normal
gear-planner path. The staging artifact has been deleted per step 5 below.

---

## What happened

A new raid, **Terror of the Demon Lords**, appeared on the DDO wiki on 2026-09-05 as an
Update 81 dot-release addition to the Terror of Demogorgon pack. Twenty named items were
attributed to its end chest, all ML35. The wikitext for all twenty was harvested and
**banked without being adopted**, because the pages carried the `{{Lamannia}}` preview-server
banner, no release note mentioned the raid, and several records read unfinished.

The raid went live in **Update 81.3 on 2026-09-16**. The promotion procedure below was run
on 2026-09-22 and all three quarantine reasons were cleared:

1. **The banners are gone.** All 20 item pages AND the raid page re-harvested; zero carry
   `{{Lamannia}}`. The one banner exception (`Item:The Unspeakable Power`) is moot — every
   page is now unbannered, so the editor-slip reading never had to be decided.
2. **The release notes have it.** `Update 81 Patch 3 Release Notes` opens "Here are the
   release notes for Update 81.3, released on Wednesday, September 16th, 2026." and states:
   *A new raid, "Terror of the Demon Lords," is available as part of the "Terror of
   Demogorgon" expansion pack.*
3. **The data is finished.** The placeholder descriptions resolved or stayed as the game
   ships them; ten items changed affixes, recorded in full below.

## Why banking it was worth the trouble

**Ten of the twenty items changed between the preview and live.** Adopting the Lamannia
harvest would have shipped ten wrong items, and nothing downstream would have flagged it —
a wrong affix is indistinguishable from a right one in a finished loadout.

| Item | Preview | Live |
|---|---|---|
| Echo of Heartcleaver | `{{Telekinetic\|\|122}}` | `{{Serrated}}` |
| Echo of the Wand of Orcus | — | **added** `{{Overwhelming Despair}}` |
| The Butcher's Mind | — | **added** `{{Nearly Complete\|Spell Focus\|13}}`, `{{Augment\|Orange}}` |
| The Deep Father's Fang | `{{Disintegrate\|7}}`; crit `20 / x2` | `{{Serrated}}`; crit `19-20 / x2` |
| The Prince of Demons | `{{Conditioning\|5\|Legendary}}` | `{{Conditioning\|10\|Legendary}}` |
| The Shadow Lord's Arcana | `{{Spell Focus\|Enchantment\|14}}` | `{{Nearly Complete\|Spell Focus\|14}}` |
| The Sixth Toe of the Shadow King | `{{Guard\|Nullmagic}}`, `{{Spell Focus\|Mastery\|2\|Quality}}` | `{{Shielded by Moonlight}}`, `{{Demonic Shield\|Legendary}}` |
| The Unbreakable Divinity | `{{Augment\|Colorless}}` | `{{Augment\|Yellow}}` |
| The Unspeakable Power | — | **added** `{{Nearly Complete\|Spell Focus\|13}}`, `{{Augment\|Orange}}` |
| The Volley's Aria | `{{Doubleshot\|10}}` | `{{Shadow Striker}}` |

Two changes are worth naming because they move more than a number. `The Butcher's Mind` and
`The Unspeakable Power` each gained an **Orange augment slot**, which a preview-sourced
dataset would have denied the player entirely. And three items gained a `Nearly Complete`
host declaration, which is what put them into upstream's three new per-item pools.

The other ten items are unchanged, and the descriptions the preview flagged as unfinished
(`Praise.` on both Unspeakable items, an empty one on `The Prince of Demons`) are unchanged
too — they are what the game ships, not placeholders.

## How they actually reached the solver

**Not from this file.** Procedure step 4 asked whether the upstream gear-planner snapshot had
caught up; it had. The vendored snapshot moved to `397c673a3561d65974d8e1079c5a0fa781ce1172`
(2026-09-23), which carries all twenty, and spot-checking its records against the live wiki
shows it matches LIVE rather than preview — `Serrated` not `Telekinetic`, `Overwhelming
Despair` present. So the wiki harvest became **corroboration** and the re-vendor became the
input, which is the cheaper and better-guarded path: the items arrive through the same
pipeline, gates and vocabulary as every other item.

That re-vendor was not a drop-in. It fired a cascade of build gates and turned up two
upstream regressions; the adjudication of record is
`docs/reports/2026-09-23-gear-planner-u81-3-refresh.md`.

## Transport notes worth keeping

- **A page navigation really does clear the 202 throttle**, and it was needed repeatedly
  across this session. The bulk `prop=revisions` POST over 20 titles remains both faster and
  cheaper on the rate limit than paced single-page calls.
- **The DOM export bridge preserved template field alignment this time**, unlike the
  2026-09-05 harvest — but do not rely on it. What the bridge cannot do is prove itself, so
  the transcription was verified by computing SHA-256 of the returned text in the browser and
  again on the file on disk. **The first attempt silently dropped ten `DMG:` lines and the
  hashes caught it.** A bridge you have not hashed is a bridge you have not checked.

## Promotion procedure (retained for the next raid)

1. Re-harvest all titles and confirm the `{{Lamannia}}` banners are gone.
2. Diff the fresh wikitext against the banked preview and record every changed value — that
   diff is the whole point of banking the preview.
3. Only then parse anything through the strict `affix_parser`, with the usual rules.
4. **Check whether the upstream gear-planner snapshot has caught up first.** If it has, it is
   the cheaper source and the banked file becomes corroboration rather than input. It had.
5. Delete the quarantine file once the items are in the dataset by the normal path. Done —
   `data/seed/compendium/raw/lamannia_preview_items.json` is removed; this document keeps the
   diff, which is the part with lasting value.
