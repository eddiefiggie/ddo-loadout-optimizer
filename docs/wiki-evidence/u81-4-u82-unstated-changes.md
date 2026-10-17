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
