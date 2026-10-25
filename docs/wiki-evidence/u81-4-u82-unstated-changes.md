# Update 81.4 / 82 changes the wiki does not state — disclosed gaps (#872, #874)

**Recorded:** 2026-10-17, after Update 82 (2026-10-14) settled. Per `AGENTS.md` (never infer a value), a change the release notes describe but no wiki page states is recorded here as a gap, not filled in.

## Still unstated (#872)

| 81.4 release-note line | Wiki state, 2026-10-17 | What the catalog does |
|---|---|---|
| "Legendary Armor Piercing now provides its intended bonuses" | `Armor-Piercing` was last edited 2026-04-08 and states only a generic "+X% Legendary bonus to Fortification Bypass"; no `Legendary Armor-Piercing` page exists; a search finds nothing on the fix | Credits what upstream parses. The "intended bonuses" are unknown, so nothing is added. |
| Set bonuses labelled "Universal" now grant each element | Set pages still say "Universal"; upstream `sets.json` still carries 35 of them | Already handled by **behaviour**, not labels: #877 (spell power and lore) and #881 (crit damage) apply the per-element rule the release notes state. The label is cosmetic. |

Lahar's DR-bypass augments, the third row #872 opened with, arrived through upstream in #880.

## Update 82 / The Court of Strahd (#874)

- **Release notes** (triaged 2026-10-14): no change to a stored value. The one gear line, "Heroic Dolorous weapon augments now grant their listed effects properly", fixed the game, not a listed value, and the catalog already credits the listed effects.
- **Event gear:** the wiki gained 22 `Item:` pages between 2026-10-13 and 2026-10-17. All 16 Court of Strahd pages are cosmetics: ten lanterns and skull lanterns (an event mechanic, "sense the Dark Power's intrusions … reveal the mists", plus a clicky), four Order cloaks (Cosmetic Cloak) and two Hexblood crowns (Cosmetic Headwear). The optimizer models no cosmetic slot. The other six pages are the ML32/36 **Night Revels** Spectral Great Axe, Great Crossbow and Warhammer. They are now in the catalog through `data/seed/compendium/wiki_supplement_items.json`, because upstream's updater has been down since 2026-10-14 (illusionistpm/ddo-gear-planner#223; a fix is offered as #224).
- **Retirement:** `src/wiki_supplement.py` fails the build the moment upstream carries any of those six names. The next normal re-vendor therefore forces the supplement out, and nothing has to be remembered.

The Court of Strahd runs to 2027-02-17. If later wiki pages add stat-bearing event gear, the next re-vendor carries it.

## Two search-summary leads, ruled not real (#934)

**Checked:** 2026-10-24, against ddowiki's own copies of the release notes, read in the Browser pane. ddo.com is not reachable from there. Both leads came only from search-engine summaries of DDO Compendium's copy of the notes, and the two summaries did not agree with each other.

| Lead | Wiki evidence, 2026-10-24 | Ruling |
|---|---|---|
| 82.0.1: "values of certain loot affixes have been adjusted to boost how much items contribute to Spell DCs, including named loot" | `Update 82 Hotfix Release Notes` (rev 721720; `Update 82.0.1` redirects there) opens "released on Friday, October 16th, 2026" and covers Escher, Lantern durability, Divine Punishment and Horizon Walker. Nothing in it matches "Spell DC", "DC", "spell focus", "affix" or "named loot". | Not real. No stored value changes. |
| U82: Insightful Spell Power Shard as a Ring Extra slot, and a new Insightful Spell Focus Mastery Shard for Headgear and Trinkets | `Update 82 Release Notes` has no "Insightful", "Essence" or "Extra slot" text. Its only shard line is the DDO Bonus Days crafting bonus for high-level Magic Item Shards, which is not an Essence placement. `Essence Crafting` (rev 719281) lists no Insightful Spell Focus Mastery shard. Its Spell Focus Mastery row is still `Spellmaster's`, on Necklace and Ring. | Not real. `src/essence_pool.py` is unchanged. |

**Item edits since the harvest:** no `Item:` page has been created since 2026-10-17. The edits from 2026-10-19 on are a forum-link bot pass, the lantern description rewrite, Reaper's Steed icons and update tags, and a zero-byte reshuffle on the Dreadcursed Defender pages. None of them touches a Spell Focus value. The 157 edits made on 2026-10-18 were not read here. The #933 wiki delta covers them.

**Reopen** if the official ddo.com text of either note carries the line. The wiki's copy is a transcription, and the official text is the authority.
