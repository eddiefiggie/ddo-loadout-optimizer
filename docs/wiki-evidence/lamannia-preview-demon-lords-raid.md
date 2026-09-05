# Lamannia preview — "Terror of the Demon Lords" raid loot

**Harvested:** 2026-09-05
**Artifact:** `data/seed/compendium/raw/lamannia_preview_items.json`
**Status:** PREVIEW / UNCONFIRMED — not solver-eligible, not `wiki_confirmed`, not parsed into affixes.

---

## What this is

A new raid, **Terror of the Demon Lords**, has appeared on the DDO wiki as an Update 81
dot-release addition to the Terror of Demogorgon pack (`raid = yes`, Legendary CR 37, patron
Battlehammer Expedition). Twenty named items are attributed to its **end chest**, all ML35.
This is the wikitext for all twenty, banked as-is.

It is banked and **not adopted** because the pages are Lamannia data — see below.

## Why it is quarantined rather than merged

1. **The pages carry `{{Lamannia}}`.** 19 of 20 item pages and the raid page itself are tagged
   with the preview-server banner. Lamannia numbers are pre-release and change before they ship.
2. **The release notes do not have it.** The documented U81 dot releases are 81.0.1, 81.1,
   81.1.1 and 81.2. U81.2 (2026-08-19, the newest at harvest) adds the quest *Raiding the
   Raiders* — which is `raid = false` despite the name — and says nothing about this raid.
3. **The data reads unfinished.** `The Unspeakable Maw` and `The Unspeakable Power` both carry
   the placeholder description `Praise.`; `The Prince of Demons` has an empty description.
   `The Butcher's Mouth` / `Teeth` / `Tongue` (Morningstar / Heavy Mace / Light Mace) carry
   byte-identical affix lists, which may be intended or may be copy-paste in progress.

Under exclude-until-verified, none of that reaches the solver.

## The one banner exception

`Item:The Unspeakable Power` has **no** `{{Lamannia}}` banner while the other 19 do. It shares
the raid, the ML and the end chest with them, so the likelier reading is an editor slip rather
than a promotion to live. It is flagged in the artifact's `_banner_exception` and must be
re-checked at promotion time rather than treated as already-confirmed.

## Why it cannot leak into a build

Nothing enumerates `data/seed/compendium/raw/`. Every consumer names its input file explicitly
(`gearplanner_items` / `_crafting` / `_sets` / `_affix_synonyms`), so an extra file in that
directory is inert by construction. The quarantine is structural, not a convention anyone has
to remember.

## Transport and integrity

Harvested per `harvest-method.md`: one POST to `/api.php` carrying all 20 titles
(`action=query&prop=revisions&rvprop=content&rvslots=main`) from a ddowiki tab.

Two notes worth keeping:

- **A page navigation really does clear the 202 throttle.** Roughly a dozen exploratory
  `action=parse` calls tripped the persistent `202`-empty block; navigating the tab to a real
  ddowiki page and waiting ~40s restored clearance, and the single 20-title POST then went
  through first try. The bulk POST is both faster *and* cheaper on the rate limit than paced
  single-page calls — prefer it.
- **The DOM export bridge collapses whitespace.** `get_page_text` normalizes runs of spaces, so
  the template field alignment padding (the spaces before `=`) did not survive; nothing else
  differs. Verified by comparing per-item SHA-256 of whitespace-normalized wikitext, browser vs
  repo: **20/20 match**. If a future harvest needs byte-exact wikitext, this bridge cannot give
  it to you.

## Promotion procedure (when the raid goes live)

1. Re-harvest all 20 titles and confirm the `{{Lamannia}}` banners are gone.
2. Diff the fresh wikitext against `lamannia_preview_items.json` and record every changed value
   — that diff is the whole point of banking the preview.
3. Only then parse `enhancements_raw` through the strict `affix_parser`, with the usual rules:
   explicit stat+value only, quarantine anything ambiguous, never infer.
4. Check whether the upstream gear-planner snapshot has caught up; if it has, it is the cheaper
   source and this file becomes corroboration rather than input.
5. Delete this quarantine file once the items are in the dataset by the normal path.

## Items (all ML35, end chest)

| Item | Kind |
|---|---|
| The Prince of Demons | Armor (Medium) |
| The Diadem of Rot | Clothing (Helm) |
| The Skull of the Horned King | Clothing (Helm) |
| The Queen of Rot | Clothing (Cloak) |
| The Volley's Aria | Clothing (Gloves) |
| The Unbreakable Divinity | Jewelry (Necklace) |
| The Sixth Toe of the Shadow King | Jewelry (Trinket) |
| The Butcher's Mind | Shield (Orb) |
| The Unspeakable Power | Shield (Orb) |
| The Unspeakable Maw | Rune Arm |
| The Butcher's Mouth | Weapon (Morningstar) |
| The Butcher's Teeth | Weapon (Heavy Mace) |
| The Butcher's Tongue | Weapon (Light Mace) |
| The Deep Father's Fang | Weapon (Dagger) |
| The Faceless Lord's Reach | Weapon (Long Bow) |
| The Fetid Prince's Fury | Weapon (Maul) |
| The Shadow Lord's Arcana | Weapon (Club) |
| The Slime Father's Staff | Weapon (Quarterstaff) |
| Echo of Heartcleaver | Weapon (Dwarven War Axe) |
| Echo of the Wand of Orcus | Weapon (Club) |
